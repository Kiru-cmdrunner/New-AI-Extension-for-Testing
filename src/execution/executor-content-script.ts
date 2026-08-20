/**
 * Executor Content Script — injected on-demand by the service worker.
 *
 * Listens for EXECUTE_STEP messages from the service worker and executes
 * them against the live DOM. Returns structured results.
 *
 * SELF-CONTAINED: Content scripts run in an isolated world and cannot import
 * modules. All logic is inlined here. This file mirrors the logic in:
 *   - src/execution/locator-resolver.ts
 *   - src/execution/action-executor.ts
 *
 * The testable modules are the source of truth; this file inlines them for
 * the content script environment.
 */

// ════════════════════════════════════════════════════════════════════════
// TYPES (inlined — no module imports in content scripts)
// ════════════════════════════════════════════════════════════════════════

interface LocatorInput {
  type: string;
  value: string;
  priority: number;
  confidence: number | null;
}

interface ResolvedElement {
  element: Element;
  matchedLocator: LocatorInput;
  visible: boolean;
}

interface ActionExecutionResult {
  success: boolean;
  actualValue?: unknown;
  error?: { message: string; type: string };
}

interface StepMessage {
  type: 'EXECUTE_STEP';
  step: {
    id: string;
    action: string;
    target: {
      kind: string;
      elementId?: string;
      resolvedLocators?: LocatorInput[];
      url?: string;
    };
    input: string | number | boolean | null;
    executionParameters?: {
      timeoutMs?: number;
      waitStrategy?: 'none' | 'present' | 'visible' | 'stable';
    };
  };
}

interface ResolveMessage {
  type: 'RESOLVE_LOCATOR';
  locators: LocatorInput[];
  requireVisible?: boolean;
  /** Max ms to poll for late-rendered elements; <=0/absent = single-shot (legacy). */
  timeoutMs?: number;
}

interface ExtractDomContextMessage {
  type: 'EXTRACT_DOM_CONTEXT';
  hint?: Record<string, string | null>;
}

interface EvaluateAssertionsMessage {
  type: 'EVALUATE_ASSERTIONS';
  assertions: Array<{
    type: string;
    comparison: string;
    expectedValue: unknown;
    property: string | null;
    severity?: 'hard' | 'soft';
    target: { kind: string; elementId?: string; resolvedLocators?: LocatorInput[]; url?: string };
  }>;
  url?: string;
}

interface StepResult {
  stepId: string;
  action: string;
  status: 'passed' | 'failed' | 'error';
  actualValue?: unknown;
  error?: { message: string; type: string };
  durationMs: number;
}

// ════════════════════════════════════════════════════════════════════════
// LOCATOR RESOLVER (inlined from src/execution/locator-resolver.ts)
// ════════════════════════════════════════════════════════════════════════

