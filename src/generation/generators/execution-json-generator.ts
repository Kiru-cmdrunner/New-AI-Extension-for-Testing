/**
 * Execution JSON Generator — transforms Canonical Test Steps (executionJson=null)
 * into Steps with executionJson populated (per frozen B5.2 contract).
 *
 * Milestone B5.3 (v5.0.0) — Implementation
 *
 * B5.1 §3.2: The generator reads steps with executionJson=null, passes each
 * step's elementIdentity to the Locator Resolution Engine, constructs the
 * Execution Object (six B4.2 categories), serializes it as Execution JSON,
 * and embeds it in step.executionJson.
 *
 * B5.1 §5.1: The generator does NOT read the Timeline, call AI services,
 * write to storage directly, or generate Playwright code.
 *
 * B5.1 AP5 / B4.5 EJ-P2: Pure function — deterministic, same input → same output.
 * B5.1 §3.5: Per-step error isolation — a failure in one step does not prevent
 * other steps from generating.
 */

import type { ElementIdentity } from '../../shared/types';
import type { GeneratorResult, CanonicalStep } from '../types';
import type {
  GeneratorContract,
  ExecutionJsonGeneratorInput,
} from '../contracts/generator-contract';
import type {
  ExecutionJsonObject,
  ExecutionAction,
  ExecutionTarget,
  ExecutionLocator,
  ExecutionContext,
  ExecutionTrace,
  ExecutionMeta,
} from '../contracts/execution-json-types';
import { resolveLocators } from '../engine/locator-resolution-engine';
import { lookupExecutionVerb } from '../verb-mapping-table';
import { normalizeToCanonical } from '../engine/step-to-semantic';

// ── Types for the generator's working representation ───────

/**
 * A Canonical Step that has passed through the Execution JSON Generator.
 * The only difference from the B3 CanonicalStep is that executionJson is
 * now populated (or null on failure for that step).
 */
type StepWithExecutionJson = Omit<import('../types').CanonicalStep, 'executionJson'> & {
  executionJson: ExecutionJsonObject;
};

// ── Action Type Mapping (via frozen verb-mapping-table) ────

/**
 * Resolve the B5.2 abstract action verb for a Canonical Step.
 *
 * Phase 3 Integration Step 2: The legacy inline if-chain (mapActionType) has
 * been replaced by the frozen verb-mapping-table.ts. This function:
 *   1. Normalizes the step's actionType to a CanonicalType (handles both
 *      legacy types like 'checkbox' and canonical types like 'toggle').
 *   2. Looks up the execution verb via lookupExecutionVerb().
 *
 * For toggle (checkbox), the checked state resolves to check/uncheck.
 * For navigate, the URL is in the target, not the value field.
 *
 * B5.2 §2.2: action.type is framework-agnostic. The mapping is deterministic.
 */
function resolveActionVerb(
  actionType: string,
  checked: boolean | null,
): string {
  const canonicalType = normalizeToCanonical(actionType);
  return lookupExecutionVerb(canonicalType, checked ?? undefined);
}

// ── Target Section Construction ────────────────────────────

/**
 * Build the target section for an element action (e.g. click).
 *
 * B5.2 §2.3: kind = "element", tag + name required, role optional.
 */
function buildElementTarget(identity: ElementIdentity): ExecutionTarget {
  return {
    kind: 'element',
    tag: identity.tag,
    role: identity.ariaRole,
    name: identity.accessibleName || identity.tag,
  };
}

/**
 * Build the target section for a navigation action.
 *
 * B5.2 §2.3: kind = "navigation", url required.
 * The URL is stored in elementIdentity.accessibleName by the canonical step
 * generator for navigation steps. We also check for a url-like field.
 */
function buildNavigationTarget(step: import('../types').CanonicalStep): ExecutionTarget {
  // The canonical step generator stores URL in accessibleName for navigation
  const url = step.elementIdentity.accessibleName || '';
  return {
    kind: 'navigation',
    url,
  };
}

// ── Context Section Construction ───────────────────────────

/**
 * Build the context section from element identity.
 *
 * B5.2 §2.5: iframe (bool), shadowDom (bool), frame (IframeContext|null).
 */
function buildContext(identity: ElementIdentity): ExecutionContext {
  return {
    iframe: identity.inIframe ?? false,
    shadowDom: identity.shadowDom ?? false,
    frame: identity.inIframe && identity.iframeContext ? identity.iframeContext : null,
  };
}

