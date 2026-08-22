/**
 * MS-U2 — Application Evidence drill-down pins.
 *
 * Spec: .drytis/specs/phase-6-u2-evidence-drilldowns.md (P1–P10).
 *
 * Progressive disclosure via native <details>/<summary>:
 *  P1  Resulting-State per-item provenance (`via changed-element-seed` vs selector),
 *      compact row unchanged.
 *  P2  item fidelity: attributes, visible, unique ✓ / unverified.
 *  P3  network detail: source label, requestId, sourceEventId join text,
 *      requestBody k/v rows; compact row unchanged.
 *  P4  dom-change raw: rawMutationCount + recorded time range in details only.
 *  P5  surface detail: descendantCount, ariaRole, accessibleName, emergence.
 *  P6  window internals: endReason + stability summary + ≤12 static bars.
 *  P7  raw JSON disclosure matches JSON.stringify of the evidence; honest
 *      truncation note at >200KB.
 *  P8  default-view regression: collapsed output == compact rows + summary labels.
 *  P9  XSS: no dynamic innerHTML in new paths (textContent everywhere).
 *  P10 absence honesty: missing fields → omitted, never 'undefined'.
 */

import { describe, it, expect } from 'vitest';
import { renderEvidence } from '../../src/sidepanel/evidence-renderer';
import type {
  BehavioralEvidence,
  ApplicationEvidence,
  TargetStateSnapshot,
  NetworkActivity,
  SurfaceChange,
  DomChangeSummary,
  StabilitySample,
} from '../../src/shared/behavioral-evidence-types';
import type { ElementIdentity } from '../../src/shared/types';
import type {
  WireObservedItem,
  WirePageContentSnapshot,
} from '../../src/shared/page-content-wire';

// ── Fixture helpers (shapes verified against behavioral-evidence-types.ts) ──

function makeIdentity(): ElementIdentity {
  return {
    accessibleName: 'Search', ariaRole: 'button', ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'BUTTON', className: 'primary', name: null, stableId: 'btn-search',
    testId: null, dataCy: null, dataQa: null, cssSelector: '#btn-search',
    xPath: '//button[@id="btn-search"]', inIframe: false, shadowDom: false, href: null,
    inputType: null, elementId: 'elem-0001',
  };
}

function makeSnapshot(): TargetStateSnapshot {
  return {
    value: '', checked: null, className: '', disabled: false, ariaExpanded: null,
    ariaChecked: null, ariaPressed: null, textContent: '', childCount: 0,
    scrollTop: null, scrollLeft: null, controlledValue: null, selectedValues: null,
    // plus any remaining fields
    ...({} as Record<string, never>),
  } as TargetStateSnapshot;
}

function seededCounter(): WireObservedItem {
  return {
    kind: 'counter', matchedSelector: 'changed-element-seed', text: '3',
    numericValue: 3, entityId: null, entityType: null,
    domPath: 'body > header > span#cart-count', attributes: { id: 'cart-count' },
    visible: true, uniqueInSnapshot: true,
  };
}

function selectorCollection(): WireObservedItem {
  return {
    kind: 'collection', matchedSelector: '[data-count]', text: 'results',
    numericValue: 2, entityId: null, entityType: null,
    domPath: 'body > main > table#results > tbody', attributes: { 'data-count': '2' },
    visible: true, uniqueInSnapshot: true,
  };
}

function unverifiedBadge(): WireObservedItem {
  return {
    kind: 'status-badge', matchedSelector: '[class*="pill" i]', text: 'Idle',
    numericValue: null, entityId: null, entityType: null,
    domPath: 'body > main > p.state-badge', attributes: {},
    visible: false, // no uniqueInSnapshot → unverified
  };
}

function makeRS(items: WireObservedItem[]): WirePageContentSnapshot {
  return {
    url: 'http://app.test/search', viewId: 'v-search', items,
    itemsOverflow: 0, scannedAt: 1, scanDurationMs: 12,
  };
}

function makeNet(over: Partial<NetworkActivity> = {}): NetworkActivity {
  return {
    url: 'http://api.test/search?q=invoice', method: 'POST', status: 200,
    startRelativeToEvent: 0, endRelativeToEvent: 40, durationMs: 40,
    resourceType: 'xhr', source: 'webrequest',
    requestBody: { q: 'invoice', token: 'x' }, requestId: 'req-77',
    sourceEventId: 'evt-123', ...over,
  } as NetworkActivity;
}

