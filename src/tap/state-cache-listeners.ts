/**
 * State Cache Listeners — Before-State Pre-Population
 *
 * Two capture-phase event listeners that silently populate the
 * ElementStateCache BEFORE the browser changes element state.
 *
 * COMPLEMENTARY ROLE:
 * These listeners capture DOM PROPERTIES (.value, .checked) at the earliest
 * possible moment — mousedown/focus capture phase. This covers native controls
 * where the interacted element IS the state holder. For custom components
 * where the state holder is elsewhere in the DOM, Phase B's MutationObserver
 * independently captures attribute-level before/after transitions.
 *
 * DOM Event Ordering Guarantee:
 *   1. Capture phase (document → target)    ← OUR LISTENERS RUN HERE
 *   2. Target phase
 *   3. Bubble phase (target → document)     ← application JS runs here
 *   4. Default actions / activation behavior ← browser changes STATE here
 *   5. Derived events (input, change)       ← fire AFTER state changed
 *
 * At capture phase of mousedown and focus, no default action has run,
 * no activation behavior has toggled anything. The element's state is
 * exactly as it was before the user's input reached the DOM.
 *
 * Architecture: `.drytis/specs/m1-complete-design.md` §4.1
 */

import type { ElementStateCache } from './element-state-cache';

/**
 * Register capture-phase listeners that populate the state cache.
 *
 * Call on recording start. The returned cleanup function removes
 * the listeners — call on recording stop.
 *
 * @param cache The ElementStateCache to populate
 * @returns cleanup function that removes the listeners
 */
export function setupStateCacheListeners(
  cache: ElementStateCache,
): () => void {
  const onMouseDown = (event: Event): void => {
    const el = event.target;
    if (el instanceof HTMLElement) {
      cache.capture(el);
    }
  };

  const onFocus = (event: Event): void => {
    // Focus events can fire on document or window in edge cases.
    // Only capture for actual elements.
    const el = event.target;
    if (el instanceof HTMLElement) {
      cache.capture(el);
    }
  };

  // Capture phase: runs BEFORE bubble-phase application handlers and
  // BEFORE default actions that change element state.
  // passive: true — we don't call preventDefault(), so the browser
  // can optimize dispatch.
  document.addEventListener('mousedown', onMouseDown, {
    capture: true,
    passive: true,
  });
  document.addEventListener('focus', onFocus, {
    capture: true,
    passive: true,
  });

  // Return cleanup
  return () => {
    document.removeEventListener('mousedown', onMouseDown, {
      capture: true,
    } as EventListenerOptions);
    document.removeEventListener('focus', onFocus, {
      capture: true,
    } as EventListenerOptions);
  };
}
