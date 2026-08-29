/**
 * Phase 7.4-B6.1 — IR bridge: form-less Enter commit plans
 *
 * Spec: .drytis/specs/phase-7-4-b6-1-formless-spa-enter-commit.md §4.4, §7 (C-2/C-3)
 *
 * C-3: tier N needs NO reorder code — the hook completes the TextEntry
 * inside the nav flush BEFORE the Navigation definition discovers the nav
 * event, so emission order is already FILL-then-NAVIGATE. This suite PINS
 * that natural order.
 *
 * C-2: tier C (no navigation) emits FILL-only with commitSignal 'network'
 * in metadata — no fabricated commit step.
 */

import { describe, it, expect } from 'vitest';
import { build } from '../../src/generation/ir-bridge';
import { IRAction } from '../../src/domain/execution-ir/types';
import type {
  ComponentInteraction,
  ObservedEvent,
  ElementIdentity,
} from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector: 'div',
    xPath: '/html/body/div', inIframe: false, shadowDom: false, href: null,
    inputType: null, elementId: '', ...overrides,
  };
}

const INPUT: Partial<ElementIdentity> = {
  tag: 'INPUT', ariaRole: 'textbox', stableId: 'q', accessibleName: 'Search',
  inputType: 'text', cssSelector: '#q',
};

function ev(id: string, seq: number, over: Record<string, unknown> = {}): ObservedEvent {
  return makeObservedEvent({
    eventId: id, eventType: 'input' as never, target: makeTarget(INPUT),
    captureSeq: seq, ...over,
  } as never);
}

/** A tier-N (navigation) committed formless TextEntry, as the runtime emits it. */
function navCommittedTextEntry(): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: 'TextEntry',
    trigger: makeTarget(INPUT),
    triggerEvent: ev('evt-1-1', 1, { eventType: 'focus' }),
    memberEvents: [
      ev('evt-1-1', 1, { eventType: 'focus' }),
      ev('evt-1-2', 2, { valueAfter: 'wireless earbuds' }),
      ev('evt-1-3', 3, { eventType: 'keydown', key: 'Enter' }),
    ],
    startTime: 1, endTime: 10,
    endState: 'completed',
    metadata: {
      targetName: 'Search', textValue: 'wireless earbuds',
      typedValue: 'wireless earbuds', userTyped: true,
      commitSignal: 'navigation', committedValue: 'wireless earbuds',
      enterCause: true, navType: 'pushState',
    },
  };
}

function navigationInteraction(): ComponentInteraction {
  return {
    interactionId: 'int-2',
    type: 'Navigation',
    trigger: makeTarget({ tag: 'BODY', ariaRole: 'document' }),
    triggerEvent: makeObservedEvent({
      eventId: 'evt-1-4', eventType: 'navigation' as never,
      target: makeTarget({ tag: 'BODY', ariaRole: 'document' }),
      captureSeq: 4, pageUrl: 'https://app.test/search?q=wireless+earbuds',
    } as never),
    memberEvents: [],
    startTime: 4, endTime: 4,
    endState: 'completed',
    metadata: { pageUrl: 'https://app.test/search?q=wireless+earbuds' },
  };
}

/** A tier-C (network) rescued TextEntry — no Navigation interaction. */
function networkRescuedTextEntry(): ComponentInteraction {
  const te = navCommittedTextEntry();
  return {
    ...te,
    metadata: {
      ...te.metadata,
      commitSignal: 'network',
      corroboration: 'viewConfirmation',
      networkCommitRequestIds: ['r-101'],
      navType: undefined,
    },
  };
}

function plan(interactions: ComponentInteraction[]): ReturnType<typeof build> {
  return build({
    interactions,
    recordingContext: { startUrl: 'https://app.test/', title: 'Search' },
    testCaseName: 'Formless search',
  });
}

