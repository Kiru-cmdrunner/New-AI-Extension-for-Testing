/**
 * Unit tests for Semantic Interaction Language — Frozen Plain-English Templates.
 *
 * Phase 3 Integration Step 3.
 *
 * Verifies:
 *   - All 10 canonical types render their frozen template.
 *   - Element name resolution priority (AI businessName > accessibleName > tag).
 *   - Edge cases: missing values, radio without value, date ranges, unknown types.
 *   - Templates match §8.2 frozen spec exactly.
 */

import { describe, it, expect } from 'vitest';
import { renderSemanticPlainEnglish, resolveElementName } from '../src/generation/engine/semantic-templates';
import type { ElementIdentity, AIUnderstanding } from '../src/shared/types';

// ── Helpers ───────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit Button',
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
    cssSelector: 'button.submit',
    xPath: '//button',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-1',
    ...overrides,
  };
}

function makeUnderstanding(overrides: Partial<AIUnderstanding> = {}): AIUnderstanding {
  return {
    businessName: 'Submit Form Button',
    controlType: 'Button',
    userIntent: 'Submit the form',
    confidenceScore: 0.95,
    ...overrides,
  };
}

// ── resolveElementName ────────────────────────────────────

describe('resolveElementName', () => {
  it('uses AI businessName when available', () => {
    const name = resolveElementName(makeIdentity(), makeUnderstanding());
    expect(name).toBe('Submit Form Button');
  });

  it('falls back to accessibleName when no AI businessName', () => {
    const name = resolveElementName(makeIdentity(), null);
    expect(name).toBe('Submit Button');
  });

  it('falls back to lowercased tag when no accessibleName', () => {
    const name = resolveElementName(makeIdentity({ accessibleName: '' }), null);
    expect(name).toBe('button');
  });

  it('truncates long names to 100 chars', () => {
    const longName = 'A'.repeat(200);
    const name = resolveElementName(makeIdentity(), makeUnderstanding({ businessName: longName }));
    expect(name.length).toBe(100);
  });
});

// ── Template Rendering: navigate ──────────────────────────

describe('navigate template', () => {
  it('renders "Navigate to {url}" without quotes', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'navigate',
      identity: makeIdentity(),
      understanding: null,
      value: null,
      checked: null,
      url: 'https://example.com/dashboard',
    });
    expect(result).toBe('Navigate to https://example.com/dashboard');
  });

  it('uses accessibleName when no explicit url provided', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'navigate',
      identity: makeIdentity({ accessibleName: 'https://example.com' }),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Navigate to https://example.com');
  });
});

// ── Template Rendering: click ─────────────────────────────

describe('click template', () => {
  it('renders "Click the {elementName}" with AI name', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'click',
      identity: makeIdentity(),
      understanding: makeUnderstanding(),
      value: null,
      checked: null,
    });
    expect(result).toBe('Click the Submit Form Button');
  });

  it('uses accessibleName when no AI', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'click',
      identity: makeIdentity(),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Click the Submit Button');
  });

  it('uses lowercased tag when no accessibleName', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'click',
      identity: makeIdentity({ accessibleName: '' }),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Click the button');
  });
});

// ── Template Rendering: fill ──────────────────────────────

describe('fill template', () => {
  it('renders "Enter \'{value}\' in the {elementName}"', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'fill',
      identity: makeIdentity({ tag: 'INPUT', accessibleName: 'Email' }),
      understanding: makeUnderstanding({ businessName: 'Email Address' }),
      value: 'user@test.com',
      checked: null,
    });
    expect(result).toBe("Enter 'user@test.com' in the Email Address");
  });

  it('renders "Enter text in the {elementName}" when no value', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'fill',
      identity: makeIdentity({ tag: 'INPUT', accessibleName: 'Email' }),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Enter text in the Email');
  });

  it('truncates long values to 100 chars', () => {
    const longValue = 'X'.repeat(200);
    const result = renderSemanticPlainEnglish({
      canonicalType: 'fill',
      identity: makeIdentity({ tag: 'INPUT', accessibleName: 'Notes' }),
      understanding: null,
      value: longValue,
      checked: null,
    });
    expect(result).toBe(`Enter '${'X'.repeat(100)}' in the Notes`);
  });
});

