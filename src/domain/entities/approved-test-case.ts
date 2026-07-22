/**
 * Approved Test Case Entity — domain-schema.md §3.2
 *
 * The canonical source of truth for business intent. An Approved Test Case (ATC)
 * describes what the business wants to verify — a sequence of business-level
 * steps with logical element references, inputs, and validations — without
 * coupling to any specific execution engine, selector strategy, or UI detail.
 *
 * Two sub-entities:
 *   - ApprovedTestCase: stable identity + current metadata
 *   - TestCaseVersion: immutable snapshot of steps + content at a point in time
 *
 * Invariants:
 *   INV-ATC1: currentVersionId always points to an existing version
 *   INV-ATC2: Status transitions: draft → in_review → approved → deprecated
 *   INV-ATC3: Title/tags update in place; step changes create new version
 *   INV-ATC4: No execution evidence on definitions (belongs to runs)
 *   INV-ATCV1: Versions are immutable
 *   INV-ATCV2: versionNumber is monotonically increasing, never reused
 *   INV-ATCV3: Every step.elementId must resolve to an existing Element
 *   INV-ATCV4: Steps reference Elements by stable ID, never by name
 *   INV-ATCV5: sourceArtifactIds records provenance
 */

import {
  StepAction,
  TestCasePriority,
  TestCaseStatus,
  ValidationComparison,
  ValidationSeverity,
  ValidationType,
} from '../enums';
import { InvalidStatusTransitionError, MissingFieldError, ValueObjectError } from '../errors/invariant-errors';

// ── Validation (value object) ─────────────────────────────

/** A validation assertion to verify after a step executes. */
export interface Validation {
  readonly id: string;
  readonly type: ValidationType;
  /** Target element (required for element-based validations; null for URL/custom). */
  readonly elementId: string | null;
  /** Property to check (e.g., "text", "value", "visible", "count"). */
  readonly property: string | null;
  readonly comparison: ValidationComparison;
  /** Expected value (required for most comparisons; omitted for isTrue/isFalse). */
  readonly expectedValue: unknown;
  readonly severity: ValidationSeverity;
}

/** Input for creating a Validation. */
export interface CreateValidationInput {
  type: ValidationType;
  elementId?: string | null;
  property?: string | null;
  comparison: ValidationComparison;
  expectedValue?: unknown;
  severity: ValidationSeverity;
}

/**
 * Create a validated Validation value object.
 *
 * @throws ValueObjectError for invalid validation config
 */
export function createValidation(input: CreateValidationInput): Validation {
  if (!input.type) {
    throw new ValueObjectError('Validation', 'type is required');
  }
  if (!input.comparison) {
    throw new ValueObjectError('Validation', 'comparison is required');
  }

  // isTrue/isFalse don't need expectedValue; all others do
  const isBooleanComparison =
    input.comparison === ValidationComparison.IS_TRUE ||
    input.comparison === ValidationComparison.IS_FALSE;
  if (!isBooleanComparison && input.expectedValue === undefined) {
    throw new ValueObjectError(
      'Validation',
      `expectedValue is required for comparison "${input.comparison}"`,
    );
  }

  return {
    id: crypto.randomUUID(),
    type: input.type,
    elementId: input.elementId ?? null,
    property: input.property ?? null,
    comparison: input.comparison,
    expectedValue: isBooleanComparison ? null : input.expectedValue,
    severity: input.severity,
  };
}

// ── Step (value object) ───────────────────────────────────

/** A business-level step in a test case version. */
export interface Step {
  readonly id: string;
  /** Position in the sequence (0-based). */
  readonly order: number;
  readonly action: StepAction;
  readonly description: string;
  /**
   * Logical element reference (stable ID).
   * Required for all actions except navigate and wait.
   */
  readonly elementId: string | null;
  /** Value to enter, select, or choose. */
  readonly input: unknown;
  readonly validations: Validation[];
}

