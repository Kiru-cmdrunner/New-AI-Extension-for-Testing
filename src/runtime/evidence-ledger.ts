/**
 * Evidence Ledger — Append-Only Store with Dispositions
 *
 * Milestone 2 of the End-to-End Capture Guarantee.
 *
 * INV-LE-1: Every discrete event appended to the ledger receives a 'pending'
 *           disposition. No discrete event is silently rejected.
 * INV-LE-2: Dispositions follow a strict lifecycle:
 *           pending → absorbed → (claimed | unclaimed).
 *           'claimed' is terminal. 'unclaimed' is terminal.
 * INV-LE-3: restore() always resets 'absorbed' → 'unclaimed' (SW restart rule).
 *
 * Architecture: Evidence Ledger → ComponentRuntime (dispositions) →
 *               Projection Engine → Observed Workflow / Capability Analysis / IR
 */

import type { ObservedEvent, InteractionType, ElementIdentity, ClickQualification, ClickInvalidityCause, ComponentInteraction } from '../shared/component-types';
import { isInteractiveElement } from '../definitions/patterns';
import { deriveConsequenceClasses } from '../presentation/output-adapter';

/**
 * Browser event types that represent deliberate user actions.
 * Each of these MUST produce exactly one ComponentInteraction — either from
 * a specialized definition, or from the Unclassified fallback.
 *
 * Accumulating events (scroll, input, change, mousemove) do NOT get the
 * guarantee — they are part of lifecycles, not standalone actions.
 */
export const DISCRETE_ACTION_TYPES = new Set<string>([
  'click', 'contextmenu', 'mousedown', 'keydown',
  'dragstart', 'drop', // M9.10 — drag & drop are discrete user actions
]);

/**
 * B7-P2 §5.2.4 (A-3): DISCRETE_ACTION_TYPES is decomposed into explicit
 * per-consumer predicates. The monolithic export stays for compat and gains
 * NO members — mouseenter never joins it. Each consumer switches to its
 * named predicate below.
 *
 * LEDGER_APPENDABLE — what append() stores. Base = the monolithic set plus
 * gated discovery mouseenters. The gate is a PREDICATE, not a membership:
 * bare pointer crossings on non-interactive elements never touch the ledger
 * (no Unclassified flood — B-1). Computed from the event's own target
 * fields via the shared structural affordance predicate (no vocabulary).
 */
export const LEDGER_APPENDABLE = new Set<string>([...DISCRETE_ACTION_TYPES]);

/**
 * ANCHOR_ELIGIBLE — episode-builder anchor gate (§5.2.4, W-3 pin:
 * Dropdown's mousedown-completing lifecycles mean anchors CAN be
 * mousedown today — verified against the definitions; the amendment's
 * "exclude mousedown" branch is NOT taken, the "keep mousedown" branch
 * IS). Base = the monolithic set minus NOTHING; admitted hovers join
 * anchoring in P3 via admission, not raw enter membership.
 */
export const ANCHOR_ELIGIBLE = new Set<string>([...DISCRETE_ACTION_TYPES]);

/**
 * B7-P3 §5.3.1: the ANCHOR GATE PREDICATE over interactions (not raw
 * events). Every interaction whose trigger event type ∈ ANCHOR_ELIGIBLE
 * anchors exactly as before (byte-identical non-hover behavior); an
 * admitted Hover — endState 'completed' with ≥1 recorded consequence
 * class (the P2 §5.2.7 admission outcome, surfaced via the compat
 * bridge as metadata.consequenceClasses) — additionally anchors.
 * Gesture-only and abandoned/interrupted hovers never anchor (V4: no
 * negative knowledge in the model).
 *
 * Keyed on the ADMISSION OUTCOME, never on the enter event's membership:
 * admission is derived from recorded evidence; ANCHOR_ELIGIBLE remains
 * the raw-event view for non-hover types. No timing, no vocabulary —
 * consequenceClasses is a P2-recorded fact list.
 */
