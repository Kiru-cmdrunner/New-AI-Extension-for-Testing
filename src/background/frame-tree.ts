/**
 * FrameTree — Service-Worker Frame Topology Manager
 *
 * The ONLY component that can see the complete frame tree across all origins.
 * Chrome's `chrome.webNavigation.getAllFrames(tabId)` returns every frame's
 * URL, frame ID, and parent frame ID — regardless of cross-origin boundaries.
 *
 * The content script inside a cross-origin iframe cannot read its parent's DOM
 * (same-origin policy), but it doesn't need to — the FrameTree already knows
 * the complete topology from the service worker's privileged perspective.
 *
 * ## Lifecycle
 *
 * 1. On recording start: `await frameTree.refresh(tabId)` builds the initial tree.
 * 2. On webNavigation.onCommitted: `frameTree.refresh(tabId)` for ALL frames
 *    (not just frameId===0) keeps the tree current.
 * 3. On OBSERVED_EVENT: `frameTree.get(sender.frameId)` enriches the event
 *    with authoritative frame context — replacing the content script's
 *    limited single-parent view.
 *
 * ## Limitations
 *
 * - FrameTree knows URLs and parent-child relationships, NOT CSS selectors.
 *   For same-origin iframes, the top-frame content script reports precise
 *   CSS selectors via the hybrid locator strategy (Phase 4).
 * - The tree is point-in-time; between refreshes, rapidly created/destroyed
 *   frames may be missed. webNavigation.onDOMContentLoaded refreshes mitigate.
 *
 * Architecture: .drytis/IFRAME_ARCHITECTURE_ROADMAP.md §2
 */

// ── Types ─────────────────────────────────────────────────────────────

/**
 * A single frame node in the frame tree.
 */
export interface FrameNode {
  /** Chrome frame ID (0 = top frame). */
  frameId: number;
  /** Parent frame ID (-1 for the top frame). */
  parentFrameId: number;
  /** Full URL of this frame (from chrome.webNavigation). */
  url: string;
  /** Depth in the nesting (0 = top frame, 1 = child of top, etc.). */
  depth: number;
  /**
   * All ancestor frame IDs, outermost-first: [0, 3, 7] for a depth-2 frame
   * whose chain is: top(0) → outer(3) → inner(7).
   */
  ancestorFrameIds: number[];
  /**
   * URLs of all ancestors, parallel to ancestorFrameIds.
   * Used to build nested frameLocator() selectors.
   */
  ancestorUrls: string[];
}

/**
 * A frame selector reported by the top-frame content script for a
 * same-origin iframe. Merged into the FrameTree to provide precise
 * CSS-based selectors (replacing URL-guess fallbacks).
 */
export interface FrameSelectorEntry {
  /** CSS selector for the <iframe> element in the parent document. */
  frameSelector: string;
  /** The <iframe> element's name attribute, if any. */
  frameName: string | null;
  /** The <iframe> element's id attribute, if any. */
  frameId: string | null;
  /** 0-based index among siblings of the same tag. */
  frameIndex: number;
  /** The iframe's source URL (matches FrameNode.url for correlation). */
  frameSrc: string | null;
}

// ── FrameTree ─────────────────────────────────────────────────────────

export class FrameTree {
  /** frameId → FrameNode */
  private frames = new Map<number, FrameNode>();

  /** tabId → FrameTree instance (one per tab) */
  private static instances = new Map<number, FrameTree>();

  /**
   * Same-origin iframe selectors reported by the top-frame content script.
   * Keyed by URL for correlation with FrameNodes.
   */
  private selectorMap = new Map<string, FrameSelectorEntry>();

  // ── Instance Management ────────────────────────────────────────────

  /**
   * Get the FrameTree for a specific tab. Creates one if none exists.
   */
  static forTab(tabId: number): FrameTree {
    if (!this.instances.has(tabId)) {
      this.instances.set(tabId, new FrameTree());
    }
    return this.instances.get(tabId)!;
  }

  /**
   * Remove the FrameTree for a tab (on tab close or recording stop).
   */
  static clearTab(tabId: number): void {
    this.instances.delete(tabId);
  }

  /**
   * Clear all tab frame trees (on extension reload).
   */
  static clearAll(): void {
    this.instances.clear();
  }

  // ── Frame Tree Building ────────────────────────────────────────────

  /**
   * Refresh the frame tree from Chrome's webNavigation API.
   *
   * Called on recording start and on every navigation (all frames).
   * Builds the complete parent→child topology with ancestor chains.
   */
  async refresh(tabId: number): Promise<void> {
    let allFrames: chrome.webNavigation.GetAllFrameResultDetails[] | undefined;
    try {
      allFrames = await chrome.webNavigation.getAllFrames({ tabId });
    } catch {
      return; // tab may not exist or permission denied
    }
    if (!allFrames) return;

    // Build a lookup map for ancestor resolution
    const byId = new Map<number, chrome.webNavigation.GetAllFrameResultDetails>();
    for (const f of allFrames) {
      byId.set(f.frameId, f);
    }

    // Rebuild the frames map
    const newFrames = new Map<number, FrameNode>();

    for (const frame of allFrames) {
      const { frameId, parentFrameId, url } = frame;

      // Walk up the parent chain to build ancestor info
      const ancestorFrameIds: number[] = [];
      const ancestorUrls: string[] = [];
      let depth = 0;
      let current = frame;

      while (current.parentFrameId >= 0) {
        const parent = byId.get(current.parentFrameId);
        if (!parent) break; // orphaned frame — parent was destroyed
        ancestorFrameIds.unshift(parent.frameId);
        ancestorUrls.unshift(parent.url);
        depth++;
        current = parent;

        // Safety valve against cycles (shouldn't happen, but guard)
        if (depth > 20) break;
      }

      newFrames.set(frameId, {
        frameId,
        parentFrameId,
        url,
        depth,
        ancestorFrameIds,
        ancestorUrls,
      });
    }

    this.frames = newFrames;
  }

