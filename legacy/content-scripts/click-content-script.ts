/**
 * Click Content Script — Detection, Resolution, Validation, Dedup,
 * Identity Extraction, and Classification of the Click interaction.
 *
 * Implements the frozen Milestone 2 Architecture:
 *   - Detection: click event only, capture phase, isTrusted + button 0
 *   - Target Resolution: composedPath() walking to nearest interactive element
 *   - Ownership: data-cmdrunner-handled check
 *   - Dedup: identity key comparison (not Element reference), holding window
 *   - Identity: extracted at click time, immutable after classification
 *   - Classification: sendMessage('CLICK_CAPTURED') = the interaction now exists
 *
 * This file is SELF-CONTAINED — content scripts run in an isolated world
 * and cannot import modules. All helpers are inlined.
 *
 * Principles (Milestone 2):
 *   5. Capture identity early, process later
 *   6. Classified identity is immutable
 *   7. Record only interactions that actually occur
 *   8. Confident classification or nothing
 *   9. Single responsibility — Click owns only Click
 */

// ── Recording State ────────────────────────────────────────

/**
 * Recording state flag, synced from chrome.storage.
 * The content script proactively checks this, but ALSO sends events
 * even if the flag is stale — the service worker makes the final
 * decision in processAction(). This prevents losing events due to
 * MV3 timing gaps where onChanged hasn't propagated yet.
 */
let isRecording = false;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const uiState = changes['ui_state'];
  if (uiState && uiState.newValue) {
    isRecording = uiState.newValue.recordingState === 'recording';
  }
});

// Sync initial state on script load
chrome.storage.local.get('ui_state').then((result) => {
  if (result['ui_state']) {
    isRecording = result['ui_state'].recordingState === 'recording';
  }
}).catch(() => {});

/**
 * Check if recording is active.
 * If the cached flag says yes, return true immediately.
 * If not, do a quick async storage check as fallback — the onChanged
 * listener may not have fired yet (MV3 timing gap on SPA pages).
 */
async function checkRecording(): Promise<boolean> {
  if (isRecording) return true;
  // Fallback: re-read storage directly
  try {
    const result = await chrome.storage.local.get('ui_state');
    if (result['ui_state']) {
      isRecording = result['ui_state'].recordingState === 'recording';
    }
  } catch {
    // ignore
  }
  return isRecording;
}

// ── Interactive Element Selector ──────────────────────────

/**
 * The selector defines what counts as a "clickable" element.
 * Three categories per the architecture (Milestone 2, Section 3):
 *
 * 1. Native semantic tags
 * 2. ARIA interactive roles
 * 3. Explicit interactivity signals
 */
const INTERACTIVE_SELECTOR = [
  // Native semantic tags
  'a[href]',
  'button',
  'summary',
  'select',
  'option',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="image"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
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
  // Explicit interactivity signals
  '[tabindex]',
  '[onclick]',
  '[data-action]',
  '[data-toggle]',
  '[data-bs-toggle]',
  '[aria-haspopup]',
  '[role="combobox"]',
].join(', ');

/**
 * Selector for checkbox and radio controls.
 *
 * C4.1 §6.2: Checkbox/Radio takes precedence over generic Click.
 * These controls are handled by checkbox-radio-content-script.ts,
 * which records the resulting STATE (Check/Uncheck/Select) rather
 * than the click itself. The click-content-script must NOT record
 * these targets to avoid duplicate events.
 *
 * This is the ownership boundary: checkbox/radio controls belong
 * to the specialized recorder, not the generic click recorder.
 */
const CHECKBOX_RADIO_SELECTOR = [
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="switch"]',
].join(', ');

