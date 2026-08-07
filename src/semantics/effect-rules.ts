/**
 * Effect Rules — Pure functions that examine an ObservationResult and
 * produce SemanticEffect[] (0 or more).
 *
 * Each rule is independent and side-effect-free. The orchestrator
 * (effect-interpreter.ts) runs all rules and collects results.
 *
 * Two evidence sources:
 * - Source A: Snapshot deltas (before→final on the trigger element)
 * - Source B: Mutation attribute changes (on any element in the window)
 *
 * Rules are grouped by confidence model:
 * - Direct-property rules: ALWAYS high confidence (noise-immune)
 * - Structural-inference rules: MEDIUM baseline, degrade on noise/early-close
 *
 * Architecture: .drytis/specs/semantic-effect-interpretation.md
 */

import type {
  ObservationResult,
  MutationRecord2,
} from '../shared/observation-types';
import type { InterpretationContext } from './interpretation-context';
import type {
  SemanticEffect,
  EffectCategory,
  Confidence,
  ConfidenceBasis,
  AffectedTarget,
} from './effect-types';

// ── Constants ─────────────────────────────────────────────────────────

/** Maximum distinct mutation target paths before aggregation kicks in. */
const MAX_DISTINCT_PATHS = 5;

// ── Internal: Window Quality ──────────────────────────────────────────

/**
 * Quality flags computed from the ObservationResult.
 * Used by structural rules to adjust confidence.
 */
export interface WindowQuality {
  /** True if performanceCondition is present (high-volume mutation batch). */
  isNoisy: boolean;
  /** True if the window did not complete normally (recording-stopped or element-removed). */
  isEarlyClose: boolean;
}

/**
 * Compute window quality flags from the ObservationResult.
 * Direct-property rules ignore these; structural rules use them.
 */
export function computeQuality(result: ObservationResult): WindowQuality {
  return {
    isNoisy: result.performanceCondition != null,
    isEarlyClose: result.endReason !== 'completed',
  };
}

// ── Internal: Helpers ──────────────────────────────────────────────────

/**
 * Build a SemanticEffect from its components.
 */
function makeEffect(
  category: EffectCategory,
  description: string,
  affectedTarget: AffectedTarget,
  confidence: Confidence,
  confidenceBasis: ConfidenceBasis,
  evidence: { windowId: string; sourceEventId: string },
  netNodeDelta?: number | null,
): SemanticEffect {
  return {
    category,
    description,
    affectedTarget,
    confidence,
    confidenceBasis,
    evidenceRef: evidence,
    ...(netNodeDelta != null ? { netNodeDelta } : {}),
  };
}

/**
 * Build an AffectedTarget for the trigger element from the interpretation context.
 */
function triggerTarget(ctx: InterpretationContext): AffectedTarget {
  return {
    role: ctx.triggerRole,
    label: ctx.triggerLabel,
    cssPath: ctx.triggerCssPath,
  };
}

/**
 * Resolve confidence for structural-inference rules.
 * Baseline is MEDIUM. Degrades to LOW on early-close or noise.
 * Early-close takes priority in the basis label (it's the stronger signal —
 * the window didn't finish observing).
 */
function resolveStructuralConfidence(quality: WindowQuality): {
  confidence: Confidence;
  basis: ConfidenceBasis;
} {
  if (quality.isEarlyClose) return { confidence: 'low', basis: 'early-close' };
  if (quality.isNoisy) return { confidence: 'low', basis: 'noise-degraded' };
  return { confidence: 'medium', basis: 'structural-inference' };
}

// ── Rule 1: State Toggle (always HIGH) ────────────────────────────────

/**
 * Rule: State Toggle
 *
 * Fires when checked, aria-checked, or aria-pressed changed between
 * before and final snapshots, OR when mutations show aria-checked /
 * aria-pressed attribute changes.
 *
 * Covers: native checkboxes (.checked), custom ARIA checkboxes
 * (aria-checked on ancestor), toggle buttons (aria-pressed).
 *
 * Confidence: ALWAYS high. Direct property delta is noise-immune.
 *
 * Deduplication: If both the snapshot delta AND a mutation capture the
 * same attribute change, only one effect is emitted (snapshot takes priority
 * since it's on the trigger element itself).
 */
