/**
 * Component Runtime — Lifecycle Management Engine (Layers 2+3 fused)
 *
 * Manages active component lifecycles. Processes events through the
 * definition stack. Emits completed interactions.
 *
 * The runtime owns:
 * - activeStack: ComponentContext[] — active components, newest at top
 * - seenEventIds: Set<string> — dedup (cap at 500, halve when exceeded)
 * - dedupByType: Map<InteractionType, DedupRecord> — per-type temporal dedup
 * - errorLog: string[] — accumulate definition errors without crashing
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 2
 * Principle: AP5 (Linear data flow), AP6 (Contract-based boundaries)
 */

import type {
  ObservedEvent,
  ComponentDefinition,
  ComponentContext,
  ComponentInteraction,
  ComponentCompletion,
  ComponentTrigger,
  RuntimeConfig,
  InteractionType,
  ElementIdentity,
} from '../shared/component-types';
import { DEDUP_WINDOW_MS } from '../shared/component-types';
import { elementKey, extractSemanticRoles } from '../definitions/patterns';
import type { EvidenceLedger } from './evidence-ledger';

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Record used for temporal dedup. Stores the key properties of the
 * last emitted interaction so a new interaction with the same type +
 * element + within the dedup window can be suppressed.
 */
interface DedupRecord {
  type: InteractionType;
  elementKey: string;
  endTime: number;
  /** Optional metadata snapshot for type-specific dedup (e.g., selectedDate). */
  metadata: Record<string, unknown>;
  /**
   * 7.4-B3 S2: interactionId of the emitted interaction this record's
   * window describes. Absent on records restored after an SW restart
   * (the live interaction object is not serialized) — in that degraded
   * state the fold target is unavailable and the suppress-and-release
   * fallback applies (pinned, honest Unclassified).
   */
  interactionId?: string;
}

/**
 * Snapshot of the runtime state, used for MV3 recovery.
 * Serialized and stored so a restarted SW can recreate the runtime.
 */
export interface RuntimeSnapshot {
  interactionCounter: number;
  seenEventIds: string[];
  /** Per-type dedup records for MV3 recovery. */
  dedupRecords: DedupRecord[];
}

// ── Constants ─────────────────────────────────────────────────────────

/** Maximum size of seenEventIds before halving. */
const SEEN_EVENTS_CAP = 500;

/**
 * 6F-M1 A: pageId from an eventId of the form `evt-{pageId}-{counter}` —
 * the EvidenceLedger's documented event-ID contract (evidence-ledger.ts).
 * 'unknown' fallback matches the ledger's own defensive behavior.
 */
function pageIdOf(eventId: string): string {
  const match = eventId.match(/^evt-(.+)-\d+$/);
  return match ? match[1] : 'unknown';
}

/**
 * 7.4-B3 S2: element identity key for a ledger entry (D1 targetIdentity
 * preferred — same normalization the Projection Engine applies).
 */
function ledgerEntryKey(entry: { targetIdentity?: unknown }): string {
  const id = entry.targetIdentity as ElementIdentity | null | undefined;
  if (id) return elementKey(id);
  return 'tag:∅';
}

/**
 * Maximum idle time (ms) an active component can remain on the stack without
 * receiving any in-scope events. Prevents zombie components from blocking
 * discovery indefinitely after the user has moved on to something else.
 *
 * This is an internal leak-protection mechanism — NOT a user-facing timing
 * limit. A lifecycle that is actively receiving events (typing, browsing,
 * mouse movement inside the surface) stays alive regardless of total duration.
 * Only a lifecycle with ZERO in-scope events for this duration gets evicted.
 *
 * Framework-independent: doesn't rely on DOM boundary heuristics.
 */
const LIFECYCLE_IDLE_TIMEOUT_MS = 300_000;

/**
 * Browser event types that represent deliberate user actions.
 * Each of these MUST produce exactly one ComponentInteraction — either from
 * a specialized definition, or from the Unclassified fallback.
 *
 * Accumulating events (scroll, input, change, mousemove) do NOT get the
 * guarantee — they are part of lifecycles, not standalone actions.
 *
 * Re-exported from evidence-ledger.ts (the canonical source).
 */
export { DISCRETE_ACTION_TYPES } from './evidence-ledger';
import { DISCRETE_ACTION_TYPES } from './evidence-ledger';

// ── Factory ───────────────────────────────────────────────────────────

/**
 * Generic ownership test — can an active lifecycle positively prove that a
 * different-target discrete event is one of its own semantic children?
 *
 * Two-part test using ONLY W3C-standard signals:
 *   Part 1: target has a declared semantic child role/tag
 *   Part 2: target's ancestorRoles (DOM-traversed) includes the lifecycle's surfaceRole
 *
 * No framework heuristics. No isInteractiveElement(). No CSS selectors.
 * If either test fails → false → event falls through to discovery/Unclassified.
 *
 * Exported for Phase 6D.0 regression pins (pure function of its arguments).
 */
