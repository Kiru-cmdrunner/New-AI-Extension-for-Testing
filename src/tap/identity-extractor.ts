/**
 * Identity Extractor — Element Identity Extraction (Layer 1)
 *
 * Extracts a complete ElementIdentity from a live DOM element. This runs in
 * the content script at event capture time — the DOM is accessible but will
 * mutate later, so all identity information must be captured NOW.
 *
 * The logic is adapted from the proven implementation in
 * deterministic-recorder.ts (v10.4.18). Key behaviors preserved:
 *   - 10-tier accessible name cascade
 *   - Implicit ARIA role mapping
 *   - CSS selector and XPath generation
 *   - Shadow DOM awareness (open roots)
 *   - Iframe context extraction
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 1
 */

import type { ElementIdentity, IframeContext } from '../shared/types';
import {
  subtreeTextNameEligibility,
  isHoverDiscoveryShape,
} from '../definitions/patterns';

// ── Utilities ──────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) : str;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}

// ── Implicit Role Mapping ──────────────────────────────────────────────

const TAG_ROLE_MAP: Record<string, string> = {
  A: 'link', BUTTON: 'button', NAV: 'navigation', MAIN: 'main',
  HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary',
  ARTICLE: 'article', SECTION: 'region', FORM: 'form', SEARCH: 'search',
  H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading',
  H5: 'heading', H6: 'heading', UL: 'list', OL: 'list', LI: 'listitem',
  TABLE: 'table', TR: 'row', TH: 'columnheader', TD: 'cell',
  DETAILS: 'group', DIALOG: 'dialog', IMG: 'img', FIGURE: 'figure',
  FIGCAPTION: 'caption', SELECT: 'listbox', OPTION: 'option',
  TEXTAREA: 'textbox', SUMMARY: 'button', I: 'img', SVG: 'img',
};

const INPUT_TYPE_ROLE_MAP: Record<string, string> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button',
  checkbox: 'checkbox', radio: 'radio',
  text: 'textbox', email: 'textbox', password: 'textbox',
  search: 'textbox', tel: 'textbox', url: 'textbox',
  number: 'spinbutton', range: 'slider',
  date: 'textbox', time: 'textbox', 'datetime-local': 'textbox',
  month: 'textbox', week: 'textbox',
};

/**
 * Determine the implicit ARIA role for an element.
 * Uses explicit role attribute if present, otherwise maps from tag/type.
 */
export function getImplicitRole(el: Element): string | null {
  const explicitRole = el.getAttribute('role');
  if (explicitRole && explicitRole.trim()) return explicitRole.trim();

  const tag = el.tagName;
  if (TAG_ROLE_MAP[tag]) return TAG_ROLE_MAP[tag];

  if (el instanceof HTMLInputElement) {
    const inputType = el.type?.toLowerCase() || 'text';
    return INPUT_TYPE_ROLE_MAP[inputType] ?? null;
  }

  return null;
}

// ── Shadow-DOM-aware query helpers ─────────────────────────────────────

function deepGetElementById(id: string): Element | null {
  const found = document.getElementById(id);
  if (found) return found;
  return deepGetElementByIdInShadowRoot(id, document);
}

function deepGetElementByIdInShadowRoot(id: string, root: Document | ShadowRoot): Element | null {
  const allElements = root.querySelectorAll('*');
  for (const el of allElements) {
    if (el.id === id) return el;
    if (el.shadowRoot) {
      const inner = deepGetElementByIdInShadowRoot(id, el.shadowRoot);
      if (inner) return inner;
    }
  }
  return null;
}

function deepQuerySelector(selector: string): Element | null {
  const found = document.querySelector(selector);
  if (found) return found;
  return deepQuerySelectorInShadowRoot(selector, document);
}

function deepQuerySelectorInShadowRoot(selector: string, root: Document | ShadowRoot): Element | null {
  const allElements = root.querySelectorAll('*');
  for (const el of allElements) {
    if (el.matches(selector)) return el;
    if (el.shadowRoot) {
      const innerMatch = el.shadowRoot.querySelector(selector);
      if (innerMatch) return innerMatch;
      const nested = deepQuerySelectorInShadowRoot(selector, el.shadowRoot);
      if (nested) return nested;
    }
  }
  return null;
}

