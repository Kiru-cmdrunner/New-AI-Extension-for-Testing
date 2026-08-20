/**
 * Defect 2c — entity locator priority + 2a derivation outcomes + 2b held.
 *
 * Pins (spec .drytis/specs/defect1-2a-2c-replay-wait-alt-testid.md):
 *  - entity own identity attribute derives [data-sku="X"] even under ancestor #id (2c)
 *  - null-identity duplicate entity (same identity VALUE) never emits a vacuous
 *    #ancestor assertion (double-capture dedup)
 *  - entity without any identity attr but with ancestor #id → #id preserved (tier id)
 *  - entity without identity attr and without ancestor #id → skipped
 *  - 2b HELD: id-less counter → no assertion; counter w/ ancestor #id → #ancestor (no attr locator)
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

describe('2b HELD — id-less counter locator policy unchanged', () => {
  it('id-less counter (no id anywhere) → no assertion', () => {
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

  it('counter with ancestor #id → textMatch targets #ancestor-id (no attribute locator)', () => {
    const items = [
      item({
        kind: 'counter',
        text: '3',
        numericValue: 3,
        domPath: 'body > main#app-root > div#cart-root > div.total > span',
        attributes: { 'data-auto-id': 'cart-total' },
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const asr = map.get('evt-1') ?? [];
    expect(asr.length).toBe(1);
    expect(asr[0].targetCss).toBe('#cart-root');
    expect(asr[0].type).toBe('textMatch');
  });

  it('no counter assertion uses a data-auto-id/data-testid attribute locator', () => {
    const items = [
      item({
        kind: 'counter',
        text: '2',
        numericValue: 2,
        domPath: 'body > header > span > span',
        attributes: { 'data-auto-id': 'cart-count' },
      }),
      item({
        kind: 'counter',
        text: '3',
        numericValue: 3,
        domPath: 'body > main#app-root > div#cart-root > div.total > span',
        attributes: { 'data-auto-id': 'cart-total' },
      }),
    ];
    const map = deriveStepAssertions([interactionOf('evt-1', items)]);
    const all = [...map.values()].flat();
    for (const a of all) {
      expect(a.targetCss.includes('data-auto-id')).toBe(false);
      expect(a.targetCss.includes('data-testid')).toBe(false);
      expect(a.targetCss.includes('data-test-id')).toBe(false);
    }
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
