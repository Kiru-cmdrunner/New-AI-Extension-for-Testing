/**
 * Unit Tests: Workflow Normalizer
 *
 * Tests the semantic refinement layer that removes Unclassified interactions
 * subsumed by recognized interactions on the same element within a gesture window.
 *
 * Architecture: `.drytis/specs/workflow-normalizer.md`
 */

import { describe, it, expect } from 'vitest';
import { normalizeWorkflow, GESTURE_WINDOW_MS } from '../../src/presentation/workflow-normalizer';
import type { ComponentInteraction, ElementIdentity } from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
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
    cssSelector: 'button',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: '',
    ...overrides,
  };
}

let interactionCounter = 0;

function makeInteraction(
  overrides: Partial<ComponentInteraction> & { type: string },
): ComponentInteraction {
  interactionCounter++;
  const target = overrides.trigger ?? makeTarget({ accessibleName: 'Test', tag: 'BUTTON', cssSelector: '#btn' });
  const eventType = overrides.metadata?.physicalEventType ?? 'click';
  const event = makeObservedEvent({
    eventId: `e${interactionCounter}`,
    eventType: eventType as any,
    target,
    timestamp: overrides.startTime ?? 1000,
  });

  return {
    interactionId: `int-${interactionCounter}`,
    trigger: target,
    triggerEvent: event,
    memberEvents: [event],
    startTime: 1000,
    endTime: 1200,
    endState: 'completed',
    metadata: {},
    ...overrides,
  } as ComponentInteraction;
}

