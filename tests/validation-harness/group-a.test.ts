/**
 * Group A — Form Input Validation
 *
 * Exercises capabilities A1–A6 through the full pipeline:
 *   ObservedEvent[] → ComponentRuntime → ComponentInteraction[] → IR → Playwright
 *
 * Each test records findings with quality scores. No fixes applied.
 */

import { describe, it, beforeEach } from 'vitest';
import {
  runFullPipeline,
  makeEvent,
  makeTarget,
  makeContext,
  resetEventCounter,
  recordFinding,
  getResolvedType,
  type Finding,
} from './harness';
import { IRAction } from '../../src/domain/execution-ir/types';

beforeEach(() => resetEventCounter());

// ─── A1: Text Entry ───────────────────────────────────────────────────

describe('A1 — Text Entry', () => {
  it('native text input: focus → type → blur', () => {
    const target = makeTarget({
      tag: 'INPUT', accessibleName: 'Email', ariaRole: 'textbox',
      inputType: 'email', cssSelector: 'input[name="email"]',
      stableId: 'email', name: 'email',
    });
    const ctx = makeContext({ inputType: 'email' });

    const result = runFullPipeline([
      makeEvent('focus', target, ctx, { valueBefore: '' }),
      makeEvent('input', target, ctx, { valueAfter: 'john@test.com' }),
      makeEvent('blur', target, ctx, { valueAfter: 'john@test.com' }),
    ]);

    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    const hasTextValue = ci?.metadata?.textValue !== undefined;
    const action = step?.action;
    const desc = step?.description ?? '';
    const pwLine = result.playwright
      ?.split('\n').find(l => l.includes('await page.')) ?? '';

    const scores = {
      q1_intent: resolvedType === 'TextEntry' ? 5 : resolvedType === 'Click' ? 2 : 1,
      q2_abstraction: result.interactions.length === 1 ? 5 : result.interactions.length <= 2 ? 4 : 2,
      q3_locator: target.testId ? 5 : target.stableId ? 4 : target.name ? 3 : 2,
      q4_description: desc.includes('Enter') && desc.includes('john@test.com') ? 5
        : desc.includes('Enter') ? 4 : desc.length > 0 ? 3 : 1,
      q5_replay: action === IRAction.FILL ? 5 : action === IRAction.CLICK ? 2 : 1,
      q6_confidence: ci?.endState === 'completed' ? 4 : 3, // 1.0 for completed is slightly overconfident
      q7_evidence: ci?.evidenceTrail && ci.evidenceTrail.length > 0 ? 4 : 3, // not expected for TextEntry
      q8_assertion: (step?.assertions?.length ?? 0) > 0 ? 4 : 2,
    };

    recordFinding({
      capabilityId: 'A1',
      capabilityName: 'Text Entry',
      scenario: 'Native text input: focus → type "john@test.com" → blur',
      app: 'synthetic (OrangeHRM-like)',
      expected: 'Single TextEntry interaction with textValue, FILL action, value assertion',
      observed: `${result.interactions.length} interaction(s), type=${resolvedType}, action=${action}, textValue=${hasTextValue}, assertions=${step?.assertions?.length ?? 0}, desc="${desc}"`,
      scores,
      supportLevel: scores.q1_intent >= 4 && scores.q5_replay >= 4 ? 'full' : 'partial',
      rootCause: resolvedType !== 'TextEntry' ? 'definition recognition' : '',
      severity: resolvedType !== 'TextEntry' ? 'P0' : 'P2',
      emitted: result.interactions,
      plan: result.irPlan,
      playwrightCode: result.playwright,
    } as Finding);
  });

  it('textarea: multi-line text entry', () => {
    const target = makeTarget({
      tag: 'TEXTAREA', accessibleName: 'Comments', ariaRole: 'textbox',
      cssSelector: 'textarea#comments', stableId: 'comments',
    });

    const result = runFullPipeline([
      makeEvent('focus', target, {}, { valueBefore: '' }),
      makeEvent('input', target, {}, { valueAfter: 'Line one\nLine two' }),
      makeEvent('blur', target, {}, { valueAfter: 'Line one\nLine two' }),
    ]);

    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    const step = result.irPlan?.steps[0];

    const scores = {
      q1_intent: resolvedType === 'TextEntry' ? 5 : 2,
      q2_abstraction: result.interactions.length === 1 ? 5 : 3,
      q3_locator: 4,
      q4_description: step?.description?.includes('Enter') ? 5 : 3,
      q5_replay: step?.action === IRAction.FILL ? 5 : 2,
      q6_confidence: 4,
      q7_evidence: 3,
      q8_assertion: (step?.assertions?.length ?? 0) > 0 ? 4 : 2,
    };

    recordFinding({
      capabilityId: 'A1',
      capabilityName: 'Text Entry',
      scenario: 'Textarea: multi-line text entry',
      app: 'synthetic',
      expected: 'TextEntry with multi-line textValue',
      observed: `type=${resolvedType}, interactions=${result.interactions.length}`,
      scores,
      supportLevel: 'full',
      rootCause: '',
      severity: 'P3',
      emitted: result.interactions,
      plan: result.irPlan,
      playwrightCode: result.playwright,
    } as Finding);
  });
});

