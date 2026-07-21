/**
 * C3.2 Phase 2 — Hover Artifact Generation Pipeline Integration Tests
 *
 * Validates that a recorded Hover interaction behaves as a first-class
 * interaction throughout the entire generation pipeline:
 *
 *   Timeline → Canonical Steps → Execution JSON → Playwright
 *
 * Permanently frozen C3.1 §4.5: Hover is never merged by Readability Optimizer.
 * B5.2: Execution JSON six-section contract must be complete for hover.
 * B6: Playwright Generator must produce deterministic .hover() calls.
 *
 * These tests exercise the FULL pipeline with realistic multi-interaction
 * scenarios to prove hover works alongside click, text, and navigation.
 */

import { describe, it, expect } from 'vitest';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import { playwrightGenerator } from '../src/generation/generators/playwright-generator';
import { applyReadabilityRules } from '../src/generation/engine/readability-optimizer';
import type { SessionEvent, ElementIdentity, RecordingContext } from '../src/shared/types';
import type { CanonicalStep } from '../src/generation/types';

// ── Test Helpers ──────────────────────────────────────────

const recordingContext: RecordingContext = {
  startUrl: 'https://example.com',
  startTitle: 'Example App',
  capturedAt: '2026-07-15T00:00:00Z',
};

function makeIdentity(
  accessibleName: string,
  tag: string,
  overrides: Partial<ElementIdentity> = {},
): ElementIdentity {
  return {
    accessibleName,
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: `body > ${tag.toLowerCase()}`,
    xPath: `//body/${tag.toLowerCase()}`,
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeHover(actionId: string, name: string, tag = 'A', overrides: Partial<ElementIdentity> = {}): SessionEvent {
  return {
    actionId,
    type: 'hover',
    elementIdentity: makeIdentity(name, tag, { elementId: actionId.replace('hover', 'elem'), ...overrides }),
    timestamp: `2026-07-15T10:00:0${actionId.slice(-1)}Z`,
  } as unknown as SessionEvent;
}

function makeClick(actionId: string, name: string, tag = 'BUTTON', overrides: Partial<ElementIdentity> = {}): SessionEvent {
  return {
    actionId,
    type: 'click',
    elementIdentity: makeIdentity(name, tag, { elementId: actionId.replace('click', 'elem'), ...overrides }),
    timestamp: `2026-07-15T10:00:0${actionId.slice(-1)}Z`,
  } as unknown as SessionEvent;
}

function makeText(actionId: string, name: string, value: string, overrides: Partial<ElementIdentity> = {}): SessionEvent {
  return {
    actionId,
    type: 'text',
    elementIdentity: makeIdentity(name, 'INPUT', { elementId: actionId.replace('text', 'elem'), ...overrides }),
    value,
    timestamp: `2026-07-15T10:00:0${actionId.slice(-1)}Z`,
  } as unknown as SessionEvent;
}

function makeNav(actionId: string, url: string): SessionEvent {
  return {
    actionId,
    type: 'navigation',
    url,
    title: url,
    timestamp: `2026-07-15T10:00:0${actionId.slice(-1)}Z`,
  } as unknown as SessionEvent;
}

// Run through full pipeline and return all artifacts
function runFullPipeline(events: SessionEvent[], tcName = 'Test Case') {
  const canonical = canonicalStepGenerator.generate({ timeline: events, recordingContext });
  const exec = executionJsonGenerator.generate({ steps: canonical.output as CanonicalStep[] });
  const pw = playwrightGenerator.generate({
    steps: exec.output as unknown as CanonicalStep[],
    recordingContext,
    testCaseName: tcName,
  });
  return { canonical, exec, pw };
}

// ── Canonical Test Step Generation ────────────────────────

describe('C3.2 Phase 2 — Canonical Step Generation for Hover', () => {
  it('generates correct plain English: Hover over the Products', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const { canonical } = runFullPipeline(events);
    expect(canonical.output![0].plainEnglish).toBe('Hover over the Products');
    expect(canonical.output![0].actionType).toBe('hover');
  });

  it('generates unique step IDs for hover steps', () => {
    const events = [makeHover('hover-0001', 'Menu 1'), makeHover('hover-0002', 'Menu 2')];
    const { canonical } = runFullPipeline(events);
    const ids = canonical.output!.map((s) => s.stepId);
    expect(new Set(ids).size).toBe(2);
  });

  it('preserves linkedInteractionId for traceability', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const { canonical } = runFullPipeline(events);
    expect(canonical.output![0].linkedInteractionId).toBe('hover-0001');
  });

  it('preserves element identity', () => {
    const events = [makeHover('hover-0001', 'Products', 'A', { ariaLabel: 'Products menu' })];
    const { canonical } = runFullPipeline(events);
    expect(canonical.output![0].elementIdentity.ariaLabel).toBe('Products menu');
    expect(canonical.output![0].elementIdentity.accessibleName).toBe('Products');
  });

  it('does not infer business intent (aiConfidence = 0 without AI)', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const { canonical } = runFullPipeline(events);
    expect(canonical.output![0].aiConfidence).toBe(0);
    expect(canonical.output![0].aiEnrichment).toBeNull();
  });

  it('does not set a value for hover (unlike text entry)', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const { canonical } = runFullPipeline(events);
    expect(canonical.output![0].value).toBeNull();
  });
});