/**
 * Selector for native <select> dropdown controls.
 *
 * C5.1 §7.2: Select takes precedence over generic Click when a value
 * change occurs. The select-content-script handles the change event
 * and claims ownership. However, the click event fires before change,
 * so we need to exclude <select> from click recording to avoid a
 * duplicate Click+Select for the same interaction.
 *
 * The initial click to OPEN the dropdown is still a legitimate click
 * and will fire on the <select> — but since the click event fires
 * before any option is selected, there is no value change yet. The
 * change event (with value change) is what gets recorded as Select.
 *
 * We exclude <select> entirely because the click event on a <select>
 * only opens the native dropdown picker — it does not represent a
 * meaningful user action by itself (the meaningful action is selecting
 * an option, which fires the change event). Recording "Click Country"
 * when the user merely opened the dropdown would produce misleading tests.
 *
 * Note: Only native <select> is excluded here. Custom dropdown triggers
 * C5.2B: Custom dropdown triggers ([role="combobox"]) are also excluded.
 * Opening a dropdown is part of the selection flow — recording a Click for
 * it would produce a redundant step in the test. The select-content-script
 * records the meaningful value change via mousedown/keydown detection.
 *
 * Note: Plain <button>/<div> triggers without role="combobox" are still
 * recorded as Click (we can't reliably determine they're dropdown triggers
 * without ARIA semantics).
 */
const SELECT_DROPDOWN_SELECTOR = [
  'select:not([multiple])',
  '[role="combobox"]',
].join(', ');

/**
 * Selector for dropdown option elements in custom dropdowns.
 *
 * C5.1 §7.2: Select takes precedence over generic Click.
 * Custom dropdown components (OXD, React Select, MUI, Ant Design)
 * render options as <div role="option"> elements. When the user
 * clicks an option, the select-content-script records the value
 * change via mousedown detection. The generic click recorder must
 * NOT also record this as a Click to avoid duplicate events.
 */
const DROPDOWN_OPTION_SELECTOR = '[role="option"]';

/**
 * Selector for segmented control buttons using aria-pressed.
 *
 * C5.1 §7.2: Select takes precedence over generic Click.
 * Segmented controls (buttons with aria-pressed) are value-selection
 * controls. The select-content-script records the value selection via
 * mousedown detection. The generic click recorder must NOT also record
 * this as a Click to avoid duplicate events.
 */
const SEGMENTED_CONTROL_SELECTOR = '[aria-pressed]';

/**
 * Selector for ARIA menu items inside dropdown menus.
 *
 * Web apps (OrangeHRM, GitHub, Google) render dropdown menus using:
 *   <ul role="menu"><li><a role="menuitem">Support</a></li></ul>
 * The select-content-script records these as Select interactions.
 * The click recorder must NOT also record a duplicate Click.
 */
const MENU_ITEM_DROPDOWN_SELECTOR = '[role="menu"] [role="menuitem"]:not([role="menuitemcheckbox"]):not([role="menuitemradio"])';

/**
 * Selector for native HTML date inputs.
 *
 * C6.1 §8: DateSelect takes precedence over generic Click.
 * Native date inputs (type=date, time, datetime-local, month, week)
 * are handled by the datepicker-content-script via change event.
 * Recording a click on these inputs would produce a duplicate event
 * or noise (clicking to open the native picker UI).
 */
const DATE_INPUT_SELECTOR = 'input[type="date"], input[type="datetime-local"], input[type="time"], input[type="month"], input[type="week"]';

/**
 * Selector for calendar grid cells.
 *
 * C6.1 §8: DateSelect takes precedence over generic Click for date cells
 * in calendar grid components. The datepicker-content-script detects
 * these via mousedown + aria-label/data-date.
 */
const CALENDAR_CELL_SELECTOR = '[role="gridcell"], [data-date], [data-day]';

/**
 * C6.2A: Broader calendar container selector for click exclusion.
 * When a click happens inside a calendar overlay (even with unrecognized
 * class names), the datepicker-content-script handles it via post-click
 * value outcome detection. We skip the generic click to avoid duplicates.
 */
const CALENDAR_OVERLAY_SELECTOR = '[role="grid"], [class*="calendar"], [class*="datepicker"], [class*="date-picker"], [class*="date_picker"], [data-datepicker]';

/**
 * C6.2A: Date-like text inputs — text inputs whose attributes suggest they
 * hold dates. Clicking to open the calendar is not a meaningful action.
 */
const DATE_LIKE_TEXT_INPUT_SELECTOR = 'input[type="text"]';

/**
 * C6.2A: Check if a text input looks date-related by its attributes.
 * Matches inputs whose placeholder/name/id/class/aria-label mention
 * date/depart/arrival/return/travel/calendar keywords.
 */
