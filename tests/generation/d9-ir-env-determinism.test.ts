/**
 * D9 — IR Environment Honesty + Deterministic Test-Case IDs
 *
 * Regression tests for the approved D9 fix:
 *  1. INV-GEN-1: identical GenerationInput → deep-equal ExecutionIRPlan
 *     (previously `tc-${Date.now()}` made every build unique).
 *  2. Deterministic ID format and sensitivity (name/startUrl/steps).
 *  3. baseUrl = origin semantics (not the pathful startUrl), with raw
 *     fallback for non-http(s) (about:blank).
 *  4. environment.startUrl preserves the recorded page verbatim.
 *  5. viewport passthrough from recordingContext + documented fallback.
 *  6. browser invariant 'chrome'.
 *
 * Spec: .drytis/specs/d9-ir-env-determinism.md
 */

import { describe, it, expect } from 'vitest';
import { build } from '../../src/generation/ir-bridge';
import type { GenerationInput } from '../../src/generation/generation-types';
import { IRAction } from '../../src/domain/execution-ir/types';
import type { ElementIdentity } from '../../src/shared/types';
import type {
  ComponentInteraction,
  InteractionType,
  ObservedEvent,
} from '../../src/shared/component-types';

// ── Fixtures (pattern from ir-bridge.test.ts) ───────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    inputType: null,
    elementId: 'elem-0001',
    accessibleName: 'Search Box',
    ariaRole: 'searchbox',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: 'Search',
    tag: 'INPUT',
    className: 'search-input',
    name: null,
    stableId: 'twotabsearchtextbox',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'input#twotabsearchtextbox',
    xPath: '//input[@id="twotabsearchtextbox"]',
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
    domContext: { inputType: 'text', ariaExpanded: null, ariaHasPopup: null, isContentEditable: false, disabled: false, readOnly: false, required: false, ancestorRoles: [], ancestorClasses: [], tabIndex: null },
    valueBefore: null,
    valueAfter: 'headphones',
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
    pageUrl: 'http://127.0.0.1:8098/search.html',
    pageTitle: 'Search',
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
    interactions: [makeInteraction('Click')],
    recordingContext: {
      startUrl: 'http://127.0.0.1:8098/search.html?q=headphones',
      title: 'Search',
      viewport: { width: 1100, height: 760 },
    },
    testCaseName: 'D9 Test',
    ...overrides,
  };
}

// ── 1. INV-GEN-1 determinism ────────────────────────────────

describe('D9: INV-GEN-1 — same input, same plan', () => {
  it('build() twice with identical input produces deep-equal plans', () => {
    const a = build(makeInput());
    const b = build(makeInput());
    expect(a).toEqual(b);
  });

  it('IDs are stable across builds (no wall-clock leakage)', () => {
    const a = build(makeInput());
    const b = build(makeInput());
    expect(a.testCaseId).toBe(b.testCaseId);
    expect(a.testCaseVersionId).toBe(b.testCaseVersionId);
  });

  it('IDs are not epoch-millisecond strings (13 digits)', () => {
    const plan = build(makeInput());
    expect(plan.testCaseId).not.toMatch(/^tc-\d{13}$/);
    expect(plan.testCaseVersionId).not.toMatch(/^tcv-\d{13}$/);
  });
});

// ── 2. ID format + sensitivity ──────────────────────────────

describe('D9: deterministic ID format and sensitivity', () => {
  it('testCaseId matches ^tc-[0-9a-f]{8}$ and version ^tcv-[0-9a-f]{8}$', () => {
    const plan = build(makeInput());
    expect(plan.testCaseId).toMatch(/^tc-[0-9a-f]{8}$/);
    expect(plan.testCaseVersionId).toMatch(/^tcv-[0-9a-f]{8}$/);
  });

  it('different test-case name → different IDs', () => {
    const a = build(makeInput({ testCaseName: 'Test A' }));
    const b = build(makeInput({ testCaseName: 'Test B' }));
    expect(a.testCaseId).not.toBe(b.testCaseId);
  });

  it('different startUrl → different IDs', () => {
    const a = build(makeInput());
    const b = build(makeInput({
      recordingContext: { startUrl: 'http://127.0.0.1:8098/product.html', title: 'P', viewport: { width: 1100, height: 760 } },
    }));
    expect(a.testCaseId).not.toBe(b.testCaseId);
  });

  it('different steps → different IDs', () => {
    const a = build(makeInput());
    const b = build(makeInput({
      interactions: [
        makeInteraction('Click'),
        makeInteraction('TextEntry', { interactionId: 'int-0002' }),
      ],
    }));
    expect(a.testCaseId).not.toBe(b.testCaseId);
  });

  it('same steps in same order with same ids → same IDs even if timestamps differ', () => {
    const evtA = makeObservedEvent();
    const evtB = makeObservedEvent({ timestamp: 999999 });
    const a = build(makeInput({ interactions: [makeInteraction('Click', { triggerEvent: evtA })] }));
    const b = build(makeInput({ interactions: [makeInteraction('Click', { triggerEvent: evtB })] }));
    expect(a.testCaseId).toBe(b.testCaseId);
  });
});

