/**
 * Navigate Capability Rule
 *
 * Classifies interactions where the user moved to a different page or view.
 *
 * Required: URL PATH changed after this interaction (different page, not
 *           just query-param update). Filters and sorts that change query
 *           params on the same page are NOT navigation.
 *
 * Supporting:
 *   - Keyword: "home", "back", "next", "continue", "menu", "dashboard" (keyword stream)
 *   - Physical type: Link or Click (most navigation is via links/buttons) (physical-type stream)
 *   - URL also changed from previous interaction (sequence stream)
 *
 * Confidence:
 *   HIGH:   required + 2+ non-keyword supporting
 *   MEDIUM: required + 1 non-keyword supporting
 *   LOW:    required + 0 supporting (path changed but no other evidence)
 *
 * Conflict: OpenDetail has lower priority number (10) and wins ties when
 * the URL is item-specific. FilterSelection and SortSelection use
 * urlPathChangedAfter (same gate) but they claim at their own confidence
 * independently — if both the path changed AND a filter has evidence,
 * the path change wins for Navigate while the filter goes to alternatives.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 3, Fix F3)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class NavigateRule implements CapabilityRule {
  readonly capability = 'Navigate' as const;
  readonly priority = 30; // general — lower specificity than OpenDetail (10)

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required: URL PATH changed after this interaction ─────────────
    // Query-param-only changes (?brand=sony) are NOT navigation.
    // F3 fix: was urlChangedAfter (any URL difference), now urlPathChangedAfter.
    if (!evidence.sequence.urlPathChangedAfter) {
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;
    let keywordCount = 0;

    // S1: Keyword match for navigation terms (keyword stream)
    const navKeywordMatch = evidence.keywords.matches.find(
      (m) => m.capability === 'Navigate',
    );
    if (navKeywordMatch) {
      streams.add('keyword');
      supportingCount++;
      keywordCount++;
    }

    // S2: Link or Click physical type (physical-type stream)
    if (
      evidence.physical.interactionType === 'Link' ||
      evidence.physical.interactionType === 'Click'
    ) {
      streams.add('physical-type');
      supportingCount++;
    }

    // S3: URL also changed from previous interaction (sequence stream)
    // This confirms a navigation chain rather than a single jump
    if (evidence.sequence.urlChanged) {
      streams.add('sequence');
      supportingCount++;
    }

    // ── Confidence ────────────────────────────────────────────────────
    const nonKeywordSupporting = supportingCount - keywordCount;
    let confidence: CapabilityClaim['confidence'];

    if (nonKeywordSupporting >= 2) {
      confidence = 'high';
    } else if (nonKeywordSupporting >= 1 || keywordCount >= 1) {
      confidence = 'medium';
    } else {
      // Path changed but zero supporting — LOW, not MEDIUM.
      // F3 fix: previously defaulted to MEDIUM, which caused over-claiming.
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
      reason: `URL path changed after interaction${evidence.sequence.nextUrl ? ` → ${evidence.sequence.nextUrl}` : ''}`,
    };
  }
}
