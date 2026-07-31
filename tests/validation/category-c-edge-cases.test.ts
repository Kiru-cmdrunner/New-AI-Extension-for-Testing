/**
 * Category C — Edge Cases
 *
 * Probes boundary conditions and potential failure modes.
 *
 *   C1:  Single-select dropdown WITH Done button
 *   C2:  Checkbox INSIDE dropdown surface
 *   C3:  Radio group INSIDE dropdown surface
 *   C4:  Two separate dropdown sessions (no cross-contamination)
 *   C5:  Text input inside dropdown surface
 *   C6:  Counter with large delta (5 increments)
 *   C7:  Idempotency under re-enrichment
 *   C8:  Empty subActions array
 *   C9:  Only confirm action (no field changes)
 *   C10: Stepper with only minus (negative delta)
 */

import { describe, it, expect } from 'vitest';
import { shouldEnrich, enrichConfigurationSession } from '../../src/enrichment/structural-enrichment';
import { build } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { DropdownSubAction } from '../../src/definitions/dropdown';
import { makeComponentInteraction as makeCI, makeElementIdentity } from '../helpers/component-interaction-fixture';
import { IRAction } from '../../src/domain/execution-ir/types';

// ── Helpers ───────────────────────────────────────────────────────────

function makeInteraction(
  subActions: DropdownSubAction[],
  triggerName = 'Economy',
): ComponentInteraction {
  return makeCI('CustomDropdown', {
    trigger: makeElementIdentity({
      accessibleName: triggerName,
      ariaRole: 'button',
      tag: 'BUTTON',
    }),
    metadata: { subActions, isMultiConfig: true, targetName: triggerName },
  });
}

function buildFromSubActions(subActions: DropdownSubAction[], triggerName = 'Economy') {
  const interaction = enrichConfigurationSession(makeInteraction(subActions, triggerName));
  const input: IRBridgeInput = {
    events: [], interactions: [interaction], understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test' },
    testCaseName: 'test',
  };
  return build(input);
}

// ═══════════════════════════════════════════════════════════════════════
// C1: Single-select dropdown WITH Done button
// ═══════════════════════════════════════════════════════════════════════

