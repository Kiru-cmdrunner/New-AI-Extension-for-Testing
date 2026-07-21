/**
 * Playwright Generator — consumes Canonical Test Steps (with Execution JSON)
 * and produces one Playwright test() per Test Case.
 *
 * Milestone B6 (v5.1.0) — Implementation
 *
 * B5.1 §5.4: The Playwright Generator is a READ-ONLY consumer.
 *   - Reads step.executionJson for each step (never modifies it)
 *   - Translates action + locators into Playwright API calls
 *   - Produces Playwright test code as a string
 *   - Respects isManualEdit flag (not yet implemented — always fresh)
 *
 * B5.1 AP3: One-way dependency. The generator reads Steps with JSON,
 * never the Timeline.
 *
 * B5.1 AP5: Deterministic. Same steps → same code, every time.
 *
 * B6 Spec: Extensible action-mapping approach. Future interaction types
 * are added by extending the action map, not rewriting the generator.
 */

import type { CanonicalStep } from '../types';
import type { GeneratorResult } from '../types';
import type {
  GeneratorContract,
  PlaywrightGeneratorInput,
  PlaywrightGeneratorOutput,
} from '../contracts/generator-contract';
import type {
  ExecutionJsonObject,
  ExecutionLocator,
} from '../contracts/execution-json-types';

// ── Indentation ────────────────────────────────────────────

/** Indent inside test() body. */
const INDENT = '  ';

// ── Locator Strategy → Playwright Selector Translation ─────

/**
 * Translate a resolved locator into a Playwright locator expression.
 *
 * B5.2 §2.4: Each locator has { strategy, value, role }.
 * The strategy determines which Playwright API to use.
 *
 * B6 Spec: Uses the primary locator only for the generated selector.
 * Fallback locators are noted in comments for maintainability.
 */
function translateLocator(locator: ExecutionLocator): string {
  const { strategy, value } = locator;

  switch (strategy) {
    // ── Category 1: Business Identifiers ──
    case 'testId':
      return `getByTestId('${escapeString(value)}')`;
    case 'dataCy':
      return `locator('[data-cy="${escapeString(value)}"]')`;
    case 'dataQa':
      return `locator('[data-qa="${escapeString(value)}"]')`;
    case 'dataTest':
      return `locator('[data-test="${escapeString(value)}"]')`;
    case 'dataAutomationId':
      return `locator('[data-automation-id="${escapeString(value)}"]')`;

    // ── Category 2: Accessibility ──
    case 'ariaLabel':
      return `getByLabel('${escapeString(value)}')`;
    case 'ariaLabelledby':
      return `locator('[aria-labelledby="${escapeString(value)}"]')`;

    // ── Category 3: Stable Technical ──
    case 'id':
      return `locator('#${escapeCssId(value)}')`;
    case 'name':
      return `locator('[name="${escapeString(value)}"]')`;

    // ── Category 4: Content-Based ──
    case 'text':
      return `getByText('${escapeString(value)}')`;
    case 'placeholder':
      return `getByPlaceholder('${escapeString(value)}')`;
    case 'alt':
      return `getByAltText('${escapeString(value)}')`;
    case 'title':
      return `getByTitle('${escapeString(value)}')`;

    // ── Category 5: Structural ──
    case 'css':
      return `locator('${escapeCssSelector(value)}')`;
    case 'xpath':
      return `locator('xpath=${escapeString(value)}')`;

    default:
      return `locator('${escapeString(value)}')`;
  }
}

/**
 * Escape a string for safe use inside single-quoted Playwright selectors.
 */
