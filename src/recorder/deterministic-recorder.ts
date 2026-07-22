/**
 * Deterministic Recorder — Content Script
 *
 * Phase 1 — replaces ALL 9 previous content scripts (6 legacy interaction
 * scripts + universal observer + state tracker + V2 observer) with a single
 * script that captures exactly what the user did.
 *
 * This script records raw events in deterministic order:
 *   1. Correct target element (resolveTarget via composedPath, crosses shadow)
 *   2. Stable element identity (18-field extraction)
 *   3. Event sequence (click, focus, blur, change, input)
 *   4. Values before/after (tracked via snapshot map)
 *   5. Sends RECORDED_EVENT messages to the service worker
 *
 * It does NOT classify interactions, infer intent, or generate steps.
 *
 * SELF-CONTAINED: Content scripts run in an isolated world and cannot import
 * modules. All logic is inlined here.
 */

// ════════════════════════════════════════════════════════════════════════
// TYPES (inlined — no module imports in content scripts)
// ════════════════════════════════════════════════════════════════════════

interface ElementIdentity {
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
  elementId: string;
}

/**
 * DOM context captured at event time — enriches events with structural
 * information the Evidence Engine needs but can't access post-hoc.
 */
interface DomContext {
  inputType: string | null;
  ariaExpanded: boolean | null;
  ariaHasPopup: string | null;
  isContentEditable: boolean;
  ariaAutoComplete?: string | null;
  listId?: string | null;
  surfaceType?: string | null;
  surfaceRole?: string | null;
  surfaceLabel?: string | null;
  acceptedFileTypes?: string | null;
  multipleFiles?: boolean | null;
  fileData?: { name: string; type: string }[] | null;
  uploadMethod?: 'browse' | 'drag-drop' | null;
  triggeredDialog?: 'alert' | 'confirm' | 'prompt' | null;
  dialogMessage?: string | null;
  dialogResult?: string | null;
  opensNewTab?: boolean | null;
  opensNewWindow?: boolean | null;
  openedUrl?: string | null;
  domAttributes?: Record<string, string>;
  ancestorRoles?: string[];
  // Date picker fields (present on dateSelect events)
  dateType?: string;
  isoValue?: string;
  displayValue?: string;
  dateAmbiguous?: boolean;
  dateWarning?: string;
  dateConfidence?: number;
  /** Events inside calendar popovers — evidence-only, not standalone interactions. */
  ownedByDatePicker?: boolean;
}

interface RecordedEventMessage {
  type: 'RECORDED_EVENT';
  eventType: 'click' | 'dblclick' | 'contextmenu' | 'focus' | 'blur' | 'change' | 'input' | 'scroll' | 'mouseenter' | 'dragstart' | 'drop' | 'dateSelect';
  timestamp: string;
  target: ElementIdentity;
  valueBefore: string | null;
  valueAfter: string | null;
  checkedBefore: boolean | null;
  checkedAfter: boolean | null;
  domContext?: DomContext;
}

/** Per-element value snapshot — tracks before-state for transitions. */
interface ValueSnapshot {
  value: string | null;
  checked: boolean | null;
}

// ════════════════════════════════════════════════════════════════════════
// RECORDING STATE
// ════════════════════════════════════════════════════════════════════════

/**
 * Recording state flag, synced from chrome.storage.
 * Content scripts proactively send events — the service worker makes the
 * final decision via session state. This prevents losing events due to
 * MV3 timing gaps.
 */
// ════════════════════════════════════════════════════════════════════════
// DOUBLE-INJECTION GUARD
// ════════════════════════════════════════════════════════════════════════

/**
 * When an extension is reloaded or updated, Chrome may inject a new content
 * script into an already-open tab without removing the old one's listeners.
 * This guard ensures only ONE instance runs per page, preventing duplicate
 * event captures and state corruption.
 *
 * If a previous instance is already running, the new script exits early.
 */
const CS_GUARD = '__CMDRUNNER_CS_ACTIVE__';
if ((window as any)[CS_GUARD]) {
  // Already injected — silently exit to prevent duplicate listeners
} else {

(window as any)[CS_GUARD] = true;

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

async function checkRecording(): Promise<boolean> {
  if (isRecording) return true;
  try {
    const result = await chrome.storage.local.get('ui_state');
    if (result['ui_state']) {
      isRecording = result['ui_state'].recordingState === 'recording';
    }
  } catch {}
  return isRecording;
}

// Also listen for explicit messages (covers SPA navigation where storage
// change events may be delayed)
// PING is handled synchronously so the service worker can verify the content
// script is alive and correctly injected (detects orphaned scripts after
// extension reload/update).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ type: 'PONG', isRecording, url: location.href });
    return true; // keep channel open for sendResponse
  }
  if (message.type === 'START_RECORDING') {
    isRecording = true;
  } else if (message.type === 'STOP_RECORDING') {
    isRecording = false;
    valueTracker.clear();
    clearDatePickerDebounce();
  }
  return false;
});

// ════════════════════════════════════════════════════════════════════════
// PAGE-WORLD INTERCEPTION — alert/confirm/prompt + window.open
// ════════════════════════════════════════════════════════════════════════
//
// Content scripts run in an isolated world and cannot directly override
// page-level window.alert/confirm/prompt/open. Instead, we inject a
// <script> tag into the page's main world at document_start. The page-world
// script wraps the native functions and records interaction data on a
// data-* attribute that the content script can read synchronously after
// the click handler runs.

(function injectPageWorldScript() {
  // Only inject once per document (all_frames means each frame gets it)
  if (document.documentElement.hasAttribute('data-cmdrunner-pw-installed')) return;
  document.documentElement.setAttribute('data-cmdrunner-pw-installed', '1');

  const script = document.createElement('script');
  script.textContent = `(function() {
    var origAlert = window.alert;
    var origConfirm = window.confirm;
    var origPrompt = window.prompt;
    var origOpen = window.open;

    window.alert = function(msg) {
      document.documentElement.setAttribute('data-cmdrunner-dialog',
        JSON.stringify({type:'alert', message:String(msg)}));
      return origAlert.call(this, msg);
    };
    window.confirm = function(msg) {
      var result = origConfirm.call(this, msg);
      document.documentElement.setAttribute('data-cmdrunner-dialog',
        JSON.stringify({type:'confirm', message:String(msg), result:result ? 'OK' : 'Cancel'}));
      return result;
    };
    window.prompt = function(msg, def) {
      var result = origPrompt.call(this, msg, def);
      document.documentElement.setAttribute('data-cmdrunner-dialog',
        JSON.stringify({type:'prompt', message:String(msg), result:result === null ? 'Cancelled' : result}));
      return result;
    };
    window.open = function(url, target, features) {
      var hasFeatures = features && (features.indexOf('width') !== -1 || features.indexOf('height') !== -1);
      document.documentElement.setAttribute('data-cmdrunner-window-open',
        JSON.stringify({url:url||'', target:target||'', isWindow:!!hasFeatures}));
      return origOpen.call(this, url, target, features);
    };
  })();`;
  // Use textContent (set above) and inject synchronously
  try {
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // clean up the DOM node — the code is already executed
  } catch {
    // If we can't inject (e.g., CSP blocks), the page-world features
    // won't work — the content script continues normally without them.
  }
})();

/**
 * Read and clear dialog/window-open attributes set by the page-world script.
 * Called via setTimeout(0) after a click to capture dialogs/window.open
 * triggered by the clicked element.
 */
function readPageWorldSignals(): Partial<DomContext> | null {
  const dialogAttr = document.documentElement.getAttribute('data-cmdrunner-dialog');
  const openAttr = document.documentElement.getAttribute('data-cmdrunner-window-open');

  // Clean up attributes regardless of what we found
  document.documentElement.removeAttribute('data-cmdrunner-dialog');
  document.documentElement.removeAttribute('data-cmdrunner-window-open');

  if (!dialogAttr && !openAttr) return null;

  const ctx: Partial<DomContext> = {};
  if (dialogAttr) {
    try {
      const dialog = JSON.parse(dialogAttr);
      ctx.triggeredDialog = dialog.type;
      ctx.dialogMessage = dialog.message || '';
      ctx.dialogResult = dialog.result !== undefined ? String(dialog.result) : null;
    } catch { /* malformed JSON — skip */ }
  }
  if (openAttr) {
    try {
      const opened = JSON.parse(openAttr);
      if (opened.isWindow) {
        ctx.opensNewWindow = true;
      } else {
        ctx.opensNewTab = true;
      }
      ctx.openedUrl = opened.url || '';
    } catch { /* malformed JSON — skip */ }
  }
  return ctx;
}

// ════════════════════════════════════════════════════════════════════════
// VALUE TRACKER — before/after state tracking
// ════════════════════════════════════════════════════════════════════════

/**
 * Map from element key → last known value/checked state.
 *
 * Keyed by CSS selector + XPath (identity key) to handle element identity
 * across events on the same element.
 *
 * Strategy:
 *   - On mousedown: snapshot value/checked (before-state for click)
 *   - On focus: snapshot value (before-state for input/change)
 *   - On click: checkedBefore from tracker; checkedAfter deferred via setTimeout(0)
 *   - On change/input: before from tracker, after from element, update tracker
 *   - On blur: before from tracker, after from element, delete tracker entry
 */
const valueTracker = new Map<string, ValueSnapshot>();

/**
 * Generate a stable identity key for an element.
 * Uses CSS selector + XPath to uniquely identify elements.
 */
function elementKey(el: Element): string {
  return `${el.tagName}|${el.id || ''}|${generateCssSelector(el)}`;
}

/**
 * Snapshot an element's current value/checked state into the tracker.
 * Called on mousedown and focus — the "before" moment.
 */
function snapshotValue(el: Element): ValueSnapshot {
  return {
    value: captureValue(el) ?? null,
    checked: captureCheckedState(el) ?? null,
  };
}

// ════════════════════════════════════════════════════════════════════════
// IDENTITY & TARGET RESOLUTION
// ════════════════════════════════════════════════════════════════════════

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) : str;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}

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
  checkbox: 'checkbox', radio: 'radio', text: 'textbox', email: 'textbox',
  password: 'textbox', search: 'textbox', tel: 'textbox', url: 'textbox',
  number: 'spinbutton', range: 'slider', color: 'textbox', date: 'textbox',
  'datetime-local': 'textbox', time: 'textbox', file: 'textbox',
};

function getImplicitRole(el: Element): string | null {
  const explicitRole = el.getAttribute('role');
  if (explicitRole && explicitRole.trim()) return explicitRole.trim();
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const type = el.getAttribute('type') || 'text';
    return INPUT_TYPE_ROLE_MAP[type] || null;
  }
  return TAG_ROLE_MAP[tag] || null;
}

function computeAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return truncate(ariaLabel.trim(), 200);

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

  const isFormControl = el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');

  if (isFormControl) {
    const elId = el.id;
    if (elId) {
      const label = deepQuerySelector(`label[for="${cssEscape(elId)}"]`);
      if (label) {
        const labelText = label.textContent?.trim();
        if (labelText) return truncate(labelText, 200);
      }
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const labelText = parentLabel.textContent?.trim();
      if (labelText) return truncate(labelText, 200);
    }
    if (el instanceof HTMLSelectElement && el.selectedIndex >= 0) {
      const opt = el.options[el.selectedIndex];
      const optText = opt?.textContent?.trim();
      if (optText) return truncate(optText, 200);
    }
  }

  if (el instanceof HTMLElement) {
    const inner = el.innerText?.trim();
    if (inner) return truncate(inner, 200);
  }

  const textContent = el.textContent?.trim();
  if (textContent) return truncate(textContent, 200);

  const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
  if (placeholder && placeholder.trim()) return truncate(placeholder.trim(), 200);

  const value = (el as HTMLInputElement).value;
  if (value && value.trim() && el.tagName === 'INPUT') {
    const type = el.getAttribute('type');
    if (type === 'button' || type === 'submit' || type === 'reset') {
      return truncate(value.trim(), 200);
    }
  }

  const alt = el.getAttribute('alt');
  if (alt && alt.trim()) {
    if (el.tagName === 'IMG' || (el.tagName === 'INPUT' && el.getAttribute('type') === 'image')) {
      return truncate(alt.trim(), 200);
    }
  }

  const title = el.getAttribute('title');
  if (title && title.trim()) return truncate(title.trim(), 200);

  return '';
}

function generateCssSelector(el: Element): string {
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

function generateXPath(el: Element): string {
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

function isInShadowDom(el: Element): boolean {
  const root = el.getRootNode();
  return root instanceof ShadowRoot;
}

// ── Shadow-DOM-aware query helpers ──────────────────────────────────────
//
// These functions replicate document.getElementById and document.querySelector
// but also traverse into open shadow roots. Closed shadow roots cannot be
// traversed (browser limitation).
//
// Each function first tries the document (light DOM), then recursively
// walks all shadow hosts discovered via querySelectorAll('*').

/**
 * Find an element by ID across the light DOM and all open shadow roots.
 * Returns the first match or null.
 */
function deepGetElementById(id: string): Element | null {
  // Light DOM first (fast path)
  const found = document.getElementById(id);
  if (found) return found;

  // Walk all elements looking for shadow hosts
  return deepGetElementByIdInShadowRoot(id, document);
}

/**
 * Recursive helper: search within a root (Document or ShadowRoot) and all
 * its descendant open shadow roots.
 */
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

/**
 * Find an element by CSS selector across the light DOM and all open shadow roots.
 * Returns the first match or null.
 */
function deepQuerySelector(selector: string): Element | null {
  // Light DOM first (fast path)
  const found = document.querySelector(selector);
  if (found) return found;

  // Walk all elements looking for shadow hosts
  return deepQuerySelectorInShadowRoot(selector, document);
}

/**
 * Recursive helper: search within a root (Document or ShadowRoot) and all
 * its descendant open shadow roots.
 */
function deepQuerySelectorInShadowRoot(selector: string, root: Document | ShadowRoot): Element | null {
  const allElements = root.querySelectorAll('*');
  for (const el of allElements) {
    // Check if this element matches the selector
    if (el.matches(selector)) return el;
    // Recurse into shadow roots
    if (el.shadowRoot) {
      // First check inside the shadow root for the selector
      const innerMatch = el.shadowRoot.querySelector(selector);
      if (innerMatch) return innerMatch;
      // Then recurse for nested shadow roots
      const nested = deepQuerySelectorInShadowRoot(selector, el.shadowRoot);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Find all elements matching a selector across the light DOM and all open
 * shadow roots. Returns an array (since results from multiple roots cannot
 * be a single NodeList).
 */
function deepQuerySelectorAll(selector: string): Element[] {
  const results: Element[] = [];
  // Light DOM
  results.push(...document.querySelectorAll(selector));
  // Shadow roots
  deepQuerySelectorAllInShadowRoot(selector, document, results);
  return results;
}

function deepQuerySelectorAllInShadowRoot(
  selector: string,
  root: Document | ShadowRoot,
  results: Element[],
): void {
  const allElements = root.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot) {
      const innerMatches = el.shadowRoot.querySelectorAll(selector);
      results.push(...innerMatches);
      deepQuerySelectorAllInShadowRoot(selector, el.shadowRoot, results);
    }
  }
}

/**
 * Observe a MutationObserver across the document body AND all open shadow roots.
 *
 * MutationObserver.observe() can be called multiple times on the same
 * instance to watch multiple targets natively. This function discovers
 * all open shadow roots in the current document and calls observe() on
 * each, in addition to document.body. The callback receives mutations
 * from all observed roots.
 *
 * This is a one-time snapshot of shadow roots at call time. Shadow roots
 * created after this call will not be observed (acceptable for per-click
 * observers that run for 500ms). Closed shadow roots are skipped.
 *
 * @param observer - The MutationObserver instance to add targets to
 * @param options - The MutationObserverInit options (same for all targets)
 */
function observeWithShadowRoots(
  observer: MutationObserver,
  options: MutationObserverInit,
): void {
  // Observe the document body (light DOM)
  if (document.body) {
    observer.observe(document.body, options);
  }

  // Discover and observe all open shadow roots
  observeShadowRootsRecursive(observer, options, document);
}

function observeShadowRootsRecursive(
  observer: MutationObserver,
  options: MutationObserverInit,
  root: Document | ShadowRoot,
): void {
  const allElements = root.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot) {
      observer.observe(el.shadowRoot, options);
      // Recurse for nested shadow roots
      observeShadowRootsRecursive(observer, options, el.shadowRoot);
    }
  }
}

function extractIframeContext() {
  const inIframe = window !== window.top;
  if (!inIframe) {
    return { inIframe: false, frameSrc: '', frameName: null, frameId: null,
      frameSelector: null, frameXPath: null, frameIndex: null, frameDepth: 0 };
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
      } catch {}
    }
  } catch {}
  let frameDepth = 1;
  let w: Window = window;
  try {
    while (w.parent && w.parent !== w) { frameDepth++; w = w.parent; }
  } catch {}
  return { inIframe: true, frameSrc, frameName, frameId, frameSelector, frameXPath, frameIndex, frameDepth };
}

function extractIdentity(el: Element): ElementIdentity {
  const iframeCtx = extractIframeContext();
  const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
  const className = el instanceof HTMLElement ? el.className || null : null;
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
    elementId: '',
  };
  if (iframeCtx.inIframe) {
    identity.iframeContext = {
      frameSrc: iframeCtx.frameSrc, frameName: iframeCtx.frameName,
      frameId: iframeCtx.frameId, frameSelector: iframeCtx.frameSelector,
      frameXPath: iframeCtx.frameXPath, frameIndex: iframeCtx.frameIndex,
      frameDepth: iframeCtx.frameDepth,
    };
  }
  return identity;
}

// ── Value / State Capture ──────────────────────────────────────────────

function captureValue(el: Element): string | undefined {
  if (el instanceof HTMLSelectElement) {
    const option = el.options[el.selectedIndex];
    if (option) return option.text?.trim() || option.textContent?.trim() || option.value || '';
    return '';
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value ?? '';
  }
  // ARIA value for custom sliders, spinbuttons (MUI Slider, AntD Slider, etc.)
  // aria-valuetext provides a human-readable value (e.g. "₹48,598") and takes
  // precedence over aria-valuenow (raw numeric value).
  const ariaValueText = el.getAttribute('aria-valuetext');
  if (ariaValueText !== null) return ariaValueText;
  const ariaValueNow = el.getAttribute('aria-valuenow');
  if (ariaValueNow !== null) return ariaValueNow;
  // Contenteditable elements (Quill, Draft.js, Slate, TinyMCE, CKEditor)
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
  return undefined;
}

function captureCheckedState(el: Element): boolean | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  }
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked !== null) return ariaChecked === 'true';
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed !== null) return ariaPressed === 'true';

  // CSS-class-based fallback for custom checkboxes/switches without ARIA.
  // Frameworks like MUI, AntD, and Chakra apply state classes to wrapper
  // elements when the underlying input is checked. Check these last — after
  // native and ARIA — as a final safety net.
  const cls = (el.getAttribute('class') || '').toLowerCase();
  if (cls) {
    // MUI: .Mui-checked on Checkbox/Switch root
    // AntD: .ant-checkbox-checked, .ant-radio-checked, .ant-switch-checked
    // Bootstrap: .active on .btn-check toggle buttons
    // Headless UI: data-headlessui-state includes 'checked' (set as class)
    if (
      cls.includes('mui-checked') ||
      cls.includes('ant-checkbox-checked') ||
      cls.includes('ant-radio-checked') ||
      cls.includes('ant-switch-checked') ||
      cls.includes('checked')
    ) {
      // Check for unchecked patterns to avoid false positives
      if (cls.includes('unchecked') || cls.includes('not-checked')) return false;
      return true;
    }
  }

  return undefined;
}

// ── Target Resolution ──────────────────────────────────────────────────

/**
 * Elements that should NEVER be captured as click targets.
 * These are structural/container elements that users don't interact with directly.
 */
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
 * Check if an element is known-interactive via CSS selectors.
 * Returns true for native form elements, ARIA widgets, and elements with
 * explicit interactivity hints.
 */
function isInteractive(el: Element): boolean {
  try { return el.matches(INTERACTIVE_SELECTOR); } catch { return false; }
}

/**
 * Check if an element is explicitly non-interactive (structural/decorative).
 * We skip these when deciding the fallback target.
 */
function isNonInteractive(el: Element): boolean {
  // Skip known structural/decorative tags
  // Use uppercase for HTML elements, but also check lowercase for SVG elements
  // (SVG tagNames are lowercase in the DOM, unlike HTML which is uppercase)
  const tagUpper = el.tagName.toUpperCase();
  if (NON_INTERACTIVE_TAGS.has(tagUpper)) return true;

  // Skip elements explicitly marked hidden
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.hasAttribute('hidden')) return true;

  return false;
}

/**
 * Check if an element is "clickable" via heuristics.
 * Modern SPAs (React, Vue, Angular) bind click handlers via addEventListener,
 * which doesn't set the `onclick` DOM attribute. We detect these via:
 *   - computed cursor:pointer (explicit user-facing click hint)
 *   - onclick property set (covers some addEventListener cases)
 */
