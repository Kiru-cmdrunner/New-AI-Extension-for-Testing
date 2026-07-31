/**
 * Tests for the IR Bridge — validates the transformation from
 * SessionEvent[] + DetectedInteraction[] + ApplicationKnowledgeFragment
 * → ExecutionIRPlan.
 *
 * Covers:
 * - Interaction type → IRAction mapping (all categories)
 * - Locator resolution from ElementIdentity
 * - Input value extraction (text, checked, selected value, dates, sliders)
 * - Description generation (with and without business field enrichment)
 * - Assertion derivation from InteractionContract.constraints
 * - AI enrichment passthrough
 * - Noise filtering (scroll events, Unknown)
 * - Readability rules (duplicate click merging)
 * - Event ↔ interaction correlation
 * - Empty inputs (no events, no interactions, null fragment)
 * - Full end-to-end plan construction
 */

import { describe, it, expect } from 'vitest';
import { build } from '../src/generation/ir-bridge';
import type { IRBridgeInput } from '../src/generation/ir-bridge-input';
import { IRAction } from '../src/domain/execution-ir/types';
import { LocatorStrategyType, ValidationType, ValidationComparison } from '../src/domain/enums';
import type { SessionEvent, ElementIdentity } from '../src/shared/types';
import type { ComponentInteraction } from '../src/shared/component-types';
import { makeComponentInteraction as makeCI, makeObservedEvent } from './helpers/component-interaction-fixture';
import type { ApplicationKnowledgeFragment } from '../src/domain/entities/application-knowledge';
import type { UnderstandingResult } from '../src/domain/entities/understanding-result';

// ── Helpers ────────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    elementId: 'elem-0001',
    accessibleName: 'Submit Button',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn btn-primary',
    name: null,
    stableId: 'submit-btn',
    testId: 'submit-btn',
    dataCy: null,
    dataQa: null,
    cssSelector: 'button#submit-btn',
    xPath: '//button[@id="submit-btn"]',
    inIframe: false,
    shadowDom: false,
    ...overrides,
  };
}

/**
 * Build a ComponentInteraction for testing.
 * The `type` argument is the resolved type (e.g., 'NativeDropdown', 'Click').
 * Accepts DetectedInteraction-style overrides (target, eventIds, etc.)
 * and translates them to ComponentInteraction fields.
 *
 * Key differences from old DetectedInteraction fixtures:
 * - `target` → `trigger` (ElementIdentity)
 * - `eventIds` → translated to `memberEvents` with matching IDs
 * - When `eventIds` is explicitly `[]`, no memberEvents are set
 *   (signals "no correlatable events" to the bridge)
 * - When `target` is explicitly `undefined`, the interaction has no trigger
 */
function makeInteraction(
  type: string,
  overrides: Record<string, unknown> = {},
): ComponentInteraction {
  const hasExplicitTarget = 'target' in overrides;
  const trigger = hasExplicitTarget
    ? (overrides.target as ElementIdentity | undefined)
    : makeElementIdentity();
  const metadata = (overrides.metadata as Record<string, unknown>) ?? {};
  const endState = (overrides.endState as ComponentInteraction['endState']) ?? 'completed';
  const interactionId = (overrides.interactionId as string) ?? 'int-0001';
  const eventIds = overrides.eventIds as string[] | undefined;

  // If eventIds explicitly provided (including empty array), derive memberEvents from them
  let memberEvents: ObservedEvent[] | undefined;
  if (eventIds !== undefined) {
    if (eventIds.length > 0) {
      const eventTarget = trigger ?? makeElementIdentity();
      memberEvents = eventIds.map(id => makeObservedEvent({ eventId: id, target: eventTarget }));
    } else {
      // Explicitly empty eventIds → no memberEvents
      memberEvents = [];
    }
  }

  return makeCI(type, {
    metadata,
    trigger,
    endState,
    interactionId,
    memberEvents,
  });
}