function resetCounter() {
  interactionCounter = 0;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Workflow Normalizer', () => {

  describe('basic subsumption', () => {

    it('subsumes Unclassified(mousedown) when Click follows on same element', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Submit', tag: 'BUTTON', cssSelector: '#submit-btn' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: target,
          startTime: 1080,
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('subsumes Unclassified(mousedown) when Link follows on same element', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Product Page', tag: 'A', cssSelector: 'a.product' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 2000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Link',
          trigger: target,
          startTime: 2050,
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Link');
    });

    it('subsumes Unclassified(mousedown) when Checkbox follows on same element', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'With Exchange', tag: 'INPUT', cssSelector: '#exchange' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 3000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Checkbox',
          trigger: target,
          startTime: 3080,
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Checkbox');
    });

    it('subsumes Unclassified when recognized interaction arrives at exact same time', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Button', tag: 'BUTTON', cssSelector: '#btn' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 5000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: target,
          startTime: 5000, // delta = 0
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });
  });

  describe('non-subsumption (preserved)', () => {
    it('preserves Unclassified with no recognized interaction on same element', () => {
      resetCounter();
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: makeTarget({ accessibleName: 'Drag Handle', cssSelector: '#drag' }),
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Unclassified');
    });

    it('preserves Unclassified when recognized interaction is outside gesture window', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Button', cssSelector: '#btn' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: target,
          startTime: 1000 + GESTURE_WINDOW_MS + 1, // 501ms later — outside window
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(2);
    });

    it('preserves Unclassified when recognized interaction is on different element', () => {
      resetCounter();
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: makeTarget({ accessibleName: 'Element A', cssSelector: '#a' }),
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: makeTarget({ accessibleName: 'Element B', cssSelector: '#b' }),
          startTime: 1080,
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(2);
    });

    it('preserves two recognized interactions on the same element', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Button', cssSelector: '#btn' });
      const interactions = [
        makeInteraction({ type: 'Click', trigger: target, startTime: 1000 }),
        makeInteraction({ type: 'Click', trigger: target, startTime: 2000 }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(2);
    });

    it('preserves Unclassified when only another Unclassified is on the same element', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Area', cssSelector: '#area' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 1080,
          metadata: { physicalEventType: 'keydown' },
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(2);
    });

    it('preserves Unclassified when recognized interaction precedes it (reverse temporal)', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Button', cssSelector: '#btn' });
      const interactions = [
        makeInteraction({
          type: 'Click',
          trigger: target,
          startTime: 1000,
        }),
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 1080, // after the Click — delta is negative from Click's perspective
          metadata: { physicalEventType: 'mousedown' },
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      expect(normalizeWorkflow([])).toEqual([]);
    });

    it('returns single Unclassified unchanged', () => {
      resetCounter();
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: makeTarget({ accessibleName: 'Element', cssSelector: '#el' }),
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Unclassified');
    });

    it('returns all-Unclassified input unchanged', () => {
      resetCounter();
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: makeTarget({ accessibleName: 'A', cssSelector: '#a' }),
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Unclassified',
          trigger: makeTarget({ accessibleName: 'B', cssSelector: '#b' }),
          startTime: 2000,
          metadata: { physicalEventType: 'mousedown' },
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(2);
    });

    it('subsumes at exactly GESTURE_WINDOW_MS boundary (inclusive)', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Button', cssSelector: '#btn' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: target,
          startTime: 1000 + GESTURE_WINDOW_MS, // exactly 500ms — boundary
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('does NOT subsume at GESTURE_WINDOW_MS + 1 (just outside)', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Button', cssSelector: '#btn' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: target,
          startTime: 1000 + GESTURE_WINDOW_MS + 1, // 501ms — outside
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(2);
    });

    it('subsumes only the temporally-close Unclassified when multiple exist', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Button', cssSelector: '#btn' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 500,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 1000, // 600ms gap from Click — outside window
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: target,
          startTime: 1100, // 100ms after the second, 600ms after the first
        }),
      ];

      const result = normalizeWorkflow(interactions);
      // First Unclassified (500) is 600ms before Click (1100) — outside window
      // Second Unclassified (1000) is 100ms before Click (1100) — inside window
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('Unclassified');
      expect(result[1].type).toBe('Click');
    });
  });

  describe('immutability', () => {
    it('does not mutate the input array', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Button', cssSelector: '#btn' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: target,
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: target,
          startTime: 1080,
        }),
      ];
      const originalLength = interactions.length;

      normalizeWorkflow(interactions);

      expect(interactions).toHaveLength(originalLength);
      expect(interactions[0].type).toBe('Unclassified');
    });

    it('returns the same array reference when nothing is subsumed', () => {
      resetCounter();
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: makeTarget({ accessibleName: 'Drag', cssSelector: '#drag' }),
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toBe(interactions); // same reference
    });

    it('does not mutate interaction objects', () => {
      resetCounter();
      const target = makeTarget({ accessibleName: 'Button', cssSelector: '#btn' });
      const unclassified = makeInteraction({
        type: 'Unclassified',
        trigger: target,
        startTime: 1000,
        metadata: { physicalEventType: 'mousedown' },
      });
      const click = makeInteraction({
        type: 'Click',
        trigger: target,
        startTime: 1080,
      });

      normalizeWorkflow([unclassified, click]);

      expect(unclassified.type).toBe('Unclassified');
      expect(unclassified.interactionId).toBe('int-1');
    });
  });

  describe('realistic workflows', () => {
    it('Amazon-like workflow: search + product click (removes mousedown noise)', () => {
      resetCounter();
      const searchTarget = makeTarget({ accessibleName: 'Go', tag: 'INPUT', cssSelector: '#nav-search-submit-button' });
      const productTarget = makeTarget({ accessibleName: 'V70 5G', tag: 'A', cssSelector: 'a.product-link' });

      const interactions = [
        // Search button gesture
        makeInteraction({
          type: 'Unclassified',
          trigger: searchTarget,
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown', targetName: 'Go' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: searchTarget,
          startTime: 1080,
          metadata: { targetName: 'Go' },
        }),
        // Product link gesture
        makeInteraction({
          type: 'Unclassified',
          trigger: productTarget,
          startTime: 5000,
          metadata: { physicalEventType: 'mousedown', targetName: 'V70 5G' },
        }),
        makeInteraction({
          type: 'Link',
          trigger: productTarget,
          startTime: 5050,
          metadata: { targetName: 'V70 5G' },
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('Click');
      expect(result[0].trigger.accessibleName).toBe('Go');
      expect(result[1].type).toBe('Link');
      expect(result[1].trigger.accessibleName).toBe('V70 5G');
    });

    it('preserves standalone drag-start mousedown with no following click', () => {
      resetCounter();
      const dragTarget = makeTarget({ accessibleName: 'Drag Handle', tag: 'DIV', cssSelector: '#drag-handle' });
      const interactions = [
        makeInteraction({
          type: 'Unclassified',
          trigger: dragTarget,
          startTime: 1000,
          metadata: { physicalEventType: 'mousedown' },
        }),
        makeInteraction({
          type: 'Click',
          trigger: makeTarget({ accessibleName: 'Drop Zone', cssSelector: '#drop-zone' }),
          startTime: 2000,
        }),
      ];

      const result = normalizeWorkflow(interactions);
      expect(result).toHaveLength(2); // drag mousedown preserved, drop click preserved
    });
  });
});