// ── Accessible Name (10-tier cascade) ──────────────────────────────────

/**
 * Compute the accessible name for an element using a 10-tier cascade.
 *
 * Tier 1:  aria-label
 * Tier 2:  aria-labelledby (resolved text, supports multiple IDs)
 * Tier 3:  label[for=<id>] (form controls only)
 * Tier 4:  wrapping <label> (form controls only)
 * Tier 5:  SELECT selected option text
 * Tier 6:  innerText
 * Tier 7:  textContent
 * Tier 8:  placeholder / aria-placeholder
 * Tier 9:  value (submit/button/reset inputs only)
 * Tier 10: alt attribute (IMG / INPUT[image])
 * Tier 11: title attribute
 *
 * Returns '' (empty string) for text inputs with a value but no label.
 * This is the OXD combobox root cause: callers must use `||` to fall
 * through to valueBefore when accessibleName is empty.
 *
 * Architecture: §4.2
 */
export function computeAccessibleName(el: Element): string {
  // Tier 1: aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return truncate(ariaLabel.trim(), 200);

  // Tier 2: aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const texts: string[] = [];
    for (const id of ids) {
      const target = deepGetElementById(id);
      if (target) {
        const text = target.textContent?.trim();
        if (text) texts.push(text);
      }
    }
    if (texts.length > 0) return truncate(texts.join(' '), 200);
  }

  // Tiers 3-5: form control specific
  const isFormControl = el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

  if (isFormControl) {
    // Tier 3: label[for]
    const elId = el.id;
    if (elId) {
      const label = deepQuerySelector(`label[for="${cssEscape(elId)}"]`);
      if (label) {
        const labelText = label.textContent?.trim();
        if (labelText) return truncate(labelText, 200);
      }
    }
    // Tier 4: wrapping label
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const labelText = parentLabel.textContent?.trim();
      if (labelText) return truncate(labelText, 200);
    }
    // Tier 5: SELECT selected option
    if (el instanceof HTMLSelectElement && el.selectedIndex >= 0) {
      const opt = el.options[el.selectedIndex];
      const optText = opt?.textContent?.trim();
      if (optText) return truncate(optText, 200);
    }
  }

  // Tier 6: innerText — RC-2 (hover-capture generic fix v1): subtree text is
  // a NAME only for a single text-bearing shape. A container's whole-subtree
  // text is not a name (banner DIV named "12345678"; UL named "One WayRound
  // Trip"). Eligibility decision is the pure policy in patterns.ts; the DOM
  // measurement happens here at the capture instant. Cursor-inheritance
  // amendment: the measured text is VISIBLE-only (aria-hidden stripped) and
  // the descendant shape scan uses own-boundary cursor facts, so an icon
  // glyph inside a link no longer poisons the anchor's own name.
  if (el instanceof HTMLElement) {
    const visible = visibleSubtreeText(el).trim();
    if (visible && subtreeTextNameEligibility(measureSubtreeText(el, visible))) {
      return truncate(visible, 200);
    }
  }

  // Tier 7: textContent — same RC-2 gating (textContent is the same subtree
  // text without rendering semantics). Cursor-inheritance amendment: skip if
  // the element HAS innerText (tier 6 already measured the visible text —
  // do not name from the less-honest serialization).
  {
    const visible = visibleSubtreeText(el).trim();
    const hasInnerText = el instanceof HTMLElement
      && typeof el.innerText === 'string' && el.innerText.length > 0;
    if (visible && !hasInnerText && subtreeTextNameEligibility(measureSubtreeText(el, visible))) {
      return truncate(visible, 200);
    }
  }

  // Tier 8: placeholder / aria-placeholder
  const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
  if (placeholder && placeholder.trim()) return truncate(placeholder.trim(), 200);

  // Tier 9: value (submit/button/reset only)
  const value = (el as HTMLInputElement).value;
  if (value && value.trim() && el.tagName === 'INPUT') {
    const type = el.getAttribute('type');
    if (type === 'button' || type === 'submit' || type === 'reset') {
      return truncate(value.trim(), 200);
    }
  }

  // Tier 10: alt (IMG / INPUT[image])
  const alt = el.getAttribute('alt');
  if (alt && alt.trim()) {
    if (el.tagName === 'IMG' || (el.tagName === 'INPUT' && el.getAttribute('type') === 'image')) {
      return truncate(alt.trim(), 200);
    }
  }

  // Tier 11: title
  const title = el.getAttribute('title');
  if (title && title.trim()) return truncate(title.trim(), 200);

  return '';
}

