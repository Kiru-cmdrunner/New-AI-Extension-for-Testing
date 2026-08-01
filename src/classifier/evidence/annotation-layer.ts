/**
 * Semantic Annotation Layer
 *
 * A post-classification pass that runs after the Component Runtime emits
 * interactions but before they're persisted. It attaches semantic intent,
 * confidence, and evidence trail to every interaction.
 *
 * For lifecycle definitions (TextEntry, DatePicker, Slider, etc.):
 *   - Intent is statically mapped from the interaction type
 *   - Confidence is 1.0 (deterministic lifecycle match)
 *   - Evidence is a synthetic "Lifecycle match" proof
 *
 * For the Click definition (universal fallback where ambiguity lives):
 *   - The full evidence pipeline runs (FeatureView → generators → fusion)
 *   - The type may be reclassified (Click → Checkbox, Click → Link, etc.)
 *   - Confidence and evidence trail come from the fusion result
 *
 * Architecture: .drytis/PHASE2_DESIGN.md §3.2.3
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { SemanticIntent } from './types';
import { classifyByEvidence } from './evidence-classifier';

// ── Type → Intent Static Mapping ───────────────────────────────────────

/**
 * Map lifecycle interaction types to their semantic intent.
 *
 * These are deterministic — a TextEntry is always 'input', a Checkbox is
 * always 'toggle', etc. The evidence engine's generators don't need to
 * run because the lifecycle definition already resolved the classification.
 */
const TYPE_TO_INTENT: Record<string, SemanticIntent> = {
  // Input intents
  TextEntry: 'input',
  TagInput: 'input',
  OtpInput: 'input',

  // Select intents
  Dropdown: 'select',
  DatePicker: 'select',
  Slider: 'select',
  RadioButton: 'select',
  Tab: 'select',

  // Toggle intents
  Checkbox: 'toggle',

  // Navigate intents
  Link: 'navigate',
  Navigation: 'navigate',
  NewTab: 'navigate',
  NewWindow: 'navigate',
  Breadcrumb: 'navigate',

  // Explore intents
  Hover: 'explore',

  // Trigger intents (generic actions)
  Click: 'trigger',
  Stepper: 'trigger',
  FileUpload: 'trigger',
  DragDrop: 'trigger',
  KeyboardShortcut: 'trigger',
  HotkeySequence: 'trigger',
  ModalDialog: 'trigger',
  Scroll: 'trigger',
};

/**
 * Confidence threshold for evidence-based reclassification of Click interactions.
 *
 * If the evidence engine's confidence is below this threshold, the interaction
 * stays as 'Click' (trigger intent). Above it, the type is reclassified.
 */
const RECLASSIFY_THRESHOLD = 0.5;

/**
 * R3.5: Unrecognized interaction threshold.
 *
 * If the evidence engine produces a classification with confidence below
 * this threshold AND no generator produced meaningful evidence (max weight
 * < this threshold), the interaction is flagged as 'unrecognized'.
 *
 * This surfaces truly novel interactions instead of silently degrading them
 * to Click. The side panel can display a "low confidence" indicator.
 */
const UNRECOGNIZED_THRESHOLD = 0.3;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Annotate a single interaction with semantic intent, confidence, and evidence.
 *
 * For Click interactions: runs the full evidence pipeline and may reclassify.
 * For all other interactions: applies a static type→intent mapping.
 *
 * @param interaction  The ComponentInteraction to annotate (mutated in place)
 * @returns The same interaction, now with intent/confidence/evidenceTrail
 */
export function annotateWithEvidence(interaction: ComponentInteraction): ComponentInteraction {
  // Click is the ambiguous case — run the full evidence pipeline
  if (interaction.type === 'Click' && !interaction.interactionSubtype) {
    return annotateClick(interaction);
  }

  // All other types: static mapping
  return annotateLifecycle(interaction);
}

/**
 * Annotate all interactions in a batch.
 * Each interaction is annotated independently (pure function per interaction).
 */
export function annotateAll(interactions: ComponentInteraction[]): ComponentInteraction[] {
  return interactions.map(annotateWithEvidence);
}

// ── Internal: Click Annotation ─────────────────────────────────────────

/**
 * Run the full evidence pipeline on a Click interaction.
 *
 * If the evidence is strong enough (confidence ≥ RECLASSIFY_THRESHOLD), the
 * interaction type is reclassified to the evidence-derived type. Otherwise
 * it stays as Click with trigger intent.
 */
function annotateClick(interaction: ComponentInteraction): ComponentInteraction {
  try {
    const classification = classifyByEvidence(interaction);

    // Attach semantic fields
    interaction.intent = classification.intent;
    interaction.confidence = classification.confidence;
    interaction.evidenceTrail = classification.evidence;

    // Reclassify if evidence is strong enough and the type changed
    if (
      classification.confidence >= RECLASSIFY_THRESHOLD &&
      classification.type !== 'Click' &&
      classification.type !== 'DoubleClick' &&
      classification.type !== 'RightClick'
    ) {
      // Don't reclassify if the evidence says Click — it's already Click
      interaction.interactionSubtype = classification.type as string;
    }

    // R3.5: Flag unrecognized interactions — low confidence AND no meaningful evidence
    const maxEvidenceWeight = classification.evidence.length > 0
      ? Math.max(...classification.evidence.map(e => Math.abs(e.weight)))
      : 0;
    if (classification.confidence < UNRECOGNIZED_THRESHOLD && maxEvidenceWeight < UNRECOGNIZED_THRESHOLD) {
      interaction.metadata.unrecognized = true;
      interaction.metadata.recognitionNote = 'No evidence generator produced meaningful signal for this interaction';
    }
  } catch {
    // If the evidence engine fails, fall back to static annotation
    interaction.intent = 'trigger';
    interaction.confidence = 0;
    interaction.evidenceTrail = [];
    interaction.metadata.unrecognized = true;
    interaction.metadata.recognitionNote = 'Evidence engine error during classification';
  }

  return interaction;
}

// ── Internal: Lifecycle Annotation ─────────────────────────────────────

/**
 * Annotate a lifecycle interaction with a static type→intent mapping.
 *
 * Confidence is 1.0 because the lifecycle definition's match is deterministic.
 * Evidence is a synthetic proof entry.
 */
function annotateLifecycle(interaction: ComponentInteraction): ComponentInteraction {
  const intent = TYPE_TO_INTENT[interaction.type] ?? 'trigger';

  interaction.intent = intent;
  interaction.confidence = 1.0;
  interaction.evidenceTrail = [{
    intent,
    weight: 1.0,
    source: 'lifecycle-definition',
    reason: `Lifecycle match: ${interaction.type} definition`,
  }];

  return interaction;
}
