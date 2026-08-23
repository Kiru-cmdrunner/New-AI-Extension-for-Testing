/**
 * Phase 6D.1 W2 — 1/1 text-swap counter seeding (#id-only counters).
 *
 * Spec: .drytis/specs/phase-6d1-universal-interaction-classes.md §3 W2
 *
 * Root cause (audit 92de517, classic app): `el.textContent = "2 tickets"`
 * on p#result-count captures as a net-zero childList swap
 * {types:['childList'], addedNodesCount:1, removedNodesCount:1,
 *  characterDataDelta:null} — the classifier's net-zero-churn gate drops
 * it, so #id-only counters never seed.
 *
 * Fix shape (§2.3 decision 2 — shape-gated relaxation):
 *  - classifier: added===removed===1 childList on the PARENT emits a
 *    text-swap candidate (kinds: counter|notification|status-badge,
 *    resolveViaChildren=false) — classification stays pure (no DOM reads)
 *  - resolution: text-swap candidates resolve to the element AT ITS PATH;
 *    the element must have NO element children at scan time (that is the
 *    structural proof the 1/1 swap was TEXT nodes, since DomChangeSummary
 *    records counts, not node types); text/kind/anchor gates then apply
 *
 * Pins:
 *  - AC-W2a: p#result-count "2 tickets" → counter item, numericValue 2,
 *    matchedSelector changed-element-seed, uniqueInSnapshot true (own #id)
 *  - AC-W2b: unlabeled non-numeric text-swap w/o identity coordinate → NO item
 *  - AC-W2c: element churn (2/2, 4/4, mount/unmount) stays DROPPED
 *  - AC-W2d: STAB — every pre-6D.1 classifier shape unchanged
 *  - AC-W2e: end-to-end derivation — the seeded counter derives its #id
 *    locator + text assertion through deriveStepAssertions
 *
 * TDD: written before implementation. Red until the relaxation ships.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { classifyChangedSummaries } from '../../src/understanding/page-content/changed-element-seed';
import { PageContentObserver } from '../../src/understanding/page-content/page-content-observer';
import { createDefaultPageContentConfig } from '../../src/understanding/page-content/page-content-config';
import { BrowserPageContentAdapter } from '../../src/tap/page-content-dom-adapter';
import { deriveStepAssertions } from '../../src/generation/assertion-derivation';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { WireObservedItem } from '../../src/shared/page-content-wire';
import type { DomChangeSummary } from '../../src/shared/behavioral-evidence-types';

const SEED = 'changed-element-seed';

function summary(overrides: Partial<DomChangeSummary> = {}): DomChangeSummary {
  return {
    types: ['characterData'],
    targetPath: 'body > div#counter',
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

function setup(html: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    pretendToBeVisual: true,
  });
  (globalThis as Record<string, unknown>).window = dom.window;
  (globalThis as Record<string, unknown>).document = dom.window.document;
  const adapter = new BrowserPageContentAdapter(dom.window.document);
  const observer = new PageContentObserver(createDefaultPageContentConfig(), adapter);
  return { observer };
}

/** The exact real-capture shape of the audit miss (classic p#result-count). */
function textSwapSummary(path: string, tag: string): DomChangeSummary {
  return summary({
    types: ['childList'],
    targetPath: path,
    targetTag: tag,
    characterDataDelta: null,
    addedNodesCount: 1,
    removedNodesCount: 1,
  });
}

// ── AC-W2a: classifier + resolution ────────────────────────────────────

