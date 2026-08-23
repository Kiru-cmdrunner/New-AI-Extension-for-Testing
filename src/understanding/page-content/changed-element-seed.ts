/**
 * Phase 6A — Changed-Element Seed classification (pure module).
 *
 * Spec: .drytis/specs/phase-6a6c-assertion-derivation-fill-semantics.md §2.2, §2.4
 *
 * Converts accumulated DomChangeSummaries (the window's own observation, from
 * domObserver.getAccumulatedSummaries()) into SEED CANDIDATES for the scan()
 * seed pass. This is NOT a selector engine:
 *  - No CSS selector strings are produced or matched here.
 *  - Kinds are inferred from the CHANGE SHAPE (what kind of mutation happened)
 *    — the same vocabulary DEFAULT_SEMANTIC_SELECTORS encodes as selectors,
 *    derived here from behavior instead of markup conventions.
 *  - The changed element is resolved STRUCTURALLY by path (segment walk over
 *    children, tag + #id match) at scan time — never querySelector(path).
 *
 * Noise gates (§2.4) are content/shape-based ONLY — zero timing rules, zero
 * site tokens. React hydration placeholders, skeleton states, spinner text,
 * mount/unmount churn, and no-op echoes are dropped before any candidate is
 * produced.
 *
 * Determinism: same summaries → same seeds, input order preserved, capped at
 * MAX_CHANGED_ELEMENT_SEEDS (first-N).
 */

import type { DomChangeSummary } from '../../shared/behavioral-evidence-types';

/** Maximum seeds the classification pass will emit (spec §2.2 bound). */
export const MAX_CHANGED_ELEMENT_SEEDS = 24;

/** Candidate kinds — the exact WireObservedItem['kind'] vocabulary. */
export type SeedCandidateKind =
  | 'counter'
  | 'collection'
  | 'notification'
  | 'status-badge'
  | 'entity';

export interface SeedCandidate {
  /** The summary that produced this candidate (resolution reads its facts). */
  summary: DomChangeSummary;
  /** Kinds inferred from the change shape (resolution refines by element facts). */
  candidateKinds: SeedCandidateKind[];
  /**
   * True when the summary's targetPath is the PARENT of the semantic content
   * (e.g. a <ul> appended to <body> — the summary targets body, the added
   * children carry the semantics). Resolution must inspect added children.
   */
  resolveViaChildren: boolean;
  /**
   * Phase 6D.1: true for the 1/1 text-swap shape (parent.textContent
   * assignment — a net-zero childList swap of exactly one TEXT node for
   * another, no characterDataDelta on the parent summary). The classifier
   * cannot read the text (purity), so resolution applies the same noise and
   * kind gates it applies to characterData candidates, after proving the
   * swap was text-only (element has NO element children at scan time).
   */
  resolveViaTextSwap: boolean;
}

// ── Noise vocabulary (generic words, NOT site tokens) ──────────────────

/**
 * Generic skeleton/loading vocabulary. Matched case-insensitively against the
 * TRIMMED new text with a prefix rule (≤ MAX_TRANSIENT_TEXT_LENGTH chars);
 * real content that merely CONTAINS these words survives.
 */
const TRANSIENT_TEXT_RE =
  /^(loading|loadin|spinner|skeleton|placeholder|please wait|fetching|updating|processing)[.…]*$/i;

/** Longest text still considered a bare transient marker. */
const MAX_TRANSIENT_TEXT_LENGTH = 24;
/** Tags whose text changes are implementation noise, never semantics. */
const NON_SEMANTIC_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'HEAD']);

/** Editable control tags — their value changes are captured by the tap, not seeded. */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True if the trimmed text is only punctuation/whitespace. */
function isPunctuationOnly(text: string): boolean {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length === 0;
}

/** True if the trimmed text is a bare transient marker (skeleton/loading). */
function isTransientText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  // Any short text that STARTS with a loading-family word is a transient
  // marker ("loading…", "loading...", "Loading some data", "fetching rows").
  // Real content that merely CONTAINS the word survives via the length gate.
  if (trimmed.length > MAX_TRANSIENT_TEXT_LENGTH) return false;
  if (TRANSIENT_TEXT_RE.test(trimmed)) return true;
  if (/^(loading|loadin|spinner|skeleton|placeholder|fetching|updating|processing)\b/i.test(trimmed)) return true;
  if (/^please wait/i.test(trimmed)) return true;
  return false;
}

