/**
 * Observer Helpers — consolidated identity extraction logic
 *
 * Architecture C — Phase 4
 * Blueprint: .drytis/architecture-c-production.md §4
 *
 * These pure functions are extracted from the 6 legacy content scripts
 * into a single consolidated location. They are unit-testable with jsdom.
 *
 * Canonical implementations chosen from the most complete version in each
 * script (see .drytis/specs/phase4-universal-observer.md for decision log).
 */

import type { ElementIdentity, IframeContext } from '../../shared/types';
import type { MutationSummary } from '../../shared/evidence-types';

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

// ── Implicit Role (from click-content-script.ts lines 437–514) ─────────

const TAG_ROLE_MAP: Record<string, string> = {
  A: 'link',
  BUTTON: 'button',
  NAV: 'navigation',
  MAIN: 'main',
  HEADER: 'banner',
  FOOTER: 'contentinfo',
  ASIDE: 'complementary',
  ARTICLE: 'article',
  SECTION: 'region',
  FORM: 'form',
  SEARCH: 'search',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  UL: 'list',
  OL: 'list',
  LI: 'listitem',
  TABLE: 'table',
  TR: 'row',
  TH: 'columnheader',
  TD: 'cell',
  DETAILS: 'group',
  DIALOG: 'dialog',
  IMG: 'img',
  FIGURE: 'figure',
  FIGCAPTION: 'caption',
  SELECT: 'listbox',
  OPTION: 'option',
  TEXTAREA: 'textbox',
  SUMMARY: 'button',
  I: 'img',
  SVG: 'img',
};

const INPUT_TYPE_ROLE_MAP: Record<string, string> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  text: 'textbox',
  email: 'textbox',
  password: 'textbox',
  search: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  number: 'spinbutton',
  range: 'slider',
  color: 'textbox',
  date: 'textbox',
  'datetime-local': 'textbox',
  time: 'textbox',
  file: 'textbox',
};

/**
 * Get the implicit/explicit ARIA role for an element.
 *
 * Explicit role attribute takes precedence; falls back to tag-based mapping.
 */
export function getImplicitRole(el: Element): string | null {
  const explicitRole = el.getAttribute('role');
  if (explicitRole && explicitRole.trim()) {
    return explicitRole.trim();
  }

  const tag = el.tagName;

  if (tag === 'INPUT') {
    const type = el.getAttribute('type') || 'text';
    return INPUT_TYPE_ROLE_MAP[type] || null;
  }

  return TAG_ROLE_MAP[tag] || null;
}

// ── Accessible Name (from click-content-script.ts lines 344–427) ───────

/**
 * Compute an accessible name for an element using the 9-level cascade.
 *
 * Priority: aria-label > aria-labelledby > innerText > textContent >
 * label[for] > placeholder (incl. aria-placeholder) > value (button) >
 * alt (img) > title.
 *
 * Returns '' if no accessible name can be derived.
 */
export function computeAccessibleName(el: Element): string {
  // a. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return truncate(ariaLabel.trim(), 200);
  }

  // b. aria-labelledby (may reference multiple IDs)
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const texts: string[] = [];
    for (const id of ids) {
      const target = document.getElementById(id);
      if (target) {
        const text = target.textContent?.trim();
        if (text) texts.push(text);
      }
    }
    if (texts.length > 0) {
      return truncate(texts.join(' '), 200);
    }
  }

  // c. For form controls, check label association BEFORE innerText/textContent.
  // This is critical: <select> elements have textContent = all option text
  // concatenated, which is NOT the field's accessible name. The field label
  // (via <label for> or enclosing <label>) is the correct name.
  const isFormControl = el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

  if (isFormControl) {
    // c1. <label for> association
    const elId = el.id;
    if (elId) {
      const label = document.querySelector(`label[for="${cssEscape(elId)}"]`);
      if (label) {
        const labelText = label.textContent?.trim();
        if (labelText) {
          return truncate(labelText, 200);
        }
      }
    }

    // c2. Enclosing <label> (input inside <label>...</label> — common pattern)
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const labelText = parentLabel.textContent?.trim();
      if (labelText) {
        return truncate(labelText, 200);
      }
    }

    // c3. For <select>, use the selected option's text, not all options
    if (el instanceof HTMLSelectElement && el.selectedIndex >= 0) {
      const opt = el.options[el.selectedIndex];
      const optText = opt?.textContent?.trim();
      if (optText) {
        return truncate(optText, 200);
      }
    }
  }

  // d. innerText (rendered text)
  if (el instanceof HTMLElement) {
    const inner = el.innerText?.trim();
    if (inner) {
      return truncate(inner, 200);
    }
  }

  // e. textContent (DOM text)
  const textContent = el.textContent?.trim();
  if (textContent) {
    return truncate(textContent, 200);
  }

  // f. placeholder (check both placeholder and aria-placeholder)
  const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
  if (placeholder && placeholder.trim()) {
    return truncate(placeholder.trim(), 200);
  }

  // g. value (for button-type inputs)
  const value = (el as HTMLInputElement).value;
  if (value && value.trim() && el.tagName === 'INPUT') {
    const type = el.getAttribute('type');
    if (type === 'button' || type === 'submit' || type === 'reset') {
      return truncate(value.trim(), 200);
    }
  }

  // h. alt text (img, input[type=image])
  const alt = el.getAttribute('alt');
  if (alt && alt.trim()) {
    const tag = el.tagName;
    if (tag === 'IMG' || (tag === 'INPUT' && el.getAttribute('type') === 'image')) {
      return truncate(alt.trim(), 200);
    }
  }

  // i. title
  const title = el.getAttribute('title');
  if (title && title.trim()) {
    return truncate(title.trim(), 200);
  }

  return '';
}