function escapeString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Escape an ID for use in CSS ID selector (#id).
 * IDs can contain special chars that need escaping in CSS context.
 */
function escapeCssId(value: string): string {
  // For IDs, we keep it simple — if it's a valid CSS identifier, use as-is.
  // Otherwise fall back to attribute selector.
  if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(value)) {
    return value;
  }
  // Non-standard ID — this shouldn't normally happen since the locator engine
  // rejects auto-generated IDs, but handle gracefully.
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Escape a CSS selector for safe embedding in a Playwright locator string.
 */
function escapeCssSelector(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ── Action Type → Playwright Action Translation ────────────

/**
 * Build the Playwright action call for a single step.
 *
 * B6 Spec: Extensible action-mapping approach.
 * Each action type maps to a Playwright method call.
 *
 * Returns an object with the Playwright statement and optional comment lines.
 */
interface ActionTranslation {
  /** The Playwright statement(s) for this step. */
  statements: string[];
}

/**
 * Translate an Execution JSON action into a Playwright statement.
 *
 * Uses the primary locator for element actions.
 * Navigation actions use page.goto().
 */
function translateAction(json: ExecutionJsonObject): ActionTranslation {
  const { action, target, locators, context } = json;

  // Handle error steps — generate a commented placeholder
  if (json.meta.status === 'error') {
    return {
      statements: [`// ⚠️ Step generation failed: ${json.meta.warnings.join('; ')}`],
    };
  }

  // Resolve iframe frame prefix for element actions
  const framePrefix = context.iframe && context.frame ? buildFramePrefix(context.frame) : '';

  // Resolve primary locator for element actions
  const primaryLocator = locators.length > 0
    ? (locators.find((l) => l.role === 'primary') || locators[0])
    : null;

  switch (action.type) {
    case 'click': {
      if (target.kind !== 'element' || !primaryLocator) {
        return {
          statements: [`// ⚠️ Click step has no locators`],
        };
      }
      const selector = translateLocator(primaryLocator);
      const statement = `${framePrefix}${selector}.click();`;
      return { statements: [statement] };
    }

    case 'navigate': {
      const url = target.url || '';
      if (!url) {
        return { statements: [`// ⚠️ Navigation step has no URL`] };
      }
      return {
        statements: [`page.goto('${escapeString(url)}');`],
      };
    }

    // Future action types — extensible mapping
    case 'type':
    case 'fill': {
      if (!primaryLocator) {
        return { statements: [`// ⚠️ ${action.type} step has no locators`] };
      }
      const selector = translateLocator(primaryLocator);
      const value = action.value || '';
      return { statements: [`${framePrefix}${selector}.fill('${escapeString(value)}');`] };
    }

    case 'select': {
      // C4.1 §5.5: Distinguish radio-select from dropdown-select.
      // Radio buttons use Playwright's .check() to set checked=true.
      // Dropdown <select> elements use .selectOption().
      // The distinguishing signal is target.role === 'radio'.
      if (target.role === 'radio') {
        if (!primaryLocator) {
          return { statements: [`// ⚠️ Radio select step has no locators`] };
        }
        const selector = translateLocator(primaryLocator);
        return { statements: [`${framePrefix}${selector}.check();`] };
      }
      // Existing dropdown select behavior
      if (!primaryLocator) {
        return { statements: [`// ⚠️ Select step has no locators`] };
      }
      const selector = translateLocator(primaryLocator);
      const value = action.value || '';
      return { statements: [`${framePrefix}${selector}.selectOption('${escapeString(value)}');`] };
    }

    case 'check': {
      if (target.kind !== 'element' || !primaryLocator) {
        return { statements: [`// ⚠️ Check step has no locators`] };
      }
      const selector = translateLocator(primaryLocator);
      return { statements: [`${framePrefix}${selector}.check();`] };
    }

    case 'uncheck': {
      if (target.kind !== 'element' || !primaryLocator) {
        return { statements: [`// ⚠️ Uncheck step has no locators`] };
      }
      const selector = translateLocator(primaryLocator);
      return { statements: [`${framePrefix}${selector}.uncheck();`] };
    }

    case 'hover': {
      if (!primaryLocator) {
        return { statements: [`// ⚠️ Hover step has no locators`] };
      }
      const selector = translateLocator(primaryLocator);
      return { statements: [`${framePrefix}${selector}.hover();`] };
    }

    default:
      return { statements: [`// ⚠️ Unknown action type: ${action.type}`] };
  }
}

/**
 * Build a Playwright frame locator prefix for iframe context.
 *
 * B5.2 §2.5: When iframe=true, the target is inside an iframe.
 * Playwright needs frameLocator() to reach into frames.
 */
function buildFramePrefix(frame: NonNullable<ExecutionJsonObject['context']['frame']>): string {
  // Prefer frame selector for specificity
  if (frame.frameSelector) {
    return `frameLocator('${escapeCssSelector(frame.frameSelector)}').`;
  }
  if (frame.frameId) {
    return `frameLocator('#${escapeCssId(frame.frameId)}').`;
  }
  if (frame.frameName) {
    return `frameLocator('${escapeString(frame.frameName)}').`;
  }
  if (frame.frameIndex !== null && frame.frameIndex !== undefined) {
    return `frameLocator('iframe').nth(${frame.frameIndex}).`;
  }
  return '';
}

// ── Test Builder ───────────────────────────────────────────

/**
 * Build a complete Playwright test from an array of Canonical Steps.
 *
 * Structure:
 *   import { test, expect } from '@playwright/test';
 *
 *   test('Test Case Name', async ({ page }) => {
 *     // Step 1: Click "Search"
 *     await page.getByRole('button', { name: 'Search' }).click();
 *
 *     // Step 2: Navigate to results
 *     await page.goto('https://example.com/results');
 *   });
 */
function buildTest(
  steps: CanonicalStep[],
  testCaseName: string,
  recordingContext: { startUrl: string },
  expectedResult?: string,
): string {
  const lines: string[] = [];

  // Header import
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');

  // Test name — escape single quotes
  const testName = escapeString(testCaseName);

  lines.push(`test('${testName}', async ({ page }) => {`);

  // Navigate to start URL first (recording context)
  lines.push(`${INDENT}// Navigate to starting page`);
  lines.push(`${INDENT}await page.goto('${escapeString(recordingContext.startUrl)}');`);
  lines.push('');

  // Generate each step
  for (const step of steps) {
    const json = step.executionJson;
    if (!json) {
      lines.push(`${INDENT}// Step ${step.stepNumber}: ${step.plainEnglish}`);
      lines.push(`${INDENT}// ⚠️ No Execution JSON for this step`);
      lines.push('');
      continue;
    }

    // Traceability comment (B6 spec: comment referencing originating step)
    lines.push(`${INDENT}// Step ${step.stepNumber}: ${step.plainEnglish}`);

    const translation = translateAction(json);
    for (const stmt of translation.statements) {
      if (stmt.startsWith('//')) {
        lines.push(`${INDENT}${stmt}`);
      } else {
        lines.push(`${INDENT}await ${stmt}`);
      }
    }

    // Add fallback locator comment if there are secondary/fallback locators
    const fallbacks = json.locators.filter((l) => l.role !== 'primary');
    if (fallbacks.length > 0) {
      const fallbackStr = fallbacks
        .map((l) => `${l.role}: ${l.strategy}="${l.value}"`)
        .join(', ');
      lines.push(`${INDENT}// Fallback locators: ${fallbackStr}`);
    }

    // Error step warning
    if (json.meta.status === 'error') {
      lines.push(`${INDENT}// ⚠️ Execution JSON generation error — review this step`);
    }

    lines.push('');
  }

  // Optional expected result assertion
  if (expectedResult) {
    lines.push(`${INDENT}// Expected: ${escapeString(expectedResult)}`);
    lines.push('');
  }

  // Close test
  lines.push(`});`);

  return lines.join('\n');
}

// ── Generator Entry Point ──────────────────────────────────

/**
 * Generate one Playwright test from canonical steps.
 *
 * B5.1 §3.3: Reads steps with executionJson populated.
 * B6 Spec: Produces one test() per Test Case.
 *
 * @param input  Steps with executionJson, recording context, TC name.
 * @returns      GeneratorResult with PlaywrightGeneratorOutput.
 */
function generate(
  input: PlaywrightGeneratorInput,
): GeneratorResult<PlaywrightGeneratorOutput> {
  const { steps, recordingContext, testCaseName, expectedResult } = input;

  if (!steps || steps.length === 0) {
    return {
      status: 'failure',
      output: null,
      errors: [{
        stepIndex: null,
        message: 'No canonical steps provided for Playwright generation',
        recoverable: false,
      }],
    };
  }

  try {
    const testCode = buildTest(steps, testCaseName, recordingContext, expectedResult);

    return {
      status: 'success',
      output: {
        testCode,
        isManualEdit: false,
        generatedAt: new Date().toISOString(),
      },
      errors: [],
    };
  } catch (err) {
    return {
      status: 'failure',
      output: null,
      errors: [{
        stepIndex: null,
        message: `Playwright generation failed: ${err instanceof Error ? err.message : String(err)}`,
        recoverable: true,
      }],
    };
  }
}

// ── Generator Contract ─────────────────────────────────────

/**
 * The Playwright Generator contract.
 *
 * B5.1 §3.6: Registers with dependency on execution-json-generator.
 * B2 AP7: Extension by addition — one new file, no existing component modified.
 */
export const playwrightGenerator: GeneratorContract<
  PlaywrightGeneratorInput,
  PlaywrightGeneratorOutput
> = {
  name: 'playwright-generator',
  dependencies: ['execution-json-generator'],
  generate,
};

// ── Exports for testing ────────────────────────────────────

export { translateLocator, translateAction, buildTest };
