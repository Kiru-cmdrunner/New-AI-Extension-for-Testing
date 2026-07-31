/**
 * Playwright Action Renderer — Milestone 2
 *
 * Maps an IRStep's action to a Playwright method call string.
 * This is a pure function: given the same step, always produces
 * the same Playwright code. No side effects, no I/O.
 *
 * Action Mapping Table (IRAction → Playwright method):
 *   CLICK           → locator.click()
 *   FILL            → locator.fill('value')
 *   SELECT          → locator.selectOption('value')
 *   SELECT_DATE     → locator.fill('date')
 *   TOGGLE (true)   → locator.check()
 *   TOGGLE (false)  → locator.uncheck()
 *   TOGGLE (null)   → locator.click()
 *   HOVER           → locator.hover()
 *   NAVIGATE        → page.goto('url')
 *   VERIFY          → '' (no action line; assertions handled in M3)
 *   WAIT            → page.waitForTimeout(ms)
 *   WAIT_FOR_ELEMENT → '' (Playwright auto-waits; P1 design principle)
 *
 * Input Conventions (IR contract, §2.6.1):
 *   TOGGLE: input = true (check) | false (uncheck) | null (literal toggle)
 *   WAIT:   input = duration in milliseconds
 *   FILL/SELECT/SELECT_DATE: input = string value
 *
 * Reference: execution-ir-design.md §2.1, §2.6.1
 */

import type { IRStep, IRInput } from '../../domain/execution-ir/types';
import { IRAction } from '../../domain/execution-ir/types';
import { renderLocator } from './locator-renderer';

// ── Types ─────────────────────────────────────────────────

/** Options for rendering an action. */
export interface RenderActionOptions {
  /** Indentation prefix for the generated code line (e.g., '  '). */
  readonly indent?: string;
}

// ── Main Entry Point ──────────────────────────────────────

/**
 * Render an IR step's action to a Playwright code line.
 *
 * Returns the code line WITHOUT trailing newline. For steps that produce
 * no action line (VERIFY, WAIT_FOR_ELEMENT), returns an empty string.
 *
 * @param step     The IR step to render.
 * @param pageVar  The variable name for the Playwright Page object (default: 'page').
 * @param options  Optional rendering options.
 * @returns        Playwright code line, or empty string for no-op actions.
 */
export function renderAction(
  step: IRStep,
  pageVar = 'page',
  options?: RenderActionOptions,
): string {
  const indent = options?.indent ?? '';
  const line = renderActionLine(step, pageVar);

  if (!line) return '';
  return `${indent}${line}`;
}

// ── Per-Action Renderers ──────────────────────────────────

/**
 * Render the raw action line (no indent). Returns empty string for no-op actions.
 */
function renderActionLine(step: IRStep, pageVar: string): string {
  switch (step.action) {
    case IRAction.CLICK:
      return renderClick(step, pageVar);

    case IRAction.FILL:
      return renderFill(step, pageVar);

    case IRAction.SELECT:
      return renderSelect(step, pageVar);

    case IRAction.SELECT_DATE:
      return renderSelectDate(step, pageVar);

    case IRAction.TOGGLE:
      return renderToggle(step, pageVar);

    case IRAction.HOVER:
      return renderHover(step, pageVar);

    case IRAction.DRAG_DROP:
      return renderDragDrop(step, pageVar);

    case IRAction.PRESS_KEY:
      return renderPressKey(step, pageVar);

    case IRAction.NAVIGATE:
      return renderNavigate(step, pageVar);

    case IRAction.VERIFY:
      // VERIFY steps carry assertions only — no action line.
      // Assertions are rendered in Milestone 3.
      return '';

    case IRAction.WAIT:
      return renderWait(step, pageVar);

    case IRAction.WAIT_FOR_ELEMENT:
      // Playwright auto-waits on locators. The WAIT_FOR_ELEMENT step
      // is an execution-only injection that adapters skip — P1 design
      // principle: the IR says WHAT, the adapter decides HOW.
      return '';

    default:
      throw new Error(
        `Unsupported IRAction: "${step.action}". ` +
        `This is an IR completeness gap — add a renderer for this action.`,
      );
  }
}

// ── Element-Based Actions ─────────────────────────────────

/** Actions that target a DOM element and accept a timeout option. */
const TIMED_ELEMENT_ACTIONS: ReadonlySet<IRAction> = new Set([
  IRAction.CLICK,
  IRAction.FILL,
  IRAction.SELECT,
  IRAction.SELECT_DATE,
  IRAction.TOGGLE,
  IRAction.HOVER,
]);