// ── Readability Optimizer Non-Interference ────────────────

describe('C3.2 Phase 2 — Readability Optimizer: Hover Independence', () => {
  it('OR-1 does NOT merge hover + click', () => {
    const steps: CanonicalStep[] = [
      {
        stepId: 'step-001', stepNumber: 1, actionType: 'hover',
        plainEnglish: 'Hover over "Products"',
        elementIdentity: makeIdentity('Products', 'A', { elementId: 'elem-001', cssSelector: 'nav > a:nth-of-type(1)' }),
        aiEnrichment: null, aiConfidence: 0, linkedInteractionId: 'hover-0001',
        checked: null,
        value: null, executionJson: null, timestamp: '2026-07-15T10:00:01Z',
      },
      {
        stepId: 'step-002', stepNumber: 2, actionType: 'click',
        plainEnglish: 'Click "Laptops"',
        elementIdentity: makeIdentity('Laptops', 'A', { elementId: 'elem-002', cssSelector: 'nav > a:nth-of-type(2)' }),
        aiEnrichment: null, aiConfidence: 0, linkedInteractionId: 'click-0001',
        checked: null,
        value: null, executionJson: null, timestamp: '2026-07-15T10:00:02Z',
      },
    ];

    const optimized = applyReadabilityRules(steps);
    expect(optimized).toHaveLength(2);
    expect(optimized[0].actionType).toBe('hover');
    expect(optimized[1].actionType).toBe('click');
  });

  it('OR-1 does NOT merge click + hover', () => {
    const steps: CanonicalStep[] = [
      {
        stepId: 'step-001', stepNumber: 1, actionType: 'click',
        plainEnglish: 'Click "Menu"',
        elementIdentity: makeIdentity('Menu', 'BUTTON', { elementId: 'elem-001', cssSelector: 'body > button' }),
        aiEnrichment: null, aiConfidence: 0, linkedInteractionId: 'click-0001',
        checked: null,
        value: null, executionJson: null, timestamp: '2026-07-15T10:00:01Z',
      },
      {
        stepId: 'step-002', stepNumber: 2, actionType: 'hover',
        plainEnglish: 'Hover over "Products"',
        elementIdentity: makeIdentity('Products', 'A', { elementId: 'elem-002', cssSelector: 'nav > a' }),
        aiEnrichment: null, aiConfidence: 0, linkedInteractionId: 'hover-0001',
        checked: null,
        value: null, executionJson: null, timestamp: '2026-07-15T10:00:02Z',
      },
    ];

    const optimized = applyReadabilityRules(steps);
    expect(optimized).toHaveLength(2);
  });

  it('OR-1 DOES merge click+text but NOT hover+text (hover unaffected)', () => {
    const steps: CanonicalStep[] = [
      {
        stepId: 'step-001', stepNumber: 1, actionType: 'hover',
        plainEnglish: 'Hover over "Search"',
        elementIdentity: makeIdentity('Search', 'DIV', { elementId: 'elem-001', cssSelector: 'body > div.search' }),
        aiEnrichment: null, aiConfidence: 0, linkedInteractionId: 'hover-0001',
        checked: null,
        value: null, executionJson: null, timestamp: '2026-07-15T10:00:01Z',
      },
      {
        stepId: 'step-002', stepNumber: 2, actionType: 'fill',
        plainEnglish: "Enter 'laptop' in the Search",
        elementIdentity: makeIdentity('Search', 'INPUT', { elementId: 'elem-002', cssSelector: 'body > input.search' }),
        aiEnrichment: null, aiConfidence: 0, linkedInteractionId: 'text-0001',
        checked: null,
        value: 'laptop', executionJson: null, timestamp: '2026-07-15T10:00:02Z',
      },
    ];

    const optimized = applyReadabilityRules(steps);
    // Hover (step-001) is NOT 'click', so C1 fails → no merge → both remain
    expect(optimized).toHaveLength(2);
  });

  it('hover between click+text prevents OR-1 merge (adjacency broken)', () => {
    // Click on input → hover somewhere else → text entry.
    // Hover breaks adjacency between click and text → no merge.
    const events: SessionEvent[] = [
      makeClick('click-0001', 'Username', 'INPUT', { cssSelector: 'input[name="username"]', name: 'username' }),
      makeHover('hover-0001', 'Help Icon', 'SPAN', { cssSelector: 'span.help' }),
      makeText('text-0001', 'Username', 'admin', { cssSelector: 'input[name="username"]', name: 'username' }),
    ];

    const { canonical } = runFullPipeline(events);
    // All three steps should remain — hover breaks adjacency
    expect(canonical.output).toHaveLength(3);
  });
});

