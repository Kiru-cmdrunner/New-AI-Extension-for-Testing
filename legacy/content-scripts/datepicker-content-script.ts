/**
 * Date Picker Content Script — Universal Date Selection Recording
 *
 * Implements the frozen C6.1 Date Picker Product Strategy:
 *   - Detects meaningful date/time/range value changes
 *   - Applies the 5-Gate Decision Process (C6.1 §3.1)
 *   - Records the resulting committed value, not the click sequence
 *
 * C6.2 Universal detection — multi-mechanism support:
 *   - Native HTML date inputs (change event + ISO value)
 *   - Calendar grid components (mousedown on gridcell + aria-label)
 *   - Editable text inputs (change event + date parsing)
 *
 * This file is SELF-CONTAINED — content scripts run in an isolated world
 * and cannot import modules. All helpers are inlined.
 *
 * Frozen Product Rules (C6.1):
 *   1. One interaction type (dateSelect) for all date-selection mechanisms
 *   2. Value-outcome model — record only when committed value changes
 *   3. Display value representation + ISO value for execution
 *   4. Ownership Priority — dateSelect > generic click/text when value changes
 *   5. Evidence Mechanism Independence — detection may evolve
 *
 * C6.1 5-Gate Decision Tree:
 *   Gate 1: Genuine user interaction? (isTrusted)
 *   Gate 2: Not owned by a DIFFERENT interaction type?
 *   Gate 3: Is the target a date-selection control?
 *   Gate 4: Did the value actually change?
 *   Gate 5: Is the control enabled and interactive?
 */

// ── Recording State ────────────────────────────────────────

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
    // Storage may be unavailable
  }
  return isRecording;
}

// ── Selectors ─────────────────────────────────────────────

/**
 * Native HTML date input types.
 * Matches: input[type=date], input[type=datetime-local],
 * input[type=time], input[type=month], input[type=week]
 */
const NATIVE_DATE_INPUT_SELECTOR = [
  'input[type="date"]',
  'input[type="datetime-local"]',
  'input[type="time"]',
  'input[type="month"]',
  'input[type="week"]',
].join(', ');

/**
 * Calendar grid cell selector.
 *
 * ARIA-compliant calendars render dates as:
 *   <td role="gridcell"> or <button role="gridcell">
 *   <td role="gridcell" aria-label="15 July 2026">
 *
 * Some frameworks use aria-selected on cells. Others use data-date.
 */
const CALENDAR_GRIDCELL_SELECTOR = '[role="gridcell"], [data-date], td[aria-label]';

/**
 * Container that identifies a calendar widget.
 * Used to resolve the date input/trigger associated with a calendar.
 */
const CALENDAR_CONTAINER_SELECTOR = '[role="grid"], [role="dialog"], [class*="calendar"], [class*="datepicker"], [class*="date-picker"], [class*="date_picker"], [data-datepicker]';

// ── Pre-State Tracking ────────────────────────────────────

/**
 * Pre-state map: elementKey → value before user interaction.
 * Used for Gate 4 (meaningful value change).
 */
const preStateMap = new Map<string, string>();

function elementKey(el: Element): string {
  return [
    el.tagName,
    el.id || '',
    el.getAttribute('name') || '',
    generateCssSelector(el),
  ].join('|');
}

/**
 * Capture pre-state for native date inputs.
 */
function captureNativePreState(el: Element): void {
  if (el instanceof HTMLInputElement && el.matches(NATIVE_DATE_INPUT_SELECTOR)) {
    preStateMap.set(elementKey(el), el.value || '');
  }
}

// ── Date Format Conversion ────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Convert an ISO date string to human-readable display value.
 *
 * Format depends on the date sub-type (C6.1 §2.3):
 *   date: "15 July 2026"
 *   time: "09:30 AM"
 *   dateTime: "15 July 2026 09:30"
 *   month: "July 2026"
 *   week: "Week 29, 2026"
 */
