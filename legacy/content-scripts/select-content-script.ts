/**
 * Dropdown & Select Content Script — Universal Value-Based Recording
 *
 * Implements the frozen C5.1 Dropdown & Select Product Strategy:
 *   - Detects meaningful value changes on dropdown controls
 *   - Applies the 5-Gate Decision Process (C5.1 §3.1)
 *   - Records the resulting selected value, not the click sequence
 *
 * C5.2B: Universal dropdown recording — multi-mechanism detection for:
 *   - Native HTML <select> (change event)
 *   - ARIA combobox/listbox (mousedown + keyboard on [role="option"])
 *   - Portaled dropdowns (trigger resolution via aria-controls)
 *   - Keyboard-only selection (Enter/Space)
 *
 * This file is SELF-CONTAINED — content scripts run in an isolated world
 * and cannot import modules. All helpers are inlined.
 *
 * Frozen Product Rules (C5.1):
 *   1. One interaction type for all dropdown categories
 *   2. State-based model — record only when value changes
 *   3. Value-based representation — user-visible option label
 *   4. Ownership Priority — select > generic click when value changes
 *   5. Execution Engine Independence — product model is agnostic to Playwright strategy
 *
 * C5.1 5-Gate Decision Tree:
 *   Gate 1: Genuine user interaction?
 *   Gate 2: Not owned by a DIFFERENT interaction type?
 *   Gate 3: Is the target a dropdown control?
 *   Gate 4: Did the value actually change?
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

// ── Dropdown Control Detection ────────────────────────────

/**
 * Selector for dropdown controls — native HTML and ARIA.
 *
 * Gate 3 (C5.1 §3.1): "Is the target a dropdown control?"
 * Detects native <select> and ARIA-based custom dropdown controls.
 *
 * Note: <select multiple> is excluded per C5.1 §2.3 (multi-select deferred).
 */
const SELECT_SELECTOR = [
  'select:not([multiple])',
  '[role="combobox"]',
  '[role="listbox"]',
].join(', ');

/**
 * Selector for dropdown option elements in custom dropdowns.
 *
 * Custom dropdowns (OXD, React Select, MUI, Ant Design, Headless UI,
 * Radix UI) render their options as <div role="option"> elements.
 * The user selects an option by clicking or pressing Enter — no native
 * 'change' event fires.
 *
 * Also matches elements with aria-selected attribute that may not have
 * an explicit role="option" (some frameworks omit the role), but ONLY
 * when the element is inside a [role="listbox"] or [role="combobox"].
 * This avoids false positives on [role="tab"] elements (which also use
 * aria-selected but belong to tablist, not dropdowns).
 *
 * The loose match is checked at runtime — the selector is narrower than
 * it looks because [aria-selected] elements are filtered by context in
 * handleOptionClick/handleOptionKeydown via the closest() check.
 */
const OPTION_SELECTOR = '[role="option"]';

/**
 * Selector for segmented control buttons using aria-pressed.
 *
 * Segmented controls (common in Adani One, Material UI, Bootstrap)
 * render as a group of <button> elements where only one can be pressed
 * at a time (mutually exclusive). The selected value is the button's
 * text content; the state is tracked via aria-pressed="true".
 *
 * This pattern is semantically equivalent to a radio group or single-
 * select dropdown — the user is choosing one value from a set.
 */
const SEGMENTED_CONTROL_SELECTOR = '[aria-pressed]';

/**
 * CSS class name patterns that indicate selection state.
 *
 * When a user clicks a value-selection element (card, button, div),
 * the application updates the element's CSS classes to visually indicate
 * the selected state. Common class name patterns include:
 *   "selected", "active", "checked", "current", "chosen",
 *   "is-selected", "is-active", "is-checked"
 *
 * This is used as a heuristic to detect CSS-only selection groups —
 * groups of sibling elements where clicking one changes the CSS classes
 * to indicate mutual exclusivity (value selection semantics).
 *
 * Pattern is matched case-insensitively as a substring of any class.
 */
const SELECTION_CLASS_PATTERN = /(^|[-_ ])(selected|active|checked|current|chosen|on)([-_ ]|$)/i;

/**
 * Minimum number of sibling elements required to qualify as a selection group.
 *
 * A single toggle button (play/pause, mute) is NOT a selection group.
 * Two or more sibling elements that share a selection class pattern are.
 */
const MIN_SELECTION_GROUP_SIZE = 2;

/**
 * Selector for ARIA menu items inside dropdown menus.
 *
 * Many web applications (OrangeHRM, GitHub, GitLab, Google apps) render
 * their dropdown menus using the ARIA menu pattern:
 *   <button aria-haspopup="menu">Profile</button>
 *   <ul role="menu">
 *     <li><a role="menuitem">Support</a></li>
 *     <li><a role="menuitem">Change Password</a></li>
 *   </ul>
 *
 * These are semantically value selections (the user picks one item from
 * a list), not navigation links or action buttons. Excludes
 * menuitemcheckbox and menuitemradio which are handled by the
 * checkbox/radio recorder.
 */
const MENU_ITEM_SELECTOR = '[role="menu"] [role="menuitem"]:not([role="menuitemcheckbox"]):not([role="menuitemradio"])';

// ── CSS-Class-Differential Detection State ────────────────

/**
 * Snapshot of sibling class state captured at mousedown time.
 * Used to detect CSS class changes that indicate a selection occurred.
 */
