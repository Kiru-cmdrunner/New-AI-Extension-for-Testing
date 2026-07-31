/**
 * Unit tests for the developer diagnostics module.
 *
 * Tests formatReasoningTrace, formatCompact, and getScoreBreakdown.
 */

import { describe, it, expect } from 'vitest';
import { formatReasoningTrace, formatCompact, getScoreBreakdown } from '../src/classifier/evidence/diagnostics';
import type { IntentVote } from '../src/classifier/evidence/types';
import type { EvidenceClassification } from '../src/classifier/evidence/evidence-classifier';

// ── Test Helpers ─────────────────────────────────────────────────────────

function makeVote(intent: IntentVote['intent'], weight: number, source: string, reason = ''): IntentVote {
  return { intent, weight, source, reason };
}

function makeClassification(overrides: Partial<EvidenceClassification> = {}): EvidenceClassification {
  return {
    type: 'Checkbox',
    metadata: {},
    confidence: 0.8,
    intent: 'toggle',
    evidence: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────

describe('Diagnostics — formatReasoningTrace', () => {
  it('produces a multi-line trace with all sections', () => {
    const result = makeClassification({
      type: 'Checkbox',
      intent: 'toggle',
      confidence: 0.8,
      evidence: [
        makeVote('toggle', 0.8, 'aria-checked', 'Element has checkbox role'),
        makeVote('toggle', 0.6, 'checked-transition', 'Checked state changed'),
        makeVote('navigate', -0.2, 'class-checkbox', 'Checkbox class suppresses nav'),
      ],
    });
    const trace = formatReasoningTrace(result);

    // Header
    expect(trace).toContain('Evidence Classification');
    expect(trace).toContain('Type:       Checkbox');
    expect(trace).toContain('Intent:     toggle');
    expect(trace).toContain('Confidence: 0.80');

    // Supporting evidence
    expect(trace).toContain('Supporting Evidence');
    expect(trace).toContain('aria-checked');
    expect(trace).toContain('+0.80');
    expect(trace).toContain('checked-transition');
    expect(trace).toContain('+0.60');

    // Suppressing evidence
    expect(trace).toContain('Suppressing Evidence');
    expect(trace).toContain('-0.20');

    // Winner marker
    expect(trace).toContain('WINNER');

    // Runner-up
    expect(trace).toContain('Runner-up');
    expect(trace).toContain('navigate');
  });

  it('handles empty evidence gracefully', () => {
    const result = makeClassification({
      type: 'Click',
      intent: 'trigger',
      confidence: 0,
      evidence: [],
    });
    const trace = formatReasoningTrace(result);
    expect(trace).toContain('Type:       Click');
    expect(trace).toContain('Intent:     trigger');
    expect(trace).toContain('Confidence: 0.00');
    // No supporting/suppressing sections
    expect(trace).not.toContain('Supporting Evidence');
  });

  it('handles only positive evidence (no suppressing)', () => {
    const result = makeClassification({
      type: 'Link',
      intent: 'navigate',
      confidence: 0.4,
      evidence: [makeVote('navigate', 0.4, 'tag-anchor', 'Anchor tag')],
    });
    const trace = formatReasoningTrace(result);
    expect(trace).toContain('Supporting Evidence');
    expect(trace).not.toContain('Suppressing Evidence');
  });

  it('handles only negative evidence', () => {
    const result = makeClassification({
      type: 'Click',
      intent: 'trigger',
      confidence: 0,
      evidence: [makeVote('navigate', -0.2, 'class-checkbox', 'Suppresses navigate')],
    });
    const trace = formatReasoningTrace(result);
    expect(trace).toContain('Suppressing Evidence');
    // navigate score is -0.2, trigger has no votes (default fallback)
    expect(trace).toContain('navigate');
    expect(trace).toContain('-0.20');
  });

  it('shows intent score breakdown', () => {
    const result = makeClassification({
      type: 'Checkbox',
      intent: 'toggle',
      confidence: 0.8,
      evidence: [
        makeVote('toggle', 0.8, 'aria-checked'),
        makeVote('navigate', 0.4, 'tag-anchor'),
        makeVote('navigate', -0.2, 'class-checkbox'),
      ],
    });
    const trace = formatReasoningTrace(result);
    expect(trace).toContain('Intent Scores');
    expect(trace).toContain('toggle');
    expect(trace).toContain('navigate');
    expect(trace).toContain('+0.80');
    expect(trace).toContain('+0.20');
  });

  it('shows victory margin in runner-up', () => {
    const result = makeClassification({
      type: 'Checkbox',
      intent: 'toggle',
      confidence: 0.6,
      evidence: [
        makeVote('toggle', 0.6, 'checked-transition'),
        makeVote('navigate', 0.4, 'tag-anchor'),
      ],
    });
    const trace = formatReasoningTrace(result);
    expect(trace).toContain('margin: 0.20');
  });
});

describe('Diagnostics — formatCompact', () => {
  it('produces a one-line summary with type, intent, confidence, and evidence', () => {
    const result = makeClassification({
      type: 'Checkbox',
      intent: 'toggle',
      confidence: 0.8,
      evidence: [
        makeVote('toggle', 0.8, 'aria-checked'),
        makeVote('toggle', 0.6, 'checked-transition'),
      ],
    });
    const compact = formatCompact(result);
    expect(compact).toContain('Checkbox');
    expect(compact).toContain('toggle');
    expect(compact).toContain('conf=0.80');
    expect(compact).toContain('aria-checked');
    expect(compact).toContain('+0.80');
  });

  it('limits evidence sources to maxSources', () => {
    const result = makeClassification({
      type: 'Checkbox',
      intent: 'toggle',
      confidence: 0.8,
      evidence: [
        makeVote('toggle', 0.8, 'src1'),
        makeVote('toggle', 0.6, 'src2'),
        makeVote('toggle', 0.4, 'src3'),
        makeVote('navigate', 0.2, 'src4'),
        makeVote('navigate', -0.1, 'src5'),
        makeVote('navigate', -0.05, 'src6'),
      ],
    });
    const compact = formatCompact(result, 3);
    // Should only show top 3 sources
    const sourceCount = (compact.match(/\+/g) || []).length;
    expect(sourceCount).toBeLessThanOrEqual(3);
  });

  it('handles empty evidence', () => {
    const result = makeClassification({
      type: 'Click',
      intent: 'trigger',
      confidence: 0,
      evidence: [],
    });
    const compact = formatCompact(result);
    expect(compact).toContain('Click');
    expect(compact).toContain('trigger');
    expect(compact).toContain('conf=0.00');
  });

  it('shows negative weights', () => {
    const result = makeClassification({
      type: 'Checkbox',
      intent: 'toggle',
      confidence: 0.8,
      evidence: [
        makeVote('toggle', 0.8, 'aria-checked'),
        makeVote('navigate', -0.2, 'class-checkbox'),
      ],
    });
    const compact = formatCompact(result);
    expect(compact).toContain('-0.20');
  });
});

describe('Diagnostics — getScoreBreakdown', () => {
  it('returns ranked intents with scores and evidence counts', () => {
    const evidence = [
      makeVote('toggle', 0.8, 'aria-checked'),
      makeVote('toggle', 0.6, 'checked-transition'),
      makeVote('navigate', 0.4, 'tag-anchor'),
    ];
    const breakdown = getScoreBreakdown(evidence);

    expect(breakdown.ranked).toHaveLength(2);
    expect(breakdown.ranked[0].intent).toBe('toggle');
    expect(breakdown.ranked[0].score).toBe(1.4);
    expect(breakdown.ranked[0].evidenceCount).toBe(2);
    expect(breakdown.ranked[1].intent).toBe('navigate');
    expect(breakdown.ranked[1].score).toBe(0.4);
    expect(breakdown.ranked[1].evidenceCount).toBe(1);
  });

  it('returns winner and winnerScore', () => {
    const evidence = [
      makeVote('toggle', 0.8, 'aria-checked'),
      makeVote('navigate', 0.4, 'tag-anchor'),
    ];
    const breakdown = getScoreBreakdown(evidence);
    expect(breakdown.winner).toBe('toggle');
    expect(breakdown.winnerScore).toBe(0.8);
  });

  it('returns runnerUp when there are multiple intents', () => {
    const evidence = [
      makeVote('toggle', 0.8, 'aria-checked'),
      makeVote('navigate', 0.4, 'tag-anchor'),
    ];
    const breakdown = getScoreBreakdown(evidence);
    expect(breakdown.runnerUp).not.toBeNull();
    expect(breakdown.runnerUp!.intent).toBe('navigate');
    expect(breakdown.runnerUp!.score).toBe(0.4);
  });

  it('returns null runnerUp when single intent', () => {
    const evidence = [makeVote('toggle', 0.8, 'aria-checked')];
    const breakdown = getScoreBreakdown(evidence);
    expect(breakdown.runnerUp).toBeNull();
  });

  it('calculates margin between winner and runner-up', () => {
    const evidence = [
      makeVote('toggle', 0.8, 'aria-checked'),
      makeVote('navigate', 0.4, 'tag-anchor'),
    ];
    const breakdown = getScoreBreakdown(evidence);
    expect(breakdown.margin).toBeCloseTo(0.4);
  });

  it('handles empty evidence', () => {
    const breakdown = getScoreBreakdown([]);
    expect(breakdown.ranked).toHaveLength(0);
    expect(breakdown.winner).toBeNull();
    expect(breakdown.winnerScore).toBe(0);
    expect(breakdown.runnerUp).toBeNull();
    expect(breakdown.margin).toBe(0);
  });

  it('handles negative scores', () => {
    const evidence = [
      makeVote('navigate', 0.4, 'tag-anchor'),
      makeVote('navigate', -0.2, 'class-checkbox'),
    ];
    const breakdown = getScoreBreakdown(evidence);
    expect(breakdown.winner).toBe('navigate');
    expect(breakdown.winnerScore).toBeCloseTo(0.2);
    expect(breakdown.runnerUp).toBeNull();
  });
});
