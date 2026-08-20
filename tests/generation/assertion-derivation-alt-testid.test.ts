/**
 * Defect 2c — entity locator priority + 2a derivation outcomes + 2b held.
 *
 * Pins (spec .drytis/specs/defect1-2a-2c-replay-wait-alt-testid.md):
 *  - entity own identity attribute derives [data-sku="X"] even under ancestor #id (2c)
 *  - null-identity duplicate entity (same identity VALUE) never emits a vacuous
 *    #ancestor assertion (double-capture dedup)
 *  - entity without any identity attr but with ancestor #id → #id preserved (tier id)
 *  - entity without identity attr and without ancestor #id → skipped
 *  - Phase 2b: id-less counters derive attribute locators ONLY when the
 *    observer stamped uniqueInSnapshot=true and the attribute is allowlisted;
 *    verified attribute outranks an ANCESTOR #id; own #id always wins;
 *    unverified items keep the exact legacy policy (skip / #ancestor)
 *  - collection COUNT still requires #id container (unchanged)
 *  - OR-1: repeated interactions keep separate assertions per sourceEventId
 */
import { describe, it, expect } from 'vitest';
import {
  deriveStepAssertions,
} from '../../src/generation/assertion-derivation';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { WirePageContentSnapshot, WireObservedItem } from '../../src/shared/page-content-wire';

function item(partial: Partial<WireObservedItem>): WireObservedItem {
  return {
    kind: 'entity',
    matchedSelector: '[data-sku]',
    text: 'row',
    numericValue: null,
    entityId: null,
    entityType: 'product',
    domPath: 'body > main#app-root > div#cart-root > div',
    attributes: {},
    visible: true,
    ...partial,
  };
}

function snapOf(items: WireObservedItem[]): WirePageContentSnapshot {
  return {
    url: 'https://example.com/cart',
    viewId: 'v',
    items,
    itemsOverflow: 0,
    scannedAt: 0,
    scanDurationMs: 1,
  } as unknown as WirePageContentSnapshot;
}

function interactionOf(eventId: string, items: WireObservedItem[]): ComponentInteraction {
  return {
    triggerEvent: { eventId },
    behavioralEvidence: { applicationEvidence: { resultingState: snapOf(items) } },
  } as unknown as ComponentInteraction;
}

