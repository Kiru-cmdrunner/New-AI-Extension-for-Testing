/**
 * Tests: Runtime Disposition Tracking — Evidence Ledger Integration
 *
 * Milestone 3 of the End-to-End Capture Guarantee.
 *
 * Tests that ComponentRuntime correctly assigns dispositions to EvidenceLedger
 * entries at each decision point:
 *
 *   pending → absorbed (when lifecycle claims event)
 *   absorbed → claimed (when lifecycle completes)
 *   absorbed → unclaimed (when lifecycle abandoned/interrupted)
 *   immediate claim (when lifecycle completes on first event)
 *
 * These tests run with ledger attached but the OLD fallback code still fires.
 * No existing behavior changes.
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

// ── Test Definitions ──────────────────────────────────────────────────

function makeClickDef(): ComponentDefinition {
  return {
    type: 'Click',
    priority: 180,
    triggerEventTypes: new Set(['click', 'contextmenu']),
    detectTrigger(event) {
      const { tag, ariaRole } = event.target;
      const interactiveTags = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
      const interactiveRoles = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option']);
      if (interactiveTags.has(tag)) return { type: 'Click' };
      if (ariaRole && interactiveRoles.has(ariaRole)) return { type: 'Click' };
      return null;
    },
    isInScope() {
      return false; // immediate completion
    },
    handleEvent() {
      return { endState: 'completed' as const };
    },
    shouldCancelOnOutside() {
      return false;
    },
    buildResult(ctx) {
      return { metadata: { targetName: ctx.trigger.accessibleName || 'element' } };
    },
  };
}

function makeDropdownDef(): ComponentDefinition {
  return {
    type: 'Dropdown',
    priority: 40,
    triggerEventTypes: new Set(['click', 'focus']),
    semanticChildRoles: ['option'],
    semanticChildTags: ['OPTION'],
    detectTrigger(event) {
      if (event.eventType === 'click' && event.domContext.ariaHasPopup) {
        return { type: 'Dropdown' };
      }
      return null;
    },
    isInScope(event, ctx) {
      if (event.target.stableId === ctx.trigger.stableId) return true;
      if (event.target.ariaRole === 'option') return true;
      return false;
    },
    handleEvent(event, ctx) {
      if (event.eventType === 'click' && event.target.ariaRole === 'option') {
        ctx.data.selectedValue = event.target.accessibleName;
        return { endState: 'completed' as const };
      }
      return null;
    },
    shouldCancelOnOutside(event) {
      if (event.eventType === 'click') return true;
      return false;
    },
    shouldCompleteOnOutside() {
      return false;
    },
    buildResult(ctx) {
      return {
        metadata: {
          targetName: ctx.trigger.accessibleName,
          selectedValue: ctx.data.selectedValue ?? '',
        },
      };
    },
  };
}

function makeTextEntryDef(): ComponentDefinition {
  return {
    type: 'TextEntry',
    priority: 50,
    triggerEventTypes: new Set(['focus']),
    detectTrigger(event) {
      if (event.eventType === 'focus' && (event.target.tag === 'INPUT' || event.target.tag === 'TEXTAREA')) {
        return { type: 'TextEntry' };
      }
      return null;
    },
    isInScope(event, ctx) {
      return event.target.stableId === ctx.trigger.stableId;
    },
    handleEvent(event, _ctx) {
      if (event.eventType === 'blur') {
        return { endState: 'completed' as const };
      }
      return null;
    },
    shouldCancelOnOutside() {
      return false;
    },
    buildResult(ctx) {
      return { metadata: { targetName: ctx.trigger.accessibleName || 'text field' } };
    },
  };
}

// ── Test Setup ────────────────────────────────────────────────────────

describe('Runtime Disposition Tracking — Milestone 3', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;
  let ledger: EvidenceLedger;

  function setup(defs: ComponentDefinition[], withLedger: boolean = true) {
    emitted = [];
    ledger = new EvidenceLedger();
    const config: RuntimeConfig = {
      onEmit: (i) => emitted.push(i),
      ...(withLedger ? { evidenceLedger: ledger } : {}),
    };
    runtime = createRuntime(defs, config);
  }

  beforeEach(() => {
    emitted = [];
  });

  // ── Click: immediate completion → claimed ───────────────────────────

  it('click on button: trigger event disposition → claimed', () => {
    setup([makeClickDef()]);
    const click = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      captureSeq: 100,
      target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
    });
    ledger.append(click);
    runtime.process(click);

    const entry = ledger.get('evt-p1-1')!;
    expect(entry.disposition).toBe('claimed');
    expect(entry.claimType).toBe('Click');
    expect(entry.claimedBy).toMatch(/^int-\d+$/);
  });

  // ── Contextmenu: immediate completion → claimed ─────────────────────

  it('contextmenu on button: trigger event disposition → claimed', () => {
    setup([makeClickDef()]);
    const ctxMenu = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'contextmenu',
      captureSeq: 100,
      target: { tag: 'BUTTON', accessibleName: 'Menu', stableId: 'btn1', cssSelector: 'button#btn1' },
    });
    ledger.append(ctxMenu);
    runtime.process(ctxMenu);

    expect(ledger.get('evt-p1-1')!.disposition).toBe('claimed');
  });

  // ── Dropdown: trigger → option click → completion → both claimed ────

  it('dropdown lifecycle: trigger + option events → claimed on completion', () => {
    setup([makeClickDef(), makeDropdownDef()]);

    // 1. Trigger: click on dropdown toggle
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      captureSeq: 100,
      target: { tag: 'BUTTON', accessibleName: 'Choose', stableId: 'dd1', cssSelector: 'button#dd1', ariaRole: 'button' },
      domContext: { ariaHasPopup: 'listbox', tabIndex: 0 } as any,
    });
    ledger.append(trigger);
    runtime.process(trigger);

    // Trigger event should be absorbed (dropdown lifecycle active, not completed)
    expect(ledger.get('evt-p1-1')!.disposition).toBe('absorbed');

    // 2. Option click: completes the dropdown
    const optionClick = makeObservedEvent({
      eventId: 'evt-p1-2',
      eventType: 'click',
      captureSeq: 200,
      target: { tag: 'LI', accessibleName: 'Option A', stableId: 'opt1', cssSelector: 'li#opt1', ariaRole: 'option' },
    });
    ledger.append(optionClick);
    runtime.process(optionClick);

    // Both should now be claimed
    expect(ledger.get('evt-p1-1')!.disposition).toBe('claimed');
    expect(ledger.get('evt-p1-2')!.disposition).toBe('claimed');
    expect(emitted.some((i) => i.type === 'Dropdown')).toBe(true);
  });

  // ── Dropdown: trigger → outside click → abandoned → trigger unclaimed ─

  it('dropdown abandoned by outside click: trigger event → unclaimed', () => {
    setup([makeClickDef(), makeDropdownDef()]);

    const trigger = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      captureSeq: 100,
      target: { tag: 'BUTTON', accessibleName: 'Choose', stableId: 'dd1', cssSelector: 'button#dd1', ariaRole: 'button' },
      domContext: { ariaHasPopup: 'listbox', tabIndex: 0 } as any,
    });
    ledger.append(trigger);
    runtime.process(trigger);

    expect(ledger.get('evt-p1-1')!.disposition).toBe('absorbed');

    // Outside click triggers shouldCancelOnOutside → abandoned
    const outsideClick = makeObservedEvent({
      eventId: 'evt-p1-2',
      eventType: 'click',
      captureSeq: 200,
      target: { tag: 'DIV', accessibleName: 'Somewhere else', stableId: 'body', cssSelector: 'div#body' },
    });
    ledger.append(outsideClick);
    runtime.process(outsideClick);

    // Trigger should be released to unclaimed (lifecycle was abandoned)
    expect(ledger.get('evt-p1-1')!.disposition).toBe('unclaimed');
  });

  // ── Mousedown on unrecognized element → pending (Projection Engine surfaces) ──

  it('mousedown on div: no definition matches → pending (Projection Engine surfaces)', () => {
    setup([makeClickDef()]); // Click only triggers on click, not mousedown

    const mousedown = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'mousedown',
      captureSeq: 100,
      target: { tag: 'DIV', accessibleName: 'Box', stableId: 'box1', cssSelector: 'div#box1' },
    });
    ledger.append(mousedown);
    runtime.process(mousedown);

    // M5: No fallback emission. Disposition stays 'pending'.
    // Projection Engine surfaces pending entries as Unclassified at output time.
    expect(ledger.get('evt-p1-1')!.disposition).toBe('pending');
  });

  // ── TextEntry lifecycle: focus → input → blur → completion ──────────

  it('textentry lifecycle: trigger and blur events → claimed on completion', () => {
    setup([makeClickDef(), makeTextEntryDef()]);

    const focus = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'focus',
      captureSeq: 100,
      target: { tag: 'INPUT', accessibleName: 'Name', stableId: 'inp1', cssSelector: 'input#inp1' },
    });
    // focus is non-discrete → not in ledger
    ledger.append(focus);
    runtime.process(focus);

    // Non-discrete events don't enter the ledger
    expect(ledger.size).toBe(0);

    const input = makeObservedEvent({
      eventId: 'evt-p1-2',
      eventType: 'input',
      captureSeq: 200,
      target: { tag: 'INPUT', accessibleName: 'Name', stableId: 'inp1', cssSelector: 'input#inp1' },
    });
    ledger.append(input);
    runtime.process(input);

    // input is non-discrete → not in ledger
    expect(ledger.size).toBe(0);

    const blur = makeObservedEvent({
      eventId: 'evt-p1-3',
      eventType: 'blur',
      captureSeq: 300,
      target: { tag: 'INPUT', accessibleName: 'Name', stableId: 'inp1', cssSelector: 'input#inp1' },
    });
    ledger.append(blur);
    runtime.process(blur);

    // blur is non-discrete → not in ledger
    expect(ledger.size).toBe(0);
    // TextEntry should complete and emit
    expect(emitted.some((i) => i.type === 'TextEntry')).toBe(true);
  });

  // ── Flush: interrupted lifecycle → absorbed events → unclaimed ──────

  it('flush interrupts active lifecycle without shouldCompleteOnOutside: trigger → unclaimed', () => {
    // This dropdown def does NOT define shouldCompleteOnOutside,
    // so flush() uses endState='interrupted'.
    const dropdownNoComplete: ComponentDefinition = {
      ...makeDropdownDef(),
      shouldCompleteOnOutside: undefined,
      shouldCancelOnOutside() { return false; },
    };
    setup([makeClickDef(), dropdownNoComplete]);

    const trigger = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      captureSeq: 100,
      target: { tag: 'BUTTON', accessibleName: 'Choose', stableId: 'dd1', cssSelector: 'button#dd1', ariaRole: 'button' },
      domContext: { ariaHasPopup: 'listbox', tabIndex: 0 } as any,
    });
    ledger.append(trigger);
    runtime.process(trigger);

    expect(ledger.get('evt-p1-1')!.disposition).toBe('absorbed');

    // Flush without completing the dropdown
    runtime.flush();

    expect(ledger.get('evt-p1-1')!.disposition).toBe('unclaimed');
  });

  // ── Dedup: suppressed interaction → events released ─────────────────

  it('dedup-suppressed click: second click released to unclaimed', () => {
    setup([makeClickDef()]);

    const click1 = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      captureSeq: 100,
      timestamp: 1000,
      target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
    });
    ledger.append(click1);
    runtime.process(click1);

    expect(ledger.get('evt-p1-1')!.disposition).toBe('claimed');

    // Second click same element, same type, within dedup window
    const click2 = makeObservedEvent({
      eventId: 'evt-p1-2',
      eventType: 'click',
      captureSeq: 101,
      timestamp: 1050, // 50ms gap, within DEDUP_WINDOW_MS
      target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
    });
    ledger.append(click2);
    runtime.process(click2);

    // click2 was absorbed by immediate completion, then dedup suppressed
    // it — 7.4-B3 S2 FOLDS it into the prior interaction instead of
    // releasing: disposition 'claimed' by the PRIOR interactionId (no
    // Unclassified resurrection; repeatCount recorded).
    expect(ledger.get('evt-p1-2')!.disposition).toBe('claimed');
    expect(ledger.get('evt-p1-2')!.claimedBy).toBe('int-1');
    expect(ledger.get('evt-p1-2')!.claimType).toBe('Click');
  });

  // ── Non-discrete events don't enter ledger ──────────────────────────

  it('focus events do not enter the ledger', () => {
    setup([makeClickDef(), makeTextEntryDef()]);

    const focus = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'focus',
      target: { tag: 'INPUT', accessibleName: 'Name', stableId: 'inp1', cssSelector: 'input#inp1' },
    });
    ledger.append(focus);
    runtime.process(focus);

    expect(ledger.size).toBe(0); // focus is non-discrete
  });

  // ── Ledger not provided: runtime works standalone ───────────────────

  it('runtime without ledger works exactly as before', () => {
    setup([makeClickDef()], false); // no ledger

    const click = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
    });
    runtime.process(click);

    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
  });

  // ── Complete ledger lifecycle for a multi-event interaction ─────────

  it('full lifecycle: mousedown(pending) + click(claimed by Click) on same button', () => {
    setup([makeClickDef()]);

    // mousedown first (not handled by Click def — Click triggers on 'click')
    const mousedown = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'mousedown',
      captureSeq: 100,
      target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
    });
    ledger.append(mousedown);
    runtime.process(mousedown);

    // M5: mousedown has no definition match → stays pending (no fallback emission)
    expect(ledger.get('evt-p1-1')!.disposition).toBe('pending');

    // click on same button
    const click = makeObservedEvent({
      eventId: 'evt-p1-2',
      eventType: 'click',
      captureSeq: 101,
      target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
    });
    ledger.append(click);
    runtime.process(click);

    // click: Click def matches → immediate completion → claimed
    expect(ledger.get('evt-p1-2')!.disposition).toBe('claimed');
    expect(ledger.get('evt-p1-2')!.claimType).toBe('Click');

    // mousedown still pending (no definition matched it)
    expect(ledger.get('evt-p1-1')!.disposition).toBe('pending');
  });

  // ── Keydown events ──────────────────────────────────────────────────

  it('keydown on div: no definition matches → pending (Projection Engine surfaces)', () => {
    setup([makeClickDef()]);

    const keydown = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'keydown',
      captureSeq: 100,
      target: { tag: 'DIV', accessibleName: 'Container', stableId: 'div1', cssSelector: 'div#div1' },
    });
    ledger.append(keydown);
    runtime.process(keydown);

    // M5: No fallback emission. Disposition stays 'pending'.
    expect(ledger.get('evt-p1-1')!.disposition).toBe('pending');
  });

  // ── Multiple pages: ledger preserves page boundaries ────────────────

  it('events from different pages get different pageIds in ledger', () => {
    setup([makeClickDef()]);

    const click1 = makeObservedEvent({
      eventId: 'evt-pA-1',
      eventType: 'click',
      captureSeq: 100,
      target: { tag: 'BUTTON', accessibleName: 'A', stableId: 'btnA', cssSelector: 'button#btnA' },
    });
    ledger.append(click1);
    runtime.process(click1);

    const click2 = makeObservedEvent({
      eventId: 'evt-pB-1',
      eventType: 'click',
      captureSeq: 200,
      target: { tag: 'BUTTON', accessibleName: 'B', stableId: 'btnB', cssSelector: 'button#btnB' },
    });
    ledger.append(click2);
    runtime.process(click2);

    expect(ledger.get('evt-pA-1')!.pageId).toBe('pA');
    expect(ledger.get('evt-pB-1')!.pageId).toBe('pB');
    expect(ledger.get('evt-pA-1')!.disposition).toBe('claimed');
    expect(ledger.get('evt-pB-1')!.disposition).toBe('claimed');
  });
});
