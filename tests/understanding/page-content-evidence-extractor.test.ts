/**
 * Phase 2 — PageContentEvidenceExtractor (D2) consuming resultingState.
 *
 * Pins the resulting-application-state consumption design:
 *   - resultingState.items are extracted (entities/counters/collections/
 *     notifications/status-badges) alongside newSurfaces items
 *   - merge dedup key = kind + ':' + domPath; SNAPSHOT item wins collisions
 *   - real snapshot metadata (url/viewId/scannedAt/itemsOverflow/
 *     scanDurationMs) replaces D2's synthetic values when resultingState
 *     contributed the winning items; synthetic {url:''} retained otherwise
 *   - resultingState ABSENT → output identical to the pre-Phase-2
 *     newSurfaces-only behavior (additive activation)
 *   - merged items.length may exceed the observer's MAX_ITEMS in the union
 *     — harmless, consumers read the observed* arrays (§9.4)
 *
 * Spec: .drytis/specs/resulting-application-state.md (Phase 2),
 * plan: .drytis/specs/resulting-application-state-plan.md (Phase 2).
 */
import { describe, it, expect } from 'vitest';
import { PageContentEvidenceExtractor } from '../../src/understanding/signal-extractors/page-content-evidence-extractor';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { WireObservedItem, WirePageContentSnapshot } from '../../src/shared/page-content-wire';

// ── Fixtures ────────────────────────────────────────────────────────────

interface NewSurfaceFixture {
  path: string;
  ariaRole: string;
  tagName: string;
  accessibleName: string;
}

function wireSnapshot(
  overrides: Partial<WirePageContentSnapshot> = {},
): WirePageContentSnapshot {
  return {
    url: 'https://shop.example/cart',
    viewId: 'cart',
    items: [],
    itemsOverflow: 0,
    scannedAt: 1234.5,
    scanDurationMs: 6,
    ...overrides,
  };
}

function entityItem(id: string, path: string): WireObservedItem {
  return {
    kind: 'entity',
    matchedSelector: '[data-asin]',
    text: `Widget ${id}`,
    numericValue: null,
    entityId: id,
    entityType: 'product',
    domPath: path,
    attributes: { 'data-asin': id },
    visible: true,
  };
}

function counterItem(path: string, value: number): WireObservedItem {
  return {
    kind: 'counter',
    matchedSelector: '[data-count]',
    text: String(value),
    numericValue: value,
    entityId: null,
    entityType: null,
    domPath: path,
    attributes: { 'data-count': String(value) },
    visible: true,
  };
}