function isClickableHeuristic(el: Element): boolean {
  // onclick property — set by both inline onclick= and some frameworks
  if ((el as HTMLElement).onclick !== null) return true;

  // cursor:pointer — the universal CSS signal for "this is clickable"
  try {
    const style = window.getComputedStyle(el as HTMLElement);
    if (style.cursor === 'pointer') return true;
  } catch { /* getComputedStyle may fail in some contexts */ }

  return false;
}

/**
 * Resolve the target element from an event.
 *
 * Resolution strategy (in priority order):
 *   1. Walk composedPath() for nearest element matching INTERACTIVE_SELECTOR
 *      (native form elements, ARIA roles, explicit interactivity attributes).
 *   2. If no match, walk composedPath() for nearest "clickable" element
 *      (cursor:pointer, onclick property).
 *   3. If still no match, return the raw click target if it's a real element
 *      (div, span, li, etc.) — capture what the user actually clicked.
 *   4. Skip structural elements (html, body, script, svg internals).
 *
 * This ensures we NEVER silently drop a user interaction. A click on a bare
 * <div> with a React onClick handler is captured, not ignored.
 */
function resolveTarget(event: Event): Element | null {
  const rawTarget = event.target;
  if (!rawTarget || !(rawTarget instanceof Element)) return null;

  // Strategy 1: Find nearest known-interactive element via composedPath
  if (typeof event.composedPath === 'function') {
    const path = event.composedPath();
    for (const node of path) {
      if (node instanceof Element && isInteractive(node)) return node;
    }
  }

  // Strategy 1b: Parent walk for known-interactive (fallback if composedPath unavailable)
  let current: Element | null = rawTarget;
  while (current) {
    if (isInteractive(current)) return current;
    current = current.parentElement;
  }

  // Strategy 2: Find nearest "clickable" element (cursor:pointer, onclick)
  if (typeof event.composedPath === 'function') {
    const path = event.composedPath();
    for (const node of path) {
      if (node instanceof Element && !isNonInteractive(node) && isClickableHeuristic(node)) {
        return node;
      }
    }
  }
  current = rawTarget;
  while (current) {
    if (!isNonInteractive(current) && isClickableHeuristic(current)) {
      return current;
    }
    current = current.parentElement;
  }

  // Strategy 3: Return the raw target if it's a real interactive-looking element
  // (div, span, li, p, etc. that the user actually clicked).
  // If the raw target is itself non-interactive (svg path, etc.),
  // walk up to the nearest non-non-interactive ancestor.
  current = rawTarget;
  while (current) {
    if (!isNonInteractive(current)) return current;
    current = current.parentElement;
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// EVENT CAPTURE — capture phase, high priority
// ════════════════════════════════════════════════════════════════════════

/**
 * Build and send a RecordedEventMessage to the service worker.
 *
 * @param preBuiltDomContext — when provided (e.g. by the drop handler which
 *   augments it with dataTransfer.files), use it instead of capturing a fresh
 *   one. This avoids double-capture and preserves file metadata from the event.
 */
function sendEvent(
  eventType: 'click' | 'dblclick' | 'contextmenu' | 'focus' | 'blur' | 'change' | 'input' | 'scroll' | 'mouseenter' | 'dragstart' | 'drop' | 'dateSelect',
  target: Element,
  valueBefore: string | null,
  valueAfter: string | null,
  checkedBefore: boolean | null,
  checkedAfter: boolean | null,
  surfaceData?: { surfaceType: string; surfaceRole: string | null; surfaceLabel: string | null } | null,
  preBuiltDomContext?: DomContext,
): void {
  const identity = extractIdentity(target);
  const domContext = preBuiltDomContext ?? captureDomContext(target);

  // Merge surface detection results into domContext
  if (surfaceData) {
    domContext.surfaceType = surfaceData.surfaceType as 'modal' | 'drawer' | 'popover' | 'tooltip';
    domContext.surfaceRole = surfaceData.surfaceRole;
    domContext.surfaceLabel = surfaceData.surfaceLabel;
  }

  const message: RecordedEventMessage = {
    type: 'RECORDED_EVENT',
    eventType,
    timestamp: new Date().toISOString(),
    target: identity,
    valueBefore,
    valueAfter,
    checkedBefore,
    checkedAfter,
    domContext,
  };
  try {
    chrome.runtime.sendMessage(message);
  } catch {
    // Service worker may be restarting — event will be captured on next interaction
  }
}

/**
 * Capture DOM context at event time for the Evidence Engine.
 *
 * This is the enrichment data that replaces regex hacks on cssSelector
 * in the old classifier. The engine reads these first-class fields instead
 * of trying to parse attributes out of CSS selectors.
 */
function captureDomContext(el: Element): DomContext {
  let inputType: string | null = null;
  let listId: string | null = null;
  let acceptedFileTypes: string | null = null;
  let multipleFiles: boolean | null = null;
  let nativeMin: string | null = null;
  let nativeMax: string | null = null;
  if (el instanceof HTMLInputElement) {
    inputType = el.type || 'text'; // type defaults to "text" if absent
    listId = el.getAttribute('list'); // native datalist association
    // File input attributes
    if (inputType === 'file') {
      acceptedFileTypes = el.accept || null;
      multipleFiles = el.multiple;
    }
    // Native range input bounds
    if (inputType === 'range') {
      nativeMin = el.min || null;
      nativeMax = el.max || null;
    }
  }

  const ariaExpandedAttr = el.getAttribute('aria-expanded');
  const ariaExpanded: boolean | null =
    ariaExpandedAttr === 'true' ? true :
    ariaExpandedAttr === 'false' ? false : null;

  const ariaHasPopup = el.getAttribute('aria-haspopup');
  const ariaAutoComplete = el.getAttribute('aria-autocomplete');
  const isContentEditable = el instanceof HTMLElement ? el.isContentEditable : false;

  // ARIA value attributes for custom sliders/spinbuttons
  const ariaValueNow = el.getAttribute('aria-valuenow');
  const ariaValueText = el.getAttribute('aria-valuetext');
  const ariaValueMin = el.getAttribute('aria-valuemin');
  const ariaValueMax = el.getAttribute('aria-valuemax');

  const ctx: DomContext = { inputType, ariaExpanded, ariaHasPopup, ariaAutoComplete, listId, isContentEditable };
  if (acceptedFileTypes !== null) ctx.acceptedFileTypes = acceptedFileTypes;
  if (multipleFiles !== null) ctx.multipleFiles = multipleFiles;
  if (ariaValueNow !== null) ctx.ariaValueNow = ariaValueNow;
  if (ariaValueText !== null) ctx.ariaValueText = ariaValueText;
  if (ariaValueMin !== null) ctx.ariaValueMin = ariaValueMin;
  if (ariaValueMax !== null) ctx.ariaValueMax = ariaValueMax;
  if (nativeMin !== null) ctx.nativeMin = nativeMin;
  if (nativeMax !== null) ctx.nativeMax = nativeMax;

  // Semantically relevant DOM attributes for the enrichment pipeline
  ctx.domAttributes = captureDomAttributes(el);

  // Ancestor role chain for structural recognition
  ctx.ancestorRoles = captureAncestorRoles(el);

  return ctx;
}

/**
 * Capture semantically relevant DOM attributes from an element.
 * Only captures attributes that are present (no undefined keys).
 * These feed into UiElement.domAttributes for InteractionContract derivation.
 */
function captureDomAttributes(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};

  const htmlEl = el instanceof HTMLElement ? el : null;

  // Validation attributes (present on <input>, <textarea>, <select>)
  const validationAttrs = [
    'required', 'aria-required', 'type', 'min', 'max', 'step',
    'pattern', 'minlength', 'maxlength', 'multiple', 'accept', 'autocomplete',
  ];
  for (const attr of validationAttrs) {
    const value = el.getAttribute(attr);
    if (value !== null) {
      attrs[attr] = value;
    }
  }

  // For <input> elements, ensure type is always captured (defaults to 'text')
  if (el instanceof HTMLInputElement) {
    if (!('type' in attrs)) {
      attrs['type'] = el.type || 'text';
    }
  }

  // For contenteditable elements, capture the contenteditable attribute
  if (htmlEl && (htmlEl.isContentEditable || htmlEl.getAttribute('contenteditable') === 'true')) {
    attrs['contenteditable'] = 'true';
  }

  return attrs;
}

/**
 * Capture the ancestor chain from the target element upward.
 * Returns an array of strings, index 0 = parent.
 * Each entry is either "tag" or "tag[role=role]" if the ancestor has an ARIA role.
 * Walks up to 10 ancestors (matching generateXPath depth).
 */
function captureAncestorRoles(el: Element): string[] {
  const chain: string[] = [];
  let current: Element | null = el.parentElement;
  const MAX_DEPTH = 10;
  let depth = 0;
  while (current && current !== document.documentElement && depth < MAX_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const role = current.getAttribute('role');
    if (role) {
      chain.push(`${tag}[role=${role}]`);
    } else {
      chain.push(tag);
    }
    current = current.parentElement;
    depth++;
  }
  return chain;
}

// ── mousedown: snapshot before-state for click ─────────────────────────

document.addEventListener('mousedown', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  // Only snapshot value/checked for elements that actually have
  // meaningful values — text inputs, selects, checkboxes, radios.
  // This prevents non-value elements from polluting valueTracker and
  // triggering spurious blur events.
  const hasValue = captureValue(target) !== undefined;
  const hasChecked = captureCheckedState(target) !== undefined;
  if (!hasValue && !hasChecked) return;

  // Snapshot value/checked BEFORE the click potentially changes state
  valueTracker.set(elementKey(target), snapshotValue(target));
}, true);

// ── focus: snapshot before-state for text entry ────────────────────────

/**
 * Input types that accept free text entry. Focus events are only recorded
 * for these — focus on buttons, divs, date pickers, etc. is noise because
 * the click event already captures the interaction.
 */
const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text', 'email', 'password', 'search', 'tel', 'url', 'number', '',
]);

/**
 * Check if an element is a text-entry input (not button, checkbox, radio,
 * date, file, etc.). Focus events are only recorded for these elements.
 *
 * IMPORTANT: readonly inputs are NOT text-entry elements — they display
 * values but the user can't type into them. Date pickers, formatted
 * display fields, and React-controlled read-only inputs all fall here.
 */
function isTextEntryElement(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) {
    return !(el as HTMLTextAreaElement).readOnly;
  }
  if (el instanceof HTMLInputElement) {
    if ((el as HTMLInputElement).readOnly) return false;
    const type = (el.type || 'text').toLowerCase();
    return TEXT_ENTRY_INPUT_TYPES.has(type);
  }
  // contenteditable elements accept text entry
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  // ARIA textbox role
  if (el.getAttribute('role') === 'textbox') return true;
  return false;
}

