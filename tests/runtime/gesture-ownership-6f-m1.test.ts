/**
 * 6F-M1 Item A — Runtime Gesture Ownership (twin Click absorption)
 *
 * Spec: .drytis/specs/phase-6f-m1-gesture-ownership.md §2.1.A, §2.3.1, §3.A
 *
 * Doctrine: the pairing predicate is STRICTLY STRUCTURAL — same pageId,
 * same elementKey, click AFTER the completing mousedown in capture order,
 * with exact adjacency in DISCRETE-event order (any intervening discrete
 * event supersedes the gesture record; non-discrete focus/mousemove/input
 * never break it — they share the browser capture counter, so raw-captureSeq
 * gaps are expected). NO timing rules: no Date.now(), no timestamp deltas,
 * no captureSeq arithmetic against constants.
 *
 * Fixture: a lifecycle definition that triggers on focus and completes on
 * mousedown (mirrors DatePicker's cell-completion shape) + a Click fallback
 * definition (immediate completion on click).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import type {
  ComponentDefinition,
  ComponentInteraction,
  RuntimeConfig,
} from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

const CELL_TARGET = {
  accessibleName: 'Choose Sunday, September 6th, 2026',
  ariaRole: 'option',
  className: 'react-datepicker__day',
  tag: 'DIV',
} as const;

/** Focus-triggered lifecycle that completes on mousedown (DatePicker shape). */
function makeMousedownCompletingDef(type: any, priority: number): ComponentDefinition {
  return {
    type,
    priority,
    triggerEventTypes: new Set(['focus']),
    detectTrigger(event) {
      if (event.eventType === 'focus') return { type } as any;
      return null;
    },
    isInScope(event, ctx) {
      // Calendar-cell events are in scope (mirrors date-picker.ts: the
      // completing cell is a different element than the wrapper trigger).
      if (event.target.className?.includes('react-datepicker__day')) return true;
      return event.target.stableId === ctx.trigger.stableId;
    },
    handleEvent(event) {
      if (event.eventType === 'mousedown') {
        return { endState: 'completed' as const };
      }
      return null;
    },
    shouldCancelOnOutside() {
      return false;
    },
    buildResult(ctx) {
      return { metadata: { targetName: ctx.trigger.accessibleName, dateValue: 'D' } };
    },
  };
}

/** Click fallback (immediate completion) — the twin source today. */
function makeClickDef(): ComponentDefinition {
  return {
    type: 'Click',
    priority: 180,
    triggerEventTypes: new Set(['click']),
    detectTrigger() {
      return { type: 'Click' } as any;
    },
    isInScope() {
      return false;
    },
    handleEvent() {
      return { endState: 'completed' as const };
    },
    shouldCancelOnOutside() {
      return false;
    },
    buildResult(ctx) {
      return { metadata: { targetName: ctx.trigger.accessibleName } };
    },
  };
}