// ── Single Step Processing ─────────────────────────────────

/**
 * Process one Canonical Step and produce its Execution JSON.
 *
 * This function NEVER throws — it returns an error marker on failure
 * (B5.1 §3.5, §7.3).
 */
function processStep(
  step: import('../types').CanonicalStep,
): { json: ExecutionJsonObject; warnings: string[]; failed: boolean } {
  const warnings: string[] = [];

  // Build trace section (always succeeds)
  const trace: ExecutionTrace = {
    interactionId: step.linkedInteractionId,
    stepId: step.stepId,
  };

  // Build action section — verb resolved via frozen verb-mapping-table
  const mappedActionType = resolveActionVerb(step.actionType, step.checked ?? null);
  const action: ExecutionAction = {
    type: mappedActionType,
    // Text-entry actions carry the user-entered value
    value: step.value ?? null,
  };

  const isNavigation = normalizeToCanonical(step.actionType) === 'navigate';

  // Build target section
  let target: ExecutionTarget;
  if (isNavigation) {
    target = buildNavigationTarget(step);
  } else {
    target = buildElementTarget(step.elementIdentity);
  }

  // Build locators section
  let locators: ExecutionLocator[] = [];
  if (!isNavigation) {
    // Only element actions have locators (B4.4 §4.5)
    const resolution = resolveLocators(step.elementIdentity);
    locators = resolution.locators;
    warnings.push(...resolution.warnings);

    // If locator resolution found nothing, this is an error
    if (locators.length === 0) {
      const json: ExecutionJsonObject = {
        action,
        target,
        locators: [],
        context: buildContext(step.elementIdentity),
        trace,
        meta: {
          status: 'error',
          warnings: [...warnings],
          generatedAt: new Date().toISOString(),
        },
      };
      return { json, warnings, failed: true };
    }
  }

  // Build context section
  const context = buildContext(step.elementIdentity);

  // Build metadata
  const meta: ExecutionMeta = {
    status: 'generated',
    warnings,
    generatedAt: new Date().toISOString(),
  };

  const json: ExecutionJsonObject = {
    action,
    target,
    locators,
    context,
    trace,
    meta,
  };

  return { json, warnings, failed: false };
}

// ── Generator Entry Point ──────────────────────────────────

/**
 * Generate Execution JSON for all canonical steps.
 *
 * B5.1 §3.3: For each step, extract elementIdentity, resolve locators,
 * construct the Execution Object, serialize as JSON, embed in step.
 *
 * B5.1 §3.5: Per-step error isolation. Failed steps carry error marker,
 * not null. Pipeline continues.
 *
 * @param input  Steps with executionJson = null (from canonical step generator).
 * @returns      GeneratorResult with steps (executionJson populated).
 */
function generate(
  input: ExecutionJsonGeneratorInput,
): GeneratorResult<CanonicalStep[]> {
  const { steps } = input;
  const errors: GeneratorResult<unknown>['errors'] = [];

  if (!steps || steps.length === 0) {
    return {
      status: 'success',
      output: [],
      errors: [],
    };
  }

  const resultSteps: StepWithExecutionJson[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    const { json, failed } = processStep(step);

    if (failed) {
      errors.push({
        stepIndex: i,
        message: `Step ${i + 1}: Execution JSON generation failed — ${json.meta.warnings.join('; ')}`,
        recoverable: true,
      });
    }

    // Even failed steps get embedded (with error status) — never null
    resultSteps.push({
      ...step,
      executionJson: json,
    });
  }

  const status: 'success' | 'partial' | 'failure' =
    errors.length === steps.length && steps.length > 0 ? 'partial' :
    errors.length > 0 ? 'partial' :
    'success';

  return {
    status,
    output: resultSteps as CanonicalStep[],
    errors,
  };
}

// ── Generator Contract ─────────────────────────────────────

/**
 * The Execution JSON Generator contract.
 *
 * B5.1 §3.6: Registers with dependency on canonical-step-generator.
 * B2 AP7: Extension by addition — one new file, no existing component modified.
 */
export const executionJsonGenerator: GeneratorContract<
  ExecutionJsonGeneratorInput,
  CanonicalStep[]
> = {
  name: 'execution-json-generator',
  dependencies: ['canonical-step-generator'],
  generate,
};
