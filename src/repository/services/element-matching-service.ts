/**
 * Element Matching Service (R4) — matches fresh UiElements from a new recording
 * against stored Element entities from the Repository.
 *
 * R4 changes from the original:
 *   - Element entity now carries a durable ElementIdentityRecord (9 fields).
 *   - Scoring uses 8 independently-weighted dimensions (no averaging).
 *   - Three-category result: MATCHED, AMBIGUOUS, UNMATCHED.
 *   - Ambiguity detection via margin check (best vs second-best candidate).
 *   - Identity fields read from Element.identity when available; falls back
 *     to reverse-engineering from locatorStrategies for pre-R4 Elements.
 *
 * All weights, thresholds, and margins are named policy constants so they
 * can be calibrated without restructuring the algorithm.
 *
 * Design: .drytis/specs/r4-element-identity-matching-foundation.md §5.4
 */

import type { UiElement } from '../../domain/entities/ui-element';
import type { Element, ElementIdentityRecord } from '../../domain/entities/element';
import type { ElementIdentity } from '../../shared/types';
import { LocatorStrategyType } from '../../domain/enums';

// ── Types ────────────────────────────────────────────────────

/** A confident match between a fresh UiElement and a stored Element. */
export interface ElementMatch {
  /** The stored Element from the Repository. */
  readonly storedElement: Element;
  /** The fresh UiElement from the new recording. */
  readonly freshUiElement: UiElement;
  /** Match score (0.0–1.0). */
  readonly matchScore: number;
  /** Score margin between this match and the next-best candidate. */
  readonly margin: number;
}

/** An ambiguous match — multiple candidates above threshold, cannot distinguish. */
export interface AmbiguousMatch {
  /** The fresh UiElement that has multiple candidates. */
  readonly freshUiElement: UiElement;
  /** All stored candidates that scored above threshold. */
  readonly candidates: ReadonlyArray<{
    readonly storedElement: Element;
    readonly matchScore: number;
  }>;
}

/**
 * Result of matching a batch of fresh elements against stored elements.
 *
 * Three categories:
 *   - matched:   confidently paired (score ≥ threshold, margin ≥ MIN_MARGIN)
 *   - ambiguous: multiple candidates, cannot safely distinguish
 *   - unmatched: no candidate above threshold (new element)
 */
export interface ElementMatchResult {
  readonly matched: ElementMatch[];
  readonly ambiguous: AmbiguousMatch[];
  readonly unmatched: UiElement[];
}

// ── Identity Signature ──────────────────────────────────────

/**
 * Normalised identity signature used for scoring.
 * Extracted from either a fresh UiElement or a stored Element.
 */
interface IdentitySignature {
  accessibleName: string;
  ariaRole: string | null;
  tag: string;
  /** HTML `name` attribute — backend-facing form field identifier. */
  name: string | null;
  /** Explicit `aria-label` attribute. */
  ariaLabel: string | null;
  /** Ancestor role chain from DomContext. */
  ancestorRoles: string[] | null;
  /** `data-testid` value. */
  testId: string | null;
  /** `data-cy` value. */
  dataCy: string | null;
  /** `data-qa` value. */
  dataQa: string | null;
  /** Source URL / page scope. */
  sourceUrl: string;
}

// ── R4 Scoring Policy Constants ──────────────────────────────
//
// All weights and thresholds are named so they can be tuned
// without restructuring the algorithm.

export const SCORING_POLICY = {
  WEIGHTS: {
    /** Business identifiers (testId/dataCy/dataQa) — definitive when present. */
    BUSINESS_IDS: 0.25,
    /** Accessible name — primary semantic label. */
    ACCESSIBLE_NAME: 0.20,
    /** HTML name attribute — backend-facing form field identifier. */
    FORM_NAME: 0.15,
    /** ARIA role — semantic contract (combobox, textbox, etc.). */
    ARIA_ROLE: 0.10,
    /** Explicit aria-label — independent of accessible name. */
    ARIA_LABEL: 0.10,
    /** Ancestor role chain — structural context (section/dialog/form). */
    ANCESTOR_ROLES: 0.10,
    /** HTML tag name — very stable but low disambiguation power. */
    TAG: 0.05,
    /** Source URL / page scope. */
    PAGE_SCOPE: 0.05,
  },
  /** Minimum score for a candidate to be considered. */
  MATCH_THRESHOLD: 0.70,
  /** Minimum gap between best and second-best candidate for MATCHED. */
  MIN_MARGIN: 0.05,
  /** Neutral score when a field is missing on one or both sides. */
  NEUTRAL: 0.5,
  /** Score when ancestorRoles are missing on both sides (was 1.0 pre-R4). */
  NEUTRAL_BOTH_MISSING: 0.5,
  /** Score when ancestorRoles present on only one side. */
  ANCESTOR_ONE_SIDE: 0.25,
} as const;

