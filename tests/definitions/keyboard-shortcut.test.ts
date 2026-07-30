/**
 * Unit Tests: Keyboard Shortcut Definition
 *
 * Tests modifier shortcuts (Ctrl+S, Cmd+K), special keys (Escape, Enter,
 * Tab, arrows), text input exclusion, and key normalization.
 *
 * Architecture: `.drytis/specs/p0-4-keyboard-shortcuts.md`
 */

import { describe, it, expect } from 'vitest';
import { keyboardShortcutDefinition, formatShortcut, normalizeKeyForPlaywright } from '../../src/definitions/keyboard-shortcut';
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
  eventType: BrowserEventType,
  target: Partial<ElementIdentity> = {},
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType,
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

// ── formatShortcut / normalizeKeyForPlaywright Tests ─────────────────

describe('formatShortcut', () => {
  it('formats Ctrl+S', () => {
    expect(formatShortcut('s', true, false, false, false)).toBe('Ctrl+S');
  });

  it('formats Cmd+K (Mac)', () => {
    expect(formatShortcut('k', false, true, false, false)).toBe('Cmd+K');
  });

  it('formats Ctrl+Shift+P', () => {
    expect(formatShortcut('P', true, false, false, true)).toBe('Ctrl+Shift+P');
  });

  it('formats Escape (no modifier)', () => {
    expect(formatShortcut('Escape', false, false, false, false)).toBe('Escape');
  });

  it('formats Space', () => {
    expect(formatShortcut(' ', false, false, false, false)).toBe('Space');
  });

  it('does not show Shift for plain Shift+letter', () => {
    expect(formatShortcut('A', false, false, false, true)).toBe('A');
  });
});

describe('normalizeKeyForPlaywright', () => {
  it('formats Ctrl+S for Playwright', () => {
    expect(normalizeKeyForPlaywright('s', true, false, false, false)).toBe('Control+s');
  });

  it('formats Cmd+K for Playwright', () => {
    expect(normalizeKeyForPlaywright('k', false, true, false, false)).toBe('Meta+k');
  });

  it('formats Escape for Playwright', () => {
    expect(normalizeKeyForPlaywright('Escape', false, false, false, false)).toBe('Escape');
  });
});

// ── Definition Trigger Tests ─────────────────────────────────────────

describe('KeyboardShortcut Definition — Trigger', () => {
  it('triggers on Ctrl+S (modifier+key)', () => {
    const event = makeEvent('e1', 'keydown', {}, {}, {
      key: 's', code: 'KeyS', ctrlKey: true,
    });
    const result = keyboardShortcutDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'KeyboardShortcut' });
  });

  it('triggers on Cmd+K (metaKey)', () => {
    const event = makeEvent('e1', 'keydown', {}, {}, {
      key: 'k', code: 'KeyK', metaKey: true,
    });
    const result = keyboardShortcutDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'KeyboardShortcut' });
  });

  it('triggers on Shift+Tab', () => {
    const event = makeEvent('e1', 'keydown', {}, {}, {
      key: 'Tab', code: 'Tab', shiftKey: true,
    });
    const result = keyboardShortcutDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'KeyboardShortcut' });
  });

  it('triggers on Escape (special key, no modifier)', () => {
    const event = makeEvent('e1', 'keydown', {}, {}, {
      key: 'Escape', code: 'Escape',
    });
    const result = keyboardShortcutDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'KeyboardShortcut' });
  });

  it('triggers on Enter outside text input', () => {
    const event = makeEvent('e1', 'keydown', {
      tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn-1',
    }, {}, {
      key: 'Enter', code: 'Enter',
    });
    const result = keyboardShortcutDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'KeyboardShortcut' });
  });

  it('triggers on ArrowDown', () => {
    const event = makeEvent('e1', 'keydown', {
      tag: 'DIV', accessibleName: 'List Item',
    }, {}, {
      key: 'ArrowDown', code: 'ArrowDown',
    });
    const result = keyboardShortcutDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'KeyboardShortcut' });
  });

  it('triggers on Ctrl+Shift+P (triple modifier)', () => {
    const event = makeEvent('e1', 'keydown', {}, {}, {
      key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true,
    });
    const result = keyboardShortcutDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'KeyboardShortcut' });
  });

  it('triggers on F5', () => {
    const event = makeEvent('e1', 'keydown', {}, {}, {
      key: 'F5', code: 'F5',
    });
    const result = keyboardShortcutDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'KeyboardShortcut' });
  });
});

