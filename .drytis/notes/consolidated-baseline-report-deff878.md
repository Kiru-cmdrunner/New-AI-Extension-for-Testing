# Consolidated Baseline Report — deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8

Audited exclusively against `/workspace/tmp/deff878-audit`. All findings sourced from the six layer audits.

---

## 1. Working Correctly

These subsystems are architecturally sound and function as designed:

**Layer 0 — Event Capture:**
- 12-event-type registration with capture-phase document-level listeners
- 4-strategy target resolution (composedPath → parent walk → clickable heuristic → raw)
- 10-tier accessible name cascade
- SPA navigation detection (history.pushState/replaceState monkey-patch + popstate/hashchange)
- Durable event delivery with sessionStorage buffering + exponential backoff retry
- CSS-in-JS class filtering in locator ranking

**Layer 1 — Behavioral Observation:**
- 3-second independent observation windows with WeakRef element management
- Refcounted MutationObserver lifecycle
- Before/after element state snapshot capture (10 fields)
- Three safe-point cleanup for durable obs keys
- Mojo IPC serialization pressure mitigations (transient event handling)

**Layer 2 — ComponentRuntime:**
- Priority-ordered discovery (14 definitions, Click=180 fallback)
- Disposition lifecycle (pending → absorbed → claimed|unclaimed) with terminal immutability
- W3C-standard lifecycle ownership test (semanticChildRoles + surface ancestry)
- Per-type temporal dedup with type-specific special cases
- Evidence Ledger audit trail for 4 discrete event types
- Scroll gesture coalescing via shouldCompleteOnOutside
- Hover confidence model (5 weighted signals, threshold ≥50)

**Layer 3 — Enrichment:**
- Framework detection (11 frameworks) with specific regex patterns
- SortButton-before-DataGrid ordering
- IconButton detection with 68-entry ICON_SEMANTIC_NAMES map
- Meaning resolution covers all 15 interaction types with graceful degradation
- Pure functions — no DOM access, fully testable

**Layer 4 — Capability Inference:**
- Conflict resolver (6 rules): confidence > signal count > priority, LOW-only → Unclassified
- Evidence extractor clean separation — rules consume ExtractedEvidence not raw interactions
- "Paginate correction principle" — remote content-change alone never sufficient
- URL path vs query param distinction in Navigate/OpenDetail/FilterSelection/SortSelection
- SubmitForm form-context backward scan

**Layer 5 — Generation:**
- Locator ranking 5-category hierarchy (BUSINESS → ACCESSIBILITY → STABLE_TECHNICAL → CONTENT → STRUCTURAL)
- Auto-generated ID detection (16 regex patterns)
- Action renderer covers all 10 IRAction types
- Playwright config best practices (fullyParallel, CI-aware retries, trace)
- String escaping consistent across renderers
- Graceful degradation — enrichment absent → valid plan

**Layer 6 — Persistence:**
- Dexie schema V1→V2→V3 versioning
- Unit of Work atomic transactions across 9 tables
- RecordingSession 3-tier data model (canonical/operational/archival)
- EvidenceLedger persistence survives SW restart
- Durable observation keys survive SW death with three cleanup points
- Repository V2 interface/repository pattern separation
- Non-fatal persistence (.catch) — storage failures don't crash recording

---

## 2. Confirmed Bugs

Issues where the code definitively does the wrong thing, verified in source:

