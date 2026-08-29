/**
 * Phase 7.4-B6 — TextEntry Enter-Submit Commit (unit: definition + patterns)
 *
 * Spec: .drytis/specs/phase-7-4-b6-enter-submit-commit.md
 *
 * Doctrine (user directive): Enter keydown alone is NEVER a completion
 * trigger. Completion is grounded in the trusted native `submit` DOM event
 * on the form that owns the input — the application's own commit signal.
 *
 * TDD: written before implementation. Red until text-entry.ts + patterns.ts
 * implement submit-completion, the same-form click exemption, and commit
 * metadata. No product code here.
 */

import { describe, it, expect } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { formJoinKey } from '../../src/definitions/patterns';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';

// ── Helpers (mirror tests/definitions/text-entry-6c.test.ts) ──

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
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
    ...overrides,
  };
}

function makeContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
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
    eventType: eventType as never,
    target: makeTarget(target),
    domContext: makeContext(domContext),
    ...eventOverrides,
  });
}

function setupRuntime() {
  const emitted: ComponentInteraction[] = [];
  const ledger = new EvidenceLedger();
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i), evidenceLedger: ledger };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted, ledger };
}

function processSeq(
  runtime: ComponentRuntime,
  ledger: EvidenceLedger,
  event: ObservedEvent,
): void {
  ledger.append(event);
  runtime.process(event);
}

// The search input inside form#search-form.
const Q_INPUT: Partial<ElementIdentity> = {
  tag: 'INPUT',
  ariaRole: 'textbox',
  stableId: 'q',
  accessibleName: 'Search products',
  inputType: 'text',
  cssSelector: '#q',
};

// The default submit button of the same form.
const GO_BTN: Partial<ElementIdentity> = {
  tag: 'BUTTON',
  ariaRole: 'button',
  stableId: 'go',
  accessibleName: 'Search',
  inputType: 'submit',
  cssSelector: '#go',
};

// The form itself — target of the native submit event.
const FORM: Partial<ElementIdentity> = {
  tag: 'FORM',
  ariaRole: null,
  stableId: 'search-form',
  accessibleName: '',
  cssSelector: '#search-form',
};

const FORM_KEY = 'id:search-form';
const Q_CTX = { inputType: 'text', formElementKey: FORM_KEY };
const GO_CTX = { inputType: 'submit', formElementKey: FORM_KEY };
const FORM_CTX = { formElementKey: FORM_KEY };
const OTHER_FORM_CTX = { formElementKey: 'id:other-form' };

// ── AC1: formJoinKey ──────────────────────────────────────────────────

describe('formJoinKey (7.4-B6)', () => {
  it('AC1: prefixes domContext.formElementKey; null when absent/empty (legacy)', () => {
    expect(formJoinKey(makeTarget(Q_INPUT), makeContext({ formElementKey: FORM_KEY }))).toBe(
      `form:${FORM_KEY}`,
    );
    // Absent (legacy events)
    expect(formJoinKey(makeTarget(Q_INPUT), makeContext())).toBeNull();
    // Empty string — honest absence
    expect(formJoinKey(makeTarget(Q_INPUT), makeContext({ formElementKey: '' }))).toBeNull();
  });
});

// ── AC3/AC4/AC5/AC6: submit completion + click exemption ─────────────

