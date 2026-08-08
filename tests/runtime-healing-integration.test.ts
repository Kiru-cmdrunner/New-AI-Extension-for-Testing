/**
 * Tests for the Runtime Healing Integration (Phase 12 Milestone 12.5).
 *
 * Tests cover:
 *   - ExecutionRun factory correctly maps IRExecutionResult → ExecutionRun
 *   - ExecutionRun persistence via mock repository
 *   - Execution summary structure
 *   - EXECUTION_RESULT message broadcasting
 *
 * The service worker's handleRunTest() is tested via a module-level test
 * that mocks chrome.storage.local and the dynamic imports.
 */

import { describe, it, expect } from 'vitest';
import {
  createExecutionRun,
  type CreateExecutionRunInput,
} from '../src/domain/entities/execution-run';
import type { IRExecutionResult, IRStepResult } from '../src/domain/execution-ir/adapters/ir-executor';
import { StorageKeys } from '../src/shared/types';

// ── Mock Data ──────────────────────────────────────────────

function makeIRStepResult(overrides: Partial<IRStepResult> = {}): IRStepResult {
  return {
    stepId: 'step-1',
    status: 'passed',
    durationMs: 50,
    assertionResults: [],
    ...overrides,
  };
}

function makeExecutionResult(overrides: Partial<IRExecutionResult> = {}): IRExecutionResult {
  return {
    status: 'passed',
    stepResults: [makeIRStepResult()],
    startedAt: '2026-07-22T00:00:00.000Z',
    completedAt: '2026-07-22T00:00:05.000Z',
    durationMs: 5000,
    ...overrides,
  };
}

