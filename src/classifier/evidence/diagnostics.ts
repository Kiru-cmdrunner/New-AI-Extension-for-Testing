/**
 * Developer Diagnostics for the Evidence Classification Engine.
 *
 * Provides human-readable formatting of the evidence-based reasoning trail,
 * making classification decisions transparent and debuggable.
 *
 * Usage:
 *   import { formatReasoningTrace, formatCompact } from './diagnostics';
 *
 *   const result = classifyByEvidence(target, clickEvent);
 *   console.log(formatReasoningTrace(result));
 *   // → full multi-line reasoning trace
 *
 *   console.log(formatCompact(result));
 *   // → "Checkbox (toggle, conf=0.80) [aria-checked +0.80, checked-transition +0.60, tag-anchor -0.20]"
 *
 * In production: conditionally enabled via a global flag or dev tools setting.
 * In development: always available for debugging.
 */

import type { IntentVote, SemanticIntent } from './types';
import type { EvidenceClassification } from './evidence-classifier';

// ── Formatting Helpers ───────────────────────────────────────────────────

/**
 * Format a weight as a signed string: +0.80, -0.20, +1.00
 */
function formatWeight(w: number): string {
  return (w >= 0 ? '+' : '') + w.toFixed(2);
}

/**
 * Sort evidence by absolute weight (strongest first).
 */
function sortByImpact(evidence: IntentVote[]): IntentVote[] {
  return [...evidence].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}

/**
 * Group evidence into positive (supporting) and negative (suppressing).
 */