export function lifecycleOwnsTarget(
  event: ObservedEvent,
  ctx: ComponentContext,
  def: ComponentDefinition,
): boolean {
  // ── Part 1: Semantic child identity ─────────────────────
  const { tag, ariaRole } = event.target;

  const hasChildRole =
    def.semanticChildRoles != null &&
    def.semanticChildRoles.includes(ariaRole ?? '');

  const hasChildTag =
    def.semanticChildTags != null &&
    def.semanticChildTags.includes(tag);

  if (!hasChildRole && !hasChildTag) return false;

  // ── Part 2: Surface containment via DOM-traversed ancestry ──
  const surfaceRole = ctx.data.surfaceRole as string | undefined;
  if (!surfaceRole) return false;

  // ancestorRoles was populated by walking el.parentElement in the content
  // script — this is actual DOM ancestry, not selector matching.
  // Phase 6D.0: compare the semantic role token — capture stores entries as
  // `div[role=grid]`, surfaceRole is the bare token 'grid'.
  if (
    !extractSemanticRoles(event.domContext.ancestorRoles).includes(surfaceRole)
  ) {
    return false;
  }

  return true;
}

/**
 * Create a ComponentRuntime instance.
 *
 * @param definitions — all registered component definitions (sorted by priority)
 * @param config — runtime configuration (onEmit callback, initial counter)
 */
export function createRuntime(
  definitions: ComponentDefinition[],
  config: RuntimeConfig,
): ComponentRuntime {
  return new ComponentRuntimeImpl(definitions, config);
}

// ── Implementation ────────────────────────────────────────────────────

export interface ComponentRuntime {
  /** Process an observed event. Returns newly emitted interactions. */
  process(event: ObservedEvent): ComponentInteraction[];

  /** Flush all active components as 'interrupted'. Returns emitted interactions. */
  flush(): ComponentInteraction[];

  /** Get a serializable snapshot for MV3 recovery. */
  snapshot(): RuntimeSnapshot;

  /** Restore from a snapshot. */
  restore(snap: RuntimeSnapshot): void;

  /**
   * 7.4-B3 S3: live lifecycle stack, trigger-first. Read-only view for
   * SW-side episode trackers (typed-text sampling must not mint when a
   * definition mid-flight owns the element).
   */
  getLiveLifecycles(): { id: string; trigger?: unknown }[];

  /** Get the current active stack depth (for diagnostics). */
  get activeCount(): number;

  /** Get accumulated errors (for diagnostics). */
  get errors(): string[];
}

class ComponentRuntimeImpl implements ComponentRuntime {
  private readonly definitions: ComponentDefinition[];
  private readonly clickDefinition: ComponentDefinition | null;
  private readonly nonClickDefinitions: ComponentDefinition[];
  private readonly config: RuntimeConfig;
  private readonly ledger: EvidenceLedger | null;

  private activeStack: ComponentContext[] = [];
  private seenEventIds: Set<string> = new Set();
  private interactionCounter: number;
  private lifecycleCounter: number = 0;
  /** Per-type dedup: tracks the last interaction of each type independently. */
  private dedupByType: Map<InteractionType, DedupRecord> = new Map();
  /**
   * 7.4-B3 S2: last emitted interaction per type (object ref). The dedup
   * fold appends suppressed events to this interaction instead of leaving
   * them unclaimed. NOT serialized — after an SW restart the map is empty
   * and the suppress-and-release degradation applies (pinned).
   */
  private lastInteractionByType: Map<InteractionType, ComponentInteraction> = new Map();
  private errorLog: string[] = [];

  // ── 6F-M1 A: gesture ownership ───────────────────────────────────────
  //
  // A lifecycle that completes on MOUSEDOWN forgets its gesture: the paired
  // click of the same physical gesture arrives immediately after the
  // mousedown in the DISCRETE-event ledger order, finds no active lifecycle
  // (it was spliced at completion), and falls through to discovery → twin
  // Click card + duplicate IR step (6E-M2 E2E Finding 2; 6F-M1 run-1
  // grounded the real stream: the pair is consecutive in ledger-entry order
  // with ~90ms raw captureSeq gap — browser-monotonic captureSeq is NOT
  // +1-adjacent across a gesture because non-discrete events share the
  // counter).
  //
  // The pairing predicate is the runtime analog of the shipped S1' projection
  // rule (projection-engine.ts pairPhysicalPress) — same structural family,
  // owner-corrected doctrine (2026-08-20): same pageId, same elementKey, and
  // the click is the NEXT discrete event after the completing mousedown —
  // no intervening DISCRETE event on that page (interleaved non-discrete
  // events — focus/mousemove/input — never break a physical press-release
  // gesture). NO TIMING FIELDS participate (no Date.now, no timestamp
  // deltas, no captureSeq arithmetic) — timing rules are doctrinally
  // forbidden.
  //
  // The bound below is memory hygiene only (most-recent-first eviction),
  // not a timing rule: entries are never expired by time.
  private readonly MAX_GESTURE_RECORDS = 16;
  private completedGestures: Array<{
    pageId: string;
    elementKey: string;
    /** Ledger captureSeq of the completing mousedown — ordering anchor. */
    mousedownCaptureSeq: number;
    /** Set true once any later DISCRETE event landed on this page. */
    superseded: boolean;
    lifecycleId: string;
    interactionId: string;
    interactionType: InteractionType;
    /** Emitted interaction object — the click may append to memberEvents. */
    interaction: ComponentInteraction;
  }> = [];