function isElementVisible(element: Element): boolean {
  if (!element || !element.isConnected) return false;
  const htmlEl = element as HTMLElement;
  const style = window.getComputedStyle(htmlEl);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  if (style.position !== 'fixed' && htmlEl.offsetParent === null) return false;
  const rect = htmlEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function resolveByTestId(doc: Document, value: string): Element | null {
  return (
    doc.querySelector(`[data-testid="${cssEscape(value)}"]`) ||
    doc.querySelector(`[data-cy="${cssEscape(value)}"]`) ||
    doc.querySelector(`[data-qa="${cssEscape(value)}"]`) || null
  );
}

function resolveByAccessibleName(doc: Document, value: string): Element | null {
  const ariaMatch = doc.querySelector(`[aria-label="${cssEscape(value)}"]`);
  if (ariaMatch) return ariaMatch;
  const labelledBy = doc.querySelector(`[aria-labelledby="${cssEscape(value)}"]`);
  if (labelledBy) return labelledBy;
  const all = doc.querySelectorAll('*');
  for (const el of all) {
    if ((el as HTMLElement).getAttribute?.('aria-label') === value) return el;
  }
  return null;
}

function resolveByRole(doc: Document, value: string): Element | null {
  return doc.querySelector(`[role="${cssEscape(value)}"]`);
}

function resolveByText(doc: Document, value: string): Element | null {
  const all = doc.querySelectorAll('*');
  for (const el of all) {
    if (el.textContent?.trim() === value) return el;
  }
  return null;
}

function resolveByLabel(doc: Document, value: string): Element | null {
  const label = doc.querySelector(`label[for="${cssEscape(value)}"]`);
  if (label) {
    const forId = label.getAttribute('for');
    if (forId) {
      const target = doc.getElementById(forId);
      if (target) return target;
    }
  }
  const byName = doc.querySelector(`[name="${cssEscape(value)}"]`);
  if (byName) return byName;
  const byAriaLabel = doc.querySelector(`[aria-label="${cssEscape(value)}"]`);
  if (byAriaLabel) return byAriaLabel;
  const byPlaceholder = doc.querySelector(`[placeholder="${cssEscape(value)}"]`);
  if (byPlaceholder) return byPlaceholder;
  return null;
}

function resolveByCss(doc: Document, value: string): Element | null {
  try { return doc.querySelector(value); } catch { return null; }
}

function resolveByXPath(doc: Document, value: string): Element | null {
  try {
    const result = doc.evaluate(value, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return (result.singleNodeValue as Element) || null;
  } catch { return null; }
}

function resolveLocator(doc: Document, locator: LocatorInput): Element | null {
  switch (locator.type) {
    case 'testId': return resolveByTestId(doc, locator.value);
    case 'accessibleName': return resolveByAccessibleName(doc, locator.value);
    case 'role': return resolveByRole(doc, locator.value);
    case 'text': return resolveByText(doc, locator.value);
    case 'label': return resolveByLabel(doc, locator.value);
    case 'css': return resolveByCss(doc, locator.value);
    case 'xpath': return resolveByXPath(doc, locator.value);
    default: return null;
  }
}

function resolveElement(
  locators: LocatorInput[],
  doc: Document = document,
  requireVisible = true,
): ResolvedElement | null {
  if (!locators || locators.length === 0) return null;
  const sorted = [...locators].sort((a, b) => a.priority - b.priority);
  for (const locator of sorted) {
    const element = resolveLocator(doc, locator);
    if (element) {
      const visible = isElementVisible(element);
      if (requireVisible && !visible) continue;
      return { element, matchedLocator: locator, visible };
    }
  }
  return null;
}

/**
 * 4c-iii-a (D2): resolve ALL elements matching the best-priority locator
 * that yields at least one match — the SAME strategy the Playwright export
 * uses when rendering locator().count(). The best-priority locator is the
 * first (lowest priority number) whose type supports multi-match
 * resolution. Text/accessibleName resolvers walk every element, so they
 * can return full match lists too. Returns null when no locator type
 * supports all-match resolution or nothing matches.
 */
function resolveAllMatches(
  locators: LocatorInput[],
  doc: Document = document,
): Element[] | null {
  if (!locators || locators.length === 0) return null;
  const sorted = [...locators].sort((a, b) => a.priority - b.priority);
  for (const locator of sorted) {
    const matches = resolveAllByType(doc, locator);
    if (matches && matches.length > 0) return matches;
    // Empty match set from a supported type is authoritative: stop — do
    // not fall through to a lower-priority locator and inflate the count.
    if (matches) return [];
  }
  return null;
}

function resolveAllByType(doc: Document, locator: LocatorInput): Element[] | null {
  try {
    switch (locator.type) {
      case 'css': return Array.from(doc.querySelectorAll(locator.value));
      case 'testId': {
        // Union of the three test-id attribute namespaces, deduped — an
        // element carrying more than one of them must not double-count.
        const seen = new Set<Element>();
        for (const sel of [
          `[data-testid="${cssEscape(locator.value)}"]`,
          `[data-cy="${cssEscape(locator.value)}"]`,
          `[data-qa="${cssEscape(locator.value)}"]`,
        ]) {
          for (const el of doc.querySelectorAll(sel)) seen.add(el);
        }
        return Array.from(seen);
      }
      case 'role': return Array.from(doc.querySelectorAll(`[role="${cssEscape(locator.value)}"]`));
      case 'text': {
        const out: Element[] = [];
        for (const el of doc.querySelectorAll('*')) {
          if (el.textContent?.trim() === locator.value) out.push(el);
        }
        return out;
      }
      case 'accessibleName': {
        const out: Element[] = [];
        for (const el of doc.querySelectorAll('*')) {
          if ((el as HTMLElement).getAttribute?.('aria-label') === locator.value) out.push(el);
        }
        return out;
      }
      case 'label': {
        // Mirrors resolveByLabel's fallback chain: label[for] → [name] →
        // [aria-label] → [placeholder]. First non-empty set wins.
        const out: Element[] = [];
        const labels = doc.querySelectorAll(`label[for="${cssEscape(locator.value)}"]`);
        for (const label of labels) {
          const forId = label.getAttribute('for');
          if (!forId) continue;
          const target = doc.getElementById(forId);
          if (target) out.push(target);
        }
        if (out.length > 0) return out;
        const byName = Array.from(doc.querySelectorAll(`[name="${cssEscape(locator.value)}"]`));
        if (byName.length > 0) return byName;
        const byAriaLabel = Array.from(doc.querySelectorAll(`[aria-label="${cssEscape(locator.value)}"]`));
        if (byAriaLabel.length > 0) return byAriaLabel;
        return Array.from(doc.querySelectorAll(`[placeholder="${cssEscape(locator.value)}"]`));
      }
      case 'xpath': {
        const result = doc.evaluate(
          locator.value,
          doc,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null,
        );
        const out: Element[] = [];
        for (let i = 0; i < result.snapshotLength; i++) {
          const node = result.snapshotItem(i);
          if (node && node.nodeType === Node.ELEMENT_NODE) out.push(node as Element);
        }
        return out;
      }
      default: return null; // unsupported type → skip to next locator
    }
  } catch {
    return null; // invalid selector → skip to next locator
  }
}

function extractElementIdentity(element: Element): Record<string, string | null> {
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
    cssSelector: el.id ? `#${el.id}` : el.tagName.toLowerCase(),
  };
}

// ════════════════════════════════════════════════════════════════════════
// ACTION EXECUTOR (inlined from src/execution/action-executor.ts)
// ════════════════════════════════════════════════════════════════════════

function executeClick(element: Element): ActionExecutionResult {
  try { (element as HTMLElement).click(); return { success: true }; }
  catch (e) { return { success: false, error: { message: `Click failed: ${(e as Error).message}`, type: 'ActionError' } }; }
}

function executeFill(element: Element, value: string): ActionExecutionResult {
  try {
    const el = element as HTMLInputElement | HTMLTextAreaElement;
    const setter = el instanceof HTMLTextAreaElement
      ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, actualValue: value };
  } catch (e) { return { success: false, error: { message: `Fill failed: ${(e as Error).message}`, type: 'ActionError' } }; }
}

