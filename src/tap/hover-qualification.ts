/**
 * HoverQualification — capture-time earned classification for Hover.
 *
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md
 *   §4 (T1 physical, T1b enter-time baseline, T2 affordance,
 *       T3 earning evidence, T4 disambiguation)
 *   §5 (HoverQualification record + rules R-Q1..R-Q9)
 *   §6 (owned surface set via joinsRecordedSurface)
 *   §15 D1/D2/D3 locked decisions.
 *
 * Doctrine:
 *   - `mouseenter` = Hover CANDIDATE, never automatically Hover (D-HEC-8).
 *   - `evidenced` ⇔ ≥1 NEW, target-local, baseline-relative T3 transition.
 *   - No thresholds, no scores, no confidence (R-Q3).
 *   - Reason is a deterministic pure function of the recorded fact vector
 *     (R-Q7), max 200 chars (D3), structural vocabulary only.
 *   - NOTHING global (page-wide churn, network, dwell, nav) ever qualifies.
 *
 * This module is PURE — no live DOM reads, no timing calls, no Date.now.
 * All inputs are recorded facts. Imported by evidence-collector (capture
 * side) and reusable by tests.
 */

import { joinsRecordedSurface } from '../shared/surface-join';
import type { ConsumerIdentity } from '../shared/surface-join';
import type {
  DomChangeSummary,
  SurfaceChange,
  VisibilityChange,
} from '../shared/behavioral-evidence-types';

// ── Public contract (spec §5) ─────────────────────────────────────────

/** Locked Decision D3 — max reason length. */
export const HOVER_REASON_MAX_CHARS = 200;

export type HoverVerdict = 'evidenced' | 'gesture-only';

export type HoverEvidenceClass = 'reveal' | 'pointer-reach' | 'revert' | null;

export interface HoverAnchorFacts {
  /** How the hover anchor was resolved (R-A4). */
  resolution: 'self' | 'ancestor-lift' | 'reveal-target' | 'body';
  /** elementKey of the hover anchor A. */
  anchorKey: string;
  /** elementKey of resolveTarget(R) recorded at the enter (R-A1). */
  clickAnchorKey: string;
  /** T2 CSS :hover reveal fact probed on the enter path. */
  hoverReveal: boolean;
  /** isHoverDiscoveryShape(A) — declared affordance. */
  shaped: boolean;
}

export interface HoverFactSummary {
  domChangesInOwnedSet: number;
  domChangesTotal: number;
  newSurfacesJoined: number;
  pointerPathEnters: number;
  networkRows: number;
}

export interface HoverQualification {
  verdict: HoverVerdict;
  evidenceClass: HoverEvidenceClass;
  evidenceReason: string;
  anchorFacts: HoverAnchorFacts;
  factSummary: HoverFactSummary;
}

/**
 * The owned-surface baseline (T1b): recorded at the gated-enter instant.
 * `null` = no baseline captured (degraded path) — verdict degrades honestly
 * to gesture-only (R-Q8).
 */
export interface HoverBaseline {
  /** Reveal-state attributes of the ANCHOR element at enter. */
  anchor: {
    ariaExpanded: string | null;
    ariaHidden: string | null;
    hidden: boolean;
  };
}

/** A gated pointer-path enter recorded inside the hover window. */
export interface HoverPointerPathEnter {
  identity: ConsumerIdentity;
}

export interface HoverQualificationInput {
  anchorIdentity: ConsumerIdentity;
  anchorKey: string;
  clickAnchorKey: string;
  resolution: HoverAnchorFacts['resolution'];
  hoverReveal: boolean;
  shaped: boolean;
  /** T1b baseline (null = degraded). */
  baseline: HoverBaseline | null;
  /** Window facts (recorded). */
  domChanges: DomChangeSummary[];
  newSurfaces: SurfaceChange[];
  visibilityChanges: VisibilityChange[];
  pointerPathEnters: HoverPointerPathEnter[];
  networkRows: number;
  navigationCount: number;
  openedBatch: number;
}

// ── T3 vocabulary (structural — mirrors surface-fact-ownership flips) ──

const REVEAL_ATTR_FLIPS: Record<string, [string, string][]> = {
  // attribute: allowed [from, to] transitions that REVEAL
  'aria-expanded': [['false', 'true']],
  'aria-selected': [['false', 'true']],
  'aria-checked': [['false', 'true']],
  'open': [['false', 'true']],
  'aria-hidden': [['true', 'false'], ['true', '']],
  // 'hidden' removed: old='hidden', new absent — handled separately below.
};

const REVERT_ATTR_FLIPS: Record<string, [string, string][]> = {
  'aria-hidden': [['false', 'true']],
};

function normalizeV(v: string | null | undefined): string {
  if (v == null) return '';
  return String(v).trim().toLowerCase();
}