  constructor(definitions: ComponentDefinition[], config: RuntimeConfig) {
    // Sort by priority ascending (lower number = higher priority = checked first).
    // Click (180) is the universal fallback — always checked last.
    this.definitions = [...definitions].sort((a, b) => a.priority - b.priority);
    this.config = config;
    this.ledger = config.evidenceLedger ?? null;
    this.interactionCounter = config.initialInteractionId ?? 0;

    // Separate Click (fallback) from other definitions
    this.clickDefinition =
      this.definitions.find((d) => d.type === 'Click') ?? null;
    this.nonClickDefinitions = this.definitions.filter(
      (d) => d.type !== 'Click',
    );
  }

  // ── Public API ───────────────────────────────────────────────────

  get activeCount(): number {
    return this.activeStack.length;
  }

  get errors(): string[] {
    return [...this.errorLog];
  }

  process(event: ObservedEvent): ComponentInteraction[] {
    const emitted: ComponentInteraction[] = [];

    // 1. Dedup by event ID
    if (this.seenEventIds.has(event.eventId)) return emitted;
    this.trackSeenEvent(event.eventId);

    // 2. Navigation flush — interrupt all active, then continue to discovery
    if (event.eventType === ('navigation' as string)) {
      const flushed = this.flush();
      emitted.push(...flushed);
      // Fall through to discovery — the Navigation definition will claim it
    }

    // 2b. Stale component cleanup — abandon components that exceeded the
    //     maximum lifecycle duration. This is the framework-independent
    //     replacement for shouldCancelOnOutside DOM boundary heuristics.
    //     Prevents zombie components (e.g., Dropdown, DatePicker that never
    //     received their completion event) from blocking discovery.
    this.cleanupStaleComponents(event, emitted);

    // 2c. 6F-M1 A: gesture-record supersession — any discrete event other
    //     than a click (mousedown/contextmenu/keydown/dragstart/drop) that
    //     arrives after a recorded completing mousedown breaks the exact
    //     ledger adjacency for every gesture on the same page. Clicks are
    //     excluded here: step 3b below decides whether a click is the
    //     absorbing half of a gesture or an adjacency-breaking event.
    if (DISCRETE_ACTION_TYPES.has(event.eventType) && event.eventType !== 'click') {
      const pageId = pageIdOf(event.eventId);
      for (const g of this.completedGestures) {
        if (g.pageId === pageId) g.superseded = true;
      }
    }

    // 3. Offer to active stack (top → bottom)
    let handled = false;
    // Iterate from top of stack downward. We may remove items during iteration.
    for (let i = this.activeStack.length - 1; i >= 0; i--) {
      const ctx = this.activeStack[i];
      const def = this.findDefForType(ctx.type);
      if (!def) continue;

      let inScope = false;
      try {
        inScope = def.isInScope(event, ctx);
      } catch (err) {
        this.logError(def.type, 'isInScope', err);
      }

      if (inScope) {
        // Add event to member events
        ctx.memberEvents.push(event);
        // Update last activity time for idle-based stale eviction
        ctx.lastActivityTime = event.timestamp;

        let completion: ComponentCompletion | null = null;
        try {
          completion = def.handleEvent(event, ctx);
        } catch (err) {
          this.logError(def.type, 'handleEvent', err);
        }

        if (completion) {
          handled = true;
          ctx.state = completion.endState;
          ctx.endTime = event.timestamp;
          // Disposition: completion absorbs the event (completeComponent will set claimed/unclaimed)
          if (DISCRETE_ACTION_TYPES.has(event.eventType)) {
            this.ledger?.setDisposition(event.eventId, 'absorbed', ctx.lifecycleId, ctx.type);
          }
          const interaction = this.completeComponent(ctx, def, completion);
          if (interaction) emitted.push(interaction);
          // Remove from stack
          this.activeStack.splice(i, 1);
        } else {
          // handleEvent returned null — event is either:
          // (a) a legitimate accumulating event (input, change, scroll, mousemove)
          // (b) a discrete event consumed silently by the lifecycle
          //
          // For discrete events on a DIFFERENT element than the trigger,
          // we must verify positive ownership before allowing silent absorption.
          // If ownership cannot be proven, the event falls through to discovery.

          const isDiscrete = DISCRETE_ACTION_TYPES.has(event.eventType);
          // Use elementKey() instead of raw stableId comparison to avoid
          // null === null false positives when both elements lack IDs.
          const sameElement =
            elementKey(event.target) === elementKey(ctx.trigger);

          if (isDiscrete && !sameElement) {
            // Different-target discrete event inside lifecycle scope.
            // Check positive ownership — W3C semantic child + surface containment.
            if (lifecycleOwnsTarget(event, ctx, def)) {
              // Legitimate absorption (e.g., dropdown option click with role=option).
              handled = true;
              this.ledger?.setDisposition(event.eventId, 'absorbed', ctx.lifecycleId, ctx.type);
            } else {
              // Cannot positively prove ownership. Release the event so it falls
              // through to discovery → definition match or Unclassified fallback.
              // The active lifecycle is NOT removed — it may still complete later.
              ctx.memberEvents.pop(); // undo the push — this event isn't part of us
            }
          } else {
            // Same-element click or accumulating event — legitimate absorption.
            handled = true;
            if (isDiscrete) {
              this.ledger?.setDisposition(event.eventId, 'absorbed', ctx.lifecycleId, ctx.type);
            }
          }
        }
      } else {
        // Not in scope — check outside cancellation
        let shouldCancel = false;
        try {
          shouldCancel = def.shouldCancelOnOutside(event, ctx);
        } catch (err) {
          this.logError(def.type, 'shouldCancelOnOutside', err);
        }

        if (shouldCancel) {
          ctx.state = 'abandoned';
          ctx.endTime = event.timestamp;
          const interaction = this.completeComponent(ctx, def, {
            endState: 'abandoned',
          });
          if (interaction) emitted.push(interaction);
          this.activeStack.splice(i, 1);
        } else {
          // Check if the component should complete (e.g., Scroll gesture ended)
          let shouldComplete = false;
          if (def.shouldCompleteOnOutside) {
            try {
              shouldComplete = def.shouldCompleteOnOutside(event, ctx);
            } catch (err) {
              this.logError(def.type, 'shouldCompleteOnOutside', err);
            }
          }

          if (shouldComplete) {
            ctx.state = 'completed';
            ctx.endTime = event.timestamp;
            const interaction = this.completeComponent(ctx, def, {
              endState: 'completed',
            });
            if (interaction) emitted.push(interaction);
            this.activeStack.splice(i, 1);
          }
        }
      }
    }

    // WARN-4 (6F-M1 doctrine extension): a discrete event absorbed by an
    // ACTIVE lifecycle breaks the exact ledger adjacency for this page's
    // gesture records — the same discipline step 2c applies to unhandled
    // discrete events. Without it, a stale record can claim a later
    // genuine click for the OLD interaction (misattribution) and then be
    // consumed, so the interaction the click actually belonged to loses
    // its evidence. Strictly structural: pageId equality + discrete type
    // only — no timing fields, no captureSeq windows (owner doctrine
    // 2026-08-20). The mousedownCaptureSeq < event.captureSeq guard is
    // ORDERING, not timing: the completing mousedown that CREATED a record
    // is itself a discrete event handled by an active lifecycle, and
    // without the guard it would supersede its own fresh record at birth
    // (every mousedown-completed gesture born dead — regression caught by
    // the W4-T4/T5 pins). A record is broken only by events that occur
    // BETWEEN its completing mousedown and the potential release click.
    if (handled && DISCRETE_ACTION_TYPES.has(event.eventType)) {
      const warn4PageId = pageIdOf(event.eventId);
      for (const g of this.completedGestures) {
        if (g.pageId === warn4PageId && g.mousedownCaptureSeq < event.captureSeq) {
          g.superseded = true;
        }
      }
    }

    // 3b. 6F-M1 A: gesture ownership — a click that is the NEXT discrete
    //     event after a mousedown that COMPLETED a lifecycle, on the same
    //     element and page, is the second half of that same gesture. It is
    //     absorbed (claimed for the completed interaction, appended to its
    //     memberEvents) instead of falling through to discovery, where the
    //     Click fallback would emit a twin card + duplicate IR step.
    //     Strictly structural (S1' family): pageId + elementKey + exact
    //     discrete-event adjacency. No timing fields, no captureSeq math.
    if (!handled && event.eventType === 'click' && this.completedGestures.length > 0) {
      const clickPageId = pageIdOf(event.eventId);
      const clickKey = elementKey(event.target);
      const owner = this.completedGestures.find(
        (g) =>
          !g.superseded &&
          g.pageId === clickPageId &&
          g.elementKey === clickKey &&
          event.captureSeq > g.mousedownCaptureSeq,
      );
      if (owner) {
        handled = true;
        this.ledger?.setDisposition(
          event.eventId,
          'claimed',
          owner.interactionId,
          owner.interactionType,
        );
        // Append-only memberEvents extension (eventId-guarded) — the emitted
        // interaction keeps the full gesture evidence for drill-downs.
        if (!owner.interaction.memberEvents.some((ev) => ev.eventId === event.eventId)) {
          owner.interaction.memberEvents.push(event);
        }
        // One gesture record absorbs at most one click (the release half).
        this.completedGestures = this.completedGestures.filter((g) => g !== owner);
      } else {
        // A click that matched NO gesture record is itself an
        // adjacency-breaking event for this page's records.
        for (const g of this.completedGestures) {
          if (g.pageId === clickPageId) g.superseded = true;
        }
      }
    }

    // 4. Discovery — no active component claimed it
    if (!handled) {
      const newCtx = this.tryDiscovery(event);
      if (newCtx) {
        this.activeStack.push(newCtx);
        // Disposition: trigger event absorbed by new lifecycle
        if (DISCRETE_ACTION_TYPES.has(event.eventType)) {
          this.ledger?.setDisposition(event.eventId, 'absorbed', newCtx.lifecycleId, newCtx.type);
        }
        // Check if the definition completes immediately (e.g., Click, Checkbox)
        const def = this.findDefForType(newCtx.type);
        if (def) {
          let completion: ComponentCompletion | null = null;
          try {
            completion = def.handleEvent(event, newCtx);
          } catch (err) {
            this.logError(def.type, 'handleEvent', err);
          }
          if (completion) {
            newCtx.state = completion.endState;
            newCtx.endTime = event.timestamp;
            // Disposition: completeComponent will set 'claimed' on success,
            // or releaseClaims on dedup failure. The trigger was already set
            // to 'absorbed' when the lifecycle was pushed to activeStack.
            const interaction = this.completeComponent(newCtx, def, completion);
            if (interaction) emitted.push(interaction);
            this.activeStack.pop();
          }
        }
        // M5: The capture guarantee fallback that previously emitted an
        // Unclassified interaction here has been removed. The event was
        // already absorbed by the lifecycle push above (disposition: 'absorbed').
        // If the lifecycle completes later, the event is claimed; if it is
        // interrupted or abandoned, releaseClaims sets it to 'unclaimed'.
        // The Projection Engine surfaces unclaimed/pending entries as
        // Unclassified interactions at stopRecording time.
      } else {
        // M5: No definition recognized this event. If it's a discrete action,
        // it will be surfaced as an Unclassified interaction by the Projection
        // Engine at stopRecording time. The ledger entry stays 'pending'.
        // No runtime emission — the Projection Engine handles this.
      }
    }

    return emitted;
  }

