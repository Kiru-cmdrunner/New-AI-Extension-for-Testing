/**
 * Hover Content Script Tests — Milestone C3.2
 *
 * Tests the exported testing functions from hover-content-script.ts
 * (isHoverResponsive, isNonCosmeticStyleChange, isOwnedByAnother,
 * COSMETIC_CSS_PROPERTIES, DWELL_THRESHOLD, etc.) and the pipeline
 * integration (hover interaction type registration, plain English,
 * canonical step generation, execution JSON, Playwright).
 *
 * Permanently frozen C3.1: Tests verify the frozen product rules:
 *   - Intentional pause (500ms threshold is implementation detail)
 *   - Observable application behavior (cosmetic excluded)
 *   - Pipeline integration via existing architecture
 */

import { describe, it, expect } from 'vitest';
import { __testing } from '../src/recorder/hover-content-script';
import { getInteractionType, getRegisteredTypes } from '../src/recorder/interaction-types';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import { playwrightGenerator } from '../src/generation/generators/playwright-generator';
import type { SessionEvent, ClickEvent, NavigationEvent, ElementIdentity, RecordingContext } from '../src/shared/types';
import type { CanonicalStep } from '../src/generation/types';

// ── Test Helpers ──────────────────────────────────────────

const recordingContext: RecordingContext = {
  startUrl: 'https://example.com',
  startTitle: 'Example',
  capturedAt: '2026-07-15T00:00:00Z',
};

function makeHoverEvent(
  actionId: string,
  accessibleName: string,
  attrs: Partial<ElementIdentity> = {},
): SessionEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'link',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'A',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'nav > a:nth-of-type(1)',
    xPath: '//nav/a[1]',
    inIframe: false,
    shadowDom: false,
    elementId: actionId.replace('hover', 'elem'),
    ...attrs,
  };
  return {
    actionId,
    type: 'hover',
    elementIdentity: identity,
    timestamp: new Date().toISOString(),
  } as unknown as SessionEvent;
}

function makeClickEvent(
  actionId: string,
  accessibleName: string,
  attrs: Partial<ElementIdentity> = {},
): ClickEvent {
  const identity: ElementIdentity = {
    accessibleName,
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'body > button',
    xPath: '//body/button',
    inIframe: false,
    shadowDom: false,
    elementId: actionId.replace('click', 'elem'),
    ...attrs,
  };
  return {
    actionId,
    type: 'click',
    elementIdentity: identity,
    timestamp: new Date().toISOString(),
  };
}

function makeNavEvent(actionId: string, url: string): NavigationEvent {
  return {
    actionId,
    type: 'navigation',
    url,
    title: url,
    timestamp: new Date().toISOString(),
  };
}

// ── C3.1 Gate 1: Genuine Event ───────────────────────────

describe('C3.2 — Hover Detection: Gate 1 (Genuine Event)', () => {
  // Gate 1 is checked in handleMouseEnter via event.isTrusted.
  // This is a runtime check that can't be unit-tested directly
  // without a full DOM + event simulation environment.
  // The function logic is verified via integration testing.
  it('DWELL_THRESHOLD is set to 500ms (implementation detail)', () => {
    expect(__testing.DWELL_THRESHOLD).toBe(500);
  });
});

// ── C3.1 Gate 2: Ownership Check ─────────────────────────

describe('C3.2 — Hover Detection: Gate 2 (Ownership)', () => {
  it('detects data-cmdrunner-handled attribute on element', () => {
    document.body.innerHTML = '<div id="test"><button data-cmdrunner-handled>Click</button></div>';
    const btn = document.querySelector('#test button')!;
    expect(__testing.isOwnedByAnother(btn)).toBe(true);
  });

  it('detects ownership on ancestor element', () => {
    document.body.innerHTML = '<div data-cmdrunner-handled><button>Click</button></div>';
    const btn = document.querySelector('button')!;
    expect(__testing.isOwnedByAnother(btn)).toBe(true);
  });

  it('passes elements without ownership attribute', () => {
    document.body.innerHTML = '<div><button>Click</button></div>';
    const btn = document.querySelector('button')!;
    expect(__testing.isOwnedByAnother(btn)).toBe(false);
  });

  it('passes elements with other data attributes', () => {
    document.body.innerHTML = '<div data-testid="menu"><button>Click</button></div>';
    const btn = document.querySelector('button')!;
    expect(__testing.isOwnedByAnother(btn)).toBe(false);
  });
});

