/**
 * Structural Semantic Enrichment — Unit Tests
 *
 * Tests the pure transform: subActions[] → ConfigurationSession
 *
 * Covers:
 *   - Multi-field config (steppers + select + confirm) — Adani One Economy panel
 *   - Single select (simple dropdown) — should NOT enrich
 *   - Filter pattern (multiple selects + apply)
 *   - Toggle batch (checkboxes + confirm)
 *   - Counter delta computation
 *   - Idempotency
 *   - Graceful degradation (empty/missing data)
 *   - Display rendering
 */

import { describe, it, expect } from 'vitest';
import {
  enrichConfigurationSession,
  shouldEnrich,
  renderConfigurationSummary,
  type ConfigurationSession,
  type ConfigurationField,
} from '../../src/enrichment/structural-enrichment';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { DropdownSubAction } from '../../src/definitions/dropdown';

// ── Helpers ───────────────────────────────────────────────────────────

function makeInteraction(
  subActions: DropdownSubAction[],
  metadata?: Record<string, unknown>,
): ComponentInteraction {
  return {
    type: 'CustomDropdown',
    trigger: {
      tagName: 'BUTTON',
      ariaRole: 'button',
      ariaLabel: 'Economy',
      accessibleName: 'Economy',
      inputType: null,
      cssClasses: [],
    } as any,
    target: {
      tagName: 'BUTTON',
      ariaRole: 'button',
      ariaLabel: 'Economy',
      accessibleName: 'Economy',
      inputType: null,
      cssClasses: [],
    } as any,
    eventIds: ['evt-1'],
    metadata: {
      subActions,
      isMultiConfig: true,
      targetName: 'Economy',
      ...metadata,
    },
  } as unknown as ComponentInteraction;
}

// ── shouldEnrich ──────────────────────────────────────────────────────

