/**
 * FeatureView: a lightweight facade over ObservedEvent + ElementIdentity + DomContext.
 *
 * This is NOT a copy of the data — it holds references to the original types
 * and adds computed helpers that prevent evidence generators from reimplementing
 * the same normalization logic. The original types remain the single source of truth.
 *
 * Evidence generators receive a FeatureViewInput (the read-only computed subset).
 * This keeps generators decoupled from the raw event/identity/dom context structure.
 *
 * Phase 2: Rewired from ElementRecordedEvent (V1 type) to ObservedEvent
 * (Component Runtime type). The FeatureViewInput interface is unchanged —
 * generators don't notice the difference.
 *
 * R3.1: FeatureViewInput expanded with behavioral/structural fields that were
 * always captured but not propagated. buildFeatureView now maps these fields
 * from the ObservedEvent and DomContext. Existing generators are unaffected
 * (new fields are additive).
 *
 * R3.4: buildFeatureView now accepts an optional attributeChanges parameter
 * from the Click lifecycle's post-handler re-snapshot. When present, these
 * transitions are mapped to hasAttributeTransition and attributeChanges on
 * FeatureViewInput, enabling behavioral generators to reason about post-handler
 * attribute state changes.
 */

import type { ElementIdentity } from '../../shared/types';
import type { ObservedEvent, AttributeChange } from '../../shared/component-types';
import type { FeatureViewInput } from './types';

/**
 * Build a FeatureViewInput from the Component Runtime's event data.
 *
 * This is the ONLY function that touches the raw event structure — all evidence
 * generators consume the FeatureViewInput interface instead. If the recorder
 * changes how it captures data, only this function needs updating.
 *
 * @param target           The element identity from the observed event
 * @param event            The click event (trigger event from the ComponentInteraction)
 * @param attributeChanges Optional attribute transitions from the post-handler re-snapshot (R3.4)
 */
export function buildFeatureView(
  target: ElementIdentity,
  event: ObservedEvent,
  attributeChanges?: AttributeChange[],
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

  // R3.4: Attribute transitions from post-handler re-snapshot
  const attrChanges = attributeChanges ?? [];

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

    // Structural signals (from DomContext)
    surfaceType: domCtx?.surfaceType ?? null,
    ancestorRoles: domCtx?.ancestorRoles ?? [],

    // Navigation signals
    opensNewTab: domCtx?.opensNewTab === true,
    opensNewWindow: domCtx?.opensNewWindow === true,

    // Element type checks
    isLink: target.tag === 'A' || ariaRole === 'link',

    // R3.1: Value transitions (behavioral)
    valueBefore: event.valueBefore,
    valueAfter: event.valueAfter,

    // R3.1: ARIA behavioral/structural signals
    ariaExpanded: domCtx?.ariaExpanded ?? null,
    ariaHasPopup: domCtx?.ariaHasPopup ?? null,
    ariaAutoComplete: domCtx?.ariaAutoComplete ?? null,
    ariaValueNow: domCtx?.ariaValueNow ?? null,

    // R3.1: Element properties (structural)
    inputType: domCtx?.inputType ?? null,
    isContentEditable: domCtx?.isContentEditable ?? false,

    // R3.1: Context (structural)
    ancestorClasses: domCtx?.ancestorClasses ?? [],

    // R3.4: Post-handler attribute transitions (behavioral)
    hasAttributeTransition: attrChanges.length > 0,
    attributeChanges: attrChanges,
  };
}
