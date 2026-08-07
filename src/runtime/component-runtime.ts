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
} from '../shared/component-types';
import { DEDUP_WINDOW_MS } from '../shared/component-types';
import { elementKey } from '../definitions/patterns';
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
 * Maximum duration (ms) an active component can remain on the stack without
 * completing. Prevents zombie components from blocking discovery indefinitely.
 * Framework-independent: doesn't rely on DOM boundary heuristics.
 */
const MAX_LIFECYCLE_DURATION_MS = 15_000;

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
 */
function lifecycleOwnsTarget(
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
  if (!event.domContext.ancestorRoles.includes(surfaceRole)) {
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
  private errorLog: string[] = [];

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
   * Abandon active components that have exceeded MAX_LIFECYCLE_DURATION_MS.
   * This is the framework-independent lifecycle management mechanism —
   * no DOM boundary checks, no CSS class heuristics.
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
      const duration = event.timestamp - ctx.startTime;
      if (duration > MAX_LIFECYCLE_DURATION_MS) {
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
    return {
      type: def.type,
      lifecycleId: `lc-${++this.lifecycleCounter}`,
      state: 'active',
      trigger: event.target,
      triggerEvent: event,
      memberEvents: [event],
      scopeKeys: new Set([elementKey(event.target)]),
      startTime: event.timestamp,
      endTime: 0,
      data: {},
    };
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
      // Suppressed by dedup — release all absorbed events for this lifecycle.
      // The events were absorbed but no completed interaction backs them.
      this.ledger?.releaseClaims(ctx.lifecycleId);
      return null;
    }

    // Create interaction
    this.interactionCounter++;
    const interaction: ComponentInteraction = {
      interactionId: `int-${this.interactionCounter}`,
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
    });

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
        this.ledger.releaseClaims(ctx.lifecycleId);
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