// ── Execution JSON Contract ───────────────────────────────

describe('C3.2 Phase 2 — Execution JSON Contract for Hover', () => {
  it('generates all 6 sections for hover', () => {
    const events = [makeHover('hover-0001', 'Products', 'A', {
      className: null,
      cssSelector: 'nav > a.products',
      ariaLabel: 'Products',
    })];
    const { exec } = runFullPipeline(events);
    const json = exec.output![0].executionJson!;

    // §1 action
    expect(json.action).toBeDefined();
    expect(json.action.type).toBe('hover');
    expect(json.action.value).toBeNull();

    // §2 target
    expect(json.target).toBeDefined();
    expect(json.target.kind).toBe('element');
    expect(json.target.tag).toBe('A');
    expect(json.target.name).toBe('Products');

    // §3 locators
    expect(json.locators).toBeDefined();
    expect(json.locators.length).toBeGreaterThan(0);
    const primary = json.locators.find((l) => l.role === 'primary');
    expect(primary).toBeDefined();

    // §4 context
    expect(json.context).toBeDefined();
    expect(json.context.iframe).toBe(false);
    expect(json.context.shadowDom).toBe(false);

    // §5 trace
    expect(json.trace).toBeDefined();
    expect(json.trace.interactionId).toBe('hover-0001');
    expect(json.trace.stepId).toBeTruthy();

    // §6 meta
    expect(json.meta).toBeDefined();
    expect(json.meta.status).toBe('generated');
  });

  it('action.type is exactly "hover" (not click/fill/navigate)', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const { exec } = runFullPipeline(events);
    expect(exec.output![0].executionJson!.action.type).toBe('hover');
  });

  it('no hover-specific metadata is introduced', () => {
    // The B5.2 contract has 6 top-level keys. Hover must not add a 7th.
    const events = [makeHover('hover-0001', 'Products')];
    const { exec } = runFullPipeline(events);
    const json = exec.output![0].executionJson!;
    const keys = Object.keys(json).sort();
    expect(keys).toEqual(['action', 'context', 'locators', 'meta', 'target', 'trace']);
  });
});

