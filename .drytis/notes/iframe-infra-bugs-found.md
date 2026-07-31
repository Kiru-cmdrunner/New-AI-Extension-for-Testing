# Iframe Infrastructure Bugs Found During P0-11 Audit

## Date: 2026-07-31

## Critical Bugs (Pre-existing, not introduced by P0-11)

### 1. Manifest missing `match_about_blank` and `match_origin_as_fallback`
- **File**: `src/manifest.json`
- **Impact**: `about:blank`, `srcdoc`, `javascript:`, and `data:` iframes never receive content scripts. Rich-text editor helper frames (TinyMCE), ad iframes, popup helper frames are invisible to the recorder.
- **Fix**: Add `"match_about_blank": true, "match_origin_as_fallback": true` to both content_scripts entries.

### 2. Executor `executeScript` missing `allFrames`
- **File**: `src/execution/ir-executor-impl.ts` line 114
- **Impact**: Extension's in-browser test executor only injects into top frame. Generated Playwright tests with `frameLocator()` work in external Playwright runner, but extension's own executor silently fails on iframe targets.
- **Fix**: Add `allFrames: true` to the `target` object.

### 3. Programmatic re-injection only injects first content script
- **File**: `src/background/service-worker.ts` lines 94-109
- **Impact**: `injectContentScript()` reads `manifest.content_scripts?.[0]?.js?.[0]` — only injects `recorder-entry.ts`, never `control-recorder.ts`. After extension reload/recovery, the V2 control recorder is missing.
- **Fix**: Iterate all `content_scripts[].js[]` entries.

### 4. Navigation handler drops all iframe navigations
- **File**: `src/background/service-worker.ts` line 708
- **Code**: `if (details.frameId !== 0) return;`
- **Impact**: SPA navigations inside iframes are not recorded. The content script inside the iframe may capture the URL change, but no synthetic navigation event is generated.
- **Fix**: Keep the filter for synthetic navigation events (only top-frame navigations should create test steps), but update the frame tree for ALL navigations.

### 5. V2 element-identity-builder depth calculation inconsistency
- **File**: `src/recorder/v2/element-identity-builder.ts` lines 95-98
- **Impact**: Initializes depth=0 and walks from window.parent, computing depth differently from the active identity-extractor.ts (which initializes depth=1). Only affects V2 control recorder path.
- **Fix**: Align initialization with identity-extractor.ts.

## Design Document
See: `/workspace/.drytis/IFRAME_ARCHITECTURE_ROADMAP.md` for the full architectural roadmap.
