/**
 * AdjustValue Capability Rule
 *
 * Classifies interactions where the user set a numeric or range value
 * via a slider, spinbutton, or similar continuous control.
 *
 * Required (ALL must hold):
 *   1. Slider-like physical type: role='slider', role='spinbutton',
 *      or INPUT[type=range]. Identified by isSliderLike in PhysicalEvidence.
 *   2. userAdjusted=true: the user actually changed the value (not just focus).
 *      This comes from interaction.metadata.userAdjusted, set by the slider
 *      and spinbutton definitions during recording.
 *
 * Supporting:
 *   - Keyword: "price", "range", "quantity", "volume" (keyword stream)
 *   - Content-change on results (behavioral stream: adjusting a price filter
 *     updates product results)
 *   - Remote effect on different element (behavioral stream)
 *
 * Confidence:
 *   HIGH:   keyword + 1+ non-keyword supporting, OR 2+ non-keyword supporting
 *   MEDIUM: 1 non-keyword supporting, OR keyword only
 *   LOW:    0 supporting (slider adjusted with no other evidence)
 *
 * Amazon price slider + results change → AdjustValue HIGH
 *   (with FilterSelection as alternative if filter-specific signals also present)
 * Volume slider on a media player → AdjustValue MEDIUM
 *   (userAdjusted + slider type, no keyword, no content-change)
 * Slider focus-only traversal (userAdjusted=false) → null
 *   (filtered at the required gate)
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 5)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class AdjustValueRule implements CapabilityRule {
  readonly capability = 'AdjustValue' as const;
  readonly priority = 22; // specific: requires physical + metadata evidence

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required 1: Slider-like physical type ──────────────────────────
    if (!evidence.physical.isSliderLike) {
      return null;
    }

    // ── Required 2: userAdjusted=true ──────────────────────────────────
    if (!evidence.physical.userAdjusted) {
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;
    let keywordCount = 0;

    // S1: Keyword match for adjust-value-related terms
    const adjustKeywordMatch = evidence.keywords.matches.find(
      (m) => m.capability === 'AdjustValue',
    );
    if (adjustKeywordMatch) {
      streams.add('keyword');
      supportingCount++;
      keywordCount++;
    }

    // S2: Content-change on results (behavioral stream)
    // Adjusting a price slider that updates product results provides
    // strong behavioral evidence.
    if (evidence.behavioral.hasRemoteEffect) {
      streams.add('behavioral');
      supportingCount++;
    }

    // S3: Slider/spinbutton physical type confirms the interaction (physical-type stream)
    streams.add('physical-type');
    supportingCount++;

    // ── Confidence ────────────────────────────────────────────────────
    const nonKeywordSupporting = supportingCount - keywordCount;
    let confidence: CapabilityClaim['confidence'];

    if ((keywordCount >= 1 && nonKeywordSupporting >= 1) || nonKeywordSupporting >= 2) {
      confidence = 'high';
    } else if (nonKeywordSupporting >= 1 || keywordCount >= 1) {
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
      reason: `value adjusted on slider/spinbutton${adjustKeywordMatch ? ` (keyword: ${adjustKeywordMatch.matched.join(', ')})` : ''}${evidence.behavioral.hasRemoteEffect ? ' (content-change on results)' : ''}`,
    };
  }
}
