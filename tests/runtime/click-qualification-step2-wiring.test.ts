/**
 * Capture-Time Click Qualification v1.2 — Step 2 (wiring) — RED PINS
 *
 * Spec: .drytis/specs/click-capture-qualification-v1.md §8.1 (universal
 * pre-gate before tryDiscovery), §8.5 (claim rule: verdict==='qualified',
 * gates deleted as authority), §8.2 (accepted side effects), §10.8
 * (pre-gate totality).
 *
 * Written RED, before the wiring lands:
 *   S2-1  R-1: provably-invalid click is claimed by NO definition
 *         (disabled button[aria-expanded] never becomes Expander)
 *   S2-2  invalid click stays pending → projected Unclassified with causes
 *   S2-3  flip: qualified plain-div click → Click (was Unclassified)
 *   S2-4  flip: qualified BODY canvas click → Click + insufficient (B3 S4
 *         click-away preserved as a REAL action)
 *   S2-5  side effect: invalid click still completes an in-flight Hover
 *   S2-6  side effect: invalid trailing click absorbed by 6F-M1 gesture,
 *         member retains vector, no twin
 *   S2-7  contextmenu gated identically
 *   S2-8  legacy: vector-less event still claims Click (undefined=qualified)
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import { qualifyClick, type ClickQualificationFacts } from '../../src/tap/click-qualification';
import type { ObservedEvent, DomContext } from '../../src/shared/component-types';

// ── Vector factories ───────────────────────────────────────────────────

function invalidFacts(over: Partial<ClickQualificationFacts> = {}): ClickQualificationFacts {
  return {
    disabledNative: true,
    disabledAttrNonNative: false,
    fieldsetDisabled: false,
    ariaDisabled: false,
    inertSubtree: false,
    pointerEventsNone: false,
    zeroSizeLifted: false,
    hitTest: { checked: false, miss: null },
    hitTarget: { kind: 'element', rawTag: 'BUTTON', lifted: false, liftStrategy: 'raw', rawInteractiveShaped: true },
    ...over,
  };
}

function qualifiedFacts(over: Partial<ClickQualificationFacts> = {}): ClickQualificationFacts {
  return {
    ...invalidFacts(),
    disabledNative: false,
    hitTest: { checked: false, miss: null },
    hitTarget: { kind: 'element', rawTag: 'DIV', lifted: false, liftStrategy: 'raw', rawInteractiveShaped: false },
    ...over,
  };
}

function withQual(
  eventId: string,
  eventType: 'click' | 'contextmenu',
  target: Record<string, unknown>,
  qual: ReturnType<typeof qualifyClick> | undefined,
  domOver: Partial<DomContext> = {},
  captureSeq = 1,
): ObservedEvent {
  const dom: DomContext = {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    tabIndex: null,
    ...domOver,
  } as DomContext;
  if (qual) dom.clickQualification = qual;
  return makeObservedEvent({
    eventId,
    eventType,
    target: target as any,
    domContext: dom,
    captureSeq,
  } as any);
}

function setup() {
  const emitted: any[] = [];
  const ledger = new EvidenceLedger();
  const runtime = createRuntime(ALL_DEFINITIONS, {
    onEmit: (i) => emitted.push(i),
    evidenceLedger: ledger,
  });
  return {
    runtime, emitted, ledger,
    // Mirrors sw-integration.processObservedEvent: ledger append happens
    // BEFORE runtime.process (capture guarantee).
    feed(ev: ObservedEvent) { ledger.append(ev); return runtime.process(ev); },
  };
}

describe('Step 2 wiring — universal pre-gate (§8.1) + claim rule (§8.5)', () => {
  it('S2-1 R-1: provably-invalid disabled button[aria-expanded] is claimed by NO definition (never Expander)', () => {
    const { emitted, feed } = setup();
    const ev = withQual('evt-s2-1', 'click',
      { tag: 'BUTTON', ariaRole: null, accessibleName: 'Open', ariaExpanded: null, stableId: 'xbtn' },
      qualifyClick(invalidFacts()),
      { ariaExpanded: 'false' } as any);
    feed(ev);
    expect(emitted.length).toBe(0); // no Expander, no Click, nothing
  });

  it('S2-2 R-1: invalid click stays pending → projected Unclassified with invalidityCauses', () => {
    const { emitted, ledger, feed } = setup();
    const ev = withQual('evt-s2-2', 'click',
      { tag: 'DIV', accessibleName: 'dead control', ariaRole: 'button' },
      qualifyClick(invalidFacts({ disabledNative: false, ariaDisabled: true })));
    feed(ev);
    expect(emitted.length).toBe(0);
    expect(ledger.get('evt-s2-2')?.disposition).toBe('pending');
    const { interactions } = projectInteractions(ledger, []);
    const card = interactions.find((i) => i.type === 'Unclassified');
    expect(card).toBeTruthy();
    expect(card!.metadata.invalidityCauses).toEqual(['aria-disabled']);
  });

  it('S2-3 flip: qualified plain-div click claims Click (gate authority deleted)', () => {
    const { emitted, feed } = setup();
    const ev = withQual('evt-s2-3', 'click',
      { tag: 'DIV', accessibleName: 'plain responder' },
      qualifyClick(qualifiedFacts()));
    feed(ev);
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
  });

  it('S2-4 flip: qualified BODY canvas click claims Click + insufficient rides (B3 S4 preserved)', () => {
    const { emitted, feed } = setup();
    const ev = withQual('evt-s2-4', 'click',
      { tag: 'BODY', accessibleName: '' },
      qualifyClick(qualifiedFacts({
        hitTarget: { kind: 'canvas', rawTag: 'BODY', lifted: false, liftStrategy: 'raw', rawInteractiveShaped: false },
      })));
    feed(ev);
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
  });

  it('S2-5 side effect: invalid click still completes an in-flight Hover (physical gesture)', () => {
    const { emitted, ledger, feed } = setup();
    // Open a gated hover lifecycle first: mouseenter on an interactive div
    // (passes isGatedDiscoveryEnter via tabIndex>=0 + role).
    const enter = makeObservedEvent({
      eventId: 'evt-s2-5a', eventType: 'mouseenter',
      target: { tag: 'DIV', ariaRole: 'button', accessibleName: 'Menu' } as any,
      domContext: { ancestorRoles: [], ancestorClasses: [], tabIndex: 0 } as any,
      isTrusted: true,
    });
    feed(enter);
    expect(emitted.length).toBe(0); // parked, not completed
    // The completing click is PROVABLY INVALID (disabled native button).
    const click = withQual('evt-s2-5b', 'click',
      { tag: 'BUTTON', accessibleName: 'Menu', stableId: 'menu-btn' },
      qualifyClick(invalidFacts()));
    feed(click);
    // Hover completes (terminal consumed-by-click), the click itself is
    // claimed by nothing: no twin Click, entry pending.
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeTruthy();
    expect(hover!.endState).toBe('completed');
    const twin = emitted.find((i) => i.type === 'Click');
    expect(twin).toBeUndefined();
    expect(ledger.get('evt-s2-5b')?.disposition).toBe('pending');
  });

  it('S2-6 side effect: invalid trailing click absorbed by 6F-M1 gesture, no Unclassified twin', () => {
    const emitted: any[] = [];
    const ledger = new EvidenceLedger();
    // Same def shape as gesture-ownership-6f-m1: focus-triggered lifecycle
    // completing on mousedown (DatePicker cell shape).
    const dpDef = {
      type: 'DatePicker', priority: 60,
      triggerEventTypes: new Set(['focus']),
      detectTrigger(event: any) { return event.eventType === 'focus' ? { type: 'DatePicker' } : null; },
      isInScope(event: any, ctx: any) {
        return event.target.className?.includes('react-datepicker__day')
          || event.target.stableId === ctx.trigger.stableId;
      },
      handleEvent(event: any) { return event.eventType === 'mousedown' ? { endState: 'completed' as const } : null; },
      shouldCancelOnOutside() { return false; },
      buildResult(ctx: any) { return { metadata: { targetName: ctx.trigger.accessibleName } }; },
    } as any;
    const runtime = createRuntime([dpDef, ...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });
    const feed = (ev: ObservedEvent) => { ledger.append(ev); return runtime.process(ev); };
    const target = { tag: 'DIV', className: 'react-datepicker__day', ariaRole: 'option', accessibleName: 'Sun', stableId: 'cell-1' };
    const focus = makeObservedEvent({
      eventId: 'evt-s2-6a', eventType: 'focus', target: target as any,
      domContext: { ancestorRoles: [], ancestorClasses: [] } as any,
    });
    const mousedown = makeObservedEvent({
      eventId: 'evt-s2-6b', eventType: 'mousedown', target: target as any,
      domContext: { ancestorRoles: [], ancestorClasses: [] } as any,
      captureSeq: 2,
    });
    feed(focus);
    feed(mousedown);
    expect(emitted.some((i) => i.endState === 'completed')).toBe(true);
    // The trailing click is provably INVALID — still absorbed (physical
    // gesture), still claimed-by-nothing for typing.
    const click = withQual('evt-s2-6c', 'click', target as any, qualifyClick(invalidFacts({ disabledNative: false, ariaDisabled: true })), {}, 3);
    feed(click);
    const twin = emitted.find((i) => i.type === 'Click' && i.triggerEvent.eventId === 'evt-s2-6c');
    expect(twin).toBeUndefined();
    const { interactions } = projectInteractions(ledger, []);
    const uncl = interactions.find((i) => i.type === 'Unclassified' && i.triggerEvent.eventId === 'evt-s2-6c');
    expect(uncl).toBeUndefined(); // absorbed → claimed, not projected
    expect(ledger.get('evt-s2-6c')?.disposition).toBe('claimed');
  });

  it('S2-7 contextmenu gated identically (invalid right-click → no Click; qualified)', () => {
    const { emitted, ledger, feed } = setup();
    const bad = withQual('evt-s2-7a', 'contextmenu',
      { tag: 'DIV', ariaRole: 'button', accessibleName: 'ctx' },
      qualifyClick(invalidFacts({ disabledNative: false, ariaDisabled: true })));
    feed(bad);
    expect(emitted.length).toBe(0);
    expect(ledger.get('evt-s2-7a')?.disposition).toBe('pending');

    const good = withQual('evt-s2-7b', 'contextmenu',
      { tag: 'DIV', ariaRole: 'button', accessibleName: 'ctx' },
      qualifyClick(qualifiedFacts({ hitTarget: { kind: 'element', rawTag: 'DIV', lifted: false, liftStrategy: 'raw', rawInteractiveShaped: true } })));
    feed(good);
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
  });

  it('S2-8 legacy: vector-less event still claims Click (undefined = qualified = not gated)', () => {
    const { emitted, feed } = setup();
    const ev = withQual('evt-s2-8', 'click',
      { tag: 'DIV', accessibleName: 'legacy plain div', className: null },
      undefined);
    feed(ev);
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
  });
});