export function checkStateToggle(
  result: ObservationResult,
  ctx: InterpretationContext,
): SemanticEffect[] {
  const effects: SemanticEffect[] = [];
  const target = triggerTarget(ctx);
  const evidence = { windowId: result.windowId, sourceEventId: result.sourceEventId };
  const before = result.beforeSnapshot;
  const after = result.finalSnapshot;

  // Track which toggle attributes were already covered by snapshot
  const coveredAttrs = new Set<string>();

  // ── Source A: Snapshot deltas on the trigger element ──────────────

  if (before && after) {
    // .checked property (native checkbox/radio)
    if (before.checked !== null && after.checked !== null && before.checked !== after.checked) {
      effects.push(makeEffect(
        'state-toggle',
        `checked: ${before.checked} → ${after.checked}`,
        target, 'high', 'direct-property', evidence,
      ));
      coveredAttrs.add('checked');
    }

    // aria-checked attribute
    if (
      before.ariaChecked !== null && after.ariaChecked !== null &&
      before.ariaChecked !== after.ariaChecked
    ) {
      effects.push(makeEffect(
        'state-toggle',
        `aria-checked: ${before.ariaChecked} → ${after.ariaChecked}`,
        target, 'high', 'direct-property', evidence,
      ));
      coveredAttrs.add('aria-checked');
    }

    // aria-pressed attribute
    if (
      before.ariaPressed !== null && after.ariaPressed !== null &&
      before.ariaPressed !== after.ariaPressed
    ) {
      effects.push(makeEffect(
        'state-toggle',
        `aria-pressed: ${before.ariaPressed} → ${after.ariaPressed}`,
        target, 'high', 'direct-property', evidence,
      ));
      coveredAttrs.add('aria-pressed');
    }
  }

  // ── Source B: Mutation attribute changes on any element ──────────
  // Covers custom components where the clicked element is NOT the
  // state-holder (e.g., clicking <span> inside <div aria-checked>).
  // Skips attributes already covered by the snapshot delta.

  const ariaToggleMutations = result.mutations.filter(
    (m) =>
      m.type === 'attributes' &&
      (m.attributeName === 'aria-checked' || m.attributeName === 'aria-pressed') &&
      m.oldValue !== null &&
      m.newValue !== null &&
      m.oldValue !== m.newValue,
  );

  for (const m of ariaToggleMutations) {
    const attrName = m.attributeName!;
    if (coveredAttrs.has(attrName)) continue;

    effects.push(makeEffect(
      'state-toggle',
      `${attrName}: ${m.oldValue} → ${m.newValue}`,
      { role: null, label: null, cssPath: m.targetPath },
      'high', 'direct-property', evidence,
    ));
  }

  return effects;
}

// ── Rule 2: Expand Collapse (always HIGH) ─────────────────────────────

/**
 * Rule: Expand / Collapse
 *
 * Fires when aria-expanded changed between snapshots, or when
 * mutations show aria-expanded attribute changes.
 *
 * Covers: accordions, collapsible panels, disclosure widgets.
 *
 * Confidence: ALWAYS high. Direct property delta is noise-immune.
 */
export function checkExpandCollapse(
  result: ObservationResult,
  ctx: InterpretationContext,
): SemanticEffect[] {
  const effects: SemanticEffect[] = [];
  const target = triggerTarget(ctx);
  const evidence = { windowId: result.windowId, sourceEventId: result.sourceEventId };
  const before = result.beforeSnapshot;
  const after = result.finalSnapshot;

  // Snapshot delta
  if (
    before && after &&
    before.ariaExpanded !== null && after.ariaExpanded !== null &&
    before.ariaExpanded !== after.ariaExpanded
  ) {
    const fmt = (v: boolean) => (v ? 'expanded' : 'collapsed');
    effects.push(makeEffect(
      'expand-collapse',
      `expanded: ${fmt(before.ariaExpanded)} → ${fmt(after.ariaExpanded)}`,
      target, 'high', 'direct-property', evidence,
    ));
    return effects;
  }

  // Mutation attribute change (custom component where aria-expanded is on ancestor)
  const expandMutations = result.mutations.filter(
    (m) =>
      m.type === 'attributes' &&
      m.attributeName === 'aria-expanded' &&
      m.oldValue !== null &&
      m.newValue !== null &&
      m.oldValue !== m.newValue,
  );

  for (const m of expandMutations) {
    const fmt = (v: string) => (v === 'true' ? 'expanded' : 'collapsed');
    effects.push(makeEffect(
      'expand-collapse',
      `expanded: ${fmt(m.oldValue!)} → ${fmt(m.newValue!)}`,
      { role: null, label: null, cssPath: m.targetPath },
      'high', 'direct-property', evidence,
    ));
  }

  // ── Native <details> open attribute (G6) ────────────────────────────
  // <details open> is a boolean HTML attribute. Absent = collapsed,
  // present = expanded. Maps to expand-collapse just like aria-expanded.
  const detailsOpenMutations = result.mutations.filter(
    (m) =>
      m.type === 'attributes' &&
      m.attributeName === 'open' &&
      m.targetTag === 'DETAILS' &&
      m.oldValue !== m.newValue,
  );

  for (const m of detailsOpenMutations) {
    const fmt = (v: string | null) => (v === null ? 'collapsed' : 'expanded');
    effects.push(makeEffect(
      'expand-collapse',
      `details: ${fmt(m.oldValue)} → ${fmt(m.newValue)}`,
      { role: null, label: null, cssPath: m.targetPath },
      'high', 'direct-property', evidence,
    ));
  }

  return effects;
}

