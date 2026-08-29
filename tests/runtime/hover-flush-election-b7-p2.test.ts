/**
 * B7-P2 §5.2.2 (recording-end split) + §5.2.6 (nav election
 * generalization, B-7) — runtime-level contracts.
 *
 * B-2 split: flush() consults the NEW completesAtRecordingEnd declaration;
 * cleanupStaleComponents (5-min idle) does NOT — idle stays 'abandoned'
 * with the Unclassified backstop as the honest floor.
 *
 * B-7 election: candidates carrying commit metadata (commitSignal) rank by
 * their commit-marker captureSeq; marker-less candidates rank AFTER
 * marker-bearing ones. Marker-less hover deterministically loses to a
 * marker-bearing TextEntry → B6/B6.1 outcomes preserved byte-for-byte.
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
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
    accessibleName: 'Menu', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'BUTTON', className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector: 'button',
    inputType: null,
    xPath: '/html/body/button', inIframe: false, shadowDom: false, elementId: '',
    href: null,
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [],
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
    eventType: eventType as ObservedEvent['eventType'],
    target: makeTarget(target),
    domContext: makeDomContext(domContext),
    isTrusted: true,
    ...eventOverrides,
  });
}

function setupRuntime() {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

describe('B7-P2: completesAtRecordingEnd — flush() vs idle-timeout split (B-2)', () => {
  it('flush() COMPLETES a hover lifecycle that declared completesAtRecordingEnd', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(makeEvent('evt-f1-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: 1000 }));
    expect(runtime.activeCount).toBe(1);
    runtime.flush();
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.terminal).toBe('recording-end');
  });

  it('idle-timeout still ABANDONS the hover even though completesAtRecordingEnd is declared', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(makeEvent('evt-f2-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: 1000 }));
    // 6 minutes of silence, then any event — stale cleanup fires first.
    runtime.process(makeEvent('evt-f2-2', 'click', { tag: 'A', cssSelector: 'a' }, {}, { timestamp: 1000 + 360_000 }));
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('abandoned');
    expect(hover!.metadata.terminal).toBe('idle-timeout');
  });

  it('Scroll still completes at flush (existing shouldCompleteOnOutside semantics untouched)', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(makeEvent('evt-f3-1', 'scroll', { tag: 'DIV', className: null }, {}, {
      timestamp: 1000, scrollDeltaY: 120,
    }));
    expect(runtime.activeCount).toBe(1);
    runtime.flush();
    const scroll = emitted.find((i) => i.type === 'Scroll');
    expect(scroll).toBeDefined();
    expect(scroll!.endState).toBe('completed');
  });
});

describe('B7-P2: flushOnNavigation commit-marker election (B-7)', () => {
  it('marker-bearing TextEntry beats marker-less Hover — B6/B6.1 outcome preserved', () => {
    const { runtime, emitted } = setupRuntime();
    // Hover lifecycle starts first (mouseenter on the nav trigger).
    runtime.process(makeEvent('evt-n1-1', 'mouseenter', { tag: 'BUTTON', accessibleName: 'Account' }, {}, {
      timestamp: 1000, captureSeq: 10,
    }));
    // TextEntry lifecycle on the search field with a terminal Enter.
    const teTarget = makeTarget({ tag: 'INPUT', cssSelector: 'input', inputType: 'text', accessibleName: 'Search' });
    runtime.process(makeObservedEvent({
      eventId: 'evt-n1-2', eventType: 'focus', target: teTarget,
      domContext: makeDomContext({ inputType: 'text' }), isTrusted: true,
      timestamp: 1100, captureSeq: 11,
    }));
    runtime.process(makeObservedEvent({
      eventId: 'evt-n1-3', eventType: 'input', target: teTarget,
      domContext: makeDomContext({ inputType: 'text' }), isTrusted: true,
      timestamp: 1200, captureSeq: 12, valueAfter: 'earbuds',
    }));
    runtime.process(makeObservedEvent({
      eventId: 'evt-n1-4', eventType: 'keydown', key: 'Enter', target: teTarget,
      domContext: makeDomContext({ inputType: 'text' }), isTrusted: true,
      timestamp: 1300, captureSeq: 13,
    }));
    expect(runtime.activeCount).toBe(2);
    // The nav event flushes both — a real SPA navigation event.
    const nav = makeObservedEvent({
      eventId: 'evt-n1-5', eventType: 'navigation' as never,
      navType: 'pushState',
      target: makeTarget({ tag: 'A', cssSelector: 'a' }),
      domContext: makeDomContext(), isTrusted: true,
      timestamp: 1400, captureSeq: 14,
    });
    runtime.flushOnNavigation(nav);
    const te = emitted.find((i) => i.type === 'TextEntry');
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(te).toBeDefined();
    expect(hover).toBeDefined();
    // TextEntry carries the commit marker (form-less tier N) and WINS.
    expect(te!.endState).toBe('completed');
    expect(te!.metadata.commitSignal).toBe('navigation');
    // Hover lost the election and is interrupted honestly — scrubbed.
    expect(hover!.endState).toBe('interrupted');
    expect(hover!.metadata.commitSignal).toBeUndefined();
  });

  it('nested hover enters flatten into ONE lifecycle (V2) — the nav election has at most one hover candidate', () => {
    // Architectural invariant (B7-P1 member policy): a second gated enter
    // while a hover is active is absorbed as a POINTER-PATH FACT into the
    // existing lifecycle — two hover lifecycles never coexist. The nav
    // election therefore has at most one hover candidate, and it is always
    // marker-bearing (the hook writes commitSignal when it returns true).
    const { runtime, emitted } = setupRuntime();
    runtime.process(makeEvent('evt-n2-1', 'mouseenter', { tag: 'BUTTON', accessibleName: 'A', elementId: 'el-a' }, {}, {
      timestamp: 1000, captureSeq: 10,
    }));
    // Enter a SECOND interactive element mid-gesture — pointer-path fact.
    runtime.process(makeEvent('evt-n2-2', 'mouseenter', { tag: 'BUTTON', accessibleName: 'B', elementId: 'el-b' }, {}, {
      timestamp: 1500, captureSeq: 20,
    }));
    // ONE lifecycle — the second enter was absorbed, not discovered.
    expect(runtime.activeCount).toBe(1);
    const nav = makeObservedEvent({
      eventId: 'evt-n2-3', eventType: 'navigation' as never,
      navType: 'pushState',
      target: makeTarget({ tag: 'A', cssSelector: 'a' }),
      domContext: makeDomContext(), isTrusted: true,
      timestamp: 2000, captureSeq: 30,
    });
    runtime.flushOnNavigation(nav);
    const hovers = emitted.filter((i) => i.type === 'Hover');
    expect(hovers.length).toBe(1);
    // The single hover candidate is marker-bearing and WINS the election.
    expect(hovers[0].endState).toBe('completed');
    expect(hovers[0].metadata.commitSignal).toBe('navigation');
    // The nested enter survived as a pointer-path fact on the winner.
    const enters = (hovers[0].metadata.pointerPathEnters ?? []) as Array<{ eventId: string }>;
    expect(enters.some((e) => e.eventId === 'evt-n2-2')).toBe(true);
  });

  it('marker-less hover with NO marker-bearing candidate completes (navigation hook fires for it)', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(makeEvent('evt-n3-1', 'mouseenter', { tag: 'BUTTON', accessibleName: 'Nav' }, {}, {
      timestamp: 1000, captureSeq: 10,
    }));
    const nav = makeObservedEvent({
      eventId: 'evt-n3-2', eventType: 'navigation' as never,
      navType: 'pushState',
      target: makeTarget({ tag: 'A', cssSelector: 'a' }),
      domContext: makeDomContext(), isTrusted: true,
      timestamp: 1500, captureSeq: 20,
    });
    runtime.flushOnNavigation(nav);
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.commitSignal).toBe('navigation');
  });
});
