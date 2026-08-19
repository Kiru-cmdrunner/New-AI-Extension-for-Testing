/**
 * Phase 5a — API Test Seed Derivation (pure function tests)
 *
 * Pins the attribution ladder (event-stamped vs window-inferred), the
 * post-condition mapping and its 4c-mirroring priority, the bounds
 * (≤20 seeds/session, ≤4 conditions/seed), deterministic ordering,
 * degenerate cases (navigation rows, duplicate requestIds, caps),
 * recurring-endpoint detection, and INV-5a-7 (bodyKeys are keys only,
 * values never emitted, sensitive keys denied).
 *
 * Architecture: .drytis/specs/resulting-application-state-plan.md Phase 5a
 */
import { describe, expect, it } from 'vitest';

import {
  derivePostConditions,
  deriveSessionSeeds,
  generalizeRequestPath,
  isSensitiveBodyKey,
  MAX_SEEDS_PER_SESSION,
  type SeedEvidenceRow,
  type SeedNetworkRow,
} from '../../../src/understanding/contract/api-seed-derivation';
import { MAX_POST_CONDITIONS_PER_SEED } from '../../../src/understanding/contract/contract-types';

// ── Fixtures ───────────────────────────────────────────────────────────

function net(overrides: Partial<SeedNetworkRow> = {}): SeedNetworkRow {
  return {
    url: 'https://shop.example/cart/add',
    method: 'POST',
    status: 200,
    resourceType: 'xhr',
    source: 'webrequest',
    sourceEventId: 'evt-1',
    requestId: 'req-1',
    ...overrides,
  };
}

function snapshot(items: Array<Partial<SeedEvidenceRow['resultingState'] extends undefined ? never : NonNullable<SeedEvidenceRow['resultingState']>['items'][number]>>): SeedEvidenceRow['resultingState'] {
  return {
    items: items.map((i) => ({
      kind: 'counter',
      matchedSelector: 'div[data-role="counter"]',
      text: '1',
      numericValue: 1,
      entityId: null,
      domPath: 'DIV#cart-count',
      ...i,
    })),
  };
}

function row(overrides: Partial<SeedEvidenceRow> = {}): SeedEvidenceRow {
  return {
    windowId: 'bev-evt-1',
    interactionId: 'int-1',
    recordingSessionId: 'session-1',
    sourceEventId: 'evt-1',
    interactionEventIds: ['evt-1'],
    networkActivity: [net()],
    resultingState: snapshot([{ kind: 'counter', numericValue: 1, domPath: 'DIV#cart-count' }]),
    ...overrides,
  };
}

function derive(rows: SeedEvidenceRow[], extra: Parameters<typeof deriveSessionSeeds>[0] extends never ? never : Partial<Parameters<typeof deriveSessionSeeds>[0]> = {}) {
  return deriveSessionSeeds({
    appId: 'app-5a',
    sessionId: 'session-1',
    evidenceRows: rows,
    knowledgeByInteraction: new Map(),
    apiConfidence: new Map(),
    ...extra,
  });
}

// ── INV-5a-7 — sensitive key denylist ──────────────────────────────────

describe('INV-5a-7 — bodyKeys are keys only, sensitive keys denied', () => {
  it.each([
    'password', 'userPassword', 'password_confirmation', 'PASSWD',
    'secret', 'client_secret', 'apiToken', 'access-token', 'X-API-KEY',
    'Authorization', 'credential', 'sessionKey', 'cookie',
    'csrf_token', 'XSRF-Token', 'ssn', 'socialSecurityNumber',
    'cardNumber', 'creditCard', 'cvc', 'cvv2', 'pinCode', 'otp', 'totp',
    'privateKey', 'private_key', 'billingCardNumber',
  ])('flags "%s" as sensitive', (key) => {
    expect(isSensitiveBodyKey(key)).toBe(true);
  });

  it.each([
    'ASIN', 'quantity', 'productId', 'email', 'firstName',
    'address', 'zip', 'userComment', 'option',
    // Deliberate non-match: bare 'auth' would false-positive on common
    // form keys like 'author' / 'authorName'.
    'author', 'authorName',
  ])('passes non-sensitive "%s" through', (key) => {
    expect(isSensitiveBodyKey(key)).toBe(false);
  });

  it('emits KEYS ONLY — no formData value ever appears in the seed', () => {
    const result = derive([
      row({
        networkActivity: [net({
          requestBody: {
            ASIN: 'B08KGRVW2S',
            quantity: '2',
            password: 'hunter2-SUPER-SECRET',
            sessionToken: 'tok_abc123',
            promo: 'SAVE20',
          },
        })],
      }),
    ]);
    expect(result.seeds).toHaveLength(1);
    expect(result.seeds[0].request.bodyKeys).toEqual(['ASIN', 'promo', 'quantity']);
    // The literal secret values must not appear anywhere in the seed.
    const serialized = JSON.stringify(result.seeds[0]);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('tok_abc123');
    expect(serialized).not.toContain('B08KGRVW2S');
    expect(serialized).not.toContain('SAVE20');
  });

  it('returns [] for rows without a body', () => {
    const result = derive([row({ networkActivity: [net({ requestBody: undefined })] })]);
    expect(result.seeds[0].request.bodyKeys).toEqual([]);
  });
});

