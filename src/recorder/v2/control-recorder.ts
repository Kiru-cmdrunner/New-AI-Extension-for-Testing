/**
 * Stage 2 — Control-Centric Content Script (Capture Layer)
 *
 * This content script uses the Control Model for target resolution. When the
 * feature flag is set to 'control', this script captures events instead of
 * deterministic-recorder.ts.
 *
 * KEY DIFFERENCE from deterministic-recorder.ts:
 * - Events are resolved via model.matchEvent() which returns the CORRECT
 *   control (Nationality → "Nationality", not "Blood Type")
 * - The same RECORDED_EVENT message format is sent so the downstream pipeline
 *   (V1/V2 classifier → merge → domain adapter → enrichment → IR → Playwright)
 *   works unchanged
 *
 * Feature flag mechanism:
 * - Reads `recorder_engine` from chrome.storage.local (via ui_state changes)
 * - Both content scripts are injected declaratively, but only one activates
 *   based on the flag value
 * - Default is 'legacy' (deterministic-recorder.ts)
 */

import { ControlModel } from './control-model';
import { buildElementIdentity } from './element-identity-builder';
import type { ControlNode } from './types';
import type { DomContext } from '../recorded-event';
import type { RecordedEventMessage } from '../recorded-event';

// ─── Double-injection guard ─────────────────────────────────────────────────

const V2_GUARD = '__CMDRUNNER_V2_CS_ACTIVE__';

