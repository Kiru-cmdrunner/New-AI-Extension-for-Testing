/**
 * Recorded Event Types — Phase 1 Deterministic Recorder
 *
 * The atom of the recording system. A RecordedEvent captures exactly what
 * happened — the event type, the target element's identity, and the value
 * transitions. No classification, no inference, no interaction types.
 *
 * There are exactly two variants:
 *   - NavigationEvent: URL/page change
 *   - ElementEvent: a DOM event on an interactive element
 *
 * ReplayJson is the replay artifact: a flat, ordered, deterministic JSON
 * representation of the entire recording session.
 */

import type { ElementIdentity, RecordingContext } from '../shared/types';
export type { ElementIdentity };

// ── DOM Context ────────────────────────────────────────────────────────

/**
 * DOM context captured at event time — enriches the raw event with structural
 * information that the Evidence Engine providers need but cannot access later
 * (the DOM has changed by recording stop).
 *
 * This is the bridge between the recorder (DOM Context Sensor) and the engine
 * (Decision Maker). Every field here eliminates a regex hack or timing guess
 * in the classifier.
 */
/**
 * The type of dynamic UI surface that appeared after a user interaction.
 * Detected by the surface detection MutationObserver.
 */
export type SurfaceType = 'modal' | 'drawer' | 'popover' | 'tooltip';

export interface DomContext {
  /** For <input> elements: the value of el.type (text, checkbox, radio, date, etc.). null for non-input elements. */
  inputType: string | null;
  /** Value of aria-expanded attribute: true if expanded, false if collapsed, null if absent. */
  ariaExpanded: boolean | null;
  /** Value of aria-haspopup attribute (e.g., "listbox", "menu", "dialog"). null if absent. */
  ariaHasPopup: string | null;
  /** Whether the element is contenteditable. */
  isContentEditable: boolean;
  /** Value of aria-autocomplete attribute ("list", "both", "inline"). null if absent. */
  ariaAutoComplete?: string | null;
  /** Value of the `list` attribute on <input> elements (native datalist ID). null if absent. */
  listId?: string | null;
  /** Surface that appeared after this interaction (modal, drawer, popover, tooltip). null if none. */
  surfaceType?: SurfaceType | null;
  /** ARIA role of the surface element that appeared. */
  surfaceRole?: string | null;
  /** Accessible name of the surface element that appeared. */
  surfaceLabel?: string | null;
  /** For file inputs: accepted file types from the accept attribute (e.g. ".pdf,image/*"). null if no accept attribute. */
  acceptedFileTypes?: string | null;
  /** For file inputs: whether the multiple attribute is present. */
  multipleFiles?: boolean | null;
  /** Files captured at event time. Array of {name, type}. null if no files. */
  fileData?: { name: string; type: string }[] | null;
  /** How files were uploaded: 'browse' (input change) or 'drag-drop' (drop event). null if not a file upload. */
  uploadMethod?: 'browse' | 'drag-drop' | null;
  /** Whether a click triggered a native browser dialog (alert/confirm/prompt). null if no dialog. */
  triggeredDialog?: 'alert' | 'confirm' | 'prompt' | null;
  /** Message shown in the triggered native dialog. null if no dialog. */
  dialogMessage?: string | null;
  /** Dialog result: 'OK'/'Cancel' for confirm, entered text/null for prompt. null if no dialog. */
  dialogResult?: string | null;
  /** Whether the clicked element opens a new browser tab (target=_blank or window.open without features). */
  opensNewTab?: boolean | null;
  /** Whether the clicked element opens a new browser window (window.open with width/height features). */
  opensNewWindow?: boolean | null;
  /** URL that will be opened in the new tab/window (from href or window.open argument). */
  openedUrl?: string | null;
  /** Value of aria-valuenow attribute (for sliders, spinbuttons). null if absent. */
  ariaValueNow?: string | null;
  /** Human-readable text from aria-valuetext attribute. null if absent. */
  ariaValueText?: string | null;
  /** Value of aria-valuemin attribute (slider/scrollbar minimum). null if absent. */
  ariaValueMin?: string | null;
  /** Value of aria-valuemax attribute (slider/scrollbar maximum). null if absent. */
  ariaValueMax?: string | null;
  /** Native min value for <input type="range"> (el.min). null if not a range input. */
  nativeMin?: string | null;
  /** Native max value for <input type="range"> (el.max). null if not a range input. */
  nativeMax?: string | null;
  /**
   * Semantically relevant DOM attributes captured at event time.
   * Only present attributes are included (no undefined keys).
   * Keys typically include: required, aria-required, type, min, max, step,
   * pattern, minlength, maxlength, multiple, accept, autocomplete.
   * This is the source of InteractionContract derivation in the enrichment pipeline.
   */
  domAttributes?: Record<string, string>;
  /** Ancestor chain from the target element upward (up to 10 levels).
   * Each entry is the tag name lowercased; if the ancestor has an ARIA role,
   * it is included as "tag[role=role]". Index 0 is the target's parent.
   * Used by the recognition pipeline for structural pattern matching.
   */
  ancestorRoles?: string[];
  /** Date picker type: 'date' | 'time' | 'dateTime' | 'month' | 'week'. Present on dateSelect events. */
  dateType?: string;
  /** ISO value for execution, e.g. "2026-07-15". Present on dateSelect events. */
  isoValue?: string;
  /** Human-readable display value, e.g. "July 15, 2026". Present on dateSelect events. */
  displayValue?: string;
  /** True if the captured value could not be confidently normalized. */
  dateAmbiguous?: boolean;
  /** Warning message if date normalization was uncertain. */
  dateWarning?: string;
  /** Confidence of the date normalization (1.0 = confident, 0 = unparseable). */
  dateConfidence?: number;
  /**
   * True when this event occurred inside a calendar popover/dialog that is
   * part of a date picker interaction. Such events (scroll, hover, click on
   * navigation buttons) are evidence-only — they must NOT produce standalone
   * interactions. Set by the recorder when it detects the event target is
   * inside a calendar container while a date picker is active.
   */
  ownedByDatePicker?: boolean;
}

