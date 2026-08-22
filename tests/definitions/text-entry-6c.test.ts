/**
 * Phase 6C — TextEntry dual-sample semantics (typedValue / textValue)
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md §3
 *
 * Pins:
 *  - typedValue = user intent (input/change sample, LAST wins, NEVER
 *    overwritten by blur).
 *  - textValue = committed application state (blur overwrites when non-empty —
 *    existing semantics preserved).
 *  - buildResult emits BOTH fields; userTyped untouched.
 *  - Autofill recovery (blur-only): typed backfilled := committed, userTyped
 *    forced true (existing Bug-2-style recovery preserved).
 *
 * TDD: written before implementation. Red until text-entry.ts sets
 * typedValue on input/change and buildResult emits it. No product code here.
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

// ── Helpers (mirror tests/definitions/core-definitions.test.ts) ──

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

/**
 * Drives events through ledger + runtime WITHOUT inter-event flushes —
 * the TextEntry lifecycle spans focus→input→blur and must not be
 * interrupted. Mirrors the passing pattern in core-definitions.test.ts.
 */
function processSeq(
  runtime: ComponentRuntime,
  ledger: EvidenceLedger,
  event: ObservedEvent,
): void {
  ledger.append(event);
  runtime.process(event);
}

const ORIGIN: Partial<ElementIdentity> = {
  tag: 'INPUT',
  ariaRole: 'textbox',
  stableId: 'origin',
  accessibleName: 'Origin',
  inputType: 'text',
  cssSelector: '#origin',
};

const TEXT_CTX = { inputType: 'text' };

// ── P5: typed/committed divergence end-to-end (int-28) ────

describe('TextEntry — dual-sample capture (P5)', () => {
  it('int-28: typed "Sat, 22 Aug", committed "Sat, 05 Sep" — BOTH preserved, blur does NOT overwrite typed', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    processSeq(runtime, ledger, makeEvent('e1', 'focus', ORIGIN, TEXT_CTX));
    processSeq(
      runtime,
      ledger,
      makeEvent('e2', 'input', ORIGIN, TEXT_CTX, { valueAfter: 'Sat, 22 Aug' }),
    );
    processSeq(
      runtime,
      ledger,
      makeEvent('e3', 'blur', ORIGIN, TEXT_CTX, { valueAfter: 'Sat, 05 Sep' }),
    );

    expect(emitted.length).toBe(1);
    const md = emitted[0].metadata;
    expect(md.textValue).toBe('Sat, 05 Sep');
    expect(md.typedValue).toBe('Sat, 22 Aug');
    expect(md.userTyped).toBe(true);
  });

  it('typed === committed when blur carries the same value (no rewrite)', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    processSeq(runtime, ledger, makeEvent('e1', 'focus', ORIGIN, TEXT_CTX));
    processSeq(
      runtime,
      ledger,
      makeEvent('e2', 'input', ORIGIN, TEXT_CTX, { valueAfter: 'AMD' }),
    );
    processSeq(
      runtime,
      ledger,
      makeEvent('e3', 'blur', ORIGIN, TEXT_CTX, { valueAfter: 'AMD' }),
    );
    expect(emitted.length).toBe(1);
    const md = emitted[0].metadata;
    expect(md.textValue).toBe('AMD');
    expect(md.typedValue).toBe('AMD');
  });

  it('LAST typed sample wins: multiple input events keep the final keystroke', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    processSeq(runtime, ledger, makeEvent('e1', 'focus', ORIGIN, TEXT_CTX));
    processSeq(runtime, ledger, makeEvent('e2', 'input', ORIGIN, TEXT_CTX, { valueAfter: 'A' }));
    processSeq(runtime, ledger, makeEvent('e3', 'input', ORIGIN, TEXT_CTX, { valueAfter: 'AM' }));
    processSeq(runtime, ledger, makeEvent('e4', 'input', ORIGIN, TEXT_CTX, { valueAfter: 'AMD' }));
    processSeq(
      runtime,
      ledger,
      makeEvent('e5', 'blur', ORIGIN, TEXT_CTX, { valueAfter: 'AMD' }),
    );
    expect(emitted[0].metadata.typedValue).toBe('AMD');
    expect(emitted[0].metadata.textValue).toBe('AMD');
  });

  it('change events also sample typedValue (same lifecycle as input)', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    processSeq(runtime, ledger, makeEvent('e1', 'focus', ORIGIN, TEXT_CTX));
    processSeq(
      runtime,
      ledger,
      makeEvent('e2', 'change', ORIGIN, TEXT_CTX, { valueAfter: 'Sat, 22 Aug' }),
    );
    processSeq(
      runtime,
      ledger,
      makeEvent('e3', 'blur', ORIGIN, TEXT_CTX, { valueAfter: 'Sat, 05 Sep' }),
    );
    expect(emitted[0].metadata.typedValue).toBe('Sat, 22 Aug');
    expect(emitted[0].metadata.textValue).toBe('Sat, 05 Sep');
  });

  it('blur with EMPTY valueAfter does not clobber either sample', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    processSeq(runtime, ledger, makeEvent('e1', 'focus', ORIGIN, TEXT_CTX));
    processSeq(
      runtime,
      ledger,
      makeEvent('e2', 'input', ORIGIN, TEXT_CTX, { valueAfter: 'AMD' }),
    );
    processSeq(
      runtime,
      ledger,
      makeEvent('e3', 'blur', ORIGIN, TEXT_CTX, { valueAfter: null }),
    );
    expect(emitted[0].metadata.typedValue).toBe('AMD');
    expect(emitted[0].metadata.textValue).toBe('AMD');
  });
});