function isoToDisplay(isoValue: string, dateType: string): string {
  if (!isoValue) return '';

  try {
    switch (dateType) {
      case 'date': {
        // YYYY-MM-DD
        const [y, m, d] = isoValue.split('-');
        const day = parseInt(d, 10);
        const monthIdx = parseInt(m, 10) - 1;
        return `${day} ${MONTH_NAMES[monthIdx]} ${y}`;
      }

      case 'time': {
        // HH:MM or HH:MM:SS
        const parts = isoValue.split(':');
        let hour = parseInt(parts[0], 10);
        const minute = parts[1] || '00';
        const period = hour >= 12 ? 'PM' : 'AM';
        if (hour === 0) hour = 12;
        else if (hour > 12) hour -= 12;
        return `${String(hour).padStart(2, '0')}:${minute} ${period}`;
      }

      case 'dateTime': {
        // YYYY-MM-DDTHH:MM
        const [datePart, timePart] = isoValue.split('T');
        const [y, m, d] = datePart.split('-');
        const day = parseInt(d, 10);
        const monthIdx = parseInt(m, 10) - 1;
        const timeParts = (timePart || '').split(':');
        let hour = parseInt(timeParts[0] || '0', 10);
        const minute = timeParts[1] || '00';
        return `${day} ${MONTH_NAMES[monthIdx]} ${y} ${String(hour).padStart(2, '0')}:${minute}`;
      }

      case 'month': {
        // YYYY-MM
        const [y, m] = isoValue.split('-');
        const monthIdx = parseInt(m, 10) - 1;
        return `${MONTH_NAMES[monthIdx]} ${y}`;
      }

      case 'week': {
        // YYYY-WNN
        const [y, w] = isoValue.split('-W');
        return `Week ${parseInt(w || '1', 10)}, ${y}`;
      }

      default:
        return isoValue;
    }
  } catch {
    return isoValue;
  }
}

/**
 * Determine the date sub-type from a native input element's type attribute.
 */
function getNativeDateType(input: HTMLInputElement): string {
  switch (input.type) {
    case 'date': return 'date';
    case 'datetime-local': return 'dateTime';
    case 'time': return 'time';
    case 'month': return 'month';
    case 'week': return 'week';
    default: return 'date';
  }
}

/**
 * Parse an aria-label like "15 July 2026" or "July 15, 2026" into ISO.
 * This handles the common aria-label formats used by calendar frameworks.
 */
function parseDateLabel(label: string): { iso: string; display: string } | null {
  if (!label) return null;

  // Try parsing as a date using the Date constructor.
  // Many calendar frameworks use full date labels: "15 July 2026", "July 15, 2026"
  const parsed = new Date(label);
  if (!isNaN(parsed.getTime())) {
    // Check if the label was actually a date (not a random number that parsed)
    // Date constructor parses plain numbers as timestamps, so verify label has month/day
    const hasDateContent = /\d{1,2}.*\d{4}|\d{4}.*\d{1,2}/i.test(label) ||
      MONTH_NAMES.some(m => label.includes(m)) ||
      MONTH_NAMES_SHORT.some(m => label.includes(m));
    if (hasDateContent) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      const iso = `${y}-${m}-${d}`;
      const display = `${parsed.getDate()} ${MONTH_NAMES[parsed.getMonth()]} ${y}`;
      return { iso, display };
    }
  }

  return null;
}

// ── Ownership Check ───────────────────────────────────────

/**
 * Check if a DIFFERENT interaction type has claimed this element.
 *
 * Gate 2 (C6.1 §3.1): "Does another interaction own it?"
 * Same pattern as select-content-script: ignores 'dateSelect' ownership
 * to allow multiple selections on the same date picker.
 */
function isOwnedByAnotherInteraction(target: Element): boolean {
  const owner = target.closest('[data-cmdrunner-handled]');
  if (!owner) return false;
  const ownerType = owner.getAttribute('data-cmdrunner-handled');
  return ownerType !== 'dateSelect';
}