function executeSelect(element: Element, value: string): ActionExecutionResult {
  try {
    const el = element as HTMLSelectElement;
    const option = Array.from(el.options).find(o => o.value === value || o.textContent?.trim() === value);
    if (!option) return { success: false, error: { message: `Option "${value}" not found`, type: 'OptionNotFound' } };
    el.value = option.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, actualValue: option.value };
  } catch (e) { return { success: false, error: { message: `Select failed: ${(e as Error).message}`, type: 'ActionError' } }; }
}

function executeToggle(element: Element, checked: boolean): ActionExecutionResult {
  try {
    const el = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
    if (setter) setter.call(el, checked); else el.checked = checked;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, actualValue: checked };
  } catch (e) { return { success: false, error: { message: `Toggle failed: ${(e as Error).message}`, type: 'ActionError' } }; }
}

function executeHover(element: Element): ActionExecutionResult {
  try {
    const el = element as HTMLElement;
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true }));
    return { success: true };
  } catch (e) { return { success: false, error: { message: `Hover failed: ${(e as Error).message}`, type: 'ActionError' } }; }
}

function executeAction(
  action: string,
  element: Element | null,
  input: string | number | boolean | null = null,
): ActionExecutionResult {
  switch (action) {
    case 'click': return element ? executeClick(element) : { success: false, error: { message: 'No element', type: 'MissingElement' } };
    case 'fill': return element ? executeFill(element, String(input ?? '')) : { success: false, error: { message: 'No element', type: 'MissingElement' } };
    case 'select': return element ? executeSelect(element, String(input ?? '')) : { success: false, error: { message: 'No element', type: 'MissingElement' } };
    case 'selectDate': return element ? executeFill(element, String(input ?? '')) : { success: false, error: { message: 'No element', type: 'MissingElement' } };
    case 'toggle': return element ? executeToggle(element, input === true || input === 'true') : { success: false, error: { message: 'No element', type: 'MissingElement' } };
    case 'hover': return element ? executeHover(element) : { success: false, error: { message: 'No element', type: 'MissingElement' } };
    case 'verify': return { success: true };
    case 'wait': return { success: true };
    case 'navigate': return { success: true };
    case 'waitForElement': return { success: true };
    default: return { success: false, error: { message: `Unknown action: ${action}`, type: 'UnknownAction' } };
  }
}