export function isAnchorEligibleInteraction(interaction: {
  type: InteractionType | string;
  endState?: string;
  triggerEvent?: { eventType?: string } | null;
  metadata?: Record<string, unknown> | null;
  behavioralEvidence?: unknown;
}): boolean {
  const triggerType = interaction.triggerEvent?.eventType ?? null;
  if (triggerType !== null && ANCHOR_ELIGIBLE.has(triggerType)) return true;
  if (interaction.type === 'Hover') {
    if (interaction.endState !== 'completed') return false;
    // B7-P4 (bridge deletion): admission derives from the recorded
    // evidence at read time — deriveConsequenceClasses is the primary
    // authority (same function the production filter uses). The stored
    // metadata.consequenceClasses array remains a LEGITIMATE fallback:
    // it is the P2-recorded fact list (written by the bridge era), and
    // legacy rows recorded before this commit still anchor on it. The
    // bridge's WRITE is deleted; the READ of already-recorded facts
    // survives. metadata.meaningful (the stored judgment) is never
    // consulted — it was already dead as a gate in P2.
    if (deriveConsequenceClasses(interaction as unknown as ComponentInteraction).length > 0) return true;
    const classes = interaction.metadata?.consequenceClasses;
    return Array.isArray(classes) && classes.length > 0;
  }
  return false;
}

/**
 * STAMP_ELIGIBLE types (primary/secondary classification stays in
 * network-observation.ts stampClass — the R-4 dispatcher-site gate computes
 * isGatedEnter there). Listed here for the single-source-of-truth doc point.
 */

/**
 * GESTURE_SUPERSESSION_ELIGIBLE — today's supersession set minus pointer
 * events (§5.2.4): mouseenter/mousemove/mouseleave are gesture-family
 * events, not adjacency breakers. Base = the monolithic set minus click
 * (step 3b owns click) — unchanged from today.
 */

/**
 * Is this event a gated hover discovery enter?
 * The SHARED structural predicate — same gate as the definition's
 * detectTrigger and the SW stamp site (one predicate, three call sites,
 * no vocabulary). patterns.ts is dependency-free (shared types only), so
 * this import introduces no cycle.
 */
export function isGatedDiscoveryEnter(event: ObservedEvent): boolean {
  if (event.eventType !== 'mouseenter') return false;
  if (event.isTrusted !== true) return false;
  return isInteractiveElement(
    event.target.tag,
    event.target.ariaRole,
    event.target.className,
    event.domContext?.tabIndex ?? null,
  );
}

/**
 * Disposition lifecycle:
 *   pending   — event appended, not yet processed by runtime
 *   absorbed  — runtime's lifecycle has consumed this event
 *   claimed   — a completed interaction backs this event (terminal)
 *   unclaimed — no completed interaction backs this event (terminal)
 */
export type DispositionStatus = 'pending' | 'absorbed' | 'claimed' | 'unclaimed';

/**
 * A single entry in the Evidence Ledger.
 */
export interface LedgerEntry {
  /** Page-unique event ID: `evt-{pageId}-{counter}`. */
  eventId: string;
  /** Browser-assigned monotonic sequence (rawEvent.timeStamp). */
  captureSeq: number;
  /** Page ID extracted from eventId (`evt-pABC-3` → `pABC`). */
  pageId: string;
  /** Browser event type (click, mousedown, contextmenu, keydown). */
  eventType: string;
  /** Date.now() timestamp from the ObservedEvent. */
  timestamp: number;
  /** Current disposition. */
  disposition: DispositionStatus;
  /** Interaction or lifecycle ID that claimed/absorbed this event. */
  claimedBy?: string;
  /** InteractionType of the claiming interaction. */
  claimType?: InteractionType;

  // ── Diagnostic Identity (Phase 1.2) ────────────────────────────────
  //
  // These fields are populated at append() time from ObservedEvent.target.
  // They enable post-mortem debugging ("which element did this event
  // target?") without requiring the full ElementIdentity. They are NOT
  // used for classification or disposition decisions — only for
  // diagnostics and Unclassified interaction enrichment by the
  // Projection Engine.
  //
  // Cost: ~100 bytes per entry. At 100 entries this is ~10KB.

  /** HTML tag name of the target element (e.g. 'BUTTON', 'A', 'INPUT'). */
  targetTag: string;
  /** Accessible name of the target element (best-effort, may be ''). */
  targetName: string;
  /** ARIA role of the target element, or null if none. */
  targetRole: string | null;

