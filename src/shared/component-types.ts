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
export type { ElementIdentity } from './types';


// ── Browser Events ─────────────────────────────────────────────────────

/**
 * Browser event types the EventTap listens for.
 *
 * The union is deliberately finite — adding a new event type means adding
 * it here AND to the EventTap's listener registration.
 */
export type BrowserEventType =
  | 'click'
  | 'mousedown'
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
  | 'navigation';

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
  /** TabIndex of the element (HTMLElement.tabIndex). -1 for elements without tabindex attr, null for non-HTMLElement (SVG, etc.). */
  tabIndex: number | null;

  // ── ARIA value attributes (for custom sliders/spinbuttons) ──
  // Present only when the DOM attribute exists (conditionally set by captureDomContext).

  /** Value of aria-valuenow. Present only if the attribute exists on the element. */
  ariaValueNow?: string;
  /** Value of aria-valuetext. Present only if the attribute exists on the element. */
  ariaValueText?: string;
  /** Value of aria-valuemin. Present only if the attribute exists on the element. */
  ariaValueMin?: string;
  /** Value of aria-valuemax. Present only if the attribute exists on the element. */
  ariaValueMax?: string;

  // ── Native input bounds (for <input type="range">) ──
  // Present only when the element is an <input type="range"> with min/max attributes.

  /** Native el.min for range inputs. Present only for <input type="range">. */
  nativeMin?: string;
  /** Native el.max for range inputs. Present only for <input type="range">. */
  nativeMax?: string;
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
  /**
   * Browser-assigned monotonic sequence number (rawEvent.timeStamp).
   * Provides deterministic within-document event ordering independent of
   * async SW message processing. Two events from the same document are
   * in browser-observed order iff `a.captureSeq <= b.captureSeq`.
   * Navigation synthetic events use `performance.now()` (no rawEvent).
   */
  captureSeq: number;
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

  /**
   * Navigation trigger type. Only present when eventType === 'navigation'.
   * Distinguishes pushState, replaceState, popstate, hashchange.
   * (Behavioral Evidence Model v3.0 §7.3)
   */
  navType?: 'pushState' | 'replaceState' | 'popstate' | 'hashchange' | null;
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
  | 'ColorInput'
  | 'Tab'
  | 'Scroll'
  | 'Navigation'
  | 'Unclassified';

// ── Component Lifecycle ────────────────────────────────────────────────

/**
 * The lifecycle states a component transitions through.
 *
 *   triggering → active → completed | abandoned | interrupted | discarded
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

  /**
   * Unique lifecycle ID for Evidence Ledger disposition tracking.
   * Assigned at createContext time. Format: `lc-{counter}`.
   * Optional for compatibility with projected/synthetic interactions.
   */
  lifecycleId?: string;

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

  /**
   * Timestamp of the last event absorbed by this lifecycle.
   * Updated whenever a memberEvent is pushed. Used by idle-time
   * stale eviction: a lifecycle is evicted only if it has been idle
   * (zero in-scope events) for longer than the idle timeout.
   * Optional for compatibility with test fixtures.
   */
  lastActivityTime?: number;

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
   * W3C-standard ARIA roles that identify selectable items belonging to this
   * lifecycle's surface (e.g., 'option' for Dropdown, 'gridcell' for DatePicker).
   * Used by the generic ownership test in ComponentRuntime.
   *
   * Leave undefined if this lifecycle has no surface children.
   */
  semanticChildRoles?: readonly string[];

  /**
   * Native HTML tags that identify selectable items belonging to this
   * lifecycle's surface (e.g., 'OPTION', 'TD').
   */
  semanticChildTags?: readonly string[];
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
  /** Lifecycle ID from ComponentRuntime (lc-{counter}). Optional for projected/synthetic interactions. */
  lifecycleId?: string;
  /** Interaction type. */
  type: InteractionType;
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

  // ── Behavioral Evidence ──────────────────────────────────────────────
  //
  // Populated by the deferred-attachment pipeline (EvidenceCollector → SW).
  // Optional because evidence arrives asynchronously after the interaction
  // is emitted, and some interactions may never receive evidence.
  //
  // Architecture: .drytis/specs/behavioral-evidence-model.md §9

  /** Dual-scope behavioral evidence (TargetEvidence + ApplicationEvidence). */
  behavioralEvidence?: import('./behavioral-evidence-types').BehavioralEvidence;
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
   * Callback invoked when a new lifecycle is created (createContext).
   * The SW uses this to send a LIFECYCLE_BOUND message to the content
   * script so the EvidenceCollector can bind evidence windows to the
   * interaction lifecycle.
   */
  onLifecycleStart?: (ctx: ComponentContext) => void;

  /**
   * Starting interaction ID counter (for MV3 recovery — continues from
   * where the previous runtime left off).
   */
  initialInteractionId?: number;

  /**
   * Optional Evidence Ledger for disposition tracking.
   * When provided, the runtime records a disposition for every discrete
   * event: absorbed when a lifecycle claims it, claimed when the lifecycle
   * completes, unclaimed when the lifecycle is abandoned/interrupted.
   * When not provided, the runtime works standalone (backward compat).
   */
  evidenceLedger?: import('../runtime/evidence-ledger').EvidenceLedger;
}

/**
 * Dedup window in milliseconds. Two interactions of the same type on the
 * same element within this window (measured end-of-previous to start-of-next)
 * are suppressed as duplicates.
 *
 * Architecture: §2.2 (Dedup), §4.3 (DatePicker double-trigger fix)
 */
export const DEDUP_WINDOW_MS = 2000;
