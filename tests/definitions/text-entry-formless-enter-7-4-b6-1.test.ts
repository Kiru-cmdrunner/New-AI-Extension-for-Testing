/**
 * Phase 7.4-B6.1 — Form-less SPA Enter Commit (unit: definition)
 *
 * Spec: .drytis/specs/phase-7-4-b6-1-formless-spa-enter-commit.md
 *
 * Tier N: a live form-less TextEntry whose terminal member keydown is Enter
 * (nothing on the trigger element after it) completes when a same-document
 * navigation event arrives — the application's own commit proof. The Enter
 * keydown alone NEVER completes anything (directive).
 *
 * TDD: written before implementation. Red until component-types.ts gains
 * shouldCompleteOnNavigation? and text-entry.ts implements the hook +
 * enterEventId recording. No product code here.
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

// ── Helpers (mirror tests/definitions/text-entry-enter-submit-7-4-b6.test.ts) ──

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

// A form-less search input (no formElementKey — honest no-form).
const SEARCH_INPUT: Partial<ElementIdentity> = {
  tag: 'INPUT',
  ariaRole: 'textbox',
  stableId: 'q',
  accessibleName: 'Search',
  inputType: 'text',
  cssSelector: '#q',
};

// The search input INSIDE a form (B6 territory — must never complete via nav hook).
const FORM_Q: Partial<ElementIdentity> = { ...SEARCH_INPUT, stableId: 'form-q', cssSelector: '#form-q' };
const FORM_Q_CTX = { inputType: 'text', formElementKey: 'id:search-form' };

// navigation event target = document body.
const NAV_TARGET: Partial<ElementIdentity> = {
  tag: 'BODY',
  accessibleName: 'https://app.test/search?q=earbuds',
  ariaRole: 'document',
};

function navEvent(eventId: string, url: string): ObservedEvent {
  return makeEvent(eventId, 'navigation', {
    ...NAV_TARGET,
    accessibleName: url,
    ariaLabel: `Navigation to ${url}`,
    href: url,
  }, {}, { pageUrl: url, navType: 'pushState' });
}

/** P5: full-page pull-navs (webNavigation.onCommitted) carry NO navType. */
function fullPageNavEvent(eventId: string, url: string): ObservedEvent {
  return makeEvent(eventId, 'navigation', {
    ...NAV_TARGET,
    accessibleName: url,
    ariaLabel: `Navigation to ${url}`,
    href: url,
  }, {}, { pageUrl: url });
}

// ── AC1: P1–P4 truth table via the navigation hook ────────────────────

