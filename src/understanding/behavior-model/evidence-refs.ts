/**
 * Application Behavior Model — Evidence References (CP1)
 *
 * Pure utilities over EvidenceRef:
 *   - evidenceRefKey(): the deterministic canonical key that implements the
 *     model's REF UNIQUENESS LAW (one ref → at most one owning edge, per
 *     model). Two refs with the same canonical key are the SAME artifact.
 *   - factories: validated, degradation-aware construction of each ref kind.
 *   - degradation helpers: canonical ordering, union, containment.
 *   - createRefRegistry(): the mechanical enforcement of ref uniqueness
 *     during edge construction (consumed by causal-graph, CP3).
 *
 * This module MUST NOT:
 *   - read stores, sessions, or DOM state (pure functions only);
 *   - decide causality or ownership (it only keys and claims refs);
 *   - import capture/attribution/ledger modules.
 */

import type { EvidenceRef, RefDegradation } from './model-types';

// ═════════════════════════════════════════════════════════════════════════
// Canonical key
// ═════════════════════════════════════════════════════════════════════════

/**
 * Deterministic canonical key for one captured artifact.
 *
 * Injective per artifact:
 *   request     → `request:<requestId>`
 *   event       → `event:<eventId>`
 *   transition  → `transition:<transitionId>`
 *   entity      → `entity:<entityId>@<interactionId>`   (an entity id may be
 *                 recorded by several interactions; the artifact is the pair)
 *   dom         → `dom:<windowId>#<sequence>`
 *   nav         → `nav:<navEventId>`
 *
 * Degradation flags are NOT part of the key: the same artifact with
 * different degradation annotations is still ONE artifact with ONE owner.
 */
export function evidenceRefKey(ref: EvidenceRef): string {
  switch (ref.kind) {
    case 'request':
      return `request:${ref.requestId}`;
    case 'event':
      return `event:${ref.eventId}`;
    case 'transition':
      return `transition:${ref.transitionId}`;
    case 'entity':
      return `entity:${ref.entityId}@${ref.interactionId}`;
    case 'dom':
      return `dom:${ref.windowId}#${ref.sequence}`;
    case 'nav':
      return `nav:${ref.navEventId}`;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Degradations
// ═════════════════════════════════════════════════════════════════════════

/** Canonical ordering of degradation flags — the single sort order used
 *  anywhere degradations are compared, serialized, or deduplicated. */
export const DEGRADATION_ORDER: readonly RefDegradation[] = [
  'body-less-row',
  'synthesized-evidence',
  'capped-window',
  'missing-window',
  'malformed-trigger',
  'tail-capped',
];

const DEGRADATION_RANK: ReadonlyMap<RefDegradation, number> = new Map(
  DEGRADATION_ORDER.map((flag, index) => [flag, index]),
) as ReadonlyMap<RefDegradation, number>;

/** Sort + dedupe a degradation list into canonical order. Returns []. */
export function canonicalDegradations(
  flags: readonly RefDegradation[] | undefined | null,
): RefDegradation[] {
  if (!flags || flags.length === 0) return [];
  const seen = new Set<RefDegradation>();
  for (const flag of flags) {
    if (DEGRADATION_RANK.has(flag)) seen.add(flag);
  }
  return [...seen].sort(
    (a, b) => (DEGRADATION_RANK.get(a) ?? 0) - (DEGRADATION_RANK.get(b) ?? 0),
  );
}

/** Union of any number of degradation lists, canonical order. */
export function mergeDegradations(
  ...lists: Array<readonly RefDegradation[] | undefined | null>
): RefDegradation[] {
  const collected: RefDegradation[] = [];
  for (const list of lists) {
    if (list) collected.push(...list);
  }
  return canonicalDegradations(collected);
}

/** True when `flag` is present (list treated as canonical or raw). */
export function hasDegradation(
  flags: readonly RefDegradation[] | undefined | null,
  flag: RefDegradation,
): boolean {
  if (!flags) return false;
  return flags.includes(flag);
}

// ═════════════════════════════════════════════════════════════════════════
// Ref factories (validated construction)
// ═════════════════════════════════════════════════════════════════════════

function normalized(
  flags: readonly RefDegradation[] | undefined,
): RefDegradation[] | undefined {
  const canonical = canonicalDegradations(flags);
  return canonical.length > 0 ? canonical : undefined;
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `EvidenceRef factory: ${field} must be a non-empty string (got ${JSON.stringify(value)})`,
    );
  }
}

