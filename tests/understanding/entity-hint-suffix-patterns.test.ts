/**
 * Entity-hint suffix patterns — ASIN.1 / quantity.1 (Amazon indexed form fields)
 *
 * Spec: .drytis/specs/entity-hint-suffix-patterns.md
 * Baseline: commit 0dfa90e (verified int-14 run: plain { ASIN, quantity } body
 * on /cart/add-to-cart → status 200, entity cart-item:B0FFF9VPMN).
 *
 * Amazon cart-page / multi-item add-to-cart posts indexed form keys
 * (ASIN.1, quantity.1, ASIN.2, …). The previously anchored patterns matched
 * only unsuffixed forms, so those bodies produced zero entity hints. These
 * tests pin the widened patterns and the untouched consumer semantics
 * (state-builder first-match-wins on product-id / quantity).
 */
import { describe, it, expect } from 'vitest';
import { NetworkSignalExtractor } from '../../src/understanding/signal-extractors/network-signals';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { NetworkActivity } from '../../src/shared/behavioral-evidence-types';
import type { ApiOperationSignal, SignalSet } from '../../src/understanding/types';

// ── Helpers (mirror tests/network-evidence-hardening.test.ts shape) ────

function makeInteraction(
  id: string,
  networkActivity: NetworkActivity[],
): ComponentInteraction {
  return {
    interactionId: id,
    type: 'click' as any,
    trigger: {
      kind: 'element',
      tagName: 'INPUT',
      id: 'add-to-cart-button',
      className: 'a-button-input',
      attributes: { 'aria-role': 'button', type: 'submit' },
    } as any,
    triggerEvent: { eventId: `evt-${id}` } as any,
    behavioralEvidence: {
      sourceEventId: `evt-${id}`,
      applicationEvidence: { networkActivity },
    } as any,
  } as unknown as ComponentInteraction;
}

function makeRow(body?: Record<string, string>): NetworkActivity {
  return {
    url: 'https://www.amazon.in/cart/add-to-cart',
    method: 'POST',
    status: 200,
    startRelativeToEvent: 0,
    endRelativeToEvent: 40,
    durationMs: 40,
    resourceType: 'unknown',
    source: 'webrequest',
    requestBody: body,
  } as unknown as NetworkActivity;
}

/** Extract the single add-to-cart ApiOperationSignal for a body. */
function extractOp(body?: Record<string, string>): ApiOperationSignal {
  const extractor = new NetworkSignalExtractor();
  const signals = extractor.extract(
    makeInteraction('int-suffix', [makeRow(body)]),
  ) as ApiOperationSignal[];
  const op = signals.find((s) => s.operation === 'add-to-cart');
  if (!op) throw new Error('add-to-cart signal not produced');
  return op;
}

/** Build a SignalSet with exactly one api-operation signal. */
function makeSignalSet(apiOp: ApiOperationSignal): SignalSet {
  return {
    interactionId: apiOp.interactionId,
    viewChanges: [],
    apiOperations: [apiOp],
    notifications: [],
    counterChanges: [],
    listChanges: [],
    inputChanges: [],
    pageContent: null,
  } as SignalSet;
}

// ── AC1–AC3: suffix forms now match ───────────────────────────────────

describe('Entity-hint suffix patterns: ASIN.1 / quantity.1', () => {
  it('AC1: indexed keys yield product-id and quantity hints', () => {
    const op = extractOp({ 'ASIN.1': 'B0FFF9VPMN', 'quantity.1': '2' });

    expect(op.entityHints).toBeDefined();
    const asin = op.entityHints!.find((h) => h.hint === 'product-id');
    expect(asin).toBeDefined();
    expect(asin!.value).toBe('B0FFF9VPMN');
    expect(asin!.field).toBe('ASIN.1');

    const qty = op.entityHints!.find((h) => h.hint === 'quantity');
    expect(qty).toBeDefined();
    expect(qty!.value).toBe('2');
    expect(qty!.field).toBe('quantity.1');
  });

  it('AC2: case-insensitive asin.1 / QUANTITY.1 / QTY.1', () => {
    const op = extractOp({ 'asin.1': 'B0TESTASIN1', 'QUANTITY.1': '3' });
    expect(op.entityHints!.find((h) => h.hint === 'product-id')!.value).toBe('B0TESTASIN1');
    expect(op.entityHints!.find((h) => h.hint === 'quantity')!.value).toBe('3');

    const opQty = extractOp({ 'QTY.1': '4' });
    expect(opQty.entityHints!.find((h) => h.hint === 'quantity')!.value).toBe('4');
  });

  it('AC3: two-digit indices (ASIN.10, quantity.10) match', () => {
    const op = extractOp({ 'ASIN.10': 'B0TESTASIN10', 'quantity.10': '5' });
    expect(op.entityHints!.find((h) => h.hint === 'product-id')!.value).toBe('B0TESTASIN10');
    expect(op.entityHints!.find((h) => h.hint === 'quantity')!.value).toBe('5');
  });
});

