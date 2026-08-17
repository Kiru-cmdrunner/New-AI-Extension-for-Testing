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
import type { IntentVocabularyRegistry } from '../domain-config/intent-vocabulary-registry';

/**
 * D7: Intent labels produced ONLY by the api-operation resolution path.
 * They describe network activity (often ambient background polling or a
 * navigation document GET) attributed to whichever step preceded it — not
 * the user's own action. canonicalizeSteps() drops them from workflow
 * identity so this attribution noise cannot split one physical workflow
 * into distinct patternIds.
 */
export const AMBIENT_API_INTENTS: ReadonlySet<string> = new Set([
  'Fetch data',
  'Submit form',
  'Update resource',
  'Delete resource',
]);

/**
 * Label a single interaction with its intent.
 *
 * @param interaction The interaction to label.
 * @param outcome Optional outcome for API-operation path.
 * @param vocabRegistry Optional M9.11 domain vocabulary registry. When
 *   provided, domain entries are checked BEFORE built-in vocabulary.
 */
export function labelIntent(
  interaction: ComponentInteraction,
  outcome?: ActionOutcome,
  vocabRegistry?: IntentVocabularyRegistry | null,
): IntentLabel {
  // 1. API-operation path
  if (outcome) {
    const apiIntent = resolveFromApiOperation(interaction, outcome);
    if (apiIntent) return apiIntent;
  }

  // 2. Vocabulary template path (domain registry first, then built-in)
  const domainIntent = vocabRegistry ? resolveFromDomainVocabulary(interaction, vocabRegistry) : null;
  if (domainIntent) return domainIntent;

  const vocabIntent = resolveFromVocabulary(interaction);
  if (vocabIntent) return vocabIntent;

  // 3. Button-text fallback
  return resolveFromButtonText(interaction);
}

/**
 * Label all interactions. Returns a map keyed by interactionId.
 *
 * M9.11/D1: The optional IntentVocabularyRegistry is now threaded
 * through to each labelIntent call so domain-specific intents are
 * resolved before built-in vocabulary.
 */
export function labelAllIntents(
  interactions: ComponentInteraction[],
  outcomes: Map<string, ActionOutcome>,
  vocabRegistry?: IntentVocabularyRegistry | null,
): Map<string, IntentLabel> {
  const result = new Map<string, IntentLabel>();
  for (const interaction of interactions) {
    const outcome = outcomes.get(interaction.interactionId);
    result.set(interaction.interactionId, labelIntent(interaction, outcome, vocabRegistry));
  }
  return result;
}

// ── Resolution paths ───────────────────────────────────────────────────

/**
 * D7.5: Whether an api-operation evidence row describes one of the
 * interaction's OWN navigation destinations.
 *
 * Synthetic navigation interactions (the projected twin of a full-page
 * form submit / link click) often carry the destination document GET as
 * attributed network evidence. That GET is the navigation itself, not
 * user-triggered data fetching — letting the api-operation path claim it
 * flips the step's intent label between "Fetch data" (when the row has a
 * status) and the accessible-name URL (when it doesn't yet), which made
 * workflow identity depend on a capture-timing race (F1 family).
 *
 * The evidence detail embeds the URL verbatim ("<op> API <method> <url>
 * -> <status>"), so the comparison is a substring containment against the
 * interaction's navigation toUrl set. F1 and the status-enrichment logic
 * are untouched — this only makes the LABEL invariant to them.
 */
function evidenceDescribesOwnDestination(
  interaction: ComponentInteraction,
  detail: string,
): boolean {
  const nav = interaction.behavioralEvidence?.applicationEvidence?.navigation;
  if (!nav || nav.length === 0) return false;
  for (const n of nav) {
    if (!n.toUrl) continue;
    if (detail.includes(n.toUrl.toLowerCase())) return true;
  }
  return false;
}

function resolveFromApiOperation(
  interaction: ComponentInteraction,
  outcome: ActionOutcome,
): IntentLabel | null {
  // D7.5: skip evidence rows describing the interaction's own navigation
  // destination(s) — they must not produce an ambient API intent label.
  const apiEvidence = outcome.supportingEvidence.find(
    (e) =>
      e.kind === 'api-operation' &&
      !evidenceDescribesOwnDestination(interaction, (e.detail ?? '').toLowerCase()),
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

/**
 * M9.11: Resolve intent from domain-specific vocabulary registry.
 * Domain entries take priority over built-in vocabulary.
 */
function resolveFromDomainVocabulary(
  interaction: ComponentInteraction,
  registry: IntentVocabularyRegistry,
): IntentLabel | null {
  const entries = registry.getAll();
  const trigger = interaction.trigger;

  for (const entry of entries) {
    if (matchesEntry(trigger, entry)) {
      return {
        interactionId: interaction.interactionId,
        intent: entry.intent,
        resolutionPath: 'button-text', // domain vocabulary match (text-based)
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