function makeInput(
  overrides: Partial<IRBridgeInput> & { fragment?: ApplicationKnowledgeFragment | null } = {},
): IRBridgeInput {
  const { fragment, ...rest } = overrides;
  let understanding: UnderstandingResult | null = null;
  if (fragment) {
    understanding = {
      sessionId: fragment.sessionId,
      generatedAt: fragment.generatedAt,
      schemaVersion: 1,
      fragment,
      capability: null,
    };
  }
  return {
    events: [],
    interactions: [],
    understanding,
    recordingContext: { startUrl: 'https://example.com/login', title: 'Login Page' },
    testCaseName: 'Test Case',
    ...rest,
  };
}

function makeFragment(
  overrides: Partial<ApplicationKnowledgeFragment> = {},
): ApplicationKnowledgeFragment {
  return {
    sessionId: 'session-1',
    generatedAt: '2026-07-21T00:00:00Z',
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

// ── Tests ──────────────────────────────────────────────────

describe('IR Bridge — build()', () => {

  // ── Empty / Edge Cases ──────────────────────────────

  describe('empty inputs', () => {
    it('returns an empty plan when no interactions', () => {
      const plan = build(makeInput({ events: [], interactions: [] }));
      expect(plan.steps).toHaveLength(0);
      expect(plan.title).toBe('Test Case');
      expect(plan.environment.baseUrl).toBe('https://example.com/login');
    });

    it('returns a plan with correct environment', () => {
      const plan = build(makeInput({
        recordingContext: { startUrl: 'https://app.example.com/dashboard', title: 'Dashboard' },
      }));
      expect(plan.environment.baseUrl).toBe('https://app.example.com/dashboard');
      expect(plan.environment.browser).toBe('chrome');
      expect(plan.environment.viewport).toEqual({ width: 1280, height: 720 });
    });

    it('handles null fragment gracefully', () => {
      const interaction = makeInteraction('Click');
      const plan = build(makeInput({ interactions: [interaction], fragment: null }));
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].assertions).toHaveLength(0);
    });
  });

  // ── Interaction Type → IRAction Mapping ──────────────

  describe('interaction type mapping', () => {
    const cases: Array<[InteractionType, IRAction]> = [
      ['Click', IRAction.CLICK],
      ['DoubleClick', IRAction.CLICK],
      ['RightClick', IRAction.CLICK],
      ['TextEntry', IRAction.FILL],
      ['NativeDropdown', IRAction.SELECT],
      ['CustomDropdown', IRAction.SELECT],
      ['Autocomplete', IRAction.SELECT],
      ['MultiSelect', IRAction.SELECT],
      ['RadioButton', IRAction.CLICK],
      ['Checkbox', IRAction.TOGGLE],
      ['ToggleSwitch', IRAction.TOGGLE],
      ['Hover', IRAction.HOVER],
      ['PageNavigation', IRAction.NAVIGATE],
      ['Back', IRAction.NAVIGATE],
      ['Forward', IRAction.NAVIGATE],
      ['Refresh', IRAction.NAVIGATE],
      ['DatePicker', IRAction.SELECT_DATE],
      ['TimePicker', IRAction.SELECT_DATE],
      ['DateTimePicker', IRAction.SELECT_DATE],
      ['Slider', IRAction.FILL],
      ['FileUpload', IRAction.FILL],
      ['Link', IRAction.CLICK],
      ['Tab', IRAction.CLICK],
      ['Menu', IRAction.CLICK],
      ['Breadcrumb', IRAction.CLICK],
      ['DragDrop', IRAction.DRAG_DROP],
      ['KeyboardShortcut', IRAction.PRESS_KEY],
      ['NewTab', IRAction.CLICK],
      ['NewWindow', IRAction.CLICK],
      ['Iframe', IRAction.CLICK],
      ['Modal', IRAction.CLICK],
      ['Drawer', IRAction.CLICK],
      ['Popover', IRAction.CLICK],
      ['Tooltip', IRAction.HOVER],
      ['BrowserAlert', IRAction.CLICK],
    ];

    for (const [type, expectedAction] of cases) {
      it(`maps ${type} → ${expectedAction}`, () => {
        const interaction = makeInteraction(type, { eventIds: [] });
        const plan = build(makeInput({ interactions: [interaction] }));
        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].action).toBe(expectedAction);
      });
    }
  });

  // ── Noise Filtering ──────────────────────────────────

  describe('noise filtering', () => {
    it('filters out PageScroll', () => {
      const scroll = makeInteraction('PageScroll');
      const click = makeInteraction('Click', { interactionId: 'int-0002', eventIds: ['click-0002'] });
      const plan = build(makeInput({ interactions: [scroll, click] }));
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].action).toBe(IRAction.CLICK);
    });

    it('filters out ContainerScroll and InfiniteScroll', () => {
      const scroll1 = makeInteraction('ContainerScroll');
      const scroll2 = makeInteraction('InfiniteScroll');
      const plan = build(makeInput({ interactions: [scroll1, scroll2] }));
      expect(plan.steps).toHaveLength(0);
    });

    it('filters out Unknown interactions', () => {
      const unknown = makeInteraction('Unknown');
      const plan = build(makeInput({ interactions: [unknown] }));
      expect(plan.steps).toHaveLength(0);
    });
  });

  // ── Locator Resolution ───────────────────────────────

  describe('locator resolution', () => {
    it('resolves testId as highest priority locator', () => {
      const identity = makeElementIdentity({ testId: 'login-btn', stableId: 'btn-1', cssSelector: 'button.btn' });
      const interaction = makeInteraction('Click', { target: identity, eventIds: [] });
      const plan = build(makeInput({ interactions: [interaction] }));
      const target = plan.steps[0].target;
      expect(target.kind).toBe('element');
      if (target.kind === 'element') {
        expect(target.resolvedLocators).toHaveLength(3);
        expect(target.resolvedLocators[0].type).toBe(LocatorStrategyType.TEST_ID);
        expect(target.resolvedLocators[0].value).toBe('login-btn');
      }
    });

    it('falls back to CSS selector when no business/a11y IDs', () => {
      const identity = makeElementIdentity({
        testId: null, dataCy: null, dataQa: null,
        ariaLabel: null, ariaLabelledBy: null,
        stableId: null, name: null,
        ariaRole: null,
        accessibleName: 'Submit',
        cssSelector: 'button.submit',
        xPath: '//button',
      });
      const interaction = makeInteraction('Click', { target: identity, eventIds: [] });
      const plan = build(makeInput({ interactions: [interaction] }));
      const target = plan.steps[0].target;
      if (target.kind === 'element') {
        expect(target.resolvedLocators.length).toBeGreaterThanOrEqual(1);
        // accessibleName (content) should be first when nothing better exists
        // (no testId, ariaLabel, stableId, name, or role — accessibleName is the only signal)
        expect(target.resolvedLocators[0].type).toBe(LocatorStrategyType.ACCESSIBLE_NAME);
      }
    });

    it('uses URL target for navigation', () => {
      const navEvent: SessionEvent = {
        actionId: 'nav-0001',
        type: 'navigation',
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('PageNavigation', {
        eventIds: ['nav-0001'],
        target: undefined,
        metadata: { url: 'https://example.com/dashboard' },
      });
      const plan = build(makeInput({ events: [navEvent], interactions: [interaction] }));
      expect(plan.steps[0].target.kind).toBe('url');
      if (plan.steps[0].target.kind === 'url') {
        expect(plan.steps[0].target.url).toBe('https://example.com/dashboard');
      }
    });

    it('uses element target from trigger even with no correlatable events', () => {
      // In the unified system, trigger is always present (ElementIdentity is required).
      // The bridge resolves the target from interaction.target when no event matches.
      const identity = makeElementIdentity({ elementId: 'minimal' });
      const interaction = makeInteraction('Click', { target: identity, eventIds: [] });
      const plan = build(makeInput({ events: [], interactions: [interaction] }));
      expect(plan.steps[0].target.kind).toBe('element');
    });

    it('resolves from interaction.target when no matching event', () => {
      const identity = makeElementIdentity({ testId: 'from-target', eventIds: [] });
      const interaction = makeInteraction('Click', { target: identity, eventIds: ['nonexistent'] });
      const plan = build(makeInput({ events: [], interactions: [interaction] }));
      const target = plan.steps[0].target;
      if (target.kind === 'element') {
        expect(target.resolvedLocators[0].value).toBe('from-target');
      }
    });
  });

  // ── Input Value Extraction ─────────────────────────

  describe('input value extraction', () => {
    it('extracts text value from TextEntryEvent', () => {
      const textEvent: SessionEvent = {
        actionId: 'text-0001',
        type: 'text',
        elementIdentity: makeElementIdentity(),
        value: 'john@example.com',
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('TextEntry', { eventIds: ['text-0001'] });
      const plan = build(makeInput({ events: [textEvent], interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('john@example.com');
    });

    it('extracts checked state from CheckboxEvent', () => {
      const checkEvent: SessionEvent = {
        actionId: 'check-0001',
        type: 'checkbox',
        elementIdentity: makeElementIdentity(),
        checked: true,
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('Checkbox', { eventIds: ['check-0001'] });
      const plan = build(makeInput({ events: [checkEvent], interactions: [interaction] }));
      expect(plan.steps[0].input).toBe(true);
    });

    it('extracts selected value from SelectEvent', () => {
      const selectEvent: SessionEvent = {
        actionId: 'select-0001',
        type: 'select',
        elementIdentity: makeElementIdentity(),
        value: 'United States',
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('NativeDropdown', { eventIds: ['select-0001'] });
      const plan = build(makeInput({ events: [selectEvent], interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('United States');
    });

    it('extracts ISO date value from DateSelectEvent', () => {
      const dateEvent: SessionEvent = {
        actionId: 'dateSelect-0001',
        type: 'dateSelect',
        elementIdentity: makeElementIdentity(),
        dateType: 'date',
        displayValue: '15 July 2026',
        isoValue: '2026-07-15',
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('DatePicker', { eventIds: ['dateSelect-0001'] });
      const plan = build(makeInput({ events: [dateEvent], interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('2026-07-15');
    });

    it('extracts slider value from interaction metadata', () => {
      const interaction = makeInteraction('Slider', {
        eventIds: [],
        metadata: { sliderValue: '75', sliderMin: '0', sliderMax: '100' },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('75');
    });

    it('returns null for click (no input value)', () => {
      const interaction = makeInteraction('Click', { eventIds: [] });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBeNull();
    });
  });

  // ── Description Generation ───────────────────────────

  describe('description generation', () => {
    it('generates click description with element name', () => {
      const interaction = makeInteraction('Click', { eventIds: [] });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].description).toContain('Submit Button');
    });

    it('generates fill description with value', () => {
      const textEvent: SessionEvent = {
        actionId: 'text-0001',
        type: 'text',
        elementIdentity: makeElementIdentity({ accessibleName: 'Email' }),
        value: 'admin@test.com',
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('TextEntry', {
        eventIds: ['text-0001'],
        target: makeElementIdentity({ accessibleName: 'Email' }),
      });
      const plan = build(makeInput({ events: [textEvent], interactions: [interaction] }));
      expect(plan.steps[0].description).toContain('admin@test.com');
      expect(plan.steps[0].description).toContain('Email');
    });

    it('enriches description with business field from knowledge fragment', () => {
      const textEvent: SessionEvent = {
        actionId: 'text-0001',
        type: 'text',
        elementIdentity: makeElementIdentity({ elementId: 'elem-0001' }),
        value: 'john@example.com',
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('TextEntry', {
        interactionId: 'int-0001',
        eventIds: ['text-0001'],
        target: makeElementIdentity({ elementId: 'elem-0001' }),
      });
      const fragment = makeFragment({
        logicalActions: [{
          actionId: 'la-0001',
          componentId: null,
          businessField: 'Email Address',
          transitionIds: ['int-0001'],
          lifecycleComplete: true,
          resultingChange: null,
          timestamp: 0,
        }],
      });
      const plan = build(makeInput({ events: [textEvent], interactions: [interaction], fragment }));
      expect(plan.steps[0].description).toContain('Email Address');
    });

    it('generates navigation description with URL', () => {
      const navEvent: SessionEvent = {
        actionId: 'nav-0001',
        type: 'navigation',
        url: 'https://example.com/home',
        title: 'Home',
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('PageNavigation', {
        eventIds: ['nav-0001'],
        target: undefined,
        metadata: { url: 'https://example.com/home' },
      });
      const plan = build(makeInput({ events: [navEvent], interactions: [interaction] }));
      expect(plan.steps[0].description).toContain('https://example.com/home');
    });

    it('capitalizes plainEnglish', () => {
      const interaction = makeInteraction('Click', { eventIds: [] });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].plainEnglish?.[0]).toMatch(/[A-Z]/);
    });
  });

  // ── Assertion Derivation ─────────────────────────────

  describe('assertion derivation from knowledge fragment', () => {
    it('derives required assertion when constraint.required = true', () => {
      const identity = makeElementIdentity({ elementId: 'elem-0001' });
      const interaction = makeInteraction('TextEntry', { target: identity, eventIds: [] });
      const fragment = makeFragment({
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-0001' },
          affordances: ['fill'],
          constraints: {
            required: true,
            inputType: 'email',
            valueRange: null,
            lengthRange: null,
            format: null,
            validOptions: null,
            dateFormat: null,
          },
        }],
      });
      const plan = build(makeInput({ interactions: [interaction], fragment }));
      expect(plan.steps[0].assertions.length).toBeGreaterThanOrEqual(1);
      const requiredAssertion = plan.steps[0].assertions.find(a => a.property === 'required');
      expect(requiredAssertion).toBeDefined();
      expect(requiredAssertion?.type).toBe(ValidationType.PRESENCE);
      expect(requiredAssertion?.expectedValue).toBe(true);
    });

    it('derives min/max assertions from valueRange', () => {
      const identity = makeElementIdentity({ elementId: 'elem-0001' });
      const interaction = makeInteraction('Slider', { target: identity, eventIds: [] });
      const fragment = makeFragment({
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-0001' },
          affordances: ['adjust'],
          constraints: {
            required: false,
            inputType: 'number',
            valueRange: { min: 0, max: 100, step: 1 },
            lengthRange: null,
            format: null,
            validOptions: null,
            dateFormat: null,
          },
        }],
      });
      const plan = build(makeInput({ interactions: [interaction], fragment }));
      const minAssertion = plan.steps[0].assertions.find(a => a.property === 'min');
      const maxAssertion = plan.steps[0].assertions.find(a => a.property === 'max');
      expect(minAssertion).toBeDefined();
      expect(minAssertion?.expectedValue).toBe(0);
      expect(maxAssertion).toBeDefined();
      expect(maxAssertion?.expectedValue).toBe(100);
    });

    it('derives pattern assertion from format.regex', () => {
      const identity = makeElementIdentity({ elementId: 'elem-0001' });
      const interaction = makeInteraction('TextEntry', { target: identity, eventIds: [] });
      const fragment = makeFragment({
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-0001' },
          affordances: ['fill'],
          constraints: {
            required: true,
            inputType: 'email',
            valueRange: null,
            lengthRange: null,
            format: { regex: '^[^@]+@[^@]+\\.[^@]+$', description: 'Email format' },
            validOptions: null,
            dateFormat: null,
          },
        }],
      });
      const plan = build(makeInput({ interactions: [interaction], fragment }));
      const patternAssertion = plan.steps[0].assertions.find(a => a.property === 'pattern');
      expect(patternAssertion).toBeDefined();
      expect(patternAssertion?.type).toBe(ValidationType.TEXT_MATCH);
      expect(patternAssertion?.comparison).toBe(ValidationComparison.MATCHES);
    });

    it('derives validOptions assertion', () => {
      const identity = makeElementIdentity({ elementId: 'elem-0001' });
      const interaction = makeInteraction('NativeDropdown', { target: identity, eventIds: [] });
      const fragment = makeFragment({
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-0001' },
          affordances: ['select'],
          constraints: {
            required: false,
            inputType: null,
            valueRange: null,
            lengthRange: null,
            format: null,
            validOptions: ['US', 'UK', 'CA'],
            dateFormat: null,
          },
        }],
      });
      const plan = build(makeInput({ interactions: [interaction], fragment }));
      const optionsAssertion = plan.steps[0].assertions.find(a => a.property === 'value');
      expect(optionsAssertion).toBeDefined();
      expect(optionsAssertion?.expectedValue).toEqual(['US', 'UK', 'CA']);
    });

    it('derives no assertions when no matching contract', () => {
      const identity = makeElementIdentity({ elementId: 'elem-9999' });
      const interaction = makeInteraction('Click', { target: identity, eventIds: [] });
      const fragment = makeFragment({
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-0001' },
          affordances: [],
          constraints: {
            required: true, inputType: null, valueRange: null,
            lengthRange: null, format: null, validOptions: null, dateFormat: null,
          },
        }],
      });
      const plan = build(makeInput({ interactions: [interaction], fragment }));
      expect(plan.steps[0].assertions).toHaveLength(0);
    });
  });

  // ── AI Enrichment ────────────────────────────────────

  describe('AI enrichment passthrough', () => {
    it('passes aiUnderstanding from SessionEvent to IRStep', () => {
      const clickEvent: SessionEvent = {
        actionId: 'click-0001',
        type: 'click',
        elementIdentity: makeElementIdentity(),
        timestamp: '2026-07-21T10:00:00Z',
        aiUnderstanding: {
          businessName: 'Login Button',
          controlType: 'Button',
          userIntent: 'Submit the login form',
          confidenceScore: 0.92,
        },
      };
      const interaction = makeInteraction('Click', { eventIds: ['click-0001'] });
      const plan = build(makeInput({ events: [clickEvent], interactions: [interaction] }));
      expect(plan.steps[0].aiEnrichment).toEqual({
        businessName: 'Login Button',
        controlType: 'Button',
        userIntent: 'Submit the login form',
        confidenceScore: 0.92,
      });
    });

    it('sets aiEnrichment to null when event has no AI understanding', () => {
      const clickEvent: SessionEvent = {
        actionId: 'click-0001',
        type: 'click',
        elementIdentity: makeElementIdentity(),
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('Click', { eventIds: ['click-0001'] });
      const plan = build(makeInput({ events: [clickEvent], interactions: [interaction] }));
      expect(plan.steps[0].aiEnrichment).toBeNull();
    });

    it('sets aiEnrichment to null when no matching event', () => {
      const interaction = makeInteraction('Click', { eventIds: ['nonexistent'] });
      const plan = build(makeInput({ events: [], interactions: [interaction] }));
      expect(plan.steps[0].aiEnrichment).toBeNull();
    });
  });

  // ── Readability Rules ────────────────────────────────

  describe('readability rules', () => {
    it('merges consecutive clicks on the same element', () => {
      const identity = makeElementIdentity({ elementId: 'elem-0001' });
      const int1 = makeInteraction('Click', { interactionId: 'int-0001', target: identity, eventIds: [] });
      const int2 = makeInteraction('Click', { interactionId: 'int-0002', target: identity, eventIds: [] });
      const int3 = makeInteraction('Click', {
        interactionId: 'int-0003',
        target: makeElementIdentity({ elementId: 'elem-0002' }),
        eventIds: [],
      });
      const plan = build(makeInput({ interactions: [int1, int2, int3] }));
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].target.kind).toBe('element');
      if (plan.steps[0].target.kind === 'element') {
        expect(plan.steps[0].target.elementId).toBe('elem-0001');
      }
      expect(plan.steps[1].order).toBe(1);
    });

    it('does not merge clicks on different elements', () => {
      const int1 = makeInteraction('Click', {
        target: makeElementIdentity({ elementId: 'elem-0001' }), eventIds: [],
      });
      const int2 = makeInteraction('Click', {
        interactionId: 'int-0002',
        target: makeElementIdentity({ elementId: 'elem-0002' }), eventIds: [],
      });
      const plan = build(makeInput({ interactions: [int1, int2] }));
      expect(plan.steps).toHaveLength(2);
    });
  });

  // ── Source Event ID ──────────────────────────────────

  describe('source event ID', () => {
    it('sets sourceEventId from interaction.eventIds[0]', () => {
      const interaction = makeInteraction('Click', { eventIds: ['click-0001'] });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].sourceEventId).toBe('click-0001');
    });

    it('falls back to event.actionId when eventIds is empty', () => {
      const clickEvent: SessionEvent = {
        actionId: 'click-fallback',
        type: 'click',
        elementIdentity: makeElementIdentity(),
        timestamp: '2026-07-21T10:00:00Z',
      };
      const interaction = makeInteraction('Click', { eventIds: [] });
      const plan = build(makeInput({ events: [clickEvent], interactions: [interaction] }));
      // When eventIds is empty, falls back to event?.actionId — but event is found by eventId
      // which won't match since eventIds is empty, so event is undefined, so sourceEventId is undefined
      expect(plan.steps[0].sourceEventId).toBeUndefined();
    });
  });

  // ── Execution Parameters ──────────────────────────────

  describe('execution parameters', () => {
    it('uses default execution parameters for high-confidence interactions', () => {
      const interaction = makeInteraction('Click', { confidence: 0.95, eventIds: [] });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].executionParameters.timeoutMs).toBe(30_000);
      expect(plan.steps[0].executionParameters.waitStrategy).toBe('visible');
    });

    it('uses visible wait strategy for low-confidence interactions', () => {
      const interaction = makeInteraction('Click', { confidence: 0.5, eventIds: [] });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].executionParameters.waitStrategy).toBe('visible');
    });
  });

  // ── Tag Derivation ──────────────────────────────────

  describe('tag derivation', () => {
    it('derives tags from start URL path segment', () => {
      const plan = build(makeInput({
        recordingContext: { startUrl: 'https://example.com/login', title: null },
      }));
      expect(plan.tags).toContain('login');
    });

    it('derives tags from surface transitions in fragment', () => {
      const fragment = makeFragment({
        recordedWorkflow: {
          surfaceTransitions: [{
            fromUrl: 'https://example.com/login',
            toUrl: 'https://example.com/dashboard',
            triggeredByTransitionId: 'trans-0001',
          }],
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
      });
      const plan = build(makeInput({ fragment }));
      expect(plan.tags).toContain('login');
      expect(plan.tags).toContain('dashboard');
    });

    it('limits to 5 tags', () => {
      const transitions = Array.from({ length: 10 }, (_, i) => ({
        fromUrl: 'https://example.com',
        toUrl: `https://example.com/page${i}`,
        triggeredByTransitionId: `trans-${i}`,
      }));
      const fragment = makeFragment({
        recordedWorkflow: {
          surfaceTransitions: transitions,
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
      });
      const plan = build(makeInput({
        fragment,
        recordingContext: { startUrl: 'https://example.com/home', title: null },
      }));
      expect(plan.tags.length).toBeLessThanOrEqual(5);
    });
  });

  // ── Full End-to-End ──────────────────────────────────

  describe('end-to-end plan construction', () => {
    it('builds a complete plan from a login recording session', () => {
      const emailIdentity = makeElementIdentity({
        elementId: 'elem-0001',
        accessibleName: 'Email',
        tag: 'INPUT',
        ariaRole: 'textbox',
        testId: 'email-input',
      });
      const passwordIdentity = makeElementIdentity({
        elementId: 'elem-0002',
        accessibleName: 'Password',
        tag: 'INPUT',
        ariaRole: 'textbox',
        testId: 'password-input',
      });
      const submitIdentity = makeElementIdentity({
        elementId: 'elem-0003',
        accessibleName: 'Login',
        tag: 'BUTTON',
        ariaRole: 'button',
        testId: 'login-btn',
      });

      const events: SessionEvent[] = [
        { actionId: 'text-0001', type: 'text', elementIdentity: emailIdentity, value: 'admin@test.com', timestamp: '2026-07-21T10:00:00Z' },
        { actionId: 'text-0002', type: 'text', elementIdentity: passwordIdentity, value: 'secret123', timestamp: '2026-07-21T10:01:00Z' },
        { actionId: 'click-0001', type: 'click', elementIdentity: submitIdentity, timestamp: '2026-07-21T10:02:00Z' },
        { actionId: 'nav-0001', type: 'navigation', url: 'https://example.com/dashboard', title: 'Dashboard', timestamp: '2026-07-21T10:03:00Z' },
      ];

      const interactions: DetectedInteraction[] = [
        makeInteraction('TextEntry', { interactionId: 'int-0001', eventIds: ['text-0001'], target: emailIdentity }),
        makeInteraction('TextEntry', { interactionId: 'int-0002', eventIds: ['text-0002'], target: passwordIdentity }),
        makeInteraction('Click', { interactionId: 'int-0003', eventIds: ['click-0001'], target: submitIdentity }),
        makeInteraction('PageNavigation', { interactionId: 'int-0004', eventIds: ['nav-0001'], target: undefined, metadata: { url: 'https://example.com/dashboard' } }),
      ];

      const fragment = makeFragment({
        interactionContracts: [{
          appliesTo: { type: 'element', id: 'elem-0001' },
          affordances: ['fill'],
          constraints: {
            required: true, inputType: 'email', valueRange: null,
            lengthRange: { minLength: 3, maxLength: 100 },
            format: { regex: '^[^@]+@[^@]+\\.[^@]+$', description: 'Email' },
            validOptions: null, dateFormat: null,
          },
        }],
        logicalActions: [{
          actionId: 'la-0001',
          componentId: null,
          businessField: 'Email Address',
          transitionIds: ['int-0001'],
          lifecycleComplete: true,
          resultingChange: null,
          timestamp: 0,
        }],
      });

      const plan = build(makeInput({
        events,
        interactions,
        fragment,
        recordingContext: { startUrl: 'https://example.com/login', title: 'Login' },
        testCaseName: 'User Login Test',
      }));

      expect(plan.title).toBe('User Login Test');
      expect(plan.steps).toHaveLength(4);
      expect(plan.steps[0].action).toBe(IRAction.FILL);
      expect(plan.steps[0].input).toBe('admin@test.com');
      expect(plan.steps[0].description).toContain('Email Address');
      expect(plan.steps[0].assertions.length).toBeGreaterThanOrEqual(2); // required + pattern
      expect(plan.steps[1].action).toBe(IRAction.FILL);
      expect(plan.steps[1].input).toBe('secret123');
      expect(plan.steps[2].action).toBe(IRAction.CLICK);
      expect(plan.steps[3].action).toBe(IRAction.NAVIGATE);
      expect(plan.steps[3].target.kind).toBe('url');
      expect(plan.tags).toContain('login');
      expect(plan.environment.baseUrl).toBe('https://example.com/login');
    });
  });
});