  // ── D1: Full identity + capture origin for unclaimed-event projection ──
  //
  // The diagnostic fields above are too impoverished for workflow
  // subsumption: a projected Unclassified twin built from tag/name alone
  // gets an elementKey like 'tag:INPUT' that never matches the recognized
  // interaction's rich key ('name:X|sel:Y'), so normalizeWorkflow's
  // same-element affinity silently failed and one physical click produced
  // two logical actions (Click + Unclassified twin).
  //
  // These two optional fields (null on legacy snapshots) carry the full
  // element identity and the capturing tab/frame so the Projection Engine
  // can build a twin with equivalent affinity. Shallow copies only — the
  // ledger never mutates the event's identity objects.

  /** Full element identity snapshot at append() time; null on legacy rows. */
  targetIdentity: ElementIdentity | null;
  /** Capture origin (tab/frame) of the event; null on legacy rows. */
  captureOrigin: { tabId: number; frameId: number } | null;

  // ── LP3 (S6): minimal ancestor context for post-hoc enrichment ──────
  //
  // LP2 enriches projected Unclassified cards via the same
  // detectComponent() path used at runtime. detectComponent() reads
  // triggerEvent.domContext.ancestorRoles / .ancestorClasses to detect
  // Dialog / open-selection-surface ancestry. The projection's synthetic
  // triggerEvent used to hard-code both to [], so enrichment could never
  // fire on a projected card even if it were called (LP3's data-loss half
  // of that defect). We persist ONLY the two arrays detectComponent
  // consumes — not the full DomContext (~90 bytes/entry vs ~400) — to
  // keep ledger storage bounded. Null on legacy snapshots (restored to
  // null explicitly, like the D1 optional fields).

  /** Ancestor roles (up to 10 levels, index 0 = parent); null on legacy rows. */
  ancestorRoles: string[] | null;
  /** Ancestor classes (up to 10 levels, index 0 = parent); null on legacy rows. */
  ancestorClasses: string[] | null;

  // ── 7.4-B3 S3: synthetic-entry marker ─────────────────────────────
  /** True when this entry was minted from an accumulating-event episode (typed-text terminal sample), not raw capture. */
  synthetic?: boolean;
  /** S3: terminal value of the sampled typing episode (synthetic entries only). */
  sampledValueAfter?: string;

  // ── Capture-time click qualification (v1.2 Step 1, 2026-08-29) ────
  // Spec: .drytis/specs/click-capture-qualification-v1.md §7. The frozen
  // verdict record from DomContext.clickQualification, persisted on the
  // durable row so qualification is auditable from the record alone
  // (ends ledger starvation for qualification facts). Null on legacy
  // rows and on non-click-family events (null = legacy = qualified,
  // never pre-gated). Restore-stable. Step 1 is INERT: no consumer may
  // read this for a typing decision until Step 2 wires the pre-gate.
  /** Click provable-invalidity verdict + fact vector; null on legacy/non-click rows. */
  clickQualification?: ClickQualification | null;
}

/** Chrome storage key for the evidence ledger. */
export const EVIDENCE_LEDGER_KEY = 'cmdrunner_evidence_ledger';

/**
 * Structural copy of a ClickQualification record for ledger persistence
 * (v1.2 Step 1). The original is frozen at capture; the copy keeps the
 * ledger's ownership of its own row data explicit. Causes/hitTest/hitTarget
 * are re-frozen to preserve immutability guarantees through restore().
 */
function copyClickQualification(q: ClickQualification): ClickQualification {
  const copy: ClickQualification = {
    verdict: q.verdict,
    causes: [...q.causes] as ClickInvalidityCause[],
    insufficient: q.insufficient,
    facts: {
      ...q.facts,
      hitTest: { ...q.facts.hitTest },
      hitTarget: { ...q.facts.hitTarget },
    },
  };
  Object.freeze(copy.causes);
  Object.freeze(copy.facts.hitTest);
  Object.freeze(copy.facts.hitTarget);
  Object.freeze(copy.facts);
  return Object.freeze(copy);
}

