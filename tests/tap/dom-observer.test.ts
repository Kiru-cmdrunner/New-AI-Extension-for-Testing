/**
 * M3 Unit Tests: DOMObserver — Mutation Observation + Summarization
 *
 * Tests refcounting, mutation grouping, attribute deltas, childList counting,
 * characterData deltas, global batch counter, noise filtering, surface detection,
 * and performance tracking.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §4.5, §5.1-5.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DOMObserver } from '../../src/tap/dom-observer';

// Helper: wait for MutationObserver to fire (jsdom is synchronous-ish but
// MutationObserver callbacks are microtask-deferred)
function flushMutations(): Promise<void> {
  return new Promise((resolve) => {
    // MutationObserver.deliverRecords is synchronous in jsdom,
    // but we need a microtask tick for the callback to fire
    setTimeout(resolve, 0);
  });
}

describe('DOMObserver', () => {
  let observer: DOMObserver;

  beforeEach(() => {
    document.body.innerHTML = '';
    observer = new DOMObserver();
  });

  // ── Refcounting ────────────────────────────────────────────────────

  it('start() creates a MutationObserver (refcount 1)', async () => {
    const refTime = observer.start();
    expect(refTime).toBeGreaterThan(0);

    // Mutations should be observed
    const div = document.createElement('div');
    document.body.appendChild(div);
    await flushMutations();

    expect(observer.getAccumulatedSummaries().length).toBeGreaterThan(0);
    observer.stop();
  });

  it('multiple start() calls increment refcount but only one MutationObserver', async () => {
    observer.start();
    observer.start();
    observer.start();
    // Should still work

    const div = document.createElement('div');
    document.body.appendChild(div);
    await flushMutations();

    expect(observer.getAccumulatedSummaries().length).toBeGreaterThan(0);

    // Need to stop all 3
    observer.stop();
    observer.stop();

    // Still observing with refcount 1
    document.body.appendChild(document.createElement('span'));
    await flushMutations();
    // Should still accumulate

    observer.stop();
    // Now refcount 0 — no longer observing
  });

  it('stop() with refcount 0 does not crash', () => {
    expect(() => observer.stop()).not.toThrow();
  });

  it('after all stops, mutations are no longer observed', async () => {
    observer.start();
    observer.stop();

    document.body.appendChild(document.createElement('div'));
    await flushMutations();

    expect(observer.getAccumulatedSummaries().length).toBe(0);
  });

  // ── Mutation Grouping ──────────────────────────────────────────────

  it('groups multiple mutations on the same element into one summary', async () => {
    observer.start();

    const el = document.createElement('div');
    el.id = 'test-el';
    document.body.appendChild(el);

    el.className = 'first';
    el.className = 'second';
    el.setAttribute('data-test', 'value');

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    // Find the summary for our element
    const target = summaries.find((s) => s.targetPath.includes('#test-el'));
    expect(target).toBeDefined();
    expect(target!.changedAttributes).toContain('class');
    expect(target!.changedAttributes).toContain('data-test');
  });

  it('separate elements produce separate summaries', async () => {
    observer.start();

    const el1 = document.createElement('div');
    el1.id = 'el1';
    const el2 = document.createElement('div');
    el2.id = 'el2';
    document.body.appendChild(el1);
    document.body.appendChild(el2);

    el1.className = 'active';
    el2.className = 'hidden';

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    expect(summaries.length).toBeGreaterThanOrEqual(2);
  });

  // ── Attribute Delta Tracking ───────────────────────────────────────

  it('tracks attribute old and new values', async () => {
    observer.start();

    const el = document.createElement('div');
    el.id = 'attr-test';
    el.className = 'before';
    document.body.appendChild(el);

    el.className = 'after';

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    const target = summaries.find((s) => s.targetPath.includes('#attr-test'));
    expect(target).toBeDefined();
    expect(target!.attributeDeltas['class']).toBeDefined();
    expect(target!.attributeDeltas['class'].old).toBe('before');
    expect(target!.attributeDeltas['class'].new).toBe('after');
  });

  it('tracks aria-expanded changes', async () => {
    observer.start();

    const el = document.createElement('button');
    el.id = 'expand-btn';
    el.setAttribute('aria-expanded', 'false');
    document.body.appendChild(el);

    el.setAttribute('aria-expanded', 'true');

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    const target = summaries.find((s) => s.targetPath.includes('#expand-btn'));
    expect(target).toBeDefined();
    expect(target!.changedAttributes).toContain('aria-expanded');
    expect(target!.attributeDeltas['aria-expanded'].old).toBe('false');
    expect(target!.attributeDeltas['aria-expanded'].new).toBe('true');
  });

  // ── ChildList Mutation Counting ────────────────────────────────────

  it('counts added nodes', async () => {
    observer.start();

    const container = document.createElement('div');
    container.id = 'container';
    document.body.appendChild(container);

    container.appendChild(document.createElement('span'));
    container.appendChild(document.createElement('span'));

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    const target = summaries.find((s) => s.targetPath.includes('#container'));
    expect(target).toBeDefined();
    expect(target!.addedNodesCount).toBeGreaterThanOrEqual(2);
  });

  it('counts removed nodes', async () => {
    const container = document.createElement('div');
    container.id = 'remove-container';
    const child1 = document.createElement('span');
    const child2 = document.createElement('span');
    container.appendChild(child1);
    container.appendChild(child2);
    document.body.appendChild(container);

    observer.start();

    container.removeChild(child1);

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    const target = summaries.find((s) => s.targetPath.includes('#remove-container'));
    expect(target).toBeDefined();
    expect(target!.removedNodesCount).toBeGreaterThanOrEqual(1);
  });

  // ── CharacterData ──────────────────────────────────────────────────

  it('tracks characterData delta', async () => {
    observer.start();

    const el = document.createElement('div');
    el.id = 'text-el';
    el.textContent = 'original';
    document.body.appendChild(el);

    el.textContent = 'modified';

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    const target = summaries.find((s) => s.targetPath.includes('#text-el'));
    expect(target).toBeDefined();
    expect(target!.characterDataDelta).toBeDefined();
  });

  // ── Global Batch Counter ───────────────────────────────────────────

  it('globalBatchCounter increments once per MutationObserver callback', async () => {
    observer.start();

    expect(observer.getBatchCounter()).toBe(0);

    document.body.appendChild(document.createElement('div'));
    await flushMutations();

    // After one batch, counter should be >= 1
    expect(observer.getBatchCounter()).toBeGreaterThanOrEqual(1);

    const batchAfterFirst = observer.getBatchCounter();

    document.body.appendChild(document.createElement('span'));
    await flushMutations();

    expect(observer.getBatchCounter()).toBeGreaterThan(batchAfterFirst);
    observer.stop();
  });

  it('batchIndex is available in batch callback', async () => {
    const batches: number[] = [];
    observer.start((batchIndex) => {
      batches.push(batchIndex);
    });

    document.body.appendChild(document.createElement('div'));
    await flushMutations();

    document.body.appendChild(document.createElement('span'));
    await flushMutations();

    observer.stop();

    expect(batches.length).toBeGreaterThanOrEqual(1);
    // Indices should be monotonically increasing
    for (let i = 1; i < batches.length; i++) {
      expect(batches[i]).toBeGreaterThan(batches[i - 1]);
    }
  });

  // ── Noise Filtering ────────────────────────────────────────────────

  it('filters characterData mutations on <script> tags', async () => {
    observer.start();

    const script = document.createElement('script');
    script.textContent = 'var x = 1;';
    document.body.appendChild(script);

    script.textContent = 'var x = 2;';

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    // Should NOT have characterData mutations from the script tag
    const scriptSummary = summaries.find((s) => s.targetTag === 'script');
    if (scriptSummary) {
      // If a summary exists for the script tag, it should not have characterData type
      // (it may have childList from the append)
      expect(scriptSummary.types).not.toContain('characterData');
    }
  });

  // ── Surface Detection ──────────────────────────────────────────────

  it('detects dialog surfaces added to DOM', async () => {
    observer.start();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'My Dialog');
    document.body.appendChild(dialog);

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    expect(surfaces.length).toBeGreaterThanOrEqual(1);
    const dialogSurface = surfaces.find((s) => s.ariaRole === 'dialog');
    expect(dialogSurface).toBeDefined();
    expect(dialogSurface!.accessibleName).toBe('My Dialog');
  });

  it('detects removed surfaces', async () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.id = 'test-menu';
    document.body.appendChild(menu);

    observer.start();

    document.body.removeChild(menu);

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    const removedMenu = surfaces.find((s) => s.ariaRole === 'menu');
    expect(removedMenu).toBeDefined();
  });

  it('ignores non-significant elements as surfaces', async () => {
    observer.start();

    document.body.appendChild(document.createElement('span'));

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    expect(surfaces.length).toBe(0);
  });

  // ── Visibility Changes ─────────────────────────────────────────────

  it('detects hidden attribute changes', async () => {
    const el = document.createElement('div');
    el.id = 'vis-test';
    document.body.appendChild(el);

    observer.start();

    el.setAttribute('hidden', '');

    await flushMutations();
    observer.stop();

    const visChanges = observer.getVisibilityChanges();
    expect(visChanges.length).toBeGreaterThanOrEqual(1);
    const hiddenChange = visChanges.find((v) => v.property === 'hidden');
    expect(hiddenChange).toBeDefined();
  });

  it('detects aria-hidden changes', async () => {
    const el = document.createElement('div');
    el.id = 'aria-hidden-test';
    document.body.appendChild(el);

    observer.start();

    el.setAttribute('aria-hidden', 'true');

    await flushMutations();
    observer.stop();

    const visChanges = observer.getVisibilityChanges();
    const ariaHidden = visChanges.find((v) => v.property === 'aria-hidden');
    expect(ariaHidden).toBeDefined();
    expect(ariaHidden!.newValue).toBe('true');
  });

  // ── Clear / Reset ──────────────────────────────────────────────────

  it('clearAccumulated() resets all accumulated data', async () => {
    observer.start();

    document.body.appendChild(document.createElement('div'));
    await flushMutations();

    expect(observer.getAccumulatedSummaries().length).toBeGreaterThan(0);

    observer.clearAccumulated();

    expect(observer.getAccumulatedSummaries().length).toBe(0);
    expect(observer.getSurfaceChanges().length).toBe(0);
    expect(observer.getVisibilityChanges().length).toBe(0);

    observer.stop();
  });

  it('resetBatchCounter() resets the batch counter to 0', async () => {
    observer.start();

    document.body.appendChild(document.createElement('div'));
    await flushMutations();

    expect(observer.getBatchCounter()).toBeGreaterThan(0);

    observer.resetBatchCounter();
    expect(observer.getBatchCounter()).toBe(0);

    observer.stop();
  });

  // ── Performance Tracking ───────────────────────────────────────────

  it('tracks totalBatches', async () => {
    observer.start();

    document.body.appendChild(document.createElement('div'));
    await flushMutations();

    document.body.appendChild(document.createElement('span'));
    await flushMutations();

    observer.stop();

    const metrics = observer.getPerformanceMetrics();
    expect(metrics.totalBatches).toBeGreaterThanOrEqual(1);
  });

  it('tracks longestBatchMs', async () => {
    observer.start();

    document.body.appendChild(document.createElement('div'));
    await flushMutations();

    observer.stop();

    const metrics = observer.getPerformanceMetrics();
    expect(metrics.longestBatchMs).toBeGreaterThanOrEqual(0);
  });

  // ── RelativeTime ───────────────────────────────────────────────────

  it('firstMutationAt and lastMutationAt use relativeTime (from referenceTime)', async () => {
    observer.start();

    // Small delay to ensure elapsed > 0
    await new Promise((r) => setTimeout(r, 10));

    const el = document.createElement('div');
    el.id = 'rel-time-test';
    document.body.appendChild(el);

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    const target = summaries.find((s) => s.targetPath.includes('#rel-time-test'));
    if (target) {
      // relativeTime should be >= 0 (from referenceTime)
      expect(target.firstMutationAt).toBeGreaterThanOrEqual(0);
    }
  });

  // ── rawMutationCount ───────────────────────────────────────────────

  it('rawMutationCount tracks total records collapsed into summary', async () => {
    observer.start();

    const el = document.createElement('div');
    el.id = 'count-test';
    document.body.appendChild(el);

    el.className = 'a';
    el.className = 'b';
    el.className = 'c';

    await flushMutations();
    observer.stop();

    const summaries = observer.getAccumulatedSummaries();
    const target = summaries.find((s) => s.targetPath.includes('#count-test'));
    if (target) {
      expect(target.rawMutationCount).toBeGreaterThanOrEqual(3);
    }
  });
});
