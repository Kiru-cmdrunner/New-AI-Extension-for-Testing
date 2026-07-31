/**
 * Tests for State-Based Assertion Derivation (Phase 2)
 */

import { describe, it, expect } from 'vitest';
import { deriveStateAssertions } from '../../src/generation/assertion-deriver';
import type { DetectedInteraction } from '../../src/classifier/interaction-types';
import { ValidationType, ValidationComparison, ValidationSeverity } from '../../src/domain/enums';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeInteraction(
  type: string,
  metadata: Record<string, unknown>,
): DetectedInteraction {
  return {
    interactionId: 'int-1',
    type: type as DetectedInteraction['type'],
    eventIds: ['evt-1'],
    rawEventTypes: ['click'],
    metadata,
    confidence: 1.0,
  };
}

// ── TextEntry ───────────────────────────────────────────────────────────

describe('TextEntry assertions', () => {
  it('derives value assertion from textValue', () => {
    const interaction = makeInteraction('TextEntry', { textValue: 'john@example.com' });
    const assertions = deriveStateAssertions(interaction);

    expect(assertions).toHaveLength(1);
    expect(assertions[0].type).toBe(ValidationType.EQUALITY);
    expect(assertions[0].comparison).toBe(ValidationComparison.EQUALS);
    expect(assertions[0].expectedValue).toBe('john@example.com');
    expect(assertions[0].property).toBe('value');
    expect(assertions[0].severity).toBe(ValidationSeverity.HARD);
  });

  it('derives no assertion for empty textValue', () => {
    const interaction = makeInteraction('TextEntry', { textValue: '' });
    const assertions = deriveStateAssertions(interaction);
    expect(assertions).toHaveLength(0);
  });

  it('derives no assertion for missing textValue', () => {
    const interaction = makeInteraction('TextEntry', {});
    const assertions = deriveStateAssertions(interaction);
    expect(assertions).toHaveLength(0);
  });
});

// ── Checkbox ───────────────────────────────────────────────────────────

describe('Checkbox assertions', () => {
  it('derives IS_TRUE for checked=true', () => {
    const interaction = makeInteraction('Checkbox', { checked: true });
    const assertions = deriveStateAssertions(interaction);

    expect(assertions).toHaveLength(1);
    expect(assertions[0].type).toBe(ValidationType.PRESENCE);
    expect(assertions[0].comparison).toBe(ValidationComparison.IS_TRUE);
    expect(assertions[0].property).toBe('checked');
  });

  it('derives IS_FALSE for checked=false', () => {
    const interaction = makeInteraction('Checkbox', { checked: false });
    const assertions = deriveStateAssertions(interaction);

    expect(assertions).toHaveLength(1);
    expect(assertions[0].comparison).toBe(ValidationComparison.IS_FALSE);
  });
});

// ── Dropdown ───────────────────────────────────────────────────────────

describe('Dropdown assertions', () => {
  it('derives value assertion from selectedValue', () => {
    const interaction = makeInteraction('CustomDropdown', { selectedValue: 'Premium Economy' });
    const assertions = deriveStateAssertions(interaction);

    expect(assertions).toHaveLength(1);
    expect(assertions[0].expectedValue).toBe('Premium Economy');
  });
});

// ── DatePicker ─────────────────────────────────────────────────────────

describe('DatePicker assertions', () => {
  it('derives value assertion from dateValue', () => {
    const interaction = makeInteraction('DatePicker', { dateValue: '2026-08-15' });
    const assertions = deriveStateAssertions(interaction);

    expect(assertions).toHaveLength(1);
    expect(assertions[0].expectedValue).toBe('2026-08-15');
  });
});

// ── Slider ─────────────────────────────────────────────────────────────

describe('Slider assertions', () => {
  it('derives value assertion from sliderValue', () => {
    const interaction = makeInteraction('Slider', { sliderValue: 75 });
    const assertions = deriveStateAssertions(interaction);

    expect(assertions).toHaveLength(1);
    expect(assertions[0].expectedValue).toBe(75);
  });
});

// ── Navigation ─────────────────────────────────────────────────────────

describe('Navigation assertions', () => {
  it('derives URL assertion for PageNavigation', () => {
    const interaction = makeInteraction('PageNavigation', { url: 'https://app.example.com/dashboard' });
    const assertions = deriveStateAssertions(interaction);

    expect(assertions).toHaveLength(1);
    expect(assertions[0].type).toBe(ValidationType.URL_MATCH);
    expect(assertions[0].expectedValue).toBe('https://app.example.com/dashboard');
  });
});

// ── Configuration Session ─────────────────────────────────────────────

describe('Configuration session assertions', () => {
  it('derives per-field assertions from configuredFields', () => {
    const interaction = makeInteraction('DatePicker', {
      dateValue: '2026-08-15',
      configuredFields: {
        startDate: '2026-08-15',
        endDate: '2026-08-20',
      },
    });
    const assertions = deriveStateAssertions(interaction);

    // 1 from dateValue + 2 from configuredFields
    expect(assertions).toHaveLength(3);
    const fieldProps = assertions.map(a => a.property);
    expect(fieldProps).toContain('value');
    expect(fieldProps).toContain('value.startDate');
    expect(fieldProps).toContain('value.endDate');
  });
});

// ── No Assertions Cases ───────────────────────────────────────────────

describe('no assertion cases', () => {
  it('Click without metadata produces no assertions', () => {
    const interaction = makeInteraction('Click', {});
    const assertions = deriveStateAssertions(interaction);
    expect(assertions).toHaveLength(0);
  });

  it('Hover produces no assertions', () => {
    const interaction = makeInteraction('Hover', {});
    const assertions = deriveStateAssertions(interaction);
    expect(assertions).toHaveLength(0);
  });

  it('Scroll produces no assertions', () => {
    const interaction = makeInteraction('PageScroll', {});
    const assertions = deriveStateAssertions(interaction);
    expect(assertions).toHaveLength(0);
  });
});
