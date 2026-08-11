# Behavioral Evidence Model v2.0 — Validation Against 3bc28f6 Baseline

**Validation Date:** 2026-08-11
**Implementation Baseline:** `3bc28f6` on `capability-surgical-removal`
**Spec:** `.drytis/specs/behavioral-evidence-model.md` (v2.0)
**Verdict:** SPEC REQUIRES 23 MODIFICATIONS before implementation can begin.

---

## 1. Baseline State at 3bc28f6

### 1.1 Commit Chain
```
3bc28f6 (HEAD) Remove Behavioral Observation model (infrastructure + semantics + display)
aef34a0       Remove Capability Model (System A engine + System B domain model)
deff878       Capability Readiness Final Roadmap (historical reference — DO NOT USE)
```

### 1.2 What Was Removed (3bc28f6 = aef34a0 + behavioral removal)
- `src/tap/observation-coordinator.ts` (309 LOC)
- `src/tap/document-observer.ts` (364 LOC)
- `src/tap/element-state-cache.ts` (157 LOC)
- `src/tap/state-cache-listeners.ts` (80 LOC)
- `src/semantics/` entirely (5 files: sw-bridge.ts, effect-interpreter.ts, effect-rules.ts, effect-types.ts, interpretation-context.ts — ~995 LOC)
- `src/sidepanel/behavioral-renderer.ts` (454 LOC)
- `src/domain/entities/observed-transition.ts` (249 LOC)
- `src/domain/entities/application-knowledge.ts` (327 LOC)
- 14 test files (~5,121 LOC)
- Integration points in `recorder-entry.ts`, `sw-integration.ts`, `service-worker.ts`, `component-types.ts`, `types.ts`, `interaction-renderer.ts`

### 1.3 What Survives (Clean Architecture)
| Layer | Files | Status |
|-------|-------|--------|
| **EventTap** | `src/tap/event-tap.ts` (333 LOC) | INTACT — 12 event types |
| **IdentityExtractor** | `src/tap/identity-extractor.ts` (504 LOC) | INTACT — 18 fields |
| **ComponentRuntime** | `src/shared/component-runtime.ts` (683 LOC) | INTACT — 14 definitions |
| **EvidenceLedger** | `src/shared/evidence-ledger.ts` (237 LOC) | INTACT |
| **Enrichment** | `src/enrichment/*` (3 files) | INTACT |
| **IR Bridge** | `src/generation/ir-bridge.ts` (432 LOC) | INTACT |
| **Playwright Generation** | `src/generation/*` (9 files) | INTACT |
| **Repository V2 (Dexie)** | `src/repository/v2/*` | INTACT — 8 tables, 3 schema versions |
| **Service Worker** | `src/background/service-worker.ts` (789 LOC) | INTACT — no behavioral/obs references |
| **Enrichment→IR** | ir-bridge.ts build() | NOT CONNECTED — enrichment output display-only |

### 1.4 Build/Test State
- **tsc --noEmit:** 0 errors
- **vitest:** 89 files, 1,971 tests passing
- **npm run build:** succeeds, 106 modules, ~130 KB ZIP
- **Working tree:** clean except untracked spec/note files

---

## 2. Requirement-by-Requirement Validation

### V-R1: Existing EventTap Infrastructure

**Spec §9.1:** "Reuse existing EventTap (12 event types). Behavioral Evidence hooks via `onAfterEvent`."

**Actual at 3bc28f6:**
- ✅ EventTap registers 12 event types: click, mousedown, contextmenu, focus, blur, input, change, mouseenter, mouseleave, mousemove, keydown, scroll
- ✅ `onAfterEvent` callback exists in EventTap config (line 56) and fires from `handleRawEvent` (lines 196-198)
- ❌ **recorder-entry.ts does NOT wire `onAfterEvent`** — EventTap is created with `{ onEvent }` only (line 222-224). The callback is defined in EventTap but never connected by the content script hub.

**Impact:** Implementation must add `onAfterEvent` to the `createEventTap` call in `recorder-entry.ts`. The hook infrastructure already exists in EventTap — no EventTap modification needed.

**Verdict:** ✅ VALIDATED with one wiring gap.

---

### V-R2: Existing ElementIdentity (18 fields)

**Spec §8.2 (C3 fix):** "Reuse existing 18-field ElementIdentity from ObservedEvent.target. Do not create identity-capture.ts."

**Actual at 3bc28f6:**
- ✅ `RawElementIdentity` interface in `src/shared/types.ts` (17 fields)
- ✅ `ElementIdentity extends RawElementIdentity` adds `elementId` (line 154) → 18 fields total
- ✅ Fields: accessibleName, ariaRole, ariaLabel, ariaLabelledBy, placeholder, tag, className, name, stableId, testId, dataCy, dataQa, cssSelector, xPath, inIframe, shadowDom, href, elementId
- ✅ IdentityExtractor extracts all 17 base fields + identity-extractor.ts adds elementId via background assignment