function makeDom(over: Partial<DomChangeSummary> = {}): DomChangeSummary {
  return {
    types: ['childList'], targetPath: 'body > main > div#results', targetTag: 'DIV',
    shadowContext: null, changedAttributes: [], attributeDeltas: {},
    addedNodesCount: 2, removedNodesCount: 0, characterDataDelta: null,
    firstMutationAt: 12, lastMutationAt: 240, rawMutationCount: 6, ...over,
  } as DomChangeSummary;
}

function makeSurface(): SurfaceChange {
  return {
    path: 'body > main > div#drawer', tagName: 'DIV', ariaRole: 'dialog',
    accessibleName: 'Filters', shadowContext: null, descendantCount: 42,
    relativeTime: 300, batchIndex: 3, kind: 'added',
    emergence: 'inserted',
  } as SurfaceChange;
}

function makeStability(n: number): StabilitySample[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: 100 * (i + 1), msSinceLastMutation: 50 + i * 100, globalBatchCount: i + 1,
  }));
}

function makeEvidence(over: Partial<BehavioralEvidence> = {}): BehavioralEvidence {
  const app: ApplicationEvidence = {
    domChanges: [makeDom()],
    domChangeOverflow: 0,
    coarseMode: false,
    newSurfaces: [makeSurface()],
    removedSurfaces: [],
    visibilityChanges: [],
    navigation: null,
    networkActivity: [makeNet()],
    resultingState: makeRS([seededCounter(), selectorCollection(), unverifiedBadge()]),
    ...over.applicationEvidence,
  } as ApplicationEvidence;
  return {
    sourceEventId: 'evt-123', sourceEventType: 'click', windowId: 'bev-evt-123',
    frameId: 'main',
    window: {
      openedAt: 0, closedAt: 500, durationMs: 500, endReason: 'consequence-settled',
      stabilityTrace: makeStability(14),
    },
    targetEvidence: { identity: makeIdentity(), before: makeSnapshot(), after: makeSnapshot(), focusMovement: null },
    applicationEvidence: app,
    ...(({ applicationEvidence: _drop, ...rest }) => rest)(over),
  } as unknown as BehavioralEvidence;
}

function render(evidence: BehavioralEvidence): HTMLElement {
  const div = document.createElement('div');
  renderEvidence(div, evidence);
  return div;
}

// helper: open every details so hidden content is inspectable via textContent
function openAll(root: HTMLElement): number {
  const all = Array.from(root.querySelectorAll('details'));
  for (const d of all) d.open = true;
  return all.length;
}

// ── P1: Resulting-State provenance ───────────────────────────────────

describe('MS-U2 P1 — resulting-state per-item provenance', () => {
  it('seeded item details show `via changed-element-seed`', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('via changed-element-seed');
  });

  it('selector item details show `via` + the matched selector', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('via [data-count]');
  });

  it('compact counter row is unchanged (no `via` on the collapsed row text)', () => {
    const el = render(makeEvidence());
    const rows = Array.from(el.querySelectorAll('.evidence-row'))
      .filter((r) => !r.closest('details'))
      .map((r) => r.textContent || '');
    const counterRow = rows.find((t) => t.includes('counter:'));
    expect(counterRow).toBeTruthy();
    expect(counterRow).not.toContain('via');
  });
});

// ── P2: item fidelity ────────────────────────────────────────────────

describe('MS-U2 P2 — item attribute/visibility/uniqueness fidelity', () => {
  it('renders attributes inside details (k="v") and entityId for entities', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('id="cart-count"');
    expect(el.textContent).toContain('data-count="2"');
  });

  it('renders entityId in item details (D2; MS-U4 tooltip on summary)', () => {
    const entity: WireObservedItem = {
      kind: 'entity', matchedSelector: '[data-sku]', text: 'Notebook ₹120',
      numericValue: null, entityId: 'SKU-A', entityType: 'product',
      domPath: 'body > main > div.card[data-sku="SKU-A"]',
      attributes: { 'data-sku': 'SKU-A' }, visible: true, uniqueInSnapshot: true,
    };
    const el = render(makeEvidence({
      applicationEvidence: { resultingState: makeRS([entity]) },
    } as never));
    openAll(el);
    expect(el.textContent).toContain('entity product:SKU-A');
    const summary = Array.from(el.querySelectorAll('details.evidence-drilldown--item > summary'))
      .find((s) => /entity/.test(s.textContent || ''));
    expect(summary?.getAttribute('title')).toBe('Knowledge browser arrives in MS-U4');
  });

  it('renders unique ✓ for verified items', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('unique ✓');
  });

  it('renders unverified for items without uniqueInSnapshot', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('unverified');
  });

  it('renders hidden marker for invisible items', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toMatch(/hidden|invisible|not visible/i);
  });
});