// ── C3.1 Gate 3: Hover-Responsive Target ─────────────────

describe('C3.2 — Hover Detection: Gate 3 (Hover-Responsive)', () => {
  it('detects aria-haspopup attribute', () => {
    document.body.innerHTML = '<button aria-haspopup="true">Menu</button>';
    const btn = document.querySelector('button')!;
    expect(__testing.isHoverResponsive(btn)).toBe(true);
  });

  it('detects onmouseenter handler', () => {
    document.body.innerHTML = '<div id="hover-target">Menu</div>';
    const div = document.querySelector('#hover-target') as HTMLElement;
    div.onmouseenter = () => {};
    expect(__testing.isHoverResponsive(div)).toBe(true);
  });

  it('detects onmouseover handler', () => {
    document.body.innerHTML = '<div id="hover-target">Menu</div>';
    const div = document.querySelector('#hover-target') as HTMLElement;
    div.onmouseover = () => {};
    expect(__testing.isHoverResponsive(div)).toBe(true);
  });

  it('detects dropdown class name', () => {
    document.body.innerHTML = '<div class="dropdown-menu">Menu</div>';
    const div = document.querySelector('div')!;
    expect(__testing.isHoverResponsive(div)).toBe(true);
  });

  it('detects menu class name', () => {
    document.body.innerHTML = '<li class="nav-menu-item">Products</li>';
    const li = document.querySelector('li')!;
    expect(__testing.isHoverResponsive(li)).toBe(true);
  });

  it('detects tooltip class name', () => {
    document.body.innerHTML = '<span class="tooltip-trigger">Help</span>';
    const span = document.querySelector('span')!;
    expect(__testing.isHoverResponsive(span)).toBe(true);
  });

  it('detects data-bs-toggle attribute (Bootstrap)', () => {
    document.body.innerHTML = '<a data-bs-toggle="dropdown">Dropdown</a>';
    const a = document.querySelector('a')!;
    expect(__testing.isHoverResponsive(a)).toBe(true);
  });

  it('detects role="menuitem"', () => {
    document.body.innerHTML = '<div role="menuitem">Item</div>';
    const div = document.querySelector('div')!;
    expect(__testing.isHoverResponsive(div)).toBe(true);
  });

  it('detects anchor inside nav', () => {
    document.body.innerHTML = '<nav><a href="/products">Products</a></nav>';
    const a = document.querySelector('a')!;
    expect(__testing.isHoverResponsive(a)).toBe(true);
  });

  it('detects summary element', () => {
    document.body.innerHTML = '<details><summary>Expand</summary></details>';
    const summary = document.querySelector('summary')!;
    expect(__testing.isHoverResponsive(summary)).toBe(true);
  });

  it('rejects plain paragraph', () => {
    document.body.innerHTML = '<p>This is just text content.</p>';
    const p = document.querySelector('p')!;
    expect(__testing.isHoverResponsive(p)).toBe(false);
  });

  it('rejects plain div with no hover behavior', () => {
    document.body.innerHTML = '<div>Static content</div>';
    const div = document.querySelector('div')!;
    expect(__testing.isHoverResponsive(div)).toBe(false);
  });

  it('rejects plain image without hover behavior', () => {
    document.body.innerHTML = '<img src="test.png" alt="logo" />';
    const img = document.querySelector('img')!;
    expect(__testing.isHoverResponsive(img)).toBe(false);
  });
});

// ── C3.1 Gate 5: Observable Behavior — Cosmetic Exclusion ──

