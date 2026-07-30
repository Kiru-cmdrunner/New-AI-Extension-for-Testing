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
    expect(summary).toBe('Configure Economy: Adults=2, Children=1, Premium Economy=premium, Done');
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
    expect(summary).toBe('Change Filters: Status=Active (not confirmed)');
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
    expect(summary).toBe('Configure Settings: Notifications=on, Newsletter=off, Save');
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
    // Counter fields render as "FieldName +N" (not "FieldName=+N")
    expect(summary).toBe('Configure Passengers: Adults +2, Done');
  });
});

// ── Bare +/- label handling and counter grouping ─────────────────────

describe('Stepper label normalization and counter grouping', () => {
  it('normalizes bare + label to Counter field name', () => {
    const subActions: DropdownSubAction[] = [
      { action: 'increment', label: '+', value: '2', target: { elementId: 'el-1', cssSelector: 'button.plus' } as any },
    ];
    const interaction = makeInteraction(subActions, { targetName: '1Economy' });
    const enriched = enrichConfigurationSession(interaction);
    const cs = enriched.metadata!.configurationSession as ConfigurationSession;
    expect(cs.fields.length).toBe(1);
    expect(cs.fields[0].kind).toBe('counter');
    expect(cs.fields[0].delta).toBe(1);
  });

  it('separates 3 stepper buttons with bare + label by elementId', () => {
    // Simulates AdaniOne: 3 different + buttons (Adults/Children/Infants),
    // all labeled "+" but with different elementIds and CSS selectors
    const subActions: DropdownSubAction[] = [
      { action: 'increment', label: '+', value: '', target: { elementId: 'el-a', cssSelector: 'button.plus-adults', className: 'plus-icon' } as any },
      { action: 'increment', label: '+', value: '', target: { elementId: 'el-b', cssSelector: 'button.plus-children', className: 'plus-icon' } as any },
      { action: 'increment', label: '+', value: '', target: { elementId: 'el-c', cssSelector: 'button.plus-infants', className: 'plus-icon' } as any },
      { action: 'selectOption', label: 'Premium Economy', value: 'Premium Economy', target: { elementId: 'el-pe' } as any },
      { action: 'confirm', label: 'Done', value: undefined, target: { elementId: 'el-d' } as any },
    ];
    const interaction = makeInteraction(subActions, { targetName: '1Economy' });
    const enriched = enrichConfigurationSession(interaction);
    const cs = enriched.metadata!.configurationSession as ConfigurationSession;

    // Should have 3 separate counter fields + 1 select field (NOT one merged counter +3)
    const counterFields = cs.fields.filter(f => f.kind === 'counter');
    expect(counterFields.length).toBe(3);
    expect(counterFields.every(f => f.delta === 1)).toBe(true);

    // Each counter should have inferred name from CSS selector
    expect(counterFields.some(f => f.label === 'Adults')).toBe(true);
    expect(counterFields.some(f => f.label === 'Children')).toBe(true);
    expect(counterFields.some(f => f.label === 'Infants')).toBe(true);

    // Select field for Premium Economy
    const selectFields = cs.fields.filter(f => f.kind === 'select');
    expect(selectFields.length).toBe(1);
    expect(selectFields[0].label).toBe('Premium Economy');

    // Commit action preserved
    expect(cs.commitAction).not.toBeNull();
    expect(cs.commitAction!.label).toBe('Done');
  });

  it('renders the full AdaniOne-style session summary with Done', () => {
    const subActions: DropdownSubAction[] = [
      { action: 'increment', label: '+', value: '', target: { elementId: 'el-a', cssSelector: 'button.plus-adults' } as any },
      { action: 'increment', label: '+', value: '', target: { elementId: 'el-b', cssSelector: 'button.plus-children' } as any },
      { action: 'increment', label: '+', value: '', target: { elementId: 'el-c', cssSelector: 'button.plus-infants' } as any },
      { action: 'selectOption', label: 'Premium Economy', value: 'Premium Economy', target: { elementId: 'el-pe' } as any },
      { action: 'confirm', label: 'Done', value: undefined, target: { elementId: 'el-d' } as any },
    ];
    const interaction = makeInteraction(subActions, { targetName: '1Economy' });
    const enriched = enrichConfigurationSession(interaction);
    const cs = enriched.metadata!.configurationSession as ConfigurationSession;
    const summary = renderConfigurationSummary(cs);

    // Trigger label "1Economy" is normalized to "Economy"
    expect(summary).toContain('Configure Economy:');
    expect(summary).toContain('Adults +1');
    expect(summary).toContain('Children +1');
    expect(summary).toContain('Infants +1');
    // Label=value dedup: "Premium Economy=Premium Economy" → just "Premium Economy"
    expect(summary).toContain('Premium Economy');
    expect(summary).not.toContain('Premium Economy=Premium Economy');
    expect(summary).toContain('Done');
  });

  it('does NOT merge descriptive counter labels (Adults vs Children)', () => {
    const subActions: DropdownSubAction[] = [
      { action: 'increment', label: 'Adults', value: '2', target: { elementId: 'el-a' } as any },
      { action: 'increment', label: 'Children', value: '1', target: { elementId: 'el-b' } as any },
      { action: 'confirm', label: 'Done', value: undefined, target: { elementId: 'el-d' } as any },
    ];
    const interaction = makeInteraction(subActions, { targetName: 'Pax' });
    const enriched = enrichConfigurationSession(interaction);
    const cs = enriched.metadata!.configurationSession as ConfigurationSession;
    // Two separate fields, not merged
    expect(cs.fields.length).toBe(2);
    expect(cs.fields[0].label).toBe('Adults');
    expect(cs.fields[1].label).toBe('Children');
  });

  it('separates counters with no CSS keywords into Passenger 1, 2, 3', () => {
    // Simulates the stripped subActions as they come from buildResult,
    // where the CSS selector has no "adults"/"children" keywords (common
    // on AdaniOne where buttons are generic icons with no contextual class)
    const interaction = makeInteraction([], { targetName: '1Economy' });
    (interaction as any).metadata.subActions = [
      { action: 'increment', label: '+', value: '', targetElementId: 'el-a', targetCssSelector: 'div.panel > button.icon-btn', targetClassName: 'icon-btn' },
      { action: 'increment', label: '+', value: '', targetElementId: 'el-b', targetCssSelector: 'div.panel > button.icon-btn', targetClassName: 'icon-btn' },
      { action: 'increment', label: '+', value: '', targetElementId: 'el-c', targetCssSelector: 'div.panel > button.icon-btn', targetClassName: 'icon-btn' },
      { action: 'selectOption', label: 'Premium Economy', value: 'Premium Economy' },
      { action: 'confirm', label: 'Done', value: undefined },
    ];
    const enriched = enrichConfigurationSession(interaction);
    const cs = enriched.metadata!.configurationSession as ConfigurationSession;

    // 3 separate counter fields (NOT merged into one "Counter +3")
    const counterFields = cs.fields.filter(f => f.kind === 'counter');
    expect(counterFields.length).toBe(3);
    expect(counterFields.every(f => f.delta === 1)).toBe(true);

    // Sequential naming: Passenger 1, Passenger 2, Passenger 3
    expect(counterFields[0].label).toBe('Passenger 1');
    expect(counterFields[1].label).toBe('Passenger 2');
    expect(counterFields[2].label).toBe('Passenger 3');

    // Verify the summary includes all of them + Done
    const summary = renderConfigurationSummary(cs);
    expect(summary).toContain('Passenger 1 +1');
    expect(summary).toContain('Passenger 2 +1');
    expect(summary).toContain('Passenger 3 +1');
    expect(summary).toContain('Done');
  });
});