/**
 * Claim ownership of a date control to prevent generic click/text duplication.
 */
function claimDateOwnership(el: Element): void {
  el.setAttribute('data-cmdrunner-handled', 'dateSelect');
}

// ── Enabled/Interactive Check ─────────────────────────────

/**
 * Gate 5 (C6.1 §3.1): Is the control enabled and interactive?
 */
function isControlEnabled(el: Element): boolean {
  if (el instanceof HTMLInputElement && el.disabled) return false;
  if (el instanceof HTMLInputElement && el.readOnly) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  if (el.getAttribute('aria-readonly') === 'true') return false;
  const fieldset = el.closest('fieldset[disabled]');
  if (fieldset) return false;
  return true;
}

// ── Identity ──────────────────────────────────────────────

interface DateSelectIdentity {
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

function extractIdentity(el: Element): DateSelectIdentity {
  const iframeCtx = extractIframeContext();

  const identity: DateSelectIdentity = {
    accessibleName: computeAccessibleName(el),
    ariaRole: getImplicitRole(el),
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledBy: el.getAttribute('aria-labelledby'),
    placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-placeholder'),
    tag: el.tagName,
    className: (el instanceof HTMLElement ? el.className : '') || null,
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
 * Commit a date selection — send DATE_SELECT_CAPTURED.
 *
 * C6.1 §7: The payload carries displayValue + isoValue + dateType.
 */
function commitDateSelect(
  identity: DateSelectIdentity,
  dateType: string,
  displayValue: string,
  isoValue: string,
  rangeData?: {
    startDisplayValue?: string;
    endDisplayValue?: string;
    startIsoValue?: string;
    endIsoValue?: string;
  },
): void {
  const payload: Record<string, unknown> = {
    ...identity,
    dateType,
    displayValue,
    isoValue,
  };

  if (rangeData) {
    if (rangeData.startDisplayValue) payload.startDisplayValue = rangeData.startDisplayValue;
    if (rangeData.endDisplayValue) payload.endDisplayValue = rangeData.endDisplayValue;
    if (rangeData.startIsoValue) payload.startIsoValue = rangeData.startIsoValue;
    if (rangeData.endIsoValue) payload.endIsoValue = rangeData.endIsoValue;
  }

  chrome.runtime.sendMessage({
    type: 'DATE_SELECT_CAPTURED',
    payload,
  }).catch(() => {
    // Service worker may be asleep
  });
}

// ── Native Date Input Handler ─────────────────────────────

/**
 * Handle 'change' events on native HTML date inputs.
 *
 * The 'change' event fires when the user commits a date selection via:
 *   - The browser's native date picker
 *   - Typing into the input and committing (blur/Enter)
 *   - Keyboard arrow navigation + Enter
 *
 * This is Mechanism 1 from C6.1 §5.1 — the simplest and most reliable.
 * input.value is always in ISO format.
 */
async function handleNativeDateChange(event: Event): Promise<void> {
  // ── Gate 1: Genuine user event? ──
  if (!event.isTrusted) return;

  const recording = await checkRecording();
  if (!recording) return;

  const target = event.target;
  if (!target || !(target instanceof HTMLInputElement)) return;

  // ── Gate 3: Is it a native date input? ──
  if (!target.matches(NATIVE_DATE_INPUT_SELECTOR)) return;

  // ── Gate 2: Owned by another interaction? ──
  if (isOwnedByAnotherInteraction(target)) return;

  // ── Gate 5: Enabled? ──
  if (!isControlEnabled(target)) return;

  // ── Gate 4: Did the value change? ──
  const newValue = target.value || '';
  if (!newValue) return; // Empty value = clearing, not recorded per C6.1 §3.4

  const key = elementKey(target);
  const preState = preStateMap.get(key);
  if (preState !== undefined && preState === newValue) {
    return; // No change — Gate 4 fails
  }

  // ── ALL GATES PASS → RECORD DATE SELECTION ──
  const dateType = getNativeDateType(target);
  const displayValue = isoToDisplay(newValue, dateType);
  const isoValue = newValue;

  const identity = extractIdentity(target);
  commitDateSelect(identity, dateType, displayValue, isoValue);

  claimDateOwnership(target);
  preStateMap.set(key, newValue);
}

// ── Calendar Grid Cell Handler ────────────────────────────

/**
 * Handle mousedown on date cells in calendar grid components.
 *
 * This is Mechanism 2 from C6.1 §5.1 — calendar popover, inline, and
 * dialog-based calendars. The mousedown fires before the framework
 * closes the calendar and potentially removes the cell from the DOM.
 *
 * Detection strategy:
 *   1. The clicked element matches CALENDAR_GRIDCELL_SELECTOR
 *   2. It's inside a calendar container (role="grid", class*="calendar", etc.)
 *   3. The cell has an aria-label or data-date carrying the full date
 *   4. Fall back to cell text + calendar header month/year reconstruction
 */
async function handleCalendarCellMousedown(event: Event): Promise<void> {
  // ── Gate 1: Genuine user event? ──
  if (!event.isTrusted) return;

  const recording = await checkRecording();
  if (!recording) return;

  const target = event.target;
  if (!target || !(target instanceof Element)) return;

  // ── Resolve: is this a calendar date cell? ──
  const cell = resolveCalendarCell(target, event);
  if (!cell) return;

  // ── Gate 2: Owned by another interaction? ──
  if (isOwnedByAnotherInteraction(cell)) return;

  // ── Gate 5: Is the cell enabled? ──
  if (!isControlEnabled(cell)) return;

  // ── Extract the date value ──
  const dateData = extractDateFromCell(cell);
  if (!dateData) return;

  // ── Resolve the identity target (the date input/trigger, not the cell) ──
  const identityTarget = resolveDateControl(cell) || cell;

  // ── Gate 4: Value change check ──
  const key = elementKey(identityTarget);
  const preState = preStateMap.get(key);
  if (preState !== undefined && preState === dateData.iso) {
    return; // Same date re-selected
  }

  // ── ALL GATES PASS → RECORD DATE SELECTION ──
  const identity = extractIdentity(identityTarget);
  commitDateSelect(identity, 'date', dateData.display, dateData.iso);

  claimDateOwnership(identityTarget);
  preStateMap.set(key, dateData.iso);
}

/**
 * Resolve whether an element is a calendar grid cell.
 *
 * Walks composedPath + parent walk to find an element matching
 * CALENDAR_GRIDCELL_SELECTOR that is inside a calendar container.
 */
function resolveCalendarCell(rawTarget: Element, evt: Event): Element | null {
  // Walk composedPath
  const path = evt.composedPath();
  for (const node of path) {
    if (node instanceof Element && isCalendarCell(node)) return node;
  }

  // Parent walk
  let current: Element | null = rawTarget;
  while (current) {
    if (isCalendarCell(current)) return current;
    current = current.parentElement;
  }

  return null;
}

/**
 * Check if an element is a calendar date cell inside a calendar container.
 *
 * Two-pass strategy:
 *   Pass 1 (fast): Match specific selectors (role=gridcell, data-date, td[aria-label])
 *   Pass 2 (broader): For any element inside a calendar container that has
 *     date-like content (aria-label with a date, numeric text 1-31), treat
 *     it as a date cell. This catches Flatpickr spans, react-datepicker divs,
 *     and custom calendar cells that lack role=gridcell.
 */
function isCalendarCell(el: Element): boolean {
  // Must be inside a calendar container first
  const container = el.closest(CALENDAR_CONTAINER_SELECTOR);
  if (!container) return false;

  // Exclude elements that are clearly navigation, not date cells
  if (el.getAttribute('aria-disabled') === 'true') return true; // still a cell, just disabled (Gate 5 will reject)

  // Pass 1: Fast path — explicit gridcell/data-date/td[aria-label]
  if (el.matches(CALENDAR_GRIDCELL_SELECTOR)) {
    const ariaLabel = el.getAttribute('aria-label');
    const dataDate = el.getAttribute('data-date');
    const text = el.textContent?.trim();
    return !!(ariaLabel || dataDate || (text && /^\d{1,2}$/.test(text)));
  }

  // Pass 2: Broader detection — element inside calendar container with
  // date-like content. Catches Flatpickr spans, react-datepicker divs,
  // custom button/div cells without ARIA gridcell role.
  const ariaLabel = el.getAttribute('aria-label');
  const dataDate = el.getAttribute('data-date') || el.getAttribute('data-day');
  const text = el.textContent?.trim();

  // data-date or data-day attribute is deterministic evidence
  if (dataDate) return true;

  // aria-label that contains a date-like pattern (month name + day number)
  if (ariaLabel && /\b\d{1,2}\b/.test(ariaLabel) && hasMonthName(ariaLabel)) {
    return true;
  }

  // Bare numeric text (1-31) on a clickable element inside calendar container
  if (text && /^(0?[1-9]|[12]\d|3[01])$/.test(text)) {
    // Must be an interactive element (button, span, div, td, a)
    const tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'SPAN' || tag === 'DIV' ||
        tag === 'TD' || tag === 'A' || tag === 'LI') {
      return true;
    }
  }

  return false;
}

/**
 * Check if a string contains a month name.
 */
function hasMonthName(s: string): boolean {
  const lower = s.toLowerCase();
  return MONTH_NAMES.some(m => lower.includes(m.toLowerCase())) ||
         MONTH_NAMES_SHORT.some(m => lower.includes(m.toLowerCase()));
}

/**
 * Extract date data from a calendar cell.
 *
 * Priority:
 *   1. aria-label (e.g., "15 July 2026") — most ARIA-compliant calendars
 *   2. data-date attribute (e.g., "2026-07-15") — some frameworks
 *   3. Cell text + calendar header month/year — fallback reconstruction
 */
function extractDateFromCell(cell: Element): { iso: string; display: string } | null {
  // Strategy 1: aria-label
  const ariaLabel = cell.getAttribute('aria-label');
  if (ariaLabel) {
    const parsed = parseDateLabel(ariaLabel);
    if (parsed) return parsed;
  }

  // Strategy 2: data-date attribute
  const dataDate = cell.getAttribute('data-date');
  if (dataDate) {
    const display = isoToDisplay(dataDate, 'date');
    if (display !== dataDate) return { iso: dataDate, display };
  }

  // Strategy 3: cell text + calendar header
  const text = cell.textContent?.trim();
  if (text && /^\d{1,2}$/.test(text)) {
    const reconstructed = reconstructDateFromCalendar(cell, parseInt(text, 10));
    if (reconstructed) return reconstructed;
  }

  return null;
}

/**
 * Reconstruct a full date from a cell's day number + calendar header.
 *
 * Walks up to the calendar container and looks for month/year in:
 *   - ARIA labels on the container
 *   - Header elements with month/year text
 *   - data-* attributes on the container
 */
function reconstructDateFromCalendar(cell: Element, day: number): { iso: string; display: string } | null {
  const container = cell.closest(CALENDAR_CONTAINER_SELECTOR);
  if (!container) return null;

  // Look for month/year in various header patterns
  const allText = container.textContent || '';

  // Try to find a month name and year
  for (let i = 0; i < 12; i++) {
    if (allText.includes(MONTH_NAMES[i]) || allText.includes(MONTH_NAMES_SHORT[i])) {
      // Find the year near this month
      const yearMatch = allText.match(/(\d{4})/);
      if (yearMatch) {
        const year = parseInt(yearMatch[1], 10);
        const monthIdx = i;
        const iso = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const display = `${day} ${MONTH_NAMES[monthIdx]} ${year}`;
        return { iso, display };
      }
    }
  }

  return null;
}

/**
 * Resolve the date input/trigger element associated with a calendar cell.
 *
 * Walks up from the cell to find the calendar container, then looks for:
 *   1. An associated input via aria-controls/aria-labelledby
 *   2. An input with a matching class/name pattern
 *   3. Falls back to the calendar container itself
 */
function resolveDateControl(cell: Element): Element | null {
  const container = cell.closest(CALENDAR_CONTAINER_SELECTOR);
  if (!container) return null;

  // Strategy 1: container has aria-labelledby → resolve to the label element
  const labelledBy = container.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy.split(/\s+/)[0]);
    if (labelEl) {
      // The label may itself be the input or contain the input
      if (labelEl instanceof HTMLInputElement) return labelEl;
      const input = labelEl.querySelector('input');
      if (input) return input;
      return labelEl; // The trigger element
    }
  }

