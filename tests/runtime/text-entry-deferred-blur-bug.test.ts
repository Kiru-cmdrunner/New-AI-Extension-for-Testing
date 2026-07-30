/**
 * Bug Reproduction: TextEntry dropped when click fires BEFORE deferred blur
 *
 * In real browser with SPA frameworks (React), the event order for autocomplete
 * selection is:
 *   mousedown → click → [deferred] blur
 *
 * The click on the autocomplete suggestion fires BEFORE the deferred blur.
 * TextEntry's shouldCancelOnOutside abandons the TextEntry on the outside click.
 * When the deferred blur arrives later, the TextEntry is already gone.
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
  BrowserEventType,
} from '../../src/shared/component-types';

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null,
    stableId: null, testId: null, dataCy: null, dataQa: null,
    cssSelector: 'div', xPath: '/html/body/div', inIframe: false, shadowDom: false,
    elementId: '', ...overrides,
  };
}

function makeContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [], ...overrides,
  };
}

function makeEvent(
  eventId: string,
  eventType: BrowserEventType,
  target: Partial<ElementIdentity> = {},
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId, eventType, target: makeTarget(target), domContext: makeContext(domContext),
    ...eventOverrides,
  });
}

function setupRuntime() {
  let emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

describe('TextEntry Deferred Blur Race Condition', () => {
  it('REPRODUCES: TextEntry abandoned when click fires before deferred blur', () => {
    const { runtime, emitted } = setupRuntime();

    const toField = { tag: 'INPUT', stableId: 'to', accessibleName: 'To', ariaRole: 'textbox', cssSelector: '#to' };
    const suggestion = { tag: 'LI', stableId: 'suggestion-bangalore', accessibleName: 'Bangalore, India', ariaRole: 'option', cssSelector: 'li.suggestion:nth-child(2)' };
    const textCtx = { inputType: 'text' };

    // 1. Focus "To" field and type "Ban"
    runtime.process(makeEvent('f1', 'focus', toField, textCtx));
    runtime.process(makeEvent('i1', 'input', toField, textCtx, { valueAfter: 'Ban' }));

    // 2. Click on suggestion (BEFORE blur - simulates deferred blur async behavior)
    runtime.process(makeEvent('md1', 'mousedown', suggestion));
    runtime.process(makeEvent('c1', 'click', suggestion));

    // 3. Deferred blur on "To" fires AFTER click
    runtime.process(makeEvent('b1', 'blur', toField, textCtx, { valueAfter: 'Bangalore' }));

    const textEntries = emitted.filter((e) => e.type === 'TextEntry');

    console.log('Emitted:', emitted.map(e => `${e.type}(${e.endState}) target="${e.metadata?.targetName}" val="${e.metadata?.textValue}"`));

    // The TextEntry should be captured
    const toEntry = textEntries.find((e) => e.metadata.targetName === 'To');
    expect(toEntry).toBeDefined();
    expect(toEntry!.metadata.textValue).toBe('Bangalore');
    expect(toEntry!.endState).toBe('completed');
  });

  it('WORKS: TextEntry captured when blur fires before click (normal order)', () => {
    const { runtime, emitted } = setupRuntime();

    const toField = { tag: 'INPUT', stableId: 'to', accessibleName: 'To', ariaRole: 'textbox' };
    const suggestion = { tag: 'LI', stableId: 'suggestion-bangalore', accessibleName: 'Bangalore, India', ariaRole: 'option' };
    const textCtx = { inputType: 'text' };

    // 1. Focus "To" field and type "Ban"
    runtime.process(makeEvent('f1', 'focus', toField, textCtx));
    runtime.process(makeEvent('i1', 'input', toField, textCtx, { valueAfter: 'Ban' }));

    // 2. Blur fires FIRST (normal synchronous order)
    runtime.process(makeEvent('b1', 'blur', toField, textCtx, { valueAfter: 'Bangalore' }));

    // 3. Click on suggestion fires after blur
    runtime.process(makeEvent('md1', 'mousedown', suggestion));
    runtime.process(makeEvent('c1', 'click', suggestion));

    const textEntries = emitted.filter((e) => e.type === 'TextEntry');

    console.log('Emitted:', emitted.map(e => `${e.type}(${e.endState}) target="${e.metadata?.targetName}" val="${e.metadata?.textValue}"`));

    const toEntry = textEntries.find((e) => e.metadata.targetName === 'To');
    expect(toEntry).toBeDefined();
    expect(toEntry!.metadata.textValue).toBe('Bangalore');
    expect(toEntry!.endState).toBe('completed');
  });
});
