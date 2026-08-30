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
  | 'navigation'
  | 'dragstart'
  | 'drop'
  | 'submit';

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

  // ── Interaction affordance (7.4-M1) ──
  // Computed/DOM facts declaring WHY the resolved target is interactive.
  // Captured at event time for the RESOLVED target; classification input only
  // (never identity/locators — replay must not depend on computed style).

  /** Computed style cursor === 'pointer' on the resolved target. */
  pointerCursor?: boolean;
  /** The onclick ATTRIBUTE is present on the resolved target. */
  clickHandler?: boolean;

  // ── Combobox autocomplete signals (7.4-B2 S1) ──
  // Present only when the DOM attribute exists. Declared-but-unfilled until
  // 7.4-B2 added the extractor calls below (lesson 4: these fields existed in
  // the legacy recorder's DomContext but were never populated by the live
  // capture path — the recurring "declared-but-unfilled" sin).

  /** Value of aria-autocomplete attribute ("list", "both", "inline"). null if absent. */
  ariaAutoComplete?: string | null;
  /** Value of the `list` attribute on <input> (native datalist association). null if absent. */
  listId?: string | null;

  // ── Owner-form join (7.4-B6) ──
  // Captured at event time so downstream layers can join a form control to
  // its owner <form> WITHOUT a live DOM query (purity: completion and IR
  // decisions read recorded data only). Absent/null on legacy events and
  // on targets with no <form> ancestor — null is an honest "no form".

  /** elementKey of the closest ancestor <form> when the target is a form control; null otherwise. */
  formElementKey?: string | null;
  /** Owner-form action URL at event time; null when absent or no form. */
  formAction?: string | null;
  /** Owner-form method ('get'/'post'); null when absent or no form. */
  formMethod?: string | null;
  /** Owner-form DOM id; null when the form has no id or no form. */
  formId?: string | null;
  /** True when the target IS a form submit control (input[type=submit|image], button[type=submit or missing type]). Captured from the live DOM at event time — ground truth, never inferred downstream. */
  isFormSubmitControl?: boolean | null;


  // ── ARIA value attributes (for custom sliders/spinbuttons) ──
  // Present only when the DOM attribute exists (conditionally set by captureDomContext).

  /** Value of aria-valuenow. Present only if the attribute exists on the element. */
  ariaValueNow?: string;
  /** Value of aria-valuetext. Present only if the attribute exists on the element. */
  ariaValueText?: string;  /** Value of aria-valuemin. Present only if the attribute exists on the element. */
  ariaValueMin?: string;
  /** Value of aria-valuemax. Present only if the attribute exists on the element. */
  ariaValueMax?: string;

  // ── Native input bounds (for <input type="range">) ──
  // Present only when the element is an <input type="range"> with min/max attributes.

  /** Native el.min for range inputs. Present only for <input type="range">. */
  nativeMin?: string;
  /** Native el.max for range inputs. Present only for <input type="range">. */
  nativeMax?: string;

  // ── Capture-time click qualification (v1.2, 2026-08-29) ──
  // Click Qualification spec .drytis/specs/click-capture-qualification-v1.md.
  // Computed ONCE at the EventTap capture-phase instant (dispatch moment,
  // DOM frozen) for click/contextmenu events; undefined on every other
  // event type and on legacy recordings (undefined = legacy = qualified,
  // never pre-gated — Step 1 is inert: this field is recorded fact only,
  // consumed by NO typing decision yet).
  // Classification-input only — never identity, never locators, never replay.

  /** Provable-invalidity verdict + causes for the trusted click. */
  clickQualification?: ClickQualification;

  /**
   * Hover-capture generic fix v1 (G3): scoped `:hover`-reveal CSS fact,
   * recorded on the mouseenter capture path only when the raw pointer
   * element was probed (non-shaped). undefined = not probed = false.
   * Discovery input only — classification-input, never identity/locators.
   */
  hoverReveal?: boolean;

  // ── Hover Capture-Time Evidence Contract v1 (HEC v1, 2026-08-30) ──
  // Spec .drytis/specs/hover-capture-evidence-contract-v1.md §7 R-A1/R-A4:
  // recorded at the mouseenter capture instant so one physical act joins
  // reliably downstream (R-A2) without re-deriving resolution later.
  // Present ONLY on mouseenter captures; undefined = legacy event.

  /** elementKey of the hover anchor A (resolveHoverTarget outcome). */
  hoverAnchorKey?: string;
  /** elementKey of resolveTarget(R) — the click-policy anchor (R-A1). */
  hoverClickAnchorKey?: string;
  /** Which G1 branch produced the hover anchor (R-A4 honesty fact). */
  hoverAnchorResolution?: 'self' | 'ancestor-lift' | 'reveal-target' | 'body';
}