  flush(): ComponentInteraction[] {
    const emitted: ComponentInteraction[] = [];
    for (let i = this.activeStack.length - 1; i >= 0; i--) {
      const ctx = this.activeStack[i];
      const def = this.findDefForType(ctx.type);
      // Gesture components (Scroll) complete naturally on flush, not interrupt.
      // They accumulated their data and the gesture is done — it should be emitted.
      const endState = def?.shouldCompleteOnOutside ? 'completed' : 'interrupted';
      ctx.state = endState;
      ctx.endTime = Date.now();
      if (def) {
        const interaction = this.completeComponent(ctx, def, {
          endState,
        });
        if (interaction) emitted.push(interaction);
      }
    }
    this.activeStack = [];
    return emitted;
  }

  /**
   * Abandon active components that have been idle for longer than
   * LIFECYCLE_IDLE_TIMEOUT_MS. Idle means the lifecycle has received ZERO
   * in-scope events for the entire idle period.
   *
   * This is leak-protection, NOT a user-facing timing limit. A lifecycle
   * that is actively receiving events stays alive regardless of total age.
   *
   * Gesture components (Scroll) are completed, not abandoned, since they
   * accumulated valid data — the user just didn't do anything afterwards.
   *
   * Called on every event, so staleness is caught promptly.
   */
  private cleanupStaleComponents(
    event: ObservedEvent,
    emitted: ComponentInteraction[],
  ): void {
    for (let i = this.activeStack.length - 1; i >= 0; i--) {
      const ctx = this.activeStack[i];
      const idleTime = event.timestamp - (ctx.lastActivityTime ?? ctx.startTime);
      if (idleTime > LIFECYCLE_IDLE_TIMEOUT_MS) {
        const def = this.findDefForType(ctx.type);
        const endState = def?.shouldCompleteOnOutside ? 'completed' : 'abandoned';
        ctx.state = endState;
        ctx.endTime = event.timestamp;
        if (def) {
          const interaction = this.completeComponent(ctx, def, {
            endState,
          });
          if (interaction) emitted.push(interaction);
        }
        this.activeStack.splice(i, 1);
      }
    }
  }

