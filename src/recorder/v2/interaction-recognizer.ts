/**
 * Interaction Recognizer — Stage 3 New Classifier (Control Engine)
 *
 * Replaces the V1 (interaction-detector.ts) + V2 (evidence/detector.ts) +
 * merge-layer.ts pipeline with a single deterministic classifier that:
 *   1. Groups events into interaction windows (same-element, temporal proximity)
 *   2. Classifies each group using an ordered rule cascade
 *   3. Applies temporal dedup (2s per-type window)
 *
 * Produces `DetectedInteraction[]` identical in shape to the existing classifiers
 * so all downstream consumers (pipeline-runner, IR bridge, Playwright generator,
 * side panel) work unchanged.
 *
 * Classification is deterministic (confidence = 1.0 for matched types).
 * Unmatched events → Unknown (confidence 0.0).
 */

import type { RecordedEvent, NavigationRecordedEvent, ElementRecordedEvent } from '../../recorder/recorded-event';
import type { ElementIdentity } from '../../shared/types';
import type { DetectedInteraction, InteractionType, InteractionMetadata } from '../../classifier/interaction-types';
import { ActionIdGenerator } from '../../recorder/action-id';
import { classifyByEvidence } from '../../classifier/evidence/evidence-classifier';

// ════════════════════════════════════════════════════════════════════════
// STAGE 1: EVENT GROUPER
// ════════════════════════════════════════════════════════════════════════

interface EventGroup {
  events: RecordedEvent[];
}

/**
 * Segment raw events into interaction windows.
 *
 * Rules:
 *   1. Navigation events are standalone
 *   2. dateSelect events are standalone (they represent the final committed value)
 *   3. dblclick/contextmenu/scroll/mouseenter are standalone
 *      (unless owned by a date picker — those are evidence-only, skipped)
 *   4. dragstart...drop forms one group
 *   5. Same-element events within 500ms (30s for text/select) form one group
 *   6. Each click on the same element starts a new group (each click is distinct)
 */