  // Strategy 2: container has an id → find [aria-controls="id"]
  if (container.id) {
    const controller = document.querySelector(`[aria-controls="${cssEscape(container.id)}"]`);
    if (controller) return controller;
  }

  // Strategy 3: look for a native date input near the calendar
  const nearbyInput = container.parentElement?.querySelector(NATIVE_DATE_INPUT_SELECTOR);
  if (nearbyInput) return nearbyInput;

  // Strategy 4: look for a text input near the calendar
  const nearbyTextInput = container.parentElement?.querySelector('input[type="text"]');
  if (nearbyTextInput) return nearbyTextInput;

  // Fallback: the container itself
  return container;
}

// ── Pre-State Capture Handlers ────────────────────────────

/**
 * Listen for focus and mousedown on date controls to capture pre-state.
 */
function handlePreStateCapture(event: Event): void {
  if (!event.isTrusted) return;
  if (!event.target) return;

  const target = event.target;
  if (target instanceof Element && target.matches(NATIVE_DATE_INPUT_SELECTOR)) {
    captureNativePreState(target);
  }
}

// ── Post-Click Value Outcome Detection ───────────────────

/**
 * C6.2A Mechanism 4: Post-click input value outcome detection.
 *
 * Many modern date pickers use text inputs (<input type="text">) with
 * custom calendar popups. The calendar DOM may use arbitrary class names
 * that don't match CALENDAR_CONTAINER_SELECTOR (e.g., Adani One).
 *
 * Instead of trying to match the calendar DOM, we watch the OUTCOME:
 * after ANY mousedown on the page, we snapshot all text inputs' values,
 * then check after a short delay if any changed to a date-like format.
 * If so, we record it as a dateSelect and suppress the click.
 *
 * This is framework-agnostic and catches:
 *   - Custom calendar popups with unrecognized class names
 *   - Portaled calendars rendered outside the form
 *   - JS frameworks that programmatically set input.value
 */
