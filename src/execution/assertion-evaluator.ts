/**
 * Assertion Evaluator — evaluates IRAssertion[] against live DOM state.
 *
 * This module is testable in isolation (jsdom). The executor content script
 * inlines the same logic.
 *
 * Each IRAssertion specifies:
 *   - type:        What to check (presence, visibility, textMatch, etc.)
 *   - comparison:  How to compare (equals, contains, matches, etc.)
 *   - expectedValue: The expected value
 *   - severity:    Whether failure stops the test (hard) or records (soft)
 *   - target:      Which element or URL to check
 *   - property:    Which element property to extract (text, value, etc.)
 *
 * The evaluator:
 *   1. Extracts the actual value from the DOM element (based on property)
 *   2. Compares actual vs expected using the comparison operator
 *   3. Returns IRAssertionResult[] with pass/fail, actual/expected values
 */

// ── Types (inlined for content script compatibility) ───────

export type AssertionTarget =
  | { kind: 'element'; element: Element | null; allMatches?: readonly Element[] }
  | { kind: 'url'; url: string }
  | { kind: 'none' };

export interface AssertionInput {
  /** What to check — matches ValidationType enum values. */
  readonly type: string;
  /** How to compare — matches ValidationComparison enum values. */
  readonly comparison: string;
  /** The expected value. */
  readonly expectedValue: unknown;
  /** Property to extract from the element (text, value, visible, count, etc.). */
  readonly property: string | null;
  /** Which element/URL to check. */
  readonly target: AssertionTarget;
}

export interface AssertionResult {
  /** Mirrors ValidationType. */
  readonly type: string;
  readonly passed: boolean;
  readonly actualValue?: unknown;
  readonly expectedValue?: unknown;
  readonly message: string;
}

// ── Property Extraction ─────────────────────────────────────

/**
 * Extract a property value from a DOM element.
 *
 * Supported properties:
 *   text     → element.textContent?.trim()
 *   value    → (element as HTMLInputElement).value
 *   visible  → computed visibility (display, visibility, opacity)
 *   enabled  → !(element as HTMLElement).disabled
 *   checked  → (element as HTMLInputElement).checked
 *   href     → element.getAttribute('href')
 *   count    → number of matching elements (caller must provide count)
 *   <custom> → element.getAttribute(property)
 */
export function extractPropertyValue(
  element: Element | null,
  property: string | null,
  url?: string,
): unknown {
  if (property === 'url') {
    return url ?? window.location.href;
  }

  if (!element) return null;

  const el = element as HTMLElement;

  switch (property) {
    case 'text':
    case 'textContent':
      return el.textContent?.trim() ?? '';

    case 'value':
      return (el as HTMLInputElement).value ?? '';

    case 'visible':
    case 'visibility':
      return isElementVisible(el);

    case 'enabled':
    case 'disabled':
      return !el.hasAttribute('disabled') && !(el as HTMLInputElement).disabled;

    case 'checked':
    case 'selected':
      return (el as HTMLInputElement).checked ?? false;

    case 'href':
      return el.getAttribute('href') ?? '';

    case 'count':
      // Count is handled separately — caller must provide the actual count
      return null;

    case 'class':
    case 'className':
      return el.className ?? '';

    case 'tag':
    case 'tagName':
      return el.tagName.toLowerCase();

    case 'id':
      return el.id ?? '';

    default:
      // Treat property as an attribute name
      if (property) {
        return el.getAttribute(property);
      }
      // No property specified — use textContent as default
      return el.textContent?.trim() ?? '';
  }
}

// ── Comparison Operators ────────────────────────────────────

/**
 * Compare actual vs expected using the specified comparison operator.
 *
 * Supported comparisons (matching ValidationComparison enum):
 *   EQUALS        → strict equality (case-sensitive for strings)
 *   CONTAINS      → actual includes expected (substring or array element)
 *   MATCHES       → actual matches expected regex pattern
 *   STARTS_WITH   → actual starts with expected
 *   GREATER_THAN  → Number(actual) > Number(expected)
 *   LESS_THAN     → Number(actual) < Number(expected)
 *   IS_TRUE       → actual is truthy / boolean true
 *   IS_FALSE      → actual is falsy / boolean false
 */
export function compareValues(
  actual: unknown,
  expected: unknown,
  comparison: string,
): boolean {
  switch (comparison) {
    case 'equals':
      return String(actual) === String(expected);

    case 'contains':
      if (typeof actual === 'string') {
        return actual.includes(String(expected));
      }
      if (Array.isArray(actual)) {
        return actual.includes(expected);
      }
      return false;

    case 'matches': {
      // Expected is a regex pattern string
      try {
        const regex = new RegExp(String(expected));
        return regex.test(String(actual));
      } catch {
        return false;
      }
    }

    case 'startsWith':
      return String(actual).startsWith(String(expected));

    case 'greaterThan':
      return Number(actual) > Number(expected);

    case 'lessThan':
      return Number(actual) < Number(expected);

    case 'isTrue':
      return actual === true || actual === 'true' || actual === 1 || actual === '1';

    case 'isFalse':
      return actual === false || actual === 'false' || actual === 0 || actual === '0' || actual === null || actual === '';

    default:
      // Default to equals comparison
      return String(actual) === String(expected);
  }
}

// ── Element Visibility (mirrors locator-resolver for content script) ──

function isElementVisible(element: Element): boolean {
  if (!element || !element.isConnected) return false;

  const htmlEl = element as HTMLElement;
  const style = window.getComputedStyle(htmlEl);

  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;

  return true;
}