describe('KeyboardShortcut Definition — Non-Trigger', () => {
  it('does NOT trigger on bare modifier press (Ctrl alone)', () => {
    const event = makeEvent('e1', 'keydown', {}, {}, {
      key: 'Control', code: 'ControlLeft', ctrlKey: true,
    });
    expect(keyboardShortcutDefinition.detectTrigger(event)).toBeNull();
  });

  it('does NOT trigger on regular letter key without modifiers', () => {
    const event = makeEvent('e1', 'keydown', {}, {}, {
      key: 'a', code: 'KeyA',
    });
    expect(keyboardShortcutDefinition.detectTrigger(event)).toBeNull();
  });

  it('does NOT trigger on Enter inside a text input', () => {
    const event = makeEvent('e1', 'keydown', {
      tag: 'INPUT', ariaRole: 'textbox', stableId: 'search',
    }, { inputType: 'search' }, {
      key: 'Enter', code: 'Enter',
    });
    expect(keyboardShortcutDefinition.detectTrigger(event)).toBeNull();
  });

  it('does NOT trigger on Enter inside textarea', () => {
    const event = makeEvent('e1', 'keydown', {
      tag: 'TEXTAREA', ariaRole: 'textbox',
    }, {}, {
      key: 'Enter', code: 'Enter',
    });
    expect(keyboardShortcutDefinition.detectTrigger(event)).toBeNull();
  });

  it('DOES trigger on Escape inside text input', () => {
    const event = makeEvent('e1', 'keydown', {
      tag: 'INPUT', ariaRole: 'textbox', stableId: 'search',
    }, { inputType: 'search' }, {
      key: 'Escape', code: 'Escape',
    });
    expect(keyboardShortcutDefinition.detectTrigger(event)).toEqual({ type: 'KeyboardShortcut' });
  });

  it('DOES trigger on Ctrl+B inside text input (modifier in editor)', () => {
    const event = makeEvent('e1', 'keydown', {
      tag: 'DIV', isContentEditable: true,
    }, { isContentEditable: true }, {
      key: 'b', code: 'KeyB', ctrlKey: true,
    });
    expect(keyboardShortcutDefinition.detectTrigger(event)).toEqual({ type: 'KeyboardShortcut' });
  });
});

// ── Metadata Tests ──────────────────────────────────────────────────

describe('KeyboardShortcut Definition — Metadata', () => {
  it('captures shortcut key, code, and modifier flags', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'keydown', {}, {}, {
        key: 's', code: 'KeyS', ctrlKey: true,
      }),
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('KeyboardShortcut');
    expect(emitted[0].metadata.shortcutKey).toBe('Ctrl+S');
    expect(emitted[0].metadata.keyValue).toBe('s');
    expect(emitted[0].metadata.keyCode).toBe('KeyS');
    expect(emitted[0].metadata.hasCtrl).toBe(true);
    expect(emitted[0].metadata.hasShift).toBe(false);
    expect(emitted[0].metadata.hasAlt).toBe(false);
    expect(emitted[0].metadata.playwrightKey).toBe('Control+s');
  });

  it('captures Escape metadata', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'keydown', {}, {}, {
        key: 'Escape', code: 'Escape',
      }),
    );

    expect(emitted[0].metadata.shortcutKey).toBe('Escape');
    expect(emitted[0].metadata.keyValue).toBe('Escape');
    expect(emitted[0].metadata.hasCtrl).toBe(false);
    expect(emitted[0].metadata.playwrightKey).toBe('Escape');
  });

  it('sets interactionSubtype for modifier shortcuts', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'keydown', {}, {}, {
        key: 'k', code: 'KeyK', metaKey: true,
      }),
    );

    expect(emitted[0].interactionSubtype).toBe('ModifierShortcut');
  });

  it('sets interactionSubtype for special keys', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'keydown', {}, {}, {
        key: 'F5', code: 'F5',
      }),
    );

    expect(emitted[0].interactionSubtype).toBe('SpecialKey');
  });
});

// ── Priority and Integration ─────────────────────────────────────────

describe('KeyboardShortcut Definition — Integration', () => {
  it('has priority 5 (first definition)', () => {
    expect(keyboardShortcutDefinition.priority).toBe(5);
  });

  it('is registered in ALL_DEFINITIONS', () => {
    expect(ALL_DEFINITIONS).toContain(keyboardShortcutDefinition);
  });
});

// ── No Regression ────────────────────────────────────────────────────

describe('KeyboardShortcut Definition — No Regression', () => {
  it('normal click still produces Click', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'click', { tag: 'BUTTON', accessibleName: 'Save', stableId: 'save-btn' }),
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
  });

  it('text entry still works for typing in input', () => {
    const { runtime, emitted } = setupRuntime();

    const target = { tag: 'INPUT', ariaRole: 'textbox', stableId: 'name', accessibleName: 'Name' };
    const ctx = { inputType: 'text' };

    runtime.process(makeEvent('f1', 'focus', target, ctx));
    runtime.process(makeEvent('i1', 'input', target, ctx, { valueAfter: 'John' }));
    runtime.process(makeEvent('b1', 'blur', target, ctx, { valueAfter: 'John' }));

    const textEntry = emitted.find((e) => e.type === 'TextEntry');
    expect(textEntry).toBeDefined();
    expect(textEntry!.metadata.textValue).toBe('John');
  });
});
