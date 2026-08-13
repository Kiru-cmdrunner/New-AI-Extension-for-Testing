/**
 * M9.7 — Intent Labeler
 *
 * Labels each interaction with a canonical intent using three resolution
 * paths (in priority order):
 *   1. API-operation: if the outcome has an api-operation evidence item,
 *      derive intent from the operation type.
 *   2. Vocabulary template: match against the built-in vocabulary.
 *   3. Button-text: fall back to the element's accessible name or label.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { ActionOutcome } from '../outcome/outcome-types';
import type { IntentLabel } from './semantic-types';
import { getAllVocabEntries, type IntentVocabEntry } from './intent-vocabulary';

/**
 * Label a single interaction with its intent.
 */
export function labelIntent(
  interaction: ComponentInteraction,
  outcome?: ActionOutcome,
): IntentLabel {
  // 1. API-operation path
  if (outcome) {
    const apiIntent = resolveFromApiOperation(interaction, outcome);
    if (apiIntent) return apiIntent;
  }

  // 2. Vocabulary template path
  const vocabIntent = resolveFromVocabulary(interaction);
  if (vocabIntent) return vocabIntent;

  // 3. Button-text fallback
  return resolveFromButtonText(interaction);
}

/**
 * Label all interactions. Returns a map keyed by interactionId.
 */
export function labelAllIntents(
  interactions: ComponentInteraction[],
  outcomes: Map<string, ActionOutcome>,
): Map<string, IntentLabel> {
  const result = new Map<string, IntentLabel>();
  for (const interaction of interactions) {
    const outcome = outcomes.get(interaction.interactionId);
    result.set(interaction.interactionId, labelIntent(interaction, outcome));
  }
  return result;
}

// ── Resolution paths ───────────────────────────────────────────────────

function resolveFromApiOperation(
  interaction: ComponentInteraction,
  outcome: ActionOutcome,
): IntentLabel | null {
  // Look for api-operation evidence in the outcome
  const apiEvidence = outcome.supportingEvidence.find(
    (e) => e.kind === 'api-operation',
  );
  if (!apiEvidence) return null;

  // Map detail to an intent label
  const detail = apiEvidence.detail.toLowerCase();
  const intentMap: Record<string, string> = {
    'post': 'Submit form',
    'put': 'Update resource',
    'patch': 'Update resource',
    'delete': 'Delete resource',
    'get': 'Fetch data',
  };

  // Check if the detail mentions a specific operation
  for (const [op, intent] of Object.entries(intentMap)) {
    if (detail.includes(op)) {
      return {
        interactionId: interaction.interactionId,
        intent,
        resolutionPath: 'api-operation',
        confidence: 0.75,
      };
    }
  }

  return {
    interactionId: interaction.interactionId,
    intent: 'Submit form',
    resolutionPath: 'api-operation',
    confidence: 0.6,
  };
}

function resolveFromVocabulary(
  interaction: ComponentInteraction,
): IntentLabel | null {
  const entries = getAllVocabEntries();
  const trigger = interaction.trigger;

  for (const entry of entries) {
    if (matchesEntry(trigger, entry)) {
      return {
        interactionId: interaction.interactionId,
        intent: entry.intent,
        resolutionPath: 'button-text', // vocabulary match is text-based
        confidence: entry.baseConfidence,
      };
    }
  }

  return null;
}

function resolveFromButtonText(
  interaction: ComponentInteraction,
): IntentLabel {
  const label =
    interaction.trigger.accessibleName ??
    interaction.trigger.placeholder ??
    interaction.trigger.ariaLabel ??
    '';

  return {
    interactionId: interaction.interactionId,
    intent: label || interaction.type,
    resolutionPath: 'context',
    confidence: 0.3,
  };
}

// ── Matching ───────────────────────────────────────────────────────────

interface Matchable {
  accessibleName: string;
  className: string | null;
  tag: string;
  inputType: string | null;
  href: string | null;
}

function matchesEntry(trigger: Matchable, entry: IntentVocabEntry): boolean {
  for (const matcher of entry.matchers) {
    const value = getFieldValue(trigger, matcher.field);
    if (value === null) continue;
    try {
      const re = new RegExp(matcher.pattern, 'i');
      if (re.test(value)) return true;
    } catch {
      // If regex fails, skip
    }
  }
  return false;
}

function getFieldValue(
  trigger: Matchable,
  field: IntentVocabEntry['matchers'][number]['field'],
): string | null {
  switch (field) {
    case 'label':
      return trigger.accessibleName ?? '';
    case 'className':
      return trigger.className;
    case 'tag':
      return trigger.tag ?? '';
    case 'inputType':
      return trigger.inputType;
    case 'href':
      return trigger.href;
    default:
      return null;
  }
}
