/**
 * DOM Observer — Refcounted MutationObserver with Summarization (M3)
 * Extended in M5: Recursive Shadow DOM observation (spec §5.1)
 *
 * A refcounted singleton MutationObserver on document.body that captures
 * DOM mutations, summarizes them into DomChangeSummary entries, and
 * distributes them to all active observation windows via a shared
 * globalBatchCounter.
 *
 * Shadow DOM (M5): Recursively discovers open shadow roots and attaches
 * per-root MutationObservers. Mutations inside shadow roots carry a
 * non-null shadowContext path. Maximum 20 shadow roots. Closed roots
 * are an inherent limitation (documented in spec §5.1).
 *
 * Pipeline (spec §5.2):
 *   Stage 1: Filter — exclude noise (CSS animations, virtual scroll, scripts)
 *   Stage 2: Summarize — group mutations by targetPath + shadowContext
 *   Stage 3: Cap — at window-close time, keep first 200 entries (NOT M3 concern;
 *           the EvidenceCollector (M4) applies the cap when building the final
 *           ApplicationEvidence. DOMObserver itself just summarizes and stores.)
 *
 * Refcounting: start() increments refcount and begins observing; stop()
 * decrements and disconnects when refcount hits zero. Shadow root observers
 * share the same refcount lifecycle.
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

// ── Constants ────────────────────────────────────────────────────────

/** Maximum number of shadow roots to observe concurrently (spec §5.1). */
const MAX_SHADOW_ROOTS = 20;

// ── Shadow DOM Utilities ─────────────────────────────────────────────

/**
 * Generate a CSS-like path for an element within the light DOM.
 * This is used to build shadowContext paths.
 */
function buildCssSegment(el: Element): string {
  let part = el.tagName.toLowerCase();
  if (el.id) {
    part += `#${el.id}`;
  }
  // Add nth-of-type if needed for disambiguation
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === el.tagName,
    );
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      part += `:nth-of-type(${index})`;
    }
  }
  return part;
}

/**
 * Build a shadow context path for a shadow host element.
 * Walks up the light DOM to create a hierarchical path.
 */
function buildShadowContextPath(host: Element, parentContext: string | null): string {
  const segment = buildCssSegment(host);
  return parentContext ? `${parentContext} > ${segment}` : segment;
}

/**
 * Generate a CSS-like path for an element. Used as the grouping key
 * for summarization. Not a full unique selector — just enough to
 * group mutations on the same element.
 *
 * If shadowContext is provided, the path is prefixed with [shadowContext].
 */
