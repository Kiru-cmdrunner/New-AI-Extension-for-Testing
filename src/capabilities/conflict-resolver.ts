/**
 * Conflict Resolver — selects the primary capability claim from competing
 * claims and demotes the rest to alternatives.
 *
 * Implements the 6 conflict resolution rules from §7 of the finalized
 * architecture:
 *
 * 1. Highest confidence wins. HIGH beats MEDIUM beats LOW.
 * 2. If same confidence: most supporting signals wins (count distinct streams).
 * 3. If still tied: lowest priority number wins (more specific rule).
 * 4. If only LOW claims exist: Unclassified wins. LOWs go to alternatives.
 * 5. Behavioral evidence beats keyword evidence when they conflict.
 * 6. The losing claim goes to the alternatives array with its rejection reason.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (§7)
 */

import type {
  CapabilityClaim,
  CapabilityAlternative,
  CapabilityConfidence,
} from './capability-types';

// ── Resolution Result ─────────────────────────────────────────────────

/**
 * The result of conflict resolution for one interaction.
 */
export interface ResolutionResult {
  /** The winning claim (primary). Null if no claims at all. */
  primary: CapabilityClaim | null;
  /** Losing claims, with rejection reasons. */
  alternatives: CapabilityAlternative[];
}

// ── Confidence Ordering ───────────────────────────────────────────────

const CONFIDENCE_RANK: Record<CapabilityConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

// ── Resolver ──────────────────────────────────────────────────────────

/**
 * Compare two claims to determine which wins.
 *
 * Order of comparison (per §7):
 * 1. Confidence: higher wins.
 * 2. Distinct signal streams: more wins.
 * 3. Priority number: lower wins (more specific).
 *
 * Returns negative if a wins, positive if b wins, 0 if truly tied.
 */
function compareClaims(a: CapabilityClaim, b: CapabilityClaim): number {
  // Rule 1: Confidence
  const confDiff = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
  if (confDiff !== 0) return confDiff;

  // Rule 2: Supporting signal count (distinct streams)
  const sigDiff = b.supportingSignalCount - a.supportingSignalCount;
  if (sigDiff !== 0) return sigDiff;

  // Rule 3: Priority number (lower = more specific = wins)
  return a.priority - b.priority;
}

/**
 * Resolve competing claims into a primary claim and alternatives.
 *
 * Per §7 rule 4: if only LOW claims exist (no MEDIUM or HIGH),
 * the primary is Unclassified and all LOW claims become alternatives.
 *
 * Per §7 rule 5: behavioral evidence (hasDirectProperty) is a tiebreaker
 * at the same confidence level — it overrides the pure signal-count comparison.
 *
 * @param claims - All non-null claims for this interaction.
 * @returns ResolutionResult with primary (or null) and alternatives.
 */
export function resolveClaims(claims: CapabilityClaim[]): ResolutionResult {
  if (claims.length === 0) {
    return { primary: null, alternatives: [] };
  }

  // Sort claims: best first
  const sorted = [...claims].sort(compareClaims);

  // Rule 4: If only LOW claims exist, Unclassified wins.
  // All LOW claims become alternatives.
  const hasAboveLow = sorted.some((c) => c.confidence !== 'low');
  if (!hasAboveLow) {
    const alternatives: CapabilityAlternative[] = sorted.map((c) => ({
      capability: c.capability,
      confidence: c.confidence,
      reason: c.reason,
    }));
    return { primary: null, alternatives };
  }

  // Rule 5: At the same confidence level, direct-property evidence wins.
  // Re-sort the top tier to prefer direct-property claims.
  const topConfidence = sorted[0].confidence;
  const topTier = sorted.filter((c) => c.confidence === topConfidence);
  if (topTier.length > 1) {
    topTier.sort((a, b) => {
      // Direct-property claims win ties at the same confidence
      if (a.hasDirectProperty && !b.hasDirectProperty) return -1;
      if (!a.hasDirectProperty && b.hasDirectProperty) return 1;
      // Fall back to signal count, then priority
      return compareClaims(a, b);
    });
  }

  // Primary is the best claim. Everything else is an alternative.
  const primary = topTier[0];
  const losers = sorted.slice(1); // exclude primary

  const alternatives: CapabilityAlternative[] = losers.map((c) => ({
    capability: c.capability,
    confidence: c.confidence,
    reason: c.reason,
  }));

  return { primary, alternatives };
}

// ── Unclassified Fallback ─────────────────────────────────────────────

/**
 * The reason string for Unclassified when no rule claims at all.
 */
export const NO_CLAIM_REASON = 'No capability rule claimed for this interaction';

/**
 * The reason string for Unclassified when only LOW claims exist.
 */
export const ONLY_LOW_CLAIMS_REASON = 'Only LOW confidence claims — insufficient evidence for confident classification';
