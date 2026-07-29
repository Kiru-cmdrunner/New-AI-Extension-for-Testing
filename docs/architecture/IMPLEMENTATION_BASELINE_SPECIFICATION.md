# Implementation Baseline Specification

**Version:** 1.0
**Date:** 2026-06-20
**Baseline Commit:** `e7a5e9b` (docs: implementation baseline & target architecture document)
**Latest Commit:** `77aa1d6` (fix: wire surface-anchored detection into 7bfd949 pipeline)
**Status:** FROZEN — This document defines the authoritative development baseline. No changes to the baseline structure without updating this document first.

---

## 1. Branch of Truth

| Property | Value |
|----------|-------|
| **Branch** | `master` |
| **Remote** | `origin` (workspace-managed Gitea repo) |
| **Upstream** | `upstream` → `https://github.com/<user>/<repo>` on branch `fix/calendar-dropdown-modern-app` |
| **Integration Point** | Commit `35fd884` — merge of `7bfd949` (upstream working commit) into `master` (surface-anchored detection branch) |
| **Latest Working Commit** | `77aa1d6` — fix: wire surface-anchored detection into 7bfd949 pipeline |

### Branch Rules

1. **All development commits go to `master`.** No feature branches, no parallel branches.
2. **Upstream sync** is done only by the leader via `git_manager` — never by a contributor directly.
3. **No force push.** Ever. If a push is rejected, fetch → rebase → push.
4. **No rebase of already-pushed commits.** Amend only locally before pushing.
5. **Every commit must leave the build green** (`npm run build` succeeds, `npm test` passes with no new failures).

---

## 2. Build Path of Truth

| Property | Value |
|----------|-------|
| **Build command** | `npm run build` |
| **Build tool** | Vite (`vite build`) |
| **Build config** | `vite.config.ts` |
| **Output directory** | `dist/` |
| **Expected output** | ~20 files, ~145 KB, built in ~3-5s |
| **Manifest version** | `10.9.0` (in both `src/manifest.json` and `dist/manifest.json`) |

### Build Verification

After every build, verify:
```bash
# 1. Build succeeds
npm run build 2>&1 | tail -5

# 2. Manifest version is correct
grep '"version"' dist/manifest.json
# Expected: "version": "10.9.0"

# 3. Key files exist
ls -la dist/manifest.json dist/service-worker.js dist/content/recorder-entry.js dist/sidepanel/index.html

# 4. No TypeScript errors leaked
grep -r "error TS" /tmp/last-build.log || echo "No TS errors"
```

---

## 3. Extension Package of Truth

| Property | Value |
|----------|-------|
| **Source** | `dist/` directory (the Vite build output) |
| **Packaging** | `zip -r cmdrunner-extension-v10.9.0.zip dist/` |
| **Served from** | `download/` and `downloads/` directories (Caddy proxies on ports 8888/8889) |
| **Download URL pattern** | `https://new-cmdrunner-ai-ext-upxqyy.drytis.dev/download/cmdrunner-extension-v10.9.0.zip` |
| **Version in side panel** | Footer shows `v10.9.0 · Component Runtime` |

### Packaging Rules

1. **Always rebuild before packaging.** Never package stale `dist/`.
2. **Always version-stamp the zip filename.** Format: `cmdrunner-extension-v<version>-<descriptor>.zip`.
3. **Always copy to both `download/` and `downloads/`** — both Caddy proxies serve different ports.
4. **Always verify HTTP 200** on the download URL before telling the user it's ready.
5. **Never serve from `src/`** — only built, minified `dist/` output.

### How to Verify Testing the Latest Extension

