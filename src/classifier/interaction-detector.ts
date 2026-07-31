/**
 * Interaction Detector — Phase 2 Raw Interaction Type Detection
 *
 * Takes a RecordedEvent[] (Phase 1 output) and produces DetectedInteraction[].
 *
 * Two-stage pipeline:
 *   1. EventGrouper — segments raw events into interaction windows
 *   2. TypeClassifier — applies detection rules to classify each window
 *
 * All Tier 1 types are detected deterministically (confidence 1.0).
 * Tier 2 types and anything unmatched → Unknown (confidence 0.0).
 */

import type { RecordedEvent, NavigationRecordedEvent, ElementRecordedEvent } from '../recorder/recorded-event';
import type { ElementIdentity } from '../shared/types';
import type { DetectedInteraction, InteractionType, InteractionMetadata } from './interaction-types';
import { ActionIdGenerator } from '../recorder/action-id';
import { classifyByEvidence } from './evidence/evidence-classifier';

// ════════════════════════════════════════════════════════════════════════
// STAGE 1: EVENT GROUPER
// ════════════════════════════════════════════════════════════════════════

/** A group of events that belong to a single interaction. */
interface EventGroup {
  events: RecordedEvent[];
}

/**
 * Segment raw events into interaction windows.
 *
 * Rules:
 *   1. Navigation events are standalone interactions
 *   2. Element events on the same element within 500ms form one interaction
 *   3. dblclick/contextmenu are standalone
 *   4. scroll events are standalone (already debounced by recorder)
 *   5. dragstart...drop forms one interaction (with any events between on same target)
 *   6. Events on different elements start a new interaction
 */
function groupEvents(events: RecordedEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  let current: EventGroup | null = null;

  for (const event of events) {
    // Navigation events are always standalone
    if (event.eventType === 'navigation') {
      groups.push({ events: [event] });
      current = null;
      continue;
    }

    // Standalone event types — always start a new group
    if (
      event.eventType === 'dblclick' ||
      event.eventType === 'contextmenu' ||
      event.eventType === 'scroll' ||
      event.eventType === 'mouseenter'
    ) {
      // Skip events owned by a date picker — they are evidence-only
      // (scrolls, hovers, clicks inside calendar popovers)
      const domCtx = (event as ElementRecordedEvent).domContext;
      if (domCtx?.ownedByDatePicker) {
        continue; // evidence-only, not a standalone interaction
      }
      groups.push({ events: [event] });
      current = null;
      continue;
    }

    // dragstart starts a new group (will collect drop later)
    if (event.eventType === 'dragstart') {
      groups.push({ events: [event] });
      current = null;
      continue;
    }

    // drop closes a drag group — add to the last group if it was a dragstart
    if (event.eventType === 'drop') {
      // Find the last group with a dragstart
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.events.some((e) => e.eventType === 'dragstart')) {
        lastGroup.events.push(event);
        continue;
      }
      // Standalone drop (no matching dragstart)
      groups.push({ events: [event] });
      current = null;
      continue;
    }

    // Regular element events (click, focus, input, change, blur)
    const elEvent = event as ElementRecordedEvent;
    const targetKey = getIdentityKey(elEvent.target);

    // Skip events owned by a date picker — they are evidence-only
    // (clicks on calendar navigation buttons inside calendar popovers)
    if (elEvent.domContext?.ownedByDatePicker && elEvent.eventType !== 'dateSelect') {
      continue;
    }

    if (current) {
      const lastEvent = current.events[current.events.length - 1];
      const lastElEvent = lastEvent as ElementRecordedEvent;
      const lastKey = lastElEvent.target ? getIdentityKey(lastElEvent.target) : null;
      const timeDiff = new Date(elEvent.timestamp).getTime() - new Date(lastEvent.timestamp).getTime();

      // Determine the grouping window for this element.
      // SELECT dropdowns (tag=SELECT, role=listbox) need a longer window
      // because users browse options for several seconds before choosing.
      // Text-entry elements (INPUT/TEXTAREA with textbox role) need a longer
      // window because the debounced input event fires ~800ms after typing
      // pauses, and blur fires whenever the user moves on — both well beyond
      // the standard 500ms window.
      // Standard window is 500ms; extended window is 30000ms (30s).
      const isSelectElement =
        elEvent.target.tag === 'SELECT' ||
        elEvent.target.ariaRole === 'listbox' ||
        (lastElEvent.target && (lastElEvent.target.tag === 'SELECT' || lastElEvent.target.ariaRole === 'listbox'));
      const isTextEntryElement =
        elEvent.target.ariaRole === 'textbox' ||
        elEvent.target.tag === 'TEXTAREA' ||
        elEvent.target.tag === 'INPUT' ||
        (lastElEvent.target && (lastElEvent.target.ariaRole === 'textbox' || lastElEvent.target.tag === 'TEXTAREA' || lastElEvent.target.tag === 'INPUT'));
      const groupWindow = (isSelectElement || isTextEntryElement) ? 30000 : 500;

      // Continue group if same element AND within window
      if (lastKey === targetKey && timeDiff <= groupWindow) {
        // But NOT if the current group already has a click and this is another click.
        // Each click on the same element is a separate interaction.
        if (event.eventType === 'click' && current.events.some((e) => e.eventType === 'click')) {
          // Start a new group instead
        } else {
          current.events.push(event);
          continue;
        }
      }
    }

    // Start a new group
    current = { events: [event] };
    groups.push(current);
  }

  return groups;
}

