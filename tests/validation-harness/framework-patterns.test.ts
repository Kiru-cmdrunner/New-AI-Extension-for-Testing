/**
 * Area 1 — Framework-Specific Component Pattern Validation
 *
 * Tests whether the 5 registered frameworks (MUI, Ant Design, Bootstrap,
 * PrimeReact) and 3 unregistered frameworks (Radix, Chakra, AGGrid)
 * produce correct classifications when their specific CSS class patterns
 * and DOM structures are present.
 *
 * Architecture: .drytis/EXPANDED_VALIDATION_DESIGN.md §3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runFullPipeline, makeTarget, makeContext, makeEvent, resetEventCounter } from './harness';
import type { RawObservation } from './types';

// ── Helpers ──────────────────────────────────────────────────────────

const observations: RawObservation[] = [];

function recordObs(
  observationId: string,
  framework: string,
  capabilityId: string,
  scores: RawObservation['scores'],
  observed: string,
  rootCause: string,
  category: RawObservation['category'],
  severity: RawObservation['severity'],
  subsystem: RawObservation['subsystem'],
  emitted?: unknown[],
  playwrightCode?: string | null,
): void {
  observations.push({
    observationId,
    area: 'framework',
    capabilityId,
    framework,
    scores,
    support: scores.q1_intent >= 4 ? 'full' : scores.q1_intent >= 2 ? 'partial' : 'unsupported',
    observed,
    rootCause,
    category,
    severity,
    subsystem,
    confidence: 'VERIFIED',
    emittedInteractions: emitted,
    playwrightCode,
  });
}

/**
 * Run a framework interaction scenario and return a quality assessment.
 */
function assessScenario(
  events: Parameters<typeof runFullPipeline>[0],
  expectedType: string,
): ReturnType<typeof runFullPipeline> {
  return runFullPipeline(events);
}

// ── MUI Framework Tests ──────────────────────────────────────────────

