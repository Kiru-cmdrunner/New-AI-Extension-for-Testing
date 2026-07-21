/**
 * Playwright Assertion Renderer — Milestone 3
 *
 * Maps an IRAssertion to a Playwright expect() line.
 * Pure function: same assertion → same code, always.
 *
 * Assertion Matrix (ValidationType × ValidationComparison → Playwright API):
 *
 *   VISIBILITY     IS_TRUE      → toBeVisible()
 *   VISIBILITY     IS_FALSE     → toBeHidden()
 *   PRESENCE       IS_TRUE      → toBeAttached()
 *   PRESENCE       IS_FALSE     → not.toBeAttached()
 *   TEXT_MATCH     EQUALS       → toHaveText('val')
 *   TEXT_MATCH     CONTAINS     → toContainText('val')
 *   TEXT_MATCH     STARTS_WITH  → toContainText(/^val/)
 *   TEXT_MATCH     MATCHES      → toHaveText(/val/)
 *   ATTRIBUTE_MATCH EQUALS      → toHaveAttribute('prop', 'val')
 *   ATTRIBUTE_MATCH CONTAINS    → toHaveAttribute('prop', /val/)
 *   ATTRIBUTE_MATCH MATCHES     → toHaveAttribute('prop', /val/)
 *   COUNT          EQUALS       → toHaveCount(n)
 *   COUNT          GREATER_THAN → const count = await loc.count(); expect(count).toBeGreaterThan(n)
 *   COUNT          LESS_THAN    → const count = await loc.count(); expect(count).toBeLessThan(n)
 *   EQUALITY       IS_TRUE      → property-specific (checked→toBeChecked, enabled→toBeEnabled, etc.)
 *   EQUALITY       IS_FALSE     → property-specific negation
 *   URL_MATCH      *            → toHaveURL on page target
 *   CUSTOM         *            → // TODO: Custom assertion
 *
 * Severity:
 *   HARD (default) → expect(...)
 *   SOFT           → expect.soft(...)
 *
 * Reference: execution-ir-design.md §2.4
 */

import type { IRAssertion } from '../../domain/execution-ir/types';
import {
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
} from '../../domain/enums';
import { renderLocator } from './locator-renderer';

// ── Types ─────────────────────────────────────────────────

/**
 * A rendered assertion. Most assertions are a single line, but COUNT
 * comparisons that need extraction produce multiple lines.
 */
export interface RenderedAssertion {
  /** One or more code lines (no trailing newlines). */
  readonly lines: string[];
}

// ── Main Entry Point ──────────────────────────────────────

/**
 * Render an IRAssertion to Playwright expect() line(s).
 *
 * @param assertion      The assertion to render.
 * @param pageVar        The variable name for the Playwright Page object.
 * @param targetOverride Pre-rendered target expression (POM mode). When provided,
 *                       element assertions use this instead of rendering locators.
 * @returns              Rendered assertion with one or more code lines.
 */
export function renderAssertion(
  assertion: IRAssertion,
  pageVar = 'page',
  targetOverride?: string,
): RenderedAssertion {
  // Create a bound targetExpression that uses targetOverride when provided
  const resolveTarget = (a: IRAssertion, pv: string) => targetExpression(a, pv, targetOverride);

  switch (assertion.type) {
    case ValidationType.VISIBILITY:
      return renderVisibility(assertion, pageVar, resolveTarget);

    case ValidationType.PRESENCE:
      return renderPresence(assertion, pageVar, resolveTarget);

    case ValidationType.TEXT_MATCH:
      return renderTextMatch(assertion, pageVar, resolveTarget);

    case ValidationType.ATTRIBUTE_MATCH:
      return renderAttributeMatch(assertion, pageVar, resolveTarget);

    case ValidationType.COUNT:
      return renderCount(assertion, pageVar, resolveTarget);

    case ValidationType.EQUALITY:
      return renderEquality(assertion, pageVar, resolveTarget);

    case ValidationType.URL_MATCH:
      return renderUrlMatch(assertion, pageVar, resolveTarget);

    case ValidationType.CUSTOM:
      return renderCustom(assertion);

    default:
      throw new Error(
        `Unsupported ValidationType: "${assertion.type}". ` +
        `This is an IR completeness gap — add a renderer for this assertion type.`,
      );
  }
}

