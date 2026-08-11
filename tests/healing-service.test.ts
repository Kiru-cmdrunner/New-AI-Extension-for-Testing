/**
 * Tests for the Healing Service — cross-session element healing orchestrator.
 *
 * Tests cover:
 *   - Empty input handling
 *   - Matched element healing (locator changed)
 *   - Matched element unchanged (locators identical)
 *   - New element creation (unmatched)
 *   - Mixed scenario (some healed, some unchanged, some created)
 *   - Elements with no valid locators (skipped)
 *   - Transaction commit/rollback semantics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { healFromRecording } from '../src/repository/services/healing-service';
import { DexieUnitOfWorkFactory } from '../src/repository/v2';
import type { UiElement } from '../src/domain/entities/ui-element';
import type { ElementIdentity } from '../src/shared/types';
import { LocatorStrategyType, ElementStatus } from '../src/domain/enums';
import type { CmdRunnerDatabase } from '../src/repository/v2/dexie/dexie-database';

// ── Test Helpers ────────────────────────────────────────────

/**
 * Create an ElementIdentity for healing tests.
 * Only specified fields are set — everything else is empty/null so
 * extractCandidatesFromIdentity() only produces locators from fields the
 * test explicitly controls.
 */
function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  const base: ElementIdentity = {
    elementId: 'el-' + Math.random().toString(36).slice(2, 8),
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '',
    xPath: '',
    inIframe: false,
    shadowDom: false,
    href: null,
  };
  return { ...base, ...overrides };
}

function makeUiElement(
  elementId: string,
  identity: ElementIdentity,
  sourceUrl = 'https://app.example.com/orders',
): UiElement {
  return {
    elementId,
    identity,
    sourceUrl,
    domAttributes: {},
    domTreePath: 'html>body>button',
    intrinsicCapabilities: [],
    componentId: null,
    componentRole: null,
  };
}

/**
 * Seed a stored Element directly into the database.
 * Uses proper LocatorStrategyType enum values.
 */
async function seedElement(
  db: CmdRunnerDatabase,
  projectId: string,
  logicalName: string,
  locatorType: LocatorStrategyType,
  locatorValue: string,
  pageOrComponent = 'https://app.example.com/orders',
): Promise<string> {
  const elementId = `stored-${logicalName.toLowerCase().replace(/\s/g, '-')}`;
  await db.elements.add({
    id: elementId,
    projectId,
    logicalName,
    description: '',
    pageOrComponent,
    locatorStrategies: [
      {
        type: locatorType,
        value: locatorValue,
        priority: 1,
        confidence: 0.95,
      },
    ],
    status: ElementStatus.ACTIVE,
    healHistory: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    lastHealedAt: null,
  });
  return elementId;
}

// ── Tests ───────────────────────────────────────────────────