// ── 3. baseUrl origin semantics ─────────────────────────────

describe('D9: environment.baseUrl is origin, not the pathful startUrl', () => {
  it('https URL with path+query → origin only', () => {
    const plan = build(makeInput({
      recordingContext: { startUrl: 'https://shop.example.com/search.html?q=hd', title: 'S' },
    }));
    expect(plan.environment.baseUrl).toBe('https://shop.example.com');
  });

  it('http URL with port → origin including port', () => {
    const plan = build(makeInput());
    expect(plan.environment.baseUrl).toBe('http://127.0.0.1:8098');
  });

  it('about:blank (unparseable origin) → raw fallback', () => {
    const plan = build(makeInput({
      recordingContext: { startUrl: 'about:blank', title: null },
    }));
    expect(plan.environment.baseUrl).toBe('about:blank');
  });

  it('origin-only URL stays origin', () => {
    const plan = build(makeInput({
      recordingContext: { startUrl: 'http://127.0.0.1:8098/', title: null },
    }));
    expect(plan.environment.baseUrl).toBe('http://127.0.0.1:8098');
  });
});

// ── 4. startUrl preserved ───────────────────────────────────

describe('D9: environment.startUrl preserves the recorded page', () => {
  it('pathful startUrl lands verbatim in environment.startUrl', () => {
    const startUrl = 'http://127.0.0.1:8098/search.html?q=headphones';
    const plan = build(makeInput({ recordingContext: { startUrl, title: 'S' } }));
    expect(plan.environment.startUrl).toBe(startUrl);
  });

  it('about:blank is preserved in environment.startUrl too', () => {
    const plan = build(makeInput({
      recordingContext: { startUrl: 'about:blank', title: null },
    }));
    expect(plan.environment.startUrl).toBe('about:blank');
  });
});

// ── 5. viewport honesty ─────────────────────────────────────

describe('D9: environment.viewport reflects the recording context', () => {
  it('recordingContext.viewport passes through verbatim', () => {
    const plan = build(makeInput({
      recordingContext: { startUrl: 'http://127.0.0.1:8098/', title: null, viewport: { width: 1100, height: 760 } },
    }));
    expect(plan.environment.viewport).toEqual({ width: 1100, height: 760 });
  });

  it('absent viewport → documented {1280,720} fallback', () => {
    const plan = build(makeInput({
      recordingContext: { startUrl: 'http://127.0.0.1:8098/', title: null },
    }));
    expect(plan.environment.viewport).toEqual({ width: 1280, height: 720 });
  });
});

// ── 6. browser invariant ────────────────────────────────────

describe('D9: browser invariant', () => {
  it("environment.browser is 'chrome' (Chrome-only MV3 extension)", () => {
    const plan = build(makeInput());
    expect(plan.environment.browser).toBe('chrome');
  });
});

// ── 7. unchanged behavior guards ────────────────────────────

describe('D9: regression guards on unaffected behavior', () => {
  it('steps still compile with deterministic step ids and actions', () => {
    const plan = build(makeInput());
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].id).toBe('step-0001');
    expect(plan.steps[0].action).toBe(IRAction.CLICK);
  });

  it('title and version number are unchanged', () => {
    const plan = build(makeInput());
    expect(plan.title).toBe('D9 Test');
    expect(plan.testCaseVersionNumber).toBe(1);
  });
});
