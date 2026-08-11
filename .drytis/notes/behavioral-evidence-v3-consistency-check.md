# Behavioral Evidence Model v3.0 — Final Consistency Check Against 3bc28f6

**Date**: 2026-08-11
**Spec**: `.drytis/specs/behavioral-evidence-model.md` v3.0 (1,840 lines)
**Baseline**: `3bc28f6` on `capability-surgical-removal`
**Verdict**: ✅ PASS — Spec is implementation-ready. All 23 validation findings resolved. All consistency checks verified against actual code.

---

## 1. Baseline Verification

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| HEAD commit | `3bc28f6` | `3bc28f65021a7a9fc6912366831beaffc21b1176` | ✅ |
| Branch | `capability-surgical-removal` | `capability-surgical-removal` | ✅ |
| Working tree | Clean (untracked spec/notes only) | 3 untracked `.drytis/` files only | ✅ |
| tsc --noEmit | 0 errors | 0 errors | ✅ |
| vitest | 89 files, 1,971 tests | 89 files, 1,971 tests passing | ✅ |

---

## 2. Codebase State Confirmed

| Item | Spec Claim | Actual at 3bc28f6 | Status |
|------|-----------|-------------------|--------|
| `src/tap/` directory | Contains only event-tap.ts + identity-extractor.ts | 2 files confirmed | ✅ |
| `src/semantics/` | Does NOT exist | `ls: No such file or directory` | ✅ |
| EventTap `onAfterEvent` | Defined at line 56, fires from handleRawEvent at 196-198 | Confirmed: 4 occurrences (definition + call) | ✅ |
| EventTap `emitSpaNavigation` | Emits nav via `onEvent` only, does NOT call `onAfterEvent` | Confirmed: body calls `config.onEvent(navEvent)` only | ✅ |
| recorder-entry `createEventTap` | Called with `{ onEvent }` only (line 222) | Confirmed: `createEventTap({ onEvent })` | ✅ |
| `submit` event type | NOT registered in EventTap | Confirmed: grep returns nothing | ✅ |
| `inputType` field | NOT in RawElementIdentity; identity-extractor reads `el.type` internally at line 70 but does NOT expose it | Confirmed: no `inputType` in types.ts; `el.type` used internally for role mapping only | ✅ |
| Dexie schema | V3 with 8 tables (projects, elements, testCases, testCaseVersions, sourceArtifacts, executionIRs, recordingSessions, executionRuns) | Confirmed: 3 version() calls, 8 stores in V3 | ✅ |
| Manifest permissions | sidePanel, storage, unlimitedStorage, activeTab, webNavigation, tabs, scripting, alarms | Confirmed exact match | ✅ |
| Manifest `world` field | NOT SET (ISOLATED world) | Confirmed: ISOLATED | ✅ |
| `webRequest` permission | NOT present | Confirmed: not in permissions | ✅ |
| `webRequest` usage | Not present anywhere in src/ | Confirmed: 0 occurrences | ✅ |
| SW message types | 7 types (START_RECORDING, STOP_RECORDING, OPEN_SETTINGS, OPEN_REPOSITORY, RUN_TEST, PING, OBSERVED_EVENT) | Confirmed exact match | ✅ |
| `chrome.scripting.executeScript` | Already used at line 107 | Confirmed | ✅ |
| ComponentInteraction M1 comment | Orphaned comment block at lines 440-448, field removed | Confirmed: comment present, `behavioralObservations` not found by grep | ✅ |
| `behavioralObservations` field | Removed from ComponentInteraction | Confirmed: 0 grep hits in component-types.ts | ✅ |

---

## 3. SC Resolution Verification

### SC-1: Evidence Attachment Timing — ✅ RESOLVED
- Spec §9 defines complete lifecycle: deferred in-memory attachment via `pendingEvidence: Map<string, BehavioralEvidence>` in SW
- Evidence attaches on match (interaction emitted → SW finds evidence in Map) or at `stopRecording` (flush remaining)
- Side panel gets live updates via `INTERACTION_EVIDENCE_UPDATE`
- SW restart recovery via sessionStorage buffer (§9.4)
- No `chrome.storage.local` durable keys for raw evidence

### SC-2: Navigation Events — ✅ RESOLVED
- Spec §7.2 specifies exact EventTap modification: add `config.onAfterEvent(...)` call at end of `emitSpaNavigation()`
- Verified: `emitSpaNavigation()` at line 100 currently calls `config.onEvent(navEvent)` only — no `onAfterEvent`
- Spec provides exact code snippet for the modification
- Spec also specifies adding `navType` to navigation ObservedEvent for distinguishing pushState/replaceState/popstate/hashchange

