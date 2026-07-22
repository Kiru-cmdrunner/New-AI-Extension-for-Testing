/**
 * healElement() Tests — Phase 11 Milestone 11.1
 *
 * Tests the domain pure function for healing Element entities with fresh
 * locator strategies from cross-session recordings.
 */

import { describe, it, expect } from 'vitest';
import {
  createElement,
  healElement,
  updateElement,
  type Element,
  type CreateElementInput,
  type HealContext,
  type HealElementInput,
} from '../src/domain/entities/element';
import { ElementStatus, LocatorStrategyType } from '../src/domain/enums';

// ── Helpers ──────────────────────────────────────────────────

function makeElement(overrides: Partial<CreateElementInput> = {}): Element {
  return createElement({
    projectId: 'proj-001',
    logicalName: 'Submit Button',
    pageOrComponent: 'login-page',
    locatorStrategies: [
      { type: LocatorStrategyType.CSS, value: '.old-selector', priority: 1, confidence: 0.4 },
    ],
    ...overrides,
  });
}

function makeHealContext(overrides: Partial<HealContext> = {}): HealContext {
  return {
    sourceSessionId: 'session-002',
    reason: 'css-shifted',
    proposedBy: 'cross-session-matching',
    ...overrides,
  };
}

function makeHealInput(
  newStrategies: CreateElementInput['locatorStrategies'],
  contextOverrides: Partial<HealContext> = {},
): HealElementInput {
  return {
    newStrategies,
    context: makeHealContext(contextOverrides),
  };
}

// ── healElement() ────────────────────────────────────────────

