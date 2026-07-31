# Iframe Architecture Phases 1-4

## Overview

Implemented the service-worker frame tree architecture that moves frame
awareness from the content script (cross-origin-limited) to the service
worker (Chrome API — sees all frames regardless of origin).

## Phase 1: Critical Bug Fixes (3 one-liners)

### 1a. Manifest: match_about_blank + match_origin_as_fallback
- File: `src/manifest.json`
- Both content_scripts entries now have `match_about_blank: true` and `match_origin_as_fallback: true`
- Impact: `about:blank`, `srcdoc`, `javascript:`, `data:` iframes now receive content scripts

### 1b. Executor: allFrames: true
- File: `src/execution/ir-executor-impl.ts` line 114
- Added `allFrames: true` to `chrome.scripting.executeScript` target
- Impact: Extension's in-browser test executor can now reach iframe targets

### 1c. Re-injection: all content scripts
- File: `src/background/service-worker.ts` injectContentScript()
- Changed from `content_scripts[0].js[0]` to `flatMap(cs => cs.js)` — injects ALL scripts
- Impact: After extension reload, both recorder-entry.ts AND control-recorder.ts are re-injected

### 1d. webNavigation: refresh frame tree for ALL navigations
- File: `src/background/service-worker.ts` webNavigation.onCommitted handler
- Added FrameTree.refresh() before the `frameId !== 0` early return
- Impact: Frame tree stays current for iframe navigations; synthetic nav events still only for top frame

## Phase 2: Service-Worker Frame Tree

### FrameTree class
- File: `src/background/frame-tree.ts` (282 lines, new)
- Uses `chrome.webNavigation.getAllFrames(tabId)` to build complete frame topology
- Tracks: frameId, parentFrameId, url, depth, ancestorFrameIds, ancestorUrls
- Per-tab isolation via static `instances` Map
- Hybrid selector merge: top-frame content script reports CSS selectors, SW correlates by URL

### Event enrichment
- File: `src/background/service-worker.ts` handleObservedEvent()
- Now accepts `sender: chrome.runtime.MessageSender`
- Uses `sender.tab.frameId` to look up FrameTree and enrich event with authoritative frame data
- Populates `swFrameId`, `swDepth`, `swAncestorUrls` on IframeContext

### Type extension
- File: `src/shared/types.ts` IframeContext
- Added: `swFrameId?`, `swDepth?`, `swAncestorUrls?`

## Phase 3: Nested Iframe Codegen

### ResolvedFrame with ancestors
- File: `src/domain/execution-ir/types.ts`
- Added `ancestors?: ReadonlyArray<{selector, strategy, frameSrc}>` to ResolvedFrame

### IR Bridge ancestor resolution
- File: `src/generation/ir-bridge.ts` resolveFrame()
- Reads `swAncestorUrls` from IframeContext
- Slices to exclude top frame (index 0) and immediate parent (last index)
- Produces ancestor chain of intermediate iframes

### Playwright chained frameLocator()
- File: `src/adapters/playwright/action-renderer.ts` elementExpression()
- Chains ancestor frameLocators before immediate parent: `page.frameLocator(outer).frameLocator(inner).getByRole(...)`

## Phase 4: Hybrid Locator Strategy

### Top-frame iframe selector reporting
- File: `src/recorder/phase5/recorder-entry.ts`
- `reportSameOriginIframeSelectors()` runs only in top frame
- Scans `document.querySelectorAll('iframe')`, reads CSS selector/name/id/src
- Sends `IFRAME_SELECTORS` message to SW
- SW merges into FrameTree via `mergeSelectors()` — correlates by URL
- MutationObserver re-reports on dynamic iframe additions
- `generateIframeSelector()` priority: id > name > data-testid > nth-of-type

## Acceptance Criteria

- [ ] Manifest has match_about_blank and match_origin_as_fallback on both content_scripts
- [ ] Executor executeScript includes allFrames: true
- [ ] injectContentScript iterates all content_scripts[].js entries
- [ ] webNavigation handler refreshes frame tree before frameId !== 0 early return
- [ ] FrameTree class builds correct topology from chrome.webNavigation.getAllFrames
- [ ] FrameTree handles nested iframes with correct ancestor chains
- [ ] FrameTree skips top frame (frameId 0) in getAncestorChain
- [ ] Events enriched with swFrameId, swDepth, swAncestorUrls when sender.frameId is available
- [ ] IframeContext type has swFrameId, swDepth, swAncestorUrls fields
- [ ] ResolvedFrame has optional ancestors field
- [ ] IR Bridge resolves ancestor chain from swAncestorUrls
- [ ] Playwright adapter chains frameLocators for ancestors
- [ ] Content script reports same-origin iframe selectors to SW
- [ ] SW IFRAME_SELECTORS handler merges selectors into FrameTree
- [ ] MutationObserver re-reports on dynamic iframe changes
- [ ] Zero regressions in existing iframe codegen tests
- [ ] Full suite passes
