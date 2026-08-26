/**
 * Modal Definition — Dialog Open + Escape Dismissal (Priority 75)
 *
 * Two trigger branches in one definition:
 *   - Open (click):  the target's own `aria-haspopup === "dialog"` (strict
 *     W3C token — `aria-haspopup="true"` means *menu* and MUST NOT claim).
 *     Never ancestry.  This keeps DatePicker(10) ownership of
 *     calendar+haspopup=dialog triggers, Dropdown(20) untouched
 *     (`listbox` only), in-dialog controls their own types.
 *   - Dismiss (keydown): bare `Escape` + dialog in ancestry-or-self.
 *     `getAncestorRoles` starts at `parentElement`, so Escape pressed *on*
 *     the dialog container itself sees no dialog in ancestry unless an
 *     outer dialog exists — the gate checks self (tag/role) too.
 *
 * Both-present (`aria-expanded` + `haspopup=dialog`, the common "Filters"
 * shape): Modal wins at 75 — dialog-opener convention subsumes disclosure
 * (mirrors B1's "stronger type keeps its type when also aria-expanded"
 * rule, one rung up).
 *
 * Immediate completion (Expander shape): no lifecycle, `isInScope` always
 * false, no active-stack residue.  Action-named metadata: an Escape the app
 * ignores still produces the card naming the ACTION; consequence
 * attribution stays evidence-owned (B1 precedent).
 *
 * Honest limits (spec §7):
 *   1. Escape on a same-element-focused input (TextEntry lifecycle active)
 *      is silently absorbed as a memberEvent — existing typing semantic,
 *      not changed.
 *   2. Escape-on-body (no focus trap) has no dialog signal → stays
 *      Unclassified.
 *   3. Native `<dialog>` cannot be closed by the synthetic executor
 *      keypress; the Playwright render covers it.
 *   4. Roleless class-styled overlays (no role=dialog) produce no surface
 *      rows — the dom-observer SURFACE_ROLES list is role-based. Sibling
 *      backdrops (plain div, no dialog ancestry) stay Unclassified (B3 parity).
 *   5. KR fragmentation: dialog triggers previously typed Click or Expander
 *      will retype to Modal — signatureKey = appId|actionType|normalizedTarget
 *      changes, creating a new KR episode. Accepted cost (B1 precedent).
 *   6. DRAG_DROP renderer gap remains out of scope (action-renderer.ts
 *      default throw for the other unrendered IRAction enum member).
 *
 * 7.4-B5
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { extractSemanticRoles, bestName } from './patterns';

// ── Dialog-in-ancestry-or-self check ───────────────────────────────────

const DIALOG_ROLES = new Set(['dialog', 'alertdialog']);

function dialogInAncestryOrSelf(event: ObservedEvent): boolean {
  // Self check: the resolved target itself is a dialog
  const tag = (event.target as any).tag;
  const role = (event.target as any).ariaRole;
  if (tag === 'DIALOG' || DIALOG_ROLES.has(role)) return true;

  // Ancestry check: any ancestor role is dialog/alertdialog
  // extractSemanticRoles parses `tag[role=x]` entries, unwraps quoted
  // variants, splits multi-token roles.
  const roles = extractSemanticRoles(event.domContext.ancestorRoles);
  for (const r of roles) {
    if (DIALOG_ROLES.has(r)) return true;
  }
  return false;
}

export const modalDefinition: ComponentDefinition = {
  type: 'Modal',
  priority: 75,
  triggerEventTypes: new Set<BrowserEventType>(['click', 'keydown']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // ── Open branch (click): strict aria-haspopup === 'dialog' ──
    if (event.eventType === 'click') {
      if (event.domContext.ariaHasPopup === 'dialog') {
        return { type: 'Modal' };
      }
      return null;
    }

    // ── Dismiss branch (keydown): bare Escape + dialog in ancestry-or-self ──
    if (event.eventType === 'keydown') {
      if (event.key === 'Escape' && dialogInAncestryOrSelf(event)) {
        return { type: 'Modal' };
      }
      return null;
    }

    return null;
  },

  isInScope(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Immediate completion — no lifecycle (Expander shape)
    return false;
  },

  handleEvent(
    _event: ObservedEvent,
    _ctx: ComponentContext,
  ): ComponentCompletion | null {
    return { endState: 'completed' };
  },

  shouldCancelOnOutside(
    _event: ObservedEvent,
    _ctx: ComponentContext,
  ): boolean {
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const event = ctx.triggerEvent;
    const isOpen = event.eventType === 'click';

    if (isOpen) {
      const targetName = bestName(
        ctx.trigger.accessibleName ?? '',
        (ctx.trigger as any).ariaLabel,
        (ctx.trigger as any).placeholder,
      );
      return {
        metadata: {
          action: 'open' as const,
          targetName,
          targetTag: (ctx.trigger as any).tag,
          targetRole: (ctx.trigger as any).ariaRole,
          clientX: event.clientX,
          clientY: event.clientY,
        },
      };
    }

    // Dismiss branch
    const targetName = bestName(
      ctx.trigger.accessibleName ?? '',
      (ctx.trigger as any).ariaLabel,
      (ctx.trigger as any).placeholder,
    );
    return {
      metadata: {
        action: 'dismiss-escape' as const,
        targetName,
        targetTag: (ctx.trigger as any).tag,
        targetRole: (ctx.trigger as any).ariaRole,
        key: event.key,
        dialogInAncestry: event.domContext.ancestorRoles.some(
          (r: string) => {
            const roles = extractSemanticRoles([r]);
            return roles.some((rr: string) => DIALOG_ROLES.has(rr));
          },
        ),
      },
    };
  },
};