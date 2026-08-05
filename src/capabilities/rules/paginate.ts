/**
 * Paginate Capability Rule
 *
 * Classifies interactions where the user moved to the next/previous page of
 * results, or loaded more results.
 *
 * Required: pagination-specific keyword match ("next page", "previous page",
 *           "load more", "show more", "›", "«", "page 2", etc.) AND no URL
 *           change (pagination stays on the same page — if URL changed, that
 *           is Navigate's domain).
 *
 * The keyword is the required signal because "content changed without
 * navigation" is shared by filter, sort, search, expand, and many other
 * capabilities — it is not specific to pagination. Only explicit pagination
 * language in the user-visible control label proves the intent was to
 * paginate.
 *
 * Supporting:
 *   - Content-change or visibility-change SemanticEffect (confirms items actually changed)
 *   - Physical type: Link or Click (pagination controls are links/buttons)
 *   - netNodeDelta > 0 (items added, not removed — pagination adds items)
 *   - Remote effect (changes on results container, not trigger itself)
 *
 * Confidence:
 *   HIGH:   required + 2+ non-keyword supporting
 *   MEDIUM: required + 1 non-keyword supporting
 *   LOW:    required + 0 non-keyword supporting
 *
 * Distinguishing from FilterSelection: Paginate requires a pagination keyword;
 * FilterSelection (Phase 4) requires remote content-change. They rarely
 * co-claim because filter controls don't have pagination keywords and
 * pagination controls don't have filter keywords. When they do co-claim,
 * the conflict resolver picks by confidence + priority.
 *
 * "Load more" → Paginate because "load more" is a pagination keyword.
 * "Show Reviews" → NOT Paginate (no pagination keyword) → Unclassified
 *   or ExpandCollapse depending on aria-expanded evidence.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 3, corrected)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class PaginateRule implements CapabilityRule {
  readonly capability = 'Paginate' as const;
  readonly priority = 25; // more specific than Navigate (30), less than OpenDetail (10)

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required 1: pagination-specific keyword match ────────────────
    // The keyword is the defining signal that distinguishes pagination
    // from other same-page content updates (filter, sort, expand, etc.).
    const paginateKeywordMatch = evidence.keywords.matches.find(
      (m) => m.capability === 'Paginate',
    );
    if (!paginateKeywordMatch) {
      return null;
    }

    // ── Required 2: no URL change ─────────────────────────────────────
    // If URL changed, that is Navigate's domain, not Paginate.
    if (evidence.sequence.urlChangedAfter) {
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;

    // S1: Keyword match present (keyword stream — already confirmed as required)
    streams.add('keyword');
    supportingCount++;

    // S2: Content-change or visibility-change confirms items actually changed (behavioral stream)
    const hasContentUpdate =
      evidence.behavioral.hasContentChange || evidence.behavioral.hasVisibilityChange;
    if (hasContentUpdate) {
      streams.add('behavioral');
      supportingCount++;
    }

    // S3: Link or Click physical type (physical-type stream)
    if (
      evidence.physical.interactionType === 'Link' ||
      evidence.physical.interactionType === 'Click'
    ) {
      streams.add('physical-type');
      supportingCount++;
    }

    // S4: netNodeDelta > 0 (items added — pagination adds items)
    if (evidence.behavioral.netNodeDelta !== null && evidence.behavioral.netNodeDelta > 0) {
      streams.add('structural');
      supportingCount++;
    }

    // S5: Remote effect (changes on results container, not trigger)
    if (evidence.behavioral.hasRemoteEffect) {
      streams.add('sequence');
      supportingCount++;
    }

    // ── Confidence ────────────────────────────────────────────────────
    // Keyword is already counted as 1 supporting. Count non-keyword supporting.
    const nonKeywordSupporting = supportingCount - 1; // subtract keyword
    let confidence: CapabilityClaim['confidence'];

    if (nonKeywordSupporting >= 2) {
      confidence = 'high';
    } else if (nonKeywordSupporting >= 1) {
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
      reason: `pagination keyword "${paginateKeywordMatch.matched.join(', ')}" present`,
    };
  }
}