### SC-3: inputType — ✅ RESOLVED
- Spec §8.2 explicitly states: "This was incorrect — `inputType` does NOT exist in `RawElementIdentity` or `ElementIdentity` at `3bc28f6`"
- Marked as NEW field addition with exact code snippet
- Verified: `inputType` is used internally in `identity-extractor.ts` line 70 for role mapping (`el.type?.toLowerCase()`) but is NOT exposed as a field on ElementIdentity
- Spec correctly identifies this as a new addition requiring `RawElementIdentity` modification

### SC-4: MAIN-World Network Interception — ✅ RESOLVED
- Spec §6.2 specifies dynamic `chrome.scripting.executeScript({ world: 'MAIN', injectImmediately: true })` instead of static manifest entry
- Verified: `chrome.scripting.executeScript` already used at line 107 in service-worker.ts — proven API
- Spec requires standalone bundle (`network-inject.js`) for MAIN-world — no crxjs dependency
- Spec specifies CustomEvent bridge between MAIN and ISOLATED worlds

### SC-4b: Network Race Condition — ✅ RESOLVED
- Spec §6.3 specifies webRequest listeners run IN PARALLEL from recording start (not just CSP fallback)
- Deduplication: prefer 'main-world' source, keep 'webrequest' if only source
- Spec provides code showing webRequest registration BEFORE executeScript call

### SC-5: webRequest Permission — ✅ RESOLVED
- Spec §6.7 specifies adding `"webRequest"` to permissions array
- Notes that MV3 webRequest is observational-only, no `webRequestBlocking` needed
- UX note: host permissions already cover URLs, no new user prompt on update

### SC-6: Dexie Table Scope — ✅ RESOLVED
- Spec §12.6 defines `behavioral_evidence` table as long-term queryable persistence
- Indexes: `++id, interactionEventId, sessionId`
- Evidence stored separately from interactions (not inlined) to avoid blob inflation
- Lazy-loaded via `behavioral_evidence.where('interactionEventId').equals(eventId)`
- V4 schema specified with all V1-V3 stores repeated (Dexie requirement)

### SC-7: Orphaned M1 Comment — ✅ RESOLVED
- Spec §9.3 explicitly states: "Implementation must remove this orphaned comment and add the new field"
- Provides exact replacement code block
- Verified: orphaned comment at lines 440-448 in component-types.ts

### SC-8: No Reuse of Removed Systems — ✅ RESOLVED
- Spec §15 states: "This spec defines clean-slate replacements. No removed file is reused, no removed type is reused, no removed pattern is reused verbatim."
- All new file names differ from removed files (e.g., `evidence-renderer.ts` not `behavioral-renderer.ts`, `dom-observer.ts` not `document-observer.ts`, `evidence-collector.ts` not `observation-coordinator.ts`)
- All new type names differ (e.g., `BehavioralEvidence` not `ObservationResult`, `TargetStateSnapshot` not `ElementStateSnapshot`)

---

## 4. V-R Resolution Verification