// ── Playwright Generation ─────────────────────────────────

describe('C3.2 Phase 2 — Playwright Generation for Hover', () => {
  it('generates .hover() call', () => {
    const events = [makeHover('hover-0001', 'Products', 'A', {
      className: null,
      cssSelector: 'nav > a.products',
    })];
    const { pw } = runFullPipeline(events, 'Mega Menu Test');
    expect(pw.output!.testCode).toContain('.hover()');
  });

  it('includes traceability comment referencing step number', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const { pw } = runFullPipeline(events, 'Test');
    expect(pw.output!.testCode).toMatch(/Step\s*1/i);
  });

  it('includes hover in plain English comment', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const { pw } = runFullPipeline(events, 'Test');
    const code = pw.output!.testCode;
    expect(code).toMatch(/hover/i);
    expect(code).toContain('Products');
  });

  it('uses primary locator, not fallback', () => {
    const events = [makeHover('hover-0001', 'Products', 'A', {
      className: null,
      cssSelector: 'nav > a.products',
      testId: 'products-menu',
    })];
    const { pw } = runFullPipeline(events, 'Test');
    const code = pw.output!.testCode;
    // testId is Category 1 (Business ID) → should be primary → getByTestId
    expect(code).toContain('getByTestId');
    expect(code).toContain('products-menu');
  });
});

// ── Execution Order Preservation ──────────────────────────

describe('C3.2 Phase 2 — Execution Order Preservation', () => {
  it('hover appears in correct position between other interactions', () => {
    const events: SessionEvent[] = [
      makeClick('click-0001', 'Open App', 'A'),
      makeHover('hover-0001', 'Products', 'A'),
      makeClick('click-0002', 'Laptops', 'A'),
      makeNav('nav-0001', 'https://example.com/laptops'),
    ];

    const { canonical, exec, pw } = runFullPipeline(events, 'Workflow');

    // Canonical steps preserve order
    const actionTypes = canonical.output!.map((s) => s.actionType);
    expect(actionTypes).toEqual(['click', 'hover', 'click', 'navigate']);

    // Execution JSON preserves order
    const execActions = exec.output!.map((s) => s.executionJson!.action.type);
    expect(execActions).toEqual(['click', 'hover', 'click', 'navigate']);

    // Playwright preserves order — verify hover appears between the two clicks
    // (The test has an initial page.goto(startUrl) so we check relative ordering
    //  of the hover vs the click actions in the generated code)
    const code = pw.output!.testCode;
    const hoverIdx = code.indexOf('.hover()');
    expect(hoverIdx).toBeGreaterThan(-1);
    // There should be at least 2 click calls (click-0001 before hover, click-0002 after)
    const clickMatches = [...code.matchAll(/\.click\(\)/g)];
    expect(clickMatches.length).toBeGreaterThanOrEqual(2);
    // Hover is between the two clicks
    expect(hoverIdx).toBeGreaterThan(clickMatches[0].index!);
    expect(hoverIdx).toBeLessThan(clickMatches[clickMatches.length - 1].index!);
  });
});

// ── Traceability ──────────────────────────────────────────

describe('C3.2 Phase 2 — Traceability', () => {
  it('hover step traces to timeline event via linkedInteractionId', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const { canonical, exec } = runFullPipeline(events);

    const step = canonical.output![0];
    const json = exec.output![0].executionJson!;

    // step.linkedInteractionId === event.actionId
    expect(step.linkedInteractionId).toBe('hover-0001');

    // Execution JSON trace section links back
    expect(json.trace.interactionId).toBe('hover-0001');
    expect(json.trace.stepId).toBe(step.stepId);
  });

  it('traceability preserved in multi-step scenario', () => {
    const events: SessionEvent[] = [
      makeHover('hover-0001', 'Products'),
      makeClick('click-0001', 'Laptops'),
    ];

    const { canonical, exec } = runFullPipeline(events);

    for (let i = 0; i < events.length; i++) {
      const step = canonical.output![i];
      const json = exec.output![i].executionJson!;
      expect(json.trace.interactionId).toBe(events[i].actionId);
      expect(json.trace.stepId).toBe(step.stepId);
    }
  });
});