// ─── A2: Checkbox / Toggle ───────────────────────────────────────────

describe('A2 — Checkbox / Toggle', () => {
  it('native checkbox: click to check', () => {
    const target = makeTarget({
      tag: 'INPUT', accessibleName: 'Subscribe to newsletter', ariaRole: 'checkbox',
      cssSelector: 'input[type="checkbox"]#subscribe', stableId: 'subscribe', name: 'subscribe',
    });

    const result = runFullPipeline([
      makeEvent('click', target, {}, { checkedBefore: false, checkedAfter: true }),
    ]);

    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    const step = result.irPlan?.steps[0];

    const scores = {
      q1_intent: resolvedType === 'Checkbox' ? 5 : resolvedType === 'Click' ? 2 : 1,
      q2_abstraction: result.interactions.length === 1 ? 5 : 3,
      q3_locator: 4,
      q4_description: step?.description?.includes('Check') ? 5 : 3,
      q5_replay: step?.action === IRAction.TOGGLE ? 5 : 2,
      q6_confidence: 4,
      q7_evidence: ci?.evidenceTrail?.length ? 4 : 3,
      q8_assertion: (step?.assertions?.length ?? 0) > 0 ? 4 : 2,
    };

    recordFinding({
      capabilityId: 'A2',
      capabilityName: 'Checkbox / Toggle',
      scenario: 'Native checkbox: click to check',
      app: 'synthetic (OrangeHRM-like)',
      expected: 'Checkbox interaction with checked=true, TOGGLE action',
      observed: `type=${resolvedType}, action=${step?.action}, checked=${ci?.metadata?.checked}, assertions=${step?.assertions?.length ?? 0}`,
      scores,
      supportLevel: resolvedType === 'Checkbox' ? 'full' : 'partial',
      rootCause: resolvedType !== 'Checkbox' ? 'definition recognition' : '',
      severity: resolvedType !== 'Checkbox' ? 'P1' : 'P3',
      emitted: result.interactions,
      plan: result.irPlan,
      playwrightCode: result.playwright,
    } as Finding);
  });

  it('ARIA switch (role=switch): click to toggle', () => {
    const target = makeTarget({
      tag: 'BUTTON', accessibleName: 'Enable WiFi', ariaRole: 'switch',
      cssSelector: 'button[role="switch"]', stableId: 'wifi-toggle',
    });

    const result = runFullPipeline([
      makeEvent('click', target, {}, { checkedBefore: false, checkedAfter: true }),
    ]);

    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    const step = result.irPlan?.steps[0];

    const scores = {
      q1_intent: resolvedType === 'ToggleSwitch' ? 5 : resolvedType === 'Checkbox' ? 4 : 2,
      q2_abstraction: 5,
      q3_locator: 4,
      q4_description: step?.description?.includes('Enable') ? 5 : 3,
      q5_replay: step?.action === IRAction.TOGGLE ? 5 : 2,
      q6_confidence: 4,
      q7_evidence: ci?.evidenceTrail?.length ? 4 : 3,
      q8_assertion: (step?.assertions?.length ?? 0) > 0 ? 4 : 2,
    };

    recordFinding({
      capabilityId: 'A2',
      capabilityName: 'Checkbox / Toggle',
      scenario: 'ARIA switch (role=switch): click to toggle on',
      app: 'synthetic (React Spectrum-like)',
      expected: 'ToggleSwitch interaction (not generic Checkbox)',
      observed: `type=${resolvedType}, action=${step?.action}`,
      scores,
      supportLevel: resolvedType === 'ToggleSwitch' || resolvedType === 'Checkbox' ? 'full' : 'partial',
      rootCause: resolvedType !== 'ToggleSwitch' && resolvedType !== 'Checkbox' ? 'definition recognition' : '',
      severity: 'P2',
      emitted: result.interactions,
      plan: result.irPlan,
      playwrightCode: result.playwright,
    } as Finding);
  });
});

