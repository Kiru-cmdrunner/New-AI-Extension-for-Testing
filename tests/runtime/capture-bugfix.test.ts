/**
 * Unit Tests: Component Runtime Capture Bug Fixes
 *
 * Tests the three critical capture failures that were destroying real
 * user interactions on login forms:
 *
 * Bug 1: TextEntry abandoned before blur (mousedown cancels)
 * Bug 2: Text value not captured on blur (valueAfter missing)
 * Bug 3: Hover absorbs click events (isInScope too broad)
 *
 * Spec: .drytis/specs/fix-component-runtime-capture.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { textEntryDefinition } from '../../src/definitions/text-entry';
import { hoverDefinition } from '../../src/definitions/hover';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
  ComponentContext,
} from '../../src/shared/component-types';

// ── Helpers ──────────────────────────────────────────────────────────

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
    eventType: eventType as any,
    target: makeTarget(target),
    domContext: makeContext(domContext),
    ...eventOverrides,
  });
}

function setupRuntime() {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

function makeComponentContext(
  type: string,
  trigger: ObservedEvent,
): ComponentContext {
  return {
    type: type as any,
    state: 'active',
    trigger: trigger.target,
    triggerEvent: trigger,
    memberEvents: [trigger],
    scopeKeys: new Set(),
    startTime: trigger.timestamp,
    endTime: 0,
    data: {},
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Bug 1: TextEntry not abandoned on mousedown before blur', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    const setup = setupRuntime();
    emitted = setup.emitted;
    runtime = setup.runtime;
  });

  it('completes TextEntry when mousedown on another element fires before blur', () => {
    // Real browser event order: focus → input → mousedown(Login) → blur → click(Login)
    // Previously: mousedown cancelled the TextEntry before blur could complete
    const userTarget = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'username', accessibleName: 'Username' };
    const loginTarget = { tag: 'BUTTON', accessibleName: 'Login', stableId: 'login-btn' };

    runtime.process(makeEvent('f1', 'focus', userTarget, { inputType: 'text' }));
    runtime.process(makeEvent('i1', 'input', userTarget, { inputType: 'text' }, { valueAfter: 'admin' }));

    // mousedown on Login button — should NOT cancel the TextEntry
    runtime.process(makeEvent('md1', 'mousedown', loginTarget));

    // TextEntry should still be active
    expect(runtime.activeCount).toBe(1);

    // blur fires — TextEntry completes
    runtime.process(makeEvent('b1', 'blur', userTarget, { inputType: 'text' }));

    const textEntry = emitted.find((e) => e.type === 'TextEntry');
    expect(textEntry).toBeDefined();
    expect(textEntry!.endState).toBe('completed');
    expect(textEntry!.metadata.textValue).toBe('admin');
  });

  it('completes password field when clicking Login (full login flow)', () => {
    // The password field is the last input before clicking submit
    const pwTarget = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'password', accessibleName: 'Password' };
    const loginTarget = { tag: 'BUTTON', accessibleName: 'Login', stableId: 'login-btn' };

    runtime.process(makeEvent('f1', 'focus', pwTarget, { inputType: 'password' }));
    runtime.process(makeEvent('i1', 'input', pwTarget, { inputType: 'password' }, { valueAfter: 'secret123' }));

    // User clicks Login: mousedown → blur → click
    runtime.process(makeEvent('md1', 'mousedown', loginTarget));
    runtime.process(makeEvent('b1', 'blur', pwTarget, { inputType: 'password' }));
    runtime.process(makeEvent('c1', 'click', loginTarget));

    const textEntry = emitted.find((e) => e.type === 'TextEntry');
    expect(textEntry).toBeDefined();
    expect(textEntry!.endState).toBe('completed');
    expect(textEntry!.metadata.textValue).toBe('secret123');
    expect(textEntry!.metadata.userTyped).toBe(true);
  });
});

describe('Bug 2: Text value captured from blur event', () => {
  it('captures text value from blur event when input events were missed', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'autofill', accessibleName: 'Email' };

    // Focus → blur with NO input events (autofill/paste scenario)
    // But blur event carries valueAfter (from event-tap fix)
    runtime.process(makeEvent('f1', 'focus', target, { inputType: 'email' }));
    runtime.process(makeEvent('b1', 'blur', target, { inputType: 'email' }, { valueAfter: 'user@example.com' }));

    const textEntry = emitted.find((e) => e.type === 'TextEntry');
    expect(textEntry).toBeDefined();
    expect(textEntry!.metadata.textValue).toBe('user@example.com');
    expect(textEntry!.metadata.userTyped).toBe(true);
  });

  it('still captures text value normally via input events', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'name', accessibleName: 'Name' };

    runtime.process(makeEvent('f1', 'focus', target, { inputType: 'text' }));
    runtime.process(makeEvent('i1', 'input', target, { inputType: 'text' }, { valueAfter: 'John' }));
    runtime.process(makeEvent('b1', 'blur', target, { inputType: 'text' }, { valueAfter: 'John' }));

    const textEntry = emitted.find((e) => e.type === 'TextEntry');
    expect(textEntry).toBeDefined();
    expect(textEntry!.metadata.textValue).toBe('John');
  });

  it('marks userTyped=false when both input and blur have no value', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'empty', accessibleName: 'Search' };

    runtime.process(makeEvent('f1', 'focus', target, { inputType: 'text' }));
    runtime.process(makeEvent('b1', 'blur', target, { inputType: 'text' }));

    const textEntry = emitted.find((e) => e.type === 'TextEntry');
    expect(textEntry).toBeDefined();
    expect(textEntry!.metadata.userTyped).toBe(false);
  });

  it('handles change events as text input', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'search2', accessibleName: 'Search' };

    runtime.process(makeEvent('f1', 'focus', target, { inputType: 'text' }));
    runtime.process(makeEvent('ch1', 'change', target, { inputType: 'text' }, { valueAfter: 'query' }));
    runtime.process(makeEvent('b1', 'blur', target, { inputType: 'text' }, { valueAfter: 'query' }));

    const textEntry = emitted.find((e) => e.type === 'TextEntry');
    expect(textEntry).toBeDefined();
    expect(textEntry!.metadata.textValue).toBe('query');
  });
});

describe('Bug 3: Click not absorbed by active Hover', () => {
  it('click fires Click definition when Hover is active on same element', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'BUTTON', ariaRole: 'button', stableId: 'submit', accessibleName: 'Submit', cssSelector: 'button#submit' };

    // mouseenter starts a Hover
    runtime.process(makeEvent('me1', 'mouseenter', target));
    expect(runtime.activeCount).toBe(1);

    // click on the same element — must NOT be absorbed by Hover
    runtime.process(makeEvent('c1', 'click', target));

    // Click should be emitted (not swallowed)
    const click = emitted.find((e) => e.type === 'Click');
    expect(click).toBeDefined();
    expect(click!.endState).toBe('completed');
  });

  it('hover discarded without evidence (600ms dwell, no evidence signal)', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'BUTTON', ariaRole: 'button', stableId: 'hover1', accessibleName: 'Info', cssSelector: 'button#hover1' };

    runtime.process(makeEvent('me1', 'mouseenter', target, {}, { timestamp: 1000 }));

    // mouseleave after 600ms — above transit threshold but no evidence
    runtime.process(makeEvent('ml1', 'mouseleave', target, {}, { timestamp: 1600 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('discarded');
    expect(hover!.metadata.dwellMs).toBe(600);
  });

  it('hover discarded on quick mouseleave (below threshold)', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'BUTTON', ariaRole: 'button', stableId: 'hover2', accessibleName: 'Menu', cssSelector: 'button#hover2' };

    runtime.process(makeEvent('me1', 'mouseenter', target, {}, { timestamp: 1000 }));

    // mouseleave after 200ms (below 500ms threshold)
    runtime.process(makeEvent('ml1', 'mouseleave', target, {}, { timestamp: 1200 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('discarded');
  });

  it('full login flow: hover Login → click Login does not lose the click', () => {
    const { runtime, emitted } = setupRuntime();
    const loginTarget = { tag: 'BUTTON', ariaRole: 'button', stableId: 'login-btn', accessibleName: 'Login', cssSelector: 'button#login-btn' };

    // User hovers the Login button, then clicks it
    runtime.process(makeEvent('me1', 'mouseenter', loginTarget, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('c1', 'click', loginTarget, {}, { timestamp: 1300 }));

    const click = emitted.find((e) => e.type === 'Click');
    expect(click).toBeDefined();
    expect(click!.metadata.targetName).toBe('Login');
  });
});

describe('TextEntry shouldCancelOnOutside (unit)', () => {
  it('returns false for mousedown on different element', () => {
    const focusEvent = makeEvent('f1', 'focus',
      { tag: 'INPUT', stableId: 'user', cssSelector: 'input#user' },
      { inputType: 'text' }
    );
    const ctx = makeComponentContext('TextEntry', focusEvent);

    const mousedownElsewhere = makeEvent('md1', 'mousedown',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );

    // Should NOT cancel on mousedown — wait for blur
    expect(textEntryDefinition.shouldCancelOnOutside(mousedownElsewhere, ctx)).toBe(false);
  });

  it('returns true for click on different element', () => {
    const focusEvent = makeEvent('f1', 'focus',
      { tag: 'INPUT', stableId: 'user', cssSelector: 'input#user' },
      { inputType: 'text' }
    );
    const ctx = makeComponentContext('TextEntry', focusEvent);

    const clickElsewhere = makeEvent('c1', 'click',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );

    // Should cancel on click (different element)
    expect(textEntryDefinition.shouldCancelOnOutside(clickElsewhere, ctx)).toBe(true);
  });

  it('returns false for click on same element', () => {
    const focusEvent = makeEvent('f1', 'focus',
      { tag: 'INPUT', stableId: 'user', cssSelector: 'input#user' },
      { inputType: 'text' }
    );
    const ctx = makeComponentContext('TextEntry', focusEvent);

    const clickSame = makeEvent('c1', 'click',
      { tag: 'INPUT', stableId: 'user', cssSelector: 'input#user' }
    );

    expect(textEntryDefinition.shouldCancelOnOutside(clickSame, ctx)).toBe(false);
  });
});

describe('Hover isInScope (unit)', () => {
  it('returns true for mouseenter on same element', () => {
    const enter = makeEvent('me1', 'mouseenter',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );
    const ctx = makeComponentContext('Hover', enter);

    const anotherEnter = makeEvent('me2', 'mouseenter',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );

    expect(hoverDefinition.isInScope(anotherEnter, ctx)).toBe(true);
  });

  it('returns true for mouseleave on same element', () => {
    const enter = makeEvent('me1', 'mouseenter',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );
    const ctx = makeComponentContext('Hover', enter);

    const leave = makeEvent('ml1', 'mouseleave',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );

    expect(hoverDefinition.isInScope(leave, ctx)).toBe(true);
  });

  it('returns false for click on same element (critical fix)', () => {
    const enter = makeEvent('me1', 'mouseenter',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );
    const ctx = makeComponentContext('Hover', enter);

    const click = makeEvent('c1', 'click',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );

    // Click must NOT be in scope for Hover — must fall through to Click def
    expect(hoverDefinition.isInScope(click, ctx)).toBe(false);
  });

  it('returns false for mousedown on same element', () => {
    const enter = makeEvent('me1', 'mouseenter',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );
    const ctx = makeComponentContext('Hover', enter);

    const mousedown = makeEvent('md1', 'mousedown',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );

    expect(hoverDefinition.isInScope(mousedown, ctx)).toBe(false);
  });

  it('returns false for contextmenu on same element', () => {
    const enter = makeEvent('me1', 'mouseenter',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );
    const ctx = makeComponentContext('Hover', enter);

    const ctxMenu = makeEvent('cm1', 'contextmenu',
      { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn' }
    );

    expect(hoverDefinition.isInScope(ctxMenu, ctx)).toBe(false);
  });
});

describe('Full Login Flow Integration', () => {
  it('captures all 3 interactions from a typical login (username, password, click)', () => {
    const { runtime, emitted } = setupRuntime();

    const userTarget = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'username', accessibleName: 'Username', cssSelector: 'input#username' };
    const pwTarget = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'password', accessibleName: 'Password', cssSelector: 'input#password' };
    const loginTarget = { tag: 'BUTTON', ariaRole: 'button', stableId: 'login-btn', accessibleName: 'Login', cssSelector: 'button#login-btn' };

    // 1. Type username
    runtime.process(makeEvent('f1', 'focus', userTarget, { inputType: 'text' }));
    runtime.process(makeEvent('i1', 'input', userTarget, { inputType: 'text' }, { valueAfter: 'admin' }));
    runtime.process(makeEvent('b1', 'blur', userTarget, { inputType: 'text' }, { valueAfter: 'admin' }));

    // 2. Type password
    runtime.process(makeEvent('f2', 'focus', pwTarget, { inputType: 'password' }));
    runtime.process(makeEvent('i2', 'input', pwTarget, { inputType: 'password' }, { valueAfter: 'pass123' }));
    runtime.process(makeEvent('md1', 'mousedown', loginTarget));
    runtime.process(makeEvent('b2', 'blur', pwTarget, { inputType: 'password' }, { valueAfter: 'pass123' }));

    // 3. Click Login (after hovering it)
    runtime.process(makeEvent('me1', 'mouseenter', loginTarget));
    runtime.process(makeEvent('c1', 'click', loginTarget));

    // Verify all interactions
    const textEntries = emitted.filter((e) => e.type === 'TextEntry');
    expect(textEntries.length).toBe(2);

    expect(textEntries[0].metadata.targetName).toBe('Username');
    expect(textEntries[0].metadata.textValue).toBe('admin');
    expect(textEntries[0].endState).toBe('completed');

    expect(textEntries[1].metadata.targetName).toBe('Password');
    expect(textEntries[1].metadata.textValue).toBe('pass123');
    expect(textEntries[1].endState).toBe('completed');

    const click = emitted.find((e) => e.type === 'Click');
    expect(click).toBeDefined();
    expect(click!.metadata.targetName).toBe('Login');
    expect(click!.endState).toBe('completed');
  });
});
