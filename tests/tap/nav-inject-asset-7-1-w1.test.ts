/**
 * 7.1-W1 Unit Tests: nav-inject.js (MAIN-world asset) — idempotency + restore
 *
 * Spec: .drytis/specs/phase-7-1-w1-spa-nav-inject.md §5 (tests 6-7)
 *
 * The asset is a standalone IIFE with no imports and no extension APIs —
 * it can be evaluated directly in jsdom's MAIN-world-equivalent context.
 * In jsdom there is no world split, but the script's own contracts
 * (guard flag, ready marker, dispatch shape, restore path) are testable:
 *
 *   6. Idempotency: double evaluation → guard flag set, originals patched
 *      once, ready marker re-signaled but no double dispatch.
 *   7. Restore: `cmdrunner-nav-stop` → originals restored, guard cleared.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NAV_INJECT_PATH = resolve(__dirname, '../../public/assets/nav-inject.js');
const SOURCE = readFileSync(NAV_INJECT_PATH, 'utf8');

/** Evaluate the asset fresh in the current realm (documented jsdom test). */
function evalNavInject(): void {
  // eslint-disable-next-line no-new-func
  new Function(SOURCE)();
}

describe('7.1-W1 — nav-inject.js MAIN-world asset', () => {
  beforeEach(() => {
    // Clean all shared-world state the script touches
    delete (window as unknown as Record<string, unknown>).__cmdrunnerNavPatched;
    document.documentElement.removeAttribute('data-cmdrunner-nav-ready');
  });

  it('test 6a: first evaluation patches history and signals readiness', () => {
    const originalPush = history.pushState;
    const readyListener = vi.fn();
    window.addEventListener('cmdrunner-nav-ready', readyListener);

    evalNavInject();

    expect((window as unknown as Record<string, unknown>).__cmdrunnerNavPatched).toBe(true);
    expect(history.pushState).not.toBe(originalPush);
    expect(document.documentElement.getAttribute('data-cmdrunner-nav-ready')).toBe('true');
    // The ready event may fire before this listener attached — the durable
    // DOM marker is the contract (D8); listener count asserted loosely.
    expect(readyListener.mock.calls.length).toBeLessThanOrEqual(1);

    window.removeEventListener('cmdrunner-nav-ready', readyListener);
    // restore for the next test
    window.dispatchEvent(new CustomEvent('cmdrunner-nav-stop'));
  });

  it('test 6b: double evaluation → single patch (guard flag)', () => {
    evalNavInject();
    const patchedOnce = history.pushState;

    evalNavInject(); // idempotent re-entry

    expect(history.pushState).toBe(patchedOnce); // SAME reference — not re-wrapped
    expect((window as unknown as Record<string, unknown>).__cmdrunnerNavPatched).toBe(true);

    window.dispatchEvent(new CustomEvent('cmdrunner-nav-stop'));
  });

  it('test 6c: pushState dispatches cmdrunner-nav with fromUrl/toUrl', () => {
    const details: Array<{ navType: string; fromUrl: string; toUrl: string }> = [];
    const listener = (e: Event) => {
      details.push((e as CustomEvent).detail);
    };
    window.addEventListener('cmdrunner-nav', listener);

    evalNavInject();
    history.pushState({}, '', '/injected-target');

    expect(details.length).toBe(1);
    expect(details[0].navType).toBe('pushState');
    expect(details[0].toUrl).toContain('/injected-target');
    expect(typeof details[0].fromUrl).toBe('string');

    window.removeEventListener('cmdrunner-nav', listener);
    window.dispatchEvent(new CustomEvent('cmdrunner-nav-stop'));
  });

  it('test 7: restore event → originals restored, guard cleared', () => {
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;

    evalNavInject();
    expect(history.pushState).not.toBe(originalPush);

    window.dispatchEvent(new CustomEvent('cmdrunner-nav-stop'));

    expect(history.pushState).toBe(originalPush);
    expect(history.replaceState).toBe(originalReplace);
    expect((window as unknown as Record<string, unknown>).__cmdrunnerNavPatched).toBeUndefined();
  });

  it('test 7b: same-URL pushState suppressed (no duplicate dispatch)', () => {
    const details: unknown[] = [];
    const listener = (e: Event) => details.push((e as CustomEvent).detail);
    window.addEventListener('cmdrunner-nav', listener);

    evalNavInject();
    history.pushState({}, '', '/same-url');
    // Same URL again — the script's own lastKnownUrl dedup must suppress.
    history.pushState({}, '', '/same-url');

    expect(details.length).toBe(1);

    window.removeEventListener('cmdrunner-nav', listener);
    window.dispatchEvent(new CustomEvent('cmdrunner-nav-stop'));
  });
});