// ── Hover capture generic fix v1 (RC-1/RC-2/RC-3) ──────────────────────
// Spec: `.drytis/specs/hover-capture-generic-fix-v1.md` §5 G1, G2a, G3.

/** aria-hidden="true" subtree boundary (DOM ownership fact, no vocabulary). */
function isAriaHidden(el: Element): boolean {
  return el.getAttribute('aria-hidden') === 'true';
}

/**
 * Visible-subtree text: innerText when available (rendering semantics), with
 * aria-hidden subtree text REMOVED (accname conformance — hidden content is
 * not a name source). Falls back to textContent-derived visible text when
 * innerText is unavailable (non-rendered jsdom nodes).
 */
function visibleSubtreeText(el: Element): string {
  if (el instanceof HTMLElement && typeof el.innerText === 'string' && el.innerText.length > 0) {
    // innerText is already visible-only for display:none subtrees; strip
    // aria-hidden descendants explicitly (they can still be visually shown).
    const clone = el.cloneNode(true) as Element;
    for (const h of Array.from(clone.querySelectorAll('[aria-hidden="true"]'))) {
      h.remove();
    }
    return clone.textContent ?? '';
  }
  // textContent path (no layout): same aria-hidden strip.
  const clone = el.cloneNode(true) as Element;
  for (const h of Array.from(clone.querySelectorAll('[aria-hidden="true"]'))) {
    h.remove();
  }
  return clone.textContent ?? '';
}

/**
 * Measure the subtree-text naming facts for RC-2 eligibility. DOM
 * measurement only — the eligibility DECISION is the pure policy
 * (subtreeTextNameEligibility in definitions/patterns.ts).
 */
function measureSubtreeText(el: Element, text: string): {
  elementChildCount: number;
  textBearingElementDescendantCount: number;
  textLength: number;
  hasNewline: boolean;
  hasInteractiveShapedDescendant: boolean;
} {
  let textBearing = 0;
  let interactiveShaped = false;
  // DOM ownership: descendants beyond an aria-hidden boundary are HIDDEN
  // content — they contribute neither text nor shape evidence (accname
  // conformance: hidden content is not a name source).
  const subtree = isAriaHidden(el) ? [] : Array.from(el.querySelectorAll('*'));
  for (const d of subtree) {
    if (isAriaHidden(d)) continue;
    const ownText = Array.from(d.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
    );
    if (ownText) textBearing++;
    if (!interactiveShaped && isHoverDiscoveryShape(domShapeOf(d))) {
      interactiveShaped = true;
    }
  }
  return {
    elementChildCount: el.children.length,
    textBearingElementDescendantCount: textBearing,
    textLength: text.length,
    hasNewline: text.includes('\n'),
    hasInteractiveShapedDescendant: interactiveShaped,
  };
}

/**
 * pointerCursor as an OWN-BOUNDARY fact (hover-capture generic fix v1,
 * cursor-inheritance amendment). `cursor` is an INHERITED CSS property:
 * Chrome's UA stylesheet puts `cursor: pointer` on `a[href]`, so every
 * child of a link (icon glyphs, spans) inherits pointer and would look
 * "interactive-shaped" under the raw computed-style read. The cursor only
 * signals an affordance when it CHANGES at the element boundary.
 *
 * This is pure CSS semantics — no vocabulary, no site knowledge. Applied
 * uniformly to both DOM-edge producers of the shape facts
 * (domShapeOf here and DomContext.pointerCursor in
 * definitions/dom-context-extractor.ts — T3 sync point).
 */