describe('C3.2 — Hover Qualification: Gate 5 (Cosmetic Exclusion)', () => {
  it('includes background-color in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('background-color')).toBe(true);
  });

  it('includes cursor in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('cursor')).toBe(true);
  });

  it('includes text-decoration in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('text-decoration')).toBe(true);
  });

  it('includes color in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('color')).toBe(true);
  });

  it('includes box-shadow in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('box-shadow')).toBe(true);
  });

  it('includes transform in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('transform')).toBe(true);
  });

  it('does NOT include display in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('display')).toBe(false);
  });

  it('does NOT include visibility in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('visibility')).toBe(false);
  });

  it('does NOT include opacity in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('opacity')).toBe(false);
  });

  it('does NOT include height in cosmetic set', () => {
    expect(__testing.COSMETIC_CSS_PROPERTIES.has('height')).toBe(false);
  });
});

// ── C3.1 Gate 5: Observable Behavior — Style Change ──────

describe('C3.2 — Hover Qualification: Gate 5 (Style Change Detection)', () => {
  it('qualifies display change as non-cosmetic', () => {
    document.body.innerHTML = '<div id="revealed" style="display:block;height:200px;">Content</div>';
    const div = document.querySelector('#revealed') as HTMLElement;
    expect(__testing.hasNonCosmeticInlineStyleChange(div)).toBe(true);
  });

  it('qualifies visibility change as non-cosmetic', () => {
    document.body.innerHTML = '<div id="visible" style="visibility:visible;">Content</div>';
    const div = document.querySelector('#visible') as HTMLElement;
    expect(__testing.hasNonCosmeticInlineStyleChange(div)).toBe(true);
  });

  it('rejects purely cosmetic change (background-color only)', () => {
    document.body.innerHTML = '<div id="cosmetic" style="background-color:red;">Content</div>';
    const div = document.querySelector('#cosmetic') as HTMLElement;
    expect(__testing.hasNonCosmeticInlineStyleChange(div)).toBe(false);
  });

  it('rejects purely cosmetic change (cursor only)', () => {
    document.body.innerHTML = '<div id="cosmetic" style="cursor:pointer;">Content</div>';
    const div = document.querySelector('#cosmetic') as HTMLElement;
    expect(__testing.hasNonCosmeticInlineStyleChange(div)).toBe(false);
  });

  it('rejects purely cosmetic change (text-decoration only)', () => {
    document.body.innerHTML = '<div id="cosmetic" style="text-decoration:underline;">Content</div>';
    const div = document.querySelector('#cosmetic') as HTMLElement;
    expect(__testing.hasNonCosmeticInlineStyleChange(div)).toBe(false);
  });

  it('qualifies mixed cosmetic + non-cosmetic (background-color + display)', () => {
    document.body.innerHTML = '<div id="mixed" style="background-color:red;display:block;">Content</div>';
    const div = document.querySelector('#mixed') as HTMLElement;
    expect(__testing.hasNonCosmeticInlineStyleChange(div)).toBe(true);
  });
});

// ── Identity Extraction ──────────────────────────────────

