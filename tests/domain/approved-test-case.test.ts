/**
 * Approved Test Case Entity Tests — domain-schema.md §3.2
 *
 * Tests ATC identity, versioning, steps, validations, status transitions,
 * and all applicable invariants.
 */
import { describe, it, expect } from 'vitest';
import {
  createTestCase,
  createTestCaseVersion,
  createStep,
  createValidation,
  updateTestCaseMetadata,
  transitionStatus,
  setCurrentVersion,
  approveVersion,
  isValidStatusTransition,
  type CreateTestCaseInput,
  type CreateStepInput,
} from '../../src/domain/entities/approved-test-case';
import {
  StepAction,
  TestCasePriority,
  TestCaseStatus,
  ValidationComparison,
  ValidationSeverity,
  ValidationType,
} from '../../src/domain/enums';
import {
  InvalidStatusTransitionError,
  MissingFieldError,
  ValueObjectError,
} from '../../src/domain/errors/invariant-errors';

// ── Validation Tests ──────────────────────────────────────

describe('Validation (value object)', () => {

  describe('createValidation', () => {
    it('creates an element-based validation', () => {
      const v = createValidation({
        type: ValidationType.VISIBILITY,
        elementId: 'elm-001',
        property: 'visible',
        comparison: ValidationComparison.IS_TRUE,
        severity: ValidationSeverity.HARD,
      });
      expect(v.id).toBeDefined();
      expect(v.type).toBe(ValidationType.VISIBILITY);
      expect(v.elementId).toBe('elm-001');
      expect(v.property).toBe('visible');
      expect(v.comparison).toBe(ValidationComparison.IS_TRUE);
      expect(v.severity).toBe(ValidationSeverity.HARD);
      expect(v.expectedValue).toBeNull(); // isTrue doesn't need expectedValue
    });

    it('creates a URL validation without elementId', () => {
      const v = createValidation({
        type: ValidationType.URL_MATCH,
        comparison: ValidationComparison.CONTAINS,
        expectedValue: '/dashboard',
        severity: ValidationSeverity.HARD,
      });
      expect(v.elementId).toBeNull();
      expect(v.expectedValue).toBe('/dashboard');
    });

    it('creates a text match validation', () => {
      const v = createValidation({
        type: ValidationType.TEXT_MATCH,
        elementId: 'elm-002',
        property: 'text',
        comparison: ValidationComparison.CONTAINS,
        expectedValue: 'Welcome',
        severity: ValidationSeverity.SOFT,
      });
      expect(v.expectedValue).toBe('Welcome');
      expect(v.severity).toBe(ValidationSeverity.SOFT);
    });

    it('throws when type is missing', () => {
      expect(() => createValidation({
        type: undefined as unknown as ValidationType,
        comparison: ValidationComparison.IS_TRUE,
        severity: ValidationSeverity.HARD,
      })).toThrow(ValueObjectError);
    });

    it('throws when comparison is missing', () => {
      expect(() => createValidation({
        type: ValidationType.VISIBILITY,
        comparison: undefined as unknown as ValidationComparison,
        severity: ValidationSeverity.HARD,
      })).toThrow(ValueObjectError);
    });

    it('throws when expectedValue is missing for non-boolean comparison', () => {
      expect(() => createValidation({
        type: ValidationType.TEXT_MATCH,
        comparison: ValidationComparison.EQUALS,
        severity: ValidationSeverity.HARD,
        // expectedValue omitted
      })).toThrow(ValueObjectError);
    });

    it('allows missing expectedValue for isTrue', () => {
      expect(() => createValidation({
        type: ValidationType.VISIBILITY,
        comparison: ValidationComparison.IS_TRUE,
        severity: ValidationSeverity.HARD,
      })).not.toThrow();
    });

    it('allows missing expectedValue for isFalse', () => {
      expect(() => createValidation({
        type: ValidationType.VISIBILITY,
        comparison: ValidationComparison.IS_FALSE,
        severity: ValidationSeverity.HARD,
      })).not.toThrow();
    });
  });
});

// ── Step Tests ────────────────────────────────────────────