// ── Severity Helper ───────────────────────────────────────

/**
 * Build the expect call prefix based on severity.
 * HARD → expect(locator)
 * SOFT → expect.soft(locator)
 *
 * Returns the full expression up to the matcher, without the leading "await ".
 */
function expectCall(targetExpr: string, assertion: IRAssertion): string {
  if (assertion.severity === ValidationSeverity.SOFT) {
    return `expect.soft(${targetExpr})`;
  }
  return `expect(${targetExpr})`;
}

// ── Element Helper ────────────────────────────────────────

/**
 * Render the element locator expression from an assertion's target.
 * For assertions on the page (URL_MATCH), returns the page variable directly.
 * In POM mode, targetOverride replaces the rendered locator expression.
 */
function targetExpression(assertion: IRAssertion, pageVar: string, targetOverride?: string): string {
  if (targetOverride && assertion.target.kind === 'element') {
    return targetOverride;
  }
  if (assertion.target.kind === 'element') {
    const rendered = renderLocator(assertion.target.resolvedLocators, pageVar);
    return `${rendered.pageRef}.${rendered.expression}`;
  }
  if (assertion.target.kind === 'url') {
    return pageVar;
  }
  // NoTarget — used for URL_MATCH and custom assertions
  return pageVar;
}

// ── Per-Type Renderers ────────────────────────────────────

/** Type for the target expression resolver callback. */
type TargetResolver = (assertion: IRAssertion, pageVar: string) => string;

/**
 * VISIBILITY:
 *   IS_TRUE  → toBeVisible()
 *   IS_FALSE → toBeHidden()
 */
function renderVisibility(assertion: IRAssertion, pageVar: string, resolveTarget: TargetResolver): RenderedAssertion {
  const target = resolveTarget(assertion, pageVar);
  const matcher =
    assertion.comparison === ValidationComparison.IS_FALSE
      ? 'toBeHidden()'
      : 'toBeVisible()';
  // Playwright toBeHidden() IS the negation of toBeVisible(), so no .not. needed.
  return { lines: [`await ${expectCall(target, assertion)}.${matcher}`] };
}

/**
 * PRESENCE:
 *   IS_TRUE  → toBeAttached()
 *   IS_FALSE → not.toBeAttached()
 */
function renderPresence(assertion: IRAssertion, pageVar: string, resolveTarget: TargetResolver): RenderedAssertion {
  const target = resolveTarget(assertion, pageVar);
  const isFalse = assertion.comparison === ValidationComparison.IS_FALSE;
  const matcher = isFalse ? 'not.toBeAttached()' : 'toBeAttached()';
  return { lines: [`await ${expectCall(target, assertion)}.${matcher}`] };
}

/**
 * TEXT_MATCH:
 *   EQUALS      → toHaveText('val')
 *   CONTAINS    → toContainText('val')
 *   STARTS_WITH → toContainText(/^val/) (regex anchored at start)
 *   MATCHES     → toHaveText(/val/)
 */
function renderTextMatch(assertion: IRAssertion, pageVar: string, resolveTarget: TargetResolver): RenderedAssertion {
  const target = resolveTarget(assertion, pageVar);
  const value = String(assertion.expectedValue ?? '');

  switch (assertion.comparison) {
    case ValidationComparison.EQUALS:
      return { lines: [`await ${expectCall(target, assertion)}.toHaveText('${escapeString(value)}')`] };

    case ValidationComparison.CONTAINS:
      return { lines: [`await ${expectCall(target, assertion)}.toContainText('${escapeString(value)}')`] };

    case ValidationComparison.STARTS_WITH:
      // Use a regex anchored at the start so Playwright's toContainText matches prefix.
      return { lines: [`await ${expectCall(target, assertion)}.toContainText(/^${escapeRegex(value)}/)`] };

    case ValidationComparison.MATCHES:
      // expectedValue is treated as a regex pattern.
      return { lines: [`await ${expectCall(target, assertion)}.toHaveText(/${escapeRegex(value)}/)`] };

    default:
      throw new Error(
        `TEXT_MATCH does not support comparison "${assertion.comparison}". ` +
        `Expected: equals | contains | matches | startsWith`,
      );
  }
}

