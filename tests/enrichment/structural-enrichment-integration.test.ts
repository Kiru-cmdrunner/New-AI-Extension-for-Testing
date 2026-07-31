/**
 * Structural Semantic Enrichment — Integration Tests
 *
 * Tests the end-to-end pipeline from subActions → IR steps:
 *   1. ComponentInteraction with subActions → enrichConfigurationSession
 *   2. enriched interaction → IR Bridge build() → field-based IR steps
 *   3. Verify each field kind produces the correct IRAction
 *
 * This validates Phase 0e end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { enrichConfigurationSession } from '../../src/enrichment/structural-enrichment';
import { build } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { DropdownSubAction } from '../../src/definitions/dropdown';
import { makeComponentInteraction as makeCI, makeElementIdentity } from '../helpers/component-interaction-fixture';
import { IRAction } from '../../src/domain/execution-ir/types';

// ── Helpers ───────────────────────────────────────────────────────────

function makeInteraction(
  subActions: DropdownSubAction[],
): ComponentInteraction {
  return makeCI('CustomDropdown', {
    trigger: makeElementIdentity({
      accessibleName: 'Economy',
      ariaRole: 'button',
      tag: 'BUTTON',
    }),
    metadata: {
      subActions,
      isMultiConfig: true,
      targetName: 'Economy',
    },
  });
}

function buildPlanFromSubActions(
  subActions: DropdownSubAction[],
): ReturnType<typeof build> {
  // Step 1: Enrich the interaction with ConfigurationSession
  const interaction = enrichConfigurationSession(makeInteraction(subActions));

  // Step 2: Build IR plan
  const input: IRBridgeInput = {
    events: [],
    interactions: [interaction],
    understanding: null,
    recordingContext: {
      startUrl: 'https://example.com',
      title: 'Test Page',
    },
    testCaseName: 'test-case',
  };

  return build(input);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('IR Bridge: configurationSession field-based expansion', () => {
  describe('multi-field config (Adani One Economy panel)', () => {
    const subActions: DropdownSubAction[] = [
      { action: 'increment', label: 'Adults', value: '2' },
      { action: 'increment', label: 'Children', value: '1' },
      { action: 'selectOption', label: 'Premium Economy', value: 'premium' },
      { action: 'confirm', label: 'Done', value: undefined },
    ];

    it('generates one IR step per field + one commit step', () => {
      const plan = buildPlanFromSubActions(subActions);
      const steps = plan.steps;

      // 3 fields + 1 commit = 4 steps
      expect(steps.length).toBe(4);
    });

    it('generates FILL for counter fields', () => {
      const plan = buildPlanFromSubActions(subActions);
      const adultsStep = plan.steps.find(s => s.plainEnglish?.includes('Adults'));

      expect(adultsStep).toBeDefined();
      expect(adultsStep!.action).toBe(IRAction.FILL);
      expect(adultsStep!.input).toBe('2');
    });

    it('generates CLICK for select fields', () => {
      const plan = buildPlanFromSubActions(subActions);
      const cabinStep = plan.steps.find(s => s.plainEnglish?.includes('premium'));

      expect(cabinStep).toBeDefined();
      expect(cabinStep!.action).toBe(IRAction.CLICK);
      expect(cabinStep!.input).toBe('premium');
    });

    it('generated CLICK for commit action', () => buttonCommitTest());
    it('orders steps correctly: fields first, commit last', () => orderTest());

    function buttonCommitTest() {
      const plan = buildPlanFromSubActions(subActions);
      const commitStep = plan.steps[plan.steps.length - 1];

      expect(commitStep.action).toBe(IRAction.CLICK);
      expect(commitStep.plainEnglish).toContain('Confirm');
    }

    function orderTest() {
      const plan = buildPlanFromSubActions(subActions);

      expect(plan.steps[0].plainEnglish).toContain('Adults');
      expect(plan.steps[1].plainEnglish).toContain('Children');
      expect(plan.steps[2].plainEnglish).toContain('premium');
      expect(plan.steps[3].plainEnglish).toContain('Confirm');
    }
  });

  describe('toggle field', () => {
    it('generates TOGGLE with boolean input for checked', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'toggle', label: 'Add Insurance', value: 'checked' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const plan = buildPlanFromSubActions(subActions);
      const toggleStep = plan.steps.find(s => s.plainEnglish?.includes('Insurance'));

      expect(toggleStep).toBeDefined();
      expect(toggleStep!.action).toBe(IRAction.TOGGLE);
      expect(toggleStep!.input).toBe(true);
    });

    it('generates TOGGLE false for unchecked', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'toggle', label: 'Newsletter', value: 'unchecked' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const plan = buildPlanFromSubActions(subActions);
      const toggleStep = plan.steps.find(s => s.plainEnglish?.includes('Newsletter'));

      expect(toggleStep).toBeDefined();
      expect(toggleStep!.action).toBe(IRAction.TOGGLE);
      expect(toggleStep!.input).toBe(false);
    });
  });

  describe('text input field', () => {
    it('generates FILL for text input', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'fillInput', label: 'Search flights', value: 'Bangalore to Chennai' },
        { action: 'confirm', label: 'Search', value: undefined },
      ];
      const plan = buildPlanFromSubSubActions(subActions);
      const textStep = plan.steps.find(s => s.plainEnglish?.includes('Search flights'));

      expect(textStep).toBeDefined();
      expect(textStep!.action).toBe(IRAction.FILL);
      expect(textStep!.input).toBe('Bangalore to Chennai');
    });
  });

  describe('counter with multiple increments', () => {
    it('uses final value, not intermediate states', () => {
      const subActions: DropdownSubAction[] = [
        { action: 'increment', label: 'Adults', value: '2' },
        { action: 'increment', label: 'Adults', value: '3' },
        { action: 'confirm', label: 'Done', value: undefined },
      ];
      const plan = buildPlanFromSubActions(subActions);
      const adultsStep = plan.steps.find(s => s.plainEnglish?.includes('Adults'));

      expect(adultsStep).toBeDefined();
      expect(adultsStep!.input).toBe('3'); // final value, not 2
    });
  });

  describe('non-enriched interactions still work (regression)', () => {
    it('generates a single step for a simple dropdown without subActions', () => {
      const interaction = makeCI('CustomDropdown', {
        trigger: makeElementIdentity({
          accessibleName: 'One Way',
          ariaRole: 'button',
          tag: 'BUTTON',
        }),
        metadata: { selectedValue: 'Round Trip', targetName: 'One Way' },
      });

      const input: IRBridgeInput = {
        events: [],
        interactions: [interaction],
        understanding: null,
        recordingContext: { startUrl: 'https://example.com', title: 'Test' },
        testCaseName: 'test-case',
      };

      const plan = build(input);

      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// Helper alias for the subActions → plan builder
function buildPlanFromSubSubActions(subActions: DropdownSubAction[]) {
  return buildPlanFromSubActions(subActions);
}
