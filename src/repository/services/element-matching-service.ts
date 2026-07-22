/**
 * Element Matching Service — matches fresh UiElements from a new recording
 * against stored Element entities from the Repository.
 *
 * Uses a weighted identity signature comparison that deliberately ignores
 * fragile locators (CSS, XPath) and focuses on stable signals:
 *   - accessibleName (30%) — survives CSS changes
 *   - ariaRole / tag (25%) — structural identity
 *   - ancestorRoleChain (25%) — DOM topology context
 *   - testId / dataCy / dataQa (15%) — business identifiers
 *   - pageOrComponent scope (5%) — same page constraint
 *
 * Threshold: ≥ 0.70 = match, < 0.70 = new element
 *
 * This is NOT the same as the Capability matcher — capabilities match on
 * business purpose; elements match on DOM identity.
 */

import type { UiElement } from '../../domain/entities/ui-element';
import type { Element } from '../../domain/entities/element';
import type { ElementIdentity } from '../../shared/types';
import { LocatorStrategyType } from '../../domain/enums';

// ── Types ────────────────────────────────────────────────────

/** A match between a fresh UiElement and a stored Element. */
export interface ElementMatch {
  /** The stored Element from the Repository. */
  readonly storedElement: Element;
  /** The fresh UiElement from the new recording. */
  readonly freshUiElement: UiElement;
  /** Match score (0.0–1.0). */
  readonly matchScore: number;
}

/** Result of matching a batch of fresh elements against stored elements. */
export interface ElementMatchResult {
  /** Elements that matched existing Repository entries (score ≥ threshold). */
  readonly matches: ElementMatch[];
  /** Fresh elements that didn't match anything (new elements). */
  readonly unmatched: UiElement[];
}

// ── Match Score Weights ──────────────────────────────────────

const WEIGHTS = {
  ACCESSIBLE_NAME: 0.30,
  ROLE_TAG: 0.25,
  ANCESTOR_CHAIN: 0.25,
  BUSINESS_IDS: 0.15,
  PAGE_SCOPE: 0.05,
} as const;

/** Minimum score to consider two elements the same. */
const MATCH_THRESHOLD = 0.70;

// ── Identity Signature Extraction ────────────────────────────

/**
 * Extract the stable identity signals from an ElementIdentity.
 *
 * These are the fields used for matching — deliberately excludes
 * cssSelector and xPath (fragile, change between builds).
 */
interface IdentitySignature {
  accessibleName: string;
  ariaRole: string | null;
  tag: string;
  testId: string | null;
  dataCy: string | null;
  dataQa: string | null;
  /** Ancestor role chain from DomContext (if available). */
  ancestorRoles: string[] | null;
  /** Source URL / page scope. */
  sourceUrl: string;
}

function extractSignature(identity: ElementIdentity, sourceUrl?: string, ancestorRoles?: string[]): IdentitySignature {
  return {
    accessibleName: identity.accessibleName ?? '',
    ariaRole: identity.ariaRole,
    tag: identity.tag ?? '',
    testId: identity.testId,
    dataCy: identity.dataCy,
    dataQa: identity.dataQa,
    ancestorRoles: ancestorRoles ?? null,
    sourceUrl: sourceUrl ?? '',
  };
}

/**
 * Extract signature from a stored Element.
 * Stored elements don't have the full ElementIdentity — they have locatorStrategies.
 * We extract what we can from the element's metadata.
 */
function extractStoredSignature(element: Element): IdentitySignature {
  // The stored Element has logicalName (which was derived from accessibleName)
  // and pageOrComponent (scope). We don't have the full identity, but we can
  // extract testId from the locatorStrategies (TEST_ID type).
  let testId: string | null = null;

  for (const strategy of element.locatorStrategies) {
    // TEST_ID strategies store the raw attribute value
    if (strategy.type === LocatorStrategyType.TEST_ID && !testId) {
      testId = strategy.value;
    }
  }

  return {
    accessibleName: element.logicalName,
    ariaRole: null, // Not stored on Element entity
    tag: '', // Not stored on Element entity
    testId,
    dataCy: null,
    dataQa: null,
    ancestorRoles: null, // Not stored on Element entity
    sourceUrl: element.pageOrComponent,
  };
}

// ── Similarity Scoring ───────────────────────────────────────

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
 * String equality score: 1.0 for exact match, 0.0 otherwise.
 * Case-insensitive for accessibility names.
 */
function stringEqual(a: string, b: string, caseInsensitive = true): number {
  if (!a && !b) return 1.0; // Both empty = match
  if (!a || !b) return 0.0; // One empty = no match
  const cmp = caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
  return cmp ? 1.0 : 0.0;
}

/**
 * String equality with neutral handling for unknown fields.
 * When one side is empty/missing, returns NEUTRAL_SCORE instead of 0.
 * This prevents penalizing stored elements that don't persist every identity field.
 */
function stringEqualNeutral(a: string | null, b: string | null, neutralScore = 0.5): number {
  const aVal = a?.trim() ?? '';
  const bVal = b?.trim() ?? '';
  if (!aVal && !bVal) return 1.0; // Both missing = match
  if (!aVal || !bVal) return neutralScore; // One missing = unknown (not mismatch)
  return aVal.toLowerCase() === bVal.toLowerCase() ? 1.0 : 0.0;
}