| # | Layer → ID | Bug |
|---|-----------|-----|
| 1 | L0 → C-3 | elementId always `''` — hardcoded empty string. Breaks IR dedup, capability matching, POM grouping, assertion targets. |
| 2 | L5 → 5-C-1 | Or-1 readability merge: `'' === ''` always true → ALL consecutive CLICK steps on DIFFERENT elements are merged. Second click silently dropped from generated test. |
| 3 | L5 → 5-C-3 | FileUpload maps to FILL → `.fill()`. Playwright throws on file inputs. Should be `.setInputFiles()`. Every file upload step is invalid. |
| 4 | L5 → 5-H-5 | RadioButton maps to SELECT → `.selectOption()`. Playwright throws on radio inputs. Should be `.check()`. Every radio button step is invalid. |
| 5 | L5 → 5-H-4 | Dropdown `.selectOption()` only works for native `<select>`. Custom dropdowns (OXD, MUI, React-Select) produce invalid code. |
| 6 | L5 → 5-C-4 | `deriveAssertions()` always returns `[]`. 397 LOC assertion renderer is dead code. Generated tests have ZERO assertions. |
| 7 | L4 → 4-C-3 | 4 rules scan `evidence.keywords.matches` for their own keywords, but their types aren't in the KEYWORD_DICTIONARY. Keyword signal is dead code — will never fire. |
| 8 | L3 → 3-C-1 | Flush path (stopRecording) does NOT call `enrichInteraction`. Scroll, interrupted lifecycles, abandoned components have no componentType/businessMeaning. |
| 9 | L3 → 3-H-3 | DIALOG_RE matches `overlay` and `popup` — extremely broad. Clicking inside `card-overlay` classified as Dialog. |
| 10 | L3 → 3-H-4 | CAROUSEL_RE matches bare `slide` — `slide-toggle`, `slide-menu` misclassified as Carousel. |
| 11 | L3 → 3-H-5 | TOGGLE_SWITCH_RE matches bare `switch` — `switch-theme`, `switch-view` misclassified as ToggleSwitch. |
| 12 | L4 → 4-H-2 | matchKeywords uses substring `includes()` — 'go' matches 'logo', 'make' matches 'smokescreen'. False-positive keyword signals. |
| 13 | L0 → H-1 | resolveTarget() called twice per event — redundant O(n) DOM walk per event in the capture path. |
| 14 | L6 → 6-C-1 | persistSession receives `capability: null`. Capability Matching Service (302 LOC) + create/enrich paths never fire. `capabilities` table never populated. |
| 15 | L6 → 6-C-2 | rawEvents always `[]` — archival tier has no event data. SessionEvent array never populated. |
| 16 | L6 → 6-H-3 | recordingStartUrl/Title not recovered on SW restart — SW module-level variables lost. IR startUrl falls back to current tab URL. |
| 17 | L4 → 4-H-1 | 'search' and 'find' in BOTH SubmitForm and Search keyword categories — creates unnecessary claim competition for search-box interactions. |

---

## 3. Technical Debt

Issues that don't break functionality but create maintenance burden, performance risk, or future fragility:

**Performance debt:**
- L0 → H-2: SessionStorage buffer O(n²) — JSON.parse→push→JSON.stringify on growing array (up to 500 entries)
- L0 → H-3: deepGetElementById/deepQuerySelector O(n) per call in capture-phase handler
- L2 → 2-H-4: releaseClaims() O(n) full-scan per abandonment — O(n×m) total per session
- L2 → 2-H-3: EvidenceLedger getEntries() O(n log n) sorted copy per call
- L2 → 2-L-1: findDefForType() O(n) linear scan instead of Map
- L1 → 1B-H-1: No buffer cap on mutation records array — heavy SPAs can produce thousands of records per 3s window
- L1 → 1B-H-3: O(n) full-array scan per observation delivery in handleBehavioralEffects

**Unbounded state:**
- L2 → 2-H-2: errorLog unbounded string[] — buggy definition throwing on every event grows memory
- L2 → 2-H-3: EvidenceLedger no eviction cap — grows unbounded for session
- L6 → 6-H-1: No eviction of old sessions in Repository V2
- L6 → 6-H-2: chrome.storage.local full-array write on every event

