/**
 * Integration tests — Stage 3a Semantic Classification in the production pipeline.
 *
 * Phase 3 Integration Step 1.
 *
 * Verifies that:
 *   1. classifyInteractions output flows through the canonical-step-generator.
 *   2. Step actionType uses canonicalType (from classifier) not raw event.type.
 *   3. Plain English output remains unchanged from legacy registry.
 *   4. Execution JSON mapActionType handles both canonical and legacy types.
 *   5. End-to-end pipeline: timeline → classifier → canonical-step-generator → execution-json-generator.
 */

import { describe, it, expect } from 'vitest';
import { classifyInteractions } from '../src/generation/engine/semantic-classifier';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import type { SessionEvent, RecordingContext, ElementIdentity } from '../src/shared/types';

// ── Helpers ────────────────────────────────────────────────

function makeRecordingContext(url = 'https://example.com'): RecordingContext {
  return {
    startUrl: url,
    startTitle: 'Test Page',
    capturedAt: '2024-01-01T00:00:00Z',
  };
}

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test Button',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'button.test',
    xPath: '//button',
    inIframe: false,
    shadowDom: false,
    elementId: 'btn-1',
    ...overrides,
  };
}

function makeClickEvent(overrides: Record<string, unknown> = {}): SessionEvent {
  return {
    actionId: 'click-0001',
    type: 'click',
    timestamp: '2024-01-01T10:00:00Z',
    elementIdentity: makeElementIdentity(),
    ...overrides,
  } as SessionEvent;
}

function makeTextEvent(value: string, overrides: Record<string, unknown> = {}): SessionEvent {
  return {
    actionId: 'text-0001',
    type: 'text',
    timestamp: '2024-01-01T10:01:00Z',
    elementIdentity: makeElementIdentity({ tag: 'INPUT', ariaRole: 'textbox', accessibleName: 'Email' }),
    value,
    ...overrides,
  } as SessionEvent;
}

function makeCheckboxEvent(checked: boolean, overrides: Record<string, unknown> = {}): SessionEvent {
  return {
    actionId: 'check-0001',
    type: 'checkbox',
    timestamp: '2024-01-01T10:02:00Z',
    elementIdentity: makeElementIdentity({ tag: 'INPUT', ariaRole: 'checkbox', accessibleName: 'Remember Me' }),
    checked,
    ...overrides,
  } as SessionEvent;
}

function makeRadioEvent(overrides: Record<string, unknown> = {}): SessionEvent {
  return {
    actionId: 'radio-0001',
    type: 'radio',
    timestamp: '2024-01-01T10:03:00Z',
    elementIdentity: makeElementIdentity({ tag: 'INPUT', ariaRole: 'radio', accessibleName: 'Option A' }),
    ...overrides,
  } as SessionEvent;
}

function makeSelectEvent(value: string, overrides: Record<string, unknown> = {}): SessionEvent {
  return {
    actionId: 'select-0001',
    type: 'select',
    timestamp: '2024-01-01T10:04:00Z',
    elementIdentity: makeElementIdentity({ tag: 'SELECT', ariaRole: 'combobox', accessibleName: 'Country' }),
    value,
    ...overrides,
  } as SessionEvent;
}

function makeHoverEvent(overrides: Record<string, unknown> = {}): SessionEvent {
  return {
    actionId: 'hover-0001',
    type: 'hover',
    timestamp: '2024-01-01T10:05:00Z',
    elementIdentity: makeElementIdentity({ tag: 'DIV', ariaRole: null, accessibleName: 'Menu' }),
    ...overrides,
  } as SessionEvent;
}

function makeDateSelectEvent(overrides: Record<string, unknown> = {}): SessionEvent {
  return {
    actionId: 'dateSelect-0001',
    type: 'dateSelect',
    timestamp: '2024-01-01T10:06:00Z',
    elementIdentity: makeElementIdentity({ tag: 'INPUT', ariaRole: 'textbox', accessibleName: 'Departure Date' }),
    dateType: 'date',
    displayValue: '15 July 2026',
    isoValue: '2026-07-15',
    ...overrides,
  } as SessionEvent;
}

// ── Tests ──────────────────────────────────────────────────

