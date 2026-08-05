/**
 * FilterSelection Capability Rule
 *
 * Classifies interactions where the user narrowed a result set by a criterion.
 *
 * Required (ALL must hold):
 *   1. content-change OR visibility-change on a DIFFERENT element than
 *      the control (remote effect) — the control affected something external.
 *   2. At least ONE filter-specific supporting signal:
 *        a. Keyword: "filter", "refine", "brand", "category", "department"
 *        b. Ancestor context: "filter", "sidebar", "facets" in roles/classes
 *        c. Strongly negative netNodeDelta (items removed from DOM)
 *
 *   Per the Paginate correction principle and the remote-change review:
 *   remote content-change alone is NOT specific to filtering. "Add to Cart"
 *   (cart badge text changes), colour swatch (image src changes), and many
 *   other UI updates also produce remote content-change. Without at least one
 *   filter-specific signal, the interaction is genuinely ambiguous and should
 *   be Unclassified rather than guessed as FilterSelection.
 *
 *   This mirrors how SortSelection requires at least one sort-specific signal
 *   (keyword or Dropdown) on top of remote content-change.
 *
 * Supporting (for confidence calibration):
 *   - Keyword: "filter", "refine", "brand", "category", "department" (keyword stream)
 *   - Ancestor context: "filter", "sidebar", "facets" (structural stream)
 *   - netNodeDelta strongly negative (behavioral stream)
 *
 * Confidence:
 *   HIGH:   keyword + 1+ non-keyword supporting, OR 2+ non-keyword supporting
 *   MEDIUM: 1 non-keyword supporting, OR keyword only
 *   LOW:    unreachable — the required gate needs ≥1 filter-specific signal,
 *           which by definition gives at least MEDIUM. LOW is kept as a
 *           defensive fallback but should never be produced.
 *
 * Amazon brand filter: Link + remote content-change + keyword "brand" + delta -15
 *   → keyword + behavioral = HIGH ✓
 *
 * "Add to Cart" → cart badge changes: remote content-change but no keyword,
 *   no filter ancestor, delta ≈ 0 → null ✓ (correctly Unclassified)
 *
 * "Blue" swatch → image src changes: remote content-change but no keyword,
 *   no filter ancestor, delta = 0 → null ✓ (correctly Unclassified)
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 4)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class FilterSelectionRule implements CapabilityRule {
  readonly capability = 'FilterSelection' as const;
  readonly priority = 35;

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required 1: content-change OR visibility-change on a DIFFERENT element ──
    const hasRemoteContentUpdate =
      (evidence.behavioral.hasContentChange || evidence.behavioral.hasVisibilityChange) &&
      evidence.behavioral.hasRemoteEffect;
    if (!hasRemoteContentUpdate) {
      return null;
    }

    // If URL PATH changed after this interaction (different page), this is
    // Navigate/OpenDetail territory. Query-param-only changes (?brand=sony)
    // are still same-page filtering and should NOT block FilterSelection.
    if (evidence.sequence.urlPathChangedAfter) {
      return null;
    }

    // ── Evaluate filter-specific signals ──────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;
    let keywordCount = 0;

    // S1: Keyword match for filter terms (keyword stream)
    const filterKeywordMatch = evidence.keywords.matches.find(
      (m) => m.capability === 'FilterSelection',
    );
    if (filterKeywordMatch) {
      streams.add('keyword');
      supportingCount++;
      keywordCount++;
    }

    // S2: Ancestor context has filter/sidebar/facets (structural stream)
    const hasFilterAncestor =
      evidence.physical.ancestorRoles.some((r) =>
        ['filter', 'sidebar', 'facets', 'navigation'].includes(r.toLowerCase()),
      ) ||
      evidence.physical.ancestorClasses.some((c) =>
        c.toLowerCase().includes('filter') ||
        c.toLowerCase().includes('sidebar') ||
        c.toLowerCase().includes('facet'),
      );
    if (hasFilterAncestor) {
      streams.add('structural');
      supportingCount++;
    }

    // S3: netNodeDelta strongly negative (items removed — filter narrows)
    if (evidence.behavioral.netNodeDelta !== null && evidence.behavioral.netNodeDelta < 0) {
      streams.add('behavioral');
      supportingCount++;
    }

    // ── Required 2: at least ONE filter-specific supporting signal ──
    // Remote content-change alone is insufficient — could be cart update,
    // image swap, or any other remote UI change. We need filter-specific
    // evidence to claim FilterSelection.
    if (supportingCount === 0) {
      return null;
    }

    // ── Confidence ────────────────────────────────────────────────────
    const nonKeywordSupporting = supportingCount - keywordCount;
    let confidence: CapabilityClaim['confidence'];

    if ((keywordCount >= 1 && nonKeywordSupporting >= 1) || nonKeywordSupporting >= 2) {
      confidence = 'high';
    } else {
      // Exactly 1 supporting signal (keyword-only or non-keyword-only)
      confidence = 'medium';
    }

    return {
      capability: this.capability,
      confidence,
      priority: this.priority,
      supportingSignalCount: supportingCount,
      signalStreams: streams,
      hasDirectProperty: evidence.behavioral.hasDirectPropertyEvidence,
      parameters: {
        target: evidence.physical.accessibleName || undefined,
      },
      reason: `remote content-change with filter evidence${filterKeywordMatch ? ` (keyword: ${filterKeywordMatch.matched.join(', ')})` : ''}${hasFilterAncestor ? ' (filter context)' : ''}${evidence.behavioral.netNodeDelta !== null && evidence.behavioral.netNodeDelta < 0 ? ` (delta ${evidence.behavioral.netNodeDelta})` : ''}`,
    };
  }
}