**Dead code:**
- L0 → TD-3: deterministic-recorder.ts (2,724 LOC) — dead code from Era 2/3
- L6 → 6-C-3: 13 of 30 StorageKeys dead (session_events, session_steps, detected_interactions*, knowledge_fragment, recognition_components, domain_entities, replay_json, screenshots, understanding_result, capability_candidate)
- L6 → 6-M-3: V1 repository-service.ts (481 LOC tests) fully implemented but disconnected from V2
- L6 → 6-M-4: healFromRecording() (274 LOC) never called
- L6 → 6-M-7: sourceArtifacts table never populated
- L5 → 5-H-8: Two parallel generation paths (generator.ts ATC vs ir-bridge.ts recording)
- L4 → 4-C-1: Capability engine (2,722 LOC) produces display-only data
- L5 → 5-C-5: Generation enrichment parameter always undefined

**Non-determinism:**
- L5 → 5-M-3: testCaseId/versionId use Date.now() — violates INV-GEN-1
- L6 → 6-M-10: crypto.randomUUID() for all entity IDs — no idempotency

**Code quality:**
- L5 → 5-L-2: escapeString duplicated across 4 renderer files
- L6 → 6-M-9: Dexie version() blocks repeat all store definitions
- L5 → 5-M-7: pageOrComponent always `'main'` — no page detection
- L4 → 4-M-10: isCheckboxLike boolean expression relies on operator precedence

---

## 4. Missing Capabilities

Features the system needs but has no implementation for:

| # | Missing Capability | Impact |
|---|-------------------|--------|
| 1 | **Drag-and-drop capture** (L0 → C-2, L5 → 5-H-3) | No drag/drop events captured, no interaction type, no IR action, no renderer. Entire interaction class invisible. |
| 2 | **Touch/pointer events** (L0 → C-2) | No touchstart/end/move, no pointerdown/up/move. Mobile/touch interactions invisible. |
| 3 | **Submit event** (L0 → M-3) | No `<form>` submit capture. Form submission inferred from button click only. |
| 4 | **keyup event** (L0 → M-2) | No keyup capture. Key sequences incomplete. |
| 5 | **dblclick event** | Not captured. Double-click interactions invisible. |
| 6 | **Autocomplete/Combobox definition** (L2 → 2-C-3) | No definition for combobox search text. Typed filter text absorbed by Dropdown, never captured. |
| 7 | **Assertion generation** (L5 → 5-C-4) | deriveAssertions always []. No outcome verification in generated tests. |
| 8 | **AI Understanding** (IR Bridge understanding:null) | Track 3 AI understanding never implemented. No semantic interpretation of recordings. |
| 9 | **ApplicationKnowledgeFragment** (L6 → 6-C-5) | UnderstandingResult.fragment always null. No structural understanding generated. |
| 10 | **CapabilityCandidate generation** (L6 → 6-C-1) | UnderstandingResult.capability always null. No business-capability candidates produced for persistence. |
| 11 | **Scroll in generated tests** (L5 → 5-M-1) | Scroll filtered as NOISE. Can't reproduce scroll-dependent flows (lazy loading, infinite scroll). |
| 12 | **Shadow DOM observation** (L1 → 1B-C-2) | MutationObserver doesn't cross shadow boundaries. Web Component mutations invisible. |
| 13 | **Navigation buttons (back/forward)** | Not specifically captured. Browser back/forward button clicks may produce Unclassified. |
| 14 | **Multi-tab recording** | All recording is single-tab. Multi-tab flows not supported. |
| 15 | **Recording-time element healing** (L6 → 6-M-4) | healFromRecording available but never called. Elements not updated from fresh recordings. |
| 16 | **Session listing/browsing UI** (L6 → 6-L-6) | Repository V2 stores sessions but no UI to view them. |
| 17 | **Test case management** (L6 → 6-M-1) | No ApprovedTestCase or TestCaseVersion ever created from recordings. |

---

## 5. Architectural Gaps

Structural disconnections where subsystems exist but don't connect to each other:

### Gap A: The Capability Pipeline is a Dead Branch