// ── Determinism ───────────────────────────────────────────

describe('C3.2 Phase 2 — Determinism', () => {
  it('same hover input produces identical canonical step plain English', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const result1 = runFullPipeline(events);
    const result2 = runFullPipeline(events);

    expect(result1.canonical.output![0].plainEnglish).toBe(result2.canonical.output![0].plainEnglish);
    expect(result1.canonical.output![0].actionType).toBe(result2.canonical.output![0].actionType);
  });

  it('same hover input produces identical Playwright code (action + locator)', () => {
    const events = [makeHover('hover-0001', 'Products', 'A', {
      cssSelector: 'nav > a.products',
    })];
    const result1 = runFullPipeline(events, 'Test');
    const result2 = runFullPipeline(events, 'Test');

    // The action line (not timestamp) should be identical
    const lines1 = result1.pw.output!.testCode.split('\n').filter((l) => l.includes('.hover()'));
    const lines2 = result2.pw.output!.testCode.split('\n').filter((l) => l.includes('.hover()'));
    expect(lines1).toEqual(lines2);
  });

  it('same hover input produces identical Execution JSON action section', () => {
    const events = [makeHover('hover-0001', 'Products')];
    const result1 = runFullPipeline(events);
    const result2 = runFullPipeline(events);

    expect(result1.exec.output![0].executionJson!.action).toEqual(result2.exec.output![0].executionJson!.action);
    expect(result1.exec.output![0].executionJson!.target).toEqual(result2.exec.output![0].executionJson!.target);
  });
});

// ── End-to-End: Realistic Workflows ───────────────────────

describe('C3.2 Phase 2 — E2E: Mega-Menu Navigation', () => {
  it('hover Products → click Laptops → navigate to results', () => {
    const events: SessionEvent[] = [
      makeHover('hover-0001', 'Products', 'A', { cssSelector: 'nav > a:nth-of-type(1)' }),
      makeClick('click-0001', 'Laptops', 'A', { cssSelector: 'nav > ul > li > a' }),
      makeNav('nav-0001', 'https://example.com/products/laptops'),
    ];

    const { canonical, exec, pw } = runFullPipeline(events, 'Mega Menu Navigation');

    // 3 canonical steps (no merge)
    expect(canonical.output).toHaveLength(3);

    // Plain English (frozen Semantic Interaction Language templates)
    expect(canonical.output![0].plainEnglish).toBe('Hover over the Products');
    expect(canonical.output![1].plainEnglish).toBe('Click the Laptops');
    expect(canonical.output![2].plainEnglish).toContain('Navigate to');

    // Execution JSON
    expect(exec.output![0].executionJson!.action.type).toBe('hover');
    expect(exec.output![1].executionJson!.action.type).toBe('click');
    expect(exec.output![2].executionJson!.action.type).toBe('navigate');

    // Playwright
    const code = pw.output!.testCode;
    expect(code).toContain('.hover()');
    expect(code).toContain('.click()');
    expect(code).toContain('page.goto(');
  });
});

describe('C3.2 Phase 2 — E2E: Hover + Form Entry', () => {
  it('hover help icon → fill username → fill password → click login', () => {
    const events: SessionEvent[] = [
      makeHover('hover-0001', 'Username Help', 'SPAN', { cssSelector: 'span.help-username' }),
      makeClick('click-0001', 'Username', 'INPUT', { name: 'username', cssSelector: 'input[name="username"]' }),
      makeText('text-0001', 'Username', 'admin', { name: 'username', cssSelector: 'input[name="username"]' }),
      makeClick('click-0002', 'Password', 'INPUT', { name: 'password', cssSelector: 'input[name="password"]' }),
      makeText('text-0002', 'Password', 'secret123', { name: 'password', cssSelector: 'input[name="password"]' }),
      makeClick('click-0003', 'Login', 'BUTTON', { cssSelector: 'button[type="submit"]' }),
    ];

    const { canonical, pw } = runFullPipeline(events, 'Login Workflow');

    // Hover step preserved (step 1)
    expect(canonical.output![0].actionType).toBe('hover');

    // OR-1 should merge click+text pairs (click-0001+text-0001, click-0002+text-0002)
    // Hover is independent and not affected
    const actionTypes = canonical.output!.map((s) => s.actionType);
    // hover + merged text + merged text + click(login) = 4 steps
    expect(actionTypes).toEqual(['hover', 'fill', 'fill', 'click']);

    // Playwright
    const code = pw.output!.testCode;
    expect(code).toContain('.hover()');
    expect(code).toContain('.fill(');
    expect(code).toContain('.click()');
  });
});

