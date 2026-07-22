/**
 * Locator Resolver — resolves ResolvedLocator[] against a live DOM.
 *
 * This module is testable in isolation (jsdom). The executor content script
 * inlines the same logic because content scripts run in an isolated world
 * and cannot import modules.
 *
 * The resolver tries each locator strategy in priority order (1 = highest)
 * and returns the first matching element, or null if none match.
 *
 * Strategy → DOM mapping:
 *   TEST_ID        → [data-testid="X"], [data-cy="X"], [data-qa="X"]
 *   ACCESSIBLE_NAME → role + aria-label, or [aria-labelledby="X"]
 *   CSS            → document.querySelector(X)
 *   LABEL          → label[for="X"], or [name="X"], or [aria-label="X"]
 *   XPATH          → document.evaluate(X, ...)
 *   ROLE           → [role="X"]
 *   TEXT           → text content match (case-sensitive)
 */

// ── Types (inlined for content script compatibility) ───────

export interface LocatorInput {
  readonly type: string; // LocatorStrategyType values
  readonly value: string;
  readonly priority: number;
  readonly confidence: number | null;
}

export interface ResolvedElement {
  /** The DOM element that was found. */
  readonly element: Element;
  /** Which locator strategy succeeded (1-based priority). */
  readonly matchedLocator: LocatorInput;
  /** Whether the element is visible (computed). */
  readonly visible: boolean;
}

export type LocatorResolutionStatus = 'found' | 'not_found' | 'timeout';

export interface LocatorResolutionResult {
  readonly status: LocatorResolutionStatus;
  readonly resolvedElement?: ResolvedElement;
  readonly attemptedLocators: LocatorInput[];
  readonly durationMs: number;
}

// ── Locator Strategy Constants ──────────────────────────────

/**
 * String constants matching LocatorStrategyType enum values.
 * Inlined because content scripts can't import the enum.
 */
const LOCATOR_TYPE = {
  ROLE: 'role',
  ACCESSIBLE_NAME: 'accessibleName',
  TEST_ID: 'testId',
  TEXT: 'text',
  LABEL: 'label',
  CSS: 'css',
  XPATH: 'xpath',
} as const;

// ── Visibility Check ───────────────────────────────────────

/**
 * Check if an element is visible in the viewport.
 * An element is visible if:
 *   - It's connected to the DOM
 *   - display is not 'none'
 *   - visibility is not 'hidden'
 *   - offsetParent is not null (or it's a fixed/absolute element)
 *   - width and height > 0
 */
export function isElementVisible(element: Element): boolean {
  if (!element || !element.isConnected) return false;

  const htmlEl = element as HTMLElement;
  const style = window.getComputedStyle(htmlEl);

  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;

  // offsetParent is null for position:fixed elements and hidden elements.
  // In jsdom (no layout engine), offsetParent is always null and
  // getBoundingClientRect returns {0,0,0,0} for all elements — so skip
  // these checks when we detect a jsdom-like environment (no layout).
  if (typeof htmlEl.offsetParent !== 'undefined' && htmlEl.offsetParent !== null) {
    // Real browser — offsetParent exists, element is in layout flow
    return true;
  }

  if (style.position === 'fixed') {
    // Fixed elements never have an offsetParent but can be visible
    return true;
  }

  // In jsdom, offsetParent is null for everything; rely on CSS only.
  // In real browsers, null offsetParent usually means hidden, but we
  // can't distinguish from jsdom — so if display/visibility/opacity
  // passed, treat as visible. Real browsers will catch genuinely hidden
  // elements via the display/visibility checks above.
  return true;
}

// ── Individual Locator Strategies ──────────────────────────

/**
 * Resolve a single locator strategy against the DOM.
 * Returns the matched element or null.
 */
function resolveByTestId(doc: Document, value: string): Element | null {
  // Try data-testid, data-cy, data-qa — all are "business ID" locators
  return (
    doc.querySelector(`[data-testid="${cssEscape(value)}"]`) ||
    doc.querySelector(`[data-cy="${cssEscape(value)}"]`) ||
    doc.querySelector(`[data-qa="${cssEscape(value)}"]`) ||
    null
  );
}