interface SiblingSnapshot {
  /** The clicked element */
  clickedEl: Element;
  /** The parent element containing the selection group */
  parent: Element | null;
  /** Map of sibling element → class list at mousedown time */
  siblingClasses: Map<Element, string>;
}

/**
 * Last mousedown snapshot — used by the setTimeout(0) deferred check.
 * Only one snapshot is needed because the deferred check runs before
 * the next mousedown can occur.
 */
let pendingSnapshot: SiblingSnapshot | null = null;

/**
 * Capture the DOM state at mousedown time for CSS-class-differential detection.
 *
 * Called on EVERY trusted mousedown during recording. If the clicked element
 * has siblings (suggesting it might be part of a selection group), we snapshot
 * all siblings' class lists. The deferred check compares before/after states.
 */
function captureSiblingSnapshot(target: Element): void {
  const parent = target.parentElement;
  if (!parent) return;

  // Only snapshot if there are siblings (potential selection group)
  const siblings = Array.from(parent.children);
  if (siblings.length < MIN_SELECTION_GROUP_SIZE) return;

  const siblingClasses = new Map<Element, string>();
  for (const sibling of siblings) {
    siblingClasses.set(sibling, sibling.className);
  }

  pendingSnapshot = {
    clickedEl: target,
    parent,
    siblingClasses,
  };

  // ── OPTIMISTIC OWNERSHIP: Suppress generic Click ──
  // Claim ownership immediately on mousedown to prevent the generic click
  // recorder (which fires on click, after mousedown) from recording a
  // duplicate Click. If the deferred check finds no selection occurred,
  // we release ownership so future clicks on this element are recorded
  // as Clicks.
  target.setAttribute('data-cmdrunner-pending-select', 'true');
}

/**
 * Check whether a CSS class differential occurred after a click,
 * indicating a mutually exclusive selection group.
 *
 * This is the FALLBACK detection for value selections that don't use
 * standard ARIA attributes (role="option", role="radio", aria-pressed).
 *
 * Detection logic:
 *   1. The clicked element gained a class matching SELECTION_CLASS_PATTERN
 *      that it didn't have before (or gained a new class with that pattern)
 *   2. At least one OTHER sibling lost a class with that pattern
 *      (proving mutual exclusivity)
 *   3. If only the clicked element changed but no sibling lost the class,
 *      it might still be a selection (first-time selection in a group where
 *      nothing was previously selected) — record it if ≥2 siblings match
 *      the selection pattern after the click.
 */
function checkCssClassDifferential(snapshot: SiblingSnapshot): {
  isSelection: boolean;
  selectedValue: string;
} {
  const { clickedEl, parent, siblingClasses } = snapshot;
  if (!parent) return { isSelection: false, selectedValue: '' };

  const clickedNewClasses = clickedEl.className || '';
  const clickedOldClasses = siblingClasses.get(clickedEl) || '';

  // Did the clicked element gain a selection class?
  const clickedGainedSelection = hasNewSelectionClass(clickedNewClasses, clickedOldClasses);

  // Check siblings for class changes
  let siblingLostSelection = false;
  let siblingsWithSelection = 0;

  for (const [sibling, oldClasses] of siblingClasses) {
    if (sibling === clickedEl) continue;

    const newClasses = sibling.className || '';
    const lostSelection = hasLostSelectionClass(newClasses, oldClasses);
    if (lostSelection) siblingLostSelection = true;

    if (hasClassMatchingPattern(newClasses)) siblingsWithSelection++;
  }

  // Also count the clicked element if it now has a selection class
  if (hasClassMatchingPattern(clickedNewClasses)) siblingsWithSelection++;

  // Selection group: either mutual exclusivity proven (sibling lost class)
  // or multiple siblings have selection classes (group structure)
  const hasGroupStructure = siblingsWithSelection >= MIN_SELECTION_GROUP_SIZE;

  const isSelection = clickedGainedSelection && (siblingLostSelection || hasGroupStructure);

  if (!isSelection) return { isSelection: false, selectedValue: '' };

  // Extract the value: text content of the clicked element
  const selectedValue = getOptionValue(clickedEl);
  return { isSelection: true, selectedValue };
}

/**
 * Check if an element's class list gained a selection class compared to before.
 */
