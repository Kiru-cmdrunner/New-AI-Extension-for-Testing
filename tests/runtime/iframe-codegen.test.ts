/**
 * Iframe Code Generation Tests (P0-11)
 *
 * Validates that the IR Bridge resolves frame context from iframe-embedded
 * elements and the Playwright adapter generates frameLocator() prefixes.
 *
 * Event capture already works (manifest all_frames: true). This tests the
 * code generation pipeline — IR Bridge + Playwright adapter.
 */

import { describe, it, expect } from 'vitest';
import { build as buildIRPlan } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { DetectedInteraction } from '../../src/classifier/interaction-types';
import type { ElementIdentity, IframeContext } from '../../src/shared/types';
import type { IRStep } from '../../src/domain/execution-ir/types';
import { renderAction } from '../../src/adapters/playwright/action-renderer';

// ── Helpers ────────────────────────────────────────────────────────────

function makeIframeContext(overrides: Partial<IframeContext> = {}): IframeContext {
  return {
    frameSrc: 'https://js.stripe.com/v3/elements',
    frameName: null,
    frameId: null,
    frameSelector: null,
    frameXPath: null,
    frameIndex: 0,
    frameDepth: 1,
    ...overrides,
  };
}

function makeIframeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Card Number',
    ariaRole: 'textbox',
    ariaLabel: 'Card Number',
    ariaLabelledBy: null,
    placeholder: '1234 5678 9012 3456',
    tag: 'INPUT',
    className: 'stripe-field',
    name: 'cardnumber',
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'input[name="cardnumber"]',
    xPath: '//input[@name="cardnumber"]',
    inIframe: true,
    shadowDom: false,
    elementId: 'elem-0001',
    iframeContext: makeIframeContext(),
    ...overrides,
  };
}

function makeTopFrameTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaLabel: 'Submit',
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn-primary',
    name: null,
    stableId: 'submit-btn',
    testId: 'submit-btn',
    dataCy: null,
    dataQa: null,
    cssSelector: '#submit-btn',
    xPath: '//button[@id="submit-btn"]',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0002',
    ...overrides,
  };
}

function makeInteraction(
  type: string,
  target: ElementIdentity,
  metadata: Record<string, unknown> = {},
): DetectedInteraction {
  return {
    interactionId: `int-${type}-1`,
    type: type as any,
    eventIds: ['evt-1'],
    rawEventTypes: ['click'],
    target,
    metadata: metadata as any,
    confidence: 0.9,
  } as DetectedInteraction;
}

function buildPlan(interactions: DetectedInteraction[]): IRStep[] {
  const input: IRBridgeInput = {
    events: [],
    interactions,
    understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test' } as any,
    testCaseName: 'Iframe Test',
  };
  return buildIRPlan(input).steps;
}

// ── IR Bridge: Frame Resolution ───────────────────────────────────────

describe('Iframe IR Bridge — frame resolution', () => {
  it('populates frame when element has inIframe=true and iframeContext', () => {
    const target = makeIframeTarget();
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    expect(steps).toHaveLength(1);
    expect(steps[0].frame).toBeDefined();
    expect(steps[0].frame!.depth).toBe(1);
  });

  it('does NOT populate frame for top-frame elements', () => {
    const target = makeTopFrameTarget();
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    expect(steps).toHaveLength(1);
    expect(steps[0].frame).toBeUndefined();
  });

  it('uses frameSelector when available (same-origin)', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: 'iframe#stripe-payment',
        frameSrc: 'https://js.stripe.com/v3/elements',
      }),
    });
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    expect(steps[0].frame!.selector).toBe('iframe#stripe-payment');
    expect(steps[0].frame!.strategy).toBe('css');
  });

  it('uses frameName when frameSelector is null', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: 'stripe-frame',
      }),
    });
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    expect(steps[0].frame!.selector).toBe('iframe[name="stripe-frame"]');
    expect(steps[0].frame!.strategy).toBe('name');
  });

  it('uses frameId when frameSelector and frameName are null', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: 'payment-widget',
      }),
    });
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    expect(steps[0].frame!.selector).toBe('iframe#payment-widget');
    expect(steps[0].frame!.strategy).toBe('css');
  });

  it('uses frameSrc (url partial match) for cross-origin iframes', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: 'https://js.stripe.com/v3/elements/card-field',
      }),
    });
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    expect(steps[0].frame!.selector).toContain('iframe[src*="');
    expect(steps[0].frame!.strategy).toBe('url');
    expect(steps[0].frame!.frameSrc).toBe('https://js.stripe.com/v3/elements/card-field');
  });

  it('falls back to frameIndex when nothing else is available', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: '', // edge case: no src available
        frameIndex: 2,
      }),
    });
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    expect(steps[0].frame!.selector).toContain('nth=');
    expect(steps[0].frame!.strategy).toBe('index');
  });
});

