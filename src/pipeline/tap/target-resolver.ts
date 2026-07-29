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
 * Compute a best-effort accessible name for an element.
 * Used by Strategy 2 to prefer clickable ancestors with meaningful labels
 * over empty-name icon wrappers.
 */
function getAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const title = el.getAttribute('title');
  if (title) return title.trim();
  const text = el.textContent?.trim() ?? '';
  // Only use text content if it's reasonably short (not a container with
  // concatenated child text)
  if (text && text.length <= 80) return text;
  return '';
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
  // Prefers clickable ancestors with meaningful accessible names over
  // inner icon wrappers with empty names. Prevents resolving to an
  // icon container (cursor:pointer, no label) instead of the parent
  // trigger (cursor:pointer, has label like "Passengers and class").
  let clickCandidate: Element | null = null;
  for (const el of fullPath) {
    if (!(el instanceof Element)) continue;
    if (isNonInteractive(el)) continue;
    if (isClickableHeuristic(el)) {
      clickCandidate = el;
      const name = getAccessibleName(el);
      if (name && name.trim().length > 2) return el;
      // No meaningful name — keep walking to find a clickable ancestor with one
      break;
    }
  }
  // Walk parents to find a better clickable candidate
  if (clickCandidate) {
    let bestCandidate = clickCandidate;
    let parent: Element | null = clickCandidate.parentElement;
    for (let depth = 0; depth < 3 && parent; depth++) {
      if (isNonInteractive(parent)) break;
      if (isClickableHeuristic(parent)) {
        const parentName = getAccessibleName(parent);
        const bestName = getAccessibleName(bestCandidate);
        if (parentName && parentName.trim().length > 2) {
          if (!bestName || bestName.trim().length <= 2) {
            bestCandidate = parent;
          }
        }
      }
      parent = parent.parentElement;
    }
    return bestCandidate;
  }

  // Strategy 3: Raw target (if not structural)
  if (!isNonInteractive(target)) return target;

  return null;
}

/**
 * Export the NON_INTERACTIVE_TAGS set for testing.
 */
export { NON_INTERACTIVE_TAGS, INTERACTIVE_SELECTOR };
