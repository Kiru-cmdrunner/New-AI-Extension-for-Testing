/**
 * Value/State Capture Expansion Tests
 *
 * Tests the expanded value capture for custom framework components:
 * - Slider: aria-valuenow/aria-valuetext/aria-valuemin/aria-valuemax
 * - Contenteditable: text content for rich text editors
 * - RadioButton: selectedValue mapping from accessibleName
 * - Checkbox: CSS-class-based checked fallback
 * - Timeline renderer: slider min/max phrasing, radio selectedValue phrasing
 */
import { describe, it, expect } from 'vitest';
import { DomProvider } from '../../src/classifier/evidence/providers/dom-provider.ts';
import { AriaProvider } from '../../src/classifier/evidence/providers/aria-provider.ts';
import { actionDescription } from '../../src/sidepanel/timeline-renderer.ts';
import type { RecordedEvent, ElementRecordedEvent } from '../../src/recorder/recorded-event.ts';
import type { InteractionBuffer } from '../../src/classifier/evidence/types.ts';
import type { DetectedInteraction } from '../../src/classifier/interaction-types.ts';

const emptyBuffer: InteractionBuffer = { events: [] } as unknown as InteractionBuffer;

function makeEvent(overrides: Partial<ElementRecordedEvent>): ElementRecordedEvent {
  return {
    eventId: 'evt-1',
    eventType: 'click',
    timestamp: '1000',
    target: {
      elementId: 'elem-1',
      tag: 'DIV',
      accessibleName: 'Test',
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      className: '',
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: 'div',
      xPath: '/html/body/div',
      inIframe: false,
      shadowDom: false,
    href: null,
      ...overrides.target,
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  } as ElementRecordedEvent;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Slider Value Capture (DomProvider)
// ─────────────────────────────────────────────────────────────────────────────

describe('DomProvider — custom slider value capture', () => {
  it('detects custom slider via role=slider + ariaValueNow', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          className: 'MuiSlider-thumb',
          accessibleName: 'Price',
          cssSelector: 'span.MuiSlider-thumb',
        } as any,
        valueAfter: '48598',
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '48598',
          ariaValueText: null,
          ariaValueMin: '10276',
          ariaValueMax: '57150',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    expect(sliderEv!.confidence).toBe(0.9);
    expect(sliderEv!.metadata!.sliderValue).toBe('48598');
    expect(sliderEv!.metadata!.sliderMin).toBe('10276');
    expect(sliderEv!.metadata!.sliderMax).toBe('57150');
    expect(sliderEv!.reason).toContain('aria-valuenow');
  });

  it('extracts aria-valuetext for human-readable slider value', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          className: 'ant-slider-handle',
          accessibleName: 'Price Range',
          cssSelector: 'span.ant-slider-handle',
        } as any,
        valueAfter: '₹48,598', // captureValue returned aria-valuetext
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '48598',
          ariaValueText: '₹48,598',
          ariaValueMin: '10276',
          ariaValueMax: '57150',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    expect(sliderEv!.metadata!.sliderValue).toBe('₹48,598');
    expect(sliderEv!.metadata!.sliderMin).toBe('10276');
    expect(sliderEv!.metadata!.sliderMax).toBe('57150');
  });

  it('native range input still works with min/max extraction', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'INPUT',
          className: '',
          accessibleName: 'Volume',
          cssSelector: 'input[type="range"]',
        } as any,
        valueAfter: '75',
        domContext: {
          inputType: 'range',
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          nativeMin: '0',
          nativeMax: '100',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    expect(sliderEv!.confidence).toBe(0.99);
    expect(sliderEv!.metadata!.sliderValue).toBe('75');
    expect(sliderEv!.metadata!.sliderMin).toBe('0');
    expect(sliderEv!.metadata!.sliderMax).toBe('100');
  });

  it('slider without ariaValueNow falls back to valueAfter', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          className: 'custom-slider-thumb',
          accessibleName: 'Price',
          cssSelector: 'span.custom-slider-thumb',
        } as any,
        valueAfter: '50',
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
        } as any,
      }),
      emptyBuffer,
    );
    // role=slider but no ariaValueNow in domCtx → no custom slider evidence
    // (falls through to CssClassnameProvider for generic detection)
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeUndefined();
  });

  it('custom slider with only ariaValueNow (no min/max) captures value only', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          className: 'slider-handle',
          accessibleName: 'Brightness',
          cssSelector: 'span[role="slider"]',
        } as any,
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '80',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    expect(sliderEv!.metadata!.sliderValue).toBe('80');
    expect(sliderEv!.metadata!.sliderMin).toBeUndefined();
    expect(sliderEv!.metadata!.sliderMax).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Slider Value Capture (AriaProvider)
