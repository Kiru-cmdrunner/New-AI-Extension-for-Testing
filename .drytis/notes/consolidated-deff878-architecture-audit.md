# Consolidated Architecture Audit — deff878

**Baseline:** `deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8` (2026-08-08)
**Date:** 2026-08-11
**Method:** Read-only source inspection of frozen git worktree at `/workspace/tmp/deff878-audit`
**Scope:** Layers 0–6 (Event Capture → Identity Extraction → Behavioral Observation → Component Runtime & Classification → Enrichment → Capability Inference → Generation → Persistence)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Layer-by-Layer Summary](#2-layer-by-layer-summary)
3. [Cross-Cutting Issues](#3-cross-cutting-issues)
4. [Confirmed Bugs (Non-Severity-Sorted)](#4-confirmed-bugs)
5. [Technical Debt Register — All IDs](#5-technical-debt-register)
6. [Missing Capabilities](#6-missing-capabilities)
7. [Architectural Gaps](#7-architectural-gaps)
8. [False or Uncertain Findings](#8-false-or-uncertain-findings)
9. [Test Coverage Summary](#9-test-coverage-summary)
10. [Real-Browser Validation Needs](#10-real-browser-validation-needs)
11. [Top 10 Issues Before Production-Ready](#11-top-10-issues-before-production-ready)

---

## 1. Architecture Overview

```
Content Script                      Service Worker (MV3)                    Side Panel
┌──────────────────┐               ┌─────────────────────────┐             ┌──────────────┐
│ Layer 0          │               │ Layer 2                  │             │              │
│ EventTap (12     │  ObservedEvent│ ComponentRuntime         │  broadcast  │ Interaction  │
│ event types)     │──────────────>│ 14 definitions           │────────────>│ list         │
│ IdentityExtractor│               │ EvidenceLedger           │             │ Capability   │
│ DomContext       │               │                          │             │ badges       │
│                  │               │ Layer 1 (integrated)     │             │ Semantic     │
│ Layer 1          │               │ Behavioral Observations  │             │ effects      │
│ Observation      │  ObsResult    │ (click+change only)      │             │ Behavioral   │
│ Coordinator      │<──────────────>│ Effect Interpreter       │             │ evidence     │
│ DocumentObserver │               │                          │             │              │
│                  │               │ Layer 3                  │             │ Repository   │
│ Recorder Entry   │  STOP         │ Enrichment               │             │ Browser      │
│ (buffers,        │  RECORDING    │ Component Detector        │             │ (V1 + V2)    │
│  delivery)       │<──────────────│ Meaning Resolver          │             │              │
└──────────────────┘               │                          │             └──────────────┘
                                   │ Layer 4                  │
                                   │ Capability Engine        │
                                   │ 12 rules → display-only  │
                                   │                          │
                                   │ Layer 5                  │
                                   │ IR Bridge                │
                                   │ Locator Ranking          │
                                   │ Playwright Renderers     │
                                   │                          │
                                   │ Layer 6                  │
                                   │ chrome.storage.local     │
                                   │ Repository V1 (flat JSON)│
                                   │ Repository V2 (Dexie)    │
                                   └─────────────────────────┘
```

**7 layers, 162 TS source files, 37,769 LOC. Version: 10.9.0 (manifest) / 10.4.18 (package.json — mismatch).**

---

## 2. Layer-by-Layer Summary

### Layer 0 — Event Capture & Identity Extraction

| Aspect | Status |
|--------|--------|
| Files | event-tap.ts (333), identity-extractor.ts (504), dom-context-extractor.ts (138), recorder-entry.ts (465) |
| Event types captured | 12 (click, mousedown, contextmenu, focus, blur, input, change, mouseenter, mouseleave, mousemove, keydown, scroll) |
| Event types missing | 7 categories (submit, keyup, dblclick, wheel, pointer/touch/drag) |
| Core issue | `elementId` always `''` — cascades to Layers 5+6 |
| Critical TDs | 0-C-1 (mouseenter real-Chrome), 0-C-2 (elementId), 0-C-3 (checkedBefore) |
| Tests | 49 tests / 4 files, all passing. 20 gaps. |

### Layer 1 — Behavioral Observation

| Aspect | Status |
|--------|--------|
| Files | observation-coordinator.ts (309), document-observer.ts (364), element-state-cache.ts (157), state-cache-listeners.ts (80), observation-types.ts (201) |
| Observation triggers | click + change only (3s fixed window) |
| Core issue | 7 of 14 interaction definitions get ZERO behavioral evidence |
| Critical TDs | 1B-C-1 (click+change only), 1B-C-2 (shadow DOM blind) |
| Crash vector | Orphaned `cmdrunner_obs_*` keys — 143MB/3hrs documented |
| Tests | 59 tests / 4 files, all passing. 10 gaps. |

### Layer 2 — Component Runtime & Classification

| Aspect | Status |
|--------|--------|
| Files | component-runtime.ts (683), evidence-ledger.ts (237), projection-engine.ts (218), 14 definition files (~3000 LOC), component-types.ts (485) |
| Definitions | 14 by priority (DatePicker=10 → Click=180) |
| Core issue | Active stack NOT serialized — SW restart loses all lifecycles |
| Critical TDs | 2-C-1 (active stack lost), 2-C-2 (seenEventIds halving), 2-C-3 (combobox text lost) |
| Tests | 414 tests / 21 files, all passing. 10 gaps. |

### Layer 3 — Enrichment / Meaning

| Aspect | Status |
|--------|--------|
| Files | enrich.ts (54), component-detector.ts (281), meaning-resolver.ts (186) |
| Detection | 11 framework regexes, 17 DETECTION_RULES, 68-entry ICON_SEMANTIC_NAMES |
| Core issue | Enrichment is display-only — completely disconnected from Capability Engine and Generation |
| Critical TDs | 3-C-1 (flush path skips enrichment), 3-C-2 (Unclassified never enriched), 3-C-3 (disconnected from Capability Engine) |
| Tests | 28 tests / 1 file, all passing. 13 gaps. |

### Layer 4 — Capability Inference

| Aspect | Status |
|--------|--------|
| Files | capability-engine.ts (192), capability-bridge.ts (203), evidence-extractor.ts (451), conflict-resolver.ts (138), keyword-dictionary.ts (144), 12 rule files (~1260 LOC) |
| Capability types | 13 (1:1 cardinality with interactions) |
| Rules | 12 independent rules, batch post-recording |
| Core issue | Output is display-only (side panel). Never reaches generation or persistence. |
| Critical TDs | 4-C-1 (display-only), 4-C-2 (8/12 rules evidence-starved), 4-C-3 (dead keyword signals), 4-C-4 (UI patterns not business capabilities) |
| Tests | 243 tests / 7 phase files, all passing. 10 gaps. |

### Layer 5 — Generation / IR Bridge / Playwright

| Aspect | Status |
|--------|--------|
| Files | ir-bridge.ts (432), generation-types.ts (120), locator-ranking.ts (319), action-renderer.ts (306), locator-renderer.ts (263), assertion-renderer.ts (397), test-function-renderer.ts (301), page-object-renderer.ts (~400), project-generator.ts (301) |
| Generation paths | Two parallel (active: ir-bridge.ts; inactive: generator.ts) |
| Core issue | Or-1 merge drops ALL consecutive clicks (elementId `''` = always merge) |
| Critical TDs | 5-C-1 through 5-C-6 |
| Tests | 308 tests / 10 files, all passing. 12 gaps. |

### Layer 6 — Persistence / Repository / Session Storage

| Aspect | Status |
|--------|--------|
| Files | dexie-database.ts (139), 11 Dexie repos (~900 LOC), 3 service files (~868 LOC), storage-service.ts (319), repository-service.ts (375) |
| Storage tiers | 3 (chrome.storage.local, Repository V1 flat JSON, Repository V2 Dexie/IndexedDB) |
| Core issue | V1 ↔ V2 disconnected; persistSession receives capability:null |
| Critical TDs | 6-C-1 through 6-C-6 |
| Tests | 220 tests / 14 files, all passing. 12 gaps. |

---

## 3. Cross-Cutting Issues

### 3.1 The elementId Cascade

`elementId` is hardcoded to `''` in identity-extractor.ts:365. No code ever assigns it. This single defect cascades through:

- **Layer 5 (5-C-1):** Or-1 merge rule merges ALL consecutive CLICKs (`'' === ''`)
- **Layer 5 (5-C-6):** IR target identity unreliable
- **Layer 5 (5-M-10):** POM mode element dedup collision
- **Layer 6 (6-C-1 indirect):** capability-matching-service receives elementId `''` for entryElement comparison (35% weight)
- **Layer 4:** Evidence extractor physical evidence tag works, but any downstream element-identity feature fails

**This is the single highest-leverage fix.**

### 3.2 The Dead Understanding Layer

The UnderstandingResult (fragment + capability) is the designed boundary between understanding and generation. In production:
- `fragment: null` — ApplicationKnowledgeFragment never produced
- `capability: null` — CapabilityCandidate never produced

This kills:
- Layer 6: Capability matching/creation/enrichment (418 LOC + 434 LOC entity)
- Layer 5: Enrichment input to generation (5-C-5)
- Layer 5: Assertion derivation (5-C-4 — always `[]`)
- Layer 4: Capability engine output is display-only (4-C-1)
- Layer 3: Enrichment disconnected from everything downstream (3-C-3)

### 3.3 The Behavioral Evidence Starvation

Observation windows open ONLY for click + change events (1B-C-1). This means:
- Layer 1: 7/14 definitions get ZERO behavioral evidence
- Layer 2: Hover entirely non-functional without mouseenter evidence (2-H-8)
- Layer 4: 4/12 capability rules inoperable (4-C-2)
- Layer 4: Checkbox/accordion/filter/sort detection degraded to Unclassified

### 3.4 The Unclassified Drop

Unclassified interactions (real user actions that no definition recognized) are in `NOISE_TYPES` (5-C-2). They are:
- Dropped from generated tests entirely
- Never enriched (3-C-2)
- Silently lost — no warning, no user notification

This is the most impactful correctness bug after elementId: legitimate user actions disappear from generated tests.

### 3.5 SW Restart Fragility (MV3)

The MV3 service worker can restart every ~30 seconds. Three separate recovery gaps:
- Layer 2 (2-C-1): Active stack NOT restored — in-progress lifecycles vanish
- Layer 6 (6-C-3): recordingStartUrl/Title NOT restored — wrong baseUrl in generated tests
- Layer 2 (2-C-2): seenEventIds halving creates dedup blind spots

---

## 4. Confirmed Bugs

These are not design limitations or missing features — these are code that is definitively wrong:

| # | Bug | Layer | ID | Impact |
|---|-----|-------|-----|--------|
| 1 | Or-1 merges ALL consecutive clicks (elementId always `''`) | 5 | 5-C-1 | Clicks on different buttons silently dropped |
| 2 | FileUpload generates `.fill()` not `.setInputFiles()` | 5 | 5-C-3 | Invalid Playwright code, throws at runtime |
| 3 | RadioButton generates `.selectOption()` not `.check()` | 5 | 5-H-5 | Invalid Playwright code |
| 4 | Dropdown `.selectOption()` only works for native `<select>` | 5 | 5-H-4 | Invalid code for custom dropdowns |
| 5 | deriveAssertions() always returns `[]` | 5 | 5-C-4 | Zero assertions ever generated |
| 6 | resolveTarget() called twice per event | 0 | 0-H-1 | Doubles DOM traversal cost |
| 7 | getByCapabilityId() ignores its parameter | 6 | 6-C-5 | Returns wrong results |
| 8 | SessionStorage buffer O(n²) per session | 0 | 0-H-2 | Performance degradation |
| 9 | Evidence Ledger persisted on every single event | 6 | 6-M-1 | I/O amplification |
| 10 | persistSession receives events:[] | 6 | 6-C-2 | Archival tier permanently empty |

---

## 5. Technical Debt Register

### Critical (40 items)

| Layer | IDs | Count |
|-------|-----|-------|
| 0 | 0-C-1, 0-C-2, 0-C-3 | 3 |
| 1 | 1B-C-1, 1B-C-2 | 2* |
| 2 | 2-C-1, 2-C-2, 2-C-3 | 3 |
| 3 | 3-C-1, 3-C-2, 3-C-3 | 3 |
| 4 | 4-C-1, 4-C-2, 4-C-3, 4-C-4 | 4 |
| 5 | 5-C-1, 5-C-2, 5-C-3, 5-C-4, 5-C-5, 5-C-6 | 6 |
| 6 | 6-C-1, 6-C-2, 6-C-3, 6-C-4, 6-C-5, 6-C-6 | 6 |

*(Layer 1 1B-C-3 demoted to HIGH per closer analysis — beforeSnapshot timing is fragile but not confirmed broken)*

### High (37 items)

| Layer | IDs | Count |
|-------|-----|-------|
| 0 | 0-H-1 through 0-H-5 | 5 |
| 1 | 1B-H-1 through 1B-H-4 | 4 |
| 2 | 2-H-1 through 2-H-8 | 8 |
| 3 | 3-H-1 through 3-H-7 | 7 |
| 4 | 4-H-1 through 4-H-8 | 8 |
| 5 | 5-H-1 through 5-H-8 | 8 |
| 6 | 6-H-1 through 6-H-8 | 8 |

*(Some counts include items renumbered from initial analysis)*

### Medium (52 items)

Distributed across all layers. Key patterns: unbounded buffers, O(n) scans, substring false positives, hardcoded values, missing event/component coverage.

### Low (30 items)

Code quality, minor performance, documentation, redundant logic.

---

## 6. Missing Capabilities

### Capture Layer
1. No submit event capture (programmatic form.submit())
2. No keyup event (key release timing lost)
3. No pointer/touch/drag events (7 categories)
4. No dblclick event

### Observation Layer
5. No observation windows for non-click/non-change triggers
6. No Shadow DOM mutation observation
7. No keyboard-triggered observation

### Classification Layer
8. No Autocomplete/Combobox definition
9. No Shadow DOM path computation

### Enrichment Layer
10. No component detection for 8 common types (CommandPalette, SearchInput, MultiSelect, FileDropZone, VirtualList, ModalWizard, Toast, Pagination)

### Capability Layer
11. No capability types for common e-commerce actions (Add to Cart, Checkout, Wishlist, Review)
12. No Hover/Tab/DatePicker/ColorInput capability rules
13. No multi-step or composed capability model

### Generation Layer
14. No DragDrop IR action
15. No scroll-related test steps
16. No assertion generation
17. No capability-informed test naming
18. No iframe/shadow DOM handling in locators

### Persistence Layer
19. No data export/import
20. No session deletion
21. No project cascade delete
22. No storage quota monitoring
23. No entity schema migration
24. No Repository V2 → V1 sync
25. No test case creation from recording sessions
26. No IR regeneration from stored sessions

---

## 7. Architectural Gaps

### Gap A: Capability Pipeline Dead Branch
```
Capability Engine → capability_records (chrome.storage.local) → Side Panel Display
                    (DEAD END — never reaches Generation or Persistence)
```

### Gap B: Enrichment Disconnected
```
Enrichment → interaction.componentType / componentFramework / businessMeaning
             (DISPLAY ONLY — no downstream consumer reads these fields)
```

### Gap C: Two Parallel Repositories
```
Repository V1 (chrome.storage.local flat JSON) ←→ Side Panel (user-facing)
Repository V2 (Dexie/IndexedDB structured)     ←→ Session Persistence (shadow)
(NO BRIDGE BETWEEN THEM)
```

### Gap D: elementId Breaks Generation
```
identity-extractor.ts elementId='' → IR Bridge merge → POM dedup → staleness detection
(ALL BROKEN — cascading from single missing assignment)
```

### Gap E: Behavioral Evidence Starvation
```
Observation Windows (click+change only) → Effect Interpreter → Capability Rules
70%+ of interactions → ZERO behavioral evidence → 4/12 rules inoperable
```

### Gap F: Unclassified Silent Drop
```
Projection Engine → Unclassified interactions → NOISE_TYPES filter → DROPPED
(Real user actions silently removed from generated tests)
```

### Gap G: Dead Understanding Layer
```
UnderstandingResult { fragment: null, capability: null }
(ApplicationKnowledgeFragment never produced)
(CapabilityCandidate never produced)
(Entire 3-tier data lifecycle has Tier 1 permanently null)
```

---

## 8. False or Uncertain Findings

| Finding | Layer | Status | Note |
|---------|-------|--------|------|
| mouseenter/mouseleave may not fire at child level | 0 | **UNCERTAIN** | Requires real Chrome validation. jsdom tests pass. If confirmed, Hover definition (Layer 2) is non-functional. |
| checkedBefore timing unreliable | 0 | **UNCERTAIN** | DOM spec says click fires during target phase; activation behavior after. Some browsers may update .checked before handler. Needs real Chrome validation. |
| Orphaned obs keys crash at 143MB/3hrs | 1 | **CONFIRMED** | Documented in prior crash reports. Fully active at deff878. |
| performance.now() vs event.timeStamp ordering | 0 | **UNCERTAIN** | Navigation uses performance.now(), events use timeStamp. Spec has changed across Chrome versions. |
| Hover confidence model threshold ≥50 | 2 | **CONFIRMED working in jsdom** | But depends on mouseenter/mouseleave firing (see above). |
| SortButton CSS regex false positives | 3 | **LOW RISK** | `\bsort\b` with word boundary — doesn't match 'resort'. 'sort-filter' would match. |
| MutationObserver misses shadow DOM | 1 | **CONFIRMED** | `subtree:true` does not cross shadow boundaries. Web Components invisible. |

---

## 9. Test Coverage Summary

| Layer | Test Files | Test Count | LOC | All Passing | Key Gap |
|-------|-----------|------------|-----|-------------|---------|
| 0 | 4 | 49 | ~1,400 | ✅ | No shadow DOM, SPA nav, resolveTarget strategies |
| 1 | 4 | 59 | ~2,000 | ✅ | No crash-scenario tests |
| 2 | 21 | 414 | ~8,500 | ✅ | No SW restart recovery tests |
| 3 | 1 | 28 | 490 | ✅ | 14 of 15 interaction types untested for meaning |
| 4 | 7+2 | 243+89 | ~7,500 | ✅ | No behavioral-evidence-missing scenarios |
| 5 | 10 | 308 | ~5,300 | ✅ | No test for Or-1 with empty elementId |
| 6 | 14 | 220 | ~4,500 | ✅ | No production-path persistSession test |
| **Total** | **63** | **~1,420** | **~30,000** | **✅** | **All tests pass but no integration/E2E test** |

**Critical observation:** 2,578 tests across 114 files all pass at deff878. But no single test exercises the full production path from recording → classification → generation → persistence with real (non-synthetic) data. The tests verify components in isolation; the integration points are where the critical bugs live.

---

## 10. Real-Browser Validation Needs

| Priority | Item | Layers Affected |
|----------|------|-----------------|
| 1 | mouseenter/mouseleave firing at child elements via document-level capture | 0, 2 |
| 2 | checkedBefore timing for native checkbox on click event | 0, 2 |
| 3 | MV3 SW restart recovery completeness | 2, 6 |
| 4 | chrome.storage.local write performance under rapid events | 0, 1, 6 |
| 5 | MutationObserver shadow DOM behavior | 1 |
| 6 | IndexedDB quota behavior with unlimitedStorage | 6 |
| 7 | Dexie transaction behavior during SW termination | 6 |
| 8 | performance.now() vs event.timeStamp ordering | 0 |

---

## 11. Top 10 Issues Before Production-Ready

Ranked by: user impact × fix leverage × blocking severity.

| Rank | ID | Issue | Fix Leverage |
|------|-----|-------|--------------|
| **#1** | 5-C-1 | Or-1 merge drops ALL consecutive clicks on different elements | Fix elementId (0-C-2) → merge works correctly. **Single highest-leverage fix.** |
| **#2** | 5-C-3, 5-H-5, 5-H-4 | Wrong Playwright APIs: FileUpload `.fill()`, RadioButton `.selectOption()`, Dropdown `.selectOption()` on non-`<select>` | Three separate fix points in ir-bridge + action-renderer |
| **#3** | 5-C-2 | Unclassified interactions dropped from generated tests | Remove Unclassified from NOISE_TYPES or add minimum viable IR action |
| **#4** | 0-C-2 | elementId always `''` | Assign stable elementId in identity-extractor or at classification time |
| **#5** | 1B-C-1 | Observation windows click+change only — 70%+ starved | Open windows for all discrete events, not just click+change |
| **#6** | 1B-H-2 | Orphaned obs keys crash (143MB/3hrs) | Guarantee cleanup in stopRecording; add periodic sweep |
| **#7** | 5-C-4 | Zero assertions ever generated | Wire enrichment or derive basic assertions from interaction metadata |
| **#8** | 4-C-1 + 6-C-1 | Capability pipeline disconnected from generation and persistence | Pass capability to buildIRPlan and persistSession |
| **#9** | 0-C-1 | mouseenter/mouseleave real-Chrome validation | Validate; if broken, switch to mouseover/mouseout |
| **#10** | 2-C-1 + 6-C-3 | SW restart loses active stack + recordingStartUrl/Title | Serialize active stack; persist start URL/Title |

---

## Appendix: Source Files by Layer

### Layer 0 (1,440 LOC source)
`src/tap/event-tap.ts`, `src/tap/identity-extractor.ts`, `src/definitions/dom-context-extractor.ts`, `src/recorder/phase5/recorder-entry.ts`

### Layer 1 (1,111 LOC source)
`src/tap/observation-coordinator.ts`, `src/tap/document-observer.ts`, `src/tap/element-state-cache.ts`, `src/tap/state-cache-listeners.ts`, `src/shared/observation-types.ts`

### Layer 2 (~5,000 LOC source)
`src/runtime/component-runtime.ts`, `src/runtime/evidence-ledger.ts`, `src/presentation/projection-engine.ts`, `src/shared/component-types.ts`, `src/definitions/*.ts` (14 files)

### Layer 3 (521 LOC source)
`src/enrichment/enrich.ts`, `src/enrichment/component-detector.ts`, `src/enrichment/meaning-resolver.ts`

### Layer 4 (~2,400 LOC source)
`src/capabilities/capability-engine.ts`, `src/capabilities/capability-bridge.ts`, `src/capabilities/evidence-extractor.ts`, `src/capabilities/conflict-resolver.ts`, `src/capabilities/keyword-dictionary.ts`, `src/capabilities/rules/*.ts` (12 files)

### Layer 5 (~3,400 LOC source)
`src/generation/ir-bridge.ts`, `src/generation/generation-types.ts`, `src/generation/locator-ranking.ts`, `src/generation/adapters/playwright/*.ts` (6 files), `src/presentation/output-adapter.ts`, `src/presentation/workflow-normalizer.ts`

### Layer 6 (~4,200 LOC source)
`src/repository/v2/dexie/*.ts` (11 files), `src/repository/v2/interfaces/*.ts`, `src/repository/services/*.ts` (4 files), `src/storage/storage-service.ts`, `src/repository/repository-service.ts`, `src/domain/entities/*.ts` (6 files)

### Cross-Layer Integration
`src/background/service-worker.ts` (911 LOC), `src/runtime/sw-integration.ts` (514 LOC)