// ── Recorded Events ────────────────────────────────────────────────────

/**
 * A navigation event — captured when the URL changes.
 */
export interface NavigationRecordedEvent {
  eventId: string;
  eventType: 'navigation';
  timestamp: string;
  url: string;
  title: string;
  transitionType?: string;
}

/**
 * An element event — captured for DOM events on interactive elements.
 *
 * valueBefore/valueAfter and checkedBefore/checkedAfter use null when
 * the field is not applicable to this element/event (e.g., a button
 * click has no value). Non-null values track transitions deterministically.
 */
export interface ElementRecordedEvent {
  eventId: string;
  eventType: 'click' | 'dblclick' | 'contextmenu' | 'focus' | 'blur' | 'change' | 'input' | 'scroll' | 'mouseenter' | 'dragstart' | 'drop' | 'dateSelect';
  timestamp: string;
  target: ElementIdentity;
  valueBefore: string | null;
  valueAfter: string | null;
  checkedBefore: boolean | null;
  checkedAfter: boolean | null;
  /** DOM context captured at event time for the Evidence Engine. */
  domContext?: DomContext;
}

/**
 * Union of all recorded event types.
 */
export type RecordedEvent = NavigationRecordedEvent | ElementRecordedEvent;

// ── Replay JSON ────────────────────────────────────────────────────────

/**
 * The replay artifact — the complete, deterministic output of a recording.
 *
 * This is what future layers (event grouping, type classification, business
 * action generation) will consume. It is deliberately raw and unopinionated.
 */
export interface ReplayJson {
  schemaVersion: 1;
  recordingContext: RecordingContext;
  events: RecordedEvent[];
}

// ── Messages ───────────────────────────────────────────────────────────

/**
 * Message sent by the content script when a raw event is captured.
 *
 * The payload contains the raw event data WITHOUT an eventId — the service
 * worker assigns the eventId (single source of truth for sequential IDs).
 */
export interface RecordedEventMessage {
  type: 'RECORDED_EVENT';
  eventType: ElementRecordedEvent['eventType'];
  timestamp: string;
  target: ElementIdentity;
  valueBefore: string | null;
  valueAfter: string | null;
  checkedBefore: boolean | null;
  checkedAfter: boolean | null;
  /** DOM context captured at event time for the Evidence Engine. */
  domContext?: DomContext;
}

/**
 * Type guard: is this a RecordedEventMessage?
 */
export function isRecordedEventMessage(msg: unknown): msg is RecordedEventMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as Record<string, unknown>).type === 'RECORDED_EVENT'
  );
}