// ── Attribution ladder ─────────────────────────────────────────────────

describe('attribution ladder (INV-5a-3)', () => {
  it('webRequest row stamped with an interaction event → event-stamped', () => {
    const result = derive([row()]);
    expect(result.seeds).toHaveLength(1);
    expect(result.seeds[0].attribution).toBe('event-stamped');
    expect(result.seeds[0].expectedPostConditions).toEqual([
      { kind: 'counter', identity: 'DIV#cart-count', value: 1, operator: 'equals' },
    ]);
  });

  it('webRequest row whose stamp is NOT an interaction event → window-inferred', () => {
    const result = derive([row({
      networkActivity: [net({ sourceEventId: 'evt-other' })],
    })]);
    expect(result.seeds[0].attribution).toBe('window-inferred');
    // Observed-alongside, never expected-of.
    expect(result.seeds[0].expectedPostConditions).toEqual([]);
    expect(result.seeds[0].honesty.uiBasis).toBe('content-observed');
  });

  it('main-world row (never stamped) with a requestId → window-inferred', () => {
    const result = derive([row({
      networkActivity: [net({ source: 'main-world', sourceEventId: undefined })],
    })]);
    expect(result.seeds[0].attribution).toBe('window-inferred');
    expect(result.seeds[0].expectedPostConditions).toEqual([]);
  });

  it('main-world row with NO requestId → excluded with no-request-id', () => {
    const result = derive([row({
      networkActivity: [net({ source: 'main-world', requestId: undefined, sourceEventId: undefined })],
    })]);
    expect(result.seeds).toHaveLength(0);
    expect(result.excluded).toEqual([
      { interactionId: 'int-1', requestId: null, reason: 'no-request-id' },
    ]);
  });

  it('causal conditions require the stamp even with state present (window-inferred keeps [])', () => {
    const conditions = derivePostConditions(row(), /* causal */ false);
    expect(conditions).toEqual([]);
  });
});

// ── Post-condition mapping ─────────────────────────────────────────────