export function ownBoundaryPointerCursor(el: Element): boolean | null {
  try {
    if (typeof window === 'undefined' || !(el instanceof Element)) return null;
    const own = window.getComputedStyle(el).cursor;
    if (own !== 'pointer') return false;
    // Pointer at the element; true only if the parent is not already
    // pointer (inherited ≠ own affordance signal).
    const parent = el.parentElement;
    if (!parent) return true;
    return window.getComputedStyle(parent).cursor !== 'pointer';
  } catch {
    return null;
  }
}

/** DomContext-style shape facts for a live element (G3 shape test, DOM form). */
export function domShapeOf(el: Element): {
  tag: string;
  ariaRole: string | null;
  tabIndex: number | null;
  ariaHasPopup: string | null;
  clickHandler: boolean | null;
  pointerCursor: boolean | null;
} {
  const html = el as HTMLElement;
  let role: string | null = el.getAttribute('role');
  if (!role) {
    const tag = el.tagName;
    if (tag === 'A' && el.getAttribute('href')) role = 'link';
    else if (tag === 'BUTTON' || tag === 'SUMMARY') role = 'button';
    else if (tag === 'SELECT') role = 'listbox';
  }
  const pointer = ownBoundaryPointerCursor(el);
  return {
    tag: el.tagName,
    ariaRole: role,
    tabIndex: html.tabIndex ?? null,
    ariaHasPopup: el.getAttribute('aria-haspopup'),
    clickHandler: el.hasAttribute('onclick'),
    pointerCursor: pointer,
  };
}

/**
 * G1: resolve the HOVER anchor — the element under the pointer.
 *
 * Unlike resolveTarget (click-lifting, nearest interactive/cursor ancestor,
 * kept for clicks per CQ v1.2), the hover anchor lifts only to the enclosing
 * interactive control, never into unnamed wrappers:
 *   1. raw is hover-shaped → raw;
 *   2. nearest hover-shaped ancestor (path/parent walk, stop at BODY);
 *   3. optional caller-provided fallback (e.g. scoped hoverReveal probe
 *      result) when nothing else shaped exists;
 *   4. else the raw element (honest pointer element — discovery decides).
 * Never returns HTML/BODY.
 */
export type HoverAnchorResolution =
  | 'self'
  | 'ancestor-lift'
  | 'reveal-target'
  | 'body';

export interface ResolvedHoverAnchor {
  /** The hover anchor element (G1 outcome). */
  target: Element;
  /** Which G1 branch produced it — recorded fact (HEC v1 R-A4). */
  resolution: HoverAnchorResolution;
}

/**
 * G1: resolve the HOVER anchor — the element under the pointer.
 *
 * Unlike resolveTarget (click-lifting, nearest interactive/cursor ancestor,
 * kept for clicks per CQ v1.2), the hover anchor lifts only to the enclosing
 * interactive control, never into unnamed wrappers:
 *   1. raw is hover-shaped → raw;
 *   2. nearest hover-shaped ancestor (path/parent walk, stop at BODY);
 *   3. optional caller-provided fallback (e.g. scoped hoverReveal probe
 *      result) when nothing else shaped exists;
 *   4. else the raw element (honest pointer element — discovery decides).
 * Never returns HTML/BODY.
 *
 * HEC v1 R-A4: also reports WHICH branch resolved, so the capture layer can
 * record the honest resolution fact (never re-derived downstream).
 */
export function resolveHoverAnchor(
  raw: Element,
  hoverRevealTarget: Element | null,
): ResolvedHoverAnchor {
  const isBody =
    raw === document.body || raw === document.documentElement;
  if (isBody) return { target: raw, resolution: 'body' };

  if (isHoverDiscoveryShape(domShapeOf(raw))) {
    return { target: raw, resolution: 'self' };
  }

  // Nearest shaped ancestor — bounded walk, stop at BODY.
  let cur: Element | null = raw.parentElement;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (isHoverDiscoveryShape(domShapeOf(cur))) {
      return { target: cur, resolution: 'ancestor-lift' };
    }
    cur = cur.parentElement;
  }

  if (hoverRevealTarget) {
    return { target: hoverRevealTarget, resolution: 'reveal-target' };
  }
  return { target: raw, resolution: 'self' };
}