describe('shouldEnrich', () => {
  it('returns true when has confirm action', () => {
    const interaction = makeInteraction([
      { action: 'selectOption', label: 'Premium Economy', value: 'premium' },
      { action: 'confirm', label: 'Done', value: undefined },
    ]);
    expect(shouldEnrich(interaction)).toBe(true);
  });

  it('returns true when has multiple distinct fields', () => {
    const interaction = makeInteraction([
      { action: 'increment', label: 'Adults', value: '2' },
      { action: 'increment', label: 'Children', value: '1' },
      { action: 'confirm', label: 'Done', value: undefined },
    ]);
    expect(shouldEnrich(interaction)).toBe(true);
  });

  it('returns true for single-select dropdown (field is captured structurally)', () => {
    const interaction = makeInteraction([
      { action: 'selectOption', label: 'Round Trip', value: 'round-trip' },
    ]);
    // Phase 0e: Any Dropdown with at least one field-changing subAction gets
    // enriched — even single-selects. This handles cases where the confirm
    // action (Done button) escapes as a separate interaction on SPA sites.
    expect(shouldEnrich(interaction)).toBe(true);
  });

  it('returns false when no subActions', () => {
    const interaction = makeInteraction([]);
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('returns false when subActions missing', () => {
    const interaction = { ...makeInteraction([]), metadata: {} } as ComponentInteraction;
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('returns false when already enriched (idempotency)', () => {
    const interaction = makeInteraction([
      { action: 'increment', label: 'Adults', value: '2' },
      { action: 'confirm', label: 'Done', value: undefined },
    ]);
    // Enrich once
    const enriched = enrichConfigurationSession(interaction);
    // shouldEnrich should now return false
    expect(shouldEnrich(enriched)).toBe(false);
  });
});

// ── enrichConfigurationSession ────────────────────────────────────────

describe('enrichConfigurationSession', () => {
  describe('multi-field config (Adani One Economy panel)', () => {
    const subActions: DropdownSubAction[] = [
      { action: 'increment', label: 'Adults', value: '2' },
      { action: 'increment', label: 'Children', value: '1' },
      { action: 'selectOption', label: 'Premium Economy', value: 'premium' },
      { action: 'confirm', label: 'Done', value: undefined },
    ];

    it('produces a ConfigurationSession with correct fields', () => {
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata?.configurationSession as ConfigurationSession | undefined;

      expect(session).toBeDefined();
      expect(session!.fields).toHaveLength(3);
    });

    it('classifies counter fields correctly', () => {
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      const adults = session.fields.find(f => f.label === 'Adults');
      expect(adults).toBeDefined();
      expect(adults!.kind).toBe('counter');
      expect(adults!.finalValue).toBe('2');
      expect(adults!.delta).toBe(1); // one increment
    });

    it('classifies select fields correctly', () => {
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      const cabin = session.fields.find(f => f.label === 'Premium Economy');
      expect(cabin).toBeDefined();
      expect(cabin!.kind).toBe('select');
      expect(cabin!.finalValue).toBe('premium');
    });

    it('extracts commit action', () => {
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.commitAction).not.toBeNull();
      expect(session.commitAction!.label).toBe('Done');
      expect(session.commitAction!.action).toBe('confirm');
    });

    it('classifies pattern as multiFieldConfig', () => {
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.pattern).toBe('multiFieldConfig');
    });

    it('sets triggerLabel from targetName metadata', () => {
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.triggerLabel).toBe('Economy');
    });
  });

  describe('counter with multiple increments', () => {
    it('computes delta from multiple increments', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'increment', label: 'Adults', value: '2' },
        { action: 'increment', label: 'Adults', value: '3' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.fields).toHaveLength(1);
      expect(session.fields[0].kind).toBe('counter');
      expect(session.fields[0].delta).toBe(2);
      expect(session.fields[0].finalValue).toBe('3');
    });

    it('handles mixed increment and decrement', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'increment', label: 'Adults', value: '2' },
        { action: 'decrement', label: 'Adults', value: '1' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.fields[0].delta).toBe(0); // +1 -1
      expect(session.fields[0].finalValue).toBe('1');
    });
  });

  describe('filter pattern', () => {
    it('classifies multiple selects + Apply as filterApply', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'selectOption', label: 'Status', value: 'Active' },
        { admin: true, action: 'selectOption', label: 'Department', value: 'Engineering' } as DropdownSubAction,
        { action: 'selectOption', label: 'Location', value: 'Remote' },
        { action: 'confirm', label: 'Apply', value: undefined },
      ];
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.pattern).toBe('filterApply');
      expect(session.fields).toHaveLength(3);
    });
  });

  describe('toggle batch', () => {
    it('classifies multiple toggles + confirm as toggleBatch', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'toggle', label: 'Email Notifications', value: 'checked' },
        { action: 'toggle', label: 'Push Notifications', value: 'checked' },
        { action: 'confirm', label: 'Save', value: undefined },
      ];
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.pattern).toBe('toggleBatch');
      expect(session.fields).toHaveLength(2);
      expect(session.fields[0].kind).toBe('toggle');
      expect(session.fields[0].finalValue).toBe('true');
    });
  });

  describe('single select with confirm', () => {
    it('classifies as singleSelect', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'selectOption', label: 'Round Trip', value: 'round-trip' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.pattern).toBe('singleSelect');
      expect(session.fields).toHaveLength(1);
    });
  });

  describe('uncommitted session', () => {
    it('classifies as uncommitted when no confirm action', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'increment', label: 'Adults', value: '2' },
        { action: 'increment', label: 'Children', value: '1' },
      ];
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.pattern).toBe('uncommitted');
      expect(session.commitAction).toBeNull();
    });
  });

  describe('idempotency', () => {
    it('returns same result when called twice', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'increment', label: 'Adults', value: '2' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const interaction = makeInteraction(subActions);
      const first = enrichConfigurationSession(interaction);
      const second = enrichConfigurationSession(first);

      expect(second).toEqual(first);
    });
  });

  describe('graceful degradation', () => {
    it('returns interaction unchanged when no subActions', () => {
      const interaction = makeInteraction([]);
      const result = enrichConfigurationSession(interaction);
      expect(result.metadata?.configurationSession).toBeUndefined();
    });

    it('returns interaction unchanged when subActions missing', () => {
      const interaction = { ...makeInteraction([]), metadata: { isMultiConfig: true } } as unknown as ComponentInteraction;
      const result = enrichConfigurationSession(interaction);
      expect(result.metadata?.configurationSession).toBeUndefined();
    });

    it('handles toggle value: unchecked → false', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'toggle', label: 'Add Insurance', value: 'unchecked' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.fields[0].kind).toBe('toggle');
      expect(session.fields[0].finalValue).toBe('false');
    });
  });

  describe('field normalization', () => {
    it('strips action verbs from stepper labels', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'increment', label: 'Increase adults', value: '2' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.fields[0].label).toBe('Adults');
    });

    it('strips "Add" from labels correctly', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'toggle', label: 'Add insurance', value: 'checked' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const result = enrichConfigurationSession(makeInteraction(subActions));
      const session = result.metadata!.configurationSession as ConfigurationSession;

      expect(session.fields[0].label).toBe('Insurance');
    });
  });
});