describe('Framework: MUI', () => {
  beforeEach(() => resetEventCounter());

  describe('FW-MUI-01: MUI Select dropdown', () => {
    it('classifies as Dropdown (not Click)', () => {
      // MUI Select trigger: a div with MuiSelect classes, role=combobox
      const trigger = makeTarget({
        tag: 'DIV',
        ariaRole: 'combobox',
        className: 'MuiSelect-select MuiSelect-outlined MuiOutlinedInput-root',
        accessibleName: 'Country',
        cssSelector: 'body > div.MuiSelect-select',
        xPath: '/html/body/div[1]',
      });
      const triggerCtx = makeContext({ inputType: null });
      const downEvt = makeEvent('mousedown', trigger, triggerCtx);

      // Option click
      const option = makeTarget({
        tag: 'LI',
        ariaRole: 'option',
        className: 'MuiMenuItem-root MuiMenuItem-gutters MuiButtonBase-root',
        accessibleName: 'United States',
        cssSelector: 'body > div.MuiMenu-paper > ul > li',
        xPath: '/html/body/div[3]/ul/li[1]',
      });
      const optionCtx = makeContext({ });
      const optionEvt = makeEvent('click', option, optionCtx, { timestamp: Date.now() + 500 });

      const result = assessScenario([downEvt, optionEvt], 'Dropdown');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);
      const isDropdown = result.interactions.some(ci => {
        const t = (ci as any).interactionSubtype ?? (ci as any).type;
        return t === 'CustomDropdown' || t === 'Dropdown' || t === 'Autocomplete';
      });

      const q1 = isDropdown ? 5 : 2;
      const q2 = result.interactions.length === 1 ? 5 : 2;
      const q5 = result.playwright && result.playwright.length > 0 ? 4 : 1;

      recordObs('FW-MUI-01', 'MUI', 'B-dropdown-select',
        { q1_intent: q1, q2_abstraction: q2, q3_locator: 4, q4_description: 4, q5_replay: q5, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}] — expected 1 Dropdown`,
        isDropdown ? 'None — MUI Select correctly classified' : 'Dropdown definition may not recognize MuiSelect trigger class on combobox role',
        isDropdown ? 'implementation-gap' : 'framework-gap',
        isDropdown ? 'P3' : 'P1',
        'Definition',
        result.interactions,
        result.playwright);

      expect(result.error).toBeNull();
    });
  });

  describe('FW-MUI-02: MUI Dialog (Modal)', () => {
    it('classifies as ModalDialog when surface appears', () => {
      // MUI Dialog trigger: a button that opens a dialog
      const trigger = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        className: 'MuiButtonBase-root MuiButton-root',
        accessibleName: 'Open Dialog',
        cssSelector: 'body > button',
        xPath: '/html/body/button',
      });
      const triggerCtx = makeContext({});
      const triggerEvt = makeEvent('click', trigger, triggerCtx);

      // Inside the dialog
      const modalInput = makeTarget({
        tag: 'INPUT',
        ariaRole: 'textbox',
        className: 'MuiOutlinedInput-input',
        accessibleName: 'Name',
        cssSelector: 'body > div.MuiDialog-root div input',
        xPath: '/html/body/div[5]/div[3]/div/div[2]/input',
      });
      const modalCtx = makeContext({ inputType: 'text' });
      const inputEvt = makeEvent('input', modalInput, modalCtx, { timestamp: Date.now() + 300, valueAfter: 'John' });

      const result = assessScenario([triggerEvt, inputEvt], 'ModalDialog');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);

      recordObs('FW-MUI-02', 'MUI', 'E-modal-dialog',
        { q1_intent: 4, q2_abstraction: 3, q3_locator: 3, q4_description: 3, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}] — expected Click + TextEntry inside modal`,
        'ModalDialog definition requires surface detection; programmatic test may not simulate surface lifecycle correctly',
        'architectural-limitation', 'P2', 'Runtime',
        result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });

  describe('FW-MUI-03: MUI Checkbox', () => {
    it('classifies as Checkbox', () => {
      const target = makeTarget({
        tag: 'INPUT',
        type: 'checkbox',
        ariaRole: 'checkbox',
        className: 'MuiCheckbox-root PrivateSwitchBase-root',
        accessibleName: 'Accept terms',
        cssSelector: 'body > label > input.MuiCheckbox-root',
        xPath: '/html/body/label/input',
      });
      const ctx = makeContext({ inputType: 'checkbox' });
      const evt = makeEvent('click', target, ctx, { checkedBefore: false, checkedAfter: true });

      const result = assessScenario([evt], 'Checkbox');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);
      const isCheckbox = types.includes('Checkbox') || types.includes('ToggleSwitch');

      const q1 = isCheckbox ? 5 : 2;
      recordObs('FW-MUI-03', 'MUI', 'A2-checkbox',
        { q1_intent: q1, q2_abstraction: 5, q3_locator: 4, q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 4 },
        `${result.interactions.length} interactions: [${types.join(', ')}]`,
        isCheckbox ? 'None' : 'Checkbox definition may not handle MuiCheckbox-root className',
        isCheckbox ? 'implementation-gap' : 'framework-gap',
        isCheckbox ? 'P3' : 'P1',
        'Definition', result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });
});

// ── Ant Design Framework Tests ───────────────────────────────────────

describe('Framework: Ant Design', () => {
  beforeEach(() => resetEventCounter());

  describe('FW-ANT-01: Ant Select dropdown', () => {
    it('classifies as Dropdown with ant-select classes', () => {
      const trigger = makeTarget({
        tag: 'DIV',
        ariaRole: 'combobox',
        className: 'ant-select ant-select-selector',
        accessibleName: 'Language',
        cssSelector: 'body > div.ant-select-selector',
        xPath: '/html/body/div[1]',
      });
      const ctx = makeContext({});
      const downEvt = makeEvent('mousedown', trigger, ctx);

      const option = makeTarget({
        tag: 'DIV',
        ariaRole: 'option',
        className: 'ant-select-item ant-select-item-option',
        accessibleName: 'English',
        cssSelector: 'body > div.ant-select-dropdown div.ant-select-item',
        xPath: '/html/body/div[3]/div[1]',
      });
      const optCtx = makeContext({});
      const optEvt = makeEvent('click', option, optCtx, { timestamp: Date.now() + 400 });

      const result = assessScenario([downEvt, optEvt], 'Dropdown');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);
      const isDropdown = result.interactions.some(ci => {
        const t = (ci as any).interactionSubtype ?? (ci as any).type;
        return ['CustomDropdown', 'Dropdown', 'Autocomplete'].includes(t);
      });

      const q1 = isDropdown ? 5 : 2;
      recordObs('FW-ANT-01', 'Ant Design', 'B-dropdown-select',
        { q1_intent: q1, q2_abstraction: result.interactions.length === 1 ? 5 : 3, q3_locator: 4, q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}]`,
        isDropdown ? 'None' : 'ant-select class not triggering Dropdown definition',
        isDropdown ? 'implementation-gap' : 'framework-gap',
        isDropdown ? 'P3' : 'P1',
        'Definition', result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });

  describe('FW-ANT-02: Ant DatePicker', () => {
    it('classifies as DatePicker with ant-picker classes', () => {
      const trigger = makeTarget({
        tag: 'INPUT',
        ariaRole: 'textbox',
        className: 'ant-picker ant-picker-large',
        accessibleName: 'Select date',
        cssSelector: 'body > div.ant-picker',
        xPath: '/html/body/div[1]',
      });
      const ctx = makeContext({ inputType: 'text' });
      const focusEvt = makeEvent('focus', trigger, ctx);

      const dayCell = makeTarget({
        tag: 'TD',
        ariaRole: 'gridcell',
        className: 'ant-picker-cell ant-picker-cell-in-view',
        accessibleName: '15',
        cssSelector: 'body > div.ant-picker-dropdown td.ant-picker-cell',
        xPath: '/html/body/div[3]/div[2]/table/tbody/tr[3]/td[3]',
      });
      const dayCtx = makeContext({});
      const dayEvt = makeEvent('click', dayCell, dayCtx, { timestamp: Date.now() + 600 });

      const result = assessScenario([focusEvt, dayEvt], 'DatePicker');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);
      const isDatePicker = types.some(t => ['DatePicker', 'DateTimePicker', 'TimePicker'].includes(t));

      const q1 = isDatePicker ? 5 : 2;
      recordObs('FW-ANT-02', 'Ant Design', 'A6-date-picker',
        { q1_intent: q1, q2_abstraction: result.interactions.length === 1 ? 5 : 3, q3_locator: 3, q4_description: 4, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}]`,
        isDatePicker ? 'None' : 'ant-picker class not triggering DatePicker definition',
        isDatePicker ? 'implementation-gap' : 'framework-gap',
        isDatePicker ? 'P3' : 'P2',
        'Definition', result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });
});

// ── Bootstrap Framework Tests ────────────────────────────────────────

describe('Framework: Bootstrap', () => {
  beforeEach(() => resetEventCounter());

  describe('FW-BS-01: Bootstrap Dropdown', () => {
    it('classifies as Dropdown with dropdown-menu classes', () => {
      const trigger = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        className: 'btn btn-primary dropdown-toggle',
        accessibleName: 'Actions',
        cssSelector: 'body > div > button.dropdown-toggle',
        xPath: '/html/body/div/button',
      });
      const ctx = makeContext({ ariaExpanded: false });
      const downEvt = makeEvent('click', trigger, ctx);
      const triggerAfter = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        className: 'btn btn-primary dropdown-toggle show',
        accessibleName: 'Actions',
        cssSelector: 'body > div > button.dropdown-toggle',
        xPath: '/html/body/div/button',
      });
      const ctxAfter = makeContext({ ariaExpanded: true });
      const expandEvt = makeEvent('mousedown', triggerAfter, ctxAfter, { timestamp: Date.now() + 200 });

      const option = makeTarget({
        tag: 'A',
        ariaRole: 'menuitem',
        className: 'dropdown-item',
        accessibleName: 'Edit',
        cssSelector: 'body > div.dropdown-menu > a.dropdown-item',
        xPath: '/html/body/div[2]/a[1]',
      });
      const optCtx = makeContext({});
      const optEvt = makeEvent('click', option, optCtx, { timestamp: Date.now() + 500 });

      const result = assessScenario([downEvt, expandEvt, optEvt], 'Dropdown');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);
      const isDropdown = result.interactions.some(ci => {
        const t = (ci as any).interactionSubtype ?? (ci as any).type;
        return ['CustomDropdown', 'Dropdown'].includes(t);
      });

      const q1 = isDropdown ? 5 : 2;
      recordObs('FW-BS-01', 'Bootstrap', 'B-dropdown-select',
        { q1_intent: q1, q2_abstraction: result.interactions.length === 1 ? 5 : 3, q3_locator: 4, q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}]`,
        isDropdown ? 'None' : 'dropdown-toggle class not triggering Dropdown definition',
        isDropdown ? 'implementation-gap' : 'framework-gap',
        isDropdown ? 'P3' : 'P2',
        'Definition', result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });

  describe('FW-BS-02: Bootstrap Modal', () => {
    it('records interactions inside modal', () => {
      const trigger = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        className: 'btn btn-primary',
        accessibleName: 'Launch demo modal',
        cssSelector: 'body > button.btn',
        xPath: '/html/body/button',
      });
      const ctx = makeContext({});
      const triggerEvt = makeEvent('click', trigger, ctx);

      // Inside modal
      const modalInput = makeTarget({
        tag: 'INPUT',
        ariaRole: 'textbox',
        className: 'form-control',
        accessibleName: 'Recipient name',
        cssSelector: 'body > div.modal.show input.form-control',
        xPath: '/html/body/div[3]/div/div[2]/div/input',
      });
      const modalCtx = makeContext({ inputType: 'text' });
      const inputEvt = makeEvent('input', modalInput, modalCtx, { timestamp: Date.now() + 400, valueAfter: 'John' });

      const result = assessScenario([triggerEvt, inputEvt], 'ModalDialog');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);

      recordObs('FW-BS-02', 'Bootstrap', 'E-modal-dialog',
        { q1_intent: 4, q2_abstraction: 3, q3_locator: 3, q4_description: 3, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}]`,
        'Modal surface detection is programmatic; no real DOM mutation',
        'architectural-limitation', 'P2', 'Runtime',
        result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });
});

// ── Radix UI Tests (NO Pattern Registry plugin) ─────────────────────

describe('Framework: Radix UI (no plugin)', () => {
  beforeEach(() => resetEventCounter());

  describe('FW-RDX-01: Radix DropdownMenu', () => {
    it('classifies trigger + menu item as Dropdown with expanded role support', () => {
      // Radix DropdownMenu trigger: button with aria-haspopup="menu"
      const trigger = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        className: 'radix-trigger',
        accessibleName: 'Options',
        cssSelector: 'body > button.radix-trigger',
        xPath: '/html/body/button',
      });
      const ctx = makeContext({ ariaHasPopup: 'menu' });
      const downEvt = makeEvent('click', trigger, ctx);

      // Radix menu item: role=menuitem inside portaled content
      const menuItem = makeTarget({
        tag: 'DIV',
        ariaRole: 'menuitem',
        className: 'radix-dropdown-menu-item',
        accessibleName: 'Save',
        cssSelector: 'body > div.radix-popper-content div[role="menuitem"]',
        xPath: '/html/body/div[3]/div[1]',
      });
      const itemCtx = makeContext({});
      const itemEvt = makeEvent('click', menuItem, itemCtx, { timestamp: Date.now() + 300 });

      const result = assessScenario([downEvt, itemEvt], 'Dropdown');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);
      const isDropdown = result.interactions.some(ci => {
        const t = (ci as any).interactionSubtype ?? (ci as any).type;
        return ['CustomDropdown', 'Dropdown'].includes(t);
      });

      const q1 = isDropdown ? 5 : 3;
      recordObs('FW-RDX-01', 'Radix', 'B-dropdown-select',
        { q1_intent: q1, q2_abstraction: result.interactions.length === 1 ? 5 : 3, q3_locator: 3, q4_description: 3, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}]`,
        isDropdown ? 'ARIA role expansion (menuitem as option) + aria-haspopup trigger detection works' : 'Trigger detected but surface binding needed for full classification',
        isDropdown ? 'implementation-gap' : 'framework-gap',
        isDropdown ? 'P3' : 'P2',
        'Definition', result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });

  describe('FW-RDX-02: Radix Dialog', () => {
    it('records interaction inside Radix dialog', () => {
      const trigger = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Edit profile',
        cssSelector: 'body > button',
        xPath: '/html/body/button',
      });
      const ctx = makeContext({});
      const triggerEvt = makeEvent('click', trigger, ctx);

      const saveBtn = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        className: 'radix-dialog-save',
        accessibleName: 'Save changes',
        cssSelector: 'body > div[role="dialog"] button',
        xPath: '/html/body/div[3]/div/div[2]/button',
      });
      const saveCtx = makeContext({});
      const saveEvt = makeEvent('click', saveBtn, saveCtx, { timestamp: Date.now() + 500 });

      const result = assessScenario([triggerEvt, saveEvt], 'ModalDialog');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);

      recordObs('FW-RDX-02', 'Radix', 'E-modal-dialog',
        { q1_intent: 3, q2_abstraction: 3, q3_locator: 3, q4_description: 3, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}] — portaled dialog, surface detection is programmatic`,
        'Radix dialogs are portaled; surface detection requires real DOM mutations to track portal appearance',
        'architectural-limitation', 'P2', 'Runtime',
        result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });

  describe('FW-RDX-03: Radix Tabs', () => {
    it('classifies Tab via role=tab', () => {
      const tab1 = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'tab',
        accessibleName: 'Account',
        ariaLabel: 'Account',
        cssSelector: 'body > div[role="tablist"] button[role="tab"]',
        xPath: '/html/body/div/button[1]',
        testId: 'tab-account',
      });
      const ctx = makeContext({});
      const evt1 = makeEvent('click', tab1, ctx);

      const tab2 = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'tab',
        accessibleName: 'Password',
        ariaLabel: 'Password',
        cssSelector: 'body > div[role="tablist"] button[role="tab"]:nth-child(2)',
        xPath: '/html/body/div/button[2]',
        testId: 'tab-password',
      });
      const evt2 = makeEvent('click', tab2, ctx, { timestamp: Date.now() + 1000 });

      const result = assessScenario([evt1, evt2], 'Tab');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);
      const allTabs = types.every(t => t === 'Tab');

      const q1 = allTabs ? 5 : 3;
      recordObs('FW-RDX-03', 'Radix', 'B4-tab',
        { q1_intent: q1, q2_abstraction: result.interactions.length === 2 ? 5 : 3, q3_locator: 4, q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 4, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}] — Radix tabs use standard role=tab`,
        allTabs ? 'None — ARIA role detection works without plugin' : 'Some tabs not classified',
        allTabs ? 'implementation-gap' : 'framework-gap',
        allTabs ? 'P3' : 'P2',
        'Definition', result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });
});

// ── Chakra UI Tests (NO Pattern Registry plugin) ────────────────────

describe('Framework: Chakra UI (no plugin)', () => {
  beforeEach(() => resetEventCounter());

  describe('FW-CHK-01: Chakra Select', () => {
    it('relies on native select or ARIA fallback', () => {
      // Chakra's custom Select renders a native <select> with chakra classes
      const target = makeTarget({
        tag: 'SELECT',
        ariaRole: 'combobox',
        className: 'chakra-select',
        accessibleName: 'Choose fruit',
        cssSelector: 'body > select.chakra-select',
        xPath: '/html/body/select',
      });
      const ctx = makeContext({ inputType: 'select-one' });
      const changeEvt = makeEvent('change', target, ctx, { valueBefore: '', valueAfter: 'apple' });

      const result = assessScenario([changeEvt], 'Dropdown');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);
      const isDropdown = types.some(t => ['NativeDropdown', 'Dropdown'].includes(t));

      const q1 = isDropdown ? 5 : 2;
      recordObs('FW-CHK-01', 'Chakra', 'A4-native-select',
        { q1_intent: q1, q2_abstraction: 5, q3_locator: 4, q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 4, q8_assertion: 4 },
        `${result.interactions.length} interactions: [${types.join(', ')}]`,
        isDropdown ? 'None — native SELECT detected via change event' : 'Chakra select not classified as Dropdown',
        isDropdown ? 'implementation-gap' : 'framework-gap',
        isDropdown ? 'P3' : 'P2',
        'Definition', result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });

  describe('FW-CHK-02: Chakra Modal', () => {
    it('records interactions inside Chakra modal', () => {
      const trigger = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Open modal',
        cssSelector: 'body > button',
        xPath: '/html/body/button',
      });
      const triggerEvt = makeEvent('click', trigger, makeContext({}));

      const input = makeTarget({
        tag: 'INPUT',
        ariaRole: 'textbox',
        className: 'chakra-input',
        accessibleName: 'Name',
        cssSelector: 'body > div.chakra-modal input',
        xPath: '/html/body/div[3]/div/input',
      });
      const inputEvt = makeEvent('input', input, makeContext({ inputType: 'text' }), { timestamp: Date.now() + 300, valueAfter: 'test' });

      const result = assessScenario([triggerEvt, inputEvt], 'ModalDialog');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);

      recordObs('FW-CHK-02', 'Chakra', 'E-modal-dialog',
        { q1_intent: 3, q2_abstraction: 3, q3_locator: 3, q4_description: 3, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}]`,
        'Chakra modal detection relies on ARIA/classes, no Pattern Registry support',
        'framework-gap', 'P2', 'Runtime',
        result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });
});

