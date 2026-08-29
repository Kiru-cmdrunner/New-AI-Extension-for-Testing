/**
 * Hover Definition — B7 observe-only model (7.4-B7 P2, 2026-08-28)
 *
 * Supersedes the confidence-model definition (evidence-based-hover.md era).
 * Spec: .drytis/specs/phase-7-4-b7-hover-evidence-observation.md §5.2.
 *
 * DOCTRINE (DC-1..DC-4): this definition OBSERVES a pointer gesture and
 * records facts. It never JUDGES meaning. Meaning is derived after the
 * fact from consequence evidence by the admission rule
 * (output-adapter.ts) and, later, by episodes/KR.
 *
 * Deleted in P2 (never to return — DC-6):
 *   - CONFIDENCE_THRESHOLD, HOVER_TRANSIT_THRESHOLD_MS, SUSTAINED_DWELL_MS,
 *     POINTER_STATIONARY_RADIUS_PX — no clock, no radius, no threshold
 *     decides anything.
 *   - OVERLAY_TRIGGER_ROLES, HOVER_POPUP_TYPES, OVERLAY_CSS_RE,
 *     NAV_ANCESTOR_RE — no site/class vocabulary.
 *   - metadata.meaningful / evidenceReason / confidence — no stored
 *     judgment. (The panel compat bridge re-derives `meaningful` in P2–P4.)
 *   - shouldCancelOnOutside — a click no longer cancels a hover; the click
 *     CONSUMES it (both are real user actions; both are recorded).
 *
 * Kept from P1:
 *   - Discovery gate: shared isInteractiveElement (structural, no vocab).
 *   - One lifecycle at a time (mouseenter trigger set).
 *   - applyMemberPolicy (W-6): mousemove members popped; pointer-path
 *     enters capped at MAX_POINTER_PATH_FACTS=20 drop-oldest with counted
 *     pointerPathDropped.
 *
 * Six structural terminals (§5.2.2), zero clocks:
 *   left              same-element mouseleave            → completed
 *   consumed-by-click any click anywhere (in-scope)      → completed
 *   navigation        shouldCompleteOnNavigation (P2)    → completed
 *   target-removed    TRIGGER_REMOVED window close (P1)  → completed
 *   recording-end     completesAtRecordingEnd → flush()  → completed
 *   idle-timeout      5-min cleanupStaleComponents       → abandoned
 *
 * Recorded FACTS (never judgments): terminal, dwellMs (display only),
 * pointer-path enters, revert fact (settle window, P1 evidence),
 * pointerPathDropped count.
 */

import type {
  ComponentDefinition,
  ComponentTrigger,
  ObservedEvent,
  ComponentCompletion,
  ComponentContext,
  ElementIdentity,
} from '../shared/component-types';
import { elementKey, isInteractiveElement } from './patterns';

/** B7 §6: max pointer-path facts kept as memberEvents (drop-oldest). */
export const MAX_POINTER_PATH_FACTS = 20;

/** Terminal names recorded as metadata.terminal (facts, not judgments). */
export type HoverTerminal =
  | 'left'
  | 'consumed-by-click'
  | 'navigation'
  | 'target-removed'
  | 'recording-end';

