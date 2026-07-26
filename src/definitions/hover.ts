/**
 * Hover Definition — Confidence-Based Candidate (Priority 60)
 *
 * Unlike Click or TextEntry, a mouseenter alone does not represent user
 * intent. The pointer may be transiting through elements on its way to a
 * destination. Hover is therefore a CANDIDATE interaction — it starts on
 * mouseenter but is NOT emitted until accumulated evidence confidence
 * exceeds the promotion threshold.
 *
 * ## Confidence Model
 *
 * Evidence signals contribute weighted confidence:
 *
 *   Signal                           Confidence
 *   ───────────────────────────────  ──────────
 *   aria-expanded false→true         100  (Very High)
 *   Overlay role + dwell ≥ 500ms      70  (High)
 *   aria-haspopup + dwell ≥ 500ms     60  (High)
 *   Sustained dwell ≥3s + stationary  50  (Medium — fallback)
 *   Transit (< 500ms, no evidence)     0  (None)
 *
 * Promotion threshold: confidence ≥ 50
 *
 * Dwell is the WEAKEST form of evidence — it only counts when combined
 * with pointer stationarity (< 10px movement) and a longer threshold (3s).
 * This prevents false positives from thinking pauses over disabled buttons.
 *
 * ## Lifecycle
 *
 *   mouseenter → candidate (confidence = 0)
 *     ├── mouseleave + confidence ≥ threshold → emit completed Hover
 *     ├── mouseleave + confidence < threshold → discard silently
 *     ├── click on same element → discard (Click takes precedence)
 *     └── click elsewhere → discard (user moved on)
 *
 * Spec: .drytis/specs/evidence-based-hover.md
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import {
  isInteractiveElement,
  bestName,
} from './patterns';

// ── Confidence Weights ────────────────────────────────────────────────

/** Direct proof the UI expanded — highest possible evidence. */
const CONFIDENCE_ARIA_EXPANDED = 100;

/** Element is part of an overlay system (menuitem, tooltip, tab) + dwell. */
const CONFIDENCE_OVERLAY_ROLE = 70;

/** Element declares popup capability via aria-haspopup + dwell. */
const CONFIDENCE_HASPOPUP = 60;

/** Fallback: sustained dwell + pointer stationarity. Weakest evidence. */
const CONFIDENCE_SUSTAINED_DWELL = 50;

/** Minimum accumulated confidence to promote hover to meaningful. */
const CONFIDENCE_THRESHOLD = 50;

// ── Timing & Movement Thresholds ──────────────────────────────────────

/** Hovers shorter than this are always discarded (transit). */
const HOVER_TRANSIT_THRESHOLD_MS = 500;

/** Dwell duration required for fallback confidence (dwell alone is weak). */
const SUSTAINED_DWELL_MS = 3000;

/** Max pointer displacement (px) from initial position to count as "stationary". */
const POINTER_STATIONARY_RADIUS_PX = 10;

// ── Pattern Sets ──────────────────────────────────────────────────────

/**
 * Roles that indicate an element participates in an overlay system.
 * Hovering these with sufficient dwell is strong evidence of intent.
 */
const OVERLAY_TRIGGER_ROLES = new Set([
  'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tooltip', 'tab',
]);

/**
 * aria-haspopup values that indicate a hover-triggered overlay.
 */
const HOVER_POPUP_TYPES = new Set([
  'menu', 'listbox', 'dialog', 'tooltip', 'tree', 'grid',
]);

/**
 * Events that belong to the hover lifecycle. Only these are claimed by
 * isInScope — click/mousedown/focus/blur/input/change are explicitly
 * excluded so they fall through to their own definitions.
 */
const HOVER_LIFECYCLE_EVENTS = new Set<BrowserEventType>([
  'mouseenter', 'mouseleave', 'mousemove',
]);

// ── Definition ────────────────────────────────────────────────────────

export const hoverDefinition: ComponentDefinition = {
  type: 'Hover',
  priority: 60,
  triggerEventTypes: new Set<BrowserEventType>(['mouseenter']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'mouseenter') return null;

    const { tag, ariaRole, className } = event.target;
    if (!isInteractiveElement(tag, ariaRole, className, null)) {
      return null;
    }

    return { type: 'Hover' };
  },

  isInScope(event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Only claim hover-lifecycle events. This is critical:
    // click/mousedown/focus/blur must fall through to their own definitions.
    return HOVER_LIFECYCLE_EVENTS.has(event.eventType);
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // ── Initialize pointer tracking on first event ──
    if (ctx.data.pointerOriginX === undefined && event.clientX !== null) {
      ctx.data.pointerOriginX = event.clientX;
      ctx.data.pointerOriginY = event.clientY;
      ctx.data.maxDisplacement = 0;
    }

    // ── Accumulate evidence on every in-scope event ──
    accumulateEvidence(event, ctx);

    // ── mouseleave: decide emit vs discard ──
    if (event.eventType === 'mouseleave') {
      const sameElement = event.target.stableId === ctx.trigger.stableId
        || event.target.cssSelector === ctx.trigger.cssSelector;

      if (sameElement) {
        const dwell = event.timestamp - ctx.startTime;
        ctx.data.dwellMs = dwell;

        const confidence = (ctx.data.confidence as number) ?? 0;
        if (confidence >= CONFIDENCE_THRESHOLD) {
          ctx.data.meaningful = true;
          return { endState: 'completed' };
        }

        // Not enough evidence — discard silently
        return { endState: 'discarded' };
      }
      return null; // mouseleave on different element, ignore
    }

    // ── mousemove: track pointer stationarity ──
    if (event.eventType === 'mousemove') {
      trackPointerMovement(event, ctx);
      // Re-check evidence after updating pointer state
      accumulateEvidence(event, ctx);
    }

    return null; // still active
  },

  shouldCancelOnOutside(event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Click anywhere → discard the hover candidate.
    // If on same element: Click takes precedence via discovery.
    // If on different element: user moved on.
    if (event.eventType === 'click') {
      return true;
    }
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    return {
      metadata: {
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
        ),
        dwellMs: (ctx.data.dwellMs as number) ?? 0,
        meaningful: ctx.data.meaningful === true,
        confidence: (ctx.data.confidence as number) ?? 0,
        evidenceReason: (ctx.data.evidenceReason as string) ?? null,
      },
    };
  },
};