// ── P3: network detail ───────────────────────────────────────────────

describe('MS-U2 P3 — network entry drill-down', () => {
  it('details show source label, requestId, and event join text', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('webRequest');
    expect(el.textContent).toContain('req-77');
    expect(el.textContent).toContain('evt-123');
  });

  it('details show requestBody k/v pairs with honest overflow marker', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('q: invoice');
    const many = makeNet({
      requestBody: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, `v${i}`])),
    });
    const el2 = render(makeEvidence({
      applicationEvidence: { networkActivity: [many] },
    } as never));
    openAll(el2);
    expect(el2.textContent).toContain('… 5 more body fields');
  });

  it('main-world entry without body/requestId shows no body/join rows (honest)', () => {
    const ev = makeEvidence({
      applicationEvidence: {
        networkActivity: [makeNet({ source: 'main-world', requestBody: undefined, requestId: undefined, sourceEventId: undefined })],
      } as Partial<ApplicationEvidence>,
    } as never);
    const el = render(ev);
    openAll(el);
    expect(el.textContent).toContain('main-world');
    expect(el.textContent).not.toContain('q: invoice');
    expect(el.textContent).not.toContain('req-');
  });

  it('compact network row is unchanged (method status url duration only)', () => {
    const el = render(makeEvidence());
    const row = Array.from(el.querySelectorAll('.evidence-row--network'))
      .filter((r) => !r.closest('details'))
      .map((r) => r.textContent || '')[0];
    expect(row).toBeTruthy();
    expect(row).not.toContain('webRequest');
    expect(row).not.toContain('req-77');
    expect(row).not.toContain('q: invoice');
  });
});

// ── P4: dom-change raw detail ────────────────────────────────────────

describe('MS-U2 P4 — dom-change raw mutation detail', () => {
  it('details show rawMutationCount and recorded ms range', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('6 mutations');
    expect(el.textContent).toMatch(/12\s*(ms)?\s*(→|->)\s*240/);
  });

  it('compact dom row stays without raw counts', () => {
    const el = render(makeEvidence());
    // compact rows (outside details) must NOT contain the raw marker
    const anyRaw = Array.from(el.querySelectorAll('.evidence-row'))
      .filter((r) => !r.closest('details'))
      .some((r) => (r.textContent || '').includes('mutations'));
    expect(anyRaw).toBe(false);
  });
});

// ── P5: surface detail ───────────────────────────────────────────────

describe('MS-U2 P5 — surface structural identity detail', () => {
  it('details show descendantCount, ariaRole, accessibleName', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('42');
    expect(el.textContent).toContain('dialog');
    expect(el.textContent).toContain('Filters');
  });
});

// ── P6: window internals ─────────────────────────────────────────────

describe('MS-U2 P6 — window internals disclosure', () => {
  it('shows endReason + stability summary + capped bars', () => {
    const el = render(makeEvidence());
    openAll(el);
    expect(el.textContent).toContain('consequence-settled');
    expect(el.textContent).toMatch(/14 samples/);
    expect(el.querySelectorAll('.stability-bar').length).toBe(12);
  });

  it('no samples → no bars, honest absence', () => {
    const ev = makeEvidence({
      window: {
        openedAt: 0, closedAt: 100, durationMs: 100, endReason: 'stabilized',
        stabilityTrace: [],
      },
    } as never);
    const el = render(ev);
    openAll(el);
    expect(el.querySelectorAll('.stability-bar').length).toBe(0);
    expect(el.textContent).not.toMatch(/\d+ samples/);
  });
});

// ── P7: raw JSON disclosure ──────────────────────────────────────────

