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
    const subAny = sub as any;
    const label: string = subAny.label ?? '';
    const fieldName = normalizeFieldName(label);

    // For counters with generic labels, try to infer a better name from
    // the target's CSS selector or class. If we can't infer one, use
    // a sequential counter label ("Passenger 1", "Passenger 2") to keep
    // distinct stepper buttons as separate, readable fields.
    let key = fieldName;
    if (
      (subAny.action === 'increment' || subAny.action === 'decrement') &&
      (fieldName === 'Counter' || fieldName === '+' || fieldName === '-')
    ) {
      const inferredName = inferCounterName(sub);
      const elementId = subAny.targetElementId ?? subAny.target?.elementId ?? '';
      if (inferredName) {
        key = inferredName;
      } else if (elementId) {
        // Use elementId to distinguish but with a friendlier label.
        // The renderer will show "Passenger +1" etc.
        key = `__counter_${elementId}`;
      }
      // else: fall through with generic "Counter" key (all merge)
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
 *
 * Handles both raw DropdownSubAction (with full .target object) and
 * stripped metadata subActions (with flat targetCssSelector/targetClassName).
 */
function inferCounterName(sub: DropdownSubAction | Record<string, unknown>): string | null {
  // Extract CSS selector and class name from either shape
  const cssSelector = (sub as any)?.targetCssSelector ?? (sub as any)?.target?.cssSelector ?? '';
  const className = (sub as any)?.targetClassName ?? (sub as any)?.target?.className ?? '';

  // Check CSS selector for contextual keywords
  const selMatch = cssSelector.match?.(/(?:adult|child|children|infant|senior|youth|teen|pax|passenger|room|guest)(?:[-_a-z]*)?/i);
  if (selMatch) {
    const name = selMatch[0].replace(/[-_]/g, ' ').trim();
    if (name) return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  // Check className for contextual keywords
  const clsMatch = className.match?.(/(?:adult|child|children|infant|senior|youth|teen|pax|passenger|room|guest)(?:[-_a-z]*)?/i);
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
  // Count unnamed counter groups for sequential labeling
  let unnamedCounterIdx = 0;
  const fields: ConfigurationField[] = [];
  for (const [label, group] of groups) {
    const kind = deriveKind(group[0].action);
    const finalValue = extractFinalValue(group, kind);
    const delta = kind === 'counter' ? computeDelta(group) : undefined;

    // Convert internal __counter_<id> keys into sequential "Passenger N" labels
    let displayLabel = label;
    if (label.startsWith('__counter_')) {
      unnamedCounterIdx++;
      displayLabel = `Passenger ${unnamedCounterIdx}`;
    }

    fields.push({
      label: displayLabel,
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
 * Normalize a trigger label by removing common noise from accessible names.
 *
 * Many UIs concatenate counts, badges, or status indicators into the trigger's
 * accessible name: "1Economy", "3 Adults · Premium Economy", "Sort by (Relevance)".
 * This function strips leading digits, separator characters, and parenthetical
 * suffixes to produce a clean, readable label.
 *
 * Application-independent — uses only structural patterns in the string.
 */
export function normalizeTriggerLabel(raw: string): string {
  if (!raw) return '';
  let label = raw.trim();

  // Remove leading digits + optional separator: "1Economy" → "Economy",
  // "3 · Passengers" → "Passengers", "2x Rooms" → "Rooms"
  label = label.replace(/^\d+\s*[*×x]?\s*[·••\-\|:»]?\s*/i, '');

  // Remove trailing parenthetical or bracketed annotations:
  // "Sort (Relevance)" → "Sort", "Filter [3]" → "Filter"
  label = label.replace(/\s*[\(\[][^)\]]*[\)\]]\s*$/, '');

  // Collapse internal whitespace
  label = label.replace(/\s+/g, ' ').trim();

  // If everything was stripped, return the original
  return label || raw.trim();
}

/**
 * Choose the display verb based on the structural pattern.
 * This replaces the old "Configure if commit, Changed if not" logic with
 * pattern-aware verb selection that reads naturally for each interaction type.
 */
function verbForPattern(
  pattern: StructuralPattern,
  hasCommit: boolean,
): string {
  switch (pattern) {
    case 'singleSelect':
      return 'Select';
    case 'searchSubmit':
      return 'Search';
    case 'filterApply':
      return 'Filter';
    case 'toggleBatch':
      return hasCommit ? 'Configure' : 'Toggle';
    case 'multiFieldConfig':
      return hasCommit ? 'Configure' : 'Change';
    case 'uncommitted':
      return 'Change';
    default:
      return hasCommit ? 'Configure' : 'Change';
  }
}

/**
 * Render a single configuration field as a readable string.
 *
 * Rules (application-independent):
 * - toggle: "Field=on" or "Field=off"
 * - counter with finalValue: "Field=N"
 * - counter without finalValue: "Field +N" or "Field -N"
 * - select/text/date where label===value: just "Value"
 * - select/text/date where label≠value: "Field=Value"
 */
function renderField(f: ConfigurationField): string {
  switch (f.kind) {
    case 'toggle':
      return `${f.label}=${f.finalValue === 'true' ? 'on' : 'off'}`;

    case 'counter':
      if (f.finalValue) {
        return `${f.label}=${f.finalValue}`;
      }
      // No finalValue — show the delta
      if (f.delta !== undefined && f.delta !== 0) {
        return `${f.label} ${f.delta > 0 ? '+' : ''}${f.delta}`;
      }
      return `${f.label} +1`;

    case 'select':
    case 'text':
    case 'date':
    default:
      // Deduplicate: if the field label IS the value, show only the value.
      // "Premium Economy=Premium Economy" → "Premium Economy"
      if (f.label && f.finalValue && f.label.toLowerCase() === f.finalValue.toLowerCase()) {
        return f.finalValue;
      }
      // If we have both a label and a value, show "Label=Value"
      if (f.label && f.finalValue) {
        return `${f.label}=${f.finalValue}`;
      }
      // Fallback: show whichever we have
      return f.finalValue || f.label || '?';
  }
}

/**
 * Generate a human-readable summary of a ConfigurationSession.
 *
 * The rendering is fully pattern-aware and application-independent:
 * - Verb is chosen based on the structural pattern (Select, Configure, Filter, Search, Change)
 * - Trigger label is normalized (leading digits and noise stripped)
 * - Fields are rendered with label-value deduplication
 * - Commit action label is appended when present
 *
 * Examples:
 *   singleSelect:     Select "Premium Economy" from Economy
 *   multiFieldConfig: Configure Passengers: Adults=2, Children=1, Premium Economy, Done
 *   filterApply:      Filter Results: Star Rating=4, Price=Low to High, Apply
 *   searchSubmit:     Search Flights: "new york", Search
 *   toggleBatch:      Configure Settings: Notifications=on, Newsletter=off, Save
 *   uncommitted:      Change Sort: Relevance (not confirmed)
 */
export function renderConfigurationSummary(
  session: ConfigurationSession,
): string {
  const verb = verbForPattern(session.pattern, session.commitAction !== null);
  const triggerLabel = normalizeTriggerLabel(session.triggerLabel);

  const parts = session.fields.map(renderField);

  // Include the commit action label in the display (e.g., "Done", "Apply")
  const commitLabel = session.commitAction?.label;
  if (commitLabel) {
    parts.push(commitLabel);
  }

  // For searchSubmit, render as: Search Target: "query", Search
  // This avoids the awkward "Search: Search=query" repetition.
  if (session.pattern === 'searchSubmit' && session.fields.length === 1) {
    const queryValue = session.fields[0].finalValue || session.fields[0].label || '';
    const commitPart = commitLabel ? `, ${commitLabel}` : '';
    return triggerLabel
      ? `${verb} ${triggerLabel}: "${queryValue}"${commitPart}`
      : `${verb} "${queryValue}"${commitPart}`;
  }

  // For singleSelect, the format is more natural: Select Value from Target
  if (session.pattern === 'singleSelect' && session.fields.length === 1) {
    const valuePart = parts[0]; // The single field value
    const commitPart = commitLabel ? `, ${commitLabel}` : '';
    return triggerLabel
      ? `${verb} ${valuePart} from ${triggerLabel}${commitPart}`
      : `${verb} ${valuePart}${commitPart}`;
  }

  // For all other patterns: Verb Target: field1, field2, ...
  const suffix = !session.commitAction ? ' (not confirmed)' : '';
  const prefix = triggerLabel
    ? `${verb} ${triggerLabel}`
    : verb;

  return `${prefix}: ${parts.join(', ')}${suffix}`;
}
