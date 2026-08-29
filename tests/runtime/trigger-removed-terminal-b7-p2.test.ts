/**
 * B7-P2 §5.2.2 T4 (target-removed) — SW LIFECYCLE completion contract.
 *
 * The spec's line-130 contract ("TRIGGER_REMOVED(lifecycleId) content→SW
 * notification when the hover target is removed") has its P1 evidence-
 * window half implemented, but no CS→SW notification exists and no code
 * path completes the SW hover lifecycle with terminal 'target-removed'.
 * These tests pin the runtime method the SW will call.
 *
 * Contracts pinned:
 *   - an active Hover lifecycle completes 'completed' with terminal
 *     'target-removed' when its id is passed (definition declares
 *     completesOnTriggerRemoved);
 *   - unknown ids are no-ops (stack untouched, nothing emitted);
 *   - lifecycles of types WITHOUT the declaration (TextEntry) are NOT
 *     completed by this path;
 *   - emitted interactions flow through config.onEmit exactly once.
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
  target: Partial<ElementIdentity> = {},
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

describe('B7-P2 T4: completeTriggerRemoved (runtime contract)', () => {
  it('completes an active Hover with terminal target-removed and endState completed', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(makeEvent('evt-tr1-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: 1000 }));
    expect(runtime.activeCount).toBe(1);
    const live = runtime.getLiveLifecycles();
    expect(live.length).toBe(1);
    expect(live[0].type).toBe('Hover');

    const out = runtime.completeTriggerRemoved(live[0].id);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('Hover');
    expect(out[0].endState).toBe('completed');
    expect((out[0].metadata as Record<string, unknown>).terminal).toBe('target-removed');
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toBe(out[0]);
    expect(runtime.activeCount).toBe(0);
  });

  it('unknown lifecycle id → no-op (stack untouched, nothing emitted)', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(makeEvent('evt-tr2-1', 'mouseenter', { tag: 'BUTTON' }, {}, { timestamp: 1000 }));
    expect(runtime.activeCount).toBe(1);
    const out = runtime.completeTriggerRemoved('lc-does-not-exist');
    expect(out.length).toBe(0);
    expect(emitted.length).toBe(0);
    expect(runtime.activeCount).toBe(1);
  });

  it('lifecycle type WITHOUT completesOnTriggerRemoved declaration (TextEntry) is NOT completed', () => {
    const { runtime, emitted } = setupRuntime();
    // focus into a text input opens a TextEntry lifecycle (priority 50 < 180)
    runtime.process(makeEvent(
      'evt-tr3-1', 'focus',
      { tag: 'INPUT', inputType: 'text' },
      { inputType: 'text' },
      { timestamp: 1000 },
    ));
    const live = runtime.getLiveLifecycles();
    expect(live.length).toBe(1);
    expect(live[0].type).toBe('TextEntry');

    const out = runtime.completeTriggerRemoved(live[0].id);
    expect(out.length).toBe(0);
    expect(emitted.length).toBe(0);
    expect(runtime.activeCount).toBe(1);

    // TextEntry remains live and healthy — blur completion still works after
    runtime.process(makeEvent(
      'evt-tr3-2', 'blur',
      { tag: 'INPUT', inputType: 'text' },
      { inputType: 'text' },
      { timestamp: 2000 },
    ));
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    const entry = emitted.find((i) => i.type === 'TextEntry');
    expect(entry).toBeDefined();
    expect(entry!.endState).toBe('completed');
  });
});