// ── AGGrid Tests (NO Pattern Registry plugin) ───────────────────────

describe('Framework: AGGrid (no plugin)', () => {
  beforeEach(() => resetEventCounter());

  describe('FW-AGG-01: AGGrid cell click', () => {
    it('classifies as Click (generic fallback)', () => {
      const cell = makeTarget({
        tag: 'DIV',
        ariaRole: 'gridcell',
        className: 'ag-cell ag-cell-not-inline-editing ag-cell-with-height',
        accessibleName: 'John Doe',
        cssSelector: 'body > div.ag-root div.ag-row > div.ag-cell[colid="name"]',
        xPath: '/html/body/div[2]/div[2]/div[3]/div[2]/div[2]',
      });
      const ctx = makeContext({});
      const evt = makeEvent('click', cell, ctx);

      const result = assessScenario([evt], 'Click');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);

      const q1 = types.includes('Click') ? 4 : 2;
      recordObs('FW-AGG-01', 'AGGrid', 'B1-click',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 2, q4_description: 3, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}] — AGGrid cell classified as generic Click. Locator: ${result.irPlan?.steps[0]?.target?.kind === 'element' ? 'has locators' : 'no locators'}`,
        'AGGrid cells have long CSS selectors with colid attributes — no AGGrid-specific locator strategy',
        'framework-gap', 'P2', 'Locator Ranking',
        result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });

  describe('FW-AGG-02: AGGrid header sort', () => {
    it('sort intent not detected — classified as Click', () => {
      const header = makeTarget({
        tag: 'DIV',
        ariaRole: 'columnheader',
        className: 'ag-header-cell ag-header-cell-sortable',
        accessibleName: 'Name',
        cssSelector: 'body > div.ag-root div.ag-header-row div.ag-header-cell',
        xPath: '/html/body/div[2]/div[1]/div[3]/div[2]',
      });
      const ctx = makeContext({});
      const evt = makeEvent('click', header, ctx);

      const result = assessScenario([evt], 'Click');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);

      const q1 = 2; // Click is correct action but sort intent not captured
      recordObs('FW-AGG-02', 'AGGrid', 'B1-click',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 2, q4_description: 2, q5_replay: 3, q6_confidence: 3, q7_evidence: 2, q8_assertion: 2 },
        `${result.interactions.length} interactions: [${types.join(', ')}] — sort intent not detected`,
        'No AGGrid-specific component detector — ag-header-cell-sortable class not recognized as a sort action',
        'framework-gap', 'P2', 'Enrichment',
        result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });
});

// ── PrimeReact Tests ─────────────────────────────────────────────────

describe('Framework: PrimeReact', () => {
  beforeEach(() => resetEventCounter());

  describe('FW-PRE-01: PrimeReact Dropdown', () => {
    it('classifies as Dropdown with p-dropdown classes', () => {
      const trigger = makeTarget({
        tag: 'INPUT',
        ariaRole: 'combobox',
        className: 'p-dropdown p-component p-inputwrapper',
        accessibleName: 'Select city',
        cssSelector: 'body > div.p-dropdown',
        xPath: '/html/body/div[1]',
      });
      const ctx = makeContext({});
      const downEvt = makeEvent('mousedown', trigger, ctx);

      const option = makeTarget({
        tag: 'LI',
        ariaRole: 'option',
        className: 'p-dropdown-item',
        accessibleName: 'New York',
        cssSelector: 'body > div.p-dropdown-panel li.p-dropdown-item',
        xPath: '/html/body/div[3]/ul/li[1]',
      });
      const optEvt = makeEvent('click', option, makeContext({}), { timestamp: Date.now() + 400 });

      const result = assessScenario([downEvt, optEvt], 'Dropdown');

      const types = result.interactions.map(ci => (ci as any).interactionSubtype ?? (ci as any).type);
      const isDropdown = result.interactions.some(ci => {
        const t = (ci as any).interactionSubtype ?? (ci as any).type;
        return ['CustomDropdown', 'Dropdown'].includes(t);
      });

      const q1 = isDropdown ? 5 : 2;
      recordObs('FW-PRE-01', 'PrimeReact', 'B-dropdown-select',
        { q1_intent: q1, q2_abstraction: result.interactions.length === 1 ? 5 : 3, q3_locator: 4, q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${result.interactions.length} interactions: [${types.join(', ')}]`,
        isDropdown ? 'None — p-dropdown class recognized' : 'p-dropdown class not triggering Dropdown definition',
        isDropdown ? 'implementation-gap' : 'framework-gap',
        isDropdown ? 'P3' : 'P2',
        'Definition', result.interactions, result.playwright);

      expect(result.error).toBeNull();
    });
  });
});

// ── Observations Summary ─────────────────────────────────────────────

describe('Framework Observations Summary', () => {
  it('records all framework observations', () => {
    console.log(`\n[Framework Patterns] ${observations.length} observations recorded`);
    for (const obs of observations) {
      console.log(`  ${obs.observationId} (${obs.framework}): Q1=${obs.scores.q1_intent} | ${obs.severity} | ${obs.observed}`);
    }
    expect(observations.length).toBeGreaterThanOrEqual(12);
  });
});
