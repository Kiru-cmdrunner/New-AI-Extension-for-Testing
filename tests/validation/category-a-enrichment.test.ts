/**
 * Category A — Should Enrich (ConfigurationSession Expected)
 *
 * Verifies that multi-field configuration patterns produce the correct
 * ConfigurationSession and field-based IR steps.
 *
 * Patterns tested:
 *   A1: Multi-config (Steppers + Select + Confirm) — Adani One Economy
 *   A2: Filter panel (Multiple Selects + Apply)
 *   A3: Toggle batch (Multiple Checkboxes + Save)
 *   A4: Search submit (Text Input + Search button)
 *   A5: Mixed (Counter + Toggle + Select + Done)
 *   A6: Counter with decrement
 *   A7: Uncommitted (multi-field changes, no confirm)
 */

import { describe, it, expect } from 'vitest';
import { shouldEnrich, enrichConfigurationSession } from '../../src/enrichment/structural-enrichment';
import { build } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { DropdownSubAction } from '../../src/definitions/dropdown';
import type { SessionEvent } from '../../src/shared/types';
import { IRAction } from '../../src/domain/execution-ir/types';

// ── Helpers ───────────────────────────────────────────────────────────

function makeTarget(name: string, tag = 'BUTTON', role = 'button'): any {
  return {
    tagName: tag, ariaRole: role, ariaLabel: name, accessibleName: name,
    inputType: null, cssClasses: [],
    elementId: `elem-${name.toLowerCase().replace(/\s+/g, '-')}`,
  };
}

function makeInteraction(
  subActions: DropdownSubAction[],
  triggerName = 'Economy',
): ComponentInteraction {
  return {
    type: 'Dropdown',
    trigger: makeTarget(triggerName),
    target: makeTarget(triggerName),
    eventIds: subActions.map((_, i) => `evt-${i + 1}`),
    metadata: { subActions, isMultiConfig: true, targetName: triggerName },
  } as unknown as ComponentInteraction;
}

function makeEvent(actionId: string, name: string): SessionEvent {
  return {
    actionId, timestamp: Date.now() + Math.random(),
    action: 'click', target: makeTarget(name),
    valueBefore: null, valueAfter: null, modifierKeys: [],
    url: 'https://example.com', timestampISO: new Date().toISOString(),
  } as unknown as SessionEvent;
}

function buildFromSubActions(subActions: DropdownSubAction[], triggerName = 'Economy') {
  const interaction = enrichConfigurationSession(makeInteraction(subActions, triggerName));
  const events = subActions.map((s, i) => makeEvent(`evt-${i + 1}`, s.label));
  const input: IRBridgeInput = {
    events, interactions: [interaction], understanding: null,
    recordingContext: { startUrl: 'https://example.com', pageTitle: 'Test' },
    testCaseName: 'test',
  };
  return build(input);
}

function getField(session: any, label: string) {
  return session.fields.find((f: any) => f.label === label);
}

// ═══════════════════════════════════════════════════════════════════════
// A1: Multi-config (Steppers + Select + Confirm)
// ═══════════════════════════════════════════════════════════════════════