// ── Playwright Adapter: frameLocator() ────────────────────────────────

describe('Iframe Playwright adapter — frameLocator() prefixing', () => {
  it('wraps element locator in frameLocator()', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: 'iframe#stripe',
      }),
    });
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    const code = renderAction(steps[0]);

    expect(code).toContain("frameLocator('iframe#stripe')");
    expect(code).toContain('.click()');
    expect(code).not.toMatch(/^page\.getBy/); // should NOT start with page.getBy
  });

  it('wraps fill action in frameLocator()', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: 'iframe#stripe',
      }),
    });
    const interaction = makeInteraction('TextEntry', target, {
      textValue: '4242424242424242',
    });

    const steps = buildPlan([interaction]);
    const code = renderAction(steps[0]);

    expect(code).toContain("frameLocator('iframe#stripe')");
    expect(code).toContain('.fill(');
    expect(code).toContain('4242424242424242');
  });

  it('does NOT add frameLocator for top-frame elements', () => {
    const target = makeTopFrameTarget();
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    const code = renderAction(steps[0]);

    expect(code).not.toContain('frameLocator');
    expect(code).toMatch(/^page\./);
  });

  it('uses URL-based selector for cross-origin iframes', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: 'https://js.stripe.com/v3/elements',
      }),
    });
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    const code = renderAction(steps[0]);

    expect(code).toContain('frameLocator(');
    expect(code).toContain('iframe[src*=');
  });
});

// ── Regression Tests ──────────────────────────────────────────────────

describe('Iframe codegen — regression', () => {
  it('mixed iframe and non-iframe steps in same plan', () => {
    const iframeTarget = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: 'iframe#widget',
      }),
    });
    const topTarget = makeTopFrameTarget();

    const steps = buildPlan([
      makeInteraction('Click', topTarget),        // open payment
      makeInteraction('TextEntry', iframeTarget, { textValue: 'test@example.com' }), // fill in iframe
      makeInteraction('Click', topTarget),        // submit
    ]);

    expect(steps).toHaveLength(3);
    expect(steps[0].frame).toBeUndefined();       // top-frame click
    expect(steps[1].frame).toBeDefined();          // iframe fill
    expect(steps[1].frame!.selector).toBe('iframe#widget');
    expect(steps[2].frame).toBeUndefined();       // top-frame click
  });
});

// ── Known Limitation ──────────────────────────────────────────────────

describe('Iframe codegen — known limitations', () => {
  it('depth > 1 iframes produce a single frameLocator (no chaining)', () => {
    // KNOWN LIMITATION: The content script's IframeContext captures only the
    // immediate parent frame, not the full ancestor chain. Nested iframes
    // (iframe-within-iframe) get a single frameLocator wrapping the immediate
    // parent. Full chaining requires enhancing the content script to walk
    // window.parent and collect ancestor frame selectors.
    //
    // This test documents the current behavior — it is NOT a bug.
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: 'iframe#inner-widget',
        frameDepth: 2, // nested
      }),
    });
    const interaction = makeInteraction('Click', target);

    const steps = buildPlan([interaction]);
    const code = renderAction(steps[0]);

    // Single frameLocator (immediate parent) — not chained
    const locatorCount = (code.match(/frameLocator/g) || []).length;
    expect(locatorCount).toBe(1);
    expect(code).toContain("frameLocator('iframe#inner-widget')");
  });
});
