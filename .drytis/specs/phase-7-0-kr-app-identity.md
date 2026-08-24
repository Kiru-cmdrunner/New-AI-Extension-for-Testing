# Phase 7.0-KR — App Identity Gate (spec)

- **Status:** SHIPPED @ commit 1 (owner gate 2026-08-24 ~04:15 UTC — all
  verification gates green: suite 269 files / 4,584 tests, tsc 8-baseline,
  build+ZIP md5 `74d31466…`, reviewer PASS, infra PASS, real-Chrome E2E ⑨
  10 PASS / 0 FAIL, 6E-M2/M1 regression 9 PASS / 0 FAIL). Two-commit closure
  in flight (commit 1 src+tests, commit 2 spec+evidence+roadmap); no push
  until owner says so.
- **Proposed baseline:** `15974fa` (capability-surgical-removal, published)
- **Date:** 2026-08-24
- **Owner gate:** pending
- **Doctype:** implementation spec (single milestone, two-commit closure)

---

## 1. Problem statement

Phase 7's headline metric — *"session 2 on the same app shows improved
recognition/derivation from KR alone"* (roadmap 7.4) — **cannot fire today**
because sessions are being written under the wrong (or fragmented) app
identity. Two committed real-Chrome Dexie dumps prove it:

| Dump | `applications[0].origin` | Reality |
|---|---|---|
| `phase-6e-m2-e2e-2026-08-23/dumps/m2-kr-dexie.json` | `chrome-extension://gndjidfncanlhlonpcabokbdhnikglpn/src/sidepanel/index.html` | recording ran on `http://127.0.0.1:<port>/m9-form-submit-validation.html` |
| `phase-6f-m2b-e2e-2026-08-23/m1-regression-dumps/m2-kr-dexie.json` | same panel URL | same class of mis-stamp |

Symptom cluster in the same dumps: `knowledgeEntities: 0`,
`knowledgeViews: 0`, `knowledgeViewTransitions: 0`, and 5 `unattr-*` gaps.
Cross-session reinforcement (archived MS-U5 proved it works **when appIds
match**) is structurally impossible while the write key is wrong: every
session with a different start-tab URL lands under a different `appId`.

## 2. Root cause (source-grounded)

1. **Stamp (write-side).** `handleStartRecording`
   (`src/background/service-worker.ts:310-316`) records
   `recordingStartUrl = tab.url` — the *active tab's full URL* at START.
   If the side panel is the active surface (exactly what every E2E harness
   does, and reproducible for users), this is the **extension panel URL**.
2. **Pass-through.** The stop path (`service-worker.ts:543`) does
   `origin = recordingStartUrl || (await getActiveTab())?.url || ''` and hands
   the **full URL string** (path included) to `runUnderstandingPipeline` as
   `origin`.
3. **Hash.** `deriveAppId(origin)` (`knowledge-persistence-service.ts:55-61`)
   hashes whatever string it receives. `deriveAppId('https://app.test/')` ≠
   `deriveAppId('https://app.test/checkout')` → **path fragmentation**
   (already flagged as audit finding #3 in
   `full-pipeline-audit-92de517-2026-08-22/AUDIT-REPORT.md`, deferred to 7.x).
4. **Read-side mirror.** The M9.12 preload
   (`service-worker.ts:353-362` → `preloadPriorKnowledge(startUrl)` →
   `understanding-pipeline.ts:238-250` → `deriveAppId(origin)`) uses the same
   dirty string. Read and write must use the **same normalized key** or
   session-2 reinforcement misses even after the write is fixed.

**What is NOT wrong:** `deriveAppId`'s hash itself, the 11-step persist flow,
`KnowledgeLoader`/`KnowledgePreloader`/`buildSeed`/`loadSeed`, the KR browser
page, and the MS-U5 reinforcement logic — all verified working in the Aug-22
audit when fed a correct appId.

## 3. Secondary finding — entity landing (roadmap 7.1's "pin ⑨")

`knowledgeEntities` is 0 in both recent dumps. Entities derive from view
changes and target-state changes (`entity-tracker.ts:1-9`;
`persistEntities` at `knowledge-persistence-service.ts:221-253` iterates
`state.entities`). The m9-form-submit fixture plausibly produces **no**
entity-bearing DOM (no `data-sku`/item-id attributes), so 0 may be honest —
but **no current-era evidence exists either way**. 7.0-KR therefore includes
a real-Chrome **entity-landing check** on an entity-bearing fixture. If
entities still land 0 on an entity-bearing page, that is a **reported
finding**, not a silently absorbed fix.

## 4. Scope

### In scope
- One new pure helper `resolveRecordingOrigin(...)` + `normalizeWebOrigin(url)`
  (extraction, not invention — no heuristic naming, no vocab).
