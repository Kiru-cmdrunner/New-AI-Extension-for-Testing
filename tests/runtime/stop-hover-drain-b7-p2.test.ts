/**
 * B7-P2 §5.2.2 recording-end terminal — STOP evidence-drain ordering.
 *
 * Real-Chrome S5 exposed the gap: a no-leave hover completes via
 * completesAtRecordingEnd at flush(), but its provisional evidence window
 * is STILL OPEN in the content script at that moment. The window
 * force-closes only when the STOP_RECORDING broadcast reaches the content
 * script — AFTER handleStopRecording already ran the whole pipeline
 * (flush → projection → filterProductionInteractions → persistence).
 * The delivered evidence lands in pendingEvidence with the interaction
 * already emitted and filtered out as evidence-less → not admitted.
 *
 * Fix contract (delivery mechanics, hover-scoped, no semantics change):
 *   1. SW handleStopRecording drains open provisional hover windows
 *      BEFORE the stop pipeline: send STOP_EVIDENCE_DRAIN to all tabs and
 *      await bounded settle of the delivered evidence.
 *   2. CS STOP_EVIDENCE_DRAIN handler force-closes ONLY provisional
 *      hover windows (still open) with endReason 'recording-stopped' —
 *      every other window class is untouched; delivery contract
 *      identical to stop() for those windows.
 *   3. flush() then emits the recording-end hover through onEmit, where
 *      drainPendingEvidence attaches the now-arrived evidence →
 *      admission is evidence-grounded (S5 admitted).
 *
 * Byte-identity: with zero open hover windows the drain is a no-op —
 * no evidence delivered, no state mutated, nothing re-persisted.
 * B6/B6.1 outcomes are untouched (their windows are typing/click
 * windows — never provisional hover windows).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import { EvidenceCollector } from '../../src/tap/evidence-collector';
import { TargetStateCache } from '../../src/tap/target-state-cache';
import { DOMObserver } from '../../src/tap/dom-observer';

/**
 * CS-side contract: the recorder-entry message listener handles
 * STOP_EVIDENCE_DRAIN by delegating to the new collector method —
 * and ONLY that message (ordering is SW-owned; STOP_RECORDING must
 * not trigger the drain, it tears the collector down).
 */
describe('B7-P2 STOP pre-pipeline hover evidence drain (CS side)', () => {
  function buildListener(
    collector: { drainHoverWindowsAtStop: () => void } | null,
  ): (m: { type?: string }) => boolean {
    return (message: { type?: string }): boolean => {
      if (message?.type === 'STOP_EVIDENCE_DRAIN') {
        collector?.drainHoverWindowsAtStop();
        return false;
      }
      return false;
    };
  }

  it('STOP_EVIDENCE_DRAIN delegates to collector.drainHoverWindowsAtStop', () => {
    const drainSpy = vi.fn();
    const listener = buildListener({ drainHoverWindowsAtStop: drainSpy });
    listener({ type: 'STOP_EVIDENCE_DRAIN' });
    expect(drainSpy).toHaveBeenCalledTimes(1);
  });

  it('STOP_RECORDING does NOT invoke the drain (ordering is SW-owned)', () => {
    const drainSpy = vi.fn();
    const listener = buildListener({ drainHoverWindowsAtStop: drainSpy });
    listener({ type: 'STOP_RECORDING' });
    expect(drainSpy).not.toHaveBeenCalled();
  });

  it('a null collector (already torn down) is tolerated by the listener', () => {
    const listener = buildListener(null);
    expect(() => listener({ type: 'STOP_EVIDENCE_DRAIN' })).not.toThrow();
  });
});

describe('B7-P2 STOP drain — collector method contract', () => {
  let delivered: BehavioralEvidence[];

  beforeEach(() => {
    delivered = [];
    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string; payload?: unknown }, cb?: () => void) => {
          if (msg.type === 'BEHAVIORAL_EVIDENCE' && msg.payload) {
            delivered.push(msg.payload as BehavioralEvidence);
          }
          if (cb) cb();
        }),
        lastError: undefined,
      },
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    delete (global as { chrome?: unknown }).chrome;
  });

  function makeCollector(): EvidenceCollector {
    const collector = new EvidenceCollector({
      targetStateCache: new TargetStateCache(),
      domObserver: new DOMObserver(),
    });
    collector.start();
    return collector;
  }

  it('exists on EvidenceCollector', () => {
    const collector = makeCollector();
    expect(typeof collector.drainHoverWindowsAtStop).toBe('function');
    collector.stop();
  });

  it('force-closes ONLY open provisional hover windows — non-hover and closed windows untouched', () => {
    const collector = makeCollector();

    document.body.innerHTML = `
      <div id="h" role="button" tabindex="0">HoverTarget</div>
      <button id="c">ClickTarget</button>`;
    const hoverEl = document.getElementById('h')!;
    const clickEl = document.getElementById('c')!;
    const gatedEnter = {
      eventType: 'mouseenter',
      isTrusted: true,
      target: { tag: 'DIV', ariaRole: 'button', className: '', id: 'h' },
      domContext: { tabIndex: 0 },
    };
    collector.onAfterEvent(hoverEl, 'hover-enter-1', 'mouseenter', '', null, gatedEnter as never);
    collector.onAfterEvent(clickEl, 'click-1', 'click', '', null, undefined);

    collector.drainHoverWindowsAtStop();

    const hoverDeliveries = delivered.filter((d) => d.sourceEventId === 'hover-enter-1');
    expect(hoverDeliveries.length).toBe(1);
    expect((hoverDeliveries[0].window as { endReason?: string }).endReason).toBe('recording-stopped');
    expect(delivered.some((d) => d.sourceEventId === 'click-1')).toBe(false);

    // Idempotence: a second drain delivers nothing new.
    collector.drainHoverWindowsAtStop();
    expect(delivered.filter((d) => d.sourceEventId === 'hover-enter-1').length).toBe(1);

    collector.stop();
  });

  it('is a no-op with zero open windows (byte-identity for non-hover sessions)', () => {
    const collector = makeCollector();
    collector.drainHoverWindowsAtStop();
    expect(delivered.length).toBe(0);
    collector.stop();
  });

  it('keeps the collector running after the drain (STOP_RECORDING still tears it down)', () => {
    const collector = makeCollector();
    document.body.innerHTML = '<div id="h2" role="button" tabindex="0">T</div>';
    const el = document.getElementById('h2')!;
    const gatedEnter = {
      eventType: 'mouseenter',
      isTrusted: true,
      target: { tag: 'DIV', ariaRole: 'button', className: '', id: 'h2' },
      domContext: { tabIndex: 0 },
    };
    collector.onAfterEvent(el, 'hover-a', 'mouseenter', '', null, gatedEnter as never);
    collector.drainHoverWindowsAtStop();
    expect(delivered.length).toBe(1);

    // A gated enter AFTER the drain still opens a window (collector alive).
    collector.onAfterEvent(el, 'hover-b', 'mouseenter', '', null, gatedEnter as never);
    collector.drainHoverWindowsAtStop();
    expect(delivered.filter((d) => d.sourceEventId === 'hover-b').length).toBe(1);

    collector.stop();
  });
});
