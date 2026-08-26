/**
 * Action Executor — executes IRStep actions against live DOM elements.
 *
 * This module is testable in isolation (jsdom). The executor content script
 * inlines the same logic.
 *
 * Supported actions:
 *   CLICK        → element.click()
 *   FILL         → element.value = input; dispatch input + change events
 *   SELECT       → element.value = input; dispatch change event
 *   SELECT_DATE  → date-specific fill (type the date string)
 *   TOGGLE       → element.checked = input; dispatch change event
 *   HOVER        → dispatch mouseover + mouseenter events
 *   NAVIGATE     → handled by service worker (chrome.tabs.update), not here
 *   VERIFY       → no action (assertions only)
 *   WAIT         → setTimeout(input as duration)
 *   WAIT_FOR_ELEMENT → handled by locator resolver, not here
 */

// ── Types ───────────────────────────────────────────────────

export type ActionType =
  | 'click'
  | 'fill'
  | 'select'
  | 'selectDate'
  | 'toggle'
  | 'hover'
  | 'navigate'
  | 'verify'
  | 'wait'
  | 'waitForElement'
  | 'keyboardShortcut'; // 7.4-B5 B5-2c: page-scoped keypress

export interface ActionExecutionResult {
  readonly success: boolean;
  readonly actualValue?: unknown;
  readonly error?: { readonly message: string; readonly type: string };
}

// ── Action Executors ────────────────────────────────────────

/**
 * Execute a click on an element.
 * Uses element.click() which dispatches a trusted click event.
 */
export function executeClick(element: Element): ActionExecutionResult {
  try {
    (element as HTMLElement).click();
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: { message: `Click failed: ${(e as Error).message}`, type: 'ActionError' },
    };
  }
}

/**
 * Fill an input element with a value.
 * Dispatches input and change events to trigger framework listeners.
 */
export function executeFill(element: Element, value: string): ActionExecutionResult {
  try {
    const el = element as HTMLInputElement | HTMLTextAreaElement;

    // Use native setter to work with React/Vue controlled inputs
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;

    if (el instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
      nativeTextAreaValueSetter.call(el, value);
    } else if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    // Dispatch input event (fires framework listeners)
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // Dispatch change event (fires framework listeners on blur)
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, actualValue: value };
  } catch (e) {
    return {
      success: false,
      error: { message: `Fill failed: ${(e as Error).message}`, type: 'ActionError' },
    };
  }
}

/**
 * Select an option from a <select> element.
 * Dispatches change event to trigger framework listeners.
 */
export function executeSelect(element: Element, value: string): ActionExecutionResult {
  try {
    const el = element as HTMLSelectElement;

    // Find the option matching the value
    const option = Array.from(el.options).find(
      (opt) => opt.value === value || opt.textContent?.trim() === value,
    );

    if (!option) {
      return {
        success: false,
        error: { message: `Option "${value}" not found in select`, type: 'OptionNotFound' },
      };
    }

    el.value = option.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, actualValue: option.value };
  } catch (e) {
    return {
      success: false,
      error: { message: `Select failed: ${(e as Error).message}`, type: 'ActionError' },
    };
  }
}

/**
 * Select a date in a date input.
 * Uses the native value setter for date inputs (yyyy-mm-dd format).
 */
export function executeSelectDate(element: Element, value: string): ActionExecutionResult {
  try {
    const el = element as HTMLInputElement;

    // Date inputs expect yyyy-mm-dd format
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, actualValue: value };
  } catch (e) {
    return {
      success: false,
      error: { message: `Date selection failed: ${(e as Error).message}`, type: 'ActionError' },
    };
  }
}

/**
 * Toggle a checkbox or radio button.
 */
export function executeToggle(element: Element, checked: boolean): ActionExecutionResult {
  try {
    const el = element as HTMLInputElement;

    const nativeCheckedSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'checked',
    )?.set;

    if (nativeCheckedSetter) {
      nativeCheckedSetter.call(el, checked);
    } else {
      el.checked = checked;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, actualValue: checked };
  } catch (e) {
    return {
      success: false,
      error: { message: `Toggle failed: ${(e as Error).message}`, type: 'ActionError' },
    };
  }
}

/**
 * Hover over an element (dispatch mouseover and mouseenter events).
 */
export function executeHover(element: Element): ActionExecutionResult {
  try {
    const el = element as HTMLElement;

    el.dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, cancelable: true }),
    );
    el.dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: false, cancelable: true }),
    );

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: { message: `Hover failed: ${(e as Error).message}`, type: 'ActionError' },
    };
  }
}

/**
 * Wait for a specified duration (in milliseconds).
 * This is async — the caller should await it.
 */
export function executeWait(durationMs: number): Promise<ActionExecutionResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true, actualValue: durationMs });
    }, durationMs);
  });
}

// ── Main Action Dispatcher ──────────────────────────────────

/**
 * Execute an action on an element.
 *
 * @param action    The action type (from IRAction enum values).
 * @param element   The resolved DOM element (null for navigate/wait/verify).
 * @param input     The action input value (string | number | boolean | null).
 * @returns         Execution result.
 */
export function executeAction(
  action: ActionType,
  element: Element | null,
  input: string | number | boolean | null = null,
): ActionExecutionResult | Promise<ActionExecutionResult> {
  switch (action) {
    case 'click':
      if (!element) return { success: false, error: { message: 'No element for click', type: 'MissingElement' } };
      return executeClick(element);

    case 'fill':
      if (!element) return { success: false, error: { message: 'No element for fill', type: 'MissingElement' } };
      return executeFill(element, String(input ?? ''));

    case 'select':
      if (!element) return { success: false, error: { message: 'No element for select', type: 'MissingElement' } };
      return executeSelect(element, String(input ?? ''));

    case 'selectDate':
      if (!element) return { success: false, error: { message: 'No element for selectDate', type: 'MissingElement' } };
      return executeSelectDate(element, String(input ?? ''));

    case 'toggle':
      if (!element) return { success: false, error: { message: 'No element for toggle', type: 'MissingElement' } };
      return executeToggle(element, input === true || input === 'true');

    case 'hover':
      if (!element) return { success: false, error: { message: 'No element for hover', type: 'MissingElement' } };
      return executeHover(element);

    case 'verify':
      // No action needed — assertions are evaluated separately
      return { success: true };

    case 'wait':
      return executeWait(typeof input === 'number' ? input : parseInt(String(input ?? '0'), 10) || 0);

    case 'navigate':
      // Handled by service worker (chrome.tabs.update), not here
      return { success: true };

    case 'waitForElement':
      // Handled by locator resolver with wait strategy, not here
      return { success: true };

    case 'keyboardShortcut': {
      // 7.4-B5 B5-2c-2: dispatch a trusted-shaped KeyboardEvent keydown+keyup
      // on document.activeElement (or document if none). Same synthetic-event
      // family the executors already use (el.click(), new Event('input')).
      //
      // Fidelity limit (spec §7 limit 3): synthetic keydowns are untrusted —
      // JS-handled modals (MUI/AntD/Radix) close; the native <dialog> Escape
      // auto-behavior will NOT. The Playwright render is a trusted real
      // keypress and covers that path.
      const key = String(input ?? 'Escape');
      const target = element ?? document.activeElement ?? document.body ?? document;
      const init = { key, code: key, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent('keydown', init));
      target.dispatchEvent(new KeyboardEvent('keyup', init));
      return { success: true };
    }

    default:
      return {
        success: false,
        error: { message: `Unknown action: ${action}`, type: 'UnknownAction' },
      };
  }
}