- Service-worker wiring at exactly three sites: START stamp (:310-316 area),
  preload (:353-362), stop origin (:543).
- Fallback chain so a session that STARTS on the panel still lands under the
  recorded app: last main-frame `webNavigation.onCommitted` URL observed for
  a **recording-scope** tab (`noteRecordingScopeTab` already exists,
  `service-worker.ts:1710`).
- Honest skip: if no web origin is resolvable at stop, KR persistence is
  **skipped with a warning** (pipeline stage already isolates per-stage
  failures) — never a garbage `app-*` row.
- Real-Chrome E2E pin: two sessions, one app, reinforcement visible in Dexie.
- Entity-landing check on an entity-bearing fixture.

### Out of scope (explicit)
- **`deriveAppId` hash change or KR backfill/migration** — existing
  mis-stamped rows (panel-origin apps, path-fragment apps) stay untouched
  (read-only-KR doctrine, no destructive migration). They become inert.
- **IR path (`service-worker.ts:601`)**: `recordingContext.startUrl` and
  `harvestSessionElements` legitimately need the **full URL** — untouched.
  Only the KR key derivation changes.
- 7.2 panel surfacing, 7.3 capability derivation, 7.4 metrics collection.
- `kr-chip` panel lookup scoping (loads all apps' episodes — harmless while
  appId is correct; separate review if it ever matters).
- WARN-4 micro-spec, O7, drag twin, O1, S5, version sync, dead code,
  legacy-file housekeeping.

## 5. Design

### 5.1 Pure helper — `src/understanding/persistence/recording-origin.ts`

```
normalizeWebOrigin(url: string): string | null
  - try new URL(url)
  - return null for any non-http(s) scheme (chrome-extension:, about:, file: ok? NO — http/https only, doctrine-honest)
  - else return url.origin (port included)

resolveRecordingOrigin(input: {
  startUrl: string,            // raw recordingStartUrl
  lastCommittedWebUrl: string | null, // last onCommitted main-frame URL in a recording-scope tab
}): string | null
  1. normalizeWebOrigin(startUrl)                  — common user case: app tab active at START
  2. normalizeWebOrigin(lastCommittedWebUrl)       — panel-active START (harness + real edge case)
  3. null                                          — honest skip
```