describe('Stage 3a Integration — Canonical Step Generator', () => {
  it('uses canonicalType from classifier when classified is provided', () => {
    const timeline: SessionEvent[] = [makeClickEvent()];
    const classified = classifyInteractions(timeline);

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    // Click without special ARIA → canonicalType 'click'
    expect(result.output![0].actionType).toBe('click');
  });

  it('uses canonicalType for text event (fill instead of text)', () => {
    const timeline: SessionEvent[] = [makeTextEvent('hello@example.com')];
    const classified = classifyInteractions(timeline);

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(result.output![0].actionType).toBe('fill');
  });

  it('uses canonicalType for checkbox (toggle instead of checkbox)', () => {
    const timeline: SessionEvent[] = [makeCheckboxEvent(true)];
    const classified = classifyInteractions(timeline);

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(result.output![0].actionType).toBe('toggle');
  });

  it('uses canonicalType for radio (select instead of radio)', () => {
    const timeline: SessionEvent[] = [makeRadioEvent()];
    const classified = classifyInteractions(timeline);

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(result.output![0].actionType).toBe('select');
  });

  it('uses canonicalType for select dropdown (select)', () => {
    const timeline: SessionEvent[] = [makeSelectEvent('India')];
    const classified = classifyInteractions(timeline);

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(result.output![0].actionType).toBe('select');
  });

  it('uses canonicalType for dateSelect (selectDate instead of dateSelect)', () => {
    const timeline: SessionEvent[] = [makeDateSelectEvent()];
    const classified = classifyInteractions(timeline);

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(result.output![0].actionType).toBe('selectDate');
  });

  it('uses canonicalType for hover (hover)', () => {
    const timeline: SessionEvent[] = [makeHoverEvent()];
    const classified = classifyInteractions(timeline);

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(result.output![0].actionType).toBe('hover');
  });
});

describe('Stage 3a Integration — Plain English Preserved', () => {
  it('click plain English is identical with and without classification', () => {
    const timeline: SessionEvent[] = [makeClickEvent()];

    // Without classified (legacy path)
    const legacyResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
    });

    // With classified (new path)
    const classified = classifyInteractions(timeline);
    const newResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(newResult.output![0].plainEnglish).toBe(legacyResult.output![0].plainEnglish);
  });

  it('text plain English is identical with and without classification', () => {
    const timeline: SessionEvent[] = [makeTextEvent('hello@example.com')];

    const legacyResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
    });

    const classified = classifyInteractions(timeline);
    const newResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(newResult.output![0].plainEnglish).toBe(legacyResult.output![0].plainEnglish);
  });

  it('checkbox plain English is identical with and without classification', () => {
    const timeline: SessionEvent[] = [makeCheckboxEvent(true)];

    const legacyResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
    });

    const classified = classifyInteractions(timeline);
    const newResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(newResult.output![0].plainEnglish).toBe(legacyResult.output![0].plainEnglish);
  });

  it('dateSelect plain English is identical with and without classification', () => {
    const timeline: SessionEvent[] = [makeDateSelectEvent()];

    const legacyResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
    });

    const classified = classifyInteractions(timeline);
    const newResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(newResult.output![0].plainEnglish).toBe(legacyResult.output![0].plainEnglish);
  });
});

describe('Stage 3a Integration — Execution JSON Compatible', () => {
  it('canonical click type maps to execution verb click', () => {
    const timeline: SessionEvent[] = [makeClickEvent()];
    const classified = classifyInteractions(timeline);

    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    const jsonResult = executionJsonGenerator.generate({ steps: stepResult.output! });
    expect(jsonResult.status).toBe('success');
    expect(jsonResult.output![0].executionJson!.action.type).toBe('click');
  });

  it('canonical fill type maps to execution verb fill', () => {
    const timeline: SessionEvent[] = [makeTextEvent('hello@example.com')];
    const classified = classifyInteractions(timeline);

    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    const jsonResult = executionJsonGenerator.generate({ steps: stepResult.output! });
    expect(jsonResult.output![0].executionJson!.action.type).toBe('fill');
  });

  it('canonical toggle type maps to execution verb check when checked=true', () => {
    const timeline: SessionEvent[] = [makeCheckboxEvent(true)];
    const classified = classifyInteractions(timeline);

    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    const jsonResult = executionJsonGenerator.generate({ steps: stepResult.output! });
    expect(jsonResult.output![0].executionJson!.action.type).toBe('check');
  });

  it('canonical toggle type maps to execution verb uncheck when checked=false', () => {
    const timeline: SessionEvent[] = [makeCheckboxEvent(false)];
    const classified = classifyInteractions(timeline);

    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    const jsonResult = executionJsonGenerator.generate({ steps: stepResult.output! });
    expect(jsonResult.output![0].executionJson!.action.type).toBe('uncheck');
  });

  it('canonical select type maps to execution verb select', () => {
    const timeline: SessionEvent[] = [makeRadioEvent()];
    const classified = classifyInteractions(timeline);

    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    const jsonResult = executionJsonGenerator.generate({ steps: stepResult.output! });
    expect(jsonResult.output![0].executionJson!.action.type).toBe('select');
  });

  it('canonical selectDate type maps to execution verb fill', () => {
    const timeline: SessionEvent[] = [makeDateSelectEvent()];
    const classified = classifyInteractions(timeline);

    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    const jsonResult = executionJsonGenerator.generate({ steps: stepResult.output! });
    expect(jsonResult.output![0].executionJson!.action.type).toBe('fill');
  });

  it('canonical hover type maps to execution verb hover', () => {
    const timeline: SessionEvent[] = [makeHoverEvent()];
    const classified = classifyInteractions(timeline);

    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    const jsonResult = executionJsonGenerator.generate({ steps: stepResult.output! });
    expect(jsonResult.output![0].executionJson!.action.type).toBe('hover');
  });
});