// ── Pattern-Aware Rendering Tests ─────────────────────────────────────

describe('Pattern-aware rendering (generic, application-independent)', () => {

  describe('singleSelect pattern', () => {
    it('renders as: Select "Value" from Target', () => {
      const session: ConfigurationSession = {
        triggerLabel: 'Economy',
        pattern: 'singleSelect',
        commitAction: null,
        rawInteractionType: 'Dropdown',
        fields: [
          { label: 'Premium Economy', kind: 'select', finalValue: 'Premium Economy', subActionCount: 1, evidence: [] },
        ],
      };
      const summary = renderConfigurationSummary(session);
      expect(summary).toBe('Select Premium Economy from Economy');
    });

    it('renders singleSelect with Done', () => {
      const session: ConfigurationSession = {
        triggerLabel: 'Country',
        pattern: 'singleSelect',
        commitAction: { action: 'confirm', label: 'Done', value: undefined } as any,
        rawInteractionType: 'Dropdown',
        fields: [
          { label: 'United States', kind: 'select', finalValue: 'United States', subActionCount: 1, evidence: [] },
        ],
      };
      const summary = renderConfigurationSummary(session);
      expect(summary).toBe('Select United States from Country, Done');
    });
  });

  describe('multiFieldConfig pattern', () => {
    it('renders counters with finalValue as Field=N', () => {
      const session: ConfigurationSession = {
        triggerLabel: 'Passengers',
        pattern: 'multiFieldConfig',
        commitAction: { action: 'confirm', label: 'Done', value: undefined } as any,
        rawInteractionType: 'Dropdown',
        fields: [
          { label: 'Adults', kind: 'counter', finalValue: '2', delta: 1, subActionCount: 1, evidence: [] },
          { label: 'Children', kind: 'counter', finalValue: '1', delta: 1, subActionCount: 1, evidence: [] },
        ],
      };
      const summary = renderConfigurationSummary(session);
      expect(summary).toBe('Configure Passengers: Adults=2, Children=1, Done');
    });

    it('renders counters without finalValue as Field +N', () => {
      const session: ConfigurationSession = {
        triggerLabel: 'Passengers',
        pattern: 'multiFieldConfig',
        commitAction: { action: 'confirm', label: 'Done', value: undefined } as any,
        rawInteractionType: 'Dropdown',
        fields: [
          { label: 'Adults', kind: 'counter', finalValue: '', delta: 2, subActionCount: 2, evidence: [] },
        ],
      };
      const summary = renderConfigurationSummary(session);
      expect(summary).toBe('Configure Passengers: Adults +2, Done');
    });

    it('renders mixed counters and selects', () => {
      const session: ConfigurationSession = {
        triggerLabel: '1Economy',
        pattern: 'multiFieldConfig',
        commitAction: { action: 'confirm', label: 'Done', value: undefined } as any,
        rawInteractionType: 'Dropdown',
        fields: [
          { label: 'Adults', kind: 'counter', finalValue: '', delta: 1, subActionCount: 1, evidence: [] },
          { label: 'Premium Economy', kind: 'select', finalValue: 'Premium Economy', subActionCount: 1, evidence: [] },
        ],
      };
      const summary = renderConfigurationSummary(session);
      // Trigger "1Economy" → "Economy", select value deduplicated
      expect(summary).toBe('Configure Economy: Adults +1, Premium Economy, Done');
    });
  });

  describe('filterApply pattern', () => {
    it('renders as: Filter Target: field=value, Apply', () => {
      const session: ConfigurationSession = {
        triggerLabel: 'Results',
        pattern: 'filterApply',
        commitAction: { action: 'confirm', label: 'Apply', value: undefined } as any,
        rawInteractionType: 'Dropdown',
        fields: [
          { label: 'Star Rating', kind: 'select', finalValue: '4', subActionCount: 1, evidence: [] },
          { label: 'Price', kind: 'select', finalValue: 'Low to High', subActionCount: 1, evidence: [] },
        ],
      };
      const summary = renderConfigurationSummary(session);
      expect(summary).toBe('Filter Results: Star Rating=4, Price=Low to High, Apply');
    });
  });

  describe('searchSubmit pattern', () => {
    it('renders as: Search Target: "query", Search', () => {
      const session: ConfigurationSession = {
        triggerLabel: 'Flights',
        pattern: 'searchSubmit',
        commitAction: { action: 'confirm', label: 'Search', value: undefined } as any,
        rawInteractionType: 'Dropdown',
        fields: [
          { label: 'Search', kind: 'text', finalValue: 'new york', subActionCount: 1, evidence: [] },
        ],
      };
      const summary = renderConfigurationSummary(session);
      expect(summary).toBe('Search Flights: "new york", Search');
    });
  });

  describe('toggleBatch pattern', () => {
    it('renders toggles as Field=on/off', () => {
      const session: ConfigurationSession = {
        triggerLabel: 'Settings',
        pattern: 'toggleBatch',
        commitAction: { action: 'confirm', label: 'Save', value: undefined } as any,
        rawInteractionType: 'Dropdown',
        fields: [
          { label: 'Notifications', kind: 'toggle', finalValue: 'true', subActionCount: 1, evidence: [] },
          { label: 'Newsletter', kind: 'toggle', finalValue: 'false', subActionCount: 1, evidence: [] },
        ],
      };
      const summary = renderConfigurationSummary(session);
      expect(summary).toBe('Configure Settings: Notifications=on, Newsletter=off, Save');
    });
  });

  describe('uncommitted pattern', () => {
    it('renders with (not confirmed) suffix', () => {
      const session: ConfigurationSession = {
        triggerLabel: 'Sort',
        pattern: 'uncommitted',
        commitAction: null,
        rawInteractionType: 'Dropdown',
        fields: [
          { label: 'Sort Order', kind: 'select', finalValue: 'Relevance', subActionCount: 1, evidence: [] },
        ],
      };
      const summary = renderConfigurationSummary(session);
      expect(summary).toBe('Change Sort: Sort Order=Relevance (not confirmed)');
    });
  });
});

