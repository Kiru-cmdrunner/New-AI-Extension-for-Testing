/**
 * Evidence Renderer — Unit Tests (M7)
 *
 * Tests rendering of BehavioralEvidence in the side panel:
 * TargetEvidence display, ApplicationEvidence display, state diffs,
 * network activity, surfaces, visibility, navigation, caps, collapsibility,
 * placeholder, late-arriving evidence updates.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §12.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderEvidence,
  renderEvidencePlaceholder,
  updateEvidenceOnInteraction,
  EVIDENCE_CONTAINER_ATTR,
} from '../../src/sidepanel/evidence-renderer';
import type {
  BehavioralEvidence,
  TargetEvidence,
  ApplicationEvidence,
  TargetStateSnapshot,
} from '../../src/shared/behavioral-evidence-types';
import type { ElementIdentity } from '../../src/shared/types';
import type {
  WireObservedItem,
  WirePageContentSnapshot,
} from '../../src/shared/page-content-wire';

// ── Helpers ──────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Email Address',
    ariaRole: 'textbox',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    className: 'form-input required',
    name: 'email',
    stableId: 'email',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '#email',
    xPath: '//input[@id="email"]',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: 'text',
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<TargetStateSnapshot> = {}): TargetStateSnapshot {
  return {
    value: '',
    checked: null,
    className: '',
    disabled: false,
    ariaExpanded: null,
    ariaChecked: null,
    ariaPressed: null,
    textContent: '',
    childCount: 0,
    scrollTop: null,
    scrollLeft: null,
    selectedValues: null,
    controlledValue: null,
    capturedAt: 100,
    ...overrides,
  };
}

function makeTargetEvidence(overrides: Partial<TargetEvidence> = {}): TargetEvidence {
  return {
    identity: makeIdentity(),
    identityCapturedAt: 100,
    before: makeSnapshot(),
    after: makeSnapshot({ value: 'test@example.com' }),
    focusMovement: null,
    ...overrides,
  };
}

function makeAppEvidence(overrides: Partial<ApplicationEvidence> = {}): ApplicationEvidence {
  return {
    domChanges: [],
    domChangeOverflow: 0,
    coarseMode: false,
    newSurfaces: [],
    removedSurfaces: [],
    visibilityChanges: [],
    navigation: [],
    networkActivity: [],
    performanceCondition: null,
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<BehavioralEvidence> = {}): BehavioralEvidence {
  return {
    sourceEventId: 'evt-1',
    sourceEventType: 'click',
    windowId: 'win-1',
    frameId: 'main',
    window: {
      openedAt: 100,
      closedAt: 400,
      durationMs: 300,
      endReason: 'stabilized',
      stabilityTrace: [],
    },
    targetEvidence: makeTargetEvidence(),
    applicationEvidence: makeAppEvidence(),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

// ── Tests ────────────────────────────────────────────────────────────

describe('renderEvidence', () => {
  it('renders two clearly separated sections (target + application)', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence());

    const targetSection = container.querySelector('[data-evidence-scope="target"]');
    const appSection = container.querySelector('[data-evidence-scope="application"]');

    expect(targetSection).toBeTruthy();
    expect(appSection).toBeTruthy();
  });

  it('renders window metadata line', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      window: {
        openedAt: 100,
        closedAt: 400,
        durationMs: 300,
        endReason: 'stabilized',
        stabilityTrace: [],
      },
    }));

    const meta = container.querySelector('.evidence-window-meta');
    expect(meta).toBeTruthy();
    expect(meta!.textContent).toContain('300ms');
    expect(meta!.textContent).toContain('stabilized');
  });

  it('marks the container with evidence attribute', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence());

    expect(container.hasAttribute(EVIDENCE_CONTAINER_ATTR)).toBe(true);
  });

  it('renders element identity with tag, id, role, name', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      targetEvidence: makeTargetEvidence({
        identity: makeIdentity({
          tag: 'BUTTON',
          stableId: 'submit-btn',
          ariaRole: 'button',
          accessibleName: 'Submit Form',
        }),
      }),
    }));

    const identity = container.querySelector('.evidence-identity__main');
    expect(identity).toBeTruthy();
    expect(identity!.textContent).toContain('BUTTON');
    expect(identity!.textContent).toContain('#submit-btn');
    expect(identity!.textContent).toContain('[role=button]');
    expect(identity!.textContent).toContain('"Submit Form"');
  });

  it('shows state changes as a diff', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      targetEvidence: makeTargetEvidence({
        before: makeSnapshot({ value: '', checked: false }),
        after: makeSnapshot({ value: 'hello', checked: true }),
      }),
    }));

    const diffs = container.querySelectorAll('.evidence-row--diff');
    expect(diffs.length).toBeGreaterThan(0);

    const allDiffText = Array.from(diffs).map(d => d.textContent).join(' ');
    expect(allDiffText).toContain('value');
    expect(allDiffText).toContain('hello');
    expect(allDiffText).toContain('checked');
    expect(allDiffText).toContain('true');
  });

  it('shows "no changes" when before equals after', () => {
    const container = document.createElement('div');
    const snapshot = makeSnapshot({ value: 'same' });
    renderEvidence(container, makeEvidence({
      targetEvidence: makeTargetEvidence({
        before: snapshot,
        after: { ...snapshot },
      }),
    }));

    const muted = container.querySelector('.evidence-row--muted');
    expect(muted).toBeTruthy();
    expect(muted!.textContent).toContain('No observable state changes');
  });

  it('shows focus movement when present', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      targetEvidence: makeTargetEvidence({
        focusMovement: {
          before: { tagName: 'INPUT', ariaRole: 'textbox', accessibleName: 'Email' },
          after: { tagName: 'BUTTON', ariaRole: 'button', accessibleName: 'Submit' },
          detectedAt: 200,
        },
      }),
    }));

    const focusRows = container.querySelectorAll('.evidence-row');
    const focusText = Array.from(focusRows).map(r => r.textContent).join(' ');
    expect(focusText).toContain('INPUT');
    expect(focusText).toContain('BUTTON');
    expect(focusText).toContain('→');
  });

  it('renders DOM changes with type and attribute deltas', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        domChanges: [{
          types: ['attributes'],
          targetPath: 'div.card',
          targetTag: 'DIV',
          shadowContext: null,
          changedAttributes: ['class'],
          attributeDeltas: { class: { old: 'hidden', new: 'visible' } },
          addedNodesCount: 0,
          removedNodesCount: 0,
          characterDataDelta: null,
          firstMutationAt: 150,
          lastMutationAt: 200,
          rawMutationCount: 3,
          firstBatchIndex: 1,
          lastBatchIndex: 2,
        }],
      }),
    }));

    const rows = container.querySelectorAll('.evidence-row');
    const rowText = Array.from(rows).map(r => r.textContent).join(' ');
    expect(rowText).toContain('attributes');
    expect(rowText).toContain('<DIV>');
    expect(rowText).toContain('class');
    expect(rowText).toContain('hidden');
    expect(rowText).toContain('visible');
  });

  it('caps DOM changes at 10 visible entries', () => {
    const container = document.createElement('div');
    const changes = Array.from({ length: 15 }, (_, i) => ({
      types: ['childList'] as ('attributes' | 'childList' | 'characterData')[],
      targetPath: `div.item-${i}`,
      targetTag: 'DIV',
      shadowContext: null,
      changedAttributes: [],
      attributeDeltas: {},
      addedNodesCount: 1,
      removedNodesCount: 0,
      characterDataDelta: null,
      firstMutationAt: 100 + i,
      lastMutationAt: 110 + i,
      rawMutationCount: 1,
      firstBatchIndex: i,
      lastBatchIndex: i,
    }));

    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({ domChanges: changes }),
    }));

    // Should show 10 rows + 1 "more" indicator
    const domRows = container.querySelectorAll('.evidence-row');
    const moreText = Array.from(domRows).map(r => r.textContent).find(t => t?.includes('more'));
    expect(moreText).toBeTruthy();
    expect(moreText).toContain('5 more');
  });

  it('renders network activity with method, status, and URL', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        networkActivity: [{
          url: '/api/users/123',
          method: 'GET',
          status: 200,
          startRelativeToEvent: 10,
          endRelativeToEvent: 50,
          durationMs: 40,
          resourceType: 'fetch',
          source: 'main-world',
        }],
      }),
    }));

    const netRows = container.querySelectorAll('.evidence-row--network');
    expect(netRows.length).toBe(1);
    expect(netRows[0].textContent).toContain('GET');
    expect(netRows[0].textContent).toContain('200');
    expect(netRows[0].textContent).toContain('/api/users/123');
  });

  it('distinguishes main-world vs webrequest source with emoji', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        networkActivity: [
          { url: '/api/a', method: 'GET', status: 200, startRelativeToEvent: 0, endRelativeToEvent: 10, durationMs: 10, resourceType: 'fetch', source: 'main-world' },
          { url: '/api/b', method: 'POST', status: 500, startRelativeToEvent: 0, endRelativeToEvent: 10, durationMs: 10, resourceType: 'unknown', source: 'webrequest' },
        ],
      }),
    }));

    const netRows = container.querySelectorAll('.evidence-row--network');
    expect(netRows.length).toBe(2);
    expect(netRows[0].textContent).toContain('🔵');
    expect(netRows[1].textContent).toContain('🟣');
  });

  it('renders navigation evidence', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        navigation: [{
          type: 'pushState',
          fromUrl: '/page1',
          toUrl: '/page2',
          relativeTime: 100,
          batchIndex: 3,
        }],
      }),
    }));

    const rows = container.querySelectorAll('.evidence-row');
    const navText = Array.from(rows).map(r => r.textContent).join(' ');
    expect(navText).toContain('pushState');
    expect(navText).toContain('/page1');
    expect(navText).toContain('/page2');
  });

  it('renders surface changes (new surfaces)', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        newSurfaces: [{
          path: 'body > div.modal',
          tagName: 'DIV',
          ariaRole: 'dialog',
          accessibleName: 'Confirmation Dialog',
          shadowContext: null,
          descendantCount: 5,
          relativeTime: 50,
          batchIndex: 2,
          kind: 'added' as const,
        }],
      }),
    }));

    const rows = container.querySelectorAll('.evidence-row');
    const surfText = Array.from(rows).map(r => r.textContent).join(' ');
    expect(surfText).toContain('<DIV>');
    expect(surfText).toContain('dialog');
    expect(surfText).toContain('Confirmation Dialog');
  });

  it('renders visibility changes', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        visibilityChanges: [{
          path: 'div#overlay',
          property: 'display',
          oldValue: 'none',
          newValue: 'block',
          relativeTime: 80,
          batchIndex: 1,
        }],
      }),
    }));

    const rows = container.querySelectorAll('.evidence-row');
    const visText = Array.from(rows).map(r => r.textContent).join(' ');
    expect(visText).toContain('display');
    expect(visText).toContain('none');
    expect(visText).toContain('block');
  });

  it('shows empty application state when no changes detected', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence(),
    }));

    const muted = container.querySelectorAll('.evidence-row--muted');
    const texts = Array.from(muted).map(m => m.textContent);
    expect(texts.some(t => t?.includes('No application-level changes'))).toBe(true);
  });

  it('renders shadow context in DOM changes', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        domChanges: [{
          types: ['childList'],
          targetPath: 'ul.list',
          targetTag: 'UL',
          shadowContext: 'my-component#root > div.host',
          changedAttributes: [],
          attributeDeltas: {},
          addedNodesCount: 1,
          removedNodesCount: 0,
          characterDataDelta: null,
          firstMutationAt: 100,
          lastMutationAt: 120,
          rawMutationCount: 1,
          firstBatchIndex: 1,
          lastBatchIndex: 1,
        }],
      }),
    }));

    const rows = container.querySelectorAll('.evidence-row');
    const rowText = Array.from(rows).map(r => r.textContent).join(' ');
    expect(rowText).toContain('shadow');
  });
});

describe('renderEvidencePlaceholder', () => {
  it('creates a placeholder element with collecting text', () => {
    const placeholder = renderEvidencePlaceholder();
    expect(placeholder).toBeTruthy();
    expect(placeholder.className).toContain('evidence-placeholder');
    expect(placeholder.textContent).toContain('Collecting');
  });
});

describe('updateEvidenceOnInteraction', () => {
  it('appends evidence container when none exists', () => {
    const interactionEl = document.createElement('div');
    interactionEl.className = 'interaction-event';
    interactionEl.innerHTML = '<div class="timeline-event__id">evt-1</div>';

    updateEvidenceOnInteraction(interactionEl, makeEvidence());

    const evidenceContainer = interactionEl.querySelector('[data-evidence-container]');
    expect(evidenceContainer).toBeTruthy();
  });

  it('replaces existing evidence when container exists', () => {
    const interactionEl = document.createElement('div');
    interactionEl.className = 'interaction-event';

    // Add initial evidence
    updateEvidenceOnInteraction(interactionEl, makeEvidence({
      window: { openedAt: 0, closedAt: 100, durationMs: 100, endReason: 'stabilized', stabilityTrace: [] },
    }));

    const firstMeta = interactionEl.querySelector('.evidence-window-meta');
    expect(firstMeta?.textContent).toContain('100ms');

    // Update with new evidence
    updateEvidenceOnInteraction(interactionEl, makeEvidence({
      window: { openedAt: 0, closedAt: 500, durationMs: 500, endReason: 'max-duration', stabilityTrace: [] },
    }));

    const updatedMeta = interactionEl.querySelector('.evidence-window-meta');
    expect(updatedMeta?.textContent).toContain('500ms');
    expect(updatedMeta?.textContent).toContain('max-duration');
  });

  it('replaces placeholder when evidence arrives', () => {
    const interactionEl = document.createElement('div');
    interactionEl.className = 'interaction-event';
    interactionEl.appendChild(renderEvidencePlaceholder());

    expect(interactionEl.querySelector('.evidence-placeholder')).toBeTruthy();

    updateEvidenceOnInteraction(interactionEl, makeEvidence());

    expect(interactionEl.querySelector('.evidence-placeholder')).toBeFalsy();
    expect(interactionEl.querySelector('[data-evidence-container]')).toBeTruthy();
  });

  it('does not duplicate evidence containers on multiple updates', () => {
    const interactionEl = document.createElement('div');
    interactionEl.className = 'interaction-event';

    updateEvidenceOnInteraction(interactionEl, makeEvidence());
    updateEvidenceOnInteraction(interactionEl, makeEvidence());
    updateEvidenceOnInteraction(interactionEl, makeEvidence());

    const containers = interactionEl.querySelectorAll('[data-evidence-container]');
    expect(containers.length).toBe(1);
  });
});

describe('collapsibility', () => {
  it('target section header toggles body visibility', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence());

    const targetSection = container.querySelector('[data-evidence-scope="target"]') as HTMLElement;
    const header = targetSection.querySelector('.evidence-section__header') as HTMLElement;
    const body = targetSection.querySelector('.evidence-section__body') as HTMLElement;

    expect(body.hidden).toBe(false);

    header.click();

    expect(body.hidden).toBe(true);

    header.click();

    expect(body.hidden).toBe(false);
  });

  it('application section header toggles body visibility', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence());

    const appSection = container.querySelector('[data-evidence-scope="application"]') as HTMLElement;
    const header = appSection.querySelector('.evidence-section__header') as HTMLElement;
    const body = appSection.querySelector('.evidence-section__body') as HTMLElement;

    expect(body.hidden).toBe(false);

    header.click();

    expect(body.hidden).toBe(true);
  });
});

describe('performance condition display', () => {
  it('renders performance metadata when present', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        performanceCondition: {
          mainThreadBlocked: false,
          highChurnMode: true,
          longestBatchMs: 45.3,
          totalBatches: 12,
        },
      }),
    }));

    const rows = container.querySelectorAll('.evidence-row');
    const perfText = Array.from(rows).map(r => r.textContent).join(' ');
    expect(perfText).toContain('12 batches');
    expect(perfText).toContain('45');
    expect(perfText).toContain('high-churn');
  });
});

describe('frame ID display', () => {
  it('shows frame ID when not main', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      frameId: 'iframe-content',
    }));

    const meta = container.querySelector('.evidence-window-meta');
    expect(meta?.textContent).toContain('frame');
    expect(meta?.textContent).toContain('iframe-content');
  });

  it('omits frame ID when main', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      frameId: 'main',
    }));

    const meta = container.querySelector('.evidence-window-meta');
    expect(meta?.textContent).not.toContain('frame');
  });
});

// ── Phase 4a — Resulting State display ──────────────────────────────

/** Wire-type factories (src/shared/page-content-wire.ts). */
function makeItem(overrides: Partial<WireObservedItem> = {}): WireObservedItem {
  return {
    kind: 'counter',
    matchedSelector: '[data-count]',
    text: '',
    numericValue: null,
    entityId: null,
    entityType: null,
    domPath: 'DIV#cart-count',
    attributes: {},
    visible: true,
    ...overrides,
  };
}