const DATE_VALUE_PATTERN = /\b\d{1,2}[-/\s](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)[-/\s]\d{2,4}\b/i;
const DATE_VALUE_PATTERN_2 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2},?\s*\d{2,4}\b/i;
const DATE_VALUE_PATTERN_3 = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/;
const DATE_VALUE_PATTERN_4 = /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i;

/**
 * Date-like input fields selector.
 * Text inputs whose attributes suggest they hold dates.
 */
const DATE_LIKE_INPUT_SELECTOR = [
  'input[type="text"]',
  'input:not([type])',
].join(', ');

/**
 * Check if an input element looks date-related by its attributes.
 */
function isDateLikeInput(el: HTMLInputElement): boolean {
  const placeholder = (el.placeholder || '').toLowerCase();
  const name = (el.name || '').toLowerCase();
  const id = (el.id || '').toLowerCase();
  const cls = (el.className || '').toLowerCase();
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

  const combined = `${placeholder} ${name} ${id} ${cls} ${ariaLabel}`;
  return /\b(date|depart|arrival|return|check.?in|check.?out|from.?date|to.?date|travel|journey|trip|fly|calendar)\b/.test(combined);
}

/**
 * Check if a string value looks like a date.
 */
function isDateLikeValue(value: string): boolean {
  if (!value || value.trim().length < 4) return false;
  const v = value.trim();
  return DATE_VALUE_PATTERN.test(v) ||
         DATE_VALUE_PATTERN_2.test(v) ||
         DATE_VALUE_PATTERN_3.test(v) ||
         DATE_VALUE_PATTERN_4.test(v);
}

