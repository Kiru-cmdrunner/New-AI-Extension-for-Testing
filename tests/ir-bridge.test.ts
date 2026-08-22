/**
 * Tests for the Generation Layer (IR Compiler) — validates the transformation
 * from ComponentInteraction[] + RecordingContext → ExecutionIRPlan.
 *
 * Phase 1.3.8: Rewritten from DetectedInteraction-based fixtures to
 * ComponentInteraction-based fixtures. Removed SessionEvent correlation
 * tests, fragment/understanding tests, AI enrichment tests, and assertion
 * derivation tests — all Track 3 concerns via GenerationEnrichment.
 *
 * Covers:
 * - Interaction type → IRAction mapping (14 types)
 * - Locator resolution from ElementIdentity
 * - Input value extraction (text, checked, selected value, dates, sliders)
 * - Description generation
 * - Noise filtering (Scroll, Unclassified)
 * - Readability rules (duplicate click merging)
 * - Source event ID from triggerEvent
 * - Execution parameters
 * - Tag derivation
 * - Full end-to-end plan construction
 */

import { describe, it, expect } from 'vitest';
import { build } from '../src/generation/ir-bridge';
import type { GenerationInput } from '../src/generation/generation-types';
import { IRAction } from '../src/domain/execution-ir/types';
import { LocatorStrategyType } from '../src/domain/enums';
import type { ElementIdentity } from '../src/shared/types';
import type {
  ComponentInteraction,
  InteractionType,

  ObservedEvent,
} from '../src/shared/component-types';

// ── Helpers ────────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    inputType: null,
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
    href: null,
    ...overrides,
  };
}

function makeObservedEvent(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  return {
    eventId: 'click-0001',
    eventType: 'click',
    timestamp: 1000,
    captureSeq: 1,
    isTrusted: true,
    target: makeElementIdentity(),
    domContext: { inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false, disabled: false, readOnly: false, required: false, ancestorRoles: [], ancestorClasses: [], tabIndex: null },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 200,
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
    ...overrides,
  };
}

function makeInteraction(
  type: InteractionType,
  overrides: Partial<ComponentInteraction> = {},
): ComponentInteraction {
  const triggerEvent = overrides.triggerEvent ?? makeObservedEvent();
  return {
    interactionId: 'int-0001',
    type,
    trigger: triggerEvent.target,
    triggerEvent,
    memberEvents: [triggerEvent],
    startTime: 1000,
    endTime: 2000,
    endState: 'completed',
    metadata: {},
    ...overrides,
  };
}

