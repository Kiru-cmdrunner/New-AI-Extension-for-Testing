/**
 * Capability Deriver — derives a CapabilityCandidate from an
 * ApplicationKnowledgeFragment.
 *
 * This module completes the Understanding Layer by producing the semantic
 * "what does the application do?" artifact from the structural "what exists
 * and what happened?" artifact.
 *
 * Derivation is deterministic pattern matching on fragment data:
 *   - Capability name: from the first submit-like action or page title
 *   - Entry element: the first non-navigation logical action's component trigger
 *   - Inputs: LogicalAction.businessField + InteractionContract.constraints
 *   - Validation rules: InteractionContract.constraints → ValidationRule[]
 *   - Observed outcome: terminal SurfaceTransition + success indicators
 *   - Confidence: 'candidate' (single observation; rises via cross-session)
 *
 * Design principles:
 *   - No rigid taxonomy — names derived from application text, not an enum
 *   - Graceful degradation — every derivation path handles missing data
 *   - Pure function — fragment in, capability out, no side effects
 *   - Peer to enrichment modules — same pattern as other derivers
 *
 * Reference: Phase 9.5 architectural design discussion
 */

import type {
  CapabilityCandidate,
  CapabilityInput,
  ValidationRule,
  OutcomeDescriptor,
} from '../../domain/entities/capability-candidate';
import type { ApplicationKnowledgeFragment } from '../../domain/entities/application-knowledge';

// ── Types ─────────────────────────────────────────────────

export interface CapabilityDeriverInput {
  /** The fragment to derive a capability from. */
  readonly fragment: ApplicationKnowledgeFragment;
  /** Session ID (for provenance). */
  readonly sessionId: string;
}

export interface CapabilityDeriverResult {
  /** The derived capability, or null if the fragment is too sparse. */
  readonly capability: CapabilityCandidate | null;
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Keywords that suggest a capability trigger (submit/create/save/etc.).
 * Used to identify the entry element from logical actions.
 */
const ACTION_KEYWORDS = [
  'submit', 'save', 'create', 'add', 'new', 'update', 'edit',
  'delete', 'remove', 'confirm', 'continue', 'next', 'finish',
  'login', 'sign in', 'sign up', 'register', 'send', 'apply',
  'search', 'filter', 'export', 'import', 'download', 'upload',
];

/**
 * Check if a string contains any action keyword (case-insensitive).
 */
function containsActionKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return ACTION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Derive a human-readable capability name from the fragment.
 *
 * Strategy (in priority order):
 * 1. If a logical action's component has a businessField, use it + action verb
 * 2. If a submit-like element has an accessible name, use it
 * 3. If there are surface transitions, use the last page's URL path
 * 4. Fall back to "Recorded Workflow"
 */
function deriveCapabilityName(fragment: ApplicationKnowledgeFragment): string {
  // Strategy 1: business field from the first logical action
  const firstActionWithField = fragment.logicalActions.find(
    (a) => a.businessField !== null,
  );
  if (firstActionWithField?.businessField) {
    return firstActionWithField.businessField;
  }

  // Strategy 2: submit-like element's accessible name
  const submitElement = fragment.elements.find(
    (el) => el.tag === 'button' && containsActionKeyword(el.accessibleName),
  );
  if (submitElement) {
    return submitElement.accessibleName;
  }

  // Strategy 3: last surface URL path
  const transitions = fragment.recordedWorkflow.surfaceTransitions;
  if (transitions.length > 0) {
    const lastUrl = transitions[transitions.length - 1].toUrl;
    const path = new URL(lastUrl, 'http://placeholder').pathname;
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 0) {
      // Convert last segment to title case
      const last = segments[segments.length - 1];
      return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
    }
  }

  // Strategy 4: first surface URL path
  if (fragment.applicationSurfaces.length > 0) {
    const url = fragment.applicationSurfaces[0].url;
    const path = new URL(url, 'http://placeholder').pathname;
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' ');
    }
  }

  return 'Recorded Workflow';
}

/**
 * Derive a purpose description from the capability name + workflow structure.
 */
function derivePurpose(name: string, fragment: ApplicationKnowledgeFragment): string {
  const transitions = fragment.recordedWorkflow.surfaceTransitions;
  if (transitions.length > 0) {
    return `${name} workflow with ${transitions.length} page transition${transitions.length === 1 ? '' : 's'}`;
  }
  return `${name} workflow`;
}

