/**
 * Checkbox & Radio Content Script — State-Based Recording
 *
 * Implements the frozen C4.1 Checkbox & Radio Button Product Strategy:
 *   - Detects meaningful state transitions on checkbox and radio controls
 *   - Applies the 5-Gate Decision Process (C4.1 §3.1)
 *   - Records the resulting state (Check/Uncheck/Select), not the click
 *   - Claims ownership to prevent duplicate generic Click recording
 *
 * This file is SELF-CONTAINED — content scripts run in an isolated world
 * and cannot import modules. All helpers are inlined.
 *
 * Frozen Product Rules (C4.1):
 *   1. State-Based, Not Click-Based — record the resulting state
 *   2. Meaningful State Changes Only — no-op clicks excluded
 *   3. Detection mechanism is an implementation detail (C4.1 §3.1-3.3)
 *   4. Ownership Priority — state-based > generic click
 *
 * C4.1 5-Gate Decision Tree:
 *   Gate 1: Genuine user interaction?
 *   Gate 2: Not owned by another interaction?
 *   Gate 3: Is the target a checkbox or radio control?
 *   Gate 4: Did the state actually change?
 *   Gate 5: Is the control enabled and interactive?
 */

// ── Recording State ────────────────────────────────────────

/**
 * Recording state flag, synced from chrome.storage.
 * Same pattern as click-content-script: proactive check + async fallback
 * for MV3 timing gaps.
 */
let isRecording = false;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const uiState = changes['ui_state'];
  if (uiState && uiState.newValue) {
    isRecording = uiState.newValue.recordingState === 'recording';
  }
});

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
  } catch {
    // ignore
  }
  return isRecording;
}

// ── Checkbox/Radio Control Detection ─────────────────────

/**
 * Selector for checkbox and radio controls — native HTML and ARIA.
 *
 * Gate 3 (C4.1 §3.1): "Is the target a checkbox or radio control?"
 * Detects both native <input> controls and ARIA-based custom controls.
 */
const CHECKBOX_SELECTOR = [
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="switch"]',
].join(', ');

const RADIO_SELECTOR = [
  'input[type="radio"]',
  '[role="radio"]',
  '[role="menuitemradio"]',
].join(', ');

/**
 * Determine if an element is a checkbox-type control.
 */
function isCheckboxControl(el: Element): boolean {
  return el.matches(CHECKBOX_SELECTOR) && !el.matches(RADIO_SELECTOR);
}

/**
 * Determine if an element is a radio-type control.
 */
function isRadioControl(el: Element): boolean {
  return el.matches(RADIO_SELECTOR);
}

/**
 * Get the checked state of a checkbox/radio control.
 *
 * For native <input> elements, uses the .checked property.
 * For ARIA controls, checks aria-checked attribute.
 *
 * Returns true if checked/selected, false if unchecked/unselected.
 */
function getCheckedState(el: Element): boolean {
  // Native input elements
  if (el instanceof HTMLInputElement) {
    return el.checked;
  }

  // ARIA controls: aria-checked="true" means checked/selected
  const ariaChecked = el.getAttribute('aria-checked');
  return ariaChecked === 'true';
}

/**
 * Resolve the checkbox/radio target from an event.
 *
 * Walks composedPath() to find the nearest matching control.
 * Falls back to parentElement walk, then to event.target.
 */