function isDateLikeTextInput(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  const placeholder = (el.placeholder || '').toLowerCase();
  const name = (el.name || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const cls = (el.className || '').toLowerCase();
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

  const combined = `${placeholder} ${name} ${id} ${cls} ${ariaLabel}`;
  return /\b(date|depart|arrival|return|check.?in|check.?out|from.?date|to.?date|travel|journey|trip|fly|calendar)\b/.test(combined);
}

// ── Target Resolution ─────────────────────────────────────

/**
 * Resolve the intended interactive element from the click event.
 *
 * Walks event.composedPath() to find the nearest element matching
 * INTERACTIVE_SELECTOR. composedPath() crosses Shadow DOM boundaries
 * (unlike closest()).
 *
 * Falls back to manual parentElement walk if composedPath doesn't
 * find a match, then to the raw event.target as last resort.
 *
 * Architecture Principle: resolve to the FIRST interactive ancestor.
 * Do not keep going higher.
 */
function resolveClickTarget(event: MouseEvent): Element | null {
  const rawTarget = event.target;
  if (!rawTarget || !(rawTarget instanceof Element)) {
    return null;
  }

  // Strategy 1: Walk composedPath for interactive element
  const path = event.composedPath();
  for (const node of path) {
    if (node instanceof Element && node.matches(INTERACTIVE_SELECTOR)) {
      return node;
    }
  }

  // Strategy 2: Fall back to parentElement walk (doesn't cross shadow)
  let current: Element | null = rawTarget;
  while (current) {
    if (current.matches(INTERACTIVE_SELECTOR)) {
      return current;
    }
    current = current.parentElement;
  }

  // Strategy 3: Best effort — return raw target
  return rawTarget;
}

// ── Ownership Check ───────────────────────────────────────

/**
 * Check if another interaction has already claimed this element.
 *
 * Architecture (Milestone 2, Section 4):
 * The data-cmdrunner-handled attribute is a binary ownership signal.
 * If present, another interaction's content script claimed this element.
 * Click exits silently.
 *
 * Additionally checks data-cmdrunner-pending-select: this is set by the
 * select-content-script during mousedown (before the click event fires)
 * when it captures a sibling snapshot for CSS-class-differential detection.
 * If the pending-select attribute is present, the click recorder must
 * defer to the select recorder's deferred check (which runs in setTimeout(0)
 * after the click). Without this check, a duplicate Click would be recorded
 * for every CSS-only value selection (e.g., segmented controls without ARIA).
 *
 * On the clean baseline (no other content scripts), this always passes.
 */
function isOwnedByAnother(target: Element): boolean {
  if (target.closest('[data-cmdrunner-handled]')) return true;
  if (target.closest('[data-cmdrunner-pending-select]')) return true;
  return false;
}

// ── Accessible Name Computation ───────────────────────────

/**
 * Compute the accessible name for an element.
 *
 * Architecture (Milestone 2, Section 6) — 9-level priority:
 *   a. aria-label
 *   b. aria-labelledby (supports multiple space-separated IDs)
 *   c. innerText
 *   d. textContent
 *   e. <label for> association (form controls)
 *   f. placeholder
 *   g. value
 *   h. alt text (img, input[type=image])
 *   i. title
 *
 * Returns '' if nothing found.
 */
function computeAccessibleName(el: Element): string {
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

  // c. innerText (rendered text)
  if (el instanceof HTMLElement) {
    const inner = el.innerText?.trim();
    if (inner) {
      return truncate(inner, 200);
    }
  }

  // d. textContent (DOM text)
  const textContent = el.textContent?.trim();
  if (textContent) {
    return truncate(textContent, 200);
  }

  // e. <label for> association (form controls only)
  if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
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
  }

  // f. placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) {
    return truncate(placeholder.trim(), 200);
  }

  // g. value
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

// ── Role Mapping ──────────────────────────────────────────

/**
 * Get the implicit ARIA role for an element based on its tag and type.
 *
 * Returns the explicit role attribute if present, otherwise the
 * implicit role from tag/type mapping, or null if unknown.
 */
