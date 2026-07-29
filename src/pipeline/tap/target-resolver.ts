/**
 * Target Resolver — Phase 3
 *
 * Resolves the correct target element from a DOM event using a proven
 * 3-strategy cascade that pierces Shadow DOM boundaries.
 *
 * Provenance: Adapted from working-better/src/tap/identity-extractor.ts
 * (resolveTarget function, lines 470-503) and the integration branch's
 * deterministic-recorder.ts resolveTarget().
 *
 * The algorithm NEVER drops an interaction — if no interactive element
 * is found in the path, it returns the raw target (unless it's structural).
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

/** Elements that should NEVER be captured as click targets. */
const NON_INTERACTIVE_TAGS = new Set([
  'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META',
  'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'G', 'DEFS', 'RECT',
  'CIRCLE', 'LINE', 'POLYLINE', 'POLYGON', 'USE', 'CLIPPATH',
]);

/** CSS selector matching all interactive elements. */
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'summary', 'select', 'option', 'textarea', 'input',
  'form', '[contenteditable]',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
  '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="option"]',
  '[role="switch"]', '[role="treeitem"]', '[role="checkbox"]', '[role="radio"]',
  '[role="gridcell"]', '[role="combobox"]', '[role="textbox"]', '[role="spinbutton"]',
  '[role="slider"]', '[role="group"]', '[role="radiogroup"]',
  '[tabindex]', '[onclick]', '[data-action]', '[data-toggle]', '[data-bs-toggle]',
  '[aria-haspopup]',
].join(', ');

/**
 * Check if an element matches the interactive selector.
 */
function isInteractive(el: Element): boolean {
  try {
    return el.matches(INTERACTIVE_SELECTOR);
  } catch {
    return false;
  }
}

/**
 * Check if an element is non-interactive (structural).
 */
function isNonInteractive(el: Element): boolean {
  return NON_INTERACTIVE_TAGS.has(el.tagName);
}

/**
 * Check if an element is clickable via heuristic (cursor:pointer or onclick).
 */
function isClickableHeuristic(el: Element): boolean {
  try {
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer') return true;
  } catch { /* getComputedStyle may fail */ }
  if (el.hasAttribute('onclick')) return true;
  return false;
}

/**
 * Resolve the target element from a DOM event.
 *
 * Uses composedPath() to pierce Shadow DOM boundaries.
 * NEVER drops an interaction — if no interactive element is found,
 * returns the raw target (unless it's structural).
 *
 * Strategy:
 *   1. composedPath → find first element matching INTERACTIVE_SELECTOR
 *   2. Walk parents from raw target for interactive elements
 *   3. composedPath → find clickable heuristic (cursor:pointer, onclick)
 *   4. If nothing, return raw target (if not structural)
 *
 * @param event The DOM event (may be null)
 * @returns The resolved target element, or null if event is null/invalid
 */
export function resolveTarget(event: Event | null | undefined): Element | null {
  if (!event) return null;

  // composedPath() pierces Shadow DOM; fall back to event.target for
  // environments where composedPath returns empty (e.g. JSDOM).
  const path = event.composedPath();
  const rawTarget = event.target instanceof Element ? event.target : null;
  const target = (path[0] instanceof Element) ? path[0] : rawTarget;
  if (!target) return null;

  // Strategy 1: Find first interactive element in the composed path
  // (prepend the raw target to the path so we never miss it)
  const fullPath = (path[0] === target) ? path : [target, ...path];
  for (const el of fullPath) {
    if (!(el instanceof Element)) continue;
    if (isNonInteractive(el)) continue;
    if (isInteractive(el)) return el;
  }

  // Strategy 1b: Walk parents from raw target
  let current: Element | null = target;
  while (current && !isNonInteractive(current)) {
    if (isInteractive(current)) return current;
    current = current.parentElement;
  }

  // Strategy 2: Clickable heuristic (cursor:pointer or onclick)
  for (const el of fullPath) {
    if (!(el instanceof Element)) continue;
    if (isNonInteractive(el)) continue;
    if (isClickableHeuristic(el)) return el;
  }

  // Strategy 3: Raw target (if not structural)
  if (!isNonInteractive(target)) return target;

  return null;
}

/**
 * Export the NON_INTERACTIVE_TAGS set for testing.
 */
export { NON_INTERACTIVE_TAGS, INTERACTIVE_SELECTOR };