// ════════════════════════════════════════════════════════════════════════
// ASSERTION EVALUATOR (inlined from src/execution/assertion-evaluator.ts)
// ════════════════════════════════════════════════════════════════════════

function extractPropertyValue(element: Element | null, property: string | null, url?: string): unknown {
  if (property === 'url') return url ?? window.location.href;
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
    case 'class':
    case 'className':
      return el.className ?? '';
    case 'tag':
    case 'tagName':
      return el.tagName.toLowerCase();
    case 'id':
      return el.id ?? '';
    case 'count':
      return null;
    default:
      return property ? el.getAttribute(property) : (el.textContent?.trim() ?? '');
  }
}

function compareValues(actual: unknown, expected: unknown, comparison: string): boolean {
  switch (comparison) {
    case 'equals':
      return String(actual) === String(expected);
    case 'contains':
      if (typeof actual === 'string') return actual.includes(String(expected));
      if (Array.isArray(actual)) return actual.includes(expected);
      return false;
    case 'matches':
      try { return new RegExp(String(expected)).test(String(actual)); } catch { return false; }
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
      return String(actual) === String(expected);
  }
}

function evaluateAssertionInContentScript(
  assertion: EvaluateAssertionsMessage['assertions'][0],
  url?: string,
): { type: string; passed: boolean; actualValue?: unknown; expectedValue?: unknown; message: string; severity?: 'hard' | 'soft' } {
  const { type, comparison, expectedValue, property, target, severity } = assertion;
  const result = evaluateAssertionInner(type, comparison, expectedValue, property, target, url);
  return { ...result, severity };
}

