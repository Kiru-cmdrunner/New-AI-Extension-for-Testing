/**
 * Tests for CSS :hover mega-menu detection logic.
 *
 * The hasCssHoverReveal() function scans CSSStyleSheet rules for :hover
 * selectors that change visibility properties (display, opacity, etc.).
 * This directly detects CSS-driven mega-menus WITHOUT relying on timing
 * (the old visibility-count-diff approach was broken because :hover is
 * already active when mouseover fires).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Simulate the hasCssHoverReveal logic ────────────────────────────────

const HOVER_REVEAL_PROPS = new Set([
  'display', 'visibility', 'opacity', 'transform',
  'height', 'max-height', 'width', 'max-width',
  'pointer-events', 'top', 'left', 'right', 'bottom',
  'clip', 'clip-path', 'overflow',
]);

/**
 * Parenthesis-aware comma splitter — mirrors the production
 * splitSelectorOnTopLevelCommas() in deterministic-recorder.ts.
 *
 * Splits a CSS selector on commas ONLY at paren-depth 0, so commas inside
 * pseudo-class function argument lists (:is(), :where(), :not(), :has())
 * and attribute selectors ([attr="a,b"]) are preserved.
 */
function splitSelectorOnTopLevelCommas(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  // Drop empty trailing parts (e.g. trailing comma)
  return parts.filter((p) => p.length > 0);
}

/**
 * Parenthesis/bracket-aware combinator tokenizer — mirrors the production
 * splitSelectorOnCombinators() in deterministic-recorder.ts.
 *
 * Splits a selector on descendant/child combinators (whitespace, >, +, ~)
 * ONLY at paren-depth 0. This prevents splitting inside :is(.a, .b)
 * (whitespace after comma), :has(> .x) (> as a relative-selector prefix),
 * and attribute selectors like [attr~="a,b"] (~ in ~= vs ~ combinator).
 */
function splitSelectorOnCombinators(selector: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];

    if (ch === '(' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === ']') {
      depth--;
    } else if (depth === 0) {
      // At depth 0, check for combinators.
      // Note: `~` inside `[attr~=value]` is at depth≥1 (inside []), so it's
      // not mistaken for a general-sibling combinator.
      if (ch === '>' || ch === '+' || ch === '~') {
        if (i > start) tokens.push(selector.slice(start, i).trim());
        start = i + 1;
      } else if (ch === ' ' || ch === '\t') {
        // Descendant combinator (whitespace) — coalesce runs and split
        if (i > start) tokens.push(selector.slice(start, i).trim());
        // Skip the whitespace
        while (i + 1 < selector.length && (selector[i + 1] === ' ' || selector[i + 1] === '\t')) i++;
        start = i + 1;
      }
    }
  }
  if (start < selector.length) tokens.push(selector.slice(start).trim());
  return tokens.filter((t) => t.length > 0);
}

/**
 * Simulated version of the CSS :hover rule analysis that mirrors
 * deterministic-recorder.ts logic. Works with mock rule lists.
 */
function ruleMatchesHover(
  selector: string,
  properties: Record<string, string>,
  ancestors: Element[],
): boolean {
  if (!selector || !selector.includes(':hover')) return false;

  let hasRevealProp = false;
  for (const propName of Object.keys(properties)) {
    if (HOVER_REVEAL_PROPS.has(propName)) {
      hasRevealProp = true;
      break;
    }
  }
  if (!hasRevealProp) return false;

  const selectorParts = splitSelectorOnTopLevelCommas(selector);

  for (const selPart of selectorParts) {
    if (!selPart.includes(':hover')) continue;

    const tokens = splitSelectorOnCombinators(selPart);
    const hoverToken = tokens.find((t) => t.includes(':hover'));
    if (!hoverToken) continue;

    const baseSelector = hoverToken
      .replace(':hover', '')
      .replace(/::[\w-]+/g, '')
      .trim();
    if (!baseSelector) return true;

    for (const ancestor of ancestors) {
      try {
        if (ancestor.matches(baseSelector)) return true;
      } catch { /* skip */ }
    }
  }

  return false;
}