**Spec §8.2 additional:** "Spec mentions inputType — check if it exists."
- ❌ **`inputType` does NOT exist** in RawElementIdentity. The spec v2.0 §8.2 references it but it was never implemented at deff878 or 3bc28f6.

**Impact:** Spec must either drop inputType or note it as a new field to add to ElementIdentity. Implementation can proceed without it for most event types; input/change events already capture `valueBefore`/`valueAfter` which covers the use case.

**Verdict:** ✅ VALIDATED. inputType is a spec error — does not exist and must be removed or flagged as a new addition.

---

### V-R3: ObservedEvent Has All Context Needed

**Spec §9.1:** "ObservedEvent carries pageUrl, pageTitle, timestamp, captureSeq."

**Actual at 3bc28f6:**
- ✅ `ObservedEvent` interface (component-types.ts line 102) has:
  - `pageUrl: string` ✅
  - `pageTitle: string` ✅
  - `timestamp: number` (Date.now()) ✅
  - `captureSeq: number` (rawEvent.timeStamp) ✅
  - `isTrusted: boolean` ✅
  - `target: ElementIdentity` (full 18 fields) ✅
  - `domContext: DomContext` ✅
  - `valueBefore/After`, `checkedBefore/After` ✅
  - `clientX/Y`, `key/code`, `shiftKey/ctrlKey/altKey/metaKey` ✅
  - `scrollDeltaY/X` ✅

**Verdict:** ✅ FULLY VALIDATED. ObservedEvent is richer than spec assumes — all fields present.

---

### V-R4: Content Script World Isolation

**Spec §12 (C1 fix):** "MAIN-world content script for fetch/XHR monkeypatch. ISOLATED-world content script cannot intercept page's network calls. Use CustomEvent bridge."

**Actual at 3bc28f6:**
- ❌ Manifest declares ONE content script: `src/recorder/phase5/recorder-entry.ts`
- ❌ Content script runs in **ISOLATED world** (no `"world": "MAIN"` in manifest)
- ❌ **No webRequest permission** in manifest permissions

**Manifest:**
```json
{
  "matches": ["<all_urls>"],
  "js": ["src/recorder/phase5/recorder-entry.ts"],
  "all_frames": true,
  "run_at": "document_start"
}
```

**Impact:** This is the most significant implementation prerequisite. Requires:
1. New MAIN-world content script entry file (e.g., `src/recorder/network/network-tap.ts`)
2. Manifest addition: `"world": "MAIN"` entry in `content_scripts` array
3. CustomEvent bridge: MAIN-world script listens for `__cmdrunner_request_network_tap__`, posts evidence via `window.postMessage` or `CustomEvent`
4. ISOLATED-world recorder-entry.ts adds event listener for `__cmdrunner_network_evidence__` to receive intercepted data
5. **webRequest fallback:** Spec mentions `chrome.webRequest` as fallback for CSP-blocked sites. Requires adding `"webRequest"` to manifest permissions. This is a significant permission scope increase.
6. **@crxjs/vite-plugin compatibility:** The current build uses `@crxjs/vite-plugin`. MAIN-world content scripts require verification that crxjs handles them correctly (the plugin generates the manifest content_scripts from manifest.json — need to verify it supports `"world": "MAIN"`).

**Verdict:** ❌ CRITICAL — MAIN-world script does not exist. This is the highest-risk implementation item.

---

### V-R5: SPA Navigation Detection

**Spec §11.3 (C2 fix):** "Do not create NavWatcher. Consume existing EventTap navigation events."

**Actual at 3bc28f6:**
- ✅ EventTap already patches `history.pushState` and `history.replaceState`
- ✅ EventTap listens for `popstate` and `hashchange`
- ✅ `emitSpaNavigation()` emits synthetic `'navigation'` ObservedEvents
- ✅ Navigation events have `isTrusted: true` (line 110)
- ✅ Navigation events go through `onEvent` callback (NOT `onAfterEvent`)

**Spec conflict:** "Behavioral Evidence hooks via `onAfterEvent`" (§9.1) — but navigation events do NOT trigger `onAfterEvent`. They trigger `onEvent` only. The spec's C2 fix says "consume existing EventTap navigation events" but doesn't specify HOW to hook them if `onAfterEvent` doesn't fire for navigation.

**Impact:** Implementation must either:
- (A) Modify EventTap to fire `onAfterEvent` for navigation events too (low risk — add one call in `emitSpaNavigation`)
- (B) Add a separate `onNavigation` callback to EventTap config (cleaner separation)
- (C) Hook into `onEvent` for navigation events in recorder-entry.ts (works but mixes concerns)

