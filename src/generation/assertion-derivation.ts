/**
 * Track 3 — Resulting-State → Step-Scoped Assertion Derivation
 *
 * Pure adapter that transforms resulting-state evidence
 * (BehavioralEvidence.applicationEvidence.resultingState, wire types from
 * src/shared) into StepScopedAssertion[] keyed by the CAUSING step's
 * sourceEventId.
 *
 * Architecture (Phase 4c-i, Option A — approved):
 *   - Assertions ON by default for the four kinds: counter, status-badge,
 *     notification, entity. (collection COUNT is deferred to 4c-iii — the
 *     in-extension evaluator counts element-or-0, so a COUNT assertion
 *     would silently evaluate wrong until S3 lands.)
 *   - ALL derived assertions are SOFT ('expect.soft') — they record
 *     without failing the replay. Promotion to hard is a later,
 *     execution-feedback-gated decision.
 *   - Locator policy (LOCATOR_CONFIDENCE):
 *       high  → domPath #id segment, or a unique identifying attribute
 *               from the item's entity identity ([data-asin="X"]).
 *       none  → anything else. An assertion without a re-findable locator
 *               is SKIPPED (never emitted with a fragile locator) —
 *               INV-GEN-4: generic selectors only, never synthesized
 *               nth-child chains.
 *   - Never asserts on volatile text: notification/order text carries
 *     order numbers and names; only PRESENCE is asserted there.
 *
 * Invariants honored:
 *   INV-GEN-7  no resultingState → no stepAssertions (empty map)
 *   INV-GEN-8  no Understanding-Layer imports (shared wire types only)
 *   INV-GEN-9  invoked by the service worker (sole adapter site)
 *   INV-GEN-10 no UnderstandingResult/CapabilityCandidate types here
 *   INV-CS1    evidence is read per-interaction as captured; Click and
 *              Navigation resulting states are never merged (each
 *              interaction's own resultingState feeds its own assertions)
 *
 * Determinism (INV-GEN-1): pure function of its inputs — no clock, no
 * random, no storage.
 */

import type { ComponentInteraction } from '../shared/component-types';
import type {
  WireObservedItem,
  WirePageContentSnapshot,
} from '../shared/page-content-wire';
import type { GenerationEnrichment, StepScopedAssertion } from './generation-types';

// ── Bounds ───────────────────────────────────────────────────────────────

/** Max assertions derived from ONE interaction's resulting state. */
const MAX_ASSERTIONS_PER_STEP = 3;

/** Max text length embedded into an assertion (defensive; capture caps at 200). */
const MAX_ASSERT_TEXT_LENGTH = 60;

/**
 * Kinds eligible for derivation in 4c-i. `collection` (needs COUNT — S3)
 * and `entity-title` (provenance carrier, never user-visible text) are
 * deliberately excluded.
 */
const DERIVABLE_KINDS = new Set<WireObservedItem['kind']>([
  'counter',
  'status-badge',
  'notification',
  'entity',
]);

// ── Locator Policy ───────────────────────────────────────────────────────

/** Result of evaluating whether an observed item is re-findable. */
interface LocatorDecision {
  /** CSS locator for replay, or null when the item must be SKIPPED. */
  css: string | null;
  /** Confidence tier, for documentation and tests. */
  tier: 'id' | 'identity-attribute' | 'none';
}

/**
 * Parse the #id segment from a domPath produced by getElementPath
 * (e.g. 'UL#cart > LI' → 'cart'). Only a TOP-anchored segment is used —
 * getElementPath omits :nth-child indexes, so an #id anywhere in the path
 * is the only stable coordinate it carries.
 */
