/**
 * Phase 6A/6C — Assertion derivation: fill committed-value branch + seeded kinds
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md §2.5
 *
 * Pins:
 *  - P2: TextEntry fills gain ≥1 soft assertion on the COMMITTED state
 *    (equality/equals/property='value', #id tier via trigger.stableId, honest
 *    skip when no stableId).
 *  - P5 (derivation half): assertion expects the committed textValue, NOT the
 *    typed intent.
 *  - Seeded-item kinds derive through the EXISTING per-kind emission — no new
 *    derivation logic for seeded items.
 *
 * TDD: written before implementation. Red until deriveStepAssertions grows
 * the TextEntry committed-value branch. No product code here.
 */

import { describe, it, expect } from 'vitest';
import { deriveStepAssertions } from '../../src/generation/assertion-derivation';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { WireObservedItem, WirePageContentSnapshot } from '../../src/shared/page-content-wire';

// ── Factories (mirror tests/generation/assertion-derivation.test.ts) ──

function item(overrides: Partial<WireObservedItem> = {}): WireObservedItem {
  return {
    kind: 'counter',
    matchedSelector: 'changed-element-seed',
    text: '5 items',
    numericValue: 5,
    entityId: null,
    entityType: null,
    domPath: 'body > div#cart-count',
    attributes: {},
    visible: true,
    ...overrides,
  };
}

function snapshot(items: WireObservedItem[]): WirePageContentSnapshot {
  return {
    url: 'https://example.test/cart',
    viewId: null,
    items,
    itemsOverflow: 0,
    scannedAt: 12345,
    scanDurationMs: 4,
  };
}

type InteractionOverrides = {
  type?: string;
  eventId?: string;
  metadata?: Record<string, unknown>;
  stableId?: string | null;
  resultingState?: WirePageContentSnapshot;
};

function interaction(o: InteractionOverrides = {}): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: (o.type ?? 'TextEntry') as ComponentInteraction['type'],
    trigger: {
      tag: 'INPUT',
      stableId: o.stableId === undefined ? 'origin' : o.stableId,
      accessibleName: 'Origin',
      cssSelector: '#origin',
      elementId: '',
      ariaLabel: null,
      ariaRole: 'textbox',
      placeholder: null,
      className: null,
      name: 'origin',
      testId: null,
      dataCy: null,
      dataQa: null,
      href: null,
      inputType: 'text',
      ariaLabelledBy: null,
      xPath: '/html/body/input',
      inIframe: false,
      shadowDom: false,
    } as never,
    triggerEvent: { eventId: o.eventId ?? 'ev-1' } as never,
    memberEvents: [],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata: o.metadata ?? {},
    behavioralEvidence:
      o.resultingState !== undefined
        ? ({ applicationEvidence: { resultingState: o.resultingState } } as never)
        : undefined,
  } as unknown as ComponentInteraction;
}

function fillMetadata(typed: string, committed: string): Record<string, unknown> {
  return { targetName: 'Origin', textValue: committed, typedValue: typed, userTyped: true };
}

// ── P2: fill committed-value assertion ────────────────────