function groupEvents(events: RecordedEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  let current: EventGroup | null = null;

  for (const event of events) {
    // Navigation = standalone
    if (event.eventType === 'navigation') {
      groups.push({ events: [event] });
      current = null;
      continue;
    }

    // dateSelect = standalone (final committed date value)
    if (event.eventType === 'dateSelect') {
      groups.push({ events: [event] });
      current = null;
      continue;
    }

    // Standalone event types
    if (
      event.eventType === 'dblclick' ||
      event.eventType === 'contextmenu' ||
      event.eventType === 'scroll' ||
      event.eventType === 'mouseenter'
    ) {
      // Skip events inside calendar popovers — evidence-only
      const domCtx = (event as ElementRecordedEvent).domContext;
      if (domCtx?.ownedByDatePicker) continue;
      groups.push({ events: [event] });
      current = null;
      continue;
    }

    // dragstart starts a new group
    if (event.eventType === 'dragstart') {
      groups.push({ events: [event] });
      current = null;
      continue;
    }

    // drop closes a drag group
    if (event.eventType === 'drop') {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.events.some((e) => e.eventType === 'dragstart')) {
        lastGroup.events.push(event);
        continue;
      }
      groups.push({ events: [event] });
      current = null;
      continue;
    }

    // Regular element events (click, focus, input, change, blur)
    const elEvent = event as ElementRecordedEvent;
    const targetKey = getIdentityKey(elEvent.target);

    // Skip events inside calendar popovers (evidence-only)
    if (elEvent.domContext?.ownedByDatePicker) continue;

    if (current) {
      const lastEvent = current.events[current.events.length - 1];
      const lastElEvent = lastEvent as ElementRecordedEvent;
      const lastKey = lastElEvent.target ? getIdentityKey(lastElEvent.target) : null;
      const timeDiff = new Date(elEvent.timestamp).getTime() - new Date(lastEvent.timestamp).getTime();

      // Extended window for SELECT and text-entry elements
      const isSelectElement =
        elEvent.target.tag === 'SELECT' ||
        elEvent.target.ariaRole === 'listbox' ||
        (lastElEvent.target && (lastElEvent.target.tag === 'SELECT' || lastElEvent.target.ariaRole === 'listbox'));
      const isTextEntryElement =
        elEvent.target.ariaRole === 'textbox' ||
        elEvent.target.tag === 'TEXTAREA' ||
        elEvent.target.tag === 'INPUT' ||
        (lastElEvent.target && (lastElEvent.target.ariaRole === 'textbox' || lastElEvent.target.tag === 'TEXTAREA' || lastElEvent.target.tag === 'INPUT'));
      const groupWindow = isSelectElement || isTextEntryElement ? 30000 : 500;

      // Continue group if same element AND within window
      if (lastKey === targetKey && timeDiff <= groupWindow) {
        // Each click on same element = separate interaction
        if (event.eventType === 'click' && current.events.some((e) => e.eventType === 'click')) {
          // Fall through to start a new group
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

function getIdentityKey(identity: ElementIdentity): string {
  return `${identity.tag}|${identity.stableId ?? ''}|${identity.cssSelector ?? ''}`;
}

// ════════════════════════════════════════════════════════════════════════
// STAGE 2: TYPE CLASSIFIER
// ════════════════════════════════════════════════════════════════════════

interface ClassifyResult {
  type: InteractionType;
  metadata: InteractionMetadata;
  confidence: number;
  engine?: string;
  intent?: import('../../classifier/evidence/types').SemanticIntent;
  evidenceTrail?: import('../../classifier/evidence/types').IntentVote[];
}

/**
 * Classify a group of events into an interaction type.
 *
 * Ordered cascade — more specific rules checked first.
 */
function classifyGroup(group: EventGroup): ClassifyResult {
  const events = group.events;
  const firstEvent = events[0];

  // ── Navigation ────────────────────────────────────────────────────────

  if (firstEvent.eventType === 'navigation') {
    const nav = firstEvent as NavigationRecordedEvent;
    const transition = nav.transitionType;

    if (transition === 'reload') {
      return { type: 'Refresh', metadata: { url: nav.url, title: nav.title, transitionType: transition }, confidence: 1.0 };
    }
    if (transition === 'forward') {
      return { type: 'Forward', metadata: { url: nav.url, title: nav.title, transitionType: transition }, confidence: 1.0 };
    }
    if (transition && transition.includes('forward_back')) {
      return { type: 'Back', metadata: { url: nav.url, title: nav.title, transitionType: transition }, confidence: 1.0 };
    }
    return { type: 'PageNavigation', metadata: { url: nav.url, title: nav.title, transitionType: transition }, confidence: 1.0 };
  }

  // ── Date Picker (dateSelect events — carry normalized metadata) ───────
  {
    const dateSelectEvent = events.find((e) => e.eventType === 'dateSelect') as ElementRecordedEvent | undefined;
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

      return { type: pickerType, metadata: meta, confidence: domCtx.dateConfidence ?? 1.0 };
    }
  }

  // ── Scroll ────────────────────────────────────────────────────────────

  if (firstEvent.eventType === 'scroll') {
    const el = firstEvent as ElementRecordedEvent;
    const isPageScroll = el.target.tag === 'HTML' || el.target.tag === 'BODY' || el.target.ariaRole === 'document';
    return { type: isPageScroll ? 'PageScroll' : 'ContainerScroll', metadata: {}, confidence: 1.0 };
  }

  // ── Hover ─────────────────────────────────────────────────────────────

  if (firstEvent.eventType === 'mouseenter') {
    return { type: 'Hover', metadata: {}, confidence: 1.0 };
  }

  // ── Double Click / Right Click ────────────────────────────────────────

  if (firstEvent.eventType === 'dblclick') {
    return { type: 'DoubleClick', metadata: {}, confidence: 1.0 };
  }
  if (firstEvent.eventType === 'contextmenu') {
    return { type: 'RightClick', metadata: {}, confidence: 1.0 };
  }

  // ── Drag & Drop / Drag-Drop Upload ────────────────────────────────────

  const hasDragStart = events.some((e) => e.eventType === 'dragstart');
  const hasDrop = events.some((e) => e.eventType === 'drop');

  if (hasDrop) {
    const dropEvt = events.find((e) => e.eventType === 'drop') as ElementRecordedEvent | undefined;
    const fileData = dropEvt?.domContext?.fileData;
    if (fileData && fileData.length > 0) {
      const meta: InteractionMetadata = {
        files: fileData.map((f) => f.name),
        fileCount: fileData.length,
        uploadMethod: 'drag-drop',
      };
      if (dropEvt?.domContext?.acceptedFileTypes) meta.acceptedFileTypes = dropEvt.domContext.acceptedFileTypes;
      if (dropEvt) meta.dropTarget = getIdentityKey(dropEvt.target);
      return { type: 'DragDropUpload', metadata: meta, confidence: 1.0 };
    }
  }
  if (hasDragStart || hasDrop) {
    const dropEvent = events.find((e) => e.eventType === 'drop') as ElementRecordedEvent | undefined;
    return { type: 'DragDrop', metadata: dropEvent ? { dropTarget: getIdentityKey(dropEvent.target) } : {}, confidence: 1.0 };
  }

  // ── Element-based interactions ────────────────────────────────────────

  const target = (firstEvent as ElementRecordedEvent).target;
  const eventTypes = events.map((e) => e.eventType);
  const firstElEvent = events.find((e) => e.eventType !== 'navigation') as ElementRecordedEvent | undefined;
  const domCtx = firstElEvent?.domContext;

  // ── File Upload ───────────────────────────────────────────────────────

  if (target.tag === 'INPUT' && isFileInput(target, domCtx)) {
    const meta: InteractionMetadata = {};
    if (domCtx?.fileData && domCtx.fileData.length > 0) {
      meta.files = domCtx.fileData.map((f) => f.name);
      meta.fileCount = domCtx.fileData.length;
    }
    if (domCtx?.uploadMethod) meta.uploadMethod = domCtx.uploadMethod;
    if (domCtx?.acceptedFileTypes) meta.acceptedFileTypes = domCtx.acceptedFileTypes;
    if (domCtx?.multipleFiles !== undefined && domCtx?.multipleFiles !== null) meta.multiple = domCtx.multipleFiles;
    return { type: 'FileUpload', metadata: meta, confidence: 1.0 };
  }

  // ── Slider (must come before TextEntry — range inputs are INPUT tags) ──

  {
    const inputType = domCtx?.inputType;
    if (target.ariaRole === 'slider' || inputType === 'range' || (target.cssSelector && /type=["']?range["']?/i.test(target.cssSelector))) {
      const changeEvent = events.find((e) => e.eventType === 'change' || e.eventType === 'input') as ElementRecordedEvent | undefined;
      const blurEvent = events.find((e) => e.eventType === 'blur') as ElementRecordedEvent | undefined;
      const sliderValue =
        changeEvent?.valueAfter
        ?? blurEvent?.valueAfter
        ?? domCtx?.ariaValueText
        ?? domCtx?.ariaValueNow
        ?? '';
      const sliderMin = domCtx?.ariaValueMin || domCtx?.nativeMin || '';
      const sliderMax = domCtx?.ariaValueMax || domCtx?.nativeMax || '';
      return {
        type: 'Slider',
        metadata: {
          ...(sliderValue ? { sliderValue } : {}),
          ...(sliderMin ? { sliderMin } : {}),
          ...(sliderMax ? { sliderMax } : {}),
        },
        confidence: 1.0,
      };
    }
  }

  // ── Text Entry ────────────────────────────────────────────────────────

  if (isTextInput(target) && (eventTypes.includes('input') || eventTypes.includes('focus') || eventTypes.includes('blur'))) {
    // Read the final committed value from change/input events, or from blur
    const lastChangeEvent = [...events].reverse().find((e) => e.eventType === 'input' || e.eventType === 'change') as ElementRecordedEvent | undefined;
    const blurEvent = events.find((e) => e.eventType === 'blur') as ElementRecordedEvent | undefined;
    const textValue = lastChangeEvent?.valueAfter ?? blurEvent?.valueAfter ?? lastChangeEvent?.valueBefore ?? null;

    return { type: 'TextEntry', metadata: textValue !== null ? { textValue } : {}, confidence: 1.0 };
  }

  // ── Native Dropdown (select element) ──────────────────────────────────

  if (target.tag === 'SELECT' || target.ariaRole === 'listbox') {
    const changeEvent = events.find((e) => e.eventType === 'change') as ElementRecordedEvent | undefined;
    const selectedValue = changeEvent?.valueAfter ?? null;
    return { type: 'NativeDropdown', metadata: selectedValue !== null ? { selectedValue } : {}, confidence: 1.0 };
  }

  // ── Custom Dropdown (combobox — OXD, MUI, Ant, etc.) ──────────────────
  //
  // Custom dropdowns are DIV-based comboboxes. The Control Model resolves
  // clicks to the combobox container (role=combobox). Detection:
  //   - ariaRole === 'combobox' OR className contains 'select'/'dropdown'
  //   - Has a change event or click with aria-expanded
  {
    const isCombobox =
      target.ariaRole === 'combobox' ||
      (target.className && /\b(select|dropdown|oxd-select)\b/i.test(target.className)) ||
      (domCtx?.ariaHasPopup === 'listbox') ||
      (domCtx?.ariaExpanded !== null && domCtx?.ariaExpanded !== undefined);
    const hasValueChange = eventTypes.includes('change') || firstElEvent?.valueAfter;
    const hasClick = eventTypes.includes('click');

    if (isCombobox && (hasValueChange || hasClick)) {
      // Extract selected value from the change event or the element's value
      const changeEvent = events.find((e) => e.eventType === 'change') as ElementRecordedEvent | undefined;
      const selectedValue =
        changeEvent?.valueAfter
        ?? firstElEvent?.valueAfter
        ?? target.accessibleName
        ?? null;

      // If we can't extract a value, still classify as CustomDropdown (the click
      // opened it) — downstream enrichment may fill in the value from later events.
      return {
        type: 'CustomDropdown',
        metadata: selectedValue !== null ? { selectedValue } : {},
        confidence: 0.9,
      };
    }
  }

  // ── Checkbox ──────────────────────────────────────────────────────────

  if (target.ariaRole === 'checkbox') {
    const clickEvent = events.find((e) => e.eventType === 'click') as ElementRecordedEvent | undefined;
    const checked = clickEvent?.checkedAfter ?? clickEvent?.checkedBefore ?? null;
    return { type: 'Checkbox', metadata: checked !== null ? { checked } : {}, confidence: 1.0 };
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
    const clickEvent = events.find((e) => e.eventType === 'click') as ElementRecordedEvent | undefined;
    if (clickEvent && clickEvent.checkedAfter !== null) {
      return { type: 'ToggleSwitch', metadata: { checked: clickEvent.checkedAfter }, confidence: 1.0 };
    }
  }

  // ── Breadcrumb ────────────────────────────────────────────────────────

  {
    const className = (target.className || '').toLowerCase();
    if (className.includes('breadcrumb') || className.includes('crumb')) {
      return { type: 'Breadcrumb', metadata: { accessibleName: target.accessibleName ?? undefined }, confidence: 1.0 };
    }
  }

  // ── Tab ───────────────────────────────────────────────────────────────

  if (target.ariaRole === 'tab') {
    return { type: 'Tab', metadata: target.accessibleName ? { selectedTab: target.accessibleName } : {}, confidence: 1.0 };
  }

  // ── Menu ──────────────────────────────────────────────────────────────

  if (target.ariaRole === 'menuitem' || target.ariaRole === 'menuitemcheckbox' || target.ariaRole === 'menuitemradio') {
    return { type: 'Menu', metadata: { accessibleName: target.accessibleName ?? undefined }, confidence: 1.0 };
  }

  // Navigation menu items via CSS class
  {
    const cls = (target.className || '').toLowerCase();
    if (cls.includes('navbar-item') || cls.includes('sidebar-item') || cls.includes('menu-link') || cls.includes('nav-menu')) {
      return { type: 'Menu', metadata: { accessibleName: target.accessibleName ?? undefined }, confidence: 0.9 };
    }
  }

  // ── Browser Alert ─────────────────────────────────────────────────────

  {
    const clickEvt = events.find((e) => e.eventType === 'click') as ElementRecordedEvent | undefined;
    const dialog = clickEvt?.domContext?.triggeredDialog;
    if (dialog) {
      return {
        type: 'BrowserAlert',
        metadata: {
          dialogType: dialog,
          dialogMessage: clickEvt?.domContext?.dialogMessage ?? undefined,
          dialogResult: clickEvt?.domContext?.dialogResult ?? undefined,
        },
        confidence: 1.0,
      };
    }
  }

  // ── New Tab / New Window ──────────────────────────────────────────────

  {
    const clickEvt = events.find((e) => e.eventType === 'click') as ElementRecordedEvent | undefined;
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
  // All unambiguous fast-path rules exhausted. Delegate the Link vs Checkbox
  // vs Click decision to the evidence engine, which fuses multiple weak
  // signals into a confident classification.

  {
    const clickEvent = events.find((e) => e.eventType === 'click') as ElementRecordedEvent | undefined;
    if (clickEvent) {
      const result = classifyByEvidence(target, clickEvent);
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

  if (eventTypes.includes('click')) {
    return { type: 'Click', metadata: { accessibleName: target.accessibleName ?? undefined }, confidence: 1.0 };
  }

  // ── Unknown ───────────────────────────────────────────────────────────

  return { type: 'Unknown', metadata: {}, confidence: 0.0 };
}

// ── Element Type Helpers ────────────────────────────────────────────────

function isTextInput(identity: ElementIdentity): boolean {
  if (identity.tag === 'TEXTAREA') return true;
  if (identity.ariaRole === 'textbox') return true;
  if (identity.ariaRole === 'spinbutton') return true;
  if (identity.ariaRole === 'searchbox') return true;
  if (identity.tag === 'DIV' && identity.ariaRole === 'textbox') return true;
  if (identity.tag === 'INPUT') {
    const nonTextRoles = ['checkbox', 'radio', 'button', 'slider'];
    if (nonTextRoles.includes(identity.ariaRole ?? '')) return false;
    return true;
  }
  return false;
}

function isFileInput(identity: ElementIdentity, domCtx?: { inputType: string | null }): boolean {
  if (domCtx?.inputType === 'file') return true;
  const cssSel = identity.cssSelector ?? '';
  if (/type=["']?file["']?/i.test(cssSel)) return true;
  const nameOrClass = `${identity.name ?? ''} ${identity.className ?? ''}`.toLowerCase();
  return nameOrClass.includes('file') || nameOrClass.includes('upload');
}

// ════════════════════════════════════════════════════════════════════════
// STAGE 3: TEMPORAL DEDUP
// ════════════════════════════════════════════════════════════════════════

/** Dedup window: 2000ms. If two interactions of the same type happen within
 *  this window on elements with the same identity key, keep the later one. */
const DEDUP_WINDOW_MS = 2000;

/**
 * Remove duplicate interactions of the same type on the same element within
 * a 2-second window. Keeps the last interaction (it has the final value).
 *
 * This catches rapid double-clicks that produce two Click groups, and
 * change+blur events that produce overlapping TextEntry groups.
 *
 * @param interactions The interactions to dedup
 * @param timestamps   Parallel array of first-event timestamps (ms since epoch)
 */
function temporalDedup(
  interactions: DetectedInteraction[],
  timestamps: number[],
): DetectedInteraction[] {
  if (interactions.length <= 1) return interactions;

  const result: DetectedInteraction[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < interactions.length; i++) {
    if (suppressed.has(i)) continue;

    const current = interactions[i];
    const currentKey = current.target ? getIdentityKey(current.target) : '';
    const currentTime = timestamps[i] || 0;

    // Look ahead for duplicates
    for (let j = i + 1; j < interactions.length; j++) {
      if (suppressed.has(j)) continue;
      const next = interactions[j];
      const nextKey = next.target ? getIdentityKey(next.target) : '';
      const nextTime = timestamps[j] || 0;

      const timeDiff = Math.abs(nextTime - currentTime);

      // Same type, same element, within window → suppress the earlier one
      if (current.type === next.type && currentKey === nextKey && timeDiff <= DEDUP_WINDOW_MS) {
        suppressed.add(i);
        break; // current is suppressed; the next one becomes the new candidate
      }
    }
  }

  for (let i = 0; i < interactions.length; i++) {
    if (!suppressed.has(i)) result.push(interactions[i]);
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════

/**
 * Detect interactions from recorded events using the Control Model classifier.
 *
 * This replaces V1 (detectInteractions) + V2 (detectInteractionsV2) + merge
 * layer with a single deterministic pass. Produces DetectedInteraction[]
 * in the same format as the existing classifiers.
 *
 * @param events Raw events from a recording session
 * @returns Ordered list of detected interactions
 */
export function recognizeInteractions(events: RecordedEvent[]): DetectedInteraction[] {
  const idGen = new ActionIdGenerator('ctrl', 0);
  const groups = groupEvents(events);

  const interactions: DetectedInteraction[] = [];
  const timestamps: number[] = [];

  for (const group of groups) {
    const { type, metadata, confidence, engine: evidenceEngine, intent, evidenceTrail } = classifyGroup(group);
    const firstEvent = group.events[0];
    const target = firstEvent.eventType === 'navigation' ? undefined : (firstEvent as ElementRecordedEvent).target;

    // Iframe enrichment
    if (target?.inIframe && target.iframeContext) {
      const iframeCtx = target.iframeContext;
      metadata.iframeSrc = iframeCtx.frameSrc;
      metadata.iframeName = iframeCtx.frameName ?? undefined;
      metadata.iframeDepth = iframeCtx.frameDepth;
    }

    interactions.push({
      interactionId: idGen.next(),
      type,
      eventIds: group.events.map((e) => e.eventId),
      rawEventTypes: group.events.map((e) => e.eventType),
      target,
      metadata,
      confidence,
      engine: evidenceEngine ?? 'control',
      ...(intent ? { intent } : {}),
      ...(evidenceTrail ? { evidenceTrail } : {}),
    });
    timestamps.push(new Date(firstEvent.timestamp).getTime());
  }

  return suppressRedundantHovers(temporalDedup(interactions, timestamps), timestamps);
}

// ════════════════════════════════════════════════════════════════════════
// STAGE 4: HOVER SUPPRESSION (Click-Cancels-Hover)
// ════════════════════════════════════════════════════════════════════════

/** Window: if a hover on element X is followed by a click/text-entry on X
 *  within this window, the hover is suppressed. */
const CLICK_CANCELS_HOVER_MS = 2000;

/**
 * Remove Hover interactions that are immediately followed by a click or
 * text-entry on the same element within CLICK_CANCELS_HOVER_MS.
 *
 * This catches hovers that were the precursor to a real interaction —
 * the user moved the mouse to a button, then clicked it. The click is the
 * primary action; the hover is noise.
 *
 * @param interactions The post-dedup interactions
 * @param timestamps   Parallel timestamps (ms since epoch)
 * @returns Filtered interactions
 */
function suppressRedundantHovers(
  interactions: DetectedInteraction[],
  timestamps: number[],
): DetectedInteraction[] {
  if (interactions.length <= 1) return interactions;

  const suppressed = new Set<number>();

  for (let i = 0; i < interactions.length; i++) {
    if (interactions[i].type !== 'Hover') continue;
    if (suppressed.has(i)) continue;

    const hoverKey = interactions[i].target ? getIdentityKey(interactions[i].target) : '';
    if (!hoverKey) continue;
    const hoverTime = timestamps[i] || 0;

    // Look ahead for a click or text-entry on the same element
    for (let j = i + 1; j < interactions.length; j++) {
      const next = interactions[j];
      const nextTime = timestamps[j] || 0;
      const timeDiff = nextTime - hoverTime;

      if (timeDiff > CLICK_CANCELS_HOVER_MS) break; // beyond window
      if (timeDiff < 0) continue; // shouldn't happen but guard

      const nextKey = next.target ? getIdentityKey(next.target) : '';
      if (nextKey === hoverKey) {
        // Same element — check if it's an interaction that makes the hover redundant
        if (
          next.type === 'Click' ||
          next.type === 'DoubleClick' ||
          next.type === 'TextEntry' ||
          next.type === 'NativeDropdown' ||
          next.type === 'CustomDropdown' ||
          next.type === 'Checkbox' ||
          next.type === 'RadioButton' ||
          next.type === 'ToggleSwitch' ||
          next.type === 'DatePicker' ||
          next.type === 'Tab' ||
          next.type === 'Menu' ||
          next.type === 'Link' ||
          next.type === 'Slider'
        ) {
          suppressed.add(i);
          break;
        }
      }
    }
  }

  if (suppressed.size === 0) return interactions;
  return interactions.filter((_, idx) => !suppressed.has(idx));
}
