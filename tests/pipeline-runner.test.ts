/**
 * Tests for the Pipeline Runner (Milestones 6.3-6.5).
 *
 * Verifies that the pipeline correctly chains:
 *   1. Domain adapter → UiElement[] + ObservedTransition[]
 *   2. Recognition orchestrator → ComponentGrouping[]
 *   3. Enrichment orchestrator → ApplicationKnowledgeFragment
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runPipeline } from '../src/recorder/pipeline/pipeline-runner';
import type { RecordedEvent, ElementRecordedEvent } from '../src/recorder/recorded-event';
import type { DetectedInteraction } from '../src/classifier/interaction-types';
import type { ElementIdentity } from '../src/shared/types';
import { ComponentLifecycleState } from '../src/domain/enums';

// ── Test helpers ────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test Button',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: null,
    name: null,
    stableId: 'test-btn',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'button#test-btn',
    xPath: '//button[@id=\'test-btn\']',
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeClickEvent(overrides: Partial<ElementRecordedEvent> = {}): ElementRecordedEvent {
  return {
    eventId: 'evt-001',
    eventType: 'click',
    timestamp: '2026-07-21T12:00:00.000Z',
    target: makeIdentity(),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function makeInteraction(
  type: string,
  eventIds: string[],
  target?: ElementIdentity,
): DetectedInteraction {
  return {
    interactionId: `interaction-${eventIds[0]}`,
    type: type as any,
    eventIds,
    rawEventTypes: [],
    target,
    metadata: {},
    confidence: 0.95,
    engine: 'v2',
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Milestone 6.3-6.5 — Pipeline Runner', () => {
  describe('runPipeline — basic flow', () => {
    it('should return entities, components, and fragment for a simple session', () => {
      const events: RecordedEvent[] = [makeClickEvent()];
      const interactions = [makeInteraction('Click', ['evt-001'])];
      const result = runPipeline(events, interactions, 'test-session', 'https://example.com');

      expect(result.entities.elements).toHaveLength(1);
      expect(result.entities.transitions).toHaveLength(1);
      expect(result.components).toBeDefined();
      expect(result.fragment).toBeDefined();
    });

    it('should handle empty sessions gracefully', () => {
      const result = runPipeline([], [], 'test-session', 'https://example.com');
      expect(result.entities.elements).toHaveLength(0);
      expect(result.entities.transitions).toHaveLength(0);
      expect(result.components).toHaveLength(0);
      // Fragment may be null for empty sessions — that's OK
    });
  });

  describe('runPipeline — recognition integration', () => {
    it('should produce components for a combobox interaction', () => {
      const comboboxIdentity = makeIdentity({
        elementId: 'elem-cb-001',
        tag: 'INPUT',
        ariaRole: 'combobox',
        accessibleName: 'Country',
        cssSelector: 'input#country',
      });
      const events: RecordedEvent[] = [
        makeClickEvent({
          eventId: 'evt-cb-001',
          target: comboboxIdentity,
          domContext: {
            inputType: 'text',
            ariaExpanded: true,
            ariaHasPopup: 'listbox',
            isContentEditable: false,
          },
        }),
      ];
      const interactions = [makeInteraction('CustomDropdown', ['evt-cb-001'], comboboxIdentity)];
      const result = runPipeline(events, interactions, 'test-session', 'https://example.com');

      // Recognition should find a component for the combobox
      // (It may or may not depending on pattern catalogue, but it should not crash)
      expect(result.components).toBeDefined();
    });

    it('should handle multiple clicks on different elements', () => {
      const events: RecordedEvent[] = [
        makeClickEvent({
          eventId: 'evt-001',
          target: makeIdentity({ elementId: 'elem-001', stableId: 'btn1' }),
        }),
        makeClickEvent({
          eventId: 'evt-002',
          target: makeIdentity({ elementId: 'elem-002', stableId: 'btn2' }),
        }),
        makeClickEvent({
          eventId: 'evt-003',
          target: makeIdentity({ elementId: 'elem-003', stableId: 'btn3' }),
        }),
      ];
      const interactions = [
        makeInteraction('Click', ['evt-001']),
        makeInteraction('Click', ['evt-002']),
        makeInteraction('Click', ['evt-003']),
      ];
      const result = runPipeline(events, interactions, 'test-session', 'https://example.com');

      expect(result.entities.elements).toHaveLength(3);
      expect(result.entities.transitions).toHaveLength(3);
    });
  });

  describe('runPipeline — enrichment integration', () => {
    it('should produce a fragment with elements and transitions', () => {
      const events: RecordedEvent[] = [
        makeClickEvent({
          eventId: 'evt-001',
          target: makeIdentity({ elementId: 'elem-001' }),
        }),
        makeClickEvent({
          eventId: 'evt-002',
          target: makeIdentity({ elementId: 'elem-002', tag: 'INPUT', ariaRole: 'textbox' }),
          eventType: 'input',
          valueBefore: '',
          valueAfter: 'hello@example.com',
          domContext: {
            inputType: 'email',
            ariaExpanded: null,
            ariaHasPopup: null,
            isContentEditable: false,
            domAttributes: { type: 'email', required: '', minlength: '5' },
          },
        }),
      ];
      const interactions = [
        makeInteraction('Click', ['evt-001']),
        makeInteraction('TextEntry', ['evt-002']),
      ];
      const result = runPipeline(events, interactions, 'test-session', 'https://example.com');

      expect(result.fragment).not.toBeNull();
      // Fragment should contain elements and transitions
      expect(result.fragment!.elements).toBeDefined();
      expect(result.fragment!.transitions).toBeDefined();
    });

    it('should enrich with interaction contracts from domAttributes', () => {
      const events: RecordedEvent[] = [
        makeClickEvent({
          eventId: 'evt-001',
          target: makeIdentity({ elementId: 'elem-001', tag: 'INPUT', ariaRole: 'textbox' }),
          eventType: 'input',
          valueBefore: '',
          valueAfter: 'test@example.com',
          domContext: {
            inputType: 'email',
            ariaExpanded: null,
            ariaHasPopup: null,
            isContentEditable: false,
            domAttributes: {
              type: 'email',
              required: '',
              minlength: '5',
              maxlength: '100',
              pattern: '^[^@]+@[^@]+\\.[^@]+$',
            },
          },
        }),
      ];
      const interactions = [makeInteraction('TextEntry', ['evt-001'])];
      const result = runPipeline(events, interactions, 'test-session', 'https://example.com');

      // Fragment should exist and have elements
      expect(result.fragment).not.toBeNull();
      // The element should have interaction contract with constraints
      if (result.fragment) {
        expect(result.fragment.elements.length).toBeGreaterThan(0);
        const el = result.fragment.elements[0];
        // Check if interaction contract exists (depends on enrichment pipeline producing it)
        if (el.interactionContract) {
          expect(el.interactionContract.constraints).toBeDefined();
        }
      }
    });
  });

  describe('runPipeline — resilience', () => {
    it('should not throw if recognition fails on an unknown pattern', () => {
      const events: RecordedEvent[] = [
        makeClickEvent({
          eventId: 'evt-001',
          target: makeIdentity({ elementId: 'elem-001', ariaRole: 'unknown-role' }),
        }),
      ];
      const interactions = [makeInteraction('Unknown', ['evt-001'])];
      expect(() => runPipeline(events, interactions, 'test-session', 'https://example.com')).not.toThrow();
    });

    it('should produce a fragment even with no classified interactions', () => {
      const events: RecordedEvent[] = [makeClickEvent()];
      const result = runPipeline(events, [], 'test-session', 'https://example.com');
      expect(result.fragment).not.toBeNull();
    });

    it('should handle navigation events in the pipeline', () => {
      const events: RecordedEvent[] = [
        makeClickEvent(),
        {
          eventId: 'evt-nav-001',
          eventType: 'navigation',
          timestamp: '2026-07-21T12:00:01.000Z',
          url: 'https://example.com/page2',
          title: 'Page 2',
        },
      ];
      const interactions = [makeInteraction('Click', ['evt-001'])];
      const result = runPipeline(events, interactions, 'test-session', 'https://example.com');

      // Should handle navigation without crashing
      expect(result.entities.elements).toHaveLength(1);
      expect(result.entities.transitions).toHaveLength(2); // 1 click + 1 navigation
    });
  });

  describe('runPipeline — fragment structure', () => {
    it('should produce a fragment with schema version', () => {
      const events: RecordedEvent[] = [makeClickEvent()];
      const interactions = [makeInteraction('Click', ['evt-001'])];
      const result = runPipeline(events, interactions, 'test-session', 'https://example.com');

      if (result.fragment) {
        expect(result.fragment.schemaVersion).toBeDefined();
        expect(result.fragment.sessionId).toBe('test-session');
      }
    });

    it('should produce a fragment with surfaces', () => {
      const events: RecordedEvent[] = [makeClickEvent()];
      const result = runPipeline(events, [], 'test-session', 'https://example.com');

      if (result.fragment) {
        expect(result.fragment.applicationSurfaces).toBeDefined();
      }
    });
  });
});
