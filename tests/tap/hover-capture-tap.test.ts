/**
 * T2 (red) — hover-capture generic fix v1: capture layer.
 * Spec: `.drytis/specs/hover-capture-generic-fix-v1.md` §5 G1, G2a, G3.
 *
 * jsdom environment. Exercises resolveHoverTarget (RC-1), the scoped
 * hoverReveal CSS probe, and computeAccessibleName subtree gating (RC-2).
 */
import { describe, it, expect, beforeEach } from 'vitest';
// @vitest-environment jsdom
import {
  resolveHoverTarget,
  computeAccessibleName,
  computeHoverReveal,
} from '../../src/tap/identity-extractor';

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

describe('resolveHoverTarget (RC-1)', () => {
  it('hover-shaped raw element is returned as-is (element under the pointer)', () => {
    const a = el('<a href="#">Services</a>');
    expect(resolveHoverTarget(a, null)).toBe(a);
  });

  it('raw span inside a link lifts to the enclosing control (nearest shaped ancestor)', () => {
    const a = el('<a href="#"><span>Services</span></a>');
    const span = a.querySelector('span')!;
    expect(resolveHoverTarget(span, null)).toBe(a);
  });

  it('raw svg-path inside a button lifts to the button', () => {
    const btn = el('<button><svg><path d="M0 0"></path></svg></button>');
    const path = btn.querySelector('path')!;
    expect(resolveHoverTarget(path, null)).toBe(btn);
  });

  it('class-only container with NO shaped ancestor is NOT lifted into the container', () => {
    // RC-8 case: div.custom-arrow wrapper is not a declared affordance.
    // The raw pointer element is honest; discovery decides downstream.
    const root = el(
      '<div><div class="custom-arrow"><span>1</span></div></div>',
    );
    const span = root.querySelector('span')!;
    const arrow = root.querySelector('.custom-arrow') as HTMLElement;
    const out = resolveHoverTarget(span, null);
    expect(out).not.toBe(arrow);
    expect(out).toBe(span);
  });

  it('class-only container lifts when it IS cursor:pointer shaped (declared affordance)', () => {
    const root = el('<div><div class="custom-arrow" style="cursor:pointer"><span>1</span></div></div>');
    const span = root.querySelector('span')!;
    const arrow = root.querySelector('.custom-arrow') as HTMLElement;
    expect(resolveHoverTarget(span, null)).toBe(arrow);
  });

  it('never returns BODY or HTML', () => {
    const span = document.createElement('span');
    document.body.appendChild(span);
    expect(resolveHoverTarget(span, null)).not.toBe(document.body);
    expect(resolveHoverTarget(span, null)).not.toBe(document.documentElement);
  });

  it('aria-haspopup div is shaped', () => {
    const d = el('<div aria-haspopup="menu">Menu</div>');
    expect(resolveHoverTarget(d, null)).toBe(d);
    const inner = el('<div aria-haspopup="menu"><span>x</span></div>');
    const span = inner.querySelector('span')!;
    expect(resolveHoverTarget(span, null)).toBe(inner);
  });
});

describe('computeHoverReveal (G3 scoped CSS probe)', () => {
  beforeEach(() => {
    document.querySelectorAll('style').forEach((s) => s.remove());
  });

  it('true when a :hover rule on the element reveals a descendant', () => {
    document.head.appendChild(el(
      '<style>.nav:hover .panel { display: block; }</style>',
    ));
    const nav = el('<div class="nav"><span>Services</span></div>');
    document.body.appendChild(nav);
    expect(computeHoverReveal(nav)).toBe(true);
    document.body.removeChild(nav);
  });

  it('true when a :hover rule on an ancestor (<=5) reveals content', () => {
    document.head.appendChild(el(
      '<style>.banner:hover .hero-panel { display: block; }</style>',
    ));
    const banner = el(
      '<div class="banner"><div class="hero-wrap"><div class="hero-wrap2"><div class="inner"><span>promo</span></div></div></div></div>',
    );
    document.body.appendChild(banner);
    const inner = banner.querySelector('.inner') as HTMLElement;
    expect(computeHoverReveal(inner)).toBe(true);
    document.body.removeChild(banner);
  });

  it('false with no :hover rules', () => {
    const d = el('<div class="plain"><span>x</span></div>');
    document.body.appendChild(d);
    expect(computeHoverReveal(d)).toBe(false);
    document.body.removeChild(d);
  });

  it('false when :hover changes only color (not a reveal property)', () => {
    document.head.appendChild(el(
      '<style>.nav:hover { color: red; }</style>',
    ));
    const nav = el('<div class="nav"><span>x</span></div>');
    document.body.appendChild(nav);
    expect(computeHoverReveal(nav)).toBe(false);
    document.body.removeChild(nav);
  });
});

describe('computeAccessibleName subtree gating (RC-2)', () => {
  it('banner container with multi-part promo text is NOT named by subtree text', () => {
    const banner = el(
      '<div class="banner"><span>12345678</span><span>promo text here</span><a href="#">link</a></div>',
    );
    document.body.appendChild(banner);
    expect(computeAccessibleName(banner)).toBe('');
    document.body.removeChild(banner);
  });

  it('UL menu container is NOT named by joined item text', () => {
    const ul = el(
      '<ul role="list"><li>One Way</li><li>Round Trip</li></ul>',
    );
    document.body.appendChild(ul);
    expect(computeAccessibleName(ul)).toBe('');
    document.body.removeChild(ul);
  });

  it('button with single wrapping span still gets "Save"', () => {
    const b = el('<button><span>Save</span></button>');
    document.body.appendChild(b);
    expect(computeAccessibleName(b)).toBe('Save');
    document.body.removeChild(b);
  });

  it('link with plain own text still gets its text', () => {
    const a = el('<a href="#">Services</a>');
    document.body.appendChild(a);
    expect(computeAccessibleName(a)).toBe('Services');
    document.body.removeChild(a);
  });

  it('aria-label tier still wins over subtree text', () => {
    const d = el('<div aria-label="Hero banner"><span>12345678</span><span>promo</span></div>');
    document.body.appendChild(d);
    expect(computeAccessibleName(d)).toBe('Hero banner');
    document.body.removeChild(d);
  });

  it('container of interactive descendants is not text-named even with one text node', () => {
    const nav = el('<div class="nav">Menu <a href="#">go</a></div>');
    document.body.appendChild(nav);
    expect(computeAccessibleName(nav)).toBe('');
    document.body.removeChild(nav);
  });
});