// ── Autofill / paste-without-input recovery (Bug-2 semantics preserved) ──

describe('TextEntry — autofill recovery (blur-only fill)', () => {
  it('blur-only value (autofill, no input events): typed := committed, userTyped forced true', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    processSeq(runtime, ledger, makeEvent('e1', 'focus', ORIGIN, TEXT_CTX));
    processSeq(
      runtime,
      ledger,
      makeEvent('e2', 'blur', ORIGIN, TEXT_CTX, { valueAfter: 'autofilled@example.com' }),
    );
    expect(emitted.length).toBe(1);
    const md = emitted[0].metadata;
    expect(md.textValue).toBe('autofilled@example.com');
    expect(md.typedValue).toBe('autofilled@example.com');
    expect(md.userTyped).toBe(true);
  });

  it('focus → blur with NO value at all still yields userTyped=false (Bug 4 preserved)', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    processSeq(runtime, ledger, makeEvent('e1', 'focus', ORIGIN, TEXT_CTX));
    processSeq(runtime, ledger, makeEvent('e2', 'blur', ORIGIN, TEXT_CTX, { valueAfter: null }));
    expect(emitted.length).toBe(1);
    expect(emitted[0].metadata.userTyped).toBe(false);
    expect(emitted[0].metadata.textValue).toBe('');
    expect(emitted[0].metadata.typedValue).toBe('');
  });
});

// ── Regression guards: existing consumers keep committed semantics ──

describe('TextEntry — committed-value consumers unaffected', () => {
  it('core pin stays green: admin/secret123 flow emits textValue=committed (identical typed/committed)', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target: Partial<ElementIdentity> = {
      tag: 'INPUT',
      ariaRole: 'textbox',
      stableId: 'username',
      accessibleName: 'Username',
      inputType: 'text',
      cssSelector: '#username',
    };
    processSeq(runtime, ledger, makeEvent('e1', 'focus', target, TEXT_CTX));
    processSeq(
      runtime,
      ledger,
      makeEvent('e2', 'input', target, TEXT_CTX, { valueAfter: 'admin' }),
    );
    processSeq(
      runtime,
      ledger,
      makeEvent('e3', 'blur', target, TEXT_CTX, { valueAfter: 'admin' }),
    );
    expect(emitted[0].metadata.textValue).toBe('admin');
    expect(emitted[0].metadata.typedValue).toBe('admin');
  });

  it('password flow (secret123) keeps committed textValue', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target: Partial<ElementIdentity> = {
      tag: 'INPUT',
      ariaRole: null,
      stableId: 'pw',
      accessibleName: 'Password',
      inputType: 'password',
      cssSelector: '#pw',
    };
    const ctx = { inputType: 'password' };
    processSeq(runtime, ledger, makeEvent('e1', 'focus', target, ctx));
    processSeq(
      runtime,
      ledger,
      makeEvent('e2', 'input', target, ctx, { valueAfter: 'secret123' }),
    );
    processSeq(
      runtime,
      ledger,
      makeEvent('e3', 'blur', target, ctx, { valueAfter: 'secret123' }),
    );
    expect(emitted[0].metadata.textValue).toBe('secret123');
    expect(emitted[0].metadata.typedValue).toBe('secret123');
  });
});