function resolveTarget(event: Event): Element | null {
  const rawTarget = event.target;
  if (!rawTarget || !(rawTarget instanceof Element)) {
    return null;
  }

  // Strategy 1: Walk composedPath
  const path = event.composedPath();
  for (const node of path) {
    if (node instanceof Element && node.matches(CHECKBOX_SELECTOR)) {
      return node;
    }
  }

  // Strategy 2: Parent walk (doesn't cross shadow)
  let current: Element | null = rawTarget;
  while (current) {
    if (current.matches(CHECKBOX_SELECTOR)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

/**
 * Resolve the target from any event using a given selector.
 *
 * WARN-4 FIX: Walks composedPath() to find the nearest ancestor matching
 * the selector. This handles clicks on child elements (icons, text spans)
 * inside a button/element with the target attribute.
 *
 * Falls back to parentElement walk, then to raw event.target.
 */
function resolveTargetFromEvent(event: Event, selector: string): Element | null {
  const rawTarget = event.target;
  if (!rawTarget || !(rawTarget instanceof Element)) {
    return null;
  }

  // Direct match — fast path
  if (rawTarget.matches(selector)) return rawTarget;

  // Strategy 1: Walk composedPath
  const path = event.composedPath();
  for (const node of path) {
    if (node instanceof Element && node.matches(selector)) {
      return node;
    }
  }

  // Strategy 2: Parent walk
  let current: Element | null = rawTarget;
  while (current) {
    if (current.matches(selector)) return current;
    current = current.parentElement;
  }

  return null;
}

// ── Ownership Check ───────────────────────────────────────

/**
 * Check if another interaction has already claimed this element.
 *
 * Gate 2 (C4.1 §3.1): "Does another interaction own it?"
 * The data-cmdrunner-handled attribute is the ownership signal.
 * Same pattern as click-content-script.
 */
function isOwnedByAnother(target: Element): boolean {
  return !!target.closest('[data-cmdrunner-handled]');
}

/**
 * Claim ownership of the target element.
 *
 * C4.1 §6.2: Checkbox/Radio takes precedence over generic Click.
 * After recording a state change, we mark the element as handled
 * so the click content script's Gate 2 check prevents duplicate
 * generic Click recording.
 */
function claimOwnership(target: Element): void {
  target.setAttribute('data-cmdrunner-handled', 'checkbox-radio');
}

// ── Enabled/Interactive Check ─────────────────────────────

/**
 * Check if the control is enabled and interactive.
 *
 * Gate 5 (C4.1 §3.1): "Is the control enabled and interactive?"
 * Excludes disabled, read-only, and aria-disabled controls.
 */
function isControlEnabled(el: Element): boolean {
  // Disabled attribute (native inputs)
  if (el instanceof HTMLInputElement && el.disabled) return false;

  // Read-only attribute
  if (el instanceof HTMLInputElement && el.readOnly) return false;

  // aria-disabled
  if (el.getAttribute('aria-disabled') === 'true') return false;

  // fieldset[disabled] ancestor disables nested inputs
  const fieldset = el.closest('fieldset[disabled]');
  if (fieldset) return false;

  return true;
}

// ── Accessible Name Computation ───────────────────────────

/**
 * Compute the accessible name for an element.
 *
 * Priority order (standard accessibility model):
 *   1. aria-label
 *   2. aria-labelledby (resolve referenced elements)
 *   3. Associated <label for="id"> element
 *   4. Wrapping <label> element
 *   5. title attribute
 *   6. value/name attribute fallback
 */
function computeAccessibleName(el: Element): string {
  // 1. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return truncate(ariaLabel.trim(), 200);

  // 2. aria-labelledby
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
    if (texts.length > 0) return truncate(texts.join(' '), 200);
  }

  // 3. Associated <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (label) {
      const text = label.textContent?.trim();
      if (text) return truncate(text, 200);
    }
  }

  // 4. Wrapping <label>
  const parent = el.parentElement;
  if (parent && parent.tagName === 'LABEL') {
    // Use the label text minus the control's own text
    const text = parent.textContent?.trim();
    if (text) return truncate(text, 200);
  }

  // 5. title attribute
  const title = el.getAttribute('title');
  if (title && title.trim()) return truncate(title.trim(), 200);

  // 6. value attribute (checkbox/radio often have meaningful values)
  if (el instanceof HTMLInputElement && el.value) {
    return truncate(el.value, 200);
  }

  // 7. name attribute as last resort
  const nameAttr = el.getAttribute('name');
  if (nameAttr && nameAttr.trim()) return truncate(nameAttr.trim(), 200);

  return '';
}

// ── Role Mapping ──────────────────────────────────────────

function getImplicitRole(el: Element): string | null {
  const explicitRole = el.getAttribute('role');
  if (explicitRole && explicitRole.trim()) return explicitRole.trim();

  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'radio') return 'radio';
  }

  const TAG_ROLE_MAP: Record<string, string> = {
    A: 'link', BUTTON: 'button', NAV: 'navigation', MAIN: 'main',
    HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary',
    H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading',
    H5: 'heading', H6: 'heading', IMG: 'img',
  };
  return TAG_ROLE_MAP[el.tagName] || null;
}

