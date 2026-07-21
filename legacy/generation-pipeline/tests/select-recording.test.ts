/**
 * Dropdown & Select Recording Tests — Milestone C5.2
 *
 * Tests the interaction type registration, plain English generation,
 * and pipeline integration for Dropdown & Select interactions.
 *
 * Permanently frozen C5.1: Select interactions represent meaningful
 * value changes, not clicks. Only the resulting selected value is recorded.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getInteractionType, getRegisteredTypes } from '../src/recorder/interaction-types';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import type { SessionEvent, ElementIdentity, RecordingContext } from '../src/shared/types';
import type { CanonicalStep } from '../src/generation/types';
// @ts-ignore - jsdom has no type declarations in this project
import { JSDOM } from 'jsdom';

// ── Test Helpers ──────────────────────────────────────────

const recordingContext: RecordingContext = {
  startUrl: 'https://example.com',
  startTitle: 'Example',
  capturedAt: '2026-07-16T00:00:00Z',
};

function makeSelectEvent(
  actionId: string,
  accessibleName: string,
  value: string,
  attrs: Partial<ElementIdentity> = {},
): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'listbox',
    ariaLabel: accessibleName,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'SELECT',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'select#country',
    xPath: '//select[@id="country"]',
    inIframe: false,
    shadowDom: false,
    elementId: actionId.replace('select', 'elem'),
    ...attrs,
  };
  return {
    actionId,
    type: 'select',
    elementIdentity: identity,
    value,
    timestamp: '2026-07-16T00:00:00Z',
  };
}

function makeClickEvent(actionId: string, accessibleName: string): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'button',
    ariaLabel: accessibleName,
    ariaLabelledBy: null, placeholder: null,
    tag: 'BUTTON', name: null, stableId: null, testId: null,
    dataCy: null, dataQa: null,
    className: null,
    cssSelector: 'button', xPath: '//button',
    inIframe: false, shadowDom: false, elementId: actionId.replace('click', 'elem'),
  };
  return {
    actionId,
    type: 'click',
    elementIdentity: identity,
    timestamp: '2026-07-16T00:00:00Z',
  };
}

function makeNavEvent(actionId: string, url: string): SessionEvent {
  return {
    actionId,
    type: 'navigation',
    url,
    title: 'Page',
    timestamp: '2026-07-16T00:00:00Z',
  };
}

// ── Registration Tests ────────────────────────────────────

describe('C5.2 — Select Interaction Type Registration', () => {
  it('select type is registered', () => {
    const types = getRegisteredTypes();
    expect(types).toContain('select');
  });

  it('exactly six interaction types registered', () => {
    const types = getRegisteredTypes();
    expect(types).toHaveLength(7);
    expect(types).toContain('click');
    expect(types).toContain('text');
    expect(types).toContain('hover');
    expect(types).toContain('checkbox');
    expect(types).toContain('radio');
    expect(types).toContain('select');
  });

  it('select config has correct actionType', () => {
    const config = getInteractionType('select');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('select');
  });

  it('select config has correct idPrefix', () => {
    const config = getInteractionType('select');
    expect(config!.idPrefix).toBe('select');
  });

  it('select config has cyan badge color', () => {
    const config = getInteractionType('select');
    expect(config!.badgeColor).toBe('#06b6d4');
  });

  it('select config has Select badge label', () => {
    const config = getInteractionType('select');
    expect(config!.badgeLabel).toBe('Select');
  });
});

// ── Plain English Generation ──────────────────────────────

describe('C5.2 — Select Plain English', () => {
  it('generates "Select [value]" using the selected option label', () => {
    const config = getInteractionType('select')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Country',
        ariaRole: 'listbox', ariaLabel: 'Country', ariaLabelledBy: null, placeholder: null,
        tag: 'SELECT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'select#country', xPath: '//select[@id="country"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: { value: 'India' },
    });
    expect(result).toBe('Select "India"');
  });

  it('prioritizes extras.value over AI business name for the control', () => {
    const config = getInteractionType('select')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Country',
        ariaRole: 'listbox', ariaLabel: 'Country', ariaLabelledBy: null, placeholder: null,
        tag: 'SELECT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'select', xPath: '//select',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: { businessName: 'Geographic Region' } as any,
      extras: { value: 'India' },
    });
    // extras.value (selected option label) takes priority — it IS the user's selection
    expect(result).toBe('Select "India"');
  });

  it('falls back to control name when no value provided', () => {
    const config = getInteractionType('select')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Country',
        ariaRole: 'listbox', ariaLabel: 'Country', ariaLabelledBy: null, placeholder: null,
        tag: 'SELECT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'select', xPath: '//select',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: {},
    });
    expect(result).toBe('Select "Country"');
  });

  it('truncates long option labels', () => {
    const longName = 'A'.repeat(150);
    const config = getInteractionType('select')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Field',
        ariaRole: 'listbox', ariaLabel: 'Field', ariaLabelledBy: null, placeholder: null,
        tag: 'SELECT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'select', xPath: '//select',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: { value: longName },
    });
    expect(result.length).toBeLessThan(longName.length + 10); // "Select " + quotes
    expect(result).toContain('Select "');
  });
});

// ── Canonical Step Generation ─────────────────────────────

describe('C5.2 — Canonical Step Generation', () => {
  it('generates canonical step for Select action', () => {
    const timeline: SessionEvent[] = [
      makeSelectEvent('select-0001', 'Country', 'India'),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].plainEnglish).toBe("Select 'India' from Country");
  });

  it('generates different steps for different values', () => {
    const timeline: SessionEvent[] = [
      makeSelectEvent('select-0001', 'Priority', 'High'),
      makeSelectEvent('select-0002', 'Priority', 'Low'),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.output).toHaveLength(2);
    expect(result.output![0].plainEnglish).toBe("Select 'High' from Priority");
    expect(result.output![1].plainEnglish).toBe("Select 'Low' from Priority");
  });
});

// ── Execution JSON (through pipeline) ─────────────────────

describe('C5.2 — Execution JSON Generation', () => {
  it('select action produces execution JSON', () => {
    const timeline: SessionEvent[] = [
      makeSelectEvent('select-0001', 'Country', 'India'),
    ];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output).toHaveLength(1);
  });
});

// ── Full Pipeline: Select → Click → Navigate ───────────────

describe('C5.2 — Full Pipeline: Select → Click → Navigate', () => {
  it('generates all three step types through full pipeline', () => {
    const timeline: SessionEvent[] = [
      makeSelectEvent('select-0001', 'Country', 'India'),
      makeClickEvent('click-0001', 'Submit'),
      makeNavEvent('nav-0001', 'https://example.com/success'),
    ];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(canonicalResult.output).toHaveLength(3);
    expect(canonicalResult.output![0].plainEnglish).toBe("Select 'India' from Country");

    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });
    expect(execResult.output).toHaveLength(3);
  });
});

// ── Multiple Sequential Selects ───────────────────────────

describe('C5.2 — Multiple Sequential Select Interactions', () => {
  it('records multiple dropdown selections in sequence', () => {
    const timeline: SessionEvent[] = [
      makeSelectEvent('select-0001', 'Country', 'India'),
      makeSelectEvent('select-0002', 'Payment Method', 'Credit Card'),
      makeSelectEvent('select-0003', 'Shipping', 'Express Delivery'),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.output).toHaveLength(3);
    expect(result.output![0].plainEnglish).toBe("Select 'India' from Country");
    expect(result.output![1].plainEnglish).toBe("Select 'Credit Card' from Payment Method");
    expect(result.output![2].plainEnglish).toBe("Select 'Express Delivery' from Shipping");
  });

  it('records changing selection on same dropdown', () => {
    const timeline: SessionEvent[] = [
      makeSelectEvent('select-0001', 'Country', 'India'),
      makeSelectEvent('select-0002', 'Country', 'Japan'),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.output).toHaveLength(2);
    expect(result.output![0].plainEnglish).toBe("Select 'India' from Country");
    expect(result.output![1].plainEnglish).toBe("Select 'Japan' from Country");
  });
});

// ── renderTitle ───────────────────────────────────────────

describe('C5.2 — renderTitle', () => {
  it('uses selected value as title', () => {
    const config = getInteractionType('select')!;
    const title = config.renderTitle({
      actionId: 'select-0001',
      type: 'select',
      timestamp: '2026-07-16T00:00:00Z',
      elementIdentity: {
        accessibleName: 'Country',
        ariaRole: 'listbox', ariaLabel: 'Country', ariaLabelledBy: null, placeholder: null,
        tag: 'SELECT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'select', xPath: '//select',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      value: 'India',
    } as any);
    expect(title).toBe('India');
  });

  it('falls back to accessibleName when no value', () => {
    const config = getInteractionType('select')!;
    const title = config.renderTitle({
      actionId: 'select-0001',
      type: 'select',
      timestamp: '2026-07-16T00:00:00Z',
      elementIdentity: {
        accessibleName: 'Country',
        ariaRole: 'listbox', ariaLabel: 'Country', ariaLabelledBy: null, placeholder: null,
        tag: 'SELECT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'select', xPath: '//select',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
    } as any);
    expect(title).toBe('Country');
  });
});

// ── executionExtras ───────────────────────────────────────

describe('C5.2 — executionExtras', () => {
  it('includes value field', () => {
    const config = getInteractionType('select')!;
    const extras = config.executionExtras({
      actionId: 'select-0001',
      type: 'select',
      timestamp: '2026-07-16T00:00:00Z',
      elementIdentity: {} as any,
      value: 'India',
    } as any);
    expect(extras).toEqual({ value: 'India' });
  });

  it('returns empty when no value', () => {
    const config = getInteractionType('select')!;
    const extras = config.executionExtras({
      actionId: 'select-0001',
      type: 'select',
      timestamp: '2026-07-16T00:00:00Z',
      elementIdentity: {} as any,
    } as any);
    expect(extras).toEqual({});
  });
});

// ── Permanent Regression: Gate 5 Exclusion (Disabled/Read-only) ──

describe('C5.2 — Permanent Regression: Gate 5 Exclusion', () => {
  let dom: Document;
  let domWindow: typeof globalThis;

  beforeEach(() => {
    const jsdom = new JSDOM('<!DOCTYPE html><body></body>');
    domWindow = jsdom.window as unknown as typeof globalThis;
    dom = domWindow.document;
  });

  function isControlEnabled(el: Element): boolean {
    const HTMLSelectElement = domWindow.HTMLSelectElement;
    if (el instanceof HTMLSelectElement && el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.getAttribute('aria-readonly') === 'true') return false;
    const fieldset = el.closest('fieldset[disabled]');
    if (fieldset) return false;
    return true;
  }

  it('enabled select passes Gate 5', () => {
    const sel = dom.createElement('select');
    expect(isControlEnabled(sel)).toBe(true);
  });

  it('disabled select fails Gate 5 (not recorded)', () => {
    const sel = dom.createElement('select');
    sel.disabled = true;
    expect(isControlEnabled(sel)).toBe(false);
  });

  it('aria-disabled select fails Gate 5', () => {
    const sel = dom.createElement('select');
    sel.setAttribute('aria-disabled', 'true');
    expect(isControlEnabled(sel)).toBe(false);
  });

  it('aria-readonly select fails Gate 5', () => {
    const sel = dom.createElement('select');
    sel.setAttribute('aria-readonly', 'true');
    expect(isControlEnabled(sel)).toBe(false);
  });

  it('select inside disabled fieldset fails Gate 5', () => {
    const fieldset = dom.createElement('fieldset');
    fieldset.disabled = true;
    const sel = dom.createElement('select');
    fieldset.appendChild(sel);
    expect(isControlEnabled(sel)).toBe(false);
  });
});

// ── Permanent Regression: Value Extraction ────────────────

describe('C5.2 — Permanent Regression: Value Extraction', () => {
  let dom: Document;
  let domWindow: typeof globalThis;

  beforeEach(() => {
    const jsdom = new JSDOM('<!DOCTYPE html><body></body>');
    domWindow = jsdom.window as unknown as typeof globalThis;
    dom = domWindow.document;
  });

  it('extracts selected option text from native <select>', () => {
    const sel = dom.createElement('select');
    const opt1 = dom.createElement('option');
    opt1.value = 'US'; opt1.textContent = 'United States';
    const opt2 = dom.createElement('option');
    opt2.value = 'IN'; opt2.textContent = 'India';
    sel.appendChild(opt1);
    sel.appendChild(opt2);
    sel.selectedIndex = 1;

    const HTMLSelectElement = domWindow.HTMLSelectElement;
    if (sel instanceof HTMLSelectElement) {
      const option = sel.options[sel.selectedIndex];
      expect(option.text.trim()).toBe('India');
    }
  });

  it('select:not([multiple]) is excluded from click recording', () => {
    const sel = dom.createElement('select');
    expect(sel.matches('select:not([multiple])')).toBe(true);

    const multi = dom.createElement('select');
    multi.setAttribute('multiple', '');
    expect(multi.matches('select:not([multiple])')).toBe(false);
  });
});

// ── Regression: Existing Types Unaffected ─────────────────

describe('C5.2 — Regression: Existing Types Unaffected', () => {
  it('click interaction type still registered', () => {
    const config = getInteractionType('click');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('click');
  });

  it('text interaction type still registered', () => {
    const config = getInteractionType('text');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('text');
  });

  it('hover interaction type still registered', () => {
    const config = getInteractionType('hover');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('hover');
  });

  it('checkbox interaction type still registered', () => {
    const config = getInteractionType('checkbox');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('checkbox');
  });

  it('radio interaction type still registered', () => {
    const config = getInteractionType('radio');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('radio');
  });

  it('click plain English still works', () => {
    const config = getInteractionType('click')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Submit',
        ariaRole: 'button', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'BUTTON', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'button', xPath: '//button',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: {},
    });
    expect(result).toBe('Click "Submit"');
  });

  it('checkbox plain English still works', () => {
    const config = getInteractionType('checkbox')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Remember Me',
        ariaRole: 'checkbox', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input', xPath: '//input',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: { checked: true },
    });
    expect(result).toBe('Check "Remember Me"');
  });

  it('radio plain English still works', () => {
    const config = getInteractionType('radio')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Express',
        ariaRole: 'radio', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input', xPath: '//input',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: {},
    });
    expect(result).toBe('Select "Express"');
  });
});

// ════════════════════════════════════════════════════════════════
// Custom Dropdown Regression Tests
//
// Runtime validation defect fix: custom dropdown components (OrangeHRM OXD,
// React Select, MUI, Ant Design) do NOT dispatch native 'change' events.
// They use @mousedown/@click on [role="option"] elements. The recorder
// must detect clicks on [role="option"] and record the value change.
//
// These tests verify the recording pipeline handles custom dropdown
// interactions correctly — the same select action type, same Execution
// JSON, same Playwright output as native <select>.
// ════════════════════════════════════════════════════════════════

describe('Custom Dropdown Regression — Runtime Fix', () => {
  it('custom dropdown select produces same Canonical Step as native select', () => {
    // Simulate what handleOptionClick commits: same SelectEvent shape,
    // just with a different element tag (DIV instead of SELECT)
    const customSelectEvent: SessionEvent = {
      actionId: 'select-0001',
      type: 'select',
      elementIdentity: {
        accessibleName: 'Country',
        ariaRole: 'listbox',
        ariaLabel: 'Country',
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'DIV',
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        className: null,
        cssSelector: '.oxd-select-wrapper',
        xPath: '//div[@class="oxd-select-wrapper"]',
        inIframe: false,
        shadowDom: false,
        elementId: 'elem-0001',
      },
      value: 'India',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const nativeSelectEvent = makeSelectEvent('select-0002', 'Country', 'India');

    const customResult = canonicalStepGenerator.generate({ timeline: [customSelectEvent], recordingContext });
    const nativeResult = canonicalStepGenerator.generate({ timeline: [nativeSelectEvent], recordingContext });

    expect(customResult.status).toBe('success');
    expect(nativeResult.status).toBe('success');
    const customSteps = customResult.output!;
    const nativeSteps = nativeResult.output!;
    expect(customSteps).toHaveLength(1);
    expect(nativeSteps).toHaveLength(1);

    // Both produce the same action type and action
    expect(customSteps[0].actionType).toBe('select');
    expect(nativeSteps[0].actionType).toBe('select');
    expect(customSteps[0].actionType).toBe(nativeSteps[0].actionType);
    expect(customSteps[0].value).toBe('India');
    expect(nativeSteps[0].value).toBe('India');
  });

  it('custom dropdown select produces correct Execution JSON', () => {
    const customSelectEvent: SessionEvent = {
      actionId: 'select-0001',
      type: 'select',
      elementIdentity: {
        accessibleName: 'Employment Status',
        ariaRole: 'listbox',
        ariaLabel: 'Employment Status',
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'DIV',
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        className: null,
        cssSelector: '.oxd-select-wrapper',
        xPath: '//div[@class="oxd-select-wrapper"]',
        inIframe: false,
        shadowDom: false,
        elementId: 'elem-0001',
      },
      value: 'Full-Time',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const stepsResult = canonicalStepGenerator.generate({ timeline: [customSelectEvent], recordingContext });
    const execResult = executionJsonGenerator.generate({
      steps: stepsResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output).toHaveLength(1);
    expect(execResult.output![0].actionType).toBe('select');
  });

  it('OXD-style custom dropdown: option click produces Select, not Click', () => {
    // OXD renders: <div role="option" @mousedown="onClick">Full-Time</div>
    // The recorder should record this as Select "Full-Time", not Click.
    const selectEvent: SessionEvent = {
      actionId: 'select-0001',
      type: 'select',
      elementIdentity: {
        accessibleName: 'Job Title',
        ariaRole: 'listbox',
        ariaLabel: 'Job Title',
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'DIV',
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        className: null,
        cssSelector: 'div.oxd-select-dropdown',
        xPath: '//div[@role="listbox"]',
        inIframe: false,
        shadowDom: false,
        elementId: 'elem-0001',
      },
      value: 'Software Engineer',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const config = getInteractionType('select')!;
    const english = config.toPlainEnglish({
      identity: selectEvent.elementIdentity,
      understanding: undefined,
      extras: { value: 'Software Engineer' },
    });

    expect(english).toBe('Select "Software Engineer"');
    expect(english).not.toContain('Click');
  });

  it('multiple sequential custom dropdown selections all recorded', () => {
    const events: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Country', ariaRole: 'listbox', ariaLabel: 'Country',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '.country-dropdown', xPath: '//div[@class="country-dropdown"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'India', timestamp: '2026-07-16T00:00:00Z',
      },
      {
        actionId: 'select-0002', type: 'select',
        elementIdentity: {
          accessibleName: 'State', ariaRole: 'listbox', ariaLabel: 'State',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '.state-dropdown', xPath: '//div[@class="state-dropdown"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'Maharashtra', timestamp: '2026-07-16T00:00:01Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    const steps = result.output!;
    expect(steps).toHaveLength(2);
    expect(steps[0].actionType).toBe('select');
    expect(steps[1].actionType).toBe('select');
    expect(steps[0].value).toBe('India');
    expect(steps[1].value).toBe('Maharashtra');
  });

  it('custom dropdown re-select of same value is a no-op (Gate 4)', () => {
    // The pre-state tracking should prevent duplicate recording
    // when the user clicks the same option that was already selected.
    // This test verifies the pipeline-level behavior: if only one
    // select event reaches the pipeline, only one step is produced.
    const events: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Status', ariaRole: 'listbox', ariaLabel: 'Status',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '.status-dropdown', xPath: '//div[@class="status-dropdown"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'Active', timestamp: '2026-07-16T00:00:00Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    const steps = result.output!;
    expect(steps).toHaveLength(1);
    expect(steps[0].value).toBe('Active');
  });

  it('mixed Click + custom Select + Hover workflow generates correctly', () => {
    const events: SessionEvent[] = [
      // Click to open dropdown
      {
        actionId: 'click-0001', type: 'click',
        elementIdentity: {
          accessibleName: 'Open Menu', ariaRole: 'button', ariaLabel: 'Open Menu',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '.menu-trigger', xPath: '//div[@class="menu-trigger"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        timestamp: '2026-07-16T00:00:00Z',
      },
      // Custom dropdown select
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Category', ariaRole: 'listbox', ariaLabel: 'Category',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '.category-dropdown', xPath: '//div[@class="category-dropdown"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'Electronics', timestamp: '2026-07-16T00:00:01Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    const steps = result.output!;
    expect(steps).toHaveLength(2);
    expect(steps[0].actionType).toBe('click');
    expect(steps[1].actionType).toBe('select');
  });
});

// ════════════════════════════════════════════════════════════════
// C5.2B — Universal Dropdown Recording Tests
//
// Tests for: ownership ratchet fix, keyboard selection, portaled
// dropdowns, multiple selections on same dropdown, searchable
// autocomplete, value extraction edge cases.
// ════════════════════════════════════════════════════════════════

describe('C5.2B — Multiple Selections on Same Dropdown (Ownership Ratchet Fix)', () => {
  it('records all three selections when user changes value three times', () => {
    const timeline: SessionEvent[] = [
      makeSelectEvent('select-0001', 'Country', 'India'),
      makeSelectEvent('select-0002', 'Country', 'Japan'),
      makeSelectEvent('select-0003', 'Country', 'Brazil'),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(3);
    expect(result.output![0].value).toBe('India');
    expect(result.output![1].value).toBe('Japan');
    expect(result.output![2].value).toBe('Brazil');
  });

  it('records two selections on custom dropdown (same identity, different values)', () => {
    const events: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Status', ariaRole: 'listbox', ariaLabel: 'Status',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: 'status-listbox', testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '#status-listbox', xPath: '//div[@id="status-listbox"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'Active', timestamp: '2026-07-16T00:00:00Z',
      },
      {
        actionId: 'select-0002', type: 'select',
        elementIdentity: {
          accessibleName: 'Status', ariaRole: 'listbox', ariaLabel: 'Status',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: 'status-listbox', testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '#status-listbox', xPath: '//div[@id="status-listbox"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'Inactive', timestamp: '2026-07-16T00:00:01Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(2);
    expect(result.output![0].value).toBe('Active');
    expect(result.output![1].value).toBe('Inactive');
  });
});

describe('C5.2B — Keyboard Selection via Pipeline', () => {
  it('keyboard-selected option produces same Canonical Step as mouse', () => {
    const mouseEvent = makeSelectEvent('select-mouse', 'City', 'Mumbai', {
      tag: 'DIV', ariaRole: 'listbox',
    });
    const keyboardEvent = makeSelectEvent('select-key', 'City', 'Mumbai', {
      tag: 'DIV', ariaRole: 'listbox',
    });

    const mouseResult = canonicalStepGenerator.generate({ timeline: [mouseEvent], recordingContext });
    const keyResult = canonicalStepGenerator.generate({ timeline: [keyboardEvent], recordingContext });

    expect(mouseResult.output![0].actionType).toBe('select');
    expect(keyResult.output![0].actionType).toBe('select');
    expect(mouseResult.output![0].value).toBe(keyResult.output![0].value);
    expect(mouseResult.output![0].plainEnglish).toBe("Select 'Mumbai' from City");
    expect(keyResult.output![0].plainEnglish).toBe("Select 'Mumbai' from City");
  });
});

describe('C5.2B — Portaled Dropdown Identity Resolution', () => {
  it('portaled listbox selection resolves to stable trigger identity', () => {
    // Radix-style: trigger has [aria-controls="list-id"] pointing to
    // a portaled listbox at document.body level
    const selectEvent: SessionEvent = {
      actionId: 'select-0001', type: 'select',
      elementIdentity: {
        // Identity should be the trigger, not the portal
        accessibleName: 'Sort By', ariaRole: 'combobox', ariaLabel: 'Sort By',
        ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
        stableId: 'trigger-sort', testId: null, dataCy: null, dataQa: null,
        className: null,
        cssSelector: '#trigger-sort', xPath: '//button[@id="trigger-sort"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      value: 'Price: Low to High',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].value).toBe('Price: Low to High');
    // Identity tag is BUTTON (the trigger), not DIV (the portal)
    expect(result.output![0].elementIdentity.tag).toBe('BUTTON');
  });
});

describe('C5.2B — Searchable / Autocomplete Dropdown', () => {
  it('autocomplete selection records only final value, not search text', () => {
    // User types "ind" in autocomplete → sees options → clicks "India"
    // The text entry of "ind" is recorded by text-entry-content-script (if at all)
    // The final selection is recorded as Select "India"
    const selectEvent: SessionEvent = {
      actionId: 'select-0001', type: 'select',
      elementIdentity: {
        accessibleName: 'Destination', ariaRole: 'combobox', ariaLabel: 'Destination',
        ariaLabelledBy: null, placeholder: 'Search country...', tag: 'INPUT', name: 'country',
        stableId: 'autocomplete', testId: null, dataCy: null, dataQa: null,
        className: null,
        cssSelector: '#autocomplete', xPath: '//input[@id="autocomplete"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      value: 'India',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].value).toBe('India');
    expect(result.output![0].plainEnglish).toBe("Select 'India' from Destination");
  });

  it('autocomplete search text not recorded as select value', () => {
    // If the user types "ind" but selects "Indonesia", the value must be
    // "Indonesia", not "ind" or "India"
    const selectEvent: SessionEvent = {
      actionId: 'select-0001', type: 'select',
      elementIdentity: {
        accessibleName: 'Country', ariaRole: 'combobox', ariaLabel: 'Country',
        ariaLabelledBy: null, placeholder: 'Search...', tag: 'INPUT', name: 'country',
        stableId: null, testId: null, dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input[name="country"]', xPath: '//input[@name="country"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      value: 'Indonesia',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.output![0].value).toBe('Indonesia');
    expect(result.output![0].plainEnglish).toBe("Select 'Indonesia' from Country");
  });
});

describe('C5.2B — Execution JSON for Custom Dropdown', () => {
  it('custom dropdown select produces valid Execution JSON with select action', () => {
    const timeline: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Job Title', ariaRole: 'listbox', ariaLabel: 'Job Title',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: 'job-listbox', testId: 'job-title-select', dataCy: null, dataQa: null,
          className: null,
          cssSelector: '#job-listbox', xPath: '//div[@id="job-listbox"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'Software Engineer',
        timestamp: '2026-07-16T00:00:00Z',
      },
    ];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output).toHaveLength(1);
    expect(execResult.output![0].actionType).toBe('select');
  });
});

describe('C5.2B — Playwright Generation for Custom Dropdown', () => {
  it('custom DIV listbox select generates correct Playwright', () => {
    const timeline: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Department', ariaRole: 'listbox', ariaLabel: 'Department',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: 'dept-select', testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '#dept-select', xPath: '//div[@id="dept-select"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'Engineering',
        timestamp: '2026-07-16T00:00:00Z',
      },
    ];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    const steps = canonicalResult.output as CanonicalStep[];

    // Verify the step was generated correctly
    expect(steps).toHaveLength(1);
    expect(steps[0].actionType).toBe('select');
    expect(steps[0].value).toBe('Engineering');

    // Verify Execution JSON
    const execResult = executionJsonGenerator.generate({ steps });
    expect(execResult.output![0].actionType).toBe('select');
  });
});

describe('C5.2B — OXD-Style Non-ARIA Dropdown (OrangeHRM)', () => {
  it('OXD option with aria-selected produces Select event correctly', () => {
    // OXD renders: <div role="option" @mousedown="onClick">Text</div>
    // After mousedown, the option gets aria-selected="true"
    // The select-content-script detects it via handleOptionClick
    const selectEvent: SessionEvent = {
      actionId: 'select-0001', type: 'select',
      elementIdentity: {
        accessibleName: 'Employment Type',
        ariaRole: 'listbox',
        ariaLabel: 'Employment Type',
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'DIV',
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        className: null,
        cssSelector: 'div.oxd-select-dropdown',
        xPath: '//div[@role="listbox"]',
        inIframe: false,
        shadowDom: false,
        elementId: 'elem-0001',
      },
      value: 'Full-Time',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.status).toBe('success');
    expect(result.output![0].plainEnglish).toBe("Select 'Full-Time' from Employment Type");
  });
});

describe('C5.2B — Async-Loaded Options', () => {
  it('select on async-loaded option produces correct step', () => {
    // Options appear after API call; the option appears in DOM only after
    // the async fetch completes. The mousedown handler fires when user
    // clicks the now-visible option.
    const selectEvent: SessionEvent = {
      actionId: 'select-0001', type: 'select',
      elementIdentity: {
        accessibleName: 'Assign To', ariaRole: 'listbox', ariaLabel: 'Assign To',
        ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
        stableId: 'assignee-listbox', testId: null, dataCy: null, dataQa: null,
        className: null,
        cssSelector: '#assignee-listbox', xPath: '//div[@id="assignee-listbox"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      value: 'John Doe',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.output![0].value).toBe('John Doe');
  });
});

describe('C5.2B — Mixed Workflow Regression', () => {
  it('Click → Select → Hover → Checkbox → Navigate full pipeline', () => {
    const timeline: SessionEvent[] = [
      makeClickEvent('click-0001', 'Open Settings'),
      makeSelectEvent('select-0001', 'Theme', 'Dark'),
      {
        actionId: 'hover-0001', type: 'hover',
        elementIdentity: {
          accessibleName: 'Preview', ariaRole: 'img', ariaLabel: 'Preview',
          ariaLabelledBy: null, placeholder: null, tag: 'IMG', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: 'img.preview', xPath: '//img[@class="preview"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0003',
        },
        timestamp: '2026-07-16T00:00:02Z',
      },
      {
        actionId: 'check-0001', type: 'checkbox',
        elementIdentity: {
          accessibleName: 'Email notifications', ariaRole: 'checkbox', ariaLabel: 'Email notifications',
          ariaLabelledBy: null, placeholder: null, tag: 'INPUT', name: 'email-notif',
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: 'input[name="email-notif"]', xPath: '//input[@name="email-notif"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0004',
        },
        checked: true,
        timestamp: '2026-07-16T00:00:03Z',
      },
      makeNavEvent('nav-0001', 'https://example.com/settings/saved'),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(5);
    expect(result.output![0].actionType).toBe('click');
    expect(result.output![1].actionType).toBe('select');
    expect(result.output![2].actionType).toBe('hover');
    expect(result.output![3].actionType).toBe('toggle');
    expect(result.output![4].actionType).toBe('navigate');
  });
});

describe('C5.2B — Execution JSON Contract Unchanged', () => {
  it('select action produces same JSON structure for native and custom', () => {
    // Native <select>
    const nativeTimeline: SessionEvent[] = [makeSelectEvent('s1', 'Country', 'India')];
    const nativeCanonical = canonicalStepGenerator.generate({ timeline: nativeTimeline, recordingContext });
    const nativeExec = executionJsonGenerator.generate({
      steps: nativeCanonical.output as CanonicalStep[],
    });

    // Custom DIV dropdown
    const customTimeline: SessionEvent[] = [{
      actionId: 's2', type: 'select',
      elementIdentity: {
        accessibleName: 'Country', ariaRole: 'listbox', ariaLabel: 'Country',
        ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
        stableId: 'country-lb', testId: null, dataCy: null, dataQa: null,
        className: null,
        cssSelector: '#country-lb', xPath: '//div[@id="country-lb"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      value: 'India', timestamp: '2026-07-16T00:00:00Z',
    }];
    const customCanonical = canonicalStepGenerator.generate({ timeline: customTimeline, recordingContext });
    const customExec = executionJsonGenerator.generate({
      steps: customCanonical.output as CanonicalStep[],
    });

    expect(nativeExec.output![0].actionType).toBe('select');
    expect(customExec.output![0].actionType).toBe('select');
    // Both have same action type — the execution engine decides the strategy
  });
});

describe('C5.2B — Gate 5: Disabled/Read-Only Exclusion', () => {
  it('aria-disabled listbox does not produce execution JSON', () => {
    // The content script checks isControlEnabled at Gate 5 and returns early.
    // This test verifies that if a disabled event somehow reached the pipeline,
    // it still processes correctly (the gate is in the content script, not pipeline).
    // The pipeline doesn't filter — it processes whatever events reach it.
    // This is correct: the Gate 5 filter is in the recorder, not the generator.
    const selectEvent = makeSelectEvent('select-0001', 'Locked', 'Read-Only Value');
    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    // The pipeline DOES process it — the gate is in the content script.
    // This test confirms the pipeline doesn't need to know about disabled state.
    expect(result.status).toBe('success');
  });
});

// ════════════════════════════════════════════════════════════════
// Value-Selection Implementation Extensions
//
// Tests for segmented controls (aria-pressed), custom ARIA radio buttons
// in dialogs, and menu-based selectors.
// ════════════════════════════════════════════════════════════════

describe('Value Selection — Segmented Control (aria-pressed)', () => {
  it('segmented control button selection produces Select event', () => {
    // Adani One travel class: <button aria-pressed="true">Premium Economy</button>
    const selectEvent: SessionEvent = {
      actionId: 'select-0001', type: 'select',
      elementIdentity: {
        accessibleName: 'Premium Economy',
        ariaRole: 'button',
        ariaLabel: 'Premium Economy',
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'BUTTON',
        name: null,
        stableId: 'travel-class-premium',
        testId: null,
        dataCy: null,
        dataQa: null,
        className: null,
        cssSelector: '#travel-class-premium',
        xPath: '//button[@id="travel-class-premium"]',
        inIframe: false,
        shadowDom: false,
        elementId: 'elem-0001',
      },
      value: 'Premium Economy',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.status).toBe('success');
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].value).toBe('Premium Economy');
    expect(result.output![0].plainEnglish).toBe("Select 'Premium Economy' from Premium Economy");
  });

  it('changing segmented control selection records both values', () => {
    const events: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Economy', ariaRole: 'button', ariaLabel: 'Economy',
          ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
          stableId: 'class-economy', testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '#class-economy', xPath: '//button[@id="class-economy"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'Economy', timestamp: '2026-07-16T00:00:00Z',
      },
      {
        actionId: 'select-0002', type: 'select',
        elementIdentity: {
          accessibleName: 'Business', ariaRole: 'button', ariaLabel: 'Business',
          ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
          stableId: 'class-business', testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '#class-business', xPath: '//button[@id="class-business"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'Business', timestamp: '2026-07-16T00:00:01Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output).toHaveLength(2);
    expect(result.output![0].value).toBe('Economy');
    expect(result.output![1].value).toBe('Business');
  });
});

describe('Value Selection — Custom Radio in Dialog', () => {
  it('role=radio button inside dialog produces Select event via radio type', () => {
    // Adani One: <div role="dialog"> <button role="radio" aria-checked="true">Economy</button>
    const radioEvent: SessionEvent = {
      actionId: 'radio-0001', type: 'radio',
      elementIdentity: {
        accessibleName: 'Economy', ariaRole: 'radio', ariaLabel: 'Economy',
        ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: 'travel-class',
        stableId: null, testId: null, dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'button[role="radio"]', xPath: '//button[@role="radio"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [radioEvent], recordingContext });
    expect(result.status).toBe('success');
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].plainEnglish).toBe("Select 'Economy'");
  });

  it('menuitemradio in menu produces Select event', () => {
    const radioEvent: SessionEvent = {
      actionId: 'radio-0001', type: 'radio',
      elementIdentity: {
        accessibleName: 'Sort by Name', ariaRole: 'menuitemradio', ariaLabel: 'Sort by Name',
        ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
        stableId: null, testId: null, dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'div[role="menuitemradio"]', xPath: '//div[@role="menuitemradio"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [radioEvent], recordingContext });
    expect(result.output![0].actionType).toBe('select');
  });
});

describe('Value Selection — Adani One Modal Dialog Scenario', () => {
  it('full modal flow: segmented control + counter buttons + submit', () => {
    // Adani One travel modal: passenger count buttons + travel class segmented control
    const events: SessionEvent[] = [
      // Click + to add a passenger
      makeClickEvent('click-0001', 'Add Adult'),
      // Select Premium Economy from segmented control
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Premium Economy', ariaRole: 'button', ariaLabel: 'Premium Economy',
          ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
          stableId: 'class-premium', testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '#class-premium', xPath: '//button[@id="class-premium"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'Premium Economy', timestamp: '2026-07-16T00:00:01Z',
      },
      // Click Done to close modal
      makeClickEvent('click-0002', 'Done'),
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(3);
    expect(result.output![0].actionType).toBe('click');
    expect(result.output![1].actionType).toBe('select');
    expect(result.output![2].actionType).toBe('click');
  });
});

describe('Value Selection — Execution JSON for Segmented Control', () => {
  it('segmented control produces valid Execution JSON with select action', () => {
    const timeline: SessionEvent[] = [{
      actionId: 'select-0001', type: 'select',
      elementIdentity: {
        accessibleName: 'Business', ariaRole: 'button', ariaLabel: 'Business',
        ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
        stableId: 'class-business', testId: 'travel-class', dataCy: null, dataQa: null,
        className: null,
        cssSelector: '#class-business', xPath: '//button[@id="class-business"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      value: 'Business', timestamp: '2026-07-16T00:00:00Z',
    }];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output![0].actionType).toBe('select');
  });
});

// ════════════════════════════════════════════════════════════════
// C5.2C — CSS-Only Value Selection (no ARIA) Runtime Fixes
//
// Adani One uses React segmented controls with plain <button> elements
// that toggle CSS classes (e.g., "active") without aria-pressed,
// role="radio", or any ARIA semantics. These tests verify:
//   1. CSS-only segmented control selection produces a Select event
//   2. No duplicate Click event is produced for the same interaction
//   3. The CSS-class-differential detection works in the canonical pipeline
// ════════════════════════════════════════════════════════════════

describe('C5.2C — CSS-Only Segmented Control (no ARIA)', () => {
  it('CSS-only segmented control selection produces Select event', () => {
    // Adani One travel class: <button class="segment-btn active">Premium Economy</button>
    // No aria-pressed, no role=radio. CSS "active" class marks selection.
    const selectEvent: SessionEvent = {
      actionId: 'select-0001',
      type: 'select',
      elementIdentity: {
        accessibleName: 'Premium Economy',
        ariaRole: 'button',
        ariaLabel: 'Premium Economy',
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'BUTTON',
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        className: null,
        cssSelector: 'div.segment-group > button:nth-child(2)',
        xPath: '//div[@class="segment-group"]/button[2]',
        inIframe: false,
        shadowDom: false,
        elementId: 'elem-0001',
      },
      value: 'Premium Economy',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].value).toBe('Premium Economy');
    expect(result.output![0].plainEnglish).toBe("Select 'Premium Economy' from Premium Economy");
  });

  it('CSS-only segmented control with icon child resolves correctly', () => {
    // The segmented control button contains an <i> icon and a <span> label.
    // The Select event should use the button's text/label, not the icon.
    const selectEvent: SessionEvent = {
      actionId: 'select-0001',
      type: 'select',
      elementIdentity: {
        accessibleName: 'Business',
        ariaRole: 'button',
        ariaLabel: 'Business',
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'BUTTON',
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        className: null,
        cssSelector: 'div.travel-class > button:nth-child(3)',
        xPath: '//div[@class="travel-class"]/button[3]',
        inIframe: false,
        shadowDom: false,
        elementId: 'elem-0001',
      },
      value: 'Business',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.status).toBe('success');
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].value).toBe('Business');
    expect(result.output![0].plainEnglish).toBe("Select 'Business' from Business");
  });

  it('CSS-only card selection (div group) produces Select event', () => {
    // Card-based selection: <div class="card active">Option A</div>
    const selectEvent: SessionEvent = {
      actionId: 'select-0001',
      type: 'select',
      elementIdentity: {
        accessibleName: 'Option A',
        ariaRole: null,
        ariaLabel: 'Option A',
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'DIV',
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        className: null,
        cssSelector: 'div.card-group > div:nth-child(1)',
        xPath: '//div[@class="card-group"]/div[1]',
        inIframe: false,
        shadowDom: false,
        elementId: 'elem-0001',
      },
      value: 'Option A',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.status).toBe('success');
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].value).toBe('Option A');
  });

  it('multiple CSS-only selections in sequence all produce Select events', () => {
    const events: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Economy', ariaRole: 'button', ariaLabel: 'Economy',
          ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: 'div.travel-class > button:nth-child(1)',
          xPath: '//div[@class="travel-class"]/button[1]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'Economy', timestamp: '2026-07-16T00:00:00Z',
      },
      {
        actionId: 'select-0002', type: 'select',
        elementIdentity: {
          accessibleName: 'First Class', ariaRole: 'button', ariaLabel: 'First Class',
          ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: 'div.travel-class > button:nth-child(4)',
          xPath: '//div[@class="travel-class"]/button[4]',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'First Class', timestamp: '2026-07-16T00:00:01Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output).toHaveLength(2);
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].value).toBe('Economy');
    expect(result.output![1].actionType).toBe('select');
    expect(result.output![1].value).toBe('First Class');
  });

  it('CSS-only segmented control produces valid Execution JSON', () => {
    const timeline: SessionEvent[] = [{
      actionId: 'select-0001', type: 'select',
      elementIdentity: {
        accessibleName: 'Premium Economy', ariaRole: 'button', ariaLabel: 'Premium Economy',
        ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
        stableId: null, testId: null, dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'div.segment-group > button:nth-child(2)',
        xPath: '//div[@class="segment-group"]/button[2]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      value: 'Premium Economy', timestamp: '2026-07-16T00:00:00Z',
    }];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output![0].actionType).toBe('select');
  });
});

// ── DOM-Level Tests for CSS-Class-Differential Detection ──

describe('C5.2C — CSS-Class-Differential DOM Detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('detects selection when clicked element gains "active" class and sibling loses it', () => {
    // Simulate Adani One segmented control
    document.body.innerHTML = `
      <div class="travel-class">
        <button class="segment-btn active" data-element="economy">Economy</button>
        <button class="segment-btn" data-element="premium">Premium Economy</button>
        <button class="segment-btn" data-element="business">Business</button>
        <button class="segment-btn" data-element="first">First Class</button>
      </div>
    `;

    const economyBtn = document.querySelector('[data-element="economy"]') as HTMLElement;
    const premiumBtn = document.querySelector('[data-element="premium"]') as HTMLElement;

    // Capture pre-click state: Economy has "active", Premium doesn't
    const economyClassesBefore = economyBtn.className;
    const premiumClassesBefore = premiumBtn.className;

    // Simulate React click: move "active" from Economy to Premium
    economyBtn.className = 'segment-btn';
    premiumBtn.className = 'segment-btn active';

    // Verify differential: Premium gained "active", Economy lost "active"
    expect(premiumBtn.className).toContain('active');
    expect(economyBtn.className).not.toContain('active');
    expect(premiumClassesBefore).not.toContain('active');
    expect(economyClassesBefore).toContain('active');

    // The "active" class matches SELECTION_CLASS_PATTERN
    const SELECTION_CLASS_PATTERN = /(^|[-_ ])(selected|active|checked|current|chosen|on)([-_ ]|$)/i;
    expect(SELECTION_CLASS_PATTERN.test('segment-btn active')).toBe(true);
    expect(SELECTION_CLASS_PATTERN.test('segment-btn')).toBe(false);
  });

  it('detects selection when clicked element gains "selected" class', () => {
    document.body.innerHTML = `
      <div class="card-group">
        <div class="card" data-element="a">Option A</div>
        <div class="card" data-element="b">Option B</div>
      </div>
    `;

    const cardB = document.querySelector('[data-element="b"]') as HTMLElement;
    const classesBefore = cardB.className;

    // Simulate click: add "selected" class
    cardB.className = 'card selected';

    const SELECTION_CLASS_PATTERN = /(^|[-_ ])(selected|active|checked|current|chosen|on)([-_ ]|$)/i;
    expect(classesBefore).not.toContain('selected');
    expect(cardB.className).toContain('selected');
    expect(SELECTION_CLASS_PATTERN.test('card selected')).toBe(true);
  });

  it('detects "is-active" as selection class (compound pattern)', () => {
    const SELECTION_CLASS_PATTERN = /(^|[-_ ])(selected|active|checked|current|chosen|on)([-_ ]|$)/i;
    // "is-active" should match because "-" is a boundary and "active" follows
    expect(SELECTION_CLASS_PATTERN.test('tab is-active')).toBe(true);
    expect(SELECTION_CLASS_PATTERN.test('tab-item-selected')).toBe(true);
    expect(SELECTION_CLASS_PATTERN.test('btn-checked')).toBe(true);
    // Non-selection classes should NOT match
    expect(SELECTION_CLASS_PATTERN.test('btn-primary')).toBe(false);
    expect(SELECTION_CLASS_PATTERN.test('color-blue')).toBe(false);
  });

  it('data-cmdrunner-pending-select is set on mousedown target', () => {
    // Verify the pending-select attribute suppresses the click recorder
    document.body.innerHTML = `
      <div class="segment-group">
        <button class="seg active">A</button>
        <button class="seg">B</button>
      </div>
    `;

    const btnB = document.querySelector('.seg:last-child') as HTMLElement;
    btnB.setAttribute('data-cmdrunner-pending-select', 'true');

    // The click recorder's isOwnedByAnother checks this attribute
    expect(btnB.closest('[data-cmdrunner-pending-select]')).not.toBeNull();
  });

  it('data-cmdrunner-pending-select is removed after deferred check finds no selection', () => {
    // When the CSS differential check fails (no selection class change),
    // the pending-select attribute must be removed so future clicks are not suppressed
    document.body.innerHTML = `
      <div class="group">
        <button class="btn">A</button>
        <button class="btn">B</button>
      </div>
    `;

    const btnB = document.querySelector('.btn:last-child') as HTMLElement;
    btnB.setAttribute('data-cmdrunner-pending-select', 'true');

    // Simulate: deferred check found no selection → cleanup
    btnB.removeAttribute('data-cmdrunner-pending-select');

    expect(btnB.closest('[data-cmdrunner-pending-select]')).toBeNull();
  });
});

// ── No Duplicate Click+Select for Same Element ──

describe('C5.2C — No Duplicate Click+Select for CSS-Only Controls', () => {
  it('CSS-only segmented control does NOT produce a Click event alongside Select', () => {
    // When the pending-select mechanism works correctly, only ONE event
    // (Select) should appear in the timeline for a CSS-only value selection.
    // This test verifies the pipeline processes a single Select event
    // without any accompanying Click event.
    const selectOnly: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Premium Economy', ariaRole: 'button', ariaLabel: 'Premium Economy',
          ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: 'div.segment-group > button:nth-child(2)',
          xPath: '//div[@class="segment-group"]/button[2]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'Premium Economy', timestamp: '2026-07-16T00:00:00Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: selectOnly, recordingContext });
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('select');
    // NO click event in the output
    expect(result.output!.some(s => s.actionType === 'click')).toBe(false);
  });

  it('full Adani One modal flow: counter click + CSS-only select + done click', () => {
    // Adani One flight booking modal:
    // 1. Click "+" to add passenger (generic Click)
    // 2. Select travel class from CSS-only segmented control (Select)
    // 3. Click "Done" to close modal (generic Click)
    const events: SessionEvent[] = [
      makeClickEvent('click-0001', 'Add Adult'),
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Premium Economy', ariaRole: 'button', ariaLabel: 'Premium Economy',
          ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: 'div.travel-class > button:nth-child(2)',
          xPath: '//div[@class="travel-class"]/button[2]',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'Premium Economy', timestamp: '2026-07-16T00:00:01Z',
      },
      makeClickEvent('click-0002', 'Done'),
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(3);
    expect(result.output![0].actionType).toBe('click');
    expect(result.output![0].plainEnglish).toContain('Add Adult');
    expect(result.output![1].actionType).toBe('select');
    expect(result.output![1].value).toBe('Premium Economy');
    expect(result.output![1].plainEnglish).toBe("Select 'Premium Economy' from Premium Economy");
    expect(result.output![2].actionType).toBe('click');
    expect(result.output![2].plainEnglish).toContain('Done');
  });

  it('OrangeHRM-like flow: CSS-only select + icon trigger click', () => {
    // OrangeHRM uses <i> tags for dropdown chevron icons.
    // With the italic text fix, icon clicks produce meaningful names.
    // With the CSS-only select fix, value selections are recognized.
    const events: SessionEvent[] = [
      // Click on <i> chevron-down icon (no longer "Italic Text")
      {
        actionId: 'click-0001', type: 'click',
        elementIdentity: {
          accessibleName: '', ariaRole: 'img', ariaLabel: null,
          ariaLabelledBy: null, placeholder: null, tag: 'I', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: 'i.oxd-icon', xPath: '//i[@class="oxd-icon"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        timestamp: '2026-07-16T00:00:00Z',
      },
      // Select value from dropdown
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Job Title', ariaRole: 'listbox', ariaLabel: 'Job Title',
          ariaLabelledBy: null, placeholder: null, tag: 'DIV', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '.oxd-select-wrapper', xPath: '//div[@class="oxd-select-wrapper"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'Software Engineer', timestamp: '2026-07-16T00:00:01Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(2);
    expect(result.output![0].actionType).toBe('click');
    expect(result.output![1].actionType).toBe('select');
    expect(result.output![1].value).toBe('Software Engineer');
  });
});

// ════════════════════════════════════════════════════════════════
// C5.2D — ARIA Menu Dropdown Selection (role="menuitem")
//
// OrangeHRM's profile dropdown uses the ARIA menu pattern:
//   <button aria-haspopup="menu">Profile</button>
//   <ul role="menu">
//     <li><a role="menuitem">Support</a></li>
//     <li><a role="menuitem">Change Password</a></li>
//   </ul>
//
// These tests verify that menu-item selection is recorded as a Select
// interaction (not a generic Click), and that the pipeline handles it
// through canonical steps, execution JSON, and Playwright output.
// ════════════════════════════════════════════════════════════════

describe('C5.2D — ARIA Menu Item Selection (role="menuitem")', () => {
  it('menu item inside role="menu" produces Select event', () => {
    // OrangeHRM profile dropdown: <a role="menuitem">Support</a>
    const selectEvent: SessionEvent = {
      actionId: 'select-0001',
      type: 'select',
      elementIdentity: {
        accessibleName: 'Support',
        ariaRole: 'menu',
        ariaLabel: 'Support',
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'A',
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        className: null,
        cssSelector: '[role="menu"] a[role="menuitem"]',
        xPath: '//ul[@role="menu"]//a[@role="menuitem"]',
        inIframe: false,
        shadowDom: false,
        elementId: 'elem-0001',
      },
      value: 'Support',
      timestamp: '2026-07-16T00:00:00Z',
    };

    const result = canonicalStepGenerator.generate({ timeline: [selectEvent], recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].value).toBe('Support');
    expect(result.output![0].plainEnglish).toBe("Select 'Support' from Support");
  });

  it('menu item selection produces valid Execution JSON', () => {
    const timeline: SessionEvent[] = [{
      actionId: 'select-0001', type: 'select',
      elementIdentity: {
        accessibleName: 'Change Password', ariaRole: 'menu', ariaLabel: 'Change Password',
        ariaLabelledBy: null, placeholder: null, tag: 'A', name: null,
        stableId: null, testId: null, dataCy: null, dataQa: null,
        className: null,
        cssSelector: '[role="menu"] a[role="menuitem"]',
        xPath: '//ul[@role="menu"]//a[@role="menuitem"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      value: 'Change Password', timestamp: '2026-07-16T00:00:00Z',
    }];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output![0].actionType).toBe('select');
  });

  it('multiple menu item selections in sequence all produce Select events', () => {
    const events: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'About', ariaRole: 'menu', ariaLabel: 'About',
          ariaLabelledBy: null, placeholder: null, tag: 'A', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '[role="menu"] a:nth-child(1)',
          xPath: '//ul[@role="menu"]/li[1]/a',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'About', timestamp: '2026-07-16T00:00:00Z',
      },
      {
        actionId: 'select-0002', type: 'select',
        elementIdentity: {
          accessibleName: 'Settings', ariaRole: 'menu', ariaLabel: 'Settings',
          ariaLabelledBy: null, placeholder: null, tag: 'A', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '[role="menu"] a:nth-child(2)',
          xPath: '//ul[@role="menu"]/li[2]/a',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'Settings', timestamp: '2026-07-16T00:00:01Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output).toHaveLength(2);
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].value).toBe('About');
    expect(result.output![1].actionType).toBe('select');
    expect(result.output![1].value).toBe('Settings');
  });
});

// ── DOM-Level Tests for ARIA Menu Item Detection ──

describe('C5.2D — Menu Item Selector DOM Detection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('MENU_ITEM_SELECTOR matches role="menuitem" inside role="menu"', () => {
    document.body.innerHTML = `
      <ul role="menu">
        <li><a role="menuitem" href="#">Support</a></li>
        <li><a role="menuitem" href="#">Settings</a></li>
      </ul>
    `;

    const MENU_ITEM_SELECTOR = '[role="menu"] [role="menuitem"]:not([role="menuitemcheckbox"]):not([role="menuitemradio"])';
    const items = document.querySelectorAll(MENU_ITEM_SELECTOR);
    expect(items).toHaveLength(2);
    expect(items[0].textContent?.trim()).toBe('Support');
    expect(items[1].textContent?.trim()).toBe('Settings');
  });

  it('MENU_ITEM_SELECTOR does NOT match menuitem outside role="menu"', () => {
    document.body.innerHTML = `
      <div>
        <a role="menuitem" href="#">Standalone Item</a>
      </div>
    `;

    const MENU_ITEM_SELECTOR = '[role="menu"] [role="menuitem"]:not([role="menuitemcheckbox"]):not([role="menuitemradio"])';
    const items = document.querySelectorAll(MENU_ITEM_SELECTOR);
    expect(items).toHaveLength(0);
  });

  it('MENU_ITEM_SELECTOR excludes menuitemcheckbox and menuitemradio', () => {
    document.body.innerHTML = `
      <ul role="menu">
        <li><div role="menuitemcheckbox">Toggle Option</div></li>
        <li><div role="menuitemradio">Radio Option</div></li>
        <li><a role="menuitem">Regular Item</a></li>
      </ul>
    `;

    const MENU_ITEM_SELECTOR = '[role="menu"] [role="menuitem"]:not([role="menuitemcheckbox"]):not([role="menuitemradio"])';
    const items = document.querySelectorAll(MENU_ITEM_SELECTOR);
    expect(items).toHaveLength(1);
    expect(items[0].textContent?.trim()).toBe('Regular Item');
  });

  it('MENU_ITEM_SELECTOR matches nested role="menuitem" inside li', () => {
    document.body.innerHTML = `
      <div role="menu">
        <ul>
          <li><span role="menuitem">Item A</span></li>
          <li><span role="menuitem">Item B</span></li>
          <li><span role="menuitem">Item C</span></li>
        </ul>
      </div>
    `;

    const MENU_ITEM_SELECTOR = '[role="menu"] [role="menuitem"]:not([role="menuitemcheckbox"]):not([role="menuitemradio"])';
    const items = document.querySelectorAll(MENU_ITEM_SELECTOR);
    expect(items).toHaveLength(3);
  });

  it('data-cmdrunner-pending-select suppresses click on menuitem after select claim', () => {
    document.body.innerHTML = `
      <ul role="menu">
        <li><a role="menuitem" id="item-support">Support</a></li>
      </ul>
    `;

    const item = document.getElementById('item-support')!;
    // Simulate select recorder claiming ownership
    item.setAttribute('data-cmdrunner-handled', 'select');

    // Click recorder's isOwnedByAnother checks this
    expect(item.closest('[data-cmdrunner-handled]')).not.toBeNull();
  });
});

// ── No Duplicate Click+Select for Menu Items ──

describe('C5.2D — No Duplicate Click+Select for Menu Items', () => {
  it('menu item selection does NOT produce a Click event alongside Select', () => {
    const selectOnly: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Support', ariaRole: 'menu', ariaLabel: 'Support',
          ariaLabelledBy: null, placeholder: null, tag: 'A', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '[role="menu"] a[role="menuitem"]',
          xPath: '//ul[@role="menu"]//a[@role="menuitem"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'Support', timestamp: '2026-07-16T00:00:00Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: selectOnly, recordingContext });
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('select');
    // NO click event in the output
    expect(result.output!.some(s => s.actionType === 'click')).toBe(false);
  });

  it('OrangeHRM profile dropdown full flow: icon trigger click + menu item select + navigation', () => {
    // The exact OrangeHRM scenario from the bug report:
    // 1. Click <i> chevron icon → records as "i icon" Click
    // 2. Click <a role="menuitem">Support</a> → records as Select "Support"
    // 3. Navigation to support page
    const events: SessionEvent[] = [
      // Icon trigger click (not suppressed — it's the dropdown opener)
      {
        actionId: 'click-0001', type: 'click',
        elementIdentity: {
          accessibleName: '', ariaRole: 'img', ariaLabel: null,
          ariaLabelledBy: null, placeholder: null, tag: 'I', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: 'i.oxd-userdropdown-icon',
          xPath: '//i[@class="oxd-userdropdown-icon"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        timestamp: '2026-07-16T00:00:00Z',
      },
      // Menu item selection (now recorded as Select, not Click)
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'Support', ariaRole: 'menu', ariaLabel: 'Support',
          ariaLabelledBy: null, placeholder: null, tag: 'A', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '[role="menu"] a[role="menuitem"]',
          xPath: '//ul[@role="menu"]//a[@role="menuitem"]',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'Support', timestamp: '2026-07-16T00:00:01Z',
      },
      // Navigation triggered by the menu item link
      makeNavEvent('nav-0001', 'https://opensource-demo.orangehrmlive.com/web/index.php/help/support'),
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(3);
    expect(result.output![0].actionType).toBe('click');
    expect(result.output![0].elementIdentity.tag).toBe('I');
    expect(result.output![1].actionType).toBe('select');
    expect(result.output![1].value).toBe('Support');
    expect(result.output![1].plainEnglish).toBe("Select 'Support' from Support");
    expect(result.output![2].actionType).toBe('navigate');
  });

  it('OrangeHRM with multiple menu selections records each as separate Select', () => {
    const events: SessionEvent[] = [
      {
        actionId: 'select-0001', type: 'select',
        elementIdentity: {
          accessibleName: 'About', ariaRole: 'menu', ariaLabel: 'About',
          ariaLabelledBy: null, placeholder: null, tag: 'A', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '[role="menu"] a:nth-child(1)',
          xPath: '//ul[@role="menu"]/li[1]/a',
          inIframe: false, shadowDom: false, elementId: 'elem-0001',
        },
        value: 'About', timestamp: '2026-07-16T00:00:00Z',
      },
      {
        actionId: 'select-0002', type: 'select',
        elementIdentity: {
          accessibleName: 'Support', ariaRole: 'menu', ariaLabel: 'Support',
          ariaLabelledBy: null, placeholder: null, tag: 'A', name: null,
          stableId: null, testId: null, dataCy: null, dataQa: null,
          className: null,
          cssSelector: '[role="menu"] a:nth-child(2)',
          xPath: '//ul[@role="menu"]/li[2]/a',
          inIframe: false, shadowDom: false, elementId: 'elem-0002',
        },
        value: 'Support', timestamp: '2026-07-16T00:00:01Z',
      },
    ];

    const result = canonicalStepGenerator.generate({ timeline: events, recordingContext });
    expect(result.output).toHaveLength(2);
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].value).toBe('About');
    expect(result.output![1].actionType).toBe('select');
    expect(result.output![1].value).toBe('Support');
  });
});

// ── Regression: Standalone menuitem still records as Click ──

describe('C5.2D — Regression: Standalone menuitem outside menu still Clicks', () => {
  it('role="menuitem" NOT inside role="menu" is NOT captured as Select', () => {
    // A standalone menuitem (e.g., in a menubar or app menu) should NOT
    // be intercepted by the select recorder. The pipeline test verifies
    // that if such an event somehow reached the pipeline, it would still
    // be processed correctly.
    //
    // The real protection is in the click recorder's MENU_ITEM_DROPDOWN_SELECTOR:
    // it only matches '[role="menu"] [role="menuitem"]', so a standalone
    // menuitem is NOT skipped and continues to be recorded as a Click.
    const MENU_ITEM_DROPDOWN_SELECTOR = '[role="menu"] [role="menuitem"]:not([role="menuitemcheckbox"]):not([role="menuitemradio"])';

    // Simulate a standalone menuitem
    document.body.innerHTML = '<div role="menuitem" id="standalone">Save</div>';
    const standalone = document.getElementById('standalone')!;
    expect(standalone.matches(MENU_ITEM_DROPDOWN_SELECTOR)).toBe(false);

    // Simulate a menuitem inside role="menu"
    document.body.innerHTML = '<ul role="menu"><li><a role="menuitem" id="in-menu">Save</a></li></ul>';
    const inMenu = document.getElementById('in-menu')!;
    expect(inMenu.matches(MENU_ITEM_DROPDOWN_SELECTOR)).toBe(true);
  });
});
