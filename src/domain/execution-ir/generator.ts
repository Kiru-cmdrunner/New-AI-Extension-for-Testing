/**
 * Execution IR Generator — execution-ir-design.md §5
 *
 * Transforms (ATC version + Element Repository state + Environment) into an
 * ExecutionIRPlan wrapped in an ExecutionIRArtifact.
 *
 * The generator is a pure function — it doesn't query the database. The caller
 * (service layer) fetches the elements via the repository and passes them in.
 * This keeps the generator testable in isolation.
 *
 * Generation process:
 *   1. For each ATC step: map StepAction → IRAction (1:1 identity)
 *   2. Resolve elementId → ElementTarget with ResolvedLocators (snapshot)
 *   3. Resolve input → IRInput (literal in V1)
 *   4. Resolve validations → IRAssertion[] (elementId → ResolvedTarget)
 *   5. Apply default ExecutionParameters
 *   6. Inject WAIT_FOR_ELEMENT steps before element-interacting steps
 *
 * Reference: execution-ir-design.md §5
 */

import type {
  ApprovedTestCase,
  TestCaseVersion,
  Step,
  Validation,
} from '../entities/approved-test-case';
import type { Element } from '../entities/element';
import { StepAction } from '../enums';
import { MissingFieldError, ValueObjectError } from '../errors/invariant-errors';
import type {
  ExecutionIRArtifact,
  ExecutionIRPlan,
  IRStep,
  IRAction,
  ResolvedTarget,
  ElementTarget,
  IRAssertion,
  IRInput,
  IREnvironment,
} from './types';
import { IRAction as IRActionEnum, DEFAULT_EXECUTION_PARAMETERS } from './types';

// ── Generator Interface ───────────────────────────────────

export interface IRGenerator {
  /**
   * Generate an Execution IR from an ATC version and resolved elements.
   *
   * @param testCase   The Approved Test Case (for title, tags).
   * @param version    The ATC version (for steps, version number).
   * @param elements   All elements referenced by the version's steps,
   *                   keyed by element ID. Pre-fetched by the caller.
   * @param environment Resolved environment configuration.
   * @returns          ExecutionIRArtifact (ready to cache).
   */
  generate(
    testCase: ApprovedTestCase,
    version: TestCaseVersion,
    elements: Map<string, Element>,
    environment: IREnvironment,
  ): ExecutionIRArtifact;

  /** Current generator version string (for staleness detection). */
  readonly version: string;
}

// ── DefaultIRGenerator ────────────────────────────────────

/** Current version of the default generator. Incremented when generation logic changes. */
export const GENERATOR_VERSION = 'ir-gen-1.0.0';

/** Actions that interact with an element and should be preceded by a wait. */
const ELEMENT_INTERACTING_ACTIONS: ReadonlySet<IRAction> = new Set([
  IRActionEnum.CLICK,
  IRActionEnum.FILL,
  IRActionEnum.SELECT,
  IRActionEnum.SELECT_DATE,
  IRActionEnum.TOGGLE,
  IRActionEnum.HOVER,
]);

/** Actions that do NOT require an element target. */
const NO_ELEMENT_ACTIONS: ReadonlySet<StepAction> = new Set([
  StepAction.NAVIGATE,
  StepAction.WAIT,
]);

/**
 * The default IR generator. Pure function — no side effects, no DB access.
 */
export class DefaultIRGenerator implements IRGenerator {
  readonly version = GENERATOR_VERSION;

