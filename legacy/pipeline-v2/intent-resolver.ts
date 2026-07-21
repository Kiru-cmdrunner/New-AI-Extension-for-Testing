/**
 * Intent Resolver — Pipeline V2 Layer 6
 *
 * Takes an AssembledAction and produces a ResolvedAction — the final
 * business action that will be emitted as a SessionEvent.
 *
 * DESIGN PRINCIPLE: The Intent Resolver ALWAYS produces a ResolvedAction.
 * It never discards an interaction. Even for unknown controls with no
 * pattern match, it produces a business action from the state diff.
 *
 * CONFIDENCE MODEL:
 *   HIGH (0.85-1.0)   — Pattern matched + state diff confirms
 *   MEDIUM (0.60-0.84)— Pattern matched OR state diff is clear
 *   LOW (0.30-0.59)   — Generic fallback, no pattern match
 *
 * MAPPING TO SESSION EVENT TYPES:
 *   The resolver maps interaction behaviors to the 8 SessionEvent types
 *   that the downstream generation engine expects:
 *     single-selection-from-set → select (or radio)
 *     multi-selection-from-set  → checkbox (first toggle)
 *     boolean-toggle            → checkbox
 *     text-entry-commit         → text
 *     date-time-selection       → dateSelect
 *     expand-collapse           → click
 *     context-switch            → click
 *     navigation                → navigation
 *   hover-intent              → hover
 *     simple-click              → click
 *     form-submit               → click
 *     generic-fallback          → varies (based on state diff)
 */

import type {
  AssembledAction,
} from './interaction-assembler';
import type {
  ResolvedAction,
  SessionEventType,
  ResolvedActionFields,
  InteractionBehavior,
} from './canonical-event-schema';
import { hasMeaningfulChanges } from './state-diff-engine';
import type { StateDiff } from './canonical-event-schema';

// ── Intent Resolver ─────────────────────────────────────────────────────

/**
 * Resolve a final business action from an assembled action.
 *
 * @param assembled  The assembled action from the Interaction Assembler
 * @param diff       The state diff (for confidence adjustment)
 * @returns          A ResolvedAction that will be emitted as a SessionEvent
 */
export function resolveIntent(
  assembled: AssembledAction,
  diff: StateDiff,
): ResolvedAction {
  const sessionEventType = behaviorToSessionEventType(assembled.behavior, assembled, diff);
  const confidence = computeConfidence(assembled, diff);
  const fields = extractFields(assembled, sessionEventType);
  const description = assembled.description;
  const rationale = buildRationale(assembled, diff);

  return {
    behavior: assembled.behavior,
    sessionEventType,
    confidence,
    elementIdentity: assembled.elementIdentity,
    fields,
    description,
    rationale,
  };
}

// ── Behavior → SessionEvent Type Mapping ────────────────────────────────

/**
 * Map an interaction behavior to a SessionEvent type.
 *
 * This is the final mapping that determines what type of event is emitted.
 * It uses the behavior as the primary signal and the assembled fields as
 * a secondary signal for ambiguous cases.
 */
function behaviorToSessionEventType(
  behavior: InteractionBehavior,
  assembled: AssembledAction,
  diff: StateDiff,
): SessionEventType {
  switch (behavior) {
    case 'single-selection-from-set': {
      // Radio selections are 'radio', everything else is 'select'
      if (diff.radioChanges.length > 0) {
        return 'radio';
      }
      return 'select';
    }

    case 'multi-selection-from-set':
      // Emit as checkbox (first toggle; the generation engine handles multi-select)
      return 'checkbox';

    case 'boolean-toggle':
      return 'checkbox';

    case 'text-entry-commit':
      return 'text';

    case 'date-time-selection':
      return 'dateSelect';

    case 'expand-collapse':
      return 'click';

    case 'context-switch':
      return 'click';

    case 'navigation':
      return 'navigation';

    case 'hover-intent':
      return 'hover';

    case 'simple-click':
      return 'click';

    case 'form-submit':
      return 'click';

    case 'generic-fallback':
      // Infer the best type from the state diff
      return inferTypeFromDiff(diff);

    default: {
      const _exhaustive: never = behavior;
      return 'click';
    }
  }
}

/**
 * For generic-fallback, infer the best SessionEvent type from the state diff.
 */
function inferTypeFromDiff(diff: StateDiff): SessionEventType {
  if (diff.urlChange) return 'navigation';
  if (diff.valueChanges.length > 0) {
    // Could be select or text — use select for safety
    const change = diff.valueChanges[0];
    if (change.inputType.startsWith('select')) return 'select';
    if (looksLikeDateValue(change.after)) return 'dateSelect';
    return 'text';
  }
  if (diff.toggleChanges.length > 0) return 'checkbox';
  if (diff.radioChanges.length > 0) return 'radio';
  if (diff.tabChange) return 'click'; // tab switching emits as click
  return 'click'; // safest fallback
}

