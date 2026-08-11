/**
 * DOM Observer — Refcounted MutationObserver with Summarization (M3)
 *
 * A refcounted singleton MutationObserver on document.body that captures
 * DOM mutations, summarizes them into DomChangeSummary entries, and
 * distributes them to all active observation windows via a shared
 * globalBatchCounter.
 *
 * Pipeline (spec §5.2):
 *   Stage 1: Filter — exclude noise (CSS animations, virtual scroll, scripts)
 *   Stage 2: Summarize — group mutations by targetPath, merge attribute deltas
 *   Stage 3: Cap — at window-close time, keep first 200 entries (NOT M3 concern;
 *           the EvidenceCollector (M4) applies the cap when building the final
 *           ApplicationEvidence. DOMObserver itself just summarizes and stores.)
 *
 * Refcounting: start() increments refcount and begins observing; stop()
 * decrements and disconnects when refcount hits zero.
 *
 * Global batch counter: increments once per MutationObserver callback.
 * All active windows receive the same batchIndex for the same callback.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §4.5, §5.1-5.3
 */

import type {
  DomChangeSummary,
  SurfaceChange,
  VisibilityChange,
} from '../shared/behavioral-evidence-types';

// ── Types ────────────────────────────────────────────────────────────

/**
 * Callback for receiving processed mutation summaries.
 * Called once per MutationObserver callback with the batch index and summaries.
 */
export interface MutationBatchCallback {
  (batchIndex: number, summaries: DomChangeSummary[], now: number): void;
}

/**
 * Internal accumulated mutation data for a single target element.
 * Multiple raw MutationRecords on the same element are collapsed into this.
 */
interface AccumulatedSummary {
  types: Set<'attributes' | 'childList' | 'characterData'>;
  targetPath: string;
  targetTag: string;
  shadowContext: string | null;
  changedAttributes: Set<string>;
  attributeDeltas: Record<string, { old: string | null; new: string | null }>;
  addedNodesCount: number;
  removedNodesCount: number;
  characterDataDelta: { old: string | null; new: string | null } | null;
  firstMutationAt: number;
  lastMutationAt: number;
  rawMutationCount: number;
  firstBatchIndex: number;
  lastBatchIndex: number;
}

// ── Noise Filter ─────────────────────────────────────────────────────

/** Tags whose characterData mutations are noise. */
const NOISE_CHARDATA_TAGS = new Set(['SCRIPT', 'STYLE']);

/** Maximum children before virtual-scroll row mutations are filtered. */
const VIRTUAL_SCROLL_THRESHOLD = 100;

/**
 * Determine if a MutationRecord is noise and should be filtered out.
 * (Spec §5.2 Stage 1)
 */
function isNoise(record: MutationRecord): boolean {
  // characterData on <script> or <style>
  if (record.type === 'characterData') {
    const el = record.target;
    if (el instanceof Element && NOISE_CHARDATA_TAGS.has(el.tagName)) {
      return true;
    }
    // Also check parent (characterData target may be a Text node)
    if (el.parentNode instanceof Element && NOISE_CHARDATA_TAGS.has(el.parentNode.tagName)) {
      return true;
    }
  }

  // childList mutations on virtual scroll containers
  if (record.type === 'childList' && record.target instanceof Element) {
    const parent = record.target;
    const role = parent.getAttribute('role');
    if ((role === 'row' || role === 'gridcell') && parent.parentElement) {
      if (parent.parentElement.childElementCount > VIRTUAL_SCROLL_THRESHOLD) {
        return true;
      }
    }
  }

  return false;
}

// ── Path Utility ─────────────────────────────────────────────────────

/**
 * Generate a CSS-like path for an element. Used as the grouping key
 * for summarization. Not a full unique selector — just enough to
 * group mutations on the same element.
 */
function getElementPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  const maxDepth = 8;

  while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
    }
    parts.unshift(part);
    current = current.parentElement;
    depth++;
  }

  const prefix = current === document.body ? 'body' : current === document.documentElement ? 'html' : '';
  return (prefix ? prefix + ' > ' : '') + parts.join(' > ');
}

