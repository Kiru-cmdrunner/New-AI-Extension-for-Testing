/**
 * Track 3 / Phase 4c-i — Resulting-State Assertion Derivation
 *
 * Pure-function tests for deriveStepAssertions()/buildResultingStateEnrichment():
 * kind coverage, locator-confidence policy, soft severity, priority order,
 * per-step cap, INV-GEN-7 (absent evidence → empty), INV-CS1 independence.
 *
 * Spec: .drytis/specs/resulting-application-state-plan.md (Phase 4c)
 */

import { describe, it, expect } from 'vitest';
import {
  deriveStepAssertions,
  buildResultingStateEnrichment,
} from '../../src/generation/assertion-derivation';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type {
  WireObservedItem,
  WirePageContentSnapshot,
} from '../../src/shared/page-content-wire';

// ── Factories ──────────────────────────────────────────────

function item(overrides: Partial<WireObservedItem> = {}): WireObservedItem {
  return {
    kind: 'counter',
    matchedSelector: '[data-count]',
    text: '4 items',
    numericValue: 4,
    entityId: null,
    entityType: null,
    domPath: 'DIV#cart-count',
    attributes: {},
    visible: true,
    ...overrides,
  };
}

function snapshot(items: WireObservedItem[]): WirePageContentSnapshot {
  return {
    url: 'https://shop.example.com/cart',
    viewId: null,
    items,
    itemsOverflow: 0,
    scannedAt: 1234.5,
    scanDurationMs: 8,
  };
}

function interaction(
  eventId: string,
  rs?: WirePageContentSnapshot,
): ComponentInteraction {
  return {
    interactionId: `ix-${eventId}`,
    type: 'Click',
    trigger: {} as never,
    triggerEvent: { eventId } as never,
    memberEvents: [],
    startTime: 0,
    endTime: 1,
    endState: 'completed',
    metadata: {},
    ...(rs
      ? {
          behavioralEvidence: {
            applicationEvidence: { resultingState: rs },
          } as never,
        }
      : {}),
  };
}

// ── Kind coverage ─────────────────────────────────────────

