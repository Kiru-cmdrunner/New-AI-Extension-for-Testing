/**
 * Slider Drag Tests (P0-10)
 *
 * Validates the enhanced Slider definition's three trigger paths:
 * 1. Mousedown → drag (ARIA slider with mousemove tracking)
 * 2. Click (native range input / track click)
 * 3. Focus (keyboard interaction)
 *
 * Also verifies value extraction (ARIA vs native), subtype classification,
 * and click-after-drag suppression.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions/index';
import type {
  ComponentInteraction,
  ObservedEvent,
  DomContext,
  BrowserEventType,
} from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: '',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '',
    xPath: '',
    inIframe: false,
    shadowDom: false,
    elementId: '',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
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
    surfaceType: null,
    surfaceRole: null,
    surfaceLabel: null,
    ariaValueNow: null,
    ariaValueText: null,
    ariaValueMin: null,
    ariaValueMax: null,
    nativeMin: null,
    nativeMax: null,
    surfaceId: null,
    surfaceOpenedBy: null,
    ...overrides,
  };
}

function makeEvent(
  eventType: BrowserEventType,
  targetOverrides: Partial<ElementIdentity> = {},
  domOverrides: Partial<DomContext> = {},
  extra: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    timestamp: Date.now() + Math.random(),
    isTrusted: true,
    target: makeTarget(targetOverrides),
    domContext: makeDomContext(domOverrides),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Test',
    ...extra,
  };
}

function setupRuntime(): { runtime: ComponentRuntime; emitted: ComponentInteraction[] } {
  const emitted: ComponentInteraction[] = [];
  const runtime = createRuntime(ALL_DEFINITIONS, {
    onEmit: (i) => emitted.push(i),
  });
  return { runtime, emitted };
}

const SLIDER_TARGET = makeTarget({
  tag: 'DIV',
  ariaRole: 'slider',
  accessibleName: 'Volume',
  ariaLabel: 'Volume',
});

const SLIDER_DOM = (valueNow: string) =>
  makeDomContext({
    ariaValueNow: valueNow,
    ariaValueMin: '0',
    ariaValueMax: '100',
  });

// ── Tests ──────────────────────────────────────────────────────────────

describe('Slider Drag — ARIA Slider (mousedown → drag → mouseup)', () => {
  let runtime: ComponentRuntime;
  let emitted: ComponentInteraction[];

  beforeEach(() => {
    ({ runtime, emitted } = setupRuntime());
  });

  it('captures start/end values from a drag (mousedown → mousemove → mouseup → click)', () => {
    // mousedown at value 25
    runtime.process(
      makeEvent('mousedown', SLIDER_TARGET, SLIDER_DOM('25'), {
        clientX: 100,
        clientY: 200,
      }),
    );

    // mousemove at value 50
    runtime.process(
      makeEvent('mousemove', SLIDER_TARGET, SLIDER_DOM('50'), {
        clientX: 200,
        clientY: 200,
      }),
    );

    // mousemove at value 75
    runtime.process(
      makeEvent('mousemove', SLIDER_TARGET, SLIDER_DOM('75'), {
        clientX: 300,
        clientY: 200,
      }),
    );

    // mouseup at value 75
    runtime.process(
      makeEvent('mouseup', SLIDER_TARGET, SLIDER_DOM('75'), {
        clientX: 300,
        clientY: 200,
      }),
    );

    // click after drag
    runtime.process(
      makeEvent('click', SLIDER_TARGET, SLIDER_DOM('75')),
    );

    const slider = emitted.find((i) => i.type === 'Slider');
    expect(slider).toBeDefined();
    expect(slider!.endState).toBe('completed');
    expect(slider!.interactionSubtype).toBe('AriaSlider');
    expect(slider!.metadata.startValue).toBe('25');
    expect(slider!.metadata.endValue).toBe('75');
    expect(slider!.metadata.sliderValue).toBe('75');
    expect(slider!.metadata.min).toBe('0');
    expect(slider!.metadata.max).toBe('100');
    expect(slider!.metadata.dragTracked).toBe(true);
  });

  it('captures click value when mousedown+mouseup without mousemove (no drag)', () => {
    // mousedown at value 30
    runtime.process(
      makeEvent('mousedown', SLIDER_TARGET, SLIDER_DOM('30'), {
        clientX: 150,
        clientY: 200,
      }),
    );

    // mouseup immediately (no mousemove)
    runtime.process(
      makeEvent('mouseup', SLIDER_TARGET, SLIDER_DOM('30'), {
        clientX: 150,
        clientY: 200,
      }),
    );

    // click
    runtime.process(
      makeEvent('click', SLIDER_TARGET, SLIDER_DOM('30')),
    );

    const slider = emitted.find((i) => i.type === 'Slider');
    expect(slider).toBeDefined();
    expect(slider!.endState).toBe('completed');
    expect(slider!.metadata.sliderValue).toBe('30');
    expect(slider!.metadata.dragTracked).toBe(false);
  });
});

describe('Slider — Native Range Input (click)', () => {
  let runtime: ComponentRuntime;
  let emitted: ComponentInteraction[];

  beforeEach(() => {
    ({ runtime, emitted } = setupRuntime());
  });

  it('captures native range click value and sets NativeSlider subtype', () => {
    const NATIVE_TARGET = makeTarget({
      tag: 'INPUT',
      ariaRole: null,
      accessibleName: 'Brightness',
    });
    const NATIVE_DOM = makeDomContext({
      inputType: 'range',
      nativeMin: '0',
      nativeMax: '100',
    });

    runtime.process(
      makeEvent('click', NATIVE_TARGET, NATIVE_DOM, {
        valueBefore: '25',
        valueAfter: '60',
      }),
    );

    const slider = emitted.find((i) => i.type === 'Slider');
    expect(slider).toBeDefined();
    expect(slider!.endState).toBe('completed');
    expect(slider!.interactionSubtype).toBe('NativeSlider');
    expect(slider!.metadata.sliderValue).toBe('60');
    expect(slider!.metadata.min).toBe('0');
    expect(slider!.metadata.max).toBe('100');
    expect(slider!.metadata.dragTracked).toBe(false);
  });
});

describe('Slider — Native Range Input (mousedown → drag)', () => {
  let runtime: ComponentRuntime;
  let emitted: ComponentInteraction[];

  beforeEach(() => {
    ({ runtime, emitted } = setupRuntime());
  });

  it('captures drag on native range input', () => {
    const NATIVE_TARGET = makeTarget({
      tag: 'INPUT',
      ariaRole: null,
      accessibleName: 'Price Range',
    });
    const NATIVE_DOM_START = makeDomContext({
      inputType: 'range',
      nativeMin: '0',
      nativeMax: '500',
    });

    // mousedown
    runtime.process(
      makeEvent('mousedown', NATIVE_TARGET, NATIVE_DOM_START, {
        clientX: 50,
        clientY: 100,
        valueBefore: '100',
        valueAfter: '100',
      }),
    );

    // mousemove
    runtime.process(
      makeEvent('mousemove', NATIVE_TARGET, NATIVE_DOM_START, {
        clientX: 150,
        clientY: 100,
        valueBefore: '100',
        valueAfter: '250',
      }),
    );

    // mouseup
    runtime.process(
      makeEvent('mouseup', NATIVE_TARGET, NATIVE_DOM_START, {
        clientX: 150,
        clientY: 100,
        valueBefore: '250',
        valueAfter: '250',
      }),
    );

    // click after drag
    runtime.process(
      makeEvent('click', NATIVE_TARGET, NATIVE_DOM_START, {
        valueBefore: '250',
        valueAfter: '250',
      }),
    );

    const slider = emitted.find((i) => i.type === 'Slider');
    expect(slider).toBeDefined();
    expect(slider!.endState).toBe('completed');
    expect(slider!.interactionSubtype).toBe('NativeSlider');
    expect(slider!.metadata.dragTracked).toBe(true);
    expect(slider!.metadata.min).toBe('0');
    expect(slider!.metadata.max).toBe('500');
    expect(slider!.metadata.startValue).toBe('100');
    expect(slider!.metadata.endValue).toBe('250');
    expect(slider!.metadata.sliderValue).toBe('250');
  });
});

describe('Slider — Focus (keyboard)', () => {
  let runtime: ComponentRuntime;
  let emitted: ComponentInteraction[];

  beforeEach(() => {
    ({ runtime, emitted } = setupRuntime());
  });

  it('captures focus-based slider value', () => {
    runtime.process(
      makeEvent('focus', SLIDER_TARGET, SLIDER_DOM('42')),
    );

    const slider = emitted.find((i) => i.type === 'Slider');
    expect(slider).toBeDefined();
    expect(slider!.endState).toBe('completed');
    expect(slider!.metadata.sliderValue).toBe('42');
    expect(slider!.metadata.startValue).toBe('42');
    expect(slider!.metadata.endValue).toBe('42');
  });
});

describe('Slider — Regression Tests', () => {
  let runtime: ComponentRuntime;
  let emitted: ComponentInteraction[];

  beforeEach(() => {
    ({ runtime, emitted } = setupRuntime());
  });

  it('does NOT trigger on non-slider elements', () => {
    const BTN = makeTarget({ tag: 'BUTTON', ariaRole: 'button' });
    runtime.process(makeEvent('mousedown', BTN, makeDomContext()));
    runtime.process(makeEvent('mouseup', BTN, makeDomContext()));
    runtime.process(makeEvent('click', BTN, makeDomContext()));

    const slider = emitted.find((i) => i.type === 'Slider');
    expect(slider).toBeUndefined();
  });

  it('does NOT trigger on non-slider mousedown', () => {
    const LINK = makeTarget({ tag: 'A', ariaRole: 'link' });
    runtime.process(makeEvent('mousedown', LINK, makeDomContext()));

    const slider = emitted.find((i) => i.type === 'Slider');
    expect(slider).toBeUndefined();
  });

  it('suppresses click-after-drag (no spurious Click interaction)', () => {
    // mousedown on slider
    runtime.process(
      makeEvent('mousedown', SLIDER_TARGET, SLIDER_DOM('25'), {
        clientX: 100,
        clientY: 200,
      }),
    );

    // mousemove
    runtime.process(
      makeEvent('mousemove', SLIDER_TARGET, SLIDER_DOM('50'), {
        clientX: 200,
        clientY: 200,
      }),
    );

    // mouseup
    runtime.process(
      makeEvent('mouseup', SLIDER_TARGET, SLIDER_DOM('50'), {
        clientX: 200,
        clientY: 200,
      }),
    );

    // click after drag
    runtime.process(
      makeEvent('click', SLIDER_TARGET, SLIDER_DOM('50')),
    );

    // Should have exactly ONE Slider interaction, no Click
    const sliders = emitted.filter((i) => i.type === 'Slider');
    const clicks = emitted.filter((i) => i.type === 'Click');
    expect(sliders).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });
});