/**
 * ATTRIBUTE_MATCH:
 *   EQUALS   → toHaveAttribute('prop', 'val')
 *   CONTAINS → toHaveAttribute('prop', /val/)
 *   MATCHES  → toHaveAttribute('prop', /val/)
 *
 * The assertion.property field holds the attribute name.
 */
function renderAttributeMatch(assertion: IRAssertion, pageVar: string, resolveTarget: TargetResolver): RenderedAssertion {
  const target = resolveTarget(assertion, pageVar);
  const attr = assertion.property ?? 'unknown';
  const value = String(assertion.expectedValue ?? '');

  switch (assertion.comparison) {
    case ValidationComparison.EQUALS:
      return { lines: [`await ${expectCall(target, assertion)}.toHaveAttribute('${escapeString(attr)}', '${escapeString(value)}')`] };

    case ValidationComparison.CONTAINS:
    case ValidationComparison.MATCHES:
      return { lines: [`await ${expectCall(target, assertion)}.toHaveAttribute('${escapeString(attr)}', /${escapeRegex(value)}/)`] };

    default:
      throw new Error(
        `ATTRIBUTE_MATCH does not support comparison "${assertion.comparison}". ` +
        `Expected: equals | contains | matches`,
      );
  }
}

/**
 * COUNT:
 *   EQUALS       → toHaveCount(n)
 *   GREATER_THAN → const count = await loc.count(); expect(count).toBeGreaterThan(n)
 *   LESS_THAN    → const count = await loc.count(); expect(count).toBeLessThan(n)
 */
function renderCount(assertion: IRAssertion, pageVar: string, resolveTarget: TargetResolver): RenderedAssertion {
  const target = resolveTarget(assertion, pageVar);
  const value = Number(assertion.expectedValue);

  switch (assertion.comparison) {
    case ValidationComparison.EQUALS:
      return { lines: [`await ${expectCall(target, assertion)}.toHaveCount(${value})`] };

    case ValidationComparison.GREATER_THAN: {
      // toHaveCount with a comparison is not available — extract count first.
      const softPrefix = assertion.severity === ValidationSeverity.SOFT ? '.soft' : '';
      return {
        lines: [
          `const count_${sanitizedId(assertion)} = await ${target}.count()`,
          `expect${softPrefix}(count_${sanitizedId(assertion)}).toBeGreaterThan(${value})`,
        ],
      };
    }

    case ValidationComparison.LESS_THAN: {
      const softPrefix = assertion.severity === ValidationSeverity.SOFT ? '.soft' : '';
      return {
        lines: [
          `const count_${sanitizedId(assertion)} = await ${target}.count()`,
          `expect${softPrefix}(count_${sanitizedId(assertion)}).toBeLessThan(${value})`,
        ],
      };
    }

    default:
      throw new Error(
        `COUNT does not support comparison "${assertion.comparison}". ` +
        `Expected: equals | greaterThan | lessThan`,
      );
  }
}

/**
 * EQUALITY (IS_TRUE / IS_FALSE):
 *   Property-specific mapping for well-known properties:
 *     checked  → toBeChecked() / not.toBeChecked()
 *     enabled  → toBeEnabled() / toBeDisabled()
 *     editable → toBeEditable() / not.toBeEditable()
 *   Fallback for unknown properties:
 *     toHaveAttribute('prop', 'true') / not.toHaveAttribute('prop', 'true')
 */