  snapshot(): RuntimeSnapshot {
    return {
      interactionCounter: this.interactionCounter,
      seenEventIds: [...this.seenEventIds],
      dedupRecords: [...this.dedupByType.values()],
    };
  }

  restore(snap: RuntimeSnapshot): void {
    this.interactionCounter = snap.interactionCounter;
    this.seenEventIds = new Set(snap.seenEventIds);
    this.dedupByType = new Map(
      (snap.dedupRecords ?? []).map((r) => [r.type, r]),
    );
    // 7.4-B3 S2: lastInteractionByType deliberately NOT rebuilt — the live
    // interaction objects are not serialized. A duplicate arriving in the
    // post-restart window degrades to suppress-and-release (pinned honest
    // fallback). The SW re-seeds the map on its next emission of each type.
  }

  /**
   * 7.4-B3 S3: read-only view of the live stack (trigger identity included).
   */
  getLiveLifecycles(): { id: string; trigger?: unknown }[] {
    return this.activeStack.map((ctx) => ({
      id: ctx.lifecycleId as string,
      trigger: ctx.trigger as unknown,
    }));
  }

  // ── Internal ─────────────────────────────────────────────────────

  /**
   * Try to discover a matching definition for this event.
   * Iterates definitions by priority ascending — lower number = higher priority
   * (excluding Click fallback).
   * Returns a new ComponentContext if a definition matched.
   */
  private tryDiscovery(event: ObservedEvent): ComponentContext | null {
    // Try non-Click definitions first
    for (const def of this.nonClickDefinitions) {
      if (!def.triggerEventTypes.has(event.eventType)) continue;

      let trigger: ComponentTrigger | null = null;
      try {
        trigger = def.detectTrigger(event);
      } catch (err) {
        this.logError(def.type, 'detectTrigger', err);
        continue;
      }

      if (trigger) {
        return this.createContext(def, event);
      }
    }

    // Click fallback
    if (this.clickDefinition) {
      const def = this.clickDefinition;
      if (!def.triggerEventTypes.has(event.eventType)) return null;

      let trigger: ComponentTrigger | null = null;
      try {
        trigger = def.detectTrigger(event);
      } catch (err) {
        this.logError(def.type, 'detectTrigger', err);
      }

      if (trigger) {
        return this.createContext(def, event);
      }
    }

    return null;
  }

