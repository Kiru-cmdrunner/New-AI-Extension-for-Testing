/**
 * T1 (red) — hover-capture generic fix v1.
 * Spec: `.drytis/specs/hover-capture-generic-fix-v1.md` §5 G1–G4.
 *
 * Pure-policy unit tests: discovery shape predicate (RC-8) and subtree-text
 * name eligibility (RC-2). No DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  isHoverDiscoveryShape,
  subtreeTextNameEligibility,
} from '../../src/definitions/patterns';

describe('isHoverDiscoveryShape (RC-8)', () => {
  it('native interactive tags are hover-shaped', () => {
    expect(isHoverDiscoveryShape({ tag: 'BUTTON' })).toBe(true);
    expect(isHoverDiscoveryShape({ tag: 'A' })).toBe(true);
    expect(isHoverDiscoveryShape({ tag: 'SUMMARY' })).toBe(true);
  });

  it('ARIA widget roles are hover-shaped', () => {
    expect(isHoverDiscoveryShape({ tag: 'DIV', ariaRole: 'button' })).toBe(true);
    expect(isHoverDiscoveryShape({ tag: 'SPAN', ariaRole: 'menuitem' })).toBe(true);
  });

  it('tabIndex >= 0 is hover-shaped (declared affordance)', () => {
    expect(isHoverDiscoveryShape({ tag: 'DIV', tabIndex: 0 })).toBe(true);
    expect(isHoverDiscoveryShape({ tag: 'DIV', tabIndex: 3 })).toBe(true);
    expect(isHoverDiscoveryShape({ tag: 'DIV', tabIndex: -1 })).toBe(false);
    expect(isHoverDiscoveryShape({ tag: 'DIV', tabIndex: null })).toBe(false);
  });

  it('aria-haspopup is hover-shaped', () => {
    expect(isHoverDiscoveryShape({ tag: 'A', ariaHasPopup: 'menu' })).toBe(true);
  });

  it('clickHandler and pointerCursor DomContext facts are hover-shaped', () => {
    expect(isHoverDiscoveryShape({ tag: 'DIV', clickHandler: true })).toBe(true);
    expect(isHoverDiscoveryShape({ tag: 'DIV', pointerCursor: true })).toBe(true);
  });

  it('class vocabulary is NOT shape: class-only containers are not hover-shaped', () => {
    // RC-8: unbounded substring list ('custom-arrow' contains 'arrow',
    // 'tripType-dropDown' contains 'dropdown') must not start lifecycles.
    expect(isHoverDiscoveryShape({ tag: 'DIV', className: 'HeroBannerCarousel_homeHeroBanner__61LDi custom-arrow' }))
      .toBe(false);
    expect(isHoverDiscoveryShape({ tag: 'UL', className: 'tripType-dropDown' })).toBe(false);
    expect(isHoverDiscoveryShape({ tag: 'DIV', className: 'btn btn-primary' })).toBe(false);
  });

  it('plain structural elements are not hover-shaped', () => {
    expect(isHoverDiscoveryShape({ tag: 'DIV' })).toBe(false);
    expect(isHoverDiscoveryShape({ tag: 'UL' })).toBe(false);
    expect(isHoverDiscoveryShape({ tag: 'I', className: 'font-icons icon-arrow-down' })).toBe(false);
  });

  it('accepts precomputed shape facts only; hoverReveal is NOT part of shape', () => {
    // The OR-path with domContext.hoverReveal lives at the call sites —
    // shape stays honest to declared affordances.
    expect(isHoverDiscoveryShape({ tag: 'DIV', hoverReveal: true })).toBe(false);
  });
});

describe('subtreeTextNameEligibility (RC-2)', () => {
  it('element with own direct text and no element children is eligible', () => {
    expect(subtreeTextNameEligibility({
      elementChildCount: 0,
      textBearingElementDescendantCount: 0,
      textLength: 8,
      hasNewline: false,
      hasInteractiveShapedDescendant: false,
    })).toBe(true);
  });

  it('single text-bearing wrapper (<button><span>Save</span></button>) is eligible', () => {
    expect(subtreeTextNameEligibility({
      elementChildCount: 1,
      textBearingElementDescendantCount: 1,
      textLength: 4,
      hasNewline: false,
      hasInteractiveShapedDescendant: false,
    })).toBe(true);
  });

  it('multiple text-bearing descendants (containers like UL menu, banner) are NOT eligible', () => {
    // "12345678" banner promo + "One WayRound Trip" UL join are the RCA cases.
    expect(subtreeTextNameEligibility({
      elementChildCount: 2,
      textBearingElementDescendantCount: 2,
      textLength: 14,
      hasNewline: false,
      hasInteractiveShapedDescendant: false,
    })).toBe(false);
    expect(subtreeTextNameEligibility({
      elementChildCount: 12,
      textBearingElementDescendantCount: 9,
      textLength: 87,
      hasNewline: true,
      hasInteractiveShapedDescendant: false,
    })).toBe(false);
  });

  it('interactive-shaped descendants disqualify subtree text (container of controls)', () => {
    expect(subtreeTextNameEligibility({
      elementChildCount: 1,
      textBearingElementDescendantCount: 1,
      textLength: 10,
      hasNewline: false,
      hasInteractiveShapedDescendant: true,
    })).toBe(false);
  });

  it('long subtree text (>80) is not a name', () => {
    expect(subtreeTextNameEligibility({
      elementChildCount: 1,
      textBearingElementDescendantCount: 1,
      textLength: 140,
      hasNewline: false,
      hasInteractiveShapedDescendant: false,
    })).toBe(false);
  });

  it('multi-line innerText (block layouts) is not a name', () => {
    expect(subtreeTextNameEligibility({
      elementChildCount: 2,
      textBearingElementDescendantCount: 1,
      textLength: 30,
      hasNewline: true,
      hasInteractiveShapedDescendant: false,
    })).toBe(false);
  });
});
