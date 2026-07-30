/**
 * Structural Semantic Enrichment — ConfigurationSession Derivation
 *
 * Transforms action sequences (subActions[]) into state-based field
 * representations (ConfigurationSession). Recognizes configuration patterns
 * using only structural signals — zero application knowledge.
 *
 * Architecture: docs/architecture/STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md
 * Roadmap: Phase 0e
 *
 * Design principles:
 *   S1: Pure transform — no side effects, no I/O, no DOM access
 *   S2: Additive — adds configurationSession to metadata, never modifies existing fields
 *   S3: Structural, not semantic — recognizes patterns, never assigns business meaning
 *   S4: Graceful degradation — uses best available label/value, never throws
 *   S5: Deterministic — same input always produces same output
 *   S6: Idempotent — running twice produces the same result
 */

import type { ComponentInteraction } from '../shared/component-types';
import type { DropdownSubAction } from '../definitions/dropdown';

// ── Public Types ──────────────────────────────────────────────────────

/**
 * How a configuration field's value was set.
 */
export type FieldKind = 'counter' | 'select' | 'toggle' | 'text' | 'date';

/**
 * A single field that changed within a configuration session.
 * Groups all subActions that modified the same logical value.
 */
export interface ConfigurationField {
  /** Field name, structurally extracted from subAction labels. */
  label: string;
  /** How the value was set. */
  kind: FieldKind;
  /** The end-state value after all subActions on this field. */
  finalValue: string;
  /** Net change for counters (+2, -1, 0). Undefined for non-counter kinds. */
  delta?: number;
  /** Number of subActions that contributed to this field. */
  subActionCount: number;
  /** The raw subActions that produced this field (evidence chain). */
  evidence: DropdownSubAction[];
}

/**
 * The category of configuration session, derived from subAction composition.
 * Application-independent.
 */
export type StructuralPattern =
  | 'singleSelect'
  | 'multiFieldConfig'
  | 'filterApply'
  | 'searchSubmit'
  | 'toggleBatch'
  | 'uncommitted';

/**
 * A group of related field changes committed together.
 */
export interface ConfigurationSession {
  /** The fields that changed, in the order they were first modified. */
  fields: ConfigurationField[];
  /** The commit/confirm action. Null if session was closed without explicit commit. */
  commitAction: DropdownSubAction | null;
  /** Label of the trigger element that opened the configuration surface. */
  triggerLabel: string;
  /** Structural pattern recognized. */
  pattern: StructuralPattern;
  /** The physical interaction type that produced this session. */
  rawInteractionType: string;
}

// ── Internal Helpers ──────────────────────────────────────────────────

/**
 * Action verbs to strip when extracting field names from stepper labels.
 */
const ACTION_VERB_RE = /^(increase|decrease|add|remove|plus|minus|less|more|enable|disable|toggle|set|adjust)\s+/i;

/**
 * Normalize a subAction label into a field name.
 *
 * For stepper labels ("Increase adults" → "Adults"), strips the action verb.
 * For bare symbols ("+", "-") that have no contextual name, maps to "Counter".
 * For other labels, uses the label as-is.
 */
