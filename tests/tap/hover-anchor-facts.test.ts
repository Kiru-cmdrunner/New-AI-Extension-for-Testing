/**
 * HEC v1 §7 R-A1/R-A4 — anchor-fact recording pins.
 *
 * The mouseenter capture path must record BOTH anchor keys (hover anchor
 * elementKey + click-policy anchor elementKey) and the honest resolution
 * branch, so one physical act joins reliably downstream (R-A2) and the
 * record never fabricates how the anchor was derived (R-A4).
 *
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md §7, §11 (event-tap row).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';
import type { ObservedEvent, EventTapHandle } from '../../src/tap/event-tap';

function dispatch(dom: JSDOM, el: Element, type: string): void {
  // TEST_HOOK.forceTrusted is set in beforeEach — synthetic events are
  // accepted without redefining the non-configurable isTrusted.
  el.dispatchEvent(new dom.window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  }));
}

describe('HEC R-A1/R-A4 — mouseenter anchor facts', () => {
  let dom: JSDOM;
  let tap: EventTapHandle | null;
  let events: ObservedEvent[];

  beforeEach(() => {
    dom = new JSDOM(`<!doctype html><html><body>
      <div id="wrap"><span id="inner">text</span></div>
    </body></html>`);
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Element = dom.window.Element;
    globalThis.getComputedStyle = dom.window.getComputedStyle;
    TEST_HOOK.forceTrusted = true;
    events = [];
    tap = createEventTap({ onEvent: (e) => events.push(e) });
  });

  afterEach(() => {
    tap?.stop();
    tap = null;
    TEST_HOOK.forceTrusted = false;
    (globalThis as Record<string, unknown>).window = undefined;
    (globalThis as Record<string, unknown>).document = undefined;
  });

  it('records hoverAnchorKey, hoverClickAnchorKey, and resolution on mouseenter', () => {
    const wrap = dom.window.document.getElementById('wrap')!;
    // wrap is a plain div (not hover-shaped): resolution stays honest.
    dispatch(dom, wrap, 'mouseenter');
    const enter = events.find((e) => e.eventType === 'mouseenter');
    expect(enter).toBeTruthy();
    const ctx = enter!.domContext as Record<string, unknown>;
    expect(typeof ctx.hoverAnchorKey).toBe('string');
    expect((ctx.hoverAnchorKey as string).length).toBeGreaterThan(0);
    expect(typeof ctx.hoverClickAnchorKey).toBe('string');
    expect((ctx.hoverClickAnchorKey as string).length).toBeGreaterThan(0);
    expect(['self', 'ancestor-lift', 'reveal-target', 'body']).toContain(ctx.hoverAnchorResolution);
  });

  it('does NOT record anchor facts on non-mouseenter events (undefined = legacy)', () => {
    const wrap = dom.window.document.getElementById('wrap')!;
    dispatch(dom, wrap, 'click');
    const click = events.find((e) => e.eventType === 'click');
    expect(click).toBeTruthy();
    const ctx = click!.domContext as Record<string, unknown>;
    expect(ctx.hoverAnchorKey).toBeUndefined();
    expect(ctx.hoverClickAnchorKey).toBeUndefined();
    expect(ctx.hoverAnchorResolution).toBeUndefined();
  });

  it('records an ancestor-lift when the raw element lifts to a shaped ancestor', () => {
    // Make wrap hover-shaped (tabbable) and enter via the unshaped child.
    const wrap = dom.window.document.getElementById('wrap')!;
    (wrap as unknown as { tabIndex: number }).tabIndex = 0;
    const inner = dom.window.document.getElementById('inner')!;
    dispatch(dom, inner, 'mouseenter');
    const enter = events.find((e) => e.eventType === 'mouseenter');
    expect(enter).toBeTruthy();
    const ctx = enter!.domContext as Record<string, unknown>;
    expect(ctx.hoverAnchorResolution).toBe('ancestor-lift');
    // The anchor key must key the LIFTED element (wrap), not the raw child.
    expect(String(ctx.hoverAnchorKey)).toContain('id:wrap');
  });

  it('records self resolution when the raw element is already shaped', () => {
    const wrap = dom.window.document.getElementById('wrap')!;
    (wrap as unknown as { tabIndex: number }).tabIndex = 0;
    dispatch(dom, wrap, 'mouseenter');
    const enter = events.find((e) => e.eventType === 'mouseenter');
    expect(enter).toBeTruthy();
    expect((enter!.domContext as Record<string, unknown>).hoverAnchorResolution).toBe('self');
  });

  it('anchor facts survive into the evidence-collector envelope (R-A2 join set)', async () => {
    // Import the pure verdict function and the real capture facts.
    const { computeHoverQualification } = await import('../../src/tap/hover-qualification');
    // Fire a real capture first so the domContext carries recorded facts.
    const wrap = dom.window.document.getElementById('wrap')!;
    (wrap as unknown as { tabIndex: number }).tabIndex = 0;
    dispatch(dom, wrap, 'mouseenter');
    const enter = events.find((e) => e.eventType === 'mouseenter');
    expect(enter).toBeTruthy();
    const domContext = (enter?.domContext ?? {}) as Record<string, unknown>;
    // Simulate the collector's prepared-facts read (evidence-collector.ts
    // hoverAnchorFactsOf): with the fields present, the record copies them.
    const facts = {
      resolution: domContext.hoverAnchorResolution ?? 'self',
      anchorKey: (domContext.hoverAnchorKey as string) ?? '',
      clickAnchorKey: (domContext.hoverClickAnchorKey as string) ?? '',
    };
    expect(facts.anchorKey).not.toBe('');
    const q = computeHoverQualification({
      anchorIdentity: {
        tag: 'DIV', stableId: 'wrap', accessibleName: '', cssSelector: '#wrap',
        domPath: 'html>body>div#wrap', classes: '', ariaRole: null, testId: null,
      },
      anchorKey: facts.anchorKey,
      clickAnchorKey: facts.clickAnchorKey,
      resolution: facts.resolution as 'self',
      hoverReveal: false,
      shaped: false,
      baseline: { anchor: { ariaExpanded: 'false', ariaHidden: 'true', hidden: false } },
      domChanges: [{
        target: '#wrap', path: 'html>body>div#wrap',
        attributeDeltas: { 'aria-hidden': { old: 'true', new: 'false' } },
        addedNodesCount: 0, removedNodesCount: 0, characterDataDelta: null,
        changedAttributes: ['aria-hidden'], firstBatchIndex: 0, firstMutationAt: 5,
      }],
      newSurfaces: [], visibilityChanges: [], pointerPathEnters: [], networkRows: [],
      navigationCount: 0,
    });
    expect(q.anchorFacts.anchorKey).toBe(facts.anchorKey);
    expect(q.anchorFacts.clickAnchorKey).toBe(facts.clickAnchorKey);
    expect(q.anchorFacts.resolution).toBe(facts.resolution);
    expect(Object.isFrozen(q.anchorFacts)).toBe(true);
  });
});
