/**
 * Track 3 — Resulting-State → Step-Scoped Assertion Derivation
 *
 * Pure adapter that transforms resulting-state evidence
 * (BehavioralEvidence.applicationEvidence.resultingState, wire types from
 * src/shared) into StepScopedAssertion[] keyed by the CAUSING step's
 * sourceEventId.
 *
 * Architecture (Phase 4c-i, Option A — approved; extended 4c-iii-b):
 *   - Assertions ON by default for five kinds: counter, collection,
 *     status-badge, notification, entity. Collection asserts COUNT equals
 *     the observed child count (4c-iii-b) — enabled by the 4c-iii-a count
 *     fidelity fix in both evaluator twins. entity-title stays excluded
 *     (provenance carrier, never user-visible text).
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
import { isVerifiedAttrAllowed } from '../shared/page-content-wire';
import { deriveSurfaceFactOwnership, type OwnedSurfaceFact } from '../shared/surface-fact-ownership';
import type { GenerationEnrichment, StepScopedAssertion } from './generation-types';

// ── Bounds ───────────────────────────────────────────────────────────────

/** Max assertions derived from ONE interaction's resulting state. */
const MAX_ASSERTIONS_PER_STEP = 3;

/** Max text length embedded into an assertion (defensive; capture caps at 200). */
const MAX_ASSERT_TEXT_LENGTH = 60;

/**
 * Kinds eligible for derivation. 4c-iii-b adds `collection` (COUNT equals
 * the observed child count — the S3 count-fidelity fix landed in 4c-iii-a,
 * so a COUNT assertion now evaluates correctly on BOTH backends: the
 * in-extension evaluators (resolveAllMatches / allMatches) and the
 * Playwright export (locator().count())). `entity-title` (provenance
 * carrier, never user-visible text) remains excluded.
 */
const DERIVABLE_KINDS = new Set<WireObservedItem['kind']>([
  'counter',
  'collection',
  'status-badge',
  'notification',
  'entity',
  // B7-P4: the hover-owned revealed-surface kind. Unlike the snapshot
  // kinds above, `surface-visible` facts arrive from the shared
  // adversarial ownership pass (src/shared/surface-fact-ownership) —
  // owned facts carry their own honest locator — and are derived in
  // deriveForOwnedSurfaceFacts, NOT from a resulting-state snapshot.
  'surface-visible',
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
 * Phase 2b: locator for id-less items via an observer-VERIFIED attribute.
 * Requires BOTH the allowlist AND the capture-time uniqueness stamp
 * (uniqueInSnapshot === true). The stamp is computed over the settled
 * snapshot DOM — the same settled DOM state the recorder's evidence window
 * guarantees — so a true stamp means querySelectorAll matched exactly one
 * element at capture. Anything else (no stamp, stamp false, attribute not
 * allowlisted) keeps the existing skip policy unchanged.
 */
function verifiedAttributeSelector(item: WireObservedItem): string | null {
  if (item.kind === 'entity') return null; // entities use their own identity
  if (item.uniqueInSnapshot !== true) return null; // unverified → legacy policy
  const attrs = item.attributes ?? {};
  for (const [name, value] of Object.entries(attrs)) {
    if (!isVerifiedAttrAllowed(name)) continue;
    if (!value || value.length === 0) continue;
    // The observer verified THIS attribute (first allowlisted in capture
    // order — same iteration order, same candidate).
    return `[${name}="${attrValueForSelector(value)}"]`;
  }
  return null;
}

/**
 * Identity attributes used as selector `idAttribute` across the semantic
 * configs (data-asin, data-product-id, data-item-id, data-sku,
 * data-order-id, data-order-number). Kept in sync with
 * page-content-config.ts — the derivation-side mirror of which attribute
 * names denote entity identity.
 */
const IDENTITY_ATTR_NAMES = [
  'data-asin',
  'data-product-id',
  'data-item-id',
  'data-sku',
  'data-order-id',
  'data-order-number',
];

/**
 * Identity VALUE of an entity item: entityId when the capturing selector
 * had a matching idAttribute, otherwise the value of any captured identity
 * attribute. Two snapshot items describing the same physical entity (the
 * double-capture case: legacy entry with a different idAttribute →
 * entityId null, plus the co-occurrence entry → entityId set) share this
 * value.
 */
function identityValue(item: WireObservedItem): string | null {
  if (item.entityId) return item.entityId;
  const attrs = item.attributes ?? {};
  for (const name of IDENTITY_ATTR_NAMES) {
    const v = attrs[name];
    if (v) return v;
  }
  return null;
}

/**
 * Collapse entity double-captures (Defect 2c): the same physical entity
 * can be captured by two selector entries — e.g. the legacy
 * `[data-product-id], [data-item-id], [data-sku]` entry (idAttribute
 * data-product-id → entityId null on data-sku-only rows) AND the
 * `data-auto-id`-co-occurrence entry (idAttribute data-sku → entityId
 * set). Grouped by identity value, one representative survives — the one
 * carrying the strongest identity (entityId set first). Without this,
 * the null-identity twin derives the vacuous ancestor-`#id` presence the
 * entity branch would otherwise have replaced.
 */
function dedupeEntities(items: WireObservedItem[]): WireObservedItem[] {
  const groups = new Map<string, WireObservedItem>();
  const unordered: WireObservedItem[] = [];
  for (const item of items) {
    const key = identityValue(item);
    if (!key) {
      unordered.push(item);
      continue;
    }
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, item);
    } else if (!existing.entityId && item.entityId) {
      groups.set(key, item); // prefer the representative WITH its identity
    }
  }
  return [...groups.values(), ...unordered];
}