/**
 * Derive the entry element — the element that triggered the capability.
 *
 * Strategy:
 * 1. First submit-like button (contains action keywords in accessible name)
 * 2. First logical action's component root element
 * 3. First interactive element
 */
function deriveEntryElement(fragment: ApplicationKnowledgeFragment): CapabilityCandidate['entryElement'] {
  // Strategy 1: submit-like button
  const submitBtn = fragment.elements.find(
    (el) => el.tag === 'button' && containsActionKeyword(el.accessibleName),
  );
  if (submitBtn) {
    return {
      elementId: submitBtn.elementId,
      accessibleName: submitBtn.accessibleName,
      tag: submitBtn.tag,
      role: submitBtn.role,
    };
  }

  // Strategy 2: first logical action's component root
  const firstAction = fragment.logicalActions[0];
  if (firstAction?.componentId) {
    const component = fragment.components.find(
      (c) => c.groupingId === firstAction.componentId,
    );
    if (component) {
      const rootEl = fragment.elements.find(
        (el) => el.elementId === component.rootElementId,
      );
      if (rootEl) {
        return {
          elementId: rootEl.elementId,
          accessibleName: rootEl.accessibleName,
          tag: rootEl.tag,
          role: rootEl.role,
        };
      }
    }
  }

  // Strategy 3: first interactive element (not a navigation/page element)
  const firstInteractive = fragment.elements.find(
    (el) => el.tag !== 'html' && el.tag !== 'body',
  );
  if (firstInteractive) {
    return {
      elementId: firstInteractive.elementId,
      accessibleName: firstInteractive.accessibleName,
      tag: firstInteractive.tag,
      role: firstInteractive.role,
    };
  }

  return null;
}

/**
 * Derive capability inputs from logical actions + interaction contracts.
 *
 * Each logical action with a businessField becomes a capability input.
 * Constraints are resolved from the matching interaction contract.
 */
function deriveInputs(fragment: ApplicationKnowledgeFragment): CapabilityInput[] {
  const inputs: CapabilityInput[] = [];

  for (const action of fragment.logicalActions) {
    if (!action.businessField) continue;

    // Find the element for this action
    const component = action.componentId
      ? fragment.components.find((c) => c.groupingId === action.componentId)
      : null;

    let elementId = component?.rootElementId ?? '';

    // If no component, try to find the element from the action's transitions
    if (!elementId && action.transitionIds.length > 0) {
      const transition = fragment.transitions.find(
        (t) => t.transitionId === action.transitionIds[0],
      );
      if (transition) {
        elementId = transition.elementId;
      }
    }

    // If still no element, try matching by business field to element accessible name
    if (!elementId) {
      const element = fragment.elements.find(
        (el) => el.accessibleName === action.businessField,
      );
      if (element) elementId = element.elementId;
    }

    // Find the interaction contract for this element
    const contract = fragment.interactionContracts.find(
      (c) => c.appliesTo.id === elementId && c.appliesTo.type === 'element',
    );

    // Also check if there's a contract for the component
    const componentContract = action.componentId
      ? fragment.interactionContracts.find(
          (c) => c.appliesTo.id === action.componentId && c.appliesTo.type === 'component',
        )
      : null;

    const constraints = contract?.constraints ?? componentContract?.constraints;

    inputs.push({
      label: action.businessField,
      elementId,
      required: constraints?.required ?? false,
      inputType: constraints?.inputType ?? null,
      valueRange: constraints?.valueRange ?? null,
      lengthRange: constraints?.lengthRange ?? null,
      format: constraints?.format ?? null,
      validOptions: constraints?.validOptions ?? null,
      sourceInteractionType: action.sourceInteractionType,
    });
  }

  return inputs;
}

/**
 * Derive validation rules from interaction contracts.
 *
 * Each constraint (required, format, range, length, options) becomes a
 * ValidationRule entry.
 */