// ── Evidence Accumulation ─────────────────────────────────────────────

/**
 * Evaluate evidence signals and accumulate confidence.
 * Called on every in-scope event (mouseenter, mousemove, mouseleave).
 *
 * Once a signal fires, its confidence is added permanently — it doesn't
 * decay. Multiple signals stack (e.g. aria-haspopup + sustained dwell).
 * However, each unique signal type only contributes once.
 */
function accumulateEvidence(event: ObservedEvent, ctx: ComponentContext): void {
  const confidence = (ctx.data.confidence as number) ?? 0;
  const dwell = event.timestamp - ctx.startTime;

  // ── Signal 1: aria-expanded transition (Very High = 100) ──
  if (ctx.data.evidenceAriaExpanded !== true) {
    if (event.domContext.ariaExpanded === true) {
      const triggerExpanded = ctx.triggerEvent.domContext.ariaExpanded;
      if (triggerExpanded !== true) {
        ctx.data.confidence = confidence + CONFIDENCE_ARIA_EXPANDED;
        ctx.data.evidenceAriaExpanded = true;
        setReason(ctx, 'aria-expanded');
        return; // 100 ≥ threshold, done
      }
    }
  }

  // ── Signal 2: overlay role + dwell ≥ threshold (High = 70) ──
  if (ctx.data.evidenceOverlayRole !== true && dwell >= HOVER_TRANSIT_THRESHOLD_MS) {
    const triggerRole = ctx.triggerEvent.target.ariaRole;
    const ancestorRoles = ctx.triggerEvent.domContext.ancestorRoles ?? [];
    const hasOverlayRole =
      (triggerRole && OVERLAY_TRIGGER_ROLES.has(triggerRole)) ||
      ancestorRoles.some((r) => OVERLAY_TRIGGER_ROLES.has(r));
    if (hasOverlayRole) {
      ctx.data.confidence = ((ctx.data.confidence as number) ?? 0) + CONFIDENCE_OVERLAY_ROLE;
      ctx.data.evidenceOverlayRole = true;
      setReason(ctx, 'overlay-role-dwell');
      return;
    }
  }

  // ── Signal 3: aria-haspopup + dwell ≥ threshold (High = 60) ──
  if (ctx.data.evidenceHasPopup !== true && dwell >= HOVER_TRANSIT_THRESHOLD_MS) {
    const hasPopup = ctx.triggerEvent.domContext.ariaHasPopup;
    if (hasPopup && HOVER_POPUP_TYPES.has(hasPopup)) {
      ctx.data.confidence = ((ctx.data.confidence as number) ?? 0) + CONFIDENCE_HASPOPUP;
      ctx.data.evidenceHasPopup = true;
      setReason(ctx, 'haspopup-dwell');
      return;
    }
  }

  // ── Signal 4: sustained dwell + pointer stationary (Medium = 50) ──
  // This is FALLBACK evidence — the weakest signal. Only fires when:
  //   - dwell ≥ SUSTAINED_DWELL_MS (3s)
  //   - pointer stayed within POINTER_STATIONARY_RADIUS_PX of origin
  if (ctx.data.evidenceSustainedDwell !== true && dwell >= SUSTAINED_DWELL_MS) {
    const maxDisplacement = (ctx.data.maxDisplacement as number) ?? 999;
    if (maxDisplacement <= POINTER_STATIONARY_RADIUS_PX) {
      ctx.data.confidence = ((ctx.data.confidence as number) ?? 0) + CONFIDENCE_SUSTAINED_DWELL;
      ctx.data.evidenceSustainedDwell = true;
      setReason(ctx, 'sustained-dwell-stationary');
      return;
    }
  }
}

/**
 * Track pointer displacement from the origin position.
 * Updates maxDisplacement if this mousemove is farther from origin.
 */
function trackPointerMovement(event: ObservedEvent, ctx: ComponentContext): void {
  if (event.clientX === null || event.clientY === null) return;

  const originX = (ctx.data.pointerOriginX as number) ?? event.clientX;
  const originY = (ctx.data.pointerOriginY as number) ?? event.clientY;

  const dx = event.clientX - originX;
  const dy = event.clientY - originY;
  const displacement = Math.sqrt(dx * dx + dy * dy);

  const prevMax = (ctx.data.maxDisplacement as number) ?? 0;
  if (displacement > prevMax) {
    ctx.data.maxDisplacement = displacement;
  }
}

/**
 * Set the primary evidence reason (first signal that pushed confidence over threshold).
 */
function setReason(ctx: ComponentContext, reason: string): void {
  const confidence = (ctx.data.confidence as number) ?? 0;
  if (confidence >= CONFIDENCE_THRESHOLD && !ctx.data.evidenceReason) {
    ctx.data.evidenceReason = reason;
    ctx.data.meaningful = true;
  }
}
