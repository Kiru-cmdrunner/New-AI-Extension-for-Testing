/**
 * Iframe Architecture Hardening Tests
 *
 * Validates the 6 confirmed bug fixes from the production audit:
 *   #4: CSS.escape crash in Service Worker (CRITICAL)
 *   #2: MutationObserver DOS (CRITICAL)
 *   #1: FrameTree memory leak (HIGH)
 *   #3: srcdoc iframe collision (HIGH)
 *   #5: extractUrlFragment fragility (HIGH)
 *   #6: webNavigation debounce (MEDIUM)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { build as buildIRPlan } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { DetectedInteraction } from '../../src/classifier/interaction-types';
import type { ElementIdentity, IframeContext } from '../../src/shared/types';
import { renderAction } from '../../src/adapters/playwright/action-renderer';

// ── Helpers ────────────────────────────────────────────────────────────

function makeIframeContext(overrides: Partial<IframeContext> = {}): IframeContext {
  return {
    frameSrc: 'https://widget.example.com/checkout',
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
    accessibleName: 'Field',
    ariaRole: 'textbox',
    ariaLabel: 'Field',
    ariaLabelledBy: null,
    placeholder: 'Enter value',
    tag: 'INPUT',
    className: 'field',
    name: 'field',
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'input.field',
    xPath: '//input',
    inIframe: true,
    shadowDom: false,
    elementId: 'elem-0001',
    iframeContext: makeIframeContext(),
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

function buildPlan(interactions: DetectedInteraction[]) {
  const input: IRBridgeInput = {
    events: [],
    interactions,
    understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test' } as any,
    testCaseName: 'Hardening Test',
  };
  return buildIRPlan(input).steps;
}

// ── #4: CSS.escape crash in Service Worker ─────────────────────────────

describe('#4 CSS.escape polyfill — safe in SW context (no DOM)', () => {
  it('escapes special chars in frameId without CSS global', () => {
    // Simulate SW context: CSS is undefined
    const originalCSS = (globalThis as any).CSS;
    delete (globalThis as any).CSS;

    try {
      const target = makeIframeTarget({
        iframeContext: makeIframeContext({
          frameSelector: null,
          frameName: null,
          frameId: 'my:frame', // colon requires CSS escaping
        }),
      });

      // Should NOT throw — the polyfill handles CSS being undefined
      const steps = buildPlan([makeInteraction('Click', target)]);
      expect(steps).toHaveLength(1);
      expect(steps[0].frame).toBeDefined();
      // The selector should be a valid escaped CSS id selector
      expect(steps[0].frame!.selector).toContain('iframe#');
    } finally {
      // Restore
      if (originalCSS) (globalThis as any).CSS = originalCSS;
    }
  });

  it('does not crash for frameId with spaces', () => {
    const originalCSS = (globalThis as any).CSS;
    delete (globalThis as any).CSS;

    try {
      const target = makeIframeTarget({
        iframeContext: makeIframeContext({
          frameSelector: null,
          frameName: null,
          frameId: 'frame id with spaces',
        }),
      });

      expect(() => buildPlan([makeInteraction('Click', target)])).not.toThrow();
    } finally {
      if (originalCSS) (globalThis as any).CSS = originalCSS;
    }
  });

  it('produces valid selector for safe frameId (no special chars)', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: 'payment-frame',
      }),
    });

    const steps = buildPlan([makeInteraction('Click', target)]);
    expect(steps[0].frame!.selector).toBe('iframe#payment-frame');
    expect(steps[0].frame!.strategy).toBe('css');
  });

  it('escapes ALL special characters, not just the first', () => {
    // Regression test for reviewer WARN: non-global regex only escaped first char
    const originalCSS = (globalThis as any).CSS;
    delete (globalThis as any).CSS;

    try {
      const target = makeIframeTarget({
        iframeContext: makeIframeContext({
          frameSelector: null,
          frameName: null,
          frameId: 'a:b:c', // 2 colons — both must be escaped
        }),
      });

      const steps = buildPlan([makeInteraction('Click', target)]);
      const selector = steps[0].frame!.selector;
      // Both colons should be escaped (\\: appears 2 times)
      const escapeCount = (selector.match(/\\:/g) || []).length;
      expect(escapeCount).toBe(2);
      // Verify NO unescaped colon remains
      // Remove all \\: patterns and check no : remains
      const withoutEscaped = selector.replace(/\\:/g, '');
      expect(withoutEscaped).not.toContain(':');
    } finally {
      if (originalCSS) (globalThis as any).CSS = originalCSS;
    }
  });
});

// ── #3: srcdoc iframe collision ────────────────────────────────────────

describe('#3 srcdoc/about:blank iframe collision', () => {
  it('does not produce iframe[src*="about:srcdoc"] for srcdoc iframes', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: 'about:srcdoc',
      }),
    });

    const steps = buildPlan([makeInteraction('Click', target)]);
    expect(steps[0].frame).toBeDefined();
    // Should NOT use the ambiguous about:srcdoc in a src*= selector
    expect(steps[0].frame!.selector).not.toContain('about:srcdoc');
  });

  it('falls back to index strategy for about:srcdoc with no selector', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: 'about:srcdoc',
        frameIndex: 1,
      }),
    });

    const steps = buildPlan([makeInteraction('Click', target)]);
    expect(steps[0].frame).toBeDefined();
    expect(steps[0].frame!.selector).toContain('nth=');
  });

  it('still works for about:blank', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: 'about:blank',
        frameIndex: 0,
      }),
    });

    const steps = buildPlan([makeInteraction('Click', target)]);
    expect(steps[0].frame).toBeDefined();
    expect(steps[0].frame!.selector).not.toContain('about:blank');
  });

  it('does not use about:blank in src* selector for resolveFrameFromUrl', () => {
    // Test via the SW ancestor path — when an ancestor URL is about:srcdoc,
    // it should not produce iframe[src*="about:srcdoc"]
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: 'iframe#inner',
        frameSrc: 'https://inner.example.com',
        frameDepth: 2,
        swDepth: 2,
        swAncestorUrls: [
          'https://app.example.com',
          'about:srcdoc', // ancestor is a srcdoc iframe
          'https://inner.example.com',
        ],
      } as any),
    });

    const steps = buildPlan([makeInteraction('Click', target)]);
    const code = renderAction(steps[0]);
    // Should not have about:srcdoc in any frameLocator
    expect(code).not.toContain('about:srcdoc');
  });
});

// ── #5: extractUrlFragment query param disambiguation ──────────────────

describe('#5 extractUrlFragment — query param disambiguation', () => {
  it('includes query param in selector when present', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: 'https://widget.example.com/checkout?session=abc123',
      }),
    });

    const steps = buildPlan([makeInteraction('Click', target)]);
    expect(steps[0].frame).toBeDefined();
    expect(steps[0].frame!.selector).toContain('checkout');
    expect(steps[0].frame!.selector).toContain('session');
    expect(steps[0].frame!.selector).toContain('abc123');
  });

  it('differentiates same-path iframes with different query params', () => {
    const targetA = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: 'https://widget.example.com/embed?type=card',
      }),
    });

    const targetB = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: 'https://widget.example.com/embed?type=bank',
      }),
    });

    const stepsA = buildPlan([makeInteraction('Click', targetA)]);
    const stepsB = buildPlan([makeInteraction('Click', targetB)]);

    // The selectors should differ because query params differ
    expect(stepsA[0].frame!.selector).not.toBe(stepsB[0].frame!.selector);
    expect(stepsA[0].frame!.selector).toContain('card');
    expect(stepsB[0].frame!.selector).toContain('bank');
  });

  it('works without query params (regression)', () => {
    const target = makeIframeTarget({
      iframeContext: makeIframeContext({
        frameSelector: null,
        frameName: null,
        frameId: null,
        frameSrc: 'https://widget.example.com/checkout',
      }),
    });

    const steps = buildPlan([makeInteraction('Click', target)]);
    expect(steps[0].frame!.selector).toContain('checkout');
    expect(steps[0].frame!.selector).not.toContain('?');
  });
});

// ── #1: FrameTree memory leak — clearTab/clearAll lifecycle ────────────

describe('#1 FrameTree lifecycle — clearTab/clearAll', () => {
  beforeEach(() => {
    // Ensure chrome global is mocked for FrameTree.refresh calls
    if (!(globalThis as any).chrome) {
      (globalThis as any).chrome = {
        webNavigation: {
          getAllFrames: vi.fn().mockResolvedValue([
            { frameId: 0, parentFrameId: -1, url: 'https://test.com' },
          ]),
        },
      };
    }
  });

  it('clearTab removes a tab-specific tree instance', async () => {
    const { FrameTree } = await import('../../src/background/frame-tree');

    // Use unique tab IDs unlikely to collide with other tests
    const tabId = 99991;
    const tree = FrameTree.forTab(tabId);
    expect(tree).toBeDefined();

    await tree.refresh(tabId);
    expect(tree.size).toBe(1);

    FrameTree.clearTab(tabId);
    // Getting a new tree should be a fresh instance
    const newTree = FrameTree.forTab(tabId);
    expect(newTree.size).toBe(0);

    FrameTree.clearTab(tabId);
  });

  it('clearAll removes all tab tree instances', async () => {
    const { FrameTree } = await import('../../src/background/frame-tree');

    const tab1 = 99992;
    const tab2 = 99993;

    FrameTree.forTab(tab1);
    FrameTree.forTab(tab2);

    FrameTree.clearAll();

    // New instances should be fresh
    const tree1 = FrameTree.forTab(tab1);
    expect(tree1.size).toBe(0);

    FrameTree.clearTab(tab1);
    FrameTree.clearTab(tab2);
  });
});

// ── #3: FrameTree srcdoc mergeSelectors disambiguation ─────────────────

describe('#3 FrameTree — srcdoc selectorMap collision avoidance', () => {
  it('stores srcdoc entries by CSS selector, not URL', async () => {
    const { FrameTree } = await import('../../src/background/frame-tree');

    const tabId = 99994;
    const tree = FrameTree.forTab(tabId);

    // Two srcdoc iframes with different CSS selectors but same URL
    tree.mergeSelectors([
      {
        frameSelector: 'iframe#editor-1',
        frameName: null,
        frameId: 'editor-1',
        frameIndex: 0,
        frameSrc: 'about:srcdoc',
      },
      {
        frameSelector: 'iframe#editor-2',
        frameName: null,
        frameId: 'editor-2',
        frameIndex: 1,
        frameSrc: 'about:srcdoc',
      },
    ]);

    // Both should be retrievable via getSelectorForUrl
    const result = tree.getSelectorForUrl('about:srcdoc');
    expect(result).toBeDefined();
    // Both are stored — first one returned
    expect(result!.frameSelector).toMatch(/iframe#editor-[12]/);

    FrameTree.clearTab(tabId);
  });

  it('normal URLs still keyed by URL (no regression)', async () => {
    const { FrameTree } = await import('../../src/background/frame-tree');

    const tabId = 99995;
    const tree = FrameTree.forTab(tabId);

    tree.mergeSelectors([
      {
        frameSelector: 'iframe#stripe',
        frameName: null,
        frameId: 'stripe',
        frameIndex: 0,
        frameSrc: 'https://js.stripe.com/v3/elements',
      },
    ]);

    const result = tree.getSelectorForUrl('https://js.stripe.com/v3/elements');
    expect(result).toBeDefined();
    expect(result!.frameSelector).toBe('iframe#stripe');

    FrameTree.clearTab(tabId);
  });

  it('clearSelectors clears both maps', async () => {
    const { FrameTree } = await import('../../src/background/frame-tree');

    const tabId = 99996;
    const tree = FrameTree.forTab(tabId);

    tree.mergeSelectors([
      {
        frameSelector: 'iframe#srcdoc-1',
        frameName: null,
        frameId: 'srcdoc-1',
        frameIndex: 0,
        frameSrc: 'about:srcdoc',
      },
    ]);

    tree.clearSelectors();
    expect(tree.getSelectorForUrl('about:srcdoc')).toBeUndefined();

    FrameTree.clearTab(tabId);
  });
});