// ── CSS Selector & XPath Generation ───────────────────────

function generateCssSelector(el: Element): string {
  const id = el.id;
  if (id) return `#${cssEscape(id)}`;

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.documentElement && depth < 5) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings = Array.from(parent.children).filter((s) => s.tagName === current!.tagName);
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
  while (current && current !== document.documentElement && depth < 10) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings = Array.from(parent.children).filter((s) => s.tagName === current!.tagName);
    if (siblings.length === 1) parts.unshift(tag);
    else parts.unshift(`${tag}[${siblings.indexOf(current) + 1}]`);
    current = parent;
    depth++;
  }
  return '/' + parts.join('/');
}

function isInShadowDom(el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    if (current.toString().includes('ShadowRoot')) return true;
    const parent = current.parentElement;
    if (!parent && current.getRootNode() instanceof ShadowRoot) return true;
    current = parent;
  }
  return false;
}

// ── Iframe Context Extraction ─────────────────────────────

/**
 * Extract iframe context for elements inside iframes.
 *
 * Same-origin: can access parent document to get frameSelector,
 * frameXPath, frameIndex, frameName, frameId.
 * Cross-origin: only frameSrc (the iframe's own URL) is available.
 *
 * Same pattern as click-content-script.ts.
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

// ── Identity ──────────────────────────────────────────────

interface CheckboxRadioIdentity {
  accessibleName: string;
  ariaRole: string | null;
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
  placeholder: string | null;
  tag: string;
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

function extractIdentity(el: Element): CheckboxRadioIdentity {
  const iframeCtx = extractIframeContext();

  const identity: CheckboxRadioIdentity = {
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

// ── Pre-State Tracking ────────────────────────────────────

/**
 * Map of element → last known checked state.
 *
 * We capture the pre-state when the user first focuses or interacts
 * with the control. At the 'change' event, we compare the current
 * state to this pre-state to determine whether a genuine state
 * transition occurred (Gate 4).
 *
 * Uses element identity key (not Element reference) for resilience
 * against virtual DOM recreation.
 */
const preStateMap = new Map<string, boolean>();

/**
 * Generate a normalized identity key for an element.
 * Same approach as click-content-script: tag + stableId + cssSelector.
 */
function elementKey(el: Element): string {
  return [
    el.tagName,
    el.id || '',
    generateCssSelector(el),
  ].join('|');
}

/**
 * Capture the pre-state of a checkbox/radio control.
 *
 * Called on 'focus' and 'mousedown' to record the control's state
 * BEFORE the user's interaction. This gives us the "before" snapshot
 * for Gate 4 comparison.
 *
 * For 'change' events on native inputs, the browser guarantees
 * the state already changed. So we use preStateMap as the reference
 * for what the state was BEFORE the change. If the control was never
 * focused (preStateMap has no entry), we still process the change event
 * because the change event itself is definitive evidence of a state
 * transition for native controls.
 */
function capturePreState(el: Element): void {
  if (!el.matches(CHECKBOX_SELECTOR)) return;
  preStateMap.set(elementKey(el), getCheckedState(el));
}

// ── Commit ────────────────────────────────────────────────

/**
 * Commit a checkbox state change — send CHECKBOX_CAPTURED.
 *
 * C4.1 §5.4: The CheckboxEvent carries a `checked` field indicating
 * the RESULTING state (true = checked, false = unchecked).
 */
function commitCheckbox(identity: CheckboxRadioIdentity, checked: boolean): void {
  chrome.runtime.sendMessage({
    type: 'CHECKBOX_CAPTURED',
    payload: { ...identity, checked },
  }).catch(() => {
    // Service worker may be asleep — silently ignore
  });
}

/**
 * Commit a radio selection — send RADIO_CAPTURED.
 *
 * C4.1 §5.4: RadioEvent carries no extra field (selection is always "selected").
 */
function commitRadio(identity: CheckboxRadioIdentity): void {
  chrome.runtime.sendMessage({
    type: 'RADIO_CAPTURED',
    payload: identity,
  }).catch(() => {
    // Service worker may be asleep — silently ignore
  });
}

