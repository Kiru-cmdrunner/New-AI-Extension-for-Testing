/**
 * Playwright Test Function Renderer — Milestone 3 + Milestone 5
 *
 * M3: Flat pattern — produces complete test files with inline locators.
 * M5: POM pattern — produces test files that use Page Object classes.
 *
 * Reference: execution-ir-design.md §2.7, §2.9
 */

import type { ExecutionIRPlan, IRStep } from '../../domain/execution-ir/types';
import { IRAction } from '../../domain/execution-ir/types';
import { renderAction } from './action-renderer';
import { renderAssertion } from './assertion-renderer';
import { buildPageObjects } from './page-object-renderer';

// ── Types ─────────────────────────────────────────────────

/** Options for rendering a test function. */
export interface RenderTestOptions {
  /** Indentation unit (default: '  ' — two spaces). */
  readonly indent?: string;
}

// ── Main Entry Point ──────────────────────────────────────

/**
 * Render a complete Playwright test file from an ExecutionIRPlan.
 *
 * @param plan    The execution IR plan.
 * @param options Optional rendering options.
 * @returns       Complete .spec.ts file content as a string.
 */
export function renderTestFile(plan: ExecutionIRPlan, options?: RenderTestOptions): string {
  const indent = options?.indent ?? '  ';
  const lines: string[] = [];

  // ── Import ───────────────────────────────────────────
  lines.push("import { test, expect } from '@playwright/test';");
  lines.push('');

  // ── Describe block ───────────────────────────────────
  const describeName = plan.title;
  lines.push(`test.describe('${escapeString(describeName)}', () => {`);

  // ── Test block ───────────────────────────────────────
  const testName = formatTestName(plan.title);
  lines.push(`${indent}test('${escapeString(testName)}', async ({ page }) => {`);

  // ── Body ─────────────────────────────────────────────
  const bodyIndent = indent + indent; // 4 spaces inside test body
  const bodyLines = renderTestBody(plan.steps, bodyIndent);
  lines.push(...bodyLines);

  // ── Close test + describe ────────────────────────────
  lines.push(`${indent}});`);
  lines.push('});');
  lines.push(''); // trailing newline

  return lines.join('\n');
}

/**
 * Render just the test body (steps → code lines) without the
 * import/describe/test wrapper. Useful for composition.
 */
