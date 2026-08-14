/**
 * Evidence Attribution — Durable Attribution Ledger + Ownership Ledger (M9-fix)
 *
 * Deterministic, identity-based recovery of stamped network requests:
 *
 *   capture (webRequest, CER-2 stamped sourceEventId)
 *     → DurableAttributionLedger.pushStamped()   [write-through, AWAITED
 *       chrome.storage.local.set — the durability gate: a stamped request is
 *       durable before the webRequest handler completes]
 *     → attachToInteractions() / rehydrate()     [identity join, exactly-once]
 *     → acknowledge(requestIds)                  [delete AFTER LIVE_INTERACTIONS
 *       persistence — state-based eviction, no TTL]
 *
 * Recovery triggers (all event-driven, no timers):
 *   - SW boot (rehydrate), BEHAVIORAL_EVIDENCE attach, onCommitted, STOP drain.
 *
 * Invariants: see .drytis/specs/form-submit-evidence-recovery.md (INV-1..INV-8
 * + durability gate/load, session scoping, event-driven recovery,
 * pre-capture durability).
 *
 * Architecture: behavioral-evidence-model.md §9 (MV3 resilience) extended.
 */

import type {
  BehavioralEvidence,
  NetworkActivity,
} from '../shared/behavioral-evidence-types';
import type { ComponentInteraction } from '../shared/component-types';

// ── Storage key ────────────────────────────────────────────────────────
// Single source of truth: the shared enum value. Kept as a literal ONLY as
// a fallback when the enum import would create a cycle; asserted equal in
// tests to prevent drift.
import { StorageKeys } from '../shared/types';

const UNATTACHED_REQUESTS_KEY: string = StorageKeys.UNATTACHED_REQUESTS;

// ── Types ──────────────────────────────────────────────────────────────

/** A captured network request stamped with the trusted action's eventId. */
export interface StampedRequest {
  url: string;
  method: string;
  /** 0/null = captured at onBeforeRequest, completion not yet observed. */
  status: number;
  requestId: string;
  sourceEventId?: string;
  requestBody?: Record<string, string>;
  documentRequest?: boolean;
  /** True when captured as a main_frame request (CER-2 pre-redirect record). */
  mainFrame?: boolean;
  /** Serialized shape stored durably (status may be null pre-completion). */
  [k: string]: unknown;
}

/** Result of a boot reconciliation pass. */
export interface RehydrateResult {
  /** Entries attached (and acked) during this pass. */
  attached: StampedRequest[];
  /** Entries whose sourceEventId did not resolve — remain in the store. */
  unresolved: StampedRequest[];
}

// ── Filters (mirror network-drain.ts; exemption: stamped main-frame POSTs) ──

const NOISE_URL_RE =
  /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf)(\?|$)/i;

const TELEMETRY_URL_RE =
  /\/unagi|\/events\/|\/beacon|\/pixel|\/csm|\/aax2|\/impression|fls-|\/1\/batch\/|uedata/i;

/**
 * Whether a stamped entry should attach. Telemetry/noise URLs are dropped
 * EXCEPT stamped main-frame POSTs: a main-frame POST stamped with a trusted
 * action's eventId is by definition user-caused navigation (form submit),
 * never background telemetry — its URL can legitimately match the filter
 * (e.g. Amazon uedata endpoints receiving cart actions).
 */
function shouldAttach(entry: StampedRequest): boolean {
  if (entry.mainFrame && entry.method !== 'GET') return true;
  if (NOISE_URL_RE.test(entry.url)) return false;
  if (TELEMETRY_URL_RE.test(entry.url)) return false;
  return true;
}

/** Max entries per interaction (matches network-drain MAX_PER_INTERACTION). */
const MAX_PER_INTERACTION = 20;
/** Memory safety valve only — never a correctness mechanism (state eviction). */
const MAX_GLOBAL_STAMPED = 500;

// ── Ownership ledger (exactly-once authority, INV-2) ───────────────────