  /**
   * Create a new ComponentContext for a freshly triggered definition.
   */
  private createContext(
    def: ComponentDefinition,
    event: ObservedEvent,
  ): ComponentContext {
    const ctx: ComponentContext = {
      type: def.type,
      lifecycleId: `lc-${++this.lifecycleCounter}`,
      state: 'active',
      trigger: event.target,
      triggerEvent: event,
      memberEvents: [event],
      scopeKeys: new Set([elementKey(event.target)]),
      startTime: event.timestamp,
      lastActivityTime: event.timestamp,
      endTime: 0,
      data: {},
    };

    // Notify the SW that a lifecycle has started so it can send
    // LIFECYCLE_BOUND to the content script's EvidenceCollector.
    if (this.config.onLifecycleStart) {
      try {
        this.config.onLifecycleStart(ctx);
      } catch {
        // Non-fatal — lifecycle still functions without the binding message
      }
    }

    return ctx;
  }

  // M5: createUnclassifiedInteraction removed.
  // The Projection Engine now surfaces unclaimed/pending ledger entries as
  // Unclassified interactions at stopRecording time.

  /**
   * Complete a component: build result, dedup, emit.
   * Returns the interaction if emitted, null if suppressed by dedup.
   */
  private completeComponent(
    ctx: ComponentContext,
    def: ComponentDefinition,
    completion: ComponentCompletion,
  ): ComponentInteraction | null {
    // Build metadata
    let metadata: Record<string, unknown> = {};
    try {
      const result = def.buildResult(ctx, completion);
      metadata = result.metadata;
    } catch (err) {
      this.logError(def.type, 'buildResult', err);
    }

    // Dedup check
    const key = elementKey(ctx.trigger);
    if (this.isDuplicate(ctx, metadata, key)) {
      // 7.4-B3 S2: fold into the prior interaction instead of resurrecting.
      //
      // Pre-B3 this branch called releaseClaims, flipping the suppressed
      // gesture's events to 'unclaimed' → the Projection Engine minted an
      // Unclassified card for a click the system HAD recognized (F1: a Save
      // BUTTON ended "unrecognized" on a real-Chrome dump). The card lied
      // and the repeat information was lost.
      //
      // The fold keeps the honest outcome: the prior interaction gains the
      // suppressed gesture's discrete events as memberEvents (eventId-
      // guarded, same append-only pattern as 6F-M1 gesture ownership) and
      // metadata.repeatCount increments — the ledger entry stays 'claimed'
      // by the PRIOR interactionId, so projection mints no card.
      //
      // Degradation (pinned): after an SW restart lastInteractionByType is
      // empty (not serialized) while dedupByType IS restored — a duplicate
      // within that window falls back to suppress-and-release, the honest
      // Unclassified of the pre-B3 behavior.
      const prior = this.lastInteractionByType.get(ctx.type);
      if (prior) {
        this.foldIntoPrior(ctx, prior);
      } else {
        this.ledger?.releaseClaims(ctx.lifecycleId ?? '');
      }
      return null;
    }

    // Create interaction
    this.interactionCounter++;
    const interaction: ComponentInteraction = {
      interactionId: `int-${this.interactionCounter}`,
      lifecycleId: ctx.lifecycleId,
      type: ctx.type,
      trigger: ctx.trigger,
      triggerEvent: ctx.triggerEvent,
      memberEvents: [...ctx.memberEvents],
      startTime: ctx.startTime,
      endTime: ctx.endTime,
      endState: completion.endState,
      metadata,
    };

    // Update dedup record (per-type)
    this.dedupByType.set(ctx.type, {
      type: ctx.type,
      elementKey: key,
      endTime: ctx.endTime,
      metadata: { ...metadata },
      interactionId: interaction.interactionId,
    });
    // 7.4-B3 S2: fold target for subsequent duplicates of this type.
    this.lastInteractionByType.set(ctx.type, interaction);

    // Evidence Ledger disposition: claim or release all discrete member events
    if (this.ledger) {
      if (completion.endState === 'completed') {
        // Claim all discrete member events
        for (const ev of ctx.memberEvents) {
          if (DISCRETE_ACTION_TYPES.has(ev.eventType)) {
            this.ledger.setDisposition(ev.eventId, 'claimed', interaction.interactionId, ctx.type);
          }
        }
      } else {
        // Abandoned/interrupted — release all absorbed events for this lifecycle
        this.ledger.releaseClaims(ctx.lifecycleId ?? '');
      }
    }

    // 6F-M1 A: record mousedown-completed gestures for twin absorption.
    // The completing mousedown is the last member event (pushed before
    // handleEvent returned the completion). Type-generic: any definition
    // completing on mousedown participates — never DatePicker-specific.
    if (completion.endState === 'completed') {
      const completing = ctx.memberEvents[ctx.memberEvents.length - 1];
      if (completing && completing.eventType === 'mousedown') {
        // Any gesture record from an earlier mousedown on this page is now
        // superseded: a newer discrete event (this mousedown) intervened.
        for (const g of this.completedGestures) {
          if (g.pageId === pageIdOf(completing.eventId)) g.superseded = true;
        }
        this.completedGestures.push({
          pageId: pageIdOf(completing.eventId),
          elementKey: elementKey(completing.target),
          mousedownCaptureSeq: completing.captureSeq,
          superseded: false,
          lifecycleId: ctx.lifecycleId ?? '',
          interactionId: interaction.interactionId,
          interactionType: ctx.type,
          interaction,
        });
        if (this.completedGestures.length > this.MAX_GESTURE_RECORDS) {
          this.completedGestures.shift();
        }
      }
    }

    // Emit
    try {
      this.config.onEmit(interaction);
    } catch (err) {
      this.logError(def.type, 'onEmit', err);
    }

    return interaction;
  }