// ─── A3: Radio Button ────────────────────────────────────────────────

describe('A3 — Radio Button', () => {
  it('native radio: click to select', () => {
    const target = makeTarget({
      tag: 'INPUT', accessibleName: 'Monthly', ariaRole: 'radio',
      cssSelector: 'input[type="radio"][value="monthly"]', stableId: 'billing-monthly',
      name: 'billing_cycle',
    });

    const result = runFullPipeline([
      makeEvent('click', target, {}, { checkedBefore: false, checkedAfter: true }),
    ]);

    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    const step = result.irPlan?.steps[0];

    const scores = {
      q1_intent: resolvedType === 'RadioButton' ? 5 : 2,
      q2_abstraction: 5,
      q3_locator: 4,
      q4_description: step?.description?.includes('Select') ? 5 : 3,
      q5_replay: step?.action === IRAction.TOGGLE ? 4 : 2, // toggle is acceptable for radio
      q6_confidence: 4,
      q7_evidence: 3,
      q8_assertion: (step?.assertions?.length ?? 0) > 0 ? 4 : 2,
    };

    recordFinding({
      capabilityId: 'A3',
      capabilityName: 'Radio Button',
      scenario: 'Native radio: click to select "Monthly"',
      app: 'synthetic',
      expected: 'RadioButton interaction with checked=true',
      observed: `type=${resolvedType}, action=${step?.action}`,
      scores,
      supportLevel: resolvedType === 'RadioButton' ? 'full' : 'partial',
      rootCause: resolvedType !== 'RadioButton' ? 'definition recognition' : '',
      severity: resolvedType !== 'RadioButton' ? 'P1' : 'P3',
      emitted: result.interactions,
      plan: result.irPlan,
      playwrightCode: result.playwright,
    } as Finding);
  });
});

// ─── A4: Dropdown — Native ──────────────────────────────────────────