function evaluateAssertionInner(
  type: string,
  comparison: string,
  expectedValue: unknown,
  property: string | null,
  target: EvaluateAssertionsMessage['assertions'][0]['target'],
  url?: string,
): { type: string; passed: boolean; actualValue?: unknown; expectedValue?: unknown; message: string } {
  if (type === 'urlMatch') {
    const currentUrl = url ?? window.location.href;
    const passed = compareValues(currentUrl, expectedValue, comparison);
    return { type, passed, actualValue: currentUrl, expectedValue, message: passed ? `URL matched` : `URL "${currentUrl}" did not match "${expectedValue}"` };
  }

  // Element-based assertions
  if (target.kind === 'element') {
    // Resolve element via locators
    let element: Element | null = null;
    if (target.resolvedLocators) {
      const resolved = resolveElement(target.resolvedLocators, document, false);
      element = resolved?.element ?? null;
    }

    // PRESENCE
    if (type === 'presence') {
      const present = element !== null;
      const result = comparison === 'isFalse' ? !present : present;
      return { type, passed: result, actualValue: present, expectedValue, message: result ? 'Element is present' : 'Element is not present' };
    }

    // VISIBILITY
    if (type === 'visibility') {
      const visible = element !== null && isElementVisible(element);
      const result = comparison === 'isFalse' ? !visible : visible;
      return { type, passed: result, actualValue: visible, expectedValue, message: result ? 'Element is visible' : 'Element is not visible' };
    }

    // COUNT — 4c-iii-a (D2): true multi-match count via querySelectorAll
    // against the best-priority locator, matching the Playwright export's
    // locator().count(). Runs BEFORE the element-not-found guard so an
    // empty match set yields 0 rather than "Element not found".
    if (type === 'count') {
      const allMatches = target.resolvedLocators
        ? resolveAllMatches(target.resolvedLocators)
        : null;
      const actualCount = allMatches !== null ? allMatches.length : element ? 1 : 0;
      const passed = compareValues(actualCount, expectedValue, comparison);
      return { type, passed, actualValue: actualCount, expectedValue, message: passed ? 'Count matched' : `Count ${actualCount} did not match "${expectedValue}"` };
    }

    if (!element) {
      return { type, passed: false, actualValue: null, expectedValue, message: `Element not found — cannot evaluate ${type}` };
    }

    // TEXT_MATCH
    if (type === 'textMatch') {
      const actual = element.textContent?.trim() ?? '';
      const passed = compareValues(actual, expectedValue, comparison);
      return { type, passed, actualValue: actual, expectedValue, message: passed ? `Text matched` : `Text "${actual}" did not match "${expectedValue}"` };
    }

    // ATTRIBUTE_MATCH
    if (type === 'attributeMatch') {
      const attrName = property ?? 'value';
      const actual = element.getAttribute(attrName);
      const passed = compareValues(actual, expectedValue, comparison);
      return { type, passed, actualValue: actual, expectedValue, message: passed ? `Attribute matched` : `Attribute "${attrName}"="${actual}" did not match "${expectedValue}"` };
    }

    // EQUALITY
    if (type === 'equality') {
      const actual = extractPropertyValue(element, property, url);
      const passed = compareValues(actual, expectedValue, comparison);
      return { type, passed, actualValue: actual, expectedValue, message: passed ? `Property matched` : `Property "${property}" value "${actual}" did not match "${expectedValue}"` };
    }

    // CUSTOM
    if (type === 'custom') {
      const actual = extractPropertyValue(element, property, url);
      const passed = compareValues(actual, expectedValue, comparison);
      return { type, passed, actualValue: actual, expectedValue, message: passed ? `Custom check passed` : `Custom check failed` };
    }
  }

  return { type, passed: false, actualValue: null, expectedValue, message: `Assertion type "${type}" not applicable to ${target.kind} target` };
}

// ════════════════════════════════════════════════════════════════════════
// RESOLVE WITH WAIT (inlined — content scripts cannot import modules)
// ════════════════════════════════════════════════════════════════════════
// Mirrors locator-resolver.ts resolveElementWithWait() semantics, capped at
// 10s: polls resolveElement every 100ms until timeoutMs. timeoutMs <= 0
// (or absent) degrades to today's single-shot behavior — the wire contract
// is backwards compatible for all existing senders.
// Classic-script safe: performance.now / setTimeout / Promise only.
const RESOLVE_WAIT_POLL_MS = 100;
const RESOLVE_WAIT_CAP_MS = 10_000;

function resolveWithWait(
  locators: LocatorInput[],
  requireVisible: boolean,
  timeoutMs: number,
): Promise<Element | null> {
  if (!(timeoutMs > 0)) return Promise.resolve(resolveElement(locators, document, requireVisible)?.element ?? null);
  const capped = Math.min(timeoutMs, RESOLVE_WAIT_CAP_MS);
  const startedAt = performance.now();
  const poll = (resolve: (el: Element | null) => void): void => {
    const resolved = resolveElement(locators, document, requireVisible);
    if (resolved) { resolve(resolved.element); return; }
    if (performance.now() - startedAt >= capped) { resolve(null); return; }
    setTimeout(() => poll(resolve), RESOLVE_WAIT_POLL_MS);
  };
  return new Promise((resolve) => poll(resolve));
}