describe('post-condition mapping', () => {
  it('maps counter / collection / entity / badge / notification kinds', () => {
    const conditions = derivePostConditions(row({
      resultingState: snapshot([
        { kind: 'counter', numericValue: 4, domPath: 'DIV#cart-count' },
        { kind: 'collection', numericValue: 4, domPath: 'UL#cart-items' },
        { kind: 'entity', entityId: 'cart-item:B0VAL1', domPath: 'LI[data-asin="B0VAL1"]' },
        { kind: 'status-badge', text: 'In Stock', domPath: 'SPAN#availability' },
        { kind: 'notification', text: 'Item added', domPath: 'DIV[role="status"]' },
      ]),
    }), true);
    expect(conditions).toEqual([
      { kind: 'counter', identity: 'DIV#cart-count', value: 4, operator: 'equals' },
      { kind: 'collection', identity: 'UL#cart-items', count: 4 },
      { kind: 'ui-badge', identity: 'SPAN#availability', text: 'In Stock' },
      { kind: 'ui-notification', identity: 'DIV[role="status"]' },
    ]);
  });

  it('caps at MAX_POST_CONDITIONS_PER_SEED with 4c priority order', () => {
    const conditions = derivePostConditions(row({
      resultingState: snapshot([
        { kind: 'notification', domPath: 'DIV#n1' },
        { kind: 'collection', numericValue: 2, domPath: 'UL#c1' },
        { kind: 'counter', numericValue: 3, domPath: 'DIV#k1' },
        { kind: 'counter', numericValue: 4, domPath: 'DIV#k2' },
        { kind: 'counter', numericValue: 5, domPath: 'DIV#k3' },
        { kind: 'ui-badge' as never, text: 'In Stock', domPath: 'SPAN#b1' },
      ]),
    }), true);
    expect(conditions).toHaveLength(MAX_POST_CONDITIONS_PER_SEED);
    // Priority: counter first (all three), then collection.
    expect(conditions.map((c) => c.kind)).toEqual([
      'counter', 'counter', 'counter', 'collection',
    ]);
  });

  it('entity-title items never become conditions', () => {
    const conditions = derivePostConditions(row({
      resultingState: snapshot([{ kind: 'entity-title', text: 'Widget', domPath: 'H2' }]),
    }), true);
    expect(conditions).toEqual([]);
  });

  it('entity conditions carry identity only — never attribute values', () => {
    const conditions = derivePostConditions(row({
      resultingState: snapshot([{ kind: 'entity', entityId: 'cart-item:B0VAL1' }]),
    }), true);
    expect(conditions).toEqual([{ kind: 'entity-present', identity: 'cart-item:B0VAL1' }]);
    expect(JSON.stringify(conditions)).not.toContain('attributes');
  });

  it('numeric-only badge text is skipped (non-distinctive)', () => {
    const conditions = derivePostConditions(row({
      resultingState: snapshot([{ kind: 'status-badge', text: '42', domPath: 'SPAN#b' }]),
    }), true);
    expect(conditions).toEqual([]);
  });

  it('counter/collection without a finite numericValue are skipped', () => {
    const conditions = derivePostConditions(row({
      resultingState: snapshot([
        { kind: 'counter', numericValue: null, domPath: 'DIV#k' },
        { kind: 'collection', numericValue: Number.NaN, domPath: 'UL#c' },
      ]),
    }), true);
    expect(conditions).toEqual([]);
  });

  it('no resultingState → uiBasis none, empty conditions', () => {
    const result = derive([row({ resultingState: undefined, networkActivity: [net()] })]);
    expect(result.seeds[0].honesty.uiBasis).toBe('none');
    expect(result.seeds[0].expectedPostConditions).toEqual([]);
  });
});

// ── Degenerate cases ───────────────────────────────────────────────────

describe('degenerate cases', () => {
  it('navigation-resourceType rows are excluded (INV-CS1 separation)', () => {
    const result = derive([row({
      networkActivity: [net({ resourceType: 'navigation', requestId: 'req-nav', url: 'https://shop.example/cart.html' })],
    })]);
    expect(result.seeds).toHaveLength(0);
    expect(result.excluded[0].reason).toBe('navigation-resource');
  });

  it('failed request (status 500) keeps the seed with recorded status', () => {
    const result = derive([row({ networkActivity: [net({ status: 500 })] })]);
    expect(result.seeds).toHaveLength(1);
    expect(result.seeds[0].request.status).toBe(500);
    expect(result.seeds[0].expectedPostConditions).toEqual([
      { kind: 'counter', identity: 'DIV#cart-count', value: 1, operator: 'equals' },
    ]);
  });

  it('null status is carried verbatim', () => {
    const result = derive([row({ networkActivity: [net({ status: null })] })]);
    expect(result.seeds[0].request.status).toBeNull();
  });

  it('multiple stamped requests in one window → shared:true, one seed each', () => {
    const result = derive([row({
      networkActivity: [
        net({ requestId: 'req-a', sourceEventId: 'evt-1' }),
        net({ requestId: 'req-b', sourceEventId: 'evt-1', url: 'https://shop.example/recommend', method: 'GET' }),
      ],
    })]);
    expect(result.seeds).toHaveLength(2);
    expect(result.seeds.every((s) => s.shared)).toBe(true);
    expect(new Set(result.seeds.map((s) => s.seedId)).size).toBe(2);
  });

  it('shared:false when exactly one stamped request', () => {
    const result = derive([row()]);
    expect(result.seeds[0].shared).toBe(false);
  });

  it('duplicate requestId across rows → exactly one seed (exactly-once)', () => {
    const result = derive([
      row({ interactionId: 'int-1' }),
      row({
        interactionId: 'int-2',
        windowId: 'bev-evt-2',
        sourceEventId: 'evt-2',
        interactionEventIds: ['evt-2'],
        networkActivity: [net({ sourceEventId: 'evt-2' })],
      }),
    ]);
    expect(result.seeds).toHaveLength(1);
    expect(result.excluded.some((e) => e.reason === 'duplicate-request-id')).toBe(true);
    expect(result.seeds[0].interactionId).toBe('int-1');
  });

  it('polling: identical method+path recurrences → recurring:true on every instance', () => {
    const result = derive([
      row({ interactionId: 'int-1' }),
      row({
        interactionId: 'int-2',
        windowId: 'bev-evt-2',
        sourceEventId: 'evt-2',
        interactionEventIds: ['evt-2'],
        networkActivity: [net({ sourceEventId: 'evt-2', requestId: 'req-2' })],
      }),
    ]);
    expect(result.seeds).toHaveLength(2);
    expect(result.seeds.every((s) => s.recurring)).toBe(true);
    expect(result.recurringIdentities.has('POST /cart/add')).toBe(true);
  });

  it('caps at MAX_SEEDS_PER_SESSION and reports the overflow', () => {
    const rows: SeedEvidenceRow[] = [];
    for (let i = 0; i < MAX_SEEDS_PER_SESSION + 5; i++) {
      rows.push(row({
        interactionId: `int-${i}`,
        windowId: `bev-evt-${i}`,
        sourceEventId: `evt-${i}`,
        interactionEventIds: [`evt-${i}`],
        networkActivity: [net({
          requestId: `req-${i}`,
          sourceEventId: `evt-${i}`,
          url: `https://shop.example/item/${i}`,
        })],
      }));
    }
    const result = derive(rows);
    expect(result.seeds).toHaveLength(MAX_SEEDS_PER_SESSION);
    expect(result.excluded.filter((e) => e.reason === 'seed-cap')).toHaveLength(5);
  });
});