/** Input for creating a Step. */
export interface CreateStepInput {
  order: number;
  action: StepAction;
  description: string;
  elementId?: string | null;
  input?: unknown;
  validations?: CreateValidationInput[];
}

/** Actions that do NOT require an element reference. */
const ELEMENT_OPTIONAL_ACTIONS: ReadonlySet<StepAction> = new Set([
  StepAction.NAVIGATE,
  StepAction.WAIT,
]);

/**
 * Create a validated Step value object.
 *
 * Invariants enforced:
 *   - description required
 *   - elementId required for all actions except navigate/wait
 *   - order is a non-negative integer
 *
 * @throws MissingFieldError if description is empty
 * @throws ValueObjectError if elementId is missing for a required action
 */
export function createStep(input: CreateStepInput): Step {
  if (!input.action) {
    throw new ValueObjectError('Step', 'action is required');
  }

  const description = input.description?.trim();
  if (!description) {
    throw new MissingFieldError('Step', 'description');
  }

  if (!Number.isInteger(input.order) || input.order < 0) {
    throw new ValueObjectError('Step', `order must be a non-negative integer (got ${input.order})`);
  }

  const requiresElement = !ELEMENT_OPTIONAL_ACTIONS.has(input.action);
  if (requiresElement) {
    if (!input.elementId || !input.elementId.trim()) {
      throw new ValueObjectError(
        'Step',
        `elementId is required for action "${input.action}"`,
      );
    }
  }

  const validations = (input.validations ?? []).map(createValidation);

  return {
    id: crypto.randomUUID(),
    order: input.order,
    action: input.action,
    description,
    elementId: input.elementId?.trim() || null,
    input: input.input ?? null,
    validations,
  };
}

// ── AIMetadata (value object) ─────────────────────────────

/** AI interpretation metadata from the review process. */
export interface AIMetadata {
  /** AI confidence in the interpretation (0.05–0.95; never 0 or 1). */
  readonly confidence: number | null;
  readonly reasoning: string;
  readonly modelVersion: string;
  readonly interpretationTimestamp: string;
}

/** Input for creating AIMetadata. */
export interface CreateAIMetadataInput {
  confidence?: number | null;
  reasoning?: string;
  modelVersion?: string;
  interpretationTimestamp?: string;
}

/**
 * Create an AIMetadata value object.
 * Returns null if no AI metadata is provided (manual authoring).
 */
export function createAIMetadata(input?: CreateAIMetadataInput): AIMetadata | null {
  if (!input) {
    return null;
  }

  return {
    confidence: input.confidence ?? null,
    reasoning: input.reasoning ?? '',
    modelVersion: input.modelVersion ?? '',
    interpretationTimestamp: input.interpretationTimestamp ?? new Date().toISOString(),
  };
}

// ── TestCaseVersion (immutable snapshot) ──────────────────

/** An immutable snapshot of a test case's content at a point in time. */
export interface TestCaseVersion {
  readonly id: string;
  readonly testCaseId: string;
  readonly versionNumber: number;
  readonly steps: Step[];
  /** Provenance — which source artifact(s) produced this version. */
  readonly sourceArtifactIds: string[];
  readonly aiMetadata: AIMetadata | null;
  readonly changeSummary: string;
  /** Previous version (for diff chain); null for version 1. */
  readonly parentVersionId: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** Input for creating a TestCaseVersion. */
export interface CreateTestCaseVersionInput {
  testCaseId: string;
  versionNumber: number;
  steps: CreateStepInput[];
  sourceArtifactIds?: string[];
  aiMetadata?: CreateAIMetadataInput;
  changeSummary?: string;
  parentVersionId?: string | null;
  createdBy: string;
}

/**
 * Create a TestCaseVersion entity with invariant validation.
 *
 * Invariants enforced:
 *   - testCaseId, createdBy required
 *   - versionNumber must be ≥ 1 (INV-ATCV2)
 *   - steps are validated via createStep()
 *
 * Note: Element existence (INV-ATCV3) is NOT checked here — it requires
 * querying the Element Repository. That check belongs in the repository
 * layer or the Unit of Work, not in the pure domain layer.
 *
 * @throws MissingFieldError if testCaseId or createdBy is empty
 * @throws ValueObjectError if versionNumber < 1
 */
export function createTestCaseVersion(input: CreateTestCaseVersionInput): TestCaseVersion {
  if (!input.testCaseId?.trim()) {
    throw new MissingFieldError('TestCaseVersion', 'testCaseId');
  }

  const createdBy = input.createdBy?.trim();
  if (!createdBy) {
    throw new MissingFieldError('TestCaseVersion', 'createdBy');
  }

  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1) {
    throw new ValueObjectError(
      'TestCaseVersion',
      `versionNumber must be ≥ 1 (got ${input.versionNumber})`,
    );
  }