describe('A1: Multi-config (Steppers + Select + Confirm)', () => {
  const subs: DropdownSubAction[] = [
    { action: 'increment', label: 'Adults', value: '2' },
    { action: 'increment', label: 'Children', value: '1' },
    { action: 'selectOption', label: 'Premium Economy', value: 'premium' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('shouldEnrich returns true', () => {
    expect(shouldEnrich(makeInteraction(subs))).toBe(true);
  });

  it('ConfigurationSession has correct pattern', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    expect((r.metadata!.configurationSession as any).pattern).toBe('multiFieldConfig');
  });

  it('has 3 fields (2 counters + 1 select)', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(3);
  });

  it('Adults field is counter with delta=1, finalValue=2', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const adults = getField(r.metadata!.configurationSession, 'Adults');
    expect(adults.kind).toBe('counter');
    expect(adults.finalValue).toBe('2');
    expect(adults.delta).toBe(1);
  });

  it('Premium Economy field is select with finalValue=premium', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const cabin = getField(r.metadata!.configurationSession, 'Premium Economy');
    expect(cabin.kind).toBe('select');
    expect(cabin.finalValue).toBe('premium');
  });

  it('commitAction is Done', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.commitAction.label).toBe('Done');
  });

  it('IR: 4 steps (3 fields + 1 commit)', () => {
    const plan = buildFromSubActions(subs);
    expect(plan.steps).toHaveLength(4);
  });

  it('IR: counter steps are FILL', () => {
    const plan = buildFromSubActions(subs);
    const fillSteps = plan.steps.filter(s => s.action === IRAction.FILL);
    expect(fillSteps).toHaveLength(2);
  });

  it('IR: select step is CLICK', () => {
    const plan = buildFromSubActions(subs);
    const clickSteps = plan.steps.filter(s => s.action === IRAction.CLICK);
    // 1 for select + 1 for commit = 2
    expect(clickSteps).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// A2: Filter panel (Multiple Selects + Apply)
// ═══════════════════════════════════════════════════════════════════════

describe('A2: Filter panel (Multiple Selects + Apply)', () => {
  const subs: DropdownSubAction[] = [
    { action: 'selectOption', label: 'Status', value: 'Active' },
    { action: 'selectOption', label: 'Department', value: 'Engineering' },
    { action: 'selectOption', label: 'Location', value: 'Remote' },
    { action: 'confirm', label: 'Apply', value: undefined },
  ];

  it('shouldEnrich returns true', () => {
    expect(shouldEnrich(makeInteraction(subs, 'Filters'))).toBe(true);
  });

  it('pattern is filterApply', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Filters'));
    expect((r.metadata!.configurationSession as any).pattern).toBe('filterApply');
  });

  it('has 3 select fields', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Filters'));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(3);
    expect(cs.fields.every((f: any) => f.kind === 'select')).toBe(true);
  });

  it('commitAction is Apply', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Filters'));
    expect((r.metadata!.configurationSession as any).commitAction.label).toBe('Apply');
  });

  it('IR: 4 steps (3 selects + 1 commit)', () => {
    const plan = buildFromSubActions(subs, 'Filters');
    expect(plan.steps).toHaveLength(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// A3: Toggle batch (Multiple Checkboxes + Save)
// ═══════════════════════════════════════════════════════════════════════

describe('A3: Toggle batch (Multiple Checkboxes + Save)', () => {
  const subs: DropdownSubAction[] = [
    { action: 'toggle', label: 'Email Notifications', value: 'checked' },
    { action: 'toggle', label: 'Push Notifications', value: 'unchecked' },
    { action: 'confirm', label: 'Save', value: undefined },
  ];

  it('shouldEnrich returns true', () => {
    expect(shouldEnrich(makeInteraction(subs, 'Settings'))).toBe(true);
  });

  it('pattern is toggleBatch', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Settings'));
    expect((r.metadata!.configurationSession as any).pattern).toBe('toggleBatch');
  });

  it('has 2 toggle fields', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Settings'));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(2);
    expect(cs.fields.every((f: any) => f.kind === 'toggle')).toBe(true);
  });

  it('Email field is true, Push field is false', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Settings'));
    const cs = r.metadata!.configurationSession as any;
    expect(getField(cs, 'Email Notifications').finalValue).toBe('true');
    expect(getField(cs, 'Push Notifications').finalValue).toBe('false');
  });

  it('IR: toggle steps produce TOGGLE actions', () => {
    const plan = buildFromSubActions(subs, 'Settings');
    const toggles = plan.steps.filter(s => s.action === IRAction.TOGGLE);
    expect(toggles).toHaveLength(2);
    // First is checked→true, second is unchecked→false
    expect(toggles[0].input).toBe(true);
    expect(toggles[1].input).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// A4: Search submit (Text Input + Search button)
// ═══════════════════════════════════════════════════════════════════════

describe('A4: Search submit (Text Input + Search button)', () => {
  const subs: DropdownSubAction[] = [
    { action: 'fillInput', label: 'Search flights', value: 'Bangalore to Chennai' },
    { action: 'confirm', label: 'Search', value: undefined },
  ];

  it('shouldEnrich returns true', () => {
    expect(shouldEnrich(makeInteraction(subs, 'Search'))).toBe(true);
  });

  it('has 1 text field', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Search'));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(1);
    expect(cs.fields[0].kind).toBe('text');
    expect(cs.fields[0].finalValue).toBe('Bangalore to Chennai');
  });

  it('IR: FILL for text + CLICK for commit', () => {
    const plan = buildFromSubActions(subs, 'Search');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].action).toBe(IRAction.FILL);
    expect(plan.steps[0].input).toBe('Bangalore to Chennai');
    expect(plan.steps[1].action).toBe(IRAction.CLICK);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// A5: Mixed (Counter + Toggle + Select + Done)
// ═══════════════════════════════════════════════════════════════════════

describe('A5: Mixed (Counter + Toggle + Select + Done)', () => {
  const subs: DropdownSubAction[] = [
    { action: 'increment', label: 'Adults', value: '2' },
    { action: 'toggle', label: 'Add Insurance', value: 'checked' },
    { action: 'selectOption', label: 'Premium Economy', value: 'premium' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('shouldEnrich returns true', () => {
    expect(shouldEnrich(makeInteraction(subs))).toBe(true);
  });

  it('pattern is multiFieldConfig', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    expect((r.metadata!.configurationSession as any).pattern).toBe('multiFieldConfig');
  });

  it('has 3 fields with mixed kinds', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(3);
    const kinds = cs.fields.map((f: any) => f.kind);
    expect(kinds).toContain('counter');
    expect(kinds).toContain('toggle');
    expect(kinds).toContain('select');
  });

  it('IR: FILL + TOGGLE + CLICK + CLICK(commit) = 4 steps', () => {
    const plan = buildFromSubActions(subs);
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0].action).toBe(IRAction.FILL);       // counter
    expect(plan.steps[1].action).toBe(IRAction.TOGGLE);     // toggle
    expect(plan.steps[2].action).toBe(IRAction.CLICK);      // select
    expect(plan.steps[3].action).toBe(IRAction.CLICK);      // commit
  });
});

// ═══════════════════════════════════════════════════════════════════════
// A6: Counter with decrement
// ═══════════════════════════════════════════════════════════════════════

describe('A6: Counter with decrement', () => {
  const subs: DropdownSubAction[] = [
    { action: 'increment', label: 'Adults', value: '3' },
    { action: 'decrement', label: 'Adults', value: '2' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('shouldEnrich returns true', () => {
    expect(shouldEnrich(makeInteraction(subs))).toBe(true);
  });

  it('single field Adults with delta=0, finalValue=2', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(1);
    expect(cs.fields[0].kind).toBe('counter');
    expect(cs.fields[0].delta).toBe(0); // +1 -1
    expect(cs.fields[0].finalValue).toBe('2');
  });

  it('IR: FILL with final value 2', () => {
    const plan = buildFromSubActions(subs);
    expect(plan.steps).toHaveLength(2); // 1 field + 1 commit
    expect(plan.steps[0].action).toBe(IRAction.FILL);
    expect(plan.steps[0].input).toBe('2');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// A7: Uncommitted (multi-field changes, no confirm)
// ═══════════════════════════════════════════════════════════════════════

describe('A7: Uncommitted (multi-field changes, no confirm)', () => {
  const subs: DropdownSubAction[] = [
    { action: 'increment', label: 'Adults', value: '2' },
    { action: 'increment', label: 'Children', value: '1' },
    // No confirm/Done clicked
  ];

  it('shouldEnrich returns true (>1 distinct field)', () => {
    expect(shouldEnrich(makeInteraction(subs))).toBe(true);
  });

  it('pattern is uncommitted', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    expect((r.metadata!.configurationSession as any).pattern).toBe('uncommitted');
  });

  it('commitAction is null', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    expect((r.metadata!.configurationSession as any).commitAction).toBeNull();
  });

  it('IR: 2 FILL steps, no commit step', () => {
    const plan = buildFromSubActions(subs);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps.every(s => s.action === IRAction.FILL)).toBe(true);
  });
});