export function renderTestBody(steps: IRStep[], indent: string): string[] {
  const lines: string[] = [];

  for (const step of steps) {
    // WAIT_FOR_ELEMENT is omitted entirely — Playwright auto-waits.
    if (step.action === IRAction.WAIT_FOR_ELEMENT) continue;

    // Step description as comment
    lines.push(`${indent}// ${step.description}`);

    // Action line (may be empty for VERIFY, WAIT with no output)
    const actionLine = renderAction(step, 'page', { indent });
    if (actionLine) {
      // All Playwright action methods are async and require await.
      lines.push(`${indent}await ${actionLine.trim()}`);
    }

    // Assertion lines (rendered after the action)
    for (const assertion of step.assertions) {
      const rendered = renderAssertion(assertion, 'page');
      for (const line of rendered.lines) {
        lines.push(`${indent}${line}`);
      }
    }

    // Blank line between steps for readability
    lines.push('');
  }

  // Remove trailing blank line if present
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Format a plan title as a test name with "should" prefix.
 * "Login Flow" → "should complete login flow successfully"
 * "User Registration" → "should complete user registration successfully"
 */
function formatTestName(title: string): string {
  // Lowercase the first character only, keep the rest as-is.
  const lower = title.charAt(0).toLowerCase() + title.slice(1);
  return `should complete ${lower} successfully`;
}

/**
 * Render a complete POM test file from an ExecutionIRPlan.
 *
 * POM mode: element interactions delegate to page object methods,
 * assertions use page object locator getters via targetOverride.
 */
export function renderPomTestFile(plan: ExecutionIRPlan): string {
  const indent = '  ';
  const bodyIndent = '    ';
  const poms = buildPageObjects(plan);
  const lines: string[] = [];

  // ── Imports ─────────────────────────────────────────
  lines.push("import { test, expect } from '@playwright/test';");
  for (const pom of poms) {
    const importPath = pom.fileName.replace(/\.ts$/, '');
    lines.push(`import { ${pom.className} } from '../pages/${importPath}';`);
  }
  lines.push('');

  // ── Describe block ───────────────────────────────────
  lines.push(`test.describe('${escapeString(plan.title)}', () => {`);

  // ── Test block ───────────────────────────────────────
  const testName = formatTestName(plan.title);
  lines.push(`${indent}test('${escapeString(testName)}', async ({ page }) => {`);

  // ── Page Object instantiation ────────────────────────
  const instanceMap = new Map<string, string>(); // pageName → instance name
  for (const pom of poms) {
    const instanceName = toCamelInstanceName(pom.className);
    instanceMap.set(pom.pageName, instanceName);
    lines.push(`${bodyIndent}const ${instanceName} = new ${pom.className}(page);`);
  }
  if (poms.length > 0) {
    lines.push('');
  }

  // ── Build elementId → POM target expression lookup ──
  const elementTargetLookup = new Map<string, string>();
  for (const pom of poms) {
    const instanceName = toCamelInstanceName(pom.className);
    for (const element of pom.elements) {
      elementTargetLookup.set(element.elementId, `${instanceName}.${element.getterName}`);
    }
  }

  // ── Build elementId+action → method name lookup ────
  const methodLookup = new Map<string, { instanceName: string; methodName: string }>();
  for (const pom of poms) {
    const instanceName = toCamelInstanceName(pom.className);
    for (const method of pom.methods) {
      methodLookup.set(`${method.action}:${method.elementGetter}`, {
        instanceName,
        methodName: method.methodName,
      });
    }
  }

  // ── Body ─────────────────────────────────────────────
  const bodyLines = renderPomTestBody(plan.steps, elementTargetLookup, methodLookup, bodyIndent);
  lines.push(...bodyLines);

  // ── Close test + describe ────────────────────────────
  lines.push(`${indent}});`);
  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

/**
 * Render the POM test body. Element-interacting steps delegate to
 * page object methods. Assertions use page object locator getters.
 */
function renderPomTestBody(
  steps: IRStep[],
  elementTargetLookup: Map<string, string>,
  methodLookup: Map<string, { instanceName: string; methodName: string }>,
  indent: string,
): string[] {
  const lines: string[] = [];

  for (const step of steps) {
    if (step.action === IRAction.WAIT_FOR_ELEMENT) continue;

    lines.push(`${indent}// ${step.description}`);

    if (step.action === IRAction.NAVIGATE || step.action === IRAction.WAIT) {
      // Page-level actions stay as raw page calls
      const actionLine = renderAction(step, 'page', { indent: '' });
      if (actionLine) lines.push(`${indent}await ${actionLine.trim()}`);
    } else if (step.target.kind === 'element') {
      const target = step.target;
      const pomTarget = elementTargetLookup.get(target.elementId);

      if (pomTarget) {
        // Find matching method by getter name
        const getterName = getterNameFromElementName(target.elementName);
        const methodKey = `${step.action}:${getterName}`;
        const method = methodLookup.get(methodKey);

        if (method && step.action !== IRAction.VERIFY) {
          const params = renderMethodParams(step);
          lines.push(`${indent}await ${method.instanceName}.${method.methodName}(${params})`);
        } else {
          // VERIFY or no method — no action line (assertions follow)
        }
      } else {
        // Unknown page — fall back to flat rendering
        const actionLine = renderAction(step, 'page', { indent: '' });
        if (actionLine) lines.push(`${indent}await ${actionLine.trim()}`);
      }
    }

    // Assertions — use POM locator getter when available
    for (const assertion of step.assertions) {
      let targetOverride: string | undefined;
      if (assertion.target.kind === 'element') {
        targetOverride = elementTargetLookup.get(assertion.target.elementId);
      }
      const rendered = renderAssertion(assertion, 'page', targetOverride);
      for (const line of rendered.lines) {
        lines.push(`${indent}${line}`);
      }
    }

    lines.push('');
  }

  // Remove trailing blank line
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
}

/**
 * Render method call parameters based on action type.
 */
function renderMethodParams(step: IRStep): string {
  switch (step.action) {
    case IRAction.FILL:
    case IRAction.SELECT:
    case IRAction.SELECT_DATE:
      return `'${escapeString(String(step.input ?? ''))}'`;
    default:
      return '';
  }
}

/**
 * Derive the getter name from an element name (must match page-object-renderer).
 */
function getterNameFromElementName(elementName: string): string {
  return elementName
    .split(/\s+/)
    .map((word, i) =>
      i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
}

/**
 * Convert a PascalCase class name to a camelCase instance name.
 * "LoginPage" → "loginPage"
 */
function toCamelInstanceName(className: string): string {
  return className.charAt(0).toLowerCase() + className.slice(1);
}

/**
 * Escape a string for safe embedding in single-quoted code.
 * Same escaping as other renderers.
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