describe('A4 — Native Dropdown', () => {
  it('native <select>: change to option', () => {
    const target = makeTarget({
      tag: 'SELECT', accessibleName: 'Country', ariaRole: 'combobox',
      cssSelector: 'select#country', stableId: 'country', name: 'country',
    });

    const result = runFullPipeline([
      makeEvent('change', target, {}, { valueAfter: 'United States' }),
    ]);

    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    const step = result.irPlan?.steps[0];

    const scores = {
      q1_intent: resolvedType === 'NativeDropdown' ? 5 : resolvedType === 'CustomDropdown' ? 4 : 2,
      q2_abstraction: 5,
      q3_locator: 4,
      q4_description: step?.description?.includes('Select') ? 5 : 3,
      q5_replay: step?.action === IRAction.SELECT ? 5 : 2,
      q6_confidence: 4,
      q7_evidence: 3,
      q8_assertion: (step?.assertions?.length ?? 0) > 0 ? 4 : 2,
    };

    recordFinding({
      capabilityId: 'A4',
      capabilityName: 'Native Dropdown',
      scenario: 'Native <select>: change to "United States"',
      app: 'synthetic (OrangeHRM-like)',
      expected: 'NativeDropdown with selectedValue',
      observed: `type=${resolvedType}, action=${step?.action}, selectedValue=${ci?.metadata?.selectedValue ?? 'MISSING'}`,
      scores,
      supportLevel: resolvedType === 'NativeDropdown' ? 'full' : 'partial',
      rootCause: resolvedType !== 'NativeDropdown' ? 'definition recognition' : '',
      severity: resolvedType !== 'NativeDropdown' ? 'P1' : 'P3',
      emitted: result.interactions,
      plan: result.irPlan,
      playwrightCode: result.playwright,
    } as Finding);
  });
});

// ─── A5: Dropdown — Custom ──────────────────────────────────────────

describe('A5 — Custom Dropdown', () => {
  it('ARIA combobox: click trigger → click option', () => {
    const trigger = makeTarget({
      tag: 'BUTTON', accessibleName: 'Sort by', ariaRole: 'combobox',
      ariaExpanded: false, ariaHasPopup: 'listbox',
      cssSelector: 'button#sort-trigger', stableId: 'sort-trigger',
    });
    const triggerCtx = makeContext({ ariaExpanded: false, ariaHasPopup: 'listbox' });

    const option = makeTarget({
      tag: 'LI', accessibleName: 'Price: Low to High', ariaRole: 'option',
      cssSelector: 'li[data-value="price-asc"]', stableId: 'opt-price-asc',
    });
    const optionCtx = makeContext({ surfaceType: 'listbox', surfaceLabel: 'Sort options' });

    const result = runFullPipeline([
      makeEvent('click', trigger, triggerCtx),
      makeEvent('click', option, optionCtx),
    ]);

    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    const step = result.irPlan?.steps[0];

    const scores = {
      q1_intent: resolvedType === 'CustomDropdown' || resolvedType === 'Autocomplete' ? 5
        : resolvedType === 'Click' ? 2 : 3,
      q2_abstraction: result.interactions.length === 1 ? 5 : result.interactions.length === 2 ? 3 : 2,
      q3_locator: 4,
      q4_description: step?.description?.includes('Select') ? 5 : 3,
      q5_replay: step?.action === IRAction.SELECT ? 5 : 2,
      q6_confidence: 3,
      q7_evidence: 3,
      q8_assertion: (step?.assertions?.length ?? 0) > 0 ? 4 : 2,
    };

    recordFinding({
      capabilityId: 'A5',
      capabilityName: 'Custom Dropdown',
      scenario: 'ARIA combobox: click trigger → click option',
      app: 'synthetic (Booking.com-like)',
      expected: 'Single CustomDropdown interaction with selectedValue, surface lifecycle captured',
      observed: `${result.interactions.length} interaction(s), type[0]=${resolvedType}, action=${step?.action}`,
      scores,
      supportLevel: resolvedType === 'CustomDropdown' || resolvedType === 'Autocomplete' ? 'full' : 'partial',
      rootCause: resolvedType === 'Click' ? 'definition recognition — surface lifecycle not recognized' : '',
      severity: resolvedType === 'Click' ? 'P1' : 'P2',
      emitted: result.interactions,
      plan: result.irPlan,
      playwrightCode: result.playwright,
    } as Finding);
  });

  it('autocomplete: typeahead search → select suggestion', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Search city', ariaRole: 'combobox',
      inputType: 'text', ariaExpanded: false, ariaHasPopup: 'listbox',
      cssSelector: 'input#city-search', stableId: 'city-search',
    });
    const inputCtx = makeContext({ inputType: 'text', ariaHasPopup: 'listbox' });

    const option = makeTarget({
      tag: 'LI', accessibleName: 'Mumbai, India', ariaRole: 'option',
      cssSelector: 'li[data-value="BOM"]', stableId: 'opt-bom',
    });
    const optionCtx = makeContext({ surfaceType: 'listbox', surfaceLabel: 'City results' });

    const result = runFullPipeline([
      makeEvent('focus', input, inputCtx),
      makeEvent('input', input, inputCtx, { valueAfter: 'mum' }),
      makeEvent('click', option, optionCtx),
    ]);

    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    const scores = {
      q1_intent: resolvedType === 'Autocomplete' || resolvedType === 'SearchableDropdown' ? 5
        : resolvedType === 'CustomDropdown' ? 4 : resolvedType === 'TextEntry' ? 3 : 2,
      q2_abstraction: result.interactions.length <= 2 ? 4 : 2,
      q3_locator: 4,
      q4_description: 3,
      q5_replay: 3,
      q6_confidence: 3,
      q7_evidence: 3,
      q8_assertion: 2,
    };

    recordFinding({
      capabilityId: 'A5',
      capabilityName: 'Custom Dropdown',
      scenario: 'Autocomplete: type "mum" → select "Mumbai, India"',
      app: 'synthetic (Booking.com-like)',
      expected: 'Autocomplete/SearchableDropdown with typeahead + selection',
      observed: `${result.interactions.length} interaction(s), type[0]=${resolvedType}`,
      scores,
      supportLevel: 'partial',
      rootCause: 'autocomplete lifecycle not tested with real surface context',
      severity: 'P2',
      emitted: result.interactions,
      plan: result.irPlan,
      playwrightCode: result.playwright,
    } as Finding);
  });
});