/**
 * requestId → interactionId. THE single exactly-once authority across all
 * attachment paths (live supplement, commit-time, boot reconcile, drain).
 * Rebuilt on SW boot by scanning LIVE_INTERACTIONS networkActivity.
 */
export class RequestOwnershipLedger {
  private readonly owners = new Map<string, string>();

  /** Rebuild from persisted interactions (crash-point-A convergence). */
  rebuildFromInteractions(interactions: ComponentInteraction[]): void {
    this.owners.clear();
    for (const i of interactions) {
      const net = i.behavioralEvidence?.applicationEvidence?.networkActivity ?? [];
      for (const entry of net) {
        const rid = (entry as NetworkActivity & { requestId?: string }).requestId;
        if (rid) this.owners.set(rid, i.interactionId);
      }
    }
  }

  isAttached(requestId: string): boolean {
    return this.owners.has(requestId);
  }

  getInteractionId(requestId: string): string | null {
    return this.owners.get(requestId) ?? null;
  }

  markAttached(requestId: string, interactionId: string): void {
    this.owners.set(requestId, interactionId);
  }
}

// ── Identity resolver (INV-1: two-tier, exact-string join) ─────────────

/**
 * Resolve the interaction owning an eventId — triggerEvent first, then
 * memberEvents. Returns null when nothing matches (never guesses).
 * Non-navigation interactions only: the causal owner of a stamped request
 * is the trusted action. Synthetic navigations are excluded from JOINING
 * but remain valid FALLBACK attach targets for unresolved document POSTs
 * (see service-worker commit-time routing).
 */
export function resolveInteractionForEventId(
  eventId: string,
  interactions: ComponentInteraction[],
): ComponentInteraction | null {
  // Tier 1: trigger match
  for (const interaction of interactions) {
    if (interaction.triggerEvent?.eventId === eventId) {
      if (isSyntheticNavigation(interaction)) continue;
      return interaction;
    }
  }
  // Tier 2: member-event match
  for (const interaction of interactions) {
    if (interaction.memberEvents?.some((e) => e.eventId === eventId)) {
      if (isSyntheticNavigation(interaction)) continue;
      return interaction;
    }
  }
  return null;
}

function isSyntheticNavigation(i: ComponentInteraction): boolean {
  return i.behavioralEvidence?.window?.endReason === 'page-reload-synthetic';
}

// ── Thin evidence synthesis (INV-4/INV-7) ──────────────────────────────

/**
 * Build a minimal BehavioralEvidence for an interaction that has none —
 * the fast form-submit case (click window destroyed by pagehide before any
 * evidence was delivered). Never overwrites existing evidence.
 *
 * The shape mirrors the existing 'evidence-timeout' evidence (sw-integration),
 * with endReason 'sw-recovered-form-submit' to mark the SW recovery path.
 * Because it is thin (richness 0), the existing replace-if-richer branch
 * (Fix Round 5) lets later content-script evidence replace it while
 * preserving merged network — richness monotonicity holds.
 */
export function synthesizeMinimalEvidence(
  interaction: ComponentInteraction,
  sourceEventId: string,
): BehavioralEvidence {
  if (interaction.behavioralEvidence) return interaction.behavioralEvidence;

  const evidence: BehavioralEvidence = {
    sourceEventId,
    sourceEventType: interaction.triggerEvent?.eventType ?? 'click',
    windowId: `sw-${sourceEventId}`,
    frameId: 'main',
    window: {
      openedAt: 0,
      closedAt: 0,
      durationMs: 0,
      endReason: 'sw-recovered-form-submit',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: null,
      identityCapturedAt: 0,
      before: null,
      after: null,
      focusMovement: null,
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      performanceCondition: {
        mainThreadBlocked: false,
        highChurnMode: false,
        longestBatchMs: 0,
        totalBatches: 0,
      },
    },
  };
  interaction.behavioralEvidence = evidence;
  return evidence;
}

// ── Durable attribution ledger ─────────────────────────────────────────

