/**
 * Element State Cache — Before-State Preservation for DOM Properties
 *
 * A WeakMap-backed cache of element states. Populated silently by
 * capture-phase mousedown and focus listeners (via state-cache-listeners.ts)
 * and by observation window open/close (Phase C).
 *
 * COMPLEMENTARY TWO-SOURCE STRATEGY:
 * This cache captures DOM PROPERTIES (.value, .checked) that MutationObserver
 * cannot see. It is essential for native controls where mousedown target
 * == state holder. For custom components where the clicked element is NOT
 * the state holder, this snapshot may honestly show no meaningful state —
 * the meaningful before-state comes from Phase B's MutationObserver oldValue.
 *
 * The DOM event ordering guarantee: at capture phase of mousedown and
 * focus, no default action has run, no activation behavior has toggled
 * anything, and no derived event has fired. The element's state is
 * exactly as it was before the user's input reached the DOM.
 *
 * IMMUTABILITY: Each capture() call creates a brand-new ElementStateSnapshot
 * object and stores it in the WeakMap. The previously stored snapshot is
 * never mutated — it remains a valid frozen record of state at that point
 * in time. Observation windows hold references to these objects; later
 * captures cannot modify them.
 *
 * Architecture: `.drytis/specs/m1-complete-design.md` §4.1
 */

import type { ElementStateSnapshot } from '../shared/observation-types';

export class ElementStateCache {
  /**
   * The cache. WeakMap so removed elements are GC'd automatically.
   * Persists for the entire recording session.
   */
  private map = new WeakMap<Element, ElementStateSnapshot>();

  /**
   * Read the element's current state and store it in the cache.
   * Returns the snapshot. O(1) — reads 9 properties, no traversal.
   *
   * Each call creates a NEW snapshot object. The previous snapshot stored
   * for this element (if any) is NOT modified — it remains a valid record
   * of state at the time it was captured.
   *
   * Called by:
   * - state-cache-listeners.ts on mousedown capture
   * - state-cache-listeners.ts on focus capture
   * - ObservationCoordinator on window open (Phase C)
   * - ObservationCoordinator on window close (Phase C)
   */
  capture(el: Element): ElementStateSnapshot {
    const snap = this.readState(el);
    this.map.set(el, snap);
    return snap;
  }

  /**
   * Return the cached state WITHOUT reading or modifying the element.
   * Returns null if the element has never been cached (first interaction).
   *
   * Called by ObservationCoordinator on window open (Phase C) to get
   * the before-state. This is the critical call that solves Case 4.
   *
   * Returns the stored snapshot object directly. Because capture() always
   * creates a new object (never mutating the previous), the returned
   * reference is immutable by construction.
   */
  peek(el: Element): ElementStateSnapshot | null {
    return this.map.get(el) ?? null;
  }

  /**
   * Read the element's current state WITHOUT updating the cache.
   * Returns a fresh snapshot. O(1) — same as capture() but non-mutating.
   *
   * Called by ObservationCoordinator on window close (Phase C) to capture
   * the final state. Using read() instead of capture() prevents the close-time
   * snapshot from overwriting a before-state that was cached by a newer
   * mousedown/focus event for an overlapping interaction.
   *
   * Architecture: .drytis/specs/m1-phase-c-detailed-design.md §Decision 2
   */
  read(el: Element): ElementStateSnapshot {
    return this.readState(el);
  }

  /**
   * Clear the cache. Called on stopRecording only.
   * WeakMap has no clear() method — reassign the reference.
   */
  clear(): void {
    this.map = new WeakMap<Element, ElementStateSnapshot>();
  }

  // ── Internal ────────────────────────────────────────────────────────

  /**
   * Read 9 observable properties from an element. No traversal.
   * Safe for any element type — uses instanceof checks.
   */
  private readState(el: Element): ElementStateSnapshot {
    const isInput = el instanceof HTMLInputElement;
    const isSelect = el instanceof HTMLSelectElement;
    const htmlEl = el as HTMLElement;

    return {
      value: this.readValue(isInput, isSelect, el),
      checked: this.readChecked(isInput, el),
      className: el.getAttribute('class') ?? '',
      disabled: htmlEl.hasAttribute('disabled') ||
                el.getAttribute('aria-disabled') === 'true',
      ariaExpanded: this.readBooleanAttr(el, 'aria-expanded'),
      ariaChecked: this.readBooleanAttr(el, 'aria-checked'),
      ariaPressed: this.readBooleanAttr(el, 'aria-pressed'),
      textContent: this.readTruncatedText(el),
      childCount: el.children.length,
      capturedAt: Date.now(),
    };
  }

  private readValue(isInput: boolean, isSelect: boolean, el: Element): string | null {
    if (isInput) return (el as HTMLInputElement).value ?? null;
    if (isSelect) return (el as HTMLSelectElement).value ?? null;
    return null;
  }

  /**
   * Read checked state. Priority: native checked > aria-checked > aria-pressed.
   * Returns null if none applicable.
   */
  private readChecked(isInput: boolean, el: Element): boolean | null {
    if (isInput) {
      const input = el as HTMLInputElement;
      if (input.type === 'checkbox' || input.type === 'radio') {
        return input.checked;
      }
    }
    const ariaChecked = this.readBooleanAttr(el, 'aria-checked');
    if (ariaChecked !== null) return ariaChecked;
    return this.readBooleanAttr(el, 'aria-pressed');
  }

  /**
   * Read an ARIA boolean attribute. Returns true, false, or null (absent).
   */
  private readBooleanAttr(el: Element, name: string): boolean | null {
    const val = el.getAttribute(name);
    if (val === null) return null;
    return val === 'true';
  }

  private readTruncatedText(el: Element): string | null {
    const text = el.textContent ?? '';
    return text.length > 0 ? text.substring(0, 200) : null;
  }
}
