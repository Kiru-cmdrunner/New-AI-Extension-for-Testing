/**
 * Playwright Locator Renderer — Milestone 1
 *
 * Maps IR ResolvedLocator[] to Playwright locator expressions.
 * Uses the highest-priority (priority 1) locator strategy.
 *
 * Mapping table (LocatorStrategyType → Playwright API):
 *   ROLE            → page.getByRole(role, { name })
 *   ACCESSIBLE_NAME → page.getByLabel(name) or page.getByPlaceholder(name)
 *   TEST_ID         → page.getByTestId(id)
 *   TEXT            → page.getByText(text)
 *   LABEL           → page.getByLabel(label)
 *   CSS             → page.locator(selector)
 *   XPATH           → page.locator('xpath=...')
 *
 * The renderer is a pure function: given the same locators, always
 * produces the same Playwright code. No side effects, no I/O.
 *
 * Reference: execution-ir-design.md §2.2, §2.3
 */

import { LocatorStrategyType } from '../../domain/enums';
import type { ResolvedLocator } from '../../domain/execution-ir/types';

// ── Adapter-local error (no domain error imports) ────────

class LocatorRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocatorRenderError';
  }
}

// ── Types ─────────────────────────────────────────────────

export interface RenderedLocator {
  /** The page variable reference (e.g., 'page', 'this.page'). */
  readonly pageRef: string;
  /** The Playwright locator expression (e.g., `getByRole('button', { name: 'Submit' })`). */
  readonly expression: string;
}

// ── Main Entry Point ──────────────────────────────────────

/**
 * Render a priority-ordered list of resolved locators to a Playwright
 * locator expression. Uses the highest-priority (priority 1) locator.
 *
 * @param locators  Priority-ordered locator strategies (at least 1 per INV-EL4).
 * @param pageRef   The variable name for the Playwright Page object (default: 'page').
 * @returns Rendered locator with the page reference and expression.
 *
 * @throws LocatorRenderError if locators array is empty (shouldn't happen per INV-EL4).
 * @throws LocatorRenderError if a locator type can't be rendered.
 */
export function renderLocator(
  locators: ResolvedLocator[],
  pageRef = 'page',
): RenderedLocator {
  if (!locators || locators.length === 0) {
    throw new LocatorRenderError(
      'Cannot render an empty locator array (INV-EL4 requires at least one strategy)',
    );
  }

  // Sort by priority (1 = highest) and take the first.
  const sorted = [...locators].sort((a, b) => a.priority - b.priority);
  const best = sorted[0];

  const expression = renderByType(best);

  return { pageRef, expression };
}

// ── Per-Type Renderers ────────────────────────────────────

/**
 * Render a single locator to its Playwright expression.
 * Dispatches based on LocatorStrategyType.
 */
function renderByType(locator: ResolvedLocator): string {
  switch (locator.type) {
    case LocatorStrategyType.ROLE:
      return renderRoleLocator(locator.value);

    case LocatorStrategyType.ACCESSIBLE_NAME:
      return renderAccessibleNameLocator(locator.value);

    case LocatorStrategyType.TEST_ID:
      return renderTestIdLocator(locator.value);

    case LocatorStrategyType.TEXT:
      return renderTextLocator(locator.value);

    case LocatorStrategyType.LABEL:
      return renderLabelLocator(locator.value);

    case LocatorStrategyType.CSS:
      return renderCssLocator(locator.value);

    case LocatorStrategyType.XPATH:
      return renderXpathLocator(locator.value);

    default:
      throw new LocatorRenderError(
        `Unsupported locator strategy type: "${locator.type}"`,
      );
  }
}

// ── ROLE ──────────────────────────────────────────────────

/**
 * Render a ROLE locator.
 *
 * Value format: `role[name="Display Name"]` or just `role`.
 * Examples:
 *   'button[name="Sign In"]' → getByRole('button', { name: 'Sign In' })
 *   'heading[name="Dashboard"]' → getByRole('heading', { name: 'Dashboard' })
 *   'navigation' → getByRole('navigation')
 *   'checkbox[name="Subscribe to newsletter"]' → getByRole('checkbox', { name: 'Subscribe to newsletter' })
 */
function renderRoleLocator(value: string): string {
  const parsed = parseRoleValue(value);
  const { role, name } = parsed;

  if (name) {
    return `getByRole('${role}', { name: '${escapeString(name)}' })`;
  }
  return `getByRole('${role}')`;
}

interface ParsedRole {
  role: string;
  name: string | null;
}

