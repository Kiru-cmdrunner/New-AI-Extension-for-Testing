/**
 * Element Identity & DOM Context Types — Phase 1
 *
 * Target architecture types for representing DOM elements and their context
 * at the moment of capture. These types are designed to eventually replace
 * the existing RawElementIdentity / ElementIdentity / DomContext types
 * (shared/types.ts, recorder/recorded-event.ts), but for now they coexist.
 *
 * Key improvements over the existing types:
 * - Structured locator model (multiple strategies, each with a confidence)
 * - Explicit provenance tracking (where the identity came from)
 * - Separation of concerns (identity vs. context vs. appearance)
 * - Type-safe null handling (optional fields are truly optional)
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

// ── Locator Strategy ─────────────────────────────────────────────────────

/**
 * Strategies for locating a DOM element on a page.
 *
 * Ordered by priority: testId > semantic attributes > structural > generated.
 * The existing codebase uses LocatorStrategy in shared/types.ts with similar
 * values but as a flat union. This version groups them logically.
 */
export type LocatorKind =
  // High-priority: explicit test attributes
  | 'testId'          // data-testid
  | 'dataCy'          // data-cy
  | 'dataQa'          // data-qa
  | 'dataTest'        // data-test
  | 'dataAutomationId' // data-automation-id
  // Semantic attributes
  | 'ariaLabel'       // aria-label
  | 'ariaLabelledby'  // aria-labelledby
  | 'id'              // DOM id
  | 'name'            // name attribute (form elements)
  | 'placeholder'     // placeholder attribute
  | 'text'            // visible text content
  | 'alt'             // alt attribute (images)
  | 'title'           // title attribute
  // Structural
  | 'css'             // generated CSS selector
  | 'xpath';          // generated XPath

/**
 * A single locator with its value and metadata.
 *
 * Each locator records how it was derived and how confident we are that
 * it uniquely identifies the element. This allows the pipeline to rank
 * locators and the execution layer to try them in priority order.
 */
export interface ResolvedLocator {
  /** The locator strategy. */
  kind: LocatorKind;
  /** The locator value (selector string, text, id, etc.). */
  value: string;
  /** Confidence that this locator uniquely identifies the element [0, 1]. */
  confidence: number;
  /**
   * Whether this locator was directly observed (e.g., attribute exists)
   * or computed (e.g., CSS selector generated).
   */
  source: 'observed' | 'computed';
}

// ── Frame Context ────────────────────────────────────────────────────────

/**
 * Context for an element inside an iframe.
 *
 * Captures the iframe's identity in the parent document so the execution
 * layer can locate and enter the frame before interacting with the element.
 */
export interface FrameContext {
  /** The iframe's URL (from window.location.href inside the frame). */
  url: string;
  /** The <iframe> element's name attribute, if accessible (same-origin). */
  name: string | null;
  /** The <iframe> element's id, if accessible (same-origin). */
  frameElementId: string | null;
  /** CSS selector for the <iframe> in the parent document (same-origin). */
  frameSelector: string | null;
  /** How many levels deep this frame is (1 = direct child of top document). */
  depth: number;
}

// ── Target Element Identity (target architecture) ────────────────────────

/**
 * Complete identity of a DOM element at the moment of capture.
 *
 * This is the target architecture's replacement for the existing
 * RawElementIdentity + ElementIdentity (shared/types.ts). Key differences:
 *
 * - Locators are structured objects with confidence, not flat strings.
 * - ARIA attributes are grouped logically, not scattered across fields.
 * - Provenance is tracked (how and when the identity was captured).
 * - Semantic role is separated from ARIA role (native HTML semantics).
 *
 * Immutable once captured. The recognition pipeline reads but never mutates.
 */
export interface TargetElementIdentity {
  // ── Basic Properties ──
  /** HTML tag name, uppercased (e.g., 'BUTTON', 'INPUT', 'A'). */
  tag: string;
  /** Computed accessible name (best-effort, per ARIA naming computation). */
  accessibleName: string;
  /** Explicit ARIA role (el.getAttribute('role')), null if absent. */
  ariaRole: string | null;

  // ── ARIA State ──
  /** aria-expanded value: true/false, null if absent. */
  ariaExpanded: boolean | null;
  /** aria-haspopup value (e.g., 'listbox', 'menu', 'dialog'), null if absent. */
  ariaHasPopup: string | null;
  /** aria-checked value, null if absent. */
  ariaChecked: boolean | string | null;
  /** aria-selected value, null if absent. */
  ariaSelected: boolean | string | null;
  /** aria-pressed value, null if absent. */
  ariaPressed: boolean | string | null;

  // ── Semantic Attributes ──
  /** <input> type attribute, null for non-input elements. */
  inputType: string | null;
  /** Whether the element is contenteditable. */
  isContentEditable: boolean;

  // ── Locators ──
  /** All resolved locators, ordered by confidence (highest first). */
  locators: ResolvedLocator[];
  /** The highest-confidence locator (convenience accessor). */
  primaryLocator: ResolvedLocator;

