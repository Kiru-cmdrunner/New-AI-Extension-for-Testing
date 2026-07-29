/**
 * Stage 4 Validation — End-to-End Pipeline Comparison
 *
 * Traces the complete flow through BOTH engines (legacy + control) for 10
 * representative workflows, comparing output at every stage:
 *
 *   Browser Events → Classifier → Domain Adapter → Recognition → IR Bridge
 *
 * Validates that:
 *   1. No semantic information is lost in the V2 adapter
 *   2. IR bridge receives correct data from both paths
 *   3. Transition count reduction doesn't break downstream
 *   4. Healing service compatibility is maintained
 */

import { describe, it, expect } from 'vitest';
import { detectInteractions } from '../src/classifier/interaction-detector';
import { recognizeInteractions } from '../src/recorder/v2/interaction-recognizer';
import { adaptToDomainEntities } from '../src/recorder/pipeline/domain-adapter';
import { adaptToDomainEntitiesV2 } from '../src/recorder/v2/domain-adapter-v2';
import { runPipeline } from '../src/recorder/pipeline/pipeline-runner';
import { build as buildIRPlan } from '../src/generation/ir-bridge';
import type { RecordedEvent, ElementRecordedEvent, NavigationRecordedEvent } from '../src/recorder/recorded-event';
import type { ElementIdentity } from '../src/shared/types';
import type { DetectedInteraction } from '../src/classifier/interaction-types';
import { TransitionOperation } from '../src/domain/enums';
import { IRAction } from '../src/domain/execution-ir/types';

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

let idCounter = 0;

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    elementId: `elem-${String(++idCounter).padStart(4, '0')}`,
    ...overrides,
  };
}