  /**
   * 7.4-B3 S2: fold a dedup-suppressed lifecycle into the prior emitted
   * interaction of the same type.
   *
   * - All discrete member events of the suppressed lifecycle are appended
   *   to the prior's memberEvents (eventId-guarded) and their ledger
   *   disposition set to 'claimed' by the PRIOR interactionId — projection
   *   therefore mints no Unclassified card for them.
   * - The gesture's press-half (the PENDING mousedown twin that preceded
   *   the suppressed click in ledger order on the same element) is claimed
   *   too. Without this, pairPhysicalPress cannot pair the pair (they are
   *   non-adjacent in the [...unclaimed, ...pending] projection order) and
   *   the twin surfaces as a separate Unclassified card — the int-17
   *   half-card observed on the B2 dump.
   * - metadata.repeatCount increments on the prior (repeat information is
   *   preserved, not lost).
   */
  private foldIntoPrior(ctx: ComponentContext, prior: ComponentInteraction): void {
    const memberIds = new Set((prior.memberEvents ?? []).map((e) => e.eventId));

    for (const ev of ctx.memberEvents) {
      if (!DISCRETE_ACTION_TYPES.has(ev.eventType)) continue;
      if (!memberIds.has(ev.eventId)) {
        prior.memberEvents.push(ev);
        memberIds.add(ev.eventId);
      }
      this.ledger?.setDisposition(ev.eventId, 'claimed', prior.interactionId, ctx.type);
    }

    // Press-half recovery: the immediately preceding PENDING mousedown on
    // the same element (ledger order, same page) belongs to this suppressed
    // gesture. Structural facts only — pageId + elementKey + adjacency in
    // the discrete-entry sequence, the same identity pairPhysicalPress uses.
    if (this.ledger) {
      const key = elementKey(ctx.trigger);
      const pageId = pageIdOf(ctx.triggerEvent?.eventId ?? '');
      const entries = this.ledger.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.eventId === ctx.triggerEvent?.eventId) continue;
        if (e.disposition !== 'pending') continue;
        if (e.eventType !== 'mousedown') break; // adjacency: stop at first non-twin
        if (pageIdOf(e.eventId) === pageId && ledgerEntryKey(e) === key) {
          if (!memberIds.has(e.eventId)) {
            // Materialize a memberEvent view of the twin from the ledger
            // entry (the ObservedEvent object is not retained here).
            prior.memberEvents.push({
              eventId: e.eventId,
              eventType: e.eventType,
              timestamp: e.timestamp,
              captureSeq: e.captureSeq,
              target: e.targetIdentity ?? (ctx.trigger as never),
              isTrusted: true,
            } as never);
            memberIds.add(e.eventId);
          }
          this.ledger.setDisposition(e.eventId, 'claimed', prior.interactionId, ctx.type);
        }
        break; // only the immediately preceding pending mousedown
      }
    }

    prior.metadata.repeatCount =
      (typeof prior.metadata.repeatCount === 'number' ? prior.metadata.repeatCount : 0) + 1;

    try {
      this.config.onDedupFold?.(prior, ctx);
    } catch (err) {
      this.logError(ctx.type, 'onDedupFold', err);
    }
  }

  /**
   * Check if this interaction is a duplicate of the last emitted interaction
   * of the SAME type. Per-type dedup prevents interleaved interactions of
   * different types from resetting the dedup window.
   *
   * Dedup rules:
   * - Same type + same elementKey + gap (endTime_prev → startTime_now) ≤ DEDUP_WINDOW_MS
   * - DatePicker: also compare selectedDate — same date = duplicate
   */
  private isDuplicate(
    ctx: ComponentContext,
    metadata: Record<string, unknown>,
    key: string,
  ): boolean {
    const last = this.dedupByType.get(ctx.type);
    if (!last) return false;

    // For Checkbox/RadioButton: elements with different elementKeys but
    // the same accessibleName within the dedup window are the same
    // logical toggle (e.g. clicking an OXD label fires a synthetic click
    // on the hidden input — two events, one user action).
    if (ctx.type === 'Checkbox' || ctx.type === 'RadioButton') {
      if (last.elementKey !== key) {
        const prevName = String(last.metadata.targetName ?? '');
        const newName = String(metadata.targetName ?? '');
        if (prevName && prevName === newName) {
          const gap = ctx.startTime - last.endTime;
          if (gap <= DEDUP_WINDOW_MS) return true;
        }
      }
    }

    if (last.elementKey !== key) return false;

    const gap = ctx.startTime - last.endTime;
    if (gap > DEDUP_WINDOW_MS) return false;

    // DatePicker-specific: also check selectedDate
    if (ctx.type === 'DatePicker') {
      const prevDate = last.metadata.selectedDate;
      const newDate = metadata.selectedDate;
      // If dates differ, NOT a duplicate even within the window
      if (prevDate !== newDate) return false;
    }

    // Scroll is exempt from temporal dedup — gesture coalescing already
    // prevents rapid-fire duplication. Two scroll gestures separated by
    // other interactions are always distinct, even on the same container.
    if (ctx.type === 'Scroll') return false;

    return true;
  }

  /**
   * Find the definition for a given interaction type.
   */
  private findDefForType(type: InteractionType): ComponentDefinition | null {
    return this.definitions.find((d) => d.type === type) ?? null;
  }

  /**
   * Track a seen event ID. Halve the set when it exceeds the cap.
   */
  private trackSeenEvent(eventId: string): void {
    this.seenEventIds.add(eventId);
    if (this.seenEventIds.size > SEEN_EVENTS_CAP) {
      const entries = [...this.seenEventIds];
      const half = entries.slice(Math.floor(entries.length / 2));
      this.seenEventIds = new Set(half);
    }
  }

  /**
   * Log an error from a definition method without crashing the runtime.
   */
  private logError(
    type: InteractionType,
    method: string,
    err: unknown,
  ): void {
    const msg = `[${type}.${method}] ${err instanceof Error ? err.message : String(err)}`;
    this.errorLog.push(msg);
  }
}
