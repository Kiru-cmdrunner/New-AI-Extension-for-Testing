/**
 * Integration tests for Pipeline V2 orchestrator.
 *
 * Tests the full pipeline flow:
 *   PipelineEvent → BoundaryDetector → StateDiff → PatternRegistry
 *     → InteractionAssembler → IntentResolver → SessionEvent
 *
 * LEARNING 3 (No End-to-End Validation): These tests validate the full
 * pipeline flow, not just individual components.
 *
 * LEARNING 6 (Browser Validation): Additional browser validation is performed
 * by the tester sub-agent on the demo app.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineV2 } from '../../src/recorder/pipeline-v2/pipeline-v2';
import { setTracer, PipelineTracer } from '../../src/recorder/pipeline-v2/pipeline-tracer';
import type { PipelineEvent } from '../../src/recorder/pipeline-v2/canonical-event-schema';
import type { SessionEvent } from '../../src/shared/types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: null,
    name: null,
    stableId: 'test',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '#test',
    xPath: '//button',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeEvent(
  type: PipelineEvent['type'],
  overrides: Partial<PipelineEvent> = {},
): PipelineEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: new Date().toISOString(),
    element: null,
    targetTag: null,
    payload: {},
    isTrusted: true,
    ...overrides,
  };
}

// ── Pipeline V2 Integration Tests ──────────────────────────────────────

describe('PipelineV2', () => {
  let pipeline: PipelineV2;
  let emittedEvents: SessionEvent[];

  beforeEach(() => {
    // Use a quiet tracer to avoid console noise during tests
    setTracer(new PipelineTracer('off'));

    emittedEvents = [];
    pipeline = new PipelineV2();
    pipeline.onEvent((event) => emittedEvents.push(event));
  });

  // ── Simple Click ───────────────────────────────────────────────────

  describe('simple click', () => {
    it('should emit a click SessionEvent for a standalone click', () => {
      const event = makeEvent('click', {
        element: makeElementIdentity({ accessibleName: 'Submit Button' }),
        targetTag: 'BUTTON',
        payload: { clickCount: 1 },
      });

      pipeline.ingestEvidence(event);
      pipeline.flush();

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe('click');
      expect(emittedEvents[0].actionId).toMatch(/^click-\d+$/);
      expect('elementIdentity' in emittedEvents[0]).toBe(true);
      const identity = (emittedEvents[0] as { elementIdentity: ElementIdentity }).elementIdentity;
      expect(identity.accessibleName).toBe('Submit Button');
    });
  });

  // ── Navigation ─────────────────────────────────────────────────────

  describe('navigation', () => {
    it('should emit a navigation SessionEvent', () => {
      pipeline.ingestNavigation('https://example.com/page2', new Date().toISOString());
      pipeline.flush();

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].type).toBe('navigation');
      expect((emittedEvents[0] as { url: string }).url).toBe('https://example.com/page2');
    });
  });

  // ── Multiple Sequential Events ─────────────────────────────────────

  describe('multiple sequential events', () => {
    it('should produce separate events for sequential interactions', () => {
      // First click
      const click1 = makeEvent('click', {
        timestamp: new Date(1000).toISOString(),
        element: makeElementIdentity({ accessibleName: 'Button 1' }),
      });
      pipeline.ingestEvidence(click1);

      // Second click (well after temporal gap)
      const click2 = makeEvent('click', {
        timestamp: new Date(5000).toISOString(),
        element: makeElementIdentity({ accessibleName: 'Button 2' }),
      });
      pipeline.ingestEvidence(click2);

      pipeline.flush();

      expect(emittedEvents).toHaveLength(2);
      expect(emittedEvents[0].type).toBe('click');
      expect(emittedEvents[1].type).toBe('click');
      const id1 = (emittedEvents[0] as { elementIdentity: ElementIdentity }).elementIdentity;
      const id2 = (emittedEvents[1] as { elementIdentity: ElementIdentity }).elementIdentity;
      expect(id1.accessibleName).toBe('Button 1');
      expect(id2.accessibleName).toBe('Button 2');
    });
  });

  // ── SessionEvent Format Compatibility ─────────────────────────────

  describe('SessionEvent format compatibility', () => {
    it('should produce events with actionId and timestamp', () => {
      pipeline.ingestEvidence(makeEvent('click', {
        element: makeElementIdentity(),
      }));
      pipeline.flush();

      expect(emittedEvents[0].actionId).toBeDefined();
      expect(emittedEvents[0].actionId.length).toBeGreaterThan(0);
      expect(emittedEvents[0].timestamp).toBeDefined();
    });

    it('should produce valid SessionEvent types (one of the 8 variants)', () => {
      const validTypes = ['navigation', 'click', 'text', 'hover', 'checkbox', 'radio', 'select', 'dateSelect'];

      pipeline.ingestEvidence(makeEvent('click', {
        element: makeElementIdentity(),
      }));
      pipeline.flush();

      expect(validTypes).toContain(emittedEvents[0].type);
    });

    it('should include elementIdentity for non-navigation events', () => {
      pipeline.ingestEvidence(makeEvent('click', {
        element: makeElementIdentity({ accessibleName: 'Test' }),
      }));
      pipeline.flush();

      expect('elementIdentity' in emittedEvents[0]).toBe(true);
      const identity = (emittedEvents[0] as { elementIdentity: ElementIdentity }).elementIdentity;
      expect(identity).toBeDefined();
      expect(identity.elementId).toBeDefined();
    });

    it('should NOT include elementIdentity for navigation events', () => {
      pipeline.ingestNavigation('https://example.com', new Date().toISOString());
      pipeline.flush();

      expect(emittedEvents[0].type).toBe('navigation');
      expect('elementIdentity' in emittedEvents[0]).toBe(false);
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all state', () => {
      pipeline.ingestEvidence(makeEvent('click', {
        element: makeElementIdentity(),
      }));
      pipeline.reset();
      pipeline.flush();

      // No events should be emitted after reset
      expect(emittedEvents).toHaveLength(0);
    });
  });

  // ── Event ID Generation ───────────────────────────────────────────

  describe('event ID generation', () => {
    it('should generate sequential action IDs', () => {
      pipeline.ingestEvidence(makeEvent('click', {
        timestamp: new Date(1000).toISOString(),
        element: makeElementIdentity({ accessibleName: 'A' }),
      }));
      pipeline.ingestEvidence(makeEvent('click', {
        timestamp: new Date(5000).toISOString(), // > 2000ms gap → separate unit
        element: makeElementIdentity({ accessibleName: 'B' }),
      }));
      pipeline.flush();

      expect(emittedEvents).toHaveLength(2);
      // Both should have click- prefix
      expect(emittedEvents[0].actionId).toMatch(/^click-/);
      expect(emittedEvents[1].actionId).toMatch(/^click-/);
      // IDs should be unique
      expect(emittedEvents[0].actionId).not.toBe(emittedEvents[1].actionId);
    });
  });
});

// ── Pipeline Tracer Tests ──────────────────────────────────────────────

describe('PipelineTracer', () => {
  it('should store trace entries', () => {
    const tracer = new PipelineTracer('normal');
    tracer.trace(
      'event-capture',
      'ingest',
      'click',
      'routed',
      5,
      'test decision',
      'evt-001',
    );

    const entries = tracer.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].layer).toBe('event-capture');
    expect(entries[0].action).toBe('ingest');
    expect(entries[0].decision).toBe('test decision');
    expect(entries[0].eventId).toBe('evt-001');
  });

  it('should filter entries by event ID', () => {
    const tracer = new PipelineTracer('normal');
    tracer.trace('event-capture', 'a', '', '', 0, undefined, 'evt-001');
    tracer.trace('boundary-detection', 'b', '', '', 0, undefined, undefined, 'unit-001');
    tracer.trace('state-diff', 'c', '', '', 0, undefined, 'evt-002');

    const evt1 = tracer.getEntriesForTarget('evt-001');
    expect(evt1).toHaveLength(1);
    expect(evt1[0].layer).toBe('event-capture');

    const unit1 = tracer.getEntriesForTarget(undefined, 'unit-001');
    expect(unit1).toHaveLength(1);
    expect(unit1[0].layer).toBe('boundary-detection');
  });

  it('should respect off level', () => {
    const tracer = new PipelineTracer('off');
    tracer.trace('event-capture', 'test', '', '', 0);

    expect(tracer.getEntries()).toHaveLength(0);
  });

  it('should clear entries', () => {
    const tracer = new PipelineTracer('normal');
    tracer.trace('event-capture', 'a', '', '', 0);
    tracer.trace('boundary-detection', 'b', '', '', 0);

    tracer.clear();
    expect(tracer.getEntries()).toHaveLength(0);
  });

  it('should trim entries when exceeding max', () => {
    const tracer = new PipelineTracer('normal', 5);
    for (let i = 0; i < 10; i++) {
      tracer.trace('event-capture', `action-${i}`, '', '', 0);
    }

    const entries = tracer.getEntries();
    expect(entries.length).toBeLessThanOrEqual(5);
    // Should keep the most recent entries
    expect(entries[entries.length - 1].action).toBe('action-9');
  });
});