// ── Change Event Handler ──────────────────────────────────

/**
 * Main change event handler — implements the C4.1 5-Gate Decision Tree.
 *
 * The 'change' event fires on checkbox/radio inputs ONLY when the
 * checked property actually changes. This is the primary detection
 * mechanism for native controls.
 *
 * For ARIA controls that dispatch synthetic 'change' events, the
 * pre-state comparison (Gate 4) provides the definitive state transition
 * verification.
 *
 * Decision Tree (C4.1 §3.1):
 *   Gate 1: Is it genuine? (isTrusted)
 *   Gate 2: Does another interaction own it? (data-cmdrunner-handled)
 *   Gate 3: Is the target a checkbox or radio control?
 *   Gate 4: Did the state actually change?
 *   Gate 5: Is the control enabled and interactive?
 */
async function handleChange(event: Event): Promise<void> {
  // ── Gate 1: Is it genuine? ──
  // PRODUCT REQUIREMENT: The state change was triggered by a real user action.
  // IMPLEMENTATION: event.isTrusted === true
  if (!event.isTrusted) return;

  // Recording must be active
  const recording = await checkRecording();
  if (!recording) return;

  if (!event.target) return;

  // ── Target Resolution ──
  const target = resolveTarget(event);
  if (!target) return;

  // ── Gate 2: Does another interaction own it? ──
  // PRODUCT REQUIREMENT: The element has not been claimed by another handler.
  // IMPLEMENTATION: data-cmdrunner-handled attribute
  if (isOwnedByAnother(target)) return;

  // ── Gate 3: Is the target a checkbox or radio control? ──
  // PRODUCT REQUIREMENT: The element is semantically a toggle or select control.
  // IMPLEMENTATION: Selector match (input[type], ARIA role)
  if (!target.matches(CHECKBOX_SELECTOR)) return;

  // ── Gate 5: Is the control enabled and interactive? ──
  // PRODUCT REQUIREMENT: The control is not disabled, read-only, or non-interactive.
  // IMPLEMENTATION: disabled, readOnly, aria-disabled, fieldset[disabled]
  if (!isControlEnabled(target)) return;

  // ── Gate 4: Did the state actually change? ──
  // PRODUCT REQUIREMENT: The control's state was different after the
  // user's interaction compared to before.
  //
  // IMPLEMENTATION: For native <input> elements, the 'change' event itself
  // is definitive proof of a state transition — it only fires when .checked
  // changes. For ARIA controls dispatching synthetic change events, we
  // compare against the pre-state map.
  const currentChecked = getCheckedState(target);
  const key = elementKey(target);
  const preState = preStateMap.get(key);

  // For native inputs: the change event is definitive evidence.
  // For ARIA controls: verify against pre-state map if available.
  if (preState !== undefined) {
    // Pre-state was captured — compare
    if (preState === currentChecked) {
      // State did not change — Gate 4 fails
      return;
    }
  }
  // If no pre-state captured, the trusted change event is sufficient
  // evidence of a transition for native controls.

  // ── ALL GATES PASS → RECORD STATE TRANSITION ──

  const identity = extractIdentity(target);

  if (isRadioControl(target)) {
    // Radio: always "Select" (radio can't be unselected by clicking)
    commitRadio(identity);
  } else {
    // Checkbox: record the resulting state
    commitCheckbox(identity, currentChecked);
  }

  // Claim ownership to prevent duplicate generic Click recording
  claimOwnership(target);

  // Update pre-state map to reflect the new state
  preStateMap.set(key, currentChecked);
}

// ── Click-Based Handler for Custom ARIA Controls ─────────

/**
 * Handle clicks on ARIA checkbox/radio controls that don't dispatch change events.
 *
 * CRITICAL FIX: Custom ARIA controls (role="radio", role="checkbox",
 * role="menuitemradio", role="switch") typically toggle their state via
 * JavaScript on click WITHOUT dispatching a native DOM 'change' event.
 * The change handler (handleChange) never fires for these controls.
 *
 * This handler runs on a 0ms timeout after mousedown to let the
 * application's click handler update the aria-checked state FIRST.
 * Then we read the post-click state for Gate 4 verification.
 *
 * For native <input type="checkbox"> and <input type="radio">, we skip
 * this handler entirely — they dispatch native change events reliably.
 */
