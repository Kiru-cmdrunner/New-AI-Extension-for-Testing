/**
 * Component Runtime — Type Contracts
 *
 * The typed interfaces between every layer of the Component Runtime pipeline.
 * No logic lives here — only types. Every component (EventTap, Runtime,
 * Definitions, Presentation) imports from this file.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2
 *
 * Data flow:
 *   ObservedEvent → ComponentRuntime → ComponentInteraction → Presentation
 *                       ↑
 *               ComponentDefinition[]
 */

import type { ElementIdentity } from './types';
export type { ElementIdentity };

// ── Browser Events ─────────────────────────────────────────────────────

/**
 * Browser event types the EventTap listens for.
 *
 * The union is deliberately finite — adding a new event type means adding
 * it here AND to the EventTap's listener registration.
 */
export type BrowserEventType =
  | 'click'
  | 'dblclick'
  | 'mousedown'
  | 'mouseup'
  | 'contextmenu'
  | 'focus'
  | 'blur'
  | 'input'
  | 'change'
  | 'mouseenter'
  | 'mouseleave'
  | 'mousemove'
  | 'keydown'
  | 'scroll'
  | 'dragstart'
  | 'dragover'
  | 'drop'
  | 'dragend'
  | 'navigation'
  | 'attribute-change';

/**
 * A single attribute transition captured by the post-click re-snapshot.
 *
 * The EventTap snapshots the target element's attributes at capture time
 * (before the page's click handler runs), then re-snapshots after the
 * handler via setTimeout(0). If attributes changed, the diff is recorded
 * as AttributeChange[] and carried on the DomContext.
 *
 * Architecture: R3.4 — Click lifecycle deferral + behavioral re-snapshot
 */
export interface AttributeChange {
  /** Attribute name (e.g., 'class', 'aria-expanded', 'aria-checked'). */
  attribute: string;
  /** Value before the click handler ran. null if attribute was absent. */
  before: string | null;
  /** Value after the click handler ran. null if attribute was removed. */
  after: string | null;
}

/**
 * DOM context captured at event time — structural information the
 * definitions need but cannot access later (the DOM mutates).
 *
 * Adapted from `recorded-event.ts` DomContext, simplified to what the
 * Component Runtime definitions actually consume.
 */
export interface DomContext {
  /** For <input> elements: the value of el.type (text, checkbox, radio, date, etc.). null for non-input elements. */
  inputType: string | null;
  /** Value of aria-expanded attribute. null if absent. */
  ariaExpanded: boolean | null;
  /** Value of aria-haspopup attribute (e.g., "listbox", "menu", "dialog"). null if absent. */
  ariaHasPopup: string | null;
  /** Whether the element is contenteditable. */
  isContentEditable: boolean;
  /** Whether the element is disabled (native or aria-disabled). */
  disabled: boolean;
  /** Whether the element is readonly. */
  readOnly: boolean;
  /** Whether the element has the required attribute. */
  required: boolean;
  /** Ancestor chain roles (up to 10 levels), index 0 = parent. */
  ancestorRoles: string[];
  /** Ancestor chain classes (up to 10 levels), index 0 = parent. */
  ancestorClasses: string[];
  /** Type of dynamic UI surface (modal, drawer, popover, tooltip) if the element is inside one. null otherwise. */
  surfaceType?: string | null;
  /** ARIA role of the surface element. null if not applicable. */
  surfaceRole?: string | null;
  /** Human-readable label of the surface (aria-label, heading text, or title). null if not found. */
  surfaceLabel?: string | null;
  /** Value of aria-autocomplete attribute. null if absent. */
  ariaAutoComplete?: string | null;
  /** Current ARIA value (aria-valuenow). For sliders, progress bars. null if absent. */
  ariaValueNow?: string | null;
  /** Human-readable ARIA value (aria-valuetext). null if absent. */
  ariaValueText?: string | null;
  /** Minimum ARIA value (aria-valuemin). null if absent. */
  ariaValueMin?: string | null;
  /** Maximum ARIA value (aria-valuemax). null if absent. */
  ariaValueMax?: string | null;
  /** Native min attribute (for <input type="range">, <input type="number">). null if absent. */
  nativeMin?: string | null;
  /** Native max attribute. null if absent. */
  nativeMax?: string | null;

  // ── Navigation signals (Phase 2: Capability gap) ──

