/**
 * Hover-capture generic fix v1 — cursor INHERITANCE poisoning (RC-2/G3).
 *
 * Discovered in real Chrome (2026-08-29, hoverfix-megamenu-dump.json):
 * `cursor` is an inherited CSS property. Chrome's UA stylesheet sets
 * `cursor: pointer` on `a[href]`, so an icon glyph `<i>` inside a link
 * INHERITS pointer and looks "interactive-shaped". That poisoned
 * `measureSubtreeText` → `hasInteractiveShapedDescendant` → the anchor's
 * own text was rejected as a name (`#nav-products` → accessibleName ''
 * → card named "link").
 *
 * jsdom has no UA link-pointer rule, so these tests force the inherited
 * state with inline styles on BOTH parent and child.
 *
 * Rules under test (spec §5 G2a/G3 amendment — inherited-cursor rule):
 *   R1. pointerCursor counts as a shape fact ONLY when the cursor CHANGES
 *       at the element boundary (the parent's computed cursor is not
 *       already `pointer`). Pure CSS semantics — no vocabulary.
 *   R2. `aria-hidden="true"` subtrees contribute NEITHER name text NOR
 *       shape evidence (accname conformance: hidden content is not a name).
 */
import { describe, it, expect, beforeEach } from 'vitest';
// @vitest-environment jsdom
import { computeAccessibleName, domShapeOf, resolveHoverTarget } from '../../src/tap/identity-extractor';
import { isHoverDiscoveryShape } from '../../src/definitions/patterns';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('R1: pointerCursor is an own-boundary fact (inherited pointer is not a shape fact)', () => {
  it('glyph INSIDE a pointer-cursor anchor is NOT interactive-shaped (inherited)', () => {
    document.body.innerHTML = `
      <a href="#" id="nav" style="cursor:pointer">Products <i id="glyph" style="cursor:pointer">▾</i></a>`;
    const glyph = document.getElementById('glyph')!;
    // both computed cursors are pointer (forced inline; in real Chrome the
    // glyph merely inherits the anchor's UA pointer) — the glyph must NOT
    // be shaped because the cursor does not CHANGE at it.
    expect(isHoverDiscoveryShape(domShapeOf(glyph))).toBe(false);
  });

  it('element with its OWN pointer cursor (parent default) IS shaped', () => {
    document.body.innerHTML = `
      <div><span id="own" style="cursor:pointer" role="button">Go</span></div>`;
    const own = document.getElementById('own')!;
    expect(isHoverDiscoveryShape(domShapeOf(own))).toBe(true);
  });

  it('anchor itself IS shaped (UA/explicit pointer changes at the anchor)', () => {
    document.body.innerHTML = `
      <nav style="cursor:default"><a href="#" id="nav" style="cursor:pointer">Products</a></nav>`;
    const nav = document.getElementById('nav')!;
    expect(isHoverDiscoveryShape(domShapeOf(nav))).toBe(true);
  });

  it('G1 anchors the pointer glyph INSIDE a link on the LINK, not the glyph', () => {
    document.body.innerHTML = `
      <a href="#" id="nav" style="cursor:pointer">Products <i id="glyph" style="cursor:pointer">▾</i></a>`;
    const glyph = document.getElementById('glyph')!;
    const anchor = resolveHoverTarget(glyph, null);
    expect(anchor.id).toBe('nav');
  });
});

describe('R2: anchor-with-glyph naming (the #nav-products regression)', () => {
  it('anchor named by its own text when the only child is an aria-hidden glyph', () => {
    document.body.innerHTML = `
      <a href="#" id="nav-products" aria-haspopup="true">Products <i class="icon-down" aria-hidden="true" style="cursor:pointer">▾</i></a>`;
    const a = document.getElementById('nav-products')!;
    const name = computeAccessibleName(a);
    expect(name).toBe('Products');
  });

  it('aria-hidden subtree text is excluded from the name', () => {
    document.body.innerHTML = `
      <a href="#" id="nav">Services <i aria-hidden="true" style="cursor:pointer">▾</i></a>`;
    const a = document.getElementById('nav')!;
    expect(computeAccessibleName(a)).toBe('Services');
  });

  it('container of REAL controls still gets no subtree-text name (RC-2 holds)', () => {
    document.body.innerHTML = `
      <ul id="menu" role="list">
        <li><a href="#" style="cursor:pointer">One Way</a></li>
        <li><a href="#" style="cursor:pointer">Round Trip</a></li>
      </ul>`;
    const ul = document.getElementById('menu')!;
    expect(computeAccessibleName(ul)).toBe('');
  });

  it('single-text-descendant container STILL gets a name (eligibility intact)', () => {
    document.body.innerHTML = `
      <div id="card"><span class="label">Trip type</span></div>`;
    const card = document.getElementById('card')!;
    expect(computeAccessibleName(card)).toBe('Trip type');
  });

  it('anchor with two text-bearing icon children (no aria-hidden) still honest', () => {
    // both children are VISIBLE glyphs with text; subtree has 2 text-bearing
    // descendants → not a single-text shape → no subtree name.
    document.body.innerHTML = `
      <a href="#" id="nav" style="cursor:pointer"><i style="cursor:pointer">▾</i><i style="cursor:pointer">▴</i></a>`;
    const a = document.getElementById('nav')!;
    expect(computeAccessibleName(a)).toBe('');
  });
});