// ── Trigger Label Normalization Tests ─────────────────────────────────

describe('Trigger label normalization (normalizeTriggerLabel)', () => {
  // Test via renderConfigurationSummary since the function is applied there
  it('strips leading digit: "1Economy" → "Economy"', () => {
    const session: ConfigurationSession = {
      triggerLabel: '1Economy',
      pattern: 'singleSelect',
      commitAction: null,
      rawInteractionType: 'Dropdown',
      fields: [{ label: 'Premium Economy', kind: 'select', finalValue: 'Premium Economy', subActionCount: 1, evidence: [] }],
    };
    expect(renderConfigurationSummary(session)).toContain('from Economy');
  });

  it('strips leading digit with separator: "3 · Passengers" → "Passengers"', () => {
    const session: ConfigurationSession = {
      triggerLabel: '3 · Passengers',
      pattern: 'multiFieldConfig',
      commitAction: { action: 'confirm', label: 'Done', value: undefined } as any,
      rawInteractionType: 'Dropdown',
      fields: [{ label: 'Adults', kind: 'counter', finalValue: '2', delta: 1, subActionCount: 1, evidence: [] }],
    };
    expect(renderConfigurationSummary(session)).toContain('Configure Passengers:');
  });

  it('strips trailing parenthetical: "Sort (Relevance)" → "Sort"', () => {
    const session: ConfigurationSession = {
      triggerLabel: 'Sort (Relevance)',
      pattern: 'singleSelect',
      commitAction: null,
      rawInteractionType: 'Dropdown',
      fields: [{ label: 'Relevance', kind: 'select', finalValue: 'Relevance', subActionCount: 1, evidence: [] }],
    };
    expect(renderConfigurationSummary(session)).toContain('from Sort');
  });

  it('preserves clean labels as-is', () => {
    const session: ConfigurationSession = {
      triggerLabel: 'Economy Class',
      pattern: 'singleSelect',
      commitAction: null,
      rawInteractionType: 'Dropdown',
      fields: [{ label: 'Business', kind: 'select', finalValue: 'Business', subActionCount: 1, evidence: [] }],
    };
    expect(renderConfigurationSummary(session)).toContain('from Economy Class');
  });
});

const crossSource: DropdownSubAction[] = [];