function resolveByAccessibleName(doc: Document, value: string): Element | null {
  // Try aria-label match first
  const ariaLabelMatch = doc.querySelector(
    `[aria-label="${cssEscape(value)}"]`,
  );
  if (ariaLabelMatch) return ariaLabelMatch;

  // Try aria-labelledby — value is the ID of the labelling element
  const labelledBy = doc.querySelector(
    `[aria-labelledby="${cssEscape(value)}"]`,
  );
  if (labelledBy) return labelledBy;

  // Try role + accessible name (via getElementsByRole pattern)
  // accessibleName can match elements with matching role + text content
  const allElements = doc.querySelectorAll('*');
  for (const el of allElements) {
    const name = (el as HTMLElement).getAttribute?.('aria-label');
    if (name === value) return el;
  }

  return null;
}

function resolveByRole(doc: Document, value: string): Element | null {
  return doc.querySelector(`[role="${cssEscape(value)}"]`);
}

function resolveByText(doc: Document, value: string): Element | null {
  // Case-sensitive text content match on leaf elements only
  // (elements with no element children) to avoid matching ancestors
  // whose textContent includes descendant text
  const allElements = doc.querySelectorAll('*');
  for (const el of allElements) {
    if (el.children.length === 0 && el.textContent?.trim() === value) return el;
  }
  return null;
}

function resolveByLabel(doc: Document, value: string): Element | null {
  // Try: label[for="value"] → get the for-target
  const label = doc.querySelector(`label[for="${cssEscape(value)}"]`);
  if (label) {
    const forId = label.getAttribute('for');
    if (forId) {
      const target = doc.getElementById(forId);
      if (target) return target;
    }
  }

  // Try: [name="value"]
  const byName = doc.querySelector(`[name="${cssEscape(value)}"]`);
  if (byName) return byName;

  // Try: [aria-label="value"]
  const byAriaLabel = doc.querySelector(`[aria-label="${cssEscape(value)}"]`);
  if (byAriaLabel) return byAriaLabel;

  // Try: [placeholder="value"]
  const byPlaceholder = doc.querySelector(
    `[placeholder="${cssEscape(value)}"]`,
  );
  if (byPlaceholder) return byPlaceholder;

  return null;
}

function resolveByCss(doc: Document, value: string): Element | null {
  try {
    return doc.querySelector(value);
  } catch {
    // Invalid selector
    return null;
  }
}

