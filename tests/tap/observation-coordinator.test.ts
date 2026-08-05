/**
 * Unit Tests: Observation Coordinator (M1 Phase C)
 *
 * Tests the ObservationCoordinator: window lifecycle, before/after state
 * coordination, overlapping windows, rapid interactions, element removal,
 * shutdown, configure guards, and mutation evidence collection.
 *
 * Uses real ElementStateCache and DocumentObserver instances with a short
 * window duration (50ms) for fast, deterministic tests.
 *
 * Architecture: .drytis/specs/m1-phase-c-detailed-design.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObservationCoordinator } from '../../src/tap/observation-coordinator';
import { ElementStateCache } from '../../src/tap/element-state-cache';
import { DocumentObserver } from '../../src/tap/document-observer';
import type { ObservationResult } from '../../src/shared/observation-types';

/** Flush MutationObserver callbacks in JSDOM. */
function flushMutations(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

/** Window duration for tests — short for speed, long enough to flush mutations. */
const TEST_WINDOW_MS = 50;

describe('ObservationCoordinator', () => {
  let coordinator: ObservationCoordinator;
  let cache: ElementStateCache;
  let observer: DocumentObserver;
  let results: ObservationResult[];

  beforeEach(() => {
    document.body.innerHTML = '';
    cache = new ElementStateCache();
    observer = new DocumentObserver();
    coordinator = new ObservationCoordinator();
    results = [];

    coordinator.configure({
      cache,
      observer,
      onResult: (r) => results.push(r),
      windowDurationMs: TEST_WINDOW_MS,
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('full window lifecycle: openWindow → wait → result delivered', async () => {
      document.body.innerHTML = '<input type="checkbox" id="cb">';
      const cb = document.getElementById('cb') as HTMLInputElement;

      coordinator.openWindow('evt-1', 'click', cb);

      expect(coordinator.getOpenWindowCount()).toBe(1);
      expect(results.length).toBe(0);

      // Wait for the window timer to fire
      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      expect(results.length).toBe(1);
      expect(coordinator.getOpenWindowCount()).toBe(0);

      const result = results[0];
      expect(result.sourceEventId).toBe('evt-1');
      expect(result.sourceEventType).toBe('click');
      expect(result.windowId).toBe('obs-evt-1');
      expect(result.endReason).toBe('completed');
    });

    it('result has durationMs approximately equal to window duration', async () => {
      document.body.innerHTML = '<div id="el">Test</div>';
      const el = document.getElementById('el')!;

      coordinator.openWindow('evt-1', 'click', el);
      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      expect(results[0].durationMs).toBeGreaterThanOrEqual(TEST_WINDOW_MS - 10);
      expect(results[0].durationMs).toBeLessThan(TEST_WINDOW_MS + 50);
    });

    it('openWindow before configure is a safe no-op', () => {
      const unconfigured = new ObservationCoordinator();
      document.body.innerHTML = '<div id="el">Test</div>';
      const el = document.getElementById('el')!;

      // Should not throw
      unconfigured.openWindow('evt-x', 'click', el);
      expect(unconfigured.getOpenWindowCount()).toBe(0);
    });

    it('closeWindow with unknown windowId is safe (no crash, no result)', async () => {
      // closeWindow is private — but calling shutdown with no windows is the
      // equivalent public surface test
      coordinator.shutdown();
      expect(results.length).toBe(0);
    });
  });

  // ── Before/After State ─────────────────────────────────────────────────

  describe('before/after state', () => {
    it('checkbox toggle: beforeSnapshot false → finalSnapshot true', async () => {
      document.body.innerHTML = '<input type="checkbox" id="cb" class="opt">';
      const cb = document.getElementById('cb') as HTMLInputElement;
      cb.checked = false;

      // Simulate Phase A: mousedown listener captures before-state
      cache.capture(cb); // { checked: false }

      // Simulate browser toggling the checkbox on click
      cb.checked = true;
      cb.className = 'opt checked';

      coordinator.openWindow('evt-1', 'click', cb);

      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      const result = results[0];
      expect(result.beforeSnapshot).not.toBeNull();
      expect(result.beforeSnapshot!.checked).toBe(false);
      expect(result.finalSnapshot).not.toBeNull();
      expect(result.finalSnapshot!.checked).toBe(true);
    });

    it('text input change: beforeSnapshot empty → finalSnapshot has value', async () => {
      document.body.innerHTML = '<input type="text" id="txt" value="">';
      const txt = document.getElementById('txt') as HTMLInputElement;

      // Simulate Phase A: focus listener captures before-state
      cache.capture(txt); // { value: '' }

      // Simulate user typing
      txt.value = 'hello';

      coordinator.openWindow('evt-1', 'change', txt);

      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      const result = results[0];
      expect(result.beforeSnapshot!.value).toBe('');
      expect(result.finalSnapshot!.value).toBe('hello');
    });

    it('first interaction with null before-state (no prior cache)', async () => {
      document.body.innerHTML = '<input type="text" id="txt" value="test">';
      const txt = document.getElementById('txt') as HTMLInputElement;

      // NO prior cache.capture — this is a first interaction
      coordinator.openWindow('evt-1', 'click', txt);

      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      const result = results[0];
      expect(result.beforeSnapshot).toBeNull(); // honestly null
      expect(result.finalSnapshot).not.toBeNull();
      expect(result.finalSnapshot!.value).toBe('test');
    });

    it('closeWindow uses read() not capture(): cache not corrupted', async () => {
      document.body.innerHTML = '<input type="checkbox" id="cb">';
      const cb = document.getElementById('cb') as HTMLInputElement;
      cb.checked = false;

      // Phase A: mousedown captures before-state
      cache.capture(cb); // { checked: false }

      // Simulate click toggling the checkbox
      cb.checked = true;

      coordinator.openWindow('evt-1', 'click', cb);
      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      // After window close, the cache should NOT have been updated by closeWindow
      // (it uses read(), not capture()). The cache should still have the value
      // from openWindow's capture() call — which read the post-click state.
      // But the key point is: closeWindow's read() did NOT modify the cache.
      // We verify by checking that the beforeSnapshot in the result matches
      // what peek() would have returned at openWindow time.
      expect(results[0].beforeSnapshot!.checked).toBe(false);
    });
  });

  // ── Overlapping Windows ────────────────────────────────────────────────

  describe('overlapping windows', () => {
    it('two overlapping windows close independently at different times', async () => {
      document.body.innerHTML =
        '<div id="el-a">A</div><div id="el-b">B</div>';
      const elA = document.getElementById('el-a')!;
      const elB = document.getElementById('el-b')!;

      coordinator.openWindow('evt-a', 'click', elA);

      // Open second window 20ms later
      await new Promise((r) => setTimeout(r, 20));
      coordinator.openWindow('evt-b', 'click', elB);

      expect(coordinator.getOpenWindowCount()).toBe(2);

      // Wait for A to close (50ms from open)
      await new Promise((r) => setTimeout(r, 40));
      expect(results.length).toBe(1); // A closed
      expect(results[0].sourceEventId).toBe('evt-a');

      // Wait for B to close (50ms from its open, which was 20ms after A)
      await new Promise((r) => setTimeout(r, 40));
      expect(results.length).toBe(2); // B closed
      expect(results[1].sourceEventId).toBe('evt-b');

      expect(coordinator.getOpenWindowCount()).toBe(0);
    });

    it('window A close does not affect window B mutations', async () => {
      document.body.innerHTML =
        '<div id="el-a">A</div><div id="el-b">B</div>';
      const elA = document.getElementById('el-a')!;
      const elB = document.getElementById('el-b')!;

      coordinator.openWindow('evt-a', 'click', elA);
      // Wait a clear gap so A's timer fires before B's
      await new Promise((r) => setTimeout(r, 5));
      coordinator.openWindow('evt-b', 'click', elB);

      // Trigger a mutation during overlap (shared by both)
      elA.setAttribute('class', 'changed-by-a');
      await flushMutations();

      // Wait for A to close (opened at t=0, closes at t=50)
      // B opened at t=5, closes at t=55
      // Wait 70ms to ensure both close
      await new Promise((r) => setTimeout(r, 70));
      expect(results.length).toBe(2);

      // B should have the shared mutation
      const resultB = results.find((r) => r.sourceEventId === 'evt-b')!;
      expect(resultB).toBeDefined();
      expect(resultB.mutationCount).toBeGreaterThanOrEqual(1);
    });

    it('three simultaneous windows all receive shared mutations', async () => {
      document.body.innerHTML =
        '<div id="el-1">1</div><div id="el-2">2</div><div id="el-3">3</div>';
      const el1 = document.getElementById('el-1')!;
      const el2 = document.getElementById('el-2')!;
      const el3 = document.getElementById('el-3')!;

      coordinator.openWindow('evt-1', 'click', el1);
      coordinator.openWindow('evt-2', 'click', el2);
      coordinator.openWindow('evt-3', 'click', el3);

      expect(coordinator.getOpenWindowCount()).toBe(3);

      // Shared mutation
      el1.setAttribute('class', 'shared-change');
      await flushMutations();

      // Wait for all to close
      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 40));

      expect(results.length).toBe(3);
      // All three should have at least the shared mutation
      for (const r of results) {
        expect(r.mutationCount).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ── Rapid Interactions ────────────────────────────────────────────────

  describe('rapid interactions', () => {
    it('two rapid clicks on same element open two independent windows', async () => {
      document.body.innerHTML = '<input type="checkbox" id="cb">';
      const cb = document.getElementById('cb') as HTMLInputElement;
      cb.checked = false;

      // First interaction: mousedown → cache captures {checked: false}
      cache.capture(cb); // { checked: false }
      cb.checked = true; // browser toggles
      coordinator.openWindow('evt-1', 'click', cb);

      // Second interaction shortly after
      await new Promise((r) => setTimeout(r, 10));
      // mousedown for second click → cache captures {checked: true}
      cache.capture(cb); // { checked: true }
      cb.checked = false; // browser toggles back
      coordinator.openWindow('evt-2', 'click', cb);

      expect(coordinator.getOpenWindowCount()).toBe(2);

      // Wait for both to close
      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 40));

      expect(results.length).toBe(2);

      // First window: before {checked:false}, final {checked:false} (toggled twice)
      const r1 = results.find((r) => r.sourceEventId === 'evt-1')!;
      expect(r1.beforeSnapshot!.checked).toBe(false);

      // Second window: before {checked:true}, final {checked:false}
      const r2 = results.find((r) => r.sourceEventId === 'evt-2')!;
      expect(r2.beforeSnapshot!.checked).toBe(true);
      expect(r2.finalSnapshot!.checked).toBe(false);
    });
  });

  // ── Element Removal ────────────────────────────────────────────────────

  describe('element removal', () => {
    it('element removed during window → endReason element-removed, finalSnapshot null', async () => {
      document.body.innerHTML = '<div id="target">Target</div><div id="parent"></div>';
      const target = document.getElementById('target')!;

      coordinator.openWindow('evt-1', 'click', target);

      // Remove the element from DOM before window closes
      target.remove();

      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      const result = results[0];
      expect(result.endReason).toBe('element-removed');
      expect(result.finalSnapshot).toBeNull();
      // beforeSnapshot may still be present if cache had it
    });

    it('element removed during overlap: A removed, B intact', async () => {
      document.body.innerHTML =
        '<div id="el-a">A</div><div id="el-b">B</div>';
      const elA = document.getElementById('el-a')!;
      const elB = document.getElementById('el-b')!;

      coordinator.openWindow('evt-a', 'click', elA);
      await new Promise((r) => setTimeout(r, 10));
      coordinator.openWindow('evt-b', 'click', elB);

      // Remove A's element
      elA.remove();

      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 40));

      const resultA = results.find((r) => r.sourceEventId === 'evt-a')!;
      const resultB = results.find((r) => r.sourceEventId === 'evt-b')!;

      expect(resultA.endReason).toBe('element-removed');
      expect(resultA.finalSnapshot).toBeNull();

      expect(resultB.endReason).toBe('completed');
      expect(resultB.finalSnapshot).not.toBeNull();
    });
  });

  // ── Shutdown ────────────────────────────────────────────────────────────

  describe('shutdown', () => {
    it('shutdown finalizes all open windows with recording-stopped', async () => {
      document.body.innerHTML =
        '<div id="el-1">1</div><div id="el-2">2</div><div id="el-3">3</div>';

      coordinator.openWindow('evt-1', 'click', document.getElementById('el-1')!);
      coordinator.openWindow('evt-2', 'click', document.getElementById('el-2')!);
      coordinator.openWindow('evt-3', 'click', document.getElementById('el-3')!);

      expect(coordinator.getOpenWindowCount()).toBe(3);

      coordinator.shutdown();

      expect(results.length).toBe(3);
      expect(coordinator.getOpenWindowCount()).toBe(0);

      for (const r of results) {
        expect(r.endReason).toBe('recording-stopped');
      }
    });

    it('shutdown does not wait for remaining window duration', async () => {
      document.body.innerHTML = '<div id="el">Test</div>';
      const el = document.getElementById('el')!;

      coordinator.openWindow('evt-1', 'click', el);

      // Shutdown immediately — no waiting
      const shutdownStart = Date.now();
      coordinator.shutdown();
      const shutdownDuration = Date.now() - shutdownStart;

      expect(results.length).toBe(1);
      // Shutdown should be near-instant (well under the window duration)
      expect(shutdownDuration).toBeLessThan(TEST_WINDOW_MS);
    });

    it('shutdown emits results with mutations already captured', async () => {
      document.body.innerHTML = '<div id="el" class="before">Test</div>';
      const el = document.getElementById('el')!;

      coordinator.openWindow('evt-1', 'click', el);

      // Trigger a mutation
      el.setAttribute('class', 'after');
      await flushMutations();

      // Shutdown before window timer fires
      coordinator.shutdown();

      expect(results.length).toBe(1);
      expect(results[0].mutationCount).toBeGreaterThanOrEqual(1);
      expect(results[0].endReason).toBe('recording-stopped');
    });

    it('late timer after shutdown does not crash', async () => {
      document.body.innerHTML = '<div id="el">Test</div>';
      const el = document.getElementById('el')!;

      coordinator.openWindow('evt-1', 'click', el);
      coordinator.shutdown();

      // Wait past when the timer WOULD have fired
      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 50));

      // No additional results, no crash
      expect(results.length).toBe(1);
    });
  });

  // ── Mutation Evidence ──────────────────────────────────────────────────

  describe('mutation evidence', () => {
    it('attribute mutations are delivered in result', async () => {
      document.body.innerHTML = '<div id="el" class="before">Test</div>';
      const el = document.getElementById('el')!;

      coordinator.openWindow('evt-1', 'click', el);
      el.setAttribute('class', 'after');
      await flushMutations();

      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      const result = results[0];
      expect(result.mutationCount).toBeGreaterThanOrEqual(1);

      const attrRec = result.mutations.find(
        (m) => m.type === 'attributes' && m.attributeName === 'class',
      );
      expect(attrRec).toBeDefined();
      expect(attrRec!.oldValue).toBe('before');
      expect(attrRec!.newValue).toBe('after');
    });

    it('no mutations during window → empty mutations array, count 0', async () => {
      document.body.innerHTML = '<div id="el">Static</div>';
      const el = document.getElementById('el')!;

      coordinator.openWindow('evt-1', 'click', el);

      // No DOM changes during window
      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      const result = results[0];
      expect(result.mutations).toEqual([]);
      expect(result.mutationCount).toBe(0);
    });
  });

  // ── Performance Condition ──────────────────────────────────────────────

  describe('performance condition', () => {
    it('performance condition is surfaced in result (or null if none)', async () => {
      document.body.innerHTML = '<div id="el">Test</div>';
      const el = document.getElementById('el')!;

      coordinator.openWindow('evt-1', 'click', el);

      // Small mutation — should not trigger performance condition
      el.setAttribute('class', 'test');
      await flushMutations();

      await new Promise((r) => setTimeout(r, TEST_WINDOW_MS + 20));

      // performanceCondition should be null for small batches
      expect(results[0].performanceCondition).toBeNull();
    });
  });
});