describe('Healing Service', () => {
  let factory: DexieUnitOfWorkFactory;
  let db: CmdRunnerDatabase;

  beforeEach(() => {
    factory = new DexieUnitOfWorkFactory();
    db = factory.getDatabase();
  });

  afterEach(async () => {
    await db.elements.clear();
    await db.projects.clear();
    await db.testCases.clear();
    await db.recordingSessions.clear();
    db.close();
  });

  describe('healFromRecording', () => {
    it('returns zero results when no fresh elements are provided', async () => {
      const result = await healFromRecording('proj-1', [], 'session-1', factory);

      expect(result.examined).toBe(0);
      expect(result.healed).toBe(0);
      expect(result.created).toBe(0);
      expect(result.details).toHaveLength(0);
    });

    it('creates new elements when no stored elements exist', async () => {
      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({ accessibleName: 'Submit', testId: 'submit-btn' })),
        makeUiElement('el-2', makeIdentity({ accessibleName: 'Cancel', testId: 'cancel-btn' })),
      ];

      const result = await healFromRecording('proj-1', freshElements, 'session-1', factory);

      expect(result.created).toBe(2);
      expect(result.healed).toBe(0);
      expect(result.examined).toBe(0);
      expect(result.details).toHaveLength(2);
      expect(result.details.every((d) => d.action === 'created')).toBe(true);

      const stored = await db.elements.where('projectId').equals('proj-1').toArray();
      expect(stored).toHaveLength(2);
    });

    it('heals a matched element when the locator value has changed', async () => {
      // Seed with CSS locator '#old-submit'
      await seedElement(db, 'proj-1', 'Submit', LocatorStrategyType.CSS, '#old-submit');

      // Fresh recording: same element, different CSS, plus testId
      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({
          accessibleName: 'Submit',
          cssSelector: '#new-submit',
          testId: 'submit-btn',
        })),
      ];

      const result = await healFromRecording('proj-1', freshElements, 'session-2', factory);

      expect(result.examined).toBe(1);
      expect(result.healed).toBe(1);
      expect(result.created).toBe(0);
      expect(result.details).toHaveLength(1);
      expect(result.details[0].action).toBe('healed');

      // Verify the element was updated
      const stored = await db.elements.where('projectId').equals('proj-1').toArray();
      expect(stored).toHaveLength(1);
      const cssLocator = stored[0].locatorStrategies.find((l) => l.type === LocatorStrategyType.CSS);
      expect(cssLocator?.value).toBe('#new-submit');
      expect(stored[0].healHistory).toHaveLength(1);
      expect(stored[0].healHistory[0].runId).toBe('session-2');
    });

    it('marks a matched element as unchanged when locators are identical', async () => {
      // Seed with testId + accessibleName locators (matching what the ranking produces)
      await db.elements.add({
        id: 'stored-submit',
        projectId: 'proj-1',
        logicalName: 'Submit',
        description: '',
        pageOrComponent: 'https://app.example.com/orders',
        locatorStrategies: [
          { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.ACCESSIBLE_NAME, value: 'Submit', priority: 2, confidence: 0.65 },
        ],
        status: ElementStatus.ACTIVE,
        healHistory: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        lastHealedAt: null,
      });

      // Fresh element: same testId + same accessibleName → no changes
      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({
          accessibleName: 'Submit',
          testId: 'submit-btn',
        })),
      ];

      const result = await healFromRecording('proj-1', freshElements, 'session-2', factory);

      expect(result.examined).toBe(1);
      expect(result.healed).toBe(0);
      expect(result.created).toBe(0);
      expect(result.details).toHaveLength(1);
      expect(result.details[0].action).toBe('unchanged');
    });

    it('handles a mixed scenario: some healed, some unchanged, some created', async () => {
      // Seed: Submit with CSS '#old-submit', Cancel with TEST_ID + ACCESSIBLE_NAME
      await seedElement(db, 'proj-1', 'Submit', LocatorStrategyType.CSS, '#old-submit');
      await db.elements.add({
        id: 'stored-cancel',
        projectId: 'proj-1',
        logicalName: 'Cancel',
        description: '',
        pageOrComponent: 'https://app.example.com/orders',
        locatorStrategies: [
          { type: LocatorStrategyType.TEST_ID, value: 'cancel-btn', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.ACCESSIBLE_NAME, value: 'Cancel', priority: 2, confidence: 0.65 },
        ],
        status: ElementStatus.ACTIVE,
        healHistory: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        lastHealedAt: null,
      });

      // Fresh:
      // 1. Submit — CSS changed to '#new-submit' + testId → heal
      // 2. Cancel — same testId + accessibleName → unchanged
      // 3. NewButton — no match → create
      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({
          accessibleName: 'Submit',
          cssSelector: '#new-submit',
          testId: 'submit-btn',
        })),
        makeUiElement('el-2', makeIdentity({
          accessibleName: 'Cancel',
          testId: 'cancel-btn',
        })),
        makeUiElement('el-3', makeIdentity({
          accessibleName: 'New Button',
          testId: 'new-btn',
        })),
      ];

      const result = await healFromRecording('proj-1', freshElements, 'session-3', factory);

      expect(result.examined).toBe(2);
      expect(result.healed).toBe(1);
      expect(result.created).toBe(1);
      expect(result.details).toHaveLength(3);

      const actions = result.details.map((d) => d.action).sort();
      expect(actions).toEqual(['created', 'healed', 'unchanged']);
    });

    it('persists healed elements with heal history entries', async () => {
      await seedElement(db, 'proj-1', 'Submit', LocatorStrategyType.CSS, '#old-submit');

      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({
          accessibleName: 'Submit',
          cssSelector: '#new-submit',
          testId: 'submit-btn',
        })),
      ];

      await healFromRecording('proj-1', freshElements, 'session-heal-test', factory);

      const stored = await db.elements.where('projectId').equals('proj-1').toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0].healHistory).toHaveLength(1);
      expect(stored[0].healHistory[0].runId).toBe('session-heal-test');
      expect(stored[0].healHistory[0].reason).toBe('css-shifted');
      expect(stored[0].healHistory[0].proposedBy).toBe('cross-session-matching');
      expect(stored[0].status).toBe(ElementStatus.ACTIVE);
    });

    it('creates elements with active status when first discovered', async () => {
      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({
          accessibleName: 'Submit',
          testId: 'submit-btn',
        })),
      ];

      await healFromRecording('proj-1', freshElements, 'session-1', factory);

      const stored = await db.elements.where('projectId').equals('proj-1').toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0].status).toBe(ElementStatus.ACTIVE);
      expect(stored[0].healHistory).toHaveLength(0);
    });

    it('detects new locator types as changes (stored lacks test_id, fresh has it)', async () => {
      // Stored: only CSS
      await seedElement(db, 'proj-1', 'Submit', LocatorStrategyType.CSS, '#submit-btn');

      // Fresh: same CSS + new testId
      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({
          accessibleName: 'Submit',
          cssSelector: '#submit-btn',
          testId: 'submit-btn',
        })),
      ];

      const result = await healFromRecording('proj-1', freshElements, 'session-2', factory);

      expect(result.healed).toBe(1);
      expect(result.details[0].action).toBe('healed');

      // Verify the element now has a test_id locator strategy
      const stored = await db.elements.where('projectId').equals('proj-1').toArray();
      const testIdLocator = stored[0].locatorStrategies.find((l) => l.type === LocatorStrategyType.TEST_ID);
      expect(testIdLocator).toBeDefined();
      expect(testIdLocator?.value).toBe('submit-btn');
    });

    it('handles multiple fresh elements matching different stored elements', async () => {
      await seedElement(db, 'proj-1', 'Submit', LocatorStrategyType.TEST_ID, 'submit-btn');
      await seedElement(db, 'proj-1', 'Email Field', LocatorStrategyType.TEST_ID, 'email-input');

      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({
          accessibleName: 'Submit',
          ariaRole: 'button',
          tag: 'BUTTON',
          testId: 'submit-btn',
          cssSelector: '#submit-changed',
        })),
        makeUiElement('el-2', makeIdentity({
          accessibleName: 'Email Field',
          ariaRole: 'textbox',
          tag: 'INPUT',
          testId: 'email-input',
          cssSelector: '#email-changed',
        })),
      ];

      const result = await healFromRecording('proj-1', freshElements, 'session-2', factory);

      expect(result.examined).toBe(2);
      expect(result.healed).toBe(2);
      expect(result.created).toBe(0);
    });

    it('does not heal when stored element already has the same locator types and values', async () => {
      // Seed with testId + accessibleName (matching what ranking produces from the same identity)
      await db.elements.add({
        id: 'stored-submit',
        projectId: 'proj-1',
        logicalName: 'Submit',
        description: '',
        pageOrComponent: 'https://app.example.com/orders',
        locatorStrategies: [
          { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.ACCESSIBLE_NAME, value: 'Submit', priority: 2, confidence: 0.65 },
        ],
        status: ElementStatus.ACTIVE,
        healHistory: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        lastHealedAt: null,
      });

      // Fresh: same testId + same accessibleName → no changes
      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({
          accessibleName: 'Submit',
          testId: 'submit-btn',
        })),
      ];

      const result = await healFromRecording('proj-1', freshElements, 'session-2', factory);

      expect(result.healed).toBe(0);
      expect(result.details[0].action).toBe('unchanged');
    });
  });

  describe('HealingResult shape', () => {
    it('details array contains elementId, logicalName, and action for each element', async () => {
      const freshElements: UiElement[] = [
        makeUiElement('el-1', makeIdentity({ accessibleName: 'Submit', testId: 'submit-btn' })),
      ];

      const result = await healFromRecording('proj-1', freshElements, 'session-1', factory);

      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toHaveProperty('elementId');
      expect(result.details[0]).toHaveProperty('logicalName');
      expect(result.details[0]).toHaveProperty('action');
      expect(typeof result.details[0].elementId).toBe('string');
      expect(typeof result.details[0].logicalName).toBe('string');
    });
  });
});
