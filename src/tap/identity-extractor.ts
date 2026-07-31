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

  // Tier 6: innerText
  if (el instanceof HTMLElement) {
    const inner = el.innerText?.trim();
    if (inner) return truncate(inner, 200);
  }

  // Tier 7: textContent
  const textContent = el.textContent?.trim();
  if (textContent) return truncate(textContent, 200);

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
    cssSelector: generateCssSelector(el),
    xPath: generateXPath(el),
    inIframe,
    shadowDom: isInShadowDom(el),
    elementId: '',
    ...(iframeContext ? { iframeContext } : {}),
  };

  return identity;
}

// ── Value / Checked State Capture ──────────────────────────────────────

/**
 * CSS class patterns that indicate a display-value element in React SPAs.
 * AdaniOne and similar apps render the selected value (date, city, class)
 * in a sibling element with a class like "value-display", "selected-value",
 * "display-text", etc., NOT in the trigger input's .value.
 */
const DISPLAY_VALUE_CLASS_RE =
  /(?:value-display|display-value|selected-value|display-text|field-value|input-value|selected-text|value-text|current-value|date-display|date-value|city-name|airport-name)/i;

/**
 * Find the display value of an element by scanning its siblings and parent.
 *
 * React SPAs render form fields as a composite: an INPUT (or hidden div)
 * as the trigger, plus a sibling display element showing the current value.
 * When the input's .value is empty but the UI shows a value, this function
 * finds it by looking at:
 *   1. Siblings with display-value CSS classes
 *   2. The parent container's direct text content (excluding the input)
 *
 * This is a last-resort fallback — it only runs when all standard value
 * extraction strategies return undefined.
 */
function findDisplayValue(el: Element): string | undefined {
  // Strategy 1: Look for a sibling with a display-value class
  const parent = el.parentElement;
  if (parent) {
    const siblings = parent.children;
    for (const sibling of siblings) {
      if (sibling === el) continue;
      if (sibling instanceof HTMLElement) {
        const cls = sibling.className || '';
        if (typeof cls === 'string' && DISPLAY_VALUE_CLASS_RE.test(cls)) {
          const text = sibling.innerText?.trim() || sibling.textContent?.trim();
          if (text) return text;
        }
      }
    }

    // Strategy 2: The parent container has a display text that isn't
    // the input element itself. This catches date/class selectors where
    // the visible value is direct text in the container.
    // Only do this if the parent is NOT a generic form wrapper.
    const parentClass = (parent.getAttribute('class') || '').toLowerCase();
    if (parentClass && (
      parentClass.includes('field') ||
      parentClass.includes('selector') ||
      parentClass.includes('picker') ||
      parentClass.includes('date') ||
      parentClass.includes('input-group') ||
      parentClass.includes('control')
    )) {
      // Get text content excluding the input element
      let displayText = '';
      for (const child of parent.children) {
        if (child === el) continue;
        if (child instanceof HTMLElement) {
          const text = child.innerText?.trim();
          if (text && text.length < 100) { // avoid grabbing large text blocks
            displayText = text;
            break;
          }
        }
      }
      if (displayText) return displayText;
    }
  }

  return undefined;
}

/**
 * Capture the current value of an element.
 * Used for valueBefore/valueAfter tracking in ObservedEvent.
 *
 * Tries multiple strategies in priority order:
 *   1. Native form controls (select, input, textarea)
 *   2. ARIA value attributes (aria-valuetext, aria-valuenow)
 *   3. Contenteditable elements
 *   4. aria-selected descendant (active option)
 *   5. aria-activedescendant reference
 *   6. Display-value fallback: scan nearby siblings for visible text that
 *      represents the current value. React SPAs (AdaniOne, etc.) render the
 *      selected date/city/class in a separate display div, NOT in the
 *      trigger input's .value. This fallback catches that pattern.
 */