// Backward-compatible export name
const MATCH_THRESHOLD = SCORING_POLICY.MATCH_THRESHOLD;

// ── Signature Extraction ────────────────────────────────────

/**
 * Extract signature from a fresh UiElement's ElementIdentity.
 * Includes ancestorRoles from the UiElement (R4 propagation from DomContext).
 */
function extractSignature(
  identity: ElementIdentity,
  sourceUrl?: string,
  ancestorRoles?: readonly string[],
): IdentitySignature {
  return {
    accessibleName: identity.accessibleName ?? '',
    ariaRole: identity.ariaRole,
    tag: identity.tag ?? '',
    name: identity.name ?? null,
    ariaLabel: identity.ariaLabel ?? null,
    ancestorRoles: ancestorRoles ? [...ancestorRoles] : null,
    testId: identity.testId ?? null,
    dataCy: identity.dataCy ?? null,
    dataQa: identity.dataQa ?? null,
    sourceUrl: sourceUrl ?? '',
  };
}

/**
 * Extract signature from a stored Element.
 *
 * R4 path: If the Element has an `identity` record (ElementIdentityRecord),
 * use it directly — this is the durable semantic identity captured at
 * recording time.
 *
 * Fallback path: For pre-R4 Elements (identity === null or undefined),
 * reverse-engineer what we can from logicalName, pageOrComponent, and
 * locatorStrategies (scanning for TEST_ID type entries).
 */
function extractStoredSignature(element: Element): IdentitySignature {
  // R4 path: use stored identity record
  if (element.identity) {
    const id: ElementIdentityRecord = element.identity;
    return {
      accessibleName: id.accessibleName ?? element.logicalName,
      ariaRole: id.ariaRole,
      tag: id.tag ?? '',
      name: id.name,
      ariaLabel: id.ariaLabel,
      ancestorRoles: id.ancestorRoles ? [...id.ancestorRoles] : null,
      testId: id.testId,
      dataCy: id.dataCy,
      dataQa: id.dataQa,
      sourceUrl: element.pageOrComponent,
    };
  }

  // Pre-R4 fallback: reverse-engineer from locators + metadata
  let testId: string | null = null;
  for (const strategy of element.locatorStrategies) {
    if (strategy.type === LocatorStrategyType.TEST_ID && !testId) {
      testId = strategy.value;
    }
  }

  return {
    accessibleName: element.logicalName,
    ariaRole: null,
    tag: '',
    name: null,
    ariaLabel: null,
    ancestorRoles: null,
    testId,
    dataCy: null,
    dataQa: null,
    sourceUrl: element.pageOrComponent,
  };
}

// ── Scoring Helpers ─────────────────────────────────────────

/**
 * Jaccard similarity for two arrays of strings.
 * Returns 0.0–1.0.
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * String equality: 1.0 for exact match (case-insensitive), 0.0 otherwise.
 * Both empty → 1.0 (both missing = consistent).
 */
function stringEqual(a: string, b: string): number {
  if (!a && !b) return 1.0;
  if (!a || !b) return 0.0;
  return a.toLowerCase() === b.toLowerCase() ? 1.0 : 0.0;
}

/**
 * Neutral string equality for nullable fields.
 * When both sides are missing → NEUTRAL_BOTH_MISSING (0.5).
 * When one side is missing → NEUTRAL (0.5).
 * When both present → exact match (1.0) or mismatch (0.0).
 */
function stringEqualNeutral(
  a: string | null,
  b: string | null,
  neutralScore = SCORING_POLICY.NEUTRAL,
): number {
  const aVal = a?.trim() ?? '';
  const bVal = b?.trim() ?? '';
  if (!aVal && !bVal) return 1.0; // Both missing = consistent
  if (!aVal || !bVal) return neutralScore; // One missing = unknown
  return aVal.toLowerCase() === bVal.toLowerCase() ? 1.0 : 0.0;
}

