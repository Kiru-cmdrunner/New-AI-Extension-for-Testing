/**
 * Semantic Action Builder — Phase 5
 *
 * Converts lifecycle engine outputs (SemanticActionOutput) into full
 * SemanticAction objects with human-readable descriptions.
 *
 * The plainEnglish field is what a QA engineer would expect to see:
 * "Enter 'hello' in the Name field"
 * "Select 'India' from the Country dropdown"
 * "Toggle the 'Remember me' checkbox"
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { SemanticAction } from '../../types/lifecycle';
import type { InteractionVerb, ComponentType } from '../../types/foundation';
import type { SemanticActionOutput } from './lifecycle-types';

// ── ID Generation ────────────────────────────────────────────────────────

let actionCounter = 0;

function nextActionId(): string {
  actionCounter++;
  return `action-${String(actionCounter).padStart(4, '0')}`;
}

/** Reset the counter (for testing). */
export function resetActionCounter(): void {
  actionCounter = 0;
}

// ── Plain English Description Builder ────────────────────────────────────

/**
 * Build a human-readable description for a SemanticAction.
 *
 * This is what a QA engineer would expect to see as a test step.
 */
function buildPlainEnglish(
  verb: InteractionVerb,
  componentType: ComponentType,
  value: string | null,
): string {
  const hasValue = value !== null && value.length > 0;
  const quotedValue = hasValue ? `'${value}'` : '';

  switch (verb) {
    case 'fill':
      return hasValue
        ? `Enter ${quotedValue} in the text field`
        : 'Enter text in the text field';

    case 'select':
      return hasValue
        ? `Select ${quotedValue} from the dropdown`
        : 'Select an option from the dropdown';

    case 'selectDate':
      return hasValue
        ? `Select date ${quotedValue} from the date picker`
        : 'Select a date from the date picker';

    case 'selectOption':
      if (componentType === 'Slider') {
        return hasValue
          ? `Set the slider to ${quotedValue}`
          : 'Adjust the slider';
      }
      return hasValue
        ? `Select ${quotedValue}`
        : 'Select an option';

    case 'toggle':
      return hasValue
        ? `Toggle ${quotedValue}`
        : 'Toggle the checkbox';

    case 'click':
      if (componentType === 'Link') return 'Click the link';
      if (componentType === 'Button') return 'Click the button';
      return 'Click the element';

    case 'navigate':
      return 'Navigate to a new page';

    case 'scroll':
      return 'Scroll the page';

    case 'hover':
      return 'Hover to reveal a tooltip or menu';

    case 'pressKey':
      return 'Press a key';

    default:
      return `Perform ${verb} action`;
  }
}

// ── Value Normalisation (Phase 5b) ───────────────────────────────────────

/**
 * Normalise a display value for comparison.
 *
 * Strips leading/trailing dashes, colons, and whitespace — these are
 * common formatting artifacts in dropdown trigger displays (e.g.,
 * "-- Select Country --" vs "Select Country").
 *
 * Decision: [ADOPTED] from v10.9.0 patterns.ts normalizeDisplayValue().
 */
function normalizeDisplayValue(value: string | null): string {
  if (!value) return '';
  return value.replace(/^[\s\-:]+|[\s\-:]+$/g, '').trim().toLowerCase();
}

/**
 * Check if a SemanticActionOutput represents a no-op selection.
 *
 * A no-op is when the user opens a dropdown and selects the option that
 * was already selected. This is not a meaningful test step.
 *
 * Decision: [ADOPTED] from v10.9.0 dropdown.ts noOpSelection logic.
 * We compare the selected value against the trigger's display value.
 */
function isNoOpSelection(output: SemanticActionOutput): boolean {
  // Only applies to dropdown selections
  if (output.verb !== 'select' || output.definitionId !== 'dropdown-lifecycle') {
    return false;
  }
  if (!output.value || !output.committed) return false;

  // The trigger display value would come from the lifecycle's activation
  // evidence. For now, we check if the value looks like a default/placeholder.
  const normalized = normalizeDisplayValue(output.value);
  if (!normalized) return false;

  // Common placeholder patterns — selecting a placeholder is a no-op
  const PLACEHOLDER_PATTERNS: RegExp[] = [
    /^(select|choose|pick)\s/i,
    /^--.*--$/,
    /^none$/i,
    /^n[-\/]a$/i,
    /^please\s+select/i,
  ];

  return PLACEHOLDER_PATTERNS.some(re => re.test(normalized));
}

// ── Builder ──────────────────────────────────────────────────────────────

/**
 * Convert lifecycle engine outputs into full SemanticAction objects.
 *
 * Phase 5b: Filters out no-op selections (dropdown already-selected option).
 */
export function buildSemanticActions(
  outputs: SemanticActionOutput[],
): SemanticAction[] {
  const actions: SemanticAction[] = [];

  for (const output of outputs) {
    // Phase 5b: Skip no-op selections
    if (isNoOpSelection(output)) continue;

    const plainEnglish = buildPlainEnglish(
      output.verb,
      output.componentType,
      output.value,
    );

    actions.push({
      id: nextActionId(),
      kind: 'semantic_action' as const,
      verb: output.verb,
      componentType: output.componentType,
      interactions: output.sourceResults,
      startedAt: output.startedAt,
      endedAt: output.endedAt,
      lifecyclePhase: output.committed ? 'commit' : 'cancel',
      confidence: output.committed ? 1.0 : 0.5,
      value: output.value,
      plainEnglish,
      committed: output.committed,
    });
  }

  return actions;
}

/**
 * Process lifecycle outputs and return SemanticActions in one step.
 *
 * Convenience function combining buildSemanticActions with counter reset.
 */
export function processToSemanticActions(
  outputs: SemanticActionOutput[],
): SemanticAction[] {
  resetActionCounter();
  return buildSemanticActions(outputs);
}