describe('6F-M1 A — runtime gesture ownership', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;
  let ledger: EvidenceLedger;

  function setup(defs: ComponentDefinition[]) {
    emitted = [];
    ledger = new EvidenceLedger();
    const config: RuntimeConfig = {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    };
    runtime = createRuntime(defs, config);
  }

  beforeEach(() => {
    emitted = [];
  });

  /** Production wiring: sw-integration appends every observed event to the
   *  ledger before dispatching to the runtime (sw-integration.ts:844). */
  const dispatch = (ev: ReturnType<typeof makeObservedEvent>) => {
    ledger.append(ev);
    return runtime.process(ev);
  };

  const focusOn = (eventId: string, seq: number, stableId: string, name: string) =>
    makeObservedEvent({
      eventId,
      eventType: 'focus',
      captureSeq: seq,
      target: { accessibleName: name, tag: 'INPUT', stableId } as any,
    });

  const cellMousedown = (eventId: string, seq: number, stableId: string) =>
    makeObservedEvent({
      eventId,
      eventType: 'mousedown',
      captureSeq: seq,
      target: { ...CELL_TARGET, stableId } as any,
    });

  const cellClick = (eventId: string, seq: number, stableId: string) =>
    makeObservedEvent({
      eventId,
      eventType: 'click',
      captureSeq: seq,
      target: { ...CELL_TARGET, stableId } as any,
    });

  it('AC-A1: mousedown-completed lifecycle absorbs the captureSeq-adjacent same-element click — no twin emitted', () => {
    setup([makeMousedownCompletingDef('DatePicker', 60), makeClickDef()]);

    runtime.process(focusOn('evt-pT1-1', 1, 'wrap', 'Depart on'));

    // mousedown on the cell completes the lifecycle (captureSeq 2)
    const r1 = dispatch(cellMousedown('evt-pT1-2', 2, 'cell-7'));
    expect(r1.length).toBe(1);
    expect(r1[0].type).toBe('DatePicker');
    expect(r1[0].endState).toBe('completed');

    // paired click: captureSeq 3 = adjacency, same elementKey
    const r2 = dispatch(cellClick('evt-pT1-3', 3, 'cell-7'));

    // Twin gone: no new interaction for the click
    expect(r2.length).toBe(0);
    expect(emitted.filter((i) => i.type === 'Click')).toHaveLength(0);

    // Ledger: click claimed by the DatePicker interaction
    const entry = ledger.getEntries().find((e) => e.eventId === 'evt-pT1-3');
    expect(entry?.disposition).toBe('claimed');
    expect(entry?.claimType).toBe('DatePicker');
    expect(entry?.claimedBy).toBe(r1[0].interactionId);
  });

  it('AC-A2: different elementKey on the click → discovery proceeds, Click card emitted (no over-suppression)', () => {
    setup([makeMousedownCompletingDef('DatePicker', 60), makeClickDef()]);

    runtime.process(focusOn('evt-pT2-1', 1, 'wrap', 'Depart on'));
    dispatch(cellMousedown('evt-pT2-2', 2, 'cell-7'));

    // click on a DIFFERENT element (search button)
    const r2 = dispatch(
      makeObservedEvent({
        eventId: 'evt-pT2-3',
        eventType: 'click',
        captureSeq: 3,
        target: { accessibleName: 'Search Flights', tag: 'BUTTON', stableId: 'search-btn' } as any,
      }),
    );
    expect(r2.length).toBe(1);
    expect(r2[0].type).toBe('Click');
    expect(r2[0].metadata.targetName).toBe('Search Flights');
  });

  it('AC-A2b: an intervening DISCRETE event (keydown) breaks adjacency → gesture record superseded, honest Click card', () => {
    setup([makeMousedownCompletingDef('DatePicker', 60), makeClickDef()]);

    runtime.process(focusOn('evt-pT3-1', 1, 'wrap', 'Depart on'));
    dispatch(cellMousedown('evt-pT3-2', 2, 'cell-7'));

    // keydown lands BETWEEN mousedown and click — discrete, breaks adjacency
    dispatch(
      makeObservedEvent({
        eventId: 'evt-pT3-3',
        eventType: 'keydown',
        captureSeq: 3,
        target: { ...CELL_TARGET, stableId: 'cell-7' } as any,
      }),
    );
    // click on the same cell arrives AFTER the discrete break
    const r2 = dispatch(cellClick('evt-pT3-5', 5, 'cell-7'));
    expect(r2.length).toBe(1);
    expect(r2[0].type).toBe('Click');
  });

  it('AC-A2c: adjacent click on the same element but different page → no absorption (pageId guard)', () => {
    setup([makeMousedownCompletingDef('DatePicker', 60), makeClickDef()]);

    runtime.process(focusOn('evt-pT4-1', 1, 'wrap', 'Depart on'));
    dispatch(cellMousedown('evt-pT4-2', 2, 'cell-7'));

    // click from a DIFFERENT page (different pageId prefix in eventId)
    const r2 = dispatch(cellClick('evt-pT5-3', 3, 'cell-7'));
    expect(r2.length).toBe(1);
    expect(r2[0].type).toBe('Click');
  });

  it('AC-A3: plain click gesture (no mousedown-completing lifecycle) → baseline behavior unchanged', () => {
    setup([makeClickDef()]);

    const r = runtime.process(
      makeObservedEvent({
        eventId: 'evt-pT6-1',
        eventType: 'click',
        captureSeq: 1,
        target: { accessibleName: 'Search Flights', tag: 'BUTTON', stableId: 'search-btn' } as any,
      }),
    );
    expect(r.length).toBe(1);
    expect(r[0].type).toBe('Click');
    expect(r[0].endState).toBe('completed');
  });

  it('AC-A1b (corrected-rule pin): raw captureSeq GAP with only non-discrete interleave — still absorbs; +1 arithmetic would fail', () => {
    setup([makeMousedownCompletingDef('DatePicker', 60), makeClickDef()]);

    runtime.process(focusOn('evt-pT9-1', 6934, 'wrap', 'Depart on'));
    // Real run shape: mousedown seq 6935 → click seq 7025 (raw gap ≈ 90;
    // non-discrete events share the browser capture counter).
    dispatch(cellMousedown('evt-pT9-2', 6935, 'cell-7'));
    dispatch(cellClick('evt-pT9-3', 7025, 'cell-7'));

    expect(emitted.filter((i) => i.type === 'Click')).toHaveLength(0);
    const entry = ledger.getEntries().find((e) => e.eventId === 'evt-pT9-3');
    expect(entry?.disposition).toBe('claimed');
    expect(entry?.claimType).toBe('DatePicker');
  });

  it('AC-A5b (behavioral bound pin): 20 mousedown completions with NO clicks → list saturates at 16, oldest evicted — its click emits honestly, newest still absorbs', () => {
    setup([makeMousedownCompletingDef('DatePicker', 60), makeClickDef()]);

    // 20 gestures complete; no click consumes any record → list saturates
    // at MAX_GESTURE_RECORDS=16 with oldest-first eviction (gestures 0-3 out).
    for (let g =  0; g < 20; g++) {
      runtime.process(focusOn(`evt-pTA-${g}-1`, 1000 + g * 10, `wrap-${g}`, `F${g}`));
      dispatch(cellMousedown(`evt-pTA-${g}-2`, 1001 + g * 10, `cell-${g}`));
    }
    expect(emitted.filter((i) => i.type === 'DatePicker')).toHaveLength(20);

    // Evicted (oldest, g=0): honest Click card — no absorption
    const rEvict = dispatch(cellClick('evt-pTA-0-3', 1300, 'cell-0'));
    expect(rEvict.length).toBe(1);
    expect(rEvict[0].type).toBe('Click');

    // Newest (g=19) still absorbs
    const rNew = dispatch(cellClick('evt-pTA-19-3', 1301, 'cell-19'));
    expect(rNew.length).toBe(0);
    expect(emitted.filter((i) => i.type === 'Click')).toHaveLength(1);
  });

  it('AC-A4 (unit-level integration): DatePicker focus→mousedown→click + later button click → 2 interactions total, both honest', () => {
    setup([makeMousedownCompletingDef('DatePicker', 60), makeClickDef()]);

    runtime.process(focusOn('evt-pT8-1', 1, 'wrap', 'Depart on'));
    dispatch(cellMousedown('evt-pT8-2', 2, 'cell-7'));
    dispatch(cellClick('evt-pT8-3', 3, 'cell-7')); // absorbed

    // Later, unrelated click
    const r = runtime.process(
      makeObservedEvent({
        eventId: 'evt-pT8-9',
        eventType: 'click',
        captureSeq: 9,
        target: { accessibleName: 'Search Flights', tag: 'BUTTON', stableId: 'search-btn' } as any,
      }),
    );
    expect(r.length).toBe(1);
    expect(emitted).toHaveLength(2); // DatePicker + Search click
  });
});