describe('Defect 2c — entity locator priority', () => {
  it('own identity attribute wins over ancestor #id', () => {
    const items = [
      item({
        kind: 'entity',
        entityId: 'F1',
        domPath: 'body > main#app-root > div#cart-root > div',
        attributes: { 'data-sku': 'F1' },
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].type).toBe('presence');
    expect(asr[0].targetCss).toBe('[data-sku="F1"]');
  });

  it('null-identity duplicate (double-capture of the same row) never emits the vacuous ancestor #id', () => {
    // The old [data-sku] entry captured the row with entityId:null; the new
    // co-occurrence entry captured the same row with entityId:'F1'. Both share
    // the identity VALUE in attributes. Only ONE presence may be derived and it
    // must target the entity itself.
    const items = [
      item({ entityId: null, attributes: { 'data-sku': 'F1' } }),
      item({ entityId: 'F1', attributes: { 'data-sku': 'F1', 'data-auto-id': 'cart-item-F1' } }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].targetCss).toBe('[data-sku="F1"]');
    expect(asr.every((a) => a.targetCss !== '#cart-root')).toBe(true);
  });

  it('entity with no identity attribute but ancestor #id keeps #id (tier id preserved)', () => {
    const items = [
      item({ entityId: null, attributes: { 'data-testid': 'row' } }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].targetCss).toBe('#cart-root');
  });

  it('entity without identity attribute and without ancestor #id is skipped', () => {
    const items = [
      item({
        entityId: null,
        domPath: 'body > main > div > div',
        attributes: { 'data-testid': 'row' },
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    expect(map.size).toBe(0);
  });

  it('escaped identity values survive selector quoting', () => {
    const items = [
      item({ entityId: 'we"ird', attributes: { 'data-sku': 'we"ird' } }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr[0].targetCss).toBe('[data-sku="we\\"ird"]');
  });
});

describe('Phase 2b — verified id-less counter locators', () => {
  it('id-less counter with a verified allowlisted attribute → textMatch targets the attribute selector', () => {
    const items = [
      item({
        kind: 'counter',
        text: '2',
        numericValue: 2,
        domPath: 'body > header > span > span',
        attributes: { 'data-auto-id': 'cart-count' },
        uniqueInSnapshot: true,
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].type).toBe('textMatch');
    expect(asr[0].targetCss).toBe('[data-auto-id="cart-count"]');
  });

  it('id-less counter WITHOUT verification → no assertion (legacy policy unchanged)', () => {
    const items = [
      item({
        kind: 'counter',
        text: '2',
        numericValue: 2,
        domPath: 'body > header > span > span',
        attributes: { 'data-auto-id': 'cart-count' },
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    expect(map.size).toBe(0);
  });

  it('verified attribute outranks ANCESTOR #id (wrong-element fix, mirrors 2c)', () => {
    const items = [
      item({
        kind: 'counter',
        text: '3',
        numericValue: 3,
        domPath: 'body > main#app-root > div#cart-root > div.total > span',
        attributes: { 'data-auto-id': 'cart-total' },
        uniqueInSnapshot: true,
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].targetCss).toBe('[data-auto-id="cart-total"]');
    expect(asr[0].targetCss).not.toBe('#cart-root');
  });

  it('OWN #id still outranks a verified attribute (tier id preserved)', () => {
    const items = [
      item({
        kind: 'counter',
        text: '0 items',
        numericValue: 0,
        domPath: 'body > main#app-root > p > span#cart-count',
        attributes: { 'data-count': '0', 'aria-label': 'Cart' },
        uniqueInSnapshot: true,
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].targetCss).toBe('#cart-count');
  });

  it('unverified id-less counter with an ancestor #id keeps the legacy #ancestor fallback', () => {
    const items = [
      item({
        kind: 'counter',
        text: '3',
        numericValue: 3,
        domPath: 'body > main#app-root > div#cart-root > div.total > span',
        attributes: { 'data-auto-id': 'cart-total' },
        // uniqueInSnapshot absent — legacy snapshot / observer-not-verified
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].targetCss).toBe('#cart-root');
    expect(asr[0].type).toBe('textMatch');
  });

  it('verified attribute must be allowlisted: non-allowlisted attrs never become locators', () => {
    const items = [
      item({
        kind: 'counter',
        text: '2',
        numericValue: 2,
        domPath: 'body > header > span > span',
        attributes: { 'data-sku': 'X1', 'data-tracking-token': 'abc123' },
        uniqueInSnapshot: true, // stamp true even though attrs are not allowlisted
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    expect(map.size).toBe(0);
  });

  it('aria-label verified attribute derives [aria-label="…"] locator', () => {
    const items = [
      item({
        kind: 'counter',
        text: '2',
        numericValue: 2,
        domPath: 'body > header > button > span',
        attributes: { 'aria-label': 'Cart items' },
        uniqueInSnapshot: true,
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].targetCss).toBe('[aria-label="Cart items"]');
  });

  it('uniqueInSnapshot:false is treated as unverified (no locator)', () => {
    const items = [
      item({
        kind: 'counter',
        text: '2',
        numericValue: 2,
        domPath: 'body > header > span > span',
        attributes: { 'data-auto-id': 'cart-count' },
        uniqueInSnapshot: false,
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    expect(map.size).toBe(0);
  });

  it('verified counter with NO parseable numericValue is skipped (numeric gate unchanged)', () => {
    const items = [
      item({
        kind: 'counter',
        text: '—',
        numericValue: null,
        domPath: 'body > header > span > span',
        attributes: { 'data-auto-id': 'cart-count' },
        uniqueInSnapshot: true,
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    expect(map.size).toBe(0);
  });

  it('escaped attribute values survive selector quoting (2b locators)', () => {
    const items = [
      item({
        kind: 'counter',
        text: '2',
        numericValue: 2,
        domPath: 'body > header > span > span',
        attributes: { 'data-auto-id': 'cart "count"' },
        uniqueInSnapshot: true,
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].targetCss).toBe('[data-auto-id="cart \\"count\\""]');
  });

  it('nested counters (badge wrapper + leaf span) dedupe to the LEAF — cap not exhausted, entity presence survives (2b crowding fix)', () => {
    // Clone reality: the badge element (aria-label) WRAPS the count span
    // (data-auto-id). Both derive textMatch → the redundant ancestor twin
    // consumed the MAX_ASSERTIONS_PER_STEP=3 cap and crowded out entity
    // presence. Dedup keeps the leaf; the ancestor wrapper is dropped.
    const items: WireObservedItem[] = [
      item({
        kind: 'counter',
        text: '1',
        numericValue: 1,
        domPath: 'body > header > span',
        attributes: { 'aria-label': 'Cart items' },
        uniqueInSnapshot: true,
      }),
      item({
        kind: 'counter',
        text: '1',
        numericValue: 1,
        domPath: 'body > header > span > span',
        attributes: { 'data-auto-id': 'cart-count' },
        uniqueInSnapshot: true,
      }),
      item({
        kind: 'counter',
        text: '1',
        numericValue: 1,
        domPath: 'body > main > div#cart-root > div > span',
        attributes: { 'data-auto-id': 'cart-total' },
        uniqueInSnapshot: true,
      }),
      item({ kind: 'entity', entityId: 'MEAL', attributes: { 'data-sku': 'MEAL' } }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    // Three assertions: leaf cart-count + cart-total + entity presence
    expect(asr.length).toBe(3);
    const locs = asr.map((a) => a.targetCss);
    expect(locs).toContain('[data-auto-id="cart-count"]');
    expect(locs).toContain('[data-auto-id="cart-total"]');
    expect(locs).toContain('[data-sku="MEAL"]');
    // The badge wrapper twin is GONE (redundant ancestor dropped)
    expect(locs).not.toContain('[aria-label="Cart items"]');
  });

  it('nested-counter dedup is path-prefix based: siblings with a shared ancestor prefix are NOT deduped', () => {
    const items = [
      item({
        kind: 'counter',
        text: '1',
        numericValue: 1,
        domPath: 'body > header > span',
        attributes: { 'aria-label': 'Cart items' },
        uniqueInSnapshot: true,
      }),
      item({
        kind: 'counter',
        text: '2',
        numericValue: 2,
        domPath: 'body > header > nav > span',
        attributes: { 'data-auto-id': 'wish-count' },
        uniqueInSnapshot: true,
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    // 'body > header > span' is NOT a prefix of 'body > header > nav > span'
    // (segment boundary) — both are distinct widgets, both derive.
    expect(asr.length).toBe(2);
    expect(asr.map((a) => a.targetCss)).toContain('[aria-label="Cart items"]');
    expect(asr.map((a) => a.targetCss)).toContain('[data-auto-id="wish-count"]');
  });
});

describe('OR-1 — repeated interactions keep separate per-step assertions', () => {
  it('two identical qty-plus clicks derive separate assertion lists per sourceEventId', () => {
    const mk = (): WireObservedItem[] => [
      item({ entityId: 'F1', attributes: { 'data-sku': 'F1' } }),
    ];
    const map = deriveStepAssertions([
      interactionOf('evt-click-1', mk()),
      interactionOf('evt-click-2', mk()),
    ]);
    expect(map.size).toBe(2);
    expect(map.get('evt-click-1')?.[0].targetCss).toBe('[data-sku="F1"]');
    expect(map.get('evt-click-2')?.[0].targetCss).toBe('[data-sku="F1"]');
  });
});