/**
 * Snapshot of text inputs' values before a click.
 */
interface InputSnapshot {
  input: HTMLInputElement;
  oldValue: string;
  key: string;
}

let pendingInputSnapshot: InputSnapshot[] | null = null;

/**
 * Snapshot all date-like text inputs' values before a mousedown.
 * Called from the capture-phase mousedown handler.
 */
function snapshotDateInputs(): void {
  pendingInputSnapshot = null;

  const inputs = document.querySelectorAll<HTMLInputElement>(DATE_LIKE_INPUT_SELECTOR);
  const snapshots: InputSnapshot[] = [];

  for (const input of inputs) {
    // Skip hidden, disabled, or read-only inputs
    if (input.hidden || input.disabled || input.readOnly) continue;
    if (input.offsetParent === null && input.getClientRects().length === 0) continue;

    // Include ALL text inputs (not just date-like ones) — the calendar
    // may fill an input whose attributes don't mention dates. We filter
    // by checking the VALUE after the click, not the input's attributes.
    snapshots.push({
      input,
      oldValue: input.value || '',
      key: elementKey(input),
    });
  }

  pendingInputSnapshot = snapshots.length > 0 ? snapshots : null;
}

/**
 * Check if any text input's value changed to a date-like format
 * after a click. Runs on setTimeout(300) after mousedown.
 */
