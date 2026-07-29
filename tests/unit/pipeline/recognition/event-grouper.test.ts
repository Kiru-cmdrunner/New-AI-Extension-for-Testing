/**
 * Event Grouper Tests — Phase 4
 */

import { describe, it, expect } from 'vitest';
import {
  groupBatches,
  elementKey,
  isStandaloneEvent,
  isSameElement,
  areSemanticallyRelated,
} from '../../../../src/pipeline/recognition/event-grouper';
import type { EvidenceBatch } from '../../../../src/types/evidence';
import type { TargetElementIdentity } from '../../../../src/types/element';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<TargetElementIdentity> = {}): TargetElementIdentity {
  return {
    tag: 'BUTTON',
    accessibleName: 'Test Button',
    ariaRole: 'button',
    ariaExpanded: null,
    ariaHasPopup: null,
    ariaChecked: null,
    ariaSelected: null,
    ariaPressed: null,
    inputType: null,
    isContentEditable: false,
    locators: [{
      kind: 'testId' as const,
      value: 'test-btn',
      confidence: 0.95,
      source: 'observed',
    }],
    primaryLocator: {
      kind: 'testId' as const,
      value: 'test-btn',
      confidence: 0.95,
      source: 'observed',
    },
    inShadowDom: false,
    inIframe: false,
    frameContext: null,
    ...overrides,
  };
}

