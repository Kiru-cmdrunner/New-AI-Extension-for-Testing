/**
 * Capability Mappers — pure functions mapping between pipeline types.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §11 Step 2
 *
 * These functions bridge the recorder's semantic output (CapabilityCandidate,
 * InteractionContract, SuccessIndicator) to the platform-layer types
 * (DataRequirement, SuccessCriterion, P2CapabilityContract, CapabilityVersion).
 *
 * Design principles:
 *   - Pure functions — no side effects, no I/O.
 *   - Lossy by design — recorder-specific details (confidence, evidence trail,
 *     DOM structure) are intentionally dropped. Recoverable via provenance
 *     (sourceSessionId → RecordingSession).
 *   - inputMethod is derived from sourceInteractionType at THIS boundary,
 *     not inside the recorder. The recorder carries the InteractionType;
 *     the mapper converts it to the platform-level InputMethod.
 */

import type { InteractionType } from '../../shared/component-types';
import type { CapabilityInput } from '../entities/capability-candidate';
import type {
  DataRequirement,
  DataKind,
  DataConstraint,
  InputMethod,
} from '../entities/data-requirement';
import type { SuccessCriterion, SuccessType, SuccessTarget } from '../entities/success-criterion';
import type { CapabilityVersion, CapabilitySnapshot } from '../entities/capability-version';
import type { Capability } from '../entities/capability';
import type { P2CapabilityContract } from '../entities/p2-capability-contract';
import type { SuccessIndicator } from '../entities/application-knowledge';
import type { CapabilityReview } from '../entities/capability-review';

// ── InteractionType → InputMethod mapping ─────────────────

/**
 * Many-to-one mapping from InteractionType to the platform-level InputMethod.
 *
 * Non-data-input types (Click, Navigation, Tab, Hover, Scroll, etc.) return null.
 * Future InteractionTypes extend this map; existing capability contracts are
 * unaffected (INV-P1-B6).
 */
const INTERACTION_TYPE_TO_INPUT_METHOD: ReadonlyMap<string, InputMethod> = new Map<string, InputMethod>([
  // Dropdown family → dropdown
  ['Dropdown', 'dropdown'],
  ['NativeDropdown', 'dropdown'],
  ['CustomDropdown', 'dropdown'],
  ['Autocomplete', 'dropdown'],
  ['SearchableDropdown', 'dropdown'],
  ['RadioButton', 'dropdown'],
  // Checkbox → toggle
  ['Checkbox', 'toggle'],
  // Slider family → slider
  ['Slider', 'slider'],
  ['NativeSlider', 'slider'],
  ['AriaSlider', 'slider'],
  ['RangeSlider', 'slider'],
  ['CustomSlider', 'slider'],
  // Text family → text
  ['TextEntry', 'text'],
  ['RichTextEditor', 'text'],
  // Date family → datePicker
  ['DatePicker', 'datePicker'],
  ['DateRangePicker', 'datePicker'],
  // File → fileUpload
  ['FileUpload', 'fileUpload'],
]);

/**
 * Resolve the InputMethod for a given InteractionType.
 * Returns null for non-data-input types.
 */
export function interactionTypeToInputMethod(type: InteractionType): InputMethod | null {
  return INTERACTION_TYPE_TO_INPUT_METHOD.get(type) ?? null;
}

// ── CapabilityInput → DataRequirement ─────────────────────

/**
 * Derive the DataKind from CapabilityInput constraints and inputMethod.
 *
 * Priority:
 *   1. Explicit inputType from constraints (email → email, number → number, etc.)
 *   2. inputMethod fallback: toggle → boolean (the toggle interaction IS the signal)
 *   3. validOptions present → select
 *   4. Default → text
 */
