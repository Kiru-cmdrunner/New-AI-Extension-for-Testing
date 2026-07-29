/**
 * Pattern Evaluator Tests — Phase 4
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateOperator,
  evaluatePattern,
} from '../../../../src/pipeline/recognition/pattern-evaluator';
import type { PatternDefinition } from '../../../../src/types/foundation';
import type { EvidenceBatch } from '../../../../src/types/evidence';
import type { TargetElementIdentity } from '../../../../src/types/element';
import type { InteractionCandidate } from '../../../../src/pipeline/recognition/event-grouper';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<TargetElementIdentity> = {}): TargetElementIdentity {
  return {
    tag: 'BUTTON',
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaExpanded: null,
    ariaHasPopup: null,
    ariaChecked: null,
    ariaSelected: null,
    ariaPressed: null,
    inputType: null,
    isContentEditable: false,
    locators: [{
      kind: 'testId',
      value: 'btn-1',
      confidence: 0.95,
      source: 'observed',
    }],
    primaryLocator: {
      kind: 'testId',
      value: 'btn-1',
      confidence: 0.95,
      source: 'observed',
    },
    inShadowDom: false,
    inIframe: false,
    frameContext: null,
    ...overrides,
  };
}

function makeCandidate(
  target: TargetElementIdentity,
  events: string[],
  domContextOverrides: Record<string, unknown> = {},
  evidence: EvidenceBatch['evidence'] = [],
): InteractionCandidate {
  const batch: EvidenceBatch = {
    id: 'b1',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:00.100Z',
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
      ...domContextOverrides,
    },
    evidence,
    eventSequence: events,
    status: 'pending',
    correlationGroup: null,
    pageUrl: 'https://example.com',
  };

  return {
    batches: [batch],
    primaryBatchId: 'b1',
    primaryTarget: target,
    eventSequence: events,
    startedAt: batch.startedAt,
    endedAt: batch.endedAt,
    isMultiElement: false,
    isStandalone: false,
  };
}

// ── Operator Tests ───────────────────────────────────────────────────────

describe('Pattern Evaluator', () => {
  describe('evaluateOperator', () => {
    it('equals — matching strings', () => {
      expect(evaluateOperator('equals', 'button', 'button')).toBe(true);
    });
    it('equals — non-matching strings', () => {
      expect(evaluateOperator('equals', 'button', 'link')).toBe(false);
    });
    it('notEquals', () => {
      expect(evaluateOperator('notEquals', 'button', 'link')).toBe(true);
    });
    it('contains — substring match', () => {
      expect(evaluateOperator('contains', 'combobox', 'combo')).toBe(true);
    });
    it('contains — array includes element', () => {
      expect(evaluateOperator('contains', ['click', 'mousedown'], 'click')).toBe(true);
    });
    it('contains — array includes all', () => {
      expect(evaluateOperator('contains', ['click', 'mousedown', 'focus'], ['click', 'focus'])).toBe(true);
    });
    it('notContains — string', () => {
      expect(evaluateOperator('notContains', 'button', 'xyz')).toBe(true);
    });
    it('exists — non-null', () => {
      expect(evaluateOperator('exists', { before: 'a', after: 'b' }, null)).toBe(true);
    });
    it('exists — null', () => {
      expect(evaluateOperator('exists', null, null)).toBe(false);
    });
    it('notExists — null', () => {
      expect(evaluateOperator('notExists', null, null)).toBe(true);
    });
    it('notExists — non-null', () => {
      expect(evaluateOperator('notExists', { a: 1 }, null)).toBe(false);
    });
    it('matches — valid regex', () => {
      expect(evaluateOperator('matches', 'btn-submit', '^btn-')).toBe(true);
    });
    it('matches — no match', () => {
      expect(evaluateOperator('matches', 'submit', '^btn-')).toBe(false);
    });
    it('matches — invalid regex returns false', () => {
      expect(evaluateOperator('matches', 'test', '(')).toBe(false);
    });
    it('greaterThan', () => {
      expect(evaluateOperator('greaterThan', 10, 5)).toBe(true);
      expect(evaluateOperator('greaterThan', 3, 5)).toBe(false);
    });
    it('lessThan', () => {
      expect(evaluateOperator('lessThan', 3, 5)).toBe(true);
      expect(evaluateOperator('lessThan', 10, 5)).toBe(false);
    });
    it('inRange', () => {
      expect(evaluateOperator('inRange', 5, [1, 10])).toBe(true);
      expect(evaluateOperator('inRange', 15, [1, 10])).toBe(false);
    });
    it('inRange — boundary', () => {
      expect(evaluateOperator('inRange', 1, [1, 10])).toBe(true);
      expect(evaluateOperator('inRange', 10, [1, 10])).toBe(true);
    });
  });

  describe('evaluatePattern', () => {
    const testPattern: PatternDefinition = {
      id: 'test-pattern',
      verb: 'click',
      componentType: 'Button',
      confidenceThreshold: 0.7,
      description: 'Test pattern',
      conditions: [
        {
          signalType: 'eventSequence',
          operator: 'contains',
          expected: 'click',
          weight: 1,
          description: 'click event',
        },
        {
          signalType: 'ariaRole',
          operator: 'equals',
          expected: 'button',
          weight: 2,
          description: 'button role',
        },
      ],
    };

    it('should match when all conditions met', () => {
      const candidate = makeCandidate(
        makeTarget({ ariaRole: 'button' }),
        ['click'],
      );
      const result = evaluatePattern(testPattern, candidate);
      expect(result.allConditionsMet).toBe(true);
      expect(result.confidence).toBe(1);
      expect(result.matchedCount).toBe(2);
    });

    it('should not match when ariaRole wrong', () => {
      const candidate = makeCandidate(
        makeTarget({ ariaRole: 'link' }),
        ['click'],
      );
      const result = evaluatePattern(testPattern, candidate);
      expect(result.allConditionsMet).toBe(false);
      expect(result.matchedCount).toBe(1);
    });

    it('should not match when no click event', () => {
      const candidate = makeCandidate(
        makeTarget({ ariaRole: 'button' }),
        ['focus'],
      );
      const result = evaluatePattern(testPattern, candidate);
      expect(result.allConditionsMet).toBe(false);
      expect(result.matchedCount).toBe(1);
    });

    it('should compute weighted confidence correctly', () => {
      const candidate = makeCandidate(
        makeTarget({ ariaRole: 'link' }),
        ['click'],
      );
      const result = evaluatePattern(testPattern, candidate);
      // weight 1 matched (click), weight 2 not matched (ariaRole=button)
      // confidence = 1 / (1+2) = 0.333
      expect(result.confidence).toBeCloseTo(1 / 3, 2);
    });

    it('should handle checkedTransition from domContext', () => {
      const pattern: PatternDefinition = {
        id: 'test-check',
        verb: 'toggle',
        componentType: 'Checkbox',
        confidenceThreshold: 0.7,
        description: 'Test checkbox',
        conditions: [
          {
            signalType: 'checkedTransition',
            operator: 'exists',
            expected: null,
            weight: 1,
            description: 'checked transition exists',
          },
        ],
      };
      const candidate = makeCandidate(
        makeTarget({ ariaRole: 'checkbox' }),
        ['click'],
        { checkedTransition: { before: false, after: true, property: 'checked' } },
      );
      const result = evaluatePattern(pattern, candidate);
      expect(result.allConditionsMet).toBe(true);
    });

    it('should handle valueTransition from domContext', () => {
      const pattern: PatternDefinition = {
        id: 'test-value',
        verb: 'fill',
        componentType: 'TextInput',
        confidenceThreshold: 0.6,
        description: 'Test text entry',
        conditions: [
          {
            signalType: 'valueTransition',
            operator: 'exists',
            expected: null,
            weight: 1,
            description: 'value changed',
          },
        ],
      };
      const candidate = makeCandidate(
        makeTarget({ tag: 'INPUT', ariaRole: 'textbox' }),
        ['input'],
        { valueTransition: { before: '', after: 'hello' } },
      );
      const result = evaluatePattern(pattern, candidate);
      expect(result.allConditionsMet).toBe(true);
    });

    it('should expose ariaAttribute for haspopup', () => {
      const pattern: PatternDefinition = {
        id: 'test-attr',
        verb: 'hover',
        componentType: 'Tooltip',
        confidenceThreshold: 0.5,
        description: 'Test hover',
        conditions: [
          {
            signalType: 'ariaAttribute',
            operator: 'contains',
            expected: 'haspopup',
            weight: 1,
            description: 'has aria-haspopup',
          },
        ],
      };
      const candidate = makeCandidate(
        makeTarget({ ariaHasPopup: 'dialog' }),
        ['mouseenter'],
      );
      const result = evaluatePattern(pattern, candidate);
      expect(result.allConditionsMet).toBe(true);
    });

    it('should produce condition results for tracing', () => {
      const candidate = makeCandidate(
        makeTarget({ ariaRole: 'button' }),
        ['click'],
      );
      const result = evaluatePattern(testPattern, candidate);
      expect(result.conditionResults).toHaveLength(2);
      expect(result.conditionResults[0]!.matched).toBe(true);
      expect(result.conditionResults[0]!.actualValue).toEqual(['click']);
      expect(result.conditionResults[1]!.matched).toBe(true);
      expect(result.conditionResults[1]!.actualValue).toBe('button');
    });
  });
});