// ── Rule 3: Enable Disable (always HIGH) ──────────────────────────────

/**
 * Rule: Enable / Disable
 *
 * Fires when disabled property changed between snapshots, or when
 * mutations show disabled attribute changes.
 *
 * Confidence: ALWAYS high. Direct property delta is noise-immune.
 */
export function checkEnableDisable(
  result: ObservationResult,
  ctx: InterpretationContext,
): SemanticEffect[] {
  const effects: SemanticEffect[] = [];
  const target = triggerTarget(ctx);
  const evidence = { windowId: result.windowId, sourceEventId: result.sourceEventId };
  const before = result.beforeSnapshot;
  const after = result.finalSnapshot;

  // Snapshot delta
  if (before && after && before.disabled !== after.disabled) {
    const fmt = (v: boolean) => (v ? 'disabled' : 'enabled');
    effects.push(makeEffect(
      'enable-disable',
      `${fmt(before.disabled)} → ${fmt(after.disabled)}`,
      target, 'high', 'direct-property', evidence,
    ));
    return effects;
  }

  // Mutation attribute change
  const disableMutations = result.mutations.filter(
    (m) =>
      m.type === 'attributes' &&
      m.attributeName === 'disabled' &&
      m.oldValue !== m.newValue,
  );

  for (const m of disableMutations) {
    // disabled attribute present (non-null) = disabled; absent (null) = enabled
    const fmt = (v: string | null) => (v === null ? 'enabled' : 'disabled');
    effects.push(makeEffect(
      'enable-disable',
      `${fmt(m.oldValue)} → ${fmt(m.newValue)}`,
      { role: null, label: null, cssPath: m.targetPath },
      'high', 'direct-property', evidence,
    ));
  }

  return effects;
}

// ── Rule 4: Content Change (MEDIUM, noise/early-close degrades) ───────

/**
 * Rule: Content Change
 *
 * Fires when childList or characterData mutations exist, or when
 * the target element's childCount or textContent changed.
 *
 * Multi-target aggregation (U7):
 *   ≤ MAX_DISTINCT_PATHS distinct paths → one effect per path
 *   > MAX_DISTINCT_PATHS distinct paths → one aggregated effect, low confidence
 *
 * Confidence: MEDIUM baseline. Degrades to LOW on noise or early close.
 */
export function checkContentChange(
  result: ObservationResult,
  ctx: InterpretationContext,
  quality: WindowQuality,
): SemanticEffect[] {
  const effects: SemanticEffect[] = [];
  const evidence = { windowId: result.windowId, sourceEventId: result.sourceEventId };
  const before = result.beforeSnapshot;
  const after = result.finalSnapshot;

  // ── Source A: Trigger element snapshot delta ─────────────────────

  if (before && after) {
    // childCount delta on trigger element
    if (before.childCount !== after.childCount) {
      const { confidence, basis } = resolveStructuralConfidence(quality);
      effects.push(makeEffect(
        'content-change',
        `child elements: ${before.childCount} → ${after.childCount}`,
        triggerTarget(ctx), confidence, basis, evidence,
        after.childCount - before.childCount,
      ));
    }

    // textContent delta on trigger element
    if (
      before.textContent !== null && after.textContent !== null &&
      before.textContent !== after.textContent
    ) {
      const { confidence, basis } = resolveStructuralConfidence(quality);
      effects.push(makeEffect(
        'content-change',
        'text changed',
        triggerTarget(ctx), confidence, basis, evidence,
        0,
      ));
    }
  }

  // ── Source B: Structural mutations grouped by target path ────────

  const structuralMutations = result.mutations.filter(
    (m) => m.type === 'childList' || m.type === 'characterData',
  );

  if (structuralMutations.length === 0) return effects;

  // Group by targetPath
  const byPath = new Map<string, MutationRecord2[]>();
  for (const m of structuralMutations) {
    const list = byPath.get(m.targetPath) ?? [];
    list.push(m);
    byPath.set(m.targetPath, list);
  }

  if (byPath.size > MAX_DISTINCT_PATHS) {
    // ── Aggregated effect (framework rerender) ─────────────────────
    const childListMuts = structuralMutations.filter((m) => m.type === 'childList');
    const totalAdded = childListMuts.reduce((s, m) => s + m.addedNodesCount, 0);
    const totalRemoved = childListMuts.reduce((s, m) => s + m.removedNodesCount, 0);
    const netDelta = totalAdded - totalRemoved;
    effects.push(makeEffect(
      'content-change',
      `broad structural change: ${structuralMutations.length} mutations across ${byPath.size} paths`,
      { role: null, label: null, cssPath: '(multiple)' },
      'low', 'structural-inference', evidence,
      netDelta,
    ));
  } else {
    // ── One effect per distinct path ───────────────────────────────
    const { confidence, basis } = resolveStructuralConfidence(quality);

    for (const [path, muts] of byPath) {
      const childListMuts = muts.filter((m) => m.type === 'childList');
      const charDataMuts = muts.filter((m) => m.type === 'characterData');

      const added = childListMuts.reduce((s, m) => s + m.addedNodesCount, 0);
      const removed = childListMuts.reduce((s, m) => s + m.removedNodesCount, 0);
      const netDelta = added - removed;

      let desc: string;
      if (childListMuts.length > 0 && charDataMuts.length > 0) {
        desc = `content changed: ${added} added, ${removed} removed, ${charDataMuts.length} text changes`;
      } else if (childListMuts.length > 0) {
        desc = `child elements: ${added} added, ${removed} removed`;
      } else {
        desc = 'text content changed';
      }

      effects.push(makeEffect(
        'content-change',
        desc,
        { role: null, label: null, cssPath: path },
        confidence, basis, evidence,
        netDelta,
      ));
    }
  }

  return effects;
}