Order matters: START-stamp wins when valid (a user who starts on app A and
navigates to B is still recording app A's session); onCommitted is a
**recovery** path only.

### 5.2 Wiring (minimal diff, 3 sites in `service-worker.ts`)

- **START**: keep `recordingStartUrl = tab.url` verbatim (IR still needs the
  full URL). Additionally derive `recordingOrigin` via the helper and keep it
  in module state next to `recordingStartUrl` (:64).
- **onCommitted** (already listening, :1112): when the commit is main-frame
  and its tab is in recording scope, store `lastCommittedWebUrl = details.url`
  (module state; cleared on session reset alongside the other session vars).
- **Preload (:353-362)**: pass `recordingOrigin` (when non-null) instead of
  `startUrl`. Null → skip preload (existing `emptySeed` path is already
  graceful).
- **Stop (:543)**: `const origin = recordingOrigin ?? ''` — empty origin
  skips Stage 5/7 persist (add an explicit guard; keep the existing
  per-stage warning so the stop flow completes for IR generation).

### 5.3 Read/write key symmetry

Both `preloadPriorKnowledge` and `KnowledgePersistenceService.persist` call
`deriveAppId(input.origin)` — with the same normalized origin both sides key
identically, so session-2 preload finds session-1's rows. No changes inside
the pipeline.

## 6. TDD plan (red → green, per phase discipline)

**Unit (new file `tests/unit/background/recording-origin-7-0.test.ts`):**
1. `normalizeWebOrigin('https://app.test/checkout?x=1')` → `'https://app.test'`
2. `normalizeWebOrigin('https://app.test:8443/x')` → `'https://app.test:8443'`
3. `normalizeWebOrigin('chrome-extension://abc/src/sidepanel/index.html')` → `null`
4. `normalizeWebOrigin('about:blank')` / `('')` / `('not a url')` → `null`
5. `resolveRecordingOrigin` precedence: valid startUrl wins over committed;
   extension startUrl falls back to committed; both invalid → null.

**Integration (extend `tests/understanding/knowledge-persistence.test.ts`):**
6. Two `persist()` calls, same normalized origin, distinct sessionIds →
   ONE application row (`sessionCount: 2`), signature `occurrenceCount: 2`,
   entity `lastSessionId` = session 2 (reinforcement at the repository layer).
7. Two `persist()` calls with path-differing full URLs that normalize to the
   same origin → still one app row (fragmentation regression pin).

**SW wiring pin (unit, mocked chrome APIs — mirrors existing background
test style):**
8. START with panel-active tab + later main-frame commit in scope + STOP →
   persist receives normalized app origin (fallback exercised).
9. No resolvable web origin → persist skipped, IR generation still runs.

## 7. Real-Chrome E2E pin (the ⑨ evidence)

New harness `harness-7kr.mjs` (modeled on the m2b harness flow, panel-first
START — which is the *mis-stamp reproducer*):
1. **Fixture:** extend an existing entity-bearing public fixture (or add one
   small page under `public/`) with `[data-auto-id][data-sku]` items + a
   counter, so `state.entities` can seed honestly.
2. **Session 1:** START (panel active → recovery path fires) → interact →
   STOP. Dexie probe: exactly one application row, `origin ===
   'http://127.0.0.1:<port>'` (origin only, no path), entities ≥ 1,
   signature occurrenceCount 1.
3. **Session 2 (same profile):** same flow again. Probe: still one app row,
   `sessionCount: 2`, signature `occurrenceCount: 2`, entity row shared
   (not duplicated) — **reinforcement proof on real Chrome**.
4. Honest-report rule: any of entities=0 / two app rows / occurrenceCount
   stays 1 → run FAILS with the dump preserved (no assertion relaxation).

## 8. Verification gates (in order)

1. TDD red → green; full suite green (baseline 267 files / 4,562 + new).
2. `tsc` exactly the 8-error pre-existing baseline.
3. Build + ZIP repack + `serve/` mirror refresh + preview 200.
4. Reviewer (spec-vs-code, security, doctrine).
5. infra_verifier (env/services/provenance).
6. Real-Chrome E2E pin (§7) + 6F-M1 DatePicker regression re-run (engine
   adjacency rule untouched, but the stop-path diff warrants the re-run).
7. Owner gate report (no commit until approved closure).

## 9. Doctrine compliance

- No timing rules introduced (fallback is event-order + scope-tab based).
- No site-specific tokens; fixtures carry generic `data-auto-id`/`data-sku`.
- KR remains read-only for consumers; only the key-derivation input changes.
- Honesty over fabrication: unresolvable origin ⇒ skip + warning, never a
  synthesized app row; entity check reports what it finds.

## 10. Acceptance criteria (closure ticks)

- [x] AC-1 `normalizeWebOrigin` returns origin-only strings for http(s),
      `null` otherwise (tests 1-4 green).
- [x] AC-2 `resolveRecordingOrigin` precedence + fallback chain (test 5).
- [x] AC-3 START keeps full `recordingStartUrl` for IR; new
      `recordingOrigin` derived and stored (diff shows both).
- [x] AC-4 onCommitted records last main-frame web URL for recording-scope
      tabs only; cleared on session reset.
- [x] AC-5 Preload uses normalized origin; invalid → no preload, no crash.
- [x] AC-6 Stop passes normalized origin; unresolvable → KR skipped with
      warning; IR generation unaffected (tests 8-9).
- [x] AC-7 Integration: two sessions same origin → one app row,
      sessionCount 2, occurrenceCount 2 (test 6).
- [x] AC-8 Path-fragmentation regression pin (test 7).
- [x] AC-9 IR path byte-untouched (`service-worker.ts:601` region).
- [x] AC-10 E2E session-1 probe: one app row, origin-only,
      entities ≥ 1.
- [x] AC-11 E2E session-2 probe: sessionCount 2, occurrenceCount 2,
      entity shared.
- [x] AC-12 Full suite green; tsc at 8-baseline.
- [x] AC-13 Build + ZIP repacked with provenance (md5 recorded).
- [x] AC-14 Reviewer PASS.
- [x] AC-15 infra_verifier PASS.
- [x] AC-16 6F-M1 regression 9/0 on the new build.
- [x] AC-17 No out-of-scope file diffs (src diff limited to
      `recording-origin.ts`, `service-worker.ts`, fixtures + tests).
- [x] AC-18 Owner gate ticked; two-commit closure (commit 1 src+tests,
      commit 2 spec+evidence+roadmap); no push until owner says so.

## 11. Risks / notes

- **Existing junk app rows** (panel-origin apps from Aug-22/23 sessions)
  remain in KR and will show in the repository browser. Inert; cleanup is a
  separate owner decision (out of scope here).
- **onCommitted ordering**: commit URL is only a *fallback* — precedence keeps
  START-stamp semantics, so no behavior change for normal user flows.
- **viewTransitions=0 / views=0** in current dumps is most likely the
  single-page fixture (no navigation); not treated as a defect by this spec.
  §7's fixture records one navigation to also sanity-check view rows land —
  recorded as an observation, not an AC.