function getElementPath(el: Element, shadowContext?: string | null): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  const maxDepth = 8;

  // Detect if element is inside a shadow root
  const rootNode = el.getRootNode();
  const isInShadowRoot = rootNode instanceof ShadowRoot;

  while (current && depth < maxDepth) {
    // Stop at document.body for light DOM
    if (!isInShadowRoot && (current === document.body || current === document.documentElement)) {
      break;
    }
    // For shadow DOM: stop when we reach the top-level element of the shadow root
    if (isInShadowRoot && current.parentNode === rootNode) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${current.id}`;
      parts.unshift(part);
      break;
    }
    if (current.parentElement === null) break;

    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
    }
    parts.unshift(part);
    current = current.parentElement;
    depth++;
  }

  const path = parts.join(' > ');

  // If in shadow root, prefix with shadowContext
  if (shadowContext) {
    return `[${shadowContext}] > ${path}`;
  }

  const prefix = !isInShadowRoot && current === document.body
    ? 'body'
    : !isInShadowRoot && current === document.documentElement
      ? 'html'
      : '';
  return (prefix ? prefix + ' > ' : '') + path;
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
 * Safe wrapper for getComputedStyle — returns a default if it fails.
 */
function getComputedStyleSafe(el: Element, prop: string): string {
  try {
    return window.getComputedStyle(el).getPropertyValue(prop) || '';
  } catch {
    return '';
  }
}

/**
 * Extract a CSS property value from an inline style string.
 * e.g., extractCssProperty('display:none; color:red', 'display') → 'none'
 */
function extractCssProperty(styleStr: string, prop: string): string | null {
  // Match "prop:value" or "prop: value" in the style string
  const regex = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i');
  const match = styleStr.match(regex);
  return match ? match[1].trim() : null;
}

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

  // ── M5: Shadow DOM Observation ────────────────────────────────────

  /**
   * Map of shadow root observers. Keyed by the shadow root object.
   * Each entry tracks the MutationObserver for that root and the
   * shadowContext path for mutations inside it.
   */
  private shadowObservers = new Map<
    ShadowRoot,
    { observer: MutationObserver; shadowContext: string }
  >();

  /**
   * Map from shadow host elements to their shadow roots.
   * Used for re-scanning and context resolution.
   */
  private shadowHosts = new Map<Element, ShadowRoot>();

  /** Whether shadow root scanning exceeded the cap. */
  private shadowRootOverflow = false;

  /**
   * GAP-3: Cache of previous computed styles for class-change visibility detection.
   * WeakMap so entries are garbage-collected with the element — bounded.
   */
  private prevComputedStyles = new WeakMap<Element, { display: string; visibility: string; opacity: string }>();

  /**
   * Surface-detection generification: element-identity dedup for surface
   * records. First discovery wins per ELEMENT for the accumulation
   * lifetime — siblings with identical paths remain distinct records.
   * Recreated (not cleared) in clearAccumulated(): WeakSet has no clear().
   */
  private recordedSurfaceElements = new WeakSet<Element>();

  /**
   * Surface-detection generification: remaining descendant-scan budget for
   * the current MutationObserver callback (reset per batch in onMutations).
   * Bounds the cost of 5a on pathological batches.
   */
  private descendantScanBudget = 0;

  /**
   * Start observing. Increments refcount. Creates the MutationObserver
   * on first call. Returns the reference time (performance.now() at observation start).
   *
   * M5: Also discovers and attaches observers to all existing open shadow roots.
   */
  start(callback?: MutationBatchCallback): number {
    this.refcount++;
    if (callback) {
      this.batchCallback = callback;
    }
    if (this.refcount === 1) {
      this.referenceTime = performance.now();
      this.globalBatchCounter = 0;
      this.shadowRootOverflow = false;
      this.observer = new MutationObserver((records) => this.onMutations(records, null));
      this.observer.observe(document.body, {
        childList: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true,
        subtree: true,
      });

      // M5: Discover and observe existing shadow roots
      this.discoverShadowRoots(document.body, null);

      // P0-2 Fix: Seed the prevComputedStyles cache so the FIRST class
      // mutation on any element has a baseline to compare against.
      // Without this, detectClassVisibilityChange() silently drops the
      // first visibility change because cached === undefined.
      this.seedComputedStylesCache();
    }
    return this.referenceTime;
  }

  /**
   * Stop observing. Decrements refcount. Disconnects on last call.
   * M5: Also disconnects all shadow root observers.
   */
  stop(): void {
    if (this.refcount === 0) return;
    this.refcount--;
    if (this.refcount === 0) {
      this.observer?.disconnect();
      this.observer = null;

      // M5: Disconnect all shadow root observers
      for (const { observer } of this.shadowObservers.values()) {
        observer.disconnect();
      }
      this.shadowObservers.clear();
      this.shadowHosts.clear();
      this.shadowRootOverflow = false;
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
    this.recordedSurfaceElements = new WeakSet<Element>();
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

  // ── M5: Shadow DOM Discovery & Observer Attachment ────────────────

  /**
   * Recursively discover open shadow roots within a root element and
   * attach MutationObservers to them.
   *
   * Per spec §5.1:
   *   - Walks querySelectorAll('*') checking for .shadowRoot
   *   - Recursively enters nested shadow roots
   *   - Caps at MAX_SHADOW_ROOTS (20)
   *   - Closed shadow roots (shadowRoot === null) are skipped — inherent limitation
   *
   * @param root The root element to scan (document.body or a newly-added subtree)
   * @param parentContext The shadow context path of the parent (null for light DOM)
   */
  private discoverShadowRoots(root: Element | ShadowRoot, parentContext: string | null): void {
    try {
      const elements = root.querySelectorAll('*');
      for (const el of elements) {
        // Check if this element hosts an open shadow root
        const shadowRoot = el.shadowRoot;
        if (!shadowRoot) continue;

        // Skip if already observed
        if (this.shadowHosts.has(el)) continue;

        // Enforce cap
        if (this.shadowObservers.size >= MAX_SHADOW_ROOTS) {
          this.shadowRootOverflow = true;
          return;
        }

        // Build shadow context path
        const shadowContext = buildShadowContextPath(el, parentContext);

        // Attach observer
        const observer = new MutationObserver((records) =>
          this.onMutations(records, shadowContext),
        );
        observer.observe(shadowRoot, {
          childList: true,
          attributes: true,
          attributeOldValue: true,
          characterData: true,
          characterDataOldValue: true,
          subtree: true,
        });

        this.shadowObservers.set(shadowRoot, { observer, shadowContext });
        this.shadowHosts.set(el, shadowRoot);

        // Recursively discover shadow roots within this shadow root
        this.discoverShadowRoots(shadowRoot, shadowContext);
      }
    } catch {
      // querySelectorAll on a detached node can throw — silent degrade
    }
  }

  /**
   * Get the count of currently observed shadow roots.
   * Useful for diagnostics and testing.
   */
  getShadowRootCount(): number {
    return this.shadowObservers.size;
  }

  /**
   * Get whether the shadow root cap was exceeded.
   */
  getShadowRootOverflow(): boolean {
    return this.shadowRootOverflow;
  }

  // ── Internal: Mutation Processing ──────────────────────────────────

  /**
   * Process raw MutationRecords. Called by MutationObserver.
   *
   * M5: shadowContext is null for light-DOM mutations and a path string
   * for mutations inside shadow roots. Each shadow root observer passes
   * its context through.
   */
  private onMutations(records: MutationRecord[], shadowContext: string | null): void {
    const batchIndex = this.globalBatchCounter++;
    const now = performance.now();
    const batchStart = now;

    this.totalBatches++;
    this.descendantScanBudget = MAX_DESCENDANT_SCANS_PER_BATCH;

    // Process each record
    for (const record of records) {
      if (isNoise(record)) continue;

      this.processRecord(record, batchIndex, now, shadowContext);

      // M5: Re-scan for new shadow roots on childList additions
      if (record.type === 'childList' && shadowContext === null) {
        // Only re-scan from the main observer (not from shadow root observers)
        // to avoid redundant scans
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            this.discoverShadowRoots(node, null);
          }
        }
      }
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
   * M5: shadowContext tracks whether this mutation is inside a shadow root.
   */
  private processRecord(
    record: MutationRecord,
    batchIndex: number,
    now: number,
    shadowContext: string | null,
  ): void {
    const targetEl = record.target instanceof Element
      ? record.target
      : record.target.parentElement;
    if (!targetEl) return;

    const targetPath = getElementPath(targetEl, shadowContext);
    // Group by targetPath (which includes [shadowContext] prefix if present)
    const key = targetPath;
    const targetTag = targetEl.tagName.toLowerCase();

    let acc = this.accumulated.get(key);
    if (!acc) {
      acc = {
        types: new Set(),
        targetPath,
        targetTag,
        shadowContext,
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
        this.detectSurfaceChanges(record, targetEl, batchIndex, now, shadowContext);

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
    // GAP-3 fix: detect display/visibility/opacity from style attribute,
    // plus class attribute changes that may affect visibility.
    if (record.type === 'attributes') {
      const attrName = record.attributeName;
      if (attrName === 'hidden' || attrName === 'aria-hidden') {
        this.detectVisibilityChange(targetEl, attrName, record.oldValue, batchIndex, now, shadowContext);
      } else if (attrName === 'style') {
        // GAP-3: Check style attribute for display/visibility/opacity changes
        this.detectStyleVisibilityChange(targetEl, record.oldValue, batchIndex, now, shadowContext);
      } else if (attrName === 'class') {
        // GAP-3: Check class changes that may affect visibility
        // (CSS classes commonly toggle display/visibility/opacity)
        this.detectClassVisibilityChange(targetEl, record.oldValue, batchIndex, now, shadowContext);
      }
    }
  }

  /**
   * Detect surface changes from childList mutations.
   * A "surface" is a significant element added or removed (dialog, menu, panel,
   * tooltip, etc.) — identified by role or tag.
   *
   * Surface-detection generification (spec surface-detection-generification.md):
   *  - 5a: every added/removed subtree gets ONE bounded
   *    querySelector(SURFACE_SELECTOR) — finds wrapper-added dialogs (the
   *    most common real-world insertion shape) AND nested significant
   *    descendants (dialog-in-dialog). Budgeted at
   *    MAX_DESCENDANT_SCANS_PER_BATCH per MutationObserver callback.
   *  - Directly-significant nodes record the legacy shape (no emergence
   *    field); descendant discoveries record emergence:'inserted'.
   *  - All surface records (direct, descendant, revealed) go through
   *    recordSurface(), which dedups by ELEMENT identity (WeakSet) for the
   *    accumulation lifetime — wrapper+descendant and insert+reveal
   *    discoveries yield exactly one record per element, while sibling
   *    elements with identical paths remain distinct.
   */
  private detectSurfaceChanges(
    record: MutationRecord,
    _parent: Element,
    batchIndex: number,
    now: number,
    shadowContext: string | null,
  ): void {
    // Check added nodes
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (this.isSignificantSurface(node)) {
        // Direct discovery keeps the legacy record shape (no emergence field)
        this.recordSurface(node, 'added', null, batchIndex, now, shadowContext);
      }
      // 5a: bounded descendant scan — applies to EVERY added subtree
      // (significant or not) so nested significant surfaces (dialog in
      // dialog) are also recorded. First match wins; budget-bounded.
      if (this.descendantScanBudget > 0) {
        this.descendantScanBudget--;
        const matched = querySurfaceDescendant(node);
        if (matched) {
          this.recordSurface(matched, 'added', 'inserted', batchIndex, now, shadowContext);
        }
      }
      // P0-2 Fix: Seed computed styles for newly added elements so
      // the first class/style change on them has a baseline.
      this.seedComputedStylesForElement(node);
    }

    // Check removed nodes
    for (const node of record.removedNodes) {
      if (!(node instanceof Element)) continue;
      if (this.isSignificantSurface(node)) {
        this.recordSurface(node, 'removed', null, batchIndex, now, shadowContext);
      }
      if (this.descendantScanBudget > 0) {
        this.descendantScanBudget--;
        const matched = querySurfaceDescendant(node);
        if (matched) {
          this.recordSurface(matched, 'removed', 'inserted', batchIndex, now, shadowContext);
        }
      }
    }
  }

  /**
   * Push a SurfaceChange with element-identity dedup. First discovery wins
   * per element for the accumulation lifetime (WeakSet recreated in
   * clearAccumulated()).
   * `emergence` records how the surface came to be observed:
   *  - 'inserted' — a new DOM node (direct or descendant discovery)
   *  - 'revealed' — a pre-existing node became visible (5b)
   * Omitted for the legacy direct-insertion shape (backward compatible).
   */
  private recordSurface(
    el: Element,
    kind: 'added' | 'removed',
    emergence: 'inserted' | 'revealed' | null,
    batchIndex: number,
    now: number,
    shadowContext: string | null,
  ): boolean {
    if (this.recordedSurfaceElements.has(el)) return false;
    this.recordedSurfaceElements.add(el);
    const path = getElementPath(el, shadowContext);
    this.surfaceChanges.push({
      path,
      tagName: el.tagName.toLowerCase(),
      ariaRole: el.getAttribute('role'),
      accessibleName: getAccessibleName(el),
      shadowContext,
      descendantCount: kind === 'added' ? el.childElementCount : 0,
      relativeTime: now - this.referenceTime,
      batchIndex,
      kind,
      ...(emergence ? { emergence } : {}),
    });
    return true;
  }

  /**
   * 5b: surface-on-reveal. Called from the three visibility detectors after
   * their visibilityChanges.push. Emits a SurfaceChange ONLY when the
   * transition is a reveal AND the element already satisfies the existing
   * surface-role/tag definition (isSignificantSurface). No new roles, no
   * heuristics — role=region intentionally NOT included (deferred product
   * decision, spec §15).
   *
   * Reveal conditions per property:
   *  - display:     old none/'' (unrendered) → new rendered value
   *  - visibility:  hidden/collapse → visible
   *  - opacity:     0 → non-zero
   *  - hidden:      any value → removed/null (un-hidden)
   *  - aria-hidden: 'true' → 'false'/removed
   */
  private maybeRecordRevealedSurface(
    el: Element,
    prop: 'display' | 'visibility' | 'opacity' | 'hidden' | 'aria-hidden',
    oldValue: string | null,
    newValue: string | null,
    batchIndex: number,
    now: number,
    shadowContext: string | null,
  ): void {
    if (!this.isSignificantSurface(el)) return;

    let isReveal = false;
    switch (prop) {
      case 'display': {
        // Inline-style path: when the property was absent from the old inline
        // style (null/''), the element may still have been hidden by CSS.
        // Fall back to the seeded computed-style baseline as the effective
        // old value (spec §6 "computed path") so CSS-hidden → inline-shown
        // reveals (the real Amazon shape) are recognized.
        let effOld = oldValue;
        if (effOld === null || effOld === '') {
          const cached = this.prevComputedStyles.get(el);
          if (cached) effOld = cached.display;
        }
        isReveal = (effOld === 'none' || effOld === null || effOld === '')
          && newValue !== null && newValue !== 'none' && newValue !== '';
        break;
      }
      case 'visibility': {
        let effOld = oldValue;
        if (effOld === null || effOld === '') {
          const cached = this.prevComputedStyles.get(el);
          if (cached) effOld = cached.visibility;
        }
        isReveal = (effOld === 'hidden' || effOld === 'collapse') && newValue === 'visible';
        break;
      }
      case 'opacity': {
        let effOld = oldValue;
        if (effOld === null || effOld === '') {
          const cached = this.prevComputedStyles.get(el);
          if (cached) effOld = cached.opacity;
        }
        isReveal = effOld === '0' && newValue !== null && newValue !== '0';
        break;
      }
      case 'hidden':
        // hidden attribute removed → element un-hidden
        isReveal = newValue === null && oldValue !== null;
        break;
      case 'aria-hidden':
        isReveal = oldValue === 'true' && (newValue === 'false' || newValue === null);
        break;
    }

    if (!isReveal) return;

    this.recordSurface(el, 'added', 'revealed', batchIndex, now, shadowContext);
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
   * M5: shadowContext propagated for shadow root mutations.
   */
  private detectVisibilityChange(
    el: Element,
    attrName: string,
    oldValue: string | null,
    batchIndex: number,
    now: number,
    shadowContext: string | null,
  ): void {
    const newValue = el.getAttribute(attrName);

    // Skip if no actual change
    if (oldValue === newValue) return;

    this.visibilityChanges.push({
      path: getElementPath(el, shadowContext),
      property: attrName === 'aria-hidden' ? 'aria-hidden' : 'hidden',
      oldValue: oldValue,
      newValue: newValue,
      relativeTime: now - this.referenceTime,
      batchIndex,
    });

    // 5b: surface-on-reveal for recognized surfaces (hidden/aria-hidden path)
    this.maybeRecordRevealedSurface(
      el,
      attrName === 'aria-hidden' ? 'aria-hidden' : 'hidden',
      oldValue,
      newValue,
      batchIndex,
      now,
      shadowContext,
    );
  }

  /**
   * Detect visibility changes from style attribute mutations (GAP-3).
   *
   * Parses the old and new style attribute values for display, visibility,
   * and opacity properties. If any of these changed, records a VisibilityChange.
   *
   * This catches cases like:
   *   style="display:none" → style="display:block"
   *   style="visibility:hidden" → style="visibility:visible"
   *   style="opacity:0" → style="opacity:1"
   */
  private detectStyleVisibilityChange(
    el: Element,
    oldStyleValue: string | null,
    batchIndex: number,
    now: number,
    shadowContext: string | null,
  ): void {
    const newStyleValue = el.getAttribute('style') ?? '';
    const oldStyle = oldStyleValue ?? '';

    // Parse display/visibility/opacity from old and new style strings
    const props = ['display', 'visibility', 'opacity'] as const;
    for (const prop of props) {
      const oldVal = extractCssProperty(oldStyle, prop);
      const newVal = extractCssProperty(newStyleValue, prop);
      if (oldVal !== newVal) {
        this.visibilityChanges.push({
          path: getElementPath(el, shadowContext),
          property: prop,
          oldValue: oldVal ?? '',
          newValue: newVal ?? '',
          relativeTime: now - this.referenceTime,
          batchIndex,
        });

        // 5b: surface-on-reveal for recognized surfaces (inline style path)
        this.maybeRecordRevealedSurface(el, prop, oldVal, newVal, batchIndex, now, shadowContext);
      }
    }
  }

  /**
   * Seed the prevComputedStyles WeakMap with current computed styles
   * for all elements on the page. This ensures detectClassVisibilityChange()
   * has a baseline to compare against for the FIRST class mutation on
   * any element — preventing the cold-start bug where the first visibility
   * change is silently dropped.
   *
   * P0-2 Fix: Called from start() when the MutationObserver is first created.
   * Also re-seeds for newly added significant surfaces (dropdowns, menus, etc.)
   * as they appear in the DOM during recording.
   *
   * Performance: querySelectorAll('*') on document.body is bounded by the
   * DOM size. getComputedStyle is called once per element for 3 properties.
   * This is a one-time cost at observation start.
   */
  private seedComputedStylesCache(): void {
    try {
      const elements = document.body.querySelectorAll('*');
      for (const el of elements) {
        // Only seed if not already cached (avoid overwriting live data)
        if (!this.prevComputedStyles.has(el)) {
          this.prevComputedStyles.set(el, {
            display: getComputedStyleSafe(el, 'display'),
            visibility: getComputedStyleSafe(el, 'visibility'),
            opacity: getComputedStyleSafe(el, 'opacity'),
          });
        }
      }
    } catch {
      // querySelectorAll may fail on detached DOM — silent degrade
    }
  }

  /**
   * Seed computed styles for a single newly-added element and its children.
   * Called from detectSurfaceChanges when significant surfaces (dropdowns,
   * menus, etc.) are added to the DOM. This ensures the first class/style
   * change on these new elements has a baseline.
   */
  private seedComputedStylesForElement(el: Element): void {
    try {
      if (!this.prevComputedStyles.has(el)) {
        this.prevComputedStyles.set(el, {
          display: getComputedStyleSafe(el, 'display'),
          visibility: getComputedStyleSafe(el, 'visibility'),
          opacity: getComputedStyleSafe(el, 'opacity'),
        });
      }
      // Also seed direct children
      for (const child of el.children) {
        if (!this.prevComputedStyles.has(child)) {
          this.prevComputedStyles.set(child, {
            display: getComputedStyleSafe(child, 'display'),
            visibility: getComputedStyleSafe(child, 'visibility'),
            opacity: getComputedStyleSafe(child, 'opacity'),
          });
        }
      }
    } catch {
      // silent degrade
    }
  }

  /**
   * Detect visibility changes from class attribute mutations (GAP-3).
   *
   * When a class attribute changes, compares the computed display/visibility/opacity
   * before and after. Uses a WeakMap cache to avoid redundant getComputedStyle calls.
   *
   * This catches cases like:
   *   class="dropdown hidden" → class="dropdown visible"
   *   class="menu collapsed" → class="menu expanded"
   *
   * Uses a WeakMap keyed by element to cache previous computed styles.
   * This is bounded (WeakMap entries are GC'd with elements).
   */
  private detectClassVisibilityChange(
    el: Element,
    _oldClassValue: string | null,
    batchIndex: number,
    now: number,
    shadowContext: string | null,
  ): void {
    // Get current computed display/visibility/opacity
    const currentDisplay = getComputedStyleSafe(el, 'display');
    const currentVisibility = getComputedStyleSafe(el, 'visibility');
    const currentOpacity = getComputedStyleSafe(el, 'opacity');

    // Get previous values from cache
    const cached = this.prevComputedStyles.get(el);
    if (cached) {
      if (cached.display !== currentDisplay) {
        this.visibilityChanges.push({
          path: getElementPath(el, shadowContext),
          property: 'display',
          oldValue: cached.display,
          newValue: currentDisplay,
          relativeTime: now - this.referenceTime,
          batchIndex,
        });
        // 5b: surface-on-reveal (class-computed display path)
        this.maybeRecordRevealedSurface(el, 'display', cached.display, currentDisplay, batchIndex, now, shadowContext);
      }
      if (cached.visibility !== currentVisibility) {
        this.visibilityChanges.push({
          path: getElementPath(el, shadowContext),
          property: 'visibility',
          oldValue: cached.visibility,
          newValue: currentVisibility,
          relativeTime: now - this.referenceTime,
          batchIndex,
        });
        // 5b: surface-on-reveal (class-computed visibility path)
        this.maybeRecordRevealedSurface(el, 'visibility', cached.visibility, currentVisibility, batchIndex, now, shadowContext);
      }
      if (cached.opacity !== currentOpacity) {
        this.visibilityChanges.push({
          path: getElementPath(el, shadowContext),
          property: 'opacity',
          oldValue: cached.opacity,
          newValue: currentOpacity,
          relativeTime: now - this.referenceTime,
          batchIndex,
        });
        // 5b: surface-on-reveal (class-computed opacity path)
        this.maybeRecordRevealedSurface(el, 'opacity', cached.opacity, currentOpacity, batchIndex, now, shadowContext);
      }
    }

    // Update cache
    this.prevComputedStyles.set(el, {
      display: currentDisplay,
      visibility: currentVisibility,
      opacity: currentOpacity,
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

/**
 * Surface-detection generification (5a): selector matching the existing
 * SURFACE_ROLES/SURFACE_TAGS — the sets remain the single source of truth;
 * this selector is derived from them mechanically.
 */
const SURFACE_SELECTOR = [
  ...Array.from(SURFACE_ROLES, (role) => `[role="${role}"]`),
  ...Array.from(SURFACE_TAGS, (tag) => tag),
].join(',');

/**
 * Surface-detection generification (5a): hard cap on descendant scans per
 * MutationObserver callback. Bounds worst-case cost when a batch adds many
 * non-significant wrapper subtrees.
 */
const MAX_DESCENDANT_SCANS_PER_BATCH = 32;

/**
 * 5a: run ONE querySelector over the (possibly detached) subtree and return
 * the first element matching the surface selector. Returns null when the
 * subtree contains no recognized surface.
 */
function querySurfaceDescendant(root: Element): Element | null {
  try {
    return root.querySelector(SURFACE_SELECTOR);
  } catch {
    // querySelector on a detached/odd subtree can throw in edge cases — degrade silently
    return null;
  }
}
