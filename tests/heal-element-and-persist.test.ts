/**
 * Tests for healElementAndPersist() — the source-agnostic healing core.
 *
 * These tests verify the shared core function independently of any specific
 * discovery flow (recording, execution-time, etc.). They use a mock
 * ElementRepository to isolate the core from the database layer.
 *
 * Key properties tested:
 *   - Loads Element by ID from the repository
 *   - Calls healElement() with provided strategies + context
 *   - Persists via repository.update(id, changes)
 *   - Returns the healed Element
 *   - Returns undefined when element not found
 *   - Passes through healElement() errors (empty strategies, missing context)
 *   - Heals with locators from ANY source (not just recording)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { healElementAndPersist, type HealElementInput } from '../src/repository/services/healing-service';
import type { ElementRepository } from '../src/repository/v2/interfaces/element-repository';
import type { Element } from '../src/domain/entities/element';
import { ElementStatus, LocatorStrategyType } from '../src/domain/enums';
import type { RankedLocator } from '../src/domain/locator-ranking';

// ── Mock Helpers ─────────────────────────────────────────────

function makeStoredElement(overrides: Partial<Element> = {}): Element {
  return {
    id: 'el-001',
    projectId: 'proj-1',
    logicalName: 'Submit Button',
    description: '',
    pageOrComponent: 'https://app.example.com/orders',
    locatorStrategies: [
      { type: LocatorStrategyType.CSS, value: '#old-submit', priority: 1, confidence: 0.75 },
    ],
    status: ElementStatus.ACTIVE,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    lastHealedAt: null,
    healHistory: [],
    ...overrides,
  };
}

function makeMockRepo(
  stored: Element | undefined,
): ElementRepository {
  return {
    getById: vi.fn(async () => stored),
    getByProject: vi.fn(async () => stored ? [stored] : []),
    getByPageComponent: vi.fn(async () => stored ? [stored] : []),
    create: vi.fn(),
    update: vi.fn(async (_id: string, _changes: any) => stored!),
    delete: vi.fn(),
    isReferenced: vi.fn(async () => []),
  } as unknown as ElementRepository;
}

function makeRankedLocators(): RankedLocator[] {
  return [
    { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
    { type: LocatorStrategyType.CSS, value: '#new-submit', priority: 2, confidence: 0.40 },
  ];
}

function makeHealContext() {
  return {
    sourceSessionId: 'session-exec-001',
    reason: 'execution-time-dom-inspection',
    proposedBy: 'ir-executor',
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('healElementAndPersist (source-agnostic core)', () => {
  let storedElement: Element;
  let mockRepo: ElementRepository;

  beforeEach(() => {
    storedElement = makeStoredElement();
    mockRepo = makeMockRepo(storedElement);
  });

  it('loads the Element from the repository by ID', async () => {
    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: makeRankedLocators(),
      context: makeHealContext(),
    };

    await healElementAndPersist(input, mockRepo);

    expect(mockRepo.getById).toHaveBeenCalledWith('el-001');
  });

  it('returns undefined when the Element is not found', async () => {
    mockRepo = makeMockRepo(undefined);

    const input: HealElementInput = {
      elementId: 'missing-el',
      newStrategies: makeRankedLocators(),
      context: makeHealContext(),
    };

    const result = await healElementAndPersist(input, mockRepo);
    expect(result).toBeUndefined();
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  it('calls healElement() and persists the result', async () => {
    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: makeRankedLocators(),
      context: makeHealContext(),
    };

    const result = await healElementAndPersist(input, mockRepo);

    expect(result).toBeDefined();
    expect(result?.id).toBe('el-001');
    // healElement() always sets status to ACTIVE
    expect(result?.status).toBe(ElementStatus.ACTIVE);
    // healElement() sets lastHealedAt
    expect(result?.lastHealedAt).not.toBeNull();
    // healElement() appends to healHistory
    expect(result?.healHistory).toHaveLength(1);

    // Verify update was called with the correct ID and shape
    expect(mockRepo.update).toHaveBeenCalledTimes(1);
    const [updateId, updateChanges] = (mockRepo.update as any).mock.calls[0];
    expect(updateId).toBe('el-001');
    expect(updateChanges).toHaveProperty('locatorStrategies');
    expect(updateChanges).toHaveProperty('status');
    expect(updateChanges).toHaveProperty('healHistory');
    expect(updateChanges).toHaveProperty('lastHealedAt');
  });

  it('preserves the heal context provenance in the heal event', async () => {
    const context = makeHealContext();
    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: makeRankedLocators(),
      context,
    };

    const result = await healElementAndPersist(input, mockRepo);

    expect(result?.healHistory[0].runId).toBe(context.sourceSessionId);
    expect(result?.healHistory[0].reason).toBe(context.reason);
    expect(result?.healHistory[0].proposedBy).toBe(context.proposedBy);
  });

  it('merges new locator strategies additively (old CSS preserved, new testId added)', async () => {
    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: makeRankedLocators(),
      context: makeHealContext(),
    };

    const result = await healElementAndPersist(input, mockRepo);

    const types = result?.locatorStrategies.map((s) => s.type);
    expect(types).toContain(LocatorStrategyType.TEST_ID);
    expect(types).toContain(LocatorStrategyType.CSS);

    // CSS value should be updated to the new one
    const cssLocator = result?.locatorStrategies.find((s) => s.type === LocatorStrategyType.CSS);
    expect(cssLocator?.value).toBe('#new-submit');

    // testId should have the new value
    const testIdLocator = result?.locatorStrategies.find((s) => s.type === LocatorStrategyType.TEST_ID);
    expect(testIdLocator?.value).toBe('submit-btn');
  });

  it('works with locators from execution-time DOM inspection (not just recording)', async () => {
    // Simulate locators that would come from a Playwright page.locator() call
    const executionLocators: RankedLocator[] = [
      { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
      { type: LocatorStrategyType.ACCESSIBLE_NAME, value: 'Submit', priority: 2, confidence: 0.65 },
    ];

    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: executionLocators,
      context: {
        sourceSessionId: 'exec-run-42',
        reason: 'locator-failure-retry',
        proposedBy: 'ir-executor',
      },
    };

    const result = await healElementAndPersist(input, mockRepo);

    expect(result).toBeDefined();
    expect(result?.healHistory[0].reason).toBe('locator-failure-retry');
    expect(result?.healHistory[0].proposedBy).toBe('ir-executor');
    expect(result?.healHistory[0].runId).toBe('exec-run-42');
  });

  it('works with locators from AI suggestion', async () => {
    const aiLocators: RankedLocator[] = [
      { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
    ];

    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: aiLocators,
      context: {
        sourceSessionId: 'ai-suggestion-1',
        reason: 'ai-proposed-locator',
        proposedBy: 'ai-healing-agent',
      },
    };

    const result = await healElementAndPersist(input, mockRepo);

    expect(result).toBeDefined();
    expect(result?.healHistory[0].proposedBy).toBe('ai-healing-agent');
  });

  it('throws ValueObjectError when newStrategies is empty', async () => {
    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: [],
      context: makeHealContext(),
    };

    await expect(healElementAndPersist(input, mockRepo)).rejects.toThrow(
      /newStrategies must have at least one strategy/,
    );
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  it('throws MissingFieldError when context.sourceSessionId is empty', async () => {
    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: makeRankedLocators(),
      context: {
        sourceSessionId: '',
        reason: 'test',
        proposedBy: 'test',
      },
    };

    await expect(healElementAndPersist(input, mockRepo)).rejects.toThrow(
      /sourceSessionId/,
    );
    expect(mockRepo.update).not.toHaveBeenCalled();
  });

  it('persists the correct locator strategies in the update call', async () => {
    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: makeRankedLocators(),
      context: makeHealContext(),
    };

    await healElementAndPersist(input, mockRepo);

    const [, changes] = (mockRepo.update as any).mock.calls[0];
    expect(changes.locatorStrategies).toHaveLength(2);
    // Each strategy should have type, value, priority, confidence
    for (const s of changes.locatorStrategies) {
      expect(s).toHaveProperty('type');
      expect(s).toHaveProperty('value');
      expect(s).toHaveProperty('priority');
      expect(s).toHaveProperty('confidence');
    }
    // Priorities should be unique and sequential
    const priorities = changes.locatorStrategies.map((s: any) => s.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it('appends to existing heal history (does not replace)', async () => {
    const existingHealEvent = {
      healedAt: '2024-01-01T01:00:00Z',
      runId: 'previous-session',
      reason: 'css-shifted',
      proposedBy: 'cross-session-matching',
      oldStrategies: [{ type: LocatorStrategyType.CSS, value: '#original', priority: 1, confidence: 0.75 }],
      newStrategies: [{ type: LocatorStrategyType.CSS, value: '#old-submit', priority: 1, confidence: 0.75 }],
    };
    storedElement = makeStoredElement({
      healHistory: [existingHealEvent],
    });
    mockRepo = makeMockRepo(storedElement);

    const input: HealElementInput = {
      elementId: 'el-001',
      newStrategies: makeRankedLocators(),
      context: makeHealContext(),
    };

    const result = await healElementAndPersist(input, mockRepo);

    expect(result?.healHistory).toHaveLength(2);
    expect(result?.healHistory[0]).toEqual(existingHealEvent);
    expect(result?.healHistory[1].runId).toBe('session-exec-001');
  });
});