function idFromDomPath(domPath: string): string | null {
  // Take the LAST #id-bearing segment (closest to the element). Segments
  // look like 'div#cart-count' or plain 'div'.
  const segments = domPath.split('>').map((s) => s.trim());
  for (let i = segments.length - 1; i >= 0; i--) {
    const m = segments[i].match(/^([a-zA-Z][\w-]*)#([\w-]+)$/);
    if (m) return m[2];
  }
  return null;
}

/**
 * CSS.escape-free attribute-value escaper. Selector values recorded from
 * data-* attributes are attacker-influencable in principle; quoting with
 * backslash-escaping of quotes and backslashes is sufficient for the
 * locator layer (Playwright renders the selector verbatim into
 * locator('…'), executor content scripts pass it to querySelector).
 */
function attrValueForSelector(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Unique-identifying attribute for entity items: the entityId came from
 * the selector's idAttribute (data-asin, data-product-id, data-order-id,
 * …). The attribute NAME is recovered from the item's captured
 * attributes — the same source the observer read the value from.
 */
function identityAttributeSelector(item: WireObservedItem): string | null {
  if (item.kind !== 'entity' || !item.entityId) return null;
  const attrs = item.attributes ?? {};
  for (const [name, value] of Object.entries(attrs)) {
    if (value === item.entityId && /^data-[\w-]+$/i.test(name)) {
      return `[${name.toLowerCase()}="${attrValueForSelector(value)}"]`;
    }
  }
  return null;
}

/**
 * Decide the replay locator for one observed item.
 *
 * Priority: #id from domPath → identity attribute for entities → skip.
 * matchedSelector and class fragments are intentionally NOT used — they
 * are typically multi-match (collections of siblings share them), which
 * Playwright strict mode would reject and which LOCATOR_CONFIDENCE
 * classifies as unverifiable at generation time.
 */
function decideLocator(item: WireObservedItem): LocatorDecision {
  const id = idFromDomPath(item.domPath);
  if (id) return { css: `#${id}`, tier: 'id' };

  const identityAttr = identityAttributeSelector(item);
  if (identityAttr) {
    return { css: identityAttr, tier: 'identity-attribute' };
  }

  return { css: null, tier: 'none' };
}

// ── Per-Kind Derivation ──────────────────────────────────────────────────

/** Distinctive non-numeric text for status-badge contains-assertions. */
function badgeText(item: WireObservedItem): string | null {
  const text = (item.text ?? '').trim();
  if (text.length < 2) return null;
  // Skip purely numeric badges ("3") — they are counters in disguise and
  // their format is volatile ("3", "3 items", "(3)").
  if (/^[\d\s.,()+-]+$/.test(text)) return null;
  const distinctive = text.replace(/\s+/g, ' ').slice(0, MAX_ASSERT_TEXT_LENGTH);
  return distinctive.length >= 2 ? distinctive : null;
}

/**
 * Word-boundary token match, expressed WITHOUT a regex metacharacter
 * grammar: true when the counter value appears as a standalone number
 * token in the text. Retained for the 4c-iii hard-assertion upgrade path
 * (exact format then matters); 4c-i asserts the captured text verbatim.
 */
function isCounterToken(text: string, numericValue: number): boolean {
  const tokens = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return tokens.some((t) => Number(t.replace(',', '.')) === numericValue);
}
void isCounterToken;

/**
 * Counter semantics WITHOUT a regex: a standalone number token. The
 * derivation asserts the counter's captured text form verbatim (contains)
 * — the exact string the app rendered for N is the honest expectation.
 * numericValue gating still applies (unparseable counters are skipped).
 */
function counterTokenAssertionValue(item: WireObservedItem): string | null {
  const text = (item.text ?? '').trim();
  if (!text) return null;
  return text.replace(/\s+/g, ' ').slice(0, MAX_ASSERT_TEXT_LENGTH);
}

/**
 * Derive StepScopedAssertions from one interaction's resulting state.
 * Returns at most MAX_ASSERTIONS_PER_STEP, ordered
 * counter → status-badge → notification → entity (the approved priority).
 */
function deriveForSnapshot(snapshot: WirePageContentSnapshot): StepScopedAssertion[] {
  const out: StepScopedAssertion[] = [];
  // Priority bucketing, then stable order within each bucket (capture order).
  const byPriority: Record<string, WireObservedItem[]> = {
    counter: [],
    'status-badge': [],
    notification: [],
    entity: [],
  };

  for (const item of snapshot.items ?? []) {
    if (!DERIVABLE_KINDS.has(item.kind)) continue;
    if (!item.visible) continue; // hidden at capture → not a stable expectation
    byPriority[item.kind].push(item);
  }

  const emit = (assertion: StepScopedAssertion): void => {
    if (out.length >= MAX_ASSERTIONS_PER_STEP) return;
    out.push(assertion);
  };

  // 1. Counters — TEXT_MATCH contains on the captured counter text (the
  //    exact string the app rendered for N, e.g. "4 items"). The captured
  //    text IS the honest expectation; rendering it via contains avoids
  //    the pre-existing MATCHES double-escape mismatch between the
  //    Playwright renderer (escapeRegex → literal) and the in-extension
  //    evaluators (treat expectedValue as a REAL regex). numericValue is
  //    still required — a counter we could not parse at capture is too
  //    unstable to assert.
  for (const item of byPriority.counter) {
    if (item.numericValue === null || !Number.isFinite(item.numericValue)) continue;
    const text = counterTokenAssertionValue(item);
    if (!text) continue;
    const locator = decideLocator(item);
    if (!locator.css) continue;
    emit({
      type: 'textMatch',
      comparison: 'contains',
      severity: 'soft',
      expectedValue: text,
      property: null,
      targetCss: locator.css,
      targetName: item.attributes?.['aria-label']?.slice(0, 60) || 'counter',
      derivedFrom: 'counter',
    });
  }

  // 2. Status badges — TEXT_MATCH contains on distinctive non-numeric text.
  for (const item of byPriority['status-badge']) {
    const text = badgeText(item);
    if (!text) continue;
    const locator = decideLocator(item);
    if (!locator.css) continue;
    emit({
      type: 'textMatch',
      comparison: 'contains',
      severity: 'soft',
      expectedValue: text,
      property: null,
      targetCss: locator.css,
      targetName: text.slice(0, 30),
      derivedFrom: 'status-badge',
    });
  }

  // 3. Notifications — PRESENCE only. Text is volatile (order numbers,
  //    names); presence of the alert/toast region is the stable fact.
  for (const item of byPriority.notification) {
    const locator = decideLocator(item);
    if (!locator.css) continue;
    emit({
      type: 'presence',
      comparison: 'isTrue',
      severity: 'soft',
      expectedValue: null,
      property: null,
      targetCss: locator.css,
      targetName: item.attributes?.['aria-label']?.slice(0, 60) || 'notification',
      derivedFrom: 'notification',
    });
  }

  // 4. Entities — PRESENCE of the identified entity (data-asin="B0VAL1").
  for (const item of byPriority.entity) {
    const locator = decideLocator(item);
    // Entities without an identity-attribute locator are skipped: the #id
    // fallback is acceptable too (decideLocator already tried it).
    if (!locator.css || locator.tier === 'none') continue;
    emit({
      type: 'presence',
      comparison: 'isTrue',
      severity: 'soft',
      expectedValue: null,
      property: null,
      targetCss: locator.css,
      targetName: item.entityType
        ? `${item.entityType}:${item.entityId ?? ''}`.slice(0, 60)
        : 'entity',
      derivedFrom: 'entity',
    });
  }

  return out;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Build the Track-3 stepAssertions enrichment from recorded interactions.
 *
 * Reads each interaction's OWN behavioralEvidence.applicationEvidence.
 * .resultingState (INV-CS1: per-window evidence, never merged across
 * Click/Navigation). Keyed by the interaction's triggerEvent.eventId —
 * the same value the compiler stamps onto step.sourceEventId — so the
 * join is exact and independent of element-id maps (D3 rebuilds included).
 *
 * Deterministic and total: interactions without resultingState simply
 * contribute nothing (INV-GEN-7).
 */
export function deriveStepAssertions(
  interactions: readonly ComponentInteraction[],
): ReadonlyMap<string, StepScopedAssertion[]> {
  const map = new Map<string, StepScopedAssertion[]>();
  for (const interaction of interactions) {
    const snapshot =
      interaction.behavioralEvidence?.applicationEvidence?.resultingState;
    if (!snapshot || !snapshot.items || snapshot.items.length === 0) continue;

    const assertions = deriveForSnapshot(snapshot);
    if (assertions.length === 0) continue;

    const eventId = interaction.triggerEvent?.eventId;
    if (!eventId) continue;

    map.set(eventId, assertions);
  }
  return map;
}

/**
 * Convenience: build the full enrichment object the service worker passes
 * to build(). Preserves any concurrently-supplied enrichment fields.
 */
export function buildResultingStateEnrichment(
  interactions: readonly ComponentInteraction[],
  existing?: GenerationEnrichment,
): GenerationEnrichment {
  const stepAssertions = deriveStepAssertions(interactions);
  if (stepAssertions.size === 0) {
    return existing ?? {};
  }
  return {
    ...existing,
    stepAssertions,
  };
}