/**
 * Extract pageId from an eventId of the form `evt-{pageId}-{counter}`.
 * Returns 'unknown' if the format doesn't match (defensive).
 */
function extractPageId(eventId: string): string {
  const match = eventId.match(/^evt-(.+)-\d+$/);
  return match ? match[1] : 'unknown';
}

/**
 * Append-only evidence store with mutable dispositions.
 *
 * The ledger filters to DISCRETE_ACTION_TYPES only — accumulating events
 * (scroll, input, mousemove) are never stored because they are part of
 * lifecycles, not standalone actions.
 */
export class EvidenceLedger {
  private readonly entries = new Map<string, LedgerEntry>();

  /**
   * Append an ObservedEvent to the ledger.
   * B7-P2 §5.2.4: LEDGER_APPENDABLE filter — discrete action types plus
   * gated discovery mouseenters only. Deduplicates by eventId.
   * New entries start with disposition='pending'.
   */
  append(event: ObservedEvent): void {
    const appendable =
      LEDGER_APPENDABLE.has(event.eventType) ||
      isGatedDiscoveryEnter(event);
    if (!appendable) return;
    if (this.entries.has(event.eventId)) return;

    this.entries.set(event.eventId, {
      eventId: event.eventId,
      captureSeq: event.captureSeq,
      pageId: extractPageId(event.eventId),
      eventType: event.eventType,
      timestamp: event.timestamp,
      disposition: 'pending',
      targetTag: event.target.tag,
      targetName: event.target.accessibleName,
      targetRole: event.target.ariaRole,
      // D1: full identity + origin for twin affinity.
      targetIdentity: event.target ? { ...event.target } : null,
      captureOrigin: event.captureOrigin
        ? {
            tabId: event.captureOrigin.tabId,
            frameId: event.captureOrigin.frameId,
          }
        : null,
      // LP3: shallow-copy the ancestor arrays out of domContext. Defensively
      // handle events whose domContext is undefined (older senders / tests)
      // by persisting null — the projection falls back to [] for those.
      ancestorRoles: event.domContext
        ? [...(event.domContext.ancestorRoles ?? [])]
        : null,
      ancestorClasses: event.domContext
        ? [...(event.domContext.ancestorClasses ?? [])]
        : null,
      // v1.2 Step 1: persist the frozen qualification record (shallow
      // structural copy — the record's own fields are frozen at capture;
      // copy so a later event mutation can never alias into the ledger).
      clickQualification: event.domContext?.clickQualification
        ? copyClickQualification(event.domContext.clickQualification)
        : null,
    });
  }

  /**
   * 7.4-B3 S3: append a SYNTHETIC entry minted from an accumulating event
   * episode (typed text that no lifecycle ever claimed).
   *
   * Bypasses the DISCRETE_ACTION_TYPES filter (that filter is the R1 raw
   * contract — raw input/change events stay un-stored; only this curated,
   * terminal-value sample crosses the boundary as a synthesized 'change').
   * Same eventId dedup + disposition lifecycle as append(). The entry is
   * marked synthetic=true so M5 self-consistency and downstream consumers
   * can distinguish it from raw capture.
   */
  appendSynthetic(event: ObservedEvent): void {
    if (this.entries.has(event.eventId)) return;

    const entry: LedgerEntry = {
      eventId: event.eventId,
      captureSeq: event.captureSeq,
      pageId: extractPageId(event.eventId),
      eventType: event.eventType,
      timestamp: event.timestamp,
      disposition: 'pending',
      targetTag: event.target.tag,
      targetName: event.target.accessibleName,
      targetRole: event.target.ariaRole,
      targetIdentity: event.target ? { ...event.target } : null,
      captureOrigin: event.captureOrigin
        ? { tabId: event.captureOrigin.tabId, frameId: event.captureOrigin.frameId }
        : null,
      ancestorRoles: event.domContext
        ? [...(event.domContext.ancestorRoles ?? [])]
        : null,
      ancestorClasses: event.domContext
        ? [...(event.domContext.ancestorClasses ?? [])]
        : null,
      // S3 marker
      synthetic: true,
      sampledValueAfter:
        event.valueAfter != null ? String(event.valueAfter) : undefined,
    };
    this.entries.set(event.eventId, entry);
  }

