/**
 * Merge Layer Real-World Validation Harness
 *
 * Runs realistic event sequences (built from actual DOM inspections) through
 * the full V1 → V2 → merge pipeline and collects metrics.
 *
 * Sites covered:
 *   1. Avis Ford — native HTML form (cross-origin iframe)
 *   2. Google Flights — Material Design comboboxes, date pickers
 *   3. Material UI (MUI) — Autocomplete, Select, DatePicker, Checkbox
 *   4. Ant Design — Select, Cascader, DatePicker
 *   5. Generic complex form — mixed native + custom widgets
 *
 * Each scenario:
 *   - Simulates a real user flow with realistic events
 *   - Runs V1, V2, and merge
 *   - Records: V2%, V1%, avg confidence, types, issues
 */

import { describe, it, expect } from 'vitest';
import { detectInteractions } from '../../src/classifier/interaction-detector.js';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import { mergeV1V2 } from '../../src/classifier/evidence/merge-layer.js';
import type { MergeMetrics } from '../../src/classifier/evidence/merge-layer.js';
import type { DetectedInteraction } from '../../src/classifier/interaction-types.js';
import type { RecordedEvent, ElementRecordedEvent, DomContext } from '../../src/recorder/recorded-event.js';
import type { ElementIdentity } from '../../src/shared/types.js';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  focusEvent,
  blurEvent,
  changeEvent,
  inputEvent,
  scrollEvent,
  mouseenterEvent,
  dblclickEvent,
  contextmenuEvent,
  dragstartEvent,
  dropEvent,
  navigationEvent,
  domContext,
} from './helpers.js';

// ── Aggregated metrics collector ─────────────────────────────────────────────

interface ScenarioResult {
  site: string;
  scenario: string;
  totalEvents: number;
  v1Count: number;
  v2Count: number;
  mergedCount: number;
  metrics: MergeMetrics;
  v2Types: string[];
  v1FallbackTypes: string[];
  avgV2Confidence: number;
  issues: string[];
}

const allResults: ScenarioResult[] = [];

function recordResult(
  site: string,
  scenario: string,
  events: RecordedEvent[],
  v1: DetectedInteraction[],
  v2: DetectedInteraction[],
  merged: { interactions: DetectedInteraction[]; metrics: MergeMetrics },
): void {
  const v2Confident = v2.filter(i => i.type !== 'Unknown' && i.confidence >= 0.5);
  const avgConf = v2Confident.length > 0
    ? v2Confident.reduce((sum, i) => sum + i.confidence, 0) / v2Confident.length
    : 0;

  const issues: string[] = [];

  // Check for duplicate eventIds in merged output
  const allIds: string[] = [];
  for (const i of merged.interactions) {
    allIds.push(...i.eventIds);
  }
  if (new Set(allIds).size !== allIds.length) {
    issues.push('DUPLICATE_EVENT_IDS in merged output');
  }

  // Check for events not covered by any interaction
  const coveredIds = new Set(allIds);
  const uncoveredEvents = events.filter(e =>
    'eventId' in e && !coveredIds.has((e as { eventId: string }).eventId)
  );
  if (uncoveredEvents.length > 0) {
    issues.push(`${uncoveredEvents.length} events not covered by any interaction`);
  }

  // Check for V2 producing more interactions than V1 (shouldn't happen — V2 groups better)
  if (merged.metrics.v2Count > v1.length) {
    issues.push(`V2 produced MORE interactions than V1 (${merged.metrics.v2Count} > ${v1.length})`);
  }

  const result: ScenarioResult = {
    site,
    scenario,
    totalEvents: events.length,
    v1Count: v1.length,
    v2Count: v2.length,
    mergedCount: merged.interactions.length,
    metrics: merged.metrics,
    v2Types: merged.interactions.filter(i => i.engine === 'v2').map(i => `${i.type}(${i.confidence.toFixed(2)})`),
    v1FallbackTypes: merged.interactions.filter(i => i.engine === 'v1-fallback').map(i => i.type),
    avgV2Confidence: Math.round(avgConf * 1000) / 1000,
    issues,
  };

  allResults.push(result);
}

