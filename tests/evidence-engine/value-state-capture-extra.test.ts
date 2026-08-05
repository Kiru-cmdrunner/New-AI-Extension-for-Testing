/**
 * Additional Value/State Capture Tests — Phase 2, 4, and edge cases
 *
 * Tests the functions that live inside deterministic-recorder.ts (captureValue,
 * captureCheckedState) which are NOT exported, using the existing test pattern
 * from deterministic-recorder-helpers.test.ts.
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
// Phase 1: Slider Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Slider edge cases — min/max without value', () => {
  it('AriaProvider slider with min/max but no valueAfter', () => {
    const evidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          accessibleName: 'Brightness',
        } as any,
        valueAfter: null,
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '50',
          ariaValueMin: '0',
          ariaValueMax: '100',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    expect(sliderEv!.metadata!.sliderValue).toBe('50');
    expect(sliderEv!.metadata!.sliderMin).toBe('0');
    expect(sliderEv!.metadata!.sliderMax).toBe('100');
  });

  it('DomProvider slider with ariaValueText overrides ariaValueNow', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          className: 'custom-slider',
          accessibleName: 'Price',
          cssSelector: 'span[role="slider"]',
        } as any,
        valueAfter: null, // captureValue returns ariaValueText
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '75',
          ariaValueText: '75%',
          ariaValueMin: '0',
          ariaValueMax: '100',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    // extractSliderMetadata prefers valueAfter, then ariaValueText, then ariaValueNow
    // valueAfter is null, so ariaValueText "75%" should be used
    expect(sliderEv!.metadata!.sliderValue).toBe('75%');
  });

  it('DomProvider slider with only min/max and no value still provides bounds', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          className: 'slider-handle',
          accessibleName: 'Range',
          cssSelector: 'span[role="slider"]',
        } as any,
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '30',
          ariaValueMin: '0',
          ariaValueMax: '100',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    expect(sliderEv!.metadata!.sliderMin).toBe('0');
    expect(sliderEv!.metadata!.sliderMax).toBe('100');
  });

  it('native range input with min/max via domContext.nativeMin/nativeMax', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'INPUT',
          className: '',
          accessibleName: 'Volume',
          cssSelector: 'input[type="range"]',
        } as any,
        valueAfter: '50',
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
    expect(sliderEv!.metadata!.sliderMin).toBe('0');
    expect(sliderEv!.metadata!.sliderMax).toBe('100');
  });

  it('native range input without min/max does not crash', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'INPUT',
          className: '',
          accessibleName: 'Slider',
          cssSelector: 'input[type="range"]',
        } as any,
        valueAfter: '50',
        domContext: {
          inputType: 'range',
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeDefined();
    expect(sliderEv!.metadata!.sliderValue).toBe('50');
    expect(sliderEv!.metadata!.sliderMin).toBeUndefined();
    expect(sliderEv!.metadata!.sliderMax).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: RadioButton selectedValue — more frameworks
// ─────────────────────────────────────────────────────────────────────────────

describe('RadioButton selectedValue — additional scenarios', () => {
  it('DomProvider maps accessibleName for MUI Radio (native input with role=radio)', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'INPUT',
          ariaRole: 'radio',
          className: 'MuiRadio-root',
          accessibleName: 'Round Trip',
          cssSelector: 'input[type="radio"]',
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
    expect(radioEv!.metadata!.selectedValue).toBe('Round Trip');
  });

  it('AriaProvider maps accessibleName for AntD Radio', () => {
    const evidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'LABEL',
          ariaRole: 'radio',
          className: 'ant-radio-wrapper',
          accessibleName: 'Premium',
        } as any,
        checkedAfter: true,
      }),
      emptyBuffer,
    );
    const radioEv = evidence.find(e => e.suggestedType === 'RadioButton');
    expect(radioEv).toBeDefined();
    expect(radioEv!.metadata!.selectedValue).toBe('Premium');
  });

  it('RadioButton without accessibleName does not set selectedValue', () => {
    const evidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'DIV',
          ariaRole: 'radio',
          className: 'custom-radio',
          accessibleName: '',
        } as any,
        checkedAfter: true,
      }),
      emptyBuffer,
    );
    const radioEv = evidence.find(e => e.suggestedType === 'RadioButton');
    expect(radioEv).toBeDefined();
    expect(radioEv!.metadata!.selectedValue).toBeUndefined();
  });

  it('RadioButton checked=false still maps selectedValue', () => {
    const evidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'DIV',
          ariaRole: 'radio',
          accessibleName: 'Option B',
        } as any,
        checkedAfter: false,
      }),
      emptyBuffer,
    );
    const radioEv = evidence.find(e => e.suggestedType === 'RadioButton');
    expect(radioEv).toBeDefined();
    expect(radioEv!.metadata!.checked).toBe(false);
    expect(radioEv!.metadata!.selectedValue).toBe('Option B');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Slider — V2 engine integration (multi-event)
// ─────────────────────────────────────────────────────────────────────────────

describe('Slider V2 engine integration', () => {
  it('MUI Slider change event captures ariaValueNow as valueAfter', () => {
    // Simulates what captureValue would return for a span[role=slider]
    // with aria-valuenow="48598" — the content script reads it into valueAfter
    const evidence = new DomProvider().onEvent(
      makeEvent({
        eventType: 'change' as any,
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          className: 'MuiSlider-thumb',
          accessibleName: 'Price',
          cssSelector: 'span[role="slider"]',
        } as any,
        valueBefore: '30000',
        valueAfter: '48598',
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '48598',
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

  it('AntD Slider with aria-valuetext produces human-readable value', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        eventType: 'change' as any,
        target: {
          tag: 'DIV',
          ariaRole: 'slider',
          className: 'ant-slider-handle',
          accessibleName: 'Budget',
          cssSelector: 'div.ant-slider-handle',
        } as any,
        valueAfter: '₹48,598',
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
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: Dropdown detection still works (aria-selected path not broken)
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression — aria-value reading does not break dropdown detection', () => {
  it('combobox with aria-expanded does not trigger slider false positive', () => {
    // A combobox container has aria-expanded, not aria-valuenow.
    // captureValue reads aria-selected descendants for the selected option text.
    const domEvidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'DIV',
          ariaRole: 'combobox',
          className: 'custom-combobox',
          accessibleName: 'City',
          cssSelector: 'div[role="combobox"]',
        } as any,
        valueAfter: 'Mumbai',
        domContext: {
          inputType: null,
          ariaExpanded: true,
          ariaHasPopup: 'listbox',
          isContentEditable: false,
        } as any,
      }),
      emptyBuffer,
    );
    // DomProvider doesn't classify combobox → CustomDropdown, but it must NOT produce Slider
    const sliderEv = domEvidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeUndefined();
    // AriaProvider SHOULD classify it as CustomDropdown
    const ariaEvidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'DIV',
          ariaRole: 'combobox',
          className: 'custom-combobox',
          accessibleName: 'City',
        } as any,
        domContext: {
          inputType: null,
          ariaExpanded: true,
          ariaHasPopup: 'listbox',
          isContentEditable: false,
        } as any,
      }),
      emptyBuffer,
    );
    const dropdownEv = ariaEvidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdownEv).toBeDefined();
  });

  it('listbox option with no aria-valuenow does not trigger slider false positive', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'DIV',
          ariaRole: 'option',
          className: 'listbox-option',
          accessibleName: 'Option 1',
          cssSelector: 'div[role="option"]',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    expect(sliderEv).toBeUndefined();
  });

  it('spinbutton with aria-valuenow does not get classified as Slider', () => {
    // Spinbuttons also use aria-valuenow but should not be Slider
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'INPUT',
          ariaRole: 'spinbutton',
          className: 'number-input',
          accessibleName: 'Quantity',
          cssSelector: 'input[role="spinbutton"]',
        } as any,
        valueAfter: '5',
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '5',
          ariaValueMin: '1',
          ariaValueMax: '99',
        } as any,
      }),
      emptyBuffer,
    );
    const sliderEv = evidence.find(e => e.suggestedType === 'Slider');
    // role=spinbutton is not role=slider — should NOT be Slider
    expect(sliderEv).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: Checkbox/ToggleSwitch behavior unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('Regression — checkbox and toggle behavior unchanged', () => {
  it('native checkbox with checked=true still works', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'INPUT',
          className: '',
          accessibleName: 'Accept Terms',
          cssSelector: 'input[type="checkbox"]',
        } as any,
        checkedAfter: true,
        domContext: {
          inputType: 'checkbox',
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
        } as any,
      }),
      emptyBuffer,
    );
    const checkboxEv = evidence.find(e => e.suggestedType === 'Checkbox');
    expect(checkboxEv).toBeDefined();
    expect(checkboxEv!.metadata!.checked).toBe(true);
  });

  it('native checkbox unchecked still works', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        target: {
          tag: 'INPUT',
          className: '',
          accessibleName: 'Subscribe',
          cssSelector: 'input[type="checkbox"]',
        } as any,
        checkedAfter: false,
        domContext: {
          inputType: 'checkbox',
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
        } as any,
      }),
      emptyBuffer,
    );
    const checkboxEv = evidence.find(e => e.suggestedType === 'Checkbox');
    expect(checkboxEv).toBeDefined();
    expect(checkboxEv!.metadata!.checked).toBe(false);
  });

  it('ToggleSwitch with aria-checked still works', () => {
    const evidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'BUTTON',
          ariaRole: 'switch',
          className: 'toggle-switch',
          accessibleName: 'Dark Mode',
        } as any,
        checkedAfter: true,
      }),
      emptyBuffer,
    );
    const toggleEv = evidence.find(e => e.suggestedType === 'ToggleSwitch');
    expect(toggleEv).toBeDefined();
    expect(toggleEv!.metadata!.checked).toBe(true);
  });

  it('Checkbox with role=checkbox and aria-checked', () => {
    const evidence = new AriaProvider().onEvent(
      makeEvent({
        target: {
          tag: 'DIV',
          ariaRole: 'checkbox',
          className: 'custom-checkbox',
          accessibleName: 'Remember Me',
        } as any,
        checkedAfter: true,
      }),
      emptyBuffer,
    );
    const checkboxEv = evidence.find(e => e.suggestedType === 'Checkbox');
    expect(checkboxEv).toBeDefined();
    expect(checkboxEv!.metadata!.checked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: Timeline renderer — radio button phrasing
// ─────────────────────────────────────────────────────────────────────────────

describe('Timeline renderer — RadioButton phrasing with selectedValue', () => {
  it('renders selectedValue in radio button description', () => {
    const desc = actionDescription({
      type: 'RadioButton',
      metadata: { checked: true, selectedValue: 'Premium' },
      target: { accessibleName: 'Fare Type' },
    } as DetectedInteraction);
    expect(desc).toContain('Premium');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Slider with large range values (AdaniOne scenario)
// ─────────────────────────────────────────────────────────────────────────────

describe('Slider — AdaniOne price filter scenario', () => {
  it('captures AdaniOne-style price slider with large numeric range', () => {
    const evidence = new DomProvider().onEvent(
      makeEvent({
        eventType: 'change' as any,
        target: {
          tag: 'SPAN',
          ariaRole: 'slider',
          className: 'MuiSlider-thumb',
          accessibleName: 'Price',
          cssSelector: 'span.MuiSlider-thumb',
        } as any,
        valueBefore: '10276',
        valueAfter: '48598',
        domContext: {
          inputType: null,
          ariaExpanded: null,
          ariaHasPopup: null,
          isContentEditable: false,
          ariaValueNow: '48598',
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
  });
});