// ─── A6: Date Picker ────────────────────────────────────────────────

describe('A6 — Date Picker', () => {
  it('native date input: change to date', () => {
    const target = makeTarget({
      tag: 'INPUT', accessibleName: 'Date of Birth', ariaRole: 'textbox',
      inputType: 'date', cssSelector: 'input[type="date"]', stableId: 'dob',
    });
    const ctx = makeContext({ inputType: 'date' });

    const result = runFullPipeline([
      makeEvent('change', target, ctx, { valueAfter: '1990-05-15' }),
    ]);

    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    const step = result.irPlan?.steps[0];

    const scores = {
      q1_intent: resolvedType === 'DatePicker' ? 5 : 2,
      q2_abstraction: 5,
      q3_locator: 4,
      q4_description: step?.description?.includes('date') || step?.description?.includes('Date') ? 5 : 3,
      q5_replay: step?.action === IRAction.SELECT_DATE ? 5 : 2,
      q6_confidence: 4,
      q7_evidence: 3,
      q8_assertion: (step?.assertions?.length ?? 0) > 0 ? 4 : 2,
    };

    recordFinding({
      capabilityId: 'A6',
      capabilityName: 'Date Picker',
      scenario: 'Native date input: change to 1990-05-15',
      app: 'synthetic (OrangeHRM-like)',
      expected: 'DatePicker with dateValue, SELECT_DATE action',
      observed: `type=${resolvedType}, action=${step?.action}, dateValue=${ci?.metadata?.dateValue ?? 'MISSING'}`,
      scores,
      supportLevel: resolvedType === 'DatePicker' ? 'full' : 'partial',
      rootCause: resolvedType !== 'DatePicker' ? 'definition recognition' : '',
      severity: resolvedType !== 'DatePicker' ? 'P1' : 'P3',
      emitted: result.interactions,
      plan: result.irPlan,
      playwrightCode: result.playwright,
    } as Finding);
  });
});
