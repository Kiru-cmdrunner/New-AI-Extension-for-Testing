/**
 * Phase 6A stabilization — Pin ⑨ (KR round-trip for seeded items).
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md
 * (Stage 1 addendum — three consumers: Explain / Learn / Derive).
 *
 * ⑨ KNOWLEDGE: seeded WireObservedItems (matchedSelector
 * 'changed-element-seed') round-trip through PageContentEvidenceExtractor
 * into PageContentSignal observed* arrays keyed kind+domPath — the
 * Application Knowledge Repository learns from changed elements, not just
 * selector matches. Provenance survives via matchedSelector.
 *
 * The 6A doctrine (owner directive 2026-08-22): observation is a reusable
 * understanding signal FIRST, an assertion input second. This pin proves
 * the Learn consumer without any extractor code change — the seed items
 * are ordinary wire items by construction.
 *
 * Also pins the O6/STOP guard from the other direction: seeded items are
 * extracted ONCE from the window's own snapshot — the extractor has no
 * second scan path (read-only input, pure function).
 */
import { describe, it, expect } from 'vitest';
import { PageContentEvidenceExtractor } from '../../src/understanding/signal-extractors/page-content-evidence-extractor';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { WireObservedItem, WirePageContentSnapshot } from '../../src/shared/page-content-wire';

// ── Fixtures (mirror page-content-evidence-extractor.test.ts shapes) ────

function seededItem(overrides: Partial<WireObservedItem> = {}): WireObservedItem {
  return {
    kind: 'counter',
    matchedSelector: 'changed-element-seed',
    text: '5 items',
    numericValue: 5,
    entityId: null,
    entityType: null,
    domPath: 'body > span#cart',
    attributes: {},
    visible: true,
    uniqueInSnapshot: true,
    ...overrides,
  };
}

function snapshot(items: WireObservedItem[]): WirePageContentSnapshot {
  return {
    url: 'https://shop.example/results',
    viewId: null,
    items,
    itemsOverflow: 0,
    scannedAt: 1234.5,
    scanDurationMs: 6,
  };
}

function makeInteraction(
  snapshotItems: WireObservedItem[] | undefined,
): ComponentInteraction {
  const app: Record<string, unknown> = {
    newSurfaces: [],
    removedSurfaces: [],
    domChanges: [],
  };
  if (snapshotItems !== undefined) {
    app.resultingState = snapshot(snapshotItems);
  }
  return {
    interactionId: 'int-6a9',
    type: 'Click',
    trigger: { tag: 'BUTTON', accessibleName: 'Apply' },
    triggerEvent: {},
    memberEvents: [],
    startTime: 0,
    endTime: 100,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: { applicationEvidence: app },
  } as unknown as ComponentInteraction;
}

type ExtractedSignal = {
  snapshot: { url: string; scannedAt: number };
  observedEntities: WireObservedItem[];
  observedCounters: WireObservedItem[];
  observedCollections: WireObservedItem[];
  observedNotifications: WireObservedItem[];
  observedStatusBadges: WireObservedItem[];
};

function extractOne(interaction: ComponentInteraction): ExtractedSignal {
  const extractor = new PageContentEvidenceExtractor();
  const signals = extractor.extract(interaction);
  expect(signals).toHaveLength(1);
  return signals[0] as unknown as ExtractedSignal;
}

// ── ⑨ Round-trip ────────────────────────────────────────────────────────

describe('Pin ⑨ — seeded items round-trip into PageContentSignal (KR ingestion)', () => {
  it('seeded counter/collection land in observed* arrays with provenance intact', () => {
    const sig = extractOne(
      makeInteraction([
        seededItem(),
        seededItem({
          kind: 'collection',
          text: 'results',
          numericValue: 2,
          domPath: 'body > table#results > tbody',
        }),
      ]),
    );
    expect(sig.observedCounters).toHaveLength(1);
    expect(sig.observedCounters[0].domPath).toBe('body > span#cart');
    expect(sig.observedCounters[0].numericValue).toBe(5);
    expect(sig.observedCounters[0].matchedSelector).toBe('changed-element-seed');
    expect(sig.observedCollections).toHaveLength(1);
    expect(sig.observedCollections[0].domPath).toBe('body > table#results > tbody');
    expect(sig.observedCollections[0].numericValue).toBe(2);
    expect(sig.observedCollections[0].matchedSelector).toBe('changed-element-seed');
  });

  it('seeded notification + status-badge land in their arrays (aria-labeled case)', () => {
    const sig = extractOne(
      makeInteraction([
        seededItem({ kind: 'notification', text: 'Flight added', numericValue: null }),
        seededItem({ kind: 'status-badge', text: 'Confirmed', numericValue: null }),
      ]),
    );
    expect(sig.observedNotifications).toHaveLength(1);
    expect(sig.observedNotifications[0].text).toBe('Flight added');
    expect(sig.observedStatusBadges).toHaveLength(1);
    expect(sig.observedStatusBadges[0].text).toBe('Confirmed');
  });

  it('first wire item wins kind+domPath collision — items array order is the merge order', () => {
    // The extractor dedups snapshot items in ARRAY ORDER (first wins);
    // the observer guarantees selector-pass items precede seed-pass items
    // (seed pass strictly after the selector loop — pinned in
    // seeded-scan.test.ts byte-identity). This pin pins the CONTRACT from
    // the consumer side: whichever item the snapshot carries first is the
    // one the KR learns.
    const selectorItem = seededItem({
      matchedSelector: '[data-count]',
      domPath: 'body > span#cart',
      text: '5',
      numericValue: 5,
      attributes: { 'data-count': '5' },
    });
    const seed = seededItem({ domPath: 'body > span#cart', text: '5 items', numericValue: 5 });
    const sig = extractOne(makeInteraction([selectorItem, seed]));
    expect(sig.observedCounters).toHaveLength(1);
    expect(sig.observedCounters[0].matchedSelector).toBe('[data-count]');
  });

  it('real snapshot metadata is used when seeded items contributed (url carried)', () => {
    const sig = extractOne(makeInteraction([seededItem()]));
    expect(sig.snapshot.url).toBe('https://shop.example/results');
    expect(sig.snapshot.scannedAt).toBe(1234.5);
  });
});
