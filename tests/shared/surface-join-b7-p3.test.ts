/**
 * B7-P3 — surface-join: identity-form ↔ DOM-path-form surface matching.
 *
 * Real capture produces TWO different locator grammars for the same DOM:
 *   - SurfaceChange.path / DomChangeSummary.targetPath — DOM-path form:
 *     `body > div > div#mega-products`, segments `tag` or `tag#id` only.
 *   - ElementIdentity — cssSelector (`#mega-products`, or a ≤5-deep chain
 *     `div#mega-products > ul > li > a` with tag[:nth-of-type] segments),
 *     xPath (`//div[@id='mega-products']` or `//tag[n]/...`), stableId.
 *
 * The join bridges them WITHOUT vocabulary assumptions:
 *   - id-exact: a DOM id is a per-document unique fact — agreement is an
 *     exact surface match (not degraded).
 *   - chain-degraded: segment-chain containment with id agreement at any
 *     aligned position, or ≥2 aligned pure-tag segments; labeled degraded.
 *   - NEVER tag-only single-segment: `div` vs `div` proves nothing.
 *
 * Pure functions over recorded data only. No timing, no vocabulary.
 */

import { describe, expect, it } from 'vitest';
import {
  domIdOfIdentity,
  joinsRecordedSurface,
  normalizePath,
  pathSegments,
} from '../../src/shared/surface-join';

describe('B7-P3 surface-join: path parsing', () => {
  it('normalizePath strips whitespace and collapses separators', () => {
    expect(normalizePath(' body  >  div#mega ')).toBe('body > div#mega');
  });

  it('pathSegments splits DOM-path form', () => {
    expect(pathSegments('body > div > div#mega-products')).toEqual(['body', 'div', 'div#mega-products']);
  });

  it('pathSegments splits identity css-chain form (tag[:nth-of-type])', () => {
    expect(pathSegments('div#mega-products > ul > li:nth-of-type(2) > a')).toEqual([
      'div#mega-products', 'ul', 'li:nth-of-type(2)', 'a',
    ]);
  });

  it('domIdOfIdentity: stableId, then #id cssSelector, then [@id=] xPath, else null', () => {
    expect(domIdOfIdentity({ stableId: 'mega-products', cssSelector: '#x', xPath: '//y' })).toBe('mega-products');
    expect(domIdOfIdentity({ stableId: null, cssSelector: '#mega-products', xPath: '//x' })).toBe('mega-products');
    expect(domIdOfIdentity({ stableId: null, cssSelector: 'div', xPath: "//div[@id='mega-products']" })).toBe('mega-products');
    expect(domIdOfIdentity({ stableId: null, cssSelector: 'div', xPath: '//div' })).toBe(null);
  });

  it('domIdOfIdentity ignores css chains whose FIRST segment is not an id (chain start ≠ own id)', () => {
    // `div#mega-products > ul > li > a` — the element is the final `a`,
    // its OWN id is absent; the leading #mega belongs to an ANCESTOR.
    expect(domIdOfIdentity({ stableId: null, cssSelector: 'div#mega-products > ul > li > a', xPath: '//a' })).toBe(null);
  });

  it('domIdOfIdentity: css chain FIRST segment may still be the own id ONLY in the #id-only form', () => {
    expect(domIdOfIdentity({ stableId: null, cssSelector: '#mega-products', xPath: '//x' })).toBe('mega-products');
  });
});

