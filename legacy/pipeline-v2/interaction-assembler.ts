/**
 * Interaction Assembler — Pipeline V2 Layer 5
 *
 * Takes an InteractionUnit + StateDiff + PatternMatch and produces an
 * AssembledAction — a normalized description of what the user did.
 *
 * DESIGN: The assembler's job is to COLLAPSE composite interactions into
 * a single coherent action. A dropdown interaction consists of multiple
 * events (trigger click, surface open, option click, surface close) —
 * the assembler collapses these into "Selected 'Premium Economy' from
 * 'Travel Class'".
 *
 * CRITICAL: The assembler ALWAYS produces a result. If the pattern matched,
 * it uses the pattern's metadata. If no pattern matched, it assembles
 * from the state diff alone (generic-fallback).
 *
 * STATE DIFF IS GROUND TRUTH: When pattern metadata and state diff disagree,
 * the state diff wins. The pattern is an accelerator; the diff is the truth.
 */

import type {
  InteractionUnit,
  StateDiff,
  PatternMatch,
  InteractionBehavior,
  ElementIdentity,
  ElementDescriptor,
} from './canonical-event-schema';
import { hasMeaningfulChanges } from './state-diff-engine';

// ── Types ───────────────────────────────────────────────────────────────

/**
 * The output of the Interaction Assembler.
 *
 * This is a normalized action description that the Intent Resolver
 * further refines into a ResolvedAction.
 */
export interface AssembledAction {
  /** The interaction behavior (from pattern or generic-fallback). */
  readonly behavior: InteractionBehavior;

  /** The primary element identity for this action. */
  readonly elementIdentity: ElementIdentity | null;

  /** The assembled business description. */
  readonly description: string;

  /** Key fields extracted from the state diff and/or pattern metadata. */
  readonly fields: AssembledFields;

  /** Confidence from pattern match (null for generic-fallback). */
  readonly patternConfidence: number | null;

  /** Source of the resolution (pattern or state-diff). */
  readonly resolutionSource: 'pattern' | 'state-diff';
}

/**
 * Fields assembled from the interaction.
 */
export interface AssembledFields {
  readonly selectedValue?: string;
  readonly previousValue?: string;
  readonly textValue?: string;
  readonly toggleState?: boolean;
  readonly dateValue?: string;
  readonly dateIsoValue?: string;
  readonly url?: string;
  readonly title?: string;
  readonly surfaceType?: string;
}

// ── Assembler ───────────────────────────────────────────────────────────

/**
 * Assemble an interaction unit into a normalized action.
 *
 * @param unit          The interaction unit
 * @param diff          The state diff for this unit
 * @param patternMatch  The pattern match result (null if no pattern matched)
 * @returns             An AssembledAction
 */
export function assembleInteraction(
  unit: InteractionUnit,
  diff: StateDiff,
  patternMatch: PatternMatch | null,
): AssembledAction {
  const elementIdentity = extractElementIdentity(unit);

  // If a pattern matched, assemble using the pattern + diff
  if (patternMatch) {
    return assembleFromPattern(unit, diff, patternMatch, elementIdentity);
  }

  // No pattern matched — assemble from state diff alone (generic-fallback)
  return assembleFromStateDiff(unit, diff, elementIdentity);
}

// ── Pattern-Based Assembly ──────────────────────────────────────────────