  /** Whether the clicked element opens a new browser tab (target=_blank or window.open without features). */
  opensNewTab?: boolean | null;
  /** Whether the clicked element opens a new browser window (window.open with width/height features). */
  opensNewWindow?: boolean | null;
  /** URL that will be opened in the new tab/window (from href or window.open argument). */
  openedUrl?: string | null;

  // ── Validation & Form Context (Phase 2: Enrichment Layer) ──

  /** Minimum length validation constraint (from minlength attribute or aria-valuemin). null if absent. */
  minLength?: number | null;
  /** Maximum length validation constraint (from maxlength attribute). null if absent. */
  maxLength?: number | null;
  /** Regex pattern validation constraint (from pattern attribute). null if absent. */
  pattern?: string | null;
  /** Minimum numeric value (from min attribute). null if absent. */
  min?: string | null;
  /** Maximum numeric value (from max attribute). null if absent. */
  max?: string | null;
  /** Step increment for numeric inputs (from step attribute). null if absent. */
  step?: string | null;
  /** Accepted file types for file inputs (from accept attribute). null if absent. */
  acceptedFileTypes?: string | null;
  /** ID of the containing <form> element, if any. null if not inside a form. */
  formId?: string | null;
  /** Name of the containing <form> element, if any. null if not inside a form. */
  formName?: string | null;

  // ── Surface identity (Phase 0b: Observation Model) ──

  /** Stable structural identity of the surface container element.
   *  Null if the event occurred outside any surface.
   *  Derived from the surface container's DOM position (tag + role + nth-child),
   *  NOT from CSS class names (which mutate on re-render).
   *  Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §9.2, §6.2 */
  surfaceId?: string | null;
  /** eventId of the event that caused this surface to appear.
   *  Null if the surface was not caused by a recorded event (e.g., page-load modal).
   *  Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §9.2 */
  surfaceOpenedBy?: string | null;

  // ── Slider Geometry (R2: Custom slider value extraction) ──

  /** Target element's offsetLeft relative to its offsetParent. Used for geometry-based slider value extraction. */
  targetOffsetLeft?: number | null;
  /** Target element's offsetTop relative to its offsetParent. */
  targetOffsetTop?: number | null;
  /** Nearest track ancestor's offsetLeft. 0 if no track ancestor found. */
  trackOffsetLeft?: number | null;
  /** Nearest track ancestor's offsetWidth. 0 if no track ancestor found. */
  trackOffsetWidth?: number | null;

  // ── Attribute Transitions (R3.4: Post-handler behavioral re-snapshot) ──

  /** Attribute changes detected by the post-click re-snapshot. Present on
   *  synthetic 'attribute-change' events emitted by the EventTap after the
   *  page's click handler has run. Empty array if no tracked attributes changed.
   *  Architecture: R3.4 — Click lifecycle deferral */
  attributeChanges?: AttributeChange[];
}

// ── Observed Event ─────────────────────────────────────────────────────

/**
 * A single observed DOM event, enriched with element identity and value
 * transitions. This is the atom of the recording system — produced by
 * the EventTap (content script), consumed by the ComponentRuntime (SW).
 *
 * Architecture: §2.2 Stage 1
 */
export interface ObservedEvent {
  /** Page-unique event ID: `evt-{pageId}-{counter}`. */
  eventId: string;
  /** Browser event type. */
  eventType: BrowserEventType;
  /** Timestamp (Date.now()). */
  timestamp: number;
  /** Whether the event is trusted (user-initiated). Synthetic events are rejected. */
  isTrusted: boolean;

  /** Target element identity (18-field, extracted at capture time). */
  target: ElementIdentity;

  /** DOM context captured at event time. */
  domContext: DomContext;

  // ── Value transitions ──

  /** Element value before this event (on focus/click/mousedown). null if N/A. */
  valueBefore: string | null;
  /** Element value after this event (on input/change). null if N/A. */
  valueAfter: string | null;

  // ── Checked-state transitions ──

  /** Checked state before this event. null if N/A. */
  checkedBefore: boolean | null;
  /** Checked state after this event. null if N/A. */
  checkedAfter: boolean | null;

  // ── Pointer / keyboard ──

  /** Client X coordinate (mouse events). */
  clientX: number | null;
  /** Client Y coordinate (mouse events). */
  clientY: number | null;
  /** Key pressed (keyboard events). */
  key: string | null;
  /** Code of the key (keyboard events). */
  code: string | null;
  /** Modifier keys active during the event. */
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;