describe('TextEntry — formless navigation-commit hook (7.4-B6.1 tier N)', () => {
  it('AC1a: P1–P4 satisfied → navigation event completes as committed (commitSignal navigation)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pN-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pN-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'wireless earbuds' }));
    processSeq(runtime, ledger, makeEvent('evt-pN-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    processSeq(runtime, ledger, navEvent('evt-pN-4', 'https://app.test/search?q=wireless+earbuds'));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    const te = tes[0];
    expect(te.endState).toBe('completed');
    expect(te.metadata['commitSignal']).toBe('navigation');
    expect(te.metadata['committedValue']).toBe('wireless earbuds');
    expect(te.metadata['typedValue']).toBe('wireless earbuds');
    expect(te.metadata['userTyped']).toBe(true);
    expect(te.metadata['enterCause']).toBe(true);

    // Enter keydown claimed (no Unclassified twin can be minted for it)
    const kd = ledger.getEntries().find((e) => e.eventId === 'evt-pN-3');
    expect(kd?.disposition).toBe('claimed');
    expect(kd?.claimType).toBe('TextEntry');
  });

  it('AC1b: P1 violated (input HAS an owner form) → hook never fires; lifecycle interrupts (B6 preserved)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pF-1', 'focus', FORM_Q, FORM_Q_CTX));
    processSeq(runtime, ledger, makeEvent('evt-pF-2', 'input', FORM_Q, FORM_Q_CTX, { valueAfter: 'laptop' }));
    processSeq(runtime, ledger, makeEvent('evt-pF-3', 'keydown', FORM_Q, FORM_Q_CTX, { key: 'Enter' }));
    processSeq(runtime, ledger, navEvent('evt-pF-4', 'https://app.test/search?q=laptop'));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    // B6 owns this lifecycle: nav must NOT complete it. The nav-flush
    // interrupted it (STOP-equivalent semantics — B6 completion would need
    // the native submit event, absent here by design).
    expect(tes[0].endState).toBe('interrupted');
    expect(tes[0].metadata['commitSignal']).toBeUndefined();
  });

  it('AC1c: P2 violated (no typing) → no completion via nav', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pU-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pU-2', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    processSeq(runtime, ledger, navEvent('evt-pU-3', 'https://app.test/'));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    expect(tes[0].endState).toBe('interrupted');
    expect(tes[0].metadata['commitSignal']).toBeUndefined();
  });

  it('AC1d: P3 violated (last keydown NOT Enter) → no completion via nav', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pK-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pK-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'x' }));
    processSeq(runtime, ledger, makeEvent('evt-pK-3', 'keydown', SEARCH_INPUT, {}, { key: 'a' }));
    processSeq(runtime, ledger, navEvent('evt-pK-4', 'https://app.test/'));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    expect(tes[0].endState).toBe('interrupted');
  });

  it('AC1e: P4 violated (typing continues after Enter) → no completion via nav', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pP-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pP-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'ear' }));
    processSeq(runtime, ledger, makeEvent('evt-pP-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    // typing continues AFTER the Enter — the Enter was not terminal
    processSeq(runtime, ledger, makeEvent('evt-pP-4', 'input', SEARCH_INPUT, {}, { valueAfter: 'earbuds' }));
    processSeq(runtime, ledger, navEvent('evt-pP-5', 'https://app.test/search?q=earbuds'));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    expect(tes[0].endState).toBe('interrupted');
    expect(tes[0].metadata['commitSignal']).toBeUndefined();
  });

  it('AC1e2 (real-Chrome regression): browser-implicit change AFTER Enter does NOT break P4 — tier N completes', () => {
    // Verified live (Chrome 148, formless-search E2E): pressing Enter on a
    // form-less text input fires a trusted `change` on the SAME element
    // BETWEEN the Enter keydown and the pushState navigation — the browser's
    // implicit control-commit. It carries the same committed value, never
    // new typing (typing always emits keydown+input first). P4 must exempt
    // it; without the exemption the real-browser stream never completes.
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pC-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pC-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'wireless earbuds' }));
    processSeq(runtime, ledger, makeEvent('evt-pC-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    // Browser-implicit change (Enter-driven control commit) — SAME element
    processSeq(runtime, ledger, makeEvent('evt-pC-4', 'change', SEARCH_INPUT, {}, { valueAfter: 'wireless earbuds' }));
    processSeq(runtime, ledger, navEvent('evt-pC-5', 'https://app.test/search?q=wireless+earbuds'));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    expect(tes[0].endState).toBe('completed');
    expect(tes[0].metadata['commitSignal']).toBe('navigation');
    expect(tes[0].metadata['typedValue']).toBe('wireless earbuds');
  });

  it('AC1f: blur completion of a formless entry is UNCHANGED (no commit metadata, plain completed)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pB-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pB-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'hello' }));
    processSeq(runtime, ledger, makeEvent('evt-pB-3', 'blur', SEARCH_INPUT, {}, { valueAfter: 'hello' }));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    expect(tes[0].endState).toBe('completed');
    expect(tes[0].metadata['commitSignal']).toBeUndefined();
    expect(tes[0].metadata['committedValue']).toBeUndefined();
  });

  it('AC1g: P5 violated (full-page pull-nav, no navType) → hook must NOT fire; lifecycle interrupts (tier C territory)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pV-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pV-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'tv' }));
    processSeq(runtime, ledger, makeEvent('evt-pV-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    processSeq(runtime, ledger, fullPageNavEvent('evt-pV-4', 'https://app.test/search?q=tv'));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    expect(tes).toHaveLength(1);
    expect(tes[0].endState).toBe('interrupted');
    expect(tes[0].metadata['commitSignal']).toBeUndefined();
  });

  it('AC1h: stacked lifecycles — only the field with the LATEST terminal Enter completes (attribution guard)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    const FIELD_A: Partial<ElementIdentity> = { ...SEARCH_INPUT, stableId: 'a', cssSelector: '#a' };
    const FIELD_B: Partial<ElementIdentity> = { ...SEARCH_INPUT, stableId: 'b', cssSelector: '#b' };

    // Field A: type, Enter, tab away (blur completes A — it left the stack)
    processSeq(runtime, ledger, makeEvent('evt-pW-1', 'focus', FIELD_A));
    processSeq(runtime, ledger, makeEvent('evt-pW-2', 'input', FIELD_A, {}, { valueAfter: 'first query' }));
    processSeq(runtime, ledger, makeEvent('evt-pW-3', 'keydown', FIELD_A, {}, { key: 'Enter' }));
    // No app response — A stays live; user tabs to field B (same-frame focus is
    // not a discrete outside click, A remains on the stack in real capture when
    // B's focus creates a second lifecycle).
    processSeq(runtime, ledger, makeEvent('evt-pW-4', 'focus', FIELD_B));
    processSeq(runtime, ledger, makeEvent('evt-pW-5', 'input', FIELD_B, {}, { valueAfter: 'second query' }));
    processSeq(runtime, ledger, makeEvent('evt-pW-6', 'keydown', FIELD_B, {}, { key: 'Enter' }));
    processSeq(runtime, ledger, navEvent('evt-pW-7', 'https://app.test/s?q=second+query'));

    const tes = emitted.filter((i) => i.type === 'TextEntry');
    // Two lifecycles existed; BOTH were flushed by the nav. Only B (the latest
    // terminal Enter) may carry commit semantics.
    const committed = tes.filter((i) => i.metadata['commitSignal'] === 'navigation');
    expect(committed).toHaveLength(1);
    expect(committed[0].trigger.stableId).toBe('b');
    expect(committed[0].metadata['committedValue']).toBe('second query');
    const other = tes.find((i) => i.trigger.stableId === 'a');
    expect(other?.endState).toBe('interrupted');
    expect(other?.metadata['commitSignal']).toBeUndefined();
  });
});