describe('IR bridge — formless Enter commits (7.4-B6.1)', () => {
  it('G1 (C-3): tier N plan is FILL then NAVIGATE in natural order — no reorder code involved', () => {
    // Emission order as the runtime produces it: TextEntry completed in the
    // nav flush, Navigation discovered right after.
    const steps = plan([navCommittedTextEntry(), navigationInteraction()]).steps;

    const fillIdx = steps.findIndex((s) => s.action === IRAction.FILL);
    const navIdx = steps.findIndex((s) => s.action === IRAction.NAVIGATE);
    expect(fillIdx).toBeGreaterThanOrEqual(0);
    expect(navIdx).toBeGreaterThan(fillIdx);

    // 6C intent contract: FILL input is the scalar typedValue.
    expect(steps[fillIdx].input).toBe('wireless earbuds');
  });

  it('G2: tier N plan has NO phantom CLICK step (the Enter is a cause, not a click)', () => {
    const steps = plan([navCommittedTextEntry(), navigationInteraction()]).steps;
    expect(steps.filter((s) => s.action === IRAction.CLICK)).toHaveLength(0);
  });

  it('G3 (C-2): tier C plan is FILL-only — no commit step fabricated', () => {
    const steps = plan([networkRescuedTextEntry()]).steps;
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe(IRAction.FILL);
    expect(steps[0].input).toBe('wireless earbuds');
    // G3a: the plan keeps the honest shape — a FILL alone with NO later
    // step claiming to commit it (no click/navigate/keyboard-shortcut).
    expect(steps.filter(
      (s) => s.action === IRAction.CLICK
        || s.action === IRAction.NAVIGATE
        || s.action === IRAction.KEYBOARD_SHORTCUT,
    )).toHaveLength(0);
  });

  it('G4: B6 regression — submit-commit FILL restores BEFORE its submit CLICK (existing pass untouched)', () => {
    // Production shape (mirrors ir-bridge-enter-submit-7-4-b6.test.ts): the
    // form join lives on the TRIGGER EVENT's domContext — captured at event
    // time. The bridge's restoreSubmitFillOrder joins on exactly that
    // (formJoinKey(it.trigger, it.triggerEvent.domContext)), not on metadata.
    const submitIdentity = makeTarget({ tag: 'BUTTON', stableId: 'go', accessibleName: 'Search', inputType: 'submit', cssSelector: '#go' });
    const submitClick: ComponentInteraction = {
      interactionId: 'int-c1',
      type: 'Click',
      trigger: submitIdentity,
      triggerEvent: makeObservedEvent({
        eventId: 'evt-2-1', eventType: 'click' as never,
        target: submitIdentity,
        captureSeq: 10,
        domContext: { formElementKey: 'id:f1', isFormSubmitControl: true } as never,
      } as never),
      memberEvents: [],
      startTime: 10, endTime: 10,
      endState: 'completed',
      metadata: { targetName: 'Search' },
    };
    const submitFill: ComponentInteraction = {
      interactionId: 'int-t1',
      type: 'TextEntry',
      trigger: makeTarget(INPUT),
      triggerEvent: ev('evt-2-2', 2, { eventType: 'focus', domContext: { formElementKey: 'id:f1' } as never }),
      memberEvents: [],
      startTime: 2, endTime: 11,
      endState: 'completed',
      metadata: {
        targetName: 'Search', textValue: 'laptop', typedValue: 'laptop',
        userTyped: true, commitSignal: 'submit', committedValue: 'laptop',
        formJoinKey: 'form:id:f1',
      },
    };

    // Click first (browser order), FILL emitted later at submit — restore must reorder
    const steps = plan([submitClick, submitFill]).steps;
    const fillIdx = steps.findIndex((s) => s.action === IRAction.FILL);
    const clickIdx = steps.findIndex((s) => s.action === IRAction.CLICK);
    expect(clickIdx).toBeGreaterThan(fillIdx); // FILL restored BEFORE the CLICK
    expect(steps[fillIdx].input).toBe('laptop');
  });
});
