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

import type { ObservedEvent, InteractionType } from '../shared/component-types';

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
]);

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
}

/** Chrome storage key for the evidence ledger. */
export const EVIDENCE_LEDGER_KEY = 'cmdrunner_evidence_ledger';

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
   * Filters to discrete action types only. Deduplicates by eventId.
   * New entries start with disposition='pending'.
   */
  append(event: ObservedEvent): void {
    if (!DISCRETE_ACTION_TYPES.has(event.eventType)) return;
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
    });
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
      this.entries.set(entry.eventId, { ...entry });
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