/** Interaction fixture carrying an optional resultingState snapshot. */
function makeInteraction(
  snapshot: WirePageContentSnapshot | undefined,
  newSurfaces: NewSurfaceFixture[] = [],
): ComponentInteraction {
  const app: Record<string, unknown> = {
    newSurfaces,
    removedSurfaces: [],
    domChanges: [],
  };
  if (snapshot !== undefined) {
    app.resultingState = snapshot;
  }
  return {
    interactionId: 'int-p2',
    type: 'Click',
    trigger: { tag: 'BUTTON', accessibleName: 'Add to cart' },
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
  snapshot: { url: string; viewId: string | null; scannedAt: number; itemsOverflow: number; scanDurationMs: number };
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

// ── Tests ───────────────────────────────────────────────────────────────

describe('D2 resultingState consumption (Phase 2)', () => {
  it('extracts all item kinds from resultingState.items', () => {
    const pc = extractOne(
      makeInteraction(
        wireSnapshot({
          items: [
            entityItem('B0VAL1', 'ul > li'),
            counterItem('span#cart-count', 3),
            {
              kind: 'collection',
              matchedSelector: '[data-testid="cart-items"]',
              text: '3 items',
              numericValue: 3,
              entityId: null,
              entityType: null,
              domPath: 'ul#cart',
              attributes: {},
              visible: true,
            },
            {
              kind: 'notification',
              matchedSelector: '[role="alert"]',
              text: 'Added to cart',
              numericValue: null,
              entityId: null,
              entityType: null,
              domPath: 'div[role="alert"]',
              attributes: {},
              visible: true,
            },
            {
              kind: 'status-badge',
              matchedSelector: '[data-testid="status"]',
              text: 'Pending',
              numericValue: null,
              entityId: null,
              entityType: null,
              domPath: 'div.status',
              attributes: {},
              visible: true,
            },
          ],
        }),
      ),
    );

    expect(pc.observedEntities).toHaveLength(1);
    expect(pc.observedEntities[0]).toMatchObject({ entityId: 'B0VAL1', entityType: 'product' });
    expect(pc.observedCounters).toHaveLength(1);
    expect(pc.observedCounters[0]).toMatchObject({ numericValue: 3, domPath: 'span#cart-count' });
    expect(pc.observedCollections).toHaveLength(1);
    expect(pc.observedCollections[0]).toMatchObject({ numericValue: 3 });
    expect(pc.observedNotifications).toHaveLength(1);
    expect(pc.observedStatusBadges).toHaveLength(1);
  });

  it('collisions on kind+domPath resolve to the snapshot item (snapshot wins)', () => {
    // newSurfaces yields a status-badge at div.status; the snapshot also has
    // a status-badge at the same path — snapshot wins, exactly one item.
    const pc = extractOne(
      makeInteraction(
        wireSnapshot({
          items: [
            {
              kind: 'status-badge',
              matchedSelector: '[role="status"]',
              text: 'Saved successfully',
              numericValue: null,
              entityId: null,
              entityType: null,
              domPath: 'div.status',
              attributes: { 'aria-label': 'Saved successfully' },
              visible: true,
            },
          ],
        }),
        [{ path: 'div.status', ariaRole: 'status', tagName: 'div', accessibleName: 'Saved successfully' }],
      ),
    );

    expect(pc.observedStatusBadges).toHaveLength(1);
    expect(pc.observedStatusBadges[0].matchedSelector).toBe('[role="status"]');
    expect(pc.observedStatusBadges[0].text).toBe('Saved successfully');
  });

  it('different kinds at the same path are BOTH kept (key includes kind)', () => {
    // A region can be both a notification (aria-role) and a counter
    // (surface tag) — distinct observations, not a collision.
    const pc = extractOne(
      makeInteraction(
        wireSnapshot({
          items: [counterItem('div.badge', 2)],
        }),
        [{ path: 'div.badge', ariaRole: 'status', tagName: 'div', accessibleName: '2 unread' }],
      ),
    );

    expect(pc.observedCounters).toHaveLength(1);
    expect(pc.observedStatusBadges).toHaveLength(1);
  });

  it('propagates real snapshot metadata when snapshot items win', () => {
    const pc = extractOne(
      makeInteraction(
        wireSnapshot({ items: [entityItem('B0VAL1', 'ul > li')], itemsOverflow: 4, scanDurationMs: 11, viewId: 'cart-view' }),
      ),
    );

    expect(pc.snapshot.url).toBe('https://shop.example/cart');
    expect(pc.snapshot.viewId).toBe('cart-view');
    expect(pc.snapshot.scannedAt).toBe(1234.5);
    expect(pc.snapshot.itemsOverflow).toBe(4);
    expect(pc.snapshot.scanDurationMs).toBe(11);
  });

  it('resultingState ABSENT → newSurfaces-only behavior preserved', () => {
    // No resultingState on the evidence: D2 must produce exactly the
    // pre-Phase-2 output (a status-badge from the aria role, synthetic url).
    const pc = extractOne(
      makeInteraction(undefined, [
        { path: 'div.toast', ariaRole: 'status', tagName: 'div', accessibleName: 'Saved' },
      ]),
    );

    expect(pc.snapshot.url).toBe(''); // synthetic retained
    expect(pc.observedStatusBadges).toHaveLength(1);
  });

  it('returns [] when both sources are empty', () => {
    const extractor = new PageContentEvidenceExtractor();
    expect(extractor.extract(makeInteraction(wireSnapshot({ items: [] })))).toHaveLength(0);
  });

  it('empty resultingState items + newSurfaces items → newSurfaces items kept with synthetic metadata', () => {
    // The real snapshot exists but contributed no items — metadata follows
    // the winning source, so the synthetic values are retained.
    const pc = extractOne(
      makeInteraction(
        wireSnapshot({ items: [] }),
        [{ path: 'div.toast', ariaRole: 'status', tagName: 'div', accessibleName: 'Saved' }],
      ),
    );

    expect(pc.snapshot.url).toBe('');
    expect(pc.observedStatusBadges).toHaveLength(1);
  });
});
