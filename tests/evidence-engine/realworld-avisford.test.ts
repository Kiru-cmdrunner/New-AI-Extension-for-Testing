/**
 * Real-World Validation: Avis Ford Service Form
 *
 * Tests built from actual DOM inspection of avisford.com/service-appointment.aspx
 * The Ford service form lives in a cross-origin iframe at guestxpui.ford.com.
 * Form elements use native <select> with class "gxp-select" and <input type="text">
 * with class "gxp-input". No ARIA roles on the form elements.
 *
 * Form structure:
 *   - VIN: <input type="text" id="whats-your-vin" class="gxp-input"> (optional)
 *   - Make: <select id="make-input" class="gxp-select"> (45 options, FORD selected)
 *   - Year: <select id="year-input" class="gxp-select"> (47 options)
 *   - Model: <select id="model-input" class="gxp-select gxp-select--disabled"> (disabled)
 *   - Vehicle Type: <select id="vehicle-type-input" class="gxp-select gxp-select--disabled"> (disabled)
 *   - Mileage: <input type="text" id="mileage-input" class="gxp-input"> (optional)
 *   - Continue: <button class="gxp-button gxp-button--disabled gxp-button--white">
 *
 * Recording flow: Click "New Customer" → fill form → Continue
 *
 * Note: This form is inside an iframe (inIframe=true in element identity).
 * The recorder handles this natively — iframe events are captured normally.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.ts';
import { detectInteractions } from '../../src/classifier/interaction-detector.ts';
import {
  clickEvent, focusEvent, blurEvent, changeEvent, navigationEvent,
  resetEventCounter, domContext,
} from './helpers.ts';
import type { DetectedInteraction } from '../../src/classifier/interaction-types.ts';

// ── Element identities matching the real Ford service form ──────────────

const newCustomerBtn = {
  tag: 'BUTTON', accessibleName: 'button to proceed as a new customer',
  stableId: null, cssSelector: 'iframe + button.gxp-button',
  className: 'gxp-button gxp-button--white',
};

const vinInput = {
  tag: 'INPUT', accessibleName: "What's your VIN?",
  stableId: 'whats-your-vin', cssSelector: '#whats-your-vin',
  className: 'gxp-input', name: '',
};

const makeSelect = {
  tag: 'SELECT', accessibleName: 'Make',
  stableId: 'make-input', cssSelector: '#make-input',
  className: 'gxp-select', name: '',
};

const yearSelect = {
  tag: 'SELECT', accessibleName: 'Year',
  stableId: 'year-input', cssSelector: '#year-input',
  className: 'gxp-select', name: '',
};

const modelSelect = {
  tag: 'SELECT', accessibleName: 'Model',
  stableId: 'model-input', cssSelector: '#model-input',
  className: 'gxp-select', name: '',
};

const vehicleTypeSelect = {
  tag: 'SELECT', accessibleName: 'Vehicle Type',
  stableId: 'vehicle-type-input', cssSelector: '#vehicle-type-input',
  className: 'gxp-select', name: '',
};

const mileageInput = {
  tag: 'INPUT', accessibleName: 'Mileage',
  stableId: 'mileage-input', cssSelector: '#mileage-input',
  className: 'gxp-input', name: '',
};

const continueBtn = {
  tag: 'BUTTON', accessibleName: 'Continue',
  stableId: null, cssSelector: 'button.gxp-button--white',
  className: 'gxp-button gxp-button--white',
};

const TEXT_CTX = domContext({ inputType: 'text' });

// ─────────────────────────────────────────────────────────────────────────
// Complete Avis Ford service form flow
// ─────────────────────────────────────────────────────────────────────────

describe('Real-World: Avis Ford service form', () => {
  beforeEach(() => resetEventCounter());

  it('complete form fill: New Customer → VIN → Make → Year → Mileage → 5 interactions', () => {
    const events = [
      // Click "New Customer"
      clickEvent(newCustomerBtn),

      // Enter VIN
      focusEvent(vinInput, { valueBefore: '', domContext: TEXT_CTX }),
      blurEvent(vinInput, { valueAfter: '1G2ZG58B874123456', domContext: TEXT_CTX }),

      // Select Make (FORD is default, change to PONTIAC)
      clickEvent(makeSelect),
      changeEvent(makeSelect, { valueAfter: 'PONTIAC' }),

      // Select Year
      clickEvent(yearSelect),
      changeEvent(yearSelect, { valueAfter: '2008' }),

      // Enter Mileage
      focusEvent(mileageInput, { valueBefore: '', domContext: TEXT_CTX }),
      blurEvent(mileageInput, { valueAfter: '75000', domContext: TEXT_CTX }),
    ];

    const v2 = detectInteractionsV2(events);

    expect(v2).toHaveLength(5);
    expect(v2[0].type).toBe('Click');           // New Customer button
    expect(v2[1].type).toBe('TextEntry');        // VIN field
    expect(v2[2].type).toBe('NativeDropdown');   // Make select
    expect(v2[3].type).toBe('NativeDropdown');   // Year select
    expect(v2[4].type).toBe('TextEntry');        // Mileage field

    // Verify metadata
    expect(v2[1].metadata?.textValue).toBe('1G2ZG58B874123456');
    expect(v2[2].metadata?.selectedValue).toBe('PONTIAC');
    expect(v2[3].metadata?.selectedValue).toBe('2008');
    expect(v2[4].metadata?.textValue).toBe('75000');
  });

  it('V1 and V2 produce same types for native selects', () => {
    const events = [
      clickEvent(makeSelect),
      changeEvent(makeSelect, { valueAfter: 'HONDA' }),
      navigationEvent('https://guestxpui.ford.com/next'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    const v1Types = v1.map(r => r.type);
    const v2Types = v2.map(r => r.type);

    expect(v1Types).toContain('NativeDropdown');
    expect(v2Types).toContain('NativeDropdown');
  });

  it('VIN text entry with domContext produces single TextEntry', () => {
    const events = [
      focusEvent(vinInput, { valueBefore: '', domContext: TEXT_CTX }),
      blurEvent(vinInput, { valueAfter: '1FAFP42U4WA123456', domContext: TEXT_CTX }),
      navigationEvent('https://guestxpui.ford.com/next'),
    ];

    const v2 = detectInteractionsV2(events);
    expect(v2).toHaveLength(2); // TextEntry + navigation
    expect(v2[0].type).toBe('TextEntry');
    expect(v2[0].metadata?.textValue).toBe('1FAFP42U4WA123456');
  });

  it('all 4 dropdowns in sequence produce 4 NativeDropdown interactions', () => {
    // After selecting Make and Year, Model and Vehicle Type become enabled
    const events = [
      clickEvent(makeSelect),
      changeEvent(makeSelect, { valueAfter: 'FORD' }),
      clickEvent(yearSelect),
      changeEvent(yearSelect, { valueAfter: '2020' }),
      clickEvent(modelSelect),
      changeEvent(modelSelect, { valueAfter: 'F-150' }),
      clickEvent(vehicleTypeSelect),
      changeEvent(vehicleTypeSelect, { valueAfter: 'Gas' }),
    ];

    const v2 = detectInteractionsV2(events);
    expect(v2).toHaveLength(4);
    expect(v2.every(r => r.type === 'NativeDropdown')).toBe(true);
    expect(v2[0].metadata?.selectedValue).toBe('FORD');
    expect(v2[1].metadata?.selectedValue).toBe('2020');
    expect(v2[2].metadata?.selectedValue).toBe('F-150');
    expect(v2[3].metadata?.selectedValue).toBe('Gas');
  });

  it('V2 produces ≤ V1 interactions (no event splitting)', () => {
    const events = [
      focusEvent(vinInput, { valueBefore: '', domContext: TEXT_CTX }),
      blurEvent(vinInput, { valueAfter: 'V12345', domContext: TEXT_CTX }),
      clickEvent(makeSelect),
      changeEvent(makeSelect, { valueAfter: 'BMW' }),
      focusEvent(mileageInput, { valueBefore: '', domContext: TEXT_CTX }),
      blurEvent(mileageInput, { valueAfter: '50000', domContext: TEXT_CTX }),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);

    expect(v2.length).toBeLessThanOrEqual(v1.length);
  });
});