/**
 * Write-through ledger of stamped, not-yet-attached requests.
 *
 * DURABILITY GATE: pushStamped() awaits chrome.storage.local.set() inside the
 * same webRequest listener dispatch that captured the request — the handler
 * is not complete until the entry is durable. On storage failure: log +
 * memory-only degrade (strictly no worse than the pre-fix state); never throws.
 *
 * EVICTION (state-based only, no TTL):
 *   - acknowledge(requestIds): deleted AFTER the owning interaction was
 *     persisted to LIVE_INTERACTIONS (delete-after-persist ordering).
 *   - clearAll(): session-end cleanup (STOP / new recording start).
 *   - MAX_GLOBAL_STAMPED: memory safety valve for the in-memory copy.
 */
export class DurableAttributionLedger {
  /** In-memory mirror of the durable store: sourceEventId → entries. */
  private readonly entries = new Map<string, StampedRequest[]>();
  /** Shared exactly-once authority across all attach paths. */
  private readonly ownership = new RequestOwnershipLedger();
  /** Whether a durable write has succeeded this session (degrade tracking). */
  private durable = true;
  /** Resolves AFTER the latest in-flight durable write settles (gate). */
  private writeChain: Promise<void> = Promise.resolve();

  // ── Capture (durability gate) ──────────────────────────────────────

  /**
   * Record a stamped request. Durable before this promise resolves
   * (or memory-only if storage rejected — logged, non-fatal).
   */
  async pushStamped(entry: StampedRequest): Promise<void> {
    if (!entry.sourceEventId) return; // unstamped → not attributable, not our case
    if (this.ownership.isAttached(entry.requestId)) return; // already attached

    const list = this.entries.get(entry.sourceEventId) ?? [];
    if (list.some((e) => e.requestId === entry.requestId)) return; // dedup
    list.push(entry);
    if (list.length > MAX_PER_INTERACTION) list.splice(0, list.length - MAX_PER_INTERACTION);
    this.entries.set(entry.sourceEventId, list);

    // Memory safety valve (in-memory only; durability is not capped — but a
    // rejected/missing store means memory is all we have, so bound it).
    if (this.countAll() > MAX_GLOBAL_STAMPED) this.evictOldestInMemory();

    // DURABILITY GATE — serialized to keep the stored object consistent.
    this.writeChain = this.writeChain.then(() => this.persist()).catch(() => {
      /* keep chain alive on failure */ });
    await this.writeChain;
  }

  /**
   * Pre-attach filter + attempt: used by push-time fast paths that have
   * interactions at hand (not currently wired — kept for parity).
   */
  size(): number {
    return this.countAll();
  }

  // ── Commit-time routing entry point (INV-5) ────────────────────────

  /**
   * Push a stamped entry (idempotent — enriches status/url if the durable
   * at-capture copy is older) and attempt immediate attach to `interactions`.
   * Returns true when at least one entry attached (caller must persist
   * LIVE_INTERACTIONS — persist-before-ack).
   */
  async attachStampedActivity(
    entry: StampedRequest,
    interactions: ComponentInteraction[],
  ): Promise<boolean> {
    await this.pushStamped(entry);
    return this.attachToInteractions(interactions) > 0;
  }

  // ── Attach (identity join + synthesize-on-missing, INV-1/INV-4) ────