/**
 * Business ID scoring (testId/dataCy/dataQa).
 *
 * If both sides have at least one ID: any match → 1.0, else 0.0.
 * If neither has any: neutral (0.5).
 * If one has and the other doesn't: neutral (0.5).
 */
function scoreBusinessIds(a: IdentitySignature, b: IdentitySignature): number {
  const aIds = [a.testId, a.dataCy, a.dataQa].filter((v): v is string => !!v?.trim());
  const bIds = [b.testId, b.dataCy, b.dataQa].filter((v): v is string => !!v?.trim());

  if (aIds.length > 0 && bIds.length > 0) {
    // Both have IDs — any intersection = match, otherwise strong negative
    const aSet = new Set(aIds.map((s) => s.toLowerCase()));
    const bSet = new Set(bIds.map((s) => s.toLowerCase()));
    const hasMatch = [...aSet].some((v) => bSet.has(v));
    return hasMatch ? 1.0 : 0.0;
  }
  return SCORING_POLICY.NEUTRAL; // Neither side or one-side missing
}

// ── Similarity Scoring (R4: 8 independent dimensions) ────────

/**
 * Compute weighted similarity between two identity signatures.
 *
 * R4: Each field scored independently with its own weight.
 * No averaging or collapsing of fields.
 *
 * Returns 0.0–1.0.
 */
function computeSimilarity(a: IdentitySignature, b: IdentitySignature): number {
  const W = SCORING_POLICY.WEIGHTS;

  let score = 0;

  // 1. Business IDs (25%)
  score += W.BUSINESS_IDS * scoreBusinessIds(a, b);

  // 2. Accessible name (20%) — exact match
  score += W.ACCESSIBLE_NAME * stringEqual(a.accessibleName, b.accessibleName);

  // 3. Form name (15%) — strong disambiguator for same-name fields
  score += W.FORM_NAME * stringEqualNeutral(a.name, b.name);

  // 4. ARIA role (10%)
  score += W.ARIA_ROLE * stringEqualNeutral(a.ariaRole, b.ariaRole);

  // 5. ARIA label (10%) — independent of accessible name
  score += W.ARIA_LABEL * stringEqualNeutral(a.ariaLabel, b.ariaLabel);

  // 6. Ancestor roles (10%) — Jaccard with corrected neutral scoring
  if (
    a.ancestorRoles && a.ancestorRoles.length > 0 &&
    b.ancestorRoles && b.ancestorRoles.length > 0
  ) {
    score += W.ANCESTOR_ROLES * jaccardSimilarity(a.ancestorRoles, b.ancestorRoles);
  } else if (
    (!a.ancestorRoles || a.ancestorRoles.length === 0) &&
    (!b.ancestorRoles || b.ancestorRoles.length === 0)
  ) {
    // Both missing — NEUTRAL, NOT 1.0 (R4 fix)
    score += W.ANCESTOR_ROLES * SCORING_POLICY.NEUTRAL_BOTH_MISSING;
  } else {
    // One has, one doesn't — partial penalty
    score += W.ANCESTOR_ROLES * SCORING_POLICY.ANCESTOR_ONE_SIDE;
  }

  // 7. Tag (5%)
  score += W.TAG * stringEqualNeutral(a.tag, b.tag);

  // 8. Page scope (5%)
  score += W.PAGE_SCOPE * stringEqualNeutral(a.sourceUrl, b.sourceUrl);

  return score;
}

// ── Element Matching Service ─────────────────────────────────

/**
 * Match a batch of fresh UiElements against stored Elements.
 *
 * R4 algorithm:
 *   For each fresh element F:
 *     1. Score F against every stored element S.
 *     2. Collect all S where score ≥ MATCH_THRESHOLD → candidates[].
 *     3. If no candidates → UNMATCHED.
 *     4. If exactly 1 candidate → MATCHED.
 *     5. If best.margin ≥ MIN_MARGIN → MATCHED (best candidate).
 *     6. Otherwise → AMBIGUOUS (all candidates returned).
 *
 * Then apply greedy 1:1 claiming on MATCHED pairs only.
 * AMBIGUOUS and UNMATCHED are returned as-is.
 *
 * @param freshElements UiElements from the new recording session.
 * @param storedElements Elements from the Repository (scoped to project).
 * @returns Three-category match result.
 */