  // ── Scroll ──

  /** Scroll delta Y (vertical). Only present on scroll events. */
  scrollDeltaY: number | null;
  /** Scroll delta X (horizontal). Only present on scroll events. */
  scrollDeltaX: number | null;

  // ── Page context ──

  /** URL of the page where the event occurred. */
  pageUrl: string;
  /** Title of the page where the event occurred. */
  pageTitle: string;
}

// ── Interaction Types ──────────────────────────────────────────────────

/**
 * The interaction types the Component Runtime can classify.
 *
 * Each type corresponds to exactly one ComponentDefinition. Adding a new
 * type means adding a new definition file and registering it in
 * ALL_DEFINITIONS — no existing files change (AP7: Additive Extensibility).
 *
 * Architecture: §2.3
 */
export type InteractionType =
  | 'Click'
  | 'TextEntry'
  | 'Dropdown'
  | 'Checkbox'
  | 'RadioButton'
  | 'DatePicker'
  | 'Hover'
  | 'Link'
  | 'FileUpload'
  | 'Slider'
  | 'Tab'
  | 'Scroll'
  | 'Navigation'
  | 'DragDrop'
  | 'KeyboardShortcut'
  | 'ModalDialog'
  | 'Stepper'
  | 'TagInput'
  | 'OtpInput'
  | 'HotkeySequence'
  | 'NewTab'
  | 'NewWindow'
  | 'Breadcrumb';

// ── Component Lifecycle ────────────────────────────────────────────────

/**
 * The lifecycle states a component transitions through.
 *
 *   triggering → active → completed | abandoned | interrupted
 *
 * Architecture: §2.2 Stage 2
 */
export type ComponentState =
  | 'triggering'
  | 'active'
  | 'completed'
  | 'abandoned'
  | 'interrupted'
  | 'discarded';

/**
 * The end state of a completed or terminated component.
 Used in buildResult and the emitted ComponentInteraction.
 */
export type ComponentEndState = 'completed' | 'abandoned' | 'interrupted' | 'discarded';

/**
 * Result of detectTrigger — signals "this event starts my interaction".
 *
 * Architecture: §2.2 Stage 3
 */
export interface ComponentTrigger {
  /** The interaction type that was triggered. */
  type: InteractionType;
}

/**
 * Result of handleEvent — signals "this event completes my interaction".
 * Null means "event is part of my lifecycle but I'm not done yet".
 */
export interface ComponentCompletion {
  /** The end state. For most definitions, this is 'completed'. */
  endState: ComponentEndState;
}

// ── Component Context ──────────────────────────────────────────────────

/**
 * The mutable state an active component accumulates during its lifecycle.
 *
 * Created when detectTrigger matches, mutated by handleEvent, consumed by
 * buildResult, and finally emitted as a ComponentInteraction.
 *
 * Architecture: §2.2 Stage 2
 */
export interface ComponentContext {
  /** The interaction type. */
  type: InteractionType;

  /** Lifecycle state. */
  state: ComponentState;

  /** Identity of the trigger element. */
  trigger: ElementIdentity;

  /** The first ObservedEvent that triggered this component. */
  triggerEvent: ObservedEvent;

  /** All events that belong to this component's lifecycle (including trigger). */
  memberEvents: ObservedEvent[];

  /** Set of element keys that are in-scope for this component (trigger + children). */
  scopeKeys: Set<string>;

  /** Start time (timestamp of triggerEvent). */
  startTime: number;

  /** End time (timestamp of the event that completed/abandoned/interrupted). */
  endTime: number;

  /**
   * Per-definition scratch space. Definitions store intermediate state here
   * (e.g., DatePicker stores the selected date value, Dropdown stores the
   * selected option name, TextEntry stores the userTyped flag).
   *
   * This is typed as a record so each definition can use its own keys
   * without polluting the ComponentContext type.
   */
  data: Record<string, unknown>;

  // ── Surface binding (Phase 0b: Observation Model) ──

  /** Surface this session opened (if the interaction creates a surface).
   *  Set when a surface appears after the session activates.
   *  Null for surface-less interactions (Click, TextEntry, Scroll).
   *  Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §7.3 */
  openedSurface?: string | null;