function deriveKind(
  inputType: string | null,
  inputMethod: InputMethod | null,
  hasOptions: boolean,
): DataKind {
  // 1. Explicit inputType
  if (inputType) {
    if (inputType === 'email') return 'email';
    if (inputType === 'number' || inputType === 'range') return 'number';
    if (inputType === 'date' || inputType === 'datetime-local') return 'date';
    if (inputType === 'checkbox' || inputType === 'radio') return 'select';
    if (inputType === 'select-one' || inputType === 'select-multiple') return 'select';
  }

  // 2. inputMethod fallback
  if (inputMethod === 'toggle') return 'boolean';
  if (inputMethod === 'slider') return 'number';
  if (inputMethod === 'datePicker') return 'date';

  // 3. Options present implies select
  if (hasOptions) return 'select';

  // 4. Default
  return 'text';
}

/**
 * Map CapabilityInput constraints to DataConstraint.
 */
function mapConstraints(input: CapabilityInput): DataConstraint {
  return {
    minLength: input.lengthRange?.minLength ?? null,
    maxLength: input.lengthRange?.maxLength ?? null,
    pattern: input.format?.regex ?? null,
    min: input.valueRange?.min ?? null,
    max: input.valueRange?.max ?? null,
    step: input.valueRange?.step ?? null,
    options: input.validOptions ?? null,
    formatDescription: input.format?.description ?? null,
  };
}

/**
 * Map a single CapabilityInput to a DataRequirement.
 *
 * The sourceInteractionType from the CapabilityInput (carried from the
 * LogicalAction via the enrichment pipeline) determines inputMethod.
 * The kind is derived from inputType + inputMethod + constraints.
 */
export function capabilityInputToDataRequirement(input: CapabilityInput): DataRequirement {
  const inputMethod = input.sourceInteractionType
    ? interactionTypeToInputMethod(input.sourceInteractionType)
    : null;

  const hasOptions = input.validOptions !== null && input.validOptions.length > 0;
  const kind = deriveKind(input.inputType, inputMethod, hasOptions);

  return {
    field: input.label,
    label: humanizeLabel(input.label),
    kind,
    inputMethod,
    required: input.required,
    defaultValue: null,
    constraints: mapConstraints(input),
    source: 'inferred',
  };
}

/**
 * Map an array of CapabilityInputs to DataRequirements.
 */
export function candidateToDataRequirements(inputs: CapabilityInput[]): DataRequirement[] {
  return inputs.map(capabilityInputToDataRequirement);
}

// ── SuccessIndicator → SuccessCriterion ───────────────────

/**
 * Map a SuccessIndicator (from BehavioralContract) to a SuccessCriterion.
 */
export function successIndicatorToCriterion(
  indicator: SuccessIndicator,
  index: number,
): SuccessCriterion {
  const type = mapSuccessType(indicator.type);
  const target = mapSuccessTarget(indicator);
  const description = indicator.description || formatDefaultDescription(type, indicator);

  return {
    id: `criterion-${index}`,
    description,
    type,
    target,
    expectedValue: type === 'valueEquals' ? indicator.signal : null,
    timeout: 5000,
    source: 'inferred',
  };
}

/**
 * Map an array of SuccessIndicators to SuccessCriteria.
 */
export function successIndicatorsToCriteria(indicators: SuccessIndicator[]): SuccessCriterion[] {
  return indicators.map((ind, i) => successIndicatorToCriterion(ind, i));
}

function mapSuccessType(raw: SuccessIndicator['type']): SuccessType {
  switch (raw) {
    case 'navigation': return 'navigation';
    case 'valueDisplay': return 'valueEquals';
    case 'visibility': return 'elementVisible';
    case 'stateChange': return 'custom';
  }
}

function mapSuccessTarget(indicator: SuccessIndicator): SuccessTarget {
  if (indicator.type === 'navigation') {
    return { kind: 'url', urlPattern: indicator.signal, elementLocator: null };
  }
  // For element-based indicators, the signal is the element locator
  return { kind: 'element', urlPattern: null, elementLocator: indicator.signal };
}