describe('C1: Single-select dropdown WITH Done button', () => {
  const subs: DropdownSubAction[] = [
    { action: 'selectOption', label: 'Round Trip', value: 'round-trip' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('shouldEnrich returns true (has confirm action)', () => {
    expect(shouldEnrich(makeInteraction(subs, 'Trip Type'))).toBe(true);
  });

  it('pattern is singleSelect', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Trip Type'));
    expect((r.metadata!.configurationSession as any).pattern).toBe('singleSelect');
  });

  it('has exactly 1 field', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Trip Type'));
    expect((r.metadata!.configurationSession as any).fields).toHaveLength(1);
  });

  it('IR: 2 steps (1 select CLICK + 1 commit CLICK)', () => {
    const plan = buildFromSubActions(subs, 'Trip Type');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].action).toBe(IRAction.CLICK);
    expect(plan.steps[1].action).toBe(IRAction.CLICK);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C2: Checkbox INSIDE dropdown surface
// ═══════════════════════════════════════════════════════════════════════

describe('C2: Checkbox inside dropdown surface', () => {
  const subs: DropdownSubAction[] = [
    { action: 'toggle', label: 'Add Insurance', value: 'checked' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('shouldEnrich returns true', () => {
    expect(shouldEnrich(makeInteraction(subs))).toBe(true);
  });

  it('toggle field normalized to "Insurance"', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(1);
    expect(cs.fields[0].kind).toBe('toggle');
    expect(cs.fields[0].finalValue).toBe('true');
    // normalizeFieldName should strip "Add" from "Add Insurance"
    expect(cs.fields[0].label).toBe('Insurance');
  });

  it('IR: TOGGLE step with input=true', () => {
    const plan = buildFromSubActions(subs);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].action).toBe(IRAction.TOGGLE);
    expect(plan.steps[0].input).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C3: Radio group INSIDE dropdown surface
// ═══════════════════════════════════════════════════════════════════════

describe('C3: Radio group inside dropdown surface', () => {
  const subs: DropdownSubAction[] = [
    { action: 'selectOption', label: 'Premium Economy', value: 'premium' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('produces singleSelect pattern with 1 select field', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.pattern).toBe('singleSelect');
    expect(cs.fields).toHaveLength(1);
    expect(cs.fields[0].kind).toBe('select');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C4: Two separate dropdown sessions (no cross-contamination)
// ═══════════════════════════════════════════════════════════════════════

describe('C4: Two separate dropdown sessions', () => {
  const subsA: DropdownSubAction[] = [
    { action: 'increment', label: 'Adults', value: '2' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];
  const subsB: DropdownSubAction[] = [
    { action: 'selectOption', label: 'Round Trip', value: 'round-trip' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('each interaction enriches independently', () => {
    const rA = enrichConfigurationSession(makeInteraction(subsA, 'Passengers'));
    const rB = enrichConfigurationSession(makeInteraction(subsB, 'Trip Type'));

    const csA = rA.metadata!.configurationSession as any;
    const csB = rB.metadata!.configurationSession as any;

    expect(csA.triggerLabel).toBe('Passengers');
    expect(csB.triggerLabel).toBe('Trip Type');
    expect(csA.fields[0].label).toBe('Adults');
    expect(csB.fields[0].label).toBe('Round Trip');
  });

  it('two enriched interactions produce independent IR plans', () => {
    const ia = enrichConfigurationSession(makeInteraction(subsA, 'Passengers'));
    const ib = enrichConfigurationSession(makeInteraction(subsB, 'Trip Type'));
    const input: IRBridgeInput = {
      events: [], interactions: [ia, ib], understanding: null,
      recordingContext: { startUrl: 'https://example.com', title: 'Test' },
      testCaseName: 'test',
    };
    const plan = build(input);
    // Session A: 1 FILL + 1 CLICK = 2. Session B: 1 CLICK + 1 CLICK = 2. Total = 4.
    expect(plan.steps).toHaveLength(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C5: Text input inside dropdown surface
// ═══════════════════════════════════════════════════════════════════════

describe('C5: Text input inside dropdown surface', () => {
  const subs: DropdownSubAction[] = [
    { action: 'fillInput', label: 'Promo Code', value: 'SAVE50' },
    { action: 'confirm', label: 'Apply', value: undefined },
  ];

  it('produces text field with correct value', () => {
    const r = enrichConfigurationSession(makeInteraction(subs, 'Promotions'));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(1);
    expect(cs.fields[0].kind).toBe('text');
    expect(cs.fields[0].finalValue).toBe('SAVE50');
  });

  it('IR: FILL step with the text value', () => {
    const plan = buildFromSubActions(subs, 'Promotions');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].action).toBe(IRAction.FILL);
    expect(plan.steps[0].input).toBe('SAVE50');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C6: Counter with large delta (5 increments)
// ═══════════════════════════════════════════════════════════════════════

describe('C6: Counter with large delta', () => {
  const subs: DropdownSubAction[] = [
    { action: 'increment', label: 'Adults', value: '2' },
    { action: 'increment', label: 'Adults', value: '3' },
    { action: 'increment', label: 'Adults', value: '4' },
    { action: 'increment', label: 'Adults', value: '5' },
    { action: 'increment', label: 'Adults', value: '6' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('groups all 5 increments into 1 field', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(1);
    expect(cs.fields[0].subActionCount).toBe(5);
  });

  it('delta=5, finalValue=6', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const field = (r.metadata!.configurationSession as any).fields[0];
    expect(field.delta).toBe(5);
    expect(field.finalValue).toBe('6');
  });

  it('IR: single FILL step with final value', () => {
    const plan = buildFromSubActions(subs);
    // 1 FILL + 1 CLICK = 2
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].action).toBe(IRAction.FILL);
    expect(plan.steps[0].input).toBe('6');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C7: Idempotency under re-enrichment
// ═══════════════════════════════════════════════════════════════════════

describe('C7: Idempotency under re-enrichment', () => {
  const subs: DropdownSubAction[] = [
    { action: 'increment', label: 'Adults', value: '2' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('enriching twice produces identical result', () => {
    const first = enrichConfigurationSession(makeInteraction(subs));
    const second = enrichConfigurationSession(first);
    expect(second).toEqual(first);
  });

  it('shouldEnrich returns false on already-enriched', () => {
    const enriched = enrichConfigurationSession(makeInteraction(subs));
    expect(shouldEnrich(enriched)).toBe(false);
  });

  it('no nested configurationSession', () => {
    const first = enrichConfigurationSession(makeInteraction(subs));
    const second = enrichConfigurationSession(first);
    const cs = second.metadata!.configurationSession as any;
    // Should not have a configurationSession INSIDE the configurationSession
    expect(cs.configurationSession).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C8: Empty subActions array
// ═══════════════════════════════════════════════════════════════════════

describe('C8: Empty subActions array', () => {
  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(makeInteraction([]))).toBe(false);
  });

  it('no configurationSession produced', () => {
    const r = enrichConfigurationSession(makeInteraction([]));
    expect(r.metadata?.configurationSession).toBeUndefined();
  });

  it('does not crash on undefined subActions', () => {
    const interaction = {
      ...makeInteraction([]),
      metadata: { targetName: 'X' }, // no subActions at all
    } as unknown as ComponentInteraction;
    expect(() => enrichConfigurationSession(interaction)).not.toThrow();
    expect(shouldEnrich(interaction)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C9: Only confirm action (no field changes)
// ═══════════════════════════════════════════════════════════════════════

describe('C9: Only confirm action (no field changes)', () => {
  const subs: DropdownSubAction[] = [
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('shouldEnrich returns false (single confirm, no fields)', () => {
    expect(shouldEnrich(makeInteraction(subs))).toBe(false);
  });

  it('no configurationSession produced', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    expect(r.metadata?.configurationSession).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// C10: Stepper with only minus (negative delta)
// ═══════════════════════════════════════════════════════════════════════

describe('C10: Stepper with only minus (negative delta)', () => {
  const subs: DropdownSubAction[] = [
    { action: 'decrement', label: 'Adults', value: '0' },
    { action: 'decrement', label: 'Adults', value: '-1' },
    { action: 'confirm', label: 'Done', value: undefined },
  ];

  it('groups decrements into 1 counter field', () => {
    const r = enrichConfigurationSession(makeInteraction(subs));
    const cs = r.metadata!.configurationSession as any;
    expect(cs.fields).toHaveLength(1);
    expect(cs.fields[0].kind).toBe('counter');
    expect(cs.fields[0].delta).toBe(-2);
    expect(cs.fields[0].finalValue).toBe('-1');
  });

  it('IR: FILL with final value -1', () => {
    const plan = buildFromSubActions(subs);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].action).toBe(IRAction.FILL);
    expect(plan.steps[0].input).toBe('-1');
  });
});