export const hoverDefinition: ComponentDefinition = {
  type: 'Hover',
  priority: 60,
  triggerEventTypes: new Set(['mouseenter']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // Structural discovery gate — the ONLY thing that starts a Hover.
    // Shared affordance predicate; zero vocabulary (F-2 stays fixed).
    if (event.eventType !== 'mouseenter') return null;
    const { tag, ariaRole, className } = event.target;
    const interactive = isInteractiveElement(
      tag,
      ariaRole,
      className,
      event.domContext?.tabIndex ?? null,
    );
    if (!interactive) return null;
    return { type: 'Hover' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // The gesture event family. P2 adds CLICK as an in-scope TERMINAL:
    // the click that consumes the hover completes it here (inside the
    // definition) instead of cancelling it from outside. The click still
    // flows to its own discovery (Click fallback) — see handleEvent's
    // fall-through note below.
    if (HOVER_TERMINAL_EVENTS.has(event.eventType)) return true;
    // Pointer-path fact: a discovery-gated enter on a nested interactive
    // element while the hover is active (B7-P1 semantics).
    if (event.eventType === 'mouseenter' && isHoverDiscoveryEnter(event)) return true;
    void ctx;
    return false;
  },

  handleEvent(
    event: ObservedEvent,
    ctx: ComponentContext,
  ): ComponentCompletion | null {
    const triggerKey = elementKey(ctx.trigger as ElementIdentity);

    if (event.eventType === 'mouseenter') {
      // P1/W-6 member policy runs from the runtime's memberEvents; nothing
      // to accumulate here — the enter IS the fact.
      return null;
    }

    if (event.eventType === 'mouseleave') {
      // Terminal "left": same-element leave. Foreign leaves are pointer
      // noise (blur-like) — the lifecycle continues.
      const leaveKey = elementKey(event.target);
      if (leaveKey === triggerKey) {
        recordTerminal(ctx, 'left');
        return { endState: 'completed' };
      }
      return null;
    }

    if (event.eventType === 'click' || event.eventType === 'contextmenu') {
      // Terminal "consumed-by-click": ANY click anywhere consumes the
      // hover. Both the hover and the click are real user actions; both
      // are recorded. The runtime's step-3 memberEvent push already
      // attached this click as a member — the projection coveredEventIds
      // suppression keys on memberEvents, so the click lifecycle claiming
      // the same eventId later is a no-op (terminal dispositions).
      recordTerminal(ctx, 'consumed-by-click');
      return { endState: 'completed' };
    }

    // mousemove: pointer-tracking noise — applyMemberPolicy pops it from
    // memberEvents after handleEvent returns (W-6).
    return null;
  },

  /**
   * B7-P2 §5.2.2: the consuming click is NOT retained — it falls through
   * to discovery and becomes its own Click interaction.
   */
  retainsDiscreteEvents: false,

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // B7-P2: DELETED semantics. No outside event cancels a hover — a click
    // CONSUMES it (in-scope terminal), a leave completes it (in-scope
    // terminal). The 5-min idle timeout is the only abandon path (leak
    // protection, not semantics). Kept as an explicit always-false to
    // honor the interface contract (callers consult hook EXISTENCE for
    // endState in B-2-sensitive paths — hover must never flip those).
    return false;
  },

  shouldCompleteOnNavigation(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Terminal "navigation" (B-2-safe: this hook fires ONLY from the nav
    // flush path, never from idle cleanup or plain flush).
    // Grounded in recorded state: the lifecycle existed and was live when
    // the navigation committed. No wall-clock comparison (DC-3).
    void event;
    const hasEnter = ctx.triggerEvent != null;
    if (!hasEnter) return false;
    recordTerminal(ctx, 'navigation');
    ctx.data.commitSignal = 'navigation';
    ctx.data.committedAt = ctx.triggerEvent?.captureSeq ?? null;
    return true;
  },

  /**
   * B7-P2 §5.2.2: declaring completesAtRecordingEnd makes flush() (STOP)
   * complete this lifecycle. The 5-min idle path does NOT consult this
   * declaration (B-2 split) — idle stays 'abandoned' with the
   * Unclassified twin as the honest floor.
   */
  completesAtRecordingEnd: true,

  /**
   * B7-P2 §5.2.2 T4 (target-removed): the trigger element's structural
   * removal from the DOM completes this lifecycle ('completed', terminal
   * 'target-removed'). The reveal's owner is gone — the hover has
   * nowhere to live — so the removal is a genuine structural terminal,
   * exactly like 'left'. Declared by Hover only; see
   * ComponentDefinition.completesOnTriggerRemoved.
   */
  completesOnTriggerRemoved: true,

  buildResult(
    ctx: ComponentContext,
    completion: ComponentCompletion,
  ): { metadata: Record<string, unknown> } {
    const enter = ctx.triggerEvent;
    const start = enter?.timestamp ?? ctx.startTime;
    const end = ctx.endTime;
    const dwellMs = typeof end === 'number' && typeof start === 'number'
      ? Math.max(0, end - start)
      : 0;

    const enters = (ctx.memberEvents ?? []).filter(
      (e) => e.eventType === 'mouseenter',
    );

    return {
      metadata: {
        targetName: nameOf(ctx.trigger as ElementIdentity),
        dwellMs, // recorded FACT — display only, never a gate (§5.2.1)
        terminal: (ctx.data.terminal as HoverTerminal | undefined) ?? null,
        // commit metadata (nav terminal only — mirrors TextEntry B6.1)
        ...(ctx.data.commitSignal === 'navigation'
          ? { commitSignal: 'navigation' as const }
          : {}),
        pointerPathEnters: enters.map((e) => ({
          eventId: e.eventId,
          target: e.target,
        })),
        pointerPathDropped: ctx.data.pointerPathDropped ?? 0,
        // endState fact for the P1 settle-metadata remap seam.
        lifecycleEndState: completion.endState,
      },
    };
  },

  /**
   * B7-P1 (W-6): definition-local member policy. Called by the runtime
   * AFTER memberEvents are pushed, inside the hover's own call frame:
   *   - pops mousemove members (pointer noise; the gesture fact is the
   *     enter/leave pair, not the jitter between them);
   *   - caps pointer-path enters at MAX_POINTER_PATH_FACTS drop-oldest,
   *     counting drops in ctx.data.pointerPathDropped (counted, never
   *     silent).
   */
  applyMemberPolicy(ctx: ComponentContext): void {
    const members = ctx.memberEvents ?? [];
    // Pop mousemoves (the runtime pushed them before handleEvent).
    for (let i = members.length - 1; i >= 0; i--) {
      if (members[i].eventType === 'mousemove') members.splice(i, 1);
    }
    // Cap enters, drop-oldest, count the drops.
    const enterIdx = [];
    for (let i = 0; i < members.length; i++) {
      if (members[i].eventType === 'mouseenter') enterIdx.push(i);
    }
    if (enterIdx.length > MAX_POINTER_PATH_FACTS) {
      const overflow = enterIdx.length - MAX_POINTER_PATH_FACTS;
      const drop = new Set(enterIdx.slice(0, overflow));
      for (let i = members.length - 1; i >= 0; i--) {
        if (drop.has(i)) members.splice(i, 1);
      }
      ctx.data.pointerPathDropped =
        (typeof ctx.data.pointerPathDropped === 'number' ? ctx.data.pointerPathDropped : 0) + overflow;
    }
  },
};

// ── Internal helpers ─────────────────────────────────────────────────

const HOVER_TERMINAL_EVENTS = new Set<string>([
  'mouseenter',
  'mouseleave',
  'click',
  'contextmenu',
]);

function isHoverDiscoveryEnter(event: ObservedEvent): boolean {
  if (event.eventType !== 'mouseenter') return false;
  const { tag, ariaRole, className } = event.target;
  return isInteractiveElement(
    tag,
    ariaRole,
    className,
    event.domContext?.tabIndex ?? null,
  );
}

function recordTerminal(ctx: ComponentContext, terminal: HoverTerminal): void {
  ctx.data.terminal = terminal;
}

function nameOf(t: ElementIdentity | null | undefined): string {
  if (!t) return '';
  return t.accessibleName || t.ariaLabel || t.tag || '';
}