  /**
   * Update the disposition of a single entry.
   * No-op if the eventId is not in the ledger.
   * 'claimed' and 'unclaimed' are terminal — cannot be overwritten.
   */
  setDisposition(
    eventId: string,
    status: DispositionStatus,
    claimedBy?: string,
    claimType?: InteractionType,
  ): void {
    const entry = this.entries.get(eventId);
    if (!entry) return;

    // Terminal states cannot be overwritten
    if (entry.disposition === 'claimed' || entry.disposition === 'unclaimed') return;

    entry.disposition = status;
    if (claimedBy !== undefined) entry.claimedBy = claimedBy;
    if (claimType !== undefined) entry.claimType = claimType;
  }

  /**
   * Bulk-release all entries claimed by a specific lifecycle/interaction.
   * Sets their disposition to 'unclaimed'.
   * Used when a lifecycle is abandoned or interrupted.
   */
  releaseClaims(lifecycleId: string): void {
    for (const entry of this.entries.values()) {
      if (entry.claimedBy === lifecycleId) {
        // Can only release from 'absorbed' — terminal states are immutable
        if (entry.disposition === 'absorbed') {
          entry.disposition = 'unclaimed';
        }
      }
    }
  }

  /**
   * Get all entries sorted by (pageId, captureSeq).
   * Within the same page/document, entries are in browser-observed order.
   * Across documents, page boundaries are preserved (no global ordering).
   */
  getEntries(): readonly LedgerEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => {
      if (a.pageId !== b.pageId) return a.pageId.localeCompare(b.pageId);
      return a.captureSeq - b.captureSeq;
    });
  }

  /**
   * Get entries filtered by disposition status.
   */
  getByDisposition(status: DispositionStatus): readonly LedgerEntry[] {
    return this.getEntries().filter((e) => e.disposition === status);
  }

  /**
   * Serialize the ledger for persistence (chrome.storage.local).
   */
  snapshot(): LedgerEntry[] {
    return this.getEntries().map((e) => ({ ...e }));
  }

  /**
   * Restore from a snapshot.
   * Always calls resetAbsorbedToUnclaimed() after restoring —
   * 'absorbed' entries from a previous SW lifecycle have lost their
   * claimant (the ComponentRuntime that absorbed them is gone).
   */
  restore(entries: LedgerEntry[]): void {
    this.entries.clear();
    for (const entry of entries) {
      // D1: normalize legacy snapshots (pre-D1 rows have neither optional
      // field) to explicit nulls so downstream consumers never see
      // 'undefined' vs 'null' divergence in affinity comparisons.
      // LP3: same normalization for the ancestor-context fields.
      this.entries.set(entry.eventId, {
        ...entry,
        targetIdentity: entry.targetIdentity ?? null,
        captureOrigin: entry.captureOrigin ?? null,
        ancestorRoles: entry.ancestorRoles ?? null,
        ancestorClasses: entry.ancestorClasses ?? null,
        // v1.2 Step 1: normalize legacy snapshots (pre-qualification rows)
        // to explicit null — same D1/LP3 convention.
        clickQualification: entry.clickQualification ?? null,
      });
    }
    this.resetAbsorbedToUnclaimed();
  }

  /**
   * SW restart rule: set all 'absorbed' entries to 'unclaimed'.
   * After a service-worker restart, the ComponentRuntime's in-memory
   * active stack is empty — any 'absorbed' entries have lost their
   * claimant and must be treated as unclaimed evidence.
   * 'claimed' entries are preserved (backed by persisted liveInteractions).
   * 'unclaimed' entries are preserved (already terminal).
   * 'pending' entries are preserved (not yet processed).
   */
  resetAbsorbedToUnclaimed(): void {
    for (const entry of this.entries.values()) {
      if (entry.disposition === 'absorbed') {
        entry.disposition = 'unclaimed';
      }
    }
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
  }

  /** Number of entries in the ledger. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Get a single entry by eventId (for testing/debugging).
   */
  get(eventId: string): LedgerEntry | undefined {
    return this.entries.get(eventId);
  }
}
