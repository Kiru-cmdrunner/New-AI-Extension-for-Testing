/**
 * M4c regression — STOP drains pending hover evidence LIVENESS-INDEPENDENTLY.
 *
 * Real-Chrome M4c: churn ON → Services reveal → mouseleave → immediate STOP
 * lost an ALREADY-EARNED evidenced hover. Root cause: the Hover lifecycle is
 * popped from the runtime stack at leave ('left' terminal), so the B7-P2
 * drain's liveness gate (hasLiveHoverLifecycle) returned false and the drain
 * was skipped — while the hover's provisional evidence window was still
 * parked in settle mode, its quiescence close deferred indefinitely by page
 * churn. The window delivered its qualification only at the STOP_RECORDING
 * teardown, AFTER admission had dropped the evidence-less card.
 *
 * Fix contract (delivery mechanics only — no qualification-model change):
 *   - handleStopRecording's drain must NOT return early when no Hover
 *     lifecycle is live: the drain round-trip is sent unconditionally, so
 *     leave-completed hovers' parked windows force-close and deliver their
 *     frozen capture-time verdict before the stop pipeline runs.
 *   - The liveness helper remains exported/usable (M4c amendment comment),
 *     but nothing may gate the pre-STOP drain on it.
 *
 * Pinned the same way the existing 7-0 wiring tests pin the SW: by reading
 * the actual source — a behavioral harness around the SW module would
 * re-import its whole graph (chrome.* at module scope).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SW = readFileSync('src/background/service-worker.ts', 'utf-8');

function bodyOf(fn: string): string {
  const start = SW.indexOf(`function ${fn}`);
  if (start === -1) throw new Error(`${fn} not found in service-worker.ts`);
  const open = SW.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SW.length; i++) {
    if (SW[i] === '{') depth++;
    else if (SW[i] === '}') {
      depth--;
      if (depth === 0) return SW.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${fn}`);
}

describe('M4c — STOP hover-evidence drain is liveness-independent', () => {
  it('drainHoverEvidenceBeforeStop does NOT gate on hasLiveHoverLifecycle', () => {
    const body = bodyOf('drainHoverEvidenceBeforeStop');
    expect(body).not.toMatch(/hasLiveHoverLifecycle\s*\(/);
  });

  it('drainHoverEvidenceBeforeStop still sends STOP_EVIDENCE_DRAIN to tabs', () => {
    const body = bodyOf('drainHoverEvidenceBeforeStop');
    expect(body).toContain('STOP_EVIDENCE_DRAIN');
  });

  it('handleStopRecording still drains BEFORE the stop pipeline runs', () => {
    const body = bodyOf('handleStopRecording');
    const drainIx = body.indexOf('await drainHoverEvidenceBeforeStop()');
    expect(drainIx).toBeGreaterThan(-1);
    const pipelineIx = body.indexOf('const allInteractions = stopRecording()');
    expect(pipelineIx).toBeGreaterThan(drainIx);
  });

  it('the dead liveness helper is fully removed (drain is liveness-independent)', () => {
    const src = SW;
    expect(src).not.toContain('function hasLiveHoverLifecycle');
  });
});
