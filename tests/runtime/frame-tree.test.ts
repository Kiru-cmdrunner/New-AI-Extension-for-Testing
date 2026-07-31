/**
 * FrameTree Tests
 *
 * Tests the service-worker FrameTree class — the authoritative frame topology
 * manager that uses chrome.webNavigation.getAllFrames() to see all frames
 * regardless of origin.
 *
 * Mocks the chrome.webNavigation API since these tests run in Node/JSDOM,
 * not in a real service worker context.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FrameTree } from '../../src/background/frame-tree';

// ── Chrome API Mock ────────────────────────────────────────────────────

function mockGetAllFrames(
  frames: Array<{ frameId: number; parentFrameId: number; url: string }>,
) {
  (globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    webNavigation: {
      getAllFrames: vi.fn().mockResolvedValue(
        frames.map(f => ({
          ...f,
          errorOccurred: false,
          processId: 0,
        })),
      ),
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('FrameTree', () => {
  beforeEach(() => {
    FrameTree.clearAll();
  });

  describe('refresh — builds frame topology', () => {
    it('builds a simple top + 1 child tree', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
        { frameId: 5, parentFrameId: 0, url: 'https://widget.example.com/v3' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      const child = tree.get(5);
      expect(child).toBeDefined();
      expect(child!.depth).toBe(1);
      expect(child!.url).toBe('https://widget.example.com/v3');
      expect(child!.parentFrameId).toBe(0);
      expect(child!.ancestorFrameIds).toEqual([0]);
      expect(child!.ancestorUrls).toEqual(['https://example.com']);
    });

    it('builds a 3-level nested tree with correct ancestor chains', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://app.example.com' },
        { frameId: 3, parentFrameId: 0, url: 'https://payment.example.com' },
        { frameId: 7, parentFrameId: 3, url: 'https://card.stripe.com/field' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      const inner = tree.get(7);
      expect(inner).toBeDefined();
      expect(inner!.depth).toBe(2);
      expect(inner!.ancestorFrameIds).toEqual([0, 3]);
      expect(inner!.ancestorUrls).toEqual([
        'https://app.example.com',
        'https://payment.example.com',
      ]);
    });

    it('returns undefined for top frame (frameId 0)', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      expect(tree.get(0)).toBeUndefined();
      expect(tree.isTopFrame(0)).toBe(true);
      expect(tree.isTopFrame(5)).toBe(false);
    });

    it('returns undefined for unknown frameId', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      expect(tree.get(999)).toBeUndefined();
    });

    it('handles 4+ level deep nesting', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://a.com' },
        { frameId: 1, parentFrameId: 0, url: 'https://b.com' },
        { frameId: 2, parentFrameId: 1, url: 'https://c.com' },
        { frameId: 3, parentFrameId: 2, url: 'https://d.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      const deepest = tree.get(3);
      expect(deepest!.depth).toBe(3);
      expect(deepest!.ancestorFrameIds).toEqual([0, 1, 2]);
      expect(deepest!.ancestorUrls).toEqual([
        'https://a.com',
        'https://b.com',
        'https://c.com',
      ]);
    });

    it('handles multiple sibling iframes', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
        { frameId: 1, parentFrameId: 0, url: 'https://chat.example.com' },
        { frameId: 2, parentFrameId: 0, url: 'https://analytics.example.com' },
        { frameId: 3, parentFrameId: 0, url: 'https://ads.doubleclick.net' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      expect(tree.size).toBe(4);
      expect(tree.get(1)!.depth).toBe(1);
      expect(tree.get(2)!.depth).toBe(1);
      expect(tree.get(3)!.depth).toBe(1);
    });
  });

  describe('refresh — handles dynamic frame changes', () => {
    it('updates the tree when a frame is removed', async () => {
      // Start with 3 frames
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
        { frameId: 1, parentFrameId: 0, url: 'https://widget1.com' },
        { frameId: 2, parentFrameId: 0, url: 'https://widget2.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);
      expect(tree.size).toBe(3);

      // After refresh, widget2 was removed
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
        { frameId: 1, parentFrameId: 0, url: 'https://widget1.com' },
      ]);

      await tree.refresh(1);
      expect(tree.size).toBe(2);
      expect(tree.get(2)).toBeUndefined();
    });

    it('updates the tree when a new frame is added', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);
      expect(tree.size).toBe(1);

      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
        { frameId: 5, parentFrameId: 0, url: 'https://new-widget.com' },
      ]);

      await tree.refresh(1);
      expect(tree.size).toBe(2);
      expect(tree.get(5)).toBeDefined();
    });
  });

  describe('getAncestorChain', () => {
    it('returns empty array for top frame', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      expect(tree.getAncestorChain(0)).toEqual([]);
    });

    it('returns [immediate_parent] for depth-1 frame', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
        { frameId: 5, parentFrameId: 0, url: 'https://widget.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      const chain = tree.getAncestorChain(5);
      expect(chain).toHaveLength(1);
      expect(chain[0].url).toBe('https://widget.com');
    });

    it('returns [outer, inner] for depth-2 frame', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://app.com' },
        { frameId: 3, parentFrameId: 0, url: 'https://payment.com' },
        { frameId: 7, parentFrameId: 3, url: 'https://card.stripe.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      const chain = tree.getAncestorChain(7);
      expect(chain).toHaveLength(2);
      expect(chain[0].url).toBe('https://payment.com');
      expect(chain[1].url).toBe('https://card.stripe.com');
    });
  });

  describe('mergeSelectors — hybrid locator strategy', () => {
    it('stores selectors keyed by URL', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
        { frameId: 5, parentFrameId: 0, url: 'https://widget.com/embed' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      tree.mergeSelectors([{
        frameSelector: 'iframe#payment-widget',
        frameName: 'payment',
        frameId: 'payment-widget',
        frameIndex: 0,
        frameSrc: 'https://widget.com/embed',
      }]);

      const entry = tree.getSelectorForUrl('https://widget.com/embed');
      expect(entry).toBeDefined();
      expect(entry!.frameSelector).toBe('iframe#payment-widget');
    });

    it('getAncestorChain includes selector when available', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://app.com' },
        { frameId: 3, parentFrameId: 0, url: 'https://payment.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      tree.mergeSelectors([{
        frameSelector: 'iframe#payment-iframe',
        frameName: null,
        frameId: 'payment-iframe',
        frameIndex: 0,
        frameSrc: 'https://payment.com',
      }]);

      const chain = tree.getAncestorChain(3);
      expect(chain[0].selector).toBe('iframe#payment-iframe');
      expect(chain[0].selectorStrategy).toBe('css');
    });
  });

  describe('per-tab isolation', () => {
    it('maintains separate FrameTrees per tab', async () => {
      // Tab 1
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://tab1.com' },
        { frameId: 1, parentFrameId: 0, url: 'https://iframe1.com' },
      ]);
      const tree1 = FrameTree.forTab(1);
      await tree1.refresh(1);

      // Tab 2 (different mock)
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://tab2.com' },
        { frameId: 1, parentFrameId: 0, url: 'https://iframe2.com' },
      ]);
      const tree2 = FrameTree.forTab(2);
      await tree2.refresh(2);

      expect(tree1.get(1)!.url).toBe('https://iframe1.com');
      expect(tree2.get(1)!.url).toBe('https://iframe2.com');
      expect(tree1).not.toBe(tree2);
    });

    it('clearTab removes the tree for a specific tab', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
      ]);
      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      FrameTree.clearTab(1);

      const newTree = FrameTree.forTab(1);
      expect(newTree).not.toBe(tree);
      expect(newTree.size).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles getAllFrames returning undefined', async () => {
      (globalThis as any).chrome = {
        webNavigation: {
          getAllFrames: vi.fn().mockResolvedValue(undefined),
        },
      };

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);
      expect(tree.size).toBe(0);
    });

    it('handles getAllFrames throwing', async () => {
      (globalThis as any).chrome = {
        webNavigation: {
          getAllFrames: vi.fn().mockRejectedValue(new Error('Permission denied')),
        },
      };

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);
      expect(tree.size).toBe(0);
    });

    it('handles orphaned frames (parent not in tree)', async () => {
      mockGetAllFrames([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
        // Frame 5 claims parent 99 which doesn't exist
        { frameId: 5, parentFrameId: 99, url: 'https://orphan.com' },
      ]);

      const tree = FrameTree.forTab(1);
      await tree.refresh(1);

      const orphan = tree.get(5);
      expect(orphan).toBeDefined();
      // Orphan has depth 0 (parent chain walk stopped immediately)
      expect(orphan!.depth).toBe(0);
    });
  });
});