if ((window as any)[V2_GUARD]) {
  // Already injected — silently exit
} else {
  (window as any)[V2_GUARD] = true;

  // ─── State ─────────────────────────────────────────────────────────────────

  let isRecording = false;
  let isActive = false; // true when recorder_engine === 'control'
  let model: ControlModel | null = null;
  let valueBefore: string | undefined;
  let checkedBefore: boolean | undefined;

  // ─── Hover Filtering State ────────────────────────────────────────────────

  /** Pending hover — buffered until dwell threshold expires or is cancelled. */
  let pendingHoverCtrl: ControlNode | null = null;
  let pendingHoverEl: Element | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  /** Minimum dwell time (ms) before a hover is considered intentional. */
  const HOVER_DWELL_MS = 500;

  /** Cooldown map: elementKey → timestamp until which hovers are suppressed. */
  const hoverCooldowns = new Map<string, number>();
  const HOVER_COOLDOWN_MS = 2000;

  /** After any click, suppress hover on that element for HOVER_COOLDOWN_MS. */
  function isHoverSuppressed(elementKey: string): boolean {
    const until = hoverCooldowns.get(elementKey);
    if (until === undefined) return false;
    if (Date.now() >= until) {
      hoverCooldowns.delete(elementKey);
      return false;
    }
    return true;
  }

  function setHoverCooldown(elementKey: string): void {
    hoverCooldowns.set(elementKey, Date.now() + HOVER_COOLDOWN_MS);
  }

  /** Cancel any pending hover (mouse left before dwell threshold). */
  function cancelPendingHover(): void {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    pendingHoverCtrl = null;
    pendingHoverEl = null;
  }

  /** Flush a pending hover immediately (e.g. on STOP_RECORDING). */
  // flushPendingHover removed — STOP_RECORDING uses cancelPendingHover (don't
  // emit if dwell wasn't reached). If you need to flush in future, re-add here.

  // ─── Feature Flag Sync ────────────────────────────────────────────────────

  /**
   * Read the recorder_engine flag from storage.
   * Default is 'legacy' — this script only activates when flag is 'control'.
   */
  async function syncEngineFlag(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('ui_state');
      const uiState = result['ui_state'] as any;
      const engine = uiState?.recorderEngine || 'legacy';
      isActive = engine === 'control';

      // If we just became active and are recording, set up the model
      if (isActive && isRecording && !model) {
        setupModel();
      }
      // If we just became inactive, tear down
      if (!isActive && model) {
        teardownModel();
      }
    } catch {
      // Storage read failed — stay inactive (default legacy)
    }
  }

  // ─── Model Lifecycle ──────────────────────────────────────────────────────

  function setupModel(): void {
    if (model) return;
    model = new ControlModel();
    model.discover(document.body);
    model.observe(document.body);
  }

  function teardownModel(): void {
    model?.disconnect();
    model = null;
  }

  // ─── Date Picker Detection ─────────────────────────────────────────────────

  /**
   * Native date input types that produce dateSelect events.
   */
  const NATIVE_DATE_TYPES = ['date', 'time', 'datetime-local', 'month', 'week'];

  /**
   * Calendar container patterns — used to detect custom calendar popovers
   * and set ownedByDatePicker on events inside them.
   */
  const CALENDAR_CONTAINER_PATTERN = /calendar|datepicker|date-picker|date_picker|oxd-calendar|react-datepicker|flatpickr/i;
  const GRIDCELL_PATTERN = /gridcell|data-date|data-day/i;

  /**
   * Check if an element is inside a calendar popover/dialog.
   */
  function isInsideCalendar(el: Element): boolean {
    let current: Element | null = el.parentElement;
    let depth = 0;
    while (current && depth < 10) {
      const cls = current.getAttribute('class') || '';
      const role = current.getAttribute('role') || '';
      if (CALENDAR_CONTAINER_PATTERN.test(cls) || role === 'grid') {
        return true;
      }
      current = current.parentElement;
      depth++;
    }
    return false;
  }

  /**
   * Check if an element is a date picker toggle — the button/icon/input that
   * opens the calendar. Clicking it is implementation detail; only the final
   * dateSelect event should be recorded.
   */
  const DATE_PICKER_TOGGLE_PATTERN = /oxd-date-input|date.*picker.*icon|calendar.*icon|picker.*toggle/i;
  function isDatePickerToggle(el: Element): boolean {
    // Native date input — clicking opens the browser's date picker
    if (el instanceof HTMLInputElement && NATIVE_DATE_TYPES.includes(el.type)) {
      return true;
    }
    // OXD/custom: icon or button adjacent to a date input
    const cls = el.getAttribute('class') || '';
    if (DATE_PICKER_TOGGLE_PATTERN.test(cls)) return true;
    // Button/icon inside a container that also contains a native date input
    if ((el.tagName === 'BUTTON' || el.tagName === 'I' || el.tagName === 'SPAN') && isInsideDatePickerContainer(el)) {
      return true;
    }
    return false;
  }

  /** Check if an ancestor container holds a date input. */
  function isInsideDatePickerContainer(el: Element): boolean {
    let current: Element | null = el.parentElement;
    let depth = 0;
    while (current && depth < 5) {
      const cls = current.getAttribute('class') || '';
      if (/date.*input|date.*picker|oxd-date/i.test(cls)) return true;
      const dateInput = current.querySelector('input[type="date"], input[type="datetime-local"], input[type="month"], input[type="week"], input[type="time"]');
      if (dateInput) return true;
      current = current.parentElement;
      depth++;
    }
    return false;
  }

  /**
   * Check if an element is a calendar grid cell (clickable date cell).
   */
  function isCalendarCell(el: Element): boolean {
    const role = el.getAttribute('role');
    if (role === 'gridcell') return true;
    const cls = el.getAttribute('class') || '';
    if (GRIDCELL_PATTERN.test(cls)) return true;
    // OXD date picker: .oxd-calendar-wrapper --calendar cells are buttons inside
    if (el.tagName === 'BUTTON' && isInsideCalendar(el)) return true;
    return false;
  }

  /**
   * Determine the date type from a native date input element.
   */
  function getNativeDateType(inputType: string): string {
    if (inputType === 'datetime-local') return 'dateTime';
    if (inputType === 'time') return 'time';
    if (inputType === 'month') return 'date';
    if (inputType === 'week') return 'date';
    return 'date';
  }

  /**
   * Convert an ISO date value to human-readable display.
   * Simple implementation — the service worker's normalizer does the full job.
   */
  function isoToDisplay(iso: string, dateType: string): string {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      if (dateType === 'time') {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      if (dateType === 'dateTime') {
        return d.toLocaleString([], { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  // Date change debounce state
  let dateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDateElement: Element | null = null;
  let pendingDateControl: ControlNode | null = null;

  /**
   * Handle a date value change. Debounced 800ms (same as deterministic-recorder).
   * Emits a dateSelect event with normalized date metadata in DomContext.
   */
  function handleDateValueChange(el: Element, ctrl: ControlNode, cellValue?: string): void {
    // Clear any pending debounce
    if (dateDebounceTimer) {
      clearTimeout(dateDebounceTimer);
    }
    pendingDateElement = el;
    pendingDateControl = ctrl;

    dateDebounceTimer = setTimeout(() => {
      if (!pendingDateElement || !pendingDateControl) return;
      if (!shouldCapture()) return;

      const targetEl = pendingDateElement;
      const targetCtrl = pendingDateControl;

      // Determine date type and values
      let dateType = 'date';
      let isoValue = '';
      let displayValue = '';
      let dateConfidence = 0.8;
      let dateAmbiguous = false;

      if (targetEl instanceof HTMLInputElement && NATIVE_DATE_TYPES.includes(targetEl.type)) {
        // Native date input
        dateType = getNativeDateType(targetEl.type);
        isoValue = targetEl.value;
        displayValue = isoToDisplay(isoValue, dateType);
        dateConfidence = isoValue ? 1.0 : 0.5;
      } else if (cellValue) {
        // Calendar cell click — cellValue is the date text/aria-label
        isoValue = cellValue;
        displayValue = cellValue;
        dateConfidence = 0.9;
      } else {
        // Custom text input with date value
        const val = captureValue(targetEl) ?? '';
        isoValue = val;
        displayValue = val;
        dateConfidence = 0.7;
        dateAmbiguous = true;
      }

      // Build DomContext with date metadata
      const identity = buildElementIdentity(targetCtrl, targetEl);
      const domContext = captureDomContext(targetEl);
      domContext.dateType = dateType;
      domContext.isoValue = isoValue;
      domContext.displayValue = displayValue;
      domContext.dateConfidence = dateConfidence;
      if (dateAmbiguous) domContext.dateAmbiguous = dateAmbiguous;

      const message: RecordedEventMessage = {
        type: 'RECORDED_EVENT',
        eventType: 'dateSelect',
        timestamp: new Date().toISOString(),
        target: identity,
        valueBefore: null,
        valueAfter: isoValue || displayValue || null,
        checkedBefore: null,
        checkedAfter: null,
        domContext,
      };

      try {
        chrome.runtime.sendMessage(message);
      } catch {
        // SW may be restarting
      }

      // Cleanup
      dateDebounceTimer = null;
      pendingDateElement = null;
      pendingDateControl = null;
    }, 800);
  }

  /**
   * Enrich DomContext with ownedByDatePicker for events inside calendar containers.
   */
  function withDatePickerOwnership(el: Element, ctx: DomContext): DomContext {
    if (isInsideCalendar(el)) {
      ctx.ownedByDatePicker = true;
    }
    return ctx;
  }

  // ─── Value Capture (same logic as deterministic-recorder) ──────────────────

  function captureValue(el: Element): string | undefined {
    if (el instanceof HTMLSelectElement) {
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
      const option = document.getElementById(descendantId);
      if (option) return option.textContent?.trim() || option.getAttribute('aria-label') || '';
    }
    return undefined;
  }

  function captureCheckedState(el: Element): boolean | undefined {
    if (el instanceof HTMLInputElement) {
      return el.type === 'checkbox' || el.type === 'radio' ? el.checked : undefined;
    }
    const ariaChecked = el.getAttribute('aria-checked');
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;
    return undefined;
  }

  // ─── DomContext Capture (simplified version of deterministic-recorder) ────

  function captureDomContext(el: Element): DomContext {
    let inputType: string | null = null;
    let listId: string | null = null;
    let acceptedFileTypes: string | null = null;
    let multipleFiles: boolean | null = null;
    let nativeMin: string | null = null;
    let nativeMax: string | null = null;

    if (el instanceof HTMLInputElement) {
      inputType = el.type || 'text';
      listId = el.getAttribute('list');
      if (inputType === 'file') {
        acceptedFileTypes = el.accept || null;
        multipleFiles = el.multiple;
      }
      if (inputType === 'range') {
        nativeMin = el.min || null;
        nativeMax = el.max || null;
      }
    }

    const ariaExpandedAttr = el.getAttribute('aria-expanded');
    const ariaExpanded: boolean | null =
      ariaExpandedAttr === 'true' ? true :
      ariaExpandedAttr === 'false' ? false : null;

    const isContentEditable = el instanceof HTMLElement ? el.isContentEditable : false;

    const ctx: DomContext = {
      inputType,
      ariaExpanded,
      ariaHasPopup: el.getAttribute('aria-haspopup'),
      ariaAutoComplete: el.getAttribute('aria-autocomplete'),
      listId,
      isContentEditable,
    };

    if (acceptedFileTypes !== null) ctx.acceptedFileTypes = acceptedFileTypes;
    if (multipleFiles !== null) ctx.multipleFiles = multipleFiles;

    const ariaValueNow = el.getAttribute('aria-valuenow');
    const ariaValueText = el.getAttribute('aria-valuetext');
    const ariaValueMin = el.getAttribute('aria-valuemin');
    const ariaValueMax = el.getAttribute('aria-valuemax');
    if (ariaValueNow !== null) ctx.ariaValueNow = ariaValueNow;
    if (ariaValueText !== null) ctx.ariaValueText = ariaValueText;
    if (ariaValueMin !== null) ctx.ariaValueMin = ariaValueMin;
    if (ariaValueMax !== null) ctx.ariaValueMax = ariaValueMax;
    if (nativeMin !== null) ctx.nativeMin = nativeMin;
    if (nativeMax !== null) ctx.nativeMax = nativeMax;

    // DOM attributes for enrichment
    ctx.domAttributes = captureDomAttributes(el);

    // Ancestor role chain
    ctx.ancestorRoles = captureAncestorRoles(el);

    return ctx;
  }

  function captureDomAttributes(el: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    const validationAttrs = [
      'required', 'aria-required', 'type', 'min', 'max', 'step',
      'pattern', 'minlength', 'maxlength', 'multiple', 'accept', 'autocomplete',
    ];
    for (const attr of validationAttrs) {
      const value = el.getAttribute(attr);
      if (value !== null) attrs[attr] = value;
    }
    if (el instanceof HTMLInputElement) {
      if (!('type' in attrs)) attrs['type'] = el.type || 'text';
    }
    if (el instanceof HTMLElement && (el.isContentEditable || el.getAttribute('contenteditable') === 'true')) {
      attrs['contenteditable'] = 'true';
    }
    return attrs;
  }

  function captureAncestorRoles(el: Element): string[] {
    const chain: string[] = [];
    let current: Element | null = el.parentElement;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 10) {
      const tag = current.tagName.toLowerCase();
      const role = current.getAttribute('role');
      if (role) chain.push(`${tag}[role=${role}]`);
      else chain.push(tag);
      current = current.parentElement;
      depth++;
    }
    return chain;
  }

  // ─── Event Sending ─────────────────────────────────────────────────────────

  function sendEvent(
    eventType: 'click' | 'dblclick' | 'contextmenu' | 'focus' | 'blur' | 'change' | 'input' | 'scroll' | 'mouseenter' | 'dragstart' | 'drop' | 'dateSelect',
    ctrl: ControlNode,
    el: Element,
    valueAfter: string | null,
    checkedAfter: boolean | null,
  ): void {
    const identity = buildElementIdentity(ctrl, el);
    const domContext = withDatePickerOwnership(el, captureDomContext(el));

    const message: RecordedEventMessage = {
      type: 'RECORDED_EVENT',
      eventType,
      timestamp: new Date().toISOString(),
      target: identity,
      valueBefore: valueBefore ?? null,
      valueAfter,
      checkedBefore: checkedBefore ?? null,
      checkedAfter,
      domContext,
    };

    try {
      chrome.runtime.sendMessage(message);
    } catch {
      // Service worker may be restarting — event will be captured on next interaction
    }
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────

  /**
   * Guard: only capture if BOTH recording AND active (flag=control).
   */
  function shouldCapture(): boolean {
    return isRecording && isActive && model !== null;
  }

  function onClick(event: MouseEvent): void {
    if (!shouldCapture()) return;
    if (event.button !== 0) return; // left button only

    const target = event.target as Element;
    if (!target) return;

    // ── Date picker toggle interception ──
    // Clicking the date picker field/icon to open the calendar is implementation
    // detail — suppress the click. Only the dateSelect event (final committed
    // value) should be recorded.
    if (isDatePickerToggle(target)) {
      // Set hover cooldown so accidental hovers don't create noise
      const ctrl = model!.matchEvent(target);
      if (ctrl) {
        const el = ctrl.elementRef.deref();
        if (el) {
          const key = `${el.tagName}|${el.className}`;
          setHoverCooldown(key);
        }
      }
      return; // Suppress the click — wait for dateSelect or change event
    }

    // ── Date picker cell interception ──
    // Calendar cell clicks produce a dateSelect event (not a regular click)
    if (isCalendarCell(target)) {
      const ctrl = model!.matchEvent(target);
      if (ctrl) {
        const el = ctrl.elementRef.deref();
        if (el) {
          const cellValue = el.getAttribute('aria-label') || el.textContent?.trim() || '';
          handleDateValueChange(el, ctrl, cellValue);
          return; // Don't emit a regular click
        }
      }
    }

    // Native date input clicks open the picker — don't intercept the click,
    // but the change event (onChange) will trigger handleDateValueChange.

    const ctrl = model!.matchEvent(target);
    if (!ctrl) return;

    const el = ctrl.elementRef.deref();
    if (!el) return;

    // Set hover cooldown for this element — hovers immediately after a click
    // on the same element are noise (the user clicked, not hovered)
    const elementKey = `${el.tagName}|${el.className}`;
    setHoverCooldown(elementKey);
    cancelPendingHover();

    const valueAfter = captureValue(el) ?? null;
    const checkedAfter = captureCheckedState(el) ?? null;

    sendEvent('click', ctrl, el, valueAfter, checkedAfter);
  }

  function onFocus(event: FocusEvent): void {
    if (!shouldCapture()) return;

    const target = event.target as Element;
    if (!target) return;

    const ctrl = model!.matchEvent(target);
    if (!ctrl) return;

    // Capture value state before the user interacts
    const el = ctrl.elementRef.deref();
    if (el) {
      valueBefore = captureValue(el);
      checkedBefore = captureCheckedState(el);
    }
  }

  function onBlur(event: FocusEvent): void {
    if (!shouldCapture()) return;

    const target = event.target as Element;
    if (!target) return;

    const ctrl = model!.matchEvent(target);
    if (!ctrl) return;

    const el = ctrl.elementRef.deref();
    if (!el) return;

    const valueAfter = captureValue(el);
    if (valueBefore !== undefined && valueAfter !== undefined && valueBefore !== valueAfter) {
      // Value changed — send 'change' event to match legacy recorder behaviour.
      // The downstream classifier expects 'change' or 'input' event types for
      // value transitions, not 'blur'.
      sendEvent('change', ctrl, el, valueAfter ?? null, null);
    }

    valueBefore = undefined;
    checkedBefore = undefined;
  }

  function onInput(event: Event): void {
    if (!shouldCapture()) return;

    const target = event.target as Element;
    if (!target) return;

    const ctrl = model!.matchEvent(target);
    if (!ctrl) return;

    const el = ctrl.elementRef.deref();
    if (!el) return;

    const valueAfter = captureValue(el) ?? null;
    const checkedAfter = captureCheckedState(el) ?? null;

    sendEvent('input', ctrl, el, valueAfter, checkedAfter);
  }

  function onChange(event: Event): void {
    if (!shouldCapture()) return;

    const target = event.target as Element;
    if (!target) return;

    const ctrl = model!.matchEvent(target);
    if (!ctrl) return;

    const el = ctrl.elementRef.deref();
    if (!el) return;

    // ── Native date input change → emit dateSelect (not change) ──
    if (el instanceof HTMLInputElement && NATIVE_DATE_TYPES.includes(el.type)) {
      handleDateValueChange(el, ctrl);
      return;
    }

    const valueAfter = captureValue(el) ?? null;
    const checkedAfter = captureCheckedState(el) ?? null;

    sendEvent('change', ctrl, el, valueAfter, checkedAfter);
  }

  let scrollTimer: ReturnType<typeof setTimeout> | null = null;

  function onScroll(): void {
    if (!shouldCapture()) return;

    // Debounce scroll events (200ms, same as deterministic-recorder)
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!shouldCapture() || !model) return;

      // Create a synthetic control for the document/scroll container
      const target = document.scrollingElement || document.body;
      const ctrl = model.matchEvent(target);
      if (ctrl) {
        const el = ctrl.elementRef.deref();
        if (el) sendEvent('scroll', ctrl, el, null, null);
      }
      scrollTimer = null;
    }, 200);
  }

  function onMouseEnter(event: MouseEvent): void {
    if (!shouldCapture()) return;

    const target = event.target as Element;
    if (!target) return;

    // Cancel any previous pending hover — mouse moved to a new element
    cancelPendingHover();

    const ctrl = model!.matchEvent(target);
    if (!ctrl) return;

    const el = ctrl.elementRef.deref();
    if (!el) return;

    // Skip hover on date picker toggle elements
    if (isDatePickerToggle(el)) return;

    // Check cooldown — suppress hover if this element was recently clicked
    const elementKey = `${el.tagName}|${el.className}`;
    if (isHoverSuppressed(elementKey)) return;

    // Buffer the hover — only emit if the user dwells for HOVER_DWELL_MS
    pendingHoverCtrl = ctrl;
    pendingHoverEl = el;

    hoverTimer = setTimeout(() => {
      if (!pendingHoverCtrl || !pendingHoverEl) return;
      if (!shouldCapture()) return;
      // Re-check cooldown — a click may have happened during the dwell
      const key = `${pendingHoverEl.tagName}|${pendingHoverEl.className}`;
      if (isHoverSuppressed(key)) {
        pendingHoverCtrl = null;
        pendingHoverEl = null;
        hoverTimer = null;
        return;
      }
      sendEvent('mouseenter', pendingHoverCtrl, pendingHoverEl, null, null);
      pendingHoverCtrl = null;
      pendingHoverEl = null;
      hoverTimer = null;
    }, HOVER_DWELL_MS);
  }

  function onMouseLeave(event: MouseEvent): void {
    if (!shouldCapture()) return;
    // Mouse left the element before dwell threshold — cancel pending hover
    cancelPendingHover();
  }

  function onContextMenu(event: MouseEvent): void {
    if (!shouldCapture()) return;

    const ctrl = model!.matchEvent(event.target as Element);
    if (!ctrl) return;

    const el = ctrl.elementRef.deref();
    if (!el) return;

    sendEvent('contextmenu', ctrl, el, null, null);
  }

  function onDblClick(event: MouseEvent): void {
    if (!shouldCapture()) return;
    if (event.button !== 0) return;

    const ctrl = model!.matchEvent(event.target as Element);
    if (!ctrl) return;

    const el = ctrl.elementRef.deref();
    if (!el) return;

    sendEvent('dblclick', ctrl, el, null, null);
  }

  function onDragStart(event: DragEvent): void {
    if (!shouldCapture()) return;

    const ctrl = model!.matchEvent(event.target as Element);
    if (!ctrl) return;

    const el = ctrl.elementRef.deref();
    if (!el) return;

    sendEvent('dragstart', ctrl, el, null, null);
  }

  function onDrop(event: DragEvent): void {
    if (!shouldCapture()) return;

    const ctrl = model!.matchEvent(event.target as Element);
    if (!ctrl) return;

    const el = ctrl.elementRef.deref();
    if (!el) return;

    sendEvent('drop', ctrl, el, null, null);
  }

  // ─── Register Listeners (capture phase) ───────────────────────────────────

  document.addEventListener('click', onClick, true);
  document.addEventListener('dblclick', onDblClick, true);
  document.addEventListener('contextmenu', onContextMenu, true);
  document.addEventListener('focus', onFocus, true);
  document.addEventListener('blur', onBlur, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('scroll', onScroll, true);
  document.addEventListener('mouseenter', onMouseEnter, true);
  document.addEventListener('mouseleave', onMouseLeave, true);
  document.addEventListener('dragstart', onDragStart, true);
  document.addEventListener('drop', onDrop, true);

  // ─── Message Listener ───────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ type: 'PONG', isRecording, url: location.href, engine: isActive ? 'control' : 'legacy' });
      return true;
    }

    if (message.type === 'START_RECORDING') {
      isRecording = true;
      // Check if we should be the active recorder
      syncEngineFlag();
    } else if (message.type === 'STOP_RECORDING') {
      isRecording = false;
      valueBefore = undefined;
      checkedBefore = undefined;
      // Flush any pending date selection so it's included in the recording
      if (dateDebounceTimer) {
        clearTimeout(dateDebounceTimer);
        dateDebounceTimer = null;
        pendingDateElement = null;
        pendingDateControl = null;
      }
      // Cancel any pending hover — don't emit if dwell wasn't reached
      cancelPendingHover();
      hoverCooldowns.clear();
    }

    return false;
  });

  // Also sync recording state from storage changes (matches deterministic-recorder pattern)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes['ui_state']) {
      const newState = changes['ui_state'].newValue as any;
      if (newState?.recordingState === 'recording') {
        isRecording = true;
        syncEngineFlag();
      } else if (newState?.recordingState === 'stopped' || newState?.recordingState === 'ready') {
        isRecording = false;
        valueBefore = undefined;
        checkedBefore = undefined;
        if (dateDebounceTimer) {
          clearTimeout(dateDebounceTimer);
          dateDebounceTimer = null;
          pendingDateElement = null;
          pendingDateControl = null;
        }
        cancelPendingHover();
        hoverCooldowns.clear();
      }
    }
  });

  // Initial flag check
  syncEngineFlag();

} // end of V2_GUARD
