/**
 * Expanded Validation: Framework-Specific Component Patterns
 *
 * Tests whether the classification pipeline correctly identifies
 * real-world components from MUI, Ant Design, and Radix UI — even
 * when ARIA attributes are missing and only CSS class signatures
 * are available.
 *
 * Key question: does the PatternRegistry actually work? If not,
 * capabilities scored as FULL in the idealized validation may be
 * PARTIAL on real apps.
 */

import { describe, it, beforeEach, expect } from 'vitest';
import {
  runFullPipeline, makeEvent, makeTarget, makeContext,
  resetEventCounter, recordFinding, getResolvedType,
  type Finding,
} from './harness';

beforeEach(() => resetEventCounter());

// ── MUI (Material-UI) ──────────────────────────────────────────────────

describe('MUI Framework Patterns', () => {
  it('MUI Select dropdown (click trigger → click option)', () => {
    // Real MUI Select: the trigger is a div.MuiSelect-select with no
    // explicit aria-haspopup, relying on the MuiSelect class for identification.
    const trigger = makeTarget({
      tag: 'DIV',
      accessibleName: 'Age',
      ariaRole: 'combobox',  // MUI v5 sets role=combobox on the trigger
      ariaHasPopup: 'listbox',
      className: 'MuiSelect-select MuiSelect-outlined MuiInputBase-input css-1x',
      cssSelector: 'div.MuiSelect-select',
      stableId: ':r2:',
    });
    const option = makeTarget({
      tag: 'LI',
      accessibleName: 'Thirty',
      ariaRole: 'option',
      className: 'MuiMenuItem-root MuiMenuItem-gutters css-2y',
      cssSelector: 'li.MuiMenuItem-root',
      stableId: null,
    });
    const result = runFullPipeline([
      makeEvent('click', trigger, makeContext({ ariaHasPopup: 'listbox' })),
      makeEvent('click', option, makeContext({ surfaceType: 'popover', surfaceLabel: 'Age' })),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'MUI-1', capabilityName: 'MUI Select',
      scenario: 'MUI v5 Select dropdown',
      app: 'synthetic (MUI v5)',
      expected: 'CustomDropdown or Dropdown with selectOption subAction',
      observed: `${result.interactions.length} interaction(s), type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'CustomDropdown' || resolvedType === 'Dropdown' ? 5 : resolvedType === 'Click' ? 2 : 1,
        q2_abstraction: result.interactions.length === 1 ? 5 : 2,
        q3_locator: 3, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'CustomDropdown' || resolvedType === 'Dropdown' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('MUI Checkbox (no native input visible)', () => {
    // MUI Checkbox: a span.MuiCheckbox-root wrapping a hidden input.
    // The user clicks the visible label/wrapper.
    const target = makeTarget({
      tag: 'SPAN',
      accessibleName: 'Accept terms',
      ariaRole: 'checkbox',
      className: 'MuiCheckbox-root MuiCheckbox-colorPrimary css-1a',
      cssSelector: 'span.MuiCheckbox-root',
      stableId: ':r3:',
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'MUI-2', capabilityName: 'MUI Checkbox',
      scenario: 'MUI Checkbox (SPAN with role=checkbox)',
      app: 'synthetic (MUI v5)',
      expected: 'Checkbox interaction',
      observed: `type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'Checkbox' ? 5 : 2,
        q2_abstraction: 5, q3_locator: 3, q4_description: 4,
        q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3,
      },
      supportLevel: resolvedType === 'Checkbox' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('MUI Switch (toggle)', () => {
    // MUI Switch: span.MuiSwitch-root, role=switch
    const target = makeTarget({
      tag: 'SPAN',
      accessibleName: 'Dark mode',
      ariaRole: 'switch',
      className: 'MuiSwitch-root MuiSwitch-switchBase MuiSwitch-colorPrimary css-1b',
      cssSelector: 'span.MuiSwitch-root',
      stableId: ':r4:',
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'MUI-3', capabilityName: 'MUI Switch',
      scenario: 'MUI Switch (role=switch)',
      app: 'synthetic (MUI v5)',
      expected: 'Checkbox or Switch toggle',
      observed: `type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'Checkbox' || resolvedType === 'ToggleSwitch' ? 5 : 2,
        q2_abstraction: 5, q3_locator: 3, q4_description: 4,
        q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3,
      },
      supportLevel: resolvedType === 'Checkbox' || resolvedType === 'ToggleSwitch' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('MUI DatePicker (calendar cell click)', () => {
    // MUI DatePicker: triggers on a div with MuiPickersDay class.
    // The trigger is a TEXT input (not type=date) — MUI uses a text input
    // with a custom calendar popup.
    const trigger = makeTarget({
      tag: 'INPUT',
      accessibleName: 'Choose date',
      ariaRole: 'textbox',
      inputType: 'text' as any,
      className: 'MuiInputBase-input MuiOutlinedInput-input css-date',
      cssSelector: 'input.MuiInputBase-input',
      stableId: ':r5:',
    });
    const dayCell = makeTarget({
      tag: 'BUTTON',
      accessibleName: '15',
      ariaRole: 'gridcell',
      className: 'MuiPickersDay-root MuiPickersDay-dayWithMargin css-day15',
      cssSelector: 'button.MuiPickersDay-root',
      stableId: null,
    });
    const result = runFullPipeline([
      makeEvent('click', trigger, makeContext({ inputType: 'text', ariaHasPopup: 'dialog' })),
      makeEvent('click', dayCell),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'MUI-4', capabilityName: 'MUI DatePicker',
      scenario: 'MUI DatePicker (text input trigger → calendar cell click)',
      app: 'synthetic (MUI v5)',
      expected: 'DatePicker interaction',
      observed: `${result.interactions.length} interaction(s), type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'DatePicker' ? 5 : 2,
        q2_abstraction: result.interactions.length === 1 ? 5 : 3,
        q3_locator: 3, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'DatePicker' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('MUI Tab (click tab button)', () => {
    const target = makeTarget({
      tag: 'DIV',
      accessibleName: 'Settings',
      ariaRole: 'tab',
      className: 'MuiTab-root MuiButtonBase-root MuiTab-textColorPrimary css-tab',
      cssSelector: 'div.MuiTab-root',
      stableId: ':r6:',
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'MUI-5', capabilityName: 'MUI Tab',
      scenario: 'MUI Tab panel activation',
      app: 'synthetic (MUI v5)',
      expected: 'Tab interaction',
      observed: `type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'Tab' ? 5 : 2,
        q2_abstraction: 5, q3_locator: 3, q4_description: 4,
        q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'Tab' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// ── Ant Design ─────────────────────────────────────────────────────────

describe('Ant Design Patterns', () => {
  it('Ant Select (dropdown trigger → option click)', () => {
    const trigger = makeTarget({
      tag: 'DIV',
      accessibleName: 'Language',
      ariaRole: 'combobox',
      ariaHasPopup: 'listbox',
      className: 'ant-select ant-select-single ant-select-show-arrow',
      cssSelector: 'div.ant-select',
      stableId: 'rc_select_1',
    });
    const option = makeTarget({
      tag: 'DIV',
      accessibleName: 'English',
      ariaRole: 'option',
      className: 'ant-select-item ant-select-item-option ant-select-item-option-active',
      cssSelector: 'div.ant-select-item',
      stableId: null,
    });
    const result = runFullPipeline([
      makeEvent('click', trigger, makeContext({ ariaHasPopup: 'listbox' })),
      makeEvent('click', option, makeContext({ surfaceType: 'popover', surfaceLabel: 'Language' })),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'ANT-1', capabilityName: 'Ant Select',
      scenario: 'Ant Design Select dropdown',
      app: 'synthetic (Ant Design v5)',
      expected: 'CustomDropdown or Dropdown',
      observed: `${result.interactions.length} interaction(s), type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'CustomDropdown' || resolvedType === 'Dropdown' ? 5 : 2,
        q2_abstraction: result.interactions.length === 1 ? 5 : 2,
        q3_locator: 3, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'CustomDropdown' || resolvedType === 'Dropdown' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('Ant Checkbox', () => {
    const target = makeTarget({
      tag: 'LABEL',
      accessibleName: 'Remember me',
      ariaRole: 'checkbox',
      className: 'ant-checkbox-wrapper',
      cssSelector: 'label.ant-checkbox-wrapper',
      stableId: null,
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'ANT-2', capabilityName: 'Ant Checkbox',
      scenario: 'Ant Design Checkbox (LABEL wrapper)',
      app: 'synthetic (Ant Design v5)',
      expected: 'Checkbox interaction',
      observed: `type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'Checkbox' ? 5 : 2,
        q2_abstraction: 5, q3_locator: 3, q4_description: 4,
        q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3,
      },
      supportLevel: resolvedType === 'Checkbox' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('Ant DatePicker', () => {
    const trigger = makeTarget({
      tag: 'DIV',
      accessibleName: 'Select date',
      ariaRole: null,
      className: 'ant-picker ant-picker-normal',
      cssSelector: 'div.ant-picker',
      stableId: 'date1',
    });
    const result = runFullPipeline([
      makeEvent('click', trigger, makeContext({ ariaHasPopup: 'dialog' })),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'ANT-3', capabilityName: 'Ant DatePicker',
      scenario: 'Ant Design DatePicker (div.ant-picker, no ARIA role)',
      app: 'synthetic (Ant Design v5)',
      expected: 'DatePicker interaction',
      observed: `type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'DatePicker' ? 5 : 2,
        q2_abstraction: 5, q3_locator: 3, q4_description: 3,
        q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'DatePicker' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// ── Radix UI ───────────────────────────────────────────────────────────

describe('Radix UI Patterns', () => {
  it('Radix Select (trigger → option)', () => {
    const trigger = makeTarget({
      tag: 'BUTTON',
      accessibleName: 'Fruit',
      ariaRole: 'combobox',
      ariaHasPopup: 'listbox',
      className: 'SelectTrigger select-trigger',
      cssSelector: 'button.SelectTrigger',
      stableId: null,
    });
    const option = makeTarget({
      tag: 'DIV',
      accessibleName: 'Apple',
      ariaRole: 'option',
      className: 'SelectItem select-item',
      cssSelector: 'div.SelectItem',
      stableId: null,
    });
    const result = runFullPipeline([
      makeEvent('click', trigger, makeContext({ ariaHasPopup: 'listbox' })),
      makeEvent('click', option, makeContext({ surfaceType: 'popover', surfaceLabel: 'Fruit' })),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'RADIX-1', capabilityName: 'Radix Select',
      scenario: 'Radix UI Select (button trigger → div option)',
      app: 'synthetic (Radix UI)',
      expected: 'CustomDropdown or Dropdown',
      observed: `${result.interactions.length} interaction(s), type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'CustomDropdown' || resolvedType === 'Dropdown' ? 5 : 2,
        q2_abstraction: result.interactions.length === 1 ? 5 : 2,
        q3_locator: 3, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'CustomDropdown' || resolvedType === 'Dropdown' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('Radix Dialog (trigger → confirm)', () => {
    const trigger = makeTarget({
      tag: 'BUTTON',
      accessibleName: 'Delete account',
      ariaRole: 'button',
      className: 'Button root',
      cssSelector: 'button',
      stableId: 'del-btn',
    });
    const confirmBtn = makeTarget({
      tag: 'BUTTON',
      accessibleName: 'Confirm',
      ariaRole: 'button',
      className: 'DialogAction DialogConfirm',
      cssSelector: 'button.DialogAction',
      stableId: 'confirm-btn',
    });
    const result = runFullPipeline([
      makeEvent('click', trigger),
      makeEvent('click', confirmBtn, makeContext({ surfaceType: 'dialog', surfaceLabel: 'Delete account' })),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'RADIX-2', capabilityName: 'Radix Dialog',
      scenario: 'Radix Dialog (trigger → confirm in dialog)',
      app: 'synthetic (Radix UI)',
      expected: 'ModalDialog or Click interactions',
      observed: `${result.interactions.length} interaction(s), type=${resolvedType}`,
      scores: {
        q1_intent: 3, q2_abstraction: 3, q3_locator: 3,
        q4_description: 3, q5_replay: 3, q6_confidence: 3,
        q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: 'partial', rootCause: 'compound lifecycle', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('Radix Checkbox (no native input visible)', () => {
    const target = makeTarget({
      tag: 'BUTTON',
      accessibleName: 'Subscribe to newsletter',
      ariaRole: 'checkbox',
      className: 'CheckboxRoot checkbox-root',
      cssSelector: 'button.CheckboxRoot',
      stableId: null,
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'RADIX-3', capabilityName: 'Radix Checkbox',
      scenario: 'Radix Checkbox (BUTTON with role=checkbox)',
      app: 'synthetic (Radix UI)',
      expected: 'Checkbox interaction',
      observed: `type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'Checkbox' ? 5 : 2,
        q2_abstraction: 5, q3_locator: 3, q4_description: 4,
        q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3,
      },
      supportLevel: resolvedType === 'Checkbox' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// ── Incomplete ARIA (no framework classes, no testId) ──────────────────

describe('Incomplete ARIA Patterns', () => {
  it('clickable DIV with onClick but no role/class', () => {
    // Real-world SPA: a div with onClick handler but no ARIA.
    // This is the hardest case — no semantic signals at all.
    const target = makeTarget({
      tag: 'DIV',
      accessibleName: 'Submit order',
      ariaRole: null,
      className: 'css-hash1',
      cssSelector: 'div.css-hash1',
      stableId: null,
      testId: null,
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'NOROLE-1', capabilityName: 'No-ARIA Click',
      scenario: 'Click on DIV with accessibleName but no role/class',
      app: 'synthetic (generic SPA)',
      expected: 'Click interaction (or none if element is not interactive)',
      observed: `${result.interactions.length} interaction(s), type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'Click' ? 4 : 2,
        q2_abstraction: 5, q3_locator: 2, q4_description: 3,
        q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'Click' ? 'full' : 'unsupported',
      rootCause: resolvedType !== 'Click' ? 'element has no interactive tag/role/class' : '',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('React auto-generated ID (stableId=:r7:) should be filtered from locators', () => {
    const target = makeTarget({
      tag: 'BUTTON',
      accessibleName: 'Add to cart',
      ariaRole: 'button',
      className: 'css-hash2',
      stableId: ':r7:',
      testId: null,
      cssSelector: 'button.css-hash2',
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    // Check if the Playwright output uses the auto-generated ID
    const playwrightCode = result.playwright ?? '';
    const usesAutoId = playwrightCode.includes(':r7:') || playwrightCode.includes('#:r7:');

    recordFinding({
      capabilityId: 'NOROLE-2', capabilityName: 'React Auto-ID Filter',
      scenario: 'Element with React auto-generated ID (:r7:)',
      app: 'synthetic (React SPA)',
      expected: 'Click, locator uses accessibleName or CSS, NOT the :r7: ID',
      observed: `type=${resolvedType}, usesAutoId=${usesAutoId}`,
      scores: {
        q1_intent: resolvedType === 'Click' ? 5 : 2,
        q2_abstraction: 5,
        q3_locator: !usesAutoId ? 4 : 1,
        q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'Click' && !usesAutoId ? 'full' : 'partial',
      rootCause: usesAutoId ? 'React auto-generated ID leaked into Playwright locator' : '',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});
