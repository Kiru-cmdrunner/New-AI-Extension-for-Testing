import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type { DomContext } from '../../src/shared/component-types';

const INPUT = {
  tag: 'INPUT', id: 'q', ariaRole: 'textbox', cssSelector: '#q',
  inputType: 'text',
} as const;

const MENU_ITEM = {
  tag: 'DIV', id: 'm', ariaRole: 'menuitem', cssSelector: '#m',
} as const;

const dom = { tabIndex: 0, inputType: 'text' } as unknown as DomContext;

describe('B7-P2: consuming click completes a lower Hover without stealing TextEntry ownership', () => {
  it('emits exactly one owner of the focus-click (no twin Click)', () => {
    const runtime = createRuntime(ALL_DEFINITIONS, {} as never);

    // 1) gated mouseenter on the input → Hover lifecycle starts.
    let emitted = runtime.process(
      makeObservedEvent({ eventId: 'e1', eventType: 'mouseenter', target: INPUT, domContext: dom }),
    );
    expect(emitted.length).toBe(0); // hover starts, no emission

    // 2) focus on the input → TextEntry lifecycle starts (stack-top).
    emitted = runtime.process(
      makeObservedEvent({ eventId: 'e2', eventType: 'focus', target: INPUT, domContext: dom }),
    );
    expect(emitted.length).toBe(0);

    // 3) click on the input — TextEntry (stack-top) absorbs it; the Hover
    //    below completes consumed-by-click but MUST NOT release the event.
    emitted = runtime.process(
      makeObservedEvent({ eventId: 'e3', eventType: 'click', target: INPUT, domContext: dom }),
    );

    const completedHovers = emitted.filter((i) => i.type === 'Hover');
    expect(completedHovers.length).toBe(1);
    expect(completedHovers[0].metadata?.terminal).toBe('consumed-by-click');

    // THE REGRESSION: no twin Click interaction from the same event.
    const clicks = emitted.filter((i) => i.type === 'Click');
    expect(clicks.length).toBe(0);

    // 4) typing continues on the TextEntry — the lifecycle stays alive and
    //    STILL owns the click (single-owner proof at the member level).
    emitted = runtime.process(
      makeObservedEvent({ eventId: 'e4', eventType: 'input', target: INPUT, domContext: dom, valueAfter: 'wireless earbuds' }),
    );
    expect(emitted.length).toBe(0); // no completion yet — no twin emission
    // The runtime's live stack still holds the TextEntry (it absorbed e3).
    const live = runtime.getLiveLifecycles();
    expect(live.some((lc) => lc.type === 'TextEntry')).toBe(true);
  });

  it('a consuming click with NO higher owner still falls through to discovery (Hover alone)', () => {
    const runtime = createRuntime(ALL_DEFINITIONS, {} as never);

    runtime.process(
      makeObservedEvent({ eventId: 'e1', eventType: 'mouseenter', target: MENU_ITEM, domContext: { tabIndex: 0 } as unknown as DomContext }),
    );
    // click directly on the hovered item — no TextEntry on the stack.
    const emitted = runtime.process(
      makeObservedEvent({ eventId: 'e2', eventType: 'click', target: MENU_ITEM, domContext: { tabIndex: 0 } as unknown as DomContext }),
    );

    const hovers = emitted.filter((i) => i.type === 'Hover');
    expect(hovers.length).toBe(1);
    expect(hovers[0].metadata?.terminal).toBe('consumed-by-click');
    // The click IS its own interaction in this shape (spec §5.2.2).
    const clicks = emitted.filter((i) => i.type === 'Click');
    expect(clicks.length).toBe(1);
  });
});