function makeInput(overrides: Partial<GenerationInput> = {}): GenerationInput {
  return {
    interactions: [],
    recordingContext: { startUrl: 'https://example.com/login', title: 'Login Page' },
    testCaseName: 'Test Case',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('Generation Layer — build()', () => {

  // ── Empty / Edge Cases ──────────────────────────────

  describe('empty inputs', () => {
    it('returns an empty plan when no interactions', () => {
      const plan = build(makeInput({ interactions: [] }));
      expect(plan.steps).toHaveLength(0);
      expect(plan.title).toBe('Test Case');
      // D9: baseUrl is origin semantics; the recorded page is startUrl.
      expect(plan.environment.baseUrl).toBe('https://example.com');
      expect(plan.environment.startUrl).toBe('https://example.com/login');
    });

    it('returns a plan with correct environment', () => {
      const plan = build(makeInput({
        recordingContext: { startUrl: 'https://app.example.com/dashboard', title: 'Dashboard' },
      }));
      expect(plan.environment.baseUrl).toBe('https://app.example.com');
      expect(plan.environment.browser).toBe('chrome');
      expect(plan.environment.viewport).toEqual({ width: 1280, height: 720 });
    });

    it('handles single interaction gracefully', () => {
      const interaction = makeInteraction('Click');
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].assertions).toHaveLength(0);
    });
  });

  // ── Interaction Type → IRAction Mapping ──────────────

  describe('interaction type mapping (ComponentInteraction types)', () => {
    const cases: Array<[InteractionType, IRAction]> = [
      ['Click', IRAction.CLICK],
      ['TextEntry', IRAction.FILL],
      ['Dropdown', IRAction.SELECT],
      ['Checkbox', IRAction.TOGGLE],
      ['RadioButton', IRAction.SELECT],
      ['DatePicker', IRAction.SELECT_DATE],
      ['Hover', IRAction.HOVER],
      ['Link', IRAction.CLICK],
      ['FileUpload', IRAction.FILL],
      ['Slider', IRAction.FILL],
      ['ColorInput', IRAction.FILL],
      ['Tab', IRAction.CLICK],
      ['Navigation', IRAction.NAVIGATE],
      ['DragDrop', IRAction.DRAG_DROP],
      ['KeyboardShortcut', IRAction.KEYBOARD_SHORTCUT],
    ];

    for (const [type, expectedAction] of cases) {
      it(`maps ${type} → ${expectedAction}`, () => {
        const interaction = makeInteraction(type);
        const plan = build(makeInput({ interactions: [interaction] }));
        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].action).toBe(expectedAction);
      });
    }
  });

  // ── Noise Filtering ──────────────────────────────────

  describe('noise filtering', () => {
    it('filters out Scroll', () => {
      const scroll = makeInteraction('Scroll', {
        metadata: { scrollDeltaY: 100, scrollDeltaX: 0, hasDelta: true, pageUrl: 'https://example.com' },
      });
      const click = makeInteraction('Click', { interactionId: 'int-0002' });
      const plan = build(makeInput({ interactions: [scroll, click] }));
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].action).toBe(IRAction.CLICK);
    });

    it('filters out Unclassified interactions', () => {
      const unknown = makeInteraction('Unclassified');
      const plan = build(makeInput({ interactions: [unknown] }));
      expect(plan.steps).toHaveLength(0);
    });
  });

  // ── Locator Resolution ───────────────────────────────

  describe('locator resolution', () => {
    it('resolves testId as highest priority locator', () => {
      const identity = makeElementIdentity({ testId: 'login-btn', stableId: 'btn-1', cssSelector: 'button.btn' });
      const interaction = makeInteraction('Click', {
        trigger: identity,
        triggerEvent: makeObservedEvent({ target: identity }),
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      const target = plan.steps[0].target;
      expect(target.kind).toBe('element');
      if (target.kind === 'element') {
        expect(target.resolvedLocators.length).toBeGreaterThanOrEqual(1);
        expect(target.resolvedLocators[0].type).toBe(LocatorStrategyType.TEST_ID);
        expect(target.resolvedLocators[0].value).toBe('login-btn');
      }
    });

    it('falls back to CSS selector when no business/a11y IDs', () => {
      const identity = makeElementIdentity({
        testId: null, dataCy: null, dataQa: null,
        ariaLabel: null, ariaLabelledBy: null,
        stableId: null, name: null,
        accessibleName: 'Submit',
        // 6B: className null keeps the pre-6B fallback shape (no class tier);
        // with classes present the stable-class CSS tier legitimately ranks
        // above the CONTENT-tier accessibleName.
        className: null,
        cssSelector: 'button.submit',
        xPath: '//button',
      });
      const interaction = makeInteraction('Click', {
        trigger: identity,
        triggerEvent: makeObservedEvent({ target: identity }),
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      const target = plan.steps[0].target;
      if (target.kind === 'element') {
        expect(target.resolvedLocators.length).toBeGreaterThanOrEqual(1);
        expect(target.resolvedLocators[0].type).toBe(LocatorStrategyType.ACCESSIBLE_NAME);
      }
    });

    it('uses URL target for navigation', () => {
      const interaction = makeInteraction('Navigation', {
        metadata: { pageUrl: 'https://example.com/dashboard', pageTitle: 'Dashboard' },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].target.kind).toBe('url');
      if (plan.steps[0].target.kind === 'url') {
        expect(plan.steps[0].target.url).toBe('https://example.com/dashboard');
      }
    });
  });

  // ── Input Value Extraction ─────────────────────────

  describe('input value extraction', () => {
    it('extracts text value from TextEntry metadata', () => {
      const interaction = makeInteraction('TextEntry', {
        metadata: { targetName: 'Email', textValue: 'john@example.com', userTyped: true },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('john@example.com');
    });

    it('extracts checked state from Checkbox metadata', () => {
      const interaction = makeInteraction('Checkbox', {
        metadata: { targetName: 'Newsletter', checked: true },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBe(true);
    });

    it('extracts selected value from Dropdown metadata', () => {
      const interaction = makeInteraction('Dropdown', {
        metadata: { targetName: 'Country', selectedValue: 'United States', noOpSelection: false },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('United States');
    });

    it('extracts date value from DatePicker metadata', () => {
      const interaction = makeInteraction('DatePicker', {
        metadata: { targetName: 'Date of Birth', selectedDate: '2026-07-15', dateValue: '2026-07-15' },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('2026-07-15');
    });

    it('extracts slider value from metadata', () => {
      const interaction = makeInteraction('Slider', {
        metadata: { targetName: 'Volume', value: '75', userAdjusted: true },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('75');
    });

    it('extracts color value from ColorInput metadata', () => {
      const interaction = makeInteraction('ColorInput', {
        metadata: { targetName: 'Color', value: '#ff0000', userAdjusted: true },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('#ff0000');
    });

    it('extracts file name from FileUpload metadata', () => {
      const interaction = makeInteraction('FileUpload', {
        metadata: { targetName: 'Resume', fileName: 'resume.pdf' },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('resume.pdf');
    });

    it('extracts navigation URL from Navigation metadata', () => {
      const interaction = makeInteraction('Navigation', {
        metadata: { pageUrl: 'https://example.com/home', pageTitle: 'Home' },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBe('https://example.com/home');
    });

    it('returns null for click (no input value)', () => {
      const interaction = makeInteraction('Click');
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].input).toBeNull();
    });
  });

  // ── Description Generation ───────────────────────────

  describe('description generation', () => {
    it('generates click description with element name', () => {
      const interaction = makeInteraction('Click');
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].description).toContain('Submit Button');
    });

    it('generates fill description with value', () => {
      const interaction = makeInteraction('TextEntry', {
        trigger: makeElementIdentity({ accessibleName: 'Email' }),
        metadata: { targetName: 'Email', textValue: 'admin@test.com', userTyped: true },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].description).toContain('admin@test.com');
      expect(plan.steps[0].description).toContain('Email');
    });

    it('generates select description for dropdown', () => {
      const identity = makeElementIdentity({ accessibleName: 'Make' });
      const interaction = makeInteraction('Dropdown', {
        trigger: identity,
        triggerEvent: makeObservedEvent({ target: identity }),
        metadata: { targetName: 'Make', selectedValue: 'LEXUS', noOpSelection: false },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].description).toContain('LEXUS');
      expect(plan.steps[0].description).toContain('Make');
    });

    it('generates toggle description for checkbox', () => {
      const identity = makeElementIdentity({ accessibleName: 'Terms' });
      const interaction = makeInteraction('Checkbox', {
        trigger: identity,
        triggerEvent: makeObservedEvent({ target: identity }),
        metadata: { targetName: 'Terms', checked: true },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].description).toContain('Check');
      expect(plan.steps[0].description).toContain('Terms');
    });

    it('generates navigation description with URL', () => {
      const interaction = makeInteraction('Navigation', {
        metadata: { pageUrl: 'https://example.com/home', pageTitle: 'Home' },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].description).toContain('https://example.com/home');
    });

    it('generates hover description', () => {
      const identity = makeElementIdentity({ accessibleName: 'Menu' });
      const interaction = makeInteraction('Hover', {
        trigger: identity,
        triggerEvent: makeObservedEvent({ target: identity }),
        metadata: { targetName: 'Menu', dwellMs: 500, meaningful: true, confidence: 0.9, evidenceReason: 'dwell>300ms' },
      });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].description).toContain('Menu');
    });

    it('capitalizes plainEnglish', () => {
      const interaction = makeInteraction('Click');
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].plainEnglish?.[0]).toMatch(/[A-Z]/);
    });
  });

  // ── Readability Rules ────────────────────────────────

  describe('readability rules', () => {
    it('merges consecutive clicks on the same element', () => {
      const identity = makeElementIdentity({ elementId: 'elem-0001' });
      const int1 = makeInteraction('Click', {
        interactionId: 'int-0001',
        trigger: identity,
        triggerEvent: makeObservedEvent({ target: identity }),
      });
      const int2 = makeInteraction('Click', {
        interactionId: 'int-0002',
        trigger: identity,
        triggerEvent: makeObservedEvent({ target: identity }),
      });
      const int3 = makeInteraction('Click', {
        interactionId: 'int-0003',
        trigger: makeElementIdentity({ elementId: 'elem-0002' }),
        triggerEvent: makeObservedEvent({ target: makeElementIdentity({ elementId: 'elem-0002' }) }),
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
        trigger: makeElementIdentity({ elementId: 'elem-0001' }),
        triggerEvent: makeObservedEvent({ target: makeElementIdentity({ elementId: 'elem-0001' }) }),
      });
      const int2 = makeInteraction('Click', {
        interactionId: 'int-0002',
        trigger: makeElementIdentity({ elementId: 'elem-0002' }),
        triggerEvent: makeObservedEvent({ target: makeElementIdentity({ elementId: 'elem-0002' }) }),
      });
      const plan = build(makeInput({ interactions: [int1, int2] }));
      expect(plan.steps).toHaveLength(2);
    });
  });

  // ── Source Event ID ──────────────────────────────────

  describe('source event ID', () => {
    it('sets sourceEventId from triggerEvent.eventId', () => {
      const triggerEvent = makeObservedEvent({ eventId: 'click-0001' });
      const interaction = makeInteraction('Click', { triggerEvent });
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].sourceEventId).toBe('click-0001');
    });
  });

  // ── Execution Parameters ──────────────────────────────

  describe('execution parameters', () => {
    it('uses default execution parameters', () => {
      const interaction = makeInteraction('Click');
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].executionParameters.timeoutMs).toBe(30_000);
      expect(plan.steps[0].executionParameters.waitStrategy).toBe('visible');
    });

    it('applies default retry configuration', () => {
      const interaction = makeInteraction('TextEntry');
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].executionParameters.retryCount).toBe(0);
      expect(plan.steps[0].executionParameters.retryDelayMs).toBe(1_000);
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

    it('returns empty tags for root URL', () => {
      const plan = build(makeInput({
        recordingContext: { startUrl: 'https://example.com/', title: null },
      }));
      expect(plan.tags).toHaveLength(0);
    });

    it('limits to 5 tags', () => {
      const plan = build(makeInput({
        recordingContext: { startUrl: 'https://example.com/a/b/c/d/e/f', title: null },
      }));
      // Only the first path segment is used as a tag
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

      const interactions: ComponentInteraction[] = [
        makeInteraction('TextEntry', {
          interactionId: 'int-0001',
          trigger: emailIdentity,
          triggerEvent: makeObservedEvent({
            eventId: 'text-0001',
            target: emailIdentity,
            eventType: 'input',
          }),
          metadata: { targetName: 'Email', textValue: 'admin@test.com', userTyped: true },
        }),
        makeInteraction('TextEntry', {
          interactionId: 'int-0002',
          trigger: passwordIdentity,
          triggerEvent: makeObservedEvent({
            eventId: 'text-0002',
            target: passwordIdentity,
            eventType: 'input',
          }),
          metadata: { targetName: 'Password', textValue: 'secret123', userTyped: true },
        }),
        makeInteraction('Click', {
          interactionId: 'int-0003',
          trigger: submitIdentity,
          triggerEvent: makeObservedEvent({
            eventId: 'click-0001',
            target: submitIdentity,
            eventType: 'click',
          }),
        }),
        makeInteraction('Navigation', {
          interactionId: 'int-0004',
          triggerEvent: makeObservedEvent({
            eventId: 'nav-0001',
            eventType: 'navigation',
          }),
          metadata: { pageUrl: 'https://example.com/dashboard', pageTitle: 'Dashboard' },
        }),
      ];

      const plan = build(makeInput({
        interactions,
        recordingContext: { startUrl: 'https://example.com/login', title: 'Login' },
        testCaseName: 'User Login Test',
      }));

      expect(plan.title).toBe('User Login Test');
      expect(plan.steps).toHaveLength(4);
      // TextEntry → FILL (not CLICK — the old bridge had this bug)
      expect(plan.steps[0].action).toBe(IRAction.FILL);
      expect(plan.steps[0].input).toBe('admin@test.com');
      expect(plan.steps[0].description).toContain('admin@test.com');
      expect(plan.steps[1].action).toBe(IRAction.FILL);
      expect(plan.steps[1].input).toBe('secret123');
      expect(plan.steps[2].action).toBe(IRAction.CLICK);
      expect(plan.steps[3].action).toBe(IRAction.NAVIGATE);
      expect(plan.steps[3].target.kind).toBe('url');
      expect(plan.tags).toContain('login');
      // D9: origin baseUrl, recorded page preserved as startUrl.
      expect(plan.environment.baseUrl).toBe('https://example.com');
      expect(plan.environment.startUrl).toBe('https://example.com/login');
    });
  });

  // ── GenerationEnrichment (Track 3 stub) ──────────────

  describe('enrichment (graceful degradation)', () => {
    it('produces valid plan without enrichment', () => {
      const interaction = makeInteraction('Click');
      const plan = build(makeInput({ interactions: [interaction] }));
      expect(plan.steps[0].assertions).toHaveLength(0);
      expect(plan.steps[0].description).toBeDefined();
    });

    it('produces valid plan with undefined enrichment', () => {
      const interaction = makeInteraction('Click');
      const plan = build({
        interactions: [interaction],
        recordingContext: { startUrl: 'https://example.com', title: 'Test' },
        testCaseName: 'Test',
        enrichment: undefined,
      });
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].assertions).toHaveLength(0);
    });
  });
});