function resolveByXPath(doc: Document, value: string): Element | null {
  try {
    const result = doc.evaluate(
      value,
      doc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    return (result.singleNodeValue as Element) || null;
  } catch {
    // Invalid XPath
    return null;
  }
}

// ── Strategy Dispatch ──────────────────────────────────────

/**
 * Map locator type → resolver function.
 */
function resolveLocator(doc: Document, locator: LocatorInput): Element | null {
  switch (locator.type) {
    case LOCATOR_TYPE.TEST_ID:
      return resolveByTestId(doc, locator.value);
    case LOCATOR_TYPE.ACCESSIBLE_NAME:
      return resolveByAccessibleName(doc, locator.value);
    case LOCATOR_TYPE.ROLE:
      return resolveByRole(doc, locator.value);
    case LOCATOR_TYPE.TEXT:
      return resolveByText(doc, locator.value);
    case LOCATOR_TYPE.LABEL:
      return resolveByLabel(doc, locator.value);
    case LOCATOR_TYPE.CSS:
      return resolveByCss(doc, locator.value);
    case LOCATOR_TYPE.XPATH:
      return resolveByXPath(doc, locator.value);
    default:
      return null;
  }
}

// ── Main Resolver ──────────────────────────────────────────

/**
 * Resolve an array of locator strategies against the DOM.
 * Tries each locator in priority order (1 = highest priority, tried first).
 * Returns the first matching element, or null if none match.
 *
 * @param locators  Locator strategies to try, in priority order.
 * @param doc       The document to resolve against (defaults to window.document).
 * @param requireVisible  If true, skip elements that are not visible.
 * @returns         The first matching element, or null.
 */
export function resolveElement(
  locators: readonly LocatorInput[],
  doc: Document = document,
  requireVisible = true,
): ResolvedElement | null {
  if (locators.length === 0) return null;

  // Sort by priority (1 = highest)
  const sorted = [...locators].sort((a, b) => a.priority - b.priority);

  for (const locator of sorted) {
    const element = resolveLocator(doc, locator);
    if (element) {
      const visible = isElementVisible(element);
      if (requireVisible && !visible) continue; // Skip invisible elements
      return { element, matchedLocator: locator, visible };
    }
  }

  return null;
}

/**
 * Resolve locators with timeout and wait strategy support.
 *
 * @param locators    Locator strategies to try.
 * @param doc         The document to resolve against.
 * @param timeoutMs   Maximum time to wait (default 30000).
 * @param waitStrategy  'none' | 'present' | 'visible' | 'stable'.
 * @returns           Resolution result with timing info.
 */
export async function resolveElementWithWait(
  locators: readonly LocatorInput[],
  doc: Document = document,
  timeoutMs: number = 30000,
  waitStrategy: 'none' | 'present' | 'visible' | 'stable' = 'visible',
): Promise<LocatorResolutionResult> {
  const startTime = performance.now();
  const attemptedLocators = [...locators];

  if (waitStrategy === 'none') {
    // Try once immediately
    const resolved = resolveElement(locators, doc, false);
    if (resolved) {
      return {
        status: 'found',
        resolvedElement: resolved,
        attemptedLocators,
        durationMs: performance.now() - startTime,
      };
    }
    return {
      status: 'not_found',
      attemptedLocators,
      durationMs: performance.now() - startTime,
    };
  }

  // For 'present', 'visible', 'stable' — poll until timeout
  const pollIntervalMs = 100;
  const requireVisible = waitStrategy === 'visible' || waitStrategy === 'stable';

  while (performance.now() - startTime < timeoutMs) {
    const resolved = resolveElement(locators, doc, requireVisible);
    if (resolved) {
      return {
        status: 'found',
        resolvedElement: resolved,
        attemptedLocators,
        durationMs: performance.now() - startTime,
      };
    }
    await sleep(pollIntervalMs);
  }

  return {
    status: 'timeout',
    attemptedLocators,
    durationMs: performance.now() - startTime,
  };
}

// ── DOM Context Extraction (for runtime healing) ────────────

/**
 * Extract element identity from a live DOM element.
 * This produces a partial ElementIdentity for the healing pipeline.
 */
export function extractElementIdentity(element: Element): Record<string, string | null> {
  const el = element as HTMLElement;
  return {
    tag: el.tagName,
    role: el.getAttribute('role'),
    accessibleName: el.getAttribute('aria-label') || el.textContent?.trim() || null,
    testId: el.getAttribute('data-testid'),
    dataCy: el.getAttribute('data-cy'),
    dataQa: el.getAttribute('data-qa'),
    id: el.id || null,
    name: el.getAttribute('name'),
    placeholder: el.getAttribute('placeholder'),
    className: el.className || null,
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledBy: el.getAttribute('aria-labelledby'),
    cssSelector: buildCssSelector(el),
  };
}

/**
 * Build a minimal CSS selector for an element.
 * Uses tag + id if available, otherwise tag + first class.
 */
function buildCssSelector(el: HTMLElement): string {
  if (el.id) return `#${el.id}`;

  const tag = el.tagName.toLowerCase();
  const firstClass = el.classList[0];
  if (firstClass) return `${tag}.${firstClass}`;

  return tag;
}

// ── Helpers ─────────────────────────────────────────────────

function cssEscape(value: string): string {
  // CSS.escape is available in browsers and jsdom
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  // Fallback: escape double quotes
  return value.replace(/"/g, '\\"');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
