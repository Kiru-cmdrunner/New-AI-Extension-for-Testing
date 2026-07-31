# Iframe Architecture Roadmap

> **Goal**: Build a frame-aware recording architecture that reliably captures
> and replays interactions across the broadest range of iframe scenarios,
> moving frame awareness from the content script (cross-origin-limited) to the
> service worker (Chrome API — sees all frames regardless of origin).

---

## Current State Summary

| Capability | Status |
|-----------|--------|
| Same-origin iframe event capture | ✅ Works |
| Cross-origin iframe event capture | ⚠️ Events captured, identity degraded |
| Cross-origin frame locator resolution | ⚠️ Falls back to URL partial match |
| Nested iframe codegen (depth > 1) | ❌ Single frameLocator only |
| about:blank / srcdoc iframes | ❌ No content script injection |
| Dynamic iframe detection | ❌ No MutationObserver for iframes |
| Executor replay into iframes | ❌ executeScript missing allFrames |
| Navigation inside iframes | ❌ Explicitly filtered (frameId !== 0) |
| Popup / new-tab recording | ❌ No support |
| Frame tree correlation | ❌ SW has no frame awareness |

---

## Architecture: Service-Worker Frame Tree

### Core Principle

**The service worker is the only component that can see the complete frame
tree.** Chrome's `chrome.webNavigation.getAllFrames(tabId)` returns every
frame in a tab — its URL, frame ID, parent frame ID — regardless of origin.
The content script inside a cross-origin iframe cannot read its parent's DOM,
but the service worker doesn't need to — it already knows the frame tree.

### Data Model: FrameTree

```typescript
interface FrameNode {
  /** Chrome frame ID (0 = top frame). */
  frameId: number;
  /** Parent frame ID (-1 for top frame). */
  parentFrameId: number;
  /** Full URL of this frame. */
  url: string;
  /** Depth in the nesting (0 = top, 1 = child of top, etc.). */
  depth: number;
  /** All ancestor frame IDs, root-first: [0, 3, 7] for depth-2 frame. */
  ancestorFrameIds: number[];
  /** Corresponding URLs of ancestors (parallel to ancestorFrameIds). */
  ancestorUrls: string[];
}
```

### Frame Tree Lifecycle

```
1. onRecordingStart(tabId):
   - chrome.webNavigation.getAllFrames(tabId) → build initial FrameTree
   - Listen to chrome.webNavigation.onCommitted (ALL frames, not just frameId===0)
   - Listen to chrome.webNavigation.onBeforeNavigate (detect frame removal)

2. onFrameNavigation(details):
   - Update FrameTree[details.frameId] with new URL
   - If new frame (unseen frameId): add to tree, compute depth from parent chain
   - Emit synthetic frame-navigation event if inside an active session

3. onEventfromContentScript(observedEvent, sender):
   - sender.tab.frameId gives the Chrome frame ID
   - Enrich the event with FrameTree[frameId] context
   - This replaces the content-script-based iframe context extraction
```

---

## Implementation Phases

### Phase 1: Fix Critical Bugs (Low effort, high impact)

#### 1a. Manifest: Add `match_about_blank` and `match_origin_as_fallback`

```jsonc
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["src/recorder/phase5/recorder-entry.ts"],
  "all_frames": true,
  "match_about_blank": true,
  "match_origin_as_fallback": true,
  "run_at": "document_start"
}]
```

**Impact**: `about:blank`, `srcdoc`, `javascript:`, and `data:` iframes
(rich-text editors, ad iframes, popup helper frames) now get content scripts.

#### 1b. Executor: Add `allFrames: true` to executeScript

```typescript
// ir-executor-impl.ts
await chrome.scripting.executeScript({
  target: { tabId, allFrames: true },  // ← ADD allFrames
  files: ['src/execution/executor-content-script.js'],
});
```

**Impact**: Extension's in-browser test executor can now reach iframe targets.

#### 1c. Fix programmatic re-injection to inject ALL content scripts

```typescript
// service-worker.ts — injectContentScript
async function injectContentScript(tabId: number): Promise<boolean> {
  const manifest = chrome.runtime.getManifest();
  const allEntries = manifest.content_scripts?.flatMap(cs => cs.js ?? []) ?? [];
  for (const file of allEntries) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [file],
    });
  }
  return true;
}
```

**Impact**: After extension reload, all content scripts re-injected into all frames.

---

### Phase 2: Service-Worker Frame Tree (Medium effort, high impact)

#### 2a. Build FrameTree in the service worker