// ── Template Rendering: select ────────────────────────────

describe('select template', () => {
  it('renders "Select \'{value}\' from {elementName}" with value', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'select',
      identity: makeIdentity({ tag: 'SELECT', accessibleName: 'Country' }),
      understanding: null,
      value: 'India',
      checked: null,
    });
    expect(result).toBe("Select 'India' from Country");
  });

  it('renders "Select \'{elementName}\' when no value (radio buttons)', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'select',
      identity: makeIdentity({ tag: 'INPUT', ariaRole: 'radio', accessibleName: 'Express Delivery' }),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Select \'Express Delivery\'');
  });
});

// ── Template Rendering: toggle ────────────────────────────

describe('toggle template', () => {
  it('renders "Check the {elementName}" when checked=true', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'toggle',
      identity: makeIdentity({ tag: 'INPUT', ariaRole: 'checkbox', accessibleName: 'Remember Me' }),
      understanding: null,
      value: null,
      checked: true,
    });
    expect(result).toBe('Check the Remember Me');
  });

  it('renders "Uncheck the {elementName}" when checked=false', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'toggle',
      identity: makeIdentity({ tag: 'INPUT', ariaRole: 'checkbox', accessibleName: 'Subscribe' }),
      understanding: null,
      value: null,
      checked: false,
    });
    expect(result).toBe('Uncheck the Subscribe');
  });
});

// ── Template Rendering: selectDate ────────────────────────

describe('selectDate template', () => {
  it('renders "Select {value} as the {elementName}" with display value', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'selectDate',
      identity: makeIdentity({ tag: 'INPUT', accessibleName: 'Departure Date' }),
      understanding: null,
      value: null,
      checked: null,
      dateDisplayValue: '15 July 2026',
    });
    expect(result).toBe('Select 15 July 2026 as the Departure Date');
  });

  it('falls back to "date" when no display value', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'selectDate',
      identity: makeIdentity({ tag: 'INPUT', accessibleName: 'Departure Date' }),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Select date as the Departure Date');
  });
});

// ── Template Rendering: hover ─────────────────────────────

describe('hover template', () => {
  it('renders "Hover over the {elementName}"', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'hover',
      identity: makeIdentity({ tag: 'DIV', accessibleName: 'Products' }),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Hover over the Products');
  });
});

// ── Template Rendering: pressKey ──────────────────────────

describe('pressKey template', () => {
  it('renders "Press {key}"', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'pressKey',
      identity: makeIdentity(),
      understanding: null,
      value: 'Enter',
      checked: null,
    });
    expect(result).toBe('Press Enter');
  });

  it('renders "Press key" when no value', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'pressKey',
      identity: makeIdentity(),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Press key');
  });
});

// ── Template Rendering: upload ────────────────────────────

describe('upload template', () => {
  it('renders "Upload {files}"', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'upload',
      identity: makeIdentity(),
      understanding: null,
      value: 'document.pdf',
      checked: null,
    });
    expect(result).toBe('Upload document.pdf');
  });
});

// ── Template Rendering: drag ──────────────────────────────

describe('drag template', () => {
  it('renders "Drag {elementName}"', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'drag',
      identity: makeIdentity({ tag: 'DIV', accessibleName: 'Task Card' }),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Drag Task Card');
  });
});

// ── Fallback ──────────────────────────────────────────────

describe('unknown canonical type fallback', () => {
  it('defaults to click template for unknown types (L5)', () => {
    const result = renderSemanticPlainEnglish({
      canonicalType: 'unknownType' as any,
      identity: makeIdentity(),
      understanding: null,
      value: null,
      checked: null,
    });
    expect(result).toBe('Click the Submit Button');
  });
});
