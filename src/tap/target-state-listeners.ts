/**
 * Target State Listeners — Capture-Phase Pre-Population (M2)
 *
 * Capture-phase event listeners that fire BEFORE the browser applies state
 * changes from the interaction. They call TargetStateCache.capture(el) to
 * store a "before" snapshot.
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
 *   keydown: GAP-2 fix. Fires on every keydown at capture phase.
 *     This ensures a before-snapshot exists even when the user Tabs
 *     to a field (no mousedown) and starts typing immediately.
 *     Without this, the typing window's before-snapshot would be null
 *     because no prior mousedown/focus had captured the element's state.
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
   * Resolve the actual target element, piercing shadow DOM via composedPath.
   * Uses e.target as fallback.
   */
  function resolveEl(e: Event): Element | null {
    // Prefer composedPath for shadow DOM piercing (same logic as EventTap)
    const path = e.composedPath();
    for (const node of path) {
      if (node instanceof Element) return node;
    }
    const t = e.target;
    return (t instanceof Element) ? t : null;
  }

  /**
   * mousedown capture-phase handler.
   * Fires before click handlers, capturing element state before the
   * interaction changes it.
   */
  const onMouseDown = (e: Event): void => {
    const target = resolveEl(e);
    if (!target) return;
    cache.capture(target);
  };

  /**
   * focus capture-phase handler.
   * Fires before focus handlers, capturing element state before focus
   * handlers might change it (e.g., clearing placeholder text, formatting).
   */
  const onFocus = (e: Event): void => {
    const target = resolveEl(e);
    if (!target) return;
    cache.capture(target);
  };

  /**
   * keydown capture-phase handler (GAP-2 fix).
   * Fires on every keydown at capture phase. This ensures a before-snapshot
   * exists for typing sessions even when:
   *   - User Tabs to a field (no mousedown fires)
   *   - Focus was already on the element from a previous interaction
   *   - React controlled inputs delay focus events
   *
   * The snapshot captures the element's value BEFORE this keystroke modifies it,
   * which gives us the correct "before" state for the typing evidence window.
   */
  const onKeyDown = (e: Event): void => {
    const target = resolveEl(e);
    if (!target) return;
    cache.capture(target);
  };

  // Register with capture: true so we run BEFORE target/bubble phase handlers
  document.addEventListener('mousedown', onMouseDown, { capture: true, passive: true });
  document.addEventListener('focus', onFocus, { capture: true, passive: true });
  document.addEventListener('keydown', onKeyDown, { capture: true, passive: true });

  return {
    stop(): void {
      document.removeEventListener('mousedown', onMouseDown, { capture: true });
      document.removeEventListener('focus', onFocus, { capture: true });
      document.removeEventListener('keydown', onKeyDown, { capture: true });
    },
  };
}