function makeSnapshotWire(overrides: Partial<WirePageContentSnapshot> = {}): WirePageContentSnapshot {
  return {
    url: 'https://shop.example/cart',
    viewId: null,
    items: [makeItem({ kind: 'counter', numericValue: 4, domPath: 'DIV#cart-count' })],
    itemsOverflow: 0,
    scannedAt: 1234.5,
    scanDurationMs: 12.4,
    ...overrides,
  };
}

describe('renderEvidence — resulting state (Phase 4a)', () => {
  it('AC-R1: renders the block first with group order counter→collection→entity→badge→notification', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        resultingState: makeSnapshotWire({
          items: [
            makeItem({ kind: 'notification', text: 'Added to cart', domPath: 'DIV[role=alert]' }),
            makeItem({ kind: 'status-badge', text: 'Order confirmed', domPath: 'SPAN.badge' }),
            makeItem({ kind: 'entity', entityId: 'B0VAL1', entityType: 'product', text: 'USB cable', domPath: 'LI[data-asin=B0VAL1]' }),
            makeItem({ kind: 'collection', numericValue: 4, domPath: 'UL#cart-items' }),
            makeItem({ kind: 'counter', numericValue: 4, domPath: 'DIV#cart-count' }),
          ],
        }),
      }),
    }));

    const appSection = container.querySelector('[data-evidence-scope="application"]')!;
    const body = appSection.querySelector('.evidence-section__body')!;
    const subheaders = Array.from(body.querySelectorAll('.evidence-subheader'));
    // Block is present and is the FIRST sub-block (document order)
    expect(subheaders[0]?.textContent).toContain('Resulting State');

    // Row order follows the fixed group order (input order shuffled)
    const rows = Array.from(body.querySelectorAll('.evidence-row'))
      .filter((el) => el.classList.contains('evidence-row--muted') === false)
      .filter((el) => !el.textContent!.startsWith('scanned:'))
      .map((el) => el.textContent ?? '');
    expect(rows[0]).toBe('🔢 counter: 4 (DIV#cart-count)');
    expect(rows[1]).toBe('📦 collection: 4 items (UL#cart-items)');
    expect(rows[2]).toBe('🏷 product:B0VAL1 · USB cable');
    expect(rows[3]).toBe('🚦 Order confirmed');
    expect(rows[4]).toBe('💬 Added to cart');
  });

  it('AC-R2: field absent → block not rendered, existing sections unchanged', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence()); // no resultingState

    expect(container.textContent).not.toContain('Resulting State');
    const appSection = container.querySelector('[data-evidence-scope="application"]')!;
    // Only the pre-existing "No application-level changes detected" empty row
    const bodyRows = appSection.querySelectorAll('.evidence-section__body .evidence-row');
    expect(bodyRows.length).toBe(1);
    expect(bodyRows[0].textContent).toContain('No application-level changes detected');
  });

  it('AC-R3: empty items array (defensive) → nothing rendered', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({ resultingState: makeSnapshotWire({ items: [] }) }),
    }));

    expect(container.textContent).not.toContain('Resulting State');
  });

  it('AC-R4: kind above display cap → muted … N more row', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        resultingState: makeSnapshotWire({
          items: [
            makeItem({ kind: 'entity', entityId: 'B0VAL1', entityType: 'product', domPath: 'LI[data-asin=B0VAL1]' }),
            makeItem({ kind: 'entity', entityId: 'B0VAL2', entityType: 'product', domPath: 'LI[data-asin=B0VAL2]' }),
            makeItem({ kind: 'entity', entityId: 'B0VAL3', entityType: 'product', domPath: 'LI[data-asin=B0VAL3]' }),
            makeItem({ kind: 'entity', entityId: 'B0VAL4', entityType: 'product', domPath: 'LI[data-asin=B0VAL4]' }),
            makeItem({ kind: 'entity', entityId: 'B0VAL5', entityType: 'product', domPath: 'LI[data-asin=B0VAL5]' }),
            makeItem({ kind: 'entity', entityId: 'B0VAL6', entityType: 'product', domPath: 'LI[data-asin=B0VAL6]' }),
            makeItem({ kind: 'entity', entityId: 'B0VAL7', entityType: 'product', domPath: 'LI[data-asin=B0VAL7]' }),
          ],
        }),
      }),
    }));

    const appSection = container.querySelector('[data-evidence-scope="application"]')!;
    const entityRows = Array.from(appSection.querySelectorAll('.evidence-row'))
      .filter((el) => el.textContent?.startsWith('🏷'));
    expect(entityRows.length).toBe(6); // cap
    const more = Array.from(appSection.querySelectorAll('.evidence-row--muted'))
      .find((el) => el.textContent?.startsWith('…'));
    expect(more?.textContent).toBe('… 1 more'); // 7 - 6
    expect(appSection.textContent).not.toContain('B0VAL7'); // capped item not shown
  });

  it('AC-R5: capture-time overflow shown in header', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        resultingState: makeSnapshotWire({ itemsOverflow: 4 }),
      }),
    }));

    const header = Array.from(container.querySelectorAll('.evidence-subheader'))
      .find((el) => el.textContent?.includes('Resulting State'))!;
    expect(header.textContent).toContain('(1 observed · +4 dropped at capture)');
  });

  it('AC-R6: synthetic nav evidence shows destination snapshot alongside nav sections', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      window: { openedAt: 100, closedAt: 900, durationMs: 800, endReason: 'page-reload-synthetic', stabilityTrace: [] },
      applicationEvidence: makeAppEvidence({
        navigation: [{
          type: 'full-reload',
          fromUrl: 'https://shop.example/checkout',
          toUrl: 'https://shop.example/confirmation',
          relativeTime: 10,
          batchIndex: 0,
        }],
        resultingState: makeSnapshotWire({
          url: 'https://shop.example/confirmation',
          items: [makeItem({ kind: 'entity', entityId: '12345', entityType: 'order', domPath: 'DIV[data-order-id=12345]' })],
        }),
      }),
    }));

    // Synthetic notice, Navigation section, AND Resulting State all present
    expect(container.textContent).toContain('📋 Navigation evidence (page reloaded — synthetic)');
    expect(container.textContent).toContain('full-reload: https://shop.example/checkout');
    expect(container.textContent).toContain('📸 Resulting State');
    const meta = Array.from(container.querySelectorAll('.evidence-row--muted'))
      .find((el) => el.textContent?.startsWith('scanned:'));
    expect(meta?.textContent).toContain('https://shop.example/confirmation');
  });

  it('AC-R7: 200-char item text is truncated', () => {
    const longText = 'x'.repeat(200);
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        resultingState: makeSnapshotWire({
          items: [makeItem({ kind: 'notification', text: longText })],
        }),
      }),
    }));

    const rows = container.querySelectorAll('.evidence-row');
    const notif = Array.from(rows).find((r) => r.textContent?.startsWith('💬'));
    // 💬 (2 UTF-16 units) + space + 60 truncated chars + 1-char ellipsis
    expect(notif?.textContent?.length).toBeLessThanOrEqual(2 + 1 + 60 + 1);
  });

  it('AC-R8: entity-title items are never rendered', () => {
    const container = document.createElement('div');
    renderEvidence(container, makeEvidence({
      applicationEvidence: makeAppEvidence({
        resultingState: makeSnapshotWire({
          items: [
            makeItem({ kind: 'entity-title', text: 'Widget title', domPath: 'H2' }),
            makeItem({ kind: 'entity', entityId: 'B0VAL1', entityType: 'product', domPath: 'LI[data-asin=B0VAL1]' }),
          ],
        }),
      }),
    }));

    expect(container.textContent).toContain('🏷 product:B0VAL1');
    expect(container.textContent).not.toContain('Widget title');
  });

  it('AC-R9: late-arriving evidence replace path renders the block', () => {
    const interactionEl = document.createElement('div');
    updateEvidenceOnInteraction(interactionEl, makeEvidence()); // no snapshot
    expect(interactionEl.textContent).not.toContain('Resulting State');

    updateEvidenceOnInteraction(interactionEl, makeEvidence({
      applicationEvidence: makeAppEvidence({
        resultingState: makeSnapshotWire(),
      }),
    }));
    expect(interactionEl.textContent).toContain('📸 Resulting State');
    expect(interactionEl.textContent).toContain('🔢 counter: 4');
  });
});
