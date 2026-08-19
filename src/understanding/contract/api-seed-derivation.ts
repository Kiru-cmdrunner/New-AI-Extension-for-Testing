/**
 * Phase 5a — API Test Seed Derivation
 *
 * Pure, deterministic, read-side derivation of API test seeds from
 * persisted behavioral evidence + Application Knowledge rows. The
 * interaction IS the join key: Phase 1 attached `resultingState` to the
 * same BehavioralEvidence row that carries `networkActivity`, so pairing
 * needs no timing heuristics.
 *
 * Attribution ladder (INV-5a-3 — only stamped rows may claim causality):
 *   'event-stamped'   — webRequest row with requestId + sourceEventId that
 *                       matches the carrying interaction's trigger/member
 *                       events (DurableAttributionLedger CER stamp).
 *   'window-inferred' — row rode the same evidence window but lacks the
 *                       stamp (main-world / performance-observer sourced).
 *
 * Structural inputs are declared locally (no repository imports): the
 * derivation is usable from tests, the contract layer, and any future
 * exporter without coupling to Dexie.
 *
 * Architecture: .drytis/specs/resulting-application-state-plan.md Phase 5a
 * Invariants: INV-5a-1 (no response bodies), INV-5a-2 (no DB access),
 * INV-5a-3 (causal conditions only from stamped rows), INV-5a-4 (bounded,
 * deterministic), INV-5a-5 (absence explicit), INV-5a-6 (Click/Nav
 * separation — one evidence row = one seed set), INV-5a-7 (bodyKeys only,
 * values never emitted, sensitive keys denied).
 */

import type {
  ApiPostCondition,
  ApiTestSeed,
} from './contract-types';
import { MAX_POST_CONDITIONS_PER_SEED } from './contract-types';

/** ≤ seeds per session. */
export const MAX_SEEDS_PER_SESSION = 20;

/**
 * Sensitive formData-key denylist (best-effort, INV-5a-7). Values behind
 * these keys are commonly credentials or tokens; the KEYS themselves are
 * still informative for API shape, but flagging them as sensitive in a
 * seed advertises where secrets live — so they are omitted entirely.
 * Matched case-insensitively with separators stripped, via substring pass
 * (compound keys like 'billingCardNumber' also match). Deliberately does
 * NOT include the bare fragment 'auth': it false-positives on 'author' /
 * 'authorName' (common form keys) — 'authorization' covers the real cases.
 */
const SENSITIVE_BODY_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'credential',
  'session',
  'cookie',
  'csrf',
  'xsrf',
  'ssn',
  'socialsecurity',
  'cardnumber',
  'creditcard',
  'cvc',
  'cvv',
  'csc',
  'pin',
  'otp',
  'totp',
  'privatekey',
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** INV-5a-7 — key-level filter: is this formData key sensitive? */
export function isSensitiveBodyKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  for (const fragment of SENSITIVE_BODY_KEY_FRAGMENTS) {
    const f = normalizeKey(fragment);
    if (f && normalized.includes(f)) return true;
  }
  return false;
}

// ── Structural inputs (declared locally — no repository coupling) ──────

/** A network row as persisted on ApplicationEvidence. */
export interface SeedNetworkRow {
  url: string;
  method: string;
  status: number | null;
  resourceType: 'xhr' | 'fetch' | 'unknown' | 'navigation' | 'resource';
  source: 'main-world' | 'webrequest' | 'performance-observer';
  requestBody?: Record<string, string>;
  sourceEventId?: string;
  requestId?: string;
}

/** Structural shape of a persisted BehavioralEvidenceRow (subset). */
export interface SeedEvidenceRow {
  windowId: string;
  interactionId: string;
  recordingSessionId: string;
  sourceEventId: string;
  /** Trigger + member event ids of the carrying interaction, for stamp matching. */
  interactionEventIds: readonly string[];
  networkActivity: readonly SeedNetworkRow[];
  resultingState?: {
    items: ReadonlyArray<{
      kind: 'counter' | 'notification' | 'collection' | 'entity' | 'status-badge' | 'entity-title';
      matchedSelector: string;
      text: string;
      numericValue: number | null;
      entityId: string | null;
      domPath: string;
    }>;
  };
  appId?: string;
}

/** Knowledge-side join input for one evidence row's interaction. */
export interface SeedKnowledgeContext {
  /** signatureKey of the interaction's episode anchor, if recorded. */
  signatureKey: string | null;
  actionType: string | null;
  normalizedTarget: string | null;
  /** Confidence of the `api|METHOD /path` consequence for this endpoint. */
  apiConsequenceConfidence: number | null;
}

export interface DeriveSessionSeedsInput {
  appId: string;
  sessionId: string;
  evidenceRows: readonly SeedEvidenceRow[];
  /** Per-interaction knowledge context (keyed by interactionId). */
  knowledgeByInteraction: ReadonlyMap<string, SeedKnowledgeContext>;
  /** Per-endpoint confidence from aggregated api edges: `METHOD /path` → confidence. */
  apiConfidence: ReadonlyMap<string, number>;
}