// ── AC4: regression — the verified int-14 shape is unchanged ──────────

describe('Entity-hint regression: plain keys (int-14 baseline)', () => {
  it('AC4: plain { ASIN, quantity } yields identical hints to baseline', () => {
    const op = extractOp({ ASIN: 'B0FFF9VPMN', quantity: '2' });
    expect(op.entityHints).toBeDefined();
    expect(op.entityHints!.length).toBe(2);
    const asin = op.entityHints!.find((h) => h.hint === 'product-id');
    expect(asin!.field).toBe('ASIN');
    expect(asin!.value).toBe('B0FFF9VPMN');
    const qty = op.entityHints!.find((h) => h.hint === 'quantity');
    expect(qty!.field).toBe('quantity');
    expect(qty!.value).toBe('2');
  });

  it('AC4b: same body as int-14 end-to-end via StateBuilder → cart-item:B0FFF9VPMN', () => {
    const op = extractOp({ ASIN: 'B0FFF9VPMN', quantity: '1' });
    const builder = new StateBuilder();
    const transition = builder.processSignals(makeSignalSet(op));
    const entities = Array.from(transition.after.entities.values());
    const cartItem = entities.find((e) => e.type === 'cart-item');
    expect(cartItem).toBeDefined();
    expect(cartItem!.id).toBe('cart-item:B0FFF9VPMN');
    expect(cartItem!.attributes.productId).toBe('B0FFF9VPMN');
    expect(cartItem!.attributes.quantity).toBe('1');
  });
});

// ── AC5–AC7: multi-item, end-to-end suffix, non-matching shapes ───────

describe('Entity-hint suffix patterns: advanced shapes', () => {
  it('AC5: multi-item body yields both hint pairs; consumer takes item 1', () => {
    const op = extractOp({
      'ASIN.1': 'B0ITEMONE',
      'ASIN.2': 'B0ITEMTWO',
      'quantity.1': '1',
      'quantity.2': '3',
    });
    const productHints = op.entityHints!.filter((h) => h.hint === 'product-id');
    const qtyHints = op.entityHints!.filter((h) => h.hint === 'quantity');
    expect(productHints.length).toBe(2);
    expect(qtyHints.length).toBe(2);

    // Untouched consumer semantics: first-match-wins (documents, not changes).
    const builder = new StateBuilder();
    const transition = builder.processSignals(makeSignalSet(op));
    const entities = Array.from(transition.after.entities.values());
    const cartItem = entities.find((e) => e.type === 'cart-item');
    expect(cartItem).toBeDefined();
    expect(cartItem!.id).toBe('cart-item:B0ITEMONE');
    expect(cartItem!.attributes.quantity).toBe('1');
  });

  it('AC6: ASIN.1 body end-to-end → cart-item:<ASIN> with productId + quantity', () => {
    const op = extractOp({ 'ASIN.1': 'B0SUFFIXEND', 'quantity.1': '2' });
    const builder = new StateBuilder();
    const transition = builder.processSignals(makeSignalSet(op));
    const entities = Array.from(transition.after.entities.values());
    const cartItem = entities.find((e) => e.type === 'cart-item');
    expect(cartItem).toBeDefined();
    expect(cartItem!.id).toBe('cart-item:B0SUFFIXEND');
    expect(cartItem!.attributes.productId).toBe('B0SUFFIXEND');
    expect(cartItem!.attributes.quantity).toBe('2');
  });

  it('AC7: non-matching key shapes still produce no hints', () => {
    const op = extractOp({
      'asin[0]': 'B0NOPE1',
      'items[0].asin': 'B0NOPE2',
      asin_1: 'B0NOPE3',
      asin1: 'B0NOPE4',
      quantities: '7',
      sessionToken: 'abc',
    });
    expect(op.entityHints).toBeUndefined();
  });
});
