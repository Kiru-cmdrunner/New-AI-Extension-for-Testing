/**
 * Readability Optimizer — deterministic optimization of Canonical Test Steps.
 *
 * Milestone B7.2 (v5.3.0)
 *
 * B7.1 §2.1: The optimizer is an INTERNAL refinement of the Canonical Step
 * Generator. It is not a new pipeline stage. It modifies only the plainEnglish
 * field and stepNumber (display presentation). All execution fields are
 * immutable.
 *
 * B7.1 §5.3: Correctness over readability. If a transformation cannot be
 * proven safe, it is not applied.
 *
 * B7.2 Design Clarifications (frozen):
 *   - Same Element Detection: composite key (tag | stableId | cssSelector).
 *     Replaceable via isSameElement(). Decision 1.
 *   - Merge Eligibility: OR-1 requires ALL conditions (C1-C4) plus same-element.
 *     Decision 2. Same-element alone is never sufficient.
 *
 * Optimization Rules:
 *   OR-1: Focus-Click + Text-Entry Merge (implemented)
 *   OR-2: Consecutive Text Entry (no-op — constraint prevents future merges)
 *   OR-3: Duplicate Click Removal (NOT implemented — provisional, hook only)
 */

import type { ElementIdentity } from '../../shared/types';
import type { CanonicalStep } from '../types';

// ── Decision 1: Same Element Detection ─────────────────────

/**
 * Determine whether two interactions target the same logical element.
 *
 * B7.2 Same Element Detection Clarification (frozen):
 *   Uses a composite identity key derived from stable, per-element structural
 *   attributes: tag | stableId | cssSelector.
 *
 * This is the SAME approach already used by click-content-script.ts
 * (identityKey() at line 651) for double-click detection.
 *
 * Replaceability: This function is the sole implementation of same-element
 * detection. If a future recorder provides a more reliable identity mechanism
 * (e.g., a stable element fingerprint, a data-cmdrunner-element-uid), only
 * this function needs to change. The optimization rules, merge logic, and
 * step generation remain unchanged.
 *
 * Known limitations (all produce conservative no-merge behavior):
 *   - React re-render between click and blur → cssSelector changes → no merge
 *   - Framework strips/adds IDs dynamically → key changes → no merge
 *   - DOM node replacement (React key change) → position changes → no merge
 */
export function isSameElement(
  a: ElementIdentity,
  b: ElementIdentity,
): boolean {
  return (
    a.tag === b.tag &&
    (a.stableId || '') === (b.stableId || '') &&
    a.cssSelector === b.cssSelector
  );
}

// ── OR-1 Eligibility Conditions ────────────────────────────

/**
 * Input element tags that are valid targets for focus-click + text-entry merge.
 *
 * B7.1 §4.2 "When NOT to apply": "The click target is NOT an input/textarea/
 * select element."
 *
 * Clicking a button, link, or div is a meaningful action — not a focus action.
 * Only input/textarea/select elements are candidates for OR-1.
 */
const INPUT_ELEMENT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Check whether an element tag represents an input element (condition C4).
 *
 * B7.1 §4.2: Only clicks on input/textarea/select elements are candidates
 * for focus-click merge. Clicking a button or link is a meaningful action.
 */
export function isInputElement(tag: string): boolean {
  return INPUT_ELEMENT_TAGS.has(tag.toUpperCase());
}

// ── OR-1: Focus-Click + Text-Entry Merge ───────────────────

/**
 * Apply Rule OR-1: Focus-Click + Text-Entry Merge.
 *
 * B7.1 §4.2: A click event on an input/textarea/select element is immediately
 * followed by a text-entry event on the SAME element. Merge into a single
 * step using the text entry's data. The click step is omitted from the step
 * list.
 *
 * Merge Eligibility (B7.2 frozen clarification):
 *   ALL conditions must be satisfied:
 *     C1: clickStep.actionType === 'click'
 *     C2: textStep.actionType === 'fill' (canonical type for text entry)
 *     C3: textStep immediately follows clickStep (adjacency)
 *     C4: clickStep target is INPUT/TEXTAREA/SELECT
 *     D1: isSameElement(clickStep, textStep) — same logical element
 *
 * Same-element (D1) is necessary but NOT sufficient.
 *
 * What the merge does:
 *   - The text entry step is RETAINED (primary action — carries value).
 *   - The click step is OMITTED (secondary action — focus only).
 *   - The text entry's plainEnglish is already correct: `Enter 'X' in the Y`.
 *     The frozen Semantic Interaction Language template produces the ideal
 *     merged description.
 *   - The text entry's stepId, actionType, elementIdentity, value,
 *     linkedInteractionId are all preserved (permanent identity).
 *
 * Phase 3 Integration Step 3: C2 now checks for canonical type 'fill'
 * (the normalized form of legacy 'text'). The legacy 'text' actionType is
 * no longer produced by the canonical step generator.
 *
 * @param steps  Canonical steps in recording order.
 * @returns      Optimized steps (click omitted where merge applies).
 */