// ── AC2/AC3: enterEventId recording ───────────────────────────────────

describe('TextEntry — enterEventId recording (7.4-B6.1)', () => {
  it('AC2: terminal Enter on the trigger records ctx.data.enterEventId (observable via nav-commit interaction memberEvents)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pE-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pE-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'q1' }));
    processSeq(runtime, ledger, makeEvent('evt-pE-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    processSeq(runtime, ledger, navEvent('evt-pE-4', 'https://app.test/s?q=q1'));

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te).toBeDefined();
    // The Enter event must be a member event (absorbed by the lifecycle)
    expect(te!.memberEvents.some((e) => e.eventId === 'evt-pE-3')).toBe(true);
    // The canonical memberEvents derivation: last trigger-element keydown is Enter
    const lastKd = [...te!.memberEvents]
      .reverse()
      .find((e) => e.eventType === 'keydown' && e.key === 'Enter' && e.target.stableId === 'q');
    expect(lastKd?.eventId).toBe('evt-pE-3');
  });

  it('AC3: non-Enter keydowns and Enter on a foreign element never produce a terminal-Enter derivation', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pG-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pG-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'z' }));
    // Regular character keydown, NOT Enter
    processSeq(runtime, ledger, makeEvent('evt-pG-3', 'keydown', SEARCH_INPUT, {}, { key: 'z' }));
    processSeq(runtime, ledger, navEvent('evt-pG-4', 'https://app.test/'));

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te?.endState).toBe('interrupted');
    const enterKd = te!.memberEvents.find((e) => e.key === 'Enter');
    expect(enterKd).toBeUndefined();
  });
});

// ── AC4: the hook is optional — non-TextEntry definitions unaffected ──

describe('shouldCompleteOnNavigation — optionality (7.4-B6.1)', () => {
  it('AC4: every non-TextEntry definition lacks the hook (type contract is additive)', () => {
    // B7-P2 amendment: Hover also implements the hook (§5.2.2 navigation
    // terminal) — the B6.1-era "TextEntry only" pin is superseded. The
    // invariant that survives: the hook stays OPTIONAL (a definition
    // that never opts in behaves exactly as before).
    for (const def of ALL_DEFINITIONS) {
      if (def.type === 'TextEntry' || def.type === 'Hover') continue;
      expect((def as unknown as Record<string, unknown>).shouldCompleteOnNavigation).toBeUndefined();
    }
    const te = ALL_DEFINITIONS.find((d) => d.type === 'TextEntry');
    expect(typeof (te as unknown as { shouldCompleteOnNavigation?: unknown }).shouldCompleteOnNavigation)
      .toBe('function');
  });
});
