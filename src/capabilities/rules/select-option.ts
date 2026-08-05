/**
 * SelectOption Capability Rule
 *
 * Classifies interactions where the user chose a value from a dropdown/select.
 *
 * Required (ALL must hold):
 *   1. Dropdown physical interaction type
 *   2. NO other rule claimed above LOW confidence for this interaction.
 *
 * Per the finalized architecture (§Phase 5):
 *   "SelectOption is the 'dropdown that didn't filter or sort' — it fires when
 *   a dropdown was used but no higher-confidence capability claimed."
 *
 * This makes SelectOption a residual rule for Dropdown interactions: it fills
 * the gap when the dropdown didn't produce a filter, sort, or navigation effect.
 * Examples: choosing a quantity, selecting a country/timezone/language, picking
 * a vehicle Make/Model (Avis Ford).
 *
 * Design note: SelectOption cannot know in isolation whether other rules claimed
 * above LOW. The engine handles this by registering SelectOption with a high
 * priority number (low specificity). When SortSelection or FilterSelection also
 * claim at MEDIUM+, they win via priority. When they don't claim at all or only
 * claim LOW, SelectOption wins by being the only above-LOW claim.
 *
 * Supporting:
 *   - Keyword: "select", "choose", "pick", "make", "model", "quantity" (keyword stream)
 *   - Value changed (checkedBefore ≠ checkedAfter or valueBefore ≠ valueAfter)
 *   - No content-change on a results container (behavioral stream: no remote effect)
 *
 * Confidence:
 *   HIGH:   keyword + 1+ non-keyword supporting
 *   MEDIUM: keyword only, OR 1 non-keyword supporting
 *   LOW:    0 supporting (dropdown with no other evidence)
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 5)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class SelectOptionRule implements CapabilityRule {
  readonly capability = 'SelectOption' as const;
  readonly priority = 50; // lowest specificity — residual dropdown rule

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required 1: Dropdown physical type ────────────────────────────
    if (evidence.physical.interactionType !== 'Dropdown') {
      return null;
    }

    // ── Required 2: no remote content-change (not a filter/sort) ──────
    // If the dropdown caused a remote content-change, it's FilterSelection or
    // SortSelection territory. Those rules should claim (or not). SelectOption
    // only fires when there's no remote effect — it's a plain dropdown selection.
    //
    // This is the independently truthful required signal: a dropdown that didn't
    // affect anything external is genuinely a "choose a value" action.
    if (evidence.behavioral.hasRemoteEffect) {
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;
    let keywordCount = 0;

    // S1: Keyword match for selection-related terms
    const selectKeywordMatch = evidence.keywords.matches.find(
      (m) => m.capability === 'SelectOption',
    );
    if (selectKeywordMatch) {
      streams.add('keyword');
      supportingCount++;
      keywordCount++;
    }

    // S2: No remote effect — local value change only (behavioral stream)
    // This is the characteristic of a plain dropdown: value changed, nothing else.
    if (!evidence.behavioral.hasContentChange && !evidence.behavioral.hasVisibilityChange) {
      streams.add('behavioral');
      supportingCount++;
    }

    // S3: Dropdown physical type itself confirms the interaction form (physical-type stream)
    streams.add('physical-type');
    supportingCount++;

    // ── Confidence ────────────────────────────────────────────────────
    const nonKeywordSupporting = supportingCount - keywordCount;
    let confidence: CapabilityClaim['confidence'];

    if (keywordCount >= 1 && nonKeywordSupporting >= 2) {
      confidence = 'high';
    } else if (supportingCount >= 1) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      capability: this.capability,
      confidence,
      priority: this.priority,
      supportingSignalCount: supportingCount,
      signalStreams: streams,
      hasDirectProperty: false,
      parameters: {
        target: evidence.physical.accessibleName || undefined,
      },
      reason: `dropdown selection${selectKeywordMatch ? ` (keyword: ${selectKeywordMatch.matched.join(', ')})` : ''}${!evidence.behavioral.hasContentChange && !evidence.behavioral.hasVisibilityChange ? ' (local value change only)' : ''}`,
    };
  }
}