  // ── Lookup ─────────────────────────────────────────────────────────

  /**
   * Get the FrameNode for a Chrome frame ID.
   * Returns undefined for the top frame (frameId === 0) or unknown frames.
   */
  get(frameId: number): FrameNode | undefined {
    if (frameId === 0) return undefined; // top frame — no iframe context
    return this.frames.get(frameId);
  }

  /**
   * Get the full ancestor chain for a frame, outermost-first.
   * Returns an empty array for the top frame or unknown frames.
   *
   * Each element includes the selector if available from the hybrid map.
   */
  getAncestorChain(frameId: number): Array<FrameNode & { selector?: string; selectorStrategy?: string }> {
    const node = this.get(frameId);
    if (!node) return [];

    const chain: Array<FrameNode & { selector?: string; selectorStrategy?: string }> = [];

    // Walk ancestor frame IDs (outermost first).
    // Skip the top frame (frameId 0) — it's the page itself, not an iframe.
    for (let i = 0; i < node.ancestorFrameIds.length; i++) {
      const ancestorId = node.ancestorFrameIds[i];
      if (ancestorId === 0) continue; // skip top frame
      const ancestorUrl = node.ancestorUrls[i];
      const ancestorNode = this.frames.get(ancestorId);
      if (!ancestorNode) continue;

      const selectorEntry = ancestorUrl ? this.getSelectorForUrl(ancestorUrl) : undefined;

      chain.push({
        ...ancestorNode,
        selector: selectorEntry?.frameSelector,
        selectorStrategy: selectorEntry ? 'css' : undefined,
      });
    }

    // Include the immediate frame itself (the iframe the element lives in)
    const immediateSelector = node.url ? this.getSelectorForUrl(node.url) : undefined;
    chain.push({
      ...node,
      selector: immediateSelector?.frameSelector,
      selectorStrategy: immediateSelector ? 'css' : undefined,
    });

    return chain;
  }

  /**
   * Returns the immediate parent FrameNode (the iframe the element lives in).
   */
  getImmediateParent(frameId: number): FrameNode | undefined {
    return this.get(frameId);
  }

  /**
   * Check if a frame is the top frame.
   */
  isTopFrame(frameId: number): boolean {
    return frameId === 0;
  }

  /**
   * Get the total number of frames in the tree (for diagnostics).
   */
  get size(): number {
    return this.frames.size;
  }

  // ── Hybrid Selector Merge ──────────────────────────────────────────

  /**
   * URLs that are ambiguous — multiple iframes can share them.
   * For these, we store entries by CSS selector instead of URL to avoid
   * collisions where one srcdoc/blank iframe overwrites another.
   */
  private static readonly AMBIGUOUS_URLS = new Set([
    'about:srcdoc',
    'about:blank',
  ]);

  /**
   * Secondary map for ambiguous-URL iframes, keyed by CSS selector.
   * Allows lookup by selector when URL is not disambiguating.
   */
  private selectorByCssMap = new Map<string, FrameSelectorEntry>();

  /**
   * Merge same-origin iframe selectors reported by the top-frame content script.
   *
   * The content script scans `document.querySelectorAll('iframe')` and reports
   * each iframe's CSS selector, name, id, and src. The FrameTree correlates
   * these with Chrome frame IDs by URL matching.
   *
   * For ambiguous URLs (about:srcdoc, about:blank), entries are stored by
   * CSS selector to prevent collisions.
   *
   * This gives best-of-both-worlds:
   * - Same-origin iframes: precise CSS selectors from the content script
   * - Cross-origin iframes: URL-based selectors from the SW frame tree
   * - Ambiguous-URL iframes (srcdoc/blank): CSS-selector-keyed disambiguation
   */
  mergeSelectors(entries: FrameSelectorEntry[]): void {
    for (const entry of entries) {
      if (!entry.frameSrc) continue;

      if (FrameTree.AMBIGUOUS_URLS.has(entry.frameSrc)) {
        // Ambiguous URL — key by CSS selector to prevent collision
        if (entry.frameSelector) {
          this.selectorByCssMap.set(entry.frameSelector, entry);
        }
      } else {
        this.selectorMap.set(entry.frameSrc, entry);
      }
    }
  }

  /**
   * Look up a CSS selector for a frame URL (from the hybrid map).
   */
  getSelectorForUrl(url: string): FrameSelectorEntry | undefined {
    const direct = this.selectorMap.get(url);
    if (direct) return direct;

    // For ambiguous URLs, try to find a match in the CSS-selector map
    if (FrameTree.AMBIGUOUS_URLS.has(url)) {
      // Return the first entry — caller should prefer DOM-derived selector
      const entries = Array.from(this.selectorByCssMap.values());
      return entries[0];
    }

    return undefined;
  }

  /**
   * Clear selector map (called on refresh before content script re-reports).
   */
  clearSelectors(): void {
    this.selectorMap.clear();
    this.selectorByCssMap.clear();
  }
}