/**
 * G1 (legacy signature): resolve the HOVER anchor element alone.
 * Kept for existing call sites; new callers should prefer
 * {@link resolveHoverAnchor} to also obtain the R-A4 resolution fact.
 */
export function resolveHoverTarget(
  raw: Element,
  hoverRevealTarget: Element | null,
): Element {
  return resolveHoverAnchor(raw, hoverRevealTarget).target;
}

/** Reveal properties that make a :hover rule a reveal rule (G3). */
const HOVER_REVEAL_PROBE_PROPS = new Set([
  'display', 'visibility', 'opacity', 'transform', 'height', 'max-height',
  'width', 'max-width', 'pointer-events', 'top', 'left', 'right', 'bottom',
  'clip', 'clip-path', 'overflow',
]);

/** Result cache per element (WeakMap — dead elements are collected). */
const hoverRevealCache = new WeakMap<Element, boolean>();

function collectRules(group: CSSRuleList, out: CSSStyleRule[]): void {
  for (let i = 0; i < group.length; i++) {
    const rule = group[i];
    if (rule instanceof CSSStyleRule) out.push(rule);
    else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) {
      try { collectRules((rule as CSSGroupingRule).cssRules, out); } catch { /* CORS */ }
    }
  }
}

function selectorHasHover(selector: string): boolean {
  // Paren-aware scan for the `:hover` pseudo-class at top level.
  let depth = 0;
  for (let i = 0; i < selector.length - 6; i++) {
    const ch = selector[i];
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth === 0 && ch === ':' && selector.startsWith(':hover', i)) return true;
  }
  return false;
}

function ruleReveals(rule: CSSStyleRule): boolean {
  for (const prop of ['display', 'visibility', 'opacity', 'transform', 'height', 'max-height', 'width', 'max-width', 'pointer-events', 'top', 'left', 'right', 'bottom', 'clip', 'clip-path', 'overflow']) {
    const v = rule.style.getPropertyValue(prop);
    if (v && v !== '' && HOVER_REVEAL_PROBE_PROPS.has(prop)) {
      // A :hover rule that SETS a reveal property (vs inheriting the
      // base-state) counts; opaque values like `transform` also count.
      return true;
    }
  }
  return false;
}

/**
 * G3: scoped `:hover`-reveal CSS fact. True when a `:hover` rule on the
 * element or an ancestor (<=5) changes a reveal property for a descendant or
 * self. Pure DOM+CSS read; WeakMap-cached per element. Recorded at the
 * capture instant only when G1 reaches the fallback path (rare) — the SW
 * discovery gate ORs it with the shape test.
 */
export function computeHoverReveal(el: Element): boolean {
  const cached = hoverRevealCache.get(el);
  if (cached !== undefined) return cached;
  let result = false;
  try {
    const ancestors: Element[] = [];
    let cur: Element | null = el;
    let depth = 0;
    while (cur && depth < 5) {
      ancestors.push(cur);
      cur = cur.parentElement;
      depth++;
    }
    const rules: CSSStyleRule[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try { collectRules(sheet.cssRules, rules); } catch { /* CORS sheet */ }
    }
    for (const rule of rules) {
      if (!selectorHasHover(rule.selectorText)) continue;
      if (!ruleReveals(rule)) continue;
      // Does the :hover subject (selector prefix before :hover) match the
      // element or one of its probed ancestors? A bare `:hover` matches
      // anything. The reveal TARGET often does not exist in the DOM yet
      // (inserted on hover, or hidden) — matching the subject is the
      // honest, DOM-state-independent evidence of a hover-reveal rule.
      const selectors = rule.selectorText.split(',').map((s) => s.trim()).filter(Boolean);
      for (const sel of selectors) {
        const hoverIdx = sel.indexOf(':hover');
        if (hoverIdx === -1) continue;
        const base = sel.slice(0, hoverIdx).trim();
        let baseMatches: boolean;
        try {
          baseMatches = base === '' || el.matches(base) || ancestors.some((a) => {
            try { return a.matches(base); } catch { return false; }
          });
        } catch { continue; }
        if (baseMatches) { result = true; break; }
      }
      if (result) break;
    }
  } catch { result = false; }
  hoverRevealCache.set(el, result);
  return result;
}