describe('deriveStepAssertions — TextEntry committed-value branch (P2)', () => {
  it('a typed fill with a committed value and stableId gains a soft value assertion on COMMITTED state', () => {
    const map = deriveStepAssertions([
      interaction({ metadata: fillMetadata('Sat, 22 Aug', 'Sat, 05 Sep') }),
    ]);
    const asserts = map.get('ev-1') ?? [];
    expect(asserts.length).toBeGreaterThanOrEqual(1);
    const value = asserts.find((a) => a.type === 'equality' && a.property === 'value');
    expect(value).toBeDefined();
    expect(value!.severity).toBe('soft');
    expect(value!.comparison).toBe('equals');
    // COMMITTED state, not typed intent:
    expect(value!.expectedValue).toBe('Sat, 05 Sep');
    expect(value!.targetCss).toBe('#origin');
  });

  it('honest skip: no stableId → no value assertion (no locator tier)', () => {
    const map = deriveStepAssertions([
      interaction({ stableId: null, metadata: fillMetadata('Sat, 22 Aug', 'Sat, 05 Sep') }),
    ]);
    expect(map.get('ev-1') ?? []).toHaveLength(0);
  });

  it('skips when userTyped is false (no committed input to assert)', () => {
    const map = deriveStepAssertions([
      interaction({
        metadata: { targetName: 'Origin', textValue: 'Sat, 05 Sep', typedValue: '', userTyped: false },
      }),
    ]);
    expect(map.get('ev-1') ?? []).toHaveLength(0);
  });

  it('skips when the committed value is empty', () => {
    const map = deriveStepAssertions([
      interaction({
        metadata: { targetName: 'Origin', textValue: '', typedValue: 'abc', userTyped: true },
      }),
    ]);
    expect(map.get('ev-1') ?? []).toHaveLength(0);
  });

  it('value assertion is emitted FIRST and shares the 3-per-step cap with snapshot kinds', () => {
    const items: WireObservedItem[] = [
      item({ kind: 'counter', text: '5 items', numericValue: 5, domPath: 'body > div#cart-count' }),
      item({ kind: 'status-badge', text: 'Order Confirmed', domPath: 'body > div#status' }),
      item({ kind: 'notification', text: 'Added to cart', domPath: 'body > div#toast' }),
      item({ kind: 'counter', text: '2 trips', numericValue: 2, domPath: 'body > div#trip-count' }),
    ];
    const map = deriveStepAssertions([
      interaction({ metadata: fillMetadata('Sat, 22 Aug', 'Sat, 05 Sep'), resultingState: snapshot(items) }),
    ]);
    const asserts = map.get('ev-1') ?? [];
    // Cap is 3 — value assertion + 2 snapshot kinds.
    expect(asserts.length).toBeLessThanOrEqual(3);
    expect(asserts.some((a) => a.type === 'equality' && a.property === 'value')).toBe(true);
  });

  it('derivation is per-sourceEventId keyed (INV-CS1): fill assertions do not leak to other events', () => {
    const map = deriveStepAssertions([
      interaction({ eventId: 'ev-fill', metadata: fillMetadata('Sat, 22 Aug', 'Sat, 05 Sep') }),
      interaction({ eventId: 'ev-other', type: 'Click', metadata: {} }),
    ]);
    expect(map.get('ev-fill')).toHaveLength(1);
    expect(map.has('ev-other')).toBe(false);
  });
});

// ── Seeded kinds flow through EXISTING per-kind emission ──

describe('deriveStepAssertions — seeded items (seed sentinel provenance)', () => {
  it('seeded counter derives textMatch via own-#id tier with seed provenance', () => {
    const map = deriveStepAssertions([
      interaction({
        type: 'Click',
        eventId: 'ev-c',
        metadata: {},
        resultingState: snapshot([
          item({ kind: 'counter', text: '5 items', numericValue: 5, domPath: 'body > div#cart-count' }),
        ]),
      }),
    ]);
    const asserts = map.get('ev-c') ?? [];
    expect(asserts).toHaveLength(1);
    expect(asserts[0].type).toBe('textMatch');
    expect(asserts[0].comparison).toBe('contains');
    expect(asserts[0].expectedValue).toBe('5 items');
    expect(asserts[0].targetCss).toBe('#cart-count');
  });

  it('seeded collection derives count/equals via container #id', () => {
    const map = deriveStepAssertions([
      interaction({
        type: 'Click',
        eventId: 'ev-c2',
        metadata: {},
        resultingState: snapshot([
          item({
            kind: 'collection',
            text: '3 results',
            numericValue: 3,
            domPath: 'body > ul#results',
          }),
        ]),
      }),
    ]);
    const asserts = map.get('ev-c2') ?? [];
    expect(asserts).toHaveLength(1);
    expect(asserts[0].type).toBe('count');
    expect(asserts[0].expectedValue).toBe(3);
    expect(asserts[0].targetCss).toBe('#results > *');
  });

  it('seeded aria-label badge with uniqueInSnapshot=true derives via verified-attr tier', () => {
    const map = deriveStepAssertions([
      interaction({
        type: 'Click',
        eventId: 'ev-c3',
        metadata: {},
        resultingState: snapshot([
          item({
            kind: 'status-badge',
            text: 'Refunded',
            domPath: 'body > div > span',
            attributes: { 'aria-label': 'refund status' },
            uniqueInSnapshot: true,
          }),
        ]),
      }),
    ]);
    const asserts = map.get('ev-c3') ?? [];
    expect(asserts).toHaveLength(1);
    expect(asserts[0].type).toBe('textMatch');
    expect(asserts[0].targetCss).toBe('[aria-label="refund status"]');
  });
});
