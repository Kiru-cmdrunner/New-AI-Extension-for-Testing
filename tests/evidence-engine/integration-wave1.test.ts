/**
 * Integration Foundation + Wave 1 Tests
 *
 * Tests that DomContext enrichment flows through the engine correctly
 * and that Wave 1 interaction types (Click, Checkbox, RadioButton) are
 * detected accurately using first-class DomContext fields.
 *
 * The key validation: providers should use domContext.inputType instead
 * of regex-hacking cssSelector. These tests prove that works.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2, createEngine } from '../../src/classifier/evidence/detector.ts';
import { DomProvider } from '../../src/classifier/evidence/providers/dom-provider.ts';
import { AriaProvider } from '../../src/classifier/evidence/providers/aria-provider.ts';
import { EventSequenceProvider } from '../../src/classifier/evidence/providers/event-sequence-provider.ts';
import type { DetectedInteraction } from '../../src/classifier/interaction-types.ts';
import {
  clickEvent,
  focusEvent,
  blurEvent,
  changeEvent,
  inputEvent,
  navigationEvent,
  resetEventCounter,
  domContext,
  checkboxDomContext,
  radioDomContext,
  textInputDomContext,
  dateInputDomContext,
  comboboxDomContext,
} from './helpers.ts';

// ── Helpers ─────────────────────────────────────────────────────────────

function getWave1Interactions(events: Parameters<typeof detectInteractionsV2>[0]): DetectedInteraction[] {
  return detectInteractionsV2(events);
}

// ── DomContext enrichment ───────────────────────────────────────────────

describe('DomContext enrichment', () => {
  beforeEach(() => resetEventCounter());

  it('detects checkbox via domContext.inputType without any cssSelector hint', () => {
    // Simulate: a checkbox click with cssSelector that gives NO type hint
    // (just the element path). The only way to know it's a checkbox is domContext.inputType.
    const events = [
      clickEvent(
        { tag: 'INPUT', cssSelector: 'body > form > label:nth-child(1) > input' },
        { checkedAfter: true, domContext: checkboxDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Checkbox');
    expect(result[0].confidence).toBeGreaterThan(0.5);
  });

  it('detects radio button via domContext.inputType without any cssSelector hint', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', cssSelector: 'body > form > fieldset > label:nth-child(1) > input' },
        { checkedAfter: true, domContext: radioDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('RadioButton');
  });

  it('detects text entry via domContext.inputType', () => {
    const events = [
      focusEvent(
        { tag: 'INPUT', cssSelector: '#phone' },
        { valueBefore: '', domContext: textInputDomContext() },
      ),
      blurEvent(
        { tag: 'INPUT', cssSelector: '#phone' },
        { valueAfter: '555-1234', domContext: textInputDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
    expect(result[0].metadata?.textValue).toBe('555-1234');
  });

  it('detects date picker via domContext.inputType=date', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', cssSelector: '#appointment-date' },
        { valueAfter: '2024-03-15', domContext: dateInputDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DatePicker');
  });

  it('domContext.ariaExpanded=true contributes CustomDropdown evidence', () => {
    const events = [
      clickEvent(
        { tag: 'DIV', ariaRole: null, cssSelector: '#my-widget' },
        { domContext: comboboxDomContext(true) },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    // With ariaExpanded but no role, DomProvider won't match but AriaProvider should
    expect(result[0].confidence).toBeGreaterThan(0);
  });

  it('domContext.isContentEditable=true triggers TextEntry detection', () => {
    const events = [
      focusEvent(
        { tag: 'DIV', cssSelector: '.editor' },
        { domContext: domContext({ isContentEditable: true }) },
      ),
      blurEvent(
        { tag: 'DIV', cssSelector: '.editor' },
        { valueAfter: 'Hello world', domContext: domContext({ isContentEditable: true }) },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('TextEntry');
  });
});

// ── Wave 1: Click ───────────────────────────────────────────────────────

describe('Wave 1 — Click detection', () => {
  beforeEach(() => resetEventCounter());

  it('detects a simple click on a button', () => {
    const events = [
      clickEvent({ tag: 'BUTTON', accessibleName: 'Submit', cssSelector: '#submit-btn' }),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Click');
    expect(result[0].metadata?.accessibleName).toBe('Submit');
  });

  it('detects a click on a div (generic element)', () => {
    const events = [
      clickEvent({ tag: 'DIV', accessibleName: 'Card', cssSelector: '.card' }),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    // Divs get Click from EventSequenceProvider (single click, no other signals)
    expect(result[0].type).toBe('Click');
  });

  it('separates two clicks on different elements into two interactions', () => {
    const events = [
      clickEvent({ tag: 'BUTTON', accessibleName: 'A', cssSelector: '#btn-a' }),
      clickEvent({ tag: 'BUTTON', accessibleName: 'B', cssSelector: '#btn-b' }),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(2);
    expect(result[0].metadata?.accessibleName).toBe('A');
    expect(result[1].metadata?.accessibleName).toBe('B');
  });

  it('link click with <a> tag produces Link type', () => {
    const events = [
      clickEvent({ tag: 'A', accessibleName: 'Home', cssSelector: 'nav > a:first-child' }),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Link');
  });
});

// ── Wave 1: Checkbox ────────────────────────────────────────────────────

describe('Wave 1 — Checkbox detection', () => {
  beforeEach(() => resetEventCounter());

  it('detects checkbox check via domContext.inputType=checkbox', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Accept terms', cssSelector: '#terms' },
        { checkedAfter: true, domContext: checkboxDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Checkbox');
    expect(result[0].metadata?.checked).toBe(true);
  });

  it('detects checkbox uncheck', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Newsletter', cssSelector: '#newsletter' },
        { checkedBefore: true, checkedAfter: false, domContext: checkboxDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Checkbox');
    expect(result[0].metadata?.checked).toBe(false);
  });

  it('detects checkbox via ARIA role=checkbox (no inputType)', () => {
    const events = [
      clickEvent(
        { tag: 'DIV', ariaRole: 'checkbox', accessibleName: 'Custom checkbox', cssSelector: '.cb' },
        { checkedAfter: true },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Checkbox');
  });

  it('multiple checkbox toggles produce separate interactions', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Option 1', cssSelector: '#cb1' },
        { checkedAfter: true, domContext: checkboxDomContext() },
      ),
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Option 2', cssSelector: '#cb2' },
        { checkedAfter: true, domContext: checkboxDomContext() },
      ),
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Option 3', cssSelector: '#cb3' },
        { checkedAfter: true, domContext: checkboxDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(3);
    expect(result.every(r => r.type === 'Checkbox')).toBe(true);
  });
});

// ── Wave 1: RadioButton ─────────────────────────────────────────────────

describe('Wave 1 — RadioButton detection', () => {
  beforeEach(() => resetEventCounter());

  it('detects radio selection via domContext.inputType=radio', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Blue', cssSelector: '#color-blue' },
        { checkedAfter: true, domContext: radioDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('RadioButton');
  });

  it('detects radio via ARIA role=radio', () => {
    const events = [
      clickEvent(
        { tag: 'DIV', ariaRole: 'radio', accessibleName: 'Option A', cssSelector: '.radio-a' },
        { checkedAfter: true },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('RadioButton');
  });

  it('selecting different radios in same group produces separate interactions', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Small', cssSelector: '#size-s' },
        { checkedAfter: true, domContext: radioDomContext() },
      ),
      clickEvent(
        { tag: 'INPUT', accessibleName: 'Large', cssSelector: '#size-l' },
        { checkedAfter: true, domContext: radioDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.type === 'RadioButton')).toBe(true);
  });
});

// ── Backwards compatibility (events without domContext) ─────────────────

describe('Backwards compatibility — events without domContext', () => {
  beforeEach(() => resetEventCounter());

  it('falls back to cssSelector for checkbox detection', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', cssSelector: 'input[type="checkbox"]' },
        { checkedAfter: true },
        // No domContext — should still work via cssSelector fallback
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Checkbox');
  });

  it('falls back to cssSelector for radio detection', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', cssSelector: 'input[type="radio"]' },
        { checkedAfter: true },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('RadioButton');
  });

  it('falls back to cssSelector for date input detection', () => {
    const events = [
      clickEvent(
        { tag: 'INPUT', cssSelector: 'input[type="date"]' },
        { valueAfter: '2024-01-15' },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DatePicker');
  });
});

// ── DomContext priority over cssSelector ────────────────────────────────

describe('DomContext takes priority over cssSelector', () => {
  beforeEach(() => resetEventCounter());

  it('uses domContext.inputType even when cssSelector has conflicting type', () => {
    // Edge case: cssSelector says type="text" but domContext.inputType says "checkbox"
    // This can happen with libraries that override input rendering.
    // domContext should win because it's captured from the live element.
    const events = [
      clickEvent(
        { tag: 'INPUT', cssSelector: 'input[type="text"]' },
        { checkedAfter: true, domContext: checkboxDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Checkbox');
  });

  it('uses domContext.ariaExpanded instead of cssSelector regex', () => {
    const events = [
      clickEvent(
        { tag: 'DIV', ariaRole: null, cssSelector: '.trigger[data-foo="bar"]' },
        { domContext: domContext({ ariaExpanded: true, ariaHasPopup: 'listbox' }) },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    // Should detect dropdown-like behavior from domContext, not cssSelector
    expect(result[0].confidence).toBeGreaterThan(0);
  });
});

// ── Navigation + element events ─────────────────────────────────────────

describe('Navigation events in the stream', () => {
  beforeEach(() => resetEventCounter());

  it('navigation before click produces separate interactions', () => {
    const events = [
      navigationEvent('https://example.com'),
      clickEvent({ tag: 'BUTTON', accessibleName: 'Search', cssSelector: '#search-btn' }),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('PageNavigation');
    expect(result[1].type).toBe('Click');
  });

  it('navigation after click flushes the click buffer', () => {
    const events = [
      clickEvent({ tag: 'BUTTON', accessibleName: 'Submit', cssSelector: '#submit' }),
      navigationEvent('https://example.com/results'),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('Click');
    expect(result[1].type).toBe('PageNavigation');
  });
});

// ── Engine with custom provider sets ────────────────────────────────────

describe('Engine with custom providers', () => {
  beforeEach(() => resetEventCounter());

  it('works with only DomProvider', () => {
    const engine = createEngine([new DomProvider()]);
    const events = [
      clickEvent(
        { tag: 'INPUT', cssSelector: '#cb' },
        { checkedAfter: true, domContext: checkboxDomContext() },
      ),
    ];

    const result = engine.detect(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Checkbox');
  });

  it('works with only AriaProvider', () => {
    const engine = createEngine([new AriaProvider()]);
    const events = [
      clickEvent(
        { tag: 'DIV', ariaRole: 'checkbox', cssSelector: '.cb', accessibleName: 'Custom CB' },
        { checkedAfter: true },
      ),
    ];

    const result = engine.detect(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Checkbox');
  });

  it('works with only EventSequenceProvider (fallback to Click)', () => {
    const engine = createEngine([new EventSequenceProvider()]);
    const events = [
      clickEvent({ tag: 'DIV', cssSelector: '.clickable' }),
    ];

    const result = engine.detect(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Click');
  });

  it('multiple providers reinforce evidence', () => {
    // Checkbox with ALL three providers agreeing
    const events = [
      clickEvent(
        {
          tag: 'INPUT',
          ariaRole: 'checkbox',
          cssSelector: 'input[type="checkbox"]',
          accessibleName: 'I agree',
        },
        { checkedAfter: true, domContext: checkboxDomContext() },
      ),
    ];

    const result = getWave1Interactions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Checkbox');
    // With 3+ providers agreeing, confidence should be high
    expect(result[0].confidence).toBeGreaterThan(0.8);
  });
});