document.addEventListener('focus', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  // Focus events are ONLY recorded for text-entry elements.
  // For buttons, date pickers, divs, links, etc. — the click event
  // already captures the full interaction. Recording focus separately
  // just creates duplicate noise in the timeline.
  if (!isTextEntryElement(target)) return;

  const key = elementKey(target);
  // Only snapshot if not already tracked (avoid overwriting on re-focus)
  if (!valueTracker.has(key)) {
    valueTracker.set(key, snapshotValue(target));
  }

  const value = captureValue(target);
  sendEvent('focus', target, valueTracker.get(key)!.value, value ?? null, null, null);
}, true);

// ── input: value is changing ───────────────────────────────────────────

document.addEventListener('input', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  // Suppress input events on checkbox/radio elements — the click handler
  // already captures the full checked state transition via deferred read.
  // Without this, clicking a checkbox would generate both a click AND an
  // input event, creating duplicate noise in the timeline.
  if (target instanceof HTMLInputElement &&
      (target.type === 'checkbox' || target.type === 'radio')) {
    return;
  }

  // Suppress input events on SELECT elements — the change event carries
  // the committed value. The input event on SELECT is redundant and fires
  // at the same time.
  if (target instanceof HTMLSelectElement) {
    return;
  }

  // For text-entry elements, suppress ALL intermediate input events.
  // The full typed value is captured by focus (valueBefore) → blur
  // (valueAfter). Sending per-keystroke or per-burst input events floods
  // the timeline with noise (e.g., 10 INP events for a phone number).
  // We silently update the valueTracker so that blur reads the latest value.
  if (isTextEntryElement(target)) {
    const key = elementKey(target);
    const snapshot = valueTracker.get(key);
    valueTracker.set(key, { value: captureValue(target) ?? null, checked: snapshot?.checked ?? null });
    return;
  }

  // For non-text-entry elements that fire input (rare), send normally.
  const key = elementKey(target);
  const snapshot = valueTracker.get(key);
  const valueBefore = snapshot?.value ?? null;
  const valueAfter = captureValue(target) ?? null;

  // Update tracker to current value
  valueTracker.set(key, { value: valueAfter, checked: snapshot?.checked ?? null });

  sendEvent('input', target, valueBefore, valueAfter, null, null);
}, true);

// ── change: value committed ────────────────────────────────────────────

document.addEventListener('change', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  // Suppress change events on checkbox/radio elements — the click handler
  // already captures the full checked state transition via deferred read.
  if (target instanceof HTMLInputElement &&
      (target.type === 'checkbox' || target.type === 'radio')) {
    return;
  }

  const key = elementKey(target);
  const snapshot = valueTracker.get(key);
  const valueBefore = snapshot?.value ?? null;
  const valueAfter = captureValue(target) ?? null;
  const checkedBefore = snapshot?.checked ?? null;
  const checkedAfter = captureCheckedState(target) ?? null;

  // Update tracker
  valueTracker.set(key, { value: valueAfter, checked: checkedAfter });

  // ── Date picker: route to debounced dateSelect handler ──
  // Native date inputs (type=date/time/datetime-local/month/week) and
  // custom date picker text inputs are handled by the date picker capture
  // system, which debounces and emits a single dateSelect event with
  // normalized metadata. The raw change event is suppressed — the date
  // system will emit the final committed value.
  if (isDateTriggerElement(target) || isCalendarCell(target)) {
    // For native date inputs, the change event carries the committed ISO value.
    // For calendar cell clicks, the click handler will trigger date detection.
    // Only route through the date handler if this is a native date input change
    // or a text input with date keywords.
    const isNativeDate = target instanceof HTMLInputElement &&
      NATIVE_DATE_TYPES.has((target.type || '').toLowerCase());
    const isDateText = isDateTriggerElement(target) && !isNativeDate;

    if (isNativeDate || isDateText) {
      handleDateValueChange(target, valueBefore, valueAfter);
      // Still update the tracker — but don't send a raw change event
      return;
    }
  }

  // ── File input: capture actual file metadata ──
  // For <input type="file">, input.value is a fake path (C:\fakepath\...)
  // for security reasons. The real file data is in input.files (FileList).
  // We extract names and types into domContext.fileData and set uploadMethod.
  if (target instanceof HTMLInputElement && target.type === 'file') {
    const fileCtx = captureDomContext(target);
    const files = Array.from(target.files ?? []);
    if (files.length > 0) {
      fileCtx.fileData = files.map(f => ({ name: f.name, type: f.type }));
      fileCtx.uploadMethod = 'browse';
    }
    sendEvent('change', target, null, null, null, null, null, fileCtx);
    return;
  }

  sendEvent('change', target, valueBefore, valueAfter, checkedBefore, checkedAfter);
}, true);

// ── Surface detection: modal/drawer/popover/tooltip after clicks ─────────

/**
 * Detect dynamically appearing UI surfaces (modals, drawers, popovers, tooltips)
 * after a user click. Uses a temporary MutationObserver that runs for 500ms
 * after the click, checking for new elements that match surface patterns.
 *
 * This is inlined here (not imported from surface-detector.ts) because content
 * scripts run in an isolated world and cannot import modules.
 */

/** ARIA role → surface type mapping */
const SURFACE_ROLE_MAP: Record<string, string> = {
  'dialog': 'modal',
  'alertdialog': 'modal',
  'menu': 'popover',
  'listbox': 'popover',
  'tree': 'popover',
  'tooltip': 'tooltip',
};

/** Window for detecting surfaces after a click */
const SURFACE_DETECTION_MS = 500;

/**
 * Run surface detection for 500ms after a click. When done, calls the callback
 * with the detected surface data (or null if nothing appeared).
 */
function detectSurfaceAfterClick(
  callback: (surfaceData: { surfaceType: string; surfaceRole: string | null; surfaceLabel: string | null } | null) => void,
): void {
  let detected = false;

  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    if (detected) return;

    for (const mutation of mutations) {
      // Check newly added nodes
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;

        // Skip text nodes, comment nodes, script/style elements
        if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') continue;

        const surface = identifySurfaceInline(node);
        if (surface) {
          detected = true;
          observer.disconnect();
          callback(surface);
          return;
        }
      }

      // Check visibility changes on existing elements (e.g., modal display:block)
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        const surface = identifySurfaceInline(mutation.target);
        if (surface && isVisibleInline(mutation.target)) {
          detected = true;
          observer.disconnect();
          callback(surface);
          return;
        }
      }
    }
  });

  observeWithShadowRoots(observer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-modal', 'open'],
  });

  // Stop observing after the detection window
  setTimeout(() => {
    observer.disconnect();
    if (!detected) {
      callback(null);
    }
  }, SURFACE_DETECTION_MS);
}

/**
 * Check if an element is visible (not display:none, not visibility:hidden, has size).
 */
function isVisibleInline(el: Element): boolean {
  const htmlEl = el as HTMLElement;
  if (htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0) return false;
  const style = window.getComputedStyle(htmlEl);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

/**
 * Extract a readable label from a surface element.
 */
function getSurfaceLabelInline(el: Element): string | null {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = deepGetElementById(labelledBy);
    if (labelEl?.textContent) return labelEl.textContent.trim().slice(0, 100);
  }

  const heading = el.querySelector('h1, h2, h3, h4, [role="heading"]');
  if (heading?.textContent) return heading.textContent.trim().slice(0, 100);

  const title = el.getAttribute('title');
  if (title) return title;

  const text = el.textContent?.trim();
  if (text && text.length > 0) return text.slice(0, 100);

  return null;
}

/**
 * Classify a dynamically appearing element as a surface type.
 * Inlined version of identifySurface() from surface-detector.ts.
 */