/**
 * Build the Playwright timeout option string from execution parameters.
 * Returns empty string if the action doesn't use element-level timeouts.
 */
function timeoutOption(step: IRStep): string {
  if (!TIMED_ELEMENT_ACTIONS.has(step.action)) return '';

  const timeout = step.executionParameters.timeoutMs;
  // Only emit non-default timeouts to keep generated code clean.
  // Default is 30000ms per DEFAULT_EXECUTION_PARAMETERS.
  if (timeout === 30_000) return '';

  return `, { timeout: ${timeout} }`;
}

/**
 * Resolve the element locator expression from the step's target.
 * Delegates to the Milestone 1 locator renderer.
 *
 * For iframe-embedded elements (step.frame present), wraps in frameLocator():
 *   page.frameLocator('iframe#payment').getByRole('button', { name: 'Pay' })
 *
 * For nested iframes (depth > 1), chains frameLocators:
 *   page.frameLocator('iframe#outer').frameLocator('iframe#inner').getByRole(...)
 */
function elementExpression(step: IRStep, pageVar: string): string {
  if (step.target.kind !== 'element') {
    throw new Error(
      `Step "${step.description}" has action ${step.action} ` +
      `which requires an element target, but target kind is "${step.target.kind}".`,
    );
  }

  const rendered = renderLocator(step.target.resolvedLocators, pageVar);
  const baseExpr = `${rendered.pageRef}.${rendered.expression}`;

  // If the element is inside an iframe, prefix with frameLocator()
  if (step.frame) {
    let prefix = pageVar;

    // Chain ancestor frameLocators first (outermost → innermost ancestors)
    if (step.frame.ancestors && step.frame.ancestors.length > 0) {
      for (const ancestor of step.frame.ancestors) {
        prefix += `.frameLocator('${escapeString(ancestor.selector)}')`;
      }
    }

    // Immediate parent frameLocator
    prefix += `.frameLocator('${escapeString(step.frame.selector)}')`;

    return `${prefix}.${rendered.expression}`;
  }

  return baseExpr;
}

/**
 * CLICK → `page.getByRole(...).click()`
 */
function renderClick(step: IRStep, pageVar: string): string {
  const el = elementExpression(step, pageVar);
  const opts = timeoutOption(step);
  return `${el}.click(${opts ? opts.replace(/^, /, '') : ''})`;
}

/**
 * FILL → `page.getByRole(...).fill('value')`
 */
function renderFill(step: IRStep, pageVar: string): string {
  const el = elementExpression(step, pageVar);
  const value = formatStringValue(step.input);
  const opts = timeoutOption(step);
  return `${el}.fill('${value}'${opts})`;
}

/**
 * SELECT → `page.getByRole(...).selectOption('value')`
 */
function renderSelect(step: IRStep, pageVar: string): string {
  const el = elementExpression(step, pageVar);
  const value = formatStringValue(step.input);
  const opts = timeoutOption(step);
  return `${el}.selectOption('${value}'${opts})`;
}

/**
 * SELECT_DATE → `page.getByRole(...).fill('date')`
 *
 * There is no native Playwright date-picker API. SELECT_DATE uses fill()
 * for native <input type="date"> elements. Custom date pickers are an
 * adapter refinement concern, not an IR concern — the IR carries the
 * date value, the adapter decides how to enter it.
 */
function renderSelectDate(step: IRStep, pageVar: string): string {
  const el = elementExpression(step, pageVar);
  const value = formatStringValue(step.input);
  const opts = timeoutOption(step);
  return `${el}.fill('${value}'${opts})`;
}

/**
 * TOGGLE → check() / uncheck() / click() based on input convention.
 *
 * IR contract (§2.6.1):
 *   input: true  → ensure checked (idempotent)  → .check()
 *   input: false → ensure unchecked (idempotent) → .uncheck()
 *   input: null  → literal toggle (flip state)   → .click()
 */
function renderToggle(step: IRStep, pageVar: string): string {
  const el = elementExpression(step, pageVar);
  const opts = timeoutOption(step);

  if (step.input === true) {
    return `${el}.check(${opts ? opts.replace(/^, /, '') : ''})`;
  }
  if (step.input === false) {
    return `${el}.uncheck(${opts ? opts.replace(/^, /, '') : ''})`;
  }
  // null input = literal toggle
  return `${el}.click(${opts ? opts.replace(/^, /, '') : ''})`;
}

