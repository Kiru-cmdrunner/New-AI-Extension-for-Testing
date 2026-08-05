/**
 * SortSelection Capability Rule
 *
 * Classifies interactions where the user changed the ordering of a result set.
 *
 * Required: content-change on a DIFFERENT element than the control (remote effect)
 *           AND at least ONE sort-specific supporting signal: keyword "sort/order/
 *           price/relevance" OR Dropdown physical type.
 *
 *           Per the Paginate correction principle: remote content-change alone is
 *           NOT specific to sorting (it also indicates filtering, search, etc.).
 *           SortSelection must require at least one signal that specifically points
 *           to sorting. The two strongest sort-specific signals are:
 *             1. Keyword: "sort by", "price: low to high", "newest", "relevance"
 *             2. Dropdown physical type: sort controls are almost always dropdowns
 *
 *           This prevents SortSelection from claiming on every remote content-change.
 *
 * Supporting:
 *   - Keyword: "sort", "order", "arrange", "price: low", "price: high",
 *     "newest", "relevance", "a-z", "z-a" (keyword stream)
 *   - Dropdown physical type (physical-type stream)
 *   - netNodeDelta ≈ 0 (items reordered, not added/removed) (behavioral stream)
 *   - No strongly negative delta (rules out filter narrowing)
 *
 * Confidence:
 *   HIGH:   required + 2+ supporting (keyword + Dropdown + delta≈0)
 *   MEDIUM: required + 1 supporting (keyword OR Dropdown)
 *   LOW:    required via Dropdown only, no keyword, no delta signal
 *
 * Sort vs Filter conflict: both require remote content-change. Sort has priority 40
 * (lower specificity than Filter's 35). When both claim at the same confidence,
 * FilterSelection wins ties. When Sort has keyword + Dropdown + delta≈0 (HIGH)
 * and Filter has no keyword (LOW), Sort wins easily.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 4)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class SortSelectionRule implements CapabilityRule {
  readonly capability = 'SortSelection' as const;
  readonly priority = 40; // general content-change, slightly less specific than FilterSelection

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required 1: content-change on a DIFFERENT element (remote effect) ──
    const hasRemoteContentUpdate =
      evidence.behavioral.hasContentChange && evidence.behavioral.hasRemoteEffect;
    if (!hasRemoteContentUpdate) {
      return null;
    }

    // If URL PATH changed (different page), this is Navigate/OpenDetail territory.
    // Query-param-only changes (?sort=price) are still same-page sorting.
    if (evidence.sequence.urlPathChangedAfter) {
      return null;
    }

    // ── Required 2: at least ONE sort-specific signal ─────────────────
    const sortKeywordMatch = evidence.keywords.matches.find(
      (m) => m.capability === 'SortSelection',
    );
    const isDropdown = evidence.physical.interactionType === 'Dropdown';

    if (!sortKeywordMatch && !isDropdown) {
      // Remote content-change but no sort-specific evidence — could be filter,
      // search, or anything else. Don't claim.
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;
    let keywordCount = 0;

    // S1: Sort keyword match (keyword stream)
    if (sortKeywordMatch) {
      streams.add('keyword');
      supportingCount++;
      keywordCount++;
    }

    // S2: Dropdown physical type (physical-type stream)
    if (isDropdown) {
      streams.add('physical-type');
      supportingCount++;
    }

    // S3: netNodeDelta ≈ 0 (items reordered, not added/removed) (behavioral stream)
    // Range: -3 to +3 is considered "approximately zero" (frameworks may have
    // minor structural overhead around the same items).
    if (
      evidence.behavioral.netNodeDelta !== null &&
      Math.abs(evidence.behavioral.netNodeDelta) <= 3
    ) {
      streams.add('behavioral');
      supportingCount++;
    }

    // ── Confidence ────────────────────────────────────────────────────
    // HIGH requires keyword + at least 1 non-keyword supporting.
    // Without keyword, max is MEDIUM (Dropdown alone is the required signal).
    const nonKeywordSupporting = supportingCount - keywordCount;
    let confidence: CapabilityClaim['confidence'];

    if (keywordCount >= 1 && nonKeywordSupporting >= 1) {
      confidence = 'high';
    } else {
      // keyword only (MEDIUM), or Dropdown/something without keyword (MEDIUM)
      confidence = 'medium';
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
      reason: `remote content-change with sort evidence${sortKeywordMatch ? ` (keyword: ${sortKeywordMatch.matched.join(', ')})` : ''}${isDropdown ? ' (Dropdown type)' : ''}`,
    };
  }
}
