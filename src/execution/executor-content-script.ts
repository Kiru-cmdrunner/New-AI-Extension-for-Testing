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
}

interface ExtractDomContextMessage {
  type: 'EXTRACT_DOM_CONTEXT';
  hint?: Record<string, string | null>;
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
// MESSAGE HANDLERS
// ════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'EXECUTE_STEP': {
      const msg = message as StepMessage;
      const step = msg.step;
      const startTime = performance.now();

      // Resolve element if needed
      let element: Element | null = null;
      if (step.target.kind === 'element' && step.target.resolvedLocators) {
        const requireVisible = (step.executionParameters?.waitStrategy ?? 'visible') !== 'none';
        const resolved = resolveElement(step.target.resolvedLocators, document, requireVisible);
        element = resolved?.element ?? null;
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
      return true; // Keep channel open for async response
    }

    case 'RESOLVE_LOCATOR': {
      const msg = message as ResolveMessage;
      const requireVisible = msg.requireVisible ?? true;
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

    default:
      return;
  }
});