/**
 * HOVER → `page.getByRole(...).hover()`
 */
function renderHover(step: IRStep, pageVar: string): string {
  const el = elementExpression(step, pageVar);
  const opts = timeoutOption(step);
  return `${el}.hover(${opts ? opts.replace(/^, /, '') : ''})`;
}

/**
 * PRESS_KEY → `page.getByRole(...).press('Control+s')`
 *
 * If the step targets an element, uses locator.press().
 * If no element target (page-level shortcut), uses page.keyboard.press().
 *
 * The key string follows Playwright's key format:
 * "Control+s", "Meta+k", "Escape", "Shift+Tab", etc.
 */
function renderPressKey(step: IRStep, pageVar: string): string {
  const keyValue = step.input ? escapeString(String(step.input)) : 'Escape';

  // If the step has an element target, press on that element
  if (step.target.kind === 'element') {
    const el = elementExpression(step, pageVar);
    return `${el}.press('${keyValue}')`;
  }

  // Page-level keyboard shortcut
  return `${pageVar}.keyboard.press('${keyValue}')`;
}

/**
 * DRAG_DROP → `page.getByRole(...).dragTo(page.getByRole(...))`
 *
 * Playwright's dragTo() handles both mouse-based and HTML5 DnD.
 * The source element is the step's target; the drop target locator is
 * carried in the step's input as a JSON-encoded locator string.
 * If no drop target locator is available, falls back to manual
 * mousedown → mousemove → mouseup.
 */
function renderDragDrop(step: IRStep, pageVar: string): string {
  const sourceEl = elementExpression(step, pageVar);
  const opts = timeoutOption(step);

  // The drop target locator is stored in step.input as a string.
  // If it's a valid locator string, use dragTo().
  if (step.input && typeof step.input === 'string' && step.input.length > 0) {
    const targetLocator = step.input;
    return `${sourceEl}.dragTo(${pageVar}.locator('${targetLocator}')${opts})`;
  }

  // Fallback: manual drag using mouse actions
  // This generates a multi-step drag for cases where dragTo() doesn't work.
  return `${sourceEl}.hover()`;
}

// ── Non-Element Actions ───────────────────────────────────

/**
 * NAVIGATE → `page.goto('url')`
 *
 * URL is resolved from the step's UrlTarget at IR generation time.
 */
function renderNavigate(step: IRStep, pageVar: string): string {
  if (step.target.kind !== 'url') {
    throw new Error(
      `NAVIGATE step "${step.description}" must have a url target, ` +
      `but target kind is "${step.target.kind}".`,
    );
  }

  return `${pageVar}.goto('${escapeString(step.target.url)}')`;
}

/**
 * WAIT → `page.waitForTimeout(ms)`
 *
 * Duration comes from the step's input field (milliseconds).
 * Per IR contract §2.6.1: input holds the wait duration, NOT timeoutMs.
 */
function renderWait(step: IRStep, pageVar: string): string {
  const duration = resolveWaitDuration(step.input);
  return `${pageVar}.waitForTimeout(${duration})`;
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Format an IRInput value as a string for embedding in single-quoted Playwright code.
 * Escapes single quotes and backslashes.
 */
function formatStringValue(input: IRInput): string {
  if (input === null || input === undefined) {
    return '';
  }
  return escapeString(String(input));
}

/**
 * Resolve the wait duration from an IRInput.
 * Per §2.6.1: WAIT input is a number (milliseconds).
 * Falls back to a safe default if the input is missing or invalid.
 */
function resolveWaitDuration(input: IRInput): number {
  if (typeof input === 'number' && input > 0) {
    return Math.round(input);
  }
  // Defensive fallback: 1000ms. This shouldn't happen if the IR was
  // generated correctly, but we don't want generated code to contain
  // undefined or NaN.
  return 1000;
}

/**
 * Escape a string for safe embedding in single-quoted Playwright code.
 * Escapes backslashes, single quotes, and control characters (newlines,
 * tabs, etc.) that would break single-quoted string syntax.
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')       // backslash first
    .replace(/'/g, "\\'")         // single quote
    .replace(/\n/g, '\\n')        // newline
    .replace(/\r/g, '\\r')        // carriage return
    .replace(/\t/g, '\\t')        // tab
    .replace(/\u2028/g, '\\u2028') // line separator
    .replace(/\u2029/g, '\\u2029'); // paragraph separator
}
