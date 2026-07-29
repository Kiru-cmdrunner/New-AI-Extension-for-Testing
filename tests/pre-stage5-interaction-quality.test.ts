/**
 * Pre-Stage 5 Interaction Quality Tests
 *
 * Tests for:
 * 1. Date picker toggle click suppression
 * 2. Hover dwell threshold + click-cancels-hover rule
 * 3. Expandable developer view rendering
 * 4. Confidence moved to developer details
 */

import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { recognizeInteractions } from '../src/recorder/v2/interaction-recognizer';
import { createDetectedInteractionElement } from '../src/sidepanel/timeline-renderer';
import type { DetectedInteraction } from '../src/classifier/interaction-types';
import type { RecordedEvent, ElementRecordedEvent } from '../src/recorder/recorded-event';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    tag: 'DIV',
    accessibleName: 'Test Element',
    ariaRole: null,
    tagText: null,
    className: null,
    id: null,
    name: null,
    type: null,
    value: null,
    stableId: null,
    cssSelector: 'div.test',
    ...overrides,
  };
}

function makeEvent(
  eventType: string,
  target: ElementIdentity,
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    timestamp: new Date().toISOString(),
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    domContext: {},
    ...overrides,
  } as ElementRecordedEvent;
}

function makeInteraction(overrides: Partial<DetectedInteraction> = {}): DetectedInteraction {
  return {
    interactionId: 'ctrl-001',
    type: 'Click',
    eventIds: ['evt-1'],
    rawEventTypes: ['click'],
    target: makeElementIdentity(),
    metadata: {},
    confidence: 1.0,
    engine: 'control' as const,
    ...overrides,
  };
}

// ── Setup DOM ─────────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.document = dom.window.document;
(global as any).window = dom.window;