/**
 * Repository-agnostic read accessor for the cmdrunner `behavioralEvidence`
 * table. Declared here so the contract queries stay pure functions of
 * (repo, evidence-access) with zero Dexie coupling. The production
 * implementation is a thin adapter over DexieBehavioralEvidenceRepository
 * plus the session's interaction-event linkage.
 */
export interface SeedEvidenceAccess {
  /** All persisted evidence rows of one recording session. */
  getBySession(sessionId: string): Promise<readonly SeedEvidenceRow[]>;
  /**
   * Trigger + member event ids per interactionId for one session — the
   * exact-event join set used to verify webRequest stamps (CER).
   */
  getInteractionEventIds(appId: string, sessionId: string): Promise<Map<string, string[]>>;
}

// ── Path generalization (frozen grammar — never a new grammar) ─────────

/**
 * Generalize a request URL to a query-free pathname, matching the frozen
 * `METHOD /path` identity grammar produced by behavior-knowledge-mapper's
 * apiIdentity(). Unparseable URLs degrade to the raw string — same policy
 * as the mapper's non-URL fallback.
 */
export function generalizeRequestPath(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
}

// ── Post-condition derivation (Phase 1 snapshot items) ─────────────────

/**
 * Map resultingState items → bounded post-conditions. Entity-title items
 * are skipped (they are the label of an entity item, not an assertion of
 * their own — same exclusion as the 4c derivation).
 */
export function derivePostConditions(
  row: SeedEvidenceRow,
  causal: boolean,
): ApiPostCondition[] {
  const items = row.resultingState?.items ?? [];
  const byKind = new Map<
    ApiPostCondition['kind'],
    ApiPostCondition[]
  >();

  for (const item of items) {
    let condition: ApiPostCondition | null = null;
    switch (item.kind) {
      case 'counter':
        // Equals only with a finite observed value.
        if (item.numericValue != null && Number.isFinite(item.numericValue)) {
          condition = {
            kind: 'counter',
            identity: item.domPath,
            value: item.numericValue,
            operator: 'equals',
          };
        }
        break;
      case 'collection':
        if (item.numericValue != null && Number.isFinite(item.numericValue)) {
          condition = {
            kind: 'collection',
            identity: item.domPath,
            count: item.numericValue,
          };
        }
        break;
      case 'entity':
        if (item.entityId) {
          // Presence only — INV: never attribute values (ceiling C1).
          condition = { kind: 'entity-present', identity: item.entityId };
        }
        break;
      case 'status-badge': {
        // Distinctive non-numeric text only (same policy as 4c badges).
        const text = item.text.trim();
        if (text && !/^\d+$/.test(text)) {
          condition = { kind: 'ui-badge', identity: item.domPath, text };
        }
        break;
      }
      case 'notification':
        condition = { kind: 'ui-notification', identity: item.domPath };
        break;
      case 'entity-title':
      default:
        condition = null;
    }
    if (!condition) continue;
    const list = byKind.get(condition.kind) ?? [];
    list.push(condition);
    byKind.set(condition.kind, list);
  }

  // Priority order mirrors the approved 4c ranking:
  // counter → collection → status-badge → notification → entity.
  const priority: ApiPostCondition['kind'][] = [
    'counter',
    'collection',
    'ui-badge',
    'ui-notification',
    'entity-present',
  ];
  const out: ApiPostCondition[] = [];
  for (const kind of priority) {
    for (const condition of byKind.get(kind) ?? []) {
      if (out.length >= MAX_POST_CONDITIONS_PER_SEED) return out;
      out.push(condition);
    }
  }
  if (!causal) {
    // Non-causal rows never emit conditions — observed-alongside only.
    // The ladder guarantees expectedPostConditions: [] for
    // window-inferred seeds; this is a hard re-guard (defense in depth).
    return [];
  }
  return out;
}

// ── Seed derivation ────────────────────────────────────────────────────

export interface DeriveSessionSeedsResult {
  seeds: ApiTestSeed[];
  /** Rows present but excluded, with why (INV-5a-5 — absence is data). */
  excluded: Array<{ interactionId: string; requestId: string | null; reason: ExcludeSeedReason }>;
  /** Recurring endpoints: `METHOD /path` seen more than once in-session. */
  recurringIdentities: Set<string>;
}

export type ExcludeSeedReason =
  | 'navigation-resource' // resourceType 'navigation' — INV-CS1 separation
  | 'no-request-id' // unstamped AND non-webRequest — no identity key
  | 'seed-cap' // MAX_SEEDS_PER_SESSION reached
  | 'duplicate-request-id'; // requestId already seeded this session

/** Deterministic seed comparator: interactionId → path → method. */
function compareSeeds(a: ApiTestSeed, b: ApiTestSeed): number {
  return (
    (a.interactionId < b.interactionId ? -1 : a.interactionId > b.interactionId ? 1 : 0) ||
    (a.request.path < b.request.path ? -1 : a.request.path > b.request.path ? 1 : 0) ||
    (a.request.method < b.request.method ? -1 : a.request.method > b.request.method ? 1 : 0)
  );
}