/** Baseline-relative reveal check for one attribute delta. */
function isBaselineRelativeReveal(
  attr: string,
  oldV: string,
  newV: string,
  baseline: HoverBaseline | null,
): boolean {
  const o = normalizeV(oldV);
  const n = normalizeV(newV);

  // hidden removed → reveal (old truthy → new absent). Baseline-relative
  // (T1b-R): when the anchor's baseline exists and was NOT hidden at enter,
  // the removal proves nothing new → degrade honestly (R-Q8). With no
  // baseline entry, the removal cannot be proven new relative to enter →
  // also degrade. dom-observer records new: getAttribute() → null after
  // removal — normalizeV maps null → '' (the "absent" reading).
  if (attr === 'hidden') {
    if (o === '' || n !== '') return false;
    return baseline?.anchor.hidden === true;
  }

  const allowed = REVEAL_ATTR_FLIPS[attr];
  if (!allowed) return false;
      const transitionHeld = allowed.some(([f, t]) => o === f && n === t);
      if (!transitionHeld) return false;

  // Baseline-relativity (T1b-R): when the anchor's OWN recorded baseline
  // value exists, the recorded delta must actually move AWAY from it —
  // a baseline that already held the "to" state proves the state was NOT
  // new (pre-existing open at enter). With NO baseline entry (degraded
  // path) the flip cannot be proven new → degrade honestly (R-Q8).
  // Applies uniformly to every reveal-attr flip the contract tracks
  // (aria-expanded/aria-hidden baseline values; aria-selected/aria-checked/
  // open degrade honestly when unrecorded — they have no baseline entry).
  if (attr === 'aria-expanded' || attr === 'aria-hidden') {
    const baselineAttr =
      attr === 'aria-expanded' ? baseline?.anchor.ariaExpanded :
      attr === 'aria-hidden' ? baseline?.anchor.ariaHidden :
      null;
    if (baselineAttr == null) return false; // no recorded from-state — not provably new
    const b = normalizeV(baselineAttr);
    if (b === n) return false; // already held at enter
    if (b !== o) return false; // delta disagrees with baseline — trust the baseline
  } else {
    // aria-selected / aria-checked / open: no baseline entry was recorded
    // for these attributes — the flip cannot be proven NEW relative to the
    // enter instant. Honest degradation per T1b-R/R-Q8 (never fabricated).
    return false;
  }
  return true;
}

function isRevertTransition(attr: string, oldV: string, newV: string): boolean {
  const o = normalizeV(oldV);
  const n = normalizeV(newV);
  if (REVERT_ATTR_FLIPS[attr]) {
    return REVERT_ATTR_FLIPS[attr].some(([f, t]) => o === f && n === t);
  }
  return false;
}
void isRevertTransition; // reserved for fact-level phase; visibility flips handled inline

/** Ownership join: does this fact path join the hover anchor (§6.1)? */
function joinsAnchor(
  path: string | undefined | null,
  anchorIdentity: ConsumerIdentity,
): boolean {
  if (!path) return false;
  const r = joinsRecordedSurface({ path }, anchorIdentity);
  return r.joined;
}

// ── Reason builders (deterministic, structural, ≤200 chars — R-Q7/D3) ──

function capReason(reason: string): string {
  if (reason.length <= HOVER_REASON_MAX_CHARS) return reason;
  // Deterministic suffix-omission: hard cut at the cap with an ellipsis.
  return `${reason.slice(0, HOVER_REASON_MAX_CHARS - 1)}…`;
}

function revealReason(detail: string): string {
  return capReason(`reveal: ${detail}`);
}

function revertReason(detail: string): string {
  return capReason(`revert: ${detail}`);
}

function pointerReachReason(detail: string): string {
  return capReason(`pointer-reach: ${detail}`);
}

function gestureOnlyReason(
  input: HoverQualificationInput,
  ownedCount: number,
): string {
  if (input.baseline == null) {
    return 'gesture-only: no target-local consequence in enter window (baseline missing)';
  }
  if (ownedCount === 0 && input.domChanges.length > 0) {
    return 'gesture-only: no target-local consequence in enter window (mutations unjoined)';
  }
  if (input.domChanges.length === 0 && input.newSurfaces.length === 0 && input.visibilityChanges.length === 0) {
    return 'gesture-only: no target-local consequence in enter window';
  }
  return 'gesture-only: no target-local consequence in enter window';
}

// ── The verdict (R-Q3: evidenced ⇔ ≥1 T3 transition) ──────────────────

/**
 * Compute the HoverQualification record — PURE function of recorded facts.
 * Called ONCE at hover-window close (R-Q1); result deep-frozen (R-Q2).
 */
