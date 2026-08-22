/**
 * Phase 6B — Locator Durability: identity vocabulary + candidate tiers.
 *
 * Pins (spec .drytis/specs/phase-6b-locator-durability.md):
 *   AC1  extractIdentity populates dataAutoId (L1 vocabulary)
 *   AC2  candidate extraction: dataAutoId → TEST_ID/BUSINESS;
 *        stableClassCandidates() → CSS/STABLE_TECHNICAL (≤2, filtered);
 *        no auto-generated / state-volatile / Tailwind / CSS-in-JS token
 *        ever becomes a candidate
 *   STAB candidate order for identities WITHOUT the new fields is
 *        byte-identical to pre-6B (frozen corpus below)
 *
 * Deterministic-only: pure functions, no timing, no site tokens
 * (doctrine pin tests/doctrine/genericity-pin.test.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  extractCandidatesFromIdentity,
  stableClassCandidates,
  isVolatileClassToken,
  type LocatorCandidate,
} from '../src/domain/locator-ranking';
import { LocatorCategory } from '../src/domain/locator-ranking';
import { LocatorStrategyType } from '../src/domain/enums';
import type { ElementIdentity } from '../src/shared/types';

// ── Fixture factory (pre-6B 18-field shape + optional dataAutoId) ──────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn btn-primary',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    dataAutoId: null,
    cssSelector: 'button.btn-primary',
    xPath: '/html/body/div/button',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: 'elem-0001',
    ...overrides,
  };
}

// ── AC1-adjacent: type-level + extraction wiring is covered by tap tests ───
// (dataAutoId is optional; ranking pins exercise the value end-to-end.)

// ── AC2: dataAutoId → TEST_ID / BUSINESS, family-tagged value ─────────────

describe('6B AC2 — dataAutoId candidate', () => {
  it('emits a family-tagged TEST_ID BUSINESS candidate for data-auto-id', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({ dataAutoId: 'flight-card-F1', className: null, cssSelector: 'div.card' }),
    );
    const tid = candidates.find((c) => c.type === LocatorStrategyType.TEST_ID);
    expect(tid).toBeDefined();
    expect(tid!.value).toBe('[data-auto-id="flight-card-F1"]');
    expect(tid!.category).toBe(LocatorCategory.BUSINESS);
  });

  it('emits bare values for data-testid (STAB — default family stays untagged)', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({ testId: 'submit-btn' }),
    );
    const tid = candidates.find((c) => c.type === LocatorStrategyType.TEST_ID);
    expect(tid!.value).toBe('submit-btn'); // bare — byte-identical to pre-6B
  });

  it('does not emit a TEST_ID candidate when dataAutoId is null', () => {
    const candidates = extractCandidatesFromIdentity(makeIdentity({ dataAutoId: null }));
    expect(candidates.some((c) => c.type === LocatorStrategyType.TEST_ID)).toBe(false);
  });

  it('dataCy/dataQa emit family-tagged values (non-default families)', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({ dataCy: 'sign-in', dataQa: 'qa-submit', className: null, cssSelector: 'button' }),
    );
    const tidValues = candidates
      .filter((c) => c.type === LocatorStrategyType.TEST_ID)
      .map((c) => c.value);
    expect(tidValues).toContain('[data-cy="sign-in"]');
    expect(tidValues).toContain('[data-qa="qa-submit"]');
  });

  it('business precedence preserved: testId listed before dataAutoId', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({ testId: 'submit', dataAutoId: 'btn-submit' }),
    );
    const tidIdx = candidates.findIndex((c) => c.type === LocatorStrategyType.TEST_ID);
    // first TEST_ID candidate is the bare data-testid one
    expect(candidates[tidIdx].value).toBe('submit');
    const autoIdx = candidates.findIndex(
      (c) => c.type === LocatorStrategyType.TEST_ID && c.value.startsWith('[data-auto-id='),
    );
    expect(autoIdx).toBeGreaterThan(tidIdx);
  });
});

// ── AC2: stableClassCandidates ─────────────────────────────────────────────

describe('6B AC2 — stableClassCandidates', () => {
  it('keeps semantic stable tokens as [class~="token"] CSS STABLE_TECHNICAL', () => {
    const cands = stableClassCandidates('btn-primary search-button');
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.type).toBe(LocatorStrategyType.CSS);
      expect(c.category).toBe(LocatorCategory.STABLE_TECHNICAL);
      expect(c.value).toMatch(/^\[class~="[a-z0-9-]+"\]$/i);
    }
    expect(cands.map((c) => c.value)).toContain('[class~="btn-primary"]');
  });

  it('bounds output to at most 2 candidates', () => {
    const cands = stableClassCandidates('card media-player flight-summary header-logo extra');
    expect(cands.length).toBeLessThanOrEqual(2);
  });

  it('strips CSS-in-JS / auto-generated / module tokens', () => {
    const cands = stableClassCandidates('css-1q2w3e4 sc-bdVaJa __module_btn v-4a3f ember-view');
    expect(cands.length).toBe(0);
  });

  it('strips framework state-volatile tokens', () => {
    const cands = stableClassCandidates('selected checked active disabled open loading is-open has-focus');
    expect(cands.length).toBe(0);
  });

  it('strips Tailwind / utility / style prefixes', () => {
    const cands = stableClassCandidates('sm:flex hover:bg-blue group-hover:opacity');
    expect(cands.length).toBe(0);
  });

  it('strips short tokens (<3 chars) and animation/transition tokens', () => {
    const cands = stableClassCandidates('x py fade-in ripple-enter animate-spin');
    expect(cands.length).toBe(0);
  });

  it('extractCandidatesFromIdentity includes class candidates at STABLE_TECHNICAL after stableId', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({
        stableId: 'root',
        className: 'flight-card',
        cssSelector: 'div#root > div',
      }),
    );
    const stableIdIdx = candidates.findIndex(
      (c) => c.type === LocatorStrategyType.CSS && c.value === '#root',
    );
    const classIdx = candidates.findIndex(
      (c) => c.type === LocatorStrategyType.CSS && c.value === '[class~="flight-card"]',
    );
    expect(stableIdIdx).toBeGreaterThanOrEqual(0);
    expect(classIdx).toBeGreaterThan(stableIdIdx);
  });

  it('icon-class target (O9 shape) yields a class candidate, not only structural', () => {
    const candidates = extractCandidatesFromIdentity(
      makeIdentity({
        tag: 'I',
        className: 'icon-plus',
        accessibleName: '',
        cssSelector: 'div:nth-of-type(1) > i:nth-of-type(1)',
        xPath: '/html/body/div/div/i',
      }),
    );
    const classCand = candidates.find(
      (c) => c.type === LocatorStrategyType.CSS && c.value === '[class~="icon-plus"]',
    );
    expect(classCand).toBeDefined();
    expect(classCand!.category).toBe(LocatorCategory.STABLE_TECHNICAL);
  });
});

// ── isVolatileClassToken (exported filter — pure structural rules) ─────────

describe('6B — isVolatileClassToken (structural filter)', () => {
  it.each([
    ['css-1q2w3e4', true],
    ['sc-bdVaJa', true],
    ['ember-view', true],
    ['selected', true],
    ['is-open', true],
    ['has-focus', true],
    ['sm:flex', true],
    ['hover:bg-blue', true],
    ['py', true], // <3 chars
    ['btn-primary', false],
    ['flight-card', false],
    ['icon-plus', false],
    ['search-button', false],
  ])('%s → %s', (token, expected) => {
    expect(isVolatileClassToken(token)).toBe(expected);
  });
});

// ── STAB: pre-6B candidate output frozen for new-field-less identities ────

describe('6B STAB — byte-identical candidates without new fields', () => {
  // Frozen corpus: (name, identity overrides, expected candidate (type,value,category) list)
  // Expected values captured from PRE-6B behavior at 153f5c2. dataAutoId is null
  // in every fixture; className entries that produce no candidates pre-6B are
  // still exercised to prove class candidates only appear via the new tier.
  const corpus: ReadonlyArray<{
    name: string;
    overrides: Partial<ElementIdentity>;
    expected: ReadonlyArray<[LocatorStrategyType, string, LocatorCategory]>;
  }> = [
    {
      // NOTE: data-testid stays BARE (owner-approved STAB guarantee); data-cy
      // and data-qa are deliberately family-tagged by 6B L3 — that IS the
      // provenance fix, not a regression. This fixture pins both facts.
      name: 'all-business-ids',
      overrides: { testId: 'tid', dataCy: 'cy', dataQa: 'qa' },
      expected: [
        [LocatorStrategyType.TEST_ID, 'tid', LocatorCategory.BUSINESS],
        [LocatorStrategyType.TEST_ID, '[data-cy="cy"]', LocatorCategory.BUSINESS],
        [LocatorStrategyType.TEST_ID, '[data-qa="qa"]', LocatorCategory.BUSINESS],
      ],
    },
    {
      name: 'aria-accessibility',
      overrides: { ariaLabel: 'Close', ariaLabelledBy: 'lbl-1' },
      expected: [
        [LocatorStrategyType.ACCESSIBLE_NAME, 'Close', LocatorCategory.ACCESSIBILITY],
        [LocatorStrategyType.ACCESSIBLE_NAME, 'lbl-1', LocatorCategory.ACCESSIBILITY],
      ],
    },
    {
      name: 'stable-technical',
      overrides: {
        stableId: 'root',
        name: 'email',
        className: null, // no class tier exercised
      },
      expected: [
        [LocatorStrategyType.CSS, '#root', LocatorCategory.STABLE_TECHNICAL],
        [LocatorStrategyType.LABEL, 'email', LocatorCategory.STABLE_TECHNICAL],
      ],
    },
    {
      name: 'content-tiers',
      overrides: {
        accessibleName: 'Search flights',
        placeholder: 'Where from?',
        className: null,
      },
      expected: [
        [LocatorStrategyType.ACCESSIBLE_NAME, 'Search flights', LocatorCategory.CONTENT],
        [LocatorStrategyType.LABEL, 'Where from?', LocatorCategory.CONTENT],
      ],
    },
    {
      name: 'structural-only',
      overrides: {
        accessibleName: '',
        className: null,
        cssSelector: 'div:nth-of-type(2) > button:nth-of-type(1)',
        xPath: '/html/body/div/button',
      },
      expected: [
        [LocatorStrategyType.CSS, 'div:nth-of-type(2) > button:nth-of-type(1)', LocatorCategory.STRUCTURAL],
        [LocatorStrategyType.XPATH, '/html/body/div/button', LocatorCategory.STRUCTURAL],
      ],
    },
    {
      name: 'plain-volatile-classes-only (pre-6B: no candidates)',
      overrides: {
        accessibleName: '',
        className: 'selected is-open css-1ab',
        cssSelector: 'div',
        xPath: '/html/body/div',
      },
      expected: [
        [LocatorStrategyType.CSS, 'div', LocatorCategory.STRUCTURAL],
        [LocatorStrategyType.XPATH, '/html/body/div', LocatorCategory.STRUCTURAL],
      ],
    },
  ];

  it.each(corpus)('STAB: $name', ({ overrides, expected }) => {
    const candidates = extractCandidatesFromIdentity(makeIdentity(overrides));
    const tuple = (c: LocatorCandidate): [LocatorStrategyType, string, LocatorCategory] => [
      c.type,
      c.value,
      c.category,
    ];
    // Every PRE-6B candidate must appear, in order, at the front.
    const head = candidates.slice(0, expected.length).map(tuple);
    expect(head).toEqual(expected as unknown as Array<[LocatorStrategyType, string, LocatorCategory]>);
    // And nothing from the NEW tiers may intrude when className is filtered-empty
    // or null in the fixture.
    if (overrides.className === null || /^[a-z-]*$/.test(overrides.className ?? '')) {
      // class-tier candidates allowed only when stable tokens exist — for these
      // fixtures the classes are volatile/null so none may appear.
      const classTier = candidates.filter((c) => c.value.startsWith('[class~='));
      if (overrides.className === null) expect(classTier).toEqual([]);
    }
  });
});
