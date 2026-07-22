/**
 * Tests for ExecutionRun entity + ExecutionRunRepository.
 *
 * Tests cover:
 *   - createExecutionRun() factory: field validation, mapping from IRExecutionResult
 *   - ExecutionRun shape: all fields present, correct types
 *   - DexieExecutionRunRepository: CRUD operations (getById, getByTestCaseVersion,
 *     getByProject, save, delete)
 *   - Append-only semantics: save() always adds, never replaces
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { createExecutionRun, type CreateExecutionRunInput } from '../src/domain/entities/execution-run';
import type { IRExecutionResult, IRStepResult } from '../src/domain/execution-ir/adapters/ir-executor';
import { DexieUnitOfWorkFactory } from '../src/repository/v2';
import type { CmdRunnerDatabase } from '../src/repository/v2/dexie/dexie-database';

// ── Helpers ────────────────────────────────────────────────

function makeStepResult(overrides: Partial<IRStepResult> = {}): IRStepResult {
  return {
    stepId: 'step-1',
    status: 'passed',
    durationMs: 150,
    assertionResults: [],
    ...overrides,
  };
}

function makeExecutionResult(overrides: Partial<IRExecutionResult> = {}): IRExecutionResult {
  return {
    status: 'passed',
    stepResults: [makeStepResult()],
    startedAt: '2024-06-01T10:00:00Z',
    completedAt: '2024-06-01T10:00:05Z',
    durationMs: 5000,
    ...overrides,
  };
}

function makeCreateInput(overrides: Partial<CreateExecutionRunInput> = {}): CreateExecutionRunInput {
  return {
    testCaseId: 'tc-001',
    testCaseVersionId: 'tcv-001',
    projectId: 'proj-1',
    result: makeExecutionResult(),
    environment: {
      baseUrl: 'https://app.example.com',
      browser: 'chrome',
      viewport: { width: 1280, height: 720 },
    },
    healedElementIds: [],
    ...overrides,
  };
}

// ── Entity Tests ───────────────────────────────────────────

describe('createExecutionRun', () => {
  it('creates an ExecutionRun with all required fields', () => {
    const input = makeCreateInput();
    const run = createExecutionRun(input);

    expect(run.id).toBeDefined();
    expect(run.testCaseId).toBe('tc-001');
    expect(run.testCaseVersionId).toBe('tcv-001');
    expect(run.projectId).toBe('proj-1');
    expect(run.status).toBe('passed');
    expect(run.startedAt).toBe('2024-06-01T10:00:00Z');
    expect(run.completedAt).toBe('2024-06-01T10:00:05Z');
    expect(run.durationMs).toBe(5000);
    expect(run.healedElementIds).toEqual([]);
    expect(run.environment.baseUrl).toBe('https://app.example.com');
  });

  it('maps IRStepResult to ExecutionStepResult with step order', () => {
    const input = makeCreateInput({
      result: makeExecutionResult({
        stepResults: [
          makeStepResult({ stepId: 's1', status: 'passed' }),
          makeStepResult({ stepId: 's2', status: 'failed' }),
          makeStepResult({ stepId: 's3', status: 'skipped' }),
        ],
      }),
    });
    const run = createExecutionRun(input);

    expect(run.stepResults).toHaveLength(3);
    expect(run.stepResults[0].stepOrder).toBe(1);
    expect(run.stepResults[1].stepOrder).toBe(2);
    expect(run.stepResults[2].stepOrder).toBe(3);
  });

  it('maps error from IRStepResult to ExecutionStepResult', () => {
    const input = makeCreateInput({
      result: makeExecutionResult({
        stepResults: [
          makeStepResult({
            stepId: 's1',
            status: 'error',
            error: { message: 'Element not found', type: 'LocatorError' },
          }),
        ],
      }),
    });
    const run = createExecutionRun(input);

    expect(run.stepResults[0].error).toBeDefined();
    expect(run.stepResults[0].error?.message).toBe('Element not found');
    expect(run.stepResults[0].error?.type).toBe('LocatorError');
  });

  it('includes screenshots when provided', () => {
    const input = makeCreateInput({
      screenshots: { 'step-1': 'data:image/png;base64,abc123' },
    });
    const run = createExecutionRun(input);

    expect(run.stepResults[0].screenshot).toBe('data:image/png;base64,abc123');
  });

  it('defaults healed to false on all step results', () => {
    const run = createExecutionRun(makeCreateInput());
    expect(run.stepResults.every((s) => s.healed === false)).toBe(true);
  });

  it('throws when testCaseId is missing', () => {
    expect(() => createExecutionRun(makeCreateInput({ testCaseId: '' }))).toThrow(/testCaseId/);
  });

  it('throws when testCaseVersionId is missing', () => {
    expect(() => createExecutionRun(makeCreateInput({ testCaseVersionId: '' }))).toThrow(/testCaseVersionId/);
  });

  it('throws when projectId is missing', () => {
    expect(() => createExecutionRun(makeCreateInput({ projectId: '' }))).toThrow(/projectId/);
  });

  it('generates a unique ID for each run', () => {
    const run1 = createExecutionRun(makeCreateInput());
    const run2 = createExecutionRun(makeCreateInput());
    expect(run1.id).not.toBe(run2.id);
  });

  it('preserves healedElementIds', () => {
    const input = makeCreateInput({ healedElementIds: ['el-1', 'el-2'] });
    const run = createExecutionRun(input);
    expect(run.healedElementIds).toEqual(['el-1', 'el-2']);
  });
});

// ── Repository Tests ───────────────────────────────────────

describe('DexieExecutionRunRepository', () => {
  let factory: DexieUnitOfWorkFactory;
  let db: CmdRunnerDatabase;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
    db = factory.getDatabase();
  });

  afterEach(async () => {
    await db.executionRuns.clear();
    db.close();
  });

  it('saves and retrieves a run by ID', async () => {
    const uow = factory.create();
    const run = await uow.execute(async (repos) => {
      return repos.executionRuns.save(createExecutionRun(makeCreateInput()));
    });

    const retrieved = await db.executionRuns.get(run.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.testCaseId).toBe('tc-001');
  });

  it('retrieves runs by testCaseVersionId', async () => {
    const uow = factory.create();
    await uow.execute(async (repos) => {
      await repos.executionRuns.save(
        createExecutionRun(makeCreateInput({ testCaseVersionId: 'tcv-A' })),
      );
      await repos.executionRuns.save(
        createExecutionRun(makeCreateInput({ testCaseVersionId: 'tcv-A' })),
      );
      await repos.executionRuns.save(
        createExecutionRun(makeCreateInput({ testCaseVersionId: 'tcv-B' })),
      );
    });

    const uow2 = factory.create();
    const runsForA = await uow2.execute(async (repos) => {
      return repos.executionRuns.getByTestCaseVersion('tcv-A');
    });

    expect(runsForA).toHaveLength(2);
    expect(runsForA.every((r) => r.testCaseVersionId === 'tcv-A')).toBe(true);
  });

  it('retrieves runs by projectId', async () => {
    const uow = factory.create();
    await uow.execute(async (repos) => {
      await repos.executionRuns.save(
        createExecutionRun(makeCreateInput({ projectId: 'proj-X' })),
      );
      await repos.executionRuns.save(
        createExecutionRun(makeCreateInput({ projectId: 'proj-X' })),
      );
      await repos.executionRuns.save(
        createExecutionRun(makeCreateInput({ projectId: 'proj-Y' })),
      );
    });

    const uow2 = factory.create();
    const runsForX = await uow2.execute(async (repos) => {
      return repos.executionRuns.getByProject('proj-X');
    });

    expect(runsForX).toHaveLength(2);
  });

  it('delete removes a run', async () => {
    const uow = factory.create();
    const saved = await uow.execute(async (repos) => {
      const run = createExecutionRun(makeCreateInput());
      await repos.executionRuns.save(run);
      return run;
    });

    await uow.execute(async (repos) => {
      await repos.executionRuns.delete(saved.id);
    });

    const remaining = await db.executionRuns.get(saved.id);
    expect(remaining).toBeUndefined();
  });

  it('getById returns undefined for non-existent run', async () => {
    const uow = factory.create();
    const result = await uow.execute(async (repos) => {
      return repos.executionRuns.getById('non-existent');
    });
    expect(result).toBeUndefined();
  });

  it('save is append-only (multiple saves create multiple records)', async () => {
    const uow = factory.create();
    const run1 = createExecutionRun(makeCreateInput());
    const run2 = createExecutionRun(makeCreateInput());

    await uow.execute(async (repos) => {
      await repos.executionRuns.save(run1);
      await repos.executionRuns.save(run2);
    });

    const all = await db.executionRuns.toArray();
    expect(all).toHaveLength(2);
  });

  it('preserves step results with assertion results', async () => {
    const input = makeCreateInput({
      result: makeExecutionResult({
        stepResults: [
          makeStepResult({
            stepId: 's1',
            assertionResults: [
              { type: 'visibility' as any, passed: true, actualValue: true, message: 'Element is visible' },
              { type: 'textMatch' as any, passed: false, expectedValue: 'Success', actualValue: 'Error', message: 'Text mismatch' },
            ],
          }),
        ],
      }),
    });

    const uow = factory.create();
    const saved = await uow.execute(async (repos) => {
      return repos.executionRuns.save(createExecutionRun(input));
    });

    const retrieved = await db.executionRuns.get(saved.id);
    expect(retrieved?.stepResults[0].assertionResults).toHaveLength(2);
    expect(retrieved?.stepResults[0].assertionResults[0].passed).toBe(true);
    expect(retrieved?.stepResults[0].assertionResults[1].passed).toBe(false);
  });
});
