/**
 * FeatureView: a lightweight facade over RecordedEvent + ElementIdentity + DomContext.
 *
 * This is NOT a copy of the data — it holds references to the original types
 * and adds computed helpers that prevent evidence generators from reimplementing
 * the same normalization logic. The original types remain the single source of truth.
 *
 * Evidence generators receive a FeatureViewInput (the read-only computed subset).
 * This keeps generators decoupled from the raw event/identity/dom context structure.
 */

import type { ElementIdentity } from '../../shared/types';
import type { ElementRecordedEvent } from '../../recorder/recorded-event';
import type { FeatureViewInput } from './types';

/**
 * Build a FeatureViewInput from the raw event data.
 *
 * This is the ONLY function that touches the raw event structure — all evidence
 * generators consume the FeatureViewInput interface instead. If the recorder
 * changes how it captures data, only this function needs updating.
 *
 * @param target  The element identity from the recorded event
 * @param event   The click event (or the first element event in the group)
 */
export function buildFeatureView(
  target: ElementIdentity,
  event: ElementRecordedEvent,
): FeatureViewInput {
  const domCtx = event.domContext;

  // Behavioral signals from the event
  const checkedBefore = event.checkedBefore;
  const checkedAfter = event.checkedAfter;

  // ARIA state signals — check the target's role and attributes
  // The recorder's getImplicitRole already converts aria-checked to 'checkbox' role.
  // But for robustness, also check if the original attributes suggest checked state.
  const ariaRole = target.ariaRole;
  const hasAriaChecked = ariaRole === 'checkbox' || ariaRole === 'menuitemcheckbox';
  const hasAriaPressed = ariaRole === 'button' && checkedAfter !== null; // button with pressed state

  return {
    // Element semantics
    tag: target.tag,
    ariaRole,
    accessibleName: target.accessibleName ?? null,
    classNameLower: (target.className || '').toLowerCase(),

    // Computed behavioral helpers
    hasAriaChecked,
    hasAriaPressed,
    hasCheckedTransition: checkedBefore !== null || checkedAfter !== null,
    checkedBefore,
    checkedAfter,

    // Structural signals (from DomContext — captured but historically ignored by classifier)
    surfaceType: domCtx?.surfaceType ?? null,
    ancestorRoles: domCtx?.ancestorRoles ?? [],

    // Navigation signals
    opensNewTab: domCtx?.opensNewTab === true,
    opensNewWindow: domCtx?.opensNewWindow === true,

    // Element type checks
    isLink: target.tag === 'A' || ariaRole === 'link',
  };
}