/**
 * Parse a role locator value into role + optional accessible name.
 *
 * Accepted formats:
 *   'button'                         → { role: 'button', name: null }
 *   'button[name="Sign In"]'         → { role: 'button', name: 'Sign In' }
 *   'link[name="Forgot password?"]'  → { role: 'link', name: 'Forgot password?' }
 */
function parseRoleValue(value: string): ParsedRole {
  // Match: `roleName[name="..."]`
  const bracketMatch = value.match(/^([a-zA-Z]+)\[name="(.+)"\]$/);
  if (bracketMatch) {
    return { role: bracketMatch[1], name: bracketMatch[2] };
  }

  // Plain role with no name: `button`, `heading`, `navigation`
  const plainMatch = value.match(/^([a-zA-Z]+)$/);
  if (plainMatch) {
    return { role: plainMatch[1], name: null };
  }

  throw new LocatorRenderError(
    `Cannot parse ROLE locator value: "${value}". Expected format: 'role' or 'role[name="Display Name"]'`,
  );
}

// ── ACCESSIBLE_NAME ───────────────────────────────────────

/**
 * Render an ACCESSIBLE_NAME locator.
 *
 * For accessible names, getByLabel is the primary Playwright method
 * for form elements (inputs, textareas, selects). getByPlaceholder is
 * used when the value looks like a placeholder hint (contains "..." or
 * starts lowercase without being a proper label).
 *
 * V1: We always use getByLabel for ACCESSIBLE_NAME, as this is the most
 * common ARIA association. The adapter can refine this later.
 */
function renderAccessibleNameLocator(value: string): string {
  return `getByLabel('${escapeString(value)}')`;
}

// ── TEST_ID ───────────────────────────────────────────────

/**
 * Render a TEST_ID locator.
 *
 * Value format: the raw test ID value (e.g., 'email-input', 'submit-btn').
 * May also come in CSS attribute form: '[data-testid="email"]' — extract the ID.
 */
function renderTestIdLocator(value: string): string {
  // Extract from CSS attribute selector: [data-testid="email"]
  const attrMatch = value.match(/\[data-testid=["'](.+?)["']\]/);
  if (attrMatch) {
    return `getByTestId('${escapeString(attrMatch[1])}')`;
  }

  // 6B provenance + 7.3 W-B: NON-DEFAULT test-ID families carry their
  // attribute in the value ('[data-cy="X"]', '[data-qa="X"]',
  // '[data-auto-id="X"]', '[auto-id="X"]'). These cannot be getByTestId —
  // Playwright's default testIdAttribute is data-testid — so render the CSS
  // attribute locator, which resolves the EXACT attribute and fails loudly
  // (strict mode) on ambiguity. Prefix-optional match: the bare spelling
  // names the bare attribute.
  // SAFE_VALUE_RE: value charset excludes quotes/brackets/commas/parens, so a
  // crafted "value" can never widen this into a selector LIST.
  const familyMatch = value.match(
    /^\[(data-)?(cy|qa|auto-id|test|test-id)=["']([^\]"',()]+)["']\]$/,
  );
  if (familyMatch) {
    return `locator('[${familyMatch[1] ?? ''}${familyMatch[2]}="${escapeString(familyMatch[3])}"]')`;
  }

  // Plain ID value: 'email-input'
  return `getByTestId('${escapeString(value)}')`;
}

// ── TEXT ──────────────────────────────────────────────────

/**
 * Render a TEXT locator.
 */
function renderTextLocator(value: string): string {
  return `getByText('${escapeString(value)}')`;
}

// ── LABEL ─────────────────────────────────────────────────

/**
 * Render a LABEL locator. Same Playwright method as ACCESSIBLE_NAME
 * (getByLabel), but semantically distinct in the IR — LABEL comes from
 * an explicit <label> association, ACCESSIBLE_NAME from aria-label.
 */
function renderLabelLocator(value: string): string {
  return `getByLabel('${escapeString(value)}')`;
}

// ── CSS ───────────────────────────────────────────────────

/**
 * Render a CSS locator.
 */
function renderCssLocator(value: string): string {
  return `locator('${escapeString(value)}')`;
}

// ── XPATH ─────────────────────────────────────────────────

/**
 * Render an XPATH locator.
 *
 * Playwright supports XPath via the `xpath=` prefix.
 * Value may or may not already have `//` prefix.
 */
function renderXpathLocator(value: string): string {
  // If already prefixed with xpath=, use as-is
  if (value.startsWith('xpath=')) {
    return `locator('${escapeString(value)}')`;
  }

  // Add xpath= prefix
  return `locator('xpath=${escapeString(value)}')`;
}

// ── Helpers ───────────────────────────────────────────────

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