function identifySurfaceInline(el: Element): { surfaceType: string; surfaceRole: string | null; surfaceLabel: string | null } | null {
  const role = el.getAttribute('role');
  const roleLower = role?.toLowerCase() ?? '';

  // 1. ARIA roles
  if (roleLower && SURFACE_ROLE_MAP[roleLower]) {
    return {
      surfaceType: SURFACE_ROLE_MAP[roleLower],
      surfaceRole: roleLower,
      surfaceLabel: getSurfaceLabelInline(el),
    };
  }

  // 2. aria-modal
  if (el.getAttribute('aria-modal') === 'true') {
    return { surfaceType: 'modal', surfaceRole: roleLower || null, surfaceLabel: getSurfaceLabelInline(el) };
  }

  // 3. Native <dialog>
  if (el.tagName === 'DIALOG') {
    return { surfaceType: 'modal', surfaceRole: null, surfaceLabel: getSurfaceLabelInline(el) };
  }

  // 4 & 5. Class name patterns (substring matching — no word boundaries)
  const cls = (el as HTMLElement).className;
  if (typeof cls === 'string' && cls.length > 0) {
    const lower = cls.toLowerCase();

    // Calendar / autocomplete patterns (classified as popover)
    if (lower.includes('calendar') || lower.includes('datepicker') ||
        lower.includes('date-picker') || lower.includes('muicalendarpicker') ||
        lower.includes('muidatepicker') || lower.includes('ant-picker') ||
        lower.includes('autocomplete') || lower.includes('suggestion') ||
        lower.includes('typeahead') || lower.includes('muiautocomplete') ||
        lower.includes('ant-select-dropdown')) {
      return { surfaceType: 'popover', surfaceRole: roleLower || null, surfaceLabel: getSurfaceLabelInline(el) };
    }

    // Modal patterns
    if (lower.includes('modal') || lower.includes('mui-dialog') ||
        lower.includes('ant-modal') || lower.includes('p-dialog') ||
        lower.includes('dialog')) {
      return { surfaceType: 'modal', surfaceRole: roleLower || null, surfaceLabel: getSurfaceLabelInline(el) };
    }

    // Drawer patterns
    if (lower.includes('drawer') || lower.includes('sidebar') ||
        lower.includes('slideout') || lower.includes('slidein') ||
        lower.includes('slide-out') || lower.includes('slide-in') ||
        lower.includes('panel-left') || lower.includes('panel-right') ||
        lower.includes('mui-drawer') || lower.includes('ant-drawer')) {
      return { surfaceType: 'drawer', surfaceRole: roleLower || null, surfaceLabel: getSurfaceLabelInline(el) };
    }

    // Tooltip patterns
    if (lower.includes('tooltip') || lower.includes('mui-tooltip') ||
        lower.includes('ant-tooltip') || lower.includes('tippy-box') ||
        lower.includes('p-tooltip') || lower.includes('hint')) {
      return { surfaceType: 'tooltip', surfaceRole: roleLower || null, surfaceLabel: getSurfaceLabelInline(el) };
    }

    // Popover patterns (menus, dropdowns, popovers, overlays)
    if ((lower.includes('popover') || lower.includes('dropdown') ||
         lower.includes('overlay') || lower.includes('flyout') ||
         lower.includes('menu') || lower.includes('mui-popover') ||
         lower.includes('mui-menu') || lower.includes('ant-popover') ||
         lower.includes('ant-dropdown') || lower.includes('p-overlaypanel')) &&
        !lower.includes('breadcrumb')) {
      return { surfaceType: 'popover', surfaceRole: roleLower || null, surfaceLabel: getSurfaceLabelInline(el) };
    }
  }

  // 6. Drawer via CSS transform on fixed element
  try {
    const style = window.getComputedStyle(el);
    if (style.position === 'fixed') {
      const transform = style.transform;
      if (transform && transform !== 'none' && /translate[3d]*\s*\(/i.test(transform)) {
        const cls2 = (el as HTMLElement).className || '';
        if (!cls2.toLowerCase().includes('navbar') && !cls2.toLowerCase().includes('header')) {
          return { surfaceType: 'drawer', surfaceRole: roleLower || null, surfaceLabel: getSurfaceLabelInline(el) };
        }
      }
    }

    // 7. Positioned overlay fallback (z-index ≥ 100 + has clickable children)
    if ((style.position === 'fixed' || style.position === 'absolute') &&
        parseInt(style.zIndex || '0', 10) >= 100 && el.children.length > 0) {
      const hasClickable = el.querySelector(
        'button, a, [role="option"], [role="menuitem"], [data-value], li, input, select',
      );
      if (hasClickable) {
        return { surfaceType: 'popover', surfaceRole: roleLower || null, surfaceLabel: getSurfaceLabelInline(el) };
      }
    }
  } catch {
    // getComputedStyle may fail in some contexts
  }

  return null;
}

// ── click: primary interaction ─────────────────────────────────────────

document.addEventListener('click', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;
  if (event.button !== 0) return; // left button only

  // Cancel any pending hover tracking. A click often triggers DOM mutations
  // (calendar popup opening, dropdown expanding, modal appearing) that the
  // hover MutationObserver would detect and incorrectly attribute to the
  // preceding hover. Since a click is always a deliberate action that
  // supersedes any in-progress hover, cancel the hover before processing
  // the click.
  clearHoverTracking();

  // Suppress new hover tracking for a cooldown period after the click.
  // This covers DOM mutations from BOTH the click's immediate effect (popup
  // opening) AND any follow-up effect (popup closing after date selection).
  // Without this, a mouseover on whatever element is under the cursor after
  // the calendar closes would start fresh hover tracking that gets triggered
  // by the closing DOM mutation.
  hoverSuppressedUntil = Date.now() + HOVER_COOLDOWN_MS;

  // Track click time for scroll filter (UI-triggered scrolls after clicks)
  lastClickTime = Date.now();

  const target = resolveTarget(event);
  if (!target) return;

  // Suppress clicks on <label> elements that wrap (or are associated with)
  // an input element. Browsers forward label clicks to the associated input,
  // so the input's own click event captures the full interaction. Without
  // this filter, a checkbox inside a label would generate two click events.
  if (target instanceof HTMLLabelElement) {
    // Check if the label contains an input directly
    const wrappedInput = target.querySelector('input, button, select, textarea');
    if (wrappedInput) return;
    // Check if the label is associated via for attribute
    const forAttr = target.getAttribute('for');
    if (forAttr) {
      const associated = deepGetElementById(forAttr);
      if (associated && (associated instanceof HTMLInputElement ||
          associated instanceof HTMLSelectElement ||
          associated instanceof HTMLTextAreaElement ||
          associated instanceof HTMLButtonElement)) {
        return;
      }
    }
  }

  const key = elementKey(target);
  const snapshot = valueTracker.get(key);

  // For checkboxes/radios, checkedBefore comes from the mousedown snapshot.
  // checkedAfter needs deferred read — browser updates checked state AFTER
  // the click event's default action fires.
  const checkedBefore = snapshot?.checked ?? null;
  const valueBefore = snapshot?.value ?? null;

  // For value-bearing elements, read current state as valueAfter
  const valueAfter = captureValue(target) ?? valueBefore;

  // Check for target="_blank" on links at click time
  const clickDomCtx = captureDomContext(target);
  if (target instanceof HTMLAnchorElement) {
    const tgt = target.getAttribute('target');
    if (tgt === '_blank') {
      clickDomCtx.opensNewTab = true;
      clickDomCtx.openedUrl = target.href;
    }
  }

  // ── Calendar cell click: route to date picker handler ──
  // When the user clicks a day cell in a calendar popup, we detect it as
  // a date picker interaction. We still send the click event (for evidence),
  // but also trigger the debounced date capture to emit a dateSelect event
  // with the final committed value.
  if (isCalendarCell(target)) {
    // Resolve the associated date input if possible
    const dateInput = resolveDateInputFromCell(target);
    const dateTarget = dateInput ?? target;
    const ariaLabel = target.getAttribute('aria-label') || '';
    const cellText = (target instanceof HTMLElement ? target.textContent : '') || '';
    const dateValue = ariaLabel || cellText || '';

    // Use the aria-label or cell text as the value
    const beforeValue = dateInput instanceof HTMLInputElement ? dateInput.value : null;
    handleDateValueChange(dateTarget, beforeValue, dateValue);
  }

  // ── Tag clicks inside calendar popovers as evidence-only ──
  // Clicks on calendar navigation buttons (prev/next month, year selector),
  // day cells, and other interactive elements inside the calendar popover are
  // part of the date picker lifecycle — not standalone click interactions.
  // The dateSelect event captures the final committed value.
  if (isInsideCalendarPopover(target)) {
    clickDomCtx.ownedByDatePicker = true;
  }

  if (checkedBefore !== null) {
    // Checkbox/radio/toggle — defer checkedAfter read
    setTimeout(() => {
      const checkedAfter = captureCheckedState(target) ?? null;
      valueTracker.set(key, { value: valueAfter, checked: checkedAfter });
      // Start surface detection for this click
      detectSurfaceAfterClick((surfaceData) => {
        // Read page-world signals (dialog/window.open may have been triggered)
        const pwSignals = readPageWorldSignals();
        const mergedCtx: DomContext = { ...clickDomCtx };
        if (surfaceData) {
          mergedCtx.surfaceType = surfaceData.surfaceType as DomContext['surfaceType'];
          mergedCtx.surfaceRole = surfaceData.surfaceRole;
          mergedCtx.surfaceLabel = surfaceData.surfaceLabel;
        }
        if (pwSignals) {
          Object.assign(mergedCtx, pwSignals);
        }
        sendEvent('click', target, valueBefore, valueAfter, checkedBefore, checkedAfter, null, mergedCtx);
      });
    }, 0);
  } else {
    // Regular click — start surface detection
    detectSurfaceAfterClick((surfaceData) => {
      // Read page-world signals (dialog/window.open may have been triggered)
      const pwSignals = readPageWorldSignals();
      const mergedCtx: DomContext = { ...clickDomCtx };
      if (surfaceData) {
        mergedCtx.surfaceType = surfaceData.surfaceType as DomContext['surfaceType'];
        mergedCtx.surfaceRole = surfaceData.surfaceRole;
        mergedCtx.surfaceLabel = surfaceData.surfaceLabel;
      }
      if (pwSignals) {
        Object.assign(mergedCtx, pwSignals);
      }
      sendEvent('click', target, valueBefore, valueAfter, null, null, null, mergedCtx);
    });
  }
}, true);

// ── blur: element lost focus ───────────────────────────────────────────

document.addEventListener('blur', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  // ── Flush pending date picker debounce on blur ──
  // When a custom date picker text input loses focus, the user has
  // committed their selection. Flush the debounce timer immediately.
  if (datePickerDebounce && datePickerDebounce.target === target) {
    if (datePickerDebounce.timer) {
      clearTimeout(datePickerDebounce.timer);
    }
    const finalValue = datePickerDebounce.lastValue;
    const beforeValue = datePickerDebounce.valueBefore;
    const targetEl = datePickerDebounce.target;
    clearDatePickerDebounce();
    // Only emit if the value actually changed
    if (finalValue !== beforeValue) {
      sendDateSelectEvent(targetEl, beforeValue, finalValue);
    }
  }

  // Blur events are ONLY recorded for text-entry elements (same as focus).
  // Blur on date pickers, buttons, divs, calendar cells, etc. is noise.
  if (!isTextEntryElement(target)) return;

  const key = elementKey(target);
  const snapshot = valueTracker.get(key);
  if (!snapshot) return; // only send blur for elements we tracked on focus

  const valueAfter = captureValue(target) ?? null;

  sendEvent('blur', target, snapshot.value, valueAfter, null, null);

  // Clean up tracker entry
  valueTracker.delete(key);
}, true);

// ── dblclick: double click interaction ──────────────────────────────────

document.addEventListener('dblclick', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  sendEvent('dblclick', target, null, null, null, null);
}, true);

// ── contextmenu: right click ────────────────────────────────────────────

document.addEventListener('contextmenu', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  sendEvent('contextmenu', target, null, null, null, null);
}, true);

// ── mouseenter: smart hover detection ──────────────────────────────────
//
// A hover is only captured when it produces a VISIBLE change:
//   - A tooltip appears (React/JS appends a new DOM node)
//   - A CSS mega-menu opens (CSS :hover toggles display:none → block)
//   - A dropdown panel expands (class or style attribute changes)
//
// Two complementary signals are used:
//   1. MutationObserver — catches JS-driven changes (React tooltips, etc.)
//   2. CSS :hover rule analysis — scans stylesheets for :hover rules that
//      change visibility properties (display, visibility, opacity, transform,
//      height, width, max-height, pointer-events) on the element or its
//      ancestor chain. This directly detects CSS-driven mega-menus WITHOUT
//      relying on timing (the old visibility-count-diff approach was broken
//      because :hover is already active when mouseover fires).
//
// CSS :hover mega-menus typically work like:
//   <li><a>Services</a><div class="mega-menu">...</div></li>
//   CSS: li:hover .mega-menu { display: block }
// The mega-menu is hidden by default (display:none) and shown when the
// parent <li> matches :hover. Since :hover is a browser pseudo-class that
// can't be toggled via JS, we scan CSSStyleSheet rules directly.

let hoverObserver: MutationObserver | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hoverTarget: Element | null = null;
let hoverMutationSeen = false;
let hoverCssReveal = false;

/**
 * Properties that, when changed by a :hover rule, indicate the element
 * reveals new content on hover.
 *
 * IMPORTANT: `opacity` and `transform` are decorative-only — they're used
 * for hover effects on links, buttons, etc. (e.g. a:hover { opacity: 0.8 }).
 * They do NOT indicate content reveal by themselves. Only keep them as
 * reveal indicators when the :hover selector targets a DESCENDANT element.
 */
const HOVER_REVEAL_PROPS_DESCENDANT = new Set([
  'display', 'visibility', 'opacity', 'transform',
  'height', 'max-height', 'width', 'max-width',
  'pointer-events', 'top', 'left', 'right', 'bottom',
  'clip', 'clip-path', 'overflow',
]);

