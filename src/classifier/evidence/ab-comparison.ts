/**
 * A/B Comparison Utility (dev-only)
 *
 * Compares the existing classifier (V1) output with the Evidence Engine (V2)
 * output. Logs disagreements to console for development debugging.
 *
 * This module is testable in isolation — it takes two arrays of detected
 * interactions and returns a structured comparison result.
 */

export interface ComparisonResult {
  /** True if V1 and V2 produce identical type sequences. */
  agree: boolean;
  /** Total interaction count in V1. */
  v1Count: number;
  /** Total interaction count in V2. */
  v2Count: number;
  /** Per-index differences (only includes indices where types or event counts differ). */
  differences: ComparisonDifference[];
}

export interface ComparisonDifference {
  index: number;
  v1Type: string;
  v2Type: string;
  v1EventCount: number;
  v2EventCount: number;
}

/**
 * Compare V1 and V2 classifier outputs.
 *
 * Returns a structured result that can be logged, stored, or asserted on.
 * This function has ZERO side effects — it does not write to storage or console.
 */
export function compareClassifierOutputs(
  v1: { type: string; eventIds: string[] }[],
  v2: { type: string; eventIds: string[] }[],
): ComparisonResult {
  const differences: ComparisonDifference[] = [];
  const maxLen = Math.max(v1.length, v2.length);

  for (let i = 0; i < maxLen; i++) {
    const v1Item = v1[i];
    const v2Item = v2[i];
    const v1Type = v1Item?.type ?? '—';
    const v2Type = v2Item?.type ?? '—';
    const v1Events = v1Item?.eventIds?.length ?? 0;
    const v2Events = v2Item?.eventIds?.length ?? 0;

    if (v1Type !== v2Type || v1Events !== v2Events) {
      differences.push({
        index: i,
        v1Type,
        v2Type,
        v1EventCount: v1Events,
        v2EventCount: v2Events,
      });
    }
  }

  const agree = differences.length === 0 && v1.length === v2.length;

  return {
    agree,
    v1Count: v1.length,
    v2Count: v2.length,
    differences,
  };
}

/**
 * Log a comparison result to the console.
 *
 * Uses console.log for agreement, console.warn for disagreement.
 * This is the dev-facing surface — production code does not call this.
 */
export function logComparisonResult(result: ComparisonResult): void {
  if (result.v1Count === 0 && result.v2Count === 0) return;

  if (result.agree) {
    console.log(
      `[A/B] V1 and V2 agree: ${result.v1Count} interactions, all types match`,
    );
    return;
  }

  console.warn(
    `[A/B] Classifier disagreement: V1=${result.v1Count} vs V2=${result.v2Count} interactions`,
  );
  for (const diff of result.differences) {
    console.warn(
      `[A/B] #${diff.index}: V1=${diff.v1Type}(${diff.v1EventCount} evts) vs V2=${diff.v2Type}(${diff.v2EventCount} evts)`,
    );
  }
}