describe('C3.2 — Identity Extraction', () => {
  it('extracts aria-label as accessibleName', () => {
    document.body.innerHTML = '<button aria-label="Open Menu">≡</button>';
    const btn = document.querySelector('button')!;
    const identity = __testing.extractIdentity(btn);
    expect(identity.accessibleName).toBe('Open Menu');
    expect(identity.ariaLabel).toBe('Open Menu');
  });

  it('extracts innerText as accessibleName', () => {
    document.body.innerHTML = '<a href="/products">Products</a>';
    const a = document.querySelector('a')!;
    const identity = __testing.extractIdentity(a);
    expect(identity.accessibleName).toBe('Products');
  });

  it('extracts title attribute as accessibleName when no inner text', () => {
    document.body.innerHTML = '<span title="Help text"></span>';
    const span = document.querySelector('span')!;
    const identity = __testing.extractIdentity(span);
    expect(identity.accessibleName).toBe('Help text');
  });

  it('extracts tag name', () => {
    document.body.innerHTML = '<nav>Mega Menu</nav>';
    const nav = document.querySelector('nav')!;
    const identity = __testing.extractIdentity(nav);
    expect(identity.tag).toBe('NAV');
  });

  it('extracts id as stableId', () => {
    document.body.innerHTML = '<div id="main-nav">Nav</div>';
    const div = document.querySelector('div')!;
    const identity = __testing.extractIdentity(div);
    expect(identity.stableId).toBe('main-nav');
  });

  it('extracts data-testid', () => {
    document.body.innerHTML = '<div data-testid="hover-menu">Menu</div>';
    const div = document.querySelector('div')!;
    const identity = __testing.extractIdentity(div);
    expect(identity.testId).toBe('hover-menu');
  });

  it('generates CSS selector', () => {
    document.body.innerHTML = '<div id="wrapper"><button class="btn">Click</button></div>';
    const btn = document.querySelector('button')!;
    const identity = __testing.extractIdentity(btn);
    expect(identity.cssSelector).toBeTruthy();
    expect(identity.cssSelector).toContain('button');
  });

  it('generates XPath', () => {
    document.body.innerHTML = '<div id="wrapper"><button class="btn">Click</button></div>';
    const btn = document.querySelector('button')!;
    const identity = __testing.extractIdentity(btn);
    expect(identity.xPath).toBeTruthy();
    expect(identity.xPath).toContain('//');
  });

  it('detects iframe context', () => {
    document.body.innerHTML = '<button>In iframe</button>';
    const btn = document.querySelector('button')!;
    const identity = __testing.extractIdentity(btn);
    // In test environment, window === window.top is usually true
    expect(identity.inIframe).toBe(false);
  });
});

// ── Interaction Type Registration ────────────────────────

describe('C3.2 — Hover Interaction Type Registration', () => {
  it('hover type is registered', () => {
    const types = getRegisteredTypes();
    expect(types).toContain('hover');
  });

  it('hover config has correct actionType', () => {
    const config = getInteractionType('hover');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('hover');
  });

  it('hover config has correct idPrefix', () => {
    const config = getInteractionType('hover');
    expect(config!.idPrefix).toBe('hover');
  });

  it('hover config has amber badge color', () => {
    const config = getInteractionType('hover');
    expect(config!.badgeColor).toBe('#f59e0b');
  });

  it('hover config has Hover badge label', () => {
    const config = getInteractionType('hover');
    expect(config!.badgeLabel).toBe('Hover');
  });
});

// ── Plain English Generation ─────────────────────────────

describe('C3.2 — Hover Plain English', () => {
  it('generates "Hover over [name]" using accessibleName', () => {
    const config = getInteractionType('hover')!;
    const identity: ElementIdentity = {
      accessibleName: 'Products',
      ariaRole: 'link',
      ariaLabel: null, ariaLabelledBy: null, placeholder: null,
      tag: 'A', name: null, stableId: null, testId: null,
      dataCy: null, dataQa: null,
      className: null,
      cssSelector: 'nav > a', xPath: '//nav/a',
      inIframe: false, shadowDom: false, elementId: 'elem-0001',
    };
    const result = config.toPlainEnglish({
      identity,
      understanding: undefined,
      extras: {},
    });
    expect(result).toBe('Hover over "Products"');
  });

  it('uses AI business name when available', () => {
    const config = getInteractionType('hover')!;
    const identity: ElementIdentity = {
      accessibleName: 'Products',
      ariaRole: null, ariaLabel: null, ariaLabelledBy: null, placeholder: null,
      tag: 'A', name: null, stableId: null, testId: null,
      dataCy: null, dataQa: null,
      className: null,
      cssSelector: 'nav > a', xPath: '//nav/a',
      inIframe: false, shadowDom: false, elementId: 'elem-0001',
    };
    const result = config.toPlainEnglish({
      identity,
      understanding: { businessName: 'Products Mega Menu', category: 'navigation' } as never,
      extras: {},
    });
    expect(result).toBe('Hover over "Products Mega Menu"');
  });

  it('falls back to tag when no name available', () => {
    const config = getInteractionType('hover')!;
    const identity: ElementIdentity = {
      accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
      placeholder: null, tag: 'DIV', name: null, stableId: null, testId: null,
      dataCy: null, dataQa: null,
      className: null,
      cssSelector: 'body > div', xPath: '//body/div',
      inIframe: false, shadowDom: false, elementId: 'elem-0001',
    };
    const result = config.toPlainEnglish({
      identity,
      understanding: undefined,
      extras: {},
    });
    expect(result).toBe('Hover over "DIV"');
  });
});