/**
 * Derive seeds for ONE session's evidence rows. Deterministic: same inputs
 * → same seeds, same order. Bounds: ≤ MAX_SEEDS_PER_SESSION seeds, ≤
 * MAX_POST_CONDITIONS_PER_SEED conditions each, bodyKeys filtered by the
 * denylist (INV-5a-7).
 */
export function deriveSessionSeeds(
  input: DeriveSessionSeedsInput,
): DeriveSessionSeedsResult {
  const seeds: ApiTestSeed[] = [];
  const excluded: DeriveSessionSeedsResult['excluded'] = [];
  const seenRequestIds = new Set<string>();
  const identityCounts = new Map<string, number>();

  // Pass 1 — count endpoint identities for the recurring flag.
  for (const row of input.evidenceRows) {
    for (const net of row.networkActivity) {
      if (net.resourceType === 'navigation') continue;
      const identity = `${net.method} ${generalizeRequestPath(net.url)}`;
      identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    }
  }
  const recurringIdentities = new Set<string>();
  for (const [identity, count] of identityCounts) {
    if (count > 1) recurringIdentities.add(identity);
  }

  // Pass 2 — one seed per stamped/candidate request, bounded.
  for (const row of input.evidenceRows) {
    // Attribution census for this row: how many stamped requests?
    const stampedRequestIds: string[] = [];
    for (const net of row.networkActivity) {
      if (
        net.source === 'webrequest' &&
        net.requestId &&
        net.sourceEventId &&
        row.interactionEventIds.includes(net.sourceEventId)
      ) {
        stampedRequestIds.push(net.requestId);
      }
    }
    const shared = stampedRequestIds.length > 1;

    for (const net of row.networkActivity) {
      if (net.resourceType === 'navigation') {
        excluded.push({
          interactionId: row.interactionId,
          requestId: net.requestId ?? null,
          reason: 'navigation-resource',
        });
        continue; // INV-CS1 — navigation rows are never API seeds
      }

      const stamped =
        net.source === 'webrequest' &&
        net.requestId != null &&
        net.sourceEventId != null &&
        row.interactionEventIds.includes(net.sourceEventId);

      if (!net.requestId) {
        // Unstamped main-world / performance-observer row without any
        // identity key — cannot be a deterministic seed.
        excluded.push({
          interactionId: row.interactionId,
          requestId: null,
          reason: 'no-request-id',
        });
        continue;
      }
      if (seenRequestIds.has(net.requestId)) {
        excluded.push({
          interactionId: row.interactionId,
          requestId: net.requestId,
          reason: 'duplicate-request-id',
        });
        continue;
      }
      if (seeds.length >= MAX_SEEDS_PER_SESSION) {
        excluded.push({
          interactionId: row.interactionId,
          requestId: net.requestId,
          reason: 'seed-cap',
        });
        continue;
      }

      const path = generalizeRequestPath(net.url);
      const identity = `${net.method} ${path}`;
      const knowledge = input.knowledgeByInteraction.get(row.interactionId) ?? null;
      const confidence =
        knowledge?.apiConsequenceConfidence ??
        input.apiConfidence.get(identity) ??
        0;

      const seed: ApiTestSeed = {
        seedId: `${input.sessionId}:${row.interactionId}:${net.requestId}`,
        appId: input.appId,
        sessionId: input.sessionId,
        interactionId: row.interactionId,
        sourceEventId: net.sourceEventId ?? row.sourceEventId ?? null,
        request: {
          method: net.method,
          path,
          status: net.status,
          resourceType: net.resourceType,
          bodyKeys: deriveBodyKeys(net),
        },
        attribution: stamped ? 'event-stamped' : 'window-inferred',
        shared,
        recurring: recurringIdentities.has(identity),
        action: knowledge?.signatureKey
          ? {
              signatureKey: knowledge.signatureKey,
              actionType: knowledge.actionType ?? 'Click',
              normalizedTarget: knowledge.normalizedTarget ?? knowledge.signatureKey,
            }
          : null,
        expectedPostConditions: derivePostConditions(row, stamped),
        honesty: {
          payloadSchema: 'unrecorded',
          responseBody: 'unverified',
          uiBasis: (row.resultingState?.items.length ?? 0) > 0 ? 'content-observed' : 'none',
        },
        confidence,
        evidenceRef: {
          sessionId: input.sessionId,
          edgeKey: `${row.interactionId}:${net.requestId}`,
          resolvable: true, // caller resolves eviction at query time
        },
      };
      seeds.push(seed);
      seenRequestIds.add(net.requestId);
    }
  }

  seeds.sort(compareSeeds);
  return { seeds, excluded, recurringIdentities };
}

/**
 * INV-5a-7 — KEYS ONLY, values never read. Sensitive keys are dropped by
 * the denylist. Sorted for determinism.
 */
function deriveBodyKeys(net: SeedNetworkRow): string[] {
  if (!net.requestBody) return [];
  return Object.keys(net.requestBody)
    .filter((key) => !isSensitiveBodyKey(key))
    .sort();
}
