/**
 * Phase 7.4-B6 — IR bridge: FILL-before-submit-CLICK ordering (unit)
 *
 * Spec: .drytis/specs/phase-7-4-b6-enter-submit-commit.md §4.5
 *
 * A submit-completed TextEntry is emitted AFTER the synthetic (or real)
 * submit-control click. IR must restore chronological replay order:
 * FILL the field BEFORE clicking the submit control, else replay breaks
 * (fill after navigation is a no-op).
 *
 * TDD: written before implementation. Red until ir-bridge.ts implements
 * the order-restore pass. No product code here.
 */

import { describe, it, expect } from 'vitest';
import { build } from '../../src/generation/ir-bridge';
import type { ComponentInteraction, ObservedEvent, ElementIdentity } from '../../src/shared/component-types';

// ── Factories (shape per tests/generation/ir-bridge-noise-drop-7-4-b4.test.ts) ──

function makeIdentity(over: Partial<ElementIdentity>): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: '',
    ...over,
  } as ElementIdentity;
}

function makeObserved(over: Partial<ObservedEvent> & { eventId: string; eventType: string }): ObservedEvent {
  return {
    timestamp: 1,
    captureSeq: 1,
    isTrusted: true,
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
      tabIndex: null,
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.test/',
    pageTitle: 'Test',
    target: makeIdentity({}),
    ...over,
  } as unknown as ObservedEvent;
}

function makeTextEntry(id: string, eventId: string, opts: {
  value: string;
  formKey?: string | null;
  commitSignal?: string | null;
  elementId?: string;
}): ComponentInteraction {
  const identity = makeIdentity({
    tag: 'INPUT',
    stableId: 'q',
    accessibleName: 'Search products',
    cssSelector: '#q',
    xPath: '/html/body/form/input',
    elementId: opts.elementId ?? 'elem-q',
  });
  const md: Record<string, unknown> = {
    targetName: 'Search products',
    textValue: opts.value,
    typedValue: opts.value,
    userTyped: true,
  };
  // Production shape: the form join lives on the trigger event's domContext
  // (captured at focus time); metadata mirrors it for consumers.
  const dcExtra: Record<string, unknown> = {};
  if (opts.formKey != null) {
    const raw = opts.formKey.replace(/^form:/, '');
    dcExtra['formElementKey'] = raw;
    md['formJoinKey'] = opts.formKey;
  }
  if (opts.commitSignal) md['commitSignal'] = opts.commitSignal;
  return {
    interactionId: id,
    type: 'TextEntry',
    trigger: identity,
    triggerEvent: makeObserved({
      eventId,
      eventType: 'focus',
      target: identity,
      domContext: dcExtra as never,
    }),
    memberEvents: [],
    startTime: 1,
    endTime: 40,
    endState: 'completed',
    metadata: md,
  } as unknown as ComponentInteraction;
}

function makeClick(id: string, eventId: string, opts: {
  name?: string;
  formKey?: string | null;
  inputType?: string | null;
  elementId?: string;
  submitControl?: boolean;
}): ComponentInteraction {
  const identity = makeIdentity({
    tag: 'BUTTON',
    stableId: 'go',
    accessibleName: opts.name ?? 'Search',
    cssSelector: '#go',
    xPath: '/html/body/form/button',
    elementId: opts.elementId ?? 'elem-go',
    inputType: opts.inputType === undefined ? 'submit' : opts.inputType,
  });
  const md: Record<string, unknown> = {
    targetName: opts.name ?? 'Search',
    targetTag: 'BUTTON',
  };
  // The bridge derives the form join from the trigger EVENT's domContext
  // (as real capture produces) — metadata is TextEntry-only in production.
  const dcExtra: Record<string, unknown> = {
    isFormSubmitControl: opts.submitControl ?? true,
  };
  if (opts.formKey != null) dcExtra['formElementKey'] = opts.formKey.replace(/^form:/, '');
  return {
    interactionId: id,
    type: 'Click',
    trigger: identity,
    triggerEvent: makeObserved({
      eventId,
      eventType: 'click',
      target: identity,
      domContext: dcExtra as never,
    }),
    memberEvents: [],
    startTime: 2,
    endTime: 3,
    endState: 'completed',
    metadata: md,
  } as unknown as ComponentInteraction;
}

function makeNav(id: string, eventId: string, url: string): ComponentInteraction {
  return {
    interactionId: id,
    type: 'Navigation',
    trigger: makeIdentity({ tag: 'HTML' }),
    triggerEvent: makeObserved({ eventId, eventType: 'navigation', target: makeIdentity({ tag: 'HTML' }) }),
    memberEvents: [],
    startTime: 50,
    endTime: 51,
    endState: 'completed',
    metadata: { pageUrl: url },
  } as unknown as ComponentInteraction;
}