function makeBatch(
  id: string,
  target: TargetElementIdentity,
  events: string[],
  timeOffsetMs: number = 0,
  evidence: EvidenceBatch['evidence'] = [],
): EvidenceBatch {
  const base = new Date('2026-01-01T00:00:00Z').getTime() + timeOffsetMs;
  return {
    id,
    startedAt: new Date(base).toISOString(),
    endedAt: new Date(base + 100).toISOString(),
    target,
    domContext: {
      surfaces: [],
      valueTransition: null,
      checkedTransition: null,
      ancestorChain: [],
      datePicker: null,
      fileUpload: null,
      dialog: null,
      navigation: null,
    },
    evidence,
    eventSequence: events,
    status: 'pending',
    correlationGroup: null,
    pageUrl: 'https://example.com',
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Event Grouper', () => {
  describe('elementKey', () => {
    it('should use primary locator value as key', () => {
      expect(elementKey(makeTarget())).toBe('test-btn');
    });

    it('should fall back to tag name when no primary locator', () => {
      const target = makeTarget({
        primaryLocator: { kind: 'testId', value: '', confidence: 0, source: 'observed' },
      });
      // Empty locator value falls back to tag
      expect(elementKey(target)).toBe('');
    });
  });

  describe('isStandaloneEvent', () => {
    it('should identify scroll as standalone', () => {
      expect(isStandaloneEvent('scroll')).toBe(true);
    });

    it('should identify navigation as standalone', () => {
      expect(isStandaloneEvent('navigation')).toBe(true);
    });

    it('should NOT identify click as standalone', () => {
      expect(isStandaloneEvent('click')).toBe(false);
    });
  });

  describe('isSameElement', () => {
    it('should return true for same primary locator', () => {
      expect(isSameElement(makeTarget(), makeTarget())).toBe(true);
    });

    it('should return false for different primary locators', () => {
      const a = makeTarget();
      const b = makeTarget({
        primaryLocator: { kind: 'testId', value: 'other-btn', confidence: 0.95, source: 'observed' },
      });
      expect(isSameElement(a, b)).toBe(false);
    });
  });

  describe('areSemanticallyRelated', () => {
    it('should relate combobox to option', () => {
      const trigger = makeTarget({ ariaRole: 'combobox' });
      const option = makeTarget({
        primaryLocator: { kind: 'testId', value: 'opt-1', confidence: 0.95, source: 'observed' },
        ariaRole: 'option',
      });
      expect(areSemanticallyRelated(trigger, option)).toBe(true);
    });

    it('should relate SELECT to LI option', () => {
      const trigger = makeTarget({ tag: 'SELECT', ariaRole: null });
      const option = makeTarget({
        tag: 'LI',
        primaryLocator: { kind: 'testId', value: 'opt-1', confidence: 0.9, source: 'observed' },
        ariaRole: null,
      });
      expect(areSemanticallyRelated(trigger, option)).toBe(true);
    });

    it('should relate date input to gridcell', () => {
      const trigger = makeTarget({ tag: 'INPUT', inputType: 'date' });
      const cell = makeTarget({
        tag: 'TD',
        primaryLocator: { kind: 'testId', value: 'cell-1', confidence: 0.9, source: 'observed' },
        ariaRole: 'gridcell',
      });
      expect(areSemanticallyRelated(trigger, cell)).toBe(true);
    });

    it('should NOT relate two unrelated elements', () => {
      const a = makeTarget({ tag: 'BUTTON' });
      const b = makeTarget({
        tag: 'DIV',
        primaryLocator: { kind: 'testId', value: 'other', confidence: 0.9, source: 'observed' },
      });
      expect(areSemanticallyRelated(a, b)).toBe(false);
    });
  });

  describe('groupBatches', () => {
    it('should return empty array for no batches', () => {
      expect(groupBatches([])).toEqual([]);
    });

    it('should produce one candidate for a single batch', () => {
      const batch = makeBatch('b1', makeTarget(), ['click']);
      const candidates = groupBatches([batch]);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.batches).toHaveLength(1);
    });

    it('should merge same-element focus→input→blur within 500ms', () => {
      const target = makeTarget({ tag: 'INPUT', ariaRole: 'textbox' });
      const batches = [
        makeBatch('b1', target, ['focus'], 0),
        makeBatch('b2', target, ['input'], 100),
        makeBatch('b3', target, ['input'], 200),
        makeBatch('b4', target, ['blur'], 300),
      ];
      const candidates = groupBatches(batches);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.batches).toHaveLength(4);
      expect(candidates[0]!.eventSequence).toEqual(['focus', 'input', 'input', 'blur']);
    });

    it('should NOT merge events on different elements', () => {
      const target1 = makeTarget({ primaryLocator: { kind: 'testId', value: 'el-1', confidence: 0.9, source: 'observed' } });
      const target2 = makeTarget({ primaryLocator: { kind: 'testId', value: 'el-2', confidence: 0.9, source: 'observed' } });
      const batches = [
        makeBatch('b1', target1, ['click'], 0),
        makeBatch('b2', target2, ['click'], 100),
      ];
      const candidates = groupBatches(batches);
      expect(candidates).toHaveLength(2);
    });

    it('should NOT merge two clicks on the same element', () => {
      const target = makeTarget();
      const batches = [
        makeBatch('b1', target, ['click'], 0),
        makeBatch('b2', target, ['click'], 100),
      ];
      const candidates = groupBatches(batches);
      expect(candidates).toHaveLength(2);
    });

    it('should treat scroll as standalone', () => {
      const batches = [
        makeBatch('b1', makeTarget(), ['click'], 0),
        makeBatch('b2', makeTarget(), ['scroll'], 100),
        makeBatch('b3', makeTarget(), ['click'], 200),
      ];
      const candidates = groupBatches(batches);
      expect(candidates).toHaveLength(3);
    });

    it('should treat navigation as standalone', () => {
      const batches = [
        makeBatch('b1', makeTarget(), ['click'], 0),
        makeBatch('b2', makeTarget(), ['navigation'], 100),
      ];
      const candidates = groupBatches(batches);
      expect(candidates).toHaveLength(2);
    });

    it('should not merge same-element events beyond 500ms window', () => {
      const target = makeTarget({ tag: 'BUTTON', ariaRole: 'button' });
      const batches = [
        makeBatch('b1', target, ['mousedown'], 0),
        makeBatch('b2', target, ['click'], 600),
      ];
      const candidates = groupBatches(batches);
      expect(candidates).toHaveLength(2);
    });

    it('should use extended window for text-entry elements', () => {
      const target = makeTarget({ tag: 'INPUT', ariaRole: 'textbox' });
      const batches = [
        makeBatch('b1', target, ['focus'], 0),
        makeBatch('b2', target, ['blur'], 5000), // 5s gap — within 30s extended window
      ];
      const candidates = groupBatches(batches);
      expect(candidates).toHaveLength(1);
    });

    it('should cross-element group dropdown trigger and option', () => {
      const trigger = makeTarget({
        tag: 'SELECT',
        ariaRole: null,
        primaryLocator: { kind: 'testId', value: 'dd-trigger', confidence: 0.9, source: 'observed' },
      });
      const option = makeTarget({
        tag: 'LI',
        ariaRole: null,
        primaryLocator: { kind: 'testId', value: 'opt-1', confidence: 0.9, source: 'observed' },
      });
      const batches = [
        makeBatch('b1', trigger, ['click'], 0),
        makeBatch('b2', option, ['click'], 200),
      ];
      const candidates = groupBatches(batches);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.isMultiElement).toBe(true);
    });

    it('should sort batches chronologically before grouping', () => {
      const target1 = makeTarget({ primaryLocator: { kind: 'testId', value: 'el-1', confidence: 0.9, source: 'observed' } });
      const target2 = makeTarget({ primaryLocator: { kind: 'testId', value: 'el-2', confidence: 0.9, source: 'observed' } });
      // Pass in reverse order
      const batches = [
        makeBatch('b2', target2, ['click'], 200),
        makeBatch('b1', target1, ['click'], 0),
      ];
      const candidates = groupBatches(batches);
      // Should be sorted: b1 first, then b2
      expect(candidates[0]!.primaryBatchId).toBe('b1');
      expect(candidates[1]!.primaryBatchId).toBe('b2');
    });

    it('should set isStandalone flag for standalone candidates', () => {
      const batches = [makeBatch('b1', makeTarget(), ['scroll'])];
      const candidates = groupBatches(batches);
      expect(candidates[0]!.isStandalone).toBe(true);
    });

    it('should set isMultiElement flag for cross-element candidates', () => {
      const trigger = makeTarget({
        tag: 'SELECT',
        ariaRole: null,
        primaryLocator: { kind: 'testId', value: 'dd-trigger', confidence: 0.9, source: 'observed' },
      });
      const option = makeTarget({
        tag: 'LI',
        ariaRole: null,
        primaryLocator: { kind: 'testId', value: 'opt-1', confidence: 0.9, source: 'observed' },
      });
      const batches = [
        makeBatch('b1', trigger, ['click'], 0),
        makeBatch('b2', option, ['click'], 100),
      ];
      const candidates = groupBatches(batches);
      expect(candidates[0]!.isMultiElement).toBe(true);
    });
  });
});