export function captureValue(el: Element): string | undefined {
  if (el instanceof HTMLSelectElement) {
    const option = el.options[el.selectedIndex];
    if (option) return option.text?.trim() || option.textContent?.trim() || option.value || '';
    return '';
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value ?? '';
  }
  // ARIA value attributes — check BEFORE contenteditable/descendant lookups
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

  // Display-value fallback: React SPAs render the selected value in a
  // sibling display element, not in the trigger input. Look for a nearby
  // display span/div with a value-like class name.
  const displayValue = findDisplayValue(el);
  if (displayValue) return displayValue;

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

  // Descendant-based fallback: the element itself has no detectable checked
  // state, but it may wrap a native checkbox or an ARIA-checked child.
  // Amazon renders filter toggles as <a> wrapping <input type="checkbox">
  // or <i class="a-icon-checkbox">. Walk descendants to find the signal.
  const descendantChecked = findDescendantCheckedStateTap(el, 3);
  if (descendantChecked !== undefined) return descendantChecked;

  return undefined;
}

/**
 * Walk descendants (max depth) to find a checked-state signal.
 */
function findDescendantCheckedStateTap(el: Element, maxDepth: number): boolean | undefined {
  if (maxDepth <= 0) return undefined;
  const children = el.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child instanceof HTMLInputElement) {
      if (child.type === 'checkbox' || child.type === 'radio') return child.checked;
    }
    const childAriaChecked = child.getAttribute('aria-checked');
    if (childAriaChecked !== null) return childAriaChecked === 'true';
    const childCls = (child.getAttribute('class') || '').toLowerCase();
    if (childCls.includes('checkbox') || childCls.includes('checked')) {
      if (childCls.includes('unchecked') || childCls.includes('not-checked')) return false;
      return true;
    }
    const deeper = findDescendantCheckedStateTap(child, maxDepth - 1);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

// ── Target Resolution ──────────────────────────────────────────────────

/** Elements that should NEVER be captured as click targets. */
const NON_INTERACTIVE_TAGS = new Set([
  'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META',
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
  // With Change 1: collect the first clickable candidate, then walk up to
  // 3 parents looking for a clickable ancestor with a meaningful accessible
  // name (>2 chars). This resolves SVG icons inside buttons to the button
  // itself instead of the icon wrapper.
  let firstClickable: Element | null = null;
  for (const el of path) {
    if (!(el instanceof Element)) continue;
    if (NON_INTERACTIVE_TAGS.has(el.tagName)) continue;
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer' || el.hasAttribute('onclick')) {
      if (!firstClickable) firstClickable = el;
      // Check if this element has a meaningful accessible name
      const name = computeAccessibleName(el);
      if (name && name.trim().length > 2) return el;
    }
  }
  // If we found a clickable element but none had a meaningful name, walk up
  // to 3 parents from the first clickable candidate
  if (firstClickable) {
    let parent: Element | null = firstClickable;
    for (let i = 0; i < 3 && parent; i++) {
      parent = parent.parentElement;
      if (!parent || NON_INTERACTIVE_TAGS.has(parent.tagName)) break;
      const style = window.getComputedStyle(parent);
      if (style.cursor === 'pointer' || parent.hasAttribute('onclick') || parent.matches(INTERACTIVE_SELECTOR)) {
        const name = computeAccessibleName(parent);
        if (name && name.trim().length > 2) return parent;
      }
    }
    // Fall back to the first clickable element found
    return firstClickable;
  }

  // Strategy 2b: Selectable/option heuristic — React SPAs render dropdown
  // options, menu items, and listbox options as divs/spans without ARIA roles
  // or cursor:pointer. Check for common SPA option patterns via class and
  // attribute heuristics.
  for (const el of path) {
    if (!(el instanceof Element)) continue;
    if (NON_INTERACTIVE_TAGS.has(el.tagName)) continue;
    const cls = (el.getAttribute('class') || '').toLowerCase();
    // Match option/menu-item/selectable patterns common in React SPAs
    if (/(\boption\b|\bmenu-?item\b|\bselectable\b|\bselect-item\b|\bchoice\b|\bpickable\b|list-item|tile-item|radio-tile|class-option|fare-option|travel-class)/.test(cls)) {
      return el;
    }
    // aria-selected or aria-current indicates a selectable element
    if (el.getAttribute('aria-selected') !== null) return el;
    if (el.getAttribute('aria-current') !== null) return el;
  }

  // Strategy 3: Raw target (if not structural)
  if (!NON_INTERACTIVE_TAGS.has(target.tagName)) return target;

  return null;
}
