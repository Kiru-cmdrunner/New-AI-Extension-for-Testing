/**
 * Integration Tests for the Enrichment Orchestrator
 *
 * End-to-end tests: fixtures (foundations + DOM) → enrichSession →
 * ApplicationKnowledgeFragment. Verifies the full pipeline.
 *
 * Uses a flight-booking scenario fixture as described in
 * architecture-walkthrough.md: user navigates to a booking page,
 * selects travel class (dropdown), types passenger name (text field),
 * toggles a round-trip checkbox, and navigates to results.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §8
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { enrichSession } from '../src/recorder/enrichment/enrichment-orchestrator';
import type { EnrichmentInput } from '../src/recorder/enrichment/enrichment-orchestrator';
import type { UiElement } from '../src/domain/entities/ui-element';
import type { ObservedTransition, ElementState } from '../src/domain/entities/observed-transition';
import type { ComponentGrouping } from '../src/domain/entities/component-grouping';
import type { DomInspector, DomElementInfo } from '../src/recorder/enrichment/dom-inspector';
import { _resetActionCounter } from '../src/recorder/enrichment/semantic-aggregator';
import {
  ComponentRole,
  PatternType,
  RecognitionSource,
  ComponentLifecycleState,
  TransitionOperation,
  RelevanceLevel,
  TransitionEvidenceType,
  IntrinsicCapability,
} from '../src/domain/enums';
import { promoteToConfirmed, createComponentGrouping, addConstituent } from '../src/domain/entities/component-grouping';
import { createUiElement, assignToComponent } from '../src/domain/entities/ui-element';
import type { ElementIdentity } from '../src/shared/types';

// ── Fixture DomInspector ─────────────────────────────────

class FixtureDomInspector implements DomInspector {
  private elements: Map<string, DomElementInfo>;

  constructor(elements: Record<string, DomElementInfo>) {
    this.elements = new Map(Object.entries(elements));
  }

  querySelector(elementId: string): DomElementInfo | null {
    return this.elements.get(elementId) ?? null;
  }

  querySelectorAll(parentId: string, _selector: string): DomElementInfo[] {
    const parent = this.elements.get(parentId);
    if (!parent) return [];
    return parent.children;
  }
}

// ── Fixture helpers ──────────────────────────────────────

function makeIdentity(name: string, tag = 'div', role: string | null = null): ElementIdentity {
  return {
    cssPath: tag, xpath: `//${tag}`, ariaRole: role, ariaLevel: null,
    accessibleName: name, tag, type: null, testId: null,
    text: null, childText: null, href: null, title: null, label: null,
    classes: [], attributes: {}, domPosition: 1, rect: null,
  } as unknown as ElementIdentity;
}

function makeState(partial: Partial<ElementState> = {}): ElementState {
  return { value: null, checked: null, expanded: null, selected: null, ...partial };
}

function domEl(
  elementId: string,
  attributes: Record<string, string> = {},
  textContent: string | null = null,
  accessibleName: string | null = null,
  children: DomElementInfo[] = [],
): DomElementInfo {
  return { elementId, attributes, textContent, accessibleName, children };
}

// ── Tests ────────────────────────────────────────────────

describe('enrichSession — integration tests', () => {
  beforeEach(() => {
    _resetActionCounter();
  });

  describe('flight booking scenario', () => {
    it('produces a complete fragment from the full pipeline', () => {
      // ── Elements ──
      const url = 'https://airline.example.com/booking';

      const navLink = createUiElement({
        elementId: 'nav-link',
        identity: makeIdentity('Search Flights', 'a', 'link'),
        sourceUrl: url,
        domTreePath: 'html>body>nav>a',
      });

      const triggerEl = createUiElement({
        elementId: 'dd-trigger',
        identity: makeIdentity('Travel Class', 'div', 'combobox'),
        domAttributes: { 'aria-label': 'Travel Class', 'aria-expanded': 'false' },
        sourceUrl: url,
        domTreePath: 'html>body>form>div.dropdown>div.trigger',
      });

      const listboxEl = createUiElement({
        elementId: 'dd-listbox',
        identity: makeIdentity('', 'div', 'listbox'),
        sourceUrl: url,
        domTreePath: 'html>body>form>div.dropdown>div.listbox',
      });

      const nameInput = createUiElement({
        elementId: 'name-input',
        identity: makeIdentity('Passenger Name', 'input', 'textbox'),
        domAttributes: { type: 'text', required: '', minlength: '2', maxlength: '50' },
        sourceUrl: url,
        domTreePath: 'html>body>form>input#name',
      });

      const checkboxEl = createUiElement({
        elementId: 'roundtrip-cb',
        identity: makeIdentity('Round Trip', 'input', 'checkbox'),
        sourceUrl: url,
        domTreePath: 'html>body>form>input#roundtrip',
      });

      // ── Components ──
      let dropdownComp = createComponentGrouping({
        groupingId: 'comp-dropdown',
        patternType: PatternType.DROPDOWN,
        rootElementId: 'dd-trigger',
        constituents: [
          { elementId: 'dd-trigger', role: ComponentRole.TRIGGER },
          { elementId: 'dd-listbox', role: ComponentRole.CONTAINER },
        ],
        recognitionSource: RecognitionSource.STRUCTURAL,
        recognitionConfidence: 0.9,
      });
      dropdownComp = addConstituent(dropdownComp, 'dd-opt-economy', ComponentRole.OPTION);
      dropdownComp = promoteToConfirmed(dropdownComp);

      // ── Assign elements to component ──
      const triggerWithComp = assignToComponent(triggerEl, 'comp-dropdown', ComponentRole.TRIGGER);
      const listboxWithComp = assignToComponent(listboxEl, 'comp-dropdown', ComponentRole.CONTAINER);

      // ── Transitions ──
      const transitions: ObservedTransition[] = [
        // Navigate to booking page
        {
          transitionId: 't-nav',
          elementId: 'nav-link',
          componentId: null,
          operation: TransitionOperation.NAVIGATE,
          timestamp: 1000,
          relevance: RelevanceLevel.DELIBERATE,
          stateBefore: makeState(),
          stateAfter: makeState(),
          evidence: [{
            type: TransitionEvidenceType.NAVIGATION,
            description: 'Navigated to booking page',
            before: null,
            after: 'https://airline.example.com/booking',
          }],
          cascadeEffects: [],
          validationResult: null,
        },
        // Dropdown: click trigger to open
        {
          transitionId: 't-dd-click',
          elementId: 'dd-trigger',
          componentId: 'comp-dropdown',
          operation: TransitionOperation.CLICK,
          timestamp: 2000,
          relevance: RelevanceLevel.DELIBERATE,
          stateBefore: makeState({ expanded: false }),
          stateAfter: makeState({ expanded: true }),
          evidence: [{
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'Dropdown expanded',
            before: 'false',
            after: 'true',
          }],
          cascadeEffects: [],
          validationResult: null,
        },
        // Dropdown: select economy option
        {
          transitionId: 't-dd-select',
          elementId: 'dd-trigger',
          componentId: 'comp-dropdown',
          operation: TransitionOperation.SELECT,
          timestamp: 3000,
          relevance: RelevanceLevel.DELIBERATE,
          stateBefore: makeState({ value: null }),
          stateAfter: makeState({ value: 'economy' }),
          evidence: [{
            type: TransitionEvidenceType.VALUE_CHANGE,
            description: 'Selected Economy',
            before: null,
            after: 'economy',
          }],
          cascadeEffects: [],
          validationResult: null,
        },
        // Text field: type passenger name
        {
          transitionId: 't-type',
          elementId: 'name-input',
          componentId: null,
          operation: TransitionOperation.FILL,
          timestamp: 4000,
          relevance: RelevanceLevel.DELIBERATE,
          stateBefore: makeState({ value: null }),
          stateAfter: makeState({ value: 'John Doe' }),
          evidence: [{
            type: TransitionEvidenceType.VALUE_CHANGE,
            description: 'Typed John Doe',
            before: null,
            after: 'John Doe',
          }],
          cascadeEffects: [],
          validationResult: null,
        },
      ];

      // ── DOM fixture ──
      const dom: Record<string, DomElementInfo> = {
        'dd-trigger': domEl('dd-trigger', { 'aria-label': 'Travel Class' }, null, 'Travel Class'),
        'dd-listbox': domEl('dd-listbox', { role: 'listbox' }, null, null, [
          domEl('dd-opt-economy', { role: 'option', 'data-value': 'economy', 'aria-selected': 'true' }, 'Economy'),
          domEl('dd-opt-business', { role: 'option', 'data-value': 'business' }, 'Business'),
          domEl('dd-opt-first', { role: 'option', 'data-value': 'first' }, 'First Class'),
        ]),
        'name-input': domEl('name-input', { type: 'text', required: '' }, null, 'Passenger Name'),
      };

      const inspector = new FixtureDomInspector(dom);

      const input: EnrichmentInput = {
        sessionId: 'session-flight-001',
        elements: [navLink, triggerWithComp, listboxWithComp, nameInput, checkboxEl],
        transitions,
        components: [dropdownComp],
        domInspector: inspector,
      };

      // ── Run enrichment ──
      const fragment = enrichSession(input);

      // ── Verify top-level ──
      expect(fragment.sessionId).toBe('session-flight-001');
      expect(fragment.schemaVersion).toBe(1);
      expect(fragment.generatedAt).toBeTruthy();

      // ── Verify element summaries ──
      expect(fragment.elements).toHaveLength(5);
      const triggerSummary = fragment.elements.find((e) => e.elementId === 'dd-trigger')!;
      expect(triggerSummary.componentId).toBe('comp-dropdown');
      expect(triggerSummary.componentRole).toBe(ComponentRole.TRIGGER);

      // ── Verify component summaries ──
      expect(fragment.components).toHaveLength(1);
      expect(fragment.components[0].groupingId).toBe('comp-dropdown');
      expect(fragment.components[0].businessField).toBe('Travel Class');
      // optionSet should be enriched from DOM
      expect(fragment.components[0].optionCount).toBe(3);

      // ── Verify interaction contracts ──
      expect(fragment.interactionContracts).toHaveLength(5);
      const nameContract = fragment.interactionContracts.find((c) => c.appliesTo.id === 'name-input')!;
      expect(nameContract.constraints.required).toBe(true);
      expect(nameContract.constraints.lengthRange).toEqual({ minLength: 2, maxLength: 50 });

      // Verify validOptions is wired from enriched component optionSet (spec §1)
      const triggerContract = fragment.interactionContracts.find((c) => c.appliesTo.id === 'dd-trigger')!;
      expect(triggerContract.constraints.validOptions).not.toBeNull();
      expect(triggerContract.constraints.validOptions).toHaveLength(3);
      expect(triggerContract.constraints.validOptions![0].value).toBe('economy');

      // ── Verify behavioral contracts ──
      expect(fragment.behavioralContracts).toHaveLength(1);
      const ddBehavioral = fragment.behavioralContracts[0];
      expect(ddBehavioral.appliesTo.id).toBe('comp-dropdown');
      // Should have states from the expanded/value transitions
      expect(ddBehavioral.stateMachine.states.length).toBeGreaterThan(0);

      // ── Verify logical actions ──
      // Dropdown: CLICK+SELECT = 1 complete action
      // Text field: standalone FILL = 1 action
      // Navigation: standalone NAVIGATE = 1 action
      expect(fragment.logicalActions.length).toBeGreaterThanOrEqual(2);

      const ddAction = fragment.logicalActions.find((a) => a.componentId === 'comp-dropdown');
      expect(ddAction).toBeDefined();
      expect(ddAction!.lifecycleComplete).toBe(true);
      expect(ddAction!.transitionIds).toContain('t-dd-click');
      expect(ddAction!.transitionIds).toContain('t-dd-select');
      expect(ddAction!.resultingChange).not.toBeNull();
      expect(ddAction!.businessField).toBe('Travel Class');

      // ── Verify workflow ──
      expect(fragment.recordedWorkflow.surfaceTransitions).toHaveLength(1);
      expect(fragment.recordedWorkflow.surfaceTransitions[0].toUrl).toBe('https://airline.example.com/booking');

      // Branch point from the dropdown optionSet
      expect(fragment.recordedWorkflow.branchPoints).toHaveLength(1);
      expect(fragment.recordedWorkflow.branchPoints[0].chosenOption).toBe('Economy');
      expect(fragment.recordedWorkflow.branchPoints[0].availableOptions).toEqual([
        'Economy', 'Business', 'First Class',
      ]);

      // ── Verify surfaces ──
      expect(fragment.applicationSurfaces).toHaveLength(1);
      expect(fragment.applicationSurfaces[0].url).toBe(url);
      expect(fragment.applicationSurfaces[0].elementIds.length).toBe(5);
    });
  });

  describe('empty session', () => {
    it('produces a valid fragment with empty collections', () => {
      const inspector = new FixtureDomInspector({});

      const fragment = enrichSession({
        sessionId: 'empty-session',
        elements: [],
        transitions: [],
        components: [],
        domInspector: inspector,
      });

      expect(fragment.sessionId).toBe('empty-session');
      expect(fragment.elements).toEqual([]);
      expect(fragment.transitions).toEqual([]);
      expect(fragment.components).toEqual([]);
      expect(fragment.interactionContracts).toEqual([]);
      expect(fragment.behavioralContracts).toEqual([]);
      expect(fragment.logicalActions).toEqual([]);
      expect(fragment.applicationSurfaces).toEqual([]);
    });
  });

  describe('option set enrichment', () => {
    it('enriches component optionSet from DOM, discovering uninteracted options', () => {
      const url = 'https://app.com/page';

      const triggerEl = assignToComponent(
        createUiElement({
          elementId: 'trigger',
          identity: makeIdentity('Color', 'div', 'combobox'),
          domAttributes: { 'aria-label': 'Color' },
          sourceUrl: url,
          domTreePath: 'html>body>div',
        }),
        'comp-1',
        ComponentRole.TRIGGER,
      );

      const containerEl = assignToComponent(
        createUiElement({
          elementId: 'container',
          identity: makeIdentity('', 'div', 'listbox'),
          sourceUrl: url,
          domTreePath: 'html>body>div>div',
        }),
        'comp-1',
        ComponentRole.CONTAINER,
      );

      let comp = createComponentGrouping({
        groupingId: 'comp-1',
        patternType: PatternType.DROPDOWN,
        rootElementId: 'trigger',
        constituents: [
          { elementId: 'trigger', role: ComponentRole.TRIGGER },
          { elementId: 'container', role: ComponentRole.CONTAINER },
          { elementId: 'opt-red', role: ComponentRole.OPTION },
        ],
        recognitionSource: RecognitionSource.STRUCTURAL,
        recognitionConfidence: 0.85,
      });
      comp = promoteToConfirmed(comp);

      const dom: Record<string, DomElementInfo> = {
        'trigger': domEl('trigger', {}, null, 'Color'),
        'container': domEl('container', { role: 'listbox' }, null, null, [
          domEl('opt-red', { role: 'option', 'data-value': 'red' }, 'Red'),
          domEl('opt-green', { role: 'option', 'data-value': 'green', 'aria-selected': 'true' }, 'Green'),
          domEl('opt-blue', { role: 'option', 'data-value': 'blue' }, 'Blue'),
        ]),
      };

      const fragment = enrichSession({
        sessionId: 'test',
        elements: [triggerEl, containerEl],
        transitions: [],
        components: [comp],
        domInspector: new FixtureDomInspector(dom),
      });

      // The component summary should reflect the enriched optionSet
      expect(fragment.components[0].optionCount).toBe(3);
      // Branch point should be detected
      expect(fragment.recordedWorkflow.branchPoints).toHaveLength(1);
      expect(fragment.recordedWorkflow.branchPoints[0].chosenOption).toBe('Green');
    });
  });

  describe('non-confirmed components are not enriched', () => {
    it('skips behavioral contracts and option extraction for developing components', () => {
      const url = 'https://app.com/page';

      const triggerEl = createUiElement({
        elementId: 'trigger-dev',
        identity: makeIdentity('Dev Field', 'div', 'combobox'),
        sourceUrl: url,
        domTreePath: 'html>body',
      });

      // Component in DEVELOPING state (not confirmed)
      const comp = createComponentGrouping({
        groupingId: 'comp-dev',
        patternType: PatternType.DROPDOWN,
        rootElementId: 'trigger-dev',
        constituents: [{ elementId: 'trigger-dev', role: ComponentRole.TRIGGER }],
        recognitionSource: RecognitionSource.STRUCTURAL,
        recognitionConfidence: 0.5,
      });
      // comp is still in TENTATIVE state from createComponentGrouping

      const fragment = enrichSession({
        sessionId: 'test-dev',
        elements: [triggerEl],
        transitions: [],
        components: [comp],
        domInspector: new FixtureDomInspector({}),
      });

      // No behavioral contracts (not confirmed)
      expect(fragment.behavioralContracts).toHaveLength(0);
    });
  });
});
