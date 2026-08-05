/**
 * G8 ColorInput Definition — Unit & Integration Tests
 *
 * Tests the color picker lifecycle:
 *   focus (trigger) → input/change (accumulate value) → blur (complete)
 *
 * Key property: userAdjusted is ONLY true when value differs from original.
 * This filters:
 *   - Focus-only traversal (tab through without selecting)
 *   - Same-color re-selection
 *   - Cancel (no change event)
 *
 * Architecture: .drytis/specs/m0a-architecture-validation.md §2.3 (G8)
 */

import { describe, it, expect } from 'vitest';
import { colorInputDefinition } from '../../src/definitions/color-input';
import { isProductionInteraction, toIRAction } from '../../src/presentation/output-adapter';
import type { ObservedEvent, ComponentInteraction, ComponentContext } from '../../src/shared/component-types';
import { ALL_DEFINITIONS } from '../../src/definitions';

// ── Helpers ───────────────────────────────────────────────────────────

function makeFocusEvent(
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: 'evt-1',
    eventType: 'focus',
    timestamp: 1000,
    isTrusted: true,
    target: {
      tag: 'INPUT',
      inputType: 'color',
      cssSelector: 'input[type="color"]',
      stableId: 'color-1',
      ariaRole: null,
      accessibleName: 'Favorite Color',
      ariaLabel: 'Favorite Color',
      placeholder: null,
      textContent: null,
      className: '',
      href: null,
      shadowDom: false,
    },
    domContext: {
      inputType: 'color',
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: [],
      tabIndex: null,
    },
    valueBefore: '#ff0000',
    valueAfter: '#ff0000',
    checkedBefore: null,
    checkedAfter: null,
    clientX: 0,
    clientY: 0,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaX: 0,
    scrollDeltaY: 0,
    pageUrl: 'https://example.com',
    pageTitle: 'Test Page',
    ...overrides,
  };
}

function makeInputEvent(
  valueAfter: string,
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeFocusEvent({
    eventId: 'evt-2',
    eventType: 'input',
    timestamp: 2000,
    valueAfter,
    valueBefore: '#ff0000',
    ...overrides,
  });
}

function makeBlurEvent(
  valueAfter: string,
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeFocusEvent({
    eventId: 'evt-3',
    eventType: 'blur',
    timestamp: 3000,
    valueAfter,
    valueBefore: '#ff0000',
    ...overrides,
  });
}

function makeContext(
  trigger: ObservedEvent,
  data: Record<string, unknown> = {},
): ComponentContext {
  return {
    trigger: {
      type: 'ColorInput',
      stableId: trigger.target.stableId,
      cssSelector: trigger.target.cssSelector,
      accessibleName: trigger.target.accessibleName,
      ariaLabel: trigger.target.ariaLabel,
      placeholder: trigger.target.placeholder,
      tag: trigger.target.tag,
      ariaRole: trigger.target.ariaRole,
    },
    triggerEvent: trigger,
    memberEvents: [],
    allEvents: [trigger],
    data,
  };
}

// ── detectTrigger ─────────────────────────────────────────────────────

describe('G8 ColorInput — detectTrigger', () => {
  const def = colorInputDefinition;

  it('triggers on focus of input[type=color]', () => {
    const event = makeFocusEvent();
    expect(def.detectTrigger(event)).not.toBeNull();
    expect(def.detectTrigger(event)!.type).toBe('ColorInput');
  });

  it('rejects non-color input', () => {
    const base = makeFocusEvent();
    const event = makeFocusEvent({ domContext: { ...base.domContext, inputType: 'text' } });
    expect(def.detectTrigger(event)).toBeNull();
  });

  it('rejects non-INPUT tag', () => {
    const event = makeFocusEvent({ target: { ...makeFocusEvent().target, tag: 'DIV' } });
    expect(def.detectTrigger(event)).toBeNull();
  });

  it('rejects click event even on color input', () => {
    const event = makeFocusEvent({ eventType: 'click' });
    expect(def.detectTrigger(event)).toBeNull();
  });
});

// ── isInScope ─────────────────────────────────────────────────────────

describe('G8 ColorInput — isInScope', () => {
  const def = colorInputDefinition;

  it('accepts input event on same element', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const inputEvent = makeInputEvent('#00ff00');
    expect(def.isInScope(inputEvent, ctx)).toBe(true);
  });

  it('accepts change event on same element', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const changeEvent = makeInputEvent('#00ff00', { eventType: 'change' });
    expect(def.isInScope(changeEvent, ctx)).toBe(true);
  });

  it('accepts blur event on same element', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const blurEvent = makeBlurEvent('#00ff00');
    expect(def.isInScope(blurEvent, ctx)).toBe(true);
  });

  it('rejects event on different element', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const otherEvent = makeInputEvent('#00ff00', {
      target: { ...makeFocusEvent().target, stableId: 'other', cssSelector: '#other' },
    });
    expect(def.isInScope(otherEvent, ctx)).toBe(false);
  });

  it('rejects non-lifecycle event type', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const scrollEvent = makeFocusEvent({ eventType: 'scroll' });
    expect(def.isInScope(scrollEvent, ctx)).toBe(false);
  });
});

// ── handleEvent ───────────────────────────────────────────────────────