  // ── Frame & Shadow DOM ──
  /** Whether the element is inside a Shadow DOM. */
  inShadowDom: boolean;
  /** Whether the element is inside an iframe. */
  inIframe: boolean;
  /** Detailed frame context when inIframe is true. */
  frameContext: FrameContext | null;
}

// ── DOM Context (target architecture) ────────────────────────────────────

/**
 * Type of dynamic UI surface that appeared after an interaction.
 *
 * Detected by observing DOM mutations after a user action.
 */
export type TargetSurfaceType = 'modal' | 'drawer' | 'popover' | 'tooltip' | 'dropdown' | 'dialog' | 'menu';

/**
 * A dynamic UI surface that appeared (or disappeared) after an interaction.
 *
 * Replaces the scattered surfaceType/surfaceRole/surfaceLabel fields in
 * the existing DomContext with a structured object.
 */
export interface SurfaceInfo {
  /** Type of the surface. */
  type: TargetSurfaceType;
  /** ARIA role of the surface element. */
  role: string | null;
  /** Accessible name of the surface element. */
  accessibleName: string | null;
  /** Whether the surface appeared or disappeared. */
  direction: 'appeared' | 'disappeared';
  /** ISO timestamp of when the surface was detected. */
  detectedAt: string;
}

/**
 * Context about the DOM state at the moment of an event.
 *
 * This is the target architecture's replacement for the existing DomContext
 * (recorder/recorded-event.ts). Key differences:
 *
 * - Surface information is structured (SurfaceInfo[]), not scattered fields.
 * - Value transitions are typed objects, not null-able string pairs.
 * - Date picker context is grouped under a single optional field.
 * - File upload context is grouped under a single optional field.
 *
 * Captured at event time — the DOM may have changed by the time the pipeline
 * processes it. Every field here eliminates a heuristic or timing guess.
 */
export interface TargetDomContext {
  // ── Surface Information ──
  /** Dynamic surfaces that appeared or disappeared after this interaction. */
  surfaces: SurfaceInfo[];

  // ── Value Information ──
  /** For value-bearing elements: the transition from before to after. */
  valueTransition: ValueTransitionInfo | null;

  // ── State Information ──
  /** Checked/pressed/selected state transition, if the element is a toggle. */
  checkedTransition: CheckedTransitionInfo | null;

  // ── Hierarchy ──
  /** Ancestor chain from the target element upward (parent → root). */
  /** Each entry: tag name lowercased, or 'tag[role=role]' if ARIA role present. */
  ancestorChain: string[];

  // ── Specialised Contexts ──
  /** Date picker details, present only for dateSelect interactions. */
  datePicker: DatePickerContext | null;
  /** File upload details, present only for upload interactions. */
  fileUpload: FileUploadContext | null;
  /** Native dialog details, present only when a dialog was triggered. */
  dialog: DialogContext | null;
  /** Navigation details, present only for navigation events. */
  navigation: NavigationContext | null;
}

/**
 * A value transition captured at event time.
 */
export interface ValueTransitionInfo {
  /** Value before the interaction. */
  before: string;
  /** Value after the interaction. */
  after: string;
}

/**
 * A checked/pressed/selected state transition.
 */
export interface CheckedTransitionInfo {
  /** State before. */
  before: boolean;
  /** State after. */
  after: boolean;
  /** Which ARIA attribute or native property this transition tracks. */
  property: 'checked' | 'aria-checked' | 'aria-pressed' | 'aria-selected';
}

/**
 * Date picker interaction context.
 */
export interface DatePickerContext {
  /** Date picker type. */
  dateType: 'date' | 'time' | 'dateTime' | 'month' | 'week';
  /** ISO value for execution (e.g., "2026-07-15"). */
  isoValue: string;
  /** Human-readable display value (e.g., "July 15, 2026"). */
  displayValue: string;
  /** True if the value could not be confidently normalised. */
  ambiguous: boolean;
  /** Normalisation confidence [0, 1]. */
  confidence: number;
}

/**
 * File upload interaction context.
 */
export interface FileUploadContext {
  /** How files were uploaded. */
  method: 'browse' | 'drag-drop';
  /** Accepted file types from the accept attribute. */
  acceptedTypes: string[];
  /** Whether multiple files are allowed. */
  multiple: boolean;
  /** Files captured at event time. */
  files: { name: string; type: string }[];
}

/**
 * Native browser dialog (alert/confirm/prompt) triggered by the interaction.
 */
export interface DialogContext {
  /** Dialog type. */
  type: 'alert' | 'confirm' | 'prompt';
  /** Message shown in the dialog. */
  message: string;
  /** Dialog result: 'OK'/'Cancel' for confirm, entered text/null for prompt. */
  result: string;
}

/**
 * Navigation event context.
 */
export interface NavigationContext {
  /** Destination URL. */
  url: string;
  /** Page title at navigation time. */
  title: string;
  /** Whether the navigation opened a new tab. */
  newTab: boolean;
  /** Whether the navigation opened a new window. */
  newWindow: boolean;
}