describe('6D.1 W2 — 1/1 text-swap classification', () => {
  it('classifier emits a candidate for the audit shape (1/1 childList on a text-bearing parent)', () => {
    const seeds = classifyChangedSummaries([
      textSwapSummary('body > p#result-count', 'P'),
    ]);
    expect(seeds.length).toBe(1);
    expect(seeds[0].resolveViaChildren).toBe(false);
    // Kinds are provisional (counter|notification|status-badge superset);
    // the classifier cannot read text — resolution refines.
    expect(seeds[0].candidateKinds.length).toBeGreaterThanOrEqual(1);
    expect(seeds[0].candidateKinds.every((k) =>
      k === 'counter' || k === 'notification' || k === 'status-badge')).toBe(true);
  });

  it('AC-W2a: classic #id-only counter resolves to a counter item with numericValue 2', () => {
    const { observer } = setup(
      '<p class="muted" id="result-count">2 tickets</p>',
    );
    const snap = observer.scan(null, [
      textSwapSummary('body > p#result-count', 'P'),
    ]);
    expect(snap).not.toBeNull();
    const counters = snap!.items.filter((i) => i.kind === 'counter');
    expect(counters.length).toBe(1);
    expect(counters[0].numericValue).toBe(2);
    expect(counters[0].text).toBe('2 tickets');
    expect(counters[0].matchedSelector).toBe(SEED);
    expect(counters[0].domPath).toBe('body > p#result-count');
    expect(counters[0].uniqueInSnapshot).toBe(true); // own #id
  });

  it('AC-W2a: bare-digit swap ("3") also resolves as a counter', () => {
    const { observer } = setup('<span id="qty">3</span>');
    const snap = observer.scan(null, [
      textSwapSummary('body > span#qty', 'SPAN'),
    ]);
    const counters = snap!.items.filter((i) => i.kind === 'counter');
    expect(counters.length).toBe(1);
    expect(counters[0].numericValue).toBe(3);
  });

  it('non-numeric text swap on an aria-labeled element → status-badge (identity coordinate present)', () => {
    const { observer } = setup('<span id="s1" aria-label="Trip state">Planned</span>');
    const snap = observer.scan(null, [
      textSwapSummary('body > span#s1', 'SPAN'),
    ]);
    const badges = snap!.items.filter((i) => i.kind === 'status-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].text).toBe('Planned');
  });

  it('role=status text swap → notification (role outranks badge at pickSeedKind)', () => {
    const { observer } = setup('<div id="live" role="status">Saved</div>');
    const snap = observer.scan(null, [
      textSwapSummary('body > div#live', 'DIV'),
    ]);
    const notifications = snap!.items.filter((i) => i.kind === 'notification');
    expect(notifications.length).toBe(1);
    expect(notifications[0].text).toBe('Saved');
  });
});

// ── AC-W2b: honesty — no coordinate, no item ───────────────────────────

describe('6D.1 W2 — rung 7 honesty gate holds for text swaps', () => {
  it('non-numeric text swap with NO identity coordinate → NO item (honest skip)', () => {
    // Plain <p> with text "Search complete": no #id, no role, no aria-label,
    // no allowlisted attr. The swap is observable but not ADDRESSABLE.
    const { observer } = setup('<p>Search complete</p>');
    const snap = observer.scan(null, [
      textSwapSummary('body > p', 'P'),
    ]);
    const seeded = (snap?.items ?? []).filter((i) => i.matchedSelector === SEED);
    expect(seeded.length).toBe(0);
  });

  it('transient text swap (loading…) → NO item (classifier noise gate)', () => {
    // Even when addressable, skeleton/loading vocabulary stays dropped.
    const { observer } = setup('<span id="st">Loading…</span>');
    const snap = observer.scan(null, [
      textSwapSummary('body > span#st', 'SPAN'),
    ]);
    const seeded = (snap?.items ?? []).filter((i) => i.matchedSelector === SEED);
    expect(seeded.length).toBe(0);
  });

  it('date-shaped swap ("22 Aug") → NO counter item (shape-exclusion parity, reviewer WARN fix)', () => {
    // isNumericDelta's NON_COUNTER_NUMERAL_RE rejects date/duration shapes at
    // classification time; the text-swap path applies the identical guard at
    // resolution. "22 Aug" parses a leading digit but must NOT become a counter.
    const { observer } = setup('<span id="when">22 Aug</span>');
    const snap = observer.scan(null, [
      textSwapSummary('body > span#when', 'SPAN'),
    ]);
    const seeded = (snap?.items ?? []).filter((i) => i.matchedSelector === SEED);
    expect(seeded.length).toBe(0);
  });

  it('duration-shaped swap ("02h 30m") → NO counter item (shape exclusion)', () => {
    const { observer } = setup('<span id="dur">02h 30m</span>');
    const snap = observer.scan(null, [
      textSwapSummary('body > span#dur', 'SPAN'),
    ]);
    const seeded = (snap?.items ?? []).filter((i) => i.matchedSelector === SEED);
    expect(seeded.length).toBe(0);
  });

  it('empty-text element at scan time → NO item (nothing to assert)', () => {
    const { observer } = setup('<span id="blank"></span>');
    const snap = observer.scan(null, [
      textSwapSummary('body > span#blank', 'SPAN'),
    ]);
    const seeded = (snap?.items ?? []).filter((i) => i.matchedSelector === SEED);
    expect(seeded.length).toBe(0);
  });
});

// ── AC-W2c: churn stays dropped ────────────────────────────────────────

describe('6D.1 W2 — net-zero churn gate preserved (element churn)', () => {
  it('2/2 element swap (row replaced by row) stays DROPPED at classification', () => {
    const seeds = classifyChangedSummaries([
      summary({
        types: ['childList'],
        targetTag: 'UL',
        targetPath: 'body > ul#r',
        characterDataDelta: null,
        addedNodesCount: 2,
        removedNodesCount: 2,
      }),
    ]);
    expect(seeds.length).toBe(0);
  });

  it('1/1 swap where the parent STILL HAS element children at scan time → NO seeded item', () => {
    // The structural proof the swap was text-only fails: a parent that
    // carries element children was not a pure text-swap target.
    const { observer } = setup(
      '<div id="mixed"><span>item</span>2 tickets</div>',
    );
    const snap = observer.scan(null, [
      textSwapSummary('body > div#mixed', 'DIV'),
    ]);
    const seeded = (snap?.items ?? []).filter((i) => i.matchedSelector === SEED);
    expect(seeded.length).toBe(0);
  });

  it('mount/unmount churn (4/4) stays dropped — pre-6D.1 pin re-asserted', () => {
    const seeds = classifyChangedSummaries([
      summary({
        types: ['childList'],
        targetTag: 'DIV',
        characterDataDelta: null,
        addedNodesCount: 4,
        removedNodesCount: 4,
      }),
    ]);
    expect(seeds.length).toBe(0);
  });
});

// ── AC-W2d: STAB — pre-6D.1 shapes unchanged ───────────────────────────

describe('6D.1 W2 — STAB: pre-6D.1 classifier outputs unchanged', () => {
  it('net additions still classify as collection (+ resolveViaChildren off-lists)', () => {
    const seeds = classifyChangedSummaries([
      summary({
        types: ['childList'],
        targetPath: 'body > div#cart',
        targetTag: 'DIV',
        characterDataDelta: null,
        addedNodesCount: 3,
        removedNodesCount: 0,
      }),
    ]);
    expect(seeds.length).toBe(1);
    expect(seeds[0].candidateKinds).toContain('collection');
    expect(seeds[0].resolveViaChildren).toBe(true);
  });

  it('pure characterData counter classification unchanged', () => {
    const seeds = classifyChangedSummaries([
      summary({ characterDataDelta: { old: '0', new: '5' } }),
    ]);
    expect(seeds.length).toBe(1);
    expect(seeds[0].candidateKinds).toEqual(['counter']);
  });

  it('role→alert attribute change still classifies as notification', () => {
    const seeds = classifyChangedSummaries([
      summary({
        types: ['attributes'],
        changedAttributes: ['role'],
        attributeDeltas: { role: { old: null, new: 'alert' } },
        characterDataDelta: null,
      }),
    ]);
    expect(seeds.length).toBe(1);
    expect(seeds[0].candidateKinds).toContain('notification');
  });
});

// ── AC-W2e: end-to-end derivation ──────────────────────────────────────

describe('6D.1 W2 — seeded counter flows to IR assertions', () => {
  it('deriveStepAssertions derives the #id locator + text assertion for the seeded counter', () => {
    const { observer } = setup('<p class="muted" id="result-count">2 tickets</p>');
    const snap = observer.scan(null, [
      textSwapSummary('body > p#result-count', 'P'),
    ]);
    const counter = snap!.items.find(
      (i) => i.kind === 'counter' && i.domPath === 'body > p#result-count',
    );
    expect(counter).toBeDefined();

    const map = deriveStepAssertions([
      {
        triggerEvent: { eventId: 'evt-6d1-w2' },
        behavioralEvidence: {
          applicationEvidence: {
            resultingState: { ...snap!, items: [counter as unknown as WireObservedItem] },
          },
        },
      } as unknown as ComponentInteraction,
    ]);
    const derived = map.get('evt-6d1-w2') ?? [];
    expect(derived.length).toBeGreaterThanOrEqual(1);
    // Own-#id tier: the derived locator points at the counter itself.
    expect(derived.some((a) => a.targetCss === '#result-count')).toBe(true);
  });
});