```
Layer 4 (2,722 LOC)     → capability_records (chrome.storage.local)
                           ↓ DISPLAY ONLY

Layer 6 persistSession  → understanding.capability = null
                           ↓
Repository V2            → capabilities table → NEVER POPULATED
CapabilityMatchingService → NEVER CALLED
```

**Root cause:** service-worker.ts line 356 passes `capability: null`. Nothing bridges the capability engine output to persistSession.
**Layers affected:** 4, 6.
**Dependencies:** 4-C-1 (display-only) + 6-C-1 (null passed) + 6-C-5 (understanding null).

### Gap B: The Enrichment Layer is Disconnected from Everything

```
Layer 3 (521 LOC)       → enriches ComponentInteraction with componentType/businessMeaning
                           ↓ ONLY on onEmit path

Flush path              → NOT enriched (3-C-1)
Projection path         → NOT enriched (3-C-2)
Capability Engine       → does NOT read enrichment fields (3-C-3)
IR Bridge               → does NOT receive enrichment (5-C-5)
```

**Root cause:** Enrichment called only from onEmit callback (2 call sites). All other paths bypass it. Even enriched data is never consumed downstream.
**Layers affected:** 3, 4, 5.
**Dependencies:** 3-C-1 + 3-C-2 + 3-C-3 + 5-C-5.

### Gap C: Two Parallel Repositories

```
V1 (chrome.storage.local 'test_repository')
  ← repository-service.ts, repository-page.ts, sidepanel display
  ← manages projects, test cases, elements

V2 (Dexie/IndexedDB 'cmdrunner_repository')
  ← persistSession only
  ← manages recording sessions, capabilities, IR artifacts
  ← NEVER SYNCED with V1
```

**Root cause:** V1 was the original repository. V2 was added as Phase 10 but V1 was never migrated or deprecated.
**Layers affected:** 6.
**Dependencies:** 6-C-4 + 6-M-3.

### Gap D: elementId Breaks the Generation Pipeline

```
Layer 0 → elementId always '' (C-3)
  ↓
Layer 5 → Or-1 merge: '' === '' always true → drops clicks (5-C-1)
Layer 5 → POM dedup: all elements collide (5-M-10)
Layer 4 → capability matching: scoreEntryElement can't match by ID
Layer 6 → Repository V2 elements: no elementId to link
```

**Root cause:** identity-extractor.ts hardcodes `elementId: ''`.
**Layers affected:** 0, 2, 4, 5, 6.
**Dependencies:** C-3 → 5-C-1 → 5-C-6 → 5-M-10. This is the single most cross-cutting bug.

### Gap E: Behavioral Evidence Starvation

```
Layer 1 → observation windows ONLY for click+change (1B-C-1)
  ↓ 70%+ of interaction types get ZERO behavioral evidence
Layer 3 → SemanticEffect[] empty for those interactions
  ↓
Layer 4 → 4 of 12 rules REQUIRE SemanticEffects → return null
  ↓ ToggleControl, ExpandCollapse, FilterSelection, SortSelection inoperable
```

**Root cause:** Observation windows only open for click and change events. All other trigger events (focus, mouseenter, scroll, navigation) get no observation.
**Layers affected:** 1, 3, 4.
**Dependencies:** 1B-C-1 → 4-C-2.

### Gap F: Unclassified Interactions Silently Dropped

```
Layer 2 → Projection Engine creates Unclassified stubs for unclaimed events
  ↓ (correctly — capture guarantee)
Layer 5 → NOISE_TYPES = { Scroll, Unclassified } → DROPPED from IR plan
  ↓ Real user actions (clicks on custom elements) disappear from generated tests
```

**Root cause:** Unclassified is treated as noise and filtered, despite representing legitimate user actions.
**Layers affected:** 2, 5.
**Dependencies:** 5-C-2.

### Gap G: System B (Domain Capability Model) Entirely Inactive

```
Domain entities: Capability, CapabilityCandidate, ApplicationKnowledgeFragment
Services: CapabilityMatchingService, ElementMatchingService, HealingService (healFromRecording)
Tests: 1,031+ LOC (capability-matching 507, domain/capability 524)
  ↓ ALL PASSING but NEVER CALLED in production
```