const HOVER_REVEAL_PROPS_SELF = new Set([
  'display', 'visibility', 'height', 'max-height',
  'width', 'max-width', 'overflow',
  // No opacity, transform — those are decorative effects on the element itself
  // No top/left/right/bottom — those are typically transitions, not reveals
]);

/**
 * Collect all CSSStyleRules from a stylesheet, recursing into @media,
 * @supports, @container, and other conditional group rules.
 */
function collectAllStyleRules(sheet: CSSStyleSheet): CSSStyleRule[] {
  const results: CSSStyleRule[] = [];

  function scanRules(ruleList: CSSRuleList): void {
    for (let i = 0; i < ruleList.length; i++) {
      const rule = ruleList[i];

      if (rule instanceof CSSStyleRule) {
        results.push(rule);
      } else if (
        rule instanceof CSSMediaRule ||
        rule instanceof CSSSupportsRule
      ) {
        try {
          if (rule.cssRules) scanRules(rule.cssRules);
        } catch { /* skip */ }
      } else if (rule && 'cssRules' in rule) {
        try {
          const nested = (rule as any).cssRules as CSSRuleList;
          if (nested && nested.length > 0) scanRules(nested);
        } catch { /* skip */ }
      }
    }
  }

  try {
    scanRules(sheet.cssRules);
  } catch {
    // SecurityError on cross-origin stylesheets
  }

  return results;
}

/**
 * Split a CSS selector on commas that are at top level (paren-depth 0).
 *
 * CSS selector lists are comma-separated, but commas also appear inside
 * pseudo-class function argument lists (:is(), :where(), :not(), :has())
 * and inside attribute selectors ([attr="a,b"]). A naive `.split(',')`
 * shatters these into invalid fragments.
 *
 * This function tracks paren depth (`()`) and bracket depth (`[]`) and only
 * splits on commas at depth 0 — i.e. genuine selector-list separators.
 *
 * Examples:
 *   '.a:hover, .b:hover'                              → ['.a:hover', '.b:hover']
 *   ':is(.a:hover, .b:hover) .c'                       → [':is(.a:hover, .b:hover) .c']
 *   '[data-tags~="a,b"]:hover .c'                      → ['[data-tags~="a,b"]:hover .c']
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
  return parts.filter((p) => p.length > 0);
}

/**
 * Split a single CSS selector on descendant/child/sibling combinators
 * (whitespace, >, +, ~) that are at top level (paren-depth 0).
 *
 * Combinators can appear inside pseudo-class functions and attribute
 * selectors — e.g. `:is(.a, .b)` (whitespace after the comma), `:has(> .x)`
 * (`>` as a relative-selector prefix), `[attr~=value]` (`~` in `~=`). A
 * naive regex split on `/>+~|\s+/` breaks these apart incorrectly.
 *
 * This function tracks paren/bracket depth and only splits on combinators
 * at depth 0.
 *
 * Examples:
 *   '.nav-item:hover .mega-menu'                       → ['.nav-item:hover', '.mega-menu']
 *   ':is(.a:hover, .b.open) .c'                        → [':is(.a:hover, .b.open)', '.c']
 *   '.card:has(> .trigger):hover .content'             → ['.card:has(> .trigger):hover', '.content']
 *   '[data-tags~="a,b"]:hover .content'                → ['[data-tags~="a,b"]:hover', '.content']
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
      // Note: `~` inside `[attr~=value]` is at depth≥1 (inside []), so it
      // is never mistaken for a general-sibling combinator here.
      if (ch === '>' || ch === '+' || ch === '~') {
        if (i > start) tokens.push(selector.slice(start, i).trim());
        start = i + 1;
      } else if (ch === ' ' || ch === '\t') {
        // Descendant combinator (whitespace) — coalesce runs and split
        if (i > start) tokens.push(selector.slice(start, i).trim());
        while (i + 1 < selector.length && (selector[i + 1] === ' ' || selector[i + 1] === '\t')) i++;
        start = i + 1;
      }
    }
  }
  if (start < selector.length) tokens.push(selector.slice(start).trim());
  return tokens.filter((t) => t.length > 0);
}

/**
 * Check if a CSSStyleRule's :hover selector matches any ancestor of
 * the hovered element and changes a visibility property.
 *
 * Key distinction between content reveals and decorative hovers:
 *   - DESCENDANT pattern: ".nav-item:hover .mega-menu { display: block }"
 *     → :hover is on one element, property changes a CHILD → real reveal
 *   - SELF pattern: "a:hover { opacity: 0.8 }"
 *     → :hover and property change on SAME element → decorative effect
 *
 * For SELF patterns, only display/visibility changes count as reveals.
 * opacity/transform on the same element are always decorative.
 *
 * Uses parenthesis-aware splitting so modern CSS pseudo-class functions
 * (:is(), :where(), :not(), :has()) are handled correctly — a naive
 * .split(',') or regex combinator split shatters these.
 */
function ruleMatchesHover(
  rule: CSSStyleRule,
  ancestors: Element[],
): boolean {
  const selector = rule.selectorText;
  if (!selector || !selector.includes(':hover')) return false;

  // Handle comma-separated selectors (parenthesis-aware: does not split
  // inside :is(), :where(), :not(), :has(), or attribute selectors).
  const selectorParts = splitSelectorOnTopLevelCommas(selector);

  for (const selPart of selectorParts) {
    if (!selPart.includes(':hover')) continue;

    // Split on descendant/child combinators to find the :hover-bearing part.
    // Parenthesis-aware: does not split on combinators inside function args.
    const tokens = splitSelectorOnCombinators(selPart);
    const hoverTokenIdx = tokens.findIndex((t) => t.includes(':hover'));
    if (hoverTokenIdx === -1) continue;
    const hoverToken = tokens[hoverTokenIdx];

    // Does the selector target a descendant (parts after the :hover token)?
    const isDescendantTarget = hoverTokenIdx < tokens.length - 1;

    // Choose property set based on whether this targets a descendant
    const propSet = isDescendantTarget
      ? HOVER_REVEAL_PROPS_DESCENDANT
      : HOVER_REVEAL_PROPS_SELF;

    let hasRevealProp = false;
    const style = rule.style;
    for (let p = 0; p < style.length; p++) {
      if (propSet.has(style[p])) {
        hasRevealProp = true;
        break;
      }
    }
    if (!hasRevealProp) continue;

    // Strip :hover and pseudo-elements for element.matches()
    const baseSelector = hoverToken
      .replace(':hover', '')
      .replace(/::[\w-]+/g, '')
      .trim();
    if (!baseSelector) return true; // bare ":hover" matches anything

    for (const ancestor of ancestors) {
      try {
        if (ancestor.matches(baseSelector)) return true;
      } catch { /* invalid selector — skip */ }
    }
  }

  return false;
}

/**
 * Check if any CSS stylesheet has a :hover rule that would reveal content
 * for the given element or its ancestor chain.
 *
 * Scans all stylesheets recursively (including @media, @supports rules)
 * for :hover selectors that change visibility properties.
 */
function hasCssHoverReveal(el: Element): boolean {
  const ancestors: Element[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < 5) {
    ancestors.push(current);
    current = current.parentElement;
    depth++;
  }

  try {
    for (const sheet of document.styleSheets) {
      const rules = collectAllStyleRules(sheet);
      for (const rule of rules) {
        if (ruleMatchesHover(rule, ancestors)) return true;
      }
    }
  } catch { /* skip */ }

  return false;
}

/**
 * Check if hovering the element reveals nearby content by comparing
 * computed styles. This catches:
 *   - React/JS hovers that toggle inline styles (display: none → block)
 *   - CSS-in-JS that injects dynamic styles
 *   - CSS :hover rules in stylesheets we can't read (cross-origin)
 *
 * Approach: After a short delay, check if the element has siblings or
 * nearby descendants that are currently visible and positioned as
 * dropdowns/menus (absolute/fixed position, larger than 50px).
 *
 * This is a fallback signal supplementing hasCssHoverReveal().
 */
function hasNearbyRevealContent(el: Element): boolean {
  // Check siblings and parent's children for positioned overlay elements
  const parent = el.parentElement;
  if (!parent) return false;

  const siblings = parent.children;
  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === el) continue;
    if (!(sibling instanceof HTMLElement)) continue;
    if (!isVisible(sibling)) continue;

    const style = window.getComputedStyle(sibling);
    const isPositioned = style.position === 'absolute' || style.position === 'fixed';
    const hasSize = sibling.offsetWidth > 50 && sibling.offsetHeight > 50;

    // A visible, positioned, sizable sibling next to a hovered element
    // strongly suggests a dropdown/mega-menu
    if (isPositioned && hasSize) {
      // Verify it's actually NEW (was likely hidden before hover)
      // Check if it has display:none in its own class or style
      // by looking for common dropdown class patterns
      const cls = (sibling.className || '').toLowerCase();
      const isDropdownLike =
        cls.includes('dropdown') ||
        cls.includes('menu') ||
        cls.includes('mega') ||
        cls.includes('popover') ||
        cls.includes('tooltip') ||
        cls.includes('panel') ||
        cls.includes('flyout') ||
        cls.includes('submenu') ||
        cls.includes('sub-menu') ||
        // Or it has aria-haspopup on the hovered element
        el.getAttribute('aria-haspopup') !== null;
      if (isDropdownLike) return true;
    }
  }

  return false;
}

function startHoverTracking(target: Element): void {
  clearHoverTracking();

  hoverTarget = target;
  hoverMutationSeen = false;
  hoverCssReveal = false;

  // Signal 1: Check CSS :hover rules immediately (no timing dependency)
  hoverCssReveal = hasCssHoverReveal(target);

  // Signal 1b: Check for nearby positioned dropdown/menu content
  if (!hoverCssReveal) {
    hoverCssReveal = hasNearbyRevealContent(target);
  }

  // Signal 2: MutationObserver for JS-driven changes (React tooltips, etc.)
  hoverObserver = new MutationObserver((mutations: MutationRecord[]) => {
    if (!isRecording || !hoverTarget) return;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && isVisible(node)) {
            hoverMutationSeen = true;
            break;
          }
        }
      }
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        const el = mutation.target;
        if (
          mutation.attributeName === 'style' ||
          mutation.attributeName === 'class' ||
          mutation.attributeName === 'hidden'
        ) {
          if (isVisible(el)) {
            hoverMutationSeen = true;
          }
        }
      }
      if (hoverMutationSeen) break;
    }
  });

  observeWithShadowRoots(hoverObserver, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  });

  // Track surface detected during hover
  let hoverSurface: { surfaceType: string; surfaceRole: string | null; surfaceLabel: string | null } | null = null;

  // After 300ms, check signals
  hoverTimer = setTimeout(() => {
    if (!isRecording || !hoverTarget) {
      clearHoverTracking();
      return;
    }

    // Check if a tooltip/surface appeared during hover
    if (hoverMutationSeen) {
      // Scan recently added nodes for surface types
      const addedElements = deepQuerySelectorAll(
        '[role="tooltip"], .tooltip, .MuiTooltip-tooltip, .ant-tooltip-inner, .tippy-box, [data-tippy-root]',
      );
      for (const el of addedElements) {
        if (isVisible(el)) {
          const surface = identifySurfaceInline(el);
          if (surface) {
            hoverSurface = surface;
            break;
          }
        }
      }
    }

    if ((hoverMutationSeen || hoverCssReveal) && isRecording && hoverTarget) {
      sendEvent('mouseenter', hoverTarget, null, null, null, null, hoverSurface);
    }
    clearHoverTracking();
  }, 300);
}