const FORM = 'form:id:search-form';

// ── AC8: order restore ────────────────────────────────────────────────

describe('IR bridge — submit-commit FILL ordering (7.4-B6)', () => {
  it('AC8: FILL moved before same-form submit CLICK; fill value = typedValue', () => {
    // Emission order after B6: Click(Go) → TextEntry(q) → Navigation
    const interactions = [
      makeClick('int-3', 'evt-a-42', { formKey: FORM, inputType: 'submit' }),
      makeTextEntry('int-2', 'evt-a-7', { value: 'wireless earbuds', formKey: FORM, commitSignal: 'submit' }),
      makeNav('int-4', 'nav-a-1', 'https://example.test/search?q=wireless+earbuds'),
    ];

    const plan = build({
      interactions,
      recordingContext: {
        startUrl: 'https://example.test/',
        title: 'Search',
      },
      testCaseName: 'b6-order',
    });

    const actions = plan.steps.map((s) => s.action);
    expect(actions).toEqual(['fill', 'click', 'navigate']);

    const fill = plan.steps[0];
    expect(fill.action).toBe('fill');
    expect(fill.input).toBe('wireless earbuds');
    expect(fill.sourceEventId).toBe('evt-a-7');
    expect(plan.steps[1].sourceEventId).toBe('evt-a-42');
    expect(plan.steps[2].sourceEventId).toBe('nav-a-1');
  });

  it('AC8b: FILL keeps position when no submit CLICK follows (programmatic submit)', () => {
    const interactions = [
      makeTextEntry('int-1', 'evt-b-1', { value: 'solo', formKey: FORM, commitSignal: 'submit' }),
      makeNav('int-2', 'nav-b-1', 'https://example.test/next'),
    ];

    const plan = build({
      interactions,
      recordingContext: { startUrl: 'https://example.test/', title: 'S' },
      testCaseName: 'b6-solo',
    });

    expect(plan.steps.map((s) => s.action)).toEqual(['fill', 'navigate']);
    expect(plan.steps[0].input).toBe('solo');
  });

  it('AC8c: same-form CLICK that is NOT a submit control does not steal the FILL reorder', () => {
    // A same-form click on a regular button (inputType null, not submit): keep emitted order
    const interactions = [
      makeClick('int-1', 'evt-c-1', { formKey: FORM, inputType: null, name: 'Clear', submitControl: false }),
      makeTextEntry('int-2', 'evt-c-2', { value: 'x', formKey: FORM, commitSignal: 'submit' }),
    ];

    const plan = build({
      interactions,
      recordingContext: { startUrl: 'https://example.test/', title: 'S' },
      testCaseName: 'b6-nonsubmit',
    });

    // Click(Clear) is not a submit control → FILL stays after it
    expect(plan.steps.map((s) => s.action)).toEqual(['click', 'fill']);
  });

  it('AC8d: FILL of a form-joined input submitted by a LATER separate form click — mouse-submit shape', () => {
    // type → click Go (real user click, same form) → submit completes TextEntry AFTER the click
    const interactions = [
      makeClick('int-3', 'evt-d-3', { formKey: FORM, inputType: 'submit' }),
      makeTextEntry('int-2', 'evt-d-2', { value: 'laptop stand', formKey: FORM, commitSignal: 'submit' }),
    ];

    const plan = build({
      interactions,
      recordingContext: { startUrl: 'https://example.test/', title: 'S' },
      testCaseName: 'b6-mouse',
    });

    expect(plan.steps.map((s) => s.action)).toEqual(['fill', 'click']);
    expect(plan.steps[0].input).toBe('laptop stand');
  });

  it('AC8e: regression — classic blur-completed TextEntry (no form key) keeps click-then-fill when click preceded', () => {
    // Pre-B6 shape: user clicks a tab, then types and blurs. Fill after click is CORRECT here
    // (the field lives on the page the click opened).
    const interactions = [
      makeClick('int-1', 'evt-e-1', { inputType: null, name: 'Open' }),
      makeTextEntry('int-2', 'evt-e-2', { value: 'plain' }),
    ];

    const plan = build({
      interactions,
      recordingContext: { startUrl: 'https://example.test/', title: 'S' },
      testCaseName: 'b6-regress',
    });

    expect(plan.steps.map((s) => s.action)).toEqual(['click', 'fill']);
  });
});