async function handleAriaControlClick(event: Event): Promise<void> {
  // ── Gate 1: Is it genuine? ──
  if (!event.isTrusted) return;

  const recording = await checkRecording();
  if (!recording) return;

  const target = resolveTargetFromEvent(event, CHECKBOX_SELECTOR);
  if (!target) return;

  // Skip native <input> elements — they dispatch change events reliably
  if (target instanceof HTMLInputElement) return;

  // ── Gate 2 ──
  if (isOwnedByAnother(target)) return;

  // ── Gate 5 ──
  if (!isControlEnabled(target)) return;

  // ── Read the post-click state ──
  // The application's click handler has already run (we're in capture phase
  // of mousedown, and the state change happens on click which fires after
  // mousedown). We use setTimeout(0) to defer until after the click handler
  // has updated aria-checked.
  const preKey = elementKey(target);
  const preState = preStateMap.get(preKey);

  setTimeout(() => {
    handleAriaControlPostClick(target, preKey, preState);
  }, 0);
}

/**
 * Deferred handler that reads the post-click aria-checked state.
 * Separated from handleAriaControlClick so it can run after the
 * application's click handler has updated the DOM.
 *
 * WARN-1 FIX: Re-checks ownership at execution time to prevent
 * duplicates when frameworks dispatch both change AND update aria-checked.
 */
function handleAriaControlPostClick(
  target: Element,
  key: string,
  preState: boolean | undefined,
): void {
  // WARN-1 FIX: Re-check ownership — the change handler may have already
  // recorded and claimed ownership between mousedown and this deferred callback
  if (isOwnedByAnother(target)) return;

  const currentChecked = getCheckedState(target);

  // ── Gate 4: Did the state actually change? ──
  // For radio controls: if aria-checked is now true, it's a selection.
  // Radio buttons in a group: only one can be aria-checked="true" at a time.
  // If preState was true and currentChecked is true, this is a no-op click
  // (clicking the already-selected radio).
  if (isRadioControl(target)) {
    // Radio: only record if it became checked
    if (!currentChecked) return; // Gate 4 fails — radio was not selected
    // If preState was already true, this was already selected (no-op)
    if (preState === true) return;
  } else {
    // Checkbox: state must have changed
    if (preState !== undefined && preState === currentChecked) return;
  }

  // ── ALL GATES PASS → RECORD STATE TRANSITION ──

  const identity = extractIdentity(target);

  if (isRadioControl(target)) {
    commitRadio(identity);
  } else {
    commitCheckbox(identity, currentChecked);
  }

  claimOwnership(target);
  preStateMap.set(key, currentChecked);
}

// ── Pre-State Capture Handlers ────────────────────────────

/**
 * Listen for focus and mousedown on checkbox/radio controls to capture
 * the pre-interaction state.
 *
 * This is an implementation detail — the product requirement is
 * "confirm a genuine state transition" (C4.1 §3.3). The pre-state map
 * is one mechanism to achieve this.
 */
function handlePreStateCapture(event: Event): void {
  if (!event.isTrusted) return;
  if (!event.target) return;

  const target = event.target;
  if (target instanceof Element && target.matches(CHECKBOX_SELECTOR)) {
    capturePreState(target);
  }
}

// ── Event Listeners ───────────────────────────────────────

// Capture phase: fires BEFORE application handlers — no interference risk.
// The change event on checkbox/radio fires after the state changes.
document.addEventListener('change', handleChange, true);

// Click-based detection for custom ARIA controls (role="radio", role="checkbox",
// role="menuitemradio", role="switch") that toggle state via JavaScript without
// dispatching a native 'change' event. Uses capture-phase mousedown; the actual
// state read happens in a setTimeout(0) after the click handler runs.
document.addEventListener('mousedown', handleAriaControlClick, true);

// Pre-state capture: listen on focus and mousedown (capture phase)
document.addEventListener('focus', handlePreStateCapture, true);
document.addEventListener('mousedown', handlePreStateCapture, true);

// ── Utilities ─────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) : str;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}
