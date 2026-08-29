/**
 * Phase 7.4-B6.1 — Runtime contract: flushOnNavigation (tier N seam)
 *
 * Spec: .drytis/specs/phase-7-4-b6-1-formless-spa-enter-commit.md §5.1
 *
 * Pins the RUNTIME half of the navigation-commit seam:
 *  - hooked lifecycle (TextEntry, P1–P4) completes 'completed' at nav flush
 *  - hookless definitions still interrupt on nav (unchanged behavior)
 *  - plain flush() (STOP) stays blind-interrupt for TextEntry
 *  - non-navigation events never consult the hook
 *  - a throwing hook degrades to honest interrupt (try/catch guard)
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
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector: 'div',
    xPath: '/html/body/div', inIframe: false, shadowDom: false, href: null,
    inputType: null, elementId: '', ...overrides,
  };
}

function makeContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false,
    disabled: false, readOnly: false, required: false, ancestorRoles: [],
    ancestorClasses: [], tabIndex: null, ...overrides,
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

const SEARCH_INPUT: Partial<ElementIdentity> = {
  tag: 'INPUT', ariaRole: 'textbox', stableId: 'q', accessibleName: 'Search',
  inputType: 'text', cssSelector: '#q',
};

const NAV_TARGET: Partial<ElementIdentity> = {
  tag: 'BODY', accessibleName: '', ariaRole: 'document',
};

function navEvent(eventId: string, url: string): ObservedEvent {
  return makeEvent(eventId, 'navigation', {
    ...NAV_TARGET, accessibleName: url, ariaLabel: `Navigation to ${url}`, href: url,
  }, {}, { pageUrl: url, navType: 'pushState' });
}

describe('flushOnNavigation — runtime contract (7.4-B6.1 §5.1)', () => {
  it('R1: hooked TextEntry completes at nav flush; Navigation definition still claims the nav event', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pR1-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pR1-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'shoes' }));
    processSeq(runtime, ledger, makeEvent('evt-pR1-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    processSeq(runtime, ledger, navEvent('evt-pR1-4', 'https://app.test/s?q=shoes'));

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te?.endState).toBe('completed');
    expect(te?.metadata['commitSignal']).toBe('navigation');

    // The nav event itself is still claimed by the Navigation definition —
    // the flush change must not swallow discovery.
    const nav = emitted.find((i) => i.type === 'Navigation');
    expect(nav).toBeDefined();
    expect(nav?.triggerEvent.eventId).toBe('evt-pR1-4');
  });

  it('R2: hookless definitions still interrupt on navigation (pre-existing behavior unchanged)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    // Dropdown lifecycle: open a select, never complete it, then navigate.
    const SELECT: Partial<ElementIdentity> = {
      tag: 'SELECT', ariaRole: 'combobox', stableId: 'sel', cssSelector: '#sel',
    };
    processSeq(runtime, ledger, makeEvent('evt-pR2-1', 'click', SELECT));
    processSeq(runtime, ledger, navEvent('evt-pR2-2', 'https://app.test/next'));

    const dd = emitted.find((i) => i.type === 'Dropdown');
    expect(dd).toBeDefined();
    expect(dd?.endState).toBe('interrupted');
  });

  it('R3: plain flush() stays blind-interrupt for TextEntry (STOP path unchanged)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pR3-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pR3-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'x' }));
    processSeq(runtime, ledger, makeEvent('evt-pR3-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    // No navigation — user just hits STOP. flush() must interrupt.
    const flushed = runtime.flush();

    const te = flushed.find((i) => i.type === 'TextEntry') ?? emitted.find((i) => i.type === 'TextEntry');
    expect(te?.endState).toBe('interrupted');
    expect(te?.metadata['commitSignal']).toBeUndefined();
  });

  it('R4: non-navigation events never consult the hook (no accidental completion)', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pR4-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pR4-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'abc' }));
    processSeq(runtime, ledger, makeEvent('evt-pR4-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    // A non-nav event after Enter (e.g. mousemove elsewhere) — NOT a commit proof
    processSeq(runtime, ledger, makeEvent('evt-pR4-4', 'mousemove', { tag: 'BODY' }, {}, {
      clientX: 10, clientY: 10,
    }));
    // and STOP
    runtime.flush();

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te?.endState).toBe('interrupted');
    expect(te?.metadata['commitSignal']).toBeUndefined();
  });

  it('R5: a throwing hook degrades to honest interrupt (guard)', () => {
    // Inject a definition whose hook throws — runtime must survive and interrupt.
    const badDef = {
      ...ALL_DEFINITIONS.find((d) => d.type === 'TextEntry')!,
      shouldCompleteOnNavigation: (): boolean => {
        throw new Error('boom');
      },
    };
    const emitted: ComponentInteraction[] = [];
    const ledger = new EvidenceLedger();
    const runtime = createRuntime([badDef], {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });

    ledger.append(makeEvent('evt-pR5-1', 'focus', SEARCH_INPUT));
    runtime.process(makeEvent('evt-pR5-1', 'focus', SEARCH_INPUT));
    ledger.append(makeEvent('evt-pR5-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'v' }));
    runtime.process(makeEvent('evt-pR5-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'v' }));
    ledger.append(makeEvent('evt-pR5-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    runtime.process(makeEvent('evt-pR5-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    const nav = navEvent('evt-pR5-4', 'https://app.test/x');
    ledger.append(nav);
    runtime.process(nav);

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te?.endState).toBe('interrupted');
    expect(te?.metadata['commitSignal']).toBeUndefined();
  });

  it('R6: endTime of the completed TextEntry is the navigation timestamp (recorded data, not Date.now())', () => {
    const { runtime, emitted, ledger } = setupRuntime();

    processSeq(runtime, ledger, makeEvent('evt-pR6-1', 'focus', SEARCH_INPUT));
    processSeq(runtime, ledger, makeEvent('evt-pR6-2', 'input', SEARCH_INPUT, {}, { valueAfter: 'k' }));
    processSeq(runtime, ledger, makeEvent('evt-pR6-3', 'keydown', SEARCH_INPUT, {}, { key: 'Enter' }));
    const navAt = 1770000000000;
    const nav = makeEvent('evt-pR6-4', 'navigation', {
      ...NAV_TARGET, accessibleName: 'https://app.test/k', href: 'https://app.test/k',
    }, {}, { pageUrl: 'https://app.test/k', timestamp: navAt });
    processSeq(runtime, ledger, nav);

    const te = emitted.find((i) => i.type === 'TextEntry');
    expect(te?.endTime).toBe(navAt);
  });
});