```typescript
class FrameTree {
  private frames = new Map<number, FrameNode>();

  async refresh(tabId: number): Promise<void> {
    const allFrames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!allFrames) return;

    // Build parent→children map
    const byId = new Map(allFrames.map(f => [f.frameId, f]));

    for (const frame of allFrames) {
      const ancestors: number[] = [];
      const ancestorUrls: string[] = [];
      let depth = 0;
      let current = frame;

      while (current.parentFrameId >= 0) {
        const parent = byId.get(current.parentFrameId);
        if (!parent) break;
        ancestors.unshift(parent.frameId);
        ancestorUrls.unshift(parent.url);
        depth++;
        current = parent;
      }

      this.frames.set(frame.frameId, {
        frameId: frame.frameId,
        parentFrameId: frame.parentFrameId,
        url: frame.url,
        depth,
        ancestorFrameIds: ancestors,
        ancestorUrls,
      });
    }
  }

  get(frameId: number): FrameNode | undefined {
    return this.frames.get(frameId);
  }

  /** Returns the full chain of ancestor URLs for building frameLocator nesting. */
  getAncestorChain(frameId: number): FrameNode[] {
    const node = this.frames.get(frameId);
    if (!node) return [];
    const chain: FrameNode[] = [];
    for (const ancestorId of node.ancestorFrameIds) {
      const ancestor = this.frames.get(ancestorId);
      if (ancestor) chain.push(ancestor);
    }
    return chain;
  }
}
```

#### 2b. Enrich events with frame tree context

When the SW receives an `OBSERVED_EVENT` message, use `sender.tab.frameId`
to look up the FrameNode. Attach the full ancestor chain to the event's
`IframeContext` — replacing the content-script's limited single-parent view.

```typescript
function enrichWithFrameTree(event: ObservedEvent, sender: chrome.runtime.MessageSender) {
  const frameId = sender.frameId ?? 0;
  const node = frameTree.get(frameId);
  if (!node || frameId === 0) return; // top frame, no enrichment needed

  // Override the content-script's iframeContext with SW's authoritative data
  event.target.iframeContext = {
    frameSrc: node.url,
    frameName: null,           // SW doesn't have this (DOM attribute)
    frameId: null,             // SW has Chrome frameId, not HTML id attr
    frameSelector: null,       // SW can't inspect parent DOM
    frameXPath: null,
    frameIndex: null,
    frameDepth: node.depth,
    // NEW: ancestor chain for nested codegen
    ancestorUrls: node.ancestorUrls,
    ancestorFrameIds: node.ancestorFrameIds,
  } as IframeContext;
}
```

#### 2c. Allow iframe navigations in webNavigation handler

```typescript
chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Update frame tree for ALL navigations (not just frameId === 0)
  await frameTree.refresh(details.tabId);

  // Only emit synthetic navigation events for top-frame navigations
  // (iframe navigations are handled by the frame tree refresh)
  if (details.frameId !== 0) return;

  // ... existing navigation handling ...
});
```

---

### Phase 3: Nested Iframe Codegen (Medium effort, high impact)

#### 3a. Extend ResolvedFrame to carry ancestor chain

```typescript
export interface ResolvedFrame {
  /** Selector for the immediate parent iframe. */
  readonly selector: string;
  readonly strategy: 'css' | 'name' | 'url' | 'index';
  readonly frameSrc?: string;
  readonly depth: number;

  /** Ancestor frame selectors, outermost-first. For nested iframes. */
  readonly ancestors?: ReadonlyArray<{
    selector: string;
    strategy: 'css' | 'name' | 'url' | 'index';
    frameSrc?: string;
  }>;
}
```

#### 3b. IR Bridge: resolve ancestor chain

When the FrameTree provides `ancestorUrls`, resolve each ancestor into a
selector using the same priority chain (CSS > name > url > index).

#### 3c. Playwright adapter: chain frameLocators

```typescript
function elementExpression(step: IRStep, pageVar: string): string {
  const rendered = renderLocator(step.target.resolvedLocators, pageVar);

  if (step.frame) {
    let prefix = pageVar;

    // Chain ancestor frameLocators (outermost first)
    if (step.frame.ancestors) {
      for (const ancestor of step.frame.ancestors) {
        prefix += `.frameLocator('${escapeString(ancestor.selector)}')`;
      }
    }

    // Immediate parent frameLocator
    prefix += `.frameLocator('${escapeString(step.frame.selector)}')`;

    return `${prefix}.${rendered.expression}`;
  }

  return `${rendered.pageRef}.${rendered.expression}`;
}
```

**Generated code for nested iframes:**
```typescript
// depth=2: top → outer iframe → inner iframe → element
await page
  .frameLocator('iframe[src*="payment"]')
  .frameLocator('iframe[name="card-form"]')
  .getByRole('textbox', { name: 'Card Number' })
  .fill('4242424242424242');
```