/**
 * Get accessible name from an element (simplified).
 */
function getAccessibleName(el: Element): string | null {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const labelEl = document.getElementById(ariaLabelledBy);
    if (labelEl) return (labelEl.textContent || '').trim().slice(0, 200) || null;
  }

  if (el instanceof HTMLElement) {
    const text = (el.innerText || el.textContent || '').trim();
    if (text) return text.slice(0, 200);
  }

  return null;
}

// ── DOMObserver ──────────────────────────────────────────────────────

/**
 * Refcounted singleton MutationObserver on document.body.
 *
 * - start() increments refcount. First start() creates the MutationObserver.
 * - stop() decrements refcount. Last stop() disconnects.
 * - processMutations() callback receives batched summaries.
 * - getAccumulatedSummaries() returns all summaries since start (for M4 EvidenceCollector).
 * - clearAccumulated() resets accumulated summaries (for M4 window reset).
 */
export class DOMObserver {
  private observer: MutationObserver | null = null;
  private refcount = 0;
  private globalBatchCounter = 0;

  /** Accumulated summaries since the last clear. Keyed by targetPath + shadowContext. */
  private accumulated = new Map<string, AccumulatedSummary>();

  /** Surface changes detected from childList mutations. */
  private surfaceChanges: SurfaceChange[] = [];

  /** Visibility changes detected from attribute mutations. */
  private visibilityChanges: VisibilityChange[] = [];

  /** Batch callback — called on each MutationObserver callback. */
  private batchCallback: MutationBatchCallback | null = null;

  /** Reference time for relativeTime calculations. Set when accumulation begins. */
  private referenceTime = 0;

  /** Performance tracking. */
  private longestBatchMs = 0;
  private totalBatches = 0;

  /**
   * Start observing. Increments refcount. Creates the MutationObserver
   * on first call. Returns the reference time (performance.now() at observation start).
   */
  start(callback?: MutationBatchCallback): number {
    this.refcount++;
    if (callback) {
      this.batchCallback = callback;
    }
    if (this.refcount === 1) {
      this.referenceTime = performance.now();
      this.globalBatchCounter = 0;
      this.observer = new MutationObserver((records) => this.onMutations(records));
      this.observer.observe(document.body, {
        childList: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true,
        subtree: true,
      });
    }
    return this.referenceTime;
  }

  /**
   * Stop observing. Decrements refcount. Disconnects on last call.
   */
  stop(): void {
    if (this.refcount === 0) return;
    this.refcount--;
    if (this.refcount === 0) {
      this.observer?.disconnect();
      this.observer = null;
    }
  }

  /**
   * Get the current global batch counter value.
   */
  getBatchCounter(): number {
    return this.globalBatchCounter;
  }

  /**
   * Get accumulated summaries (copies them into DomChangeSummary[]).
   * Does NOT clear the accumulation.
   */
  getAccumulatedSummaries(): DomChangeSummary[] {
    return Array.from(this.accumulated.values()).map((acc) => this.finalizeSummary(acc));
  }

  /**
   * Get accumulated surface changes.
   */
  getSurfaceChanges(): SurfaceChange[] {
    return [...this.surfaceChanges];
  }

  /**
   * Get accumulated visibility changes.
   */
  getVisibilityChanges(): VisibilityChange[] {
    return [...this.visibilityChanges];
  }

  /**
   * Clear all accumulated data (called by EvidenceCollector at window close
   * or window reset).
   */
  clearAccumulated(): void {
    this.accumulated.clear();
    this.surfaceChanges = [];
    this.visibilityChanges = [];
  }

  /**
   * Get performance metrics.
   */
  getPerformanceMetrics(): { longestBatchMs: number; totalBatches: number } {
    return { longestBatchMs: this.longestBatchMs, totalBatches: this.totalBatches };
  }