function clearHoverTracking(): void {
  if (hoverObserver) {
    hoverObserver.disconnect();
    hoverObserver = null;
  }
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  hoverTarget = null;
  hoverMutationSeen = false;
  hoverCssReveal = false;
}

/**
 * Check if an element is visible (has dimensions and is not display:none).
 */
function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  return true;
}

/**
 * Keywords that indicate an element is a date/time picker trigger.
 * Checked against placeholder, name, id, className, aria-label.
 */
/**
 * Keywords that indicate an element is a date/time picker trigger.
 * Checked against placeholder, name, id, className, aria-label.
 *
 * Uses [^a-z] delimiters instead of \b because underscores (common in
 * name/id attributes like "arrival_date") are word characters that \b
 * won't split on.
 */
const DATE_TRIGGER_KEYWORDS = /(?:^|[^a-z])(date|depart|arrival|return|check.?in|check.?out|from.?date|to.?date|travel|journey|trip|fly|calendar|checkin|checkout)(?:[^a-z]|$)/i;

/**
 * Check if an element is a date/time picker trigger — an input, button, or
 * div that opens a calendar when clicked. These produce DOM mutations
 * (calendar popup appearing) that would be incorrectly attributed to hover.
 *
 * Detection signals:
 *   - placeholder/name/id/class/aria-label contains date keywords
 *   - aria-haspopup containing "dialog" or "grid" (calendar popups)
 *   - Native date input types (input[type=date], etc.)
 *   - Has a data-datepicker or data-date attribute
 */
function isDateTriggerElement(el: Element): boolean {
  // Native date inputs
  if (el instanceof HTMLInputElement) {
    const type = (el.type || '').toLowerCase();
    if (['date', 'datetime-local', 'time', 'month', 'week'].includes(type)) {
      return true;
    }
  }

  // aria-haspopup with calendar/dialog/grid hint
  const haspopup = el.getAttribute('aria-haspopup');
  if (haspopup && /\b(dialog|grid|calendar)\b/i.test(haspopup)) {
    return true;
  }

  // data-datepicker or data-date attribute
  if (el.hasAttribute('data-datepicker') || el.hasAttribute('data-date')) {
    return true;
  }

  // Check text attributes for date keywords
  const placeholder = el.getAttribute('placeholder') || '';
  const name = el.getAttribute('name') || '';
  const id = el.id || '';
  const className = (el instanceof HTMLElement ? el.className : '') || '';
  const ariaLabel = el.getAttribute('aria-label') || '';
  const combined = `${placeholder} ${name} ${id} ${className} ${ariaLabel}`;

  return DATE_TRIGGER_KEYWORDS.test(combined);
}

// ════════════════════════════════════════════════════════════════════════
// DATE PICKER CAPTURE — debounced value-outcome model
// ════════════════════════════════════════════════════════════════════════

/**
 * Native HTML date input types that produce ISO values from el.value.
 */
const NATIVE_DATE_TYPES = new Set(['date', 'datetime-local', 'time', 'month', 'week']);

/**
 * Map native input type → dateType for normalization hints.
 */
const NATIVE_DATE_TYPE_MAP: Record<string, string> = {
  'date': 'date',
  'datetime-local': 'dateTime',
  'time': 'time',
  'month': 'month',
  'week': 'week',
};

/**
 * Calendar grid cell detection — same patterns as the classifier's
 * isCalendarCell() helper, inlined here for the content script.
 */
const CALENDAR_CELL_CLASS_PATTERN = /\bday\b|\bcell\b|\bdate\b|gridcell|calendar|react-datepicker__day/i;
const CALENDAR_CELL_ROLE = 'gridcell';

/**
 * Check if an element is a calendar grid cell (a clickable day in a date picker).
 */
function isCalendarCell(el: Element): boolean {
  const role = el.getAttribute('role');
  if (role === CALENDAR_CELL_ROLE) return true;
  const className = (el instanceof HTMLElement ? el.className : '') || '';
  return CALENDAR_CELL_CLASS_PATTERN.test(className);
}

/**
 * Check if an element is inside a calendar/datepicker container.
 * Used to tag scroll, hover, and click events on calendar navigation
 * buttons as ownedByDatePicker — they are evidence-only, not standalone
 * interactions.
 */
const CALENDAR_POPOVER_PATTERN = /calendar|datepicker|date-picker|date_picker|react-datepicker|flatpickr-calendar|ant-picker/i;
const CALENDAR_POPOVER_SELECTOR = '[role="grid"], [role="dialog"][aria-label*="calendar" i], [data-datepicker], [data-date]';

function isInsideCalendarPopover(el: Element): boolean {
  // Check the element itself and its ancestors
  let current: Element | null = el;
  for (let i = 0; i < 10 && current; i++) {
    // Check role attributes
    const role = current.getAttribute('role');
    if (role === 'grid' || role === 'gridcell') return true;

    // Check class name patterns
    const className = (current instanceof HTMLElement ? current.className : '') || '';
    if (className && CALENDAR_POPOVER_PATTERN.test(className)) return true;

    // Check data attributes
    if (current.hasAttribute('data-datepicker') || current.hasAttribute('data-date')) return true;

    current = current.parentElement;
  }

  // Also check via closest() for ARIA grid containers
  if (el.closest && el.closest(CALENDAR_POPOVER_SELECTOR)) return true;

  return false;
}

/**
 * Resolve the date input element associated with a calendar cell click.
 * Walks up the DOM to find a containing calendar/datepicker element,
 * then looks for an associated input within the same container.
 */
function resolveDateInputFromCell(cell: Element): Element | null {
  const CALENDAR_CONTAINER_PATTERN = /calendar|datepicker|date-picker|date_picker/i;
  let current: Element | null = cell;
  for (let i = 0; i < 10 && current; i++) {
    const className = (current instanceof HTMLElement ? current.className : '') || '';
    if (CALENDAR_CONTAINER_PATTERN.test(className) || current.getAttribute('role') === 'dialog') {
      // Found the calendar container — look for a date input inside it
      const inputs = current.querySelectorAll('input');
      for (const input of inputs) {
        if (input instanceof HTMLInputElement && NATIVE_DATE_TYPES.has((input.type || '').toLowerCase())) {
          return input;
        }
        // Also accept text inputs that look like date fields
        if (isDateTriggerElement(input)) {
          return input;
        }
      }
      // Container found but no input — return the container itself
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Inlined date normalization — content scripts cannot import modules.
 * This mirrors src/shared/date-normalizer.ts but is simplified for the
 * content script's needs. Full normalization happens in the service worker
 * via the shared utility; here we just capture the raw value and a basic
 * ISO attempt for native inputs.
 */

/**
 * Get the dateType from a native input element's type attribute.
 */
function getNativeDateType(el: HTMLInputElement): string | null {
  const type = (el.type || '').toLowerCase();
  return NATIVE_DATE_TYPE_MAP[type] ?? null;
}

/**
 * Debounce state for date picker value capture.
 *
 * When a date picker value changes, we wait for the value to stabilize
 * before emitting a dateSelect event. This prevents capturing intermediate
 * states while the user is navigating the calendar or typing a partial date.
 */
interface DatePickerDebounce {
  timer: ReturnType<typeof setTimeout> | null;
  target: Element;
  valueBefore: string | null;
  lastValue: string | null;
}

let datePickerDebounce: DatePickerDebounce | null = null;
const DATE_DEBOUNCE_MS = 800;

/**
 * Clear any pending date picker debounce.
 * Called on STOP_RECORDING and when a new date interaction starts.
 */
function clearDatePickerDebounce(): void {
  if (datePickerDebounce?.timer) {
    clearTimeout(datePickerDebounce.timer);
  }
  datePickerDebounce = null;
}

/**
 * Send a dateSelect event with normalized date metadata in the DomContext.
 *
 * The actual normalization is done here (inlined) since the content script
 * can't import the shared utility. We capture:
 *   - dateType: from the input's type attribute
 *   - isoValue: the raw value (already ISO for native inputs)
 *   - displayValue: a human-readable version (basic conversion)
 *   - dateAmbiguous/dateConfidence: for invalid values
 */
function sendDateSelectEvent(
  target: Element,
  valueBefore: string | null,
  valueAfter: string | null,
): void {
  let dateType: string | null = null;
  let isoValue = valueAfter ?? '';
  let displayValue = valueAfter ?? '';
  let dateAmbiguous = false;
  let dateWarning: string | undefined;
  let dateConfidence = 1.0;

  if (target instanceof HTMLInputElement) {
    dateType = getNativeDateType(target);
    if (dateType) {
      // Native date input — el.value is already ISO
      isoValue = valueAfter ?? '';
      // Basic display conversion for native date
      displayValue = isoToDisplayInlined(isoValue, dateType);
      // Validate: check if the ISO value looks valid
      if (isoValue && !isValidIsoDate(isoValue, dateType)) {
        dateAmbiguous = true;
        dateWarning = `Potentially invalid date value: "${isoValue}"`;
        dateConfidence = 0.5;
      }
    } else {
      // Text input with date keywords (custom date picker)
      dateType = 'date';
      displayValue = valueAfter ?? '';
      // For custom pickers, the value may be in display format
      // The service worker / classifier can further normalize
      dateConfidence = 0.8;
    }
  } else if (isCalendarCell(target)) {
    // Calendar grid cell click — value comes from aria-label
    dateType = 'date';
    const ariaLabel = target.getAttribute('aria-label') || '';
    displayValue = ariaLabel || valueAfter || '';
    // The aria-label is a display date; the classifier will normalize
    dateConfidence = 0.9;
  }

  const domContext = captureDomContext(target);
  domContext.dateType = dateType ?? 'date';
  domContext.isoValue = isoValue;
  domContext.displayValue = displayValue;
  domContext.dateAmbiguous = dateAmbiguous;
  if (dateWarning) domContext.dateWarning = dateWarning;
  domContext.dateConfidence = dateConfidence;

  sendEvent('dateSelect', target, valueBefore, valueAfter, null, null, null, domContext);
}

/**
 * Inlined ISO→display conversion (content script can't import modules).
 * Only handles the basic cases — the full normalizer lives in the service worker.
 */
function isoToDisplayInlined(iso: string, dateType: string): string {
  if (!iso) return '';
  const months = ['', 'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  if (dateType === 'date') {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      return `${months[parseInt(m[2], 10)]} ${parseInt(m[3], 10)}, ${m[1]}`;
    }
  } else if (dateType === 'dateTime') {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})$/);
    if (m) {
      return `${months[parseInt(m[2], 10)]} ${parseInt(m[3], 10)}, ${m[1]}, ${m[4].padStart(2, '0')}:${m[5]}`;
    }
  } else if (dateType === 'time') {
    return iso;
  } else if (dateType === 'month') {
    const m = iso.match(/^(\d{4})-(\d{2})$/);
    if (m) {
      return `${months[parseInt(m[2], 10)]} ${m[1]}`;
    }
  }
  return iso;
}

