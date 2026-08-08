/**
 * G5 Spinbutton — Slider Lifecycle Reuse for role="spinbutton"
 *
 * Tests that role="spinbutton" elements trigger the Slider lifecycle,
 * correctly capture aria-valuenow changes, and filter focus-only traversal.
 *
 * Design: spinbutton is functionally identical to Slider at the physical
 * layer (focus trigger → value accumulation → blur complete). No new
 * interaction type is created. The single line `ariaRole === 'spinbutton'`
 * in isSlider() makes the entire Slider lifecycle available.
 *
 * Separate +/- buttons remain Click interactions (verified by test 7).
 *
 * Architecture: .drytis/specs/pre-capability-g4-g6-g8-g15.md (G5)
 */

import { describe, it, expect } from 'vitest';
import { isSlider } from '../../src/definitions/patterns';
import { sliderDefinition } from '../../src/definitions/slider';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { isProductionInteraction, toIRAction } from '../../src/presentation/output-adapter';
import type { ObservedEvent, ComponentInteraction, ComponentContext, BrowserEventType } from '../../src/shared/component-types';
import { makeElementIdentity, makeObservedEvent } from '../helpers/fixtures';

// ── Helpers ───────────────────────────────────────────────────────────

function makeSpinbuttonFocusEvent(
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId: 'evt-1',
    eventType: 'focus',
    target: makeElementIdentity({
      tag: 'DIV',
      cssSelector: 'div[role="spinbutton"]',
      stableId: 'spin-qty',
      ariaRole: 'spinbutton',
      accessibleName: 'Quantity',
      ariaLabel: 'Quantity',
      className: 'quantity-value',
    }),
    domContext: { inputType: null, tabIndex: 0 },
    valueBefore: '5',
    ...overrides,
  });
}

function makeInputOrChangeEvent(
  eventType: BrowserEventType,
  valueAfter: string,
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeSpinbuttonFocusEvent({
    eventId: 'evt-2',
    eventType,
    timestamp: 2000,
    valueBefore: '5',
    valueAfter,
    ...overrides,
  });
}

function makeBlurEvent(
  valueAfter: string,
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeSpinbuttonFocusEvent({
    eventId: 'evt-3',
    eventType: 'blur',
    timestamp: 3000,
    valueAfter,
    valueBefore: '5',
    ...overrides,
  });
}

function makeContext(
  trigger: ObservedEvent,
  data: Record<string, unknown> = {},
): ComponentContext {
  return {
    type: 'Slider',
    state: 'active',
    lifecycleId: 'lc-001',
    trigger: trigger.target,
    triggerEvent: trigger,
    memberEvents: [],
    scopeKeys: new Set([trigger.target.elementId]),
    startTime: trigger.timestamp,
    endTime: 0,
    data,
  };
}

function makeInteraction(
  metadata: Record<string, unknown>,
  endState = 'completed',
): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: 'Slider',
    trigger: makeSpinbuttonFocusEvent().target,
    triggerEvent: makeSpinbuttonFocusEvent(),
    timestamp: 1000,
    endState,
    metadata,
    memberEventIds: ['evt-1', 'evt-2', 'evt-3'],
  } as unknown as ComponentInteraction;
}

// ── Test 1: isSlider recognizes spinbutton ───────────────────────────

describe('G5 Spinbutton — isSlider', () => {
  it('test 1: isSlider returns true for role="spinbutton"', () => {
    expect(isSlider('DIV', null, 'spinbutton')).toBe(true);
  });

  it('test 11: isSlider returns false for unrelated role', () => {
    expect(isSlider('DIV', null, 'button')).toBe(false);
    expect(isSlider('DIV', null, 'textbox')).toBe(false);
  });

  it('test 14: isSlider returns true for INPUT type=number with role=spinbutton', () => {
    // Some frameworks put role="spinbutton" on native <input type="number">
    expect(isSlider('INPUT', 'number', 'spinbutton')).toBe(true);
  });

  it('isSlider still returns true for standard range input', () => {
    expect(isSlider('INPUT', 'range', null)).toBe(true);
    expect(isSlider('DIV', null, 'slider')).toBe(true);
  });
});

// ── Test 2: detectTrigger fires on spinbutton focus ──────────────────

describe('G5 Spinbutton — detectTrigger', () => {
  it('test 2: triggers on focus of role="spinbutton"', () => {
    const event = makeSpinbuttonFocusEvent();
    expect(sliderDefinition.detectTrigger(event)).not.toBeNull();
    expect(sliderDefinition.detectTrigger(event)!.type).toBe('Slider');
  });

  it('test 12: does NOT trigger on focus of element without aria-valuenow (still triggers — lifecycle handles filtering)', () => {
    // detectTrigger only checks isSlider — it doesn't inspect aria-valuenow.
    // The lifecycle will handle filtering via userAdjusted check.
    const event = makeSpinbuttonFocusEvent({
      target: {
        ...makeSpinbuttonFocusEvent().target,
        ariaRole: 'spinbutton',
      },
    });
    expect(sliderDefinition.detectTrigger(event)).not.toBeNull();
  });
});

// ── Tests 3-6: handleEvent value tracking ────────────────────────────