/**
 * Phase 2b: parse the #id from the item's OWN path segment (the LAST
 * segment of the domPath). Distinguishes the element's own id from an
 * ancestor's — the wrong-element risk 2c fixed for entities also exists
 * for id-less counters (e.g. cart-total under #cart-root derived the
 * CONTAINER's text, not the counter's).
 */
function ownIdFromDomPath(domPath: string): string | null {
  const segments = domPath.split('>');
  const last = (segments[segments.length - 1] ?? '').trim();
  const m = last.match(/^([a-zA-Z][\w-]*)#([\w-]+)$/);
  return m ? m[2] : null;
}

/**
 * Decide the replay locator for one observed item.
 *
 * Priority: #id from domPath → identity attribute for entities → skip.
 * matchedSelector and class fragments are intentionally NOT used — they
 * are typically multi-match (collections of siblings share them), which
 * Playwright strict mode would reject and which LOCATOR_CONFIDENCE
 * classifies as unverifiable at generation time.
 *
 * Phase 2b extends the non-entity branch, mirroring 2c's priority shape:
 *   own #id (last domPath segment) → verified allowlisted attribute →
 *   ancestor #id (legacy fallback, unchanged) → skip.
 * A VERIFIED attribute points at the element itself and therefore
 * outranks an ancestor #id, which may belong to a container whose text
 * differs from the counter's (wrong-element risk). Unverified items
 * (uniqueInSnapshot !== true) keep the pre-2b behavior exactly.
 */
function decideLocator(item: WireObservedItem): LocatorDecision {
  // Entities: their OWN identity attribute is the most precise coordinate —
  // strictly better than an #id parsed from the domPath, which may belong to
  // an ANCESTOR (e.g. … > div#cart-root > div[data-sku="X"] derived the
  // container #cart-root, a vacuous presence target). AdaniOne-clone audit
  // 2026-08-20: entity presence assertions must point at the entity itself.
  if (item.kind === 'entity') {
    const identityAttr = identityAttributeSelector(item);
    if (identityAttr) return { css: identityAttr, tier: 'identity-attribute' };
    const id = idFromDomPath(item.domPath);
    if (id) return { css: `#${id}`, tier: 'id' };
    return { css: null, tier: 'none' };
  }

  // Own #id: the highest-confidence coordinate, exactly as before.
  const ownId = ownIdFromDomPath(item.domPath);
  if (ownId) return { css: `#${ownId}`, tier: 'id' };

  // Phase 2b: observer-VERIFIED, allowlisted attribute — points at the
  // element itself, so it outranks an ancestor #id.
  const verifiedAttr = verifiedAttributeSelector(item);
  if (verifiedAttr) {
    return { css: verifiedAttr, tier: 'identity-attribute' };
  }

  // Ancestor #id fallback (legacy behavior, unchanged): better than no
  // coordinate, but only reached when no verified attribute exists.
  const id = idFromDomPath(item.domPath);
  if (id) return { css: `#${id}`, tier: 'id' };

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
 * Phase 2b: collapse nested-counter double-derivation. The same counter
 * widget can be captured twice — the badge element AND its inner count
 * span (ancestor domPath is a path-prefix of the leaf's). Keep the LEAF
 * (more precise text and locator), drop the ancestor wrapper. Without
 * this, the redundant twin consumes the per-step assertion cap and crowds
 * out lower-priority kinds (e.g. entity presence) that the counters 2b
 * newly enables would otherwise displace. Pre-2b both nested captures
 * were id-less and derived nothing, so this dedupe only REMOVES
 * redundancy introduced by 2b — it cannot remove a pre-2b assertion.
 */
function dropAncestorCounters(counters: WireObservedItem[]): WireObservedItem[] {
  return counters.filter(
    (a) => !counters.some(
      (b) => b !== a && b.domPath.startsWith(a.domPath + ' > '),
    ),
  );
}

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
 * counter → collection → status-badge → notification → entity (the
 * approved priority).
 */
function deriveForSnapshot(snapshot: WirePageContentSnapshot): StepScopedAssertion[] {
  const out: StepScopedAssertion[] = [];
  // Priority bucketing, then stable order within each bucket (capture order).
  const byPriority: Record<string, WireObservedItem[]> = {
    counter: [],
    collection: [],
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
  //    text IS the honest expectation; contains on the verbatim text is
  //    also deliberately conservative: a counter token like "4 items"
  //    contains no regex metacharacters anyway, and literal-contains is
  //    the most robust comparison across both backends regardless of the
  //    4c-iii-c MATCHES alignment. numericValue is still required — a
  //    counter we could not parse at capture is too unstable to assert.
  //    Nested-counter dedup first (Phase 2b): the badge wrapper and its
  //    leaf span are the same widget; only the leaf derives.
  for (const item of dropAncestorCounters(byPriority.counter)) {
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

  // 2. Collections — COUNT equals the observed child count. The item's
  //    numericValue IS the semantic result (extractCollectionCount =
  //    el.children.length); asserting it as `#container > *` count captures
  //    "cart now holds N items" without naming individual rows. Emitted
  //    only when BOTH coordinates are trustworthy:
  //      a high-confidence locator (the container's #id — matchedSelector
  //        is a comma-separated multi-selector and unusable as a replay
  //        locator), and a finite numericValue.
  //    `#id > *` matches exactly children.length in both querySelectorAll
  //    (extension replay, via resolveAllMatches from 4c-iii-a) and
  //    locator('#id > *').count() (Playwright export) — semantic parity
  //    with what the observer counted.
  for (const item of byPriority.collection) {
    if (item.numericValue === null || !Number.isFinite(item.numericValue)) continue;
    const containerId = idFromDomPath(item.domPath);
    if (!containerId) continue; // no high-confidence coordinate → skip
    emit({
      type: 'count',
      comparison: 'equals',
      severity: 'soft',
      expectedValue: item.numericValue,
      property: null,
      targetCss: `#${containerId} > *`,
      targetName: item.attributes?.['aria-label']?.slice(0, 60) || 'collection',
      derivedFrom: 'collection',
    });
  }

  // 3. Status badges — TEXT_MATCH contains on distinctive non-numeric text.
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

  // 4. Notifications — PRESENCE only. Text is volatile (order numbers,
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

  // 5. Entities — PRESENCE of the identified entity (data-asin="B0VAL1").
  //     Double-captures collapsed first (see dedupeEntities): each physical
  //     entity derives AT MOST one presence, on its own identity attribute.
  const entities = dedupeEntities(byPriority.entity);
  for (const item of entities) {
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
 * B7-P4: derive surface-visible assertions from a hover's OWNED surface
 * facts (the shared adversarial ownership pass's verdict for that
 * interaction).
 *
 * Locator honesty (INV-GEN-4): owned facts carry their own honest locator
 * (the last #id-bearing path segment as '#id'); facts without one are
 * owned-but-not-derivable and emit nothing. `deriveConsequenceClasses`
 * parity is preserved by the pass's fact extraction itself.
 *
 * Cap: MAX_ASSERTIONS_PER_STEP (3), first-N in fact order.
 */
function deriveForOwnedSurfaceFacts(
  ownedFacts: OwnedSurfaceFact[],
): StepScopedAssertion[] {
  const out: StepScopedAssertion[] = [];
  for (const fact of ownedFacts) {
    // (a) already enforced by the pass; here only locator honesty and the
    // assertion-derivable kinds apply.
    if (fact.kind === 'mutation') continue;
    if (!fact.locator) continue;
    if (out.length >= MAX_ASSERTIONS_PER_STEP) break;
    out.push({
      type: 'presence',
      comparison: 'isTrue',
      severity: 'soft',
      expectedValue: null,
      property: null,
      targetCss: fact.locator,
      targetName:
        fact.targetName?.slice(0, MAX_ASSERT_TEXT_LENGTH) ||
        fact.ariaRole ||
        'revealed surface',
      derivedFrom: 'surface-visible',
    });
  }
  return out;
}

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
  // B7-P4: ONE shared ownership pass over the whole interaction list —
  // the same pass the causal-graph provenance seam consumes. Computed
  // once, consulted per-hover.
  const surfaceOwnership = deriveSurfaceFactOwnership(interactions);
  const map = new Map<string, StepScopedAssertion[]>();
  for (const interaction of interactions) {
    const eventId = interaction.triggerEvent?.eventId;
    if (!eventId) continue;

    // B7-P1 containment gate REMOVED (B7-P4). Hovers now derive — but
    // ONLY ownership-safe surface-visible assertions: a Hover's evidence
    // window may CONTAIN facts caused by another interaction's action
    // (Channel A Variants 1+2 — INV-C1: the DOM/surface accumulator is
    // GLOBAL, overlapping windows re-report each other's facts). The
    // shared adversarial ownership pass (rule (a) batch boundary, rule
    // (b) primary-action veto, rule (c) container precedence) decides
    // which facts are genuinely the hover's; locator honesty (INV-GEN-4)
    // then requires an id-bearing path. Every other interaction type is
    // byte-identical to the pre-P4 derivation.
    const hoverOwnedFacts =
      interaction.type === 'Hover'
        ? (surfaceOwnership.ownedByInteraction.get(interaction.interactionId) ?? [])
        : null;

    // Phase 6C (P2): a typed fill's committed value comes from the
    // interaction's OWN metadata — controlled-input commits produce no DOM
    // mutations, so this must NOT require a resulting-state snapshot.
    // Snapshot-derived kinds still do (INV-CS1: per-window evidence).
    const fillAssertion = deriveFillCommittedValue(interaction);
    const snapshot =
      interaction.behavioralEvidence?.applicationEvidence?.resultingState;

    let assertions: StepScopedAssertion[] = [];
    if (hoverOwnedFacts) {
      // Hover: derive ONLY from owned facts (spec §5.4 P4-amendment).
      assertions = deriveForOwnedSurfaceFacts(hoverOwnedFacts);
    } else if (snapshot && snapshot.items && snapshot.items.length > 0) {
      assertions = deriveForSnapshot(snapshot);
    }
    if (fillAssertion) {
      // Fill committed-value FIRST, then snapshot kinds, shared 3-cap.
      assertions.unshift(fillAssertion);
      if (assertions.length > MAX_ASSERTIONS_PER_STEP) {
        assertions.length = MAX_ASSERTIONS_PER_STEP;
      }
    }
    if (assertions.length === 0) continue;

    map.set(eventId, assertions);
  }
  return map;
}

/**
 * Phase 6C (P2): committed-value assertion for typed fills.
 *
 * A TextEntry whose user typed an intent the app REWROTE at blur (typed
 * "Sat, 22 Aug" → committed "Sat, 05 Sep") carries its committed value in
 * metadata.textValue. The assertion contract (spec §2.5): fills assert the
 * COMMITTED application state, never the typed intent.
 *
 * Locator honesty: the only trustworthy coordinate is the interaction's own
 * trigger element. trigger.stableId is the element's own #id (the #id tier)
 * — when it is absent there is NO honest locator, so we emit nothing (an
 * assertion on a guessed locator would be worse than none). Never widens
 * selectors (INV-GEN-4): no class chains, no synthesized nth.
 *
 * Emission: runs BEFORE the snapshot-kind derivation and consumes the first
 * slot of the shared 3-per-step cap — a fill's own committed outcome is the
 * most valuable assertion for that step.
 */
function deriveFillCommittedValue(interaction: ComponentInteraction): StepScopedAssertion | null {
  if (interaction.type !== 'TextEntry') return null;
  // Non-completed fills (abandoned/interrupted/discarded) carry no honest
  // committed state to assert.
  if (interaction.endState !== 'completed') return null;

  const metadata = interaction.metadata as Record<string, unknown> | undefined;
  if (!metadata) return null;
  const userTyped = metadata.userTyped === true;
  if (!userTyped) return null; // autofill/paste — nothing semantic to assert

  const committed = metadata.textValue;
  if (typeof committed !== 'string' || committed.trim() === '') return null;

  const stableId = interaction.trigger?.stableId;
  if (typeof stableId !== 'string' || stableId === '') return null;

  const targetName =
    typeof metadata.targetName === 'string' && metadata.targetName.trim() !== ''
      ? metadata.targetName.slice(0, 60)
      : 'input field';

  return {
    type: 'equality',
    comparison: 'equals',
    severity: 'soft',
    expectedValue: committed.trim().slice(0, MAX_ASSERT_TEXT_LENGTH),
    property: 'value',
    targetCss: `#${stableId}`,
    targetName,
    derivedFrom: 'fill-committed-value',
  };
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
