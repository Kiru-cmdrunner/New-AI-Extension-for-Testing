/**
 * Phase 6A/6C stabilization — observer-layer honesty pins (integration).
 *
 * Spec: Semantic Observation Contract rungs 3/7 (E2/E9) + validation-report
 * defects 1-2. Red until pickSeedKind applies the mixed-numeral counter rule
 * and the identity-coordinate gate drops unlabeled text-shape candidates.
 * No product code here.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { PageContentObserver } from '../../src/understanding/page-content/page-content-observer';
import { createDefaultPageContentConfig } from '../../src/understanding/page-content/page-content-config';
import { BrowserPageContentAdapter } from '../../src/tap/page-content-dom-adapter';
import type { DomChangeSummary } from '../../src/shared/behavioral-evidence-types';

function setup(html: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    pretendToBeVisual: true,
  });
  (globalThis as Record<string, unknown>).window = dom.window;
  (globalThis as Record<string, unknown>).document = dom.window.document;
  const adapter = new BrowserPageContentAdapter(dom.window.document);
  const observer = new PageContentObserver(createDefaultPageContentConfig(), adapter);
  return { dom, adapter, observer };
}

function summary(overrides: Partial<DomChangeSummary> = {}): DomChangeSummary {
  return {
    types: ['characterData'],
    targetPath: 'body > div#x',
    targetTag: 'DIV',
    shadowContext: null,
    changedAttributes: [],
    attributeDeltas: {},
    addedNodesCount: 0,
    removedNodesCount: 0,
    characterDataDelta: { old: '0', new: '5' },
    firstMutationAt: 10,
    lastMutationAt: 20,
    rawMutationCount: 1,
    firstBatchIndex: 1,
    lastBatchIndex: 1,
    ...overrides,
  };
}

describe('observer seeded scan — mixed-numeral counter (fix 2, E2 family)', () => {
  it('"4 items"→"5 items" on span#cart seeds a COUNTER with numericValue 5 (not a notification)', () => {
    const { observer } = setup('<span id="cart">5 items</span>');
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > span#cart',
        targetTag: 'SPAN',
        characterDataDelta: { old: '4 items', new: '5 items' },
      }),
    ]);
    const counters = snap!.items.filter((i) => i.kind === 'counter');
    const notes = snap!.items.filter((i) => i.kind === 'notification');
    expect(counters).toHaveLength(1);
    expect(counters[0].numericValue).toBe(5);
    expect(notes).toHaveLength(0);
  });

  it('aria-labeled date-like display text stays a status-badge, never a counter ("Sat, 22 Aug" family)', () => {
    const { observer } = setup(
      '<span id="date-out" aria-label="Selected departure date">Sat, 22 Aug</span>',
    );
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > span#date-out',
        targetTag: 'SPAN',
        characterDataDelta: { old: 'Sat, 15 Aug', new: 'Sat, 22 Aug' },
      }),
    ]);
    const counters = snap!.items.filter((i) => i.kind === 'counter');
    const badges = snap!.items.filter((i) => i.kind === 'status-badge');
    expect(counters).toHaveLength(0);
    expect(badges).toHaveLength(1);
  });
});

describe('observer seeded scan — E9 unlabeled display text (fix 1, rung 7)', () => {
  it('class-only "02h 30m" duration change seeds NOTHING (no identity coordinate)', () => {
    const { observer } = setup('<div class="trip-duration">02h 30m</div>');
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > div',
        targetTag: 'DIV',
        characterDataDelta: { old: '02h', new: '02h 30m' },
      }),
    ]);
    const seeded = (snap?.items ?? []).filter((i) => i.matchedSelector === 'changed-element-seed');
    expect(seeded).toHaveLength(0);
  });

  it('same shape WITH an aria-label seeds as status-badge (honest, addressable)', () => {
    const { observer } = setup(
      '<div class="trip-duration" aria-label="Total travel time">02h 30m</div>',
    );
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > div',
        targetTag: 'DIV',
        characterDataDelta: { old: '02h', new: '02h 30m' },
      }),
    ]);
    const badges = snap!.items.filter(
      (i) => i.kind === 'status-badge' && i.matchedSelector === 'changed-element-seed',
    );
    expect(badges).toHaveLength(1);
  });

  it('role=alert seeds as notification regardless of label (rung 2 outranks rung 7)', () => {
    const { observer } = setup('<span class="toast" role="alert">Flight added</span>');
    const snap = observer.scan(null, [
      summary({
        targetPath: 'body > span',
        targetTag: 'SPAN',
        characterDataDelta: { old: '', new: 'Flight added' },
      }),
    ]);
    // role=alert is in the SELECTOR vocabulary — the item may be captured by
    // the selector pass; what matters for rung 2 is that the notification is
    // OBSERVED (never dropped by the rung-7 gate, which exempts explicit roles).
    const notes = snap!.items.filter((i) => i.kind === 'notification');
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Flight added');
  });
});