function partitionEvidence(evidence: IntentVote[]): {
  positive: IntentVote[];
  negative: IntentVote[];
} {
  const positive = evidence.filter((e) => e.weight > 0);
  const negative = evidence.filter((e) => e.weight < 0);
  return { positive, negative };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Format a full multi-line reasoning trace for a classification result.
 *
 * Example output:
 *   ┌─ Evidence Classification ─────────────────────────────
 *   │ Type:       Checkbox
 *   │ Intent:     toggle
 *   │ Confidence: 0.80
 *   │
 *   │ ── Supporting Evidence ──
 *   │   ✓ aria-checked          +0.80  Element has checkbox role or aria-checked attribute
 *   │   ✓ checked-transition   +0.60  Click captured a checked-state change
 *   │   ✓ class-checkbox        +0.20  Element CSS class suggests checkbox/filter pattern
 *   │
 *   │ ── Suppressing Evidence ──
 *   │   ✗ class-checkbox        -0.20  Checkbox-like CSS class suppresses navigation intent
 *   │
 *   │ ── Competing Intents ──
 *   │   toggle:    +0.80 ← WINNER
 *   │   navigate:  +0.20  (tag-anchor +0.40, class-checkbox -0.20)
 *   │
 *   │ Runner-up: navigate (score: 0.20, margin: 0.60)
 *   └───────────────────────────────────────────────────────
 *
 * @param result The classification result to format
 * @returns Multi-line human-readable reasoning trace
 */
export function formatReasoningTrace(result: EvidenceClassification): string {
  const lines: string[] = [];
  const indent = '  ';
  const divider = '─'.repeat(55);

  // Header
  lines.push(`┌─ Evidence Classification ${divider.slice(0, 33)}`);
  lines.push(`${indent}Type:       ${result.type}`);
  lines.push(`${indent}Intent:     ${result.intent}`);
  lines.push(`${indent}Confidence: ${result.confidence.toFixed(2)}`);
  lines.push('');

  // Partition evidence
  const { positive, negative } = partitionEvidence(result.evidence);
  const sortedPositive = sortByImpact(positive);
  const sortedNegative = sortByImpact(negative);

  // Supporting evidence
  if (sortedPositive.length > 0) {
    lines.push(`${indent}── Supporting Evidence ──`);
    for (const e of sortedPositive) {
      lines.push(`${indent}  ✓ ${e.source.padEnd(24)} ${formatWeight(e.weight)}  ${e.reason}`);
    }
    lines.push('');
  }

  // Suppressing evidence
  if (sortedNegative.length > 0) {
    lines.push(`${indent}── Suppressing Evidence ──`);
    for (const e of sortedNegative) {
      lines.push(`${indent}  ✗ ${e.source.padEnd(24)} ${formatWeight(e.weight)}  ${e.reason}`);
    }
    lines.push('');
  }

  // Intent score breakdown
  const scores = aggregateScores(result.evidence);
  lines.push(`${indent}── Intent Scores ──`);
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  for (const [intent, score] of ranked) {
    const isWinner = intent === result.intent;
    const marker = isWinner ? ' ← WINNER' : '';
    lines.push(`${indent}  ${intent.padEnd(12)} ${formatWeight(score)}${marker}`);
  }

  // Runner-up
  if (result.confidence > 0 && ranked.length > 1) {
    const runnerUpIntent = ranked[1][0];
    const runnerUpScore = ranked[1][1];
    const winnerScore = ranked[0][1];
    const margin = winnerScore - runnerUpScore;
    lines.push('');
    lines.push(`${indent}Runner-up: ${runnerUpIntent} (score: ${runnerUpScore.toFixed(2)}, margin: ${margin.toFixed(2)})`);
  }

  lines.push(`└${divider}`);
  return lines.join('\n');
}

/**
 * Format a compact one-line summary of a classification result.
 *
 * Example: "Checkbox (toggle, conf=0.80) [aria-checked +0.80, checked-transition +0.60, tag-anchor -0.20]"
 *
 * @param result The classification result
 * @param maxSources Maximum number of evidence sources to show (default 5)
 * @returns One-line summary string
 */
export function formatCompact(result: EvidenceClassification, maxSources = 5): string {
  const sorted = sortByImpact(result.evidence).slice(0, maxSources);
  const evidenceStr = sorted
    .map((e) => `${e.source} ${formatWeight(e.weight)}`)
    .join(', ');

  const parts = [
    `${result.type}`,
    `(${result.intent}, conf=${result.confidence.toFixed(2)})`,
  ];
  if (evidenceStr) {
    parts.push(`[${evidenceStr}]`);
  }
  return parts.join(' ');
}

/**
 * Aggregate evidence weights by intent.
 *
 * @param evidence All evidence votes
 * @returns Map of intent → total score
 */
function aggregateScores(evidence: IntentVote[]): Map<SemanticIntent, number> {
  const scores = new Map<SemanticIntent, number>();
  for (const e of evidence) {
    scores.set(e.intent, (scores.get(e.intent) ?? 0) + e.weight);
  }
  return scores;
}

/**
 * Get the full intent score breakdown for a classification result.
 *
 * Useful for programmatic analysis — returns all intents with their
 * total scores, the winner, runner-up, and victory margin.
 *
 * @param evidence All evidence votes
 * @returns Structured score analysis
 */
export function getScoreBreakdown(evidence: IntentVote[]): {
  ranked: Array<{ intent: SemanticIntent; score: number; evidenceCount: number }>;
  winner: SemanticIntent | null;
  winnerScore: number;
  runnerUp: { intent: SemanticIntent; score: number } | null;
  margin: number;
} {
  const scores = aggregateScores(evidence);
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([intent, score]) => ({
      intent,
      score,
      evidenceCount: evidence.filter((e) => e.intent === intent).length,
    }));

  if (ranked.length === 0) {
    return {
      ranked: [],
      winner: null,
      winnerScore: 0,
      runnerUp: null,
      margin: 0,
    };
  }

  const winner = ranked[0].intent;
  const winnerScore = ranked[0].score;
  const runnerUp = ranked.length > 1
    ? { intent: ranked[1].intent, score: ranked[1].score }
    : null;
  const margin = runnerUp ? winnerScore - runnerUp.score : winnerScore;

  return { ranked, winner, winnerScore, runnerUp, margin };
}