  generate(
    testCase: ApprovedTestCase,
    version: TestCaseVersion,
    elements: Map<string, Element>,
    environment: IREnvironment,
  ): ExecutionIRArtifact {
    // Build the IR steps, injecting WAIT_FOR_ELEMENT where needed.
    const irSteps: IRStep[] = [];
    let irOrder = 0;

    for (const step of version.steps) {
      // Inject WAIT_FOR_ELEMENT before element-interacting steps
      // (when waitStrategy is not 'none').
      if (
        this.shouldInjectWait(step) &&
        step.elementId &&
        elements.has(step.elementId)
      ) {
        irSteps.push(
          this.buildWaitForElementStep(
            step.elementId,
            elements,
            irOrder,
          ),
        );
        irOrder++;
      }

      irSteps.push(this.transformStep(step, elements, environment, irOrder));
      irOrder++;
    }

    const plan: ExecutionIRPlan = {
      testCaseId: testCase.id,
      testCaseVersionId: version.id,
      testCaseVersionNumber: version.versionNumber,
      title: testCase.title,
      tags: [...testCase.tags],
      environment,
      steps: irSteps,
    };

    return {
      id: crypto.randomUUID(),
      testCaseVersionId: version.id,
      plan,
      generatedAt: new Date().toISOString(),
      generatorVersion: this.version,
      renderings: {},
    };
  }

  // ── Private helpers ─────────────────────────────────────

  /**
   * Determine whether a WAIT_FOR_ELEMENT step should be injected
   * before the given ATC step.
   */
  private shouldInjectWait(
    step: Step,
  ): boolean {
    // Only inject before actions that interact with an element.
    if (NO_ELEMENT_ACTIONS.has(step.action)) return false;
    if (!step.elementId) return false;

    // Check if the mapped IRAction is an element-interacting action.
    const irAction = mapStepActionToIRAction(step.action);
    if (!ELEMENT_INTERACTING_ACTIONS.has(irAction)) return false;

    // V1: default waitStrategy is 'visible', so we always inject.
    // When environment drives execution parameters, this check becomes:
    //   return executionDefaults.waitStrategy !== 'none';
    return DEFAULT_EXECUTION_PARAMETERS.waitStrategy !== 'none';
  }

  /**
   * Build an injected WAIT_FOR_ELEMENT step.
   */
  private buildWaitForElementStep(
    elementId: string,
    elements: Map<string, Element>,
    order: number,
  ): IRStep {
    const element = elements.get(elementId);
    if (!element) {
      throw new ValueObjectError(
        'IRStep',
        `Cannot resolve element "${elementId}" for WAIT_FOR_ELEMENT step`,
      );
    }

    return {
      id: crypto.randomUUID(),
      order,
      action: IRActionEnum.WAIT_FOR_ELEMENT,
      description: `(implicit) Wait for ${element.logicalName} to be ready`,
      target: resolveElementTarget(element),
      input: null,
      assertions: [],
      executionParameters: { ...DEFAULT_EXECUTION_PARAMETERS },
    };
  }

  /**
   * Transform a single ATC step into an IR step.
   */
  private transformStep(
    step: Step,
    elements: Map<string, Element>,
    environment: IREnvironment,
    order: number,
  ): IRStep {
    const action = mapStepActionToIRAction(step.action);
    const target = this.resolveTarget(step, elements, environment);
    const assertions = step.validations.map(v =>
      this.transformValidation(v, elements),
    );

    return {
      id: step.id,
      order,
      action,
      description: step.description,
      target,
      input: this.resolveInput(step),
      assertions,
      executionParameters: this.resolveExecutionParameters(step),
    };
  }

  /**
   * Resolve a step's target based on its action and elementId.
   */
  private resolveTarget(
    step: Step,
    elements: Map<string, Element>,
    environment: IREnvironment,
  ): ResolvedTarget {
    // Navigate steps target a URL.
    if (step.action === StepAction.NAVIGATE) {
      return this.resolveUrlTarget(step, environment);
    }

    // Wait steps have no target.
    if (step.action === StepAction.WAIT) {
      return { kind: 'none' };
    }

    // Element-based steps: resolve the element.
    if (!step.elementId) {
      throw new MissingFieldError('IRStep', `elementId for action "${step.action}"`);
    }

    const element = elements.get(step.elementId);
    if (!element) {
      throw new ValueObjectError(
        'IRStep',
        `Cannot resolve element "${step.elementId}" referenced by step "${step.description}"`,
      );
    }

    return resolveElementTarget(element);
  }