describe('C3.2 Phase 2 — E2E: Multiple Consecutive Hovers (Cascading Menu)', () => {
  it('hover Menu → hover Submenu → click Item', () => {
    const events: SessionEvent[] = [
      makeHover('hover-0001', 'Menu', 'A', { cssSelector: 'nav > a:nth-of-type(1)' }),
      makeHover('hover-0002', 'Submenu', 'A', { cssSelector: 'nav > ul > li > a' }),
      makeClick('click-0001', 'Item', 'A', { cssSelector: 'nav > ul > li > ul > li > a' }),
    ];

    const { canonical, pw } = runFullPipeline(events, 'Cascading Menu');

    // All 3 steps preserved (no merging between hovers)
    expect(canonical.output).toHaveLength(3);
    expect(canonical.output![0].plainEnglish).toBe('Hover over the Menu');
    expect(canonical.output![1].plainEnglish).toBe('Hover over the Submenu');
    expect(canonical.output![2].plainEnglish).toBe('Click the Item');

    // Playwright has two .hover() calls
    const code = pw.output!.testCode;
    const hoverCount = (code.match(/\.hover\(\)/g) || []).length;
    expect(hoverCount).toBe(2);
  });
});

// ── Regression: Existing Types Unaffected ─────────────────

describe('C3.2 Phase 2 — Regression: Click Unaffected', () => {
  it('click-only scenario produces identical artifacts', () => {
    const events: SessionEvent[] = [
      makeClick('click-0001', 'Submit', 'BUTTON'),
    ];

    const { canonical, exec, pw } = runFullPipeline(events, 'Click Test');

    expect(canonical.output).toHaveLength(1);
    expect(canonical.output![0].actionType).toBe('click');
    expect(canonical.output![0].plainEnglish).toBe('Click the Submit');
    expect(exec.output![0].executionJson!.action.type).toBe('click');
    expect(pw.output!.testCode).toContain('.click()');
    expect(pw.output!.testCode).not.toContain('.hover()');
  });
});

describe('C3.2 Phase 2 — Regression: Text Entry + OR-1 Unaffected', () => {
  it('click+text merge still works without hover', () => {
    const events: SessionEvent[] = [
      makeClick('click-0001', 'Username', 'INPUT', { name: 'username', cssSelector: 'input[name="username"]' }),
      makeText('text-0001', 'Username', 'admin', { name: 'username', cssSelector: 'input[name="username"]' }),
    ];

    const { canonical } = runFullPipeline(events, 'Text Entry Test');

    // OR-1 should merge to 1 step
    expect(canonical.output).toHaveLength(1);
    expect(canonical.output![0].actionType).toBe('fill');
  });
});

describe('C3.2 Phase 2 — Regression: Navigation Unaffected', () => {
  it('navigation step is unchanged', () => {
    const events: SessionEvent[] = [
      makeNav('nav-0001', 'https://example.com/page'),
    ];

    const { canonical, exec, pw } = runFullPipeline(events, 'Nav Test');

    expect(canonical.output).toHaveLength(1);
    expect(canonical.output![0].actionType).toBe('navigate');
    expect(exec.output![0].executionJson!.action.type).toBe('navigate');
    expect(pw.output!.testCode).toContain('page.goto(');
  });
});

