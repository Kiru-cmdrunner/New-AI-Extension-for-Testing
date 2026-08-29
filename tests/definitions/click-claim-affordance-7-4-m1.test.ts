/**
 * Phase 7.4-M1 — L3 pins: Click definition affordance claim gate.
 *
 * RE-BASELINED by Click Qualification v1.2 §8.5 (Step 2): the four-gate
 * cascade (isInteractiveElement → LP1 open-surface → 7.3 W-B auto-id →
 * 7.4-M1 affordance) is DELETED as the qualification authority. The
 * definition now claims every qualified click unconditionally; qualification
 * moved to capture time (src/tap/click-qualification.ts + the universal
 * pre-gate in ComponentRuntime.process). The B-series matrix below keeps its
 * historical coverage labels but the assertions now pin the v1.2 claim rule:
 * detectTrigger returns { type: 'Click' } for ANY event, qualified or not —
 * the runtime pre-gate, not detectTrigger, is where invalid clicks are
 * stopped (pinned in tests/runtime/click-qualification-step2-wiring.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { clickDefinition } from '../../src/definitions/click';
import type { ObservedEvent } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

function baseIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: 'result-item anim',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div.result-item',
    xPath: '//div',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: 'elem-0001',
    ...overrides,
  } as ElementIdentity;
}

function eventOf(
  target: ElementIdentity,
  domContextOverrides: Record<string, unknown> = {},
  eventType = 'click',
): ObservedEvent {
  return {
    type: eventType,
    target,
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: [],
      tabIndex: -1,
      ...domContextOverrides,
    },
    clientX: 10,
    clientY: 10,
  } as unknown as ObservedEvent;
}

describe('7.4-M1 B-series — Click affordance claim matrix', () => {
  it('B1: plain DIV with pointerCursor true → claims Click', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity(), { pointerCursor: true }),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B2: plain DIV with clickHandler true → claims Click', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity(), { clickHandler: true }),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B3: plain DIV with NEITHER → claims Click (v1.2 flip — qualification is capture-time)', () => {
    // v1.2: appearance is no longer evidence. A trusted, qualified click on
    // a plain div is a Click; the vector-less event here is definitionally
    // legacy/qualified. The honesty pin MOVED to the capture verdict
    // (tests/tap/click-qualification-verdict.test.ts) and the runtime
    // pre-gate (S2-1/S2-2).
    const trigger = clickDefinition.detectTrigger(eventOf(baseIdentity()));
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B4: pointerCursor EXPLICITLY false → still claims (v1.2 — affordance no longer gates)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity(), { pointerCursor: false, clickHandler: false }),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B5: pointerCursor undefined (pre-7.4 persisted session) → claims (v1.2 — undefined = legacy = qualified)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity(), { pointerCursor: undefined }),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B6: semantic BUTTON with pointerCursor false → still claims (gate 1 wins, byte-identical)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(
        baseIdentity({ tag: 'BUTTON', cssSelector: 'button', ariaRole: null }),
        { pointerCursor: false },
      ),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B7: semantic BUTTON with affordance fields absent → still claims', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ tag: 'BUTTON', cssSelector: 'button' })),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B8: W-B auto-id target with pointerCursor false → still claims (earlier gate)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ autoId: 'select_flight_card' }), { pointerCursor: false }),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B9: LP1 open-surface target with neither affordance field → still claims (earlier gate)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ tag: 'LI', className: 'suggestion' }), {
        ancestorRoles: ['DIV[role=listbox]'],
        ancestorClasses: [],
      }),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B10: affordance-claimed target INSIDE an open surface → equivalent single claim (no double-claim path)', () => {
    // LP1-positive AND affordance-positive: both gates yield {type:'Click'};
    // the observable outcome must be a single plain trigger either way.
    const viaSurface = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ tag: 'LI' }), {
        ancestorRoles: ['DIV[role=listbox]'],
        ancestorClasses: [],
        pointerCursor: true,
      }),
    );
    expect(viaSurface).toEqual({ type: 'Click' });
  });

  it('B11: empty-string className variants → claims Click (v1.2 — no affordance gates)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity({ className: '' })),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('B12: contextmenu on pointer-styled div → claims (Click also triggers on contextmenu)', () => {
    const trigger = clickDefinition.detectTrigger(
      eventOf(baseIdentity(), { pointerCursor: true }, 'contextmenu'),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });
});
