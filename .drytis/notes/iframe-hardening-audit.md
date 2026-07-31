# Iframe Architecture Production Audit — Validation & Hardening

## Date: 2025-07-31
## Commit: f981613 (origin/main)

## Audit Results: 10 issues reported → 6 confirmed bugs → 4 not bugs

### Confirmed Bugs (Fixed)

| # | Issue | Severity | Fix |
|---|-------|----------|-----|
| 4 | CSS.escape crash in SW (no DOM) | CRITICAL | cssEscape() polyfill with guarded `typeof CSS` check + global regex fallback |
| 2 | MutationObserver DOS on all DOM mutations | CRITICAL | iframe-only mutation filter + 250ms trailing debounce |
| 1 | FrameTree instances never cleaned up | HIGH | chrome.tabs.onRemoved listener calls FrameTree.clearTab() |
| 3 | srcdoc/about:blank iframes collide in selectorMap | HIGH | Separate selectorByCssMap keyed by CSS selector for ambiguous URLs |
| 5 | extractUrlFragment drops query params | HIGH | Include first query param key=value in selector for disambiguation |
| 6 | webNavigation triggers immediate getAllFrames per nav | MEDIUM | 100ms per-tab trailing debounce via scheduleFrameTreeRefresh() |

### Not Bugs (4 issues dismissed)

| # | Issue | Why not a bug |
|---|-------|---------------|
| 7 | sender.frameId undefined | sender always provided in production by chrome.runtime.onMessage. Optional chaining guard is correct. |
| 8 | IFRAME_SELECTORS fire-and-forget | Advisory enrichment by design. Falls back to URL-based selectors gracefully. |
| 9 | swDepth vs frameDepth discrepancy | Both values come from same FrameTree.get() call in enriched path. No divergence. |
| 10 | No page.frame() URL fallback | CSS frameLocator() is Playwright's recommended pattern. page.frame() enhancement is future work. |

## Key Design Decision: SW Frame Tree is the Right Pattern
The service worker's chrome.webNavigation.getAllFrames() sees ALL frames regardless of origin.
Content scripts can't see cross-origin parents. The SW frame tree enrichment is the correct
architectural choice — the hardening fixes make it production-ready.

## Reviewer WARN (Also Fixed)
CSS_ESCAPE_RE used non-global regex with String.replace — only escaped first special char.
Fix: split into CSS_UNSAFE_CHAR_RE (non-global, for .test()) and inline /g regex in polyfill
for .replace(). Added test verifying 'a:b:c' escapes all 2 colons.

## Test Coverage
- 16 new tests in iframe-hardening.test.ts
- 15 existing iframe-codegen tests pass (no regression)
- 18 existing frame-tree tests pass (no regression)
- Full suite: 4,622 pass, 1 pre-existing JSDOM timing flake