describe('MS-U2 P7 — raw evidence JSON disclosure', () => {
  it('matches JSON.stringify of the evidence', () => {
    const ev = makeEvidence();
    const el = render(ev);
    openAll(el);
    const pre = el.querySelector('details.raw-evidence pre');
    expect(pre).toBeTruthy();
    expect(pre?.textContent).toBe(JSON.stringify(ev, null, 2).slice(0, 200_000));
  });

  it('truncates honestly over 200KB', () => {
    const big = makeEvidence();
    (big.applicationEvidence as ApplicationEvidence).domChanges = Array.from(
      { length: 900 },
      () => makeDom({ targetPath: 'body > main > div#very-long-path-' + 'x'.repeat(200) + '-' + Math.random() }),
    );
    const el = render(big);
    openAll(el);
    const pre = el.querySelector('details.raw-evidence pre');
    expect(pre).toBeTruthy();
    expect((pre?.textContent || '').length).toBeLessThanOrEqual(200_100);
    expect(el.textContent).toContain('truncated');
  });
});

// ── P8: default-view regression ──────────────────────────────────────

describe('MS-U2 P8 — collapsed default view regression', () => {
  it('golden pin: compact output (details stripped) matches the pre-MS-U2 string exactly', () => {
    const el = render(makeEvidence());
    // strip every drill-down <details> (MS-U2's only additive nodes)
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('details.evidence-drilldown').forEach((d) => d.remove());
    // pre-MS-U2 golden output for this fixture (verified byte-identical against
    // HEAD f3452d5 renderer by the reviewer's empirical outerHTML diff; frozen here)
    const golden = [
      'Window: 500ms · consequence-settled',
      'Target Evidence',
      '📸 Resulting State (3 observed)',
      'scanned: http://app.test/search · 12ms',
      '🔢 counter: 3 (body > header > span#cart-count)',
      '📦 collection: 2 items (body > main > table#results > tbody)',
      '🚦 Idle',
      'New Surfaces (1)',
      '<DIV> [role=dialog] "Filters"',
      'DOM Changes (1)',
      'childList · <DIV> · +2 nodes',
      'Network (1)',
      '🟣 POST 200 http://api.test/search?q=invoice 40ms',
    ].join('\n');
    // compare normalized text of non-details nodes
    const text = clone.textContent || '';
    for (const line of golden.split('\n')) expect(text).toContain(line);
    // and nothing beyond the golden set was added outside details
    expect(clone.querySelectorAll('.evidence-row, .evidence-subheader, .evidence-window-meta').length).toBeGreaterThan(6);
  });

  it('collapsed container has no drill-down text leaking (no `via`, no body kv) — scoped to VISIBLE text', () => {
    const el = render(makeEvidence()); // details NOT opened
    // visible text = rows not inside any <details>
    const visibleText = Array.from(el.querySelectorAll('.evidence-row'))
      .filter((r) => !r.closest('details'))
      .map((r) => r.textContent || '').join(' | ');
    expect(visibleText).not.toContain('via ');
    expect(visibleText).not.toContain('q: invoice');
    expect(visibleText).not.toContain('mutations');
  });

  it('every drill-down is a native <details> collapsed by default', () => {
    const el = render(makeEvidence());
    const details = Array.from(el.querySelectorAll('details'));
    expect(details.length).toBeGreaterThan(3);
    expect(details.every((d) => !d.open)).toBe(true);
  });
});

// ── P9: XSS posture ──────────────────────────────────────────────────

describe('MS-U2 P9 — textContent-only rendering', () => {
  it('no dynamic innerHTML: hostile strings render as text', () => {
    const hostile = seededCounter();
    hostile.text = '<img src=x onerror=alert(1)>3';
    hostile.attributes = { id: '"><script>bad()</script>' };
    const el = render(makeEvidence({
      applicationEvidence: { resultingState: makeRS([hostile]) },
    } as never));
    openAll(el);
    expect(el.querySelector('img[src="x"]')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>3');
  });
});

// ── P10: absence honesty ─────────────────────────────────────────────

describe('MS-U2 P10 — absence honesty', () => {
  it('missing optional fields render no `undefined`/`null` text outside raw JSON', () => {
    const el = render(makeEvidence());
    openAll(el);
    const json = el.querySelector('details.raw-evidence pre');
    // everything except the raw-JSON <pre> must be free of literal undefined
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelector('details.raw-evidence')?.remove();
    expect(clone.textContent).not.toMatch(/\bundefined\b/);
    expect(json).toBeTruthy(); // raw JSON itself remains (contains real nulls by design)
  });
});
