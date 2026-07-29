/**
 * Value Tracker — Phase 3
 *
 * Provides per-event valueBefore/After and checkedBefore/After snapshots.
 *
 * Design: Unlike the integration branch's session-wide valueTracker Map
 * (which can lose state on navigation), this tracker uses a lightweight
 * per-element snapshot that is captured at event time and discarded.
 *
 * For focus/click/mousedown events, the "before" value is captured BEFORE
 * the browser updates the element state. For input/change/blur events,
 * the "after" value is captured AFTER the browser updates state.
 *
 * Provenance: Adopted from working-better/src/tap/event-tap.ts
 * assembleObservedEvent() per-event valueBefore/After logic.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import { captureValue, captureCheckedState } from './identity-extractor';

/**
 * Value snapshot pair for a single event.
 */
export interface ValueSnapshot {
  valueBefore: string | null;
  valueAfter: string | null;
  checkedBefore: boolean | null;
  checkedAfter: boolean | null;
}

/**
 * Capture a value snapshot for a given event type and element.
 *
 * This implements the per-event valueBefore/After pattern from working-better:
 * - focus/click/mousedown: capture BEFORE state (browser hasn't updated yet)
 * - input/change: capture AFTER state (browser already updated)
 * - blur: capture AFTER state (final value, handles autofill/paste/React controlled)
 *
 * @param el The target element
 * @param eventType The DOM event type
 * @returns ValueSnapshot with before/after values as applicable
 */
export function captureValueSnapshot(el: Element, eventType: string): ValueSnapshot {
  const snapshot: ValueSnapshot = {
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
  };

  // Before-state events: capture current value BEFORE browser changes it
  if (eventType === 'focus' || eventType === 'click' || eventType === 'mousedown') {
    const value = captureValue(el);
    if (value !== undefined) {
      snapshot.valueBefore = value;
    }
    const checked = captureCheckedState(el);
    if (checked !== undefined) {
      snapshot.checkedBefore = checked;
    }
  }

  // Click events on toggle elements: infer the after-state.
  // A click on a checkbox toggles its checked state, a click on a radio
  // button sets it to true, and a click on a toggle button (aria-pressed)
  // toggles pressed.  This lets us capture the full transition from the
  // capture-phase listener (which fires BEFORE the browser applies the change).
  if (eventType === 'click') {
    const checked = captureCheckedState(el);
    if (checked !== undefined) {
      // Infer after-state: checkbox/aria-pressed toggle, radio becomes true
      const isRadio =
        (el instanceof HTMLInputElement && el.type === 'radio') ||
        el.getAttribute('role') === 'radio';
      snapshot.checkedAfter = isRadio ? true : !checked;
    }
  }

  // After-state events: capture current value AFTER browser has changed it
  if (eventType === 'input' || eventType === 'change' || eventType === 'blur') {
    const value = captureValue(el);
    if (value !== undefined) {
      snapshot.valueAfter = value;
    }
    const checked = captureCheckedState(el);
    if (checked !== undefined) {
      snapshot.checkedAfter = checked;
    }
  }

  return snapshot;
}
