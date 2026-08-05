/**
 * Document Observer — Document-Wide Mutation Capture (M1 Phase B)
 *
 * Singleton MutationObserver on document.body that captures ALL DOM
 * mutations during observation windows. Refcounted — one observer
 * shared across all active windows.
 *
 * COMPLEMENTARY ROLE:
 * Phase A (Element State Cache) captures DOM PROPERTIES (.value, .checked)
 * at the earliest possible moment. Phase B (DocumentObserver) captures DOM
 * ATTRIBUTES, TEXT, and STRUCTURAL changes with old→new transitions.
 * Neither alone covers every component type.
 *
 * CAPTURE BROADLY, ANALYZE LATER:
 * No noise filtering during capture. ALL attribute changes (including
 * style), ALL text changes, ALL structural changes are recorded. The
 * distinction between meaningful evidence and framework noise is a
 * deferred analysis concern.
 *
 * NO BUFFER CAP:
 * The 3-second observation window + pruning on window close provides
 * the natural bound. Every record in every batch is processed
 * unconditionally.
 *
 * Architecture: .drytis/specs/m1-phase-b-detailed-design.md
 */

import type { MutationRecord2 } from '../shared/observation-types';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Diagnostic/measurement evidence recorded when a MutationObserver callback
 * batch exceeds a CPU threshold.
 *
 * This is PURELY diagnostic. It records what happened without drawing
 * conclusions about reliability or triggering any change in capture behavior.
 * Capture continues unchanged regardless. Every record in the batch is
 * always processed — unconditionally.
 *
 * The value is tunable (CPU_THRESHOLD_MS) and not an architectural assumption.
 */
export interface PerformanceCondition {
  /** Number of records in the high-volume batch. */
  batchRecordCount: number;
  /** Estimated wall-clock time for the callback (performance.now delta). */
  batchDurationMs: number;
  /** When the high-volume batch occurred (performance.now()). */
  timestamp: number;
}

// ── Constants ───────────────────────────────────────────────────────────

/**
 * CPU threshold for performance condition recording (approx one animation frame).
 *
 * TUNABLE CONSTANT — not an architectural assumption. Adjust based on
 * real-browser measurements. Changing this value does not affect any code
 * structure; it only changes when PerformanceCondition diagnostics are emitted.
 *
 * The threshold has NO effect on capture behavior — all records are always
 * processed regardless of whether this threshold is crossed.
 */
const CPU_THRESHOLD_MS = 15;

// ── DocumentObserver ────────────────────────────────────────────────────

/**
 * Document-wide mutation observer. Singleton MutationObserver on document.body
 * with refcounted lifecycle. One observer shared across all active windows.
 *
 * Usage (by the ObservationCoordinator in Phase C):
 *   const observer = new DocumentObserver();
 *   observer.start('window-A');  // connects MutationObserver
 *   observer.start('window-B');  // shares the same observer
 *   // ... mutations captured with both windowIds ...
 *   observer.stop('window-A');   // refCount decremented, observer still running
 *   observer.stop('window-B');   // refCount = 0, observer disconnected
 */
export class DocumentObserver {
  /** Singleton MutationObserver — created on first start(), destroyed on last stop(). */
  private observer: MutationObserver | null = null;

  /** Refcount: number of active windows. Observer runs while > 0. */
  private refCount: number = 0;

  /** Set of currently active window IDs. Snapshotted into each record's windowIds[]. */
  private activeWindowIds: Set<string> = new Set();

  /** Shared record buffer. One entry per MutationObserver record. */
  private records: MutationRecord2[] = [];

  /** Sequential record counter (for record IDs). */
  private recordCounter: number = 0;

  /** CSS path cache. Element → path string. WeakMap for auto-GC. */
  private pathCache: WeakMap<Element, string> = new WeakMap();