describe('G8 ColorInput — handleEvent value tracking', () => {
  const def = colorInputDefinition;

  it('sets userAdjusted=true when value differs on input', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const inputEvent = makeInputEvent('#00ff00');
    def.handleEvent(inputEvent, ctx);
    expect(ctx.data.userAdjusted).toBe(true);
    expect(ctx.data.finalValue).toBe('#00ff00');
  });

  it('does NOT set userAdjusted when value is same on input', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const inputEvent = makeInputEvent('#ff0000'); // same as before
    def.handleEvent(inputEvent, ctx);
    expect(ctx.data.userAdjusted).not.toBe(true);
  });

  it('blur fallback detects change even if input event was missed', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    // Simulate: no input/change event, just blur with different value
    const blurEvent = makeBlurEvent('#00ff00');
    const result = def.handleEvent(blurEvent, ctx);
    expect(ctx.data.finalValue).toBe('#00ff00');
    expect(ctx.data.userAdjusted).toBe(true);
    expect(result).toEqual({ endState: 'completed' });
  });

  it('blur without change sets finalValue but not userAdjusted', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const blurEvent = makeBlurEvent('#ff0000'); // same
    const result = def.handleEvent(blurEvent, ctx);
    expect(ctx.data.finalValue).toBe('#ff0000');
    expect(ctx.data.userAdjusted).not.toBe(true);
    expect(result).toEqual({ endState: 'completed' });
  });
});

// ── shouldCancelOnOutside ─────────────────────────────────────────────

describe('G8 ColorInput — shouldCancelOnOutside', () => {
  const def = colorInputDefinition;

  it('does NOT cancel when clicking same element (swatch area)', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const clickEvent = makeFocusEvent({ eventType: 'click', eventId: 'evt-click' });
    expect(def.shouldCancelOnOutside(clickEvent, ctx)).toBe(false);
  });

  it('cancels when clicking elsewhere', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const clickEvent = makeFocusEvent({
      eventType: 'click',
      eventId: 'evt-click',
      target: { ...makeFocusEvent().target, stableId: 'other', cssSelector: '#other' },
    });
    expect(def.shouldCancelOnOutside(clickEvent, ctx)).toBe(true);
  });
});

// ── buildResult ───────────────────────────────────────────────────────

describe('G8 ColorInput — buildResult', () => {
  const def = colorInputDefinition;

  it('produces correct metadata for adjusted color', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger, { userAdjusted: true, finalValue: '#00ff00' });
    const result = def.buildResult(ctx, { endState: 'completed' });
    expect(result.metadata.targetName).toBe('Favorite Color');
    expect(result.metadata.value).toBe('#00ff00');
    expect(result.metadata.userAdjusted).toBe(true);
  });

  it('falls back to triggerValue when no finalValue', () => {
    const trigger = makeFocusEvent();
    const ctx = makeContext(trigger);
    const result = def.buildResult(ctx, { endState: 'completed' });
    expect(result.metadata.value).toBe('#ff0000');
    expect(result.metadata.userAdjusted).toBe(false);
  });
});

// ── Production Filter ─────────────────────────────────────────────────

describe('G8 ColorInput — isProductionInteraction', () => {
  function makeInteraction(
    metadata: Record<string, unknown>,
    endState = 'completed',
  ): ComponentInteraction {
    return {
      interactionId: 'int-1',
      type: 'ColorInput',
      trigger: makeFocusEvent().target,
      triggerEvent: makeFocusEvent(),
      timestamp: 1000,
      endState,
      metadata,
      memberEventIds: ['evt-1', 'evt-2', 'evt-3'],
    } as unknown as ComponentInteraction;
  }

  it('passes when userAdjusted=true', () => {
    expect(isProductionInteraction(makeInteraction({ userAdjusted: true }))).toBe(true);
  });

  it('filters when userAdjusted=false', () => {
    expect(isProductionInteraction(makeInteraction({ userAdjusted: false }))).toBe(false);
  });

  it('filters when userAdjusted is absent', () => {
    expect(isProductionInteraction(makeInteraction({}))).toBe(false);
  });

  it('filters when endState is abandoned', () => {
    expect(isProductionInteraction(
      makeInteraction({ userAdjusted: true }, 'abandoned'),
    )).toBe(false);
  });
});

// ── toIRAction ────────────────────────────────────────────────────────

describe('G8 ColorInput — toIRAction', () => {
  it('produces FILL action with color value', () => {
    const interaction = {
      interactionId: 'int-1',
      type: 'ColorInput',
      trigger: makeFocusEvent().target,
      triggerEvent: makeFocusEvent(),
      timestamp: 1000,
      endState: 'completed',
      metadata: { targetName: 'Favorite Color', value: '#00ff00', userAdjusted: true },
      memberEventIds: ['evt-1'],
    } as unknown as ComponentInteraction;

    const action = toIRAction(interaction);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('FILL');
    expect(action!.value).toBe('#00ff00');
    expect(action!.target.name).toBe('Favorite Color');
  });
});

// ── Registry ──────────────────────────────────────────────────────────

describe('G8 ColorInput — registry', () => {
  it('is registered in ALL_DEFINITIONS at priority 15', () => {
    const found = ALL_DEFINITIONS.find((d) => d.type === 'ColorInput');
    expect(found).toBeDefined();
    expect(found!.priority).toBe(15);
  });
});
