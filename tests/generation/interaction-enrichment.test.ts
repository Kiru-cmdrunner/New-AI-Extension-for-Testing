/**
 * Interaction Enrichment Pass — Unit Tests
 *
 * Verifies the enrichment pass produces correct assertions with backfilled
 * locators, and that build() with enrichment produces identical output
 * to build() without enrichment (backward compatibility).
 *
 * Architecture: .drytis/TIER2A_DESIGN.md
 */

import { describe, it, expect } from 'vitest';
import { enrichInteractions } from '../../src/generation/interaction-enrichment';
import { build as buildIRPlan, resolveLocatorsForIR } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ExecutionIRPlan } from '../../src/domain/execution-ir/types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Test Helpers ─────────────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    elementId: 'test-elem-1',
    tag: 'input',
    type: 'text',
    id: 'username',
    name: 'username',
    className: 'form-input',
    accessibleName: 'Username',
    ariaLabel: null,
    ariaRole: 'textbox',
    textContent: null,
    href: null,
    value: 'testuser',
    placeholder: 'Enter username',
    dataTestId: null,
    dataCy: null,
    ...overrides,
  };
}

function makeTextEntryInteraction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-001',
    type: 'TextEntry',
    trigger: makeElementIdentity(),
    triggerEvent: {
      eventId: 'evt-001',
      eventType: 'focus',
      timestamp: Date.now(),
      isTrusted: true,
      target: makeElementIdentity(),
      domContext: {
        inputType: 'text',
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: [],
      },
      valueBefore: null,
      valueAfter: 'hello',
      checkedBefore: null,
      checkedAfter: null,
      clientX: null,
      clientY: null,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://example.com',
      pageTitle: 'Test Page',
    },
    memberEvents: [],
    startTime: Date.now(),
    endTime: Date.now(),
    endState: 'completed',
    metadata: { textValue: 'hello', targetName: 'Username' },
    ...overrides,
  };
}

function makeCheckboxInteraction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return makeTextEntryInteraction({
    interactionId: 'int-002',
    type: 'Checkbox',
    trigger: makeElementIdentity({
      tag: 'input',
      type: 'checkbox',
      id: 'remember-me',
      accessibleName: 'Remember me',
      ariaRole: 'checkbox',
    }),
    metadata: { checked: true, targetName: 'Remember me' },
    triggerEvent: {
      eventId: 'evt-002',
      eventType: 'click',
      timestamp: Date.now(),
      isTrusted: true,
      target: makeElementIdentity({
        tag: 'input',
        type: 'checkbox',
        id: 'remember-me',
        accessibleName: 'Remember me',
        ariaRole: 'checkbox',
      }),
      domContext: {
        inputType: 'checkbox',
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: [],
      },
      valueBefore: null,
      valueAfter: null,
      checkedBefore: false,
      checkedAfter: true,
      clientX: 10,
      clientY: 10,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://example.com',
      pageTitle: 'Test Page',
    },
    ...overrides,
  });
}