export function computeHoverQualification(
  input: HoverQualificationInput,
): HoverQualification {
  const anchorFacts: HoverAnchorFacts = {
    resolution: input.resolution,
    anchorKey: input.anchorKey,
    clickAnchorKey: input.clickAnchorKey,
    hoverReveal: input.hoverReveal,
    shaped: input.shaped,
  };

  // factSummary honesty counts (owned = joined to anchor, §6.1)
  const domChangesTotal = input.domChanges.length;
  const domChangesInOwnedSet = input.domChanges.filter((d) =>
    joinsAnchor(d.targetPath, input.anchorIdentity),
  ).length;
  const newSurfacesJoined = input.newSurfaces.filter((s) =>
    joinsAnchor(s.path, input.anchorIdentity),
  ).length;

  const factSummary: HoverFactSummary = {
    domChangesInOwnedSet,
    domChangesTotal,
    newSurfacesJoined,
    pointerPathEnters: input.pointerPathEnters.length,
    networkRows: input.networkRows,
  };

  let verdict: HoverVerdict = 'gesture-only';
  let evidenceClass: HoverEvidenceClass = null;
  let reason = gestureOnlyReason(input, domChangesInOwnedSet);

  // ── T3 reveal ────────────────────────────────────────────────────
  // (a) attribute flips on joined elements, baseline-relative
  let revealDetail: string | null = null;
  for (const change of input.domChanges) {
    if (!joinsAnchor(change.targetPath, input.anchorIdentity)) continue;
    const deltas = change.attributeDeltas ?? {};
    for (const attr of Object.keys(deltas)) {
      const delta = deltas[attr];
      if (!delta) continue;
      if (isBaselineRelativeReveal(attr, String(delta.old ?? ''), String(delta.new ?? ''), input.baseline)) {
        revealDetail = `aria flip ${attr} ${normalizeV(String(delta.old ?? ''))}→${normalizeV(String(delta.new ?? ''))} on joined element`;
        break;
      }
    }
    if (revealDetail) break;
  }
  // (b) joined surface with emergence === 'revealed'
  if (!revealDetail) {
    const joinedRevealed = input.newSurfaces.find(
      (s) => s.emergence === 'revealed' && joinsAnchor(s.path, input.anchorIdentity),
    );
    if (joinedRevealed) {
      revealDetail = `surface emerged${joinedRevealed.ariaRole ? ` [role=${joinedRevealed.ariaRole}]` : ''} joined to anchor`;
    }
  }
  if (revealDetail) {
    verdict = 'evidenced';
    evidenceClass = 'reveal';
    reason = revealReason(revealDetail);
  }

  // ── T3 pointer-reach ────────────────────────────────────────────
  if (verdict === 'gesture-only') {
    // A later gated enter joining an insertion/reveal fact recorded in the
    // SAME window (post-enter batch, joined to the anchor).
    const joinedSurfaces = input.newSurfaces.filter((s) =>
      s.emergence === 'inserted' && joinsAnchor(s.path, input.anchorIdentity),
    );
    const joinedInsertionPaths = new Set(
      input.domChanges
        .filter((d) => joinsAnchor(d.targetPath, input.anchorIdentity) && d.addedNodesCount > 0)
        .map((d) => d.targetPath),
    );
    const reach = input.pointerPathEnters.find((enter) => {
      const bySurface = joinedSurfaces.some((s) =>
        joinsRecordedSurface(s, enter.identity).joined,
      );
      const byInsertion = [...joinedInsertionPaths].some((p) =>
        joinsRecordedSurface({ path: p! }, enter.identity).joined,
      );
      return bySurface || byInsertion;
    });
    if (reach) {
      verdict = 'evidenced';
      evidenceClass = 'pointer-reach';
      reason = pointerReachReason('enter joined insertion target via surface-join');
    }
  }

  // ── T3 revert ───────────────────────────────────────────────────
  if (verdict === 'gesture-only') {
    for (const vc of input.visibilityChanges) {
      const o = normalizeV(vc.oldValue);
      const n = normalizeV(vc.newValue);
      const isRevertFlip =
        (vc.property === 'display' && o !== 'none' && n === 'none') ||
        (vc.property === 'visibility' && o === 'visible' && n === 'hidden') ||
        (vc.property === 'aria-hidden' && o === 'false' && n === 'true');
      if (isRevertFlip && joinsAnchor(vc.path, input.anchorIdentity)) {
        verdict = 'evidenced';
        evidenceClass = 'revert';
        reason = revertReason(`${vc.property} →${n} on leave of anchored surface`);
        break;
      }
    }
  }

  const record: HoverQualification = {
    verdict,
    evidenceClass,
    evidenceReason: capReason(reason),
    anchorFacts,
    factSummary,
  };

  return deepFreeze(record);
}

function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const v = (obj as Record<string, unknown>)[key];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      deepFreeze(v as object);
    }
  }
  return obj;
}