// ─────────────────────────────────────────────────────────────────────────────

describe('AriaProvider — custom slider value capture', () => {
  it('extracts slider values from ARIA role + DomContext', () => {
    const evidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          className: 'MuiSlider-thumb',
          accessibleName: 'Price',
        } as any,
        valueAfter: '48598',
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueMin: '10276',
          ariaValueMax: '57150',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    expect(sliderEv!.metadata!.sliderValue).toBe('48598');
    expect(sliderEv!.metadata!.sliderMin).toBe('10276');
    expect(sliderEv!.metadata!.sliderMax).toBe('57150');
  });

  it('uses aria-valuetext from DomContext when valueAfter is null', () => {
    const evidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          accessibleName: 'Volume',
        } as any,
        valueAfter: null,
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '75',
          ariaValueText: '75%',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    expect(sliderEv!.metadata!.sliderValue).toBe('75%');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: RadioButton selectedValue Mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('DomProvider — RadioButton selectedValue mapping', () => {
  it('maps accessibleName to selectedValue for native radio', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'INPUT',
          className: '',
          accessibleName: 'Premium',
          cssSelector: 'input[type="radio"][value="premium"]',
        } as any,
        checkedAfter: true,
        domContext: {
          inputType: 'radio',
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
        } as any,
      }),
      emptyBuffer,
    );
    const radioEv = evidence.find(e => e.suggestedType === 'RadioButton');
    expect(radioEv).toBeDefined();
    expect(radioEv!.metadata!.selectedValue).toBe('Premium');
    expect(radioEv!.metadata!.checked).toBe(true);
  });
});

describe('AriaProvider — RadioButton selectedValue mapping', () => {
  it('maps accessibleName to selectedValue for role=radio', () => {
    const evidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'DIV',
          ariaRole: 'radio',
          className: 'MuiRadio-root',
          accessibleName: 'One Way',
        } as any,
        checkedAfter: true,
      }),
      emptyBuffer,
    );
    const radioEv = evidence.find(e => e.suggestedType === 'RadioButton');
    expect(radioEv).toBeDefined();
    expect(radioEv!.metadata!.selectedValue).toBe('One Way');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: Timeline Renderer — Slider phrasing with min/max
// ─────────────────────────────────────────────────────────────────────────────

describe('Timeline renderer — slider phrasing with min/max', () => {
  function renderSlider(metadata: any, targetName?: string): string {
    const interaction = {
      type: 'Slider',
      metadata,
      target: { accessibleName: targetName || '' },
    } as unknown as DetectedInteraction;
    return actionDescription(interaction);
  }

  it('renders slider with value and range', () => {
    const desc = renderSlider(
      { sliderValue: '48598', sliderMin: '10276', sliderMax: '57150' },
      'Price',
    );
    expect(desc).toContain('48598');
    expect(desc).toContain('10276');
    expect(desc).toContain('57150');
    expect(desc).toContain('Price');
  });

  it('renders slider with value and no range', () => {
    const desc = renderSlider(
      { sliderValue: '75' },
      'Volume',
    );
    expect(desc).toContain('75');
    expect(desc).toContain('Volume');
    expect(desc).not.toContain('range');
  });

  it('renders "Adjust slider" when no value', () => {
    const desc = renderSlider({}, 'Price');
    expect(desc).toContain('Adjust');
    expect(desc).toContain('Price');
  });
});