---

### Phase 4: Hybrid Frame Locator Strategy (Medium effort)

### The Problem

For same-origin iframes, the content script provides a precise CSS selector
(`iframe#payment`). For cross-origin iframes, only `frameSrc` (URL) is
available, producing fragile `iframe[src*="..."]` selectors.

### The Solution: Merge content-script + SW data

The SW knows the frame tree (URLs, frame IDs, depths) but not the DOM.
The content script inside the iframe knows its own URL but can't read the
parent's DOM (cross-origin).

**Bridge: same-origin content script enriches SW frame tree.**

When the top-frame content script starts, it scans for all same-origin
iframes and reports their selectors to the SW:

```typescript
// In top-frame content script (on init):
function reportSameOriginIframes() {
  const iframes = document.querySelectorAll('iframe');
  const report = Array.from(iframes).map((iframe, i) => ({
    frameSelector: generateCssSelector(iframe),
    frameName: iframe.name || null,
    frameId: iframe.id || null,
    frameIndex: i,
    // Try to match the iframe's URL to a Chrome frameId
    // by checking contentWindow.location.href
    frameSrc: (() => {
      try { return iframe.contentWindow?.location?.href ?? null; }
      catch { return null; } // cross-origin
    })(),
  })).filter(r => r.frameSrc); // only same-origin iframes have frameSrc

  chrome.runtime.sendMessage({ type: 'IFRAME_SELECTORS', payload: report });
}
```

The SW merges this into the FrameTree: for each frame whose URL matches a
reported iframe, override the URL-based selector with the precise CSS selector.

**This gives best-of-both-worlds:**
- Same-origin iframes: precise CSS selectors from content script
- Cross-origin iframes: URL-based selectors from SW frame tree
- Nested iframes: ancestor chain from SW frame tree + same-origin enrichment where available

---

### Phase 5: Popup / New-Tab Recording (High effort)

### 5a. Capture

```typescript
// In SW:
chrome.tabs.onCreated.addListener((tab) => {
  if (!isRecording) return;
  // Propagate recording to the new tab
  chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING', sessionId: currentSessionId });
  // Track as a child context of the opener tab
  popupContexts.set(tab.id, { openerTabId: tab.openerTabId, sessionId: currentSessionId });
});
```

### 5b. Codegen

```typescript
// Playwright:
const popupPromise = page.waitForEvent('popup');
await page.getByRole('button', { name: 'Open' }).click();
const popup = await popupPromise;
await popup.getByRole('textbox', { name: 'Email' }).fill('test@example.com');
```

### 5c. Limitations
- `window.open` with features (width/height) creates a window, not a tab —
  requires `chrome.windows` API tracking.
- Multiple popups from the same page need careful ordering.
- Popup → opener communication (postMessage) is not captured.

---

## Priority Matrix

| Phase | Effort | Impact | Priority |
|-------|--------|--------|----------|
| 1a. Manifest fix (`match_about_blank`) | Trivial | High | **P0** |
| 1b. Executor `allFrames` fix | Trivial | High | **P0** |
| 1c. Fix re-injection (all scripts) | Trivial | Medium | **P0** |
| 2a-c. SW Frame Tree | Medium | High | **P1** |
| 3a-c. Nested iframe codegen | Medium | Medium | **P2** |
| 4. Hybrid locator strategy | Medium | High | **P2** |
| 5. Popup/new-tab recording | High | Medium | **P3** |

---

## What Cannot Be Solved

| Scenario | Reason | Workaround |
|----------|--------|------------|
| Sandboxed iframe without `allow-scripts` | Browser blocks all JS execution | None — user must add `allow-scripts` |
| Cross-origin iframe parent DOM inspection | Same-origin policy | SW frame tree provides URL-based identification |
| Shadow DOM inside cross-origin iframe | Content script sees it, but parent can't | Content script inside the frame handles it |
| `postMessage` between frames | Not a DOM interaction | Not in scope (data flow, not user interaction) |

---

## Validation Checklist

After implementation, verify:

- [ ] Same-origin iframe: precise CSS selector in `frameLocator()`
- [ ] Cross-origin iframe: URL-based selector in `frameLocator()`
- [ ] Nested iframe (depth 2): chained `frameLocator().frameLocator()`
- [ ] Dynamic iframe (created after page load): events captured
- [ ] `about:blank` iframe: content script injected
- [ ] `srcdoc` iframe: content script injected
- [ ] Navigation inside iframe: synthetic navigation event emitted
- [ ] Mixed parent ↔ iframe interactions: correct frame context per step
- [ ] Executor replay reaches iframe targets
- [ ] No regressions in top-frame recording