/** True if the characterData delta carries a numeric change (counter shape). */
/** Shape tokens that make an embedded numeral NOT counter-shaped (dates, times, durations, codes). */
const NON_COUNTER_NUMERAL_RE =
  /\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|minutes|s|sec|secs|seconds|am|pm|st|nd|rd|th)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\b/i;

/**
 * Counter SHAPE verification (stabilization fix 2 / E9 rung 3): the new text
 * must be number-DOMINATED — a bare numeral ("5"), a number with unit/prefix
 * suffix ("5 items", "2 passengers", "$5.00", "3x", "45,012"), never a date
 * ("Sat, 22 Aug"), duration ("02h 30m"), or identifier that merely CONTAINS
 * digits. Preserves the pickSeedKind invariant (dates must not become
 * counters) while making real mixed-numeral counters reachable.
 */
function isNumericDelta(_oldText: string | null, newText: string | null): boolean {
  const t = (newText ?? '').trim();
  if (!/\d/.test(t)) return false;
  if (NON_COUNTER_NUMERAL_RE.test(t)) return false;
  // Number-dominated: strip currency, commas, percent, spaces and a short
  // unit tail; what remains must be digits-only and non-empty.
  const stripped = t
    .replace(/^[$€£₹]\s*/, '')
    .replace(/(\d)[,\s](\d{3})/g, '$1$2')
    .replace(/\s*(?:items?|pax|passengers?|results?|products?|entries|chars?|chars|of)\s*$/i, '')
    .replace(/^\s*x\s*/, '')
    .replace(/%$/, '');
  return /^\d+$/.test(stripped) && stripped.length > 0;
}

/**
 * True when the text carries a NON-counter shape (dates, times, durations,
 * ordinal codes) — the same exclusion isNumericDelta applies to counter
 * classification. Exported so the observer's Phase 6D.1 text-swap resolution
 * path (which cannot verify shape at classification time) applies the
 * identical guard at scan time — parity, not a second vocabulary.
 */
export function isNonCounterShapedText(text: string): boolean {
  return NON_COUNTER_NUMERAL_RE.test(text);
}

/**
 * Classify accumulated change summaries into seed candidates.
 *
 * Pure function: summaries in, candidates out. No DOM access, no timing, no
 * site tokens. Callers resolve candidates against the live DOM at scan time.
 */
export function classifyChangedSummaries(
  summaries: DomChangeSummary[],
): SeedCandidate[] {
  const candidates: SeedCandidate[] = [];

  for (const summary of summaries) {
    // Gate: shadow-context summaries — the document adapter cannot resolve
    // them structurally (their paths are prefixed with the shadow host).
    if (summary.shadowContext != null) continue;

    // Gate: non-semantic tags (script/style churn is hydration noise).
    if (NON_SEMANTIC_TAGS.has(summary.targetTag?.toUpperCase() ?? '')) continue;

    const candidate = classifyOne(summary);
    if (candidate) candidates.push(candidate);
    if (candidates.length >= MAX_CHANGED_ELEMENT_SEEDS) break;
  }

  return candidates;
}

