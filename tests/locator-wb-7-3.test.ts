/**
 * Phase 7.3 W-B — L4 pins: locator candidates + elementKey chain.
 *
 * Spec .drytis/specs/phase-7-3-wb-auto-id-generic.md AC4 (baseline 98aa71b):
 *   - autoId → BUSINESS TEST_ID candidate `[auto-id="X"]`, family-tagged,
 *     ordered AFTER testId/dataCy/dataQa/dataAutoId;
 *   - pre-7.3 identities (no autoId) produce byte-identical candidate lists;
 *   - elementKey chain: testId → dataCy → dataQa → stableId → dataAutoId →
 *     autoId → name|sel → sel → tag (dataAutoId omission FIXED, aligned
 *     with harvest AC8 — stableId stays ahead per 6B's byte-identity rule).
 */

import { describe, it, expect } from 'vitest';
import {
  extractCandidatesFromIdentity,
  LocatorCategory,
} from '../src/domain/locator-ranking';
import { LocatorStrategyType } from '../src/domain/enums';
import { elementKey } from '../src/definitions/patterns';
import type { ElementIdentity } from '../src/shared/types';

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '//div',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: 'elem-0001',
    ...overrides,
  };
}

describe('7.3 W-B AC4 — autoId locator candidate', () => {
  it('emits family-tagged [auto-id="X"] BUSINESS candidate', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({ autoId: 'select_flight_card' }),
    );
    const hit = candidates.find((c) => c.value === '[auto-id="select_flight_card"]');
    expect(hit).toBeDefined();
    expect(hit!.type).toBe(LocatorStrategyType.TEST_ID);
    expect(hit!.category).toBe(LocatorCategory.BUSINESS);
  });

  it('orders the BUSINESS chain testId → dataCy → dataQa → dataAutoId → autoId', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({
        testId: 'tid',
        dataCy: 'cy',
        dataQa: 'qa',
        dataAutoId: 'prefixed',
        autoId: 'bare',
      }),
    );
    const business = candidates.filter((c) => c.category === LocatorCategory.BUSINESS);
    expect(business.map((c) => c.value)).toEqual([
      'tid',
      '[data-cy="cy"]',
      '[data-qa="qa"]',
      '[data-auto-id="prefixed"]',
      '[auto-id="bare"]',
    ]);
  });

  it('autoId-only identity emits exactly one BUSINESS candidate (no other id)', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({ autoId: 'only' }),
    );
    const business = candidates.filter((c) => c.category === LocatorCategory.BUSINESS);
    expect(business.map((c) => c.value)).toEqual(['[auto-id="only"]']);
  });

  it('pre-7.3 identity (no autoId) is byte-identical: no [auto-id=…] candidate', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({ dataAutoId: 'prefixed' }),
    );
    expect(
      candidates.some((c) => c.value.startsWith('[auto-id=')),
    ).toBe(false);
  });
});

describe('7.3 W-B AC4 — elementKey chain (incl. dataAutoId fix)', () => {
  it('autoId used when no higher business id exists', () => {
    expect(elementKey(makeIdentity({ autoId: 'card-1' }))).toBe('autoId:card-1');
  });

  it('dataAutoId now present and precedes autoId (omission fix, harvest AC8 order)', () => {
    expect(elementKey(makeIdentity({ dataAutoId: 'p', autoId: 'b' }))).toBe(
      'dataAutoId:p',
    );
  });

  it('testId/dataCy/dataQa still outrank both auto-id spellings', () => {
    expect(
      elementKey(makeIdentity({ testId: 't', dataAutoId: 'p', autoId: 'b' })),
    ).toBe('testId:t');
    expect(
      elementKey(makeIdentity({ dataCy: 'c', dataAutoId: 'p', autoId: 'b' })),
    ).toBe('dataCy:c');
    expect(
      elementKey(makeIdentity({ dataQa: 'q', dataAutoId: 'p', autoId: 'b' })),
    ).toBe('dataQa:q');
  });

  it('stableId outranks both auto-id spellings (6B byte-identity rule)', () => {
    expect(
      elementKey(makeIdentity({ stableId: 'dom-id', dataAutoId: 'p', autoId: 'b' })),
    ).toBe('id:dom-id');
  });

  it('keys without any business id keep legacy shape', () => {
    expect(elementKey(makeIdentity({ stableId: 'x' }))).toBe('id:x');
    expect(
      elementKey(
        makeIdentity({ accessibleName: 'Username', cssSelector: 'input.u' }),
      ),
    ).toBe('name:Username|sel:input.u');
  });
});
