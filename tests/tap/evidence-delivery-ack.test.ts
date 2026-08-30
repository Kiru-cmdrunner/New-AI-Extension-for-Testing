/**
 * Amendment A §17 — behavioral tests: ACK-based drain + identity companions.
 *
 * Same harness shape as stop-hover-drain-b7-p2.test.ts: real
 * EvidenceCollector, real TargetStateCache/DOMObserver, mocked
 * chrome.runtime channel with an ACK callback we control.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';

let delivered: BehavioralEvidence[];
let ackDelayMs: number;
let ackMode: 'ok' | 'throw' | 'no-response';

function gatedEnter(target: { tag: string; ariaRole: string; className: string; id: string }) {
  return {
    eventType: 'mouseenter',
    isTrusted: true,
    target,
    domContext: { tabIndex: 0 },
  };
}

function installChrome() {
  delivered = [];
  ackDelayMs = 0;
  ackMode = 'ok';
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage: vi.fn(
        (
          msg: { type: string; payload?: unknown },
          cb?: (response: { ok: boolean; attached?: string } | undefined) => void,
        ) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            delivered.push(msg.payload as BehavioralEvidence);
          }
          if (ackMode === 'throw') throw new Error('channel gone');
          if (cb) {
            if (ackDelayMs > 0) setTimeout(() => cb({ ok: true, attached: 'pending' }), ackDelayMs);
            else cb({ ok: true, attached: 'pending' });
          }
        },
      ),
      lastError: undefined,
    },
  } as unknown as typeof chrome;
}

function makeCollector(): EvidenceCollector {
  const collector = new EvidenceCollector({
    targetStateCache: new TargetStateCache(),
    domObserver: new DOMObserver(),
  });
  collector.start();
  return collector;
}

const GATED_A = { tag: 'DIV', ariaRole: 'button', className: '', id: 'a' };
const GATED_B = { tag: 'DIV', ariaRole: 'button', className: '', id: 'b' };

describe('Amendment A — P1/P2 ACK-based drain (collector behavioral)', () => {
  beforeEach(installChrome);
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
    sessionStorage.removeItem('cmdrunner_evidence_buffer');
  });

  it('drain resolves only after the delivery ACK arrives (slow channel, no clock)', async () => {
    document.body.innerHTML = '<div id="a" role="button" tabindex="0">A</div>';
    const el = document.getElementById('a')!;
    const collector = makeCollector();
    collector.onAfterEvent(el, 'he-1', 'mouseenter', '', null, gatedEnter(GATED_A) as never);
    await new Promise((r) => setTimeout(r, 30));

    ackDelayMs = 250; // SLOW SW: ACK arrives a quarter-second later
    let acked = false;
    const drained = collector.drainHoverWindowsAtStop().then((n) => { acked = true; return n; });
    await new Promise((r) => setTimeout(r, 80));
    expect(acked).toBe(false); // still waiting — resolution tracks the ACK, not time
    const n = await drained;
    expect(acked).toBe(true);
    expect(n).toBe(1);
    expect(delivered.filter((d) => d.sourceEventId === 'he-1').length).toBe(1);
    collector.stop();
  }, 10_000);

  it('a failed ACK still leaves the evidence in the page buffer (R-ED2)', async () => {
    document.body.innerHTML = '<div id="a" role="button" tabindex="0">A</div>';
    const el = document.getElementById('a')!;
    const collector = makeCollector();
    collector.onAfterEvent(el, 'he-2', 'mouseenter', '', null, gatedEnter(GATED_A) as never);
    await new Promise((r) => setTimeout(r, 30));

    ackMode = 'throw'; // channel dead
    const n = await collector.drainHoverWindowsAtStop();
    expect(n).toBe(0); // nothing ACKed
    const buf = JSON.parse(sessionStorage.getItem('cmdrunner_evidence_buffer') ?? '[]');
    expect(buf.some((e: { sourceEventId?: string }) => e.sourceEventId === 'he-2')).toBe(true);
    collector.stop();
  });
});

describe('Amendment A — P3 companion identity (collector behavioral)', () => {
  beforeEach(installChrome);
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
    sessionStorage.removeItem('cmdrunner_evidence_buffer');
  });

  it('a DIFFERENT-anchor click immediately after a finalize is NOT suppressed (AC-ED3)', async () => {
    document.body.innerHTML = `
      <div id="a" role="button" tabindex="0">A</div>
      <button id="b" type="button">B</button>`;
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    const collector = makeCollector();

    collector.onAfterEvent(a, 'he-a', 'mouseenter', '', null, gatedEnter(GATED_A) as never);
    await new Promise((r) => setTimeout(r, 20));
    collector.handleLifecycleBound({ lifecycleId: 'lc-1', triggerEventId: 'he-a', interactionType: 'Hover', metadata: {} });
    collector.finalizeForInteraction({ lifecycleId: 'lc-1', interactionId: 'i-1', interactionType: 'Hover', eventIds: ['he-a'], metadata: {}, endState: 'completed' });
    // Click on a DIFFERENT anchor — zero milliseconds later.
    collector.onAfterEvent(b, 'clk-b', 'click', '', null, undefined);
    await new Promise((r) => setTimeout(r, 20));

    await collector.drainHoverWindowsAtStop();
    collector.stop();
    expect(delivered.filter((d) => d.sourceEventId === 'clk-b').length).toBe(1);
  });

  it('SAME anchor + same batch click after finalize IS suppressed (AC-ED4)', async () => {
    document.body.innerHTML = `<div id="a" role="button" tabindex="0">A</div>`;
    const a = document.getElementById('a')!;
    const collector = makeCollector();

    collector.onAfterEvent(a, 'he-a', 'mouseenter', '', null, gatedEnter(GATED_A) as never);
    await new Promise((r) => setTimeout(r, 20));
    collector.handleLifecycleBound({ lifecycleId: 'lc-2', triggerEventId: 'he-a', interactionType: 'Hover', metadata: {} });
    collector.finalizeForInteraction({ lifecycleId: 'lc-2', interactionId: 'i-2', interactionType: 'Hover', eventIds: ['he-a'], metadata: {}, endState: 'completed' });
    // Click on the SAME anchor in the same DOM batch (no mutation between).
    collector.onAfterEvent(a, 'clk-a', 'click', '', null, undefined);
    await new Promise((r) => setTimeout(r, 20));

    await collector.drainHoverWindowsAtStop();
    collector.stop();
    expect(delivered.filter((d) => d.sourceEventId === 'clk-a').length).toBe(0);
  });
});
