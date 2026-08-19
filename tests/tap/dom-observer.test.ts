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

  // ── SD: Surface Detection Generification (spec surface-detection-generification.md) ──

  it('SD1: directly added role=dialog records one surface (regression)', async () => {
    observer.start();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Direct');
    document.body.appendChild(dialog);

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    expect(surfaces.filter((s) => s.ariaRole === 'dialog')).toHaveLength(1);
    expect(surfaces[0].kind).toBe('added');
    // Spec §7: legacy direct-insertion shape records no emergence field
    expect(surfaces[0].emergence).toBeUndefined();
  });

  it('SD2: wrapper containing descendant role=dialog records the descendant surface', async () => {
    observer.start();

    const wrapper = document.createElement('div');
    wrapper.id = 'wrap';
    const inner = document.createElement('div');
    inner.setAttribute('role', 'dialog');
    inner.setAttribute('aria-label', 'Nested');
    inner.appendChild(document.createElement('p'));
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].ariaRole).toBe('dialog');
    expect(surfaces[0].accessibleName).toBe('Nested');
    expect(surfaces[0].path).toContain('#wrap');
    expect(surfaces[0].emergence).toBe('inserted');
  });

  it('SD3: wrapper containing surface-tag descendant records it (dialog/details/summary)', async () => {
    observer.start();

    const wrapper = document.createElement('div');
    wrapper.id = 'wrap3';
    const dlg = document.createElement('dialog');
    dlg.appendChild(document.createTextNode('Native'));
    wrapper.appendChild(dlg);
    document.body.appendChild(wrapper);

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].tagName).toBe('dialog');
    expect(surfaces[0].emergence).toBe('inserted');
  });

  it('SD4: hidden role=dialog revealed via display:none → block records revealed surface', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Reveal me');
    dialog.setAttribute('style', 'display:none');
    dialog.id = 'reveal-dialog';
    document.body.appendChild(dialog);

    observer.start();

    dialog.setAttribute('style', 'display:block');

    await flushMutations();
    observer.stop();

    const vis = observer.getVisibilityChanges().filter((v) => v.path.includes('#reveal-dialog'));
    const surfaces = observer.getSurfaceChanges();
    expect(vis.length).toBeGreaterThanOrEqual(1);
    expect(vis[0].property).toBe('display');
    expect(surfaces.filter((s) => s.ariaRole === 'dialog')).toHaveLength(1);
    expect(surfaces[0].emergence).toBe('revealed');
    expect(surfaces[0].kind).toBe('added');
  });

  it('SD5: aria-hidden=true → false on role=alert records revealed surface', async () => {
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.setAttribute('aria-hidden', 'true');
    alert.id = 'reveal-alert';
    document.body.appendChild(alert);

    observer.start();

    alert.setAttribute('aria-hidden', 'false');

    await flushMutations();
    observer.stop();

    const vis = observer.getVisibilityChanges();
    const surfaces = observer.getSurfaceChanges();
    expect(vis.some((v) => v.path.includes('#reveal-alert') && v.oldValue === 'true' && v.newValue === 'false')).toBe(true);
    expect(surfaces.filter((s) => s.ariaRole === 'alert')).toHaveLength(1);
    expect(surfaces[0].emergence).toBe('revealed');
  });

  it('SD6: class reveal on role=menu (computed display none → block) records revealed surface', async () => {
    const style = document.createElement('style');
    style.textContent = '.hidden-menu { display: none; }';
    document.head.appendChild(style);

    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.className = 'hidden-menu';
    menu.id = 'reveal-menu';
    document.body.appendChild(menu);

    observer.start(); // seeds prevComputedStyles (display:none baseline)

    menu.className = ''; // computed display becomes block

    await flushMutations();
    observer.stop();

    const vis = observer.getVisibilityChanges().filter((v) => v.path.includes('#reveal-menu'));
    const surfaces = observer.getSurfaceChanges();
    expect(vis.length).toBeGreaterThanOrEqual(1);
    expect(vis.some((v) => v.property === 'display' && v.oldValue === 'none')).toBe(true);
    expect(surfaces.filter((s) => s.ariaRole === 'menu')).toHaveLength(1);
    expect(surfaces[0].emergence).toBe('revealed');
  });

  it('SD7a: nested dialogs (outer + inner) record two distinct surfaces', async () => {
    observer.start();

    const outer = document.createElement('div');
    outer.setAttribute('role', 'dialog');
    outer.setAttribute('aria-label', 'Outer');
    outer.id = 'outer-dlg';
    const inner = document.createElement('div');
    inner.setAttribute('role', 'dialog');
    inner.setAttribute('aria-label', 'Inner');
    inner.id = 'inner-dlg';
    outer.appendChild(inner);
    document.body.appendChild(outer);

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    expect(surfaces).toHaveLength(2);
    expect(new Set(surfaces.map((s) => s.path)).size).toBe(2);
  });

  it('SD7b: insert + reveal of same element in one window records exactly one surface (inserted)', async () => {
    observer.start();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Dup');
    dialog.setAttribute('style', 'display:none');
    document.body.appendChild(dialog);

    await flushMutations();
    dialog.setAttribute('style', 'display:block');
    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    expect(surfaces).toHaveLength(1);
    // First discovery wins: direct insertion records the legacy shape
    // (no emergence field); the later reveal is deduped by element identity
    expect(surfaces[0].emergence).toBeUndefined();
  });

  it('SD8: descendant-scan budget bounds scans per batch; clearAccumulated resets dedup', async () => {
    observer.start();

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 100; i++) {
      const wrapper = document.createElement('div');
      const inner = document.createElement('div');
      inner.setAttribute('role', 'dialog');
      inner.setAttribute('aria-label', 'D' + i);
      wrapper.appendChild(inner);
      fragment.appendChild(wrapper);
    }
    // Single append of the fragment (one childList batch on body)
    document.body.appendChild(fragment);

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    // Budget is 32 scans per batch → at most 32 descendant-discovered surfaces
    expect(surfaces.length).toBeLessThanOrEqual(32);
    expect(surfaces.length).toBeGreaterThan(0);

    // clearAccumulated() resets the dedup set — re-adding records again
    observer.clearAccumulated();
    observer.start();
    const w2 = document.createElement('div');
    const d2 = document.createElement('div');
    d2.setAttribute('role', 'dialog');
    d2.setAttribute('aria-label', 'Again');
    w2.appendChild(d2);
    document.body.appendChild(w2);
    await flushMutations();
    observer.stop();
    expect(observer.getSurfaceChanges()).toHaveLength(1);
  });

  it('SD9: removing a wrapper containing role=dialog records descendant removed surface', async () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'removewrap';
    const inner = document.createElement('div');
    inner.setAttribute('role', 'dialog');
    inner.setAttribute('aria-label', 'Bye');
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    observer.start();

    document.body.removeChild(wrapper);

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].kind).toBe('removed');
    expect(surfaces[0].ariaRole).toBe('dialog');
  });

  it('SD10: reveal of role=region produces visibility row only, no surface record', async () => {
    const region = document.createElement('div');
    region.setAttribute('role', 'region');
    region.setAttribute('aria-hidden', 'true');
    region.id = 'reveal-region';
    document.body.appendChild(region);

    observer.start();

    region.setAttribute('aria-hidden', 'false');

    await flushMutations();
    observer.stop();

    expect(observer.getSurfaceChanges()).toHaveLength(0);
    expect(observer.getVisibilityChanges().some((v) => v.path.includes('#reveal-region'))).toBe(true);
  });

  it('SD12: CSS-hidden role=dialog revealed via inline style (no old inline value) records revealed surface', async () => {
    const style = document.createElement('style');
    style.textContent = '.css-hidden { display: none; }';
    document.head.appendChild(style);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Css hidden');
    dialog.className = 'css-hidden';
    document.body.appendChild(dialog);

    observer.start(); // seeds computed baseline (display:none via CSS)

    dialog.setAttribute('style', 'display:block'); // inline reveal, old inline value absent

    await flushMutations();
    observer.stop();

    const surfaces = observer.getSurfaceChanges();
    expect(surfaces.filter((s) => s.ariaRole === 'dialog')).toHaveLength(1);
    expect(surfaces[0].emergence).toBe('revealed');
  });

  it('SD11: hide transitions produce no surface records', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('style', 'display:block');
    document.body.appendChild(dialog);

    observer.start();

    dialog.setAttribute('style', 'display:none');

    await flushMutations();
    observer.stop();

    expect(observer.getSurfaceChanges()).toHaveLength(0);
    expect(observer.getVisibilityChanges().some((v) => v.property === 'display')).toBe(true);
  });
});