function classifyOne(summary: DomChangeSummary): SeedCandidate | null {
  const kinds: SeedCandidateKind[] = [];
  let resolveViaChildren = false;

  // ── characterData shape ─────────────────────────────────────────────
  const delta = summary.characterDataDelta;
  if (delta != null && (delta.old != null || delta.new != null)) {
    const newText = delta.new ?? '';

    // No-op echo (hydration placeholder swap: old === new).
    if ((delta.old ?? '').trim() === newText.trim() && newText.trim() !== '') return null;
    // Whitespace-only / punctuation-only.
    if (isPunctuationOnly(newText)) return null;
    // Bare transient markers (skeleton / loading vocabulary).
    if (isTransientText(newText)) return null;

    if (EDITABLE_TAGS.has(summary.targetTag?.toUpperCase() ?? '')) {
      // Editable controls' value changes are captured by the tap as
      // interaction metadata (typedValue/textValue) — never seeded as
      // page-content items.
      return null;
    }

    if (isNumericDelta(delta.old, delta.new)) {
      kinds.push('counter');
    }
    if (newText.trim().length >= 2 && !/^\d+$/.test(newText.trim())) {
      // Non-numeric display text change — notification or status-badge;
      // element facts (role/aria) refine at resolution time. The
      // identity-coordinate gate (rung 7) also applies at resolution: an
      // unlabeled change with no addressable coordinate is skipped there.
      kinds.push('notification', 'status-badge');
    }
    if (kinds.length === 0) return null;
    return { summary, candidateKinds: kinds, resolveViaChildren, resolveViaTextSwap: false };
  }

  // ── attribute shape ─────────────────────────────────────────────────
  const changed = summary.changedAttributes ?? [];
  const attrDeltas = summary.attributeDeltas ?? {};
  if (changed.length > 0) {
    // role → alert/status: notification semantics.
    if (changed.includes('role')) {
      const roleNew = attrDeltas['role']?.new;
      if (roleNew === 'alert' || roleNew === 'status') {
        kinds.push('notification');
      }
    }
    // data-count numeric delta: counter semantics.
    if (changed.includes('data-count')) {
      const countNew = attrDeltas['data-count']?.new;
      if (countNew != null && /\d/.test(countNew)) {
        kinds.push('counter');
      }
    }
    // Identity attribute set (data-* id-like): entity semantics. The exact
    // attribute family from the spec's existing-config vocabulary — NO new
    // attribute names beyond what DEFAULT_SEMANTIC_SELECTORS already knows
    // (data-asin is the entity selector's own; data-product-id/item-id/
    // sku/order-id/number are its entity idAttribute conventions).
    for (const attr of changed) {
      if (
        /^(data-asin|data-product-id|data-item-id|data-sku|data-order-id|data-order-number)$/i.test(
          attr,
        )
      ) {
        const attrNew = attrDeltas[attr]?.new;
        if (attrNew != null && attrNew !== '') {
          kinds.push('entity');
          break;
        }
      }
    }
    if (kinds.length === 0) {
      // Attribute churn with no semantic shape (className/style churn is
      // React re-render noise) — drop unless another signal exists.
      const hasChildList = summary.types.includes('childList');
      if (!hasChildList) return null;
    }
  }

  // ── childList shape ────────────────────────────────────────────────
  const added = summary.addedNodesCount ?? 0;
  const removed = summary.removedNodesCount ?? 0;
  if (summary.types.includes('childList')) {
    if (added > 0 && removed === 0) {
      // Net additions: the parent is a growing collection. When the parent is
      // not itself a list (UL/OL/TABLE/TBODY…), the added children carry the
      // semantics — resolution must walk them.
      kinds.push('collection');
      const parentTag = summary.targetTag?.toUpperCase() ?? '';
      if (!['UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'SELECT', 'DATALIST'].includes(parentTag)) {
        resolveViaChildren = true;
      }
    } else if (added === removed && added === 0) {
      // Pure attribute/noise summary already handled above; no childList.
      if (kinds.length === 0) return null;
    } else if (added === removed) {
      // Net-zero churn (mount/unmount swap) with no other signal — drop.
      // Phase 6D.1 W2: the 1/1 exception — a single-text-node swap is the
      // exact capture shape of `parent.textContent = "2 tickets"` (the audit
      // miss: #id-only counters). The classifier stays pure (it cannot read
      // the new text), so the candidate carries the text kinds and
      // resolution proves text-onlyness structurally (no element children at
      // scan time) before applying the standard noise/kind gates. Element
      // churn (2/2, 4/4, mount/unmount) stays dropped.
      if (added === 1 && kinds.length === 0) {
        return {
          summary,
          candidateKinds: ['counter', 'notification', 'status-badge'],
          resolveViaChildren: false,
          resolveViaTextSwap: true,
        };
      }
      if (kinds.length === 0) return null;
    }
    // Net removals (added === 0, removed > 0): nothing to observe — drop
    // unless an attribute/characterData signal already produced kinds.
    if (kinds.length === 0) return null;
  }

  if (kinds.length === 0) return null;
  return { summary, candidateKinds: dedupe(kinds), resolveViaChildren, resolveViaTextSwap: false };
}

function dedupe(kinds: SeedCandidateKind[]): SeedCandidateKind[] {
  return [...new Set(kinds)];
}