type RequestRef = Extract<EvidenceRef, { kind: 'request' }>;
type EventRef = Extract<EvidenceRef, { kind: 'event' }>;
type TransitionRef = Extract<EvidenceRef, { kind: 'transition' }>;
type EntityRef = Extract<EvidenceRef, { kind: 'entity' }>;
type DomRef = Extract<EvidenceRef, { kind: 'dom' }>;
type NavRef = Extract<EvidenceRef, { kind: 'nav' }>;

export const ref = {
  request(requestId: string, degradation?: readonly RefDegradation[]): RequestRef {
    assertNonEmpty(requestId, 'requestId');
    return { kind: 'request', requestId, degradation: normalized(degradation) };
  },
  event(eventId: string, degradation?: readonly RefDegradation[]): EventRef {
    assertNonEmpty(eventId, 'eventId');
    return { kind: 'event', eventId, degradation: normalized(degradation) };
  },
  transition(transitionId: string, degradation?: readonly RefDegradation[]): TransitionRef {
    assertNonEmpty(transitionId, 'transitionId');
    return { kind: 'transition', transitionId, degradation: normalized(degradation) };
  },
  entity(
    entityId: string,
    interactionId: string,
    degradation?: readonly RefDegradation[],
  ): EntityRef {
    assertNonEmpty(entityId, 'entityId');
    assertNonEmpty(interactionId, 'interactionId');
    return {
      kind: 'entity',
      entityId,
      interactionId,
      degradation: normalized(degradation),
    };
  },
  dom(windowId: string, sequence: number, degradation?: readonly RefDegradation[]): DomRef {
    assertNonEmpty(windowId, 'windowId');
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new Error(
        `EvidenceRef factory: dom sequence must be a non-negative integer (got ${JSON.stringify(sequence)})`,
      );
    }
    return { kind: 'dom', windowId, sequence, degradation: normalized(degradation) };
  },
  nav(navEventId: string, degradation?: readonly RefDegradation[]): NavRef {
    assertNonEmpty(navEventId, 'navEventId');
    return { kind: 'nav', navEventId, degradation: normalized(degradation) };
  },
} as const;

// ═════════════════════════════════════════════════════════════════════════
// Ref summary (stable human-readable form for detail strings / warnings)
// ═════════════════════════════════════════════════════════════════════════

/** Stable, deterministic one-line summary. Equals the canonical key plus
 *  degradation flags when present — safe for test assertions and diffs. */
export function refSummary(ref: EvidenceRef): string {
  const base = evidenceRefKey(ref);
  const flags = canonicalDegradations(ref.degradation);
  return flags.length > 0 ? `${base} [${flags.join(',')}]` : base;
}

// ═════════════════════════════════════════════════════════════════════════
// Ref registry — mechanical enforcement of the uniqueness law
// ═════════════════════════════════════════════════════════════════════════

/**
 * createRefRegistry — one registry per model build. Construction order of
 * edges (deterministic: T1 → T2 → T3 → T4, in CER-5 episode order) decides
 * which edge wins a contested ref; later claims on an owned ref FAIL.
 *
 * tryClaim returns true exactly once per canonical key.
 */
export interface RefRegistry {
  /** Try to claim `ref` for `ownerEdgeId`. False if already claimed. */
  tryClaim(ref: EvidenceRef, ownerEdgeId: string): boolean;
  /** Current owner of a ref's canonical key, or null when unclaimed. */
  ownerOf(ref: EvidenceRef): string | null;
  /** All claimed canonical keys, lexicographically sorted (deterministic). */
  claimedKeys(): string[];
  /** Number of distinct claimed artifacts. */
  readonly size: number;
}

export function createRefRegistry(): RefRegistry {
  const claims = new Map<string, string>();
  return {
    tryClaim(refToClaim, ownerEdgeId): boolean {
      assertNonEmpty(ownerEdgeId, 'ownerEdgeId');
      const key = evidenceRefKey(refToClaim);
      if (claims.has(key)) return false;
      claims.set(key, ownerEdgeId);
      return true;
    },
    ownerOf(refToQuery): string | null {
      return claims.get(evidenceRefKey(refToQuery)) ?? null;
    },
    claimedKeys(): string[] {
      return [...claims.keys()].sort();
    },
    get size(): number {
      return claims.size;
    },
  };
}