function checkPostClickDateChange(): void {
  const snapshots = pendingInputSnapshot;
  pendingInputSnapshot = null;
  if (!snapshots) return;

  for (const snap of snapshots) {
    const newValue = snap.input.value || '';
    if (newValue === snap.oldValue) continue;
    if (!isDateLikeValue(newValue)) continue;

    // ── VALUE CHANGED TO DATE-LIKE FORMAT ──
    // Gate 2: Owned by another interaction?
    if (isOwnedByAnotherInteraction(snap.input)) continue;

    // Gate 4: Value change confirmed (already checked above)

    // Parse the date value for display and ISO
    const parsed = parseDisplayDate(newValue);
    const displayValue = parsed ? parsed.display : newValue;
    const isoValue = parsed ? parsed.iso : '';

    // Record date selection
    const identity = extractIdentity(snap.input);
    commitDateSelect(identity, 'date', displayValue, isoValue);

    claimDateOwnership(snap.input);
    preStateMap.set(snap.key, isoValue || newValue);
  }
}

/**
 * Parse a human-readable date string into ISO + display format.
 *
 * Handles common formats:
 *   "Sat, 18 Jul" → { iso: "<current-year>-07-18", display: "18 July <year>" }
 *   "18 July 2026" → { iso: "2026-07-18", display: "18 July 2026" }
 *   "18/07/2026" → { iso: "2026-07-18", display: "18 July 2026" }
 */