// ── Main Evaluator ──────────────────────────────────────────

/**
 * Evaluate a single assertion against live DOM state.
 *
 * @param assertion  The assertion to evaluate.
 * @param url        Current page URL (for URL_MATCH assertions).
 * @returns          Assertion result with pass/fail and actual/expected values.
 */
export function evaluateAssertion(
  assertion: AssertionInput,
  url?: string,
): AssertionResult {
  const { type, comparison, expectedValue, property, target } = assertion;

  // ── URL_MATCH: check current URL ──
  if (type === 'urlMatch') {
    const currentUrl = url ?? window.location.href;
    const result = compareValues(currentUrl, expectedValue, comparison);
    return {
      type,
      passed: result,
      actualValue: currentUrl,
      expectedValue,
      message: result
        ? `URL "${currentUrl}" matched "${expectedValue}"`
        : `URL "${currentUrl}" did not match "${expectedValue}"`,
    };
  }

  // ── Element-based assertions ──
  if (target.kind === 'element') {
    const element = target.element;

    // ── PRESENCE: element exists in the DOM ──
    if (type === 'presence') {
      const present = element !== null;
      const result = comparison === 'isFalse' ? !present : present;
      return {
        type,
        passed: result,
        actualValue: present,
        expectedValue: expectedValue,
        message: result
          ? `Element is present`
          : `Element is not present`,
      };
    }

    // ── VISIBILITY: element is visible ──
    if (type === 'visibility') {
      const visible = element !== null && isElementVisible(element);
      const result = comparison === 'isFalse' ? !visible : visible;
      return {
        type,
        passed: result,
        actualValue: visible,
        expectedValue,
        message: result
          ? `Element is visible`
          : `Element is not visible`,
      };
    }

    // ── COUNT: check number of elements ──
    // 4c-iii-a (D2): counts ALL matches of the best-priority locator when
    // the caller provides allMatches (the querySelectorAll result — the SAME
    // selector the Playwright export renders via locator().count()). Runs
    // BEFORE the null-element guard so an empty match set yields count 0
    // rather than "Element not found". When allMatches is absent
    // (single-element callers), the historical element?1:0 semantics apply.
    if (type === 'count') {
      const matches = target.allMatches;
      const actualCount = matches !== undefined ? matches.length : element ? 1 : 0;
      const result = compareValues(actualCount, expectedValue, comparison);
      return {
        type,
        passed: result,
        actualValue: actualCount,
        expectedValue,
        message: result
          ? `Element count ${actualCount} matched "${expectedValue}"`
          : `Element count ${actualCount} did not match "${expectedValue}"`,
      };
    }

    // ── Element is null for non-presence/non-visibility/count checks ──
    if (!element) {
      return {
        type,
        passed: false,
        actualValue: null,
        expectedValue,
        message: `Element not found — cannot evaluate ${type}`,
      };
    }

    // ── TEXT_MATCH: check text content ──
    if (type === 'textMatch') {
      const actualText = element.textContent?.trim() ?? '';
      const result = compareValues(actualText, expectedValue, comparison);
      return {
        type,
        passed: result,
        actualValue: actualText,
        expectedValue,
        message: result
          ? `Text "${actualText}" matched "${expectedValue}"`
          : `Text "${actualText}" did not match "${expectedValue}"`,
      };
    }

    // ── ATTRIBUTE_MATCH: check attribute value ──
    if (type === 'attributeMatch') {
      // For attributeMatch, property specifies which attribute to check
      const attrName = property ?? 'value';
      const actualAttr = element.getAttribute(attrName);
      const result = compareValues(actualAttr, expectedValue, comparison);
      return {
        type,
        passed: result,
        actualValue: actualAttr,
        expectedValue,
        message: result
          ? `Attribute "${attrName}"="${actualAttr}" matched "${expectedValue}"`
          : `Attribute "${attrName}"="${actualAttr}" did not match "${expectedValue}"`,
      };
    }

    // ── EQUALITY: check a specific property value ──
    if (type === 'equality') {
      const actualVal = extractPropertyValue(element, property, url);
      const result = compareValues(actualVal, expectedValue, comparison);
      return {
        type,
        passed: result,
        actualValue: actualVal,
        expectedValue,
        message: result
          ? `Property "${property}" value "${actualVal}" matched "${expectedValue}"`
          : `Property "${property}" value "${actualVal}" did not match "${expectedValue}"`,
      };
    }

    // ── CUSTOM: fallback to property-based comparison ──
    if (type === 'custom') {
      const actualVal = extractPropertyValue(element, property, url);
      const result = compareValues(actualVal, expectedValue, comparison);
      return {
        type,
        passed: result,
        actualValue: actualVal,
        expectedValue,
        message: result
          ? `Custom check passed: "${actualVal}" matched "${expectedValue}"`
          : `Custom check failed: "${actualVal}" did not match "${expectedValue}"`,
      };
    }
  }

  // ── Target is 'none' or 'url' with non-URL assertion type ──
  return {
    type,
    passed: false,
    actualValue: null,
    expectedValue,
    message: `Assertion type "${type}" is not applicable to ${target.kind} target`,
  };
}

/**
 * Evaluate multiple assertions in batch.
 *
 * @param assertions  Array of assertions to evaluate.
 * @param url         Current page URL.
 * @returns           Array of assertion results (same order as input).
 */
export function evaluateAssertions(
  assertions: readonly AssertionInput[],
  url?: string,
): AssertionResult[] {
  return assertions.map((a) => evaluateAssertion(a, url));
}
