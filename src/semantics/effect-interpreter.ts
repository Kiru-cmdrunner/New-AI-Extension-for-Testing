/**
 * Effect Interpreter — Orchestrator
 *
 * Takes an ObservationResult + InterpretationContext, runs all rules in
 * priority order, applies confidence logic, and returns SemanticEffect[].
 *
 * This is a PURE FUNCTION — no DOM access, no async, no side effects.
 * Designed to run in the service worker (off the recording hot path).
 *
 * Execution flow:
 *   1. Compute window quality flags (isNoisy, isEarlyClose)
 *   2. Run direct-property rules → always HIGH confidence
 *   3. Run structural-inference rules → MEDIUM, degrade on noise/early-close
 *   4. Fallback ONLY if zero effects produced:
 *      - 0 mutations → no-observable-effect (HIGH for completed, LOW for early)
 *      - has mutations → unclassified (LOW)
 *
 * 'unclassified' fires ONLY when the interpreter produced zero effects.
 * Unexplained cosmetic mutations alongside a matched rule (e.g., class
 * change alongside a state-toggle) do NOT get their own effect — they
 * remain in the raw M1 evidence.
 *
 * Architecture: .drytis/specs/semantic-effect-interpretation.md
 */

import type { ObservationResult } from '../shared/observation-types';
import type { InterpretationContext } from './interpretation-context';
import type { SemanticEffect } from './effect-types';
import {
  checkStateToggle,
  checkExpandCollapse,
  checkEnableDisable,
  checkContentChange,
  checkVisibilityChange,
  makeNoObservableEffect,
  makeUnclassified,
  computeQuality,
} from './effect-rules';

/**
 * Interpret one observation window's evidence into semantic effects.
 *
 * @param result - The complete behavioral evidence from one observation window.
 * @param ctx - Minimal metadata from the triggering ComponentInteraction.
 * @returns Zero or more SemanticEffects. Multiple effects are emitted
 *          when multiple rules fire (no suppression). Direct-property
 *          effects stay HIGH confidence regardless of noise; structural
 *          effects degrade on noise/early-close.
 */
export function interpret(
  result: ObservationResult,
  ctx: InterpretationContext,
): SemanticEffect[] {
  const quality = computeQuality(result);
  const effects: SemanticEffect[] = [];

  // ── Priority 1: Direct property rules (always HIGH) ──────────────
  effects.push(...checkStateToggle(result, ctx));
  effects.push(...checkExpandCollapse(result, ctx));
  effects.push(...checkEnableDisable(result, ctx));

  // ── Priority 2: Structural inference rules (MEDIUM, degradable) ───
  effects.push(...checkContentChange(result, ctx, quality));
  effects.push(...checkVisibilityChange(result, ctx, quality));

  // ── Fallback: Only if no rule produced an effect ──────────────────
  if (effects.length === 0) {
    if (result.mutations.length === 0) {
      // No mutations at all → genuine absence
      effects.push(makeNoObservableEffect(result, ctx, quality));
    } else {
      // Mutations exist but no rule matched → unclassified
      effects.push(makeUnclassified(result, ctx));
    }
  }

  return effects;
}