// ── Rule 5: Visibility Change (MEDIUM, noise/early-close degrades) ────

/**
 * Rule: Visibility Change
 *
 * Fires ONLY when the ObservationCoordinator detected the trigger
 * element was removed from the DOM at close time (endReason='element-removed').
 *
 * We do NOT infer "appeared" from childList additions — that is handled
 * by content-change. Without computed-style or dimensions, we cannot
 * prove a visibility transition from node insertion alone.
 *
 * Confidence: MEDIUM baseline. Degrades to LOW on early close or noise.
 */
export function checkVisibilityChange(
  result: ObservationResult,
  ctx: InterpretationContext,
  quality: WindowQuality,
): SemanticEffect[] {
  if (result.endReason !== 'element-removed') return [];

  const { confidence, basis } = resolveStructuralConfidence(quality);
  return [
    makeEffect(
      'visibility-change',
      'element removed from DOM',
      triggerTarget(ctx),
      confidence,
      basis,
      { windowId: result.windowId, sourceEventId: result.sourceEventId },
    ),
  ];
}

// ── Fallback A: No Observable Effect ──────────────────────────────────

/**
 * Fallback: No Observable Effect
 *
 * Fires when NO other rule produced any effect AND there are zero
 * mutations AND no snapshot property delta.
 *
 * Confidence:
 *   Completed window (3s elapsed): HIGH — absence IS the evidence.
 *   Early close: LOW — the effect may simply not have occurred yet.
 */
export function makeNoObservableEffect(
  result: ObservationResult,
  ctx: InterpretationContext,
  quality: WindowQuality,
): SemanticEffect {
  const evidence = { windowId: result.windowId, sourceEventId: result.sourceEventId };

  if (quality.isEarlyClose) {
    return makeEffect(
      'no-observable-effect',
      'no observable DOM changes detected (window ended early)',
      triggerTarget(ctx), 'low', 'incomplete-observation', evidence,
    );
  }

  return makeEffect(
    'no-observable-effect',
    'no observable DOM changes detected',
    triggerTarget(ctx), 'high', 'direct-property', evidence,
  );
}

// ── Fallback B: Unclassified ──────────────────────────────────────────

/**
 * Fallback: Unclassified
 *
 * Fires when mutations exist but no rule matched (e.g., only class/style/
 * data-* attribute changes). Produces a raw summary for human inspection.
 *
 * IMPORTANT: This fires ONLY when effects.length === 0 — i.e., the
 * interpreter produced zero effects from all rules. If a direct-property
 * rule fired (e.g., state-toggle), unexplained cosmetic mutations
 * (class/style) do NOT get their own unclassified effect. They remain
 * available in the raw M1 evidence (ObservationResult.mutations[]).
 */
export function makeUnclassified(
  result: ObservationResult,
  ctx: InterpretationContext,
): SemanticEffect {
  const types = new Set<string>();
  const attrs = new Set<string>();
  for (const m of result.mutations) {
    types.add(m.type);
    if (m.attributeName) attrs.add(m.attributeName);
  }

  const parts = [
    `${result.mutations.length} mutations`,
    `types: [${[...types].join(', ')}]`,
  ];
  if (attrs.size > 0) parts.push(`attributes: [${[...attrs].join(', ')}]`);

  return makeEffect(
    'unclassified',
    parts.join(', '),
    triggerTarget(ctx), 'low', 'no-match',
    { windowId: result.windowId, sourceEventId: result.sourceEventId },
  );
}