describe('B7-P3 surface-join: joinsRecordedSurface', () => {
  const surface = (path: string, ariaRole: string | null = null) => ({ path, ariaRole });

  it('id-exact: consumer own-id === fact-path terminal id → join, NOT degraded', () => {
    const r = joinsRecordedSurface(surface('body > div > div#mega-products'), {
      stableId: 'mega-products', cssSelector: '#mega-products', xPath: "//div[@id='mega-products']", tag: 'DIV',
    });
    expect(r.joined).toBe(true);
    expect(r.degraded).toBe(false);
  });

  it('id-exact also works when the id appears MID-path (join to the revealing container, not just terminal)', () => {
    // aria-expanded flip fact on `... > div#mega-products`; the user then
    // clicks THAT container itself.
    const r = joinsRecordedSurface(surface('body > div > div#mega-products'), {
      stableId: 'mega-products', cssSelector: '#mega-products', xPath: "//div[@id='mega-products']", tag: 'DIV',
    });
    expect(r.joined).toBe(true);
  });

  it('chain-degraded: consumer chain CONTAINS the fact id mid-chain → join, degraded', () => {
    // Click target is the id-less `a` inside div#mega-products; its css
    // chain records the ancestor id — container lineage, honest at
    // degraded confidence.
    const r = joinsRecordedSurface(surface('body > div > div#mega-products'), {
      stableId: null, cssSelector: 'div#mega-products > ul > li > a', xPath: '//div[@id="mega-products"]/ul/li/a', tag: 'A',
    });
    expect(r.joined).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it('chain-degraded NEGATIVE: unrelated chain with a DIFFERENT mid-chain id never joins', () => {
    const r = joinsRecordedSurface(surface('body > div > div#mega-products'), {
      stableId: null, cssSelector: 'div#cart > ul > li > a', xPath: '//div[@id="cart"]/ul/li/a', tag: 'A',
    });
    expect(r.joined).toBe(false);
  });

  it('id mismatch NEVER joins even with tag agreement', () => {
    const r = joinsRecordedSurface(surface('body > div > div#cart'), {
      stableId: 'mega-products', cssSelector: '#mega-products', xPath: "//div[@id='mega-products']", tag: 'DIV',
    });
    expect(r.joined).toBe(false);
  });

  it('NO id anywhere: fact shorter than the 2-segment floor never joins', () => {
    // Fact `body > div > nav` IS a 3-segment fact — it WOULD join a
    // consumer whose chain contains div>nav contiguously. The 1-segment
    // floor case: fact `nav` alone.
    const r = joinsRecordedSurface(surface('nav'), {
      stableId: null, cssSelector: 'nav > ul', xPath: '/html/body/div/nav/ul', tag: 'UL',
    });
    // 1-segment fact — below the floor, no join (tag alone proves nothing).
    expect(r.joined).toBe(false);
  });

  it('NO id anywhere: pure tag agreement NEVER joins (tightened boundary)', () => {
    // Tightened rule 3: tag-chain containment additionally requires the
    // FACT to carry ≥1 DOM id. Pure-tag agreement — however long — is
    // same-shape coincidence across every subtree in the document.
    const ok = joinsRecordedSurface(surface('body > div > nav > ul'), {
      stableId: null, cssSelector: 'nav > ul', xPath: '/html/body/div/nav/ul', tag: 'UL',
    });
    expect(ok.joined).toBe(false);
  });

  it('id-bearing fact joins via xPath tag-chain containment (anchored, degraded)', () => {
    // Fact `body > div#nav` carries an id and its tag chain [body, div]
    // is a contiguous subchain of the consumer's root-anchored xPath
    // chain [html, body, div, nav, ul] → join, degraded.
    const r = joinsRecordedSurface(surface('body > div#nav'), {
      stableId: null, cssSelector: 'nav > ul', xPath: '/html/body/div/nav/ul', tag: 'UL',
    });
    expect(r.joined).toBe(true);
    expect(r.degraded).toBe(true);
  });

  it('non-matching tag chains never join (ambiguity boundary)', () => {
    const r = joinsRecordedSurface(surface('body > footer > section'), {
      stableId: null, cssSelector: 'nav > ul', xPath: '/html/body/div/nav/ul', tag: 'UL',
    });
    expect(r.joined).toBe(false);
  });

  it('empty/absent inputs never join (honest null)', () => {
    expect(joinsRecordedSurface(surface('body > div'), null).joined).toBe(false);
    expect(joinsRecordedSurface({ path: '', ariaRole: null }, { stableId: 'x', cssSelector: '#x', xPath: '//x', tag: 'A' }).joined).toBe(false);
  });
});