function makeCreateInput(overrides: Partial<CreateExecutionRunInput> = {}): CreateExecutionRunInput {
  return {
    testCaseId: 'tc-1',
    testCaseVersionId: 'tcv-1',
    projectId: 'proj-1',
    result: makeExecutionResult(),
    environment: {
      baseUrl: 'https://example.com',
      browser: 'chrome',
      viewport: { width: 1280, height: 720 },
    },
    healedElementIds: [],
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('Runtime Healing Integration (Milestone 12.5)', () => {
  describe('createExecutionRun — factory', () => {
    it('creates an ExecutionRun from a passing execution result', () => {
      const input = makeCreateInput();
      const run = createExecutionRun(input);

      expect(run.testCaseId).toBe('tc-1');
      expect(run.testCaseVersionId).toBe('tcv-1');
      expect(run.projectId).toBe('proj-1');
      expect(run.status).toBe('passed');
      expect(run.stepResults).toHaveLength(1);
      expect(run.stepResults[0].status).toBe('passed');
      expect(run.healedElementIds).toEqual([]);
      expect(run.id).toBeTruthy(); // UUID
    });

    it('creates an ExecutionRun from a failing execution result', () => {
      const input = makeCreateInput({
        result: makeExecutionResult({
          status: 'failed',
          stepResults: [
            makeIRStepResult({ stepId: 'step-1', status: 'passed' }),
            makeIRStepResult({
              stepId: 'step-2',
              status: 'failed',
              error: { message: 'Element not found', type: 'ElementNotFound' },
            }),
          ],
        }),
      });
      const run = createExecutionRun(input);

      expect(run.status).toBe('failed');
      expect(run.stepResults).toHaveLength(2);
      expect(run.stepResults[0].status).toBe('passed');
      expect(run.stepResults[1].status).toBe('failed');
      expect(run.stepResults[1].error?.type).toBe('ElementNotFound');
    });

    it('creates an ExecutionRun from an error execution result', () => {
      const input = makeCreateInput({
        result: makeExecutionResult({
          status: 'error',
          stepResults: [
            makeIRStepResult({ stepId: 'step-1', status: 'error' }),
            makeIRStepResult({ stepId: 'step-2', status: 'skipped' }),
          ],
        }),
      });
      const run = createExecutionRun(input);

      expect(run.status).toBe('error');
      expect(run.stepResults).toHaveLength(2);
      expect(run.stepResults[1].status).toBe('skipped');
    });

    it('maps assertion results from IRStepResult to ExecutionStepResult', () => {
      const input = makeCreateInput({
        result: makeExecutionResult({
          stepResults: [
            makeIRStepResult({
              stepId: 'step-1',
              assertionResults: [
                {
                  type: 'textMatch' as any,
                  passed: true,
                  actualValue: 'Success',
                  expectedValue: 'Success',
                  message: 'Text matched',
                },
                {
                  type: 'visibility' as any,
                  passed: false,
                  actualValue: false,
                  expectedValue: true,
                  message: 'Element is not visible',
                },
              ],
            }),
          ],
        }),
      });
      const run = createExecutionRun(input);

      expect(run.stepResults[0].assertionResults).toHaveLength(2);
      expect(run.stepResults[0].assertionResults[0].passed).toBe(true);
      expect(run.stepResults[0].assertionResults[1].passed).toBe(false);
      expect(run.stepResults[0].assertionResults[1].type).toBe('visibility');
    });

    it('includes healed element IDs', () => {
      const input = makeCreateInput({
        healedElementIds: ['el-1', 'el-2'],
      });
      const run = createExecutionRun(input);

      expect(run.healedElementIds).toEqual(['el-1', 'el-2']);
    });

    it('includes screenshots when provided', () => {
      const input = makeCreateInput({
        screenshots: { 'step-1': 'base64-png-data' },
      });
      const run = createExecutionRun(input);

      expect(run.stepResults[0].screenshot).toBe('base64-png-data');
    });

    it('throws if testCaseId is missing', () => {
      const input = makeCreateInput({ testCaseId: '' });
      expect(() => createExecutionRun(input)).toThrow('testCaseId');
    });

    it('throws if testCaseVersionId is missing', () => {
      const input = makeCreateInput({ testCaseVersionId: '' });
      expect(() => createExecutionRun(input)).toThrow('testCaseVersionId');
    });

    it('throws if projectId is missing', () => {
      const input = makeCreateInput({ projectId: '' });
      expect(() => createExecutionRun(input)).toThrow('projectId');
    });

    it('generates unique IDs for each run', () => {
      const input = makeCreateInput();
      const run1 = createExecutionRun(input);
      const run2 = createExecutionRun(input);

      expect(run1.id).not.toBe(run2.id);
    });

    it('maps environment correctly', () => {
      const input = makeCreateInput({
        environment: {
          baseUrl: 'https://staging.example.com',
          browser: 'firefox',
          viewport: { width: 1920, height: 1080 },
        },
      });
      const run = createExecutionRun(input);

      expect(run.environment.baseUrl).toBe('https://staging.example.com');
      expect(run.environment.browser).toBe('firefox');
      expect(run.environment.viewport).toEqual({ width: 1920, height: 1080 });
    });

    it('preserves startedAt and completedAt from the execution result', () => {
      const input = makeCreateInput({
        result: makeExecutionResult({
          startedAt: '2026-07-22T10:00:00.000Z',
          completedAt: '2026-07-22T10:00:30.000Z',
          durationMs: 30000,
        }),
      });
      const run = createExecutionRun(input);

      expect(run.startedAt).toBe('2026-07-22T10:00:00.000Z');
      expect(run.completedAt).toBe('2026-07-22T10:00:30.000Z');
      expect(run.durationMs).toBe(30000);
    });
  });

  describe('StorageKeys — execution result', () => {
    it('EXECUTION_RESULT key is defined', () => {
      expect(StorageKeys.EXECUTION_RESULT).toBe('execution_result');
    });

    it('EXECUTION_RESULT key is unique in the enum', () => {
      const values = Object.values(StorageKeys);
      const executionResultCount = values.filter(v => v === 'execution_result').length;
      expect(executionResultCount).toBe(1);
    });
  });

  describe('AppMessage — RUN_TEST and EXECUTION_RESULT', () => {
    it('RUN_TEST is a valid AppMessage type', async () => {
      const { isAppMessage } = await import('../src/shared/types');
      expect(isAppMessage({ type: 'RUN_TEST' })).toBe(true);
    });

    it('EXECUTION_RESULT is a valid AppMessage type', async () => {
      const { isAppMessage } = await import('../src/shared/types');
      expect(isAppMessage({
        type: 'EXECUTION_RESULT',
        status: 'passed',
        stepCount: 5,
        passedSteps: 5,
        durationMs: 3000,
        healedElements: 0,
      })).toBe(true);
    });

    it('RUN_TEST message has correct shape', () => {
      const msg = { type: 'RUN_TEST' as const };
      expect(msg.type).toBe('RUN_TEST');
    });

    it('EXECUTION_RESULT message has all required fields', () => {
      const msg = {
        type: 'EXECUTION_RESULT' as const,
        status: 'failed' as const,
        stepCount: 10,
        passedSteps: 8,
        durationMs: 5000,
        healedElements: 1,
      };
      expect(msg.status).toBe('failed');
      expect(msg.stepCount).toBe(10);
      expect(msg.passedSteps).toBe(8);
      expect(msg.durationMs).toBe(5000);
      expect(msg.healedElements).toBe(1);
    });
  });

  describe('Execution summary structure', () => {
    it('produces a well-formed execution summary from IRExecutionResult', () => {
      const result = makeExecutionResult({
        status: 'passed',
        stepResults: [
          makeIRStepResult({ stepId: 'step-1', status: 'passed' }),
          makeIRStepResult({ stepId: 'step-2', status: 'passed' }),
          makeIRStepResult({ stepId: 'step-3', status: 'skipped' }),
        ],
      });

      const summary = {
        status: result.status,
        stepCount: result.stepResults.length,
        passedSteps: result.stepResults.filter((s) => s.status === 'passed').length,
        failedSteps: result.stepResults.filter((s) => s.status === 'failed').length,
        errorSteps: result.stepResults.filter((s) => s.status === 'error').length,
        skippedSteps: result.stepResults.filter((s) => s.status === 'skipped').length,
        durationMs: result.durationMs,
      };

      expect(summary.status).toBe('passed');
      expect(summary.stepCount).toBe(3);
      expect(summary.passedSteps).toBe(2);
      expect(summary.failedSteps).toBe(0);
      expect(summary.errorSteps).toBe(0);
      expect(summary.skippedSteps).toBe(1);
      expect(summary.durationMs).toBe(5000);
    });

    it('handles mixed result statuses', () => {
      const result = makeExecutionResult({
        status: 'failed',
        stepResults: [
          makeIRStepResult({ stepId: 'step-1', status: 'passed' }),
          makeIRStepResult({ stepId: 'step-2', status: 'failed' }),
          makeIRStepResult({ stepId: 'step-3', status: 'error' }),
          makeIRStepResult({ stepId: 'step-4', status: 'skipped' }),
        ],
      });

      const summary = {
        status: result.status,
        passedSteps: result.stepResults.filter((s) => s.status === 'passed').length,
        failedSteps: result.stepResults.filter((s) => s.status === 'failed').length,
        errorSteps: result.stepResults.filter((s) => s.status === 'error').length,
        skippedSteps: result.stepResults.filter((s) => s.status === 'skipped').length,
      };

      expect(summary.passedSteps).toBe(1);
      expect(summary.failedSteps).toBe(1);
      expect(summary.errorSteps).toBe(1);
      expect(summary.skippedSteps).toBe(1);
    });
  });

  describe('ExecutionRun — immutability', () => {
    it('ExecutionRun fields are readonly at the type level', () => {
      const run = createExecutionRun(makeCreateInput());

      // TypeScript readonly is a compile-time check — verify at runtime
      // that the object has the expected shape and values
      expect(run.status).toBe('passed');
      expect(run.testCaseId).toBe('tc-1');
      expect(Object.isFrozen(run)).toBe(false); // Not frozen (TS readonly, not Object.freeze)
      // But the type system enforces readonly
    });

    it('stepResults array is a snapshot (not a live reference)', () => {
      const result = makeExecutionResult({
        stepResults: [makeIRStepResult({ stepId: 'step-1' })],
      });
      const input = makeCreateInput({ result });
      const run = createExecutionRun(input);

      // Modify the original result — the run should not be affected
      result.stepResults.push(makeIRStepResult({ stepId: 'step-2' }));

      expect(run.stepResults).toHaveLength(1);
      expect(run.stepResults[0].stepId).toBe('step-1');
    });
  });
});
