/**
 * OpenDetail Capability Rule
 *
 * Classifies interactions where the user drilled into a specific item's
 * detail page (e.g., clicking a product in search results).
 *
 * Required (either A or B):
 *   A. URL path changed after this interaction AND the next URL contains
 *      an item-specific identifier (hasNextItemSpecificUrl = true).
 *   B. The trigger element is a Link whose own href contains an item-specific
 *      pattern (triggerHasItemSpecificHref = true). This covers cases where
 *      urlChangedAfter isn't available (last interaction, or user navigated
 *      back before the next interaction was captured).
 *
 * Supporting:
 *   - Preceded by list context (Search, Filter, Dropdown on same page)
 *   - Physical type: Link or Click (product links are typically <a>)
 *   - Keyword: "detail", "product", "item", "view", "open"
 *
 * Confidence:
 *   HIGH:   required + preceded by list context + Link type
 *   MEDIUM: required + 1 supporting
 *   LOW:    required + 0 supporting
 *
 * Conflict: Priority 10 (more specific than Navigate's 30). Wins ties when
 * both claim at the same confidence.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 3, Fix F4)
 */

import type { CapabilityRule } from '../capability-rule';
import type { CapabilityClaim } from '../capability-types';
import type { ExtractedEvidence } from '../evidence-extractor';

export class OpenDetailRule implements CapabilityRule {
  readonly capability = 'OpenDetail' as const;
  readonly priority = 10; // most specific navigation — beats Navigate in ties

  evaluate(evidence: ExtractedEvidence): CapabilityClaim | null {
    // ── Required A: URL path changed AND item-specific URL ────────────
    const hasNavToItemUrl =
      evidence.sequence.urlPathChangedAfter && evidence.sequence.hasNextItemSpecificUrl;

    // ── Required B: trigger's own href is item-specific ───────────────
    // F4 fix: use the trigger's href as a navigation target signal,
    // independent of the next interaction's URL.
    const hasItemHref = evidence.sequence.triggerHasItemSpecificHref;

    if (!hasNavToItemUrl && !hasItemHref) {
      return null;
    }

    // ── Supporting signals ────────────────────────────────────────────
    const streams = new Set<'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence'>();
    let supportingCount = 0;

    // S1: Preceded by list context (Search/Filter/Dropdown on same page)
    if (evidence.sequence.precededByListContext) {
      streams.add('sequence');
      supportingCount++;
    }

    // S2: Link or Click physical type (product links are <a>)
    if (
      evidence.physical.interactionType === 'Link' ||
      evidence.physical.interactionType === 'Click'
    ) {
      streams.add('physical-type');
      supportingCount++;
    }

    // S3: Keyword match for item/detail terms
    const hasDetailKeyword = evidence.keywords.matches.some((m) =>
      m.matched.some((kw) =>
        ['detail', 'product', 'item', 'view', 'open'].includes(kw.toLowerCase()),
      ),
    );
    if (hasDetailKeyword) {
      streams.add('keyword');
      supportingCount++;
    }

    // ── Confidence ────────────────────────────────────────────────────
    const nonKeywordSupporting = supportingCount - (hasDetailKeyword ? 1 : 0);
    let confidence: CapabilityClaim['confidence'];

    if (nonKeywordSupporting >= 2) {
      confidence = 'high';
    } else if (nonKeywordSupporting >= 1) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    const reason = hasItemHref && !hasNavToItemUrl
      ? `link to item-specific URL (href pattern match)`
      : `navigation to item-specific URL${evidence.sequence.nextUrl ? ` (${evidence.sequence.nextUrl})` : ''}`;

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
      reason,
    };
  }
}
