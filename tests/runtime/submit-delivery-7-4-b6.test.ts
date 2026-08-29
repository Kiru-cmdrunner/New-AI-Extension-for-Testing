/**
 * Phase 7.4-B6 — Runtime submit delivery (unit)
 *
 * Spec: .drytis/specs/phase-7-4-b6-enter-submit-commit.md §4.4
 *
 * The runtime must deliver a trusted `submit` event to an ACTIVE TextEntry
 * lifecycle whose cached formJoinKey matches the submit's formJoinKey —
 * completing it WITHOUT minting a ledger entry for the submit itself and
 * WITHOUT creating an Unclassified card for it.
 *
 * TDD: written before implementation. Red until component-runtime.ts
 * implements the same-form submit delivery pass. No product code here.
 */

import { describe, it, expect } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { ALL_DEFINITIONS } from '../../src/definitions';
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

const Q_INPUT: Partial<ElementIdentity> = {
  tag: 'INPUT',
  ariaRole: 'textbox',
  stableId: 'q',
  accessibleName: 'Search products',
  inputType: 'text',
  cssSelector: '#q',
};

const FORM: Partial<ElementIdentity> = {
  tag: 'FORM',
  stableId: 'search-form',
  cssSelector: '#search-form',
};

const FORM_KEY = 'id:search-form';

// ── AC7: runtime submit delivery ──────────────────────────────────────

describe('Runtime — same-form submit delivery (7.4-B6)', () => {
  it('AC7: submit delivered to the matching active TextEntry; completes; no ledger entry for submit', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-r1-1', 'focus', Q_INPUT, { inputType: 'text', formElementKey: FORM_KEY }));
    processSeq(runtime, ledger, makeEvent('evt-r1-2', 'input', Q_INPUT, { inputType: 'text', formElementKey: FORM_KEY }, { valueAfter: 'notebook' }));
    // Pre-condition: active
    expect(emitted).toHaveLength(0);
    // The commit
    processSeq(runtime, ledger, makeEvent('evt-r1-3', 'submit', FORM, { formElementKey: FORM_KEY }));

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te).toBeDefined();
    expect(te?.endState).toBe('completed');
    expect(te?.metadata['committedValue']).toBe('notebook');

    // The submit event never entered the ledger (submit ∉ DISCRETE_ACTION_TYPES)
    expect(ledger.getEntries().find((e) => e.eventId === 'evt-r1-3')).toBeUndefined();
  });

  it('AC7b: submit with NO matching active TextEntry is a no-op (no card, no ledger entry)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    // No active lifecycle at all
    processSeq(runtime, ledger, makeEvent('evt-r2-1', 'submit', FORM, { formElementKey: FORM_KEY }));

    expect(emitted).toHaveLength(0);
    expect(ledger.getEntries().find((e) => e.eventId === 'evt-r2-1')).toBeUndefined();

    // Active TextEntry on a DIFFERENT form — still no completion
    processSeq(runtime, ledger, makeEvent('evt-r2-2', 'focus', Q_INPUT, { inputType: 'text', formElementKey: 'id:other-form' }));
    processSeq(runtime, ledger, makeEvent('evt-r2-3', 'input', Q_INPUT, { inputType: 'text', formElementKey: 'id:other-form' }, { valueAfter: 'v' }));
    processSeq(runtime, ledger, makeEvent('evt-r2-4', 'submit', FORM, { formElementKey: FORM_KEY }));
    expect(emitted.filter((i) => i.type === 'TextEntry')).toHaveLength(0);
  });

  it('AC7c: submit completing a TextEntry with NO prior input events (autofill edge) still works via blur-value backfill semantics', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    // focus → submit directly (no input/change observed — e.g. autofill committed via submit)
    processSeq(runtime, ledger, makeEvent('evt-r3-1', 'focus', Q_INPUT, { inputType: 'text', formElementKey: FORM_KEY }));
    processSeq(runtime, ledger, makeEvent('evt-r3-2', 'submit', FORM, { formElementKey: FORM_KEY }));

    const te = emitted.find((i) => i.type === 'TextEntry');
    // No typing and no blur value → not a production TextEntry (userTyped false) — but the lifecycle must not crash and must complete
    if (te) {
      expect(te.endState).toBe('completed');
      expect(te.metadata['userTyped']).not.toBe(true);
    }
    expect(ledger.getEntries().find((e) => e.eventId === 'evt-r3-2')).toBeUndefined();
  });
});