function renderEquality(assertion: IRAssertion, pageVar: string, resolveTarget: TargetResolver): RenderedAssertion {
  const target = resolveTarget(assertion, pageVar);
  const isTrue = assertion.comparison === ValidationComparison.IS_TRUE;
  const property = assertion.property?.toLowerCase() ?? '';

  switch (property) {
    case 'checked':
      return { lines: [
        `await ${expectCall(target, assertion)}.${isTrue ? 'toBeChecked()' : 'not.toBeChecked()'}`,
      ] };

    case 'enabled':
      // toBeDisabled() IS the negation of toBeEnabled()
      return { lines: [
        `await ${expectCall(target, assertion)}.${isTrue ? 'toBeEnabled()' : 'toBeDisabled()'}`,
      ] };

    case 'editable':
      return { lines: [
        `await ${expectCall(target, assertion)}.${isTrue ? 'toBeEditable()' : 'not.toBeEditable()'}`,
      ] };

    default: {
      // Unknown property: fall back to attribute check
      const attr = assertion.property ?? 'value';
      const matcher = isTrue
        ? `toHaveAttribute('${escapeString(attr)}', 'true')`
        : `not.toHaveAttribute('${escapeString(attr)}', 'true')`;
      return { lines: [`await ${expectCall(target, assertion)}.${matcher}`] };
    }
  }
}

/**
 * URL_MATCH:
 *   EQUALS      → toHaveURL('url')
 *   CONTAINS    → toHaveURL(/url/)
 *   MATCHES     → toHaveURL(/url/)
 *   STARTS_WITH → toHaveURL(/^url/)
 *
 * Target is the page object, not an element locator.
 */
function renderUrlMatch(assertion: IRAssertion, pageVar: string, _resolveTarget: TargetResolver): RenderedAssertion {
  const target = pageVar; // URL assertions always target the page
  const value = String(assertion.expectedValue ?? '');

  switch (assertion.comparison) {
    case ValidationComparison.EQUALS:
      return { lines: [`await ${expectCall(target, assertion)}.toHaveURL('${escapeString(value)}')`] };

    case ValidationComparison.CONTAINS:
      return { lines: [`await ${expectCall(target, assertion)}.toHaveURL(/${escapeRegex(value)}/)`] };

    case ValidationComparison.STARTS_WITH:
      return { lines: [`await ${expectCall(target, assertion)}.toHaveURL(/^${escapeRegex(value)}/)`] };

    case ValidationComparison.MATCHES:
      return { lines: [`await ${expectCall(target, assertion)}.toHaveURL(/${escapeRegex(value)}/)`] };

    default:
      throw new Error(
        `URL_MATCH does not support comparison "${assertion.comparison}". ` +
        `Expected: equals | contains | matches | startsWith`,
      );
  }
}

/**
 * CUSTOM:
 *   Renders a descriptive TODO comment. Custom assertions are business-specific
 *   and can't be auto-translated — the developer must implement them manually.
 */
function renderCustom(assertion: IRAssertion): RenderedAssertion {
  return {
    lines: [
      `// TODO: Custom assertion — type: ${assertion.type}, comparison: ${assertion.comparison}` +
        (assertion.property ? `, property: ${assertion.property}` : ''),
    ],
  };
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Escape a string for safe embedding in single-quoted Playwright code.
 * Same escaping logic as action-renderer.ts and locator-renderer.ts.
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

/**
 * Escape a string for use inside a JavaScript regex literal.
 * Escapes regex metacharacters and forward slashes (which would
 * prematurely terminate a regex literal /pattern/).
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Generate a sanitized identifier for count variables.
 * Uses the assertion target element ID when available.
 * No module-level state — the caller passes a deduplication index
 * if needed (not currently required since each assertion renders independently).
 */
function sanitizedId(assertion: IRAssertion): string {
  if (assertion.target.kind === 'element') {
    const id = assertion.target.elementId.replace(/[^a-zA-Z0-9]/g, '_');
    return id;
  }
  // Fallback for non-element targets — use a hash of the expectedValue
  const fallback = String(assertion.expectedValue ?? 'count').replace(/[^a-zA-Z0-9]/g, '_');
  return fallback || 'count';
}