export function matchElements(
  freshElements: readonly UiElement[],
  storedElements: readonly Element[],
): ElementMatchResult {
  // Phase 1: Score every fresh × stored pair and classify each fresh element
  interface ScoredCandidate {
    fresh: UiElement;
    stored: Element;
    score: number;
  }

  const matched: ElementMatch[] = [];
  const ambiguous: AmbiguousMatch[] = [];
  const unmatched: UiElement[] = [];

  // Track which fresh elements have been classified (not yet claimed)
  const classifiedFresh = new Set<string>();

  // Collect all high-scoring candidates per fresh element
  const allCandidates = new Map<string, ScoredCandidate[]>();

  for (const fresh of freshElements) {
    const freshSig = extractSignature(
      fresh.identity,
      fresh.sourceUrl,
      fresh.ancestorRoles,
    );

    const candidates: ScoredCandidate[] = [];
    for (const stored of storedElements) {
      const storedSig = extractStoredSignature(stored);
      const score = computeSimilarity(freshSig, storedSig);
      if (score >= MATCH_THRESHOLD) {
        candidates.push({ fresh, stored, score });
      }
    }

    allCandidates.set(fresh.elementId, candidates);
  }

  // Phase 2: Classify each fresh element based on its candidates
  for (const fresh of freshElements) {
    const candidates = allCandidates.get(fresh.elementId) ?? [];

    if (candidates.length === 0) {
      // No candidate above threshold
      unmatched.push(fresh);
      classifiedFresh.add(fresh.elementId);
      continue;
    }

    if (candidates.length === 1) {
      // Single candidate — MATCHED (margin = infinity, no competition)
      // Classification is tentative; greedy claiming happens below
      continue;
    }

    // Multiple candidates — sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    const best = candidates[0];
    const second = candidates[1];
    const margin = best.score - second.score;

    if (margin >= SCORING_POLICY.MIN_MARGIN) {
      // Clear winner — will be claimed in greedy phase
      continue;
    } else {
      // Ambiguous — cannot distinguish
      ambiguous.push({
        freshUiElement: fresh,
        candidates: candidates.map((c) => ({
          storedElement: c.stored,
          matchScore: c.score,
        })),
      });
      classifiedFresh.add(fresh.elementId);
    }
  }

  // Phase 3: Greedy 1:1 claiming on MATCHED pairs only
  // Collect all confidently-matchable pairs (single-candidate or margin-clear)
  const greedyCandidates: ScoredCandidate[] = [];
  for (const fresh of freshElements) {
    if (classifiedFresh.has(fresh.elementId)) continue; // Already classified

    const candidates = allCandidates.get(fresh.elementId) ?? [];
    if (candidates.length === 1) {
      greedyCandidates.push(candidates[0]);
    } else if (candidates.length > 1) {
      // Multiple candidates with sufficient margin — take the best
      candidates.sort((a, b) => b.score - a.score);
      greedyCandidates.push(candidates[0]);
    }
  }

  // Sort by score descending — highest confidence first
  greedyCandidates.sort((a, b) => b.score - a.score);

  const claimedFresh = new Set<string>();
  const claimedStored = new Set<string>();

  for (const { fresh, stored, score } of greedyCandidates) {
    if (claimedFresh.has(fresh.elementId) || claimedStored.has(stored.id)) {
      // Conflict — this fresh element's best candidate was claimed by another.
      // It becomes unmatched (its match was taken by a higher-scoring pair).
      continue;
    }

    // Compute margin for this match
    const candidates = allCandidates.get(fresh.elementId) ?? [];
    let margin = Infinity;
    if (candidates.length > 1) {
      const sorted = [...candidates].sort((a, b) => b.score - a.score);
      margin = sorted[0].score - sorted[1].score;
    }

    matched.push({
      storedElement: stored,
      freshUiElement: fresh,
      matchScore: score,
      margin,
    });
    claimedFresh.add(fresh.elementId);
    claimedStored.add(stored.id);
  }

  // Any fresh elements not classified and not claimed → unmatched
  for (const fresh of freshElements) {
    if (
      !classifiedFresh.has(fresh.elementId) &&
      !claimedFresh.has(fresh.elementId)
    ) {
      unmatched.push(fresh);
    }
  }

  return { matched, ambiguous, unmatched };
}

// ── Exported helpers (for testing) ───────────────────────────

export {
  extractSignature,
  extractStoredSignature,
  computeSimilarity,
  MATCH_THRESHOLD,
};