describe('deriveStepAssertions — kind coverage (4c-i slice)', () => {
  it('derives a word-boundary matches assertion for a counter', () => {
    const map = deriveStepAssertions([
      interaction('evt-1-1', snapshot([item()])),
    ]);
    const list = map.get('evt-1-1')!;
    expect(list).toHaveLength(1);
    const a = list[0];
    expect(a.type).toBe('textMatch');
    expect(a.comparison).toBe('contains');
    expect(a.severity).toBe('soft');
    // Captured text verbatim — the exact string the app rendered for N.
    expect(a.expectedValue).toBe('4 items');
    expect(a.targetCss).toBe('#cart-count');
    expect(a.derivedFrom).toBe('counter');
  });

  it('derives a contains assertion for a distinctive status-badge text', () => {
    const map = deriveStepAssertions([
      interaction('evt-1-2', snapshot([
        item({ kind: 'status-badge', text: 'Order Confirmed', numericValue: null, domPath: 'SPAN#status' }),
      ])),
    ]);
    const a = map.get('evt-1-2')![0];
    expect(a.type).toBe('textMatch');
    expect(a.comparison).toBe('contains');
    expect(a.expectedValue).toBe('Order Confirmed');
    expect(a.derivedFrom).toBe('status-badge');
  });

  it('derives presence-only for a notification (never text)', () => {
    const map = deriveStepAssertions([
      interaction('evt-1-3', snapshot([
        item({ kind: 'notification', text: 'Order #12345 placed!', numericValue: null, domPath: 'DIV#toast' }),
      ])),
    ]);
    const a = map.get('evt-1-3')![0];
    expect(a.type).toBe('presence');
    expect(a.comparison).toBe('isTrue');
    expect(a.expectedValue).toBeNull();
    expect(a.derivedFrom).toBe('notification');
  });

  it('derives presence for an entity via its identity attribute', () => {
    const map = deriveStepAssertions([
      interaction('evt-1-4', snapshot([
        item({
          kind: 'entity',
          matchedSelector: '[data-asin]',
          text: 'Wireless Mouse',
          numericValue: null,
          entityId: 'B0VAL1',
          entityType: 'product',
          domPath: 'UL > LI',
          attributes: { 'data-asin': 'B0VAL1' },
        }),
      ])),
    ]);
    const a = map.get('evt-1-4')![0];
    expect(a.type).toBe('presence');
    expect(a.targetCss).toBe('[data-asin="B0VAL1"]');
    expect(a.derivedFrom).toBe('entity');
  });

  it('derives a soft COUNT equals assertion for a collection with #id + numericValue (4c-iii-b)', () => {
    const map = deriveStepAssertions([
      interaction('evt-1-5', snapshot([
        item({ kind: 'collection', matchedSelector: 'ul[data-testid]', text: '', numericValue: 2, domPath: 'UL#cart-items' }),
      ])),
    ]);
    expect(map.size).toBe(1);
    const a = map.get('evt-1-5')![0];
    expect(a.type).toBe('count');
    expect(a.comparison).toBe('equals');
    expect(a.severity).toBe('soft');
    expect(a.expectedValue).toBe(2);
    expect(a.targetCss).toBe('#cart-items > *');
    expect(a.derivedFrom).toBe('collection');
  });

  it('skips a collection without a high-confidence #id (no fragile locator)', () => {
    const map = deriveStepAssertions([
      interaction('evt-1-5b', snapshot([
        item({ kind: 'collection', matchedSelector: 'ul[data-testid]', text: '', numericValue: 2, domPath: 'UL' }),
      ])),
    ]);
    expect(map.size).toBe(0);
  });

  it('skips a collection with null numericValue (no trustworthy count)', () => {
    const map = deriveStepAssertions([
      interaction('evt-1-5c', snapshot([
        item({ kind: 'collection', matchedSelector: 'ul[data-testid]', text: '', numericValue: null, domPath: 'UL#cart-items' }),
      ])),
    ]);
    expect(map.size).toBe(0);
  });

  it('skips entity-title items (provenance carriers)', () => {
    const map = deriveStepAssertions([
      interaction('evt-1-6', snapshot([
        item({ kind: 'entity-title', text: 'Wireless Mouse', domPath: 'H3#t', numericValue: null }),
      ])),
    ]);
    expect(map.size).toBe(0);
  });
});

// ── Locator-confidence policy ─────────────────────────────

describe('deriveStepAssertions — locator policy', () => {
  it('uses the #id segment from the domPath when present', () => {
    const map = deriveStepAssertions([
      interaction('evt-2-1', snapshot([item({ domPath: 'MAIN > SECTION#cart > DIV#cart-count' })])),
    ]);
    expect(map.get('evt-2-1')![0].targetCss).toBe('#cart-count');
  });

  it('falls back to the identity attribute for entities without #id', () => {
    const map = deriveStepAssertions([
      interaction('evt-2-2', snapshot([
        item({
          kind: 'entity',
          entityId: 'ORD-99',
          entityType: 'order',
          domPath: 'DIV > DIV',
          attributes: { 'data-order-id': 'ORD-99' },
          numericValue: null,
          text: '',
        }),
      ])),
    ]);
    expect(map.get('evt-2-2')![0].targetCss).toBe('[data-order-id="ORD-99"]');
  });

  it('skips items with no re-findable locator rather than emitting fragile ones', () => {
    const map = deriveStepAssertions([
      interaction('evt-2-3', snapshot([
        item({ kind: 'status-badge', text: 'In Stock', numericValue: null, domPath: 'UL > LI > SPAN' }),
      ])),
    ]);
    expect(map.size).toBe(0);
  });

  it('escapes quotes and backslashes in identity attribute values', () => {
    const map = deriveStepAssertions([
      interaction('evt-2-4', snapshot([
        item({
          kind: 'entity',
          entityId: 'we"ird\\id',
          entityType: 'product',
          domPath: 'UL > LI',
          attributes: { 'data-sku': 'we"ird\\id' },
          numericValue: null,
          text: '',
        }),
      ])),
    ]);
    expect(map.get('evt-2-4')![0].targetCss).toBe('[data-sku="we\\"ird\\\\id"]');
  });

  it('skips hidden items (not stable expectations)', () => {
    const map = deriveStepAssertions([
      interaction('evt-2-5', snapshot([item({ visible: false })])),
    ]);
    expect(map.size).toBe(0);
  });
});

