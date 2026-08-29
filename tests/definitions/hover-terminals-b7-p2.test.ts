/**
 * B7-P2 §5.2.1/§5.2.2 — Hover definition: observe-only rewrite.
 *
 * Six STRUCTURAL terminals, zero clocks, zero vocabulary:
 *   left (same-element mouseleave)          → completed
 *   consumed-by-click (any click anywhere)   → completed
 *   navigation (shouldCompleteOnNavigation)  → completed (hook)
 *   target-removed (TRIGGER_REMOVED)         → completed (P1 window close)
 *   recording-end (completesAtRecordingEnd)  → completed (flush consults)
 *   idle-timeout (5-min cleanup)             → abandoned (no hook completes)
 *
 * Deleted semantics this suite pins the ABSENCE of:
 *   - no confidence/dwell/vocabulary thresholds decide ANYTHING
 *   - sub-500ms transits complete exactly like long dwells (F-1)
 *   - metadata.meaningful is a DERIVED projection (compat bridge), never a
 *     stored judgment; evidenceReason/confidence/pointer stationarity are gone
 *   - click does NOT cancel (shouldCancelOnOutside returns false always)
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS, hoverDefinition } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Menu', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'BUTTON', className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector: 'button',
    inputType: null,
    xPath: '/html/body/button', inIframe: false, shadowDom: false, elementId: '',
    href: null,
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [],
    tabIndex: null,
    ...overrides,
  };
}

function makeEvent(
  eventId: string,
  eventType: string,
  target: Partial<ElementIdentity>,
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType: eventType as ObservedEvent['eventType'],
    target: makeTarget(target),
    domContext: makeDomContext(domContext),
    isTrusted: true,
    ...eventOverrides,
  });
}

function setupRuntime() {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = {
    onEmit: (i) => emitted.push(i),
  };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

describe('B7-P2: Hover terminals (structural, zero clocks)', () => {
  it('T1 left: same-element mouseleave completes — ANY duration, even 100ms transit (F-1)', () => {
    const { runtime, emitted } = setupRuntime();
    const t0 = 10_000;
    runtime.process(makeEvent('evt-p1-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: t0 }));
    expect(runtime.activeCount).toBe(1);
    // 100ms dwell — pre-P2 this was ALWAYS discarded as transit.
    runtime.process(makeEvent('evt-p1-2', 'mouseleave', { tag: 'BUTTON' }, {}, { timestamp: t0 + 100 }));
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('completed');
  });

  it('T2 consumed-by-click: a click ANYWHERE completes the hover (no cancellation)', () => {
    const { runtime, emitted } = setupRuntime();
    const t0 = 10_000;
    runtime.process(makeEvent('evt-p2-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: t0 }));
    // Click on a DIFFERENT interactive element (BUTTON passes Click's own
    // gate) — pre-P2 this abandoned the hover.
    runtime.process(makeEvent('evt-p2-2', 'click', { tag: 'BUTTON', accessibleName: 'Buy', cssSelector: 'button.buy' }, {}, { timestamp: t0 + 300 }));
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('completed');
    // The click is its OWN interaction (Click fallback) — both coexist.
    const click = emitted.find((i) => i.type === 'Click');
    expect(click).toBeDefined();
    expect(click!.endState).toBe('completed');
  });

  it('T3 navigation: shouldCompleteOnNavigation exists and completes (commitSignal navigation)', () => {
    expect(typeof hoverDefinition.shouldCompleteOnNavigation).toBe('function');
    const { runtime, emitted } = setupRuntime();
    const t0 = 10_000;
    runtime.process(makeEvent('evt-p3-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: t0 }));
    const navEvent = makeEvent('evt-p3-2', 'click', { tag: 'A', cssSelector: 'a' }, {}, {
      timestamp: t0 + 500,
      // Navigation events carry this marker in the runtime path; here we
      // call the flush path directly like ComponentRuntime does.
    });
    // The real nav flush path: process a navigation-tagged event.
    (navEvent as unknown as Record<string, unknown>).isNavigationEvent = true;
    runtime.flushOnNavigation(navEvent);
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.commitSignal).toBe('navigation');
  });

  it('T5 recording-end: completesAtRecordingEnd declaration makes STOP flush complete the hover', () => {
    expect(hoverDefinition.completesAtRecordingEnd).toBe(true);
    const { runtime, emitted } = setupRuntime();
    const t0 = 10_000;
    runtime.process(makeEvent('evt-p5-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: t0 }));
    // NO mouseleave, NO click — STOP alone.
    runtime.flush();
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('completed');
  });

  it('T6 idle-timeout: 5-min staleness ABANDONS the hover (no hook; honest floor for the twin)', () => {
    const { runtime, emitted } = setupRuntime();
    const t0 = 10_000;
    runtime.process(makeEvent('evt-p6-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: t0 }));
    // An event 6 minutes later — past LIFECYCLE_IDLE_TIMEOUT_MS (300000).
    // The hover received zero in-scope events in that window.
    runtime.process(makeEvent('evt-p6-2', 'click', { tag: 'A', cssSelector: 'a' }, {}, {
      timestamp: t0 + 360_000,
    }));
    const hover = emitted.find((i) => i.type === 'Hover');
    // cleanupStaleComponents fires BEFORE the click offers to the stack —
    // the hover is abandoned by the timeout, not completed by the click.
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('abandoned');
  });

  it('ABSENCE: no dwell/vocabulary gates — a class-less DIV hover on a plain interactive button completes at 10ms', () => {
    const { runtime, emitted } = setupRuntime();
    const t0 = 10_000;
    // No overlay classes, no roles, no aria anything — just interactive.
    runtime.process(makeEvent('evt-p7-1', 'mouseenter', { tag: 'BUTTON', className: null }, {}, { timestamp: t0 }));
    runtime.process(makeEvent('evt-p7-2', 'mouseleave', { tag: 'BUTTON' }, {}, { timestamp: t0 + 10 }));
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('completed');
    // And a duration FACT is recorded (panel display only — never a gate).
    expect(typeof hover!.metadata.dwellMs).toBe('number');
  });

  it('ABSENCE: no stored judgment — meaningful/evidenceReason/confidence are not emitted as stored fields', () => {
    const { runtime, emitted } = setupRuntime();
    const t0 = 10_000;
    runtime.process(makeEvent('evt-p8-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: t0 }));
    runtime.process(makeEvent('evt-p8-2', 'mouseleave', { tag: 'BUTTON' }, {}, { timestamp: t0 + 900 }));
    const hover = emitted.find((i) => i.type === 'Hover')!;
    expect(hover.metadata.evidenceReason).toBeUndefined();
    expect(hover.metadata.confidence).toBeUndefined();
    expect(hover.metadata.terminal).toEqual(expect.stringMatching(
      /^(left|consumed-by-click|navigation|target-removed|recording-end)$/,
    ));
  });

  it('ABSENCE: shouldCancelOnOutside is gone from the hover definition (or always false)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (typeof hoverDefinition.shouldCancelOnOutside === 'function') {
      const evt = makeEvent('evt-x', 'click', { tag: 'A' });
      expect(hoverDefinition.shouldCancelOnOutside(evt, {} as never)).toBe(false);
    }
    // else: absent — equally compliant.
  });

  it('terminal fact: buildResult records WHICH terminal ended the lifecycle', () => {
    const { runtime, emitted } = setupRuntime();
    const t0 = 10_000;
    runtime.process(makeEvent('evt-p9-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: t0 }));
    runtime.process(makeEvent('evt-p9-2', 'click', { tag: 'A', cssSelector: 'a' }, {}, { timestamp: t0 + 250 }));
    const hover = emitted.find((i) => i.type === 'Hover')!;
    expect(hover.metadata.terminal).toBe('consumed-by-click');
  });
});

describe('B7-P2: Hover discovery gate (unchanged from P1)', () => {
  it('ungated targets never start a Hover lifecycle (F-2 vocabulary asymmetry stays FIXED by the shared gate)', () => {
    const { runtime } = setupRuntime();
    const t0 = 10_000;
    // A bare DIV with a non-interactive class — pre-B7 this was the F-2 hole.
    runtime.process(makeEvent('evt-g1-1', 'mouseenter', { tag: 'DIV', className: 'menu-link' }, {}, { timestamp: t0 }));
    expect(runtime.activeCount).toBe(0);
    // .menu-link is overlay-vocabulary but NOT interactive — no lifecycle.
  });

  it('pointer-path enters recorded as memberEvents (B7-P1 policy preserved)', () => {
    const { runtime, emitted } = setupRuntime();
    const t0 = 10_000;
    runtime.process(makeEvent('evt-g2-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: t0 }));
    // Enter a nested interactive child — pointer-path fact.
    runtime.process(makeEvent('evt-g2-2', 'mouseenter', { tag: 'A', cssSelector: 'a' }, {}, { timestamp: t0 + 50 }));
    runtime.process(makeEvent('evt-g2-3', 'mouseleave', { tag: 'BUTTON' }, {}, { timestamp: t0 + 200 }));
    const hover = emitted.find((i) => i.type === 'Hover')!;
    const enters = hover.memberEvents.filter((e) => e.eventType === 'mouseenter');
    expect(enters.length).toBeGreaterThanOrEqual(1);
    expect(hover.memberEvents.some((e) => e.eventType === 'mousemove')).toBe(false);
  });
});