// ── C3.3 Permanent Regression: Adani One CSS-Only Hover Workflow ──
//
// This test permanently guards the exact workflow from the C3.3 investigation:
// the Adani One mega-menu pattern where CSS :hover on the parent <li> toggles
// display:none→block on the sibling <ul>, producing zero DOM mutations.
//
// The hover MUST appear in all pipeline stages as a first-class interaction.
// If this test fails, Gate 5 is either not detecting CSS-only hovers or
// the pipeline has a regression in hover artifact generation.

describe('C3.3 — Adani One CSS-Only Hover Regression', () => {
  it('full Adani One workflow: hover→click→nav→hover→click→nav', () => {
    // Exact workflow from the C3.3 manual validation:
    // Hover 'Services' → Click 'Book Flight' → Navigate →
    // Hover 'Flights' → Click 'Flight Status' → Navigate
    const events: SessionEvent[] = [
      makeHover('hover-0001', 'Services', 'A', {
        cssSelector: 'nav > ul > li > a',
        xPath: '//nav/ul/li/a',
      }),
      makeClick('click-0001', 'Book Flight', 'A', {
        cssSelector: 'nav > ul > li > ul > li > a',
        xPath: '//nav/ul/li/ul/li/a',
      }),
      makeNav('nav-0001', 'https://www.adanione.com/flight-booking'),
      makeHover('hover-0002', 'Flights', 'A', {
        cssSelector: 'nav > ul > li:nth-of-type(2) > a',
        xPath: '//nav/ul/li[2]/a',
      }),
      makeClick('click-0002', 'Flight Status', 'A', {
        cssSelector: 'nav > ul > li:nth-of-type(2) > ul > li > a',
        xPath: '//nav/ul/li[2]/ul/li/a',
      }),
      makeNav('nav-0002', 'https://www.adanione.com/flight-status'),
    ];

    const { canonical, exec, pw } = runFullPipeline(events, 'Adani One Flight Status Check');

    // Both hovers must appear in the canonical steps
    const hoverSteps = canonical.output!.filter(s => s.actionType === 'hover');
    expect(hoverSteps).toHaveLength(2);
    expect(hoverSteps[0].plainEnglish).toContain('Hover');
    expect(hoverSteps[0].plainEnglish).toContain('Services');
    expect(hoverSteps[1].plainEnglish).toContain('Hover');
    expect(hoverSteps[1].plainEnglish).toContain('Flights');

    // Total steps: 2 hover + 2 click + 2 nav = 6
    // (hovers are NOT merged per C3.1 §4.5)
    expect(canonical.output).toHaveLength(6);

    // Both hovers must have complete Execution JSON
    const hoverExecs = exec.output!.filter(s => s.executionJson?.action.type === 'hover');
    expect(hoverExecs).toHaveLength(2);
    for (const he of hoverExecs) {
      expect(he.executionJson!.action.type).toBe('hover');
      expect(he.executionJson!.target).toBeDefined();
      expect(he.executionJson!.locators).toBeDefined();
      expect(he.executionJson!.locators!.length).toBeGreaterThan(0);
    }

    // Both hovers must produce .hover() in Playwright
    const hoverMatches = pw.output!.testCode.match(/\.hover\(\)/g);
    expect(hoverMatches).not.toBeNull();
    expect(hoverMatches!.length).toBe(2);

    // Clicks and navigations must also be present
    expect(pw.output!.testCode).toContain('.click()');
    expect(pw.output!.testCode).toContain('page.goto(');
  });

  it('CSS-only hover is not merged by Readability Optimizer', () => {
    // C3.1 §4.5: Hover is never merged into the following click.
    // Even when hover immediately precedes click, both must remain as
    // separate steps.
    const events: SessionEvent[] = [
      makeHover('hover-0001', 'Services', 'A'),
      makeClick('click-0001', 'Book Flight', 'A'),
    ];

    const { canonical } = runFullPipeline(events, 'Hover Before Click');

    // Both steps must survive — hover is NOT merged
    expect(canonical.output).toHaveLength(2);
    expect(canonical.output![0].actionType).toBe('hover');
    expect(canonical.output![1].actionType).toBe('click');
  });
});