// ── Caps, priority, volatility ────────────────────────────

describe('deriveStepAssertions — caps and priority', () => {
  it('caps at 3 assertions per step, counter first, entity last', () => {
    const items: WireObservedItem[] = [
      item({ kind: 'entity', entityId: 'E1', domPath: 'UL > LI', attributes: { 'data-asin': 'E1' }, numericValue: null, text: '' }),
      item({ kind: 'notification', numericValue: null, text: 'added', domPath: 'DIV#toast' }),
      item({ kind: 'status-badge', text: 'In Stock', numericValue: null, domPath: 'SPAN#badge' }),
      item({ kind: 'collection', numericValue: 2, text: '', domPath: 'UL#cart-items' }),
      item({ kind: 'counter', domPath: 'DIV#cart-count' }),
      item({ kind: 'counter', domPath: 'DIV#cart-count-2' }),
    ];
    const map = deriveStepAssertions([interaction('evt-3-1', snapshot(items))]);
    const list = map.get('evt-3-1')!;
    expect(list).toHaveLength(3);
    expect(list.map((a) => a.derivedFrom)).toEqual([
      'counter',
      'counter',
      'collection',
    ]);
  });

  it('skips counters without a parseable numericValue', () => {
    const map = deriveStepAssertions([
      interaction('evt-3-2', snapshot([item({ numericValue: null, text: 'cart' })])),
    ]);
    expect(map.size).toBe(0);
  });

  it('skips purely-numeric status-badge text (counter in disguise)', () => {
    const map = deriveStepAssertions([
      interaction('evt-3-3', snapshot([
        item({ kind: 'status-badge', text: '3', numericValue: null, domPath: 'SPAN#b' }),
      ])),
    ]);
    expect(map.size).toBe(0);
  });

  it('truncates badge text to 60 chars', () => {
    const long = 'A'.repeat(120);
    const map = deriveStepAssertions([
      interaction('evt-3-4', snapshot([
        item({ kind: 'status-badge', text: long, numericValue: null, domPath: 'SPAN#b' }),
      ])),
    ]);
    expect((map.get('evt-3-4')![0].expectedValue as string).length).toBe(60);
  });
});

// ── INV-GEN-7 / INV-CS1 ───────────────────────────────────

describe('deriveStepAssertions — invariants', () => {
  it('returns an empty map when no interaction has resultingState (INV-GEN-7)', () => {
    const map = deriveStepAssertions([
      interaction('evt-4-1'),
      interaction('evt-4-2'),
    ]);
    expect(map.size).toBe(0);
  });

  it('ignores empty-item snapshots', () => {
    const map = deriveStepAssertions([interaction('evt-4-3', snapshot([]))]);
    expect(map.size).toBe(0);
  });

  it('keys each interaction\u2019s evidence separately (INV-CS1: no cross-interaction merge)', () => {
    const click = interaction('evt-5-1', snapshot([item({ numericValue: 1, text: '1 items', domPath: 'DIV#cart-count' })]));
    const nav = interaction('evt-5-2', snapshot([
      item({ kind: 'entity', entityId: 'ORD-1', entityType: 'order', domPath: 'MAIN > DIV#confirmation', attributes: { 'data-order-id': 'ORD-1' }, numericValue: null, text: '' }),
    ]));
    const map = deriveStepAssertions([click, nav]);
    expect(map.size).toBe(2);
    expect((map.get('evt-5-1')![0].expectedValue as string)).toBe('1 items');
    expect(map.get('evt-5-2')![0].derivedFrom).toBe('entity');
  });

  it('buildResultingStateEnrichment preserves existing fields and adds stepAssertions', () => {
    const existing = { surfaceTags: ['shop'] };
    const enrichment = buildResultingStateEnrichment(
      [interaction('evt-6-1', snapshot([item()]))],
      existing,
    );
    expect(enrichment.surfaceTags).toEqual(['shop']);
    expect(enrichment.stepAssertions?.size).toBe(1);
  });

  it('buildResultingStateEnrichment returns {}-shaped result when nothing derivable', () => {
    const enrichment = buildResultingStateEnrichment([interaction('evt-6-2')]);
    expect(enrichment.stepAssertions).toBeUndefined();
  });
});