// ═══════════════════════════════════════════════════════════════════════════
// FIX 1: Date Picker Toggle Suppression
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix 1: Date Picker — Single Semantic Interaction', () => {
  it('produces exactly one DatePicker interaction for a dateSelect event', () => {
    const target = makeElementIdentity({
      tag: 'INPUT',
      accessibleName: 'Date of Birth',
      ariaRole: 'textbox',
      className: 'oxd-input',
    });

    const events: RecordedEvent[] = [
      makeEvent('dateSelect', target, {
        domContext: {
          dateType: 'date',
          isoValue: '1990-05-15',
          displayValue: 'May 15, 1990',
          dateConfidence: 1.0,
        },
        valueAfter: '1990-05-15',
      }),
    ];

    const result = recognizeInteractions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DatePicker');
    expect(result[0].metadata.dateValue).toBe('1990-05-15');
    expect(result[0].confidence).toBe(1.0);
  });

  it('produces one DatePicker for native date input change', () => {
    const target = makeElementIdentity({
      tag: 'INPUT',
      accessibleName: 'License Expiry Date',
      type: 'date',
      className: 'native-date',
    });

    const events: RecordedEvent[] = [
      makeEvent('dateSelect', target, {
        domContext: {
          dateType: 'date',
          isoValue: '2025-12-31',
          displayValue: 'December 31, 2025',
          dateConfidence: 1.0,
        },
        valueAfter: '2025-12-31',
      }),
    ];

    const result = recognizeInteractions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DatePicker');
  });

  it('suppresses clicks on calendar cells (ownedByDatePicker)', () => {
    const cellTarget = makeElementIdentity({
      tag: 'BUTTON',
      accessibleName: '15',
      className: 'oxd-date-input',
    });

    const dateTarget = makeElementIdentity({
      tag: 'INPUT',
      accessibleName: 'Date of Birth',
      className: 'oxd-input',
    });

    const events: RecordedEvent[] = [
      // Click inside calendar — should be suppressed by grouper
      makeEvent('click', cellTarget, {
        domContext: { ownedByDatePicker: true },
      }),
      // The actual date selection
      makeEvent('dateSelect', dateTarget, {
        domContext: {
          dateType: 'date',
          isoValue: '1990-05-15',
          dateConfidence: 1.0,
        },
      }),
    ];

    const result = recognizeInteractions(events);
    // Only the dateSelect should produce an interaction
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('DatePicker');
  });

  it('does NOT suppress a regular click next to but not inside the date picker', () => {
    const saveTarget = makeElementIdentity({
      tag: 'BUTTON',
      accessibleName: 'Save',
      className: 'oxd-button--save',
    });

    const dateTarget = makeElementIdentity({
      tag: 'INPUT',
      accessibleName: 'Date of Birth',
      className: 'oxd-input',
    });

    const events: RecordedEvent[] = [
      makeEvent('dateSelect', dateTarget, {
        domContext: {
          dateType: 'date',
          isoValue: '1990-05-15',
          dateConfidence: 1.0,
        },
      }),
      makeEvent('click', saveTarget),
    ];

    const result = recognizeInteractions(events);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('DatePicker');
    expect(result[1].type).toBe('Click');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIX 2: Hover Suppression (Click-Cancels-Hover)
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix 2: Hover — Click-Cancels-Hover Rule', () => {
  it('suppresses hover followed by click on same element within 2000ms', () => {
    const target = makeElementIdentity({
      tag: 'BUTTON',
      accessibleName: 'Save',
      className: 'save-btn',
    });

    const hoverTime = new Date('2025-01-01T10:00:00.000Z');
    const clickTime = new Date('2025-01-01T10:00:01.000Z'); // 1s later

    const events: RecordedEvent[] = [
      { ...makeEvent('mouseenter', target), timestamp: hoverTime.toISOString() },
      { ...makeEvent('click', target), timestamp: clickTime.toISOString() },
    ];

    const result = recognizeInteractions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Click');
    // No hover in results
    expect(result.find((i) => i.type === 'Hover')).toBeUndefined();
  });

  it('suppresses hover followed by TextEntry on same element within 2000ms', () => {
    const target = makeElementIdentity({
      tag: 'INPUT',
      accessibleName: 'First Name',
      ariaRole: 'textbox',
      className: 'first-name',
    });

    const hoverTime = new Date('2025-01-01T10:00:00.000Z');
    const focusTime = new Date('2025-01-01T10:00:00.500Z'); // 500ms later
    const inputTime = new Date('2025-01-01T10:00:01.000Z');

    const events: RecordedEvent[] = [
      { ...makeEvent('mouseenter', target), timestamp: hoverTime.toISOString() },
      { ...makeEvent('focus', target), timestamp: focusTime.toISOString() },
      { ...makeEvent('input', target, { valueAfter: 'John' }), timestamp: inputTime.toISOString() },
    ];

    const result = recognizeInteractions(events);
    // Should have TextEntry only — hover suppressed
    expect(result.find((i) => i.type === 'Hover')).toBeUndefined();
    expect(result.find((i) => i.type === 'TextEntry')).toBeDefined();
  });

  it('does NOT suppress hover when followed by click on a DIFFERENT element', () => {
    const hoverTarget = makeElementIdentity({
      tag: 'DIV',
      accessibleName: 'Info Tooltip',
      className: 'tooltip',
    });

    const clickTarget = makeElementIdentity({
      tag: 'BUTTON',
      accessibleName: 'Save',
      className: 'save-btn',
    });

    const events: RecordedEvent[] = [
      makeEvent('mouseenter', hoverTarget),
      makeEvent('click', clickTarget),
    ];

    const result = recognizeInteractions(events);
    // Both should survive — different elements
    expect(result).toHaveLength(2);
    expect(result.find((i) => i.type === 'Hover')).toBeDefined();
    expect(result.find((i) => i.type === 'Click')).toBeDefined();
  });

  it('does NOT suppress hover when click is more than 2000ms later', () => {
    const target = makeElementIdentity({
      tag: 'BUTTON',
      accessibleName: 'Submit',
      className: 'submit-btn',
    });

    const hoverTime = new Date('2025-01-01T10:00:00.000Z');
    const clickTime = new Date('2025-01-01T10:00:03.000Z'); // 3s later

    const events: RecordedEvent[] = [
      { ...makeEvent('mouseenter', target), timestamp: hoverTime.toISOString() },
      { ...makeEvent('click', target), timestamp: clickTime.toISOString() },
    ];

    const result = recognizeInteractions(events);
    expect(result).toHaveLength(2);
    expect(result.find((i) => i.type === 'Hover')).toBeDefined();
    expect(result.find((i) => i.type === 'Click')).toBeDefined();
  });

  it('keeps hover when no subsequent interaction follows', () => {
    const target = makeElementIdentity({
      tag: 'DIV',
      accessibleName: 'Help Text',
      className: 'help-text',
    });

    const events: RecordedEvent[] = [
      makeEvent('mouseenter', target),
    ];

    const result = recognizeInteractions(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Hover');
  });

  it('suppresses hover followed by dropdown selection on same element', () => {
    const target = makeElementIdentity({
      tag: 'SELECT',
      accessibleName: 'Nationality',
      className: 'nationality-select',
    });

    const events: RecordedEvent[] = [
      makeEvent('mouseenter', target),
      makeEvent('change', target, { valueAfter: 'Indian' }),
    ];

    const result = recognizeInteractions(events);
    expect(result.find((i) => i.type === 'Hover')).toBeUndefined();
  });

  it('suppresses hover followed by date picker on same element', () => {
    const target = makeElementIdentity({
      tag: 'INPUT',
      accessibleName: 'Date of Birth',
      className: 'dob-input',
    });

    const events: RecordedEvent[] = [
      makeEvent('mouseenter', target),
      makeEvent('dateSelect', target, {
        domContext: {
          dateType: 'date',
          isoValue: '1990-05-15',
          dateConfidence: 1.0,
        },
      }),
    ];

    const result = recognizeInteractions(events);
    expect(result.find((i) => i.type === 'Hover')).toBeUndefined();
    expect(result.find((i) => i.type === 'DatePicker')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIX 3: Expandable Developer View
// ═══════════════════════════════════════════════════││││││══════════════════

describe('Fix 3: Expandable Developer View for Raw Evidence', () => {
  it('hides raw event types by default', () => {
    const interaction = makeInteraction({
      rawEventTypes: ['focus', 'click', 'change', 'blur'],
    });

    const el = createDetectedInteractionElement(interaction);

    // The details section should be hidden by default
    const details = el.querySelector('.interaction-details') as HTMLElement;
    expect(details).toBeTruthy();
    expect(details.hidden).toBe(true);

    // The raw event types text is inside the hidden details section
    expect(details.textContent).toContain('[focus, click, change, blur]');

    // The summary section should NOT contain raw event types
    const summary = el.querySelector('.interaction-summary') as HTMLElement;
    expect(summary).toBeTruthy();
    expect(summary.textContent).not.toContain('[focus, click, change, blur]');
  });

  it('has a Details toggle button', () => {
    const interaction = makeInteraction();
    const el = createDetectedInteractionElement(interaction);

    const toggle = el.querySelector('.interaction-details-toggle') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.textContent).toBe('▶ Details');
  });

  it('reveals raw event types when Details is clicked', () => {
    const interaction = makeInteraction({
      rawEventTypes: ['focus', 'click', 'change', 'blur'],
    });

    const el = createDetectedInteractionElement(interaction);
    const toggle = el.querySelector('.interaction-details-toggle') as HTMLButtonElement;
    const details = el.querySelector('.interaction-details') as HTMLElement;

    // Initially hidden
    expect(details.hidden).toBe(true);

    // Simulate click
    toggle.click();

    // Now visible
    expect(details.hidden).toBe(false);
    expect(toggle.textContent).toBe('▼ Details');

    // Raw event types are now visible
    expect(details.textContent).toContain('[focus, click, change, blur]');
  });

  it('hides details again on second click', () => {
    const interaction = makeInteraction();
    const el = createDetectedInteractionElement(interaction);
    const toggle = el.querySelector('.interaction-details-toggle') as HTMLButtonElement;
    const details = el.querySelector('.interaction-details') as HTMLElement;

    toggle.click(); // open
    expect(details.hidden).toBe(false);
    toggle.click(); // close
    expect(details.hidden).toBe(true);
    expect(toggle.textContent).toBe('▶ Details');
  });

  it('each card has independent toggle state', () => {
    const el1 = createDetectedInteractionElement(
      makeInteraction({ interactionId: 'ctrl-001' }),
    );
    const el2 = createDetectedInteractionElement(
      makeInteraction({ interactionId: 'ctrl-002' }),
    );

    const toggle1 = el1.querySelector('.interaction-details-toggle') as HTMLButtonElement;
    const toggle2 = el2.querySelector('.interaction-details-toggle') as HTMLButtonElement;
    const details1 = el1.querySelector('.interaction-details') as HTMLElement;
    const details2 = el2.querySelector('.interaction-details') as HTMLElement;

    toggle1.click();
    expect(details1.hidden).toBe(false);
    expect(details2.hidden).toBe(true); // card 2 still collapsed
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIX 4: Confidence Moved to Developer Details
// ═══════════════════════════════════════════════════════════════════════════

describe('Fix 4: Confidence in Developer Details Only', () => {
  it('does NOT show confidence percentage in the summary section', () => {
    const interaction = makeInteraction({
      type: 'CustomDropdown',
      confidence: 0.85,
    });

    const el = createDetectedInteractionElement(interaction);

    // Summary section should not contain "85%"
    const summary = el.querySelector('.interaction-summary') as HTMLElement;
    expect(summary).toBeTruthy();
    expect(summary.textContent).not.toContain('85%');
  });

  it('shows confidence in the developer details section', () => {
    const interaction = makeInteraction({
      type: 'CustomDropdown',
      confidence: 0.85,
    });

    const el = createDetectedInteractionElement(interaction);
    const details = el.querySelector('.interaction-details') as HTMLElement;

    expect(details.textContent).toContain('Confidence: 85%');
  });

  it('does NOT show confidence at all when it is 1.0', () => {
    const interaction = makeInteraction({
      confidence: 1.0,
    });

    const el = createDetectedInteractionElement(interaction);
    const allText = el.textContent || '';

    expect(allText).not.toContain('Confidence');
    expect(allText).not.toContain('100%');
  });

  it('shows engine badge in developer details', () => {
    const interaction = makeInteraction({
      engine: 'control' as const,
    });

    const el = createDetectedInteractionElement(interaction);
    const details = el.querySelector('.interaction-details') as HTMLElement;

    expect(details.textContent).toContain('Engine: Control');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED: Full workflow with all fixes applied
// ═══════════════════════════════════════════════════════════════════════════

describe('Combined: OrangeHRM-like workflow with all fixes', () => {
  it('produces clean semantic interactions without noise', () => {
    const loginBtn = makeElementIdentity({
      tag: 'BUTTON',
      accessibleName: 'Login',
      className: 'login-btn',
    });
    const firstNameInput = makeElementIdentity({
      tag: 'INPUT',
      accessibleName: 'First Name',
      ariaRole: 'textbox',
      className: 'oxd-input first-name',
    });
    const nationalitySelect = makeElementIdentity({
      tag: 'DIV',
      accessibleName: 'Nationality',
      ariaRole: 'combobox',
      className: 'oxd-select',
    });
    const dobInput = makeElementIdentity({
      tag: 'INPUT',
      accessibleName: 'Date of Birth',
      className: 'oxd-input dob',
    });
    const saveBtn = makeElementIdentity({
      tag: 'BUTTON',
      accessibleName: 'Save',
      className: 'oxd-button--save',
    });

    const t0 = '2025-01-01T10:00:00.000Z';

    const events: RecordedEvent[] = [
      // Hover-then-click on Login → hover should be suppressed
      { ...makeEvent('mouseenter', loginBtn), timestamp: t0 },
      { ...makeEvent('click', loginBtn), timestamp: '2025-01-01T10:00:00.500Z' },
      // Text entry (has focus/input/blur lifecycle)
      { ...makeEvent('focus', firstNameInput), timestamp: '2025-01-01T10:00:02.000Z' },
      { ...makeEvent('input', firstNameInput, { valueAfter: 'John' }), timestamp: '2025-01-01T10:00:02.500Z' },
      // Hover-then-select on Nationality → hover suppressed
      { ...makeEvent('mouseenter', nationalitySelect), timestamp: '2025-01-01T10:00:04.000Z' },
      { ...makeEvent('click', nationalitySelect, {
        domContext: { ariaExpanded: true },
      }), timestamp: '2025-01-01T10:00:04.500Z' },
      { ...makeEvent('change', nationalitySelect, { valueAfter: 'Indian' }), timestamp: '2025-01-01T10:00:05.000Z' },
      // Date picker — only dateSelect, no toggle click
      { ...makeEvent('dateSelect', dobInput, {
        domContext: {
          dateType: 'date',
          isoValue: '1990-05-15',
          dateConfidence: 1.0,
        },
      }), timestamp: '2025-01-01T10:00:07.000Z' },
      // Save
      { ...makeEvent('click', saveBtn), timestamp: '2025-01-01T10:00:09.000Z' },
    ];

    const result = recognizeInteractions(events);

    // Should have ~4-5 interactions: Click(Login), TextEntry, CustomDropdown, DatePicker, Click(Save)
    // No hovers should remain
    expect(result.find((i) => i.type === 'Hover')).toBeUndefined();

    // Should have the expected interaction types
    const types = result.map((r) => r.type);
    expect(types).toContain('DatePicker');
    expect(types).toContain('TextEntry');
  });
});
