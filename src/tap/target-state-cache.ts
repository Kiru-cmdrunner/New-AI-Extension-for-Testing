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
import { captureValue } from './identity-extractor';

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

  // value — for form elements use .value directly.
  // For custom dropdowns (combobox, listbox, aria-haspopup) use captureValue()
  // which falls back to textContent.
  let value: string | null = null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    value = (el as HTMLInputElement).value;
  } else {
    // Fix Round 4: For non-form elements that act as custom dropdowns/comboboxes,
    // use captureValue() which reads textContent, aria-valuetext, etc.
    const role = htmlEl.getAttribute('role');
    const hasPopup = htmlEl.hasAttribute('aria-haspopup');
    if (role === 'combobox' || role === 'listbox' || hasPopup || role === 'option') {
      const captured = captureValue(el);
      if (captured !== undefined) {
        value = captured;
      }
    }
    // Fix Round 6: Broader fallback for custom select widgets that lack
    // proper ARIA roles. Many real-world dropdowns (OrangeHRM, SAP, etc.)
    // are just styled divs with class names like "select", "dropdown".
    if (value === null) {
      const cls = htmlEl.className ?? '';
      const hasSelectClass = /\b(select|dropdown|combobox|choice)\b/i.test(cls);
      const isInteractive = htmlEl.getAttribute('tabindex') !== null;
      if (hasSelectClass && isInteractive) {
        const captured = captureValue(el);
        if (captured !== undefined && captured.length > 0) {
          value = captured;
        }
      }
    }
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

  // P2-5: controlledValue — value of element referenced by aria-controls.
  // Fix Round 4: Also look for nearby date-picker inputs when the target is
  // a calendar cell (role=gridcell, role=option inside a dialog).
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

  // Fix Round 4: For calendar cells and date-picker elements without aria-controls,
  // look for associated date input fields.
  if (controlledValue === null) {
    const role = htmlEl.getAttribute('role');
    const isCalendarCell = role === 'gridcell' || role === 'option' ||
      htmlEl.closest('[role="dialog"], [role="application"], .datepicker, .calendar, [data-datepicker]') !== null;
    if (isCalendarCell) {
      // Strategy 1: Find input[type="date"] on the page
      const dateInput = document.querySelector('input[type="date"]');
      if (dateInput instanceof HTMLInputElement && dateInput.value) {
        controlledValue = dateInput.value;
      }
      // Strategy 2: Find input with date-related class/name within a reasonable scope
      if (controlledValue === null) {
        const parent = htmlEl.closest('form, [role="dialog"], [role="application"], .oxd-form, .modal') || document;
        const dateLikeInput = parent.querySelector(
          'input[type="date"], input[name*="date"], input[name*="Date"], input[class*="date"], input[aria-label*="date" i], input[placeholder*="date" i], input[placeholder*="dd-mm" i], input[placeholder*="yyyy" i]'
        );
        if (dateLikeInput instanceof HTMLInputElement && dateLikeInput.value) {
          controlledValue = dateLikeInput.value;
        }
      }
      // Fix Round 6: Strategy 3 — broader fallback for custom date pickers.
      // Look for any input within the closest form/container that has a value.
      // This catches OrangeHRM-style date pickers where the input has custom
      // class names like "oxd-input" and may not contain "date" in attributes.
      if (controlledValue === null) {
        const container = htmlEl.closest('[role="dialog"], [role="application"], .oxd-date-picker, .oxd-form-row, .modal-body') || document;
        const inputs = container.querySelectorAll('input[type="text"], input:not([type])');
        for (const inp of inputs) {
          if (inp instanceof HTMLInputElement && inp.value && inp.value.length > 0) {
            // Heuristic: date values often contain digits and separators
            if (/^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/.test(inp.value) || /\d{4}/.test(inp.value)) {
              controlledValue = inp.value;
              break;
            }
          }
        }
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