/**
 * Compute a weighted similarity score between two identity signatures.
 *
 * Uses neutral scoring for fields missing on one side — this handles the
 * asymmetric case where stored Elements don't persist every identity field
 * (e.g., ariaRole, tag) that fresh UiElements have.
 *
 * Returns 0.0–1.0.
 */
function computeSimilarity(a: IdentitySignature, b: IdentitySignature): number {
  let score = 0;

  // 1. Accessible name (30%) — strongest signal, available on both sides
  score += WEIGHTS.ACCESSIBLE_NAME * stringEqual(a.accessibleName, b.accessibleName);

  // 2. Role + tag (25%) — neutral scoring because stored elements may not have these
  const roleScore = stringEqualNeutral(a.ariaRole, b.ariaRole);
  const tagScore = stringEqualNeutral(a.tag, b.tag);
  score += WEIGHTS.ROLE_TAG * ((roleScore + tagScore) / 2);

  // 3. Ancestor role chain (25%) — Jaccard similarity
  if (a.ancestorRoles && a.ancestorRoles.length > 0 && b.ancestorRoles && b.ancestorRoles.length > 0) {
    score += WEIGHTS.ANCESTOR_CHAIN * jaccardSimilarity(a.ancestorRoles, b.ancestorRoles);
  } else if ((!a.ancestorRoles || a.ancestorRoles.length === 0) && (!b.ancestorRoles || b.ancestorRoles.length === 0)) {
    // Both missing — count as match (ancestors weren't captured on either side)
    score += WEIGHTS.ANCESTOR_CHAIN * 1.0;
  } else {
    // One has, one doesn't — partial penalty
    score += WEIGHTS.ANCESTOR_CHAIN * 0.25;
  }

  // 4. Business identifiers (15%) — if both have IDs, they must match.
  // If one has and the other doesn't, use neutral (the ID may have been
  // added/removed between versions — not strong evidence either way).
  const aBusinessId = a.testId ?? a.dataCy ?? a.dataQa;
  const bBusinessId = b.testId ?? b.dataCy ?? b.dataQa;
  if (aBusinessId && bBusinessId) {
    // Both have business IDs — strong signal
    score += WEIGHTS.BUSINESS_IDS * stringEqual(aBusinessId, bBusinessId);
  } else if (!aBusinessId && !bBusinessId) {
    // Neither has business IDs — neutral
    score += WEIGHTS.BUSINESS_IDS * 0.5;
  } else {
    // One has, one doesn't — neutral (ID may have been added/removed)
    score += WEIGHTS.BUSINESS_IDS * 0.5;
  }

  // 5. Page scope (5%) — same page or component
  score += WEIGHTS.PAGE_SCOPE * stringEqualNeutral(a.sourceUrl, b.sourceUrl);

  return score;
}

// ── Element Matching Service ─────────────────────────────────

/**
 * Match a batch of fresh UiElements against stored Elements.
 *
 * For each fresh element, finds the best matching stored element (if any).
 * Uses greedy matching: highest-scoring pairs are matched first.
 *
 * @param freshElements UiElements from the new recording session.
 * @param storedElements Elements from the Repository (scoped to project).
 * @param threshold Minimum score to consider a match (default: 0.70).
 * @returns Match results: matches[] and unmatched[].
 */
export function matchElements(
  freshElements: readonly UiElement[],
  storedElements: readonly Element[],
  threshold: number = MATCH_THRESHOLD,
): ElementMatchResult {
  // Build all candidate pairs with their scores
  const candidates: Array<{ fresh: UiElement; stored: Element; score: number }> = [];

  for (const fresh of freshElements) {
    const freshSig = extractSignature(
      fresh.identity,
      fresh.sourceUrl,
      // ancestorRoles come from the DomContext on the recorded event,
      // not on the UiElement. For matching purposes, we use sourceUrl as
      // the page scope and skip ancestor chain if not available.
      undefined,
    );

    for (const stored of storedElements) {
      const storedSig = extractStoredSignature(stored);
      const score = computeSimilarity(freshSig, storedSig);
      if (score >= threshold) {
        candidates.push({ fresh, stored, score });
      }
    }
  }

  // Greedy matching: sort by score descending, match highest first
  candidates.sort((a, b) => b.score - a.score);

  const matchedFresh = new Set<string>();
  const matchedStored = new Set<string>();
  const matches: ElementMatch[] = [];

  for (const { fresh, stored, score } of candidates) {
    // Skip if either side is already matched (1:1 matching)
    if (matchedFresh.has(fresh.elementId) || matchedStored.has(stored.id)) {
      continue;
    }

    matches.push({
      storedElement: stored,
      freshUiElement: fresh,
      matchScore: score,
    });
    matchedFresh.add(fresh.elementId);
    matchedStored.add(stored.id);
  }

  // Collect unmatched fresh elements
  const unmatched = freshElements.filter((e) => !matchedFresh.has(e.elementId));

  return { matches, unmatched };
}

// ── Exported helpers (for testing) ───────────────────────────

export { extractSignature, extractStoredSignature, computeSimilarity, MATCH_THRESHOLD };