/**
 * Basic ISO date validation (content script level).
 */
function isValidIsoDate(iso: string, dateType: string): boolean {
  if (dateType === 'time') return /^\d{1,2}:\d{2}(:\d{2})?$/.test(iso);
  if (dateType === 'month') return /^\d{4}-\d{2}$/.test(iso) && parseInt(iso.slice(5, 7), 10) <= 12;
  if (dateType === 'week') return /^\d{4}-W\d{1,2}$/.test(iso);
  if (dateType === 'dateTime') return /^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}$/.test(iso);
  // date
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Handle a potential date picker value change.
 * Called from the change handler when the target is a date control.
 * Uses debouncing to capture only the final stabilized value.
 */
function handleDateValueChange(
  target: Element,
  valueBefore: string | null,
  valueAfter: string | null,
): boolean {
  // Only proceed if this is a date-related element
  if (!isDateTriggerElement(target) && !isCalendarCell(target)) {
    return false;
  }

  // Clear any existing debounce for a different target
  if (datePickerDebounce && datePickerDebounce.target !== target) {
    clearDatePickerDebounce();
  }

  // Track the latest value
  if (!datePickerDebounce) {
    datePickerDebounce = {
      timer: null,
      target,
      valueBefore,
      lastValue: valueAfter,
    };
  } else {
    datePickerDebounce.lastValue = valueAfter;
  }

  // Set/reset the debounce timer
  if (datePickerDebounce.timer) {
    clearTimeout(datePickerDebounce.timer);
  }
  datePickerDebounce.timer = setTimeout(() => {
    if (datePickerDebounce && isRecording) {
      const finalValue = datePickerDebounce.lastValue;
      const beforeValue = datePickerDebounce.valueBefore;
      const targetEl = datePickerDebounce.target;
      clearDatePickerDebounce();
      sendDateSelectEvent(targetEl, beforeValue, finalValue);
    } else {
      clearDatePickerDebounce();
    }
  }, DATE_DEBOUNCE_MS);

  return true; // Handled as a date picker event
}

document.addEventListener('mouseover', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  // Post-click hover cooldown: suppress all new hover tracking for a period
  // after any click. This prevents DOM mutations from click-triggered UI
  // changes (calendar opening/closing, dropdown expanding, modal toggling)
  // from being detected by the hover MutationObserver and firing spurious
  // mouseenter events.
  if (Date.now() < hoverSuppressedUntil) {
    return;
  }

  // Skip hover tracking for elements inside modal/dialog/calendar/grid
  // containers. Hovering inside a calendar picker, modal dialog, or grid
  // is browsing, not a meaningful hover interaction.
  if (target.closest('[role="dialog"], [role="grid"], [role="listbox"], [role="menu"], [class*="calendar"], [class*="datepicker"], [class*="modal"], [class*="popup"], [class*="overlay"]')) {
    // Only skip if the container itself is the one with hover behavior —
    // but individual menu items inside a [role="menu"] may still be relevant.
    // We still skip for calendar/grid/dialog as those are almost never
    // hover-reveal containers.
    if (target.closest('[role="dialog"], [role="grid"], [class*="calendar"], [class*="datepicker"], [class*="modal"], [class*="popup"], [class*="overlay"]')) {
      clearHoverTracking();
      return;
    }
  }

  // Skip hover tracking on date picker trigger elements.
  // Date triggers (inputs/buttons with "Depart on", "Check-in", etc.) open
  // calendar popups on CLICK, not on hover. But the calendar DOM mutation
  // would be detected by the MutationObserver and incorrectly attributed
  // to the hover, producing a spurious mouseenter event.
  if (isDateTriggerElement(target)) {
    clearHoverTracking();
    return;
  }

  // Only track if target is different from current hover
  if (hoverTarget && elementKey(hoverTarget) === elementKey(target)) return;

  startHoverTracking(target);
}, true);

document.addEventListener('mouseout', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  // If leaving the hovered element, cancel tracking
  if (hoverTarget && elementKey(hoverTarget) === elementKey(target)) {
    clearHoverTracking();
  }
}, true);

// ── scroll: page/container scroll detection ─────────────────────────────

let scrollTimer: ReturnType<typeof setTimeout> | null = null;
let lastScrollTarget: Element | null = null;
let lastScrollTop = 0;
let lastScrollLeft = 0;
let scrollInitialized = false;
let lastClickTime = 0;

/**
 * Hover cooldown: after a click, suppress new hover tracking for this many
 * milliseconds. Clicks trigger DOM mutations (calendar popup opening/closing,
 * dropdown expanding, modal appearing/disappearing) that the hover
 * MutationObserver would detect and incorrectly attribute to a new hover
 * on whatever element the mouse happens to be over. The cooldown covers
 * both the opening and closing mutation cycles.
 */
const HOVER_COOLDOWN_MS = 1500;
let hoverSuppressedUntil = 0;

document.addEventListener('scroll', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  // Ignore scrolls that happen within 1 second of a click — these are
  // almost always caused by UI changes (calendar opening, dropdown
  // expanding, accordion opening) rather than deliberate user scrolling.
  const now = Date.now();
  if (now - lastClickTime < 1000) return;

  // Determine scroll target — either the scrolled element or document
  const target = event.target instanceof Element ? resolveTarget(event) : null;
  const scrollEl = target || document.scrollingElement || document.documentElement;

  // Get current scroll position
  let currentTop = 0;
  let currentLeft = 0;
  if (scrollEl instanceof HTMLElement) {
    currentTop = scrollEl.scrollTop;
    currentLeft = scrollEl.scrollLeft;
  } else if (scrollEl === document.scrollingElement || scrollEl === document.documentElement) {
    currentTop = window.scrollY;
    currentLeft = window.scrollX;
  }

  // First scroll after recording starts — initialize baseline without recording
  if (!scrollInitialized) {
    lastScrollTop = currentTop;
    lastScrollLeft = currentLeft;
    scrollInitialized = true;
    return;
  }

  // Calculate delta from last scroll position
  const delta = Math.abs(currentTop - lastScrollTop) + Math.abs(currentLeft - lastScrollLeft);

  // ALWAYS update the baseline, even for small scrolls. This prevents
  // multiple small scrolls (e.g., 60px + 60px) from accumulating and
  // eventually crossing the threshold as a sum. Only a single continuous
  // scroll exceeding the threshold should be recorded.
  lastScrollTop = currentTop;
  lastScrollLeft = currentLeft;

  // Ignore small scrolls (< 100px) — likely triggered by UI changes
  // (calendar opening, dropdown expanding, modal appearing, smooth scroll
  // animations) rather than deliberate user scrolling
  if (delta < 100) return;

  // Debounce — coalesce rapid scroll events into one
  if (scrollTimer) {
    clearTimeout(scrollTimer);
  }

  lastScrollTarget = scrollEl;
  scrollTimer = setTimeout(() => {
    if (lastScrollTarget && isRecording) {
      // Tag scroll events inside calendar popovers as evidence-only
      if (isInsideCalendarPopover(lastScrollTarget)) {
        const ctx = captureDomContext(lastScrollTarget);
        ctx.ownedByDatePicker = true;
        sendEvent('scroll', lastScrollTarget, null, null, null, null, null, ctx);
      } else {
        sendEvent('scroll', lastScrollTarget, null, null, null, null);
      }
    }
    scrollTimer = null;
  }, 200);
}, true);

// ── dragstart: drag & drop start ────────────────────────────────────────

document.addEventListener('dragstart', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  sendEvent('dragstart', target, null, null, null, null);
}, true);

// ── drop: drag & drop end ───────────────────────────────────────────────

/**
 * CSS class patterns that identify an upload dropzone container.
 * Checked against the drop target and its ancestors.
 */
const DROPZONE_CLASS_PATTERN = /(?:^|[\s-])(ant-upload|ant-upload-drag|MuiDropzone|MuiDropzoneArea|react-dropzone|dropzone|drop-zone|file-drop|upload-area|upload-zone|upload-drop)(?:[\s-]|$)/i;

/**
 * Check if an element (or its ancestor) is a known upload dropzone.
 * This is used to enrich drop events with accepted file types and
 * context about where the files were dropped.
 */
function findDropzoneAncestor(el: Element): Element | null {
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < 5) {
    const cls = (current as HTMLElement).className;
    if (typeof cls === 'string' && cls.length > 0 && DROPZONE_CLASS_PATTERN.test(cls)) {
      return current;
    }
    // Elements with ondrop handler are dropzones
    if ((current as HTMLElement).hasAttribute('ondrop')) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }
  return null;
}

document.addEventListener('drop', (event) => {
  if (!isRecording) return;
  if (!event.isTrusted) return;

  const target = resolveTarget(event);
  if (!target) return;

  // Capture file metadata from the drop event's dataTransfer.
  // Files dragged from the OS into the browser appear in
  // event.dataTransfer.files — these are drag-drop uploads, not element drags.
  const domCtx = captureDomContext(target);
  const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
  if (droppedFiles.length > 0) {
    domCtx.fileData = droppedFiles.map(f => ({ name: f.name, type: f.type }));
    domCtx.uploadMethod = 'drag-drop';

    // If the drop target is inside a known dropzone, capture its accept attr
    const dropzone = findDropzoneAncestor(target);
    if (dropzone instanceof HTMLElement) {
      const accept = dropzone.getAttribute('accept');
      if (accept) domCtx.acceptedFileTypes = accept;
    }
  }

  sendEvent('drop', target, null, null, null, null, null, domCtx);
}, true);

// ════════════════════════════════════════════════════════════════════════
// END OF DOUBLE-INJECTION GUARD
// ════════════════════════════════════════════════════════════════════════

} // end of __CMDRUNNER_CS_ACTIVE__ guard