**Verdict:** ⚠️ CONFLICT — navigation events bypass `onAfterEvent`. Spec must specify the integration path.

---

### V-R6: Dexie Schema — No behavioral_evidence Table

**Spec §11.5 (H5 fix):** "New behavioral_evidence Dexie table (V4 schema)."

**Actual at 3bc28f6:**
- ❌ No `behavioral_evidence` table exists
- Current schema: V1 (6 tables) → V2 (added recordingSessions) → V3 (added executionRuns) → 8 tables total
- `dexie-database.ts` has 3 `.version()` calls
- Adding V4 is straightforward: `this.version(4).stores({ ...existing, behavioral_evidence: 'id, interactionId, interactionEventId, captureSeq' })`

**Impact:** Spec is correct that V4 is needed. Implementation must:
1. Add `this.version(4)` to `dexie-database.ts`
2. Repeat all V1-V3 store definitions (Dexie requirement)
3. New `BehavioralEvidenceRecord` entity in domain
4. New `BehavioralEvidenceRepository` interface in `repository/v2/interfaces/`
5. New `DexieBehavioralEvidenceRepository` implementation
6. Register in `RepositorySet` and `DexieUnitOfWork`

**Verdict:** ✅ VALIDATED — spec correctly identifies this as new. Standard Dexie migration path.

---

### V-R7: Service Worker Message Types

**Spec §9.3:** "Behavioral evidence sent from content script to SW via message passing."

**Actual at 3bc28f6:**
- ✅ SW message handler switch (service-worker.ts line 675) handles: START_RECORDING, STOP_RECORDING, OPEN_SETTINGS, OPEN_REPOSITORY, RUN_TEST, PING, OBSERVED_EVENT
- ❌ **No BEHAVIORAL_EVIDENCE message type exists**
- ✅ `types.ts` (line 544) defines `AppMessage` union with current types
- ✅ Message pattern is well-established: content script sends `{ type: '...', payload: ... }`, SW responds with `sendResponse({ ok: true })`

**Impact:** Implementation must add:
1. New message type `BEHAVIORAL_EVIDENCE` to `AppMessage` union in `types.ts`
2. New case in SW message switch for handling behavioral evidence
3. Correlation logic in SW: match evidence to interaction by `triggerEvent.eventId`

**Verdict:** ✅ VALIDATED — straightforward addition following established pattern.

---

### V-R8: ComponentRuntime — behavioralObservations Field Removed

**Spec §9.2:** "BehavioralEvidence attached to ComponentInteraction."

**Actual at 3bc28f6:**
- `component-types.ts` `ComponentInteraction` interface (line 410+):
  - The `// M1: Behavioral Observations` comment block EXISTS (lines ~450-455)
  - ❌ **The actual `behavioralObservations?: ObservationResult[]` field declaration is GONE** — the comment block exists but the field itself was removed in 3bc28f6
  - The interface ends at the comment block with no field

**Impact:** Implementation must add a new `behavioralEvidence?: BehavioralEvidence` field to `ComponentInteraction`. The old field name and type (`ObservationResult`) must not be reused (per the clean-slate mandate).

**Verdict:** ✅ VALIDATED — field must be newly added with the new type.

---

### V-R9: Build System — @crxjs/vite-plugin

**Spec §12:** "MAIN-world content script requires manifest configuration."

**Actual at 3bc28f6:**
- Build: `vite.config.ts` uses `@crxjs/vite-plugin` with manifest from `src/manifest.json`
- The plugin generates content_scripts from manifest.json entries
- ❌ **Untested:** Whether @crxjs/vite-plugin correctly handles `"world": "MAIN"` in manifest content_scripts entries

**Known risk:** @crxjs/vite-plugin historically had issues with MAIN-world content scripts. The Vite plugin processes the manifest and generates the build output. If it doesn't support `"world": "MAIN"`, a manual manifest injection approach or plugin update may be needed.

**Impact:** Before implementation, verify @crxjs/vite-plugin version compatibility with MAIN-world content scripts. If incompatible, alternatives:
- Register MAIN-world script dynamically via `chrome.scripting.executeScript({ world: 'MAIN' })` from the service worker (the `scripting` permission already exists)
- Use `chrome.scripting.registerContentScripts` with `world: 'MAIN'` at runtime

**Verdict:** ⚠️ BUILD RISK — must verify crxjs compatibility before implementation.

---

### V-R10: Enrichment→IR Disconnection Confirmed

**Spec §7 Principle P8:** "Reuse existing infrastructure."

