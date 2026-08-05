/**
 * Search Capability Rule
 *
 * Classifies interactions where the user entered a search query.
 *
 * Required: TextEntry physical type AND at least ONE search-specific signal:
 *           keyword "search/find/lookup/query" in label/ancestor OR content-change/
 *           navigation follows the text entry.
 *
 *           Per the Paginate correction principle: TextEntry alone is NOT specific
 *           to search (it could be form filling, login, comments, etc.).
 *           Search requires at least one signal that specifically indicates the
 *           text entry was a search action:
 *             1. Keyword: "search", "find", "query" in the field's label/placeholder
 *             2. Behavioral follow-up: content-change or navigation occurs after
 *                the text entry (search produces results or navigates to results page)
 *
 * Supporting:
 *   - Keyword: "search", "find", "lookup", "query", "go" (keyword stream)
 *   - Content-change on results after text entry (behavioral stream)
 *   - Navigation to a search results page (sequence stream)
 *   - Search-box ancestor context: role="search", class contains "search" (structural stream)
 *
 * Confidence:
 *   HIGH:   TextEntry + keyword + 1 non-keyword supporting
 *   MEDIUM: TextEntry + keyword only, OR TextEntry + content-change/navigation only
 *   LOW:    (not reachable — required needs at least 1 signal, which gives MEDIUM)
 *
 * C2 live-search case: TextEntry on a field with no "search" keyword, but content-change
 * follows (live search updates results) → Search MEDIUM (behavioral signal satisfies required).
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 4)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class SearchRule implements CapabilityRule {
  readonly capability = 'Search' as const;
  readonly priority = 30; // same as Navigate — different domain (text entry vs click)

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required 1: TextEntry physical type ───────────────────────────
    if (evidence.physical.interactionType !== 'TextEntry') {
      return null;
    }

    // ── Required 2: at least ONE search-specific signal ───────────────
    const searchKeywordMatch = evidence.keywords.matches.find(
      (m) => m.capability === 'Search',
    );

    // Behavioral signal: content-change or navigation follows the text entry
    const hasBehavioralFollowUp =
      evidence.behavioral.hasContentChange ||
      evidence.behavioral.hasRemoteEffect ||
      evidence.sequence.urlChangedAfter;

    // Structural signal: search-box context
    const hasSearchContext =
      evidence.physical.ancestorRoles.some((r) => r.toLowerCase() === 'search') ||
      evidence.physical.ancestorClasses.some((c) => c.toLowerCase().includes('search')) ||
      evidence.physical.ariaRole === 'searchbox';

    if (!searchKeywordMatch && !hasBehavioralFollowUp && !hasSearchContext) {
      // TextEntry with no search evidence — could be form filling, login, etc.
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;
    let keywordCount = 0;

    // S1: Search keyword match (keyword stream)
    if (searchKeywordMatch) {
      streams.add('keyword');
      supportingCount++;
      keywordCount++;
    }

    // S2: Content-change after text entry (behavioral stream)
    if (evidence.behavioral.hasContentChange || evidence.behavioral.hasRemoteEffect) {
      streams.add('behavioral');
      supportingCount++;
    }

    // S3: Navigation to search results page (sequence stream)
    if (evidence.sequence.urlChangedAfter) {
      streams.add('sequence');
      supportingCount++;
    }

    // S4: Search-box ancestor context (structural stream)
    if (hasSearchContext) {
      streams.add('structural');
      supportingCount++;
    }

    // ── Confidence ────────────────────────────────────────────────────
    // HIGH: keyword + 1+ non-keyword, OR 2+ non-keyword (structural + behavioral)
    const nonKeywordSupporting = supportingCount - keywordCount;
    let confidence: CapabilityClaim['confidence'];

    if ((keywordCount >= 1 && nonKeywordSupporting >= 1) || nonKeywordSupporting >= 2) {
      confidence = 'high';
    } else {
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
      reason: `TextEntry with search evidence${searchKeywordMatch ? ` (keyword: ${searchKeywordMatch.matched.join(', ')})` : ''}${hasBehavioralFollowUp ? ' (behavioral follow-up)' : ''}${hasSearchContext ? ' (search context)' : ''}`,
    };
  }
}