  /**
   * Diagnostic performance condition from the most recent high-volume batch.
   * Null if no high-volume batch has occurred. Reset on reset().
   *
   * PURELY DIAGNOSTIC — does not affect capture behavior.
   */
  private performanceCondition: PerformanceCondition | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Start observing for a window. Refcounted — the MutationObserver
   * connects on the first start() and stays connected until the last
   * stop(). Multiple start() calls with different windowIds add to
   * the active set but do NOT create additional MutationObservers.
   */
  start(windowId: string): void {
    this.activeWindowIds.add(windowId);
    this.refCount++;

    if (this.observer) return; // already running

    this.observer = new MutationObserver(this.handleMutations);
    this.observer.observe(document.body, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    });
  }

  /**
   * Stop observing for a window. Decrements refCount. When refCount
   * reaches 0, disconnects the MutationObserver.
   * Safe to call with an unknown windowId (no-op).
   */
  stop(windowId: string): void {
    if (!this.activeWindowIds.has(windowId)) return; // unknown window — no-op
    this.activeWindowIds.delete(windowId);
    this.refCount--;

    if (this.refCount <= 0 && this.observer) {
      this.observer.disconnect();
      this.observer = null;
      this.refCount = 0;
    }
  }

  /**
   * Full reset — disconnect observer, clear all state.
   * Called on stopRecording (via coordinator in Phase C).
   */
  reset(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.refCount = 0;
    this.activeWindowIds.clear();
    this.records = [];
    this.recordCounter = 0;
    this.performanceCondition = null;
    // WeakMap — create fresh instance for GC of stale entries.
    this.pathCache = new WeakMap();
  }

  // ── Record Access ─────────────────────────────────────────────────────

  /**
   * Get all records attributed to this window.
   * Returns copies — caller can mutate without affecting the buffer.
   * Called by coordinator on window close.
   */
  getRecordsForWindow(windowId: string): MutationRecord2[] {
    return this.records
      .filter((r) => r.windowIds.includes(windowId))
      .map((r) => ({ ...r, windowIds: [...r.windowIds] }));
  }

  /**
   * Total number of records attributed to this window.
   */
  getTotalRecordsDuringWindow(windowId: string): number {
    return this.records.filter((r) => r.windowIds.includes(windowId)).length;
  }

  /**
   * Remove records that ONLY belong to this window from the buffer.
   * Records also attributed to other active windows survive with
   * this windowId removed from their attribution list.
   * Called by coordinator after collecting records for window close.
   */
  pruneWindowRecords(windowId: string): void {
    this.records = this.records.filter((r) => {
      const hasOtherWindows = r.windowIds.some((id) => id !== windowId);
      if (hasOtherWindows) {
        // Remove this windowId from the record's attribution list
        r.windowIds = r.windowIds.filter((id) => id !== windowId);
        return true;
      }
      // This record ONLY belonged to the closing window — remove it
      return false;
    });
  }

  // ── Introspection (testing/debugging) ─────────────────────────────────

  /** Currently active window IDs. */
  getActiveWindowIds(): string[] {
    return [...this.activeWindowIds];
  }

  /** Current buffer length. */
  getBufferLength(): number {
    return this.records.length;
  }

  /**
   * Diagnostic performance condition from the most recent high-volume batch.
   * Null if no high-volume batch has occurred.
   *
   * PURELY DIAGNOSTIC — does not indicate evidence loss or unreliability.
   */
  getPerformanceCondition(): PerformanceCondition | null {
    return this.performanceCondition;
  }

  // ── Mutation Callback ─────────────────────────────────────────────────

  /**
   * Arrow function to preserve `this` binding when passed to MutationObserver.
   *
   * Processes EVERY record in the batch — no cap, no break, no drop.
   * Records a PerformanceCondition if the batch exceeds the CPU threshold,
   * but capture continues unchanged regardless.
   */
  private handleMutations = (mutationList: MutationRecord[]): void => {
    const now = performance.now();

    // Snapshot active window IDs (Set → Array). If no windows are active,
    // mutations shouldn't be reaching us (observer should be disconnected),
    // but guard defensively.
    const ids = [...this.activeWindowIds];
    if (ids.length === 0) return;

    // Process every record in the batch — no cap, no break.
    // The 3-second window + pruning provides the natural bound.
    const batchStart = performance.now();

    for (const m of mutationList) {
      this.records.push(this.compact(m, now, ids));
    }

    const batchDuration = performance.now() - batchStart;

    // Diagnostic: record if this batch exceeded the CPU threshold.
    // This is a MEASUREMENT, not evidence loss. Every record was processed.
    // Capture continues unchanged regardless of whether this is set.
    if (batchDuration > CPU_THRESHOLD_MS) {
      this.performanceCondition = {
        batchRecordCount: mutationList.length,
        batchDurationMs: Math.round(batchDuration * 100) / 100,
        timestamp: now,
      };
    }
  };

  /**
   * Compact one browser MutationRecord into one MutationRecord2.
   *
   * O(1) work per record (amortized — CSS path uses WeakMap cache).
   */
  private compact(
    m: MutationRecord,
    ts: number,
    windowIds: string[],
  ): MutationRecord2 {
    // characterData mutations target Text nodes, not Elements.
    // Resolve to the parent Element for CSS path computation.
    const targetEl = m.target instanceof Element
      ? m.target
      : (m.target.parentElement ?? document.body);

    const id = ++this.recordCounter;

    // Read newValue IMMEDIATELY — the DOM will mutate again before deferred analysis.
    // For childList, there's no "value" — we record counts.
    let newValue: string | null = null;
    if (m.type === 'attributes' && m.attributeName) {
      newValue = targetEl.getAttribute(m.attributeName);
    } else if (m.type === 'characterData') {
      newValue = m.target.textContent;
    }

    return {
      id,
      type: m.type as 'attributes' | 'childList' | 'characterData',
      targetPath: this.getPath(targetEl),
      targetTag: targetEl.tagName,
      attributeName: m.attributeName ?? null,
      oldValue: m.oldValue ?? null,
      newValue,
      addedNodesCount: m.addedNodes.length,
      removedNodesCount: m.removedNodes.length,
      timestamp: ts,
      windowIds: [...windowIds], // copy, not reference — critical for pruning
    };
  }

  // ── CSS Path Computation ──────────────────────────────────────────────

  /**
   * Get CSS path for an element. Uses WeakMap cache for O(1) on repeat access.
   *
   * Computed at mutation time for temporal fidelity: the path reflects the
   * element's actual position when the mutation occurred, not its position
   * 3 seconds later (which may have changed due to DOM restructuring).
   */
  private getPath(el: Element): string {
    let path = this.pathCache.get(el);
    if (path) return path;
    path = this.computePath(el);
    this.pathCache.set(el, path);
    return path;
  }

  /**
   * Compute a human-readable CSS path from document.body to the element.
   * Walks up parentElement chain, building nth-of-type selectors.
   *
   * Path purpose: display and deferred filtering only. NOT used for element
   * resolution at window close (Phase C handles that via direct reference).
   */
  private computePath(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;
    let depth = 0;

    while (
      current &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;

      const sameTagSiblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName,
      );

      if (sameTagSiblings.length === 1) {
        parts.unshift(tag);
      } else {
        parts.unshift(`${tag}:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`);
      }

      current = parent;
      depth++;
    }

    return parts.length > 0 ? `body > ${parts.join(' > ')}` : 'body';
  }
}