// ── CSS Selector & XPath Generation ────────────────────────────────────

export function generateCssSelector(el: Element): string {
  const id = el.id;
  if (id) return `#${cssEscape(id)}`;

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  const MAX_DEPTH = 5;

  while (current && current !== document.documentElement && depth < MAX_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings: Element[] = Array.from(parent.children).filter(
      (s) => s.tagName === current!.tagName,
    );
    if (siblings.length === 1) parts.unshift(tag);
    else parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
    current = parent;
    depth++;
  }
  return parts.join(' > ');
}

export function generateXPath(el: Element): string {
  const id = el.id;
  if (id) return `//${el.tagName.toLowerCase()}[@id='${id}']`;

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  const MAX_DEPTH = 10;

  while (current && current !== document.documentElement && depth < MAX_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings: Element[] = Array.from(parent.children).filter(
      (s) => s.tagName === current!.tagName,
    );
    if (siblings.length === 1) parts.unshift(tag);
    else parts.unshift(`${tag}[${siblings.indexOf(current) + 1}]`);
    current = parent;
    depth++;
  }
  return '//' + parts.join('/');
}

// ── Shadow DOM Detection ───────────────────────────────────────────────

function isInShadowDom(el: Element): boolean {
  const root = el.getRootNode();
  return root instanceof ShadowRoot;
}

// ── Iframe Context ─────────────────────────────────────────────────────

function extractIframeContext(): {
  inIframe: boolean;
  context: IframeContext | undefined;
} {
  const inIframe = window !== window.top;
  if (!inIframe) {
    return { inIframe: false, context: undefined };
  }

  const frameSrc = window.location.href;
  let frameName: string | null = null;
  let frameId: string | null = null;
  let frameSelector: string | null = null;
  let frameXPath: string | null = null;
  let frameIndex: number | null = null;

  try {
    const parentDoc = window.parent.document;
    const frames = Array.from(parentDoc.querySelectorAll('iframe'));
    for (let i = 0; i < frames.length; i++) {
      try {
        if (frames[i].contentWindow === window) {
          frameName = frames[i].name || null;
          frameId = frames[i].id || null;
          frameIndex = i;
          frameSelector = generateCssSelector(frames[i]);
          frameXPath = generateXPath(frames[i]);
          break;
        }
      } catch { /* cross-origin parent */ }
    }
  } catch { /* cross-origin parent */ }

  let frameDepth = 1;
  let w: Window = window;
  try {
    while (w.parent && w.parent !== w) { frameDepth++; w = w.parent; }
  } catch { /* cross-origin ancestor */ }

  return {
    inIframe: true,
    context: {
      frameSrc, frameName, frameId, frameSelector, frameXPath, frameIndex, frameDepth,
    },
  };
}

// ── Main Export ────────────────────────────────────────────────────────

/**
 * Extract a complete ElementIdentity from a live DOM element.
 *
 * This is the single function the EventTap calls to snapshot an element's
 * identity at capture time. The result is immutable — it will not change
 * even if the DOM mutates later.
 *
 * Architecture: V3.1 freeze §3 (frozen identity model, 18 fields)
 */