// ── renderConfigurationSummary ────────────────────────────────────────

describe('renderConfigurationSummary', () => {
  it('renders multi-field config summary', () => {
    const session: ConfigurationSession = {
      triggerLabel: 'Economy',
      pattern: 'multiFieldConfig',
      commitAction: { action: 'confirm', label: 'Done', value: undefined },
      rawInteractionType: 'CustomDropdown',
      fields: [
        { label: 'Adults', kind: 'counter', finalValue: '2', delta: 1, subActionCount: 1, evidence: [] },
        { label: 'Children', kind: 'counter', finalValue: '1', delta: 1, subActionCount: 1, evidence: [] },
        { label: 'Premium Economy', kind: 'select', finalValue: 'premium', subActionCount: 1, evidence: [] },
      ],
    };
    const summary = renderConfigurationSummary(session);
    expect(summary).toBe('Configure Economy: Adults=2, Children=1, Premium Economy=premium');
  });

  it('renders uncommitted session with suffix', () => {
    const session: ConfigurationSession = {
      triggerLabel: 'Filters',
      pattern: 'uncommitted',
      commitAction: null,
      rawInteractionType: 'CustomDropdown',
      fields: [
        { label: 'Status', kind: 'select', finalValue: 'Active', subActionCount: 1, evidence: [] },
      ],
    };
    const summary = renderConfigurationSummary(session);
    expect(summary).toBe('Changed Filters: Status=Active (not confirmed)');
  });

  it('renders toggle fields as on/off', () => {
    const session: ConfigurationSession = {
      triggerLabel: 'Settings',
      pattern: 'toggleBatch',
      commitAction: { action: 'confirm', label: 'Save', value: undefined },
      rawInteractionType: 'CustomDropdown',
      fields: [
        { label: 'Notifications', kind: 'toggle', finalValue: 'true', subActionCount: 1, evidence: [] },
        { label: 'Newsletter', kind: 'toggle', finalValue: 'false', subActionCount: 1, evidence: crossSource },
      ],
    };
    const summary = renderConfigurationSummary(session);
    expect(summary).toBe('Configure Settings: Notifications=on, Newsletter=off');
  });

  it('renders counter fields with delta when no finalValue', () => {
    const session: ConfigurationSession = {
      triggerLabel: 'Passengers',
      pattern: 'multiFieldConfig',
      commitAction: { action: 'confirm', label: 'Done', value: undefined },
      rawInteractionType: 'CustomDropdown',
      fields: [
        { label: 'Adults', kind: 'counter', finalValue: '', delta: 2, subActionCount: 2, evidence: [] },
      ],
    };
    const summary = renderConfigurationSummary(session);
    expect(summary).toBe('Configure Passengers: Adults=+2');
  });
});

const crossSource: DropdownSubAction[] = [];
