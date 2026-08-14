/**
 * Form-Submit pagehide survival — spec T7
 *
 * The Amazon fast form-submit case: click → <500ms → pagehide.
 * The OLD rule (open >500ms OR lifecycle-bound) silently abandoned these
 * windows, so the click interaction got no evidence and stamped requests
 * had nothing to join to.
 *
 * NEW rule (INV-4): ALL open ACTION windows are finalized at pagehide with
 * endReason 'page-reload', carrying sourceEventId + identity — age is never
 * a criterion. Zero-signal NON-action windows (scroll) are dropped.
 *
 * Spec: .drytis/specs/form-submit-evidence-recovery.md
 */

import { describe, it, expect } from 'vitest';
import type { EvidenceCollector } from '../../src/tap/evidence-collector';

/**
 * The pagehide decision is a pure content+type rule — extract and test it
 * directly (the collector's onPageHide consumes it). These tests encode the
 * contract the collector wiring must implement.
 */
import {
  ACTION_WINDOW_EVENT_TYPES,
  finalizeAtPagehide,
} from '../../src/tap/evidence-collector';

interface FakeWindow {
  windowId: string;
  sourceEventId: string;
  sourceEventType: string;
  openedAt: number;
  isClosed: boolean;
  isLifecycleBound: boolean;
  isNavigationWindow: boolean;
  navEvents: unknown[];
}

function makeWindow(opts: Partial<FakeWindow> = {}): FakeWindow {
  return {
    windowId: 'ev-evt-1',
    sourceEventId: 'evt-1',
    sourceEventType: 'click',
    openedAt: 0,
    isClosed: false,
    isLifecycleBound: false,
    isNavigationWindow: false,
    navEvents: [],
    ...opts,
  };
}

describe('T7: pagehide survival (INV-4)', () => {
  it('a 120ms non-lifecycle CLICK window is finalized — age is never a criterion', () => {
    const win = makeWindow({
      sourceEventType: 'click',
      openedAt: 0,
      isLifecycleBound: false, // LIFECYCLE_BOUND hadn't arrived yet
    });
    const now = 120; // pagehide 120ms after open — OLD rule abandoned this

    const decision = finalizeAtPagehide(win as never, now);
    expect(decision.finalize).toBe(true);
    expect(decision.endReason).toBe('page-reload');
  });

  it('a 40ms non-lifecycle click window is ALSO finalized — no minimum age', () => {
    const win = makeWindow({ sourceEventType: 'click', openedAt: 0 });
    const decision = finalizeAtPagehide(win as never, 40);
    expect(decision.finalize).toBe(true);
    expect(decision.endReason).toBe('page-reload');
  });

  it('a zero-signal scroll window is dropped', () => {
    const win = makeWindow({ sourceEventType: 'scroll', openedAt: 0 });
    const decision = finalizeAtPagehide(win as never, 800);
    expect(decision.finalize).toBe(false);
  });

  it('a scroll window WITH signal (navEvents) is finalized', () => {
    const win = makeWindow({
      sourceEventType: 'scroll',
      openedAt: 0,
      navEvents: [{ type: 'link', fromUrl: 'https://a/', toUrl: 'https://b/' }],
    });
    const decision = finalizeAtPagehide(win as never, 300);
    expect(decision.finalize).toBe(true);
    expect(decision.endReason).toBe('page-reload');
  });

  it('a keydown window is an action window', () => {
    expect(ACTION_WINDOW_EVENT_TYPES.has('click')).toBe(true);
    expect(ACTION_WINDOW_EVENT_TYPES.has('keydown')).toBe(true);
    expect(ACTION_WINDOW_EVENT_TYPES.has('change')).toBe(true);
    expect(ACTION_WINDOW_EVENT_TYPES.has('contextmenu')).toBe(true);
    expect(ACTION_WINDOW_EVENT_TYPES.has('scroll')).toBe(false);
    expect(ACTION_WINDOW_EVENT_TYPES.has('navigation')).toBe(false);
  });

  it('closed windows are untouched', () => {
    const win = makeWindow({ isClosed: true });
    const decision = finalizeAtPagehide(win as never, 999);
    expect(decision.finalize).toBe(false);
  });

  it('lifecycle-bound windows finalize (unchanged from old behavior)', () => {
    const win = makeWindow({ sourceEventType: 'click', isLifecycleBound: true });
    const decision = finalizeAtPagehide(win as never, 10);
    expect(decision.finalize).toBe(true);
    expect(decision.endReason).toBe('page-reload');
  });
});

// Compile-time reference guard: the collector must expose these exports.
// (Runtime behavior is covered above; the import binds the contract.)
export type { EvidenceCollector };