describe('Step (value object)', () => {

  const validStep: CreateStepInput = {
    order: 0,
    action: StepAction.NAVIGATE,
    description: 'Navigate to the login page',
    input: '/login',
  };

  describe('createStep', () => {
    it('creates a navigate step without elementId', () => {
      const step = createStep(validStep);
      expect(step.id).toBeDefined();
      expect(step.order).toBe(0);
      expect(step.action).toBe(StepAction.NAVIGATE);
      expect(step.description).toBe('Navigate to the login page');
      expect(step.input).toBe('/login');
      expect(step.elementId).toBeNull();
      expect(step.validations).toEqual([]);
    });

    it('creates a click step with elementId', () => {
      const step = createStep({
        order: 1,
        action: StepAction.CLICK,
        description: 'Click the Login button',
        elementId: 'elm-103-login-button',
      });
      expect(step.elementId).toBe('elm-103-login-button');
    });

    it('creates a fill step with input value', () => {
      const step = createStep({
        order: 2,
        action: StepAction.FILL,
        description: 'Enter email',
        elementId: 'elm-101-login-email',
        input: 'john@example.com',
      });
      expect(step.input).toBe('john@example.com');
    });

    it('creates a wait step without elementId', () => {
      const step = createStep({
        order: 3,
        action: StepAction.WAIT,
        description: 'Wait for page to load',
      });
      expect(step.elementId).toBeNull();
    });

    it('creates a step with validations', () => {
      const step = createStep({
        order: 4,
        action: StepAction.CLICK,
        description: 'Click Login',
        elementId: 'elm-103',
        validations: [
          {
            type: ValidationType.URL_MATCH,
            comparison: ValidationComparison.CONTAINS,
            expectedValue: '/dashboard',
            severity: ValidationSeverity.HARD,
          },
        ],
      });
      expect(step.validations).toHaveLength(1);
      expect(step.validations[0].type).toBe(ValidationType.URL_MATCH);
    });

    it('defaults input to null when omitted', () => {
      const step = createStep({
        order: 0,
        action: StepAction.NAVIGATE,
        description: 'Navigate',
      });
      expect(step.input).toBeNull();
    });

    it('trims whitespace from description', () => {
      const step = createStep({
        order: 0,
        action: StepAction.NAVIGATE,
        description: '  Navigate to page  ',
      });
      expect(step.description).toBe('Navigate to page');
    });
  });

  // ── INV-ATCV4: elementId required for most actions ─────

  describe('INV-ATCV4: elementId requirements', () => {
    const actionsRequiringElement: StepAction[] = [
      StepAction.CLICK, StepAction.FILL, StepAction.SELECT,
      StepAction.SELECT_DATE, StepAction.TOGGLE, StepAction.HOVER, StepAction.VERIFY,
    ];

    for (const action of actionsRequiringElement) {
      it(`throws when elementId missing for action="${action}"`, () => {
        expect(() => createStep({
          order: 0, action, description: 'Test step',
        })).toThrow(ValueObjectError);
      });
    }

    const optionalActions: StepAction[] = [StepAction.NAVIGATE, StepAction.WAIT];

    for (const action of optionalActions) {
      it(`allows missing elementId for action="${action}"`, () => {
        expect(() => createStep({
          order: 0, action, description: 'Test step',
        })).not.toThrow();
      });
    }

    it('throws when elementId is whitespace-only for click', () => {
      expect(() => createStep({
        order: 0, action: StepAction.CLICK, description: 'Click', elementId: '   ',
      })).toThrow(ValueObjectError);
    });
  });

  // ── Field validation ────────────────────────────────────

  describe('field validation', () => {
    it('throws MissingFieldError when description is empty', () => {
      expect(() => createStep({
        order: 0, action: StepAction.NAVIGATE, description: '',
      })).toThrow(MissingFieldError);
    });

    it('throws ValueObjectError when order is negative', () => {
      expect(() => createStep({
        order: -1, action: StepAction.NAVIGATE, description: 'Test',
      })).toThrow(ValueObjectError);
    });

    it('throws ValueObjectError when order is not an integer', () => {
      expect(() => createStep({
        order: 1.5, action: StepAction.NAVIGATE, description: 'Test',
      })).toThrow(ValueObjectError);
    });
  });
});

// ── TestCaseVersion Tests ─────────────────────────────────

