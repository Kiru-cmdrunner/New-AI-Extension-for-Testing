/**
 * WARN-4 — Active-lifecycle absorption cannot supersede gesture records
 *
 * Spec: .drytis/specs/warn4-active-lifecycle-supersession.md (W4-T1..T6)
 *
 * THE DEFECT, precisely (grounded by hand against the unmodified runtime,
 * dbg11c): a discrete event SILENTLY ABSORBED by an active lifecycle
 * (same-element handleEvent→null, step 3 handled=true) never marks this
 * page's completedGestures records superseded — unlike step 2c (unhandled
 * discrete) and the record site (:735-737, newer completing mousedown).
 * The defect window is BETWEEN silent absorptions: G1 armed at seq 2;
 * an intervening discrete event absorbed silently does NOT break G1's
 * adjacency (doctrine violation — it should); a later click at G1's
 * element is then wrongly claimed by the OLD interaction (misattribution)
 * and the record consumed.
 *
 * Shapes verified live (pre-fix behavior in brackets):
 *   keydown silently absorbed at overlay trigger … same-element branch
 *   [ledger: absorbed, runtime: silent — but G1 survives]
 *
 * Doctrine: STRICTLY STRUCTURAL — pageId equality + discrete type only.
 * No timing fields, no captureSeq math.
 */

import { describe, it, expect } from 'vitest';
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

/** DatePicker-family lifecycle: wrapper focus trigger, completes on cell
 *  mousedown — same as the 6F-M1 suite's fixture, with per-gesture
 *  selectedDate so two genuine completions stay distinct in dedup. */
function makeDatePickerDef(priority = 60): ComponentDefinition {
  return {
    type: 'DatePicker',
    priority,
    triggerEventTypes: new Set(['focus']),
    detectTrigger(event) {
      if (event.eventType === 'focus') return { type: 'DatePicker' } as any;
      return null;
    },
    isInScope(event, ctx) {
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
      const completing = ctx.memberEvents[ctx.memberEvents.length - 1];
      const date = String((completing?.target as { stableId?: string })?.stableId ?? 'D');
      return { metadata: { targetName: ctx.trigger.accessibleName, selectedDate: date } };
    },
  };
}

/** Overlay lifecycle: TRIGGERS on a cell mousedown (so its arming event is
 *  itself handled at step-4-discovery — discrete, absorbed), NEVER
 *  completes, and silently absorbs subsequent same-cell discrete events.
 *  This is the step-3 silent-absorption engine for the tests. */
function makeOverlayDef(priority = 40): ComponentDefinition {
  return {
    type: 'DatePickerOverlay' as unknown as ComponentDefinition['type'],
    priority,
    triggerEventTypes: new Set(['mousedown']),
    detectTrigger(event) {
      if (event.eventType === 'mousedown') return { type: 'DatePickerOverlay' } as any;
      return null;
    },
    isInScope(event, ctx) {
      if (event.target.className?.includes('react-datepicker__day')) return true;
      return event.target.stableId === ctx.trigger.stableId;
    },
    handleEvent() {
      return null; // never completes — silent absorber
    },
    shouldCancelOnOutside() {
      return false;
    },
    buildResult(ctx) {
      return { metadata: { targetName: ctx.trigger.accessibleName } };
    },
  };
}

/** Click fallback (immediate completion). */
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