// ── CSS Selector Generation (from click-content-script.ts 529–566) ─────

/**
 * Generate a CSS selector for an element.
 *
 * Strategy: #id if present, otherwise nth-of-type chain (max 5 ancestors).
 */
export function generateCssSelector(el: Element): string {
  const id = el.id;
  if (id) {
    return `#${cssEscape(id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  const MAX_DEPTH = 5;

  while (current && current !== document.documentElement && depth < MAX_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;

    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const siblings: Element[] = Array.from(parent.children).filter(
      (s) => s.tagName === current!.tagName,
    );
    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${index})`);
    }

    current = parent;
    depth++;
  }

  return parts.join(' > ');
}

// ── XPath Generation (from click-content-script.ts 577–614) ────────────

/**
 * Generate an XPath for an element.
 *
 * Strategy: //tag[@id='id'] if id present, otherwise positional path.
 * Uses `//` prefix (anywhere in document).
 */
export function generateXPath(el: Element): string {
  const id = el.id;
  if (id) {
    return `//${el.tagName.toLowerCase()}[@id='${id}']`;
  }

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  const MAX_DEPTH = 10;

  while (current && current !== document.documentElement && depth < MAX_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;

    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const siblings: Element[] = Array.from(parent.children).filter(
      (s) => s.tagName === current!.tagName,
    );
    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}[${index}]`);
    }

    current = parent;
    depth++;
  }

  return '//' + parts.join('/');
}

// ── Shadow DOM Detection (Implementation A — simple) ───────────────────

/**
 * Check whether an element is inside a Shadow DOM.
 */
export function isInShadowDom(el: Element): boolean {
  const root = el.getRootNode();
  return root instanceof ShadowRoot;
}

// ── Iframe Context (from click-content-script.ts 635–713) ──────────────

/**
 * Extract iframe context information.
 *
 * Returns { inIframe: false, ... } when not in an iframe.
 * When in an iframe, attempts to find the iframe element in the parent
 * document (same-origin only). Cross-origin iframes get partial info.
 */
export function extractIframeContext(): {
  inIframe: boolean;
  frameSrc: string;
  frameName: string | null;
  frameId: string | null;
  frameSelector: string | null;
  frameXPath: string | null;
  frameIndex: number | null;
  frameDepth: number;
} {
  const inIframe = window !== window.top;

  if (!inIframe) {
    return {
      inIframe: false,
      frameSrc: '',
      frameName: null,
      frameId: null,
      frameSelector: null,
      frameXPath: null,
      frameIndex: null,
      frameDepth: 0,
    };
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
      } catch {
        // Cross-origin iframe inside this one — skip
      }
    }
  } catch {
    // Cross-origin: cannot access parent document
  }

  let frameDepth = 1;
  let w: Window = window;
  try {
    while (w.parent && w.parent !== w) {
      frameDepth++;
      w = w.parent;
    }
  } catch {
    // Cross-origin — stop counting
  }

  return {
    inIframe: true,
    frameSrc,
    frameName,
    frameId,
    frameSelector,
    frameXPath,
    frameIndex,
    frameDepth,
  };
}

// ── Identity Extraction (consolidated from click-content-script.ts 757–792) ─

/**
 * Build a complete ElementIdentity for a DOM element.
 *
 * Consolidates all 18 fields: accessibleName, ariaRole, ariaLabel,
 * ariaLabelledBy, placeholder, tag, className, name, stableId, testId,
 * dataCy, dataQa, cssSelector, xPath, inIframe, shadowDom, iframeContext,
 * elementId.
 *
 * The elementId is generated deterministically from the identity fields.
 */
export function extractIdentity(el: Element): ElementIdentity {
  const iframeCtx = extractIframeContext();
  const placeholder =
    el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
  const className =
    el instanceof HTMLElement ? el.className || null : null;

  const identity: ElementIdentity = {
    accessibleName: computeAccessibleName(el),
    ariaRole: getImplicitRole(el),
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledBy: el.getAttribute('aria-labelledby'),
    placeholder: placeholder ?? null,
    tag: el.tagName,
    className,
    name: el.getAttribute('name'),
    stableId: el.id || null,
    testId: el.getAttribute('data-testid'),
    dataCy: el.getAttribute('data-cy'),
    dataQa: el.getAttribute('data-qa'),
    cssSelector: generateCssSelector(el),
    xPath: generateXPath(el),
    inIframe: iframeCtx.inIframe,
    shadowDom: isInShadowDom(el),
    elementId: '', // assigned by service worker on receipt
  };

  if (iframeCtx.inIframe) {
    identity.iframeContext = {
      frameSrc: iframeCtx.frameSrc,
      frameName: iframeCtx.frameName,
      frameId: iframeCtx.frameId,
      frameSelector: iframeCtx.frameSelector,
      frameXPath: iframeCtx.frameXPath,
      frameIndex: iframeCtx.frameIndex,
      frameDepth: iframeCtx.frameDepth,
    } satisfies IframeContext;
  }

  return identity;
}

// ── Value / State Capture ──────────────────────────────────────────────

/**
 * Capture the value of an input/select/textarea element.
 *
 * For native <select>, returns the selected option's text.
 * For inputs/textareas, returns the .value property.
 * Returns null for non-value elements.
 */
export function captureValue(el: Element): string | undefined {
  // Native select
  if (el instanceof HTMLSelectElement) {
    const option = el.options[el.selectedIndex];
    if (option) {
      return option.text?.trim() || option.textContent?.trim() || option.value || '';
    }
    return '';
  }

  // Input / textarea
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value ?? '';
  }

  // ARIA listbox: find [aria-selected="true"] child
  const selected = el.querySelector('[aria-selected="true"]');
  if (selected) {
    return selected.textContent?.trim() || selected.getAttribute('aria-label') || '';
  }

  // ARIA combobox: aria-activedescendant
  const descendantId = el.getAttribute('aria-activedescendant');
  if (descendantId) {
    const option = document.getElementById(descendantId);
    if (option) {
      return option.textContent?.trim() || option.getAttribute('aria-label') || '';
    }
  }

  return undefined;
}

/**
 * Capture the checked/pressed state of a checkbox/radio/ARIA toggle.
 */
export function captureCheckedState(el: Element): boolean | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      return el.checked;
    }
  }

  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked !== null) {
    return ariaChecked === 'true';
  }

  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed !== null) {
    return ariaPressed === 'true';
  }

  return undefined;
}

/**
 * Capture ARIA-related state as a string for evidence.
 */
export function captureAriaState(el: Element): string | undefined {
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked !== null) return `aria-checked=${ariaChecked}`;

  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed !== null) return `aria-pressed=${ariaPressed}`;

  const ariaSelected = el.getAttribute('aria-selected');
  if (ariaSelected !== null) return `aria-selected=${ariaSelected}`;

  return undefined;
}

// ── Interactive Element Detection ──────────────────────────────────────

/**
 * Selector matching elements that are semantically interactive.
 *
 * Used by resolveTarget() to walk composedPath() and find the nearest
 * interactive ancestor of the raw event target. This ensures that when a
 * user clicks a <span> inside a <button>, we resolve to the <button> —
 * not the <span>, and not a distant ancestor like <main>.
 *
 * This is the SAME set of selectors used by the legacy click-content-script's
 * resolveClickTarget() (Milestone 2 architecture), now consolidated here for
 * Pipeline V2's event observer.
 */
const INTERACTIVE_SELECTOR = [
  // Native semantic tags
  'a[href]',
  'button',
  'summary',
  'select',
  'option',
  'textarea',
  'input',
  'form',
  '[contenteditable]',
  // ARIA interactive roles
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="treeitem"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="gridcell"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="spinbutton"]',
  '[role="slider"]',
  // Explicit interactivity signals
  '[tabindex]',
  '[onclick]',
  '[data-action]',
  '[data-toggle]',
  '[data-bs-toggle]',
  '[aria-haspopup]',
].join(', ');

/**
 * Check if an element is semantically interactive.
 */
function isInteractive(el: Element): boolean {
  try {
    return el.matches(INTERACTIVE_SELECTOR);
  } catch {
    return false;
  }
}

// ── Target Resolution ──────────────────────────────────────────────────

/**
 * Resolve the target element from an event.
 *
 * Walks event.composedPath() to find the nearest interactive element.
 * composedPath() crosses Shadow DOM boundaries (unlike closest()).
 *
 * This ensures that when a user clicks a deeply nested element (e.g., a
 * <span> inside an <svg> inside a <button>), we resolve to the <button> —
 * the element the user actually intended to interact with — rather than
 * the raw event target or a distant ancestor like <main>.
 *
 * Resolution strategy (in priority order):
 *   1. Walk composedPath() for nearest interactive element (crosses shadow)
 *   2. Walk parentElement chain (fallback if composedPath unavailable)
 *   3. Return null — the click is on a non-interactive area and should be
 *      dropped by the observer. This prevents the timeline from filling
 *      with noise clicks on container elements like <div>, <main>, <nav>,
 *      <section>, etc.
 *
 * Architecture Principle: resolve to the FIRST interactive ancestor.
 * Do not keep going higher. If no interactive ancestor exists, the click
 * is not on a meaningful control — return null so the observer can drop it.
 */
export function resolveTarget(event: Event): Element | null {
  const rawTarget = event.target;
  if (!rawTarget || !(rawTarget instanceof Element)) {
    return null;
  }

  // Strategy 1: Walk composedPath for the nearest interactive element.
  // composedPath() includes all elements from the event target up through
  // Shadow DOM boundaries to the document — this is the authoritative path.
  if (typeof event.composedPath === 'function') {
    const path = event.composedPath();
    for (const node of path) {
      if (node instanceof Element && isInteractive(node)) {
        return node;
      }
    }
  }

  // Strategy 2: Fall back to parentElement walk (doesn't cross shadow,
  // but handles cases where composedPath is not available).
  let current: Element | null = rawTarget;
  while (current) {
    if (isInteractive(current)) {
      return current;
    }
    current = current.parentElement;
  }

  // Strategy 3: No interactive element found in the path.
  // Return null so the observer drops this click — it's on a non-interactive
  // area (empty div, container, body background, etc.) and would only
  // pollute the timeline with noise.
  return null;
}

// ── Mutation Summarization ─────────────────────────────────────────────

const RELEVANT_MUTATION_ATTRS = new Set([
  'class',
  'style',
  'aria-expanded',
  'aria-hidden',
  'aria-selected',
  'aria-checked',
  'aria-pressed',
  'hidden',
]);

/**
 * Summarize a batch of MutationRecords into a MutationSummary.
 *
 * Called by the observer when the mutation window closes.
 */
export function summarizeMutations(mutations: MutationRecord[]): MutationSummary {
  const summary: MutationSummary = {
    childListAdded: 0,
    childListRemoved: 0,
    attributeChanges: 0,
    visibilityChanges: 0,
    semanticChanges: [],
  };

  for (const m of mutations) {
    if (m.type === 'childList') {
      summary.childListAdded += m.addedNodes.length;
      summary.childListRemoved += m.removedNodes.length;
      if (m.addedNodes.length > 0) {
        summary.semanticChanges.push(`childList:added:${m.addedNodes.length}`);
      }
      if (m.removedNodes.length > 0) {
        summary.semanticChanges.push(`childList:removed:${m.removedNodes.length}`);
      }
    } else if (m.type === 'attributes') {
      const attrName = m.attributeName;
      if (!attrName) continue;
      if (!RELEVANT_MUTATION_ATTRS.has(attrName)) continue;

      summary.attributeChanges++;

      // Track visibility transitions
      if (attrName === 'hidden' || attrName === 'aria-hidden' || attrName === 'style') {
        summary.visibilityChanges++;
      }

      // Track specific semantic changes
      const target = m.target as Element;
      const newValue = target.getAttribute(attrName);
      if (attrName === 'class' && newValue) {
        const classes = newValue.split(/\s+/);
        for (const cls of classes) {
          if (cls.includes('selected') || cls.includes('active') || cls.includes('open')) {
            summary.semanticChanges.push(`class:${cls}-added`);
          }
        }
      }
      if (attrName === 'aria-expanded') {
        summary.semanticChanges.push(`aria-expanded:${newValue}`);
      }
      if (attrName === 'aria-selected') {
        summary.semanticChanges.push(`aria-selected:${newValue}`);
      }
    }
  }

  return summary;
}