// ════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLERS
// ════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'EXECUTE_STEP': {
      void (async () => {
      const msg = message as StepMessage;
      const step = msg.step;
      const startTime = performance.now();

      // Resolve element if needed
      let element: Element | null = null;
      if (step.target.kind === 'element' && step.target.resolvedLocators) {
        const requireVisible = (step.executionParameters?.waitStrategy ?? 'visible') !== 'none';
        // Honor the step's timeoutMs for late-rendered targets (capped 10s).
        // Absent timeoutMs → single-shot, identical to pre-wait behavior.
        // waitStrategy 'none' NEVER waits (resolveElementWithWait parity:
        // 'none' = try once immediately, no polling).
        const timeoutMs =
          (step.executionParameters?.waitStrategy ?? 'visible') === 'none'
            ? 0
            : (step.executionParameters?.timeoutMs ?? 0);
        element = await resolveWithWait(
          step.target.resolvedLocators,
          requireVisible,
          timeoutMs,
        );
      }

      // Execute action
      const result = executeAction(step.action, element, step.input);

      const stepResult: StepResult = {
        stepId: step.id,
        action: step.action,
        status: result.success ? 'passed' : 'failed',
        actualValue: result.actualValue,
        error: result.error,
        durationMs: performance.now() - startTime,
      };

      sendResponse(stepResult);
      })().catch((e: unknown) => {
        // Channel must ALWAYS answer — an unhandled rejection would hang the
        // executor's awaited sendTabMessage until its own timeout.
        sendResponse({
          stepId: (message as StepMessage).step?.id ?? 'unknown',
          action: (message as StepMessage).step?.action ?? 'unknown',
          status: 'error',
          actualValue: null,
          error: { message: `Content-script execution error: ${(e as Error)?.message ?? String(e)}` },
          durationMs: 0,
        });
      }); // async EXECUTE_STEP body
      return true; // Keep channel open for async response
    }

    case 'RESOLVE_LOCATOR': {
      const msg = message as ResolveMessage;
      const requireVisible = msg.requireVisible ?? true;
      if ((msg.timeoutMs ?? 0) > 0) {
        // Late-rendered element: poll up to min(timeoutMs, 10s).
        resolveWithWait(msg.locators, requireVisible, msg.timeoutMs ?? 0).then((el) =>
          sendResponse({
            found: !!el,
            identity: el ? extractElementIdentity(el) : null,
          }),
        );
        return true; // async response
      }
      const resolved = resolveElement(msg.locators, document, requireVisible);
      sendResponse({
        found: !!resolved,
        identity: resolved ? extractElementIdentity(resolved.element) : null,
      });
      return true;
    }

    case 'EXTRACT_DOM_CONTEXT': {
      const msg = message as ExtractDomContextMessage;
      // If hint provides a selector, try to find nearby elements
      // Otherwise, return the document's main content area identity
      let targetElement: Element | null = null;

      if (msg.hint?.accessibleName) {
        const els = document.querySelectorAll('*');
        for (const el of els) {
          if ((el as HTMLElement).getAttribute?.('aria-label') === msg.hint.accessibleName ||
              el.textContent?.trim() === msg.hint.accessibleName) {
            targetElement = el;
            break;
          }
        }
      }

      if (targetElement) {
        sendResponse({ identity: extractElementIdentity(targetElement) });
      } else {
        sendResponse({ identity: null });
      }
      return true;
    }

    case 'EVALUATE_ASSERTIONS': {
      const msg = message as EvaluateAssertionsMessage;
      const results = msg.assertions.map((a) => evaluateAssertionInContentScript(a, msg.url));
      sendResponse({ results });
      return true;
    }

    default:
      return;
  }
});
export {};
