/**
 * Target State Cache — Pre-Interaction Element State (M2)
 *
 * WeakMap-based cache that stores TargetStateSnapshot for elements.
 * Populated by capture-phase listeners (mousedown, focus) BEFORE the
 * browser applies state changes from the interaction.
 *
 * This gives the EvidenceCollector (M4) a "before" snapshot:
 *   1. Capture-phase listener fires → cache.capture(el) stores pre-state
 *   2. User's click/focus handler runs → element state changes
 *   3. EvidenceCollector closes → cache.read(el) captures post-state
 *
 * The 9 properties are DOM PROPERTIES (not attributes) — MutationObserver
 * cannot observe them. They complement the existing ObservedEvent.valueBefore/
 * valueAfter which only captures the `value` property.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §3.3
 */

import type { TargetStateSnapshot } from '../shared/behavioral-evidence-types';

/**
 * A WeakMap-based cache for element state snapshots.
 *
 * WeakMap ensures entries are garbage-collected when elements leave the DOM.
 * No manual eviction needed.
 */
export class TargetStateCache {
  private cache = new WeakMap<Element, TargetStateSnapshot>();

  /**
   * Capture the current state of an element and store it in the cache.
   * Overwrites any previous snapshot for this element.
   * Called by capture-phase listeners (pre-interaction) and by
   * EvidenceCollector at close time (post-interaction).
   *
   * @returns The captured snapshot.
   */
  capture(el: Element): TargetStateSnapshot {
    const snapshot = snapshotElement(el);
    this.cache.set(el, snapshot);
    return snapshot;
  }

  /**
   * Non-destructive read. Returns the cached snapshot without updating it.
   * Used by EvidenceCollector to get the "before" state.
   *
   * @returns The cached snapshot, or undefined if none exists.
   */
  peek(el: Element): TargetStateSnapshot | undefined {
    return this.cache.get(el);
  }

  /**
   * Read the cached snapshot, then immediately capture a fresh one.
   * This is the "read-then-update" pattern for close-time:
   *   const before = cache.peek(el);  // pre-interaction state
   *   ... window stays open ...
   *   const after = cache.read(el);   // returns old cache, stores new state
   *
   * Actually, per the spec §4.4 step 1, the EvidenceCollector captures
   * the "after" snapshot directly via `capture(el)` at close time.
   * This method exists for cases where we need the previous snapshot
   * AND want to update the cache in one operation.
   *
   * @returns The previous cached snapshot (or undefined), then updates.
   */
  read(el: Element): TargetStateSnapshot | undefined {
    const prev = this.cache.get(el);
    this.capture(el);
    return prev;
  }

  /**
   * Check whether a snapshot exists for this element.
   */
  has(el: Element): boolean {
    return this.cache.has(el);
  }
}

// ── Snapshot Extraction ──────────────────────────────────────────────

/**
 * Extract a TargetStateSnapshot from a live DOM element.
 *
 * Captures 9 DOM properties that MutationObserver cannot see
 * (they are properties, not attributes):
 *   - value (input/select/textarea)
 *   - checked (checkbox/radio)
 *   - className
 *   - disabled
 *   - ariaExpanded
 *   - ariaChecked
 *   - ariaPressed
 *   - textContent (truncated to 500 chars)
 *   - childCount
 *
 * Plus capturedAt: performance.now() when the snapshot was taken.
 */
function snapshotElement(el: Element): TargetStateSnapshot {
  const htmlEl = el as HTMLElement;

  // value — only meaningful for form elements
  let value: string | null = null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    value = (el as HTMLInputElement).value;
  }

  // checked — only meaningful for checkbox/radio
  let checked: boolean | null = null;
  if (el instanceof HTMLInputElement) {
    const inputEl = el as HTMLInputElement;
    if (inputEl.type === 'checkbox' || inputEl.type === 'radio') {
      checked = inputEl.checked;
    }
  }

  // className — always present on HTMLElement
  const className = htmlEl.className ?? '';

  // disabled — present on form elements and fieldset/button/etc
  const disabled = (htmlEl as HTMLInputElement).disabled ?? false;

  // ARIA state attributes
  const ariaExpanded = parseAriaBoolean(htmlEl.getAttribute('aria-expanded'));
  const ariaChecked = parseAriaBoolean(htmlEl.getAttribute('aria-checked'));
  const ariaPressed = parseAriaBoolean(htmlEl.getAttribute('aria-pressed'));

  // textContent — truncate to prevent memory bloat on large containers
  const rawText = htmlEl.textContent;
  const textContent = rawText !== null ? rawText.slice(0, 500) : null;

  // childCount
  const childCount = htmlEl.childElementCount;

  // P2-6: scrollTop/scrollLeft — only for scrollable elements
  let scrollTop: number | null = null;
  let scrollLeft: number | null = null;
  if (el instanceof HTMLElement) {
    if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) {
      scrollTop = el.scrollTop;
      scrollLeft = el.scrollLeft;
    }
  }

  // P3-7: selectedValues — all selected options for multi-select
  let selectedValues: string[] | null = null;
  if (el instanceof HTMLSelectElement) {
    const selected = el.selectedOptions;
    if (selected.length > 1) {
      selectedValues = Array.from(selected).map(
        (opt) => opt.text?.trim() || opt.textContent?.trim() || opt.value || '',
      );
    }
  } else {
    // Custom multi-select: multiple [aria-selected="true"] descendants
    const selectedDescendants = el.querySelectorAll('[aria-selected="true"]');
    if (selectedDescendants.length > 1) {
      selectedValues = Array.from(selectedDescendants).map(
        (d) => (d as HTMLElement).textContent?.trim() || (d as HTMLElement).getAttribute('aria-label') || '',
      );
    }
  }

  // P2-5: controlledValue — value of element referenced by aria-controls
  let controlledValue: string | null = null;
  const controlsId = htmlEl.getAttribute('aria-controls');
  if (controlsId) {
    const controlled = document.getElementById(controlsId);
    if (controlled) {
      if (controlled instanceof HTMLInputElement || controlled instanceof HTMLTextAreaElement) {
        controlledValue = controlled.value;
      } else {
        controlledValue = controlled.textContent?.trim().slice(0, 500) || null;
      }
    }
  }

  return {
    value,
    checked,
    className,
    disabled,
    ariaExpanded,
    ariaChecked,
    ariaPressed,
    textContent,
    childCount,
    scrollTop,
    scrollLeft,
    selectedValues,
    controlledValue,
    capturedAt: performance.now(),
  };
}

/**
 * Parse an ARIA attribute value into a boolean.
 * Returns null if the attribute is absent or not a recognized boolean string.
 */
function parseAriaBoolean(val: string | null): boolean | null {
  if (val === null) return null;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return null;
}