/**
 * Get a stable identity key for an element.
 */
function getIdentityKey(identity: ElementIdentity): string {
  return `${identity.tag}|${identity.stableId ?? ''}|${identity.cssSelector ?? ''}`;
}

// ════════════════════════════════════════════════════════════════════════
// STAGE 2: TYPE CLASSIFIER
// ════════════════════════════════════════════════════════════════════════

/**
 * Classify a group of events into an interaction type.
 *
 * The classification order matters — more specific rules are checked first.
 */
function classifyGroup(group: EventGroup): { type: InteractionType; metadata: InteractionMetadata; confidence: number; engine?: string; intent?: import('./evidence/types').SemanticIntent; evidenceTrail?: import('./evidence/types').IntentVote[] } {
  const events = group.events;
  const firstEvent = events[0];

  // ── Navigation ────────────────────────────────────────────────────────

  if (firstEvent.eventType === 'navigation') {
    const nav = firstEvent as NavigationRecordedEvent;
    const transition = nav.transitionType;

    if (transition === 'reload') {
      return {
        type: 'Refresh',
        metadata: { url: nav.url, title: nav.title, transitionType: transition },
        confidence: 1.0,
      };
    }

    if (transition === 'forward') {
      return {
        type: 'Forward',
        metadata: { url: nav.url, title: nav.title, transitionType: transition },
        confidence: 1.0,
      };
    }

    if (transition && transition.includes('forward_back')) {
      return {
        type: 'Back',
        metadata: { url: nav.url, title: nav.title, transitionType: transition },
        confidence: 1.0,
      };
    }

    return {
      type: 'PageNavigation',
      metadata: { url: nav.url, title: nav.title, transitionType: transition },
      confidence: 1.0,
    };
  }

  // ── Scroll ────────────────────────────────────────────────────────────

  if (firstEvent.eventType === 'scroll') {
    const el = firstEvent as ElementRecordedEvent;
    // Page scroll = document/scrollingElement; container = specific element
    const isPageScroll = el.target.tag === 'HTML' || el.target.tag === 'BODY' ||
      el.target.ariaRole === 'document';
    return {
      type: isPageScroll ? 'PageScroll' : 'ContainerScroll',
      metadata: {},
      confidence: 1.0,
    };
  }

  // ── Hover (only fires when DOM mutation detected by recorder) ─────────

  if (firstEvent.eventType === 'mouseenter') {
    return {
      type: 'Hover',
      metadata: {},
      confidence: 1.0,
    };
  }

  // ── Double Click ──────────────────────────────────────────────────────

  if (firstEvent.eventType === 'dblclick') {
    return {
      type: 'DoubleClick',
      metadata: {},
      confidence: 1.0,
    };
  }

  // ── Right Click ───────────────────────────────────────────────────────

  if (firstEvent.eventType === 'contextmenu') {
    return {
      type: 'RightClick',
      metadata: {},
      confidence: 1.0,
    };
  }

  // ── Drag & Drop Upload (file drag-drop, not element drag-drop) ──────────
  //
  // Must come BEFORE the DragDrop section. When files are dragged from the OS
  // into the browser, the drop event carries file data in domContext.fileData.
  // This is a file upload, not an element drag-drop.

  const hasDragStart = events.some((e) => e.eventType === 'dragstart');
  const hasDrop = events.some((e) => e.eventType === 'drop');

  if (hasDrop) {
    const dropEvt = events.find((e) => e.eventType === 'drop') as ElementRecordedEvent | undefined;
    const fileData = dropEvt?.domContext?.fileData;
    if (fileData && fileData.length > 0) {
      const meta: InteractionMetadata = {};
      meta.files = fileData.map(f => f.name);
      meta.fileCount = fileData.length;
      meta.uploadMethod = 'drag-drop';
      if (dropEvt?.domContext?.acceptedFileTypes) {
        meta.acceptedFileTypes = dropEvt.domContext.acceptedFileTypes;
      }
      if (dropEvt) {
        meta.dropTarget = getIdentityKey(dropEvt.target);
      }
      return {
        type: 'DragDropUpload',
        metadata: meta,
        confidence: 1.0,
      };
    }
  }

  // ── Drag & Drop (element drag-drop, not file drag-drop) ────────────────

  if (hasDragStart || hasDrop) {
    const dropEvent = events.find((e) => e.eventType === 'drop') as ElementRecordedEvent | undefined;
    return {
      type: 'DragDrop',
      metadata: dropEvent ? { dropTarget: getIdentityKey(dropEvent.target) } : {},
      confidence: 1.0,
    };
  }

  // ── Element-based interactions (click, focus, input, change, blur) ────

  // Find the primary element from the group
  const target = (firstEvent as ElementRecordedEvent).target;
  const eventTypes = events.map((e) => e.eventType);

  // ── File Upload ───────────────────────────────────────────────────────

  {
    const firstElEvent = events.find(e => e.eventType !== 'navigation') as ElementRecordedEvent | undefined;
    const domCtx = firstElEvent?.domContext;
    if (target.tag === 'INPUT' && isFileInput(target, domCtx)) {
      const meta: InteractionMetadata = {};
      if (domCtx?.fileData && domCtx.fileData.length > 0) {
        meta.files = domCtx.fileData.map(f => f.name);
        meta.fileCount = domCtx.fileData.length;
      }
      if (domCtx?.uploadMethod) meta.uploadMethod = domCtx.uploadMethod;
      if (domCtx?.acceptedFileTypes) meta.acceptedFileTypes = domCtx.acceptedFileTypes;
      if (domCtx?.multipleFiles !== undefined && domCtx?.multipleFiles !== null) {
        meta.multiple = domCtx.multipleFiles;
      }
      return {
        type: 'FileUpload',
        metadata: meta,
        confidence: 1.0,
      };
    }
  }

  // ── Date Picker ────────────────────────────────────────────────────────
  //
  // Must come BEFORE TextEntry (native date inputs have ariaRole='textbox')
  // and BEFORE the Click catch-all (calendar cell clicks are just clicks).
  {
    // Check for dateSelect events first — these carry normalized date metadata
    // from the recorder + service worker normalization pipeline.
    const dateSelectEvent = events.find(e => e.eventType === 'dateSelect') as ElementRecordedEvent | undefined;
    if (dateSelectEvent?.domContext) {
      const domCtx = dateSelectEvent.domContext;
      const dateType = domCtx.dateType ?? 'date';
      const pickerType: InteractionType =
        dateType === 'time' ? 'TimePicker'
        : dateType === 'dateTime' ? 'DateTimePicker'
        : 'DatePicker';
      const dateValue = domCtx.isoValue || domCtx.displayValue || dateSelectEvent.valueAfter || '';
      const meta: InteractionMetadata = {};
      if (dateValue) {
        if (pickerType === 'TimePicker') meta.timeValue = dateValue;
        else if (pickerType === 'DateTimePicker') meta.dateTimeValue = dateValue;
        else meta.dateValue = dateValue;
      }
      if (domCtx.displayValue) meta.displayValue = domCtx.displayValue;
      if (domCtx.dateAmbiguous) meta.dateAmbiguous = domCtx.dateAmbiguous;
      return {
        type: pickerType,
        metadata: meta,
        confidence: domCtx.dateConfidence ?? 1.0,
      };
    }

    const dpResult = tryClassifyDatePicker(target, events, eventTypes);
    if (dpResult) return dpResult;
  }

  // ── Slider ───────────────────────────────────────────────────────────
  //
  // Must come BEFORE TextEntry (native range inputs are INPUT tags that
  // would otherwise be classified as text entry).

  {
    const eventWithDomCtx = events.find(e => e.eventType !== 'navigation') as ElementRecordedEvent | undefined;
    const inputType = eventWithDomCtx?.domContext?.inputType;
    if (target.ariaRole === 'slider' ||
        inputType === 'range' ||
        (target.cssSelector && /type=["']?range["']?/i.test(target.cssSelector))) {
      const changeEvent = events.find((e) => e.eventType === 'change' || e.eventType === 'input') as ElementRecordedEvent | undefined;
      const sliderValue = changeEvent?.valueAfter ?? (events.find((e) => e.eventType === 'blur') as ElementRecordedEvent | undefined)?.valueAfter ?? '';
      const dCtx = eventWithDomCtx?.domContext;
      // For custom sliders, value may come from captureValue (aria-valuenow)
      const sliderValueFinal = sliderValue || dCtx?.ariaValueText || dCtx?.ariaValueNow || '';
      const sliderMin = dCtx?.ariaValueMin || dCtx?.nativeMin || '';
      const sliderMax = dCtx?.ariaValueMax || dCtx?.nativeMax || '';
      return {
        type: 'Slider',
        metadata: {
          ...(sliderValueFinal ? { sliderValue: sliderValueFinal } : {}),
          ...(sliderMin ? { sliderMin } : {}),
          ...(sliderMax ? { sliderMax } : {}),
        },
        confidence: 1.0,
      };
    }
  }

  // ── Text Entry ────────────────────────────────────────────────────────

  if (isTextInput(target) && (eventTypes.includes('input') || eventTypes.includes('focus') || eventTypes.includes('blur'))) {
    // Text entry = focus → (typing, no intermediate input events) → blur
    // The recorder suppresses intermediate input events for text typing;
    // the full value transition is captured by focus (valueBefore) and
    // blur (valueAfter). Read the final value from whichever event has it.
    const lastChangeEvent = [...events].reverse().find((e) =>
      e.eventType === 'input' || e.eventType === 'change'
    ) as ElementRecordedEvent | undefined;

    // If no input event, read textValue from blur's valueAfter
    const blurEvent = events.find((e) => e.eventType === 'blur') as ElementRecordedEvent | undefined;

    const textValue = lastChangeEvent?.valueAfter
      ?? blurEvent?.valueAfter
      ?? lastChangeEvent?.valueBefore
      ?? null;

    return {
      type: 'TextEntry',
      metadata: textValue !== null ? { textValue } : {},
      confidence: 1.0,
    };
  }

  // ── Native Dropdown (select element) ──────────────────────────────────

  if (target.tag === 'SELECT' || target.ariaRole === 'listbox') {
    const changeEvent = events.find((e) => e.eventType === 'change') as ElementRecordedEvent | undefined;
    const selectedValue = changeEvent?.valueAfter ?? null;
    return {
      type: 'NativeDropdown',
      metadata: selectedValue !== null ? { selectedValue } : {},
      confidence: 1.0,
    };
  }

  // ── Checkbox ──────────────────────────────────────────────────────────

  if (target.ariaRole === 'checkbox') {
    const clickEvent = events.find((e) => e.eventType === 'click') as ElementRecordedEvent | undefined;
    const checked = clickEvent?.checkedAfter ?? clickEvent?.checkedBefore ?? null;
    return {
      type: 'Checkbox',
      metadata: checked !== null ? { checked } : {},
      confidence: 1.0,
    };
  }

  // ── Radio Button ──────────────────────────────────────────────────────

  if (target.ariaRole === 'radio') {
    const clickEvent = events.find((e) => e.eventType === 'click') as ElementRecordedEvent | undefined;
    const checked = clickEvent?.checkedAfter ?? clickEvent?.checkedBefore ?? null;
    return {
      type: 'RadioButton',
      metadata: {
        ...(checked !== null ? { checked } : {}),
        ...(target.accessibleName ? { selectedValue: target.accessibleName } : {}),
      },
      confidence: 1.0,
    };
  }

  // ── Toggle Switch ─────────────────────────────────────────────────────

  if (target.ariaRole === 'switch' || target.ariaRole === 'button') {
    // Check for aria-pressed or aria-checked on a role=button or role=switch
    const clickEvent = events.find((e) => e.eventType === 'click') as ElementRecordedEvent | undefined;
    if (clickEvent && clickEvent.checkedAfter !== null) {
      return {
        type: 'ToggleSwitch',
        metadata: { checked: clickEvent.checkedAfter },
        confidence: 1.0,
      };
    }
  }

  // ── Breadcrumb ────────────────────────────────────────────────────────
  //
  // Checked BEFORE Link so breadcrumb clicks get the more specific
  // Breadcrumb type instead of falling through to generic Link.

  {
    const className = (target.className || '').toLowerCase();
    if (className.includes('breadcrumb') || className.includes('crumb')) {
      return {
        type: 'Breadcrumb',
        metadata: { accessibleName: target.accessibleName ?? undefined },
        confidence: 1.0,
      };
    }
  }

  // ── Tab ───────────────────────────────────────────────────────────────

  if (target.ariaRole === 'tab') {
    return {
      type: 'Tab',
      metadata: target.accessibleName ? { selectedTab: target.accessibleName } : {},
      confidence: 1.0,
    };
  }

  // ── Menu ──────────────────────────────────────────────────────────────

  if (target.ariaRole === 'menuitem' ||
      target.ariaRole === 'menuitemcheckbox' ||
      target.ariaRole === 'menuitemradio') {
    return {
      type: 'Menu',
      metadata: { accessibleName: target.accessibleName ?? undefined },
      confidence: 1.0,
    };
  }

  // Navigation menu items detected via CSS class (navbar, sidebar, nav-menu)
  {
    const cls = (target.className || '').toLowerCase();
    if (cls.includes('navbar-item') || cls.includes('sidebar-item') ||
        cls.includes('menu-link') || cls.includes('nav-menu')) {
      return {
        type: 'Menu',
        metadata: { accessibleName: target.accessibleName ?? undefined },
        confidence: 0.9,
      };
    }
  }

  // ── Browser Alert (native alert/confirm/prompt) ────────────────────────
  //
  // When a click triggers window.alert/confirm/prompt, the content script
  // captures the dialog info in domContext.triggeredDialog. This must be
  // checked before Link and Default Click so the interaction type is
  // BrowserAlert, not a generic Click/Link.

  {
    const clickEvt = events.find(e => e.eventType === 'click') as ElementRecordedEvent | undefined;
    const dialog = clickEvt?.domContext?.triggeredDialog;
    if (dialog) {
      const meta: InteractionMetadata = {
        dialogType: dialog,
        dialogMessage: clickEvt?.domContext?.dialogMessage ?? undefined,
        dialogResult: clickEvt?.domContext?.dialogResult ?? undefined,
      };
      return { type: 'BrowserAlert', metadata: meta, confidence: 1.0 };
    }
  }

  // ── New Tab / New Window ──────────────────────────────────────────────
  //
  // When a click opens a new tab (target=_blank or window.open without
  // features) or new window (window.open with width/height features),
  // the content script captures this in domContext.opensNewTab /
  // opensNewWindow. Must be checked before Link (so a target=_blank
  // link → NewTab, not Link) and before Default Click.

  {
    const clickEvt = events.find(e => e.eventType === 'click') as ElementRecordedEvent | undefined;
    const ctx = clickEvt?.domContext;

    if (ctx?.opensNewWindow) {
      const meta: InteractionMetadata = {};
      if (ctx.openedUrl) meta.openedUrl = ctx.openedUrl;
      if (target.accessibleName) meta.accessibleName = target.accessibleName;
      return { type: 'NewWindow', metadata: meta, confidence: 1.0 };
    }

    if (ctx?.opensNewTab) {
      const meta: InteractionMetadata = {};
      if (ctx.openedUrl) meta.openedUrl = ctx.openedUrl;
      if (target.accessibleName) meta.accessibleName = target.accessibleName;
      return { type: 'NewTab', metadata: meta, confidence: 1.0 };
    }
  }

  // ── Evidence-Based Classification (ambiguous cases) ───────────────────
  //
  // At this point, all unambiguous fast-path rules have been exhausted
  // (Navigation, DatePicker, Slider, TextEntry, Checkbox, RadioButton,
  // ToggleSwitch, FileUpload, etc.). What remains is the ambiguous decision:
  // Link vs Checkbox vs Click. These look the same in the DOM (click on a
  // generic element) but have different semantic intents.
  //
  // The evidence engine collects multiple weak signals and fuses them:
  //   - aria-checked → toggle
  //   - checked transition → toggle
  //   - <a> tag → navigate
  //   - CSS class patterns → toggle/navigate
  //   - opens new tab → navigate
  //
  // This replaces the old priority-ordered safety net + Link + Click chain
  // with a single evidence-based decision.

  {
    const clickEvent = events.find((e) => e.eventType === 'click') as ElementRecordedEvent | undefined;
    if (clickEvent) {
      // Phase 2: classifyByEvidence now expects ObservedEvent (Component Runtime type).
      // This V1 fallback code is dead — production uses the annotation layer instead.
      // The cast preserves backward compatibility for the V1 tests still referencing this path.
      const result = classifyByEvidence(target, clickEvent as unknown as import('../shared/component-types').ObservedEvent);
      return {
        type: result.type,
        metadata: result.metadata,
        confidence: result.confidence,
        engine: 'evidence',
        intent: result.intent,
        evidenceTrail: result.evidence,
      };
    }
  }

  // ── Default Click ─────────────────────────────────────────────────────
  // Fallback for events that aren't clicks (e.g., contextmenu without
  // a prior right-click handler producing its own classification)

  if (eventTypes.includes('click')) {
    return {
      type: 'Click',
      metadata: { accessibleName: target.accessibleName ?? undefined },
      confidence: 1.0,
    };
  }

  // ── Unknown ───────────────────────────────────────────────────────────

  return {
    type: 'Unknown',
    metadata: {},
    confidence: 0.0,
  };
}

// ── Element Type Helpers ────────────────────────────────────────────────

/**
 * Determine if an element is a text input based on identity fields.
 * Since content scripts capture identity at event time, we infer from
 * tag + ariaRole + className/name patterns.
 */
function isTextInput(identity: ElementIdentity): boolean {
  if (identity.tag === 'TEXTAREA') return true;
  if (identity.ariaRole === 'textbox') return true;
  if (identity.ariaRole === 'spinbutton') return true;
  if (identity.ariaRole === 'searchbox') return true;
  // contenteditable
  if (identity.tag === 'DIV' && identity.ariaRole === 'textbox') return true;
  // INPUT tag that is NOT checkbox/radio/file/submit/button/range/color/image = text-like
  if (identity.tag === 'INPUT') {
    const nonTextRoles = ['checkbox', 'radio', 'button', 'slider'];
    if (nonTextRoles.includes(identity.ariaRole ?? '')) return false;
    // Otherwise, it's a text input (text, email, password, search, number, tel, url, date, time, etc.)
    return true;
  }
  return false;
}

function isFileInput(identity: ElementIdentity, domCtx?: { inputType: string | null }): boolean {
  // Prefer first-class inputType from DomContext
  if (domCtx?.inputType === 'file') return true;
  const cssSel = identity.cssSelector ?? '';
  if (/type=["']?file["']?/i.test(cssSel)) return true;
  const nameOrClass = `${identity.name ?? ''} ${identity.className ?? ''}`.toLowerCase();
  return nameOrClass.includes('file') || nameOrClass.includes('upload');
}

// ── Date Picker Detection ────────────────────────────────────────────────

/**
 * Keywords that indicate an element is related to date/time selection.
 * Checked against placeholder, name, id, className, aria-label.
 *
 * Uses [^a-z] delimiters instead of \b because underscores (common in
 * name/id attributes like "arrival_date") are word characters that \b
 * won't split on.
 */
const DATE_KEYWORDS = /(?:^|[^a-z])(date|depart|arrival|return|check.?in|check.?out|from.?date|to.?date|travel|journey|trip|fly|calendar|checkin|checkout)(?:[^a-z]|$)/i;

/**
 * Patterns that match human-readable date values (display formats).
 * Catches "Mon, 20 Jul", "20 July 2026", "20/07/2026", "July 15", etc.
 */
const DATE_VALUE_PATTERNS = [
  // "Mon, 20 Jul" / "Monday, July 20th" / "Tue, 08 Sep"
  /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,]?\s+\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
  // "20 July 2026" / "July 15, 2026"
  /\b\d{0,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2},?\s*\d{0,4}/i,
  // "20/07/2026" / "07-18-2026"
  /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/,
  // "Monday, July 20th, 2026" (Adani One format with ordinal)
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(st|nd|rd|th)?,?\s*\d{4}/i,
];

/**
 * CSS selector patterns that indicate a native date/time input.
 * The recorder captures cssSelector for every element.
 */
const NATIVE_DATE_INPUT_PATTERN = /input\[type\s*=\s*["']?(date|datetime-local|time|month|week)["']?\s*\]/i;

/**
 * Class/attribute patterns that indicate a calendar container or cell.
 * Checked against the element's own className and cssSelector.
 */
const CALENDAR_CONTAINER_PATTERN = /(calendar|datepicker|date-picker|date_picker|role\s*=\s*["']?grid["']?|role\s*=\s*["']?gridcell["']?|data-date|data-day)/i;

/**
 * Check if an element identity indicates a date picker interaction.
 *
 * Three detection paths:
 *   A. Native date input (input[type=date] etc.) with a change event
 *   B. Calendar grid cell click (element inside a calendar container)
 *   C. Date-like text input with a date-format value change
 *
 * Returns a classification result or null (not a date picker).
 */
function tryClassifyDatePicker(
  target: ElementIdentity,
  events: RecordedEvent[],
  eventTypes: string[],
): { type: InteractionType; metadata: InteractionMetadata; confidence: number } | null {

  // ── Path A: Native date/time input (input[type=date], etc.) ────────────
  //
  // These have ariaRole='textbox' from INPUT_TYPE_ROLE_MAP but are identifiable
  // via cssSelector (e.g. 'input[type="date"]#departure').
  const cssSel = target.cssSelector ?? '';
  if (NATIVE_DATE_INPUT_PATTERN.test(cssSel)) {
    const changeEvent = events.find((e) => e.eventType === 'change') as ElementRecordedEvent | undefined;
    const dateValue = changeEvent?.valueAfter
      ?? changeEvent?.valueBefore
      ?? target.accessibleName
      ?? null;

    // Determine sub-type from the input type
    const typeMatch = cssSel.match(/type\s*=\s*["']?([\w-]+)/i);
    const inputType = typeMatch?.[1]?.toLowerCase() ?? 'date';
    const pickerType: InteractionType =
      inputType === 'time' ? 'TimePicker'
      : inputType === 'datetime-local' ? 'DateTimePicker'
      : 'DatePicker';

    return {
      type: pickerType,
      metadata: dateValue
        ? pickerType === 'TimePicker'
          ? { timeValue: dateValue.toString() }
          : pickerType === 'DateTimePicker'
            ? { dateTimeValue: dateValue.toString() }
            : { dateValue: dateValue.toString() }
        : {},
      confidence: 1.0,
    };
  }

  // ── Path B: Calendar grid cell click ───────────────────────────────────
  //
  // The clicked element is inside a calendar container. We detect this from
  // the element's own className/cssSelector/ariaRole — the recorder captures
  // these at click time. This handles React date pickers, Flatpickr,
  // custom calendar widgets, and the Adani One flight booking calendar.
  if (eventTypes.includes('click')) {
    const hasCalendarContainer =
      CALENDAR_CONTAINER_PATTERN.test(target.className ?? '') ||
      CALENDAR_CONTAINER_PATTERN.test(cssSel) ||
      target.ariaRole === 'gridcell';

    if (hasCalendarContainer) {
      // Extract the date value from accessible name or aria-label
      const dateValue = target.ariaLabel ?? target.accessibleName ?? null;

      return {
        type: 'DatePicker',
        metadata: dateValue ? { dateValue } : {},
        confidence: 1.0,
      };
    }
  }

  // ── Path C: Date-like text input with date value change ────────────────
  //
  // Text inputs whose placeholder/name/id/class contains date keywords
  // (e.g. placeholder="Depart on") and whose value changed to a date-like
  // format. This catches custom date pickers that write to regular text inputs.
  if (target.tag === 'INPUT' && (eventTypes.includes('change') || eventTypes.includes('input'))) {
    const combinedAttrs = `${target.placeholder ?? ''} ${target.name ?? ''} ${target.stableId ?? ''} ${target.className ?? ''} ${target.ariaLabel ?? ''}`;
    const isDateField = DATE_KEYWORDS.test(combinedAttrs);

    if (isDateField) {
      // Check if the value looks like a date
      const changeEvent = events.find((e) =>
        e.eventType === 'change' || e.eventType === 'input'
      ) as ElementRecordedEvent | undefined;
      const value = changeEvent?.valueAfter ?? changeEvent?.valueBefore ?? '';

      if (value && DATE_VALUE_PATTERNS.some((p) => p.test(value))) {
        return {
          type: 'DatePicker',
          metadata: { dateValue: value },
          confidence: 0.9,
        };
      }
    }
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═════════════════════════════════════════════════════ sequentially numbered
// ════════════════════════════════════════════════════════════════════════

/**
 * Extract surface context from a group of events.
 *
 * The content script captures DomContext.surfaceType/surfaceLabel/surfaceRole
 * when a surface (popover, drawer, modal) appears after a click. This function
 * propagates that information into DetectedInteraction.metadata.surfaceContext
 * so the SemanticReasoner can use it for multiConfig activation/absorption.
 *
 * @param events  The events in the interaction group
 * @returns       Surface context object, or null if no surface info present
 */
function extractSurfaceContext(
  events: RecordedEvent[],
): InteractionMetadata['surfaceContext'] {
  for (const event of events) {
    const elEvent = event as ElementRecordedEvent;
    const domCtx = elEvent.domContext;
    if (!domCtx) continue;

    // surfaceType on an event means THIS interaction caused the surface to appear
    if (domCtx.surfaceType) {
      return {
        type: domCtx.surfaceType,
        label: domCtx.surfaceLabel ?? undefined,
        role: domCtx.surfaceRole ?? undefined,
        openedByThisInteraction: true,
      };
    }
  }
  return null;
}

/**
 * Detect interactions from a list of recorded events.
 *
 * @param events The raw events from a recording session
 * @returns An ordered list of detected interactions
 */
export function detectInteractions(events: RecordedEvent[]): DetectedInteraction[] {
  const idGen = new ActionIdGenerator('int', 0);
  const groups = groupEvents(events);

  return groups.map((group) => {
    const { type, metadata, confidence, engine, intent, evidenceTrail } = classifyGroup(group);
    const firstEvent = group.events[0];
    const target = firstEvent.eventType === 'navigation'
      ? undefined
      : (firstEvent as ElementRecordedEvent).target;

    // ── Iframe enrichment ──
    // If the interaction occurred inside an iframe, enrich the metadata with
    // iframe context. This does NOT change the interaction type — a click
    // inside an iframe is still a Click, just with iframe metadata.
    if (target?.inIframe && target.iframeContext) {
      const iframeCtx = target.iframeContext;
      metadata.iframeSrc = iframeCtx.frameSrc;
      metadata.iframeName = iframeCtx.frameName ?? undefined;
      metadata.iframeDepth = iframeCtx.frameDepth;
    }

    // ── Surface Context Propagation ──
    // Propagate surface evidence from DomContext into metadata.surfaceContext
    // so the SemanticReasoner can use it for multiConfig activation/absorption.
    const surfaceContext = extractSurfaceContext(group.events);
    if (surfaceContext) {
      metadata.surfaceContext = surfaceContext;
    }

    return {
      interactionId: idGen.next(),
      type,
      eventIds: group.events.map((e) => e.eventId),
      rawEventTypes: group.events.map((e) => e.eventType),
      target,
      metadata,
      confidence,
      ...(engine ? { engine } : {}),
      ...(intent ? { intent } : {}),
      ...(evidenceTrail ? { evidenceTrail } : {}),
    };
  });
}