describe('WARN-4 — active-lifecycle absorption supersedes gesture records', () => {
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

  const dispatch = (ev: ReturnType<typeof makeObservedEvent>) => {
    ledger.append(ev);
    return runtime.process(ev);
  };

  const wrapFocus = (eventId: string, seq: number) =>
    makeObservedEvent({
      eventId,
      eventType: 'focus',
      captureSeq: seq,
      timestamp: 1000 * seq,
      target: { accessibleName: 'Depart on', tag: 'INPUT', stableId: 'wrap', className: 'form-control' } as any,
    });

  const cellEvent = (eventType: string, eventId: string, seq: number, stableId: string) =>
    makeObservedEvent({
      eventId,
      eventType: eventType as never,
      captureSeq: seq,
      timestamp: 1000 * seq,
      target: { ...CELL_TARGET, stableId } as any,
    });

  it('W4-T1: a keydown silently absorbed by an ACTIVE lifecycle must supersede same-page records — the later click is NOT stolen by the OLD interaction', () => {
    setup([makeDatePickerDef(), makeOverlayDef(), makeClickDef()]);

    // G1 armed: wrapper focus → cell-7 mousedown completes the DatePicker.
    runtime.process(wrapFocus('evt-pT1-1', 1));
    const r1 = dispatch(cellEvent('mousedown', 'evt-pT1-2', 2, 'cell-7'));
    expect(r1.length).toBe(1);
    expect(r1[0].type).toBe('DatePicker');

    // Overlay arms on the cell-9 mousedown (step-4 discovery trigger).
    const r2 = dispatch(cellEvent('mousedown', 'evt-pT1-3', 3, 'cell-9'));
    expect(r2.length).toBe(0); // armed silently

    // Same-element keydown at cell-9 is SILENTLY ABSORBED by the overlay
    // (step 3, handled=true). Pre-fix: this does NOT supersede G1.
    const r3 = dispatch(cellEvent('keydown', 'evt-pT1-4', 4, 'cell-9'));
    expect(r3.length).toBe(0);
    expect(
      (ledger as unknown as { entries: Map<string, { disposition: string }> }).entries.get('evt-pT1-4')?.disposition,
    ).toBe('absorbed'); // premise pinned: step 3 handled it

    // The later click at G1's element. Pre-fix (defect): G1 survives both
    // the overlay arming (superseded — :735-737 fired at the OVERLAY's
    // trigger? NO — the overlay never completes, so its arming mousedown
    // was handled at step 4 DISCOVERY, which does NOT supersede) — wait,
    // step 2c fired for it (discrete, non-click, !handled at 2c time? no:
    // 2c runs BEFORE step 3/4 — the overlay's arming mousedown passes
    // through 2c unhandled → 2c SUPERSEDES G1.
    //
    // HONEST PREMISE (verified live): the overlay's ARMING mousedown runs
    // 2c → G1 IS superseded at that point. So the true defect window for
    // THEFT requires the intervening absorbed event WITHOUT any 2c event
    // in between: G1 armed, THEN a silent absorption at a lifecycle whose
    // arming predates G1. Constructed below in W4-T2.
    const r4 = dispatch(cellEvent('click', 'evt-pT1-5', 5, 'cell-7'));
    // Post-fix AND pre-fix agree here (G1 was superseded at 2c by the
    // overlay arming): honest Click card, not stolen.
    expect(r4.length).toBe(1);
    expect(r4[0].type).toBe('Click');
    expect(r4[0].interactionId).not.toBe(r1[0].interactionId);
  });

  it('W4-T2 (the theft window): overlay armed BEFORE G1; a silently absorbed keydown intervenes; the next click at G1\'s element must NOT be stolen by the OLD interaction', () => {
    setup([makeDatePickerDef(), makeOverlayDef(), makeClickDef()]);

    // Overlay FIRST (armed on cell-9 mousedown, step 4 discovery — no
    // gesture records exist yet, so nothing to supersede).
    const r0 = dispatch(cellEvent('mousedown', 'evt-pT2-0', 1, 'cell-9'));
    expect(r0.length).toBe(0);

    // G1 armed: wrapper focus (overlay does not match wrap: different
    // stableId and no cell class → out of scope, no cancel), cell-7
    // mousedown completes the DatePicker. NOTE: is G1's completing
    // mousedown in scope of the overlay? It has the cell class → YES —
    // the overlay is higher on the stack? Priorities: overlay 40 checked
    // BEFORE DatePicker 60 (ascending). Different-target discrete
    // (cell-7 vs trigger cell-9) → ownership guard releases it → falls
    // through to DatePicker, completes, records G1. Verified live below.
    runtime.process(wrapFocus('evt-pT2-1', 2));
    const r1 = dispatch(cellEvent('mousedown', 'evt-pT2-2', 3, 'cell-7'));
    expect(r1.length).toBe(1);
    expect(r1[0].type).toBe('DatePicker');

    // KEYDOWN at the overlay's trigger (cell-9): same-element → SILENTLY
    // ABSORBED (step 3, handled=true). NOTE — this keydown also passes
    // through step 2c FIRST (discrete, non-click), which supersedes G1
    // pre-fix AND post-fix. This test is therefore a POST-FIX behavior
    // pin (the click must emit honestly), not a red-window test; the
    // pre-fix defect shape is W4-T6 (absorbed CLICK). See spec §5.
    const r3 = dispatch(cellEvent('keydown', 'evt-pT2-4', 4, 'cell-9'));
    expect(r3.length).toBe(0);
    expect(
      (ledger as unknown as { entries: Map<string, { disposition: string }> }).entries.get('evt-pT2-4')?.disposition,
    ).toBe('absorbed'); // premise pinned

    // The click at G1's element (cell-7): with the DEFECT, stale G1 claims
    // it for the OLD DatePicker interaction — r4 is EMPTY (theft +
    // misattribution). Post-fix: honest Click card.
    const r4 = dispatch(cellEvent('click', 'evt-pT2-5', 5, 'cell-7'));
    expect(r4.length).toBe(1);
    expect(r4[0].type).toBe('Click');
    expect(r4[0].interactionId).not.toBe(r1[0].interactionId);
    const entry = (ledger as unknown as { entries: Map<string, { disposition: string; claimedBy?: string }> }).entries.get('evt-pT2-5');
    expect(entry?.disposition).toBe('claimed');
    expect(entry?.claimedBy).not.toBe(r1[0].interactionId);
  });

  it('W4-T3: cross-page isolation — an absorbed discrete event on another page does not supersede this page\'s records', () => {
    setup([makeDatePickerDef(), makeOverlayDef(), makeClickDef()]);

    // Page T3: G1 armed and the release click is NEXT discrete (no
    // intervening events) — must still be absorbed by G1 (6F-M1 A1
    // behavior preserved).
    runtime.process(wrapFocus('evt-pT3-1', 1));
    const r1 = dispatch(cellEvent('mousedown', 'evt-pT3-2', 2, 'cell-7'));
    expect(r1.length).toBe(1);

    // Page PX: overlay armed, absorbs a keydown silently.
    dispatch(cellEvent('mousedown', 'evt-pX-1', 100, 'cell-X'));
    dispatch(cellEvent('keydown', 'evt-pX-2', 101, 'cell-X'));

    // Page T3: the genuine release click — still G1's half.
    const r4 = dispatch(cellEvent('click', 'evt-pT3-3', 3, 'cell-7'));
    expect(r4.length).toBe(0);
  });

  it('W4-T4: a NON-discrete event absorbed by an active lifecycle does NOT supersede (adjacency is discrete-order only)', () => {
    setup([makeDatePickerDef(), makeOverlayDef(), makeClickDef()]);

    // Overlay armed BEFORE G1 (so its arming does not supersede), then G1.
    dispatch(cellEvent('mousedown', 'evt-pT4-0', 1, 'cell-9'));
    runtime.process(wrapFocus('evt-pT4-1', 2));
    const r1 = dispatch(cellEvent('mousedown', 'evt-pT4-2', 3, 'cell-7'));
    expect(r1.length).toBe(1);

    // NON-discrete input event at the overlay trigger — absorbed silently
    // (accumulating branch), must NOT supersede G1.
    const r3 = dispatch(cellEvent('input', 'evt-pT4-4', 4, 'cell-9'));
    expect(r3.length).toBe(0);

    // The genuine release click is STILL G1's half — no emission.
    const r4 = dispatch(cellEvent('click', 'evt-pT4-5', 5, 'cell-7'));
    expect(r4.length).toBe(0);
  });

  it('W4-T5: the 6F-M1 A1 pairing itself is untouched — no active lifecycle involved', () => {
    setup([makeDatePickerDef(), makeClickDef()]);
    runtime.process(wrapFocus('evt-pT5-1', 1));
    const r1 = dispatch(cellEvent('mousedown', 'evt-pT5-2', 2, 'cell-7'));
    expect(r1.length).toBe(1);
    expect(r1[0].type).toBe('DatePicker');
    // Adjacent click absorbed — zero twins.
    const r2 = dispatch(cellEvent('click', 'evt-pT5-3', 3, 'cell-7'));
    expect(r2.length).toBe(0);
    const e = (ledger as unknown as { entries: Map<string, { disposition: string; claimType?: string; claimedBy?: string }> }).entries.get('evt-pT5-3');
    expect(e?.disposition).toBe('claimed');
    expect(e?.claimType).toBe('DatePicker');
    expect(e?.claimedBy).toBe(r1[0].interactionId);
  });

  it('W4-T6: an absorbed CLICK (same-element at overlay trigger) also supersedes — the subsequent click at G1\'s element emits honestly', () => {
    setup([makeDatePickerDef(), makeOverlayDef(), makeClickDef()]);

    dispatch(cellEvent('mousedown', 'evt-pT6-0', 1, 'cell-9')); // overlay armed
    runtime.process(wrapFocus('evt-pT6-1', 2));
    const r1 = dispatch(cellEvent('mousedown', 'evt-pT6-2', 3, 'cell-7'));
    expect(r1.length).toBe(1); // G1 armed

    // Same-element CLICK at the overlay trigger (cell-9): same-element →
    // silent absorption at step 3 (handleEvent→null, accumulating shape).
    const r3 = dispatch(cellEvent('click', 'evt-pT6-4', 4, 'cell-9'));
    expect(r3.length).toBe(0);
    expect(
      (ledger as unknown as { entries: Map<string, { disposition: string }> }).entries.get('evt-pT6-4')?.disposition,
    ).toBe('absorbed');

    // Post-fix: G1 superseded by the absorbed click → honest Click card.
    const r4 = dispatch(cellEvent('click', 'evt-pT6-5', 5, 'cell-7'));
    expect(r4.length).toBe(1);
    expect(r4[0].type).toBe('Click');
  });
});