function normalizeFieldName(label: string): string {
  if (!label || label === 'element') return label;

  // Bare +/- symbols have no intrinsic field name — normalize to a neutral label
  // so they don't group confusingly as "field name +" in the display.
  if (/^\s*[+\-]\s*$/.test(label)) return 'Counter';

  const stripped = label.replace(ACTION_VERB_RE, '').trim();
  if (!stripped) return label; // fallback if stripping removed everything
  // Title-case: "adults" → "Adults", "travel class" → "Travel Class"
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * Derive the field kind from a subAction's action type.
 */
function deriveKind(action: string): FieldKind {
  switch (action) {
    case 'increment':
    case 'decrement':
      return 'counter';
    case 'selectOption':
      return 'select';
    case 'toggle':
      return 'toggle';
    case 'fillInput':
      return 'text';
    case 'confirm':
      // Should never happen — confirm actions are filtered before grouping
      return 'select';
    default:
      return 'select';
  }
}

/**
 * Extract the final value from a group of subActions on the same field.
 */
function extractFinalValue(
  group: DropdownSubAction[],
  kind: FieldKind,
): string {
  if (group.length === 0) return '';

  const last = group[group.length - 1];

  switch (kind) {
    case 'counter':
      // Last subAction's value is the most recent state
      return last.value ?? '';

    case 'select':
      // Last selectOption wins (user may have changed their mind)
      return last.value ?? last.label ?? '';

    case 'toggle':
      // Map 'checked'/'unchecked' to 'true'/'false'
      return last.value === 'checked' ? 'true' : 'false';

    case 'text':
      // Last typed value
      return last.value ?? '';

    case 'date':
      // Date display string
      return last.value ?? last.label ?? '';

    default:
      return last.value ?? last.label ?? '';
  }
}

/**
 * Compute the net delta for counter fields.
 */
function computeDelta(group: DropdownSubAction[]): number {
  let delta = 0;
  for (const sub of group) {
    if (sub.action === 'increment') delta++;
    else if (sub.action === 'decrement') delta--;
  }
  return delta;
}

/**
 * Group subActions by their normalized field name.
 * Returns groups in the order their first member appeared.
 *
 * For counter actions (increment/decrement), if the label is generic ("Counter",
 * "+", "-") we group by elementId to distinguish different physical buttons
 * (e.g., Adults +, Children +, Infants + on AdaniOne). This prevents three
 * separate +1 presses on different stepper buttons from being merged into
 * a single "Counter +3" field.
 */
function groupByField(
  subActions: DropdownSubAction[],
): Map<string, DropdownSubAction[]> {
  const groups = new Map<string, DropdownSubAction[]>();
  for (const sub of subActions) {
    const fieldName = normalizeFieldName(sub.label);

    // For counters with generic labels, append elementId to keep distinct
    // stepper buttons as separate fields. If the label was already descriptive
    // ("Adults", "Children"), keep using the label as the key.
    let key = fieldName;
    if (
      (sub.action === 'increment' || sub.action === 'decrement') &&
      (fieldName === 'Counter' || fieldName === '+' || fieldName === '-')
    ) {
      // Use a combination of label + elementId so each physical button
      // becomes its own field. Also infer a better name from the element's
      // CSS selector or class if possible.
      const inferredName = inferCounterName(sub);
      key = inferredName || `${fieldName} (${sub.target?.elementId ?? 'unknown'})`;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(sub);
  }
  return groups;
}

/**
 * Try to infer a meaningful field name for a counter (stepper) subAction
 * from its target's CSS selector or class name.
 * E.g., cssSelector "button.plus-adults" → "Adults"
 */
function inferCounterName(sub: DropdownSubAction): string | null {
  // Check CSS selector for contextual keywords
  const selector = sub.target?.cssSelector || '';
  const selMatch = selector.match(/(?:adult|child|children|infant|senior|youth|teen|pax|passenger|room|guest)(?:[-_a-z]*)?/i);
  if (selMatch) {
    const name = selMatch[0].replace(/[-_]/g, ' ').trim();
    if (name) return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  // Check className for contextual keywords
  const className = sub.target?.className || '';
  const clsMatch = className.match(/(?:adult|child|children|infant|senior|youth|teen|pax|passenger|room|guest)(?:[-_a-z]*)?/i);
  if (clsMatch) {
    const name = clsMatch[0].replace(/[-_]/g, ' ').trim();
    if (name) return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  return null;
}

/**
 * Classify the structural pattern from field composition and commit action.
 */
function classifyPattern(
  fields: ConfigurationField[],
  commitAction: DropdownSubAction | null,
): StructuralPattern {
  const fieldKinds = new Set(fields.map((f) => f.kind));
  const hasCommit = commitAction !== null;
  const commitLabel = commitAction?.label?.toLowerCase() ?? '';

  // No commit → uncommitted
  if (!hasCommit && fields.length > 0) {
    return 'uncommitted';
  }

  // Single select, no other field types
  if (
    fields.length === 1 &&
    fieldKinds.size === 1 &&
    fieldKinds.has('select')
  ) {
    return 'singleSelect';
  }

  // Search pattern: has text input + commit labeled "search"/"find"/"go"
  if (
    fieldKinds.has('text') &&
    /\b(search|find|go)\b/i.test(commitLabel)
  ) {
    return 'searchSubmit';
  }

  // Filter pattern: multiple selects/toggles + commit labeled "apply"/"set"/"filter"
  if (
    !fieldKinds.has('counter') &&
    (fieldKinds.has('select') || fieldKinds.has('toggle')) &&
    fields.length >= 2 &&
    /\b(apply|set|filter)\b/i.test(commitLabel)
  ) {
    return 'filterApply';
  }

  // Toggle batch: only toggles + commit
  if (
    fieldKinds.size === 1 &&
    fieldKinds.has('toggle') &&
    fields.length >= 2
  ) {
    return 'toggleBatch';
  }

  // Default: multi-field config (has counters, or mixed types)
  return 'multiFieldConfig';
}

// ── Discrimination ────────────────────────────────────────────────────

/**
 * Determine whether a ComponentInteraction should be enriched with
 * a ConfigurationSession.
 *
 * Enrich when: subActions exist AND (has confirm action OR multiple distinct fields).
 * Simple single-select dropdowns are left untouched.
 */
export function shouldEnrich(interaction: ComponentInteraction): boolean {
  const subActions = interaction.metadata?.subActions;
  if (!subActions || !Array.isArray(subActions) || subActions.length === 0) {
    return false;
  }

  // Already enriched (idempotency)
  if (interaction.metadata?.configurationSession) {
    return false;
  }

  // Phase 0e: Enrich ANY Dropdown interaction that has at least one
  // field-changing subAction. Even single-select without a confirm action
  // benefits from the structural representation (field name + final value
  // vs raw action sequence). This handles the common case where the confirm
  // action (Done button) escapes as a separate interaction on SPA sites.
  const fieldLabels = new Set(
    (subActions as DropdownSubAction[])
      .filter((s) => s.action !== 'confirm')
      .map((s) => normalizeFieldName(s.label)),
  );

  return fieldLabels.size > 0;
}

// ── Main Enrichment Function ──────────────────────────────────────────

/**
 * Enrich a ComponentInteraction with structural semantic data.
 *
 * Pure function: ComponentInteraction → ComponentInteraction.
 * Adds `metadata.configurationSession` if the interaction qualifies.
 * Leaves the interaction unchanged if it doesn't qualify.
 *
 * @see docs/architecture/STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md §7
 */
export function enrichConfigurationSession(
  interaction: ComponentInteraction,
): ComponentInteraction {
  // Idempotency check
  if (interaction.metadata?.configurationSession) {
    return interaction;
  }

  if (!shouldEnrich(interaction)) {
    return interaction;
  }

  const rawSubActions = (interaction.metadata.subActions as DropdownSubAction[]) ?? [];

  // Step 1: Separate field changes from commit action
  const fieldSubActions = rawSubActions.filter((s) => s.action !== 'confirm');
  const commitAction =
    rawSubActions.find((s) => s.action === 'confirm') ?? null;

  // Step 2: Group by field name
  const groups = groupByField(fieldSubActions);

  // Step 3: Derive ConfigurationField from each group
  const fields: ConfigurationField[] = [];
  for (const [label, group] of groups) {
    const kind = deriveKind(group[0].action);
    const finalValue = extractFinalValue(group, kind);
    const delta = kind === 'counter' ? computeDelta(group) : undefined;

    fields.push({
      label,
      kind,
      finalValue,
      delta,
      subActionCount: group.length,
      evidence: group,
    });
  }

  // Step 4: Determine pattern
  const pattern = classifyPattern(fields, commitAction);

  // Step 5: Build ConfigurationSession
  const triggerLabel =
    (interaction.metadata?.targetName as string) ??
    interaction.trigger?.accessibleName ??
    '';

  const session: ConfigurationSession = {
    fields,
    commitAction,
    triggerLabel,
    pattern,
    rawInteractionType: interaction.type,
  };

  // Return a new interaction object with configurationSession added
  return {
    ...interaction,
    metadata: {
      ...interaction.metadata,
      configurationSession: session,
    },
  };
}

/**
 * Batch-enrich an array of ComponentInteractions.
 * Pure function — returns new array, does not mutate input.
 */
export function enrichConfigurationSessions(
  interactions: ComponentInteraction[],
): ComponentInteraction[] {
  return interactions.map(enrichConfigurationSession);
}

// ── Display Helpers (for timeline renderer) ───────────────────────────

/**
 * Generate a human-readable summary of a ConfigurationSession.
 * Format: "Configure Economy: Adults=2, Children=1, Class=Premium Economy"
 */
export function renderConfigurationSummary(
  session: ConfigurationSession,
): string {
  const parts = session.fields.map((f) => {
    switch (f.kind) {
      case 'toggle':
        return `${f.label}=${f.finalValue === 'true' ? 'on' : 'off'}`;
      case 'counter':
        return f.finalValue
          ? `${f.label}=${f.finalValue}`
          : `${f.label} ${f.delta !== undefined ? (f.delta > 0 ? `+${f.delta}` : `${f.delta}`) : '+1'}`;
      default:
        return `${f.label}=${f.finalValue}`;
    }
  });

  // Include the confirm action in the display (e.g., ", Done")
  const commitLabel = session.commitAction?.label;
  if (commitLabel) {
    parts.push(commitLabel);
  }

  const prefix = session.triggerLabel
    ? `${session.commitAction ? 'Configure' : 'Changed'} ${session.triggerLabel}`
    : session.commitAction
      ? 'Configure'
      : 'Changed';

  const suffix = !session.commitAction ? ' (not confirmed)' : '';

  return `${prefix}: ${parts.join(', ')}${suffix}`;
}