describe('TestCaseVersion', () => {

  const validSteps: CreateStepInput[] = [
    { order: 0, action: StepAction.NAVIGATE, description: 'Go to login', input: '/login' },
    {
      order: 1, action: StepAction.CLICK, description: 'Click login',
      elementId: 'elm-103',
    },
  ];

  describe('createTestCaseVersion', () => {
    it('creates version 1 with correct fields', () => {
      const version = createTestCaseVersion({
        testCaseId: 'tc-001',
        versionNumber: 1,
        steps: validSteps,
        changeSummary: 'Initial version',
        createdBy: 'user-1862',
      });

      expect(version.id).toBeDefined();
      expect(version.testCaseId).toBe('tc-001');
      expect(version.versionNumber).toBe(1);
      expect(version.steps).toHaveLength(2);
      expect(version.sourceArtifactIds).toEqual([]);
      expect(version.aiMetadata).toBeNull();
      expect(version.changeSummary).toBe('Initial version');
      expect(version.parentVersionId).toBeNull();
      expect(version.approvedBy).toBeNull();
      expect(version.approvedAt).toBeNull();
      expect(version.createdAt).toBeDefined();
      expect(version.createdBy).toBe('user-1862');
    });

    it('creates version 2 with parentVersionId', () => {
      const v1 = createTestCaseVersion({
        testCaseId: 'tc-001', versionNumber: 1, steps: validSteps, createdBy: 'u1',
      });

      const v2 = createTestCaseVersion({
        testCaseId: 'tc-001',
        versionNumber: 2,
        steps: validSteps,
        parentVersionId: v1.id,
        changeSummary: 'Added validation',
        createdBy: 'u1',
      });

      expect(v2.versionNumber).toBe(2);
      expect(v2.parentVersionId).toBe(v1.id);
    });

    it('creates version with sourceArtifactIds', () => {
      const version = createTestCaseVersion({
        testCaseId: 'tc-001', versionNumber: 1, steps: validSteps,
        sourceArtifactIds: ['sa-001', 'sa-002'],
        createdBy: 'u1',
      });
      expect(version.sourceArtifactIds).toEqual(['sa-001', 'sa-002']);
    });

    it('creates version with aiMetadata', () => {
      const version = createTestCaseVersion({
        testCaseId: 'tc-001', versionNumber: 1, steps: validSteps,
        aiMetadata: { confidence: 0.88, reasoning: 'Interpreted recording', modelVersion: 'gemini-2.0' },
        createdBy: 'u1',
      });
      expect(version.aiMetadata).not.toBeNull();
      expect(version.aiMetadata!.confidence).toBe(0.88);
      expect(version.aiMetadata!.reasoning).toBe('Interpreted recording');
    });

    it('defaults changeSummary to empty string', () => {
      const version = createTestCaseVersion({
        testCaseId: 'tc-001', versionNumber: 1, steps: validSteps, createdBy: 'u1',
      });
      expect(version.changeSummary).toBe('');
    });
  });

  // ── INV-ATCV2: versionNumber must be ≥ 1 ───────────────

  describe('INV-ATCV2: versionNumber validation', () => {
    it('throws when versionNumber is 0', () => {
      expect(() => createTestCaseVersion({
        testCaseId: 'tc-001', versionNumber: 0, steps: [], createdBy: 'u1',
      })).toThrow(ValueObjectError);
    });

    it('throws when versionNumber is negative', () => {
      expect(() => createTestCaseVersion({
        testCaseId: 'tc-001', versionNumber: -1, steps: [], createdBy: 'u1',
      })).toThrow(ValueObjectError);
    });
  });

  describe('approveVersion', () => {
    it('sets approvedBy and approvedAt', () => {
      const version = createTestCaseVersion({
        testCaseId: 'tc-001', versionNumber: 1, steps: validSteps, createdBy: 'u1',
      });
      const approved = approveVersion(version, 'user-999');
      expect(approved.approvedBy).toBe('user-999');
      expect(approved.approvedAt).toBeDefined();
    });

    it('throws when approvedBy is empty', () => {
      const version = createTestCaseVersion({
        testCaseId: 'tc-001', versionNumber: 1, steps: validSteps, createdBy: 'u1',
      });
      expect(() => approveVersion(version, '')).toThrow(MissingFieldError);
    });

    it('does not mutate the original version (immutability)', () => {
      const version = createTestCaseVersion({
        testCaseId: 'tc-001', versionNumber: 1, steps: validSteps, createdBy: 'u1',
      });
      approveVersion(version, 'user-999');
      expect(version.approvedBy).toBeNull();
    });
  });
});