| V-R ID | Spec Section | Verified Against Code | Status |
|--------|-------------|----------------------|--------|
| V-R1 (onAfterEvent wiring) | §4.2 | recorder-entry.ts line 222: `createEventTap({ onEvent })` — confirmed not wired | ✅ |
| V-R2 (18-field ElementIdentity) | §8.1 | RawElementIdentity 17 fields + elementId = 18 — confirmed in types.ts | ✅ |
| V-R3 (ObservedEvent context) | §4.2 | All fields present (pageUrl, pageTitle, timestamp, captureSeq) | ✅ |
| V-R4 (MAIN-world doesn't exist) | §6.2 | No MAIN-world script, no world:'MAIN' in manifest | ✅ |
| V-R5 (Navigation bypasses onAfterEvent) | §7.2 | emitSpaNavigation calls onEvent only — confirmed | ✅ |
| V-R6 (No Dexie behavioral_evidence) | §12.6 | V3 has 8 tables, no behavioral_evidence — confirmed | ✅ |
| V-R7 (SW message types) | §12.2 | 7 types in switch, no BEHAVIORAL_EVIDENCE — confirmed | ✅ |
| V-R8 (field removed) | §9.3 | behavioralObservations not found in component-types.ts — confirmed removed | ✅ |
| V-R9 (@crxjs MAIN-world risk) | §6.2 | Dynamic executeScript avoids crxjs entirely | ✅ |
| V-R10 (Enrichment→IR gap) | §12.5 | Listed as unchanged — out of scope | ✅ |
| V-R11 (no webRequest) | §6.7 | webRequest not in permissions — confirmed | ✅ |
| V-R12 (no shadow DOM obs) | §5.1 | No document-observer.ts exists — must build new | ✅ |
| V-R13 (jsdom limits) | §14.1 | Documented with mitigation strategy | ✅ |
| V-R14 (eventId correlation) | §9.2 | eventId is page-unique, monotonically increasing | ✅ |
| V-R15 (SW restart recovery removed) | §9.4 | sessionStorage buffer pattern specified | ✅ |
| V-R16 (side panel renderer removed) | §12.4 | New evidence-renderer.ts module specified | ✅ |
| V-R17 (orphaned M1 comment) | §9.3 | Cleanup specified | ✅ |
| V-R18 (global batch counter) | §4.5/§5.3 | Must be built into DOMObserver | ✅ |
| V-R19 (evidence timing ambiguous) | §9.2 | Deferred attachment fully specified | ✅ |
| V-R20 (memory budget) | §10 | All caps defined | ✅ |
| V-R21 (Vite multi-script) | §6.2 | Standalone bundle, no crxjs dependency | ✅ |
| V-R22 (dead M1 comment) | §9.3 | Same as V-R17 | ✅ |
| V-R23 (clean message types) | §12.2 | No conflicts with existing types | ✅ |

---

## 5. Cross-Spec Contradiction Check

| Check | Status | Notes |
|-------|--------|-------|
| Spec baseline is 3bc28f6 throughout | ✅ | Header, §15, §19 — all reference 3bc28f6 |
| No references to deff878 as implementation baseline | ✅ | deff878 only mentioned as historical context (§18 comparison table) |
| No references to aef34a0 as implementation baseline | ✅ | Not referenced in v3.0 at all |
| inputType consistently marked as NEW | ✅ | §8.2, §19 SC-3 row, §20 checklist |
| MAIN-world consistently uses dynamic executeScript | ✅ | §2 diagram, §6.2, §6.3, §15, §19 — all consistent |
| webRequest consistently described as parallel | ✅ | §2 diagram, §6.3, §6.7, §14.2 — all consistent |
| Coarse mode consistently keeps first 200 | ✅ | §3.4, §5.2, §10.1, §14.3 — all consistent |
| Batch counter consistently shared/global | ✅ | §3.5, §4.5, §5.3, §10.1 — all consistent |
| Evidence lifecycle consistently deferred | ✅ | §2 diagram, §9.1-§9.4, §12.3, §12.6 — all consistent |
| Dexie table consistently long-term persistence | ✅ | §12.6 — V4 schema specified |
| No "reuse removed system" language | ✅ | All new file/type names, §15 explicit statement |
| File structure matches integration descriptions | ✅ | §15 file list matches §12 integration points |
| Event-trigger matrix matches EventTap actual events | ✅ | §4.1 lists 12 actual + submit (new) |

---

## 6. Spec Completeness Assessment

| Dimension | Assessment |
|-----------|------------|
| **Types defined** | ✅ Complete — BehavioralEvidence, EvidenceWindow, TargetEvidence, TargetStateSnapshot, FocusMovement, ApplicationEvidence, DomChangeSummary, SurfaceChange, VisibilityChange, NavigationEvidence, NetworkActivity, PerformanceCondition, StabilitySample |
| **Lifecycle defined** | ✅ Complete — open → observe → close → deliver → attach → persist |
| **Integration points** | ✅ Complete — EventTap, recorder-entry, SW, component-types, types, manifest, Dexie, session-persistence, side panel |
| **Memory limits** | ✅ Complete — per-window, per-session, performance budgets |
| **Error handling** | ✅ Complete — endReasons, SW restart recovery, race mitigation |
| **Test strategy** | ✅ Complete — 7 unit test files, 10 integration scenarios, 16 invariants |
| **Implementation phases** | ✅ Complete — 8 phases with deliverables |
| **Limitations documented** | ✅ Complete — closed shadow roots, jsdom, submit optional for Phase 1 |

---

## 7. Final Verdict

**RESULT: PASS**

The Behavioral Evidence Model v3.0 specification:
1. ✅ Resolves all 23 validation findings (SC-1 through SC-8, V-R1 through V-R23)
2. ✅ Is verified against the actual code at commit `3bc28f6`
3. ✅ Contains no contradictions between sections
4. ✅ Depends only on infrastructure that survives at `3bc28f6`
5. ✅ Correctly identifies all code that must be newly introduced (17 items)
6. ✅ Correctly identifies all code that must be modified (9 files)
7. ✅ Correctly identifies all code that remains unchanged (12 systems)
8. ✅ Does not reuse any removed file, type, or pattern
9. ✅ Is implementation-ready with 8-phase plan

**No source code, tests, schema, or build files were modified during this validation.**