function getImplicitRole(el: Element): string | null {
  // Explicit role takes precedence
  const explicitRole = el.getAttribute('role');
  if (explicitRole && explicitRole.trim()) {
    return explicitRole.trim();
  }

  const tag = el.tagName;

  // Tag → role mapping
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
    // Icon elements: in modern web apps, <i> is used for icons, not italic text.
    // SVG is also used for icons.
    I: 'img',
    SVG: 'img',
  };

  if (tag === 'INPUT') {
    const type = el.getAttribute('type') || 'text';
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
    return INPUT_TYPE_ROLE_MAP[type] || null;
  }

  return TAG_ROLE_MAP[tag] || null;
}

// ── CSS Selector Generation ───────────────────────────────

/**
 * Generate a CSS selector for an element.
 *
 * Strategy:
 *   1. If element has an id, use #id (escaped)
 *   2. Otherwise, build nth-of-type chain up to 5 ancestors
 *
 * Architecture note: ID stability filtering is a deferred concern.
 * The recorder captures the id if present; the execution engine
 * will filter unstable IDs in a future milestone.
 */
function generateCssSelector(el: Element): string {
  // Strategy 1: ID-based
  const id = el.id;
  if (id) {
    return `#${cssEscape(id)}`;
  }

  // Strategy 2: nth-of-type chain
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

// ── XPath Generation ──────────────────────────────────────

/**
 * Generate an XPath for an element.
 *
 * Strategy:
 *   1. If element has an id, use //tag[@id='value']
 *   2. Otherwise, build positional path up to 10 ancestors
 */
function generateXPath(el: Element): string {
  // Strategy 1: ID-based shortcut
  const id = el.id;
  if (id) {
    return `//${el.tagName.toLowerCase()}[@id='${id}']`;
  }

  // Strategy 2: Positional path
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

// ── Shadow DOM Detection ──────────────────────────────────

/**
 * Detect if an element is inside a Shadow DOM.
 */
function isInShadowDom(el: Element): boolean {
  const root = el.getRootNode();
  return root instanceof ShadowRoot;
}

// ── Iframe Context Extraction ─────────────────────────────

/**
 * Extract iframe context for elements inside iframes.
 *
 * Same-origin: can access parent document to get frameSelector,
 * frameXPath, frameIndex, frameName, frameId.
 * Cross-origin: only frameSrc (the iframe's own URL) is available.
 */
function extractIframeContext(): {
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
    // Same-origin: try to access parent document
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
    // Only frameSrc is available
  }

  // Count frame depth
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

// ── Identity Extraction ───────────────────────────────────

/**
 * Raw element identity — mirrors RawElementIdentity in types.ts.
 * Extracted at click time. Immutable after classification.
 */
interface ClickIdentity {
  accessibleName: string;
  ariaRole: string | null;
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
  placeholder: string | null;
  tag: string;
  className: string | null;
  name: string | null;
  stableId: string | null;
  testId: string | null;
  dataCy: string | null;
  dataQa: string | null;
  cssSelector: string;
  xPath: string;
  inIframe: boolean;
  shadowDom: boolean;
  iframeContext?: {
    frameSrc: string;
    frameName: string | null;
    frameId: string | null;
    frameSelector: string | null;
    frameXPath: string | null;
    frameIndex: number | null;
    frameDepth: number;
  };
}

/**
 * Extract the full element identity at click time.
 *
 * Architecture Principle 5: Capture identity early, process later.
 * Architecture Principle 6: Once classified, identity is immutable.
 *
 * This is the snapshot of intent at a moment in time.
 */
function extractIdentity(el: Element): ClickIdentity {
  const iframeCtx = extractIframeContext();

  const identity: ClickIdentity = {
    accessibleName: computeAccessibleName(el),
    ariaRole: getImplicitRole(el),
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledBy: el.getAttribute('aria-labelledby'),
    placeholder: el.getAttribute('placeholder'),
    tag: el.tagName,
    className: el.className || null,
    name: el.getAttribute('name'),
    stableId: el.id || null,
    testId: el.getAttribute('data-testid'),
    dataCy: el.getAttribute('data-cy'),
    dataQa: el.getAttribute('data-qa'),
    cssSelector: generateCssSelector(el),
    xPath: generateXPath(el),
    inIframe: iframeCtx.inIframe,
    shadowDom: isInShadowDom(el),
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
    };
  }

  return identity;
}

// ── Identity Key (for dedup) ──────────────────────────────

/**
 * Generate a normalized identity key for dedup comparison.
 *
 * Architecture (Milestone 2, Section 1):
 * "identity stored, not Element reference" — Virtual DOM frameworks
 * may destroy and recreate the DOM node. The identity key is a string
 * comparison, safe against detachment.
 *
 * The key must uniquely identify the "same element" for double-click
 * detection. It uses tag + stableId + cssSelector — this is an exact
 * match, NOT ancestor/descendant.
 */
function identityKey(identity: ClickIdentity): string {
  return [identity.tag, identity.stableId || '', identity.cssSelector].join('|');
}

// ── Click Commit ──────────────────────────────────────────

/**
 * Commit a click — send CLICK_CAPTURED to the background immediately.
 *
 * Architecture (Milestone 2, Section 5):
 * "A click is classified — and therefore an interaction — at the moment
 * the content script sends the CLICK_CAPTURED message."
 *
 * Until this message is sent, there is NO interaction.
 *
 * IMPORTANT: The message MUST be sent synchronously relative to the click
 * event. A holding window (setInterval/setTimeout) is unreliable because
 * clicks that trigger navigation destroy the content script before the
 * timer fires, and sendMessage during pagehide/visibilitychange is not
 * guaranteed to be delivered. Therefore clicks are committed immediately.
 *
 * Double-click suppression uses event.detail (DOM standard) instead of
 * a holding window. See handleClick for details.
 */
function commitClick(identity: ClickIdentity): void {
  chrome.runtime.sendMessage({
    type: 'CLICK_CAPTURED',
    payload: identity,
  }).catch(() => {
    // Service worker may be asleep or restarting — silently ignore
  });
}

// ── Click Handler ─────────────────────────────────────────

/**
 * Track the last committed click identity for rapid-fire suppression.
 * If the same element is clicked twice in quick succession (double-click),
 * we suppress the second click — it will be handled by the future
 * Double-Click interaction.
 */
let lastClickKey: string | null = null;
let lastClickTime = 0;

/**
 * Standard browser double-click threshold (Chrome default).
 * Clicks on the same element within this window are treated as a
 * double-click and the second click is suppressed.
 */
const DBLCLICK_THRESHOLD_MS = 300;

/**
 * Main click event handler — implements the Click Decision Tree
 * (Milestone 2, Click Decision Tree section).
 *
 * Decision Tree:
 *   1. Is it genuine? (isTrusted)
 *   2. Does another interaction own it? (data-cmdrunner-handled)
 *   3. Can the target be resolved? (composedPath)
 *   4. Can it be confidently classified? (not double-click, identity extractable)
 *   5. RECORD — commit immediately
 */
async function handleClick(event: MouseEvent): Promise<void> {
  // ── Decision 1: Is it genuine? ──
  if (!event.isTrusted) return;

  // Left button only
  if (event.button !== 0) return;

  // Recording must be active (async fallback for MV3 timing gaps)
  const recording = await checkRecording();
  if (!recording) return;

  // Target sanity check
  if (!event.target) return;

  // ── Decision 2: Target Resolution ──
  const target = resolveClickTarget(event);
  if (!target) return;

  // ── Decision 2b: Skip checkbox/radio controls ──
  // C4.1 §6.2: Checkbox/Radio takes precedence over generic Click.
  // The specialized checkbox-radio-content-script handles state-based
  // recording for these controls. If we don't skip here, the first
  // state change would record both a Click AND a Check/Radio event
  // (the click event fires before the change event, so ownership
  // hasn't been claimed yet by the time we check data-cmdrunner-handled).
  if (target.matches(CHECKBOX_RADIO_SELECTOR)) return;

  // ── Decision 2c: Skip native <select> dropdown controls ──
  // C5.1 §7.2: Select takes precedence over generic Click.
  // The select-content-script records the meaningful value change via
  // the change event. The click event on a <select> only opens the
  // native dropdown picker — it's not a meaningful action by itself.
  if (target.matches(SELECT_DROPDOWN_SELECTOR)) return;

  // ── Decision 2d: Skip custom dropdown option clicks ──
  // C5.1 §7.2: Select takes precedence over generic Click.
  // Custom dropdown options (<div role="option">) are handled by the
  // select-content-script via mousedown detection. Recording this as a
  // generic Click would produce a duplicate event.
  if (target.matches(DROPDOWN_OPTION_SELECTOR)) return;

  // ── Decision 2e: Skip segmented control buttons ──
  // Segmented controls (buttons with aria-pressed) are value-selection
  // controls handled by the select-content-script. Recording this as a
  // generic Click would produce a duplicate event.
  if (target.matches(SEGMENTED_CONTROL_SELECTOR)) return;

  // ── Decision 2f: Skip ARIA menu items inside dropdown menus ──
  // role="menuitem" inside role="menu" is a value selection handled by
  // the select-content-script. Recording this as a generic Click would
  // produce a duplicate event.
  if (target.matches(MENU_ITEM_DROPDOWN_SELECTOR)) return;

  // ── Decision 2g: Skip native date inputs ──
  // C6.1 §8: DateSelect handles native date/time inputs via change event.
  // The click just opens the native picker UI — not a meaningful action.
  if (target.matches(DATE_INPUT_SELECTOR)) return;

  // ── Decision 2g-ext: Skip date-like text inputs ──
  // C6.2A: Text inputs used for date selection (placeholder/name/id mentions
  // date/depart/arrival/etc.) — the datepicker-content-script handles these
  // via post-click value outcome detection. Clicking to open the calendar
  // is not a meaningful action.
  if (target.matches(DATE_LIKE_TEXT_INPUT_SELECTOR) && isDateLikeTextInput(target)) return;

  // ── Decision 2h: Skip calendar grid cells (owned by datepicker) ──
  // C6.1 §8: Calendar date cells are handled by the datepicker-content-script.
  // Skip cells that have been claimed via data-cmdrunner-handled.
  // Also skip cells inside calendar containers that carry date semantics.
  if (target.matches(CALENDAR_CELL_SELECTOR) && target.closest('[data-cmdrunner-handled="dateSelect"]')) return;

  // ── Decision 2i: Skip clicks inside calendar overlays ──
  // C6.2A: If the click is inside a calendar-like overlay (class*="calendar",
  // role="grid", etc.), the datepicker-content-script will handle it via
  // post-click value outcome detection. Skip to avoid duplicate Click.
  if (target.closest(CALENDAR_OVERLAY_SELECTOR)) return;

  // ── Decision 3: Does another interaction own it? ──
  if (isOwnedByAnother(target)) return;

  // ── Decision 4: Dedup + Classification ──
  const identity = extractIdentity(target);
  const key = identityKey(identity);
  const now = Date.now();

  // Double-click suppression: same element clicked within threshold
  if (lastClickKey === key && (now - lastClickTime) < DBLCLICK_THRESHOLD_MS) {
    // Same element clicked again within threshold → double-click
    // Suppress this click — it defers to the future Double-Click interaction
    return;
  }

  lastClickKey = key;
  lastClickTime = now;

  // ── Decision 5: Commit immediately ──
  // Send CLICK_CAPTURED right now — no holding window.
  // A holding window would lose clicks that trigger navigation because
  // the content script is destroyed before the timer fires.
  commitClick(identity);
}

/**
 * Double-click handler — placeholder for the future Double-Click interaction.
 *
 * Architecture: A dblclick event handler emits a Double-Click interaction
 * (future interaction type). For now, this handler exists only to prevent
 * the standard dblclick from causing unexpected behavior.
 */
function handleDblClick(event: MouseEvent): void {
  if (!event.isTrusted) return;
  // Future: emit DOUBLE_CLICK_CAPTURED message
}

// ── Event Listeners ───────────────────────────────────────

// Capture phase: fires BEFORE application handlers — no interference risk.
// Architecture (Milestone 2, Section 1):
// "The content script listens to the click event on document in the
// capture phase (fires before application handlers — no interference risk)."
document.addEventListener('click', handleClick, true);
document.addEventListener('dblclick', handleDblClick, true);

// ── Utilities ─────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) : str;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  // Fallback: escape special characters
  return value.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}