export function extractIdentity(el: Element): ElementIdentity {
  const { inIframe, context: iframeContext } = extractIframeContext();
  const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');

  const identity: ElementIdentity = {
    accessibleName: computeAccessibleName(el),
    ariaRole: getImplicitRole(el),
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledBy: el.getAttribute('aria-labelledby'),
    placeholder: placeholder ?? null,
    tag: el.tagName,
    className: el instanceof HTMLElement ? el.className || null : null,
    name: el.getAttribute('name'),
    stableId: el.id || null,
    testId: el.getAttribute('data-testid'),
    dataCy: el.getAttribute('data-cy'),
    dataQa: el.getAttribute('data-qa'),
    // 6B: alternate test-ID convention family. getAttribute returns '' for
    // data-auto-id="" — normalize to null so absence is honest (matches the
    // testId/dataCy/dataQa siblings' getAttribute behavior above for absent
    // attrs, and keeps empty-string ids out of the BUSINESS tier).
    dataAutoId: el.getAttribute('data-auto-id') || null,
    // 7.3 W-B: bare `auto-id` spelling — same industry QA convention, own
    // family. Empty string normalizes to null (honest absence, mirrors the
    // dataAutoId rule). Independent of dataAutoId — both fields carry their
    // own attribute's value when both spellings are present.
    autoId: el.getAttribute('auto-id') || null,
    cssSelector: generateCssSelector(el),
    xPath: generateXPath(el),
    inIframe,
    shadowDom: isInShadowDom(el),
    href: el.getAttribute('href') ?? null,
    inputType: (el instanceof HTMLInputElement ||
                el instanceof HTMLSelectElement ||
                el instanceof HTMLTextAreaElement)
      ? (el as HTMLInputElement).type ?? null
      : null,
    elementId: '',
    ...(iframeContext ? { iframeContext } : {}),
  };

  return identity;
}

// ── Value / Checked State Capture ──────────────────────────────────────

/**
 * Capture the current value of an element.
 * Used for valueBefore/valueAfter tracking in ObservedEvent.
 *
 * P1-4 fix: Added textContent fallback for custom dropdown triggers
 * (divs with role=combobox, role=listbox, aria-haspopup) where the
 * selected value is in the element's text, not a .value property.
 */
export function captureValue(el: Element): string | undefined {
  if (el instanceof HTMLSelectElement) {
    // P3-7: For multi-select, capture ALL selected options
    if (el.multiple && el.selectedOptions.length > 1) {
      return Array.from(el.selectedOptions)
        .map((opt) => opt.text?.trim() || opt.textContent?.trim() || opt.value || '')
        .join(', ');
    }
    const option = el.options[el.selectedIndex];
    if (option) return option.text?.trim() || option.textContent?.trim() || option.value || '';
    return '';
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value ?? '';
  }
  const ariaValueText = el.getAttribute('aria-valuetext');
  if (ariaValueText !== null) return ariaValueText;
  const ariaValueNow = el.getAttribute('aria-valuenow');
  if (ariaValueNow !== null) return ariaValueNow;
  if (el instanceof HTMLElement && el.isContentEditable) {
    return el.innerText?.trim() || el.textContent?.trim() || '';
  }
  const selected = el.querySelector('[aria-selected="true"]');
  if (selected) return selected.textContent?.trim() || selected.getAttribute('aria-label') || '';
  const descendantId = el.getAttribute('aria-activedescendant');
  if (descendantId) {
    const option = deepGetElementById(descendantId);
    if (option) return option.textContent?.trim() || option.getAttribute('aria-label') || '';
  }

  // P1-4 fix: Custom dropdown trigger fallback.
  // For elements with combobox/listbox role or aria-haspopup, the
  // selected value is typically the element's textContent (trimmed).
  const role = el.getAttribute('role');
  const hasPopup = el.hasAttribute('aria-haspopup');
  if (role === 'combobox' || role === 'listbox' || hasPopup) {
    const text = (el as HTMLElement).textContent?.trim();
    if (text) return text.slice(0, 200); // bound to prevent huge values
  }

  // Fix Round 6: Broader fallback for custom select widgets that lack ARIA.
  // Common in OrangeHRM, SAP, Salesforce: div.select-wrapper > div.select-text.
  // Check for class-based detection and look for a child text display element.
  const cls = (el as HTMLElement).className ?? '';
  if (/\b(select|dropdown|combobox|choice)\b/i.test(cls)) {
    const text = (el as HTMLElement).textContent?.trim();
    if (text && text.length <= 200) return text;
  }

  return undefined;
}

/**
 * Capture the current checked state of an element.
 * Used for checkedBefore/checkedAfter tracking in ObservedEvent.
 *
 * Checks: native input.checked → aria-checked → aria-pressed → CSS class fallback.
 */