**Root cause:** The bridge from runtime capability records to domain CapabilityCandidate was never built. persistSession always receives null.
**Layers affected:** 4, 6.

---

## 6. False / Uncertain Findings Requiring Validation

Issues that need real-Chrome or real-world testing to confirm:

| ID | Finding | Why Uncertain |
|----|---------|---------------|
| **L0 → C-1** | mouseenter/mouseleave may only fire at document boundary, not child elements | Document-level capture listener for non-bubbling events. jsdom tests pass but real Chrome capture behavior for non-bubbling events at document level is unverified. **If confirmed, the entire Hover definition (Layer 2 → 2-H-8) is non-functional.** |
| **L0 → H-5** | checkedBefore timing may capture AFTER state toggle | Browser pre-click activation is documented but timing in capture-phase listener may vary. Needs real Chrome validation with high-speed recording. |
| **L2 → 2-H-7** | Checkbox checkedBefore semantics for ARIA checkboxes | Native checkbox pre-click activation is documented. ARIA checkboxes managed by JS frameworks may not follow the same timing. Needs framework-specific testing (React, Vue, Angular). |
| **L5 → 5-H-1** | ColorInput `.fill()` may not work with native color picker | Playwright's fill() on `<input type="color">` behavior varies by browser/OS. Needs cross-browser testing. |
| **L5 → 5-H-6** | Hover `.hover()` may not trigger JS-driven menus | Playwright hover performs real mouse hover. Some JS frameworks require specific mouse movement patterns or delays. Needs real application testing. |
| **L6 → 6-H-5** | `.catch(()=>{})` silent data loss | Whether chrome.storage.local writes actually fail in practice under MV3 is unknown. unlimitedStorage permission may prevent quota errors. Needs long-session stress testing. |
| **L1 → 1B-L-2** | setTimeout 3s not guaranteed in backgrounded tabs | Browser throttles timers in backgrounded tabs. Whether this affects recording on inactive tabs needs real Chrome testing. |

---

## Critical / High Issue Impact Matrix

### Layer → ID → Impact → Blocks Product Goal? → Dependencies

#### CRITICAL

| Layer | ID | Impact | Blocks? | Dependencies |
|-------|----|--------|---------|--------------|
| L0 | C-3 | elementId always `''` — breaks dedup, POM grouping, assertion targets, capability matching | **YES** | Root cause of 5-C-1, 5-C-6, 5-M-10 |
| L0 | C-2 | No pointer/touch/drag events — entire interaction classes invisible | **YES** (mobile/drag) | Causes 5-H-3 |
| L1 | 1B-C-1 | Observation windows click+change only — 70%+ get zero behavioral evidence | **YES** (capability) | Causes 4-C-2. Independent issue. |
| L1 | 1B-C-2 | MutationObserver doesn't cross shadow boundaries | Partial (Web Components) | Independent |
| L2 | 2-C-1 | Active stack lost on SW restart — in-flight lifecycles vanish | Partial (recovery) | Independent |
| L2 | 2-C-3 | Combobox text search loses typed filter text | Partial (autocomplete) | Independent |
| L3 | 3-C-1 | Flush path skips enrichment — Scroll/interrupted have no enrichment | NO (cosmetic) | Independent |
| L3 | 3-C-2 | Unclassified never enriched — stubs have null className | NO (cosmetic) | Depends on 5-C-2 (Unclassified dropped anyway) |
| L3 | 3-C-3 | Enrichment disconnected from Capability Engine | NO (display-only) | Part of Gap B |
| L4 | 4-C-1 | Capability output display-only — not connected to generation/persistence | NO (display works) | Part of Gap A. Depends on 6-C-1. |
| L4 | 4-C-2 | 4 of 12 rules inoperable without behavioral evidence | **YES** (capability) | Caused by 1B-C-1 |
| L4 | 4-C-3 | Dead keyword signal in 4 rules — keyword support never fires | NO (rules still work at MEDIUM) | Independent |
| L4 | 4-C-4 | Classifies UI interactions, not application capabilities | **YES** (semantic goal) | Architectural — requires System B activation |
| L5 | 5-C-1 | Or-1 merges ALL consecutive CLICKs — legitimate clicks dropped | **YES** | Caused by C-3. THE most severe generation bug. |
| L5 | 5-C-2 | Unclassified interactions completely dropped from generated tests | **YES** | Independent |
| L5 | 5-C-3 | FileUpload generates `.fill()` — throws at runtime | **YES** | Independent |
| L5 | 5-C-4 | deriveAssertions always [] — zero assertions in tests | **YES** (test quality) | Requires Track 3 enrichment |
| L5 | 5-C-5 | No capability/enrichment reaches generation | NO (degrades quality) | Depends on 3-C-3, 4-C-1 |
| L5 | 5-C-6 | elementId always '' — IR target identity unreliable | **YES** | Caused by C-3 |
| L6 | 6-C-1 | persistSession receives capability:null — capability persistence dead | NO (recording works) | Root cause of Gap A |
| L6 | 6-C-2 | rawEvents always [] — archival tier empty | NO (interactions archived) | Independent |
| L6 | 6-C-3 | 13/30 StorageKeys dead | NO (maintenance burden) | Independent |
| L6 | 6-C-4 | Two parallel repositories with no sync | Partial (UX) | Independent |
| L6 | 6-C-5 | UnderstandingResult null/null — canonical tier empty | NO (archival tier works) | Depends on 6-C-1, 4-C-1 |

