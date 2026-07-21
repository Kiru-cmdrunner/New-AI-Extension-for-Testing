/**
 * Unit tests for the Boundary Detector.
 *
 * Tests cover:
 *   - Simple click → single-event unit, closed by temporal gap
 *   - Dropdown interaction: surface_open → click option → surface_close → one unit
 *   - Temporal gap closes pending unit
 *   - Navigation immediately closes any open unit
 *   - Flush closes pending unit
 *   - Nested surfaces (modal within modal)
 *   - Surface close without matching open
 *   - determinePrimaryEvent heuristic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BoundaryDetector,
  determinePrimaryEvent,
  type BoundaryDetectorConfig,
} from '../../src/recorder/pipeline-v2/boundary-detector';
import type { PipelineEvent, InteractionUnit } from '../../src/recorder/pipeline-v2/canonical-event-schema';

// ── Test Helpers ────────────────────────────────────────────────────────

const NO_TIMER_CONFIG: Partial<BoundaryDetectorConfig> = {
  useTimer: false,
  temporalGapMs: 800,
};

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

function makeClickEvent(time: number, element = 'BUTTON'): PipelineEvent {
  return makeEvent('click', {
    timestamp: new Date(time).toISOString(),
    targetTag: element,
    payload: { clickCount: 1, button: 0 },
  });
}

function makeSurfaceOpenEvent(time: number, surfaceType: 'dropdown' | 'modal' = 'dropdown'): PipelineEvent {
  return makeEvent('surface_open', {
    timestamp: new Date(time).toISOString(),
    payload: { surfaceType },
  });
}

function makeSurfaceCloseEvent(time: number, surfaceType: 'dropdown' | 'modal' = 'dropdown'): PipelineEvent {
  return makeEvent('surface_close', {
    timestamp: new Date(time).toISOString(),
    payload: { surfaceType },
  });
}

function makeNavigationEvent(time: number, url: string): PipelineEvent {
  return makeEvent('navigation', {
    timestamp: new Date(time).toISOString(),
    payload: { url, title: 'Page' },
  });
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('BoundaryDetector', () => {
  let detector: BoundaryDetector;
  let closedUnits: InteractionUnit[];

  beforeEach(() => {
    closedUnits = [];
    detector = new BoundaryDetector(NO_TIMER_CONFIG);
    detector.onClosed((unit) => closedUnits.push(unit));
  });

  // ── Simple Click ───────────────────────────────────────────────────

  describe('simple click', () => {
    it('should create a unit for a single click', () => {
      detector.ingest(makeClickEvent(1000));
      detector.flush();

      expect(closedUnits).toHaveLength(1);
      expect(closedUnits[0].events).toHaveLength(1);
      expect(closedUnits[0].events[0].type).toBe('click');
    });

    it('should have temporal_gap boundary reason on flush', () => {
      detector.ingest(makeClickEvent(1000));
      detector.flush();

      expect(closedUnits[0].boundaryReason).toBe('explicit_flush');
    });
  });

  // ── Surface Lifecycle ──────────────────────────────────────────────

  describe('surface lifecycle (dropdown)', () => {
    it('should group surface_open → click → surface_close into one unit', () => {
      // Dropdown trigger click
      detector.ingest(makeClickEvent(1000, 'BUTTON'));
      // Surface opens (dropdown list appears)
      detector.ingest(makeSurfaceOpenEvent(1050, 'dropdown'));
      // User clicks an option inside the dropdown
      detector.ingest(makeClickEvent(1200, 'LI'));
      // Surface closes (dropdown list disappears)
      detector.ingest(makeSurfaceCloseEvent(1250, 'dropdown'));

      // No flush needed — surface_close closes the unit
      expect(closedUnits).toHaveLength(1);
      expect(closedUnits[0].events).toHaveLength(4);
      expect(closedUnits[0].boundaryReason).toBe('surface_closed');
    });

    it('should detect surface_open without a preceding click', () => {
      detector.ingest(makeSurfaceOpenEvent(1000, 'dropdown'));
      detector.ingest(makeClickEvent(1100, 'LI'));
      detector.ingest(makeSurfaceCloseEvent(1150, 'dropdown'));

      expect(closedUnits).toHaveLength(1);
      expect(closedUnits[0].events).toHaveLength(3);
      expect(closedUnits[0].boundaryReason).toBe('surface_closed');
    });

    it('should not close on surface_close when surfaces are nested', () => {
      // Open outer modal
      detector.ingest(makeSurfaceOpenEvent(1000, 'modal'));
      // Open inner dropdown inside the modal
      detector.ingest(makeSurfaceOpenEvent(1100, 'dropdown'));
      // Close inner dropdown — should NOT close the unit
      detector.ingest(makeSurfaceCloseEvent(1200, 'dropdown'));

      expect(closedUnits).toHaveLength(0);

      // Close outer modal — NOW should close
      detector.ingest(makeSurfaceCloseEvent(1300, 'modal'));

      expect(closedUnits).toHaveLength(1);
      expect(closedUnits[0].events).toHaveLength(4);
      expect(closedUnits[0].boundaryReason).toBe('surface_closed');
    });
  });

  // ── Temporal Gap ───────────────────────────────────────────────────

  describe('temporal gap', () => {
    it('should close unit when temporal gap exceeds threshold', () => {
      detector.ingest(makeClickEvent(1000));
      // Next event is 2000ms later (exceeds 800ms gap)
      detector.ingest(makeClickEvent(3000));

      expect(closedUnits).toHaveLength(1);
      expect(closedUnits[0].boundaryReason).toBe('temporal_gap');
      expect(closedUnits[0].events).toHaveLength(1);
    });

    it('should NOT close when events are within threshold', () => {
      detector.ingest(makeClickEvent(1000));
      detector.ingest(makeClickEvent(1500)); // 500ms later
      detector.flush();

      expect(closedUnits).toHaveLength(1);
      expect(closedUnits[0].events).toHaveLength(2);
    });

    it('should NOT close on temporal gap when a surface is open', () => {
      detector.ingest(makeClickEvent(1000));
      detector.ingest(makeSurfaceOpenEvent(1050, 'dropdown'));
      // 2000ms gap — should NOT close because surface is still open
      detector.ingest(makeClickEvent(3050, 'LI'));

      expect(closedUnits).toHaveLength(0);
    });
  });

  // ── Navigation ─────────────────────────────────────────────────────

  describe('navigation', () => {
    it('should immediately close any pending unit on navigation', () => {
      detector.ingest(makeClickEvent(1000));
      detector.ingest(makeNavigationEvent(2000, 'https://example.com/page2'));

      expect(closedUnits).toHaveLength(2);
      // First unit is the click, closed by navigation
      expect(closedUnits[0].events).toHaveLength(1);
      expect(closedUnits[0].boundaryReason).toBe('navigation');
      // Second unit is the navigation itself
      expect(closedUnits[1].events).toHaveLength(1);
      expect(closedUnits[1].events[0].type).toBe('navigation');
      expect(closedUnits[1].boundaryReason).toBe('navigation');
    });

    it('should create a standalone navigation unit when nothing pending', () => {
      detector.ingest(makeNavigationEvent(1000, 'https://example.com/page2'));

      expect(closedUnits).toHaveLength(1);
      expect(closedUnits[0].events[0].type).toBe('navigation');
    });
  });

  // ── Flush ──────────────────────────────────────────────────────────

  describe('flush', () => {
    it('should close pending unit with explicit_flush reason', () => {
      detector.ingest(makeClickEvent(1000));
      detector.ingest(makeClickEvent(1100));
      detector.flush();

      expect(closedUnits).toHaveLength(1);
      expect(closedUnits[0].boundaryReason).toBe('explicit_flush');
      expect(closedUnits[0].events).toHaveLength(2);
    });

    it('should be safe to call flush with nothing pending', () => {
      detector.flush();
      expect(closedUnits).toHaveLength(0);
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear pending unit and counter', () => {
      detector.ingest(makeClickEvent(1000));
      detector.reset();

      expect(detector.hasPending).toBe(false);

      detector.flush();
      expect(closedUnits).toHaveLength(0);
    });
  });

  // ── Surface Close Without Open ─────────────────────────────────────

  describe('orphan surface_close', () => {
    it('should handle surface_close without matching surface_open', () => {
      detector.ingest(makeSurfaceCloseEvent(1000, 'dropdown'));

      expect(closedUnits).toHaveLength(1);
      expect(closedUnits[0].events).toHaveLength(1);
      expect(closedUnits[0].boundaryReason).toBe('temporal_gap');
    });
  });

  // ── Multiple Sequential Interactions ───────────────────────────────

  describe('multiple sequential interactions', () => {
    it('should create separate units for sequential clicks with gaps', () => {
      detector.ingest(makeClickEvent(1000));
      // Gap
      detector.ingest(makeClickEvent(3000));
      // Gap
      detector.ingest(makeClickEvent(5000));

      expect(closedUnits).toHaveLength(2);
      expect(closedUnits[0].events).toHaveLength(1);
      expect(closedUnits[1].events).toHaveLength(1);

      detector.flush();
      expect(closedUnits).toHaveLength(3);
    });

    it('should create separate units for a dropdown then a click', () => {
      // Dropdown interaction
      detector.ingest(makeSurfaceOpenEvent(1000, 'dropdown'));
      detector.ingest(makeClickEvent(1100, 'LI'));
      detector.ingest(makeSurfaceCloseEvent(1150, 'dropdown'));

      // Separate click later
      detector.ingest(makeClickEvent(3000));
      detector.flush();

      expect(closedUnits).toHaveLength(2);
      expect(closedUnits[0].boundaryReason).toBe('surface_closed');
      expect(closedUnits[1].boundaryReason).toBe('explicit_flush');
    });
  });

  // ── Unit IDs ───────────────────────────────────────────────────────

  describe('unit IDs', () => {
    it('should assign sequential unit IDs', () => {
      detector.ingest(makeClickEvent(1000));
      detector.ingest(makeClickEvent(3000));
      detector.ingest(makeClickEvent(5000));
      detector.flush();

      expect(closedUnits[0].unitId).toBe('unit-0001');
      expect(closedUnits[1].unitId).toBe('unit-0002');
      expect(closedUnits[2].unitId).toBe('unit-0003');
    });
  });
});

// ── determinePrimaryEvent Tests ─────────────────────────────────────────

describe('determinePrimaryEvent', () => {
  it('should return the first click event as primary', () => {
    const events: PipelineEvent[] = [
      makeEvent('focus', { timestamp: '2026-07-18T00:00:00.000Z' }),
      makeEvent('click', { timestamp: '2026-07-18T00:00:01.000Z' }),
      makeEvent('change', { timestamp: '2026-07-18T00:00:02.000Z' }),
    ];

    const primary = determinePrimaryEvent(events);
    expect(primary?.type).toBe('click');
  });

  it('should return surface_open if no click exists', () => {
    const events: PipelineEvent[] = [
      makeEvent('surface_open', { timestamp: '2026-07-18T00:00:00.000Z' }),
      makeEvent('change', { timestamp: '2026-07-18T00:00:01.000Z' }),
    ];

    const primary = determinePrimaryEvent(events);
    expect(primary?.type).toBe('surface_open');
  });

  it('should return the first event as fallback', () => {
    const events: PipelineEvent[] = [
      makeEvent('change', { timestamp: '2026-07-18T00:00:00.000Z' }),
      makeEvent('blur', { timestamp: '2026-07-18T00:00:01.000Z' }),
    ];

    const primary = determinePrimaryEvent(events);
    expect(primary?.type).toBe('change');
  });

  it('should return null for empty events array', () => {
    expect(determinePrimaryEvent([])).toBeNull();
  });
});

// ── Timer-Based Tests ──────────────────────────────────────────────────

describe('BoundaryDetector with timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should close unit automatically after temporal gap using timer', () => {
    const closedUnits: InteractionUnit[] = [];
    const detector = new BoundaryDetector({
      temporalGapMs: 500,
      useTimer: true,
    });
    detector.onClosed((unit) => closedUnits.push(unit));

    detector.ingest(makeClickEvent(0));
    expect(closedUnits).toHaveLength(0);

    // Advance past the gap
    vi.advanceTimersByTime(600);

    expect(closedUnits).toHaveLength(1);
    expect(closedUnits[0].boundaryReason).toBe('temporal_gap');
  });

  it('should keep the unit open while events keep arriving', () => {
    const closedUnits: InteractionUnit[] = [];
    const detector = new BoundaryDetector({
      temporalGapMs: 500,
      useTimer: true,
    });
    detector.onClosed((unit) => closedUnits.push(unit));

    detector.ingest(makeClickEvent(0));
    vi.advanceTimersByTime(300);
    detector.ingest(makeClickEvent(300));
    vi.advanceTimersByTime(300);
    detector.ingest(makeClickEvent(600));
    vi.advanceTimersByTime(300);

    expect(closedUnits).toHaveLength(0);

    vi.advanceTimersByTime(300);
    expect(closedUnits).toHaveLength(1);
    expect(closedUnits[0].events).toHaveLength(3);
  });
});