// ── Determinism / ordering / identities ────────────────────────────────

describe('determinism, ordering, identities', () => {
  it('sorts by interactionId → path → method', () => {
    const result = derive([
      row({ interactionId: 'int-2', networkActivity: [net({ url: 'https://shop.example/a', requestId: 'r-a' })] }),
      row({ interactionId: 'int-1', networkActivity: [net({ url: 'https://shop.example/z', requestId: 'r-z' })] }),
      row({ interactionId: 'int-1', networkActivity: [net({ url: 'https://shop.example/a', requestId: 'r-a2' })] }),
    ]);
    expect(result.seeds.map((s) => `${s.interactionId}:${s.request.path}:${s.request.method}`)).toEqual([
      'int-1:/a:POST',
      'int-1:/z:POST',
      'int-2:/a:POST',
    ]);
  });

  it('same inputs → byte-identical outputs (JSON stable)', () => {
    const rows = [row(), row({ interactionId: 'int-2', networkActivity: [net({ requestId: 'r-2' })] })];
    expect(JSON.stringify(derive(rows))).toBe(JSON.stringify(derive(rows)));
  });

  it('generalizes query-free pathnames (frozen grammar)', () => {
    expect(generalizeRequestPath('https://shop.example/cart/add?sku=1&qty=2')).toBe('/cart/add');
    expect(generalizeRequestPath('https://shop.example')).toBe('/');
    expect(generalizeRequestPath('not a url')).toBe('not a url');
  });

  it('seedId is `${sessionId}:${interactionId}:${requestId}`', () => {
    const result = derive([row()]);
    expect(result.seeds[0].seedId).toBe('session-1:int-1:req-1');
  });

  it('joins action context from knowledge when the signature exists', () => {
    const result = derive([row()], {
      knowledgeByInteraction: new Map([
        ['int-1', {
          signatureKey: 'sig-1', actionType: 'Click', normalizedTarget: 'Add to Cart',
          apiConsequenceConfidence: null,
        }],
      ]),
    });
    expect(result.seeds[0].action).toEqual({
      signatureKey: 'sig-1', actionType: 'Click', normalizedTarget: 'Add to Cart',
    });
  });

  it('confidence falls back to the session api-edge aggregate', () => {
    const result = derive([row()], {
      apiConfidence: new Map([['POST /cart/add', 0.9]]),
    });
    expect(result.seeds[0].confidence).toBe(0.9);
  });

  it('action:null when no knowledge row exists for the interaction', () => {
    const result = derive([row()]);
    expect(result.seeds[0].action).toBeNull();
    expect(result.seeds[0].confidence).toBe(0);
  });

  it('honesty fields are fixed literals (5b/5c remain gated)', () => {
    const result = derive([row()]);
    expect(result.seeds[0].honesty).toEqual({
      payloadSchema: 'unrecorded',
      responseBody: 'unverified',
      uiBasis: 'content-observed',
    });
  });

  it('empty session → no seeds, no exclusions', () => {
    const result = derive([]);
    expect(result.seeds).toEqual([]);
    expect(result.excluded).toEqual([]);
  });
});