// ── Confidence Computation ──────────────────────────────────────────────

/**
 * Compute the final confidence for a resolved action.
 *
 * HIGH:   Pattern matched AND state diff confirms the pattern's prediction
 * MEDIUM: Pattern matched but state diff is ambiguous
 * LOW:    No pattern match — generic fallback from state diff
 */
function computeConfidence(assembled: AssembledAction, diff: StateDiff): number {
  // Generic fallback — always LOW
  if (assembled.resolutionSource === 'state-diff') {
    if (hasMeaningfulChanges(diff)) {
      return 0.45; // State diff has signal, but no pattern
    }
    return 0.30; // Minimal signal
  }

  // Pattern-based — start with the pattern's confidence
  const base = assembled.patternConfidence ?? 0.5;

  // Check if state diff CONFIRMS the pattern
  if (hasMeaningfulChanges(diff)) {
    // State diff has meaningful changes — pattern is confirmed
    return Math.min(1.0, base + 0.05);
  }

  // Pattern matched but state diff is empty — slight penalty
  // (e.g., a click with no observable state change)
  return Math.max(0.40, base - 0.10);
}

// ── Field Extraction ───────────────────────────────────────────────────

/**
 * Extract the type-specific fields for the SessionEvent.
 *
 * These fields map directly to the SessionEvent variant fields in types.ts.
 */
function extractFields(
  assembled: AssembledAction,
  sessionEventType: SessionEventType,
): ResolvedActionFields {
  switch (sessionEventType) {
    case 'select':
      return { value: assembled.fields.selectedValue || '' };

    case 'radio':
      return { value: assembled.fields.selectedValue || '' };

    case 'text':
      return { value: assembled.fields.textValue || '' };

    case 'checkbox':
      return { checked: assembled.fields.toggleState ?? true };

    case 'dateSelect': {
      const displayValue = assembled.fields.dateValue || '';
      const isoValue = assembled.fields.dateIsoValue || displayValue;
      return {
        dateType: inferDateType(displayValue),
        displayValue,
        isoValue,
      };
    }

    case 'navigation':
      return {
        url: assembled.fields.url || '',
        title: assembled.fields.title || '',
      };

    case 'click':
      return {};

    case 'hover':
      return {};

    default: {
      const _exhaustive: never = sessionEventType;
      return {};
    }
  }
}

// ── Rationale Building ─────────────────────────────────────────────────

/**
 * Build a human-readable rationale for the resolution.
 * Used for tracing and debugging.
 */
function buildRationale(assembled: AssembledAction, diff: StateDiff): string {
  if (assembled.resolutionSource === 'state-diff') {
    const changes: string[] = [];
    if (diff.valueChanges.length > 0) changes.push(`${diff.valueChanges.length} value change(s)`);
    if (diff.toggleChanges.length > 0) changes.push(`${diff.toggleChanges.length} toggle change(s)`);
    if (diff.radioChanges.length > 0) changes.push(`${diff.radioChanges.length} radio change(s)`);
    if (diff.urlChange) changes.push('URL change');
    if (diff.surfaceChanges.length > 0) changes.push(`${diff.surfaceChanges.length} surface change(s)`);

    return changes.length > 0
      ? `Generic fallback (no pattern match). State diff: ${changes.join(', ')}`
      : 'Generic fallback (no pattern match, no meaningful state change)';
  }

  const patternNote = assembled.patternConfidence
    ? `Pattern: ${assembled.behavior} (${assembled.patternConfidence.toFixed(2)} confidence)`
    : `Pattern: ${assembled.behavior}`;

  const diffNote = hasMeaningfulChanges(diff)
    ? 'State diff confirms'
    : 'State diff is empty';

  return `${patternNote}. ${diffNote}.`;
}

// ── Date Type Inference ────────────────────────────────────────────────

/**
 * Infer the date subtype from a display value.
 */
function inferDateType(displayValue: string): string {
  if (!displayValue) return 'date';

  // Time-only values: 09:30, 14:00
  if (/^\d{1,2}:\d{2}/.test(displayValue)) return 'time';

  // Date-time values: 2026-07-18T09:30, July 18 2026 2:00 PM
  if (/\d{4}.*\d{1,2}:\d{2}/.test(displayValue) || /\d{1,2}:\d{2}.*\d{4}/.test(displayValue)) {
    return 'dateTime';
  }

  // Date range: contains "to" or "-"
  if (/\bto\b/i.test(displayValue) && displayValue.split(/\bto\b/i).length === 2) {
    return 'dateRange';
  }

  // Default
  return 'date';
}

/**
 * Check if a value looks like a date.
 */
function looksLikeDateValue(value: string): boolean {
  if (!value) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return true;
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(value)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value)) return true;
  return false;
}