#### HIGH (selected most impactful)

| Layer | ID | Impact | Blocks? | Dependencies |
|-------|----|--------|---------|--------------|
| L1 | 1B-H-2 | Orphaned obs keys — 143MB in 3 hours (crash root cause Vector A) | **YES** (crash) | **RESOLVED post-baseline** but exists at deff878 |
| L2 | 2-H-2 | errorLog unbounded — memory growth in long sessions | Partial (crash risk) | Independent |
| L2 | 2-H-6 | Dropdown over-absorbs non-option clicks inside surfaces | Partial (accuracy) | Independent |
| L3 | 3-H-3 | DIALOG_RE matches 'overlay'/'popup' — false Dialog classification | Partial (accuracy) | Independent |
| L4 | 4-H-2 | matchKeywords substring matching — false keyword signals | Partial (accuracy) | Independent |
| L5 | 5-H-2 | DatePicker `.fill()` for custom calendars — most date pickers fail | **YES** (enterprise apps) | Independent |
| L5 | 5-H-4 | Dropdown `.selectOption()` on non-`<select>` — custom dropdowns fail | **YES** (enterprise apps) | Independent |
| L5 | 5-H-5 | RadioButton `.selectOption()` instead of `.check()` — throws | **YES** | Independent |
| L6 | 6-H-5 | `.catch(()=>{})` silent data loss on storage write failure | Partial (recovery) | Independent |

---

## Top 10 Issues to Address Before Production-Ready

Ranked by: (1) makes generated tests WRONG, (2) causes CRASHES, (3) makes real-world apps UNRECORDABLE, (4) severity × breadth of impact.

### 1. 🥇 5-C-1 — Or-1 Merge Drops Legitimate Clicks
**Layer 5 → caused by L0 C-3**
Generated tests silently omit user actions. Click Submit then Click Cancel → Cancel vanishes. This is the single most damaging bug: the generated test does not represent what the user did.
**Fix unblocks:** 5-C-6, 5-M-10 (POM dedup).

### 2. 🥈 5-C-3 + 5-H-5 + 5-H-4 — Wrong Playwright APIs
Three interaction types generate code that THROWS at runtime: FileUpload (`.fill()`), RadioButton (`.selectOption()`), Dropdown on custom elements (`.selectOption()`). Any test containing these steps is unrunnable. These are straightforward mapping fixes.