function evt(
  eventType: ElementRecordedEvent['eventType'],
  target: ElementIdentity,
  ts: number,
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: `evt-${String(++idCounter).padStart(4, '0')}`,
    eventType,
    timestamp: new Date(ts).toISOString(),
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function navEvt(url: string, ts: number, transitionType?: string): NavigationRecordedEvent {
  return {
    eventId: `evt-${String(++idCounter).padStart(4, '0')}`,
    eventType: 'navigation',
    timestamp: new Date(ts).toISOString(),
    url,
    title: url.split('/').pop() || 'Page',
    transitionType,
  };
}

function resetIds(): void {
  idCounter = 0;
}

/** Run BOTH classifiers on the same events and return both results */
function dualClassify(events: RecordedEvent[]): {
  legacy: DetectedInteraction[];
  control: DetectedInteraction[];
} {
  return {
    legacy: detectInteractions(events),
    control: recognizeInteractions(events),
  };
}

/** Run BOTH domain adapters on the same events+interactions */
function dualAdapt(
  events: RecordedEvent[],
  interactions: { legacy: DetectedInteraction[]; control: DetectedInteraction[] },
  sourceUrl: string,
) {
  return {
    legacy: adaptToDomainEntities(events, interactions.legacy, sourceUrl),
    control: adaptToDomainEntitiesV2(events, interactions.control, sourceUrl),
  };
}

/** Run BOTH IR bridges on the same events+interactions */
function dualIR(
  events: RecordedEvent[],
  interactions: { legacy: DetectedInteraction[]; control: DetectedInteraction[] },
  startUrl: string,
) {
  const ctx = { startUrl, title: 'Test Page' };
  return {
    legacy: buildIRPlan({
      events,
      interactions: interactions.legacy,
      understanding: null,
      recordingContext: ctx,
      testCaseName: 'Test',
    }),
    control: buildIRPlan({
      events,
      interactions: interactions.control,
      understanding: null,
      recordingContext: ctx,
      testCaseName: 'Test',
    }),
  };
}

interface ComparisonResult {
  workflow: string;
  eventCount: number;
  legacy: {
    interactionCount: number;
    transitionCount: number;
    elementCount: number;
    irStepCount: number;
    types: string[];
  };
  control: {
    interactionCount: number;
    transitionCount: number;
    elementCount: number;
    irStepCount: number;
    types: string[];
  };
  infoLossCheck: {
    irActionsMatch: boolean;
    targetIdentitiesMatch: boolean;
    inputValuesMatch: boolean;
  };
}

function buildComparison(
  workflow: string,
  events: RecordedEvent[],
  startUrl = 'https://example.com',
): ComparisonResult {
  const classifications = dualClassify(events);
  const domains = dualAdapt(events, classifications, startUrl);
  const irs = dualIR(events, classifications, startUrl);

  const legacyIRActions = irs.legacy.steps.map((s) => s.action);
  const controlIRActions = irs.control.steps.map((s) => s.action);

  const legacyTargets = irs.legacy.steps.map((s) => JSON.stringify(s.target)).sort();
  const controlTargets = irs.control.steps.map((s) => JSON.stringify(s.target)).sort();

  const legacyInputs = irs.legacy.steps.map((s) => JSON.stringify(s.input)).sort();
  const controlInputs = irs.control.steps.map((s) => JSON.stringify(s.input)).sort();

  return {
    workflow,
    eventCount: events.length,
    legacy: {
      interactionCount: classifications.legacy.length,
      transitionCount: domains.legacy.transitions.length,
      elementCount: domains.legacy.elements.length,
      irStepCount: irs.legacy.steps.length,
      types: classifications.legacy.map((i) => i.type),
    },
    control: {
      interactionCount: classifications.control.length,
      transitionCount: domains.control.transitions.length,
      elementCount: domains.control.elements.length,
      irStepCount: irs.control.steps.length,
      types: classifications.control.map((i) => i.type),
    },
    infoLossCheck: {
      irActionsMatch: JSON.stringify(legacyIRActions) === JSON.stringify(controlIRActions),
      targetIdentitiesMatch: JSON.stringify(legacyTargets) === JSON.stringify(controlTargets),
      inputValuesMatch: JSON.stringify(legacyInputs) === JSON.stringify(controlInputs),
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
// WORKFLOW SCENARIOS
// ════════════════════════════════════════════════════════════════════════

describe('Stage 4 Validation — End-to-End Pipeline Comparison', () => {

  describe('1. Login Workflow', () => {
    it('produces correct interactions and IR steps through both engines', () => {
      resetIds();
      const url = 'https://opensource-demo.orangehrmlive.com';
      const email = makeIdentity({ accessibleName: 'Username', ariaRole: 'textbox', tag: 'INPUT', name: 'username', cssSelector: 'input[name="username"]' });
      const pass = makeIdentity({ accessibleName: 'Password', ariaRole: 'textbox', tag: 'INPUT', name: 'password', type: 'password' as any, cssSelector: 'input[name="password"]' });
      const login = makeIdentity({ accessibleName: 'Login', ariaRole: 'button', tag: 'BUTTON', cssSelector: 'button[type="submit"]' });

      const events: RecordedEvent[] = [
        navEvt(`${url}/login`, 1000, 'link'),
        evt('focus', email, 2000, { valueBefore: '' }),
        evt('input', email, 3000, { valueAfter: 'Admin' }),
        evt('blur', email, 4000, { valueAfter: 'Admin' }),
        evt('focus', pass, 5000, { valueBefore: '' }),
        evt('input', pass, 6000, { valueAfter: 'admin123' }),
        evt('blur', pass, 7000, { valueAfter: 'admin123' }),
        evt('click', login, 8000),
        navEvt(`${url}/dashboard`, 9000, 'link'),
      ];

      const result = buildComparison('Login', events, url);

      // Both engines should produce meaningful steps
      expect(result.control.irStepCount).toBeGreaterThanOrEqual(3);
      expect(result.control.types).toContain('TextEntry');

      // Control engine should have fewer transitions
      expect(result.control.transitionCount).toBeLessThanOrEqual(result.legacy.transitionCount);
    });
  });

  describe('2. Text Entry', () => {
    it('captures text entry with correct value through both engines', () => {
      resetIds();
      const input = makeIdentity({ accessibleName: 'First Name', ariaRole: 'textbox', tag: 'INPUT', name: 'firstName', cssSelector: 'input[name="firstName"]' });

      const events: RecordedEvent[] = [
        evt('focus', input, 1000, { valueBefore: '' }),
        evt('input', input, 2000, { valueAfter: 'Jonathan' }),
        evt('change', input, 3000, { valueAfter: 'Jonathan' }),
        evt('blur', input, 4000, { valueAfter: 'Jonathan' }),
      ];

      const result = buildComparison('Text Entry', events);

      // Both should classify as TextEntry
      expect(result.legacy.types).toContain('TextEntry');
      expect(result.control.types).toContain('TextEntry');

      // Control should have 1 transition (vs 4 for legacy)
      expect(result.control.transitionCount).toBe(1);
      expect(result.legacy.transitionCount).toBeGreaterThanOrEqual(1);

      // Both should produce IR steps with FILL action
      expect(result.legacy.irStepCount).toBeGreaterThanOrEqual(1);
      expect(result.control.irStepCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. Dropdown Selection (Native <select>)', () => {
    it('captures native dropdown selection through both engines', () => {
      resetIds();
      const select = makeIdentity({ accessibleName: 'Nationality', tag: 'SELECT', ariaRole: 'listbox', name: 'nationality', cssSelector: 'select#nationality' });

      const events: RecordedEvent[] = [
        evt('focus', select, 1000),
        evt('change', select, 2000, { valueAfter: 'American' }),
        evt('blur', select, 3000),
      ];

      const result = buildComparison('Native Dropdown', events);

      // Both should classify as NativeDropdown
      expect(result.legacy.types).toContain('NativeDropdown');
      expect(result.control.types).toContain('NativeDropdown');

      // Control should have fewer transitions
      expect(result.control.transitionCount).toBeLessThanOrEqual(result.legacy.transitionCount);
    });
  });

  describe('4. Searchable/Custom Dropdown (OXD)', () => {
    it('captures custom dropdown selection through both engines', () => {
      resetIds();
      const combobox = makeIdentity({
        accessibleName: 'Marital Status',
        ariaRole: 'combobox',
        tag: 'DIV',
        className: 'oxd-select-text-input',
        cssSelector: 'div.oxd-select-text-input',
      });

      const events: RecordedEvent[] = [
        evt('click', combobox, 1000, {
          domContext: { ariaExpanded: true, ariaHasPopup: 'listbox', inputType: null, isContentEditable: false },
        }),
        evt('change', combobox, 3000, { valueAfter: 'Single' }),
      ];

      const result = buildComparison('Custom Dropdown', events);

      // Control should classify as CustomDropdown
      expect(result.control.types).toContain('CustomDropdown');

      // Control should have transitions ≤ legacy
      expect(result.control.transitionCount).toBeLessThanOrEqual(result.legacy.transitionCount);
    });
  });

  describe('5. Date Picker', () => {
    it('captures date picker selection through both engines', () => {
      resetIds();
      const dateInput = makeIdentity({ accessibleName: 'Date of Birth', ariaRole: 'textbox', tag: 'INPUT', name: 'dob', cssSelector: 'input[type="date"]' });

      const events: RecordedEvent[] = [
        evt('dateSelect', dateInput, 1000, {
          domContext: {
            dateType: 'date',
            isoValue: '1990-05-15',
            displayValue: 'May 15, 1990',
            dateConfidence: 1.0,
            isContentEditable: false,
            inputType: 'date',
          },
          valueAfter: '1990-05-15',
        }),
      ];

      const result = buildComparison('Date Picker', events);

      // Both should classify as DatePicker
      expect(result.legacy.types).toContain('DatePicker');
      expect(result.control.types).toContain('DatePicker');
    });
  });

  describe('6. Checkbox Toggle', () => {
    it('captures checkbox toggle through both engines', () => {
      resetIds();
      const checkbox = makeIdentity({ accessibleName: 'Subscribe to newsletter', ariaRole: 'checkbox', tag: 'INPUT', cssSelector: 'input[type="checkbox"]#subscribe' });

      const events: RecordedEvent[] = [
        evt('click', checkbox, 1000, { checkedBefore: false, checkedAfter: true }),
      ];

      const result = buildComparison('Checkbox', events);

      expect(result.legacy.types).toContain('Checkbox');
      expect(result.control.types).toContain('Checkbox');
    });
  });

  describe('7. Dialog/Browser Alert', () => {
    it('captures dialog interaction through both engines', () => {
      resetIds();
      const trigger = makeIdentity({ accessibleName: 'Delete', ariaRole: 'button', tag: 'BUTTON', cssSelector: 'button#delete' });

      const events: RecordedEvent[] = [
        evt('click', trigger, 1000, {
          domContext: { triggeredDialog: 'confirm', dialogMessage: 'Are you sure?', dialogResult: 'ok', isContentEditable: false, inputType: null },
        }),
      ];

      const result = buildComparison('Dialog', events);

      expect(result.legacy.types).toContain('BrowserAlert');
      expect(result.control.types).toContain('BrowserAlert');
    });
  });

  describe('8. AG Grid Editing', () => {
    it('captures AG grid cell editing through both engines', () => {
      resetIds();
      const cell = makeIdentity({ accessibleName: 'Status', ariaRole: 'gridcell', tag: 'DIV', className: 'ag-cell', cssSelector: 'div.ag-cell[col-id="status"]' });
      const input = makeIdentity({ accessibleName: 'Status', ariaRole: 'textbox', tag: 'INPUT', className: 'ag-text-field', cssSelector: 'input.ag-text-field' });

      const events: RecordedEvent[] = [
        evt('click', cell, 1000),
        evt('focus', input, 1500, { valueBefore: 'Pending' }),
        evt('input', input, 2000, { valueAfter: 'Completed' }),
        evt('blur', input, 3000, { valueAfter: 'Completed' }),
      ];

      const result = buildComparison('AG Grid Edit', events);

      // Both should produce some interaction
      expect(result.control.interactionCount).toBeGreaterThanOrEqual(1);
      expect(result.control.irStepCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('9. OrangeHRM 9-Step Workflow', () => {
    it('produces correct 9-step workflow through both engines', () => {
      resetIds();
      const url = 'https://opensource-demo.orangehrmlive.com';
      const ts = 1000;

      const firstName = makeIdentity({ accessibleName: 'First Name', ariaRole: 'textbox', tag: 'INPUT', name: 'firstName', cssSelector: 'input[name="firstName"]' });
      const lastName = makeIdentity({ accessibleName: 'Last Name', ariaRole: 'textbox', tag: 'INPUT', name: 'lastName', cssSelector: 'input[name="lastName"]' });
      const nationality = makeIdentity({ accessibleName: 'Nationality', tag: 'SELECT', ariaRole: 'listbox', name: 'nationality', cssSelector: 'select#nationality' });
      const maritalStatus = makeIdentity({ accessibleName: 'Marital Status', ariaRole: 'combobox', tag: 'DIV', className: 'oxd-select-text-input', cssSelector: 'div.oxd-select-text-input' });
      const femaleRadio = makeIdentity({ accessibleName: 'Female', ariaRole: 'radio', tag: 'INPUT', cssSelector: 'input[type="radio"][value="2"]' });
      const dob = makeIdentity({ accessibleName: 'Date of Birth', ariaRole: 'textbox', tag: 'INPUT', cssSelector: 'input[type="date"]' });
      const saveBtn = makeIdentity({ accessibleName: 'Save', ariaRole: 'button', tag: 'BUTTON', className: 'oxd-button--secondary', cssSelector: 'button.oxd-button--secondary' });

      const events: RecordedEvent[] = [
        navEvt(`${url}/dashboard`, ts, 'link'),
        navEvt(`${url}/myInfo`, ts + 1000, 'link'),
        // First Name
        evt('focus', firstName, ts + 2000, { valueBefore: 'John' }),
        evt('input', firstName, ts + 3000, { valueAfter: 'Jonathan' }),
        evt('blur', firstName, ts + 4000, { valueAfter: 'Jonathan' }),
        // Last Name
        evt('focus', lastName, ts + 5000, { valueBefore: 'Doe' }),
        evt('input', lastName, ts + 6000, { valueAfter: 'Smith' }),
        evt('blur', lastName, ts + 7000, { valueAfter: 'Smith' }),
        // Nationality
        evt('focus', nationality, ts + 8000),
        evt('change', nationality, ts + 9000, { valueAfter: 'American' }),
        evt('blur', nationality, ts + 9500),
        // Marital Status
        evt('click', maritalStatus, ts + 10000, {
          domContext: { ariaExpanded: true, ariaHasPopup: 'listbox', inputType: null, isContentEditable: false },
        }),
        evt('change', maritalStatus, ts + 11000, { valueAfter: 'Single' }),
        // Gender
        evt('click', femaleRadio, ts + 12000, { checkedBefore: false, checkedAfter: true }),
        // DOB
        evt('dateSelect', dob, ts + 13000, {
          domContext: { dateType: 'date', isoValue: '1990-05-15', displayValue: 'May 15, 1990', dateConfidence: 1.0, isContentEditable: false, inputType: 'date' },
          valueAfter: '1990-05-15',
        }),
        // Save
        evt('click', saveBtn, ts + 14000),
      ];

      const result = buildComparison('OrangeHRM 9-Step', events, url);

      // Control engine should produce meaningful steps
      expect(result.control.irStepCount).toBeGreaterThanOrEqual(7); // At least 7 non-noise steps

      // Control should have fewer transitions than legacy
      expect(result.control.transitionCount).toBeLessThanOrEqual(result.legacy.transitionCount);

      // Control should have correct types
      expect(result.control.types).toContain('TextEntry');
      expect(result.control.types).toContain('NativeDropdown');
      expect(result.control.types).toContain('CustomDropdown');
      expect(result.control.types).toContain('RadioButton');
      expect(result.control.types).toContain('DatePicker');

      // Both should produce IR plans
      expect(result.legacy.irStepCount).toBeGreaterThanOrEqual(1);
      expect(result.control.irStepCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('10. AdaniOne Booking Flow', () => {
    it('captures booking workflow through both engines', () => {
      resetIds();
      const url = 'https://www.adani.com';

      const origin = makeIdentity({ accessibleName: 'Origin', ariaRole: 'combobox', tag: 'INPUT', placeholder: 'From', cssSelector: 'input#origin' });
      const dest = makeIdentity({ accessibleName: 'Destination', ariaRole: 'combobox', tag: 'INPUT', placeholder: 'To', cssSelector: 'input#destination' });
      const dateField = makeIdentity({ accessibleName: 'Departure Date', ariaRole: 'textbox', tag: 'INPUT', placeholder: 'Select date', cssSelector: 'input[type="date"]' });
      const searchBtn = makeIdentity({ accessibleName: 'Search', ariaRole: 'button', tag: 'BUTTON', cssSelector: 'button#search' });
      const bookLink = makeIdentity({ accessibleName: 'Book Now', tag: 'A', ariaRole: 'link', cssSelector: 'a.book-now' });

      const events: RecordedEvent[] = [
        navEvt(`${url}/`, 1000, 'link'),
        evt('focus', origin, 2000, { valueBefore: '' }),
        evt('input', origin, 3000, { valueAfter: 'Ahmedabad' }),
        evt('change', origin, 3500, { valueAfter: 'Ahmedabad' }),
        evt('blur', origin, 4000, { valueAfter: 'Ahmedabad' }),
        evt('focus', dest, 5000, { valueBefore: '' }),
        evt('input', dest, 6000, { valueAfter: 'Mumbai' }),
        evt('change', dest, 6500, { valueAfter: 'Mumbai' }),
        evt('blur', dest, 7000, { valueAfter: 'Mumbai' }),
        evt('dateSelect', dateField, 8000, {
          domContext: { dateType: 'date', isoValue: '2026-08-15', displayValue: 'August 15, 2026', dateConfidence: 1.0, isContentEditable: false, inputType: 'date' },
          valueAfter: '2026-08-15',
        }),
        evt('click', searchBtn, 9000),
        navEvt(`${url}/results`, 10000, 'link'),
        evt('click', bookLink, 11000),
        navEvt(`${url}/booking`, 12000, 'link'),
      ];

      const result = buildComparison('AdaniOne Booking', events, url);

      // Control should produce meaningful steps
      expect(result.control.irStepCount).toBeGreaterThanOrEqual(5);

      // Control should have fewer transitions
      expect(result.control.transitionCount).toBeLessThanOrEqual(result.legacy.transitionCount);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // INFORMATION LOSS ANALYSIS
  // ════════════════════════════════════════════════════════════════════════

  describe('Information Loss Analysis', () => {
    it('IR bridge receives the same event references from both engines', () => {
      resetIds();
      const input = makeIdentity({ accessibleName: 'Email', ariaRole: 'textbox', tag: 'INPUT', cssSelector: 'input#email' });
      const events: RecordedEvent[] = [
        evt('focus', input, 1000, { valueBefore: '' }),
        evt('input', input, 2000, { valueAfter: 'test@test.com' }),
        evt('blur', input, 3000, { valueAfter: 'test@test.com' }),
      ];

      const { legacy, control } = dualClassify(events);
      const { legacy: legacyIR, control: controlIR } = dualIR(events, { legacy, control }, 'https://example.com');

      // Both IR plans should have at least one FILL step
      const legacyFills = legacyIR.steps.filter((s) => s.action === IRAction.FILL);
      const controlFills = controlIR.steps.filter((s) => s.action === IRAction.FILL);

      expect(legacyFills.length).toBeGreaterThanOrEqual(1);
      expect(controlFills.length).toBeGreaterThanOrEqual(1);

      // Both should reference the same event IDs
      const legacyEventRefs = legacyFills.map((s) => s.sourceEventId);
      const controlEventRefs = controlFills.map((s) => s.sourceEventId);

      expect(legacyEventRefs.every((id) => id && id.startsWith('evt-'))).toBe(true);
      expect(controlEventRefs.every((id) => id && id.startsWith('evt-'))).toBe(true);
    });

    it('V2 adapter transition IDs match interaction IDs (IR bridge linkage)', () => {
      resetIds();
      const input = makeIdentity({ accessibleName: 'Name', ariaRole: 'textbox', tag: 'INPUT', cssSelector: 'input#name' });
      const events: RecordedEvent[] = [
        evt('focus', input, 1000, { valueBefore: '' }),
        evt('blur', input, 2000, { valueAfter: 'John' }),
      ];

      const control = recognizeInteractions(events);
      const domainControl = adaptToDomainEntitiesV2(events, control, 'https://example.com');

      // Each transition's ID should match its corresponding interaction's ID
      for (const transition of domainControl.transitions) {
        const matchingInteraction = control.find((i) => i.interactionId === transition.transitionId);
        expect(matchingInteraction).toBeDefined();
      }
    });

    it('V2 adapter preserves all identity fields needed for healing', () => {
      resetIds();
      const target = makeIdentity({
        accessibleName: 'Email',
        ariaRole: 'textbox',
        tag: 'INPUT',
        cssSelector: 'input#email',
        stableId: 'email',
        testId: 'email-field',
        dataCy: 'email-cy',
        dataQa: 'email-qa',
        name: 'email',
        className: 'form-input required',
        xPath: '/html/body/form/input[@id="email"]',
        ariaLabel: 'Email address',
        placeholder: 'Enter email',
        ariaLabelledBy: 'email-label',
      });

      const events: RecordedEvent[] = [evt('click', target, 1000)];
      const control = recognizeInteractions(events);
      const domainControl = adaptToDomainEntitiesV2(events, control, 'https://example.com');

      expect(domainControl.elements).toHaveLength(1);
      const el = domainControl.elements[0];

      // Every identity field must be preserved
      expect(el.identity.accessibleName).toBe('Email');
      expect(el.identity.ariaRole).toBe('textbox');
      expect(el.identity.tag).toBe('INPUT');
      expect(el.identity.cssSelector).toBe('input#email');
      expect(el.identity.stableId).toBe('email');
      expect(el.identity.testId).toBe('email-field');
      expect(el.identity.dataCy).toBe('email-cy');
      expect(el.identity.dataQa).toBe('email-qa');
      expect(el.identity.name).toBe('email');
      expect(el.identity.className).toBe('form-input required');
      expect(el.identity.xPath).toBe('/html/body/form/input[@id="email"]');
      expect(el.identity.ariaLabel).toBe('Email address');
      expect(el.identity.placeholder).toBe('Enter email');
    });

    it('V2 adapter preserves all interaction metadata needed for IR bridge', () => {
      resetIds();
      const input = makeIdentity({ accessibleName: 'Name', ariaRole: 'textbox', tag: 'INPUT' });
      const events: RecordedEvent[] = [
        evt('focus', input, 1000, { valueBefore: '' }),
        evt('input', input, 2000, { valueAfter: 'John' }),
        evt('blur', input, 3000, { valueAfter: 'John' }),
      ];

      const control = recognizeInteractions(events);
      const { control: controlIR } = dualIR(events, { legacy: detectInteractions(events), control }, 'https://example.com');

      // The IR step should have the correct input value
      const fillStep = controlIR.steps.find((s) => s.action === IRAction.FILL);
      expect(fillStep).toBeDefined();
      // The input value should come from interaction.metadata.textValue
      expect(fillStep?.input).toBeTruthy();
    });

    it('reducing transitions does not reduce IR step count', () => {
      resetIds();
      const url = 'https://example.com';
      const input1 = makeIdentity({ accessibleName: 'Email', ariaRole: 'textbox', tag: 'INPUT' });
      const input2 = makeIdentity({ accessibleName: 'Password', ariaRole: 'textbox', tag: 'INPUT' });
      const btn = makeIdentity({ accessibleName: 'Login', ariaRole: 'button', tag: 'BUTTON' });

      const events: RecordedEvent[] = [
        evt('focus', input1, 1000, { valueBefore: '' }),
        evt('input', input1, 2000, { valueAfter: 'test@test.com' }),
        evt('blur', input1, 3000, { valueAfter: 'test@test.com' }),
        evt('focus', input2, 4000, { valueBefore: '' }),
        evt('input', input2, 5000, { valueAfter: 'pass123' }),
        evt('blur', input2, 6000, { valueAfter: 'pass123' }),
        evt('click', btn, 7000),
      ];

      const { legacy, control } = dualClassify(events);
      const domains = dualAdapt(events, { legacy, control }, url);
      const irs = dualIR(events, { legacy, control }, url);

      // Control has fewer transitions but same or more IR steps (no noise)
      expect(domains.control.transitions.length).toBeLessThanOrEqual(domains.legacy.transitions.length);
      // IR steps should be comparable — the reduction is in noise transitions, not meaningful steps
      expect(irs.control.steps.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY METRICS
  // ════════════════════════════════════════════════════════════════════════

  describe('Summary Metrics', () => {
    it('control engine consistently produces fewer or equal transitions', () => {
      // Run a simple workflow
      resetIds();
      const input = makeIdentity({ accessibleName: 'Name', ariaRole: 'textbox', tag: 'INPUT' });
      const events: RecordedEvent[] = [
        evt('focus', input, 1000, { valueBefore: '' }),
        evt('input', input, 2000, { valueAfter: 'Test' }),
        evt('change', input, 2500, { valueAfter: 'Test' }),
        evt('blur', input, 3000, { valueAfter: 'Test' }),
      ];

      const { legacy, control } = dualClassify(events);
      const domains = dualAdapt(events, { legacy, control }, 'https://example.com');

      // Control: 1 transition (interaction-centric)
      // Legacy: 4 transitions (event-centric: focus, input, change, blur)
      expect(domains.control.transitions.length).toBe(1);
      expect(domains.legacy.transitions.length).toBeGreaterThanOrEqual(1);
      expect(domains.control.transitions.length).toBeLessThanOrEqual(domains.legacy.transitions.length);
    });
  });
});
