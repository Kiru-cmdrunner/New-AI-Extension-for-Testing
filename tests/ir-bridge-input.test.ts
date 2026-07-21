/**
 * Tests for IRStep extensions and IRBridgeInput model.
 *
 * Validates that:
 * - IRStep's new optional fields (aiEnrichment, sourceEventId, plainEnglish) are optional
 * - IRBridgeInput encapsulates all required inputs
 * - Existing IRStep usage (without the new fields) still works
 * - The types are compatible with the AIUnderstanding import
 */

import { describe, it, expect } from 'vitest';
import { IRAction, DEFAULT_EXECUTION_PARAMETERS, type IRStep, type ExecutionIRPlan } from '../src/domain/execution-ir/types';
import type { IRBridgeInput, IRBridgeRecordingContext } from '../src/generation/ir-bridge-input';
import type { SessionEvent, AIUnderstanding } from '../src/shared/types';
import type { DetectedInteraction } from '../src/classifier/interaction-types';
import type { ApplicationKnowledgeFragment } from '../src/domain/entities/application-knowledge';

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

describe('IRBridgeInput Model (Milestone 8.1)', () => {
  describe('IRBridgeRecordingContext', () => {
    it('accepts a context with startUrl and title', () => {
      const ctx: IRBridgeRecordingContext = {
        startUrl: 'https://example.com/login',
        title: 'Login Page',
      };

      expect(ctx.startUrl).toBe('https://example.com/login');
      expect(ctx.title).toBe('Login Page');
    });

    it('accepts a context with null title', () => {
      const ctx: IRBridgeRecordingContext = {
        startUrl: 'https://example.com',
        title: null,
      };

      expect(ctx.title).toBeNull();
    });
  });

  describe('IRBridgeInput', () => {
    it('encapsulates all required inputs', () => {
      const events: SessionEvent[] = [];
      const interactions: DetectedInteraction[] = [];
      const fragment: ApplicationKnowledgeFragment | null = null;

      const input: IRBridgeInput = {
        events,
        interactions,
        fragment,
        recordingContext: { startUrl: 'https://example.com', title: 'Test' },
        testCaseName: 'Login Test',
      };

      expect(input.events).toBe(events);
      expect(input.interactions).toBe(interactions);
      expect(input.fragment).toBeNull();
      expect(input.recordingContext.startUrl).toBe('https://example.com');
      expect(input.testCaseName).toBe('Login Test');
    });

    it('accepts a non-null fragment', () => {
      const fragment: ApplicationKnowledgeFragment = {
        sessionId: 'session-1',
        generatedAt: '2026-07-21T00:00:00Z',
        schemaVersion: 1,
        elements: [],
        transitions: [],
        components: [],
        interactionContracts: [],
        behavioralContracts: [],
        logicalActions: [],
        recordedWorkflow: {
          surfaceTransitions: [],
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
        applicationSurfaces: [],
      };

      const input: IRBridgeInput = {
        events: [],
        interactions: [],
        fragment,
        recordingContext: { startUrl: 'https://example.com', title: null },
        testCaseName: 'Test',
      };

      expect(input.fragment).not.toBeNull();
      expect(input.fragment?.sessionId).toBe('session-1');
    });

    it('is a stable interface — all 5 fields are present', () => {
      const input: IRBridgeInput = {
        events: [],
        interactions: [],
        fragment: null,
        recordingContext: { startUrl: '', title: null },
        testCaseName: '',
      };

      const keys = Object.keys(input);
      expect(keys).toHaveLength(5);
      expect(keys).toContain('events');
      expect(keys).toContain('interactions');
      expect(keys).toContain('fragment');
      expect(keys).toContain('recordingContext');
      expect(keys).toContain('testCaseName');
    });
  });
});
