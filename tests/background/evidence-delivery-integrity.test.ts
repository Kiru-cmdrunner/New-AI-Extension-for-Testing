/**
 * Amendment A §17 — Evidence Delivery Integrity pins (source-level).
 *
 * D-EDI: no timing-based correctness anywhere. These pins verify the
 * STRUCTURE of the delivery/stop/suppression code — that wall-clock
 * deadlines no longer decide capture, ownership, suppression, or
 * admission, and that ACK handshakes replaced the 1500ms poll loop.
 *
 * Pinned by source-read (same pattern as recording-origin-wiring-7-0 and
 * m4c-stop-drain-liveness): importing the SW module would drag its whole
 * chrome-at-module-scope graph into the unit environment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SW = readFileSync('src/background/service-worker.ts', 'utf-8');
const CS = readFileSync('src/recorder/phase5/recorder-entry.ts', 'utf-8');
const COLLECTOR = readFileSync('src/tap/evidence-collector.ts', 'utf-8');

function bodyOf(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`${marker} not found`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${marker}`);
}

describe('Amendment A §17.2 — P2 ACK-based evidence delivery', () => {
  it('deliverEvidence awaits the sendMessage promise (no fire-and-forget)', () => {
    // Every BEHAVIORAL_EVIDENCE send in the collector must be awaited.
    const uses = COLLECTOR.split('BEHAVIORAL_EVIDENCE').length - 1;
    expect(uses).toBeGreaterThan(0);
    const fireAndForget = /chrome\.runtime\.sendMessage\(\s*\{\s*type:\s*'BEHAVIORAL_EVIDENCE'[^}]*\}\s*,\s*\(\)\s*=>\s*\{\s*\}\s*\)/;
    expect(COLLECTOR).not.toMatch(fireAndForget);
  });

  it('SW BEHAVIORAL_EVIDENCE handler responds with a structured ACK', () => {
    const handler = bodyOf(SW, "case 'BEHAVIORAL_EVIDENCE'");
    expect(handler).toMatch(/sendResponse\(\s*\{\s*ok:\s*true/);
  });
});

describe('Amendment A §17.3 — P1 closed-loop STOP drain', () => {
  it('drainHoverEvidenceBeforeStop has NO wall-clock deadline', () => {
    const body = bodyOf(SW, 'async function drainHoverEvidenceBeforeStop');
    expect(body).not.toMatch(/Date\.now\(\)/);
    expect(body).not.toMatch(/HOVER_EVIDENCE_SETTLE_MS/);
    expect(body).not.toMatch(/POLL_MS/);
  });

  it('drain awaits per-tab ACKs (sendMessage promise), not a poll loop', () => {
    const body = bodyOf(SW, 'async function drainHoverEvidenceBeforeStop');
    expect(body).toMatch(/sendMessage\([^)]*STOP_EVIDENCE_DRAIN/);
    expect(body).toMatch(/await Promise\.all/);
    expect(body).not.toMatch(/while\s*\(/);
  });

  it('the liveness guard is bounded, logged, and NOT the happy path', () => {
    const body = bodyOf(SW, 'async function drainHoverEvidenceBeforeStop');
    expect(body).toMatch(/console\.(error|warn)/);
    // guard must resolve via .catch/.finally on the channel promise — an
    // event signal (rejection), not a Date.now() deadline
    expect(body).toMatch(/\.catch\(/);
  });

  it('CS STOP_EVIDENCE_DRAIN handler responds AFTER draining (holds channel)', () => {
    const handler = bodyOf(CS, "message?.type === 'STOP_EVIDENCE_DRAIN'");
    expect(handler).toMatch(/sendResponse\(/);
    expect(handler).toMatch(/drainHoverWindowsAtStop/);
    // the listener must hold the channel open for the async response
    expect(CS.slice(CS.indexOf("message?.type === 'STOP_EVIDENCE_DRAIN'") - 400,
      CS.indexOf("message?.type === 'STOP_EVIDENCE_DRAIN'") + 1200))
      .toMatch(/return\s+true/);
  });
});

describe('Amendment A §17.4 — P3 identity-based companions', () => {
  // onAfterEvent body (the method's first occurrence is the signature)
  const onAfterBody = (() => {
    const start = COLLECTOR.indexOf('onAfterEvent(');
    const open = COLLECTOR.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < COLLECTOR.length; i++) {
      if (COLLECTOR[i] === '{') depth++;
      else if (COLLECTOR[i] === '}') {
        depth--;
        if (depth === 0) return COLLECTOR.slice(start, i + 1);
      }
    }
    throw new Error('unbalanced');
  })();

  it('companionSuppressUntil wall-clock suppression is GONE from onAfterEvent', () => {
    expect(onAfterBody).not.toMatch(/companionSuppressUntil/);
    expect(onAfterBody).not.toMatch(/Date\.now\(\)/);
  });

  it('suppression decision uses recorded anchor identity + batch ordinal', () => {
    expect(onAfterBody).toMatch(/isCompanionEvent\(/);
  });

  it('A-slice supersede uses identity/batch, not COMPANION_WINDOW_MS elapsed time', () => {
    const enter = COLLECTOR.indexOf('newerLiveClaimant');
    expect(enter).toBeGreaterThan(-1);
    const seg = COLLECTOR.slice(enter - 400, enter + 900);
    expect(seg).not.toMatch(/w\.openedAt\s*-\s*win\.openedAt\s*>=\s*COMPANION_WINDOW_MS/);
    expect(seg).toMatch(/isDistinctPhysicalAct|isCompanionWindow/);
  });

  it('COMPANION_WINDOW_MS no longer gates correctness (liveness/transport comment only)', () => {
    const mentions = COLLECTOR.split('COMPANION_WINDOW_MS').length - 1;
    expect(mentions).toBeLessThanOrEqual(1);
  });
});