  /**
   * Attach every attachable stamped entry to its owning interaction
   * (two-tier identity join). Synthesizes thin evidence when the interaction
   * has none. Returns the number of entries attached (not interactions).
   *
   * Callers MUST persist LIVE_INTERACTIONS after this returns non-zero, then
   * call acknowledge() with the persisted requestIds — delete-after-persist
   * ordering is the caller's side of the crash-point contract.
   */
  attachToInteractions(interactions: ComponentInteraction[]): number {
    if (this.entries.size === 0) return 0;
    this.ownership.rebuildFromInteractions(interactions);

    let attached = 0;
    for (const [sourceEventId, list] of this.entries) {
      const target = resolveInteractionForEventId(sourceEventId, interactions);
      if (!target) continue;

      for (const entry of [...list]) {
        if (this.ownership.isAttached(entry.requestId)) continue;
        if (!shouldAttach(entry)) {
          this.entries.get(sourceEventId)?.splice(
            this.entries.get(sourceEventId)!.indexOf(entry), 1);
          continue;
        }
        const evidence = synthesizeMinimalEvidence(target, sourceEventId);
        const net = evidence.applicationEvidence.networkActivity;
        if (net.length >= MAX_PER_INTERACTION) continue;
        net.push(toNetworkActivity(entry));
        this.ownership.markAttached(entry.requestId, target.interactionId);
        // INV-5 causal ownership: a recovered main-frame document request
        // stamps the causal link onto the synthetic navigation it produced.
        if (entry.mainFrame || entry.documentRequest) {
          this.stampCausalLink(interactions, target.interactionId);
        }
        attached++;
      }
      // Remove entries that were attached or filtered out.
      this.pruneKey(sourceEventId);
    }
    if (attached > 0) this.persist(); // durable store shrinks as we attach
    return attached;
  }

  // ── Boot reconciliation (event-driven recovery, T11–T16) ───────────

  /**
   * SW boot: rebuild from the durable store + LIVE_INTERACTIONS.
   *   - Entries whose requestId is already attached (crash-point A:
   *     persisted but not acked) are dropped and the store cleaned.
   *   - Resolvable entries are attached (crash-point B: stored, never
   *     attached) — final state identical to the no-crash run.
   *   - Unresolved entries remain (evidence flush still pending) and are
   *     retried on the next event-driven trigger.
   */
  async rehydrate(interactions: ComponentInteraction[]): Promise<RehydrateResult> {
    this.entries.clear();
    this.ownership.rebuildFromInteractions(interactions);

    const raw = await chrome.storage.local.get(UNATTACHED_REQUESTS_KEY);
    const stored = (raw?.[UNATTACHED_REQUESTS_KEY] ?? {}) as Record<
      string,
      StampedRequest[]
    >;
    for (const [k, list] of Object.entries(stored)) {
      if (Array.isArray(list) && list.length > 0) this.entries.set(k, [...list]);
    }

    // Drop crash-point-A leftovers (attached but not acked) before joining.
    let changed = false;
    for (const [k, list] of this.entries) {
      const surviving = list.filter((e) => !this.ownership.isAttached(e.requestId));
      if (surviving.length !== list.length) changed = true;
      if (surviving.length === 0) this.entries.delete(k);
      else this.entries.set(k, surviving);
    }
    if (changed || this.entries.size > 0) await this.persist();
    if (this.entries.size === 0) {
      await chrome.storage.local.remove(UNATTACHED_REQUESTS_KEY).catch(() => {});
      return { attached: [], unresolved: [] };
    }

    const attached = this.attachToInteractions(interactions);
    const unresolved: StampedRequest[] = [];
    for (const list of this.entries.values()) unresolved.push(...list);

    if (attached > 0 || changed) {
      // Persist the SURVIVORS (unresolved entries stay durable — they are
      // retried on the next event trigger); persist() removes the key when
      // everything attached, which is the acknowledge for this pass.
      await this.persist();
    }
    return {
      attached: attached > 0 ? this.collectAttached(interactions) : [],
      unresolved,
    };
  }

  /** Entries the interactions already own (used to report what rehydrate attached). */
  private collectAttached(interactions: ComponentInteraction[]): StampedRequest[] {
    const out: StampedRequest[] = [];
    for (const i of interactions) {
      for (const entry of i.behavioralEvidence?.applicationEvidence?.networkActivity ?? []) {
        const rid = (entry as NetworkActivity & { requestId?: string }).requestId;
        if (rid && this.ownership.isAttached(rid)) {
          out.push({
            requestId: rid,
            url: entry.url,
            method: entry.method,
            status: entry.status ?? 0,
            sourceEventId: entry.sourceEventId,
          });
        }
      }
    }
    return out;
  }

  // ── Acknowledge / cleanup ──────────────────────────────────────────

