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
  SurfaceEntry,
} from '../shared/component-types';
import { DEDUP_WINDOW_MS } from '../shared/component-types';
import { elementKey, isInsideDropdownSurface, isInsideCalendarSurface } from '../definitions/patterns';

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

// ── Factory ───────────────────────────────────────────────────────────

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

  private activeStack: ComponentContext[] = [];
  private seenEventIds: Set<string> = new Set();
  private interactionCounter: number;
  /** Per-type dedup: tracks the last interaction of each type independently. */
  private dedupByType: Map<InteractionType, DedupRecord> = new Map();
  private errorLog: string[] = [];
  /** Surface stack — tracks open surfaces for session-surface binding.
   *  Ordered by appearance time, newest at top (end of array).
   *  Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §11.4 */
  private surfaceStack: SurfaceEntry[] = [];

  constructor(definitions: ComponentDefinition[], config: RuntimeConfig) {
    // Sort by priority ascending (lower number = higher priority = checked first).
    // Click (180) is the universal fallback — always checked last.
    this.definitions = [...definitions].sort((a, b) => a.priority - b.priority);
    this.config = config;
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

    // 2. Navigation flush — close all surfaces, flush active sessions
    if (event.eventType === ('navigation' as string)) {
      this.closeAllSurfaces(emitted, event.timestamp);
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

    // 2c. Surface tracking — register new surfaces and bind to sessions.
    //     Phase 0b: when an event carries a surfaceId not yet in the surface
    //     stack, register it and bind it to the most recent unbound session.
    this.trackSurface(event);

    // 2d. Surface closure detection — if a surface's events are no longer
    //     appearing (outside-click pattern), close it and complete its sessions.
    this.detectSurfaceClosure(event, emitted);

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
        handled = true;
        // Add event to member events
        ctx.memberEvents.push(event);

        let completion: ComponentCompletion | null = null;
        try {
          completion = def.handleEvent(event, ctx);
        } catch (err) {
          this.logError(def.type, 'handleEvent', err);
        }

        if (completion) {
          ctx.state = completion.endState;
          ctx.endTime = event.timestamp;
          const interaction = this.completeComponent(ctx, def, completion);
          if (interaction) emitted.push(interaction);
          // Remove from stack
          this.activeStack.splice(i, 1);
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
      // Phase 0b: Concurrent session resolution.
      // Before allowing a new session to start, check if it would conflict
      // with an existing session on the active stack. If the new trigger is
      // outside the existing session's surface, interrupt the existing session.
      this.resolveConcurrentSessions(event, emitted);

      const newCtx = this.tryDiscovery(event);
      if (newCtx) {
        this.activeStack.push(newCtx);
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
            const interaction = this.completeComponent(newCtx, def, completion);
            if (interaction) emitted.push(interaction);
            this.activeStack.pop();
          }
        }
      }
    }

    return emitted;
  }

  flush(): ComponentInteraction[] {
    // Phase 0b: clear surface stack on flush
    this.surfaceStack = [];
    const emitted: ComponentInteraction[] = [];
    for (let i = this.activeStack.length - 1; i >= 0; i--) {
      const ctx = this.activeStack[i];
      const def = this.findDefForType(ctx.type);
      // Components that explicitly want flush-completion (e.g., Scroll has
      // accumulated data) are completed. All others are interrupted.
      const endState = def?.shouldCompleteOnFlush?.(ctx) ? 'completed' : 'interrupted';
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
   *
   * Phase 0b: Populates insideSurface from the trigger event's domContext.surfaceId.
   * If the trigger occurred inside an already-open surface (e.g., a dropdown
   * inside a modal), insideSurface binds this session to that surface.
   */
  private createContext(
    def: ComponentDefinition,
    event: ObservedEvent,
  ): ComponentContext {
    return {
      type: def.type,
      state: 'active',
      trigger: event.target,
      triggerEvent: event,
      memberEvents: [event],
      scopeKeys: new Set([elementKey(event.target)]),
      startTime: event.timestamp,
      endTime: 0,
      data: {},
      // Phase 0b: surface binding
      insideSurface: event.domContext.surfaceId ?? null,
      openedSurface: null, // set later when the surface this session opens is detected
    };
  }

  /**
   * Complete a component: build result, dedup, emit.
   * Returns the interaction if emitted, null if suppressed by dedup.
   */
  private completeComponent(
    ctx: ComponentContext,
    def: ComponentDefinition,
    completion: ComponentCompletion,
  ): ComponentInteraction | null {
    // ── Downcast protocol ──
    // If the component is about to be completed with a non-completed
    // endState (interrupted or abandoned), ask the definition if it
    // should be converted to a simpler interaction type.
    // E.g., a Dropdown that opened on a false-positive trigger (no panel
    // opened, no option selected) downcasts to Click so the user's action
    // remains visible instead of being filtered out.
    if (
      completion.endState !== 'completed' &&
      def.downcast &&
      ctx.type !== 'Click' // never downcast a Click
    ) {
      try {
        const downcastType = def.downcast(ctx, completion);
        if (downcastType && downcastType !== ctx.type) {
          const targetDef = this.findDefForType(downcastType);
          if (targetDef) {
            // Mutate ctx so the emitted interaction carries the
            // downcast type and the target def's metadata.
            ctx.type = downcastType;
            ctx.data = {}; // fresh data bag for the target definition
            return this.completeComponent(ctx, targetDef, {
              ...completion,
              endState: 'completed',
            });
          }
        }
      } catch (err) {
        this.logError(def.type, 'downcast', err);
      }
    }

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
      return null;
    }

    // Create interaction
    this.interactionCounter++;
    const interaction: ComponentInteraction = {
      interactionId: `int-${this.interactionCounter}`,
      type: ctx.type,
      // Allow definitions to set a fine-grained subtype via ctx.data
      interactionSubtype: (ctx.data.interactionSubtype as string) || undefined,
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

    // DatePicker cross-element dedup: a calendar cell click (trigger = cell)
    // followed by a synthetic change event on the date input (trigger = input)
    // within the dedup window is the SAME user action. The post-click value
    // poll fires a supplementary change event that triggers a new DatePicker
    // lifecycle on the input element. Without this check, the dedup fails
    // at the elementKey comparison (cell ≠ input) and a duplicate interaction
    // is emitted.
    if (ctx.type === 'DatePicker' && last.elementKey !== key) {
      const gap = ctx.startTime - last.endTime;
      if (gap <= DEDUP_WINDOW_MS) {
        // Both are DatePicker interactions within the window but on different
        // elements (calendar cell vs date input). Check if the selectedDate
        // or dateValue match — if so, suppress the duplicate.
        const prevDate = String(last.metadata.selectedDate ?? last.metadata.dateValue ?? '');
        const newDate = String(metadata.selectedDate ?? metadata.dateValue ?? '');
        // If either date value is empty, we can't compare — let the normal
        // flow handle it (will fail elementKey check and emit).
        if (prevDate && newDate) {
          // Direct match
          if (prevDate === newDate) return true;
          // One may be the accessible name format ("Choose Thursday, August 27th")
          // and the other the input value format ("27/08/2026"). If they share
          // a common date substring (day number), treat as duplicate.
          // Extract day numbers and compare.
          const prevDay = prevDate.match(/\b(\d{1,2})\b/);
          const newDay = newDate.match(/\b(\d{1,2})\b/);
          if (prevDay && newDay && prevDay[1] === newDay[1]) {
            return true;
          }
        }
      }
      // Different elements, can't confirm duplicate — fall through to normal
      // elementKey check which will return false.
    }

    if (last.elementKey !== key) return false;

    const gap = ctx.startTime - last.endTime;
    if (gap > DEDUP_WINDOW_MS) return false;

    // DatePicker same-element dedup: also check dateValue.
    // dateValue is the canonical date string from valueAfter — it's the
    // reliable dedup key. selectedDate is the display name which may differ
    // between a cell click ('27') and a change event ('2026-07-27').
    // We compare dateValue only for same-element dedup.
    if (ctx.type === 'DatePicker') {
      const prevDate = String(last.metadata.dateValue ?? '');
      const newDate = String(metadata.dateValue ?? '');
      // If both have dateValues and they differ, NOT a duplicate
      if (prevDate && newDate && prevDate !== newDate) return false;
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

  // ── Surface Management (Phase 0b: Observation Model) ──────────────────

  /**
   * Track surface appearance in the surface stack.
   *
   * When an event carries a surfaceId that isn't in the surface stack yet,
   * register it. Then bind it to the most recent active session that:
   *   - has openedSurface === null
   *   - doesn't have an insideSurface (i.e., it's a base-page session)
   *   - is surface-creating (Dropdown, DatePicker — determined by type)
   *
   * Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §11.4
   */
  private trackSurface(event: ObservedEvent): void {
    const surfaceId = event.domContext.surfaceId;
    if (!surfaceId) return;

    // Already tracked?
    const existing = this.surfaceStack.find((s) => s.surfaceId === surfaceId);
    if (existing) return; // already known

    // Register the new surface
    const entry: SurfaceEntry = {
      surfaceId,
      type: event.domContext.surfaceType ?? 'unknown',
      role: event.domContext.surfaceRole ?? null,
      label: event.domContext.surfaceLabel ?? null,
      openedByEventId: null, // will be bound to session trigger below
      openedAt: event.timestamp,
      closedAt: null,
    };

    // Try to bind to the most recent unbound surface-creating session.
    // Type-aware binding: each session type only binds compatible surface types.
    // This prevents ModalDialog from stealing listbox/grid surfaces meant for
    // Dropdown/DatePicker, and vice versa.
    const SURFACE_CREATING_TYPES: InteractionType[] = ['Dropdown', 'DatePicker', 'ModalDialog'];

    // Define which surface types each interaction type can claim.
    // Dropdown → popover surfaces (option lists, menus, listboxes — all typed as 'popover')
    // DatePicker → popover surfaces (calendars/grids also typed as 'popover')
    // ModalDialog → modal surfaces only (role=dialog, aria-modal=true, <dialog>)
    const SURFACE_COMPAT: Record<string, Set<string>> = {
      Dropdown: new Set(['popover']),
      DatePicker: new Set(['popover']),
      ModalDialog: new Set(['modal', 'drawer']),
    };

    const surfaceType = entry.type;

    for (let i = this.activeStack.length - 1; i >= 0; i--) {
      const ctx = this.activeStack[i];
      if (
        ctx.openedSurface === null &&
        ctx.insideSurface === null &&
        SURFACE_CREATING_TYPES.includes(ctx.type)
      ) {
        // Type-aware filtering: skip sessions that can't claim this surface type
        const compatTypes = SURFACE_COMPAT[ctx.type];
        if (compatTypes && !compatTypes.has(surfaceType)) continue;

        ctx.openedSurface = surfaceId;
        entry.openedByEventId = ctx.triggerEvent.eventId;
        break;
      }
    }

    this.surfaceStack.push(entry);
  }

  /**
   * Detect surface closure and complete sessions bound to closed surfaces.
   *
   * A surface is considered closed when an outside click occurs — an event
   * that is NOT inside any surface AND there are surface-creating sessions
   * on the active stack. The session(s) whose openedSurface matches the
   * surface are completed.
   *
   * Phase 0b update: also handles CSS-class fallback sessions that don't
   * have a surfaceId. For these sessions, a base-page click still completes
   * them (the user clicked away from the dropdown surface).
   */
  private detectSurfaceClosure(
    event: ObservedEvent,
    emitted: ComponentInteraction[],
  ): void {
    // Only clicks can close surfaces
    if (event.eventType !== 'click' && event.eventType !== 'mousedown') return;

    // If the event is inside a surface, it's not a closure
    const eventSurfaceId = event.domContext.surfaceId;
    if (eventSurfaceId) return;

    // If there are no open surfaces, nothing to close via surfaceId
    // But we may still need to close CSS-class-fallback sessions
    const SURFACE_CREATING_TYPES: InteractionType[] = ['Dropdown', 'DatePicker', 'ModalDialog'];

    for (let i = this.activeStack.length - 1; i >= 0; i--) {
      const ctx = this.activeStack[i];
      if (!SURFACE_CREATING_TYPES.includes(ctx.type)) continue;

      if (ctx.openedSurface) {
        // SurfaceId-based session: close it
        const def = this.findDefForType(ctx.type);
        ctx.state = 'completed';
        ctx.endTime = event.timestamp;
        if (def) {
          const interaction = this.completeComponent(ctx, def, {
            endState: 'completed',
          });
          if (interaction) emitted.push(interaction);
        }

        // Mark the surface as closed
        const surface = this.surfaceStack.find(
          (s) => s.surfaceId === ctx.openedSurface,
        );
        if (surface) surface.closedAt = event.timestamp;

        // Remove from active stack
        this.activeStack.splice(i, 1);
      } else if (ctx.insideSurface === null) {
        // CSS-class fallback session (no surfaceId ever set).
        // A base-page click means the user clicked away from the surface.
        // Only complete if the session has accumulated selections — otherwise
        // it's a no-op (user opened dropdown and clicked away without selecting).
        const hasSelections = Array.isArray(ctx.data.allSelections) &&
          (ctx.data.allSelections as string[]).length > 0;

        // Phase 0e Fix: Don't close the session on a Done/Apply/Confirm button
        // click. The Done button may not match the surface CSS class patterns,
        // but it's still inside the dropdown panel. The Dropdown definition's
        // handleEvent will complete the session when it processes this event.
        const targetName = (event.target.accessibleName || event.target.ariaLabel || '').trim().toLowerCase();
        const isConfirmButton = /^(done|apply|confirm|ok|close|save|update|continue|search)$/.test(targetName);
        if (isConfirmButton) continue; // Skip closure — let the session handle it

        // Stepper button protection: Don't close the session when the user
        // clicks a +/- stepper button. Icon-only stepper buttons (SVG icon, no
        // text, no aria-label) won't match the surface CSS class patterns, so
        // without this guard the session would be prematurely completed —
        // swallowing the stepper click. The Dropdown definition's handleEvent
        // will capture it as an increment/decrement subAction.
        const targetClassName = event.target.className || '';
        const stepperLabel = `${event.target.accessibleName || ''} ${event.target.ariaLabel || ''}`.trim();
        const isStepperButton =
          /^\s*\+\s*$/.test(stepperLabel) || /^\s*-\s*$/.test(stepperLabel) ||
          /(?:^|\s|\b)(?:increase|add|plus|decrease|remove|minus|less)(?:\s|$|\b)/i.test(stepperLabel) ||
          (targetClassName && /(?:plus|minus|increment|decrement|add-btn|remove-btn|counter-plus|counter-minus|stepper-plus|stepper-minus|pax-plus|pax-minus|qty-plus|qty-minus|inc-btn|dec-btn|increase|decrease)/i.test(targetClassName));
        if (isStepperButton) continue;

        // BUT: don't close if the click is actually INSIDE the surface (detected
        // by CSS class). This prevents premature closure when the user clicks
        // an in-surface element (Done button, stepper, etc.) that doesn't have
        // a surfaceId but IS inside the surface by CSS class matching.
        const isInsideSurfaceByClass =
          isInsideDropdownSurface(event.target.className) ||
          isInsideDropdownSurface(event.domContext.ancestorClasses.join(' ')) ||
          isInsideCalendarSurface(event.target.className) ||
          isInsideCalendarSurface(event.domContext.ancestorClasses.join(' '));
        if (hasSelections && !isInsideSurfaceByClass) {
          const def = this.findDefForType(ctx.type);
          ctx.state = 'completed';
          ctx.endTime = event.timestamp;
          if (def) {
            const interaction = this.completeComponent(ctx, def, {
              endState: 'completed',
            });
            if (interaction) emitted.push(interaction);
          }
          this.activeStack.splice(i, 1);
        }
      }
    }

    // Clean up closed surfaces from the stack
    this.surfaceStack = this.surfaceStack.filter((s) => s.closedAt === null);
  }

  /**
   * Close all surfaces (called on navigation or flush).
   */
  private closeAllSurfaces(
    _emitted: ComponentInteraction[],
    timestamp: number,
  ): void {
    for (const s of this.surfaceStack) {
      if (s.closedAt === null) s.closedAt = timestamp;
    }
    this.surfaceStack = [];
  }

  /**
   * Concurrent session resolution — interrupt sessions that conflict
   * with a new trigger about to be discovered.
   *
   * Rules (Observation Model §11.5):
   * 1. If a new trigger event is inside a surface, and there's an active
   *    session whose openedSurface is a DIFFERENT surface, interrupt the
   *    old session (the user moved to a different surface).
   * 2. If a new trigger event is NOT inside any surface (base page), and
   *    there's an active session that opened a surface, complete that
   *    session (the user clicked away from the surface).
   *    (This is also handled by detectSurfaceClosure for clicks, but this
   *    catches non-click triggers too — e.g., focusing a base-page input.)
   *
   * Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §11.5
   */
  private resolveConcurrentSessions(
    event: ObservedEvent,
    emitted: ComponentInteraction[],
  ): void {
    const eventSurfaceId = event.domContext.surfaceId ?? null;

    for (let i = this.activeStack.length - 1; i >= 0; i--) {
      const ctx = this.activeStack[i];
      const hasOpenedSurface = ctx.openedSurface !== null;
      const isInsideSurface = ctx.insideSurface !== null;

      // Skip sessions that are inside a surface (nested) — they don't conflict
      if (isInsideSurface) continue;

      // Skip sessions that haven't opened a surface — they can't cross-wire
      // via surfaceId. BUT: CSS-class fallback Dropdown/DatePicker sessions
      // don't have openedSurface set. A new base-page trigger should still
      // complete them.
      if (!hasOpenedSurface) {
        const SURFACE_CREATING_TYPES: InteractionType[] = ['Dropdown', 'DatePicker', 'ModalDialog'];
        if (SURFACE_CREATING_TYPES.includes(ctx.type) && eventSurfaceId === null) {
          // CSS-class fallback session + new base-page trigger → complete it
          // Only if it has accumulated selections
          const hasSelections = Array.isArray(ctx.data.allSelections) &&
            (ctx.data.allSelections as string[]).length > 0;
          if (hasSelections) {
            const def = this.findDefForType(ctx.type);
            ctx.state = 'completed';
            ctx.endTime = event.timestamp;
            if (def) {
              const interaction = this.completeComponent(ctx, def, {
                endState: 'completed',
              });
              if (interaction) emitted.push(interaction);
            }
            this.activeStack.splice(i, 1);
          }
        }
        continue;
      }

      if (eventSurfaceId === null) {
        // New trigger is on the base page, but there's a session that opened
        // a surface. This means the user interacted outside the surface.
        // Complete the surface-creating session.
        const def = this.findDefForType(ctx.type);
        ctx.state = 'completed';
        ctx.endTime = event.timestamp;
        if (def) {
          const interaction = this.completeComponent(ctx, def, {
            endState: 'completed',
          });
          if (interaction) emitted.push(interaction);
        }

        // Close the surface
        const surface = this.surfaceStack.find(
          (s) => s.surfaceId === ctx.openedSurface,
        );
        if (surface) surface.closedAt = event.timestamp;

        this.activeStack.splice(i, 1);
      } else if (eventSurfaceId !== ctx.openedSurface) {
        // New trigger is inside a DIFFERENT surface than the one this session
        // opened. The user moved to a different surface. Interrupt the old session.
        const def = this.findDefForType(ctx.type);
        ctx.state = 'interrupted';
        ctx.endTime = event.timestamp;
        if (def) {
          const interaction = this.completeComponent(ctx, def, {
            endState: 'interrupted',
          });
          if (interaction) emitted.push(interaction);
        }

        // Close the old surface
        const surface = this.surfaceStack.find(
          (s) => s.surfaceId === ctx.openedSurface,
        );
        if (surface) surface.closedAt = event.timestamp;

        this.activeStack.splice(i, 1);
      }
      // else: same surface — no conflict, coexist
    }

    // Clean up closed surfaces
    this.surfaceStack = this.surfaceStack.filter((s) => s.closedAt === null);
  }
}