// ── ApprovedTestCase Tests ────────────────────────────────

describe('ApprovedTestCase', () => {

  const validInput: CreateTestCaseInput = {
    projectId: 'prj-001',
    title: 'User can log in with valid credentials',
    description: 'Verifies that a registered user can log in and reach the dashboard',
    tags: ['smoke', 'auth'],
    priority: TestCasePriority.CRITICAL,
    createdBy: 'user-1862',
    steps: [
      { order: 0, action: StepAction.NAVIGATE, description: 'Go to login', input: '/login' },
      {
        order: 1, action: StepAction.CLICK, description: 'Click login button',
        elementId: 'elm-103',
      },
    ],
  };

  // ── createTestCase (ATC + Version 1) ───────────────────

  describe('createTestCase', () => {
    it('creates ATC with identity and version 1 as a pair', () => {
      const { testCase, version } = createTestCase(validInput);

      // ATC identity
      expect(testCase.id).toBeDefined();
      expect(testCase.projectId).toBe('prj-001');
      expect(testCase.title).toBe('User can log in with valid credentials');
      expect(testCase.description).toBe('Verifies that a registered user can log in and reach the dashboard');
      expect(testCase.tags).toEqual(['smoke', 'auth']);
      expect(testCase.priority).toBe(TestCasePriority.CRITICAL);
      expect(testCase.status).toBe(TestCaseStatus.DRAFT);
      expect(testCase.currentVersionId).toBe(version.id); // INV-ATC1
      expect(testCase.testDataRefs).toEqual([]);
      expect(testCase.createdBy).toBe('user-1862');

      // Version 1
      expect(version.testCaseId).toBe(testCase.id); // Fixed from 'pending'
      expect(version.versionNumber).toBe(1);
      expect(version.steps).toHaveLength(2);
    });

    it('defaults priority to MEDIUM when omitted', () => {
      const { testCase } = createTestCase({ ...validInput, priority: undefined });
      expect(testCase.priority).toBe(TestCasePriority.MEDIUM);
    });

    it('defaults tags to empty array', () => {
      const { testCase } = createTestCase({ ...validInput, tags: undefined });
      expect(testCase.tags).toEqual([]);
    });

    it('defaults testDataRefs to empty array', () => {
      const { testCase } = createTestCase({ ...validInput, testDataRefs: undefined });
      expect(testCase.testDataRefs).toEqual([]);
    });

    it('throws MissingFieldError when projectId is empty', () => {
      expect(() => createTestCase({ ...validInput, projectId: '' }))
        .toThrow(MissingFieldError);
    });

    it('throws MissingFieldError when title is empty', () => {
      expect(() => createTestCase({ ...validInput, title: '   ' }))
        .toThrow(MissingFieldError);
    });

    it('throws MissingFieldError when createdBy is empty', () => {
      expect(() => createTestCase({ ...validInput, createdBy: '' }))
        .toThrow(MissingFieldError);
    });

    // ── INV-ATC1: currentVersionId always points to v1 ───

    it('INV-ATC1: currentVersionId points to the created version', () => {
      const { testCase, version } = createTestCase(validInput);
      expect(testCase.currentVersionId).toBe(version.id);
    });
  });

  // ── updateTestCaseMetadata ──────────────────────────────

  describe('updateTestCaseMetadata', () => {
    it('updates title', () => {
      const { testCase } = createTestCase(validInput);
      const updated = updateTestCaseMetadata(testCase, { title: 'New Title' });
      expect(updated.title).toBe('New Title');
    });

    it('updates tags', () => {
      const { testCase } = createTestCase(validInput);
      const updated = updateTestCaseMetadata(testCase, { tags: ['new-tag'] });
      expect(updated.tags).toEqual(['new-tag']);
    });

    it('updates priority', () => {
      const { testCase } = createTestCase(validInput);
      const updated = updateTestCaseMetadata(testCase, { priority: TestCasePriority.LOW });
      expect(updated.priority).toBe(TestCasePriority.LOW);
    });

    it('updates updatedAt', async () => {
      const { testCase } = createTestCase(validInput);
      await new Promise(r => setTimeout(r, 5));
      const updated = updateTestCaseMetadata(testCase, { title: 'New' });
      expect(updated.updatedAt).not.toBe(testCase.updatedAt);
    });

    it('preserves currentVersionId (does not touch versions)', () => {
      const { testCase } = createTestCase(validInput);
      const updated = updateTestCaseMetadata(testCase, { title: 'New' });
      expect(updated.currentVersionId).toBe(testCase.currentVersionId);
    });

    it('throws when updating to empty title', () => {
      const { testCase } = createTestCase(validInput);
      expect(() => updateTestCaseMetadata(testCase, { title: '' }))
        .toThrow(MissingFieldError);
    });
  });

  // ── Status Transitions (INV-ATC2) ───────────────────────

  describe('INV-ATC2: status transitions', () => {
    it('allows draft → in_review', () => {
      expect(isValidStatusTransition(TestCaseStatus.DRAFT, TestCaseStatus.IN_REVIEW)).toBe(true);
    });

    it('allows in_review → approved', () => {
      expect(isValidStatusTransition(TestCaseStatus.IN_REVIEW, TestCaseStatus.APPROVED)).toBe(true);
    });

    it('allows in_review → draft (send back)', () => {
      expect(isValidStatusTransition(TestCaseStatus.IN_REVIEW, TestCaseStatus.DRAFT)).toBe(true);
    });

    it('allows approved → deprecated', () => {
      expect(isValidStatusTransition(TestCaseStatus.APPROVED, TestCaseStatus.DEPRECATED)).toBe(true);
    });

    it('allows approved → draft (revision)', () => {
      expect(isValidStatusTransition(TestCaseStatus.APPROVED, TestCaseStatus.DRAFT)).toBe(true);
    });

    it('rejects draft → approved (must go through review)', () => {
      expect(isValidStatusTransition(TestCaseStatus.DRAFT, TestCaseStatus.APPROVED)).toBe(false);
    });

    it('rejects deprecated → approved (terminal)', () => {
      expect(isValidStatusTransition(TestCaseStatus.DEPRECATED, TestCaseStatus.APPROVED)).toBe(false);
    });

    it('rejects deprecated → draft (terminal)', () => {
      expect(isValidStatusTransition(TestCaseStatus.DEPRECATED, TestCaseStatus.DRAFT)).toBe(false);
    });

    it('transitionStatus throws on invalid transition', () => {
      const { testCase } = createTestCase(validInput);
      expect(() => transitionStatus(testCase, TestCaseStatus.APPROVED))
        .toThrow(InvalidStatusTransitionError);
    });

    it('transitionStatus succeeds on valid transition', () => {
      const { testCase } = createTestCase(validInput);
      const inReview = transitionStatus(testCase, TestCaseStatus.IN_REVIEW);
      expect(inReview.status).toBe(TestCaseStatus.IN_REVIEW);
    });

    it('full workflow: draft → in_review → approved → deprecated', () => {
      const { testCase } = createTestCase(validInput);
      let tc = testCase;

      tc = transitionStatus(tc, TestCaseStatus.IN_REVIEW);
      expect(tc.status).toBe(TestCaseStatus.IN_REVIEW);

      tc = transitionStatus(tc, TestCaseStatus.APPROVED);
      expect(tc.status).toBe(TestCaseStatus.APPROVED);

      tc = transitionStatus(tc, TestCaseStatus.DEPRECATED);
      expect(tc.status).toBe(TestCaseStatus.DEPRECATED);
    });
  });

  // ── setCurrentVersion ───────────────────────────────────

  describe('setCurrentVersion', () => {
    it('updates currentVersionId', () => {
      const { testCase } = createTestCase(validInput);
      const updated = setCurrentVersion(testCase, 'tcv-new-version-id');
      expect(updated.currentVersionId).toBe('tcv-new-version-id');
    });

    it('throws when versionId is empty', () => {
      const { testCase } = createTestCase(validInput);
      expect(() => setCurrentVersion(testCase, ''))
        .toThrow(MissingFieldError);
    });
  });
});