describe('TextEntry — submit-commit completion (7.4-B6)', () => {
  it('AC3: type → Enter keydown → same-form submit → completed with commit metadata; keydowns claimed', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-p1-1', 'focus', Q_INPUT, Q_CTX));
    processSeq(runtime, ledger, makeEvent('evt-p1-2', 'input', Q_INPUT, Q_CTX, { valueAfter: 'wireless earbuds' }));
    // Enter keydown — the CAUSE, never the completion trigger
    processSeq(runtime, ledger, makeEvent('evt-p1-3', 'keydown', Q_INPUT, Q_CTX, { key: 'Enter' }));
    // Native submit on the owner form — the COMMIT
    processSeq(runtime, ledger, makeEvent('evt-p1-4', 'submit', FORM, FORM_CTX));

    expect(emitted).toHaveLength(1);
    const te = emitted[0];
    expect(te.type).toBe('TextEntry');
    expect(te.endState).toBe('completed');
    expect(te.metadata['committedValue']).toBe('wireless earbuds');
    expect(te.metadata['commitSignal']).toBe('submit');
    expect(te.metadata['formJoinKey']).toBe(`form:${FORM_KEY}`);
    expect(te.metadata['textValue']).toBe('wireless earbuds');
    expect(te.metadata['typedValue']).toBe('wireless earbuds');
    expect(te.metadata['userTyped']).toBe(true);
    // enterCause: the last keydown before completion was Enter on the trigger
    expect(te.metadata['enterCause']).toBe(true);

    // Ledger: the keydown was claimed by the completed interaction
    const kd = ledger.getEntries().find((e) => e.eventId === 'evt-p1-3');
    expect(kd?.disposition).toBe('claimed');
    expect(kd?.claimType).toBe('TextEntry');
  });

  it('AC3b: mouse-submit (type → click Go → submit) also completes with commitSignal submit, enterCause absent', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-p2-1', 'focus', Q_INPUT, Q_CTX));
    processSeq(runtime, ledger, makeEvent('evt-p2-2', 'input', Q_INPUT, Q_CTX, { valueAfter: 'laptop stand' }));
    // Real user click on the submit control of the same form
    processSeq(runtime, ledger, makeEvent('evt-p2-3', 'click', GO_BTN, GO_CTX));
    processSeq(runtime, ledger, makeEvent('evt-p2-4', 'submit', FORM, FORM_CTX));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    const te = tes[0];
    expect(te.endState).toBe('completed');
    expect(te.metadata['committedValue']).toBe('laptop stand');
    expect(te.metadata['commitSignal']).toBe('submit');
    // No Enter involved — enterCause must NOT be fabricated
    expect(te.metadata['enterCause']).toBeUndefined();
    // The click became its own Click interaction (submit control, real action)
    const clicks = emitted.filter((i) => i.type === 'Click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0].metadata['targetName']).toBe('Search');
  });

  it('AC4: submit on a DIFFERENT form does not complete the lifecycle (blur still can)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-p3-1', 'focus', Q_INPUT, Q_CTX));
    processSeq(runtime, ledger, makeEvent('evt-p3-2', 'input', Q_INPUT, Q_CTX, { valueAfter: 'x' }));
    // Submit belongs to another form (nested-page edge case)
    processSeq(runtime, ledger, makeEvent('evt-p3-3', 'submit', FORM, OTHER_FORM_CTX));

    // The foreign submit completed nothing
    expect(emitted.filter((i) => i.type === 'TextEntry')).toHaveLength(0);

    // Follow with a blur to prove the lifecycle was NOT completed by the foreign submit
    processSeq(runtime, ledger, makeEvent('evt-p3-4', 'blur', Q_INPUT, Q_CTX, { valueAfter: 'x' }));
    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    expect(tes[0].endState).toBe('completed');
    expect(tes[0].metadata['commitSignal']).toBeUndefined();
  });

  it('AC5: same-form submit-control click does NOT cancel active TextEntry', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-p5-1', 'focus', Q_INPUT, Q_CTX));
    processSeq(runtime, ledger, makeEvent('evt-p5-2', 'input', Q_INPUT, Q_CTX, { valueAfter: 'desk lamp' }));
    // The browser's synthetic implicit-submission click on the default submit button
    processSeq(runtime, ledger, makeEvent('evt-p5-3', 'click', GO_BTN, GO_CTX));
    // Still active → completed by the following submit
    processSeq(runtime, ledger, makeEvent('evt-p5-4', 'submit', FORM, FORM_CTX));

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te).toBeDefined();
    expect(te?.endState).toBe('completed');
    expect(te?.metadata['committedValue']).toBe('desk lamp');

    // The click itself is its own Click interaction (it is a real action)
    const click = emitted.find((i) => i.type === 'Click');
    expect(click).toBeDefined();
  });

  it('AC5b: outside click on a DIFFERENT form (or no form) still cancels — regression guard', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-p6-1', 'focus', Q_INPUT, Q_CTX));
    processSeq(runtime, ledger, makeEvent('evt-p6-2', 'input', Q_INPUT, Q_CTX, { valueAfter: 'chair' }));
    // Click on a button outside the form — pre-B6 this cancelled; B6 keeps that
    processSeq(
      runtime,
      ledger,
      makeEvent('evt-p6-3', 'click', { ...GO_BTN, stableId: 'other-btn', cssSelector: '#other-btn' }, { inputType: 'submit', formElementKey: 'id:other-form' }),
    );

    // Cancelled (abandoned) — NOT completed
    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te).toBeDefined();
    expect(te?.endState).toBe('abandoned');
  });

  it('AC6: enterCause false when last keydown before submit was not Enter', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-p7-1', 'focus', Q_INPUT, Q_CTX));
    processSeq(runtime, ledger, makeEvent('evt-p7-2', 'input', Q_INPUT, Q_CTX, { valueAfter: 'zz' }));
    // Some non-Enter key typed last (e.g. 'z')
    processSeq(runtime, ledger, makeEvent('evt-p7-3', 'keydown', Q_INPUT, Q_CTX, { key: 'z' }));
    processSeq(runtime, ledger, makeEvent('evt-p7-4', 'submit', FORM, FORM_CTX));

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te).toBeDefined();
    expect(te?.metadata['commitSignal']).toBe('submit');
    expect(te?.metadata['enterCause']).toBeFalsy();
  });

  it('AC10: legacy no-form flow (type → blur) unchanged — no commit fields fabricated', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-p8-1', 'focus', Q_INPUT, { inputType: 'text' }));
    processSeq(runtime, ledger, makeEvent('evt-p8-2', 'input', Q_INPUT, { inputType: 'text' }, { valueAfter: 'plain blur' }));
    processSeq(runtime, ledger, makeEvent('evt-p8-3', 'blur', Q_INPUT, { inputType: 'text' }, { valueAfter: 'plain blur' }));

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te).toBeDefined();
    expect(te?.endState).toBe('completed');
    expect(te?.metadata['textValue']).toBe('plain blur');
    expect(te?.metadata['commitSignal']).toBeUndefined();
    expect(te?.metadata['committedValue']).toBeUndefined();
    expect(te?.metadata['formJoinKey']).toBeUndefined();
  });
});