```bash
# 1. Rebuild from source
npm run build

# 2. Package
python3 -c "
import zipfile, os
with zipfile.ZipFile('cmdrunner-extension-v10.9.0.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk('dist'):
        for f in files:
            path = os.path.join(root, f)
            z.write(path, os.path.relpath(path, 'dist'))
print('Created cmdrunner-extension-v10.9.0.zip')
"

# 3. Deploy to download paths
cp cmdrunner-extension-v10.9.0.zip download/
cp cmdrunner-extension-v10.9.0.zip downloads/

# 4. Verify served
curl -sf -o /dev/null -w '%{http_code}' \
  https://new-cmdrunner-ai-ext-upxqyy.drytis.dev/download/cmdrunner-extension-v10.9.0.zip
# Expected: 200
```

---

## 4. Active Pipeline of Truth

The recording → semantic → code generation pipeline as it runs at commit `77aa1d6`:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CONTENT SCRIPT (in page)                         │
│                                                                         │
│  recorder-entry.ts                                                      │
│    ├── EventTap         → captures pointer/keyboard/focus events       │
│    ├── IdentityExtractor → resolves click targets, extracts identity   │
│    ├── DomContextExtractor → extracts DOM context + surface detection   │
│    ├── ComponentRuntime → 13 definitions, classifies raw events        │
│    └── → sends OBSERVED_EVENT messages to service worker               │
│                                                                         │
│  control-recorder.ts ← DEAD (sends RECORDED_EVENT, SW doesn't handle)  │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ Chrome messaging
┌─────────────────────────────────▼───────────────────────────────────────┐
│                      SERVICE WORKER (background)                        │
│                                                                         │
│  service-worker.ts                                                      │
│    stopRecording()                                                      │
│    ├── 1. filterProductionInteractions(ComponentInteraction[])          │
│    ├── 2. Extract ObservedEvent[] from triggerEvent + memberEvents      │
│    ├── 3. Convert ObservedEvent[] → RecordedEvent[]                    │
│    ├── 4. Classifier selection (recorderEngine setting)                 │
│    │   ├── Control path: classifyControlInteractions()                 │
│    │   └── Legacy path:  detectInteractions() + detectInteractionsV2() │
│    │                       + mergeV1V2()                                │
│    ├── 5. reasonAboutInteractions() → UnderstandingResult              │
│    │   └── SemanticReasoner: dropdown / datePicker / autocomplete /     │
│    │       multiConfig / formSubmit session types                      │
│    ├── 6. runPipeline() → recognition + enrichment                     │
│    ├── 7. buildIRPlan() → IRBridgeInput → IR actions                   │
│    ├── 8. PlaywrightCodeGenerator → Playwright code string             │
│    ├── 9. persistSession() → Repository V2 (Dexie/IndexedDB)            │
│    └── 10. healing-service → cross-session locator healing              │
│                                                                         │
│  Side panel receives ComponentInteraction[] for UI display              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Pipeline Verification Points

| Step | How to verify it ran |
|------|---------------------|
| 1. filterProductionInteractions | Check `interactions.length` in console |
| 2. ObservedEvent extraction | Check `recordedEvents.length` in console |
| 3. RecordedEvent conversion | Check no empty arrays reach classifier |
| 4. Classifier selection | Check `recorderEngine` value in settings |
| 5. Semantic reasoning | Check `understandingResult` is non-null |
| 6. Recognition/enrichment | Check `enrichedInteractions` length |
| 7. IR plan | Check `irPlan.actions.length` > 0 |
| 8. Code generation | Check generated code string is non-empty |
| 9. Persistence | Check Dexie database in DevTools > Application |
| 10. Healing | Check `healing-service` log output |

---

## 5. Source-of-Truth Modules

### 5.1 Active Modules (Source of Truth)

| Module | Path | Responsibility | Status |
|--------|------|----------------|--------|
| **EventTap** | `src/tap/event-tap.ts` | Capture raw DOM events (click, input, focus, keydown, scroll) | ✅ Active |
| **Identity Extractor** | `src/tap/identity-extractor.ts` | Resolve click targets, extract ElementIdentity | ✅ Active |
| **DOM Context Extractor** | `src/definitions/dom-context-extractor.ts` | Extract DomContext (includes surface detection) | ✅ Active |
| **Component Runtime** | `src/definitions/index.ts` + 13 definition files | Classify raw events into ComponentInteraction | ✅ Active |
| **Interaction Types** | `src/classifier/interaction-types.ts` | InteractionType enum, InteractionMetadata, DetectedInteraction | ✅ Active |
| **Interaction Detector** | `src/classifier/interaction-detector.ts` | V1/V2 classifier — detectInteractions, mergeV1V2 | ✅ Active |
| **Panel/Form Detectors** | `src/classifier/semantic/panel-form-detectors.ts` | multiConfig activation + absorption logic | ✅ Active |
| **Semantic Reasoner** | `src/classifier/semantic/reasoner.ts` | 5 session types: dropdown, datePicker, autocomplete, multiConfig, formSubmit | ✅ Active |
| **Recognition Pipeline** | `src/classifier/recognition/` | 7 pattern files — enrich interactions with recognition data | ✅ Active |
| **Evidence Providers** | `src/classifier/evidence/providers/` | 5 evidence channels (A-E) — collect UI state evidence | ✅ Active (legacy path only) |
| **IR Bridge** | `src/generation/ir-bridge.ts` | Convert UnderstandingResult + interactions → IR actions | ✅ Active |
| **IR Code Generator** | `src/generation/ir-code-generator.ts` | Interface for code generation | ✅ Active (interface) |
| **Playwright Code Generator** | `src/generation/playwright-code-generator.ts` | Generate Playwright test code from IR | ✅ Active |
| **Playwright Adapters** | `src/adapters/playwright/` | 6 files — project generator + action renderers | ✅ Active |
| **Repository V2** | `src/repository/v2/` | Dexie/IndexedDB persistence — 8 repositories | ✅ Active |
| **Repository Services** | `src/repository/services/` | Persistence, capability matching, healing | ✅ Active |
| **Healing Service** | `src/repository/services/healing-service.ts` | Cross-session locator healing | ✅ Active |
| **Domain Entities** | `src/domain/entities/` | 14 entity files — Capability, Locator, etc. | ✅ Active |
| **Shared Types** | `src/shared/types.ts` | ElementIdentity, UIState, StorageKeys (canonical) | ✅ Active |
| **Component Types** | `src/shared/component-types.ts` | ObservedEvent, ComponentInteraction, DomContext | ✅ Active |
| **Service Worker** | `src/background/service-worker.ts` | Pipeline orchestration | ✅ Active |
| **Side Panel** | `src/sidepanel/` | UI for reviewing recorded interactions | ✅ Active |
| **Settings** | `src/settings/` | Settings page (includes recorderEngine toggle) | ✅ Active |
| **Storage Service** | `src/storage/storage-service.ts` | Chrome storage abstraction | ✅ Active |

### 5.2 Dead Modules (Scheduled for Deletion — Phase 1)

| Module | Path | Lines | Why Dead |
|--------|------|-------|----------|
| Deterministic Recorder | `src/recorder/deterministic-recorder.ts` | 3079 | Not loaded by manifest; superseded by recorder-entry.ts |
| Legacy Interaction Types | `src/recorder/interaction-types.ts` | ~200 | Superseded by classifier/interaction-types.ts |
| Recording Session | `src/recorder/recording-session.ts` | ~500 | Legacy session manager; not used |
| Element ID Generator | `src/recorder/element-id-generator.ts` | ~100 | Unused |
| Step ID Generator | `src/recorder/step-id-generator.ts` | ~100 | Unused |
| Surface Detector | `src/recorder/surface-detector.ts` | ~200 | Duplicated in dom-context-extractor.ts |
| Control Recorder (content script) | `src/recorder/v2/control-recorder.ts` | ~800 | Sends RECORDED_EVENT; SW doesn't handle it |
| Control Model | `src/recorder/v2/control-model.ts` | ~300 | Used only by control-recorder.ts |
| Element Identity Builder | `src/recorder/v2/element-identity-builder.ts` | ~400 | Dead; identity extraction in identity-extractor.ts |
| Framework Adapters | `src/recorder/v2/framework-adapters.ts` | ~200 | Dead; not imported anywhere active |
| V2 Identity Extractor | `src/recorder/v2/identity-extractor.ts` | ~300 | Dead; superseded by tap/identity-extractor.ts |
| Modal Tracker | `src/runtime/modal-tracker.ts` | ~150 | Dormant — not instantiated |
| Pipeline Blueprint | `src/pipeline/` | 34 files | Entire blueprint architecture; not loaded by manifest |
| Legacy Types | `src/types/` | 8 files | Only imported by src/pipeline/ |
| Build Artifacts | `tmp-build/`, `extension-zip/` | — | Full project snapshots; not source |

### 5.3 Future Modules (Not Yet Built)

| Module | Path (planned) | Responsibility | Phase |
|--------|----------------|----------------|-------|
| SemanticInteraction (frozen contract) | `src/semantic/semantic-interaction.ts` | Unified interaction model (merges DetectedInteraction + ComponentInteraction) | Phase 0 |
| Surface Context Resolver | `src/tap/surface-resolver.ts` | Resolve surface membership for absorption decisions | Phase 0 |
| Stepper Detector | `src/classifier/semantic/stepper-detector.ts` | Detect +/- stepper controls and extract field name + direction | Phase 0 |
| AI Test Generator | `src/ai/test-generator.ts` | Generate test scenarios from semantic interactions + capabilities | Phase 4 |
| Execution Engine Manager | `src/execution/engine-manager.ts` | Multi-engine execution (Playwright, Cypress, etc.) | Phase 5 |
| Evidence Aggregator | `src/evidence/aggregator.ts` | Consolidate evidence from all channels into structured report | Phase 6 |
| AI Failure Analyzer | `src/ai/failure-analyzer.ts` | Analyze execution failures + evidence → root cause hypothesis | Phase 7 |
| Self-Healing Runtime | `src/healing/runtime-healer.ts` | Runtime locator healing during execution | Phase 8 |
| Continuous Learning | `src/learning/continual-learner.ts` | Update Capability invariants from execution outcomes | Phase 9 |

---

## 6. Ownership of Every Engine

### Engine Ownership Matrix

| Engine | Owns (files) | Does NOT Own | Dependencies (upstream) | Dependencies (downstream) |
|--------|-------------|--------------|------------------------|--------------------------|
| **EventTap** | `src/tap/event-tap.ts` | Identity, context, classification | None (raw DOM) | Identity Extractor, DomContext Extractor |
| **Identity Extractor** | `src/tap/identity-extractor.ts` | `src/recorder/v2/identity-extractor.ts` (dead) | EventTap events | Component Runtime |
| **DOM Context Extractor** | `src/definitions/dom-context-extractor.ts` | Surface detection, context extraction | EventTap events | Component Runtime |
| **Component Runtime** | `src/definitions/*.ts` (13 definition files + index.ts) | Semantic reasoning, IR, code gen | Identity Extractor, DomContext Extractor | Service Worker (OBSERVED_EVENT messages) |
| **Interaction Types** | `src/classifier/interaction-types.ts` | Event capture, classification logic | None (type definitions) | Interaction Detector, Panel/Form Detectors |
| **Interaction Detector** | `src/classifier/interaction-detector.ts` | `src/classifier/interaction-detector-v2.ts` | RecordedEvent[] | Semantic Reasoner |
| **Panel/Form Detectors** | `src/classifier/semantic/panel-form-detectors.ts` | Activation, absorption, session lifecycle | DetectedInteraction[] | Semantic Reasoner |
| **Semantic Reasoner** | `src/classifier/semantic/reasoner.ts` | `src/classifier/semantic/detectors.ts`, `patterns.ts` | DetectedInteraction[] + session state | IR Bridge |
| **Recognition Pipeline** | `src/classifier/recognition/` (7 files) | Enrichment patterns | EnrichableInteraction[] | IR Bridge |
| **Evidence Providers** | `src/classifier/evidence/providers/` (5 files) | Evidence collection | UIState changes | Interaction Detector (legacy path) |
| **IR Bridge** | `src/generation/ir-bridge.ts` | `src/generation/ir-bridge-input.ts` | UnderstandingResult + interactions | Playwright Code Generator |
| **Playwright Code Gen** | `src/generation/playwright-code-generator.ts` | `src/adapters/playwright/` (6 files) | IR actions | Output (test code string) |
| **Repository V2** | `src/repository/v2/` (8 repos + interfaces) | Persistence, retrieval | Dexie/IndexedDB | Repository Services |
| **Repository Services** | `src/repository/services/` | Capability matching, healing | Repository V2 | Healing Service |
| **Healing Service** | `src/repository/services/healing-service.ts` | Cross-session locator repair | Repository V2 | Repository Services |
| **Domain Entities** | `src/domain/entities/` (14 files) | Business logic invariants | None (pure types) | All engines |
| **Shared Types** | `src/shared/types.ts` | ElementIdentity, UIState | None (canonical types) | All engines |
| **Component Types** | `src/shared/component-types.ts` | ObservedEvent, ComponentInteraction, DomContext | None (canonical types) | EventTap, Component Runtime, SW |
| **Service Worker** | `src/background/service-worker.ts` | Pipeline orchestration | All engines (imports) | Side Panel |
| **Side Panel** | `src/sidepanel/` | UI display, user interaction | ComponentInteraction[] from SW | User |
| **Settings** | `src/settings/` | Configuration | Chrome storage | All engines (read settings) |

---

## 7. Coding Rules

### 7.1 Where Interaction Fixes Go

| Fix Type | Target Engine | Target File(s) | NEVER Touch |
|-----------|--------------|-----------------|-------------|
| Click target resolution (SVG → ancestor) | Identity Extractor | `src/tap/identity-extractor.ts` | service-worker.ts, recorder-entry.ts |
| Surface detection (overlay/panel appear) | DOM Context Extractor | `src/definitions/dom-context-extractor.ts` | service-worker.ts, identity-extractor.ts |
| Surface evidence propagation | Interaction Detector | `src/classifier/interaction-detector.ts` | service-worker.ts, dom-context-extractor.ts |
| multiConfig activation | Panel/Form Detectors | `src/classifier/semantic/panel-form-detectors.ts` | reasoner.ts, interaction-detector.ts |
| multiConfig absorption | Panel/Form Detectors | `src/classifier/semantic/panel-form-detectors.ts` | reasoner.ts, interaction-detector.ts |
| Stepper detection (+/- buttons) | Panel/Form Detectors | `src/classifier/semantic/panel-form-detectors.ts` | interaction-detector.ts, identity-extractor.ts |
| Date picker duplicate capture | Semantic Reasoner | `src/classifier/semantic/reasoner.ts` or `detectors.ts` | interaction-detector.ts, panel-form-detectors.ts |
| Dropdown classification | Component Runtime definitions | `src/definitions/dropdown.ts` | reasoner.ts, interaction-detector.ts |
| DatePicker classification | Component Runtime definitions | `src/definitions/date-picker.ts` | reasoner.ts, interaction-detector.ts |
| Event capture (missing events) | EventTap | `src/tap/event-tap.ts` | identity-extractor.ts, definitions |
| Component classification (wrong type) | Component Runtime | `src/definitions/index.ts` + relevant definition | reasoner.ts, IR bridge |

### 7.2 Where Semantic Fixes Go

| Fix Type | Target Engine | Target File(s) | NEVER Touch |
|-----------|--------------|-----------------|-------------|
| Session type selection (wrong session) | Semantic Reasoner | `src/classifier/semantic/reasoner.ts` | panel-form-detectors.ts, interaction-detector.ts |
| Session lifecycle (start/end conditions) | Semantic Reasoner | `src/classifier/semantic/reasoner.ts` | panel-form-detectors.ts |
| Session absorption rules | Panel/Form Detectors | `src/classifier/semantic/panel-form-detectors.ts` | reasoner.ts |
| Session activation rules | Panel/Form Detectors | `src/classifier/semantic/panel-form-detectors.ts` | reasoner.ts |
| Config field extraction | Panel/Form Detectors | `src/classifier/semantic/panel-form-detectors.ts` | reasoner.ts |
| Understanding result aggregation | Semantic Reasoner | `src/classifier/semantic/reasoner.ts` | IR bridge |
| Recognition pattern matching | Recognition Pipeline | `src/classifier/recognition/*.ts` | reasoner.ts |
| Evidence channel logic | Evidence Providers | `src/classifier/evidence/providers/*.ts` | interaction-detector.ts |

### 7.3 Where Capability Fixes Go

| Fix Type | Target Engine | Target File(s) | NEVER Touch |
|-----------|--------------|-----------------|-------------|
| Capability creation | Repository Services | `src/repository/services/capability-service.ts` | reasoner.ts, IR bridge |
| Capability matching | Repository Services | `src/repository/services/capability-service.ts` | reasoner.ts |
| Locator strategy | Domain Entities | `src/domain/entities/locator.ts` | reasoner.ts |
| Locator ranking | Domain Entities | `src/domain/locator-ranking.ts` | reasoner.ts |
| Healing strategy | Healing Service | `src/repository/services/healing-service.ts` | reasoner.ts, IR bridge |
| Persistence schema | Repository V2 | `src/repository/v2/*.ts` | service-worker.ts |

### 7.4 Where AI Changes Go

| Fix Type | Target Engine | Target File(s) | NEVER Touch |
|-----------|--------------|-----------------|-------------|
| AI provider configuration | AI Integration (future) | `src/ai/provider-manager.ts` (future) | service-worker.ts |
| Test generation prompts | AI Test Generator (future) | `src/ai/test-generator.ts` (future) | reasoner.ts |
| Failure analysis prompts | AI Failure Analyzer (future) | `src/ai/failure-analyzer.ts` (future) | reasoner.ts |
| LLM key management | Environment keys | Backend tool (`add_environment_key`) | Source files |

### 7.5 Files That Should NEVER Be Touched

| File | Why | Exception |
|------|-----|-----------|
| `src/manifest.json` | Only version bumps during release | Release commit only |
| `dist/*` | Build output — regenerated by `npm run build` | Never |
| `download/*.zip` | Built packages — regenerated by packaging step | Never |
| `vite.config.ts` | Build configuration — stable | Architectural change only |
| `tsconfig.json` | TypeScript configuration — stable | Dependency change only |
| `package.json` scripts section | Build scripts — stable | Adding a new script |
| `src/types/*` | Dead code — will be deleted | Deletion commit only |
| `src/pipeline/*` | Dead code — will be deleted | Deletion commit only |
| `src/recorder/deterministic-recorder.ts` | Dead code (3079 lines) — will be deleted | Deletion commit only |
| `src/recorder/v2/*` | Dead code — will be deleted | Deletion commit only |

### 7.6 Folders That Will Eventually Be Deleted

| Folder | When | Prerequisite |
|--------|------|--------------|
| `src/recorder/` (entire folder) | Phase 1 | All dead code confirmed unused |
| `src/pipeline/` (entire folder) | Phase 1 | All dead code confirmed unused |
| `src/types/` (entire folder) | Phase 1 | All dead code confirmed unused |
| `src/runtime/` (entire folder) | Phase 1 | Modal tracker confirmed unused |
| `tmp-build/` | Phase 1 | Cleanup |
| `extension-zip/` | Phase 1 | Cleanup |

---

## 8. Validation Checklist Before Every Commit

### Pre-Commit Checklist

```
☐ 1. npm run build succeeds (exit 0, no TS errors)
☐ 2. npm test passes (no NEW failures — pre-existing failures are tracked)
☐ 3. No conflict markers (grep -rn '<<<<<<<\|>>>>>>>' src/)
☐ 4. No debug console.log left in production code (grep -rn 'console.log' src/ --include='*.ts' | grep -v test)
☐ 5. Changed files are in the correct engine (per Section 6 ownership matrix)
☐ 6. No changes to files in Section 7.5 "NEVER Touch" list
☐ 7. If interaction/classifier/semantic changes — unit tests added or updated
☐ 8. If build output changes — dist/ rebuilt and package re-created
☐ 9. Commit message format: '<type>: <description>' (fix:, feat:, docs:, refactor:, test:)
☐ 10. Commit is on master branch
```

### Pre-Release Checklist (for user-facing extension package)

```
☐ 1. All pre-commit checklist items pass
☐ 2. npm test passes with NO failures (pre-existing failures resolved)
☐ 3. Extension packaged with correct version in filename
☐ 4. Package copied to both download/ and downloads/
☐ 5. Download URL returns HTTP 200 (curl -sf -o /dev/null -w '%{http_code}')
☐ 6. Side panel footer shows correct version string
☐ 7. Manual smoke test: load extension, record a simple click, verify code generation
```

---

## 9. Operational Rules

### 9.1 Where Interaction Fixes Go

**Rule:** Interaction fixes go to the engine that OWNS the detection/classification step, NOT to the service worker.

```
Q: "The + button isn't captured correctly"
A: Is the + button being CLICKED but not recorded?
   → EventTap (src/tap/event-tap.ts) — event capture issue
   YES: Is the click recorded but target is wrong (SVG instead of button)?
   → Identity Extractor (src/tap/identity-extractor.ts) — target resolution issue
   YES: Is the click recorded with correct target but wrong interaction type?
   → Component Runtime (src/definitions/*.ts) — classification issue
   YES: Is the interaction classified correctly but not absorbed into multiConfig?
   → Panel/Form Detectors (src/classifier/semantic/panel-form-detectors.ts) — absorption issue
   YES: Is it absorbed but config field name/value is wrong?
   → Panel/Form Detectors (src/classifier/semantic/panel-form-detectors.ts) — extraction issue
   YES: Is the multiConfig correct but IR code is wrong?
   → IR Bridge (src/generation/ir-bridge.ts) — IR generation issue
```

### 9.2 Where Semantic Fixes Go

**Rule:** Semantic fixes go to the engine that OWNS the reasoning step, NOT to the service worker.

```
Q: "Premium Economy selection isn't part of the multiConfig"
A: Is the click captured and target resolved?
   → If no: fix Identity Extractor first (interaction fix, not semantic)
   YES: Is it classified as a Click?
   → If yes: check if multiConfig session is active — if not, fix activation in Panel/Form Detectors
   YES: Is multiConfig active but not absorbing this click?
   → Panel/Form Detectors (absorption rules)
   YES: Is it absorbed but the value is wrong?
   → Panel/Form Detectors (config field extraction)
   YES: Is the multiConfig correct but understanding result is wrong?
   → Semantic Reasoner (reasoner.ts)
   YES: Is the understanding correct but IR is wrong?
   → IR Bridge (ir-bridge.ts)
```

### 9.3 Where Capability Fixes Go

**Rule:** Capability fixes go to the Repository/Domain layer, never to the classifier or reasoner.

```
Q: "Healing isn't finding the right locator"
A: Is the locator stored correctly?
   → Repository V2 (src/repository/v2/*.ts)
   YES: Is the locator ranking wrong?
   → Domain Entities (src/domain/locator-ranking.ts)
   YES: Is the healing logic wrong?
   → Healing Service (src/repository/services/healing-service.ts)
   YES: Is the capability matching wrong?
   → Repository Services (src/repository/services/capability-service.ts)
```

### 9.4 Where AI Changes Go

**Rule:** AI changes go in `src/ai/` (future module) or environment keys (backend). Never in source files.

```
Q: "I want to add LLM-powered test generation"
A: Does it need an API key?
   → YES: create_openai_api_key(project_id) → add_environment_key (is_secret=True)
   → Does it need a new module?
   → YES: Create src/ai/test-generator.ts (Phase 4 — not yet)
   → Does it touch the recording pipeline?
   → NO: AI modules read from Repository/Capability, they do NOT modify the pipeline
```

### 9.5 Which Branch Receives Every Commit

**Every commit goes to `master`.** No exceptions.

### 9.6 Which Build Output Is Always Installed

**Always install from `dist/` (built by `npm run build`).** Never from `src/`. The packaged zip is always created from `dist/` after a fresh build.

### 9.7 How to Verify Testing the Latest Extension

1. `npm run build` — rebuild from current source
2. Package: `zip -r cmdrunner-extension-v10.9.0.zip dist/`
3. Copy: `cp cmdrunner-extension-v10.9.0.zip download/ && cp cmdrunner-extension-v10.9.0.zip downloads/`
4. Verify: `curl -sf -o /dev/null -w '%{http_code}' https://new-cmdrunner-ai-ext-upxqyy.drytis.dev/download/cmdrunner-extension-v10.9.0.zip`
5. User loads the zip in Chrome via `chrome://extensions → Load unpacked` or drag-and-drop
6. Verify side panel footer shows `v10.9.0 · Component Runtime`

---

## 10. Current Fix Status Tracking

### Status Definitions

| Status | Meaning | Can build on? |
|--------|---------|---------------|
| 🔴 **Designed** | Architecture agreed, code not yet written | No |
| 🟡 **Implemented** | Code written, unit tests pass, NOT yet verified on the target site | No |
| 🟢 **Verified** | Confirmed working by manual testing on the target site (Adani One) | No — needs regression test |
| ✅ **Complete** | Verified AND regression-tested — safe to build on | Yes |

### Adani One Fix Status

| # | Issue | Fix Location | Status |
|---|-------|-------------|--------|
| 1 | SVG chevron resolves to icon instead of trigger button | Identity Extractor (`identity-extractor.ts`) | 🟡 Implemented |
| 2 | Surface evidence not propagated to interactions | Interaction Detector (`interaction-detector.ts`) + DomContext Extractor (`dom-context-extractor.ts`) | 🟡 Implemented |
| 3 | multiConfig not activating for surface-anchored panels | Panel/Form Detectors (`panel-form-detectors.ts`) | 🟡 Implemented |
| 4 | Absorption not working for surface-anchored sessions | Panel/Form Detectors (`panel-form-detectors.ts`) | 🟡 Implemented |
| 5 | Stepper detection (+/- buttons captured as generic Click) | Panel/Form Detectors (`panel-form-detectors.ts`) | 🟡 Implemented |
| 6 | Date picker captured twice | Semantic Reasoner (`reasoner.ts` / `detectors.ts`) | 🔴 Designed (not yet investigated) |
| 7 | "Cheapest" tab click not captured | EventTap (`event-tap.ts`) or Identity Extractor | 🔴 Designed (not yet investigated) |
| 8 | Pipeline crash (session.getEvents() undefined) | Service Worker (`service-worker.ts`) | 🟡 Implemented |

### Critical Reminder

> **No fix marked "Implemented" should be treated as "Done."** All fixes #1-5 and #8 are currently at "Implemented" status — code is written and unit tests pass, but manual testing on Adani One showed the behavior is still incorrect. The fixes need to be debugged and brought to "Verified" status before they can be used as a foundation for Phase 0.

---

## 11. Pre-Existing Test Failures (Tracked)

| Test | File | Reason | Action |
|------|------|--------|--------|
| Performance timing test | `tests/milestone4/*.test.ts` | Timing-sensitive assertion | Fix or skip with justification |
| Manifest script reference test | `tests/stage2-control-recorder.test.ts` | Fixed in commit — checks for both `recorder-entry` and `deterministic-recorder` | ✅ Resolved |

---

*This specification is the frozen baseline. All development must follow these rules. When in doubt, refer to the ownership matrix in Section 6 and the coding rules in Section 7.*
