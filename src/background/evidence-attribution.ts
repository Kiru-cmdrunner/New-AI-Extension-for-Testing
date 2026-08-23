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
import type { ElementIdentity } from '../shared/types';

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
  /**
   * G4-B (triple key): the tab/frame the request was captured in. Optional
   * (older records / tests omit it). When BOTH the entry and the candidate
   * interaction carry an origin, they must MATCH (tab and frame); when
   * either side lacks one, the eventId alone decides (primary key).
   */
  captureOrigin?: { tabId: number; frameId: number };
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
  // G2 identity-not-shape: a STAMPED mainFrame document request is
  // user-caused by definition (the stamp is causal proof — sync dispatch
  // write or form_submit back-fill). Method and body presence are display
  // metadata; they never gate participation. GET form submits and
  // body-less POSTs (Chrome only parses urlencoded/multipart) attach.
  if (entry.mainFrame) return true;
  if (NOISE_URL_RE.test(entry.url)) return false;
  if (TELEMETRY_URL_RE.test(entry.url)) return false;
  return true;
}

/** Max entries per interaction (matches network-drain MAX_PER_INTERACTION). */
const MAX_PER_INTERACTION = 20;
/** Memory safety valve only — never a correctness mechanism (state eviction). */
const MAX_GLOBAL_STAMPED = 500;

/** True when a status is a REAL observed completion status (200/302/404…). */
function isRealStatus(status: number | null | undefined): boolean {
  return typeof status === 'number' && status > 0;
}

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
  origin?: { tabId: number; frameId: number },
): ComponentInteraction | null {
  // G4-B triple-key rule: when BOTH the stamped request and the candidate
  // interaction carry a capture origin, they must match (tab + frame).
  // When either side lacks an origin, eventId alone decides (primary key).
  const matches = (i: ComponentInteraction): boolean => {
    const io = i.metadata?.captureOrigin as { tabId: number; frameId: number } | undefined;
    if (origin && io) {
      return io.tabId === origin.tabId && io.frameId === origin.frameId;
    }
    return true;
  };
  // Tier 1: trigger match
  for (const interaction of interactions) {
    if (interaction.triggerEvent?.eventId === eventId) {
      if (isSyntheticNavigation(interaction)) continue;
      if (!matches(interaction)) continue;
      return interaction;
    }
  }
  // Tier 2: member-event match
  for (const interaction of interactions) {
    if (interaction.memberEvents?.some((e) => e.eventId === eventId)) {
      if (isSyntheticNavigation(interaction)) continue;
      if (!matches(interaction)) continue;
      return interaction;
    }
  }
  return null;
}

function isSyntheticNavigation(i: ComponentInteraction): boolean {
  return i.behavioralEvidence?.window?.endReason === 'page-reload-synthetic';
}