describe('Stage 3a Integration — End-to-End Pipeline', () => {
  it('full mixed-type timeline flows through classifier → canonical-step → exec-json', () => {
    const timeline: SessionEvent[] = [
      // Navigation
      { actionId: 'nav-0001', type: 'navigation', timestamp: '2024-01-01T10:00:00Z', url: 'https://example.com' } as SessionEvent,
      // Click
      makeClickEvent({ actionId: 'click-0001' }),
      // Text entry
      makeTextEvent('test@example.com', { actionId: 'text-0001' }),
      // Checkbox check
      makeCheckboxEvent(true, { actionId: 'check-0001' }),
      // Radio select
      makeRadioEvent({ actionId: 'radio-0001' }),
      // Dropdown select
      makeSelectEvent('India', { actionId: 'select-0001' }),
      // Hover
      makeHoverEvent({ actionId: 'hover-0001' }),
      // Date select
      makeDateSelectEvent({ actionId: 'dateSelect-0001' }),
    ];

    // Stage 3a
    const classified = classifyInteractions(timeline);
    expect(classified).toHaveLength(timeline.length);

    // Verify canonical types
    const types = classified.map(c => c.canonicalType);
    expect(types).toEqual([
      'navigate',  // navigation
      'click',     // generic click
      'fill',      // text entry
      'toggle',    // checkbox
      'select',    // radio
      'select',    // dropdown select
      'hover',     // hover
      'selectDate' // dateSelect
    ]);

    // Stage 3b → Canonical Step Generator
    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });
    expect(stepResult.status).toBe('success');
    expect(stepResult.output).toHaveLength(8);

    // Verify actionType values
    const stepActionTypes = stepResult.output!.map(s => s.actionType);
    expect(stepActionTypes).toEqual([
      'navigate',   // navigation (transformNavigationEvent uses 'navigation' but classifier gives 'navigate')
      'click',      // click
      'fill',       // text → fill
      'toggle',     // checkbox → toggle
      'select',     // radio → select
      'select',     // select → select
      'hover',      // hover
      'selectDate'  // dateSelect → selectDate
    ]);

    // Stage 4: Execution JSON Generator
    const jsonResult = executionJsonGenerator.generate({ steps: stepResult.output! });
    expect(jsonResult.status).toBe('success');

    // Verify execution verbs
    const execVerbs = jsonResult.output!.map(s => s.executionJson!.action.type);
    expect(execVerbs).toEqual([
      'navigate', // navigate
      'click',    // click
      'fill',     // fill
      'check',    // toggle (checked=true)
      'select',   // select (radio)
      'select',   // select (dropdown)
      'hover',    // hover
      'fill',     // selectDate → fill
    ]);
  });

  it('empty timeline produces empty results', () => {
    const timeline: SessionEvent[] = [];
    const classified = classifyInteractions(timeline);
    expect(classified).toEqual([]);

    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });
    expect(stepResult.output).toEqual([]);
  });
});

describe('Stage 3a Integration — Backward Compatibility', () => {
  it('works without classified field (legacy mode)', () => {
    const timeline: SessionEvent[] = [makeClickEvent()];

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      // classified omitted
    });

    expect(result.status).toBe('success');
    // Falls back to event.type
    expect(result.output![0].actionType).toBe('click');
  });

  it('click on ARIA menuitem classifies as select', () => {
    const timeline: SessionEvent[] = [
      makeClickEvent({
        elementIdentity: makeElementIdentity({ ariaRole: 'menuitem', accessibleName: 'Support' }),
      }),
    ];

    const classified = classifyInteractions(timeline);
    expect(classified[0].canonicalType).toBe('select');

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    // actionType is now canonical 'select' instead of raw 'click'
    expect(result.output![0].actionType).toBe('select');

    // Execution JSON should still map to 'select' verb
    const jsonResult = executionJsonGenerator.generate({ steps: result.output! });
    expect(jsonResult.output![0].executionJson!.action.type).toBe('select');
  });

  it('click on ARIA option classifies as select', () => {
    const timeline: SessionEvent[] = [
      makeClickEvent({
        elementIdentity: makeElementIdentity({ ariaRole: 'option', accessibleName: 'Option B' }),
      }),
    ];

    const classified = classifyInteractions(timeline);
    expect(classified[0].canonicalType).toBe('select');

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });

    expect(result.output![0].actionType).toBe('select');
  });
});
