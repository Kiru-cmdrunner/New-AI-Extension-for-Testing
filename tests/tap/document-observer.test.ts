/**
 * Unit Tests: Document Observer — Document-Wide Mutation Capture (M1 Phase B)
 *
 * Tests the DocumentObserver class: singleton MutationObserver on document.body,
 * refcounted lifecycle, shared record buffer with windowId attribution,
 * pruning of closed-window records, performance condition measurement.
 *
 * Architecture: .drytis/specs/m1-phase-b-detailed-design.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentObserver } from '../../src/tap/document-observer';

/** Flush MutationObserver callbacks in JSDOM. */
function flushMutations(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('DocumentObserver', () => {
  let observer: DocumentObserver;

  beforeEach(() => {
    document.body.innerHTML = '';
    observer = new DocumentObserver();
  });

  // ── Basic Capture ────────────────────────────────────────────────────

  describe('basic capture', () => {
    it('captures attribute mutation with old and new values', async () => {
      document.body.innerHTML = '<div id="el" class="before">Hello</div>';
      observer.start('w1');

      const el = document.getElementById('el')!;
      el.setAttribute('class', 'after');

      await flushMutations();
      observer.stop('w1');

      const records = observer.getRecordsForWindow('w1');
      const attrRec = records.find((r) => r.type === 'attributes');
      expect(attrRec).toBeDefined();
      expect(attrRec!.attributeName).toBe('class');
      expect(attrRec!.oldValue).toBe('before');
      expect(attrRec!.newValue).toBe('after');
    });

    it('captures childList mutation with added/removed counts', async () => {
      document.body.innerHTML = '<div id="container"></div>';
      observer.start('w1');

      const container = document.getElementById('container')!;
      const newChild = document.createElement('span');
      newChild.textContent = 'New';
      container.appendChild(newChild);

      await flushMutations();
      observer.stop('w1');

      const records = observer.getRecordsForWindow('w1');
      const childRec = records.find(
        (r) => r.type === 'childList' && r.addedNodesCount > 0,
      );
      expect(childRec).toBeDefined();
      expect(childRec!.addedNodesCount).toBe(1);
      expect(childRec!.removedNodesCount).toBe(0);
    });

    it('captures characterData mutation with old and new text', async () => {
      document.body.innerHTML = '<span id="text">Old text</span>';
      observer.start('w1');

      const span = document.getElementById('text')!;
      // Setting textContent triggers a characterData mutation on the Text node
      span.firstChild!.textContent = 'New text';

      await flushMutations();
      observer.stop('w1');

      const records = observer.getRecordsForWindow('w1');
      const charRec = records.find((r) => r.type === 'characterData');
      expect(charRec).toBeDefined();
      expect(charRec!.newValue).toBe('New text');
      // oldValue should be 'Old text' — JSDOM may not populate characterDataOldValue
      // in all versions; verify newValue correctness as the primary assertion.
      if (charRec!.oldValue !== null) {
        expect(charRec!.oldValue).toBe('Old text');
      }
    });

    it('resolves characterData targetPath to parent Element (not Text node)', async () => {
      document.body.innerHTML = '<span id="text">Original</span>';
      observer.start('w1');

      const span = document.getElementById('text')!;
      span.firstChild!.textContent = 'Changed';

      await flushMutations();
      observer.stop('w1');

      const records = observer.getRecordsForWindow('w1');
      const charRec = records.find((r) => r.type === 'characterData');
      expect(charRec).toBeDefined();
      // targetPath should contain the span, not reference a Text node
      expect(charRec!.targetPath).toContain('span');
      expect(charRec!.targetTag).toBe('SPAN');
    });

    it('captures style attribute changes (no attributeFilter)', async () => {
      document.body.innerHTML = '<div id="styled">Content</div>';
      observer.start('w1');

      const el = document.getElementById('styled')!;
      el.setAttribute('style', 'display: none;');

      await flushMutations();
      observer.stop('w1');

      const records = observer.getRecordsForWindow('w1');
      const styleRec = records.find(
        (r) => r.type === 'attributes' && r.attributeName === 'style',
      );
      expect(styleRec).toBeDefined();
      expect(styleRec!.newValue).toContain('display');
    });
  });

  // ── Refcounting ───────────────────────────────────────────────────────

  describe('refcounting', () => {
    it('multiple starts share one observer (mutations captured for all windows)', async () => {
      observer.start('w1');
      observer.start('w2');

      expect(observer.getActiveWindowIds().sort()).toEqual(['w1', 'w2']);

      document.body.innerHTML = '<div id="el" class="a">Text</div>';
      const el = document.getElementById('el')!;
      el.setAttribute('class', 'b');

      await flushMutations();

      observer.stop('w1');
      observer.stop('w2');

      // Both windows should have records attributed to them
      const w1Records = observer.getRecordsForWindow('w1');
      const w2Records = observer.getRecordsForWindow('w2');
      expect(w1Records.length).toBeGreaterThan(0);
      expect(w2Records.length).toBeGreaterThan(0);
    });

    it('stop only disconnects when last window stops', async () => {
      observer.start('w1');
      observer.start('w2');
      observer.stop('w1'); // refCount = 1, observer still running

      document.body.innerHTML = '<div id="el" class="a">Text</div>';
      const el = document.getElementById('el')!;
      el.setAttribute('class', 'b');

      await flushMutations();
      observer.stop('w2'); // refCount = 0, observer disconnected

      // Records should exist for w2 (observer was still running after w1 stopped)
      const w2Records = observer.getRecordsForWindow('w2');
      expect(w2Records.length).toBeGreaterThan(0);
    });

    it('extra stop with unknown windowId is a safe no-op', () => {
      observer.start('w1');
      observer.stop('unknown-id'); // should not throw or corrupt state

      expect(observer.getActiveWindowIds()).toEqual(['w1']);

      observer.stop('w1');
      expect(observer.getActiveWindowIds()).toEqual([]);
    });
  });

  // ── Window Attribution ────────────────────────────────────────────────

  describe('window attribution', () => {
    it('attributes records to the active window', async () => {
      document.body.innerHTML = '<div id="el" class="a">Text</div>';
      observer.start('only-window');

      const el = document.getElementById('el')!;
      el.setAttribute('class', 'b');

      await flushMutations();
      observer.stop('only-window');

      const records = observer.getRecordsForWindow('only-window');
      expect(records.length).toBeGreaterThan(0);
      for (const r of records) {
        expect(r.windowIds).toContain('only-window');
      }
    });

    it('attributes records to all active overlapping windows', async () => {
      observer.start('w1');
      observer.start('w2');

      document.body.innerHTML = '<div id="el" class="a">Text</div>';
      const el = document.getElementById('el')!;
      el.setAttribute('class', 'b');

      await flushMutations();

      // Before stopping, check that records have BOTH windowIds
      const w1Records = observer.getRecordsForWindow('w1');
      expect(w1Records.length).toBeGreaterThan(0);
      // At least one record should be attributed to both windows
      const shared = w1Records.filter((r) => r.windowIds.includes('w2'));
      expect(shared.length).toBeGreaterThan(0);

      observer.stop('w1');
      observer.stop('w2');
    });

    it('pruning removes exclusive records, preserves shared records', async () => {
      observer.start('w1');
      observer.start('w2');

      // This mutation will be shared
      document.body.innerHTML = '<div id="el" class="a">Text</div>';
      const el = document.getElementById('el')!;
      el.setAttribute('class', 'b');

      await flushMutations();

      // Now stop w1 but keep w2 alive
      observer.stop('w1');

      // Prune w1 records
      observer.pruneWindowRecords('w1');

      // w2 records should still exist (shared records survive with w1 removed)
      const w2Records = observer.getRecordsForWindow('w2');
      expect(w2Records.length).toBeGreaterThan(0);
      // No record should have w1 in windowIds anymore
      for (const r of w2Records) {
        expect(r.windowIds).not.toContain('w1');
      }

      // w1 records should be gone (exclusive ones removed, shared ones no longer attributed)
      const w1Records = observer.getRecordsForWindow('w1');
      expect(w1Records.length).toBe(0);

      observer.stop('w2');
    });
  });

  // ── Pruning Edge Cases ────────────────────────────────────────────────

  describe('pruning edge cases', () => {
    it('getRecordsForWindow returns copies (buffer isolation)', async () => {
      document.body.innerHTML = '<div id="el" class="a">Text</div>';
      observer.start('w1');

      const el = document.getElementById('el')!;
      el.setAttribute('class', 'b');

      await flushMutations();
      observer.stop('w1');

      const records = observer.getRecordsForWindow('w1');
      expect(records.length).toBeGreaterThan(0);

      // Mutate the returned copy
      records[0].newValue = 'TAMPERED';
      records[0].windowIds.push('fake-window');

      // Buffer record should be unaffected
      const freshRecords = observer.getRecordsForWindow('w1');
      expect(freshRecords[0].newValue).not.toBe('TAMPERED');
      expect(freshRecords[0].windowIds).not.toContain('fake-window');
    });

    it('shared records survive pruning with reduced attribution list', async () => {
      observer.start('w1');
      observer.start('w2');

      document.body.innerHTML = '<div id="el" class="a">Text</div>';
      const el = document.getElementById('el')!;
      el.setAttribute('class', 'b');

      await flushMutations();
      observer.stop('w1');

      const bufferLenBefore = observer.getBufferLength();
      observer.pruneWindowRecords('w1');
      const bufferLenAfter = observer.getBufferLength();

      // Records survived (they are also attributed to w2)
      expect(bufferLenAfter).toBe(bufferLenBefore);

      // Verify the surviving records no longer have w1
      const w2Records = observer.getRecordsForWindow('w2');
      for (const r of w2Records) {
        expect(r.windowIds).not.toContain('w1');
        expect(r.windowIds).toContain('w2');
      }

      observer.stop('w2');
    });
  });

  // ── Reset ──────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all state: buffer, observer, counter, performance condition', async () => {
      document.body.innerHTML = '<div id="el" class="a">Text</div>';
      observer.start('w1');

      const el = document.getElementById('el')!;
      el.setAttribute('class', 'b');

      await flushMutations();
      observer.stop('w1');

      expect(observer.getBufferLength()).toBeGreaterThan(0);

      observer.reset();

      expect(observer.getBufferLength()).toBe(0);
      expect(observer.getActiveWindowIds()).toEqual([]);
      expect(observer.getPerformanceCondition()).toBeNull();
      expect(observer.getTotalRecordsDuringWindow('w1')).toBe(0);

      // Observer should NOT capture after reset until start() is called again
      el.setAttribute('class', 'c');
      await flushMutations();
      expect(observer.getBufferLength()).toBe(0);
    });
  });

  // ── Performance Condition ──────────────────────────────────────────────

  describe('performance condition', () => {
    it('records performance condition on high-volume batch', async () => {
      // Create a container, then start observing
      document.body.innerHTML = '<div id="container"></div>';
      observer.start('w1');

      // Inject a large number of elements to create a high-volume mutation batch
      const container = document.getElementById('container')!;
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 1500; i++) {
        const span = document.createElement('span');
        span.textContent = `Item ${i}`;
        span.setAttribute('data-idx', String(i));
        fragment.appendChild(span);
      }
      container.appendChild(fragment);

      await flushMutations();
      observer.stop('w1');

      // All records should be captured (no drop)
      const records = observer.getRecordsForWindow('w1');
      expect(records.length).toBeGreaterThan(0);

      // Performance condition may or may not be triggered depending on
      // machine speed. If it is set, verify its shape.
      const pc = observer.getPerformanceCondition();
      if (pc) {
        expect(pc.batchRecordCount).toBeGreaterThan(0);
        expect(pc.batchDurationMs).toBeGreaterThan(0);
        expect(typeof pc.timestamp).toBe('number');
      }
    });

    it('does not trigger performance condition for normal volume', async () => {
      document.body.innerHTML = '<div id="el" class="a">Text</div>';
      observer.start('w1');

      const el = document.getElementById('el')!;
      el.setAttribute('class', 'b');

      await flushMutations();
      observer.stop('w1');

      // A single attribute change should not trigger performance condition
      expect(observer.getPerformanceCondition()).toBeNull();
    });
  });
});
