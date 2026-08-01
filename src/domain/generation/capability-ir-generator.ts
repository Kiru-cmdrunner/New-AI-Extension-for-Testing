/**
 * Capability IR Generator — orchestrates P2 transformation from
 * P2CapabilityContract to ExecutionIRPlan.
 *
 * Design: .drytis/specs/p2-capability-derived-ir-generation.md §4.3
 *
 * Flow:
 *   1. Recover source RecordingSession.
 *   2. Bind fields to session elements (ElementBindingResolver).
 *   3. Build identity index from rawInteractions.
 *   4. Resolve targets via full identity + R4 matchElements (ElementTargetResolver).
 *   5. Resolve test data (DataResolver).
 *   6. Map inputMethod → IRAction (IRActionMapper).
 *   7. Resolve success criteria (SuccessCriterionResolver).
 *   8. Assemble ExecutionIRPlan.
 *
 * P2 is read-only with respect to the Element Repository.
 */

import type { P2CapabilityContract } from '../entities/p2-capability-contract';
import type { RecordingSession } from '../entities/recording-session';
import type { Element } from '../entities/element';
import type {
  ExecutionIRPlan,
  IRStep,
  IREnvironment,
} from '../execution-ir/types';
import { IRAction } from '../execution-ir/types';
import { DEFAULT_EXECUTION_PARAMETERS } from '../execution-ir/types';
import type { UnitOfWorkFactory } from '../../repository/v2/interfaces/unit-of-work';
import type { CapabilityIRResult, ResolutionWarning, P2GenerationInput } from './p2-types';
import { resolveTestData } from './data-resolver';
import { resolveFieldBindings } from './element-binding-resolver';
import {
  buildInteractionIndex,
  buildEventIdentityIndex,
  resolveTargets,
} from './element-target-resolver';
import { inputMethodToIRAction } from './ir-action-mapper';
import { resolveSuccessCriteria } from './success-criterion-resolver';

/**
 * Generate a capability-derived ExecutionIRPlan.
 *
 * @param input Generation input (contract, testData, projectId, environment)
 * @param uowFactory UnitOfWork factory for repository access
 * @returns IR plan + warnings + resolution metadata
 */
export async function generateCapabilityIR(
  input: P2GenerationInput,
  uowFactory: UnitOfWorkFactory,
): Promise<CapabilityIRResult> {
  const { contract, testData, projectId, environment, variantLabel } = input;
  const warnings: ResolutionWarning[] = [];

  // Step 1: Recover source session
  const uow = uowFactory.create();
  const result = await uow.execute(async (repos) => {
    let session: RecordingSession | undefined;
    const sessionId = contract.sourceSessionId;

    if (sessionId) {
      session = await repos.recordingSessions.getById(sessionId);
    }

    if (!session) {
      // Session not found — all fields unresolved
      warnings.push({
        field: '*',
        reason: sessionId ? 'session-not-found' : 'missing-source-session',
        message: sessionId
          ? `Source session "${sessionId}" not found in repository`
          : 'Contract has no sourceSessionId',
      });
    }

    // Step 2: Get stored Elements
    const storedElements: Element[] = await repos.elements.getByProject(projectId);

    return { session, storedElements };
  });

  const session = result.session;
  const storedElements = result.storedElements;

  // If no session, produce a plan with all unresolved targets
  if (!session) {
    return buildUnresolvedResult(contract, environment, variantLabel, warnings);
  }

  // Step 3: Bind fields to session elements
  const { bindings, warnings: bindingWarnings } = resolveFieldBindings(
    contract.dataRequirements,
    session,
  );
  warnings.push(
    ...bindingWarnings.map((w) => ({
      field: w.field,
      reason: w.reason as ResolutionWarning['reason'],
      message: w.message,
    })),
  );

  // Step 4: Build identity indexes
  const interactionIndex = buildInteractionIndex(session);
  const eventIdentityIndex = buildEventIdentityIndex(session);

  // Step 5: Resolve targets via full identity recovery + R4 matching
  const { targets, warnings: targetWarnings, resolvedFields } = resolveTargets(
    bindings,
    interactionIndex,
    eventIdentityIndex,
    storedElements,
  );
  warnings.push(...targetWarnings);

  // Step 6: Resolve test data
  const { resolved: resolvedData, warnings: dataWarnings } = resolveTestData(
    contract.dataRequirements,
    testData,
  );
  warnings.push(
    ...dataWarnings.map((w) => ({
      field: w.field,
      reason: w.reason as ResolutionWarning['reason'],
      message: w.message,
    })),
  );

  // Step 7: Resolve success criteria
  const { assertions, warnings: scWarnings } = resolveSuccessCriteria(
    contract.successCriteria,
    session,
    storedElements,
    interactionIndex,
    eventIdentityIndex,
    environment,
  );
  warnings.push(...scWarnings);

  // Step 8: Assemble IR plan
  const steps = assembleSteps(
    contract,
    targets,
    resolvedData,
    environment,
  );

  // Attach assertions to the last step (VERIFY step)
  if (steps.length > 0 && assertions.length > 0) {
    const lastStep = steps[steps.length - 1];
    if (lastStep.action === IRAction.VERIFY) {
      steps[steps.length - 1] = {
        ...lastStep,
        assertions,
      };
    }
  }

  const hasUnresolvedTargets = Array.from(targets.values()).some(
    (t) => t.kind === 'none',
  );

  const plan: ExecutionIRPlan = {
    testCaseId: `p2-${contract.capabilityId}`,
    testCaseVersionId: `p2-${contract.versionId}-data-${variantLabel ?? 'default'}`,
    testCaseVersionNumber: contract.versionNumber,
    title: variantLabel
      ? `${contract.name} — ${variantLabel}`
      : contract.name,
    tags: ['capability-derived', 'p2'],
    environment,
    steps,
  };

  return {
    plan,
    warnings,
    hasUnresolvedTargets,
    resolvedFields,
  };
}

