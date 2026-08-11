/**
 * Target State Listeners — Capture-Phase Pre-Population (M2)
 *
 * Two capture-phase event listeners (mousedown, focus) that fire BEFORE
 * the browser applies state changes from the interaction. They call
 * TargetStateCache.capture(el) to store a "before" snapshot.
 *
 * Why capture phase?
 *   DOM events flow in three phases: capture → target → bubble.
 *   Capture-phase listeners fire BEFORE any target/bubble handlers,
 *   which means they run before any onclick/onfocus handler that might
 *   change element state (toggle aria-expanded, set disabled, etc.).
 *   This gives us the true pre-interaction state.
 *
 *   mousedown: fires before click. The mousedown → mouseup → click
 *     sequence means state changes from the click handler haven't
 *     happened yet during mousedown's capture phase.
 *
 *   focus: fires when an element receives focus. Capture-phase focus
 *     fires before focus handlers that might validate, format, or
 *     clear the input value.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §3.3, §4.2 step 2
 */

import { TargetStateCache } from './target-state-cache';

/**
 * Handle for the target state listeners. Call stop() to remove.
 */
export interface TargetStateListenersHandle {
  stop(): void;
}

/**
 * Install capture-phase listeners that pre-populate the TargetStateCache.
 *
 * @param cache The TargetStateCache instance to write to.
 * @returns A handle to remove the listeners.
 */
export function installTargetStateListeners(cache: TargetStateCache): TargetStateListenersHandle {
  /**
   * mousedown capture-phase handler.
   * Fires before click handlers, capturing element state before the
   * interaction changes it.
   */
  const onMouseDown = (e: Event): void => {
    const target = e.target;
    if (!target || !(target instanceof Element)) return;
    cache.capture(target);
  };

  /**
   * focus capture-phase handler.
   * Fires before focus handlers, capturing element state before focus
   * handlers might change it (e.g., clearing placeholder text, formatting).
   */
  const onFocus = (e: Event): void => {
    const target = e.target;
    if (!target || !(target instanceof Element)) return;
    cache.capture(target);
  };

  // Register with capture: true so we run BEFORE target/bubble phase handlers
  document.addEventListener('mousedown', onMouseDown, { capture: true, passive: true });
  document.addEventListener('focus', onFocus, { capture: true, passive: true });

  return {
    stop(): void {
      document.removeEventListener('mousedown', onMouseDown, { capture: true });
      document.removeEventListener('focus', onFocus, { capture: true });
    },
  };
}