function parseDisplayDate(value: string): { iso: string; display: string } | null {
  const v = value.trim();

  // Pattern: "Day, DD Mon" or "Day, DD Mon YYYY" (e.g., "Sat, 18 Jul")
  const m1 = v.match(/(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)?,?\s*(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  if (m1) {
    const day = parseInt(m1[1], 10);
    const monthIdx = MONTH_NAMES_SHORT.findIndex(m => m.toLowerCase() === m1![2].toLowerCase());
    if (monthIdx >= 0) {
      const yearMatch = v.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
      const iso = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { iso, display: `${day} ${MONTH_NAMES[monthIdx]} ${year}` };
    }
  }

  // Pattern: "DD Month YYYY" (e.g., "18 July 2026")
  const m2 = v.match(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i);
  if (m2) {
    const day = parseInt(m2[1], 10);
    const monthIdx = MONTH_NAMES.findIndex(m => m.toLowerCase() === m2![2].toLowerCase());
    const year = parseInt(m2[3], 10);
    if (monthIdx >= 0) {
      const iso = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { iso, display: `${day} ${MONTH_NAMES[monthIdx]} ${year}` };
    }
  }

  // Pattern: "DD/MM/YYYY" or "DD-MM-YYYY"
  const m3 = v.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m3) {
    const day = parseInt(m3[1], 10);
    const monthIdx = parseInt(m3[2], 10) - 1;
    const year = parseInt(m3[3], 10);
    if (monthIdx >= 0 && monthIdx < 12) {
      const iso = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { iso, display: `${day} ${MONTH_NAMES[monthIdx]} ${year}` };
    }
  }

  // Pattern: "YYYY-MM-DD"
  const m4 = v.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m4) {
    const year = parseInt(m4[1], 10);
    const monthIdx = parseInt(m4[2], 10) - 1;
    const day = parseInt(m4[3], 10);
    if (monthIdx >= 0 && monthIdx < 12) {
      return { iso: v.substring(m4.index!, m4.index! + 10), display: `${day} ${MONTH_NAMES[monthIdx]} ${year}` };
    }
  }

  return null;
}

// ── Event Listeners ───────────────────────────────────────

// Native date input: change event (capture phase)
document.addEventListener('change', handleNativeDateChange, true);

// Calendar grid cell: mousedown (capture phase)
// Uses mousedown to detect before the framework closes the calendar
document.addEventListener('mousedown', handleCalendarCellMousedown, true);

// Pre-state capture: focus and mousedown (capture phase)
document.addEventListener('focus', handlePreStateCapture, true);
document.addEventListener('mousedown', handlePreStateCapture, true);

// C6.2A: Post-click value outcome detection for text-input date pickers.
// Snapshot ALL text inputs before any mousedown, then check after 300ms
// if any changed to a date-like value. This catches custom calendars
// (Adani One, etc.) whose DOM doesn't match CALENDAR_CONTAINER_SELECTOR.
document.addEventListener('mousedown', () => {
  snapshotDateInputs();
}, true);

// Check for date-like value changes after a delay
document.addEventListener('mousedown', () => {
  setTimeout(checkPostClickDateChange, 300);
}, true);

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

// ── Accessible Name Computation ───────────────────────────

function computeAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return truncate(ariaLabel.trim(), 200);

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

  if (el.id) {
    const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (label) {
      const text = label.textContent?.trim();
      if (text) return truncate(text, 200);
    }
  }

  const parent = el.parentElement;
  if (parent && parent.tagName === 'LABEL') {
    const text = parent.textContent?.trim();
    if (text) return truncate(text, 200);
  }

  const title = el.getAttribute('title');
  if (title && title.trim()) return truncate(title.trim(), 200);

  const nameAttr = el.getAttribute('name');
  if (nameAttr && nameAttr.trim()) return truncate(nameAttr.trim(), 200);

  return '';
}

// ── Role Mapping ──────────────────────────────────────────

function getImplicitRole(el: Element): string | null {
  const explicitRole = el.getAttribute('role');
  if (explicitRole && explicitRole.trim()) return explicitRole.trim();

  const TAG_ROLE_MAP: Record<string, string> = {
    INPUT: 'textbox',
    BUTTON: 'button',
    A: 'link',
    DIV: 'application',
    TD: 'gridcell',
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
