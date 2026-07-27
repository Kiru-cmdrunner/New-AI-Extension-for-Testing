/**
 * Unit Tests: Core Component Definitions
 *
 * Tests Click, TextEntry, Dropdown, Checkbox, RadioButton, and Link
 * definitions — including OrangeHRM bug fix scenarios.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3, §4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentDefinition,
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTarget(
  overrides: Partial<ElementIdentity> = {},
): ElementIdentity {
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

function makeContext(
  overrides: Partial<DomContext> = {},
): DomContext {
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
  let emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Click Definition', () => {
  it('captures button clicks', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('e1', 'click', { tag: 'BUTTON', accessibleName: 'Login', stableId: 'login-btn' }),
    );
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
    expect(emitted[0].metadata.targetName).toBe('Login');
  });

  it('captures link clicks as Click when Link def is present', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('e1', 'click', { tag: 'A', ariaRole: 'link', accessibleName: 'Dashboard', stableId: 'dash-link' }),
    );
    // Link has higher priority (70) than Click (180), so it should be Link
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Link');
  });

  it('rejects non-interactive elements (bare div)', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('e1', 'click', { tag: 'DIV', accessibleName: '' }),
    );
    expect(emitted.length).toBe(0);
  });

  it('captures interactive div via class pattern', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('e1', 'click', { tag: 'DIV', className: 'menu-item clickable', accessibleName: 'Settings' }),
    );
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
  });
});

describe('TextEntry Definition', () => {
  it('captures text input with focus → input → blur', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'username', accessibleName: 'Username' };
    const ctx = { inputType: 'text' };

    runtime.process(makeEvent('f1', 'focus', target, ctx));
    expect(emitted.length).toBe(0);

    runtime.process(makeEvent('i1', 'input', target, ctx, { valueAfter: 'admin' }));
    expect(emitted.length).toBe(0);

    runtime.process(makeEvent('b1', 'blur', target, ctx));
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('TextEntry');
    expect(emitted[0].metadata.userTyped).toBe(true);
    expect(emitted[0].metadata.textValue).toBe('admin');
  });

  it('captures password entry', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'password', accessibleName: 'Password' };
    const ctx = { inputType: 'password' };

    runtime.process(makeEvent('f1', 'focus', target, ctx));
    runtime.process(makeEvent('i1', 'input', target, ctx, { valueAfter: 'secret123' }));
    runtime.process(makeEvent('b1', 'blur', target, ctx));

    expect(emitted.length).toBe(1);
    expect(emitted[0].metadata.textValue).toBe('secret123');
  });

  // Bug 4: pre-filled field without typing
  it('marks as userTyped=false when user did not type (Bug 4)', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'prefilled', accessibleName: 'Employee ID' };
    const ctx = { inputType: 'text' };

    // Focus → blur without any input event
    runtime.process(makeEvent('f1', 'focus', target, ctx));
    runtime.process(makeEvent('b1', 'blur', target, ctx));

    expect(emitted.length).toBe(1);
    expect(emitted[0].metadata.userTyped).toBe(false);
  });

  it('does not capture non-text inputs (checkbox)', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', ariaRole: 'checkbox', stableId: 'chk1' };
    const ctx = { inputType: 'checkbox' };

    runtime.process(makeEvent('f1', 'focus', target, ctx));
    runtime.process(makeEvent('b1', 'blur', target, ctx));

    // Checkbox def doesn't trigger on focus, so nothing should emit
    expect(emitted.length).toBe(0);
  });
});

describe('Dropdown Definition', () => {
  it('captures native select with change event', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'SELECT', ariaRole: 'listbox', stableId: 'country', accessibleName: 'Country' };

    runtime.process(makeEvent('c1', 'mousedown', target));
    runtime.process(
      makeEvent('ch1', 'change', target, {}, { valueAfter: 'USA' }),
    );

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.selectedValue).toBe('USA');
  });

  // Bug 2: no-op detection with `||` not `??`
  it('detects no-op selection when value matches current display (Bug 2)', () => {
    const { runtime, emitted } = setupRuntime();
    const trigger = { tag: 'INPUT', ariaRole: 'combobox', stableId: 'sel1', accessibleName: '', className: 'oxd-select-text' };
    const ctx = { inputType: 'text', readOnly: true, ariaHasPopup: 'listbox' as const, ancestorClasses: ['oxd-select-wrapper'] };

    // Click trigger to open dropdown
    runtime.process(makeEvent('c1', 'click', trigger, ctx, { valueBefore: '-- Admin --' }));

    // Click on an option with same display value
    const option = { tag: 'DIV', ariaRole: 'option', className: 'oxd-select-option', accessibleName: 'Admin' };
    runtime.process(makeEvent('c2', 'click', option));

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.noOpSelection).toBe(true);
  });

  it('detects real selection when value differs from current display', () => {
    const { runtime, emitted } = setupRuntime();
    const trigger = { tag: 'INPUT', ariaRole: 'combobox', stableId: 'sel2', accessibleName: '', className: 'oxd-select-text' };
    const ctx = { inputType: 'text', readOnly: true, ariaHasPopup: 'listbox' as const, ancestorClasses: ['oxd-select-wrapper'] };

    runtime.process(makeEvent('c1', 'click', trigger, ctx, { valueBefore: '-- Admin --' }));

    const option = { tag: 'DIV', ariaRole: 'option', className: 'oxd-select-option', accessibleName: 'ESS' };
    runtime.process(makeEvent('c2', 'click', option));

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.noOpSelection).toBe(false);
    expect(dropdown!.metadata.selectedValue).toBe('ESS');
  });

  it('waits passively when user clicks outside (timeout-based abandonment)', () => {
    // Architecture change: shouldCancelOnOutside removed (Fix 4).
    // Dropdown lifecycle is now managed by timeout (MAX_LIFECYCLE_DURATION_MS).
    // A click outside no longer abandons it — it waits for completion evidence
    // (option click or change event) or the timeout safety net.
    const { runtime, emitted } = setupRuntime();
    const trigger = { tag: 'SELECT', ariaRole: 'listbox', stableId: 'sel3', accessibleName: 'Nationality' };

    runtime.process(makeEvent('c1', 'click', trigger));

    // Click outside — does NOT abandon
    runtime.process(makeEvent('c2', 'click', { tag: 'BUTTON', accessibleName: 'Save', stableId: 'save-btn' }));

    // Dropdown should NOT be abandoned (shouldCancelOnOutside is always false now)
    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeUndefined();
    expect(runtime.activeCount).toBe(1);
  });
});

describe('Checkbox Definition', () => {
  it('captures checkbox toggle', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('c1', 'click', { tag: 'INPUT', ariaRole: 'checkbox', stableId: 'chk1', accessibleName: 'Subscribe' }, { inputType: 'checkbox' }),
    );
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Checkbox');
    expect(emitted[0].metadata.checked).toBeDefined();
  });

  it('correctly determines new checked state from checkedBefore=false', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('c1', 'click', { tag: 'INPUT', ariaRole: 'checkbox', stableId: 'chk2', accessibleName: 'Agree' }, { inputType: 'checkbox' }, { checkedBefore: false }),
    );
    // Browsers perform pre-click activation: checkedBefore is the NEW state.
    expect(emitted[0].metadata.checked).toBe(false);
  });

  it('correctly determines new checked state from checkedBefore=true', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('c1', 'click', { tag: 'INPUT', ariaRole: 'checkbox', stableId: 'chk3', accessibleName: 'Agree' }, { inputType: 'checkbox' }, { checkedBefore: true }),
    );
    // Browsers perform pre-click activation: checkedBefore is the NEW state.
    expect(emitted[0].metadata.checked).toBe(true);
  });
});

describe('RadioButton Definition', () => {
  it('captures radio button selection', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('c1', 'click', { tag: 'INPUT', ariaRole: 'radio', stableId: 'r1', accessibleName: 'Male' }, { inputType: 'radio' }),
    );
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('RadioButton');
  });

  // Bug 4: radio buttons can only be turned ON, never OFF by clicking.
  // checkedBefore is unreliable because browsers perform pre-click activation
  // (radio checked state is set to true before the click event fires).
  // So noOpSelection is always false for radio — every click is a real selection.
  it('always treats radio click as a real selection (checkedBefore unreliable)', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('c1', 'click', { tag: 'INPUT', ariaRole: 'radio', stableId: 'r2', accessibleName: 'Female' }, { inputType: 'radio' }, { checkedBefore: true }),
    );
    expect(emitted[0].metadata.noOpSelection).toBe(false);
  });

  it('marks as real selection when radio was not checked', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('c1', 'click', { tag: 'INPUT', ariaRole: 'radio', stableId: 'r3', accessibleName: 'Male' }, { inputType: 'radio' }, { checkedBefore: false }),
    );
    expect(emitted[0].metadata.noOpSelection).toBe(false);
  });
});

describe('Link Definition', () => {
  it('captures link click', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('e1', 'click', { tag: 'A', ariaRole: 'link', accessibleName: 'My Info', stableId: 'my-info-link' }),
    );
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Link');
    expect(emitted[0].metadata.targetName).toBe('My Info');
  });
});

describe('Priority Ordering', () => {
  it('Dropdown wins over Click for combobox', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'SELECT', ariaRole: 'listbox', stableId: 'sel-prio', accessibleName: 'Status' };
    runtime.process(makeEvent('c1', 'click', target));
    // Complete with a change event
    runtime.process(makeEvent('ch1', 'change', target, {}, { valueAfter: 'Active' }));
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Dropdown');
  });

  it('Checkbox wins over Click for checkbox input', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('c1', 'click', { tag: 'INPUT', ariaRole: 'checkbox', stableId: 'chk1' }, { inputType: 'checkbox' }),
    );
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Checkbox');
  });
});