// ── Canonical Step Generation ────────────────────────────

describe('C3.2 — Canonical Step Generation (hover event)', () => {
  it('generates a canonical step from hover event', () => {
    const timeline: SessionEvent[] = [
      makeHoverEvent('hover-0001', 'Products'),
    ];

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext,
    });

    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    expect(result.output![0].actionType).toBe('hover');
    expect(result.output![0].plainEnglish).toBe('Hover over the Products');
    expect(result.output![0].stepId).toBeTruthy();
    expect(result.output![0].stepNumber).toBe(1);
    expect(result.output![0].executionJson).toBeNull();
  });

  it('preserves step order with clicks and navigation', () => {
    const timeline: SessionEvent[] = [
      makeHoverEvent('hover-0001', 'Products'),
      makeClickEvent('click-0001', 'Laptops'),
      makeNavEvent('nav-0001', 'https://example.com/laptops'),
    ];

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext,
    });

    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(3);
    expect(result.output![0].actionType).toBe('hover');
    expect(result.output![1].actionType).toBe('click');
    expect(result.output![2].actionType).toBe('navigate');
  });

  it('does NOT apply OR-1 merge to hover+click (different elements)', () => {
    // C3.1 §4.5: Hover is never merged by Readability Optimizer
    const timeline: SessionEvent[] = [
      makeHoverEvent('hover-0001', 'Products'),
      makeClickEvent('click-0001', 'Laptops'),
    ];

    const result = canonicalStepGenerator.generate({
      timeline,
      recordingContext,
    });

    expect(result.output).toHaveLength(2); // No merge
  });
});

// ── Execution JSON Generation ────────────────────────────

describe('C3.2 — Execution JSON (hover action)', () => {
  it('maps hover action type to "hover"', () => {
    const timeline: SessionEvent[] = [
      makeHoverEvent('hover-0001', 'Products', {
        className: null,
        tag: 'A', cssSelector: 'nav > a:nth-of-type(1)', xPath: '//nav/a[1]',
      }),
    ];

    const canonicalResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext,
    });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.status).toBe('success');
    expect(execResult.output![0].executionJson).not.toBeNull();
    expect(execResult.output![0].executionJson!.action.type).toBe('hover');
    expect(execResult.output![0].executionJson!.action.value).toBeNull();
  });

  it('hover action has element target (not navigation)', () => {
    const timeline: SessionEvent[] = [
      makeHoverEvent('hover-0001', 'Products', {
        className: null,
        tag: 'A', accessibleName: 'Products', cssSelector: 'nav > a',
      }),
    ];

    const canonicalResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext,
    });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    expect(execResult.output![0].executionJson!.target.kind).toBe('element');
    expect(execResult.output![0].executionJson!.target.tag).toBe('A');
  });

  it('hover has resolved locators', () => {
    const timeline: SessionEvent[] = [
      makeHoverEvent('hover-0001', 'Products', {
        className: null,
        tag: 'A', accessibleName: 'Products', cssSelector: 'nav > a',
      }),
    ];

    const canonicalResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext,
    });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });

    const json = execResult.output![0].executionJson!;
    expect(json.locators.length).toBeGreaterThan(0);
    const primary = json.locators.find((l) => l.role === 'primary');
    expect(primary).toBeDefined();
  });
});

// ── Playwright Generation ────────────────────────────────