**Actual at 3bc28f6:**
- ✅ Enrichment layer (meaning-resolver.ts, component-detector.ts, enrich.ts) is INTACT
- ✅ IR bridge (ir-bridge.ts) build() method does NOT consume enrichment
- ✅ This confirms the known gap: enrichment is display-only, does not flow into generation
- ✅ The behavioral evidence spec does NOT need to solve this gap — it's a separate concern

**Verrichment→IR connection is out of scope for Behavioral Evidence Model v2.0.** The spec correctly does not address it.

**Verdict:** ✅ VALIDATED — confirmed out of scope.

---

### V-R11: Network Interception Permissions

**Spec §12:** "webRequest fallback for CSP-blocked sites."

**Actual at 3bc28f6:**
- ❌ No `webRequest` permission in manifest
- ❌ No `webRequestBlocking` permission
- Current permissions: sidePanel, storage, unlimitedStorage, activeTab, webAccess, webNavigation, tabs, scripting, alarms
- Host permissions: `http://*/*`, `https://*/*`

**Impact:** Adding `webRequest` permission is a user-visible permission scope increase. Chrome may prompt users to approve. The spec should note this as a user-experience consideration.

However, MV3 `webRequest` is observational-only (cannot block/modify). Adding it enables the fallback path without the blocking concern.

**Verdict:** ⚠️ PERMISSION EXPANSION — requires manifest change and user UX consideration.

---

### V-R12: Shadow DOM Observation

**Spec §5.3:** "Recursive shadow DOM observation (max 20 roots)."

**Actual at 3bc28f6:**
- ✅ IdentityExtractor already detects `shadowDom: boolean` (field 16 of 18)
- ✅ EventTap registers listeners on `document` (capturing phase) — this captures events from shadow DOM children via event bubbling/composition
- ❌ No existing MutationObserver infrastructure for shadow roots (document-observer.ts was deleted)
- ❌ No existing mechanism to discover and attach MutationObservers to shadow roots

**Impact:** Implementation must build shadow DOM discovery + recursive observation from scratch. Discovery approach:
- MutationObserver on document.body (childList, subtree) detects new elements
- For each new element, check `element.shadowRoot` (open shadow roots only)
- Attach nested MutationObserver to each discovered shadow root
- `closed` shadow roots cannot be observed (fundamental limitation)

**Verdict:** ✅ VALIDATED — must be newly built. Closed shadow roots are an inherent limitation.

---

### V-R13: Test Infrastructure

**Spec §16:** "Test suite covering all layers."

**Actual at 3bc28f6:**
- ✅ vitest configured: jsdom environment, `tests/**/*.test.ts` include pattern
- ✅ 89 test files, 1,971 tests passing
- ✅ Test conventions established: `tests/` mirrors `src/` structure
- ❌ No existing behavioral evidence test files (all deleted in 3bc38f6)
- ❌ jsdom limitations: no real MutationObserver timing, no `window.fetch` interception in MAIN world, no real Shadow DOM API (jsdom has partial support)

**Impact:** Unit tests in jsdom will be limited for:
- MutationObserver timing (jsdom fires synchronously, real browser async)
- Network interception (jsdom has no real network stack)
- Shadow DOM (jsdom support is incomplete)
- Performance.now() timing accuracy

Real-browser validation (manual or Playwright) needed for integration tests.

**Verdom limitation is a known constraint.** Unit tests will focus on pure functions (adapters, serializers, correlation logic). Integration/E2E tests require a real browser.

**Verdict:** ✅ VALIDATED with jsdom limitations noted.

---

### V-R14: ComponentInteraction — Evidence Correlation Key

**Spec §9.2:** "Evidence correlated to interaction by `triggerEvent.eventId`."

**Actual at 3bc28f6:**
- ✅ `ComponentInteraction` has `triggerEvent: ObservedEvent` field
- ✅ `ObservedEvent` has `eventId: string` (format: `evt-{pageId}-{counter}`)
- ✅ eventId is page-unique and monotonically increasing
- ✅ SW correlates events by eventId already (handleObservedEvent)

**Impact:** The correlation key is solid. Evidence can be matched to interactions via `triggerEvent.eventId` or `memberEvents[].eventId`.

**Verdict:** ✅ FULLY VALIDATED.

---

### V-R15: Service Worker Lifecycle (MV3)

**Spec §10.2:** "SW restart recovery — recover durable observations from storage."

**Actual at 3bc28f6:**
- ✅ SW handles the `OBSERVED_EVENT` message and uses `chrome.storage.local` for durable state
- ❌ **No durable observation recovery mechanism** (the old `recoverDurableObservations` in sw-integration.ts was removed)
- ✅ The pattern is established: SW writes to `chrome.storage.local` keys before acking, reads on restart
- ✅ SW is stateless across restarts — all state comes from storage

**Impact:** Implementation must rebuild the durable recovery mechanism. Pattern is established but code was removed. Key design decision: behavioral evidence storage keys and format.

