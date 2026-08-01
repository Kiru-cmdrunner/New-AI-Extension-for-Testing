/**
 * Element Binding Resolver — maps DataRequirement.field to a session element
 * via the recording session's fragment metadata.
 *
 * Resolution pipeline (per requirement):
 *   1. Primary: Find LogicalAction where businessField === requirement.field.
 *      Get componentId → ComponentSummary.rootElementId → session elementId.
 *   2. Fallback: Find UiElementSummary where accessibleName === requirement.label.
 *   3. No match: Warning 'no-logical-action' or 'no-session-element'.
 *
 * Design: .drytis/specs/p2-capability-derived-ir-generation.md §4.3
 */

import type { DataRequirement } from '../entities/data-requirement';
import type { RecordingSession } from '../entities/recording-session';
import type { UiElementSummary } from '../entities/application-knowledge';
import type { BindingWarning } from './p2-types';

export interface BindingResult {
  readonly bindings: Map<string, { elementId: string; summary: UiElementSummary }>;
  readonly warnings: BindingWarning[];
}

/**
 * Resolve field → session element bindings.
 *
 * Determinism: logicalActions are ordered temporally; if multiple actions
 * share the same businessField, the first one (earliest temporal order) wins.
 */
export function resolveFieldBindings(
  requirements: readonly DataRequirement[],
  session: RecordingSession,
): BindingResult {
  const bindings = new Map<string, { elementId: string; summary: UiElementSummary }>();
  const warnings: BindingWarning[] = [];

  const fragment = session.understandingResult?.fragment;
  if (!fragment) {
    // No fragment — all fields unresolved
    for (const req of requirements) {
      warnings.push({
        field: req.field,
        reason: 'no-logical-action',
        message: `No fragment in session for field "${req.field}"`,
      });
    }
    return { bindings, warnings };
  }

  for (const req of requirements) {
    const binding = resolveSingleBinding(req, fragment);

    if (binding.elementId && binding.summary) {
      bindings.set(req.field, { elementId: binding.elementId, summary: binding.summary });
    } else {
      warnings.push({
        field: req.field,
        reason: binding.warningReason ?? 'no-session-element',
        message: binding.warningMessage ?? `Could not bind field "${req.field}"`,
      });
    }
  }

  return { bindings, warnings };
}

// ── Internal ─────────────────────────────────────────────────

interface SingleBindingResult {
  elementId: string | null;
  summary: UiElementSummary | null;
  warningReason?: 'no-logical-action' | 'no-session-element';
  warningMessage?: string;
}

function resolveSingleBinding(
  req: DataRequirement,
  fragment: NonNullable<RecordingSession['understandingResult']>['fragment'],
): SingleBindingResult {
  // Primary: businessField → componentId → rootElementId
  const action = fragment.logicalActions.find(
    (a) => a.businessField === req.field,
  );

  if (action) {
    // Find the component to get rootElementId
    let elementId: string | null = null;

    if (action.componentId) {
      const component = fragment.components.find(
        (c) => c.groupingId === action.componentId,
      );
      if (component) {
        elementId = component.rootElementId;
      }
    }

    // Fallback within action: try transition elementId
    if (!elementId && action.transitionIds.length > 0) {
      const transition = fragment.transitions.find(
        (t) => t.transitionId === action.transitionIds[0],
      );
      if (transition) {
        elementId = transition.elementId;
      }
    }

    // Fallback within action: try matching by businessField to element name
    if (!elementId) {
      const element = fragment.elements.find(
        (el) => el.accessibleName === action.businessField,
      );
      if (element) {
        elementId = element.elementId;
      }
    }

    if (elementId) {
      const summary = fragment.elements.find((el) => el.elementId === elementId);
      if (summary) {
        return { elementId, summary };
      }
      // elementId exists but no summary — still have the elementId for identity recovery
      return {
        elementId,
        summary: null,
        warningMessage: `Session element "${elementId}" has no UiElementSummary`,
      };
    }
  }

  // Fallback: match by accessibleName === requirement.label
  const elementByName = fragment.elements.find(
    (el) => el.accessibleName === req.label,
  );
  if (elementByName) {
    return { elementId: elementByName.elementId, summary: elementByName };
  }

  return {
    elementId: null,
    summary: null,
    warningReason: action ? 'no-session-element' : 'no-logical-action',
    warningMessage: action
      ? `Logical action found for "${req.field}" but no element resolved`
      : `No logical action with businessField "${req.field}"`,
  };
}