function applyRuleOR1(steps: CanonicalStep[]): CanonicalStep[] {
  if (steps.length < 2) return steps;

  const result: CanonicalStep[] = [];
  const skipIndices = new Set<number>();

  // First pass: identify click steps that should be merged into their text entry
  for (let i = 0; i < steps.length - 1; i++) {
    const clickStep = steps[i];
    const nextStep = steps[i + 1];

    // C1: Current step must be a click
    if (clickStep.actionType !== 'click') continue;

    // C2: Next step must be a text entry (canonical type 'fill')
    if (nextStep.actionType !== 'fill') continue;

    // C3: Adjacency is guaranteed by loop structure (i, i+1)
    //     — but only if neither step was already consumed by a previous merge
    if (skipIndices.has(i) || skipIndices.has(i + 1)) continue;

    // C4: Click target must be an input element
    if (!isInputElement(clickStep.elementIdentity.tag)) continue;

    // D1: Both interactions must target the same logical element
    if (!isSameElement(clickStep.elementIdentity, nextStep.elementIdentity)) continue;

    // All conditions satisfied — mark click step for removal
    skipIndices.add(i);
  }

  // Second pass: build result, omitting merged click steps
  for (let i = 0; i < steps.length; i++) {
    if (!skipIndices.has(i)) {
      result.push(steps[i]);
    }
  }

  return result;
}

// ── OR-2: Consecutive Text Entry (No-op) ───────────────────

/**
 * Rule OR-2: Consecutive Text Entries into Different Fields.
 *
 * B7.1 §4.3: Each text entry remains its own step. No merging.
 *
 * This rule is a NO-OP — it exists as a documented constraint to prevent
 * future developers from adding a "merge form fills" optimization. It
 * requires no code. Each text entry is already a separate step in the
 * pipeline.
 */

// ── OR-3: Duplicate Click Removal (Hook Only — Not Implemented) ──

/**
 * Rule OR-3: Redundant Duplicate Click Removal.
 *
 * B7.1 §4.4 + B7.1 Review Addendum: This rule is PROVISIONAL. It cannot be
 * proven safe by structural inspection alone — double-click semantics vary
 * widely (file open, cell edit, tree expand, word select).
 *
 * NOT IMPLEMENTED. The hook below is where this rule would be added if
 * B7.2 validation proves it is safe across all scenarios.
 *
 * To add OR-3 in the future:
 *   1. Validate extensively against real web apps.
 *   2. If safe, implement applyRuleOR3() here.
 *   3. Call it from applyReadabilityRules() — no other changes needed.
 */
// function applyRuleOR3(steps: CanonicalStep[]): CanonicalStep[] {
//   // PROVISIONAL — not implemented.
//   // See B7.1 §4.4 and B7.1 Review Addendum §1.4.
//   return steps;
// }

// ── Orchestrator ───────────────────────────────────────────

/**
 * Apply all readability optimization rules to Canonical Test Steps.
 *
 * B7.1 §2.1: The optimizer is an internal refinement of the Canonical Step
 * Generator. It runs as a post-processing pass on the generated step array.
 *
 * Rules are applied as independent passes (B7.1 Review Addendum §3.3):
 *   - OR-1: Focus-Click + Text-Entry Merge (implemented)
 *   - OR-2: No-op (constraint, no code)
 *   - OR-3: Not implemented (provisional hook only)
 *
 * After optimization, step numbers are recalculated for contiguous display.
 * Step IDs are NEVER changed — they are permanent identity (B7.1 §2.2).
 *
 * B7.1 §5.2 Precautionary Principle: If a transformation cannot be proven
 * to preserve meaning, it must not be applied. The optimizer is conservative
 * by design.
 *
 * @param steps  Canonical steps in recording order (from generator).
 * @returns      Optimized steps with contiguous step numbers.
 */
export function applyReadabilityRules(steps: CanonicalStep[]): CanonicalStep[] {
  if (steps.length === 0) return steps;

  // Apply OR-1: Focus-click + text-entry merge
  let optimized = applyRuleOR1(steps);

  // OR-2: No-op (constraint — consecutive text entries always remain separate)

  // OR-3: Hook for future duplicate-click removal (not implemented)
  // optimized = applyRuleOR3(optimized);

  // Renumber step numbers for contiguous display.
  // B7.1 §2.2: stepNumber is display presentation. stepId is permanent identity.
  // After merges, some step IDs are retired (e.g., the click step's ID).
  // The remaining steps are renumbered 1, 2, 3, ... for clean display.
  // This does NOT change stepId, linkedInteractionId, or any execution field.
  optimized = optimized.map((step, index) => ({
    ...step,
    stepNumber: index + 1,
  }));

  return optimized;
}