  /**
   * Reset the batch counter (used when a new recording session starts).
   */
  resetBatchCounter(): void {
    this.globalBatchCounter = 0;
  }

  // ── Internal: Mutation Processing ──────────────────────────────────

  /**
   * Process raw MutationRecords. Called by MutationObserver.
   */
  private onMutations(records: MutationRecord[]): void {
    const batchIndex = this.globalBatchCounter++;
    const now = performance.now();
    const batchStart = now;

    this.totalBatches++;

    // Process each record
    for (const record of records) {
      if (isNoise(record)) continue;

      this.processRecord(record, batchIndex, now);
    }

    const batchDuration = performance.now() - batchStart;
    if (batchDuration > this.longestBatchMs) {
      this.longestBatchMs = batchDuration;
    }

    // Notify callback with summaries from THIS batch
    if (this.batchCallback) {
      // Collect summaries created/updated in this batch
      const batchSummaries = this.getBatchSummaries(batchIndex);
      this.batchCallback(batchIndex, batchSummaries, now);
    }
  }

  /**
   * Process a single MutationRecord into accumulated summaries.
   */
  private processRecord(record: MutationRecord, batchIndex: number, now: number): void {
    const targetEl = record.target instanceof Element
      ? record.target
      : record.target.parentElement;
    if (!targetEl) return;

    const targetPath = getElementPath(targetEl);
    const key = targetPath; // Group by path (shadow DOM adds context in M5)
    const targetTag = targetEl.tagName.toLowerCase();

    let acc = this.accumulated.get(key);
    if (!acc) {
      acc = {
        types: new Set(),
        targetPath,
        targetTag,
        shadowContext: null,
        changedAttributes: new Set(),
        attributeDeltas: {},
        addedNodesCount: 0,
        removedNodesCount: 0,
        characterDataDelta: null,
        firstMutationAt: now,
        lastMutationAt: now,
        rawMutationCount: 0,
        firstBatchIndex: batchIndex,
        lastBatchIndex: batchIndex,
      };
      this.accumulated.set(key, acc);
    }

    // Update timing
    acc.lastMutationAt = now;
    acc.lastBatchIndex = batchIndex;
    acc.rawMutationCount++;

    // Process by type
    switch (record.type) {
      case 'attributes': {
        acc.types.add('attributes');
        const attrName = record.attributeName;
        if (attrName) {
          acc.changedAttributes.add(attrName);
          // Track delta (keep first old, latest new)
          if (!(attrName in acc.attributeDeltas)) {
            acc.attributeDeltas[attrName] = {
              old: record.oldValue ?? null,
              new: targetEl.getAttribute(attrName),
            };
          } else {
            acc.attributeDeltas[attrName].new = targetEl.getAttribute(attrName);
          }
        }
        break;
      }
      case 'childList': {
        acc.types.add('childList');
        acc.addedNodesCount += record.addedNodes.length;
        acc.removedNodesCount += record.removedNodes.length;

        // Detect surface changes (added/removed significant elements)
        this.detectSurfaceChanges(record, targetEl, batchIndex, now);

        // Detect visibility changes (display/visibility/opacity/hidden/aria-hidden)
        break;
      }
      case 'characterData': {
        acc.types.add('characterData');
        acc.characterDataDelta = {
          old: record.oldValue ?? null,
          new: record.target.textContent ?? null,
        };
        break;
      }
    }

    // Check for visibility attribute changes
    if (record.type === 'attributes') {
      const attrName = record.attributeName;
      if (attrName === 'hidden' || attrName === 'aria-hidden') {
        this.detectVisibilityChange(targetEl, attrName, record.oldValue, batchIndex, now);
      }
    }
  }