describe('C3.2 — Playwright Generation (hover action)', () => {
  it('generates .hover() for hover action', () => {
    const timeline: SessionEvent[] = [
      makeHoverEvent('hover-0001', 'Products', {
        className: null,
        tag: 'A', accessibleName: 'Products', cssSelector: 'nav > a',
      }),
    ];

    const canonicalResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext,
    });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });
    const pwResult = playwrightGenerator.generate({
      steps: execResult.output as unknown as CanonicalStep[],
      recordingContext,
      testCaseName: 'Hover Menu Navigation',
    });

    expect(pwResult.status).toBe('success');
    expect(pwResult.output).toBeDefined();

    const code = pwResult.output!.testCode;
    expect(code).toContain('.hover()');
    expect(code).toContain('Products');
  });

  it('includes traceability comment referencing hover step', () => {
    const timeline: SessionEvent[] = [
      makeHoverEvent('hover-0001', 'Products'),
    ];

    const canonicalResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext,
    });
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });
    const pwResult = playwrightGenerator.generate({
      steps: execResult.output as unknown as CanonicalStep[],
      recordingContext,
      testCaseName: 'Test Hover',
    });

    const code = pwResult.output!.testCode;
    // Traceability comment should reference step 1
    expect(code).toMatch(/Step\s*1/i);
    // Should mention "Hover" in the comment
    expect(code).toMatch(/hover/i);
  });
});

// ── Full Pipeline Integration ────────────────────────────

describe('C3.2 — Full Pipeline: Hover → Click → Navigate', () => {
  it('generates all three step types through full pipeline', () => {
    const timeline: SessionEvent[] = [
      makeHoverEvent('hover-0001', 'Products'),
      makeClickEvent('click-0001', 'Laptops'),
      makeNavEvent('nav-0001', 'https://example.com/laptops'),
    ];

    // Canonical Steps
    const canonicalResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext,
    });
    expect(canonicalResult.output).toHaveLength(3);

    // Execution JSON
    const execResult = executionJsonGenerator.generate({
      steps: canonicalResult.output as CanonicalStep[],
    });
    expect(execResult.output![0].executionJson!.action.type).toBe('hover');
    expect(execResult.output![1].executionJson!.action.type).toBe('click');
    expect(execResult.output![2].executionJson!.action.type).toBe('navigate');

    // Playwright
    const pwResult = playwrightGenerator.generate({
      steps: execResult.output as unknown as CanonicalStep[],
      recordingContext,
      testCaseName: 'Mega Menu Navigation',
    });

    const code = pwResult.output!.testCode;
    expect(code).toContain('.hover()');
    expect(code).toContain('.click()');
    expect(code).toContain('page.goto(');
  });
});

// ── Debounce ─────────────────────────────────────────────

describe('C3.2 — Debounce', () => {
  it('RECENT_HOVER_SUPPRESS_MS is 2000', () => {
    expect(__testing.RECENT_HOVER_SUPPRESS_MS).toBe(2000);
  });
});

// ── Regression: No Interference ──────────────────────────

describe('C3.2 — Regression: Existing Types Unaffected', () => {
  it('click interaction type still registered', () => {
    const config = getInteractionType('click');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('click');
  });

  it('text interaction type still registered', () => {
    const config = getInteractionType('text');
    expect(config).toBeDefined();
    expect(config!.actionType).toBe('text');
  });

  it('seven interaction types registered (click, text, hover, checkbox, radio, select, dateSelect)', () => {
    const types = getRegisteredTypes();
    expect(types).toHaveLength(7);
    expect(types).toContain('click');
    expect(types).toContain('text');
    expect(types).toContain('hover');
  });

  it('click plain English still works', () => {
    const config = getInteractionType('click')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Submit',
        ariaRole: 'button', ariaLabel: null, ariaLabelledBy: null, placeholder: null,
        tag: 'BUTTON', name: null, stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'button', xPath: '//button',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: {},
    });
    expect(result).toBe('Click "Submit"');
  });

  it('text plain English still works', () => {
    const config = getInteractionType('text')!;
    const result = config.toPlainEnglish({
      identity: {
        accessibleName: 'Username',
        ariaRole: 'textbox', ariaLabel: null, ariaLabelledBy: null, placeholder: 'Enter username',
        tag: 'INPUT', name: 'username', stableId: null, testId: null,
        dataCy: null, dataQa: null,
        className: null,
        cssSelector: 'input[name="username"]', xPath: '//input[@name="username"]',
        inIframe: false, shadowDom: false, elementId: 'elem-0001',
      },
      understanding: undefined,
      extras: { value: 'admin' },
    });
    expect(result).toBe('Enter "admin" into "Username"');
  });
});