// ── Internal ─────────────────────────────────────────────────

function assembleSteps(
  contract: P2CapabilityContract,
  targets: Map<string, import('../execution-ir/types').ResolvedTarget>,
  resolvedData: ReadonlyMap<string, string | number | boolean>,
  environment: IREnvironment,
): IRStep[] {
  const steps: IRStep[] = [];
  let order = 0;

  // Step 0: Navigate to entry point
  const entryUrl = contract.entryPoint.url.startsWith('http')
    ? contract.entryPoint.url
    : `${environment.baseUrl}${contract.entryPoint.url}`;

  steps.push({
    id: 'step-0',
    order: order++,
    action: IRAction.NAVIGATE,
    description: `Navigate to ${contract.entryPoint.url}`,
    target: { kind: 'url', url: entryUrl },
    input: null,
    assertions: [],
    executionParameters: DEFAULT_EXECUTION_PARAMETERS,
  });

  // Steps 1..N: One step per resolved data requirement
  for (const req of contract.dataRequirements) {
    const target = targets.get(req.field);
    const value = resolvedData.get(req.field);

    // Skip if data is missing (already warned)
    if (value === undefined) continue;

    const action = inputMethodToIRAction(req.inputMethod);
    const targetResolved = target ?? { kind: 'none' as const };

    steps.push({
      id: `step-${order}`,
      order: order++,
      action,
      description: buildStepDescription(req.field, req.inputMethod, value, targetResolved),
      target: targetResolved,
      input: value,
      assertions: [],
      executionParameters: DEFAULT_EXECUTION_PARAMETERS,
    });
  }

  // Final step: VERIFY (success criteria)
  steps.push({
    id: `step-${order}`,
    order: order++,
    action: IRAction.VERIFY,
    description: 'Verify success criteria',
    target: { kind: 'none' },
    input: null,
    assertions: [], // Populated by caller after assembly
    executionParameters: DEFAULT_EXECUTION_PARAMETERS,
  });

  return steps;
}

function buildStepDescription(
  field: string,
  inputMethod: string | null,
  value: string | number | boolean,
  target: import('../execution-ir/types').ResolvedTarget,
): string {
  const targetDesc = target.kind === 'element'
    ? ` (${target.elementName})`
    : '';

  switch (inputMethod) {
    case 'dropdown':
      return `Select "${value}" from ${field}${targetDesc}`;
    case 'toggle':
      return `Toggle ${field} to ${value}${targetDesc}`;
    case 'slider':
      return `Set ${field} to ${value}${targetDesc}`;
    case 'datePicker':
      return `Select date "${value}" for ${field}${targetDesc}`;
    case 'fileUpload':
      return `Upload "${value}" to ${field}${targetDesc}`;
    case 'text':
    case null:
    default:
      return `Enter "${value}" into ${field}${targetDesc}`;
  }
}

function buildUnresolvedResult(
  contract: P2CapabilityContract,
  environment: IREnvironment,
  variantLabel: string | undefined,
  warnings: ResolutionWarning[],
): CapabilityIRResult {
  // Produce a plan with NAVIGATE + no field steps + VERIFY
  const entryUrl = contract.entryPoint.url.startsWith('http')
    ? contract.entryPoint.url
    : `${environment.baseUrl}${contract.entryPoint.url}`;

  const steps: IRStep[] = [
    {
      id: 'step-0',
      order: 0,
      action: IRAction.NAVIGATE,
      description: `Navigate to ${contract.entryPoint.url}`,
      target: { kind: 'url', url: entryUrl },
      input: null,
      assertions: [],
      executionParameters: DEFAULT_EXECUTION_PARAMETERS,
    },
    {
      id: 'step-1',
      order: 1,
      action: IRAction.VERIFY,
      description: 'Verify success criteria',
      target: { kind: 'none' },
      input: null,
      assertions: [],
      executionParameters: DEFAULT_EXECUTION_PARAMETERS,
    },
  ];

  return {
    plan: {
      testCaseId: `p2-${contract.capabilityId}`,
      testCaseVersionId: `p2-${contract.versionId}-data-${variantLabel ?? 'default'}`,
      testCaseVersionNumber: contract.versionNumber,
      title: variantLabel ? `${contract.name} — ${variantLabel}` : contract.name,
      tags: ['capability-derived', 'p2'],
      environment,
      steps,
    },
    warnings,
    hasUnresolvedTargets: true,
    resolvedFields: [],
  };
}