/** Why a trusted click is provably invalid (spec §4). Platform-enforced tier first. */
export type ClickInvalidityCause =
  | 'disabled-native'          // hasAttribute('disabled') on a natively-disableable tag
  | 'fieldset-disabled'        // form control inside fieldset[disabled], outside first legend
  | 'inert-subtree'            // closest('[inert]') incl. self — defensive tier
  | 'hit-test-miss'            // topmost hittable element ∉ raw composed path (only universal proof)
  | 'pointer-events-none'      // app-declared; JOINT with hit-test-miss only (R-4)
  | 'zero-size-lifted'         // auxiliary; JOINT with hit-test-miss only (R-5)
  | 'aria-disabled'            // app-declared
  | 'disabled-attr-non-native' // app-declared: disabled attr on a non-native tag (R-2)

/** The frozen verdict record (immutable from the capture instant). */
export interface ClickQualification {
  verdict: 'provably-invalid' | 'qualified';
  /** Empty iff verdict = qualified. */
  causes: ClickInvalidityCause[];
  /** Honesty marker on qualified clicks; consumed by no rule in this phase. */
  insufficient: boolean;
  /** The full immutable fact vector the verdict was computed from. */
  facts: ClickQualificationFacts;
}

/** Capture-time fact vector (spec §3). All dispatch-instant DOM facts. */
export interface ClickQualificationFacts {
  // ── Invalidity facts (§3.1) ──
  /** hasAttribute('disabled') AND tag ∈ natively-disableable set (R-2). */
  disabledNative: boolean;
  /** hasAttribute('disabled') on any other tag — app-declared tier (R-2). */
  disabledAttrNonNative: boolean;
  /** Form-associated control inside fieldset[disabled], outside its first legend (R-3). */
  fieldsetDisabled: boolean;
  /** aria-disabled="true" on the resolved target — app-declared. */
  ariaDisabled: boolean;
  /** closest('[inert]') on the resolved target (self or ancestor) — defensive tier. */
  inertSubtree: boolean;
  /** Computed pointer-events === 'none' on the resolved target. Cause only joint with miss (R-4). */
  pointerEventsNone: boolean;
  /** Resolved target rect empty AND lift occurred. Cause only joint with miss (R-5). */
  zeroSizeLifted: boolean;
  /** elementFromPoint probe result vs the raw element's composed path. */
  hitTest: { checked: boolean; miss: boolean | null };

  // ── Hit-target structure (§3.2) ──
  hitTarget: {
    /** raw BODY/HTML ⇒ 'canvas' (empty/background click). */
    kind: 'canvas' | 'element';
    /** Tag of the raw hit element (pre-lift). */
    rawTag: string;
    /** resolved ≠ raw. */
    lifted: boolean;
    /** Which resolveTarget strategy produced the resolved target. */
    liftStrategy: 'path' | 'parent' | 'cursor' | 'raw';
    /** Raw element passes the shared isInteractiveElement predicate (recorded fact only). */
    rawInteractiveShaped: boolean;
  };
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