describe('healElement', () => {
  describe('basic healing', () => {
    it('produces a new Element (does not mutate original)', () => {
      const original = makeElement();
      const healed = healElement(original, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
      ]));

      expect(healed).not.toBe(original);
      expect(original.healHistory).toHaveLength(0);
      expect(healed.healHistory).toHaveLength(1);
    });

    it('sets status to ACTIVE', () => {
      const stale = { ...makeElement(), status: ElementStatus.STALE };
      const healed = healElement(stale, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));
      expect(healed.status).toBe(ElementStatus.ACTIVE);
    });

    it('sets lastHealedAt to current timestamp', () => {
      const before = new Date().toISOString();
      const healed = healElement(makeElement(), makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));
      const after = new Date().toISOString();

      expect(healed.lastHealedAt).not.toBeNull();
      expect(healed.lastHealedAt! >= before).toBe(true);
      expect(healed.lastHealedAt! <= after).toBe(true);
    });

    it('updates updatedAt', () => {
      const original = makeElement();
      const healed = healElement(original, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));
      expect(healed.updatedAt >= original.updatedAt).toBe(true);
    });
  });

  describe('additive merge', () => {
    it('adds new strategies alongside existing ones', () => {
      const original = makeElement({
        locatorStrategies: [
          { type: LocatorStrategyType.CSS, value: '.old-btn', priority: 1, confidence: 0.4 },
        ],
      });
      const healed = healElement(original, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));

      // New strategy added + old strategy kept (different type)
      expect(healed.locatorStrategies).toHaveLength(2);
      expect(healed.locatorStrategies.find((s) => s.type === LocatorStrategyType.TEST_ID)).toBeDefined();
      expect(healed.locatorStrategies.find((s) => s.type === LocatorStrategyType.CSS)).toBeDefined();
    });

    it('replaces old strategy when new has same type but different value', () => {
      const original = makeElement({
        locatorStrategies: [
          { type: LocatorStrategyType.CSS, value: '.old-btn', priority: 1, confidence: 0.4 },
        ],
      });
      const healed = healElement(original, makeHealInput([
        { type: LocatorStrategyType.CSS, value: '.new-btn', priority: 1, confidence: 0.4 },
      ]));

      // Same type, new value replaces old
      const cssStrategies = healed.locatorStrategies.filter((s) => s.type === LocatorStrategyType.CSS);
      expect(cssStrategies).toHaveLength(1);
      expect(cssStrategies[0].value).toBe('.new-btn');
    });

    it('keeps exact match strategies unchanged', () => {
      const original = makeElement({
        locatorStrategies: [
          { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
        ],
      });
      const healed = healElement(original, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));

      // Same strategy — should be kept
      expect(healed.locatorStrategies).toHaveLength(1);
      expect(healed.locatorStrategies[0].value).toBe('submit');
    });

    it('assigns sequential priorities to merged strategies', () => {
      const original = makeElement({
        locatorStrategies: [
          { type: LocatorStrategyType.CSS, value: '.old', priority: 1, confidence: 0.4 },
        ],
      });
      const healed = healElement(original, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
        { type: LocatorStrategyType.ACCESSIBLE_NAME, value: 'Submit', priority: 2, confidence: 0.8 },
      ]));

      const priorities = healed.locatorStrategies.map((s) => s.priority);
      expect(priorities).toEqual([1, 2, 3]);
    });
  });

  describe('heal history', () => {
    it('appends a HealEvent to healHistory', () => {
      const original = makeElement();
      const healed = healElement(original, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));

      expect(healed.healHistory).toHaveLength(1);
      const event = healed.healHistory[0];
      expect(event.runId).toBe('session-002');
      expect(event.reason).toBe('css-shifted');
      expect(event.proposedBy).toBe('cross-session-matching');
    });

    it('preserves old strategies in HealEvent', () => {
      const original = makeElement({
        locatorStrategies: [
          { type: LocatorStrategyType.CSS, value: '.old-btn', priority: 1, confidence: 0.4 },
        ],
      });
      const healed = healElement(original, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));

      const event = healed.healHistory[0];
      expect(event.oldStrategies).toHaveLength(1);
      expect(event.oldStrategies[0].value).toBe('.old-btn');
    });

    it('stores merged strategies as newStrategies in HealEvent', () => {
      const original = makeElement({
        locatorStrategies: [
          { type: LocatorStrategyType.CSS, value: '.old', priority: 1, confidence: 0.4 },
        ],
      });
      const healed = healElement(original, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));

      const event = healed.healHistory[0];
      expect(event.newStrategies).toBe(healed.locatorStrategies);
    });

    it('accumulates multiple heal events', () => {
      let element = makeElement();

      element = healElement(element, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'v1', priority: 1, confidence: 0.95 },
      ], { sourceSessionId: 's1' }));

      element = healElement(element, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'v2', priority: 1, confidence: 0.95 },
      ], { sourceSessionId: 's2' }));

      expect(element.healHistory).toHaveLength(2);
      expect(element.healHistory[0].runId).toBe('s1');
      expect(element.healHistory[1].runId).toBe('s2');
    });
  });

  describe('status transitions', () => {
    it('heals STALE → ACTIVE', () => {
      const stale = { ...makeElement(), status: ElementStatus.STALE };
      const healed = healElement(stale, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));
      expect(healed.status).toBe(ElementStatus.ACTIVE);
    });

    it('heals BROKEN → ACTIVE', () => {
      const broken = { ...makeElement(), status: ElementStatus.BROKEN };
      const healed = healElement(broken, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));
      expect(healed.status).toBe(ElementStatus.ACTIVE);
    });

    it('keeps ACTIVE → ACTIVE (proactive heal)', () => {
      const active = makeElement(); // default ACTIVE
      const healed = healElement(active, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));
      expect(healed.status).toBe(ElementStatus.ACTIVE);
    });
  });

  describe('validation', () => {
    it('throws if sourceSessionId is empty', () => {
      expect(() =>
        healElement(makeElement(), makeHealInput(
          [{ type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 }],
          { sourceSessionId: '' },
        )),
      ).toThrow();
    });

    it('throws if newStrategies is empty', () => {
      expect(() =>
        healElement(makeElement(), makeHealInput([])),
      ).toThrow();
    });
  });

  describe('immutability', () => {
    it('does not modify the original element', () => {
      const original = makeElement();
      const originalStrategies = [...original.locatorStrategies];
      const originalHistory = [...original.healHistory];

      healElement(original, makeHealInput([
        { type: LocatorStrategyType.TEST_ID, value: 'submit', priority: 1, confidence: 0.95 },
      ]));

      expect(original.locatorStrategies).toEqual(originalStrategies);
      expect(original.healHistory).toEqual(originalHistory);
      expect(original.lastHealedAt).toBeNull();
    });
  });
});