function formatDefaultDescription(type: SuccessType, indicator: SuccessIndicator): string {
  switch (type) {
    case 'navigation': return `URL matches ${indicator.signal}`;
    case 'elementVisible': return `Element ${indicator.signal} is visible`;
    case 'valueEquals': return `Element value equals ${indicator.signal}`;
    case 'elementAbsent': return `Element ${indicator.signal} is absent`;
    case 'textPresent': return `Page contains text ${indicator.signal}`;
    case 'custom': return `State change: ${indicator.signal}`;
  }
}

// ── Capability → P2CapabilityContract ─────────────────────

/**
 * Build a P2CapabilityContract from an approved Capability and its version info.
 *
 * This is the read-only contract that P2/P3 consume. It exposes only what
 * P2/P3 need — not the full Capability entity.
 */
export function capabilityToContract(
  capability: Capability,
  version: CapabilityVersion,
  entryPointUrl: string,
  entryPointElementName: string | null,
): P2CapabilityContract {
  return {
    capabilityId: capability.id,
    versionNumber: version.versionNumber,
    versionId: version.versionId,
    name: version.snapshot.name,
    purpose: version.snapshot.purpose,
    dataRequirements: [...version.snapshot.dataRequirements],
    successCriteria: [...version.snapshot.successCriteria],
    entryPoint: {
      url: entryPointUrl,
      elementName: entryPointElementName,
    },
    sourceSessionId: version.sourceSessionId,
    approvedAt: version.createdAt,
  };
}

// ── Capability → CapabilityVersion ────────────────────────

/**
 * Build a CapabilityVersion snapshot from an approved Capability.
 *
 * The snapshot captures the exact state of the capability data at this version.
 * Once created, the version is immutable.
 */
export function capabilityToVersion(
  capability: Capability,
  review: CapabilityReview,
  versionNumber: number,
): CapabilityVersion {
  const snapshot: CapabilitySnapshot = {
    name: review.edits.nameChanged && review.edits.editedName
      ? review.edits.editedName
      : capability.name,
    purpose: review.edits.purposeChanged && review.edits.editedPurpose
      ? review.edits.editedPurpose
      : capability.purpose,
    dataRequirements: review.edits.inputsEdited && review.edits.editedDataRequirements
      ? [...review.edits.editedDataRequirements]
      : (capability as Capability & { dataRequirements?: DataRequirement[] }).dataRequirements ?? [],
    successCriteria: review.edits.successCriteriaEdited && review.edits.editedSuccessCriteria
      ? [...review.edits.editedSuccessCriteria]
      : (capability as Capability & { successCriteria?: SuccessCriterion[] }).successCriteria ?? [],
    validationRules: capability.validationRules.map((r) => ({
      field: r.fieldLabel,
      type: r.ruleType,
      description: r.constraint,
      constraint: r.constraint,
    })),
    observedOutcomes: capability.observedOutcomes.map((o) => ({
      outcomeId: o.outcomeId,
      description: o.description,
      terminalUrl: o.terminalUrl,
    })),
  };

  return {
    versionId: `${capability.id}-v${versionNumber}`,
    capabilityId: capability.id,
    versionNumber,
    createdAt: review.reviewedAt ?? new Date().toISOString(),
    createdBy: review.reviewedBy ?? 'system',
    reviewDecision: 'approved',
    reviewNote: review.reviewNote,
    sourceSessionId: review.sessionId,
    snapshot,
  };
}

// ── Helpers ───────────────────────────────────────────────

/**
 * Convert a machine-readable field label to a human-readable label.
 * "email" → "Email", "maxPrice" → "Max Price", "fullName" → "Full Name"
 */
function humanizeLabel(label: string): string {
  return label
    .replace(/([A-Z])/g, ' $1')     // camelCase → space-separated
    .replace(/[_-]/g, ' ')            // snake/kebab → space
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()); // capitalize each word
}
