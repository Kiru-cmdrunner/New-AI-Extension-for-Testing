/**
 * Text Entry Content Script — captures text typed into input and textarea elements.
 *
 * Detection: blur event on input/textarea/contenteditable (captures final value
 * when the user moves focus away, not on every keystroke).
 *
 * Architecture follows the same pattern as click-content-script.ts:
 *   - Self-contained (content scripts run in isolated world)
 *   - Capture phase event listener
 *   - Identity extraction at blur time (immutable)
 *   - Immediate commit via sendMessage
 *
 * Principle: One text-entry event per field per focus. The value is the
 * complete text the user entered, not per-keystroke.
 */

// ── Recording State ────────────────────────────────────────

/**
 * Recording state flag, synced from chrome.storage.
 * Uses async fallback check to avoid MV3 timing gaps where
 * onChanged hasn't propagated to the content script's isolated world.
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
 * Check if recording is active with async fallback.
 */
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

// ── Text Entry Target Selector ─────────────────────────────

const TEXT_ENTRY_SELECTOR = [
  'input[type="text"]',
  'input[type="email"]',
  'input[type="password"]',
  'input[type="search"]',
  'input[type="tel"]',
  'input[type="url"]',
  'input[type="number"]',
  'input:not([type])', // input with no type attribute defaults to text
  'textarea',
  '[contenteditable="true"]',
].join(', ');
// NOTE: Native date inputs (type=date, time, datetime-local, month, week)
// are intentionally EXCLUDED — they are handled by datepicker-content-script
// per C6.1 §8.1 DateSelect vs Text Entry boundary.

// ── Accessible Name Computation ───────────────────────────

/**
 * Compute the accessible name for an element.
 * Reuses the same priority as click-content-script for consistency.
 */
function computeAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return truncate(ariaLabel.trim(), 200);
  }

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

  // For form controls, check associated <label>
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

  // placeholder for input/textarea
  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) {
    return truncate(placeholder.trim(), 200);
  }

  // textContent (for contenteditable)
  const textContent = el.textContent?.trim();
  if (textContent) {
    return truncate(textContent, 200);
  }

  // title
  const title = el.getAttribute('title');
  if (title && title.trim()) {
    return truncate(title.trim(), 200);
  }

  return '';
}

// ── Identity Extraction ───────────────────────────────────

/**
 * Extract element identity at blur time.
 * Mirrors RawElementIdentity in types.ts.
 */
function extractIdentity(el: Element): {
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
} {
  return {
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
    inIframe: window !== window.top,
    shadowDom: el.getRootNode() instanceof ShadowRoot,
  };
}

// ── Role Mapping ──────────────────────────────────────────

function getImplicitRole(el: Element): string | null {
  const explicitRole = el.getAttribute('role');
  if (explicitRole && explicitRole.trim()) return explicitRole.trim();

  const tag = el.tagName;
  if (tag === 'TEXTAREA') return 'textbox';
  if (tag === 'INPUT') {
    const type = el.getAttribute('type') || 'text';
    const map: Record<string, string> = {
      text: 'textbox', email: 'textbox', password: 'textbox',
      search: 'textbox', tel: 'textbox', url: 'textbox',
      number: 'spinbutton', range: 'slider',
    };
    return map[type] || null;
  }
  return null;
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
  return '//' + parts.join('/');
}

// ── Blur Handler ──────────────────────────────────────────

/**
 * Track the last value seen on focus so we only emit an event
 * when the value actually changed.
 */
const focusValues = new WeakMap<Element, string>();

/**
 * On focus, record the initial value so we can detect changes on blur.
 */
async function handleFocus(event: Event): Promise<void> {
  const target = event.target;
  if (!target || !(target instanceof Element)) return;

  const recording = await checkRecording();
  if (!recording) return;

  if (target.matches(TEXT_ENTRY_SELECTOR)) {
    const currentValue = (target as HTMLInputElement).value ?? (target as HTMLElement).textContent ?? '';
    focusValues.set(target, currentValue);
  }
}

/**
 * On blur, if the value changed, commit a TEXT_CAPTURED event.
 *
 * This produces one event per field per focus — the final value
 * the user entered, not per-keystroke.
 */
async function handleBlur(event: Event): Promise<void> {
  const recording = await checkRecording();
  if (!recording) return;

  const target = event.target;
  if (!target || !(target instanceof Element)) return;

  if (!target.matches(TEXT_ENTRY_SELECTOR)) return;

  const newValue = (target as HTMLInputElement).value ?? (target as HTMLElement).textContent ?? '';
  const oldValue = focusValues.get(target) ?? '';

  // Only emit if the value actually changed
  if (newValue === oldValue || newValue.trim() === '') return;

  const identity = extractIdentity(target);

  chrome.runtime.sendMessage({
    type: 'TEXT_CAPTURED',
    payload: { ...identity, value: newValue },
  }).catch(() => {
    // Service worker may be asleep — silently ignore
  });

  // Update tracked value
  focusValues.set(target, newValue);
}

// ── Event Listeners ───────────────────────────────────────

document.addEventListener('focus', handleFocus, true);
document.addEventListener('blur', handleBlur, true);

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