function assembleFromPattern(
  unit: InteractionUnit,
  diff: StateDiff,
  match: PatternMatch,
  elementIdentity: ElementIdentity | null,
): AssembledAction {
  const m = match.metadata;

  switch (match.behavior) {
    case 'single-selection-from-set': {
      // STATE DIFF IS GROUND TRUTH: prefer diff value over pattern metadata
      const selectedValue = diff.valueChanges[0]?.after || m.selectedValue || '';
      const previousValue = diff.valueChanges[0]?.before || m.previousValue || '';
      const fieldName = getFieldName(diff, unit, elementIdentity);

      return {
        behavior: 'single-selection-from-set',
        elementIdentity,
        description: `Select "${selectedValue}" from "${fieldName}"`,
        fields: { selectedValue, previousValue },
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'multi-selection-from-set': {
      const selectedValues = diff.toggleChanges
        .filter((t) => t.after)
        .map((t) => t.field);
      return {
        behavior: 'multi-selection-from-set',
        elementIdentity,
        description: `Select ${selectedValues.length} options: ${selectedValues.join(', ')}`,
        fields: {},
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'boolean-toggle': {
      // STATE DIFF IS GROUND TRUTH: prefer diff toggle state
      const toggleState = diff.toggleChanges[0]?.after ?? m.toggleState ?? false;
      const fieldName = diff.toggleChanges[0]?.field ||
        elementIdentity?.accessibleName || 'Toggle';
      return {
        behavior: 'boolean-toggle',
        elementIdentity,
        description: toggleState ? `Check "${fieldName}"` : `Uncheck "${fieldName}"`,
        fields: { toggleState },
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'text-entry-commit': {
      const textValue = diff.valueChanges[0]?.after || m.textValue || '';
      const fieldName = getFieldName(diff, unit, elementIdentity);
      return {
        behavior: 'text-entry-commit',
        elementIdentity,
        description: `Enter "${textValue}" into "${fieldName}"`,
        fields: { textValue },
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'date-time-selection': {
      const dateValue = m.dateValue || diff.valueChanges[0]?.after || '';
      const dateIsoValue = m.dateIsoValue || '';
      const fieldName = getFieldName(diff, unit, elementIdentity);
      return {
        behavior: 'date-time-selection',
        elementIdentity,
        description: `Select date "${dateValue}" from "${fieldName}"`,
        fields: { dateValue, dateIsoValue },
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'expand-collapse': {
      return {
        behavior: 'expand-collapse',
        elementIdentity,
        description: getClickDescription(unit, elementIdentity),
        fields: { surfaceType: m.surfaceType || diff.surfaceChanges[0]?.type },
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'context-switch': {
      const fromTab = diff.tabChange?.from.accessibleName || '';
      const toTab = diff.tabChange?.to.accessibleName || '';
      return {
        behavior: 'context-switch',
        elementIdentity,
        description: `Switch from "${fromTab}" to "${toTab}" tab`,
        fields: {},
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'navigation': {
      const url = diff.urlChange?.to || unit.events.find((e) => e.type === 'navigation')?.payload.url || '';
      return {
        behavior: 'navigation',
        elementIdentity,
        description: `Navigate to "${url}"`,
        fields: { url },
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'hover-intent': {
      return {
        behavior: 'hover-intent',
        elementIdentity,
        description: getClickDescription(unit, elementIdentity).replace('Click', 'Hover over'),
        fields: {},
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'simple-click': {
      return {
        behavior: 'simple-click',
        elementIdentity,
        description: getClickDescription(unit, elementIdentity),
        fields: {},
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'form-submit': {
      return {
        behavior: 'form-submit',
        elementIdentity,
        description: 'Submit form',
        fields: {},
        patternConfidence: match.confidence,
        resolutionSource: 'pattern',
      };
    }

    case 'generic-fallback':
      // Should not reach here via pattern match, but handle gracefully
      return assembleFromStateDiff(unit, diff, elementIdentity);

    default: {
      // Exhaustiveness check
      const _exhaustive: never = match.behavior;
      return assembleFromStateDiff(unit, diff, elementIdentity);
    }
  }
}

// ── State-Diff-Based Assembly (Generic Fallback) ────────────────────────

/**
 * Assemble an action from the state diff alone.
 *
 * This is the GRACEFUL DEGRADATION path. When no pattern matches, we still
 * produce a meaningful business action based on what changed.
 *
 * The resulting action is always valid — it may just have lower confidence
 * and less semantic resolution than a pattern-matched action.
 */
function assembleFromStateDiff(
  unit: InteractionUnit,
  diff: StateDiff,
  elementIdentity: ElementIdentity | null,
): AssembledAction {
  // Try to produce the best possible action from the diff alone

  // 1. URL change → navigation
  if (diff.urlChange) {
    return {
      behavior: 'generic-fallback',
      elementIdentity,
      description: `Navigate to "${diff.urlChange.to}"`,
      fields: { url: diff.urlChange.to },
      patternConfidence: null,
      resolutionSource: 'state-diff',
    };
  }

  // 2. Value change → generic select/text
  if (diff.valueChanges.length === 1) {
    const change = diff.valueChanges[0];
    return {
      behavior: 'generic-fallback',
      elementIdentity,
      description: `Change "${change.field}" from "${change.before}" to "${change.after}"`,
      fields: { selectedValue: change.after, previousValue: change.before },
      patternConfidence: null,
      resolutionSource: 'state-diff',
    };
  }

  // 3. Toggle change → generic toggle
  if (diff.toggleChanges.length === 1) {
    const change = diff.toggleChanges[0];
    return {
      behavior: 'generic-fallback',
      elementIdentity,
      description: change.after ? `Check "${change.field}"` : `Uncheck "${change.field}"`,
      fields: { toggleState: change.after },
      patternConfidence: null,
      resolutionSource: 'state-diff',
    };
  }

  // 4. Radio change → generic select
  if (diff.radioChanges.length === 1) {
    const change = diff.radioChanges[0];
    const selectedValue = change.after?.accessibleName || '';
    return {
      behavior: 'generic-fallback',
      elementIdentity,
      description: `Select "${selectedValue}"`,
      fields: { selectedValue },
      patternConfidence: null,
      resolutionSource: 'state-diff',
    };
  }

  // 5. Tab change → generic context switch
  if (diff.tabChange) {
    return {
      behavior: 'generic-fallback',
      elementIdentity,
      description: `Switch to "${diff.tabChange.to.accessibleName}" tab`,
      fields: {},
      patternConfidence: null,
      resolutionSource: 'state-diff',
    };
  }

  // 6. Surface change → generic expand/collapse
  if (diff.surfaceChanges.length > 0) {
    return {
      behavior: 'generic-fallback',
      elementIdentity,
      description: getClickDescription(unit, elementIdentity),
      fields: { surfaceType: diff.surfaceChanges[0].type },
      patternConfidence: null,
      resolutionSource: 'state-diff',
    };
  }

  // 7. No meaningful change → generic click (the interaction happened but
  //    nothing observable changed — e.g., a button that triggers an API call)
  return {
    behavior: 'generic-fallback',
    elementIdentity,
    description: getClickDescription(unit, elementIdentity),
    fields: {},
    patternConfidence: null,
    resolutionSource: 'state-diff',
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Extract the element identity from the interaction unit's primary event.
 *
 * LEARNING 7 (collectIdentity): The element identity is fully populated
 * by the V2 Event Observer. No re-extraction needed here.
 */
function extractElementIdentity(unit: InteractionUnit): ElementIdentity | null {
  // RC-1 FIX: Don't use unit.primaryEvent (the first event) for target
  // attribution. The first event is often a blur/focus/change from the
  // PREVIOUS interaction, which leaks the wrong element identity into the output.
  //
  // Instead, find the first SEMANTICALLY MEANINGFUL event — the event that
  // actually represents the user's primary action.
  //
  // PRIORITY ORDER (critical for correct target attribution):
  //   1. click / dblclick — the user's primary interaction
  //   2. submit — form submission
  //   3. surface_open — the user opened a dropdown/dialog
  //   4. input — typing (for text entry interactions)
  //   5. change — value change (for select/checkbox/radio)
  //   6. dragstart / drop — drag and drop
  //   7. keydown(Enter) — keyboard submit
  //
  // The key insight: a leading 'change' event is often the PREVIOUS interaction's
  // value commit firing when focus moves away. By checking click FIRST, we skip
  // that contamination and find the user's actual action.

  // Priority 1: click / dblclick (the user's primary action)
  for (const event of unit.events) {
    if (event.type === 'click' || event.type === 'dblclick') {
      if (event.element) return event.element;
    }
  }

  // Priority 2: submit
  for (const event of unit.events) {
    if (event.type === 'submit') {
      if (event.element) return event.element;
    }
  }

  // Priority 3: surface_open (dropdown/dialog trigger)
  for (const event of unit.events) {
    if (event.type === 'surface_open') {
      if (event.element) return event.element;
    }
  }

  // Priority 4: input (typing — only if no click)
  for (const event of unit.events) {
    if (event.type === 'input') {
      if (event.element) return event.element;
    }
  }

  // Priority 5: change (value change — for native selects, checkboxes)
  // NOTE: This is LOW priority because a leading change is often from the
  // previous interaction's cleanup (value committed on blur).
  for (const event of unit.events) {
    if (event.type === 'change') {
      if (event.element) return event.element;
    }
  }

  // Priority 6: dragstart / drop
  for (const event of unit.events) {
    if (event.type === 'dragstart' || event.type === 'drop') {
      if (event.element) return event.element;
    }
  }

  // Priority 7: keydown with Enter (possible form submit)
  for (const event of unit.events) {
    if (event.type === 'keydown' && event.payload?.key === 'Enter') {
      if (event.element) return event.element;
    }
  }

  // Fallback: use primaryEvent's element if it exists
  return unit.primaryEvent.element;
}

/**
 * Get the field name from the state diff or element identity.
 */
function getFieldName(
  diff: StateDiff,
  unit: InteractionUnit,
  elementIdentity: ElementIdentity | null,
): string {
  // Prefer the diff's field name (from the changed element's accessible name)
  if (diff.valueChanges.length > 0) {
    return diff.valueChanges[0].field;
  }
  if (diff.toggleChanges.length > 0) {
    return diff.toggleChanges[0].field;
  }
  // Fall back to the primary element's accessible name
  if (elementIdentity?.accessibleName) {
    return elementIdentity.accessibleName;
  }
  // Fall back to the primary event's target tag
  return unit.primaryEvent.targetTag || 'Element';
}

/**
 * Generate a click description from the unit and element identity.
 */
function getClickDescription(
  unit: InteractionUnit,
  elementIdentity: ElementIdentity | null,
): string {
  const name = elementIdentity?.accessibleName ||
    unit.primaryEvent.targetTag ||
    'Element';
  return `Click "${name}"`;
}