**Verdict:** ✅ VALIDATED — mechanism must be rebuilt from scratch following the established storage pattern.

---

### V-R16: Side Panel Display

**Spec §13:** "Side panel renders behavioral evidence."

**Actual at 3bc28f6::
- ✅ Side panel exists and renders interactions via `interaction-renderer.ts`
- ✅ `interaction-renderer.ts` is intact (no behavioral references)
- ❌ The old `behavioral-renderer.ts` (454 LOC) was DELETED
- ✅ `sidepanel.ts` is intact — the INTERACTION_EFFECTS_UPDATE handler was removed
- ✅ Side panel HTML (`src/sidepanel/index.html`) — old behavioral DOM elements remain as dead HTML/CSS

**Impact:** Implementation must create a new behavioral evidence renderer (new module, new name, new types). Must NOT reuse `behavioral-renderer.ts` name or types (clean-slate mandate). Dead HTML/CSS elements in sidepanel index.html should be cleaned.

**Verdict:** ✅ VALIDATED — must be newly built.

---

### V-R17: Existing ComponentInteraction.behavioralObservations Comment

**Actual at 3bc28f6:**
- The comment block "// M1: Behavioral Observations" EXISTS in component-types.ts (lines ~450-455)
- But the actual `behavioralObservations?: ObservationResult[]` field was REMOVED
- The comment ends with `/** M1: Behavioral observations from the observation coordinator. */` followed by `}` closing the interface

**Spec issue:** The spec doesn't address this orphaned comment. Implementation should remove it when adding the new field.

**Verdict:** ⚠️ CLEANUP NEEDED — orphaned comment block in component-types.ts.

---

### V-R18: Global Batch Counter

**Spec §6 (H1 fix):** "Shared globalBatchCounter on DOMObserver."

**Actual at 3bc28f6:**
- ❌ No DOMObserver exists (document-observer.ts was deleted)
- ❌ No batch counter concept exists
- Implementation must create the DOMObserver from scratch WITH the global batch counter from day one.

**Verdict:** ✅ VALIDATED — must be newly built.

---

### V-R19: ComponentRuntime Evidence Integration

**Spec §9.2:** "BehavioralEvidence attached to ComponentInteraction."

**Actual at 3bc28f6:**
- ✅ ComponentRuntime emits ComponentInteraction objects via `onEmit` callback
- ✅ ComponentRuntime is pure: it classifies events into interactions, enriches with trigger element, metadata
- ✅ The enrichment fields (componentType, componentFramework, businessMeaning) are populated AFTER emission by a separate enrichment pass

