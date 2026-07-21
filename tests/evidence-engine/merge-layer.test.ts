/**
 * Merge Layer Tests
 *
 * Tests the V2-primary-with-V1-fallback merge strategy.
 * Validates: event dedup, engine tagging, metrics accuracy,
 * threshold behavior, ordering, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { mergeV1V2, logMergeMetrics } from '../../src/classifier/evidence/merge-layer.js';
import type { DetectedInteraction } from '../../src/classifier/interaction-types.js';
import type { ElementIdentity } from '../../src/shared/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultTarget: ElementIdentity = {
  accessibleName: '', ariaRole: '', ariaLabel: '', ariaLabelledBy: '',
  placeholder: '', tag: 'DIV', className: '', name: '', stableId: null,
  testId: null, dataCy: null, dataQa: null, cssSelector: '', xPath: '',
  inIframe: false, shadowDom: false, elementId: 'el-0',
};

function makeInteraction(
  index: number,
  type: string,
  eventIds: string[],
  confidence: number,
  overrides: Partial<DetectedInteraction> = {},
): DetectedInteraction {
  return {
    interactionId: `int-${String(index).padStart(3, '0')}`,
    type: type as DetectedInteraction['type'],
    eventIds,
    rawEventTypes: eventIds.map(() => 'click'),
    target: defaultTarget,
    metadata: {},
    confidence,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Merge Layer — mergeV1V2()', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // Basic merge behavior
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic merge', () => {
    it('returns only V2 interactions when V2 handles everything', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),
        makeInteraction(1, 'TextEntry', ['evt-0002', 'evt-0003'], 0.9),
      ];
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),
        makeInteraction(1, 'TextEntry', ['evt-0002', 'evt-0003'], 0.5),
      ];

      const result = mergeV1V2(v2, v1, 3);

      expect(result.interactions).toHaveLength(2);
      expect(result.interactions.every(i => i.engine === 'v2')).toBe(true);
    });

    it('uses V1 fallback for events V2 did not claim', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),  // V2 claims evt-0001
      ];
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),  // overlaps → dropped
        makeInteraction(1, 'Hover', ['evt-0002'], 0.5),   // no overlap → survives
      ];

      const result = mergeV1V2(v2, v1, 2);

      expect(result.interactions).toHaveLength(2);
      const types = result.interactions.map(i => i.type);
      expect(types).toContain('Click');
      expect(types).toContain('Hover');
      expect(result.interactions.some(i => i.engine === 'v2')).toBe(true);
      expect(result.interactions.some(i => i.engine === 'v1-fallback')).toBe(true);
    });

    it('returns empty when both engines produce nothing', () => {
      const result = mergeV1V2([], [], 0);
      expect(result.interactions).toHaveLength(0);
      expect(result.metrics.totalInteractions).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Event dedup guarantee
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Event dedup guarantee', () => {
    it('no eventId appears in more than one interaction', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),
        makeInteraction(1, 'CustomDropdown', ['evt-0002', 'evt-0003'], 0.85),
      ];
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),
        makeInteraction(1, 'Click', ['evt-0002'], 0.5),
        makeInteraction(2, 'Hover', ['evt-0003'], 0.5),
        makeInteraction(3, 'Scroll', ['evt-0004'], 0.5),
      ];

      const result = mergeV1V2(v2, v1, 4);

      // Check no duplicate eventIds
      const allEventIds: string[] = [];
      for (const interaction of result.interactions) {
        allEventIds.push(...interaction.eventIds);
      }
      const uniqueIds = new Set(allEventIds);
      expect(allEventIds.length).toBe(uniqueIds.size);
    });

    it('V1 interaction with partial overlap is dropped entirely', () => {
      // V2 claims evt-0001. V1 has an interaction spanning evt-0001 + evt-0002.
      // The V1 interaction should be dropped entirely (not split).
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),
      ];
      const v1 = [
        makeInteraction(0, 'NativeDropdown', ['evt-0001', 'evt-0002'], 0.5),
      ];

      const result = mergeV1V2(v2, v1, 2);

      expect(result.interactions).toHaveLength(1);
      expect(result.interactions[0].type).toBe('Click');
      expect(result.interactions[0].engine).toBe('v2');
    });

    it('V1 interaction with zero overlap survives', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),
      ];
      const v1 = [
        makeInteraction(0, 'Hover', ['evt-0002'], 0.5),
        makeInteraction(1, 'Scroll', ['evt-0003'], 0.5),
      ];

      const result = mergeV1V2(v2, v1, 3);

      expect(result.interactions).toHaveLength(3);
      const v1Fallbacks = result.interactions.filter(i => i.engine === 'v1-fallback');
      expect(v1Fallbacks).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Confidence threshold
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Confidence threshold', () => {
    it('V2 interaction at exactly 0.5 confidence claims events', () => {
      const v2 = [makeInteraction(0, 'Click', ['evt-0001'], 0.5)];
      const v1 = [makeInteraction(0, 'Click', ['evt-0001'], 0.5)];

      const result = mergeV1V2(v2, v1, 1);

      expect(result.interactions).toHaveLength(1);
      expect(result.interactions[0].engine).toBe('v2');
    });

    it('V2 interaction below 0.5 does NOT claim events (falls to V1)', () => {
      const v2 = [makeInteraction(0, 'Click', ['evt-0001'], 0.49)];
      const v1 = [makeInteraction(0, 'Hover', ['evt-0001'], 0.5)];

      const result = mergeV1V2(v2, v1, 1);

      // V2 unconfident → doesn't claim evt-0001 → V1 claims it
      expect(result.interactions).toHaveLength(1);
      expect(result.interactions[0].engine).toBe('v1-fallback');
      expect(result.interactions[0].type).toBe('Hover');
    });

    it('V2 interaction with type=Unknown does NOT claim events even at high confidence', () => {
      const v2 = [makeInteraction(0, 'Unknown', ['evt-0001'], 0.7)];
      const v1 = [makeInteraction(0, 'Click', ['evt-0001'], 0.5)];

      const result = mergeV1V2(v2, v1, 1);

      expect(result.interactions).toHaveLength(1);
      expect(result.interactions[0].engine).toBe('v1-fallback');
    });

    it('mixed confidence: some V2 confident, some not', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),         // confident
        makeInteraction(1, 'Unknown', ['evt-0002'], 0.3),        // unconfident
        makeInteraction(2, 'CustomDropdown', ['evt-0003'], 0.85),// confident
      ];
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),          // dropped (overlap)
        makeInteraction(1, 'Hover', ['evt-0002'], 0.5),          // survives
        makeInteraction(2, 'Click', ['evt-0003'], 0.5),          // dropped (overlap)
      ];

      const result = mergeV1V2(v2, v1, 3);

      expect(result.interactions).toHaveLength(3);
      const engines = result.interactions.map(i => i.engine);
      expect(engines.filter(e => e === 'v2')).toHaveLength(2);
      expect(engines.filter(e => e === 'v1-fallback')).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Ordering
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Ordering', () => {
    it('merged interactions sorted by first eventId', () => {
      const v2 = [
        makeInteraction(0, 'CustomDropdown', ['evt-0003'], 0.85),  // later
        makeInteraction(1, 'Click', ['evt-0001'], 0.8),             // earlier
      ];
      const v1 = [
        makeInteraction(0, 'Hover', ['evt-0002'], 0.5),             // middle
      ];

      const result = mergeV1V2(v2, v1, 3);

      // evt-0001, evt-0002, evt-0003
      expect(result.interactions[0].eventIds[0]).toBe('evt-0001');
      expect(result.interactions[1].eventIds[0]).toBe('evt-0002');
      expect(result.interactions[2].eventIds[0]).toBe('evt-0003');
    });

    it('interactions remain in event order even with multi-event interactions', () => {
      const v2 = [
        makeInteraction(0, 'TextEntry', ['evt-0002', 'evt-0003'], 0.9),
        makeInteraction(1, 'Click', ['evt-0001'], 0.8),
      ];
      const v1: DetectedInteraction[] = [];

      const result = mergeV1V2(v2, v1, 3);

      expect(result.interactions[0].eventIds[0]).toBe('evt-0001');
      expect(result.interactions[1].eventIds[0]).toBe('evt-0002');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Metrics
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Metrics', () => {
    it('computes correct counts and percentages', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),
        makeInteraction(1, 'CustomDropdown', ['evt-0002'], 0.85),
        makeInteraction(2, 'Unknown', ['evt-0003'], 0.3),  // unconfident
      ];
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),   // dropped
        makeInteraction(1, 'Click', ['evt-0002'], 0.5),   // dropped
        makeInteraction(2, 'Hover', ['evt-0003'], 0.5),   // survives
      ];

      const result = mergeV1V2(v2, v1, 3);
      const m = result.metrics;

      expect(m.totalInteractions).toBe(3);   // 2 V2 + 1 V1
      expect(m.v2Count).toBe(2);
      expect(m.v1FallbackCount).toBe(1);
      expect(m.v2Percentage).toBe(66.7);
      expect(m.v1FallbackPercentage).toBe(33.3);
      expect(m.v2UnconfidentCount).toBe(1);
      expect(m.v1DroppedCount).toBe(2);
      expect(m.totalEvents).toBe(3);
      expect(m.eventsClaimedByV2).toBe(2);
      expect(m.eventsInV1Fallback).toBe(1);
    });

    it('100% V2 when no V1 fallback needed', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),
        makeInteraction(1, 'Click', ['evt-0002'], 0.8),
      ];
      const result = mergeV1V2(v2, [], 2);
      const m = result.metrics;

      expect(m.v2Count).toBe(2);
      expect(m.v1FallbackCount).toBe(0);
      expect(m.v2Percentage).toBe(100);
      expect(m.v1FallbackPercentage).toBe(0);
    });

    it('metrics handle empty input', () => {
      const result = mergeV1V2([], [], 0);
      const m = result.metrics;

      expect(m.totalInteractions).toBe(0);
      expect(m.v2Percentage).toBe(0);
      expect(m.v1FallbackPercentage).toBe(0);
      expect(m.v2UnconfidentCount).toBe(0);
      expect(m.v1DroppedCount).toBe(0);
    });

    it('counts multi-event interactions correctly in event metrics', () => {
      const v2 = [
        makeInteraction(0, 'TextEntry', ['evt-0001', 'evt-0002'], 0.9),
        makeInteraction(1, 'CustomDropdown', ['evt-0003', 'evt-0004', 'evt-0005'], 0.85),
      ];
      const result = mergeV1V2(v2, [], 5);
      const m = result.metrics;

      expect(m.eventsClaimedByV2).toBe(5);
      expect(m.eventsInV1Fallback).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Real-world scenario simulations
  // ═════════════════════════════════════════ +════════════════════════════════

  describe('Real-world simulations', () => {
    it('Google Flights booking flow: V2 handles complex widgets, V1 handles hover', () => {
      // Simulates the validated Google Flights flow
      const v2 = [
        // V2 groups combobox+option into one CustomDropdown
        makeInteraction(0, 'CustomDropdown', ['evt-0001', 'evt-0002'], 0.85),
        makeInteraction(1, 'CustomDropdown', ['evt-0003', 'evt-0004'], 0.85),
        // V2 groups combobox+listbox+option
        makeInteraction(2, 'CustomDropdown', ['evt-0005', 'evt-0006', 'evt-0007'], 0.85),
        // V2 groups input+gridcell into one DatePicker
        makeInteraction(3, 'DatePicker', ['evt-0008', 'evt-0009'], 0.7),
      ];
      // V1 sees these as individual clicks — all dropped due to overlap
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),
        makeInteraction(1, 'Click', ['evt-0002'], 0.5),
        makeInteraction(2, 'Click', ['evt-0003'], 0.5),
        makeInteraction(3, 'Click', ['evt-0004'], 0.5),
        makeInteraction(4, 'Click', ['evt-0005'], 0.5),
        makeInteraction(5, 'Click', ['evt-0006'], 0.5),
        makeInteraction(6, 'Click', ['evt-0007'], 0.5),
        makeInteraction(7, 'Click', ['evt-0008'], 0.5),
        makeInteraction(8, 'Click', ['evt-0009'], 0.5),
        // V1 catches a hover that V2 returned as Unknown (below threshold)
        makeInteraction(9, 'Hover', ['evt-0010'], 0.5),
      ];

      const result = mergeV1V2(v2, v1, 10);

      expect(result.interactions).toHaveLength(5);  // 4 V2 + 1 V1
      expect(result.metrics.v2Count).toBe(4);
      expect(result.metrics.v1FallbackCount).toBe(1);
      expect(result.metrics.v2Percentage).toBe(80);

      // The surviving V1 interaction should be the Hover
      const v1Interaction = result.interactions.find(i => i.engine === 'v1-fallback');
      expect(v1Interaction?.type).toBe('Hover');
    });

    it('Avis Ford form: V2 handles all interactions (100% V2)', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),
        makeInteraction(1, 'TextEntry', ['evt-0002', 'evt-0003'], 0.9),
        makeInteraction(2, 'NativeDropdown', ['evt-0004', 'evt-0005'], 0.99),
        makeInteraction(3, 'NativeDropdown', ['evt-0006', 'evt-0007'], 0.99),
        makeInteraction(4, 'TextEntry', ['evt-0008', 'evt-0009'], 0.9),
      ];

      const result = mergeV1V2(v2, [], 9);

      expect(result.interactions).toHaveLength(5);
      expect(result.metrics.v2Percentage).toBe(100);
      expect(result.metrics.v1FallbackCount).toBe(0);
    });

    it('mixed recording: V2 handles complex, V1 handles simple unmigrated types', () => {
      // A recording with both migrated types (handled by V2) and
      // unmigrated types (where V2 returns Click@0.6 but V1 might produce
      // a more specific type like Tab or Modal)
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),          // Submit button
        makeInteraction(1, 'CustomDropdown', ['evt-0002', 'evt-0003'], 0.85),  // Dropdown
        // V2 can only say Click for these unmigrated types:
        makeInteraction(2, 'Click', ['evt-0004'], 0.6),          // Tab switch
        makeInteraction(3, 'Click', ['evt-0005'], 0.6),          // Modal open
      ];
      // V1 has its own grouping — the tab and modal clicks have no V1 counterpart
      // that would overlap, so they'd survive as V1 fallbacks if V1 classifies them
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),
        makeInteraction(1, 'Click', ['evt-0002'], 0.5),
        makeInteraction(2, 'Click', ['evt-0003'], 0.5),
        // V1 might classify these differently
        makeInteraction(3, 'Click', ['evt-0004'], 0.5),          // V1 just sees Click too
        makeInteraction(4, 'Click', ['evt-0005'], 0.5),
      ];

      const result = mergeV1V2(v2, v1, 5);

      // V2 claims evt-0001 through evt-0005 → ALL V1 interactions are dropped
      expect(result.interactions).toHaveLength(4);
      expect(result.metrics.v2Count).toBe(4);
      expect(result.metrics.v1FallbackCount).toBe(0);
      expect(result.metrics.v1DroppedCount).toBe(5);
    });

    it('V2 returns Unknown for some events — V1 fills the gap', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),          // V2 confident
        makeInteraction(1, 'Unknown', ['evt-0002'], 0.3),        // V2 stumped
      ];
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),          // dropped
        makeInteraction(1, 'DragDrop', ['evt-0002'], 0.5),       // survives
      ];

      const result = mergeV1V2(v2, v1, 2);

      expect(result.interactions).toHaveLength(2);
      const v1Fallback = result.interactions.find(i => i.engine === 'v1-fallback');
      expect(v1Fallback?.type).toBe('DragDrop');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edge cases
  // ═════════════════════════════════════════════════════════ V══════════════════

  describe('Edge cases', () => {
    it('V2 produces interactions but V1 is empty — all V2', () => {
      const v2 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.8),
      ];
      const result = mergeV1V2(v2, [], 1);
      expect(result.interactions).toHaveLength(1);
      expect(result.interactions[0].engine).toBe('v2');
    });

    it('V1 produces interactions but V2 is empty — all V1 fallback', () => {
      const v1 = [
        makeInteraction(0, 'Hover', ['evt-0001'], 0.5),
        makeInteraction(1, 'Scroll', ['evt-0002'], 0.5),
      ];
      const result = mergeV1V2([], v1, 2);
      expect(result.interactions).toHaveLength(2);
      expect(result.interactions.every(i => i.engine === 'v1-fallback')).toBe(true);
    });

    it('V2 has all Unknown — all events fall to V1', () => {
      const v2 = [
        makeInteraction(0, 'Unknown', ['evt-0001'], 0.3),
        makeInteraction(1, 'Unknown', ['evt-0002'], 0.2),
      ];
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),
        makeInteraction(1, 'Scroll', ['evt-0002'], 0.5),
      ];

      const result = mergeV1V2(v2, v1, 2);

      expect(result.interactions).toHaveLength(2);
      expect(result.interactions.every(i => i.engine === 'v1-fallback')).toBe(true);
    });

    it('interaction with empty eventIds array — does not affect dedup', () => {
      const v2 = [
        makeInteraction(0, 'Click', [], 0.8),  // no eventIds (edge case)
      ];
      const v1 = [
        makeInteraction(0, 'Click', ['evt-0001'], 0.5),
      ];

      const result = mergeV1V2(v2, v1, 1);

      // V2 claims nothing → V1 survives
      expect(result.interactions).toHaveLength(2);
    });

    it('preserves metadata from winning interaction', () => {
      const v2 = [
        makeInteraction(0, 'CustomDropdown', ['evt-0001'], 0.85, {
          metadata: { selectedValue: 'New York' },
        }),
      ];

      const result = mergeV1V2(v2, [], 1);

      expect(result.interactions[0].metadata.selectedValue).toBe('New York');
    });

    it('preserves target element from winning interaction', () => {
      const target = { ...defaultTarget, tag: 'SELECT', accessibleName: 'Make' };
      const v2 = [
        makeInteraction(0, 'NativeDropdown', ['evt-0001'], 0.99, { target }),
      ];

      const result = mergeV1V2(v2, [], 1);

      expect(result.interactions[0].target).toEqual(target);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // logMergeMetrics
  // ═══════════════════════════════════════════════════════════════════════════

  describe('logMergeMetrics', () => {
    it('logs metrics without throwing', () => {
      const metrics = {
        totalInteractions: 10,
        v2Count: 7,
        v1FallbackCount: 3,
        v2Percentage: 70,
        v1FallbackPercentage: 30,
        v2UnconfidentCount: 1,
        v1DroppedCount: 4,
        totalEvents: 20,
        eventsClaimedByV2: 15,
        eventsInV1Fallback: 5,
      };

      expect(() => logMergeMetrics(metrics)).not.toThrow();
    });
  });
});