### 3. 🥉 5-C-2 — Unclassified Interactions Dropped
Every click on a custom interactive element (no BUTTON/A/ARIA role/interactive class) is filtered as noise. Modern SPAs with div-based interactive elements lose real user actions. Combined with 5-C-1, significant portions of user flows may be missing from generated tests.

### 4. C-3 — elementId Always Empty String
The root cause behind #1 and #5-C-6. Affects dedup, POM grouping, capability matching, assertion targets. Must be fixed for the generation pipeline to produce correct, element-distinguishing output. Cross-cutting — fixing this unblocks multiple downstream issues.

### 5. 1B-C-1 — Observation Windows Only for Click+Change
70%+ of interaction types get zero behavioral evidence. This makes 4 of 12 capability rules inoperable (4-C-2) and means the Semantic Effect Interpreter (Layer 3 semantics) has no input for most interactions. Blocks the entire behavioral evidence pipeline for focus/mouseenter/scroll/navigation triggers.

### 6. 1B-H-2 — Orphaned cmdrunner_obs_* Keys (Memory Leak)
The documented crash root cause: 143MB in 3 hours. While post-baseline commits resolved this, at the deff878 baseline it causes SW termination. The orphaned-key accumulation pattern must be structurally sound before production use.

### 7. 5-C-4 — Zero Assertions in Generated Tests
Generated tests only perform actions — they never verify outcomes. The assertion renderer (397 LOC) is complete but receives no input. A test without assertions is a script, not a test. This is the difference between "recorder" and "test generator."

### 8. 6-C-1 + 4-C-1 — Capability Pipeline Completely Disconnected
2,722 LOC of capability inference + 302 LOC of matching service + domain entities produce nothing that reaches generation or persistence. The capability engine classifies interactions but its output goes to a display-only storage key. `persistSession` always receives `capability: null`. This blocks the product's semantic intelligence goal entirely.

### 9. L0 C-1 — mouseenter/mouseleave Capture (REQUIRES VALIDATION)
If confirmed in real Chrome, the entire Hover definition (Layer 2 → 2-H-8) is non-functional. This is the only finding that could invalidate an entire interaction type. Must be validated before any other Hover-related work. If confirmed, Hover needs a fundamentally different capture strategy.

### 10. 2-C-1 + 2-C-2 — SW Restart Loses Active Stack and Dedup Integrity
MV3 service workers can restart at any time (~30s idle). The active stack (in-flight Dropdowns, DatePickers, TextEntries) is lost. seenEventIds halving can cause duplicate processing. For production recording sessions that may last minutes, this guarantees data loss or duplication on any SW restart during a lifecycle.

---

## Dependency Graph (Top 10)

```
C-3 (elementId '') ────────────────→ 5-C-1 (Or-1 merge)
│                              ────→ 5-C-6 (IR identity)
│                              ────→ 5-M-10 (POM dedup)
│
5-C-3 + 5-H-5 + 5-H-4 (wrong APIs) — independent, parallel fixes
│
5-C-2 (Unclassified dropped) — independent
│
1B-C-1 (obs windows) ──────────────→ 4-C-2 (rules inoperable)
│
1B-H-2 (orphaned keys) — independent (crash)
│
5-C-4 (no assertions) — depends on Track 3 enrichment pipeline
│
6-C-1 + 4-C-1 (capability dead) ──→ 4-C-4 (wrong abstraction)
│                              ──→ Gap A (dead branch)
│
L0 C-1 (mouseenter) ───────────────→ 2-H-8 (Hover non-functional)
│
2-C-1 + 2-C-2 (SW restart) — independent
```

**C-3 is the single highest-leverage fix** — it unblocks 5-C-1, 5-C-6, and 5-M-10 simultaneously.
**1B-C-1 is the second highest-leverage fix** — it unblocks 4-C-2 and the entire behavioral evidence pipeline.