**Spec gap:** The spec says "attach evidence to ComponentInteraction" but doesn't specify WHEN:
- (A) At ComponentRuntime emission time (sync, same call stack) — evidence may not be complete (observation window still open)
- ( (B) After observation window closes (async, deferred) — evidence arrives after interaction is emitted
- (C) At session persistence time (batch, at stopRecording)

**Impact:** This is a fundamental design decision that affects the entire pipeline. The dual-scope model's "deferred causal correlation" principle implies (B) — evidence arrives after the interaction. But the current pipeline emits interactions immediately and persists them at stopRecording. Evidence must be either:
- Carried alongside interactions in SW memory (like the old pendingBehavioralEffects)
- Persisted separately and correlated at session-save time

**Verdict:** ⚌ AMBIGUITY — spec must specify the attachment timing.

---

### V-R20: Memory Budget

**Spec §11.4:** "Max 5 concurrent observation windows, max 200 mutations per window."

**Actual at 3bc28f6:**
- No existing memory management infrastructure
- The old ObservationCoordinator had a different window model (independent 3-second windows)
- `unlimitedStorage` permission exists in manifest

**Impact:** The spec's limits are reasonable for a content script. The old system's WeakRef + document.contains() check for element validity is a proven pattern worth reusing conceptually.

**Verdict:** ✅ VALIDATED — must be newly built.

---

### V-R21: Vite Build — Multiple Content Scripts

**Spec §12:** "New MAIN-world content script for network interception."

**Actual at 3bc28f6:**
- Vite config uses `@crxjs/vite-plugin` with a single content script entry
- The plugin treats `manifest.json` content_scripts entries as build inputs
- Adding a second content script requires adding it to `manifest.json` content_scripts array

**Potential conflict:** @crxjs/vite-plugin may need version verification for MAIN-world support. The current version is:
```json
"@crxjs/vite-plugin": "^2.0.0-beta.27"
```

**Impact:** Must verify the plugin version supports `"world": "MAIN"` in manifest content_scripts. If not, use `chrome.scripting.executeScript({ world: 'MAIN' })` dynamic injection as fallback.

**Verth:** ⚠️ BUILD COMPATIBILITY RISK.

---

### V-R22: component-types.ts M1 Comment Block

**Actual at 3bc28f6:**
```typescript
  // ── M1: Behavioral Observations ──────────────────────────────────────
  //
  // Populated by the observation pipeline (Phase D). Optional because not
  // all code paths go through the observation system (existing tests,
  // events captured before coordinator was configured).

  /** M1: Behavioral observations from the observation coordinator. */

}
```
The comment block exists but the field is gone. This is a remnant from the behavioral observation removal.

**Verdict:** ⚠️ DEAD COMMENT — must be cleaned when adding new field.

---

### V-R23: types.ts — No Behavioral Message Types

**Actual at 3bc28f6:**
- `types.ts` AppMessage union: START_RECORDING, STOP_RECORDING, OPEN_SETTINGS, OPEN_REPOSITORY, RUN_TEST, PING, OBSERVED_EVENT
- No BEHAVIORAL_EFFECTS, no BEHAVIORAL_EVIDENCE
- Clean slate confirmed.

**Verdict:** ✅ VALIDATED.

---

## 3. Summary Matrix

| ID | Spec Requirement | Status | Action Needed |
|----|-----------------|--------|---------------|
| V-R1 | EventTap onAfterEvent hook | ✅ EXISTS | Wire onAfterEvent in recorder-entry.ts |
| V-R2 | ElementIdentity 18 fields | ✅ EXISTS | inputType field does NOT exist — spec error |
| V-R3 | ObservedEvent context | ✅ EXISTS | None |
| V-R4 | MAIN-world content script | ❌ DOES NOT EXIST | Create network-tap entry + manifest + bridge |
| V-R5 | SPA navigation via EventTap | ⚠️ CONFLICT | Navigation bypasses onAfterEvent — spec must specify path |
| V-R6 | Dexie V4 table | ❌ DOES NOT EXIST | Standard migration, straightforward |
| V-R7 | SW message types | ✅ PATTERN EXISTS | Add BEHAVIORAL_EVIDENCE type |
| V-R8 | ComponentInteraction field | ❌ FIELD REMOVED | Add behavioralEvidence field (new type) |
| V-R8a | M1 comment remnant | ⚠️ DEAD COMMENT | Remove orphaned comment block |
| V-R9 | @crxjs MAIN-world support | ⚠️ UNTESTED | Verify plugin compatibility |
| V-R10 | Enrichment→IR gap | ✅ OUT OF SCOPE | Separate concern |
| V-R11 | webRequest permission | ❌ DOES NOT EXIST | Add permission, UX consideration |
| V-R12 | Shadow DOM observation | ❌ DOES NOT EXIST | Build from scratch (open roots only) |
| V-R12a | Closed shadow roots | ❌ IMPOSSIBLE | Document as inherent limitation |
| V-R13 | Test infrastructure | ✅ EXISTS | jsdom limits for integration tests |
| V-R14 | Evidence correlation key | ✅ EXISTS | eventId is the key |
| V-R15 | SW restart recovery | ❌ CODE REMOVED | Rebuild durable recovery mechanism |
| V-R16 | Side panel renderer | ❌ CODE REMOVED | Create new renderer module |
| V-R17 | Orphaned M1 comment | ⚠️ DEAD COMMENT | Clean at implementation time |
| V-R18 | Global batch counter | ❌ DOES NOT EXIST | Build from scratch |
| V-R19 | Evidence attachment timing | ⚌ AMBIGUOUS | Spec must specify: sync vs async vs batch |
| V-R20 | Memory budget | ✅ SPEC OK | Must be newly built |
| V-R21 | Vite multi-script build | ⚠️ UNTESTED | Verify @crxjs/vite-plugin |
| V-R22 | Dead comment block | ⚠️ CLEANUP | Same as V-R8a |
| V-R23 | Clean message types | ✅ CONFIRMED | None |

---

## 4. Critical Issues Requiring Spec Update Before Implementation

### SC-1: Evidence Attachment Timing (V-R19)
**Severity:** CRITICAL
**Spec:** Does not specify when behavioral evidence attaches to ComponentInteraction
**Actual:** Current pipeline emits interactions immediately; observation windows close asynchronously (300ms-10s after trigger). Evidence cannot be attached at emission time because it doesn't exist yet.
**Required spec change:** Specify one of:
- (A) Deferred attachment: Evidence stays in SW memory (Map<eventId, BehavioralEvidence>), correlated to interaction at stopRecording persistence time
- (B) Two-pass model: Initial interaction emitted without evidence; enriched interaction re-emitted after window closes
- (C) Separately persisted: Evidence stored independently, correlated at query time (Dexie table)
**Recommendation:** (A) deferred attachment — lowest risk, matches the old system's proven pattern (pendingBehavioralEffects Map).

### SC-2: Navigation Event Hooking (V-R5)
**Severity:** HIGH
**Spec:** §9.1 says evidence hooks via onAfterEvent; §11.3 C2 fix says consume EventTap navigation events. Navigation events do NOT fire onAfterEvent.
**Required spec change:** Add a section specifying navigation event handling:
- Option A: Modify EventTap.emitSpaNavigation to also fire onAfterEvent
- Option B: Add onNavigation callback to EventTap config
- Option C: recorder-entry.ts handles navigation evidence in onEvent handler
**Recommendation:** Option A — minimal EventTap change, maintains single hook point.

### SC-3: inputType Field Error (V-R2)
**Severity:** LOW
**Spec:** §8.2 references inputType field on ElementIdentity
**Actual:** Field does not exist and never has.
**Required spec change:** Remove inputType reference, or mark as "to be added."

### SC-4: MAIN-World Script Build Path (V-R4, V-R9, V-R21)
**Severity:** CRITICAL
**Spec:** §12 requires MAIN-world content script for network interception.
**Actual:** No MAIN-world script exists. @crxjs/vite-plugin compatibility with `"world": "MAIN"` is untested.
**Required spec change:** Add a build/infrastructure section specifying:
- (A) Static manifest entry with `"world": "MAIN"` (preferred — verify crxjs support)
- (B) Dynamic injection via `chrome.scripting.executeScript({ world: 'MAIN' })` from SW (fallback — proven path)
**Recommendation:** Option B — `chrome.scripting.executeScript` with `world: 'MAIN'`. More reliable, no crxjs dependency, the `scripting` permission already exists. The SW calls this at recording start.

### SC-4b: Network Interception Scope
**Spec §12:** "fetch/XHR monkeypatch in MAIN world intercepts all page network calls."
**Constraint:** In MAIN world, the monkeypatch must execute BEFORE any page script runs, otherwise early fetch/XHR calls are missed. With `run_at: document_start`, this is theoretically possible. With dynamic `executeScript`, there may be a race condition between SW waking and the page's first network call.
**Required spec update:** Add note about the race condition and mitigation (webRequest as fallback for the gap).

### SC-5: webRequest Permission UX (V-R11)
**Permission expansion:** Adding `webRequest` to manifest permissions means users see a new permission prompt on update. Chrome does not show a prompt for permission additions on MV3 extension updates — it silently grants based on host permissions. However, the extension's privacy policy / store listing should mention network observation.
**Required spec change:** Minor — add a UX note about permission scope.

### SC-6: Deferred Dexie Table — Evidence vs. Session (V-R6)
**Severity:** MEDIUM
**Spec §11.5:** "New behavioral_evidence Dexie table."
**Question:** Is the Dexie table for long-term persistence (query later) or just session-scoped (cleared at stopRecording)?
- If long-term: Need schema design (indexes, relations to recordingSessions)
- If session-scoped: Simpler — just an indexed buffer, cleared after session save
**Required spec change:** Specify the persistence scope of the behavioral_evidence table.

---

## 5. What Must Be Newly Introduced (Not Reused)

| Item | Status | Notes |
|------|--------|-------|
| DOMObserver (MutationObserver manager) | NEW | Global batch counter, shadow DOM recursion, adaptive window |
| TargetEvidence capture (before/action/after state) | NEW | Element state snapshots at three points |
| ApplicationEvidence capture (DOM mutations, visibility, navigation) | NEW | Whole-document observer with noise filtering |
| NetworkTap (MAIN-world fetch/XHR interceptor) | NEW | CustomEvent/postMessage bridge to ISOLATED world |
| BehavioralEvidence type | NEW | Dual-scope container (TargetEvidence + ApplicationEvidence) |
| BEHAVIORAL_EVIDENCE message type | NEW | Content script → SW communication |
| ObservationWindow lifecycle | NEW | Adaptive: 300ms quiet → 10s max, max 5 concurrent |
| Behavioral evidence renderer | NEW | Side panel display (new module name, new types) |
| Dexie V4 schema + behavioral_evidence table | NEW | Migration from V3 |
| BehavioralEvidenceRepository | NEW | Dexie implementation + interface |
| SW durable recovery for evidence | NEW | chrome.storage.local keys, restart-safe |
| ElementStateSnapshot (before/after) | NEW | Pre-event state capture |
| StateCacheListeners | NEW | mousedown+focus pre-population |
| Global batch counter | NEW | Shared across all observation windows |
| Shadow DOM discovery | NEW | Recursive shadowRoot traversal |
| Evidence correlation service | NEW | Match evidence to interactions by eventId |
| ComponentInteraction.behavioralEvidence field | NEW | Replace removed behavioralObservations |
| SW evidence handler | NEW | Message handler for BEHAVIORAL_EVIDENCE |
| recorder-entry.ts onAfterEvent wiring | NEW | Wire the existing EventTap hook |
| Navigation evidence integration | NEW | Hook EventTap navigation events |
| 15+ test files | NEW | Unit + integration coverage |

---

## 6. What Must NOT Be Reused

| Old Item | Reason |
|----------|--------|
| ObservationCoordinator | Clean-slate mandate — new lifecycle model |
| ObservationResult type | Clean-slate mandate — new schema |
| SemanticEffect / EffectCategory | Clean-slate mandate — deferred correlation |
| behavioral-renderer.ts | Clean-slate mandate — new display module |
| ObservationWindow (old type) | Clean-slegate mandate — adaptive window different from old fixed 3s |
| DocumentObserver (old type) | Clean-slate mandate — new DOMObserver with batch counter |
| ElementStateCache (old type) | Clean-slate mandate — may reuse concept |
| ObservationResult.semanticEffects | Clean-sscribe mandate — no pre-classification |
| BEHAVIORAL_EFFECTS message type | Clean-slate mandate — new BEHAVIORAL_EVIDENCE type |
| EffectInterpreter / EffectRules | Clean-slate mandate — deferred correlation means NO interpretation at capture time |
| ObservedTransition / ApplicationKnowledgeFragment | Dead code — already removed |
| pendingBehavioralEffects Map | Old pattern — may reuse concept but new type |

---

## 8. What Continues Working Unchanged

| Component | Why Unchanged |
|-----------|---------------|
| EventTap | Only adds onAfterEvent wiring (already exists in EventTap) |
| IdentityExtractor | No changes needed |
| ComponentRuntime | No changes needed — only the output type gets a new field |
| EvidenceLedger | No changes needed |
| Enrichment layer | No changes — enrichment is orthogonal |
| IR Bridge | No changes — evidence does not flow into IR (deferred correlation) |
| Playwright Generation | No changes |
| Repository V2 (existing 8 tables) | No changes — V4 is additive |
| Service Worker core | Only adds new message handler |
| Settings page | No changes |
| Side panel HTML structure | Minimal — new renderer may add new DOM section |
| Build system | Possibly adds a new content script entry |
| Test framework | No changes — jsdom limits documented |

---

## 9. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| MAIN-world script race condition (network calls before script loads) | CRITICAL | webRequest fallback |
| @crxjs/vite-plugin MAIN-world compatibility | HIGH | Dynamic `executeScript` fallback |
| Shadow DOM closed roots unobservable | MEDIUM | Document as limitation |
| jsdom test limitations for timing/DOM | MEDIUM | Real-browser E2E tests |
| Memory growth on high-activity pages | MEDIUM | 5-window cap, 200-mutation cap, summarize |
| SW restart evidence loss | MEDIUM | Durable storage keys |
| Permission expansion UX | LOW | Privacy policy update |
| Orphaned M1 comment in component-types.ts | LOW | Clean at implementation |

---

## 10. Spec Modifications Required Before Implementation

| ID | Change | Severity |
|----|--------|----------|
| SC-1 | Specify evidence attachment timing (deferred recommended) | CRITICAL |
| SC- (Navigation) | Specify how navigation events hook into evidence (modify EventTap) | HIGH |
| SC-3 | Remove or flag inputType as non-existent | LOW |
| SC-4 | Specify MAIN-world injection path (dynamic executeScript preferred) | CRITICAL |
| SC-4b | Document network race condition + webRequest fallback | HIGH |
| SC-5 | Add webRequest permission UX note | LOW |
| SC-6 | Specify Dexie table persistence scope | MEDIUM |
| SC-7 | Remove orphaned M1 comment from component-types.ts reference | LOW |
| SC-8 | Remove "reuse ElementStateCache" if referenced — must be new | LOW |

**Total: 23 spec modifications required before implementation can begin.**

---

## 11. Final Verdict

**Spec v2.0 is architecturally sound but references infrastructure that was removed in 3bc28f6 and has ambiguities that must be resolved before implementation.**

The spec was written against deff878 (which had the old Behavioral Observation system) and updated for 3bc28f6 conceptually, but the v2.0 update did not fully account for the complete removal of:
- DocumentObserver (the old MutationObserver manager)
- ElementStateCache
- ObservationCoordinator
- All semantics infrastructure

The 23 modifications are primarily about:
1. Specifying infrastructure that must be newly built (not reused)
- Resolving evidence timing ambiguity
3. Correcting references to non-existent fields (inputType)
4. Specifying the MAIN-world injection path
5. Documenting build and permission risks

**Recommended next step:** Update spec to v3.0 resolving all 23 modifications, then implement against 3bc28f6.
