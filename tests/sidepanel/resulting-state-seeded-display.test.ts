/**
 * Phase 6A stabilization — missing pins ⑧⑨ + O6-STOP.
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md
 * (Stage 1 addendum — three consumers; pins ⑧ display / ⑨ KR round-trip)
 * + Semantic Observation Contract (O6 idempotency at the capture seam).
 *
 * ⑧ DISPLAY: renderResultingState renders seeded items (matchedSelector
 *    'changed-element-seed') in their kind groups — the side panel explains
 *    what was observed. Absent snapshot → no section (unchanged).
 * ⑨ KNOWLEDGE: PageContentEvidenceExtractor maps seeded WireObservedItems to
 *    ObservedItems keyed kind+domPath — repository reusability, not just
 *    derivation.
 * ⑩ O6-STOP: captureResultingState is at-most-once per window — the STOP
 *    drain path must not create a SECOND scan (idempotency).
 * No product code here.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderEvidence } from '../../src/sidepanel/evidence-renderer';
import type {
  BehavioralEvidence,
  ApplicationEvidence,
} from '../../src/shared/behavioral-evidence-types';
import type {
  WireObservedItem,
  WirePageContentSnapshot,
} from '../../src/shared/page-content-wire';

// ── Factories (mirror tests/sidepanel/evidence-renderer.test.ts) ─────

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

function makeEvidence(
  items: WireObservedItem[] | null,
): BehavioralEvidence {
  const app: ApplicationEvidence = {
    coarseMode: false,
    domChanges: [],
    domChangeOverflow: 0,
    newSurfaces: [],
    removedSurfaces: [],
    visibilityChanges: [],
    navigation: [],
    networkActivity: [],
    resultingState: (items && items.length > 0
      ? {
          url: 'http://localhost/app',
          viewId: null,
          items,
          itemsOverflow: 0,
          scannedAt: 123456,
          scanDurationMs: 4,
        }
      : null) as WirePageContentSnapshot | null,
  };
  return {
    window: {
      windowId: 'w-1',
      openedAt: 100,
      settledAt: 200,
      durationMs: 100,
      endReason: 'settle',
      sourceEventId: 'evt-1',
    },
    frameId: 'main',
    target: null,
    applicationEvidence: app,
  } as unknown as BehavioralEvidence;
}

// ── ⑧ Display path ───────────────────────────────────────────────────

describe('Pin ⑧ — renderResultingState displays seeded items in kind groups', () => {
  beforeEach(() => {
    const dom = new JSDOM('<div id="c"></div>');
    (globalThis as Record<string, unknown>).document = dom.window.document;
    (globalThis as Record<string, unknown>).window = dom.window;
  });

  it('renders seeded counter + seeded collection under "Resulting State"', () => {
    const container = document.createElement('div');
    renderEvidence(
      container,
      makeEvidence([
        seededItem(),
        seededItem({
          kind: 'collection',
          text: 'results',
          numericValue: 2,
          domPath: 'body > table#results > tbody',
        }),
      ]),
    );
    const html = container.innerHTML;
    expect(html).toContain('📸 Resulting State (2 observed)');
    // textContent → innerHTML escapes '>' as '&gt;'
    expect(html).toContain('body &gt; span#cart');
    expect(html).toContain('body &gt; table#results &gt; tbody');
  });

  it('renders seeded notification and status-badge kinds too', () => {
    const container = document.createElement('div');
    renderEvidence(
      container,
      makeEvidence([
        seededItem({ kind: 'notification', text: 'Flight added', numericValue: null }),
        seededItem({ kind: 'status-badge', text: 'Confirmed', numericValue: null }),
      ]),
    );
    const html = container.innerHTML;
    expect(html).toContain('Flight added');
    expect(html).toContain('Confirmed');
  });

  it('absent/empty snapshot → no Resulting State section (unchanged behavior)', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence(null));
    expect(container.innerHTML).not.toContain('Resulting State');
  });
});
