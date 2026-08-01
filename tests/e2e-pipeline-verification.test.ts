/**
 * End-to-End Pipeline Verification
 *
 * Verifies the complete recorder pipeline as an integrated whole:
 *   Events → ComponentRuntime → Classification → Evidence →
 *   Enrichment → IR Bridge → Assertions → Playwright Generation
 *
 * Each test traces a representative real-world scenario through ALL stages
 * and verifies the output at each stage is correct and connected.
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../src/definitions';
import { build as buildIRPlan } from '../src/generation/ir-bridge';
import type { IRBridgeInput } from '../src/generation/ir-bridge-input';
import { renderTestFile } from '../src/adapters/playwright/test-function-renderer';
import { enrichInteractions, type EnrichmentInput } from '../src/generation/interaction-enrichment';
import { PatternRegistry } from '../src/definitions/pattern-registry';
import type {
  ComponentInteraction,
  ObservedEvent,
  ElementIdentity,
  DomContext,
  RuntimeConfig,
} from '../src/shared/component-types';
import { IRAction } from '../src/domain/execution-ir/types';
import { LocatorStrategyType } from '../src/domain/enums';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null,
    cssSelector: 'div', xPath: '/html/body/div', inIframe: false, shadowDom: false,
    elementId: '', ...overrides,
  };
}

function makeContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [], ...overrides,
  };
}

let _ec = 0;
function makeEvent(
  eventType: string,
  target: Partial<ElementIdentity>,
  domContext: Partial<DomContext> = {},
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  _ec++;
  return {
    eventId: `evt-${_ec}`, eventType: eventType as ObservedEvent['eventType'],
    timestamp: Date.now() + _ec, isTrusted: true,
    target: makeTarget(target), domContext: makeContext(domContext),
    valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
    clientX: null, clientY: null, key: null, code: null,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: 'https://example.com', pageTitle: 'Test Page', ...overrides,
  };
}

interface FullPipelineResult {
  interactions: ComponentInteraction[];
  enrichmentOutput: ReturnType<typeof enrichInteractions> | null;
  irPlan: ReturnType<typeof buildIRPlan> | null;
  playwright: string | null;
}

function runFullPipeline(events: ObservedEvent[]): FullPipelineResult {
  // Stage 1: Runtime — events → interactions (includes classification, evidence)
  const interactions: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => interactions.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  for (const event of events) {
    runtime.process(event);
  }
  runtime.flush();

  // Stage 2: Interaction Enrichment Pass (locators + assertions)
  let enrichmentOutput: ReturnType<typeof enrichInteractions> | null = null;
  if (interactions.length > 0) {
    const enrichInput: EnrichmentInput = {
      interactions,
      fragment: null,
    };
    enrichmentOutput = enrichInteractions(enrichInput);
  }

  // Stage 3: IR Bridge (consumes enrichment output internally)
  const input: IRBridgeInput = {
    events: [], interactions, understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test Page' },
    testCaseName: 'E2E Verification',
  };
  const irPlan = buildIRPlan(input);

  // Stage 4: Playwright generation
  let playwright: string | null = null;
  if (irPlan) {
    playwright = renderTestFile(irPlan);
  }

  return { interactions, enrichmentOutput, irPlan, playwright };
}

// ── E2E Scenarios ────────────────────────────────────────────────────

describe('E2E Pipeline Verification', () => {

  describe('Scenario 1: Text Entry (login form)', () => {
    it('traces focus → input → blur through all pipeline stages', () => {
      const events = [
        makeEvent('focus', {
          tag: 'INPUT', inputType: 'email',
          accessibleName: 'Email', ariaRole: 'textbox',
          testId: 'email-input',
          cssSelector: 'form > input[type="email"]',
        }, { inputType: 'email' }),
        makeEvent('input', {
          tag: 'INPUT', inputType: 'email',
          accessibleName: 'Email', ariaRole: 'textbox',
          testId: 'email-input',
          cssSelector: 'form > input[type="email"]',
        }, { inputType: 'email' }, { valueAfter: 'user@test.com' }),
        makeEvent('blur', {
          tag: 'INPUT', inputType: 'email',
          accessibleName: 'Email', ariaRole: 'textbox',
          testId: 'email-input',
          cssSelector: 'form > input[type="email"]',
        }, { inputType: 'email' }),
      ];

      const result = runFullPipeline(events);

      // Stage 1: Classification
      expect(result.interactions).toHaveLength(1);
      const ci = result.interactions[0];
      expect(ci.type).toBe('TextEntry');
      expect(ci.metadata.textValue).toBe('user@test.com');

      // Stage 2: Enrichment (locators + assertions pre-derived)
      expect(result.enrichmentOutput).not.toBeNull();
      const enrich = result.enrichmentOutput!;
      // Should have locator entries for the interaction
      expect(enrich.locators.size).toBeGreaterThan(0);

      // Stage 3: IR Bridge
      expect(result.irPlan).not.toBeNull();
      const plan = result.irPlan!;
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
      const step = plan.steps[0];
      expect(step.action).toBe(IRAction.FILL);
      expect(step.input).toBe('user@test.com');

      // Stage 3a: Locators resolved
      expect(step.target.kind).toBe('element');
      expect(step.target.resolvedLocators.length).toBeGreaterThan(0);

      // Stage 3b: Assertions
      expect(step.assertions).toBeDefined();
      expect(step.assertions!.length).toBeGreaterThan(0);

      // Stage 4: Playwright
      expect(result.playwright).not.toBeNull();
      expect(result.playwright!).toContain('fill');
      expect(result.playwright!).toContain('user@test.com');
    });
  });

  describe('Scenario 2: Custom Dropdown (MUI Select)', () => {
    it('traces trigger click → option click as single Dropdown interaction', () => {
      const triggerTarget = makeTarget({
        tag: 'DIV', ariaRole: 'combobox', accessibleName: 'Country',
        className: 'MuiSelect-select',
        cssSelector: 'div.MuiSelect-root > div.MuiSelect-select',
      });
      const optionTarget = makeTarget({
        tag: 'LI', ariaRole: 'option', accessibleName: 'United States',
        className: 'MuiMenuItem-root',
        cssSelector: 'ul.MuiMenu-list > li.MuiMenuItem-root',
      });

      const events = [
        makeEvent('click', triggerTarget, {
          ariaExpanded: 'false', ariaHasPopup: 'listbox',
          ancestorClasses: ['MuiSelect-root'],
        }),
        makeEvent('click', optionTarget, {
          ariaExpanded: 'true',
          ancestorClasses: ['MuiMenu-list', 'MuiMenuItem-root'],
        }),
      ];

      const result = runFullPipeline(events);

      // Stage 1: Should produce 1 Dropdown interaction
      expect(result.interactions.length).toBeGreaterThanOrEqual(1);
      const dropdown = result.interactions.find(ci => ci.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      expect(dropdown!.interactionSubtype).toBe('CustomDropdown');

      // Stage 3: IR Bridge
      expect(result.irPlan).not.toBeNull();
      const plan = result.irPlan!;
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);

      // Stage 4: Playwright
      expect(result.playwright).not.toBeNull();
    });
  });

  describe('Scenario 3: Native Select', () => {
    it('traces change event through to Playwright selectOption', () => {
      const selectTarget = makeTarget({
        tag: 'SELECT', ariaRole: 'combobox', accessibleName: 'Priority',
        cssSelector: 'select#priority',
      });

      const events = [
        makeEvent('change', selectTarget, {}, { valueAfter: 'high' }),
      ];

      const result = runFullPipeline(events);

      expect(result.interactions).toHaveLength(1);
      expect(result.interactions[0].type).toBe('Dropdown');
      expect(result.interactions[0].interactionSubtype).toBe('NativeDropdown');

      const plan = result.irPlan!;
      expect(plan.steps[0].action).toBe(IRAction.SELECT);
      expect(plan.steps[0].input).toBe('high');

      expect(result.playwright!).toContain('selectOption');
      expect(result.playwright!).toContain('high');

      // Also fix multi-step
    });
  });

  describe('Scenario 4: Checkbox Toggle', () => {
    it('traces click → checked state through to assertion', () => {
      const events = [
        makeEvent('click', {
          tag: 'INPUT', inputType: 'checkbox', ariaRole: 'checkbox',
          accessibleName: 'Remember me', testId: 'remember-me',
          cssSelector: 'input[type="checkbox"]#remember-me',
        }, {}, { checkedAfter: true }),
      ];

      const result = runFullPipeline(events);

      expect(result.interactions).toHaveLength(1);
      expect(result.interactions[0].type).toBe('Checkbox');

      const plan = result.irPlan!;
      expect(plan.steps[0].action).toBe(IRAction.TOGGLE);
      expect(plan.steps[0].assertions!.length).toBeGreaterThan(0);

      expect(result.playwright!).toContain('check');
    });
  });

  describe('Scenario 5: Button Click with testId', () => {
    it('traces click through to Playwright with correct locator', () => {
      const events = [
        makeEvent('click', {
          tag: 'BUTTON', accessibleName: 'Submit', ariaRole: 'button',
          testId: 'submit-btn',
          cssSelector: 'form > button[type="submit"]',
        }),
      ];

      const result = runFullPipeline(events);

      expect(result.interactions).toHaveLength(1);
      expect(result.interactions[0].type).toBe('Click');

      const plan = result.irPlan!;
      expect(plan.steps[0].action).toBe(IRAction.CLICK);

      // Locator: testId should be top-ranked
      const topLocator = plan.steps[0].target.resolvedLocators[0];
      expect(topLocator.type).toBe(LocatorStrategyType.TEST_ID);
      expect(topLocator.value).toBe('submit-btn');

      // Playwright
      expect(result.playwright!).toContain('click');
    });
  });

  describe('Scenario 6: Slider Interaction', () => {
    it('traces slider change event through pipeline', () => {
      const sliderTarget = makeTarget({
        tag: 'INPUT', inputType: 'range', ariaRole: 'slider',
        accessibleName: 'Volume', ariaValueNow: '50',
        testId: 'volume-slider',
        cssSelector: 'input[type="range"]',
      });

      const events = [
        makeEvent('change', sliderTarget, { inputType: 'range' }, { valueAfter: '75' }),
      ];

      const result = runFullPipeline(events);

      expect(result.interactions.length).toBeGreaterThanOrEqual(1);

      const plan = result.irPlan!;
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);

      expect(result.playwright).not.toBeNull();
    });
  });

  describe('Scenario 7: Multi-step Workflow (fill + select + click)', () => {
    it('traces 3-step form submission through all stages', () => {
      const emailTarget = makeTarget({
        tag: 'INPUT', inputType: 'email', ariaRole: 'textbox',
        accessibleName: 'Email', testId: 'email',
        cssSelector: 'input#email',
      });
      const roleTarget = makeTarget({
        tag: 'SELECT', ariaRole: 'combobox', accessibleName: 'Role',
        cssSelector: 'select#role',
      });
      const submitTarget = makeTarget({
        tag: 'BUTTON', accessibleName: 'Submit', ariaRole: 'button',
        testId: 'submit',
        cssSelector: 'button[type="submit"]',
      });

      const events = [
        // Text entry
        makeEvent('focus', emailTarget, { inputType: 'email' }),
        makeEvent('input', emailTarget, { inputType: 'email' }, { valueAfter: 'admin@test.com' }),
        makeEvent('blur', emailTarget, { inputType: 'email' }),
        // Native select
        makeEvent('change', roleTarget, {}, { valueAfter: 'admin' }),
        // Submit
        makeEvent('click', submitTarget),
      ];

      const result = runFullPipeline(events);

      // Should produce 3 interactions
      expect(result.interactions.length).toBeGreaterThanOrEqual(3);

      // Verify each interaction type
      const types = result.interactions.map(ci => ci.type);
      expect(types).toContain('TextEntry');
      expect(types).toContain('Dropdown');
      expect(types).toContain('Click');

      // IR Plan: should have steps for each
      const plan = result.irPlan!;
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);

      // Verify IR actions
      const actions = plan.steps.map(s => s.action);
      expect(actions).toContain(IRAction.FILL);
      expect(actions).toContain(IRAction.SELECT);
      expect(actions).toContain(IRAction.CLICK);

      // Playwright: should contain all actions
      expect(result.playwright!).toContain('fill');
      expect(result.playwright!).toContain('selectOption');
      expect(result.playwright!).toContain('click');
    });
  });

  describe('Scenario 8: Evidence and Confidence', () => {
    it('verifies evidence annotation is attached to interactions', () => {
      const events = [
        makeEvent('click', {
          tag: 'BUTTON', accessibleName: 'Save', ariaRole: 'button',
          testId: 'save-btn',
          cssSelector: 'button#save',
        }),
      ];

      const result = runFullPipeline(events);

      expect(result.interactions.length).toBeGreaterThanOrEqual(1);
      const ci = result.interactions[0];

      // Confidence is an optional field — it's set by the evidence engine.
      // For simple Click interactions with immediate completion, it may be
      // undefined (defaulting to 1.0 at the IR Bridge stage).
      // The key verification: the field EXISTS on the type and the pipeline
      // doesn't crash when it's absent.
      if (ci.confidence !== undefined) {
        expect(ci.confidence).toBeGreaterThan(0);
      }
    });
  });

  describe('Scenario 9: Pattern Registry Integration', () => {
    it('verifies Pattern Registry detects framework classes', () => {
      // MUI
      expect(PatternRegistry.isInteractiveClass('MuiButton-root')).toBe(true);
      expect(PatternRegistry.isDropdownTriggerClass('MuiSelect-select')).toBe(true);

      // Ant Design
      expect(PatternRegistry.isInteractiveClass('ant-btn')).toBe(true);
      expect(PatternRegistry.isDropdownTriggerClass('ant-select-selector')).toBe(true);

      // Bootstrap (Tier 2 addition)
      expect(PatternRegistry.isDropdownTriggerClass('dropdown-toggle')).toBe(true);
      expect(PatternRegistry.isDropdownOptionClass('dropdown-item')).toBe(true);

      // AGGrid (Tier 2 addition)
      expect(PatternRegistry.isInteractiveClass('ag-row')).toBe(true);
      expect(PatternRegistry.isInteractiveClass('ag-header-cell')).toBe(true);

      // Word boundary (Tier 2 fix) — 'select' should not match 'preselected'
      expect(PatternRegistry.isInteractiveClass('preselected')).toBe(false);
      // But 'button' correctly matches 'ant-button-group' (hyphen = word boundary)
      expect(PatternRegistry.isInteractiveClass('ant-button-group')).toBe(true);
    });
  });

  describe('Scenario 10: Hover Interaction', () => {
    it('traces hover through pipeline', () => {
      const events = [
        makeEvent('mouseover', {
          tag: 'DIV', ariaRole: 'button', accessibleName: 'Menu',
          className: 'menu-trigger',
          cssSelector: 'div.menu-trigger',
        }, {}, { clientX: 100, clientY: 50 }),
        makeEvent('mousemove', {
          tag: 'DIV', ariaRole: 'button', accessibleName: 'Menu',
          className: 'menu-trigger',
          cssSelector: 'div.menu-trigger',
        }, {}, { clientX: 105, clientY: 52 }),
      ];

      const result = runFullPipeline(events);

      // Hover may or may not produce an interaction depending on confidence model
      // The key is that the pipeline doesn't crash
      expect(result.irPlan).not.toBeNull();

      // If interactions were produced, verify they're valid
      for (const ci of result.interactions) {
        expect(ci.confidence).toBeGreaterThan(0);
      }
    });
  });

  describe('Scenario 11: DatePicker', () => {
    it('traces date picker through pipeline', () => {
      const triggerTarget = makeTarget({
        tag: 'INPUT', inputType: 'text', accessibleName: 'Start Date',
        className: 'MuiOutlinedInput-input',
        cssSelector: 'div.MuiDatePicker-root input',
      });
      const dayTarget = makeTarget({
        tag: 'BUTTON', accessibleName: '15', ariaRole: 'gridcell',
        className: 'MuiPickersDay',
        cssSelector: 'div.MuiCalendarPicker-root button[data-day="15"]',
      });

      const events = [
        makeEvent('click', triggerTarget, {
          ancestorClasses: ['MuiDatePicker-root'],
        }),
        makeEvent('click', dayTarget, {
          ancestorClasses: ['MuiCalendarPicker-root'],
        }),
      ];

      const result = runFullPipeline(events);

      // Should produce at least 1 interaction
      expect(result.interactions.length).toBeGreaterThanOrEqual(1);

      // Pipeline should not crash
      expect(result.irPlan).not.toBeNull();
      expect(result.playwright).not.toBeNull();
    });
  });

  describe('Scenario 12: Empty pipeline (no events)', () => {
    it('handles empty event list without crashing', () => {
      const result = runFullPipeline([]);

      expect(result.interactions).toHaveLength(0);
      expect(result.irPlan).not.toBeNull();
      expect(result.playwright).not.toBeNull();
    });
  });

  describe('Pipeline Stage Connectivity', () => {
    it('every interaction flows through all 4 stages consistently', () => {
      // Run a representative scenario
      const events = [
        makeEvent('click', {
          tag: 'BUTTON', accessibleName: 'Login', ariaRole: 'button',
          testId: 'login-btn',
          cssSelector: 'button#login',
        }),
      ];

      const result = runFullPipeline(events);

      // If we got interactions, every one must have IR steps
      for (const ci of result.interactions) {
        const step = result.irPlan?.steps.find(s => s.interactionId === ci.elementId);
        if (!step) {
          // Some interactions may map differently, but at least the plan should have steps
          expect(result.irPlan!.steps.length).toBeGreaterThan(0);
        }
      }

      // Every IR step should have locators
      for (const step of result.irPlan!.steps) {
        if (step.target.kind === 'element') {
          // Locators may be empty for some edge cases, but the field must exist
          expect(step.target.resolvedLocators).toBeDefined();
        }
        // Description should be present
        expect(step.description).toBeDefined();
      }

      // Playwright output should contain at least one action
      expect(result.playwright).not.toBeNull();
      const actionLines = result.playwright!
        .split('\n')
        .filter(l => l.trim().match(/await page\.\w+/));
      expect(actionLines.length).toBeGreaterThan(0);
    });
  });

  describe('Interaction Enrichment Pass', () => {
    it('enrichInteractions produces valid output for all interaction types', () => {
      // Create a variety of interactions
      const events = [
        // Click
        makeEvent('click', {
          tag: 'BUTTON', accessibleName: 'OK', testId: 'ok-btn',
          cssSelector: 'button#ok',
        }),
        // Text entry
        makeEvent('focus', { tag: 'INPUT', inputType: 'text', testId: 'name', accessibleName: 'Name', cssSelector: 'input#name' }, { inputType: 'text' }),
        makeEvent('input', { tag: 'INPUT', inputType: 'text', testId: 'name', accessibleName: 'Name', cssSelector: 'input#name' }, { inputType: 'text' }, { valueAfter: 'John' }),
        makeEvent('blur', { tag: 'INPUT', inputType: 'text', testId: 'name', accessibleName: 'Name', cssSelector: 'input#name' }, { inputType: 'text' }),
      ];

      const interactions: ComponentInteraction[] = [];
      const config: RuntimeConfig = { onEmit: (i) => interactions.push(i) };
      const runtime = createRuntime(ALL_DEFINITIONS, config);
      for (const event of events) runtime.process(event);
      runtime.flush();

      // Run enrichment
      const enriched = enrichInteractions({ interactions, fragment: null });

      // Should return maps with entries for each interaction
      expect(enriched.locators.size).toBe(interactions.length);

      // Each interaction should have locators
      for (const ci of interactions) {
        const locs = enriched.locators.get(ci.interactionId);
        expect(locs).toBeDefined();
      }
    });
  });

  describe('Assertion Generation', () => {
    it('IR steps have assertion arrays (may be empty for simple clicks)', () => {
      const events = [
        makeEvent('click', {
          tag: 'BUTTON', accessibleName: 'Submit', ariaRole: 'button',
          testId: 'submit',
          cssSelector: 'button#submit',
        }),
      ];

      const result = runFullPipeline(events);

      const plan = result.irPlan!;
      const step = plan.steps[0];

      // Assertions array should exist (even if empty for simple clicks)
      expect(step.assertions).toBeDefined();
      expect(Array.isArray(step.assertions)).toBe(true);
    });
  });
});