function hasNewSelectionClass(newClassName: string, oldClassName: string): boolean {
  const newClasses = newClassName.split(/\s+/).filter(Boolean);
  const oldClasses = new Set(oldClassName.split(/\s+/).filter(Boolean));

  for (const cls of newClasses) {
    if (!oldClasses.has(cls) && SELECTION_CLASS_PATTERN.test(cls)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an element's class list lost a selection class compared to before.
 */
function hasLostSelectionClass(newClassName: string, oldClassName: string): boolean {
  const oldClasses = oldClassName.split(/\s+/).filter(Boolean);
  const newClassSet = new Set(newClassName.split(/\s+/).filter(Boolean));

  for (const cls of oldClasses) {
    if (!newClassSet.has(cls) && SELECTION_CLASS_PATTERN.test(cls)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if any class in a class list matches the selection pattern.
 */
function hasClassMatchingPattern(className: string): boolean {
  return className.split(/\s+/).some((cls) => SELECTION_CLASS_PATTERN.test(cls));
}

// ── Pre-State Tracking ────────────────────────────────────

/**
 * Map of element → last known selected value.
 *
 * We capture the pre-state when the user first focuses or interacts
 * with the dropdown. At the change/selection event, we compare the
 * current value to this pre-state to determine whether a genuine value
 * change occurred (Gate 4).
 *
 * Uses element identity key (not Element reference) for resilience
 * against virtual DOM recreation.
 *
 * C5.2B FIX: This is the PRIMARY dedup mechanism. The ownership attribute
 * is no longer used for dedup within the select recorder — Gate 4 (value
 * change) is the sole dedup mechanism. This fixes the ownership ratchet
 * bug that silently dropped all selections after the first.
 */
const preStateMap = new Map<string, string>();

function elementKey(el: Element): string {
  return [
    el.tagName,
    el.id || '',
    generateCssSelector(el),
  ].join('|');
}

/**
 * Capture the pre-state of a dropdown control.
 *
 * Called on 'focus' and 'mousedown' to record the control's value
 * BEFORE the user's interaction.
 */
function capturePreState(el: Element): void {
  if (!el.matches(SELECT_SELECTOR)) return;
  preStateMap.set(elementKey(el), getSelectedValue(el));
}

// ── Value Extraction ──────────────────────────────────────

/**
 * Get the currently selected value's user-visible label from a dropdown control.
 *
 * For native <select>: returns the text content of the selected <option>.
 * For ARIA combobox/listbox: returns the text content of the element
 *   with aria-selected="true".
 * For combobox with aria-activedescendant: resolves the descendant element.
 *
 * Returns the user-visible label (e.g., "India"), NOT the internal value
 * attribute (e.g., "IN"). Per C5.1 §6.4.
 */
function getSelectedValue(el: Element): string {
  // Native <select>
  if (el instanceof HTMLSelectElement) {
    const option = el.options[el.selectedIndex];
    if (option) {
      return option.text?.trim() || option.textContent?.trim() || option.value || '';
    }
    return '';
  }

  // ARIA listbox: find [aria-selected="true"] child
  const selected = el.querySelector('[aria-selected="true"]');
  if (selected) {
    return selected.textContent?.trim() || selected.getAttribute('aria-label') || '';
  }

  // ARIA combobox: may have aria-activedescendant pointing to the selected option
  const descendantId = el.getAttribute('aria-activedescendant');
  if (descendantId) {
    const option = document.getElementById(descendantId);
    if (option) {
      return option.textContent?.trim() || option.getAttribute('aria-label') || '';
    }
  }

  // Fallback: text content of the control itself
  return el.textContent?.trim() || '';
}

/**
 * Extract the value label from a clicked or activated option element.
 *
 * For a clicked option, the value is the option's text content.
 */
function getOptionValue(option: Element): string {
  return option.textContent?.trim() || option.getAttribute('aria-label') || option.getAttribute('data-value') || '';
}

// ── Trigger Resolution for Portaled Dropdowns ─────────────

/**
 * Resolve the dropdown trigger element from a listbox container.
 *
 * Modern frameworks (Radix UI, Headless UI, MUI, Floating UI) portal
 * the option list to document.body. The listbox is a sibling of (not a
 * child of) the trigger. To get a stable identity for playback, we need
 * to resolve the original trigger element.
 *
 * Resolution strategy:
 *   1. aria-labelledby on the listbox → resolve to the label element
 *   2. Listbox has an id → search for [aria-controls="<id>"] → that's the trigger
 *   3. Listbox has an id → search for [aria-owns="<id>"] → that's the trigger
 *   4. Fallback: return the listbox itself
 */
function resolveDropdownTrigger(listbox: Element): Element {
  // Strategy 1: aria-labelledby
  const labelledBy = listbox.getAttribute('aria-labelledby');
  if (labelledBy) {
    const firstId = labelledBy.split(/\s+/)[0];
    const labelEl = document.getElementById(firstId);
    if (labelEl) return labelEl;
  }

  // Strategy 2: aria-controls reference
  const listboxId = listbox.id;
  if (listboxId) {
    const controller = document.querySelector(`[aria-controls="${cssEscape(listboxId)}"]`);
    if (controller) return controller;
  }

  // Strategy 3: aria-owns reference
  if (listboxId) {
    const owner = document.querySelector(`[aria-owns="${cssEscape(listboxId)}"]`);
    if (owner) return owner;
  }

  // Fallback: the listbox itself
  return listbox;
}

// ── Target Resolution ─────────────────────────────────────

/**
 * Resolve the dropdown target from a change event.
 *
 * Walks composedPath() to find the nearest matching dropdown control.
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
    if (node instanceof Element && node.matches(SELECT_SELECTOR)) {
      return node;
    }
  }

  // Strategy 2: Parent walk (doesn't cross shadow)
  let current: Element | null = rawTarget;
  while (current) {
    if (current.matches(SELECT_SELECTOR)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

/**
 * Resolve target from any event using a given selector.
 *
 * WARN-4 FIX: Walks composedPath() to find the nearest ancestor matching
 * the selector, handling clicks on child elements (icons, text spans)
 * inside buttons/options with the target attribute.
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

/**
 * Resolve the group-member element from a mousedown event.
 *
 * When a user clicks on a child element (text span, icon <i>) inside a
 * segment button, event.target is the child element. The sibling group
 * member (the element whose parent contains the selection group) is an
 * ancestor. Walk up from event.target to find the element whose parent
 * has ≥2 children of the SAME TAG as the current element — this is a
 * reliable signal of a peer group (segmented control, card group, etc.).
 *
 * Checking same-tag peers prevents resolving to inner content: e.g.,
 * <button><i></i><span>Label</span></button> — the <button> has 2 children
 * but they're different tags (<i>, <span>), so it's not a peer group.
 * The <button>'s parent might be <div> with <button>, <button>, <button>
 * children — those ARE same-tag peers, so we resolve to the <button>.
 */
function resolveGroupMemberTarget(event: Event): Element | null {
  const rawTarget = event.target;
  if (!rawTarget || !(rawTarget instanceof Element)) {
    return null;
  }

  // Walk composedPath() — crosses Shadow DOM boundaries
  const path = event.composedPath();
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    // Count siblings with the same tag as the current node
    const tag = node.tagName;
    let peerCount = 0;
    for (const child of Array.from(parent.children)) {
      if (child.tagName === tag) peerCount++;
    }
    if (peerCount >= MIN_SELECTION_GROUP_SIZE) {
      return node;
    }
  }

  // Fallback: parent walk
  let current: Element | null = rawTarget;
  while (current) {
    const parent = current.parentElement;
    if (parent) {
      const tag = current.tagName;
      let peerCount = 0;
      for (const child of Array.from(parent.children)) {
        if (child.tagName === tag) peerCount++;
      }
      if (peerCount >= MIN_SELECTION_GROUP_SIZE) {
        return current;
      }
    }
    current = current.parentElement;
  }

  return null;
}

// ── Ownership Check ───────────────────────────────────────

/**
 * Check if a DIFFERENT interaction type has claimed this element.
 *
 * Gate 2 (C5.1 §3.1): "Does another interaction own it?"
 *
 * C5.2B FIX: Only blocks ownership by NON-SELECT interaction types
 * (hover, checkbox, radio). Allows re-selection on dropdowns that were
 * previously used (fixes the ownership ratchet bug).
 *
 * The 'select' ownership value is intentionally ignored here so that
 * multiple selections on the same dropdown are all recorded.
 */
function isOwnedByAnotherInteraction(target: Element): boolean {
  const owner = target.closest('[data-cmdrunner-handled]');
  if (!owner) return false;
  const ownerType = owner.getAttribute('data-cmdrunner-handled');
  // Allow re-selection on elements we already recorded a select on
  return ownerType !== 'select';
}

/**
 * Mark an OPTION element as handled to prevent the generic click recorder
 * from recording a duplicate Click event.
 *
 * C5.2B: Ownership is set on the individual OPTION element, NEVER on the
 * container. This ensures future selections on the same dropdown are not
 * blocked (the container remains unowned).
 */
function claimOptionOwnership(option: Element): void {
  option.setAttribute('data-cmdrunner-handled', 'select');
}

// ── Enabled/Interactive Check ─────────────────────────────

/**
 * Check if the control is enabled and interactive.
 *
 * Gate 5 (C5.1 §3.1): "Is the control enabled and interactive?"
 * Excludes disabled, read-only, and aria-disabled controls.
 */
function isControlEnabled(el: Element): boolean {
  // Disabled attribute (native select)
  if (el instanceof HTMLSelectElement && el.disabled) return false;

  // aria-disabled
  if (el.getAttribute('aria-disabled') === 'true') return false;

  // aria-readonly (ARIA combobox/listbox controls)
  if (el.getAttribute('aria-readonly') === 'true') return false;

  // fieldset[disabled] ancestor disables nested controls
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
 *   6. name attribute fallback
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
    const text = parent.textContent?.trim();
    if (text) return truncate(text, 200);
  }

  // 5. title attribute
  const title = el.getAttribute('title');
  if (title && title.trim()) return truncate(title.trim(), 200);

  // 6. name attribute as last resort
  const nameAttr = el.getAttribute('name');
  if (nameAttr && nameAttr.trim()) return truncate(nameAttr.trim(), 200);

  return '';
}

// ── Role Mapping ──────────────────────────────────────────

function getImplicitRole(el: Element): string | null {
  const explicitRole = el.getAttribute('role');
  if (explicitRole && explicitRole.trim()) return explicitRole.trim();

  const TAG_ROLE_MAP: Record<string, string> = {
    SELECT: 'listbox',
    INPUT: 'textbox',
    BUTTON: 'button',
    A: 'link',
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
        // Cross-origin iframe — skip
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

interface SelectIdentity {
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

function extractIdentity(el: Element): SelectIdentity {
  const iframeCtx = extractIframeContext();

  const identity: SelectIdentity = {
    accessibleName: computeAccessibleName(el),
    ariaRole: getImplicitRole(el),
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledBy: el.getAttribute('aria-labelledby'),
    placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-placeholder'),
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

// ── Commit ────────────────────────────────────────────────

/**
 * Commit a dropdown selection — send SELECT_CAPTURED.
 *
 * C5.1 §6.3: The payload carries the user-visible selected value label.
 */
function commitSelect(identity: SelectIdentity, value: string): void {
  chrome.runtime.sendMessage({
    type: 'SELECT_CAPTURED',
    payload: { ...identity, value },
  }).catch(() => {
    // Service worker may be asleep — silently ignore
  });
}

// ── Change Event Handler (Native <select>) ────────────────

/**
 * Main change event handler — implements the C5.1 5-Gate Decision Tree.
 *
 * The 'change' event fires on <select> elements ONLY when the selected
 * option actually changes. This is the primary detection mechanism for
 * native controls.
 *
 * Decision Tree (C5.1 §3.1):
 *   Gate 1: Is it genuine? (isTrusted)
 *   Gate 2: Does a DIFFERENT interaction type own it?
 *   Gate 3: Is the target a dropdown control?
 *   Gate 4: Did the value actually change?
 *   Gate 5: Is the control enabled and interactive?
 */
async function handleChange(event: Event): Promise<void> {
  // ── Gate 1: Is it genuine? ──
  if (!event.isTrusted) return;

  const recording = await checkRecording();
  if (!recording) return;

  if (!event.target) return;

  // ── Target Resolution ──
  const target = resolveTarget(event);
  if (!target) return;

  // ── Gate 2: Does a DIFFERENT interaction type own it? ──
  // C5.2B FIX: Only blocks non-select ownership types (hover, checkbox, radio).
  // 'select' ownership is ignored to allow multiple selections on the same dropdown.
  if (isOwnedByAnotherInteraction(target)) return;

  // ── Gate 3: Is the target a dropdown control? ──
  if (!target.matches(SELECT_SELECTOR)) return;

  // ── Gate 5: Is the control enabled and interactive? ──
  if (!isControlEnabled(target)) return;

  // ── Gate 4: Did the value actually change? ──
  // For native <select>, the 'change' event itself is definitive proof
  // of a value change. The pre-state map provides additional dedup for
  // edge cases where frameworks dispatch synthetic change events.
  const currentValue = getSelectedValue(target);
  const key = elementKey(target);
  const preState = preStateMap.get(key);

  if (preState !== undefined && preState === currentValue) {
    return; // No change — Gate 4 fails
  }

  if (!currentValue) return;

  // ── ALL GATES PASS → RECORD VALUE CHANGE ──

  const identity = extractIdentity(target);
  commitSelect(identity, currentValue);

  // C5.2B FIX: Do NOT claim ownership on the container — this would
  // block future selections. Ownership is only set on individual options
  // in handleOptionClick to prevent the generic click recorder from duplicating.

  // Update pre-state map to reflect the new value
  preStateMap.set(key, currentValue);
}

// ── Pre-State Capture Handlers ────────────────────────────

/**
 * Listen for focus and mousedown on dropdown controls to capture
 * the pre-interaction value.
 */
function handlePreStateCapture(event: Event): void {
  if (!event.isTrusted) return;
  if (!event.target) return;

  const target = event.target;
  if (target instanceof Element && target.matches(SELECT_SELECTOR)) {
    capturePreState(target);
  }
}

// ── Custom Dropdown Option Selection (Mouse) ──────────────

/**
 * Handle mouse clicks on [role="option"] elements in custom dropdowns.
 *
 * DEFECT FIX (C5.2 → C5.2B): The original implementation only listened
 * for 'change' events. Custom dropdown components (OrangeHRM OXD, React
 * Select, MUI, Ant Design, Headless UI, Radix UI) use JavaScript-based
 * selection via @mousedown/@click on [role="option"] elements. They do
 * NOT dispatch native 'change' events.
 *
 * Same 5-Gate decision tree as handleChange, with the entry point being
 * a click on an option element rather than a change event on a select.
 *
 * C5.2B FIX: Ownership is claimed on the OPTION element (not the
 * container), so future selections on the same dropdown are not blocked.
 */
async function handleOptionClick(event: Event): Promise<void> {
  // ── Gate 1: Is it genuine? ──
  if (!event.isTrusted) return;

  const recording = await checkRecording();
  if (!recording) return;

  // WARN-4 FIX: Use composedPath to resolve clicks on child elements inside options
  const target = resolveTargetFromEvent(event, OPTION_SELECTOR);
  if (!target) return;

  // C6.2A: Skip if the option is inside a calendar/datepicker container.
  // Some calendar libraries use role="option" or role="listbox" for their
  // date grid. The datepicker content script handles these.
  if (target.closest(DATEPICKER_CONTAINER_SELECTOR)) return;

  // ── Resolve the parent dropdown container ──
  // Walk up from the option to find the nearest [role="listbox"]
  // or [role="combobox"] container.
  const dropdownContainer = target.closest('[role="listbox"], [role="combobox"]');

  // C5.2B: For portaled dropdowns, resolve the stable trigger element
  // instead of using the transient portal container.
  const identityTarget = dropdownContainer
    ? resolveDropdownTrigger(dropdownContainer)
    : target;

  // ── Gate 2: Does a DIFFERENT interaction type own it? ──
  if (isOwnedByAnotherInteraction(identityTarget)) return;

  // ── Gate 5: Is the control enabled and interactive? ──
  if (!isControlEnabled(identityTarget)) return;

  // ── Extract the selected value ──
  const selectedValue = getOptionValue(target);

  // ── Gate 4: Did the value actually change? ──
  const key = elementKey(identityTarget);
  const preState = preStateMap.get(key);
  if (preState !== undefined && preState === selectedValue) {
    return; // No change — Gate 4 fails
  }

  if (!selectedValue) return;

  // ── ALL GATES PASS → RECORD VALUE CHANGE ──

  const identity = extractIdentity(identityTarget);
  commitSelect(identity, selectedValue);

  // C5.2B FIX: Claim ownership on the OPTION element only, NOT the container.
  // This prevents the generic click recorder from duplicating this as a Click
  // without blocking future selections on the same dropdown.
  claimOptionOwnership(target);

  // Update pre-state map
  preStateMap.set(key, selectedValue);
}

// ── ARIA Menu Dropdown Selection (Mouse) ──────────────────

/**
 * Handle mouse clicks on [role="menuitem"] elements inside dropdown menus.
 *
 * Many web apps (OrangeHRM, GitHub, Google) render dropdowns using the
 * ARIA menu pattern: a trigger with aria-haspopup="menu" opens a
 * <ul role="menu"> containing <a role="menuitem"> or
 * <li role="menuitem"> elements. Selecting a menu item is a value
 * selection, not a navigation click.
 *
 * The identity target is resolved to the dropdown trigger (the element
 * with aria-haspopup), same as portaled listbox dropdowns.
 */
async function handleMenuItemClick(event: Event): Promise<void> {
  // ── Gate 1: Is it genuine? ──
  if (!event.isTrusted) return;

  const recording = await checkRecording();
  if (!recording) return;

  // Resolve the menu item from the event path
  const target = resolveTargetFromEvent(event, MENU_ITEM_SELECTOR);
  if (!target) return;

  // ── Resolve the dropdown trigger ──
  // Walk up to the role="menu" container, then resolve the trigger
  // via aria-controls, aria-owns, or aria-labelledby.
  const menuContainer = target.closest('[role="menu"]');
  const identityTarget = menuContainer
    ? resolveMenuTrigger(menuContainer)
    : target;

  // ── Gate 2: Does a DIFFERENT interaction type own it? ──
  if (isOwnedByAnotherInteraction(identityTarget)) return;

  // ── Gate 5: Is the control enabled and interactive? ──
  if (!isControlEnabled(identityTarget)) return;

  // ── Extract the selected value ──
  const selectedValue = getOptionValue(target);

  // ── Gate 4: Did the value actually change? ──
  const key = elementKey(identityTarget);
  const preState = preStateMap.get(key);
  if (preState !== undefined && preState === selectedValue) {
    return; // No change
  }

  if (!selectedValue) return;

  // ── ALL GATES PASS → RECORD VALUE CHANGE ──

  const identity = extractIdentity(identityTarget);
  commitSelect(identity, selectedValue);

  // Claim ownership on the menu item element to suppress duplicate Click
  claimOptionOwnership(target);

  // Update pre-state map
  preStateMap.set(key, selectedValue);
}

/**
 * Resolve the trigger element for an ARIA menu dropdown.
 *
 * Strategy:
 *   1. aria-labelledby on the menu → the label element
 *   2. Menu has an id → find [aria-controls="<id>"]
 *   3. Menu has an id → find [aria-owns="<id>"]
 *   4. Fallback: the menu itself
 */
function resolveMenuTrigger(menu: Element): Element {
  // Strategy 1: aria-labelledby
  const labelledBy = menu.getAttribute('aria-labelledby');
  if (labelledBy) {
    const firstId = labelledBy.split(/\s+/)[0];
    const labelEl = document.getElementById(firstId);
    if (labelEl) return labelEl;
  }

  // Strategy 2: aria-controls reference
  const menuId = menu.id;
  if (menuId) {
    const controller = document.querySelector(`[aria-controls="${cssEscape(menuId)}"]`);
    if (controller) return controller;
  }

  // Strategy 3: aria-owns reference
  if (menuId) {
    const owner = document.querySelector(`[aria-owns="${cssEscape(menuId)}"]`);
    if (owner) return owner;
  }

  // Fallback: the menu itself
  return menu;
}

// ── Custom Dropdown Option Selection (Keyboard) ───────────

/**
 * Handle keyboard selection in custom dropdowns.
 *
 * C5.2B: Users can select options via keyboard by:
 *   - Focus on [role="option"], press Enter/Space
 *   - Focus on [role="combobox"] with aria-activedescendant, press Enter
 *
 * This handler detects committed keyboard selections (Enter/Space) on:
 *   1. [role="option"] elements (option-focused pattern)
 *   2. [role="combobox"] elements using aria-activedescendant (combobox-focused pattern)
 *
 * Arrow-key navigation is NOT recorded (it's intermediate highlighting,
 * not a committed selection per C5.1).
 */
async function handleOptionKeydown(event: KeyboardEvent): Promise<void> {
  // ── Gate 1: Is it genuine? ──
  if (!event.isTrusted) return;

  // Only Enter and Space commit a selection
  if (event.key !== 'Enter' && event.key !== ' ') return;

  const recording = await checkRecording();
  if (!recording) return;

  const target = event.target;
  if (!target || !(target instanceof Element)) return;

  // ── Determine the selection context ──
  // Path A: Target is [role="option"] (option-focused keyboard navigation)
  // Path B: Target is [role="combobox"] with aria-activedescendant (combobox-focused)
  let optionElement: Element | null = null;
  let identityTarget: Element;

  if (target.matches(OPTION_SELECTOR)) {
    // Path A: Enter/Space on an option element
    optionElement = target;
    const dropdownContainer = target.closest('[role="listbox"], [role="combobox"]');
    identityTarget = dropdownContainer
      ? resolveDropdownTrigger(dropdownContainer)
      : target;
  } else if (target.matches('[role="combobox"]')) {
    // Path B: Enter on a combobox using aria-activedescendant
    const descendantId = target.getAttribute('aria-activedescendant');
    if (!descendantId) return; // No highlighted option to commit
    const highlightedOption = document.getElementById(descendantId);
    if (!highlightedOption) return; // Stale reference
    optionElement = highlightedOption;
    identityTarget = resolveDropdownTrigger(target);
  } else {
    return; // Not a dropdown keyboard selection context
  }

  // ── Gate 2 ──
  if (isOwnedByAnotherInteraction(identityTarget)) return;

  // ── Gate 5 ──
  if (!isControlEnabled(identityTarget)) return;

  // ── Extract the selected value ──
  const selectedValue = getOptionValue(optionElement);

  // ── Gate 4 ──
  const key = elementKey(identityTarget);
  const preState = preStateMap.get(key);
  if (preState !== undefined && preState === selectedValue) {
    return;
  }

  if (!selectedValue) return;

  // ── ALL GATES PASS → RECORD VALUE CHANGE ──

  const identity = extractIdentity(identityTarget);
  commitSelect(identity, selectedValue);

  // Claim ownership on the option (or combobox if no option element)
  claimOptionOwnership(optionElement);
  preStateMap.set(key, selectedValue);
}

// ── Segmented Control Handler (aria-pressed) ──────────────

/**
 * Handle clicks on segmented control buttons ([aria-pressed]).
 *
 * Segmented controls render as a group of <button> elements where the
 * user selects one value (mutually exclusive). The selected button gets
 * aria-pressed="true"; all others get aria-pressed="false".
 *
 * This is semantically a value selection (same as radio or dropdown),
 * not a generic click — so it's recorded as Select "<value>".
 *
 * Uses a deferred check (setTimeout 0) to let the application's click
 * handler update aria-pressed BEFORE we read it.
 */
async function handleSegmentedControlClick(event: Event): Promise<void> {
  // ── Gate 1: Is it genuine? ──
  if (!event.isTrusted) return;

  const recording = await checkRecording();
  if (!recording) return;

  // WARN-4 FIX: Use composedPath to resolve clicks on child elements
  const target = resolveTargetFromEvent(event, SEGMENTED_CONTROL_SELECTOR);
  if (!target) return;

  // C6.2A: Skip if inside a calendar/datepicker container.
  if (target.closest(DATEPICKER_CONTAINER_SELECTOR)) return;

  // ── WARN-3 FIX: Exclude binary toggle buttons ──
  // aria-pressed is used for both:
  //   - Segmented controls (mutually exclusive group: Economy | Business | First)
  //   - Binary toggle buttons (play/pause, mute, expand/collapse)
  // A segmented control has SIBLING elements that also have aria-pressed.
  // A binary toggle has no aria-pressed siblings — it's the only one.
  // We only record segmented controls (value selection), not binary toggles.
  const parent = target.parentElement;
  if (parent) {
    const siblingsWithPressed = parent.querySelectorAll(':scope > [aria-pressed]');
    if (siblingsWithPressed.length < 2) return; // Binary toggle — only one button
  }

  // ── Gate 2 ──
  if (isOwnedByAnotherInteraction(target)) return;

  // ── Gate 5 ──
  if (!isControlEnabled(target)) return;

  // ── Deferred check: wait for click handler to update aria-pressed ──
  const key = elementKey(target);
  const preState = preStateMap.get(key);

  setTimeout(() => {
    handleSegmentedControlPostClick(target, key, preState);
  }, 0);
}

/**
 * Deferred handler for segmented controls.
 * Reads the post-click aria-pressed state and records if it changed.
 *
 * WARN-1 FIX: Re-checks ownership at execution time to prevent duplicates.
 */
function handleSegmentedControlPostClick(
  target: Element,
  key: string,
  preState: string | undefined,
): void {
  // WARN-1 FIX: Re-check ownership — another handler may have recorded
  if (isOwnedByAnotherInteraction(target)) return;

  const isPressed = target.getAttribute('aria-pressed') === 'true';
  const currentValue = getOptionValue(target);

  // Gate 4: Only record if the button became pressed (was selected)
  if (!isPressed) return;

  // Check if this value was already the pre-state (no change)
  if (preState !== undefined && preState === currentValue) return;

  if (!currentValue) return;

  // ── ALL GATES PASS → RECORD VALUE SELECTION ──

  const identity = extractIdentity(target);
  commitSelect(identity, currentValue);

  claimOptionOwnership(target);
  preStateMap.set(key, currentValue);
}

// ── Generic Selection Group Handler (CSS-Class-Differential) ──

/**
 * Handle clicks on generic value-selection controls that don't use ARIA.
 *
 * This is the FALLBACK detection for value selections that use NO standard
 * ARIA attributes (no role="option", no role="radio", no aria-pressed).
 * Common in: Adani One travel class cards, OrangeHRM OXD dropdowns,
 * React/MUI card selectors, CSS-only segmented controls.
 *
 * Detection strategy:
 *   1. On mousedown, snapshot all sibling elements' CSS classes
 *   2. On setTimeout(0), check if the clicked element GAINED a selection
 *      class (selected/active/checked/current/chosen) that it didn't have before
 *   3. Verify it's a selection GROUP: at least one sibling LOST a selection
 *      class, or multiple siblings have selection classes
 *   4. If yes, record as Select "<clicked element text>"
 *
 * This handler only fires for elements NOT already matched by ARIA-based
 * handlers (role="option", aria-pressed, role="radio"). Those handlers
 * fire first and claim ownership via data-cmdrunner-handled.
 */
async function handleGenericSelectionGroup(event: Event): Promise<void> {
  // ── Gate 1: Is it genuine? ──
  if (!event.isTrusted) return;

  const recording = await checkRecording();
  if (!recording) return;

  // Must have a target element
  const rawTarget = event.target;
  if (!rawTarget || !(rawTarget instanceof Element)) return;

  // ── Resolve to the nearest clickable/group-member ancestor ──
  // When a user clicks on a child element (text span, icon) inside a
  // segment button, event.target is the child — but the sibling group
  // member is the parent button/div. Walk up to find the element whose
  // parent has ≥2 children (the group container).
  const target = resolveGroupMemberTarget(event);
  if (!target) return;

  // Skip if already matched by ARIA-based handlers (they claimed ownership)
  // We check this in the deferred callback, but also early-exit here if the
  // element already has standard ARIA semantics that other handlers cover.
  if (target.matches(OPTION_SELECTOR)) return;
  if (target.matches(SEGMENTED_CONTROL_SELECTOR)) return;
  if (target.matches(CHECKBOX_RADIO_SKIP_SELECTOR)) return;
  if (target.matches(SELECT_DROPDOWN_SKIP_SELECTOR)) return;
  if (target.matches(MENU_ITEM_SELECTOR)) return;

  // C6.2A: Skip if inside a calendar/datepicker container.
  // Date cells receive selected/active class changes that would be caught
  // by the CSS-class-differential detection. The datepicker content script
  // handles these.
  if (target.closest(DATEPICKER_CONTAINER_SELECTOR)) return;

  // ── Gate 2: Not owned by another interaction ──
  if (isOwnedByAnotherInteraction(target)) return;

  // ── Gate 5: Enabled ──
  if (!isControlEnabled(target)) return;

  // ── Capture sibling snapshot for CSS-class-differential detection ──
  captureSiblingSnapshot(target);
}

/**
 * Deferred check for CSS-class-differential selection.
 * Runs on setTimeout(0) after EVERY mousedown to check if the pending
 * snapshot shows a selection group pattern.
 *
 * Must be called from a setTimeout(0) context.
 */
function checkPendingSelectionGroup(): void {
  const snapshot = pendingSnapshot;
  pendingSnapshot = null;
  if (!snapshot) return;

  const { clickedEl } = snapshot;

  // Helper: remove the pending-select attribute (clean up on any exit)
  const cleanupPending = () => {
    clickedEl.removeAttribute('data-cmdrunner-pending-select');
  };

  const { isSelection, selectedValue } = checkCssClassDifferential(snapshot);
  if (!isSelection || !selectedValue) {
    cleanupPending();
    return;
  }

  // ── Re-check ownership (may have been claimed by ARIA handler) ──
  if (isOwnedByAnotherInteraction(clickedEl)) {
    cleanupPending();
    return;
  }

  // ── Gate 4: Value change check ──
  const key = elementKey(clickedEl);
  const preState = preStateMap.get(key);
  if (preState !== undefined && preState === selectedValue) {
    cleanupPending();
    return;
  }

  // ── ALL GATES PASS → RECORD VALUE SELECTION ──
  const identity = extractIdentity(clickedEl);
  commitSelect(identity, selectedValue);

  // Convert pending-select to permanent ownership
  clickedEl.removeAttribute('data-cmdrunner-pending-select');
  claimOptionOwnership(clickedEl);
  preStateMap.set(key, selectedValue);
}

/**
 * Selectors for elements handled by other recorders.
 * Used to skip generic selection group detection for elements that
 * other handlers will process.
 */
const CHECKBOX_RADIO_SKIP_SELECTOR = [
  'input[type="checkbox"]', 'input[type="radio"]',
  '[role="checkbox"]', '[role="radio"]',
  '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="switch"]',
].join(', ');

const SELECT_DROPDOWN_SKIP_SELECTOR = [
  'select:not([multiple])',
  '[role="combobox"]', '[role="listbox"]',
].join(', ');

/**
 * Selector for calendar/datepicker containers.
 * When the user clicks inside one of these, the datepicker content script
 * should handle it, not the select recorder.
 */
const DATEPICKER_CONTAINER_SELECTOR = '[role="grid"], [class*="calendar"], [class*="datepicker"], [class*="date-picker"], [class*="date_picker"], [data-datepicker]';

// ── Event Listeners ───────────────────────────────────────

// Native <select>: change event (capture phase)
document.addEventListener('change', handleChange, true);

// Custom dropdown mouse selection: mousedown on [role="option"] (capture phase)
// Uses mousedown to detect before the application handler potentially closes
// the dropdown and removes the option from the DOM.
document.addEventListener('mousedown', handleOptionClick, true);

// Custom dropdown keyboard selection: keydown Enter/Space on [role="option"] (capture phase)
document.addEventListener('keydown', handleOptionKeydown, true);

// ARIA menu dropdown selection: mousedown on [role="menuitem"] inside [role="menu"] (capture phase)
// Apps like OrangeHRM use the ARIA menu pattern for dropdown menus.
document.addEventListener('mousedown', handleMenuItemClick, true);

// Segmented control detection: clicks on [aria-pressed] buttons (capture phase)
// Deferred via setTimeout(0) to read post-click aria-pressed state.
document.addEventListener('mousedown', handleSegmentedControlClick, true);

// Generic selection group detection: CSS-class-differential for elements
// without ARIA attributes. Captures sibling snapshot on mousedown,
// checks differential on setTimeout(0).
document.addEventListener('mousedown', handleGenericSelectionGroup, true);

// Deferred check: runs after every mousedown's event handlers complete
// to check for CSS class differentials indicating a selection.
// We hook into the microtask queue via a wrapper.
document.addEventListener('mousedown', () => {
  setTimeout(checkPendingSelectionGroup, 0);
}, true);

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