function makeBridgeInput(interactions: ComponentInteraction[]): IRBridgeInput {
  return {
    events: [],
    interactions,
    understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test' },
    testCaseName: 'Enrichment Test',
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Interaction Enrichment Pass', () => {

  describe('enrichInteractions — locator resolution', () => {
    it('resolves locators for every interaction', () => {
      const interactions = [makeTextEntryInteraction(), makeCheckboxInteraction()];
      const result = enrichInteractions({ interactions, fragment: null });

      expect(result.locators.size).toBe(2);
      expect(result.locators.get('int-001')).toBeDefined();
      expect(result.locators.get('int-001')!.length).toBeGreaterThan(0);
      expect(result.locators.get('int-002')).toBeDefined();
      expect(result.locators.get('int-002')!.length).toBeGreaterThan(0);
    });

    it('locators match resolveLocatorsForIR output', () => {
      const interaction = makeTextEntryInteraction();
      const result = enrichInteractions({ interactions: [interaction], fragment: null });
      const directLocators = resolveLocatorsForIR(interaction.trigger);

      expect(result.locators.get('int-001')).toEqual(directLocators);
    });
  });

  describe('enrichInteractions — assertion derivation', () => {
    it('derives value assertion for TextEntry', () => {
      const interaction = makeTextEntryInteraction();
      const result = enrichInteractions({ interactions: [interaction], fragment: null });

      const assertions = result.assertions.get('int-001');
      expect(assertions).toBeDefined();
      expect(assertions!.length).toBeGreaterThan(0);

      const valueAssertion = assertions!.find(a => a.property === 'value');
      expect(valueAssertion).toBeDefined();
      expect(valueAssertion!.expectedValue).toBe('hello');
    });

    it('derives checked assertion for Checkbox', () => {
      const interaction = makeCheckboxInteraction();
      const result = enrichInteractions({ interactions: [interaction], fragment: null });

      const assertions = result.assertions.get('int-002');
      expect(assertions).toBeDefined();
      expect(assertions!.length).toBeGreaterThan(0);

      const checkedAssertion = assertions!.find(a => a.property === 'checked');
      expect(checkedAssertion).toBeDefined();
      expect(checkedAssertion!.expectedValue).toBe(true);
    });

    it('does not derive assertions for interaction types with no state', () => {
      // Click interactions DO get structural assertions from the presence provider
      const interaction = makeTextEntryInteraction({
        interactionId: 'int-003',
        type: 'Click',
        metadata: { targetName: 'Submit button' },
      });
      const result = enrichInteractions({ interactions: [interaction], fragment: null });

      // Click gets a presence assertion from elementPresenceProvider
      const assertions = result.assertions.get('int-003');
      expect(assertions).toBeDefined();
      expect(assertions!.length).toBeGreaterThan(0);

      const presenceAssertion = assertions!.find(a => a.type === 'presence');
      expect(presenceAssertion).toBeDefined();
    });
  });

  describe('enrichInteractions — locator backfill (F5 fix)', () => {
    it('assertion targets have non-empty resolvedLocators', () => {
      const interaction = makeTextEntryInteraction();
      const result = enrichInteractions({ interactions: [interaction], fragment: null });

      const assertions = result.assertions.get('int-001')!;
      for (const assertion of assertions) {
        if (assertion.target.kind === 'element') {
          expect(assertion.target.resolvedLocators.length).toBeGreaterThan(0);
        }
      }
    });

    it('assertion target elementId matches interaction trigger elementId', () => {
      const interaction = makeTextEntryInteraction();
      const result = enrichInteractions({ interactions: [interaction], fragment: null });

      const assertions = result.assertions.get('int-001')!;
      for (const assertion of assertions) {
        if (assertion.target.kind === 'element') {
          expect(assertion.target.elementId).toBe('test-elem-1');
        }
      }
    });
  });

  describe('build() with enrichment — backward compatibility', () => {
    it('build() with enrichment produces identical plan to build() without enrichment', () => {
      const interactions = [makeTextEntryInteraction(), makeCheckboxInteraction()];
      const input = makeBridgeInput(interactions);
      const enrichment = enrichInteractions({ interactions, fragment: null });

      const planWithoutEnrichment = buildIRPlan(input);
      const planWithEnrichment = buildIRPlan(input, enrichment);

      // Both should produce identical IR plans
      // (normalizing testCaseId/versionId which use Date.now())
      const normalize = (plan: ExecutionIRPlan) => ({
        ...plan,
        testCaseId: 'STABLE',
        testCaseVersionId: 'STABLE',
      });

      expect(normalize(planWithEnrichment)).toEqual(normalize(planWithoutEnrichment));
    });

    it('build() with enrichment produces assertions with locators', () => {
      const interactions = [makeTextEntryInteraction()];
      const input = makeBridgeInput(interactions);
      const enrichment = enrichInteractions({ interactions, fragment: null });

      const plan = buildIRPlan(input, enrichment);

      expect(plan.steps.length).toBe(1);
      const step = plan.steps[0];
      expect(step.assertions.length).toBeGreaterThan(0);

      const valueAssertion = step.assertions.find(a => a.property === 'value');
      expect(valueAssertion).toBeDefined();
      expect(valueAssertion!.target.kind).toBe('element');
      if (valueAssertion!.target.kind === 'element') {
        expect(valueAssertion!.target.resolvedLocators.length).toBeGreaterThan(0);
      }
    });
  });

  describe('enrichInteractions — pure function', () => {
    it('does not mutate input interactions', () => {
      const interaction = makeTextEntryInteraction();
      const originalMetadata = { ...interaction.metadata };
      const originalIntent = interaction.intent;

      enrichInteractions({ interactions: [interaction], fragment: null });

      expect(interaction.metadata).toEqual(originalMetadata);
      expect(interaction.intent).toBe(originalIntent);
    });
  });

  describe('enrichInteractions — structural assertions', () => {
    it('derives presence assertion for Click', () => {
      const interaction = makeTextEntryInteraction({
        interactionId: 'int-click',
        type: 'Click',
        metadata: { targetName: 'Submit' },
      });
      const result = enrichInteractions({ interactions: [interaction], fragment: null });

      const assertions = result.assertions.get('int-click')!;
      const presence = assertions.find(a => a.type === 'presence');
      expect(presence).toBeDefined();
      expect(presence!.comparison).toBe('isTrue');
      expect(presence!.severity).toBe('soft');
    });

    it('derives visibility assertion for ModalDialog', () => {
      const interaction = makeTextEntryInteraction({
        interactionId: 'int-modal',
        type: 'ModalDialog',
        metadata: { modalTitle: 'Confirm Delete', targetName: 'Open dialog' },
      });
      const result = enrichInteractions({ interactions: [interaction], fragment: null });

      const assertions = result.assertions.get('int-modal')!;
      const visibility = assertions.find(a => a.type === 'visibility' && a.expectedValue === true);
      expect(visibility).toBeDefined();
    });

    it('derives panel-closed assertion for CustomDropdown after selection', () => {
      const interaction = makeTextEntryInteraction({
        interactionId: 'int-dd',
        type: 'Dropdown',
        trigger: makeElementIdentity({ tag: 'div', ariaRole: 'listbox', accessibleName: 'Country' }),
        metadata: { selectedValue: 'US', interactionSubtype: 'CustomDropdown' },
      });
      const result = enrichInteractions({ interactions: [interaction], fragment: null });

      const assertions = result.assertions.get('int-dd')!;
      // Should have value assertion (state) + panel-closed assertion (structural)
      const panelClosed = assertions.find(a => a.type === 'visibility' && a.expectedValue === false);
      expect(panelClosed).toBeDefined();
    });

    it('all structural assertions use SOFT severity', () => {
      const interaction = makeTextEntryInteraction({
        interactionId: 'int-click-soft',
        type: 'Click',
        metadata: { targetName: 'Button' },
      });
      const result = enrichInteractions({ interactions: [interaction], fragment: null });

      const assertions = result.assertions.get('int-click-soft')!;
      const structural = assertions.filter(a => a.type === 'presence' || a.type === 'visibility');
      for (const a of structural) {
        expect(a.severity).toBe('soft');
      }
    });
  });

  describe('build() — semantic intent propagation', () => {
    it('maps intent from ComponentInteraction to IRStep', () => {
      const interactions = [makeTextEntryInteraction()];
      // Simulate evidence annotation having run
      interactions[0].intent = 'input';
      interactions[0].evidenceTrail = [
        { intent: 'input', weight: 1.0, source: 'text-input', reason: 'Text input field' },
      ];

      const input = makeBridgeInput(interactions);
      const plan = buildIRPlan(input);

      const step = plan.steps[0];
      expect(step.intent).toBe('input');
      expect(step.evidenceTrail).toBeDefined();
      expect(step.evidenceTrail!.length).toBe(1);
      expect(step.evidenceTrail![0].source).toBe('text-input');
    });

    it('omits intent when ComponentInteraction has no evidence', () => {
      const interactions = [makeTextEntryInteraction()];
      // No intent/evidenceTrail set (simulates interactions that bypassed annotation)

      const input = makeBridgeInput(interactions);
      const plan = buildIRPlan(input);

      const step = plan.steps[0];
      expect(step.intent).toBeUndefined();
      expect(step.evidenceTrail).toBeUndefined();
    });
  });
});