  /** Surface this session lives inside (if the trigger was inside an
   *  already-open surface). Set from triggerEvent.domContext.surfaceId.
   *  Null for base-page interactions.
   *  Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §7.3 */
  insideSurface?: string | null;
}

// ── Surface Entry (Phase 0b: Observation Model) ───────────────────────

/**
 * Entry in the runtime's surface stack. Tracks open surfaces and their
 * association to sessions.
 *
 * Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §17.3
 */
export interface SurfaceEntry {
  /** Stable structural identity of the surface container. */
  surfaceId: string;
  /** Surface type: 'modal', 'popover', 'drawer', 'tooltip', 'sheet'. */
  type: string;
  /** ARIA role of the surface container, if any. */
  role: string | null;
  /** Human-readable label from aria-label, heading, or title. */
  label: string | null;
  /** eventId of the event that caused this surface to appear. */
  openedByEventId: string | null;
  /** Timestamp when the surface was first detected. */
  openedAt: number;
  /** Timestamp when the surface was closed. Null while open. */
  closedAt: number | null;
}

// ── Component Definition ───────────────────────────────────────────────

/**
 * The contract every component definition implements.
 *
 * A definition is a self-contained classifier for one interaction type.
 * It knows when to trigger, what's in scope, when to complete, when to
 * abandon, and what metadata to produce.
 *
 * Architecture: §2.3
 */
export interface ComponentDefinition {
  /** The interaction type this definition classifies. */
  type: InteractionType;

  /**
   * Priority for discovery ordering. Lower number = checked first.
   * Click (180) is the universal fallback — always checked last.
   */
  priority: number;

  /** Event types that can trigger this definition. */
  triggerEventTypes: Set<BrowserEventType>;

  /**
   * Does this event start my interaction?
   * Return non-null if yes (creates a new ComponentContext).
   * Return null if no (let the next definition try).
   *
   * Called during discovery — only if no active component claimed the event.
   */
  detectTrigger(event: ObservedEvent): ComponentTrigger | null;

  /**
   * Does this event belong to my active interaction?
   * Return true if the event is in-scope (it will be offered to handleEvent).
   *
   * Called for each event against each active component in the stack.
   */
  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean;

  /**
   * Process an in-scope event. Return completion if the interaction is done,
   * null if it's still ongoing.
   *
   * This is where definitions accumulate state in ctx.data (e.g., the selected
   * option name, the date value, whether the user typed anything).
   */
  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null;

  /**
   * Should this event (outside the component's scope) cause abandonment?
   * Return true if the user clicked elsewhere, abandoning this interaction.
   *
   * Only called for events NOT in scope (isInScope returned false).
   */
  shouldCancelOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean;

  /**
   * Should this event (outside the component's scope) cause completion?
   * Return true if the component should be finalized as 'completed'
   * (not abandoned) because the gesture/interaction naturally ended.
   *
   * Only called for events NOT in scope (isInScope returned false), and
   * only if shouldCancelOnOutside also returned false.
   *
   * Used by gesture components (e.g., Scroll) that coalesce consecutive
   * events and should complete when the user starts a different action.
   *
   * Optional — defaults to false. Most definitions don't need this.
   */
  shouldCompleteOnOutside?(event: ObservedEvent, ctx: ComponentContext): boolean;

  /**
   * Should this component be completed (not interrupted) when the runtime
   * flushes all active components (e.g., on navigation)?
   *
   * Return true for gesture-like components (Scroll) that have accumulated
   * data and should be emitted as 'completed' even when flushed.
   * Return false (or omit) for lifecycle components (TextEntry, Dropdown)
   * that should be 'interrupted' when flushed by navigation.
   *
   * Optional — defaults to false.
   */
  shouldCompleteOnFlush?(ctx: ComponentContext): boolean;

  /**
   * Build the metadata for the emitted interaction.
   * Called when the component reaches 'completed', 'abandoned', or 'interrupted'.
   *
   * The metadata is type-specific (targetName for Click, textValue for TextEntry,
   * selectedValue for Dropdown, selectedDate for DatePicker, etc.).
   */
  buildResult(
    ctx: ComponentContext,
    completion: ComponentCompletion,
  ): { metadata: Record<string, unknown> };