export function captureCheckedState(el: Element): boolean | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  }
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked !== null) return ariaChecked === 'true';
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed !== null) return ariaPressed === 'true';

  // CSS-class-based fallback for custom checkboxes/switches without ARIA.
  const cls = (el.getAttribute('class') || '').toLowerCase();
  if (cls) {
    if (
      cls.includes('mui-checked') ||
      cls.includes('ant-checkbox-checked') ||
      cls.includes('ant-radio-checked') ||
      cls.includes('ant-switch-checked') ||
      cls.includes('checked')
    ) {
      if (cls.includes('unchecked') || cls.includes('not-checked')) return false;
      return true;
    }
  }

  return undefined;
}

// ── Target Resolution ──────────────────────────────────────────────────

/**
 * Elements that should NEVER be captured as click targets.
 *
 * 7.4-B3 S4: BODY and HTML REMOVED from this set. A click on empty page
 * background is a real user gesture (click-away dismissal is the dominant
 * SPA pattern) and was silently dropped at capture — the honest artifact
 * is an Unclassified card, not silence. The census script classifies these
 * as `body-structural`. All genuinely structural tags (head-level metadata,
 * SVG internals) remain rejected.
 */
const NON_INTERACTIVE_TAGS = new Set([
  'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META',
  'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'G', 'DEFS', 'RECT',
  'CIRCLE', 'LINE', 'POLYLINE', 'POLYGON', 'USE', 'CLIPPATH',
]);

const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'summary', 'select', 'option', 'textarea', 'input',
  'form', '[contenteditable]',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
  '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="option"]',
  '[role="switch"]', '[role="treeitem"]', '[role="checkbox"]', '[role="radio"]',
  '[role="gridcell"]', '[role="combobox"]', '[role="textbox"]', '[role="spinbutton"]',
  '[role="slider"]', '[role="group"]', '[role="radiogroup"]',
  '[tabindex]', '[onclick]', '[data-action]', '[data-toggle]', '[data-bs-toggle]',
  '[aria-haspopup]',
  // 7.3 W-B: QA-instrumented targets (industry auto-id convention, both
  // spellings). resolveTarget stops at / walks up to these when the click
  // leaf is a plain non-interactive descendant — leaf-first composedPath
  // order keeps genuinely interactive inner elements (button, a[href],
  // [role=button], …) winning over the instrumented ancestor.
  '[auto-id]', '[data-auto-id]',
].join(', ');

/**
 * Resolve the target element from a DOM event.
 * Uses composedPath() to pierce Shadow DOM boundaries.
 * NEVER drops an interaction — if no interactive element is found, returns the raw target.
 *
 * Strategy:
 *   1. composedPath → find first element matching INTERACTIVE_SELECTOR
 *   2. If not found, walk parents to find interactive element
 *   3. If not found, composedPath → find clickable heuristic (cursor:pointer, onclick)
 *   4. If nothing, return raw target (if not structural)
 *
 * Architecture: V3.1 freeze §2 (composedPath for shadow DOM)
 */
export function resolveTarget(event: Event | null | undefined): Element | null {
  if (!event) return null;
  const path = event.composedPath();
  const target = path[0];
  if (!(target instanceof Element)) return null;

  // Strategy 1: Find first interactive element in the path
  for (const el of path) {
    if (!(el instanceof Element)) continue;
    if (NON_INTERACTIVE_TAGS.has(el.tagName)) continue;
    if (el.matches(INTERACTIVE_SELECTOR)) return el;
  }

  // Strategy 1b: Walk parents from raw target for interactive elements
  let current: Element | null = target;
  while (current && !NON_INTERACTIVE_TAGS.has(current.tagName)) {
    if (current.matches(INTERACTIVE_SELECTOR)) return current;
    current = current.parentElement;
  }

  // Strategy 2: Clickable heuristic (cursor:pointer or onclick)
  for (const el of path) {
    if (!(el instanceof Element)) continue;
    if (NON_INTERACTIVE_TAGS.has(el.tagName)) continue;
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer') return el;
    if (el.hasAttribute('onclick')) return el;
  }

  // Strategy 3: Raw target (if not structural)
  if (!NON_INTERACTIVE_TAGS.has(target.tagName)) return target;

  return null;
}