// 6F-M2b: a trigger with a truthy tag carries a real captured element
// shape (every genuine capture has one). Anything else is not an element
// identity to copy — synthesizeMinimalEvidence then keeps identity null.
function hasElementShape(trigger: unknown): trigger is ElementIdentity {
  return (
    typeof trigger === 'object' &&
    trigger !== null &&
    typeof (trigger as ElementIdentity).tag === 'string' &&
    (trigger as ElementIdentity).tag.length > 0
  );
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

  // G4-B: frameId mapping 0 ↔ 'main' — the synthesized evidence claims the
  // same frame as the trigger event's capture origin.
  const originFrame = (interaction.metadata?.captureOrigin as
    | { tabId: number; frameId: number }
    | undefined)?.frameId;
  const frameIdStr = originFrame === undefined || originFrame === 0 ? 'main' : String(originFrame);

  const evidence: BehavioralEvidence = {
    sourceEventId,
    sourceEventType: interaction.triggerEvent?.eventType ?? 'click',
    windowId: `sw-${sourceEventId}`,
    frameId: frameIdStr,
    window: {
      openedAt: 0,
      closedAt: 0,
      durationMs: 0,
      endReason: 'sw-recovered-form-submit',
      stabilityTrace: [],
    },
    targetEvidence: {
      // 6F-M2b (F4-D display honesty): seed the identity from the owning
      // interaction's trigger — the SAME captured element that produced the
      // click (trigger IS an ElementIdentity, component-types.ts:287). The
      // identity was never lost by the SW lifecycle; it simply wasn't copied
      // into the thin shape, so the panel rendered "Unknown element" for
      // exactly the cards whose ownership resolution had succeeded.
      // Clone (never share the reference) + guard: a shape-less trigger
      // (no tag) keeps null — honesty over fabrication.
      identity: hasElementShape(interaction.trigger)
        ? { ...(interaction.trigger as ElementIdentity) }
        : null,
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
  /**
   * Fix B bookkeeping: requestIds whose owning interaction row was STILL
   * NULL-status at the moment they were marked attached (first-delivery
   * freeze). Their ledger entries are NOT pruned at attach — they are the
   * Stop-time status-enrichment source until the completion merge lands a
   * real status (Fix A), the session ends (clearAll), or they are
   * acknowledged. Cleared on acknowledge/clearAll — the enrichment window
   * is bounded to the live session.
   */
  private readonly nullOwnedRequestIds = new Set<string>();
  /** Resolves AFTER the latest in-flight durable write settles (gate). */
  private writeChain: Promise<void> = Promise.resolve();

  // ── Capture (durability gate) ──────────────────────────────────────

  /**
   * Record a stamped request. Durable before this promise resolves
   * (or memory-only if storage rejected — logged, non-fatal).
   *
   * STATUS ENRICHMENT: a duplicate push (same requestId) is a *completion*
   * update, not a no-op — the at-capture write stores status 0 ("completion
   * not yet observed", network-observation.ts:984) and the onCompleted
   * dispatch (:1066) re-pushes with the real status. Merge-in-place:
   *   - status: upgrade-only (incoming > 0 AND stored <= 0 → adopt);
   *     a stored real status is NEVER overwritten or downgraded.
   *   - requestBody/sourceEventId/captureOrigin/documentRequest/mainFrame:
   *     fill-absent only, never clobber.
   * The stored object is mutated in place (no splice/re-push) so FIFO
   * eviction order and landed/ownership state are preserved.
   */
  async pushStamped(entry: StampedRequest): Promise<void> {
    if (!entry.sourceEventId) return; // unstamped → not attributable, not our case
    if (this.ownership.isAttached(entry.requestId)) {
      // COMPLETION ENRICHMENT (ledger-completion-enrichment.md Fix A +
      // ledger-completion-preservation.md Fix 1): the requestId is already
      // attached, BUT a completion push (real status > 0) still carries the
      // one thing the at-capture copy never had — the final status — while
      // the owning interaction's row was frozen at null (first-delivery,
      // pre-window-close). Upgrade-only merge; never re-attach, never a
      // second row. Status-0/absent pushes for owned ids: legacy no-op.
      if (!isRealStatus(entry.status)) return;
      // Find the KEPT ledger copy for this requestId (any key — the stamp
      // eventId is the natural one, but a re-pushed entry is authoritative
      // wherever it lands).
      const stored = this.findStoredByRequestId(entry.requestId);
      if (stored) {
        this.mergeIntoStored(stored, entry);
        this.writeChain = this.writeChain.then(() => this.persist()).catch(() => {
          /* keep chain alive on failure */ });
        await this.writeChain;
        return;
      }
      // Not in the map (pruned post-attach / acked / different key) →
      // RE-INSERT as a held completion. pendingComplete entries are
      // enrichment-only: never re-attached (ownership already holds the id),
      // never admitted to pendingAck, wiped by clearAll at session end.
      const held: StampedRequest & { pendingComplete?: boolean } = { ...entry };
      held.pendingComplete = true;
      const heldList = this.entries.get(entry.sourceEventId) ?? [];
      heldList.push(held);
      this.entries.set(entry.sourceEventId, heldList);
      this.nullOwnedRequestIds.add(entry.requestId);
      this.writeChain = this.writeChain.then(() => this.persist()).catch(() => {
        /* keep chain alive on failure */ });
      await this.writeChain;
      return;
    }

    const list = this.entries.get(entry.sourceEventId) ?? [];
    const stored = list.find((e) => e.requestId === entry.requestId);
    if (stored) {
      this.mergeIntoStored(stored, entry);
      // Durable write-through for the merged update (same serialized gate).
      this.writeChain = this.writeChain.then(() => this.persist()).catch(() => {
        /* keep chain alive on failure */ });
      await this.writeChain;
      return;
    }
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
   * Fix A helper: locate the kept ledger copy of an already-owned requestId
   * (any sourceEventId key). Null when none survived (pruned + acked).
   */
  private findStoredByRequestId(requestId: string): StampedRequest | undefined {
    for (const list of this.entries.values()) {
      const hit = list.find((e) => e.requestId === requestId);
      if (hit) return hit;
    }
    return undefined;
  }

  /**
   * Status-enrichment merge (in-place): upgrade-only status, fill-absent
   * metadata. See pushStamped's doc comment for the contract.
   */
  private mergeIntoStored(stored: StampedRequest, incoming: StampedRequest): void {
    if (
      typeof incoming.status === 'number' &&
      incoming.status > 0 &&
      !(typeof stored.status === 'number' && stored.status > 0)
    ) {
      stored.status = incoming.status;
    }
    if (stored.requestBody === undefined && incoming.requestBody !== undefined) {
      stored.requestBody = incoming.requestBody;
    }
    if (stored.captureOrigin === undefined && incoming.captureOrigin !== undefined) {
      stored.captureOrigin = incoming.captureOrigin;
    }
    if (stored.documentRequest === undefined && incoming.documentRequest !== undefined) {
      stored.documentRequest = incoming.documentRequest;
    }
    if (stored.mainFrame === undefined && incoming.mainFrame !== undefined) {
      stored.mainFrame = incoming.mainFrame;
    }
    // sourceEventId: identical by construction (it is the map key).
  }

  /** Read-only flat copy of all stamped entries (status-enrichment source). */
  snapshotStamped(): StampedRequest[] {
    const out: StampedRequest[] = [];
    for (const list of this.entries.values()) {
      for (const e of list) out.push({ ...e });
    }
    return out;
  }

  /**
   * Fix B bookkeeping: remember the interactions the ledger last saw so the
   * already-owned skip branch can inspect the owning row's CURRENT status
   * (live paths keep mutating rows after attach). Replaced on every
   * attachToInteractions pass.
   */
  private lastSeenInteractions: ComponentInteraction[] = [];

  /**
   * Pre-attach filter + attempt: used by push-time fast paths that have
   * interactions at hand (not currently wired — kept for parity).
   */
  /**
   * G5-D (INV-F5): hold a stamped doc request whose owner is not yet live.
   * Idempotent — same dedup rules as `pushStamped` (requestId ownership +
   * per-key dedup). The entry stays durable for the retry paths (STOP
   * drain, BEHAVIORAL_EVIDENCE retry, boot rehydrate); it is NEVER
   * rendered on the synthetic nav.
   */
  async holdStampedActivity(entry: StampedRequest): Promise<void> {
    await this.pushStamped(entry);
  }

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

  /** Attached entries awaiting the caller's LIVE_INTERACTIONS persist. */
  private pendingAck: StampedRequest[] = [];

  /**
   * Attach every attachable stamped entry to its owning interaction
   * (two-tier identity join). Synthesizes thin evidence when the interaction
   * has none. Returns the number of entries attached (not interactions).
   *
   * DELETE-AFTER-PERSIST: attached entries move to `pendingAck`, NOT yet
   * deleted from the durable store. The caller persists LIVE_INTERACTIONS
   * and then calls `acknowledgePersisted()` — only then are they durably
   * deleted. A crash between attach and ack converges via boot
   * reconciliation's ownership rebuild (crash-point A drops the leftover;
   * nothing duplicates, nothing is lost).
   */
  attachToInteractions(interactions: ComponentInteraction[]): number {
    if (this.entries.size === 0) return 0;
    this.ownership.rebuildFromInteractions(interactions);
    this.lastSeenInteractions = interactions;

    let attached = 0;
    const attachedNow: StampedRequest[] = [];
    for (const [sourceEventId, list] of this.entries) {
      // G4-B: pass the (first) entry's capture origin for triple-key
      // disambiguation — entries under one eventId share the stamp frame.
      const target = resolveInteractionForEventId(
        sourceEventId,
        interactions,
        list[0]?.captureOrigin,
      );
      if (!target) continue;

      for (const entry of [...list]) {
        if (this.ownership.isAttached(entry.requestId)) {
          // FIX B (already-owned skip): the requestId was attached by an
          // EARLIER path (live supplement) — check THAT owner's row now: if
          // it is still null-status, keep this ledger copy as the
          // enrichment source exactly as the fresh-attach branch does.
          const owner = this.ownership.getInteractionId(entry.requestId);
          const ownerRow = owner
            ? this.findNetworkRow(owner, entry.requestId)
            : undefined;
          if (owner && ownerRow && ownerRow.status == null) {
            this.nullOwnedRequestIds.add(entry.requestId);
          } else {
            // Owner's row now carries a real status → nothing left to
            // enrich; converge back to legacy prune behavior.
            this.nullOwnedRequestIds.delete(entry.requestId);
          }
          continue;
        }
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
        // FIX B: the freshly attached row mirrors this entry (status 0 →
        // null). Null-row owners keep their ledger copy as the enrichment
        // source until the completion merge (Fix A) lands the real status.
        const freshRow = net[net.length - 1];
        if (freshRow && freshRow.status == null) {
          this.nullOwnedRequestIds.add(entry.requestId);
        }
        // pendingComplete (completion re-insert) entries are held for the
        // Stop-time enrichment snapshot only — never re-attached, never
        // acked away (their consumer is enrichNetworkRowStatuses).
        if ((entry as StampedRequest & { pendingComplete?: boolean }).pendingComplete) {
          continue;
        }
        attachedNow.push(entry);
        // INV-5 causal ownership: a recovered main-frame document request
        // stamps the causal link onto the synthetic navigation it produced.
        if (entry.mainFrame || entry.documentRequest) {
          this.stampCausalLink(interactions, target.interactionId);
        }
        attached++;
      }
      // Remove entries that were attached or filtered out (memory-side only;
      // the durable copy stays until the caller acknowledges).
      this.pruneKey(sourceEventId);
    }
    if (attachedNow.length > 0) this.pendingAck.push(...attachedNow);
    return attached;
  }

  /**
   * FIX B (pendingAck admission): a freshly attached entry whose new row is
   * still null-status must NOT be admitted to pendingAck — the ack that
   * follows LIVE_INTERACTIONS persistence would delete the only durable
   * completion record before onCompleted can merge the real status (the
   * ack window fires mid-request on a main-frame POST). Its enrichment
   * source must survive until Stop.
   */
  private isEnrichmentHeld(entry: StampedRequest): boolean {
    return this.nullOwnedRequestIds.has(entry.requestId);
  }

  /**
   * Acknowledge that the caller's LIVE_INTERACTIONS persistence LANDED —
   * now the attached entries may leave the durable store. Call this ONLY
   * after the persist resolved (directly awaited, or via
   * `acknowledgeAfterPersist` which gates on `landed === true`).
   */
  acknowledgePersisted(): void {
    if (this.pendingAck.length === 0) return;
    const ids = new Set(
      this.pendingAck
        // FIX B: never ack away a held completion source (null-owned row).
        .filter((e) => !this.isEnrichmentHeld(e))
        .map((e) => e.requestId),
    );
    this.pendingAck = this.pendingAck.filter((e) => this.isEnrichmentHeld(e));
    this.acknowledge([...ids]);
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
    this.lastSeenInteractions = interactions;

    const raw = await chrome.storage.local.get(UNATTACHED_REQUESTS_KEY);
    const stored = (raw?.[UNATTACHED_REQUESTS_KEY] ?? {}) as Record<
      string,
      StampedRequest[]
    >;
    for (const [k, list] of Object.entries(stored)) {
      if (Array.isArray(list) && list.length > 0) this.entries.set(k, [...list]);
    }

    // Drop crash-point-A leftovers (attached but not acked) before joining.
    // FIX B invariant: an entry leaves ONLY when its owning interaction's
    // row for that requestId already has a REAL status — a null-status row
    // still needs this entry as its completion source.
    this.nullOwnedRequestIds.clear();
    let changed = false;
    for (const [k, list] of this.entries) {
      const surviving = list.filter((e) => {
        if (!this.ownership.isAttached(e.requestId)) return true; // not attached
        // Attached → keep only while the owning row is still null-status.
        const owner = this.ownership.getInteractionId(e.requestId);
        const row = owner ? this.findNetworkRow(owner, e.requestId) : undefined;
        if (row && row.status == null) {
          this.nullOwnedRequestIds.add(e.requestId);
          return true;
        }
        return false;
      });
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

    if (changed) {
      // Crash-point-A leftovers were dropped — persist the shrunk set. The
      // attached entries are NOT yet removed: they sit in pendingAck until
      // the caller persists LIVE_INTERACTIONS and calls
      // acknowledgePersisted() (delete-after-persist contract).
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
      // FIX B: a held completion source (owning row still null-status) is
      // never acked away — its only consumer is Stop-time enrichment.
      if (this.nullOwnedRequestIds.has(rid)) continue;
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
    this.nullOwnedRequestIds.clear();
    this.lastSeenInteractions = [];
    this.ownership.rebuildFromInteractions([]);
    await chrome.storage.local.remove(UNATTACHED_REQUESTS_KEY).catch(() => {});
    this.durable = true;
  }

  /** Whether the last durable write succeeded (diagnostics). */
  isDurable(): boolean {
    return this.durable;
  }

  // ── Ack ordering (LANDED-INV Delete-after-persist) ─────────────────

  /**
   * Chain the durable delete to a persist that LANDED.
   *
   * `persist` resolves `true` when the caller's LIVE_INTERACTIONS write
   * landed, `false` on failure (and is rejected-safe). Only a landed persist
   * acknowledges: a failed persist keeps the durable entry so boot
   * reconciliation can recover it — never ack-after-failed-persist.
   *
   * All fire-and-forget ack call sites MUST go through this helper instead
   * of calling acknowledgePersisted() on the line after a persist — an
   * unguarded ack deletes the durable entry before/without its interaction
   * landing in storage, losing the request irrecoverably.
   */
  acknowledgeAfterPersist(persist: Promise<boolean>): void {
    void persist.then(
      (landed) => {
        if (landed) this.acknowledgePersisted();
      },
      () => {
        // Persist rejected (should not happen — persistLiveInteractions never
        // rejects) — entry stays durable for boot reconciliation.
      },
    );
  }

  // ── Internal ───────────────────────────────────────────────────────

  /** The owning interaction's current row for a requestId (null when absent). */
  private findNetworkRow(
    interactionId: string,
    requestId: string,
  ): NetworkActivity | undefined {
    for (const i of this.lastSeenInteractions) {
      if (i.interactionId !== interactionId) continue;
      const net = i.behavioralEvidence?.applicationEvidence?.networkActivity ?? [];
      return net.find(
        (e) => (e as NetworkActivity & { requestId?: string }).requestId === requestId,
      );
    }
    return undefined;
  }

  /** Drop entries already attached/filtered under a key; delete key if empty. */
  private pruneKey(sourceEventId: string): void {
    const list = this.entries.get(sourceEventId);
    if (!list) return;
    // FIX B: attached entries whose owning row is STILL null-status keep
    // their ledger copy — it is the Stop-time status-enrichment source
    // (snapshotStamped). Entries owned with a REAL status drop as before.
    const surviving = list.filter(
      (e) => !this.ownership.isAttached(e.requestId) || this.nullOwnedRequestIds.has(e.requestId),
    );
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