  /**
   * Delete requestIds from the durable store AFTER their interactions were
   * persisted to LIVE_INTERACTIONS. Fire-and-forget from attach paths;
   * crash between persist and ack converges via rehydrate's crash-point-A
   * drop (ownership rebuild).
   */
  acknowledge(requestIds: string[]): void {
    if (requestIds.length === 0) return;
    for (const rid of requestIds) {
      for (const [k, list] of this.entries) {
        const idx = list.findIndex((e) => e.requestId === rid);
        if (idx >= 0) {
          list.splice(idx, 1);
          if (list.length === 0) this.entries.delete(k);
        }
      }
    }
    void this.persist();
  }

  /** Session-end cleanup: STOP / new recording start (INV session scoping). */
  async clearAll(): Promise<void> {
    this.entries.clear();
    this.ownership.rebuildFromInteractions([]);
    await chrome.storage.local.remove(UNATTACHED_REQUESTS_KEY).catch(() => {});
    this.durable = true;
  }

  /** Whether the last durable write succeeded (diagnostics). */
  isDurable(): boolean {
    return this.durable;
  }

  // ── Internal ───────────────────────────────────────────────────────

  /** Drop entries already attached/filtered under a key; delete key if empty. */
  private pruneKey(sourceEventId: string): void {
    const list = this.entries.get(sourceEventId);
    if (!list) return;
    const surviving = list.filter((e) => !this.ownership.isAttached(e.requestId));
    if (surviving.length === 0) this.entries.delete(sourceEventId);
    else this.entries.set(sourceEventId, surviving);
  }

  /**
   * INV-5: when a recovered document request attaches to its causal owner
   * (the click), stamp causedByInteractionId on the synthetic navigation it
   * produced — the nav records the causal link but carries no network.
   */
  private stampCausalLink(
    interactions: ComponentInteraction[],
    causeInteractionId: string,
  ): void {
    for (const i of interactions) {
      const ev = i.behavioralEvidence as unknown as Record<string, unknown> | undefined;
      if (
        ev &&
        i.behavioralEvidence?.window?.endReason === 'page-reload-synthetic' &&
        ev.causedByInteractionId === undefined
      ) {
        ev.causedByInteractionId = causeInteractionId;
      }
    }
  }

  private countAll(): number {
    let n = 0;
    for (const list of this.entries.values()) n += list.length;
    return n;
  }

  private evictOldestInMemory(): void {
    // FIFO across keys (Map preserves insertion order).
    while (this.countAll() > MAX_GLOBAL_STAMPED && this.entries.size > 0) {
      const firstKey = this.entries.keys().next().value as string;
      const list = this.entries.get(firstKey)!;
      list.shift();
      if (list.length === 0) this.entries.delete(firstKey);
    }
  }

  /** Write the current entry map through to storage (single key, atomic). */
  private async persist(): Promise<void> {
    try {
      if (this.entries.size === 0) {
        await chrome.storage.local.remove(UNATTACHED_REQUESTS_KEY);
      } else {
        await chrome.storage.local.set({
          [UNATTACHED_REQUESTS_KEY]: Object.fromEntries(this.entries),
        });
      }
      this.durable = true;
    } catch (e) {
      // Memory-only degrade — strictly no worse than the pre-fix state.
      this.durable = false;
      console.warn(
        '[AttributionLedger] durable write failed — memory-only degrade:',
        (e as Error)?.message,
      );
    }
  }
}

/** Convert a stamped entry into an applicationEvidence networkActivity row. */
function toNetworkActivity(entry: StampedRequest): NetworkActivity & { requestId?: string } {
  return {
    url: entry.url,
    method: entry.method,
    status: entry.status || null,
    startRelativeToEvent: 0,
    endRelativeToEvent: null,
    durationMs: null,
    resourceType: entry.mainFrame ? 'navigation' : 'unknown',
    source: 'webrequest',
    requestBody: entry.requestBody,
    sourceEventId: entry.sourceEventId,
    requestId: entry.requestId,
  };
}
