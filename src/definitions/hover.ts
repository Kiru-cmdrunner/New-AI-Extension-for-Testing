/**
 * Hover Definition — Evidence-Based Candidate (Priority 60)
 *
 * Unlike Click or TextEntry, a mouseenter alone does not represent user
 * intent. The pointer may be transiting through elements on its way to a
 * destination. Hover is therefore a CANDIDATE interaction — it starts on
 * mouseenter but is NOT emitted until evidence proves it was meaningful.
 *
 * Lifecycle:
 *   mouseenter → candidate (active, not emitted)
 *     ├── mouseleave + evidence     → emit as completed Hover
 *     ├── mouseleave + no evidence  → discard silently
 *     ├── click on same element     → discard (Click takes precedence)
 *     └── click elsewhere            → discard (user moved on)
 *
 * Evidence signals (any one promotes to meaningful):
 *   1. aria-expanded toggled to true during hover
 *   2. Element has aria-haspopup + dwell ≥ threshold
 *   3. Sustained dwell ≥ HOVER_PROMOTION_DWELL_MS (2s)
 *   4. Ancestor/element role suggests overlay trigger (menu, tooltip, etc.)
 *
 * Discard signals:
 *   1. mouseleave before any evidence (transit hover)
 *   2. Click on same element (Click interaction takes precedence)
 *
 * Design principle: capture meaningful user intent, not every physical
 * mouse movement.
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

// ── Constants ─────────────────────────────────────────────────────────

/**
 * Minimum dwell time before a hover is even considered.
 * Hovers shorter than this are always discarded (transit hovers).
 */
const HOVER_TRANSIT_THRESHOLD_MS = 500;

/**
 * Dwell time after which a hover is promoted to meaningful even without
 * other evidence signals. 2 seconds of stillness = intent to interact.
 */
const HOVER_PROMOTION_DWELL_MS = 2000;

/**
 * Roles that indicate an element can trigger an overlay on hover.
 * If the element (or an ancestor) has one of these, a dwell ≥ threshold
 * is strong evidence the overlay was shown.
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
    // ── Accumulate evidence on any lifecycle event ──
    checkEvidence(event, ctx);

    // ── mouseleave: decide emit vs discard ──
    if (event.eventType === 'mouseleave') {
      // Was it on the same element? (mouseleave from trigger element)
      const sameElement = event.target.stableId === ctx.trigger.stableId
        || event.target.cssSelector === ctx.trigger.cssSelector;

      if (sameElement) {
        const dwell = event.timestamp - ctx.startTime;
        ctx.data.dwellMs = dwell;

        if (ctx.data.meaningful === true) {
          return { endState: 'completed' };
        }

        // Not meaningful — discard silently
        return { endState: 'discarded' };
      }
      // mouseleave on a different element — not our trigger, ignore
      return null;
    }

    // ── mousemove: check for sustained dwell promotion ──
    if (event.eventType === 'mousemove') {
      const dwell = event.timestamp - ctx.startTime;
      if (dwell >= HOVER_PROMOTION_DWELL_MS) {
        ctx.data.meaningful = true;
        ctx.data.evidenceReason = 'sustained-dwell';
        ctx.data.dwellMs = dwell;
      }
    }

    return null; // still active
  },

  shouldCancelOnOutside(event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Click on a different element → user moved on, discard the hover.
    // Click on the SAME element → also discard (Click takes precedence),
    // but this is handled by isInScope returning false for clicks, which
    // causes the runtime to offer it to other definitions or discovery.
    if (event.eventType === 'click') {
      return true; // discard — let the Click definition fire via discovery
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
        evidenceReason: (ctx.data.evidenceReason as string) ?? null,
      },
    };
  },
};

// ── Evidence Evaluation ───────────────────────────────────────────────

/**
 * Check the current event for evidence signals and update ctx.data.
 * Called on every in-scope event.
 */
function checkEvidence(event: ObservedEvent, ctx: ComponentContext): void {
  if (ctx.data.meaningful === true) return; // already promoted

  const dwell = event.timestamp - ctx.startTime;

  // ── Evidence 1: aria-expanded transition ──
  // The element started not-expanded and now shows expanded=true
  if (event.domContext.ariaExpanded === true) {
    // Check if the trigger started as not-expanded
    const triggerExpanded = ctx.triggerEvent.domContext.ariaExpanded;
    if (triggerExpanded !== true) {
      ctx.data.meaningful = true;
      ctx.data.evidenceReason = 'aria-expanded';
      return;
    }
  }

  // ── Evidence 2: aria-haspopup + dwell ≥ threshold ──
  const hasPopup = ctx.triggerEvent.domContext.ariaHasPopup;
  if (hasPopup && HOVER_POPUP_TYPES.has(hasPopup) && dwell >= HOVER_TRANSIT_THRESHOLD_MS) {
    ctx.data.meaningful = true;
    ctx.data.evidenceReason = 'haspopup-dwell';
    return;
  }

  // ── Evidence 3: overlay trigger role + dwell ──
  const triggerRole = ctx.triggerEvent.target.ariaRole;
  const ancestorRoles = ctx.triggerEvent.domContext.ancestorRoles ?? [];
  const hasOverlayRole =
    (triggerRole && OVERLAY_TRIGGER_ROLES.has(triggerRole)) ||
    ancestorRoles.some((r) => OVERLAY_TRIGGER_ROLES.has(r));
  if (hasOverlayRole && dwell >= HOVER_TRANSIT_THRESHOLD_MS) {
    ctx.data.meaningful = true;
    ctx.data.evidenceReason = 'overlay-role-dwell';
    return;
  }

  // ── Evidence 4: sustained dwell (checked in handleEvent for mousemove) ──
  // This is handled in handleEvent on mousemove events, but also check here
  // for mouseenter/mouseleave events that arrive after the threshold.
  if (dwell >= HOVER_PROMOTION_DWELL_MS) {
    ctx.data.meaningful = true;
    ctx.data.evidenceReason = 'sustained-dwell';
    return;
  }
}