  /**
   * G4-B (triple-key attribution): the tab/frame the event was captured in,
   * attached by the SW dispatcher from `sender` (content scripts cannot know
   * their tabId). Optional — older events and tests omit it; the eventId
   * remains the primary join key, this disambiguates.
   */
  captureOrigin?: { tabId: number; frameId: number };

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
  | 'Expander'
  | 'Modal' // 7.4-B5: dialog open + Escape dismissal
  | 'Scroll'
  | 'Navigation'
  | 'DragDrop'
  | 'KeyboardShortcut'
  | 'CompoundInteraction'
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
   * 7.4-B6.1: Should this ACTIVE lifecycle complete (as 'completed') when
   * a navigation event arrives, instead of being flush-interrupted?
   *
   * Called ONLY from the navigation-flush path (ComponentRuntime.process
   * step 2) — the one instant where the cause (recorded lifecycle state)
   * and the effect (the navigation event itself) coexist synchronously.
   * Implementations MUST ground the decision in recorded data (member
   * events + ctx.data) and never in wall-clock comparisons. The navigation
   * event is NOT a ledger discrete action, so absorbing it has no
   * disposition side effects.
   *
   * Return true → the lifecycle completes 'completed' (the definition
   * should have set its commit metadata in ctx.data inside this call).
   * Return false/undefined → interrupted exactly as the blind flush would.
   *
   * Optional — defaults to false (interrupt). Only TextEntry implements
   * it today (form-less SPA Enter commit, tier N).
   */
  shouldCompleteOnNavigation?(event: ObservedEvent, ctx: ComponentContext): boolean;

  /**
   * B7-P2 §5.2.2: does this lifecycle complete at RECORDING STOP?
   *
   * Consulted by ComponentRuntime.flush() ONLY (the STOP path). The idle
   * timeout (cleanupStaleComponents, 5 min) NEVER consults it — an idle
   * lifecycle is 'abandoned' regardless, and the Unclassified twin is the
   * honest floor (B-2 endState/hook-truthiness split).
   *
   * Optional — defaults to false (interrupt at STOP). Scroll keeps its
   * existing shouldCompleteOnOutside semantics; Hover declares true.
   */
  completesAtRecordingEnd?: boolean;

  /**
   * B7-P2 §5.2.2 T4 (target-removed): does this lifecycle complete when the
   * content script notifies the SW that its TRIGGER ELEMENT was removed
   * from the DOM mid-gesture?
   *
   * Consulted by ComponentRuntime.completeTriggerRemoved(lifecycleId) —
   * the SW-side consumer of the CS TRIGGER_REMOVED notification (spec
   * §5.1 line 130). Only lifecycles that structurally own their target
   * element (Hover's discovery enter) declare it. Completion sets
   * endState 'completed' and metadata.terminal 'target-removed' (the
   * recorded fact); all other lifecycle types are no-ops.
   *
   * Optional — defaults to false. Rationale: the element's removal is a
   * structural terminal for a hover (the reveal has nowhere to live),
   * but NOT for e.g. TextEntry (an input's removal mid-typing is an
   * interruption, honestly 'abandoned'/'interrupted' via existing
   * terminals — not a completed entry).
   */
  completesOnTriggerRemoved?: boolean;

  /**
   * B7-P1 (W-6): definition-local member-policy hook. Called by the
   * runtime AFTER handleEvent returns null and the event was pushed to
   * memberEvents — lets the definition curate its own member list
   * (e.g. Hover pops mousemoves, caps pointer-path enters). Optional —
   * defaults to no-op.
   */
  applyMemberPolicy?(ctx: ComponentContext): void;

  /**
   * B7-P2 §5.2.2 "consumed-by-click": may this definition RETAIN discrete
   * events that complete it? Default true (legacy semantics — the
   * completing event is absorbed and claimed by the lifecycle).
   *
   * Hover declares false: a click that completes the hover is NOT absorbed
   * by it — the click falls through to discovery so it ALSO becomes its
   * own Click interaction (the click is its own action; the hover merely
   * records the terminal fact 'consumed-by-click'). The click is popped
   * from the hover's memberEvents and never claimed by the hover ledger
   * path; the Click lifecycle claims it instead.
   */
  retainsDiscreteEvents?: boolean;

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
   * 7.4-B3 S2: called after a dedup-suppressed lifecycle's events are
   * folded into the prior emitted interaction of the same type. The service
   * worker uses this to persist the mutated prior interaction (MV3 death
   * survival) and — critically — to notify the content script that the
   * suppressed lifecycle TERMINATED (a folded lifecycle never emits, so
   * the FINALIZE_EVIDENCE that would otherwise release its EvidenceCollector
   * binding never fires; a stale binding holds every later window open —
   * see notes/rca-stale-lifecyclebindings-leak-b3-c3.md). Optional —
   * omitting it keeps the fold in-memory only (leak unchanged).
   */
  onDedupFold?: (prior: ComponentInteraction, suppressedCtx: ComponentContext) => void;

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