  /**
   * Should this non-completed interaction be converted to a simpler type?
   *
   * Called when the component is about to be completed with a non-completed
   * endState (interrupted or abandoned). If the definition returns a type,
   * the runtime replaces the component's type with the returned type, finds
   * the target definition, and calls its buildResult instead.
   *
   * Use case: A Dropdown session opens on a click that matched dropdown
   * trigger patterns, but no option was ever selected (the element was
   * just a regular button). Instead of emitting an empty Dropdown that
   * gets filtered from the side panel, downcast to a Click so the user's
   * action is still visible.
   *
   * Optional — defaults to undefined (no downcast).
   */
  downcast?(ctx: ComponentContext, completion: ComponentCompletion): InteractionType | null;
}

// ── Component Interaction (Output) ─────────────────────────────────────

/**
 * The final output of the Component Runtime — one per user interaction.
 *
 * This is what the presentation layer filters, the side panel displays,
 * and the generation pipeline consumes.
 *
 * Architecture: §2.2 Stage 2 (completeComponent → onEmit)
 */
export interface ComponentInteraction {
  /** Unique interaction ID. */
  interactionId: string;
  /** Interaction type (coarse — one of 13 component-model types). */
  type: InteractionType;
  /**
   * Fine-grained subtype mapping to the classifier's 40-type vocabulary.
   * E.g., Dropdown → 'NativeDropdown' | 'CustomDropdown'.
   * Navigation → 'PageNavigation' | 'Back' | 'Forward' | 'Refresh'.
   * When unset, the adapter infers the subtype from the coarse type.
   */
  interactionSubtype?: string;
  /** Trigger element identity. */
  trigger: ElementIdentity;
  /** The triggering ObservedEvent. */
  triggerEvent: ObservedEvent;
  /** All member events (including trigger). */
  memberEvents: ObservedEvent[];
  /** Start timestamp. */
  startTime: number;
  /** End timestamp. */
  endTime: number;
  /** End state: 'completed', 'abandoned', or 'interrupted'. */
  endState: ComponentEndState;
  /** Type-specific metadata from buildResult. */
  metadata: Record<string, unknown>;

  // ── Three-Layer Enrichment ─────────────────────────────────────────
  //
  // These fields are populated by the enrichment layer (Layer 2 + Layer 3)
  // after the interaction is emitted by the Component Runtime. They are
  // optional because not all code paths enrich (e.g., legacy tests, raw
  // runtime output before enrichment).
  //
  // Architecture: .drytis/specs/three-layer-component-model.md

  /** Layer 2: Semantic component type (e.g. 'DataGrid', 'IconButton', 'SortButton'). */
  componentType?: string;
  /** Layer 2: Framework that rendered it (e.g. 'MUI', 'AntDesign', 'OXD'). */
  componentFramework?: string;
  /** Layer 3: Human-readable business meaning (e.g. 'Sort by Name', 'Close dialog'). */
  businessMeaning?: string;

  // ── Semantic Annotation (Phase 2: Evidence Engine) ──────────────────
  //
  // Populated by the semantic annotation layer after the Component Runtime
  // classifies the interaction. These fields are optional because the
  // annotation layer runs as a post-classification pass.
  //
  // For lifecycle definitions (TextEntry, DatePicker, etc.): intent is
  // statically mapped from type, confidence is 1.0.
  // For ambiguous clicks: the full evidence pipeline runs.
  //
  // Architecture: .drytis/PHASE2_DESIGN.md §3.2

  /** Semantic intent inferred by the evidence engine. */
  intent?: import('../classifier/evidence/types').SemanticIntent;
  /** Evidence-based confidence (0.0–1.0). */
  confidence?: number;
  /** Full evidence audit trail for explainability. */
  evidenceTrail?: import('../classifier/evidence/types').IntentVote[];
}

// ── Runtime Configuration ──────────────────────────────────────────────

/**
 * Configuration for createRuntime().
 */
export interface RuntimeConfig {
  /**
   * Callback invoked when the runtime emits a completed interaction.
   * The SW uses this to push to liveInteractions and write to storage.
   */
  onEmit: (interaction: ComponentInteraction) => void;

  /**
   * Starting interaction ID counter (for MV3 recovery — continues from
   * where the previous runtime left off).
   */
  initialInteractionId?: number;
}

/**
 * Dedup window in milliseconds. Two interactions of the same type on the
 * same element within this window (measured end-of-previous to start-of-next)
 * are suppressed as duplicates.
 *
 * Architecture: §2.2 (Dedup), §4.3 (DatePicker double-trigger fix)
 */
export const DEDUP_WINDOW_MS = 2000;
