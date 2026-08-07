/**
 * Tests for IRStep extensions and IRBridgeInput model.
 *
 * Validates that:
 * - IRStep's new optional fields (aiEnrichment, sourceEventId, plainEnglish) are optional
 * - Existing IRStep usage (without the new fields) still works
 * - The types are compatible with the AIUnderstanding import
 *
 * NOTE: The IRBridgeInput model tests were removed in Phase 1.3.2 when the
 * ir-bridge-input.ts file was deleted. The GenerationInput interface in
 * generation-types.ts replaces it. See phase-1.3-implementation-plan.md.
 */

import { describe, it, expect } from 'vitest';
import { IRAction, DEFAULT_EXECUTION_PARAMETERS, type IRStep, type ExecutionIRPlan } from '../src/domain/execution-ir/types';
import type { AIUnderstanding } from '../src/shared/types';

describe('IRStep Extensions (Milestone 8.1)', () => {
  describe('optional recording-provenance fields', () => {
    it('creates a valid IRStep without any of the new optional fields', () => {
      const step: IRStep = {
        id: 'step-0001',
        order: 0,
        action: IRAction.CLICK,
        description: 'Click the Submit button',
        target: { kind: 'none' },
        input: null,
        assertions: [],
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
      };

      expect(step.aiEnrichment).toBeUndefined();
      expect(step.sourceEventId).toBeUndefined();
      expect(step.plainEnglish).toBeUndefined();
    });

    it('creates a valid IRStep with all new optional fields populated', () => {
      const aiEnrichment: AIUnderstanding = {
        businessName: 'Submit Button',
        controlType: 'Button',
        userIntent: 'Submit the login form',
        confidenceScore: 0.95,
      };

      const step: IRStep = {
        id: 'step-0001',
        order: 0,
        action: IRAction.CLICK,
        description: 'Click the Submit button',
        target: { kind: 'none' },
        input: null,
        assertions: [],
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment,
        sourceEventId: 'click-0001',
        plainEnglish: 'Click on the "Submit" button',
      };

      expect(step.aiEnrichment).toEqual(aiEnrichment);
      expect(step.sourceEventId).toBe('click-0001');
      expect(step.plainEnglish).toBe('Click on the "Submit" button');
    });

    it('allows aiEnrichment to be null (AI failed or not used)', () => {
      const step: IRStep = {
        id: 'step-0002',
        order: 1,
        action: IRAction.FILL,
        description: 'Fill the email field',
        target: { kind: 'none' },
        input: 'test@example.com',
        assertions: [],
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        aiEnrichment: null,
      };

      expect(step.aiEnrichment).toBeNull();
    });

    it('allows partial population (sourceEventId only, no aiEnrichment)', () => {
      const step: IRStep = {
        id: 'step-0003',
        order: 2,
        action: IRAction.NAVIGATE,
        description: 'Navigate to /dashboard',
        target: { kind: 'url', url: 'https://example.com/dashboard' },
        input: null,
        assertions: [],
        executionParameters: DEFAULT_EXECUTION_PARAMETERS,
        sourceEventId: 'nav-0001',
      };

      expect(step.sourceEventId).toBe('nav-0001');
      expect(step.aiEnrichment).toBeUndefined();
      expect(step.plainEnglish).toBeUndefined();
    });
  });

  describe('ExecutionIRPlan with extended IRSteps', () => {
    it('a full plan with extended steps type-checks correctly', () => {
      const plan: ExecutionIRPlan = {
        testCaseId: 'tc-001',
        testCaseVersionId: 'tcv-001',
        testCaseVersionNumber: 1,
        title: 'Login Test',
        tags: ['login', 'auth'],
        environment: {
          baseUrl: 'https://example.com',
          browser: 'chrome',
          viewport: { width: 1280, height: 720 },
        },
        steps: [
          {
            id: 'step-0001',
            order: 0,
            action: IRAction.FILL,
            description: 'Fill the email field with "admin@example.com"',
            target: { kind: 'none' },
            input: 'admin@example.com',
            assertions: [],
            executionParameters: DEFAULT_EXECUTION_PARAMETERS,
            sourceEventId: 'text-0001',
            plainEnglish: 'Type "admin@example.com" in the Email field',
          },
          {
            id: 'step-0002',
            order: 1,
            action: IRAction.CLICK,
            description: 'Click the Submit button',
            target: { kind: 'none' },
            input: null,
            assertions: [],
            executionParameters: DEFAULT_EXECUTION_PARAMETERS,
            sourceEventId: 'click-0001',
            aiEnrichment: {
              businessName: 'Submit Button',
              controlType: 'Button',
              userIntent: 'Submit the login form',
              confidenceScore: 0.92,
            },
          },
        ],
      };

      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].plainEnglish).toContain('Email field');
      expect(plan.steps[1].aiEnrichment?.businessName).toBe('Submit Button');
    });
  });
});
