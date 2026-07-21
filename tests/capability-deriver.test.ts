/**
 * Tests for the Capability Deriver.
 *
 * Verifies that the deriver correctly produces a CapabilityCandidate from
 * an ApplicationKnowledgeFragment, covering all derivation paths and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { deriveCapability } from '../src/recorder/enrichment/capability-deriver';
import type { ApplicationKnowledgeFragment } from '../src/domain/entities/application-knowledge';
import type { CapabilityCandidate } from '../src/domain/entities/capability-candidate';

// ── Helpers ───────────────────────────────────────────────

function makeFragment(overrides: Partial<ApplicationKnowledgeFragment> = {}): ApplicationKnowledgeFragment {
  return {
    sessionId: 'session-001',
    generatedAt: '2026-07-21T22:00:00Z',
    schemaVersion: 1,
    elements: [],
    transitions: [],
    components: [],
    interactionContracts: [],
    behavioralContracts: [],
    logicalActions: [],
    recordedWorkflow: {
      surfaceTransitions: [],
      logicalActions: [],
      branchPoints: [],
      optionalSteps: [],
    },
    applicationSurfaces: [],
    ...overrides,
  };
}

function makeElementFragment(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    elementId: 'elem-001',
    tag: 'button',
    role: 'button',
    accessibleName: 'Save',
    capabilities: [],
    componentId: null,
    componentRole: null,
    sourceUrl: '/form',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('Capability Deriver', () => {

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('returns null for an empty fragment (no elements, no transitions)', () => {
      const result = deriveCapability({
        fragment: makeFragment(),
        sessionId: 'session-001',
      });
      expect(result.capability).toBeNull();
    });

    it('returns null for a fragment with only empty arrays', () => {
      const result = deriveCapability({
        fragment: makeFragment({
          elements: [],
          transitions: [],
        }),
        sessionId: 'session-001',
      });
      expect(result.capability).toBeNull();
    });

    it('derives a capability from a fragment with at least one element', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability).not.toBeNull();
      expect(result.capability!.confidence).toBe('candidate');
    });
  });

  // ── Name Derivation ──

  describe('capability name derivation', () => {
    it('uses businessField from the first logical action', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'input',
          role: 'textbox',
          accessibleName: 'Email',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/login',
        }],
        logicalActions: [{
          actionId: 'action-001',
          componentId: null,
          businessField: 'Email Address',
          transitionIds: [],
          lifecycleComplete: true,
          resultingChange: null,
          timestamp: 1000,
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.name).toBe('Email Address');
    });

    it('uses submit button accessible name when no businessField', () => {
      const fragment = makeFragment({
        elements: [
          {
            elementId: 'elem-001',
            tag: 'div',
            role: null,
            accessibleName: 'Form Container',
            capabilities: [],
            componentId: null,
            componentRole: null,
            sourceUrl: '/form',
          },
          {
            elementId: 'elem-002',
            tag: 'button',
            role: 'button',
            accessibleName: 'Create Customer',
            capabilities: [],
            componentId: null,
            componentRole: null,
            sourceUrl: '/form',
          },
        ],
        logicalActions: [],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.name).toBe('Create Customer');
    });

    it('uses last surface transition URL path when no business field or submit button', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'div',
          role: null,
          accessibleName: 'Container',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/app',
        }],
        recordedWorkflow: {
          surfaceTransitions: [{
            fromUrl: '/app/customers',
            toUrl: '/app/customers/123',
            triggeredByTransitionId: 'trans-001',
          }],
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.name).toBe('123');
    });

    it('falls back to "Recorded Workflow" when no derivable name', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'div',
          role: null,
          accessibleName: '',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: 'about:blank',
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.name).toBe('Recorded Workflow');
    });

    it('title-cases URL path segments', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'div',
          role: null,
          accessibleName: '',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: 'about:blank',
        }],
        recordedWorkflow: {
          surfaceTransitions: [{
            fromUrl: '/home',
            toUrl: '/user-profile/settings',
            triggeredByTransitionId: 'trans-001',
          }],
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.name).toBe('Settings');
    });
  });

  // ── Entry Element ──

  describe('entry element derivation', () => {
    it('finds submit-like button as entry element', () => {
      const fragment = makeFragment({
        elements: [
          {
            elementId: 'elem-input',
            tag: 'input',
            role: 'textbox',
            accessibleName: 'Name',
            capabilities: [],
            componentId: null,
            componentRole: null,
            sourceUrl: '/form',
          },
          {
            elementId: 'elem-submit',
            tag: 'button',
            role: 'button',
            accessibleName: 'Save',
            capabilities: [],
            componentId: null,
            componentRole: null,
            sourceUrl: '/form',
          },
        ],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.entryElement).not.toBeNull();
      expect(result.capability!.entryElement!.elementId).toBe('elem-submit');
      expect(result.capability!.entryElement!.accessibleName).toBe('Save');
    });

    it('uses first logical action component root when no submit button', () => {
      const fragment = makeFragment({
        elements: [
          {
            elementId: 'elem-root',
            tag: 'div',
            role: 'combobox',
            accessibleName: 'Country',
            capabilities: [],
            componentId: 'comp-001',
            componentRole: 'combobox' as never,
            sourceUrl: '/form',
          },
        ],
        components: [{
          groupingId: 'comp-001',
          patternType: 'COMBOBOX',
          rootElementId: 'elem-root',
          constituentCount: 1,
          businessField: 'Country',
          lifecycleState: 'CONFIRMED',
          optionCount: 3,
          optionSet: ['US', 'CA', 'UK'],
        }],
        logicalActions: [{
          actionId: 'action-001',
          componentId: 'comp-001',
          businessField: 'Country',
          transitionIds: [],
          lifecycleComplete: true,
          resultingChange: null,
          timestamp: 1000,
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.entryElement!.elementId).toBe('elem-root');
    });

    it('falls back to first interactive element', () => {
      const fragment = makeFragment({
        elements: [
          {
            elementId: 'elem-first',
            tag: 'input',
            role: 'textbox',
            accessibleName: 'Search',
            capabilities: [],
            componentId: null,
            componentRole: null,
            sourceUrl: '/search',
          },
        ],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.entryElement!.elementId).toBe('elem-first');
    });

    it('returns null entry element when no elements match', () => {
      const fragment = makeFragment({
        transitions: [{
          transitionId: 'trans-001',
          elementId: '__page__',
          componentId: null,
          operation: 'NAVIGATE',
          timestamp: 1000,
          relevance: 'primary',
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      // Fragment has transitions but no elements — capability is still derived
      // because we check `elements.length === 0 && transitions.length === 0`
      // But entry element will be null since no elements exist
      expect(result.capability).not.toBeNull();
      expect(result.capability!.entryElement).toBeNull();
    });
  });

  // ── Inputs ──

  describe('input derivation', () => {
    it('derives inputs from logical actions with businessField', () => {
      const fragment = makeFragment({
        elements: [
          {
            elementId: 'elem-name',
            tag: 'input',
            role: 'textbox',
            accessibleName: 'Name',
            capabilities: [],
            componentId: null,
            componentRole: null,
            sourceUrl: '/form',
          },
          {
            elementId: 'elem-email',
            tag: 'input',
            role: 'textbox',
            accessibleName: 'Email',
            capabilities: [],
            componentId: null,
            componentRole: null,
            sourceUrl: '/form',
          },
        ],
        logicalActions: [
          {
            actionId: 'action-001',
            componentId: null,
            businessField: 'Customer Name',
            transitionIds: [],
            lifecycleComplete: true,
            resultingChange: null,
            timestamp: 1000,
          },
          {
            actionId: 'action-002',
            componentId: null,
            businessField: 'Email',
            transitionIds: [],
            lifecycleComplete: true,
            resultingChange: null,
            timestamp: 2000,
          },
        ],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.inputs).toHaveLength(2);
      expect(result.capability!.inputs[0].label).toBe('Customer Name');
      expect(result.capability!.inputs[1].label).toBe('Email');
    });

    it('resolves constraints from interaction contracts', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-email',
          tag: 'input',
          role: 'textbox',
          accessibleName: 'Email',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-email' },
          affordances: ['acceptText'],
          constraints: {
            required: true,
            inputType: 'email',
            valueRange: null,
            lengthRange: null,
            format: { regex: '^[^@]+@[^@]+$', description: 'Valid email' },
            validOptions: null,
            dateFormat: null,
          },
        }],
        logicalActions: [{
          actionId: 'action-001',
          componentId: null,
          businessField: 'Email',
          transitionIds: [],
          lifecycleComplete: true,
          resultingChange: null,
          timestamp: 1000,
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      const input = result.capability!.inputs[0];
      expect(input.required).toBe(true);
      expect(input.inputType).toBe('email');
      expect(input.format?.regex).toBe('^[^@]+@[^@]+$');
    });

    it('skips logical actions without businessField', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        logicalActions: [
          {
            actionId: 'action-001',
            componentId: null,
            businessField: null,
            transitionIds: [],
            lifecycleComplete: true,
            resultingChange: null,
            timestamp: 1000,
          },
          {
            actionId: 'action-002',
            componentId: null,
            businessField: 'Username',
            transitionIds: [],
            lifecycleComplete: true,
            resultingChange: null,
            timestamp: 2000,
          },
        ],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.inputs).toHaveLength(1);
      expect(result.capability!.inputs[0].label).toBe('Username');
    });
  });

  // ── Validation Rules ──

  describe('validation rule derivation', () => {
    it('derives required rule', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-name',
          tag: 'input',
          role: 'textbox',
          accessibleName: 'Name',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-name' },
          affordances: ['acceptText'],
          constraints: {
            required: true,
            inputType: 'text',
            valueRange: null,
            lengthRange: null,
            format: null,
            validOptions: null,
            dateFormat: null,
          },
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      const requiredRule = result.capability!.validationRules.find(r => r.type === 'required');
      expect(requiredRule).toBeDefined();
      expect(requiredRule!.description).toContain('required');
    });

    it('derives format rule', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-email',
          tag: 'input',
          role: 'textbox',
          accessibleName: 'Email',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-email' },
          affordances: ['acceptText'],
          constraints: {
            required: false,
            inputType: 'email',
            valueRange: null,
            lengthRange: null,
            format: { regex: '^[^@]+@[^@]+$', description: 'Valid email format' },
            validOptions: null,
            dateFormat: null,
          },
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      const formatRule = result.capability!.validationRules.find(r => r.type === 'format');
      expect(formatRule).toBeDefined();
      expect(formatRule!.constraint).toContain('regex=');
    });

    it('derives range rule', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-age',
          tag: 'input',
          role: 'spinbutton',
          accessibleName: 'Age',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-age' },
          affordances: ['acceptText'],
          constraints: {
            required: false,
            inputType: 'number',
            valueRange: { min: 0, max: 150, step: 1 },
            lengthRange: null,
            format: null,
            validOptions: null,
            dateFormat: null,
          },
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      const rangeRule = result.capability!.validationRules.find(r => r.type === 'range');
      expect(rangeRule).toBeDefined();
      expect(rangeRule!.constraint).toContain('min=0');
      expect(rangeRule!.constraint).toContain('max=150');
    });

    it('derives length rule', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-username',
          tag: 'input',
          role: 'textbox',
          accessibleName: 'Username',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-username' },
          affordances: ['acceptText'],
          constraints: {
            required: false,
            inputType: 'text',
            valueRange: null,
            lengthRange: { minLength: 3, maxLength: 20 },
            format: null,
            validOptions: null,
            dateFormat: null,
          },
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      const lengthRule = result.capability!.validationRules.find(r => r.type === 'length');
      expect(lengthRule).toBeDefined();
      expect(lengthRule!.constraint).toContain('minLength=3');
    });

    it('derives options rule', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-country',
          tag: 'select',
          role: 'combobox',
          accessibleName: 'Country',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-country' },
          affordances: ['selectOption'],
          constraints: {
            required: true,
            inputType: null,
            valueRange: null,
            lengthRange: null,
            format: null,
            validOptions: ['US', 'CA', 'UK'],
            dateFormat: null,
          },
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      const optionsRule = result.capability!.validationRules.find(r => r.type === 'options');
      expect(optionsRule).toBeDefined();
      expect(optionsRule!.constraint).toContain('US');
      expect(optionsRule!.constraint).toContain('CA');
      expect(optionsRule!.constraint).toContain('UK');
    });

    it('derives multiple rules from a single contract', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-username',
          tag: 'input',
          role: 'textbox',
          accessibleName: 'Username',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-username' },
          affordances: ['acceptText'],
          constraints: {
            required: true,
            inputType: 'text',
            valueRange: null,
            lengthRange: { minLength: 3, maxLength: 20 },
            format: { regex: '^[a-zA-Z0-9_]+$', description: 'Alphanumeric' },
            validOptions: null,
            dateFormat: null,
          },
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      const rules = result.capability!.validationRules;
      expect(rules).toHaveLength(3); // required + format + length
      expect(rules.map(r => r.type).sort()).toEqual(['format', 'length', 'required']);
    });
  });

  // ── Observed Outcome ──

  describe('observed outcome derivation', () => {
    it('derives terminal URL from last surface transition', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        recordedWorkflow: {
          surfaceTransitions: [
            { fromUrl: '/form', toUrl: '/loading', triggeredByTransitionId: 'trans-001' },
            { fromUrl: '/loading', toUrl: '/customers/123', triggeredByTransitionId: 'trans-002' },
          ],
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.observedOutcome.terminalUrl).toBe('/customers/123');
      expect(result.capability!.observedOutcome.completed).toBe(true);
    });

    it('derives success signals from behavioral contracts', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        behavioralContracts: [{
          appliesTo: { type: 'element', id: 'elem-001' },
          stateMachine: { states: [], transitions: [], terminalStates: [] },
          validationBehavior: null,
          cascadeEffects: [],
          successIndicators: [
            { signal: 'url-change', type: 'navigation', description: 'Redirected to /customers' },
            { signal: 'value-display', type: 'valueDisplay', description: 'Success message shown' },
          ],
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.observedOutcome.successSignals).toContain('navigation');
      expect(result.capability!.observedOutcome.successSignals).toContain('valueDisplay');
    });

    it('sets completed=false when no transitions or actions', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'div',
          role: null,
          accessibleName: 'Container',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        recordedWorkflow: {
          surfaceTransitions: [],
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.observedOutcome.completed).toBe(false);
    });
  });

  // ── Provenance + Enrichment ──

  describe('provenance and enrichment fields', () => {
    it('sets sourceSessionId and sourceFragmentId', () => {
      const fragment = makeFragment({
        sessionId: 'session-abc',
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-call-id' });
      expect(result.capability!.sourceSessionId).toBe('session-call-id');
      expect(result.capability!.sourceFragmentId).toBe('session-abc');
    });

    it('initializes enrichment fields as empty', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.observedOutcomes).toEqual([]);
      expect(result.capability!.businessRules).toEqual([]);
      expect(result.capability!.failureModes).toEqual([]);
    });

    it('records initial-derivation enrichment event', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        transitions: [{
          transitionId: 'trans-001',
          elementId: 'elem-001',
          componentId: null,
          operation: 'CLICK',
          timestamp: 1000,
          relevance: 'primary',
        }],
        components: [{
          groupingId: 'comp-001',
          patternType: 'FORM',
          rootElementId: 'elem-001',
          constituentCount: 1,
          businessField: 'Form',
          lifecycleState: 'CONFIRMED',
          optionCount: null,
          optionSet: null,
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.enrichmentHistory).toHaveLength(1);
      expect(result.capability!.enrichmentHistory[0].type).toBe('initial-derivation');
      expect(result.capability!.enrichmentHistory[0].description).toContain('1 elements');
      expect(result.capability!.enrichmentHistory[0].description).toContain('1 transitions');
      expect(result.capability!.enrichmentHistory[0].description).toContain('1 components');
    });

    it('always sets confidence to candidate for initial derivation', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.confidence).toBe('candidate');
    });

    it('generates capabilityId from session ID', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
      });
      const result = deriveCapability({ fragment, sessionId: 'session-42' });
      expect(result.capability!.capabilityId).toBe('cap-session-42');
    });
  });

  // ── Purpose ──

  describe('purpose derivation', () => {
    it('includes page transition count in purpose', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        recordedWorkflow: {
          surfaceTransitions: [
            { fromUrl: '/form', toUrl: '/loading', triggeredByTransitionId: 'trans-001' },
            { fromUrl: '/loading', toUrl: '/success', triggeredByTransitionId: 'trans-002' },
          ],
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.purpose).toContain('2 page transitions');
    });

    it('uses singular "transition" for single page transition', () => {
      const fragment = makeFragment({
        elements: [{
          elementId: 'elem-001',
          tag: 'button',
          role: 'button',
          accessibleName: 'Submit',
          capabilities: [],
          componentId: null,
          componentRole: null,
          sourceUrl: '/form',
        }],
        recordedWorkflow: {
          surfaceTransitions: [
            { fromUrl: '/form', toUrl: '/success', triggeredByTransitionId: 'trans-001' },
          ],
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
      });
      const result = deriveCapability({ fragment, sessionId: 'session-001' });
      expect(result.capability!.purpose).toContain('1 page transition');
      expect(result.capability!.purpose).not.toContain('transitions');
    });
  });
});
