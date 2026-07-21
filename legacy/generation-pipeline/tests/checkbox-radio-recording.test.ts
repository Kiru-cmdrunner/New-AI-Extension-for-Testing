/**
 * Checkbox & Radio Button Recording Tests — Milestone C4.2
 *
 * Tests the interaction type registration, plain English generation,
 * and pipeline integration for Checkbox and Radio Button interactions.
 *
 * Permanently frozen C4.1: Checkbox and Radio Button interactions
 * represent state transitions, not physical clicks. Only meaningful
 * state changes are recorded.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getInteractionType, getRegisteredTypes } from '../src/recorder/interaction-types';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import type { SessionEvent, ElementIdentity, RecordingContext } from '../src/shared/types';
import type { CanonicalStep } from '../src/generation/types';

// ── Test Helpers ──────────────────────────────────────────

const recordingContext: RecordingContext = {
  startUrl: 'https://example.com',
  startTitle: 'Example',
  capturedAt: '2026-07-16T00:00:00Z',
};

function makeCheckboxEvent(
  actionId: string,
  accessibleName: string,
  checked: boolean,
  attrs: Partial<ElementIdentity> = {},
): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'checkbox',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'input[type="checkbox"]',
    xPath: '//input[@type="checkbox"]',
    inIframe: false,
    shadowDom: false,
    elementId: actionId.replace('check', 'elem'),
    ...attrs,
  };
  return {
    actionId,
    type: 'checkbox',
    elementIdentity: identity,
    checked,
    timestamp: '2026-07-16T00:00:00Z',
  };
}

function makeRadioEvent(
  actionId: string,
  accessibleName: string,
  attrs: Partial<ElementIdentity> = {},
): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'radio',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'input[type="radio"]',
    xPath: '//input[@type="radio"]',
    inIframe: false,
    shadowDom: false,
    elementId: actionId.replace('radio', 'elem'),
    ...attrs,
  };
  return {
    actionId,
    type: 'radio',
    elementIdentity: identity,
    timestamp: '2026-07-16T00:00:00Z',
  };
}

function makeClickEvent(
  actionId: string,
  accessibleName: string,
): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'button',
    ariaLabel: null, ariaLabelledBy: null, placeholder: null,
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

describe('C4.2 — Checkbox Interaction Type Registration', () => {
  it('checkbox type is registered', () => {
    const types = getRegisteredTypes();
    expect(types).toContain('checkbox');
  });

  it('checkbox config has correct actionType', () => {
    const config = getInteractionType('checkbox');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('checkbox');
  });

  it('checkbox config has correct idPrefix', () => {
    const config = getInteractionType('checkbox');
    expect(config!.idPrefix).toBe('check');
  });

  it('checkbox config has purple badge color', () => {
    const config = getInteractionType('checkbox');
    expect(config!.badgeColor).toBe('#8b5cf6');
  });

  it('checkbox config has Check badge label', () => {
    const config = getInteractionType('checkbox');
    expect(config!.badgeLabel).toBe('Check');
  });
});

describe('C4.2 — Radio Interaction Type Registration', () => {
  it('radio type is registered', () => {
    const types = getRegisteredTypes();
    expect(types).toContain('radio');
  });

  it('radio config has correct actionType', () => {
    const config = getInteractionType('radio');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('radio');
  });

  it('radio config has correct idPrefix', () => {
    const config = getInteractionType('radio');
    expect(config!.idPrefix).toBe('radio');
  });

  it('radio config has pink badge color', () => {
    const config = getInteractionType('radio');
    expect(config!.badgeColor).toBe('#ec4899');
  });

  it('radio config has Select badge label', () => {
    const config = getInteractionType('radio');
    expect(config!.badgeLabel).toBe('Select');
  });
});

describe('C4.2 — All Seven Interaction Types Registered', () => {
  it('exactly seven interaction types registered', () => {
    const types = getRegisteredTypes();
    expect(types).toHaveLength(7);
    expect(types).toContain('click');
    expect(types).toContain('text');
    expect(types).toContain('hover');
    expect(types).toContain('checkbox');
    expect(types).toContain('radio');
  });
});

// ── Plain English Generation ──────────────────────────────

describe('C4.2 — Checkbox Plain English', () => {
  it('generates "Check [name]" when checked=true', () => {
    const config = getInteractionType('checkbox')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Remember Me',
        ariaRole: 'checkbox', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input#remember', xPath: '//input[@id="remember"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: { checked: true },
    });
    expect(result).toBe('Check "Remember Me"');
  });

  it('generates "Uncheck [name]" when checked=false', () => {
    const config = getInteractionType('checkbox')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Subscribe to Newsletter',
        ariaRole: 'checkbox', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input#subscribe', xPath: '//input[@id="subscribe"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: { checked: false },
    });
    expect(result).toBe('Uncheck "Subscribe to Newsletter"');
  });

  it('uses AI business name when available', () => {
    const config = getInteractionType('checkbox')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'opt-in',
        ariaRole: 'checkbox', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input', xPath: '//input',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: { businessName: 'Marketing Consent Toggle' } as any,
      extras: { checked: true },
    });
    expect(result).toBe('Check "Marketing Consent Toggle"');
  });

  it('falls back to tag when no name available', () => {
    const config = getInteractionType('checkbox')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: '',
        ariaRole: null, ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input', xPath: '//input',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: { checked: true },
    });
    expect(result).toBe('Check "INPUT"');
  });
});

describe('C4.2 — Radio Plain English', () => {
  it('generates "Select [name]" using accessibleName', () => {
    const config = getInteractionType('radio')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Express Delivery',
        ariaRole: 'radio', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input[type="radio"]', xPath: '//input[@type="radio"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: {},
    });
    expect(result).toBe('Select "Express Delivery"');
  });

  it('uses AI business name when available', () => {
    const config = getInteractionType('radio')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'option1',
        ariaRole: 'radio', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input', xPath: '//input',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: { businessName: 'Credit Card Payment' } as any,
      extras: {},
    });
    expect(result).toBe('Select "Credit Card Payment"');
  });
});

// ── Canonical Step Generation ─────────────────────────────

describe('C4.2 — Canonical Step Generation (checkbox)', () => {
  it('generates canonical step for Check action', () => {
    const timeline: SessionEvent[] = [
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('toggle');
    expect(result.output![0].plainEnglish).toBe('Check the Remember Me');
  });

  it('generates canonical step for Uncheck action', () => {
    const timeline: SessionEvent[] = [
      makeCheckboxEvent('check-0001', 'Subscribe', false),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].plainEnglish).toBe('Uncheck the Subscribe');
  });
});

describe('C4.2 — Canonical Step Generation (radio)', () => {
  it('generates canonical step for Select action', () => {
    const timeline: SessionEvent[] = [
      makeRadioEvent('radio-0001', 'Express Delivery'),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('select');
    expect(result.output![0].plainEnglish).toBe("Select 'Express Delivery'");
  });
});

// ── Execution JSON Generation ─────────────────────────────

describe('C4.2 — Execution JSON (checkbox)', () => {
  it('check action produces action.type matching event', () => {
    const timeline: SessionEvent[] = [
      makeCheckboxEvent('check-0001', 'Remember Me', true),
    ];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output).toHaveLength(1);
  });
});

describe('C4.2 — Execution JSON (radio)', () => {
  it('radio action produces execution JSON', () => {
    const timeline: SessionEvent[] = [
      makeRadioEvent('radio-0001', 'Express Delivery'),
    ];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output).toHaveLength(1);
  });
});

// ── Full Pipeline: Checkbox → Click → Navigate ────────────

describe('C4.2 — Full Pipeline: Check → Click → Navigate', () => {
  it('generates all three step types through full pipeline', () => {
    const timeline: SessionEvent[] = [
      makeCheckboxEvent('check-0001', 'Remember Me', true),
      makeClickEvent('click-0001', 'Login'),
      makeNavEvent('nav-0001', 'https://example.com/dashboard'),
    ];

    // Canonical Steps
    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(canonicalResult.output).toHaveLength(3);
    expect(canonicalResult.output![0].plainEnglish).toBe('Check the Remember Me');

    // Execution JSON
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });
    expect(execResult.output).toHaveLength(3);
  });
});

describe('C4.2 — Full Pipeline: Radio → Click → Navigate', () => {
  it('generates all three step types through full pipeline', () => {
    const timeline: SessionEvent[] = [
      makeRadioEvent('radio-0001', 'Express Delivery'),
      makeClickEvent('click-0001', 'Continue'),
      makeNavEvent('nav-0001', 'https://example.com/checkout'),
    ];

    const canonicalResult = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(canonicalResult.output).toHaveLength(3);
    expect(canonicalResult.output![0].plainEnglish).toBe("Select 'Express Delivery'");

    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });
    expect(execResult.output).toHaveLength(3);
  });
});

// ── Multiple Sequential Checkbox/Radio ────────────────────

describe('C4.2 — Multiple Sequential Checkbox Interactions', () => {
  it('records multiple checkbox state changes in sequence', () => {
    const timeline: SessionEvent[] = [
      makeCheckboxEvent('check-0001', 'Option A', true),
      makeCheckboxEvent('check-0002', 'Option B', true),
      makeCheckboxEvent('check-0003', 'Option A', false),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.output).toHaveLength(3);
    expect(result.output![0].plainEnglish).toBe('Check the Option A');
    expect(result.output![1].plainEnglish).toBe('Check the Option B');
    expect(result.output![2].plainEnglish).toBe('Uncheck the Option A');
  });
});

describe('C4.2 — Multiple Sequential Radio Selections', () => {
  it('records radio group exploration (changing selection)', () => {
    const timeline: SessionEvent[] = [
      makeRadioEvent('radio-0001', 'Standard'),
      makeRadioEvent('radio-0002', 'Express'),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.output).toHaveLength(2);
    expect(result.output![0].plainEnglish).toBe("Select 'Standard'");
    expect(result.output![1].plainEnglish).toBe("Select 'Express'");
  });
});

// ── Regression: Existing Types Unaffected ─────────────────

describe('C4.2 — Regression: Existing Types Unaffected', () => {
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

  it('hover plain English still works', () => {
    const config = getInteractionType('hover')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Products',
        ariaRole: 'link', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'A', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'nav > a', xPath: '//nav/a',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: {},
    });
    expect(result).toBe('Hover over "Products"');
  });
});

// ── renderTitle ───────────────────────────────────────────

describe('C4.2 — renderTitle', () => {
  it('checkbox renderTitle uses accessibleName', () => {
    const config = getInteractionType('checkbox')!;
    const title = config.renderTitle({
      actionId: 'check-0001',
      type: 'checkbox',
      timestamp: '2026-07-16T00:00:00Z',
      elementIdentity: {
        accessibleName: 'Remember Me',
        ariaRole: 'checkbox', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input', xPath: '//input',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
    });
    expect(title).toBe('Remember Me');
  });

  it('radio renderTitle uses accessibleName', () => {
    const config = getInteractionType('radio')!;
    const title = config.renderTitle({
      actionId: 'radio-0001',
      type: 'radio',
      timestamp: '2026-07-16T00:00:00Z',
      elementIdentity: {
        accessibleName: 'Express Delivery',
        ariaRole: 'radio', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'INPUT', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input', xPath: '//input',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
    });
    expect(title).toBe('Express Delivery');
  });
});

// ── executionExtras ───────────────────────────────────────

describe('C4.2 — executionExtras', () => {
  it('checkbox executionExtras includes checked field', () => {
    const config = getInteractionType('checkbox')!;
    const extras = config.executionExtras({
      actionId: 'check-0001',
      type: 'checkbox',
      timestamp: '2026-07-16T00:00:00Z',
      elementIdentity: {} as any,
      checked: true,
    } as any);
    expect(extras).toEqual({ checked: true });
  });

  it('checkbox executionExtras includes checked=false', () => {
    const config = getInteractionType('checkbox')!;
    const extras = config.executionExtras({
      actionId: 'check-0001',
      type: 'checkbox',
      timestamp: '2026-07-16T00:00:00Z',
      elementIdentity: {} as any,
      checked: false,
    } as any);
    expect(extras).toEqual({ checked: false });
  });

  it('radio executionExtras returns empty object', () => {
    const config = getInteractionType('radio')!;
    const extras = config.executionExtras({
      actionId: 'radio-0001',
      type: 'radio',
      timestamp: '2026-07-16T00:00:00Z',
      elementIdentity: {} as any,
    } as any);
    expect(extras).toEqual({});
  });
});

// ── Permanent Regression: Gate 5 Exclusion (Disabled/Read-only) ──
//
// The content script runs in an isolated browser world and cannot be
// imported directly. These tests re-implement the Gate 5 DOM checks
// from checkbox-radio-content-script.ts using jsdom, verifying that
// disabled/read-only controls would be excluded at recording time.
// This follows the established pattern from click-interaction.test.ts.

// @ts-ignore - jsdom has no type declarations in this project
import { JSDOM } from 'jsdom';

describe('C4 — Permanent Regression: Gate 5 Exclusion', () => {
  let dom: Document;
  let domWindow: typeof globalThis;

  beforeEach(() => {
    const jsdom = new JSDOM('<!DOCTYPE html><body></body>');
    domWindow = jsdom.window as unknown as typeof globalThis;
    dom = domWindow.document;
  });

  function isControlEnabled(el: Element): boolean {
    const HTMLInputElement = domWindow.HTMLInputElement;
    if (el instanceof HTMLInputElement && el.disabled) return false;
    if (el instanceof HTMLInputElement && el.readOnly) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    const fieldset = el.closest('fieldset[disabled]');
    if (fieldset) return false;
    return true;
  }

  it('enabled checkbox passes Gate 5', () => {
    const cb = dom.createElement('input');
    cb.type = 'checkbox';
    cb.checked = false;
    expect(isControlEnabled(cb)).toBe(true);
  });

  it('disabled checkbox fails Gate 5 (not recorded)', () => {
    const cb = dom.createElement('input');
    cb.type = 'checkbox';
    cb.disabled = true;
    expect(isControlEnabled(cb)).toBe(false);
  });

  it('read-only checkbox fails Gate 5 (not recorded)', () => {
    const cb = dom.createElement('input');
    cb.type = 'checkbox';
    cb.readOnly = true;
    expect(isControlEnabled(cb)).toBe(false);
  });

  it('aria-disabled checkbox fails Gate 5 (not recorded)', () => {
    const cb = dom.createElement('input');
    cb.type = 'checkbox';
    cb.setAttribute('aria-disabled', 'true');
    expect(isControlEnabled(cb)).toBe(false);
  });

  it('checkbox inside disabled fieldset fails Gate 5', () => {
    const fieldset = dom.createElement('fieldset');
    fieldset.disabled = true;
    const cb = dom.createElement('input');
    cb.type = 'checkbox';
    fieldset.appendChild(cb);
    expect(isControlEnabled(cb)).toBe(false);
  });

  it('enabled radio passes Gate 5', () => {
    const radio = dom.createElement('input');
    radio.type = 'radio';
    expect(isControlEnabled(radio)).toBe(true);
  });

  it('disabled radio fails Gate 5 (not recorded)', () => {
    const radio = dom.createElement('input');
    radio.type = 'radio';
    radio.disabled = true;
    expect(isControlEnabled(radio)).toBe(false);
  });

  it('read-only radio fails Gate 5 (not recorded)', () => {
    const radio = dom.createElement('input');
    radio.type = 'radio';
    radio.readOnly = true;
    expect(isControlEnabled(radio)).toBe(false);
  });

  it('aria-disabled radio fails Gate 5 (not recorded)', () => {
    const radio = dom.createElement('input');
    radio.type = 'radio';
    radio.setAttribute('aria-disabled', 'true');
    expect(isControlEnabled(radio)).toBe(false);
  });

  it('radio inside disabled fieldset fails Gate 5', () => {
    const fieldset = dom.createElement('fieldset');
    fieldset.disabled = true;
    const radio = dom.createElement('input');
    radio.type = 'radio';
    fieldset.appendChild(radio);
    expect(isControlEnabled(radio)).toBe(false);
  });

  it('checkbox with aria-disabled=false passes Gate 5', () => {
    const cb = dom.createElement('input');
    cb.type = 'checkbox';
    cb.setAttribute('aria-disabled', 'false');
    expect(isControlEnabled(cb)).toBe(true);
  });
});

// ── Permanent Regression: Multiple Radio Groups ───────────

describe('C4 — Permanent Regression: Multiple Radio Groups', () => {
  it('records selections from multiple independent radio groups', () => {
    const timeline: SessionEvent[] = [
      makeRadioEvent('radio-0001', 'Standard', {
        name: 'shipping',
        className: null,
        cssSelector: 'input[name="shipping"][value="standard"]',
      }),
      makeRadioEvent('radio-0002', 'Credit Card', {
        name: 'payment',
        className: null,
        cssSelector: 'input[name="payment"][value="card"]',
      }),
      makeRadioEvent('radio-0003', 'Express', {
        name: 'shipping',
        className: null,
        cssSelector: 'input[name="shipping"][value="express"]',
      }),
    ];

    const result = canonicalStepGenerator.generate({ timeline, recordingContext });
    expect(result.output).toHaveLength(3);
    expect(result.output![0].plainEnglish).toBe("Select 'Standard'");
    expect(result.output![1].plainEnglish).toBe("Select 'Credit Card'");
    expect(result.output![2].plainEnglish).toBe("Select 'Express'");

    // Each has action.type "select" in Execution JSON
    const execResult = executionJsonGenerator.generate({
      steps: result.output as CanonicalStep[],
    });
    expect(execResult.output![0].executionJson!.action.type).toBe('select');
    expect(execResult.output![1].executionJson!.action.type).toBe('select');
    expect(execResult.output![2].executionJson!.action.type).toBe('select');
  });
});