  const now = new Date().toISOString();
  const steps = input.steps.map(createStep);

  return {
    id: crypto.randomUUID(),
    testCaseId: input.testCaseId.trim(),
    versionNumber: input.versionNumber,
    steps,
    sourceArtifactIds: input.sourceArtifactIds ?? [],
    aiMetadata: createAIMetadata(input.aiMetadata),
    changeSummary: input.changeSummary ?? '',
    parentVersionId: input.parentVersionId ?? null,
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    createdBy,
  };
}

/**
 * Mark a version as approved (immutable update — returns a new object).
 */
export function approveVersion(version: TestCaseVersion, approvedBy: string): TestCaseVersion {
  const approver = approvedBy?.trim();
  if (!approver) {
    throw new MissingFieldError('TestCaseVersion', 'approvedBy');
  }

  return {
    ...version,
    approvedBy: approver,
    approvedAt: new Date().toISOString(),
  };
}

// ── ApprovedTestCase (identity + metadata) ────────────────

/** Valid status transitions per INV-ATC2. */
const VALID_TRANSITIONS: ReadonlyMap<TestCaseStatus, TestCaseStatus[]> = new Map([
  [TestCaseStatus.DRAFT, [TestCaseStatus.IN_REVIEW]],
  [TestCaseStatus.IN_REVIEW, [TestCaseStatus.APPROVED, TestCaseStatus.DRAFT]],
  [TestCaseStatus.APPROVED, [TestCaseStatus.DEPRECATED, TestCaseStatus.DRAFT]],
  [TestCaseStatus.DEPRECATED, []],
]);

/**
 * Check if a status transition is valid per INV-ATC2.
 *
 * Allowed transitions:
 *   draft → in_review
 *   in_review → approved | draft
 *   approved → deprecated | draft (revision)
 *   deprecated → (terminal)
 */
export function isValidStatusTransition(
  from: TestCaseStatus,
  to: TestCaseStatus,
): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed ? allowed.includes(to) : false;
}

/** The Approved Test Case — identity + current metadata. */
export interface ApprovedTestCase {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly tags: string[];
  readonly priority: TestCasePriority;
  readonly status: TestCaseStatus;
  /** Pointer to the active version. */
  readonly currentVersionId: string;
  /** References to datasets/parameters used by this case. */
  readonly testDataRefs: string[];
  /** Optional link to the Capability this test case exercises. */
  readonly capabilityId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
}

/** Input for creating a new Approved Test Case (with version 1). */
export interface CreateTestCaseInput {
  projectId: string;
  title: string;
  description?: string;
  tags?: string[];
  priority?: TestCasePriority;
  testDataRefs?: string[];
  createdBy: string;
  /** Initial version content. */
  steps: CreateStepInput[];
  sourceArtifactIds?: string[];
  aiMetadata?: CreateAIMetadataInput;
  changeSummary?: string;
}