function checkHoverReveal(
  element: Element,
  rules: Array<{ selector: string; properties: Record<string, string> }>,
): boolean {
  const ancestors: Element[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < 5) {
    ancestors.push(current);
    current = current.parentElement;
    depth++;
  }

  for (const rule of rules) {
    if (ruleMatchesHover(rule.selector, rule.properties, ancestors)) {
      return true;
    }
  }

  return false;
}

describe('CSS :hover Mega-Menu Detection', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe('CSS mega-menu patterns (the adanione.com case)', () => {
    it('detects li:hover .mega-menu { display: block }', () => {
      container.innerHTML = `
        <nav>
          <ul>
            <li class="nav-item" id="services-li">
              <a href="#" id="services-link">Services</a>
              <div class="mega-menu" id="mega-menu">
                <a href="#">Flights</a>
                <a href="#">Hotels</a>
              </div>
            </li>
          </ul>
        </nav>
      `;

      const link = document.getElementById('services-link')!;
      const rules: Array<{ selector: string; properties: Record<string, string> }> = [
        { selector: '.nav-item:hover .mega-menu', properties: { display: 'block' } },
        { selector: '.mega-menu', properties: { display: 'none', position: 'absolute' } },
      ];

      expect(checkHoverReveal(link, rules)).toBe(true);
    });

    it('detects when hovering the <li> directly (not the <a>)', () => {
      container.innerHTML = `
        <li class="nav-item" id="services-li">
          <a href="#">Services</a>
          <div class="mega-menu">content</div>
        </li>
      `;

      const li = document.getElementById('services-li')!;
      const rules = [
        { selector: '.nav-item:hover > .mega-menu', properties: { display: 'block' } },
      ];

      expect(checkHoverReveal(li, rules)).toBe(true);
    });

    it('detects opacity-based reveal', () => {
      container.innerHTML = `
        <div class="tooltip-wrapper" id="wrapper">
          <span>Hover me</span>
          <div class="tooltip">Tooltip text</div>
        </div>
      `;

      const wrapper = document.getElementById('wrapper')!;
      const rules = [
        { selector: '.tooltip-wrapper:hover .tooltip', properties: { opacity: '1' } },
      ];

      expect(checkHoverReveal(wrapper, rules)).toBe(true);
    });

    it('detects visibility-based reveal', () => {
      container.innerHTML = `
        <div class="dropdown" id="dd">
          <button>Menu</button>
          <div class="dropdown-content">Items</div>
        </div>
      `;

      const dd = document.getElementById('dd')!;
      const rules = [
        { selector: '.dropdown:hover .dropdown-content', properties: { visibility: 'visible' } },
      ];

      expect(checkHoverReveal(dd, rules)).toBe(true);
    });

    it('detects transform-based reveal (slide-down menus)', () => {
      container.innerHTML = `<div class="menu" id="menu"><a>Items</a></div>`;
      const menu = document.getElementById('menu')!;
      const rules = [{ selector: '.menu:hover', properties: { transform: 'translateY(0)' } }];
      expect(checkHoverReveal(menu, rules)).toBe(true);
    });

    it('detects max-height transition reveal', () => {
      container.innerHTML = `<div class="accordion" id="acc"><h3>S</h3><div class="panel">C</div></div>`;
      const acc = document.getElementById('acc')!;
      const rules = [{ selector: '.accordion:hover .panel', properties: { 'max-height': '500px' } }];
      expect(checkHoverReveal(acc, rules)).toBe(true);
    });
  });

  describe('Does NOT trigger on non-hover-revealing elements', () => {
    it('returns false for :hover rules that only change color', () => {
      container.innerHTML = `<a href="#" class="nav-link" id="link">Home</a>`;
      const link = document.getElementById('link')!;
      const rules = [{ selector: '.nav-link:hover', properties: { color: 'red' } }];
      expect(checkHoverReveal(link, rules)).toBe(false);
    });

    it('returns false for :hover rules that only change background-color', () => {
      container.innerHTML = `<button class="btn" id="btn">Click</button>`;
      const btn = document.getElementById('btn')!;
      const rules = [{ selector: '.btn:hover', properties: { 'background-color': 'blue' } }];
      expect(checkHoverReveal(btn, rules)).toBe(false);
    });

    it('returns false when no :hover rules exist at all', () => {
      container.innerHTML = `<div class="card" id="card"><p>Static</p></div>`;
      const card = document.getElementById('card')!;
      expect(checkHoverReveal(card, [])).toBe(false);
    });

    it('returns false for rules that match a different element', () => {
      container.innerHTML = `<div class="other" id="el"><span>No hover</span></div>`;
      const el = document.getElementById('el')!;
      const rules = [{ selector: '.nav-item:hover .mega-menu', properties: { display: 'block' } }];
      expect(checkHoverReveal(el, rules)).toBe(false);
    });
  });

  describe('Ancestor chain matching', () => {
    it('detects :hover rule on parent when hovering child element', () => {
      container.innerHTML = `
        <div class="parent-has-hover" id="parent">
          <div class="middle"><span id="child">Hover over me</span></div>
        </div>
      `;
      const child = document.getElementById('child')!;
      const rules = [{ selector: '.parent-has-hover:hover .tooltip', properties: { display: 'block' } }];
      expect(checkHoverReveal(child, rules)).toBe(true);
    });

    it('detects :hover rule on grandparent when hovering deeply nested child', () => {
      container.innerHTML = `
        <div class="nav-item" id="gp"><div><div>
          <a id="deep-link" href="#">Deeply nested link</a>
        </div></div></div>
      `;
      const deepLink = document.getElementById('deep-link')!;
      const rules = [{ selector: '.nav-item:hover .mega-menu', properties: { display: 'block' } }];
      expect(checkHoverReveal(deepLink, rules)).toBe(true);
    });

    it('stops searching after 5 ancestor levels', () => {
      container.innerHTML = `
        <div class="nav-item" id="lvl1"><div><div><div><div><div><div>
          <a id="too-deep" href="#">Too deeply nested</a>
        </div></div></div></div></div></div></div>
      `;
      const tooDeep = document.getElementById('too-deep')!;
      const rules = [{ selector: '.nav-item:hover .mega-menu', properties: { display: 'block' } }];
      expect(checkHoverReveal(tooDeep, rules)).toBe(false);
    });
  });

  describe('Complex selectors', () => {
    it('handles compound :hover selectors (.a:hover > .b)', () => {
      container.innerHTML = `
        <li class="nav-item has-children" id="nav-li">
          <a href="#">Parent</a>
          <ul class="sub-menu"><li>Child</li></ul>
        </li>
      `;
      const navLi = document.getElementById('nav-li')!;
      const rules = [{ selector: '.nav-item.has-children:hover > .sub-menu', properties: { display: 'block' } }];
      expect(checkHoverReveal(navLi, rules)).toBe(true);
    });

    it('handles bare :hover selector', () => {
      container.innerHTML = `<div id="el">Hover me</div>`;
      const el = document.getElementById('el')!;
      const rules = [{ selector: ':hover', properties: { display: 'block' } }];
      expect(checkHoverReveal(el, rules)).toBe(true);
    });

    it('handles :hover with pseudo-elements (::before)', () => {
      container.innerHTML = `<a class="tooltip-trigger" id="trigger">Hover</a>`;
      const trigger = document.getElementById('trigger')!;
      const rules = [{ selector: '.tooltip-trigger:hover::before', properties: { display: 'block' } }];
      expect(checkHoverReveal(trigger, rules)).toBe(true);
    });

    it('handles comma-separated :hover selectors', () => {
      container.innerHTML = `<div class="mega-item" id="el">Mega</div>`;
      const el = document.getElementById('el')!;
      const rules = [{ selector: '.btn:hover, .mega-item:hover', properties: { display: 'block' } }];
      expect(checkHoverReveal(el, rules)).toBe(true);
    });

    it('handles child combinator > in :hover selector', () => {
      container.innerHTML = `<ul class="navbar-nav" id="nav"><li>Item</li></ul>`;
      const nav = document.getElementById('nav')!;
      const rules = [{ selector: '.navbar-nav:hover > li', properties: { display: 'block' } }];
      expect(checkHoverReveal(nav, rules)).toBe(true);
    });
  });

  describe('Real-world adanione.com mega-menu structure', () => {
    it('detects full adanione.com Services mega-menu pattern', () => {
      container.innerHTML = `
        <header><nav class="navbar"><ul class="navbar-nav">
          <li class="nav-item dropdown" id="services-nav-item">
            <a class="nav-link" href="#" id="services-link">Services<svg>...</svg></a>
            <div class="dropdown-menu mega-menu" id="mega">
              <div class="row"><div class="col">
                <h6>Travel Services</h6>
                <a href="#" class="dropdown-item">Book Flight</a>
                <a href="#" class="dropdown-item">Hotels</a>
              </div></div>
            </div>
          </li>
        </ul></nav></header>
      `;
      const servicesLink = document.getElementById('services-link')!;
      const rules = [
        { selector: '.nav-item.dropdown:hover .dropdown-menu', properties: { display: 'block' } },
      ];
      expect(checkHoverReveal(servicesLink, rules)).toBe(true);
    });

    it('also detects when hovering the nav-item <li> directly', () => {
      container.innerHTML = `
        <li class="nav-item dropdown" id="li">
          <a class="nav-link" href="#">Services</a>
          <div class="dropdown-menu mega-menu">content</div>
        </li>
      `;
      const li = document.getElementById('li')!;
      const rules = [{ selector: '.nav-item.dropdown:hover > .dropdown-menu', properties: { display: 'block' } }];
      expect(checkHoverReveal(li, rules)).toBe(true);
    });
  });

  describe('Hover reveal properties coverage', () => {
    const revealProperties: Array<[string, string]> = [
      ['display', 'block'], ['visibility', 'visible'], ['opacity', '1'],
      ['transform', 'translateY(0)'], ['height', 'auto'], ['max-height', '500px'],
      ['width', '300px'], ['max-width', '500px'], ['pointer-events', 'auto'],
      ['top', '0'], ['left', '0'], ['clip', 'auto'], ['clip-path', 'none'],
      ['overflow', 'visible'],
    ];
    for (const [prop, value] of revealProperties) {
      it(`detects :hover rule changing ${prop}`, () => {
        container.innerHTML = `<div class="el" id="el">test</div>`;
        const el = document.getElementById('el')!;
        const rules = [{ selector: '.el:hover .content', properties: { [prop]: value } }];
        expect(checkHoverReveal(el, rules)).toBe(true);
      });
    }

    const nonRevealProperties: Array<[string, string]> = [
      ['color', 'red'], ['background-color', 'blue'], ['border-color', 'green'],
      ['font-size', '16px'], ['font-weight', 'bold'], ['cursor', 'pointer'],
      ['box-shadow', '0 0 10px black'], ['text-decoration', 'underline'], ['z-index', '10'],
    ];
    for (const [prop, value] of nonRevealProperties) {
      it(`does NOT trigger for :hover rule changing only ${prop}`, () => {
        container.innerHTML = `<div class="el" id="el">test</div>`;
        const el = document.getElementById('el')!;
        const rules = [{ selector: '.el:hover', properties: { [prop]: value } }];
        expect(checkHoverReveal(el, rules)).toBe(false);
      });
    }
  });

  describe('Multiple :hover rules matching different elements', () => {
    it('detects when one of several :hover rules matches', () => {
      container.innerHTML = `<div class="tab" id="tab">Tab 1</div>`;
      const tab = document.getElementById('tab')!;
      const rules: Array<{ selector: string; properties: Record<string, string> }> = [
        { selector: '.other:hover', properties: { display: 'block' } },
        { selector: '.unrelated:hover', properties: { opacity: '1' } },
        { selector: '.tab:hover .tab-content', properties: { display: 'block' } },
      ];
      expect(checkHoverReveal(tab, rules)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // PAREN-AWARE SELECTOR SPLITTING — :is(), :where(), :not(), :has()
  // Regression tests for the bug where selector.split(',') broke on commas
  // nested inside modern CSS pseudo-class function argument lists.
  // ══════════════════════════════════════════════════════════════════════

  describe('splitSelectorOnTopLevelCommas', () => {
    it('splits a flat comma-separated selector list', () => {
      expect(splitSelectorOnTopLevelCommas('.a:hover, .b:hover'))
        .toEqual(['.a:hover', '.b:hover']);
    });

    it('does NOT split inside :is()', () => {
      expect(splitSelectorOnTopLevelCommas(':is(.a:hover, .b:hover) .c'))
        .toEqual([':is(.a:hover, .b:hover) .c']);
    });

    it('does NOT split inside :where()', () => {
      expect(splitSelectorOnTopLevelCommas(':where(.x, .y):hover .z'))
        .toEqual([':where(.x, .y):hover .z']);
    });

    it('does NOT split inside :not()', () => {
      expect(splitSelectorOnTopLevelCommas(':not(.disabled, .hidden):hover .panel'))
        .toEqual([':not(.disabled, .hidden):hover .panel']);
    });

    it('does NOT split inside :has()', () => {
      expect(splitSelectorOnTopLevelCommas('div:has(> .trigger, > .btn):hover .content'))
        .toEqual(['div:has(> .trigger, > .btn):hover .content']);
    });

    it('does NOT split inside attribute selectors with comma', () => {
      expect(splitSelectorOnTopLevelCommas('[data-tags~="a,b"]:hover .content'))
        .toEqual(['[data-tags~="a,b"]:hover .content']);
    });

    it('handles nested parens: :is(:not(.x), .y:hover)', () => {
      expect(splitSelectorOnTopLevelCommas(':is(:not(.x), .y:hover) .z'))
        .toEqual([':is(:not(.x), .y:hover) .z']);
    });

    it('splits multiple top-level commas alongside nested :is()', () => {
      expect(
        splitSelectorOnTopLevelCommas(':is(.a:hover, .b:hover) .c, .d:hover .e'),
      ).toEqual([':is(.a:hover, .b:hover) .c', '.d:hover .e']);
    });

    it('returns a single-element array when there are no commas', () => {
      expect(splitSelectorOnTopLevelCommas('.nav-item:hover .mega-menu'))
        .toEqual(['.nav-item:hover .mega-menu']);
    });

    it('drops a trailing empty part from a trailing comma', () => {
      expect(splitSelectorOnTopLevelCommas('.a:hover,'))
        .toEqual(['.a:hover']);
    });

    it('handles a selector that is just :is() with no top-level comma', () => {
      expect(splitSelectorOnTopLevelCommas(':is(.a, .b, .c)'))
        .toEqual([':is(.a, .b, .c)']);
    });
  });

  describe('splitSelectorOnCombinators', () => {
    it('splits a simple descendant selector', () => {
      expect(splitSelectorOnCombinators('.nav-item:hover .mega-menu'))
        .toEqual(['.nav-item:hover', '.mega-menu']);
    });

    it('splits on child combinator >', () => {
      expect(splitSelectorOnCombinators('.nav-item:hover > .mega-menu'))
        .toEqual(['.nav-item:hover', '.mega-menu']);
    });

    it('does NOT split on whitespace inside :is()', () => {
      expect(splitSelectorOnCombinators(':is(.nav-item:hover, .nav-item.open) .mega-menu'))
        .toEqual([':is(.nav-item:hover, .nav-item.open)', '.mega-menu']);
    });

    it('does NOT split on > inside :has()', () => {
      expect(splitSelectorOnCombinators('.card:has(> .trigger):hover .content'))
        .toEqual(['.card:has(> .trigger):hover', '.content']);
    });

    it('does NOT split on ~ inside attribute selector [attr~=value]', () => {
      expect(splitSelectorOnCombinators('[data-tags~="a,b"]:hover .content'))
        .toEqual(['[data-tags~="a,b"]:hover', '.content']);
    });

    it('does NOT split on + inside :not()', () => {
      expect(splitSelectorOnCombinators('li:not(.first + .second):hover .panel'))
        .toEqual(['li:not(.first + .second):hover', '.panel']);
    });

    it('handles nested parens: :is(:not(.x), .y:hover) .z', () => {
      expect(splitSelectorOnCombinators(':is(:not(.x), .y:hover) .z'))
        .toEqual([':is(:not(.x), .y:hover)', '.z']);
    });

    it('handles multiple combinators with nested functions', () => {
      expect(
        splitSelectorOnCombinators('nav > :is(.a, .b):hover > .dropdown > .item'),
      ).toEqual(['nav', ':is(.a, .b):hover', '.dropdown', '.item']);
    });

    it('returns a single token when there are no combinators', () => {
      expect(splitSelectorOnCombinators(':is(.a, .b)'))
        .toEqual([':is(.a, .b)']);
    });
  });

  describe('Modern CSS pseudo-class hover detection (:is/:where/:not/:has)', () => {
    beforeEach(() => {
      container.innerHTML = '';
    });

    it('detects :is(.nav-item:hover, .nav-item.open) .mega-menu', () => {
      container.innerHTML = `
        <div class="nav-item" id="nav">
          <a href="#" id="link">Services</a>
          <div class="mega-menu">content</div>
        </div>
      `;
      const nav = document.getElementById('nav')!;
      const rules = [
        {
          selector: ':is(.nav-item:hover, .nav-item.open) .mega-menu',
          properties: { display: 'block' },
        },
      ];
      expect(checkHoverReveal(nav, rules)).toBe(true);
    });

    it('detects :is() pattern when hovering the inner link (ancestor chain)', () => {
      container.innerHTML = `
        <div class="nav-item" id="nav">
          <a href="#" id="link">Services</a>
          <div class="mega-menu">content</div>
        </div>
      `;
      const link = document.getElementById('link')!;
      const rules = [
        {
          selector: ':is(.nav-item:hover, .nav-item.open) .mega-menu',
          properties: { display: 'block' },
        },
      ];
      expect(checkHoverReveal(link, rules)).toBe(true);
    });

    it('detects :where(.nav-item:hover) .dropdown', () => {
      container.innerHTML = `
        <div class="nav-item" id="nav">
          <div class="dropdown">content</div>
        </div>
      `;
      const nav = document.getElementById('nav')!;
      const rules = [
        {
          selector: ':where(.nav-item:hover) .dropdown',
          properties: { visibility: 'visible' },
        },
      ];
      expect(checkHoverReveal(nav, rules)).toBe(true);
    });

    it('detects :not(.disabled):hover .panel', () => {
      container.innerHTML = `
        <div class="tab" id="tab">
          <div class="panel">content</div>
        </div>
      `;
      const tab = document.getElementById('tab')!;
      const rules = [
        {
          selector: ':not(.disabled):hover .panel',
          properties: { opacity: '1' },
        },
      ];
      expect(checkHoverReveal(tab, rules)).toBe(true);
    });

    it('detects div:has(> .trigger):hover .content', () => {
      container.innerHTML = `
        <div class="card" id="card">
          <span class="trigger">t</span>
          <div class="content">c</div>
        </div>
      `;
      const card = document.getElementById('card')!;
      const rules = [
        {
          selector: '.card:has(> .trigger):hover .content',
          properties: { display: 'block' },
        },
      ];
      expect(checkHoverReveal(card, rules)).toBe(true);
    });

    it('detects chained pseudo-class functions: :where(.a, .b):not(.disabled):hover .z', () => {
      // Exercises comma handling in :where() AND a separate :not() in the
      // same compound selector. Deep nesting (:is(:not(.x), .y)) is covered
      // by the splitSelectorOnCombinators unit tests — jsdom's matches()
      // parser doesn't support that nesting level, but real Chrome does.
      container.innerHTML = `
        <div class="a" id="el">
          <div class="z">content</div>
        </div>
      `;
      const el = document.getElementById('el')!;
      const rules = [
        {
          selector: ':where(.a, .b):not(.disabled):hover .z',
          properties: { display: 'block' },
        },
      ];
      expect(checkHoverReveal(el, rules)).toBe(true);
    });

    it('detects attribute selector with comma: [data-tags~="a,b"]:hover', () => {
      container.innerHTML = `
        <div data-tags="a,b" id="el">
          <div class="content">content</div>
        </div>
      `;
      const el = document.getElementById('el')!;
      const rules = [
        {
          selector: '[data-tags~="a,b"]:hover .content',
          properties: { display: 'block' },
        },
      ];
      expect(checkHoverReveal(el, rules)).toBe(true);
    });

    it('detects multiple top-level commas with nested :is(): part 1 matches', () => {
      container.innerHTML = `<div class="a" id="el"><div class="c">content</div></div>`;
      const el = document.getElementById('el')!;
      const rules = [
        {
          selector: ':is(.a:hover, .b:hover) .c, .d:hover .e',
          properties: { display: 'block' },
        },
      ];
      expect(checkHoverReveal(el, rules)).toBe(true);
    });

    it('detects multiple top-level commas with nested :is(): part 2 matches', () => {
      container.innerHTML = `<div class="d" id="el"><div class="e">content</div></div>`;
      const el = document.getElementById('el')!;
      const rules = [
        {
          selector: ':is(.a:hover, .b:hover) .c, .d:hover .e',
          properties: { display: 'block' },
        },
      ];
      expect(checkHoverReveal(el, rules)).toBe(true);
    });

    it('does NOT trigger for :is() hover that only changes color (no reveal prop)', () => {
      container.innerHTML = `<div class="nav-item" id="nav"><span>x</span></div>`;
      const nav = document.getElementById('nav')!;
      const rules = [
        {
          selector: ':is(.nav-item:hover, .nav-item.open) span',
          properties: { color: 'red' },
        },
      ];
      expect(checkHoverReveal(nav, rules)).toBe(false);
    });

    it('does NOT trigger for :is() when the element class does not match', () => {
      container.innerHTML = `<div class="other" id="el"><div class="c">c</div></div>`;
      const el = document.getElementById('el')!;
      const rules = [
        {
          selector: ':is(.nav-item:hover, .nav-item.open) .c',
          properties: { display: 'block' },
        },
      ];
      expect(checkHoverReveal(el, rules)).toBe(false);
    });
  });

  describe('Real-world GitHub Enterprise flyout pattern', () => {
    beforeEach(() => {
      container.innerHTML = '';
    });

    it('detects the exact GitHub Enterprise NavDropdown :is() rule (hovering container)', () => {
      // Real DOM structure from github.com:
      // <div class="NavDropdown-module__container__l2YeI ...">
      //   <button class="NavDropdown-module__button__PEHWX">Enterprise</button>
      //   <div class="NavDropdown-module__dropdown__xm1jd">...flyout...</div>
      // </div>
      container.innerHTML = `
        <div class="NavDropdown-module__container__l2YeI js-details-container" id="container">
          <button type="button" class="NavDropdown-module__button__PEHWX js-details-target" aria-expanded="false" id="btn">Enterprise</button>
          <div class="NavDropdown-module__dropdown__xm1jd" id="dropdown">
            <span>Enterprise Solutions</span>
          </div>
        </div>
      `;
      const container_el = document.getElementById('container')!;
      // Real CSS rule from github.githubassets.com/assets/marketing-navigation.*.module.css
      const rules = [
        {
          selector:
            ':is(.NavDropdown-module__container__l2YeI:hover,.NavDropdown-module__container__l2YeI.open) .NavDropdown-module__dropdown__xm1jd',
          properties: {
            opacity: '1',
            visibility: 'visible',
            position: 'absolute',
            transform: 'scale(1)translateY(0)',
          },
        },
      ];
      expect(checkHoverReveal(container_el, rules)).toBe(true);
    });

    it('detects the GitHub Enterprise flyout when hovering the inner button', () => {
      // This is the actual user scenario: user hovers the "Enterprise" button text,
      // not the container div. resolveTarget walks up to the button, and
      // hasCssHoverReveal walks up ancestors — the container must match.
      container.innerHTML = `
        <div class="NavDropdown-module__container__l2YeI" id="container">
          <button class="NavDropdown-module__button__PEHWX" id="btn">Enterprise</button>
          <div class="NavDropdown-module__dropdown__xm1jd">flyout</div>
        </div>
      `;
      const btn = document.getElementById('btn')!;
      const rules = [
        {
          selector:
            ':is(.NavDropdown-module__container__l2YeI:hover,.NavDropdown-module__container__l2YeI.open) .NavDropdown-module__dropdown__xm1jd',
          properties: { visibility: 'visible', opacity: '1' },
        },
      ];
      expect(checkHoverReveal(btn, rules)).toBe(true);
    });
  });
});
