/**
 * Evidence Engine — Provider Unit Tests
 *
 * Tests each provider in isolation using mock events.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DomProvider } from '../../src/classifier/evidence/providers/dom-provider.ts';
import { AriaProvider } from '../../src/classifier/evidence/providers/aria-provider.ts';
import { EventSequenceProvider } from '../../src/classifier/evidence/providers/event-sequence-provider.ts';
import { MutationProvider } from '../../src/classifier/evidence/providers/mutation-provider.ts';
import type { InteractionBuffer } from '../../src/classifier/evidence/types.ts';
import type { RecordedEvent } from '../../src/recorder/recorded-event.ts';
import {
  clickEvent, focusEvent, blurEvent, changeEvent,
  scrollEvent, dblclickEvent, mouseenterEvent,
  resetEventCounter,
} from './helpers.ts';

function makeBuffer(events: RecordedEvent[]): InteractionBuffer {
  return {
    elementKey: 'test',
    events,
    evidence: [],
    startTime: events[0]?.timestamp ?? new Date().toISOString(),
    lastEventTime: events[events.length - 1]?.timestamp ?? new Date().toISOString(),
  };
}

function emptyBuffer(): InteractionBuffer {
  return {
    elementKey: 'test',
    events: [],
    evidence: [],
    startTime: new Date().toISOString(),
    lastEventTime: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOM PROVIDER
// ═══════════════════════════════════════════════════════════════════════════════

describe('DomProvider', () => {
  let provider: DomProvider;

  beforeEach(() => {
    provider = new DomProvider();
    resetEventCounter();
  });

  it('detects native <select> as NativeDropdown with high confidence', () => {
    const event = clickEvent({ tag: 'SELECT', cssSelector: 'select#country' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const dropdown = evidence.find(e => e.suggestedType === 'NativeDropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.confidence).toBeGreaterThanOrEqual(0.99);
    expect(dropdown!.weight).toBe(1.0);
  });

  it('detects native checkbox via type=checkbox in cssSelector', () => {
    const event = clickEvent({ tag: 'INPUT', cssSelector: 'input[type="checkbox"]' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const checkbox = evidence.find(e => e.suggestedType === 'Checkbox');
    expect(checkbox).toBeDefined();
    expect(checkbox!.confidence).toBeGreaterThanOrEqual(0.99);
    expect(checkbox!.weight).toBe(1.0);
  });

  it('detects native radio via type=radio in cssSelector', () => {
    const event = clickEvent({ tag: 'INPUT', cssSelector: 'input[type="radio"]' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const radio = evidence.find(e => e.suggestedType === 'RadioButton');
    expect(radio).toBeDefined();
    expect(radio!.confidence).toBeGreaterThanOrEqual(0.99);
  });

  it('detects native date input as DatePicker', () => {
    const event = changeEvent({ tag: 'INPUT', cssSelector: 'input[type="date"]' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const date = evidence.find(e => e.suggestedType === 'DatePicker');
    expect(date).toBeDefined();
    expect(date!.confidence).toBeGreaterThanOrEqual(0.99);
  });

  it('detects <textarea> as TextEntry', () => {
    const event = focusEvent({ tag: 'TEXTAREA', cssSelector: 'textarea#comments' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const text = evidence.find(e => e.suggestedType === 'TextEntry');
    expect(text).toBeDefined();
  });

  it('detects <a> link as Link', () => {
    const event = clickEvent({ tag: 'A', cssSelector: 'a[href="/about"]' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const link = evidence.find(e => e.suggestedType === 'Link');
    expect(link).toBeDefined();
    expect(link!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('returns empty for div with no special attributes', () => {
    const event = clickEvent({ tag: 'DIV', cssSelector: 'div.container' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    expect(evidence).toHaveLength(0);
  });

  it('onCommit reinforces TextEntry when focus→blur on text element', () => {
    const focus = focusEvent(
      { tag: 'INPUT', cssSelector: 'input[type="text"]' },
      { valueBefore: '' },
    );
    const blur = blurEvent(
      { tag: 'INPUT', cssSelector: 'input[type="text"]' },
      { valueAfter: 'hello world' },
    );
    const buffer = makeBuffer([focus, blur]);
    const evidence = provider.onCommit(buffer);
    const textEntry = evidence.find(e => e.suggestedType === 'TextEntry');
    expect(textEntry).toBeDefined();
    expect(textEntry!.metadata?.textValue).toBe('hello world');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ARIA PROVIDER
// ═══════════════════════════════════════════════════════════════════════════════

describe('AriaProvider', () => {
  let provider: AriaProvider;

  beforeEach(() => {
    provider = new AriaProvider();
    resetEventCounter();
  });

  it('detects role=checkbox as Checkbox', () => {
    const event = clickEvent({ ariaRole: 'checkbox' });
    const evidence = provider.onEvent(event, emptyBuffer());
    const checkbox = evidence.find(e => e.suggestedType === 'Checkbox');
    expect(checkbox).toBeDefined();
    expect(checkbox!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('detects role=combobox as CustomDropdown', () => {
    const event = clickEvent({ ariaRole: 'combobox' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const dropdown = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('detects role=switch with aria-checked as ToggleSwitch', () => {
    const event = clickEvent({
      ariaRole: 'switch',
      cssSelector: '[role="switch"][aria-checked="true"]',
    });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const toggle = evidence.find(e => e.suggestedType === 'ToggleSwitch');
    expect(toggle).toBeDefined();
  });

  it('detects aria-haspopup="listbox" as dropdown signal', () => {
    const event = clickEvent({
      cssSelector: '[aria-haspopup="listbox"]',
    });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const dropdown = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('detects role=tab as Tab', () => {
    const event = clickEvent({ ariaRole: 'tab' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const tab = evidence.find(e => e.suggestedType === 'Tab');
    expect(tab).toBeDefined();
  });

  it('returns empty for elements with no ARIA attributes', () => {
    const event = clickEvent({ ariaRole: '', cssSelector: 'div.card' });
    const evidence = provider.onEvent(event, emptyBuffer());
    expect(evidence).toHaveLength(0);
  });

  it('onCommit detects complete combobox → option pattern', () => {
    const comboboxClick = clickEvent(
      { ariaRole: 'combobox', elementId: 'el-combobox' },
    );
    const optionClick = clickEvent(
      { ariaRole: 'option', elementId: 'el-option', accessibleName: 'India' },
    );
    const change = changeEvent(
      { ariaRole: 'combobox', elementId: 'el-combobox' },
      { valueAfter: 'India' },
    );
    const buffer = makeBuffer([comboboxClick, optionClick, change]);
    const evidence = provider.onCommit(buffer);
    const dropdown = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata?.selectedValue).toBe('India');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT SEQUENCE PROVIDER
// ═══════════════════════════════════════════════════════════════════════════════

describe('EventSequenceProvider', () => {
  let provider: EventSequenceProvider;

  beforeEach(() => {
    provider = new EventSequenceProvider();
    resetEventCounter();
  });

  it('detects dblclick as DoubleClick with high confidence', () => {
    const event = dblclickEvent();
    const evidence = provider.onEvent(event, makeBuffer([event]));
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('DoubleClick');
    expect(evidence[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('detects scroll on HTML as PageScroll', () => {
    const event = scrollEvent({ tag: 'HTML' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('PageScroll');
  });

  it('detects scroll on DIV as ContainerScroll', () => {
    const event = scrollEvent({ tag: 'DIV' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    const scroll = evidence.find(e => e.suggestedType === 'ContainerScroll');
    expect(scroll).toBeDefined();
  });

  it('detects mouseenter as Hover', () => {
    const event = mouseenterEvent();
    const evidence = provider.onEvent(event, makeBuffer([event]));
    expect(evidence).toHaveLength(1);
    expect(evidence[0].suggestedType).toBe('Hover');
  });

  it('onCommit detects focus→blur as TextEntry', () => {
    const focus = focusEvent(
      { tag: 'INPUT', cssSelector: 'input#email' },
      { valueBefore: '' },
    );
    const blur = blurEvent(
      { tag: 'INPUT', cssSelector: 'input#email' },
      { valueAfter: 'test@test.com' },
    );
    const buffer = makeBuffer([focus, blur]);
    const evidence = provider.onCommit(buffer);
    const textEntry = evidence.find(e => e.suggestedType === 'TextEntry');
    expect(textEntry).toBeDefined();
    expect(textEntry!.metadata?.textValue).toBe('test@test.com');
  });

  it('onCommit detects click→change as NativeDropdown', () => {
    const click = clickEvent({ tag: 'SELECT', cssSelector: 'select#country' });
    const change = changeEvent(
      { tag: 'SELECT', cssSelector: 'select#country' },
      { valueAfter: 'India' },
    );
    const buffer = makeBuffer([click, change]);
    const evidence = provider.onCommit(buffer);
    const dropdown = evidence.find(e => e.suggestedType === 'NativeDropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata?.selectedValue).toBe('India');
  });

  it('onCommit detects single click as Click (weak)', () => {
    const click = clickEvent({ accessibleName: 'Submit' });
    const buffer = makeBuffer([click]);
    const evidence = provider.onCommit(buffer);
    const clickEvidence = evidence.find(e => e.suggestedType === 'Click');
    expect(clickEvidence).toBeDefined();
    expect(clickEvidence!.metadata?.accessibleName).toBe('Submit');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// MUTATION PROVIDER
// ═══════════════════════════════════════════════════════════════════════════════

describe('MutationProvider', () => {
  let provider: MutationProvider;

  beforeEach(() => {
    provider = new MutationProvider();
    resetEventCounter();
  });

  it('returns no real-time evidence (commit-only provider)', () => {
    const event = clickEvent({ ariaRole: 'combobox' });
    const evidence = provider.onEvent(event, makeBuffer([event]));
    expect(evidence).toHaveLength(0);
  });

  it('onCommit detects trigger click → option interaction as dropdown', () => {
    const trigger = clickEvent({
      ariaRole: 'combobox',
      cssSelector: '[role="combobox"][aria-expanded="true"]',
      elementId: 'el-trigger',
    });
    const option = clickEvent({
      ariaRole: 'option',
      elementId: 'el-option',
      accessibleName: 'Option B',
    });
    const buffer = makeBuffer([trigger, option]);
    const evidence = provider.onCommit(buffer);
    const dropdown = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata?.selectedValue).toBe('Option B');
  });

  it('onCommit detects aria-expanded true→false cycle as dropdown', () => {
    const open = clickEvent({
      cssSelector: '[aria-expanded="true"]',
      elementId: 'el-dd',
    });
    const close = changeEvent({
      cssSelector: '[aria-expanded="false"]',
      elementId: 'el-dd',
      ariaRole: 'combobox',
    });
    const buffer = makeBuffer([open, close]);
    const evidence = provider.onCommit(buffer);
    const dropdown = evidence.find(e => e.suggestedType === 'CustomDropdown');
    expect(dropdown).toBeDefined();
  });

  it('returns empty for simple click without popup lifecycle', () => {
    const click = clickEvent({ tag: 'BUTTON' });
    const buffer = makeBuffer([click]);
    const evidence = provider.onCommit(buffer);
    expect(evidence).toHaveLength(0);
  });
});