  /**
   * Detect surface changes from childList mutations.
   * A "surface" is a significant element added or removed (dialog, menu, panel,
   * tooltip, etc.) — identified by role or tag.
   */
  private detectSurfaceChanges(
    record: MutationRecord,
    _parent: Element,
    batchIndex: number,
    now: number,
  ): void {
    // Check added nodes
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (this.isSignificantSurface(node)) {
        this.surfaceChanges.push({
          path: getElementPath(node),
          tagName: node.tagName.toLowerCase(),
          ariaRole: node.getAttribute('role'),
          accessibleName: getAccessibleName(node),
          shadowContext: null,
          descendantCount: node.childElementCount,
          relativeTime: now - this.referenceTime,
          batchIndex,
        });
      }
    }

    // Check removed nodes
    for (const node of record.removedNodes) {
      if (!(node instanceof Element)) continue;
      if (this.isSignificantSurface(node)) {
        this.surfaceChanges.push({
          path: getElementPath(node),
          tagName: node.tagName.toLowerCase(),
          ariaRole: node.getAttribute('role'),
          accessibleName: getAccessibleName(node),
          shadowContext: null,
          descendantCount: 0,
          relativeTime: now - this.referenceTime,
          batchIndex,
        });
      }
    }
  }

  /**
   * Determine if an element is a "significant surface" worth tracking.
   * Based on ARIA roles and common HTML tags for overlays.
   */
  private isSignificantSurface(el: Element): boolean {
    const role = el.getAttribute('role');
    if (role && SURFACE_ROLES.has(role)) return true;

    const tag = el.tagName.toLowerCase();
    if (SURFACE_TAGS.has(tag)) return true;

    return false;
  }

  /**
   * Detect visibility changes from attribute mutations.
   */
  private detectVisibilityChange(
    el: Element,
    attrName: string,
    oldValue: string | null,
    batchIndex: number,
    now: number,
  ): void {
    const newValue = el.getAttribute(attrName);

    // Skip if no actual change
    if (oldValue === newValue) return;

    this.visibilityChanges.push({
      path: getElementPath(el),
      property: attrName === 'aria-hidden' ? 'aria-hidden' : 'hidden',
      oldValue: oldValue,
      newValue: newValue,
      relativeTime: now - this.referenceTime,
      batchIndex,
    });
  }

  /**
   * Get summaries that were last touched in a specific batch.
   */
  private getBatchSummaries(batchIndex: number): DomChangeSummary[] {
    const result: DomChangeSummary[] = [];
    for (const acc of this.accumulated.values()) {
      if (acc.lastBatchIndex === batchIndex) {
        result.push(this.finalizeSummary(acc));
      }
    }
    return result;
  }

  /**
   * Convert an AccumulatedSummary into an immutable DomChangeSummary.
   */
  private finalizeSummary(acc: AccumulatedSummary): DomChangeSummary {
    return {
      types: Array.from(acc.types),
      targetPath: acc.targetPath,
      targetTag: acc.targetTag,
      shadowContext: acc.shadowContext,
      changedAttributes: Array.from(acc.changedAttributes),
      attributeDeltas: { ...acc.attributeDeltas },
      addedNodesCount: acc.addedNodesCount,
      removedNodesCount: acc.removedNodesCount,
      characterDataDelta: acc.characterDataDelta,
      firstMutationAt: acc.firstMutationAt - this.referenceTime,
      lastMutationAt: acc.lastMutationAt - this.referenceTime,
      rawMutationCount: acc.rawMutationCount,
      firstBatchIndex: acc.firstBatchIndex,
      lastBatchIndex: acc.lastBatchIndex,
    };
  }
}

// ── Surface Detection Constants ──────────────────────────────────────

/** ARIA roles that indicate significant UI surfaces. */
const SURFACE_ROLES = new Set([
  'dialog', 'alertdialog', 'menu', 'menubar', 'tooltip',
  'tabpanel', 'tablist', 'listbox', 'tree', 'treegrid',
  'navigation', 'complementary', 'banner', 'contentinfo',
  'alert', 'status', 'log',
]);

/** HTML tags that indicate significant UI surfaces. */
const SURFACE_TAGS = new Set([
  'dialog', 'details', 'summary',
]);