describe('G5 Spinbutton — handleEvent lifecycle', () => {
  const def = sliderDefinition;

  it('test 3: ArrowUp without input/change — blur detects aria-valuenow change', () => {
    // App updates aria-valuenow from 5 to 6 but does not dispatch input/change.
    // captureValue at blur time reads aria-valuenow=6.
    const trigger = makeSpinbuttonFocusEvent({ valueBefore: '5' });
    const ctx = makeContext(trigger);
    const blurEvent = makeBlurEvent('6');

    def.handleEvent(blurEvent, ctx);
    expect(ctx.data.userAdjusted).toBe(true);
    expect(ctx.data.finalValue).toBe('6');
  });

  it('test 4: focus-only traversal — blur value equals original', () => {
    // User tabbed to the spinbutton, didn't press anything, tabbed away.
    // captureValue at blur reads aria-valuenow=5 (unchanged).
    const trigger = makeSpinbuttonFocusEvent({ valueBefore: '5' });
    const ctx = makeContext(trigger);
    const blurEvent = makeBlurEvent('5');

    def.handleEvent(blurEvent, ctx);
    expect(ctx.data.userAdjusted).not.toBe(true);
    expect(ctx.data.finalValue).toBe('5');
  });

  it('test 5: app dispatches input/change events', () => {
    const trigger = makeSpinbuttonFocusEvent({ valueBefore: '5' });
    const ctx = makeContext(trigger);

    def.handleEvent(makeInputOrChangeEvent('input', '6'), ctx);
    expect(ctx.data.userAdjusted).toBe(true);
    expect(ctx.data.finalValue).toBe('6');

    // Then blur
    def.handleEvent(makeBlurEvent('6'), ctx);
    expect(ctx.data.userAdjusted).toBe(true);
  });

  it('test 6: same value via input/change — still records as adjusted', () => {
    // If app dispatches input event with same value, Slider marks userAdjusted=true.
    // This is semantically correct: an input event fired, meaning something happened.
    const trigger = makeSpinbuttonFocusEvent({ valueBefore: '5' });
    const ctx = makeContext(trigger);

    def.handleEvent(makeInputOrChangeEvent('input', '5'), ctx);
    expect(ctx.data.userAdjusted).toBe(true);
    expect(ctx.data.finalValue).toBe('5');
  });

  it('test 13: multiple ArrowUp presses — final value captured at last blur', () => {
    const trigger = makeSpinbuttonFocusEvent({ valueBefore: '5' });
    const ctx = makeContext(trigger);

    // 5 → 6 → 7 → 8 (three key presses, three input events)
    def.handleEvent(makeInputOrChangeEvent('input', '6'), ctx);
    def.handleEvent(makeInputOrChangeEvent('input', '7'), ctx);
    def.handleEvent(makeInputOrChangeEvent('input', '8'), ctx);
    def.handleEvent(makeBlurEvent('8'), ctx);

    expect(ctx.data.finalValue).toBe('8');
    expect(ctx.data.userAdjusted).toBe(true);
  });
});

// ── Test 7: +/- buttons remain separate Click interactions ───────────

describe('G5 Spinbutton — separate +/- buttons are NOT consumed', () => {
  const def = sliderDefinition;

  it('test 7: click on separate +/− button cancels spinbutton lifecycle', () => {
    const trigger = makeSpinbuttonFocusEvent();
    const ctx = makeContext(trigger);

    const plusButtonClick = makeSpinbuttonFocusEvent({
      eventId: 'evt-plus',
      eventType: 'click',
      target: {
        ...makeSpinbuttonFocusEvent().target,
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Increase quantity',
        stableId: 'btn-plus',
        cssSelector: 'button[aria-label="Increase quantity"]',
      },
    });

    // Click on a DIFFERENT element should return true (cancel)
    expect(def.shouldCancelOnOutside(plusButtonClick, ctx)).toBe(true);
  });
});

// ── Tests 8-10: Production filter and IR mapping ─────────────────────

describe('G5 Spinbutton — production filter & IR mapping', () => {
  it('test 8: filters when userAdjusted=false (focus-only traversal)', () => {
    expect(isProductionInteraction(makeInteraction({ userAdjusted: false }))).toBe(false);
  });

  it('test 9: passes when userAdjusted=true (actual adjustment)', () => {
    expect(isProductionInteraction(makeInteraction({ userAdjusted: true }))).toBe(true);
  });

  it('test 10: toIRAction produces FILL with aria-valuenow value', () => {
    const interaction = makeInteraction({
      targetName: 'Quantity',
      value: '6',
      userAdjusted: true,
    });
    const action = toIRAction(interaction);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('FILL');
    expect(action!.value).toBe('6');
    expect(action!.target.name).toBe('Quantity');
    expect(action!.target.tag).toBe('DIV');
    expect(action!.target.role).toBe('spinbutton');
  });
});

// ── Test 15: Registry integration ────────────────────────────────────

describe('G5 Spinbutton — registry', () => {
  it('test 15: Slider definition handles spinbutton (no separate definition needed)', () => {
    const sliderDef = ALL_DEFINITIONS.find((d) => d.type === 'Slider');
    expect(sliderDef).toBeDefined();
    expect(sliderDef!.priority).toBe(25);

    // Spinbutton is handled by isSlider() returning true for role="spinbutton",
    // which means the Slider lifecycle's detectTrigger will fire.
    expect(isSlider('DIV', null, 'spinbutton')).toBe(true);
  });
});