function deriveValidationRules(fragment: ApplicationKnowledgeFragment): ValidationRule[] {
  const rules: ValidationRule[] = [];

  for (const contract of fragment.interactionContracts) {
    const c = contract.constraints;
    const fieldLabel = fragment.elements.find(
      (el) => el.elementId === contract.appliesTo.id,
    )?.accessibleName ?? contract.appliesTo.id;

    // Also check components for a business field label
    const component = fragment.components.find(
      (comp) => comp.groupingId === contract.appliesTo.id,
    );
    const label = component?.businessField ?? fieldLabel;

    if (c.required) {
      rules.push({
        field: label,
        type: 'required',
        description: `${label} is required`,
        constraint: 'required=true',
      });
    }

    if (c.format) {
      rules.push({
        field: label,
        type: 'format',
        description: `${label} must match: ${c.format.description}`,
        constraint: `regex=${c.format.regex}`,
      });
    }

    if (c.valueRange) {
      rules.push({
        field: label,
        type: 'range',
        description: `${label} must be between ${c.valueRange.min} and ${c.valueRange.max}`,
        constraint: `min=${c.valueRange.min},max=${c.valueRange.max},step=${c.valueRange.step}`,
      });
    }

    if (c.lengthRange) {
      rules.push({
        field: label,
        type: 'length',
        description: `${label} must be ${c.lengthRange.minLength}-${c.lengthRange.maxLength} characters`,
        constraint: `minLength=${c.lengthRange.minLength},maxLength=${c.lengthRange.maxLength}`,
      });
    }

    if (c.validOptions && c.validOptions.length > 0) {
      rules.push({
        field: label,
        type: 'options',
        description: `${label} must be one of: ${c.validOptions.join(', ')}`,
        constraint: `options=${c.validOptions.join(',')}`,
      });
    }
  }

  return rules;
}

/**
 * Derive the observed outcome from the terminal surface transition
 * and behavioral contract success indicators.
 */
function deriveObservedOutcome(fragment: ApplicationKnowledgeFragment): OutcomeDescriptor {
  const transitions = fragment.recordedWorkflow.surfaceTransitions;

  // Terminal URL: the last surface transition's destination
  const terminalUrl = transitions.length > 0
    ? transitions[transitions.length - 1].toUrl
    : (fragment.applicationSurfaces[0]?.url ?? null);

  // Success signals: from all behavioral contracts
  const successSignals: string[] = [];
  for (const contract of fragment.behavioralContracts) {
    for (const indicator of contract.successIndicators) {
      successSignals.push(indicator.type);
    }
  }

  // Completed: workflow has at least one surface transition or one logical action
  const completed = transitions.length > 0 || fragment.recordedWorkflow.logicalActions.length > 0;

  return {
    terminalUrl,
    successSignals,
    completed,
  };
}

/**
 * Generate a unique capability ID from session ID + fragment timestamp.
 */
function generateCapabilityId(sessionId: string): string {
  return `cap-${sessionId}`;
}

// ── Public API ────────────────────────────────────────────

/**
 * Derive a CapabilityCandidate from an ApplicationKnowledgeFragment.
 *
 * This is the entry point for capability derivation. It takes the structural
 * understanding (fragment) and produces the semantic understanding (capability).
 *
 * @param input Fragment + session ID
 * @returns Result with capability (or null if fragment is too sparse)
 */
export function deriveCapability(input: CapabilityDeriverInput): CapabilityDeriverResult {
  const { fragment, sessionId } = input;

  // Guard: if the fragment has no elements and no transitions, we can't
  // derive a meaningful capability.
  if (fragment.elements.length === 0 && fragment.transitions.length === 0) {
    return { capability: null };
  }

  const now = new Date().toISOString();
  const name = deriveCapabilityName(fragment);
  const purpose = derivePurpose(name, fragment);

  const capability: CapabilityCandidate = {
    capabilityId: generateCapabilityId(sessionId),
    name,
    purpose,
    confidence: 'candidate', // Single observation — always 'candidate' initially

    entryElement: deriveEntryElement(fragment),
    inputs: deriveInputs(fragment),
    observedOutcome: deriveObservedOutcome(fragment),
    validationRules: deriveValidationRules(fragment),

    // Enrichment fields — empty initially, populated by future test execution
    observedOutcomes: [],
    businessRules: [],
    failureModes: [],

    // Provenance
    sourceSessionId: sessionId,
    sourceFragmentId: fragment.sessionId,
    derivedAt: now,

    // Enrichment history — records the initial derivation
    enrichmentHistory: [
      {
        type: 'initial-derivation',
        timestamp: now,
        description: `Derived from fragment with ${fragment.elements.length} elements, ${fragment.transitions.length} transitions, ${fragment.components.length} components`,
      },
    ],
  };

  return { capability };
}
