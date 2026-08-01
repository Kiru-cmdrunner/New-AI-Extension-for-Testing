/**
 * Success Criterion Resolver — maps SuccessCriterion to IRAssertion[].
 *
 * Design: .drytis/specs/p2-capability-derived-ir-generation.md §4.3
 *
 * Element-based criteria use the same full identity recovery + matchElements
 * pipeline as field targets.
 */

import type { SuccessCriterion } from '../entities/success-criterion';
import type { RecordingSession } from '../entities/recording-session';
import type { Element } from '../entities/element';
import type { IRAssertion, ResolvedTarget } from '../execution-ir/types';
import type { IREnvironment } from '../execution-ir/types';
import { ValidationType, ValidationComparison, ValidationSeverity } from '../enums';
import type { ComponentInteraction } from '../../shared/component-types';
import type { ElementIdentity } from '../../shared/types';
import type { ResolutionWarning } from './p2-types';
import { resolveTargetByLabel } from './element-target-resolver';

export interface SuccessCriterionResult {
  readonly assertions: IRAssertion[];
  readonly warnings: ResolutionWarning[];
}

/**
 * Resolve success criteria to IR assertions.
 *
 * Element-based criteria (elementVisible, elementAbsent, valueEquals) use
 * full identity recovery + matchElements via resolveTargetByLabel().
 * URL-based criteria (navigation, textPresent) produce UrlTargets directly.
 */
export function resolveSuccessCriteria(
  criteria: readonly SuccessCriterion[],
  session: RecordingSession,
  storedElements: readonly Element[],
  interactionIndex: Map<string, ComponentInteraction>,
  eventIdentityIndex: Map<string, ElementIdentity>,
  environment: IREnvironment,
): SuccessCriterionResult {
  const assertions: IRAssertion[] = [];
  const warnings: ResolutionWarning[] = [];

  for (const criterion of criteria) {
    const result = resolveSingleCriterion(
      criterion,
      session,
      storedElements,
      interactionIndex,
      eventIdentityIndex,
      environment,
    );

    if (result.assertion) {
      assertions.push(result.assertion);
    }
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  return { assertions, warnings };
}

// ── Internal ─────────────────────────────────────────────────

interface SingleCriterionResult {
  readonly assertion: IRAssertion | null;
  readonly warning: ResolutionWarning | null;
}

function resolveSingleCriterion(
  criterion: SuccessCriterion,
  _session: RecordingSession,
  storedElements: readonly Element[],
  interactionIndex: Map<string, ComponentInteraction>,
  eventIdentityIndex: Map<string, ElementIdentity>,
  environment: IREnvironment,
): SingleCriterionResult {
  const baseUrl = environment.baseUrl;

  switch (criterion.type) {
    case 'navigation': {
      const urlPattern = criterion.target.urlPattern ?? '';
      const target: ResolvedTarget = {
        kind: 'url',
        url: urlPattern.startsWith('http') ? urlPattern : `${baseUrl}${urlPattern}`,
      };
      return {
        assertion: {
          type: ValidationType.URL_MATCH,
          comparison: ValidationComparison.MATCHES,
          expectedValue: urlPattern,
          severity: ValidationSeverity.HARD,
          target,
          property: 'url',
        },
        warning: null,
      };
    }

    case 'elementVisible':
    case 'elementAbsent': {
      const elementLocator = criterion.target.elementLocator;
      if (!elementLocator) {
        return {
          assertion: null,
          warning: {
            field: criterion.id,
            reason: 'no-session-element',
            message: `Criterion "${criterion.description}" has no elementLocator`,
          },
        };
      }

      // Use full identity recovery pipeline
      const { target, warning } = resolveTargetByLabel(
        elementLocator,
        null,
        interactionIndex,
        eventIdentityIndex,
        storedElements,
      );

      if (warning) {
        return { assertion: null, warning };
      }

      return {
        assertion: {
          type: ValidationType.VISIBILITY,
          comparison:
            criterion.type === 'elementVisible'
              ? ValidationComparison.IS_TRUE
              : ValidationComparison.IS_FALSE,
          expectedValue: criterion.type === 'elementVisible',
          severity: ValidationSeverity.HARD,
          target,
          property: 'visible',
        },
        warning: null,
      };
    }

    case 'valueEquals': {
      const elementLocator = criterion.target.elementLocator;
      if (!elementLocator) {
        return {
          assertion: null,
          warning: {
            field: criterion.id,
            reason: 'no-session-element',
            message: `Criterion "${criterion.description}" has no elementLocator`,
          },
        };
      }

      const { target, warning } = resolveTargetByLabel(
        elementLocator,
        null,
        interactionIndex,
        eventIdentityIndex,
        storedElements,
      );

      if (warning) {
        return { assertion: null, warning };
      }

      return {
        assertion: {
          type: ValidationType.ATTRIBUTE_MATCH,
          comparison: ValidationComparison.EQUALS,
          expectedValue: criterion.expectedValue,
          severity: ValidationSeverity.HARD,
          target,
          property: 'value',
        },
        warning: null,
      };
    }

    case 'textPresent': {
      const target: ResolvedTarget = {
        kind: 'url',
        url: baseUrl,
      };
      return {
        assertion: {
          type: ValidationType.TEXT_MATCH,
          comparison: ValidationComparison.CONTAINS,
          expectedValue: criterion.expectedValue ?? '',
          severity: ValidationSeverity.SOFT,
          target,
          property: 'text',
        },
        warning: null,
      };
    }

    case 'custom':
    default: {
      return {
        assertion: {
          type: ValidationType.CUSTOM,
          comparison: ValidationComparison.EQUALS,
          expectedValue: criterion.expectedValue,
          severity: ValidationSeverity.SOFT,
          target: { kind: 'none' },
          property: null,
        },
        warning: null,
      };
    }
  }
}