  /**
   * Resolve execution parameters for a step.
   * Non-element steps (navigate, wait) use waitStrategy 'none' since
   * they don't interact with DOM elements.
   */
  private resolveExecutionParameters(step: Step): import('./types').ExecutionParameters {
    if (NO_ELEMENT_ACTIONS.has(step.action)) {
      return { ...DEFAULT_EXECUTION_PARAMETERS, waitStrategy: 'none' };
    }
    return { ...DEFAULT_EXECUTION_PARAMETERS };
  }

  /**
   * Resolve a URL target for navigation steps.
   * Absolute URLs are used as-is; relative URLs are prepended with baseUrl.
   */
  private resolveUrlTarget(step: Step, environment: IREnvironment): ResolvedTarget {
    const rawUrl = typeof step.input === 'string' ? step.input : '';

    if (!rawUrl) {
      // If no URL in input, use baseUrl as the target.
      return { kind: 'url', url: environment.baseUrl };
    }

    // Absolute URL — use as-is.
    if (/^https?:\/\//i.test(rawUrl)) {
      return { kind: 'url', url: rawUrl };
    }

    // Relative URL — prepend baseUrl.
    const normalizedBase = environment.baseUrl.replace(/\/+$/, '');
    const normalizedPath = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
    return { kind: 'url', url: `${normalizedBase}${normalizedPath}` };
  }

  /**
   * Resolve a step's input value.
   */
  private resolveInput(step: Step): IRInput {
    if (step.input === null || step.input === undefined) {
      return null;
    }
    if (typeof step.input === 'string' || typeof step.input === 'number' || typeof step.input === 'boolean') {
      return step.input;
    }
    // Non-primitive inputs are serialized as JSON strings.
    return JSON.stringify(step.input);
  }

  /**
   * Transform an ATC Validation into an IRAssertion.
   */
  private transformValidation(
    validation: Validation,
    elements: Map<string, Element>,
  ): IRAssertion {
    let target: ResolvedTarget;

    if (validation.elementId) {
      const element = elements.get(validation.elementId);
      if (!element) {
        throw new ValueObjectError(
          'IRAssertion',
          `Cannot resolve element "${validation.elementId}" referenced by validation`,
        );
      }
      target = resolveElementTarget(element);
    } else {
      // URL-based or custom validations have no element target.
      target = { kind: 'none' };
    }

    return {
      type: validation.type,
      comparison: validation.comparison,
      expectedValue: validation.expectedValue,
      severity: validation.severity,
      target,
      property: validation.property,
    };
  }
}

// ── Module-level helpers ──────────────────────────────────

/**
 * Map a domain StepAction to an IRAction.
 * 1:1 identity for all 9 business-authored actions.
 * This is the canonical mapping — no transformation, just type alignment.
 *
 * @throws Error if the StepAction has no IRAction counterpart.
 */
export function mapStepActionToIRAction(stepAction: StepAction): IRAction {
  const mapping: Record<StepAction, IRAction> = {
    [StepAction.CLICK]: IRActionEnum.CLICK,
    [StepAction.FILL]: IRActionEnum.FILL,
    [StepAction.SELECT]: IRActionEnum.SELECT,
    [StepAction.SELECT_DATE]: IRActionEnum.SELECT_DATE,
    [StepAction.TOGGLE]: IRActionEnum.TOGGLE,
    [StepAction.HOVER]: IRActionEnum.HOVER,
    [StepAction.NAVIGATE]: IRActionEnum.NAVIGATE,
    [StepAction.VERIFY]: IRActionEnum.VERIFY,
    [StepAction.WAIT]: IRActionEnum.WAIT,
  };

  const irAction = mapping[stepAction];
  if (!irAction) {
    throw new ValueObjectError('IRAction', `No IRAction mapping for StepAction "${stepAction}"`);
  }
  return irAction;
}

/**
 * Resolve an Element into an ElementTarget with ResolvedLocators.
 * This is the snapshot point — locators are copied, not referenced.
 */
export function resolveElementTarget(element: Element): ElementTarget {
  return {
    kind: 'element',
    elementId: element.id,
    elementName: element.logicalName,
    pageOrComponent: element.pageOrComponent,
    resolvedLocators: element.locatorStrategies.map(s => ({
      type: s.type,
      value: s.value,
      priority: s.priority,
      confidence: s.confidence,
    })),
  };
}