/**
 * Create a new Approved Test Case with its initial version (v1).
 *
 * This is a composite operation: it creates both the ATC identity and
 * Version 1 in one call. INV-ATC1 requires that an ATC always has a
 * currentVersionId — this function guarantees that by creating the version
 * first, then linking it.
 *
 * Returns the ATC and Version 1 as a pair — the repository layer must
 * persist both atomically.
 *
 * @throws MissingFieldError if projectId, title, or createdBy is empty
 */
export function createTestCase(input: CreateTestCaseInput): {
  testCase: ApprovedTestCase;
  version: TestCaseVersion;
} {
  if (!input.projectId?.trim()) {
    throw new MissingFieldError('ApprovedTestCase', 'projectId');
  }

  const title = input.title?.trim();
  if (!title) {
    throw new MissingFieldError('ApprovedTestCase', 'title');
  }

  const createdBy = input.createdBy?.trim();
  if (!createdBy) {
    throw new MissingFieldError('ApprovedTestCase', 'createdBy');
  }

  const now = new Date().toISOString();

  // Create version 1 first so we have its ID for currentVersionId
  const version = createTestCaseVersion({
    testCaseId: 'pending', // temporary — replaced below
    versionNumber: 1,
    steps: input.steps,
    sourceArtifactIds: input.sourceArtifactIds,
    aiMetadata: input.aiMetadata,
    changeSummary: input.changeSummary ?? 'Initial version',
    parentVersionId: null,
    createdBy,
  });

  // Create the ATC identity
  const testCaseId = crypto.randomUUID();
  const testCase: ApprovedTestCase = {
    id: testCaseId,
    projectId: input.projectId.trim(),
    title,
    description: input.description?.trim() ?? '',
    tags: input.tags ?? [],
    priority: input.priority ?? TestCasePriority.MEDIUM,
    status: TestCaseStatus.DRAFT,
    currentVersionId: version.id,
    testDataRefs: input.testDataRefs ?? [],
    capabilityId: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };

  // Fix the version's testCaseId (it was 'pending' during creation)
  return {
    testCase,
    version: { ...version, testCaseId },
  };
}

/**
 * Create an updated ATC with new metadata.
 *
 * INV-ATC3: Title and tags update in place. Step changes must go through
 * a new version — this function does NOT touch steps.
 */
export function updateTestCaseMetadata(
  existing: ApprovedTestCase,
  changes: {
    title?: string;
    description?: string;
    tags?: string[];
    priority?: TestCasePriority;
    testDataRefs?: string[];
    capabilityId?: string | null;
  },
): ApprovedTestCase {
  const title = changes.title !== undefined ? changes.title.trim() : existing.title;
  if (!title) {
    throw new MissingFieldError('ApprovedTestCase', 'title');
  }

  return {
    ...existing,
    title,
    description: changes.description !== undefined ? changes.description.trim() : existing.description,
    tags: changes.tags ?? existing.tags,
    priority: changes.priority ?? existing.priority,
    testDataRefs: changes.testDataRefs ?? existing.testDataRefs,
    capabilityId: changes.capabilityId !== undefined ? changes.capabilityId : existing.capabilityId,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Transition the ATC status.
 *
 * @throws InvalidStatusTransitionError if the transition is not allowed by INV-ATC2
 */
export function transitionStatus(
  existing: ApprovedTestCase,
  to: TestCaseStatus,
): ApprovedTestCase {
  if (!isValidStatusTransition(existing.status, to)) {
    throw new InvalidStatusTransitionError(existing.status, to);
  }

  return {
    ...existing,
    status: to,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Update the ATC to point to a new current version.
 * Used after creating a new version (revision).
 */
export function setCurrentVersion(
  existing: ApprovedTestCase,
  versionId: string,
): ApprovedTestCase {
  if (!versionId?.trim()) {
    throw new MissingFieldError('ApprovedTestCase', 'currentVersionId');
  }

  return {
    ...existing,
    currentVersionId: versionId,
    updatedAt: new Date().toISOString(),
  };
}