// ── DOM Context presets ──────────────────────────────────────────────────────

const TEXT_CTX: DomContext = domContext({ inputType: 'text' });
const SELECT_CTX: DomContext = domContext({ inputType: null });
const CHECKBOX_CTX: DomContext = domContext({ inputType: 'checkbox' });
const RADIO_CTX: DomContext = domContext({ inputType: 'radio' });
const DATE_CTX: DomContext = domContext({ inputType: 'date' });
const FILE_CTX: DomContext = domContext({ inputType: 'file' });
const COMBOBOX_CTX = (expanded = false): DomContext =>
  domContext({ inputType: 'text', ariaExpanded: expanded, ariaHasPopup: 'listbox' });

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE
// ─────────────────────────────────────────────────────────────────────────────

describe('Merge Layer — Real-World Validation', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // SITE 1: AVIS FORD (native HTML form in cross-origin iframe)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Avis Ford — native HTML form', () => {

    it('New customer → VIN → Make → Year → Mileage', () => {
      resetEventCounter();
      const newCustomerBtn = makeTarget({
        tag: 'BUTTON', accessibleName: 'New Customer',
        className: 'gxp-button', ariaRole: 'button',
        cssSelector: 'button.gxp-button',
      });
      const vinInput = makeTarget({
        tag: 'INPUT', accessibleName: "What's your VIN?",
        className: 'gxp-input', cssSelector: 'input#gxp-vin',
        placeholder: 'Optional',
      });
      const makeSelect = makeTarget({
        tag: 'SELECT', accessibleName: 'Make',
        className: 'gxp-select', cssSelector: 'select#make-input',
      });
      const yearSelect = makeTarget({
        tag: 'SELECT', accessibleName: 'Year',
        className: 'gxp-select', cssSelector: 'select#year-input',
      });
      const mileageInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Mileage',
        className: 'gxp-input', cssSelector: 'input#mileage-input',
        placeholder: 'Optional',
      });

      const events: RecordedEvent[] = [
        navigationEvent('https://avisford.com/service-appointment.aspx'),
        clickEvent(newCustomerBtn),
        focusEvent(vinInput, { valueBefore: '', domContext: TEXT_CTX }),
        blurEvent(vinInput, { valueAfter: '1G2ZG58B874123456', domContext: TEXT_CTX }),
        clickEvent(makeSelect),
        changeEvent(makeSelect, { valueAfter: 'FORD' }),
        clickEvent(yearSelect),
        changeEvent(yearSelect, { valueAfter: '2008' }),
        focusEvent(mileageInput, { valueBefore: '', domContext: TEXT_CTX }),
        blurEvent(mileageInput, { valueAfter: '75000', domContext: TEXT_CTX }),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Avis Ford', 'Basic form fill (5 actions)', events, v1, v2, merged);

      expect(merged.interactions.length).toBeGreaterThan(0);
    });

    it('Full appointment booking with scroll + hover', () => {
      resetEventCounter();
      const serviceLink = makeTarget({
        tag: 'A', accessibleName: 'Service Department',
        cssSelector: 'a[href="/service"]',
      });
      const scheduleBtn = makeTarget({
        tag: 'A', accessibleName: 'Schedule Your Service',
        cssSelector: 'a[href="/service-appointment"]',
      });
      const formContainer = makeTarget({
        tag: 'DIV', accessibleName: 'Enter Your Information',
        className: 'gxp-container',
      });
      const newCustomerBtn = makeTarget({
        tag: 'BUTTON', accessibleName: 'New Customer',
        className: 'gxp-button',
      });

      const events: RecordedEvent[] = [
        navigationEvent('https://avisford.com/'),
        clickEvent(serviceLink),
        navigationEvent('https://avisford.com/service'),
        mouseenterEvent(formContainer),
        clickEvent(scheduleBtn),
        navigationEvent('https://avisford.com/service-appointment.aspx'),
        scrollEvent(makeTarget({ tag: 'HTML' })),
        clickEvent(newCustomerBtn),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Avis Ford', 'Navigation + scroll + hover + click', events, v1, v2, merged);

      expect(merged.interactions.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SITE 2: GOOGLE FLIGHTS (Material Design)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Google Flights — Material Design', () => {

    it('Departure autocomplete → Destination autocomplete → Class dropdown → Date', () => {
      resetEventCounter();
      const departureInput = makeTarget({
        tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Where from?',
        ariaLabel: 'Where from?', className: 'II2One j0Ppje zmMKJ LbIaRd',
        cssSelector: 'input[aria-label="Where from?"]',
      });
      const nyOption = makeTarget({
        tag: 'LI', ariaRole: 'option', accessibleName: 'New York, NY',
        className: 'MCs1Pd UbEQCe VfPpkd-OkbHre',
      });
      const destInput = makeTarget({
        tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Where to?',
        className: 'II2One j0Ppje zmMKJ LbIaRd',
      });
      const londonOption = makeTarget({
        tag: 'LI', ariaRole: 'option', accessibleName: 'London, England',
        className: 'MCs1Pd UbEQCe VfPpkd-OkbHre',
      });
      const classDropdown = makeTarget({
        tag: 'DIV', ariaRole: 'combobox', accessibleName: 'Class',
        className: 'e5BC7e', ariaLabel: 'Class',
      });
      const businessOption = makeTarget({
        tag: 'LI', ariaRole: 'option', accessibleName: 'Business',
        className: 'MCs1Pd UbEQCe VfPpkd-OkbHre',
      });
      const dateInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Departure',
        ariaLabel: 'Departure', className: 'TP4Lpb eoY5cb j0Ppje',
        cssSelector: 'input[aria-label="Departure"]',
      });
      const calendarCell = makeTarget({
        tag: 'DIV', ariaRole: 'gridcell', accessibleName: 'August 15',
        className: 'calendar-day',
      });

      const events: RecordedEvent[] = [
        navigationEvent('https://www.google.com/travel/flights'),
        // Departure autocomplete
        clickEvent(departureInput, { domContext: COMBOBOX_CTX(true) }),
        clickEvent(nyOption),
        // Destination autocomplete
        clickEvent(destInput, { domContext: COMBOBOX_CTX(true) }),
        clickEvent(londonOption),
        // Class dropdown
        clickEvent(classDropdown, { domContext: domContext({ inputType: null, ariaExpanded: true, ariaHasPopup: 'listbox' }) }),
        clickEvent(businessOption),
        // Date picker
        clickEvent(dateInput),
        clickEvent(calendarCell),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Google Flights', 'Full flight search (autocomplete+dropdown+date)', events, v1, v2, merged);

      // V2 should group the combobox+option pairs into CustomDropdown
      const v2Types = merged.interactions.filter(i => i.engine === 'v2').map(i => i.type);
      expect(v2Types).toContain('CustomDropdown');

      // V2 should produce fewer interactions than V1 (better grouping)
      expect(merged.metrics.v2Count).toBeLessThan(v1.length);
    });

    it('Round-trip with two date selections + passenger count', () => {
      resetEventCounter();
      const departureDate = makeTarget({
        tag: 'INPUT', ariaLabel: 'Departure', className: 'TP4Lpb',
      });
      const depCell = makeTarget({
        tag: 'DIV', ariaRole: 'gridcell', accessibleName: 'August 15',
        className: 'calendar-day',
      });
      const returnDate = makeTarget({
        tag: 'INPUT', ariaLabel: 'Return', className: 'TP4Lpb',
      });
      const retCell = makeTarget({
        tag: 'DIV', ariaRole: 'gridcell', accessibleName: 'August 22',
        className: 'calendar-day',
      });
      const passengersBtn = makeTarget({
        tag: 'BUTTON', ariaLabel: 'Passengers', className: 'VfPpkd-kBDsck',
      });
      const addPassenger = makeTarget({
        tag: 'BUTTON', accessibleName: 'Add adult',
        className: 'LK.quP', ariaLabel: 'Add adult',
      });

      const events: RecordedEvent[] = [
        clickEvent(departureDate),
        clickEvent(depCell),
        clickEvent(returnDate),
        clickEvent(retCell),
        clickEvent(passengersBtn),
        clickEvent(addPassenger),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Google Flights', 'Round-trip dates + passengers', events, v1, v2, merged);

      expect(merged.interactions.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SITE 3: MATERIAL UI (MUI) COMPONENTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Material UI (MUI) — enterprise components', () => {

    it('MUI Autocomplete (text input + dropdown)', () => {
      resetEventCounter();
      const acInput = makeTarget({
        tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Country',
        ariaExpanded: 'true', ariaHasPopup: 'listbox', ariaLabel: 'Country',
        className: 'MuiOutlinedInput-input MuiInputBase-input css-1x5jdmq',
        cssSelector: 'input.MuiOutlinedInput-input',
      });
      const acOption = makeTarget({
        tag: 'DIV', ariaRole: 'option', accessibleName: 'United States',
        className: 'MuiAutocomplete-option',
      });

      const events: RecordedEvent[] = [
        clickEvent(acInput, { domContext: COMBOBOX_CTX(true) }),
        clickEvent(acOption),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('MUI', 'Autocomplete', events, v1, v2, merged);

      expect(merged.interactions.filter(i => i.engine === 'v2' && i.type === 'Autocomplete')).toHaveLength(1);
    });

    it('MUI Select (button trigger + listbox)', () => {
      resetEventCounter();
      const selectBtn = makeTarget({
        tag: 'DIV', ariaRole: 'combobox', ariaExpanded: 'true',
        ariaHasPopup: 'listbox', accessibleName: 'Age',
        className: 'MuiSelect-select MuiInputBase-input',
      });
      const selectOption = makeTarget({
        tag: 'LI', ariaRole: 'option', accessibleName: '30',
        className: 'MuiMenuItem-root',
      });

      const events: RecordedEvent[] = [
        clickEvent(selectBtn, { domContext: domContext({ inputType: null, ariaExpanded: true, ariaHasPopup: 'listbox' }) }),
        clickEvent(selectOption),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('MUI', 'Select dropdown', events, v1, v2, merged);

      expect(merged.interactions.filter(i => i.engine === 'v2').length).toBeGreaterThan(0);
    });

    it('MUI DatePicker (input + calendar gridcell)', () => {
      resetEventCounter();
      const dateInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Choose date',
        className: 'MuiOutlinedInput-input',
      });
      const dateCell = makeTarget({
        tag: 'BUTTON', ariaRole: 'gridcell', accessibleName: '15',
        className: 'MuiPickersDay-dayWithLabel',
      });

      const events: RecordedEvent[] = [
        clickEvent(dateInput),
        clickEvent(dateCell),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('MUI', 'DatePicker', events, v1, v2, merged);

      // V2 should detect DatePicker from gridcell
      const dpInteractions = merged.interactions.filter(i => i.type === 'DatePicker');
      expect(dpInteractions.length).toBeGreaterThanOrEqual(1);
    });

    it('MUI Checkbox + RadioGroup + Switch', () => {
      resetEventCounter();
      const checkbox = makeTarget({
        tag: 'INPUT', accessibleName: 'Enable notifications',
        className: 'MuiCheckbox-root',
        cssSelector: 'input[type="checkbox"]',
      });
      const radio1 = makeTarget({
        tag: 'INPUT', accessibleName: 'Male',
        className: 'MuiRadio-root',
        cssSelector: 'input[type="radio"]',
      });
      const toggle = makeTarget({
        tag: 'SPAN', ariaRole: 'switch', accessibleName: 'WiFi',
        className: 'MuiSwitch-switchBase',
      });

      const events: RecordedEvent[] = [
        clickEvent(checkbox, { domContext: CHECKBOX_CTX, checkedAfter: true }),
        clickEvent(radio1, { domContext: RADIO_CTX, checkedAfter: true }),
        clickEvent(toggle),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('MUI', 'Checkbox + Radio + Switch', events, v1, v2, merged);

      expect(merged.interactions.length).toBeGreaterThan(0);
    });

    it('MUI full registration form (Autocomplete + Select + DatePicker + Checkbox + TextEntry)', () => {
      resetEventCounter();
      const nameInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Full Name',
        className: 'MuiOutlinedInput-input',
      });
      const countryAC = makeTarget({
        tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Country',
        ariaExpanded: 'true', ariaHasPopup: 'listbox',
        className: 'MuiOutlinedInput-input',
      });
      const countryOpt = makeTarget({
        tag: 'DIV', ariaRole: 'option', accessibleName: 'United States',
        className: 'MuiAutocomplete-option',
      });
      const stateSelect = makeTarget({
        tag: 'DIV', ariaRole: 'combobox', ariaExpanded: 'true',
        ariaHasPopup: 'listbox', accessibleName: 'State',
        className: 'MuiSelect-select',
      });
      const stateOpt = makeTarget({
        tag: 'LI', ariaRole: 'option', accessibleName: 'California',
        className: 'MuiMenuItem-root',
      });
      const dobInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Date of Birth',
        className: 'MuiOutlinedInput-input',
      });
      const dobCell = makeTarget({
        tag: 'BUTTON', ariaRole: 'gridcell', accessibleName: '15',
        className: 'MuiPickersDay-dayWithLabel',
      });
      const termsCheckbox = makeTarget({
        tag: 'INPUT', accessibleName: 'I agree to terms',
        className: 'MuiCheckbox-root',
        cssSelector: 'input[type="checkbox"]',
      });

      const events: RecordedEvent[] = [
        navigationEvent('https://app.example.com/register'),
        focusEvent(nameInput, { valueBefore: '', domContext: TEXT_CTX }),
        blurEvent(nameInput, { valueAfter: 'John Doe', domContext: TEXT_CTX }),
        clickEvent(countryAC, { domContext: COMBOBOX_CTX(true) }),
        clickEvent(countryOpt),
        clickEvent(stateSelect, { domContext: domContext({ inputType: null, ariaExpanded: true, ariaHasPopup: 'listbox' }) }),
        clickEvent(stateOpt),
        clickEvent(dobInput),
        clickEvent(dobCell),
        clickEvent(termsCheckbox, { domContext: CHECKBOX_CTX, checkedAfter: true }),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('MUI', 'Full registration form (6 actions)', events, v1, v2, merged);

      expect(merged.interactions.filter(i => i.engine === 'v2').length).toBeGreaterThanOrEqual(5);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SITE 4: ANT DESIGN COMPONENTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Ant Design — enterprise components', () => {

    it('AntD Select (div trigger with aria)', () => {
      resetEventCounter();
      const selectTrigger = makeTarget({
        tag: 'DIV', ariaRole: 'combobox', accessibleName: 'Province',
        ariaExpanded: 'true', ariaHasPopup: 'listbox', ariaLabel: 'Province',
        className: 'ant-select-selector',
      });
      const selectOption = makeTarget({
        tag: 'DIV', ariaRole: 'option', accessibleName: 'Zhejiang',
        className: 'ant-select-item ant-select-item-option',
      });

      const events: RecordedEvent[] = [
        clickEvent(selectTrigger, { domContext: domContext({ inputType: null, ariaExpanded: true, ariaHasPopup: 'listbox' }) }),
        clickEvent(selectOption),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Ant Design', 'Select dropdown', events, v1, v2, merged);

      expect(merged.interactions.filter(i => i.engine === 'v2').length).toBeGreaterThan(0);
    });

    it('AntD DatePicker', () => {
      resetEventCounter();
      const dateInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Select date',
        className: 'ant-picker-input',
      });
      const dateCell = makeTarget({
        tag: 'DIV', ariaRole: 'gridcell', accessibleName: '2024-08-15',
        className: 'ant-picker-cell ant-picker-cell-in-view',
      });

      const events: RecordedEvent[] = [
        clickEvent(dateInput),
        clickEvent(dateCell),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Ant Design', 'DatePicker', events, v1, v2, merged);

      expect(merged.interactions.filter(i => i.type === 'DatePicker').length).toBeGreaterThanOrEqual(1);
    });

    it('AntD Cascader + Checkbox + RadioGroup', () => {
      resetEventCounter();
      const cascader = makeTarget({
        tag: 'INPUT', ariaRole: 'combobox', accessibleName: 'Category',
        ariaExpanded: 'true', ariaHasPopup: 'listbox',
        className: 'ant-cascader-input',
      });
      const cascaderOpt = makeTarget({
        tag: 'LI', ariaRole: 'option', accessibleName: 'Electronics',
        className: 'ant-cascader-menu-item',
      });
      const checkbox = makeTarget({
        tag: 'INPUT', accessibleName: 'Subscribe',
        className: 'ant-checkbox-input',
        cssSelector: 'input[type="checkbox"]',
      });
      const radio = makeTarget({
        tag: 'INPUT', accessibleName: 'Monthly',
        className: 'ant-radio-input',
        cssSelector: 'input[type="radio"]',
      });

      const events: RecordedEvent[] = [
        clickEvent(cascader, { domContext: COMBOBOX_CTX(true) }),
        clickEvent(cascaderOpt),
        clickEvent(checkbox, { domContext: CHECKBOX_CTX, checkedAfter: true }),
        clickEvent(radio, { domContext: RADIO_CTX, checkedAfter: true }),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Ant Design', 'Cascader + Checkbox + Radio', events, v1, v2, merged);

      expect(merged.interactions.length).toBeGreaterThan(0);
    });

    it('AntD full checkout form', () => {
      resetEventCounter();
      const addressInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Shipping Address',
        className: 'ant-input',
      });
      const citySelect = makeTarget({
        tag: 'DIV', ariaRole: 'combobox', accessibleName: 'City',
        ariaExpanded: 'true', ariaHasPopup: 'listbox',
        className: 'ant-select-selector',
      });
      const cityOpt = makeTarget({
        tag: 'DIV', ariaRole: 'option', accessibleName: 'San Francisco',
        className: 'ant-select-item',
      });
      const deliveryDate = makeTarget({
        tag: 'INPUT', accessibleName: 'Delivery Date',
        className: 'ant-picker-input',
      });
      const dateCell = makeTarget({
        tag: 'DIV', ariaRole: 'gridcell', accessibleName: 'August 20',
        className: 'ant-picker-cell',
      });
      const payRadio = makeTarget({
        tag: 'INPUT', accessibleName: 'Credit Card',
        className: 'ant-radio-input',
        cssSelector: 'input[type="radio"]',
      });

      const events: RecordedEvent[] = [
        navigationEvent('https://shop.example.com/checkout'),
        focusEvent(addressInput, { valueBefore: '', domContext: TEXT_CTX }),
        blurEvent(addressInput, { valueAfter: '123 Main St', domContext: TEXT_CTX }),
        clickEvent(citySelect, { domContext: domContext({ inputType: null, ariaExpanded: true, ariaHasPopup: 'listbox' }) }),
        clickEvent(cityOpt),
        clickEvent(deliveryDate),
        clickEvent(dateCell),
        clickEvent(payRadio, { domContext: RADIO_CTX, checkedAfter: true }),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Ant Design', 'Full checkout form (4 actions)', events, v1, v2, merged);

      expect(merged.interactions.filter(i => i.engine === 'v2').length).toBeGreaterThanOrEqual(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SITE 5: GENERIC COMPLEX FORM (mixed widgets)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Generic complex form — mixed widgets', () => {

    it('Multi-tab form with text, dropdown, date, checkbox, file upload, scroll, hover, drag-drop', () => {
      resetEventCounter();
      const tabBtn = makeTarget({
        tag: 'DIV', ariaRole: 'tab', accessibleName: 'Profile',
        className: 'tab-button',
      });
      const nameInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Name',
      });
      const roleSelect = makeTarget({
        tag: 'SELECT', accessibleName: 'Role',
        cssSelector: 'select#role',
      });
      const startDate = makeTarget({
        tag: 'INPUT', accessibleName: 'Start Date',
        className: 'react-datepicker__input',
      });
      const dateCell = makeTarget({
        tag: 'DIV', ariaRole: 'gridcell', accessibleName: 'September 1',
        className: 'react-datepicker__day',
      });
      const adminCheckbox = makeTarget({
        tag: 'INPUT', accessibleName: 'Admin Access',
        cssSelector: 'input[type="checkbox"]',
      });
      const fileInput = makeTarget({
        tag: 'INPUT', accessibleName: 'Upload Avatar',
        cssSelector: 'input[type="file"]',
      });
      const navLink = makeTarget({
        tag: 'A', accessibleName: 'Settings',
        cssSelector: 'a[href="/settings"]',
      });
      const dragSource = makeTarget({
        tag: 'DIV', accessibleName: 'Widget A',
        className: 'draggable',
      });
      const dropTarget = makeTarget({
        tag: 'DIV', accessibleName: 'Drop Zone',
        className: 'drop-zone',
      });

      const events: RecordedEvent[] = [
        navigationEvent('https://app.example.com/dashboard'),
        clickEvent(tabBtn),
        mouseenterEvent(makeTarget({ tag: 'DIV', accessibleName: 'Tooltip area' })),
        focusEvent(nameInput, { valueBefore: '', domContext: TEXT_CTX }),
        blurEvent(nameInput, { valueAfter: 'Alice', domContext: TEXT_CTX }),
        clickEvent(roleSelect),
        changeEvent(roleSelect, { valueAfter: 'Engineer' }),
        clickEvent(startDate),
        clickEvent(dateCell),
        clickEvent(adminCheckbox, { domContext: CHECKBOX_CTX, checkedAfter: true }),
        clickEvent(fileInput, { domContext: FILE_CTX }),
        scrollEvent(makeTarget({ tag: 'HTML' })),
        clickEvent(navLink),
        dragstartEvent(dragSource),
        dropEvent(dropTarget),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Generic', 'Multi-tab dashboard (12+ actions)', events, v1, v2, merged);

      expect(merged.interactions.length).toBeGreaterThan(5);
    });

    it('Settings page with toggle switches + radio + text areas', () => {
      resetEventCounter();
      const toggle1 = makeTarget({
        tag: 'SPAN', ariaRole: 'switch', accessibleName: 'Dark Mode',
        className: 'toggle-switch',
      });
      const toggle2 = makeTarget({
        tag: 'SPAN', ariaRole: 'switch', accessibleName: 'Email Alerts',
        className: 'toggle-switch',
      });
      const radioGroup = makeTarget({
        tag: 'INPUT', accessibleName: 'Daily',
        cssSelector: 'input[type="radio"]',
      });
      const textarea = makeTarget({
        tag: 'TEXTAREA', accessibleName: 'Notes',
      });
      const saveBtn = makeTarget({
        tag: 'BUTTON', accessibleName: 'Save Settings',
      });

      const events: RecordedEvent[] = [
        clickEvent(toggle1),
        clickEvent(toggle2),
        clickEvent(radioGroup, { domContext: RADIO_CTX, checkedAfter: true }),
        focusEvent(textarea, { valueBefore: '' }),
        blurEvent(textarea, { valueAfter: 'Remember to update docs' }),
        clickEvent(saveBtn),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const merged = mergeV1V2(v2, v1, events.length);
      recordResult('Generic', 'Settings page (toggle + radio + textarea)', events, v1, v2, merged);

      expect(merged.interactions.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AGGREGATED REPORT (runs after all scenarios)
  // ═══════════════════════════════════════════════════════════════════════════

  // We use a special test that runs last to emit the aggregated report.
  // The describe blocks above all push into allResults synchronously.

  describe('Aggregated Report', () => {
    it('summary of all scenarios with metrics', () => {
      // This test runs after all the above (alphabetically later in the same file)
      // But vitest runs in order, so we need to ensure ordering.
      // Actually, vitest runs tests in order within a describe block.
      // Since this describe block is the last one, all results are populated.
      // However, all the above describe blocks haven't run yet at collection time.
      // We'll rely on the afterAll hook below for the actual report.
      expect(allResults.length).toBeGreaterThan(0);
    });
  });
});

// ── After all tests: emit aggregated report ─────────────────────────────────

import { afterAll } from 'vitest';

afterAll(() => {
  if (allResults.length === 0) return;

  const line = '═'.repeat(80);
  const dash = '─'.repeat(80);

  // Aggregate stats
  const totalScenarios = allResults.length;
  const totalEvents = allResults.reduce((s, r) => s + r.totalEvents, 0);
  const totalV2 = allResults.reduce((s, r) => s + r.metrics.v2Count, 0);
  const totalV1Fallback = allResults.reduce((s, r) => s + r.metrics.v1FallbackCount, 0);
  const totalInteractions = totalV2 + totalV1Fallback;
  const overallV2Pct = totalInteractions > 0
    ? Math.round((totalV2 / totalInteractions) * 1000) / 10 : 0;
  const overallV1Pct = totalInteractions > 0
    ? Math.round((totalV1Fallback / totalInteractions) * 1000) / 10 : 0;
  const avgConfidenceValues = allResults
    .filter(r => r.avgV2Confidence > 0)
    .map(r => r.avgV2Confidence);
  const avgConfidence = avgConfidenceValues.length > 0
    ? avgConfidenceValues.reduce((a, b) => a + b, 0) / avgConfidenceValues.length : 0;

  // V1-dependent types
  const v1TypeCounts: Record<string, number> = {};
  for (const r of allResults) {
    for (const t of r.v1FallbackTypes) {
      v1TypeCounts[t] = (v1TypeCounts[t] || 0) + 1;
    }
  }

  // V2 type breakdown
  const v2TypeCounts: Record<string, number> = {};
  for (const r of allResults) {
    for (const t of r.v2Types) {
      const baseType = t.split('(')[0]; // strip confidence
      v2TypeCounts[baseType] = (v2TypeCounts[baseType] || 0) + 1;
    }
  }

  // Issues
  const allIssues = allResults.filter(r => r.issues.length > 0);

  console.log(`
${line}
${'  MERGE LAYER REAL-WORLD VALIDATION REPORT'.padEnd(80)}
${line}
  Scenarios:     ${totalScenarios}
  Total events:  ${totalEvents}
  Total interactions: ${totalInteractions}
${dash}
  OVERALL METRICS
${dash}
  V2 (Evidence Engine):     ${totalV2} interactions (${overallV2Pct}%)
  V1 (Fallback):            ${totalV1Fallback} interactions (${overallV1Pct}%)
  Avg V2 Confidence:        ${avgConfidence.toFixed(3)}
${dash}
  V2 TYPE BREAKDOWN
${dash}${Object.entries(v2TypeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `\n  ${t.padEnd(25)} ${c}`).join('')}
${dash}
  V1 FALLBACK TYPE BREAKDOWN (types V2 couldn't handle)
${dash}${Object.keys(v1TypeCounts).length > 0
    ? Object.entries(v1TypeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `\n  ${t.padEnd(25)} ${c}`).join('')
    : '\n  (none — V2 handled everything!)'}
${dash}
  PER-SCENARIO BREAKDOWN
${dash}
${allResults.map(r =>
    `  [${r.site}] ${r.scenario}\n` +
    `    Events: ${r.totalEvents} | V1: ${r.v1Count} | V2: ${r.v2Count} | Merged: ${r.mergedCount}\n` +
    `    V2: ${r.metrics.v2Percentage}% | V1-FB: ${r.metrics.v1FallbackPercentage}% | Avg conf: ${r.avgV2Confidence}\n` +
    `    V2 types: ${r.v2Types.join(', ') || '(none)'}\n` +
    `    V1 types: ${r.v1FallbackTypes.join(', ') || '(none)'}\n` +
    `    Issues: ${r.issues.length > 0 ? r.issues.join('; ') : 'none'}`
  ).join('\n' + dash + '\n')}
${dash}
  ISSUES SUMMARY
${dash}
${allIssues.length > 0
    ? allIssues.map(r => `  [${r.site}] ${r.scenario}: ${r.issues.join('; ')}`).join('\n')
    : '  No issues found across all scenarios!'}
${line}
`);
});
