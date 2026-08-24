# Phase 7.1-W1 — SPA Navigation → View Layer (MAIN-world nav-inject + CustomEvent bridge)

- **Spec:** `.drytis/specs/phase-7-1-w1-spa-nav-inject.md`
- **Status:** SHIPPED @ commit 1 (owner gate 2026-08-24 ~06:55 UTC — all
  verification gates green: suite 272 files / 4,598 tests, tsc 8-baseline,
  build+ZIP md5 `66d761d2…`, reviewer PASS, infra PASS, real-Chrome E2E ⑩
  8 PASS / 0 FAIL, 7.0-KR regression 10/0, 6E-M2/M1 regression 9/0).
  Bonus finding: `no-live-horizon` gaps 1–4/session → 0 (render windows
  now owned). Two-commit closure in flight (commit 1 src+tests+asset+
  manifest, commit 2 spec+evidence+roadmap); no push until owner says so.
- **Baseline:** `bb264c8` (capability-surgical-removal; clean, 0/0 vs origin)
- **Owner approval:** 2026-08-24 — 7.1-W1 with **Option A** (MAIN-world inject +
  CustomEvent bridge, mirroring network-inject/dialog-inject twice-proven pattern)
- **Audit trail:** 7.1 grounding audit @ `bb264c8` (this conversation,
  2026-08-24) — root cause proven from source + every historical Dexie dump

---

## 1. Problem statement

The entire KR view layer has **never produced a row on a real browser**:

- `knowledgeViews = 0` and `knowledgeViewTransitions = 0` in **every** KR dump
  ever captured (7.0-KR s1/s2, phase-6e-m2, phase-6f-m2b, all sidepanel-e2e
  dumps — verified by scanning all evidence JSONs for `knowledgeView*`).
- Consequences: no view graph in the KR browser, no confirmation-view
  outcomes, no view-anchored signatures, `persistViews`/
  `persistViewTransitions` (correct, unit-tested code) writing nothing.

## 2. Root cause (grounded)

1. `src/tap/event-tap.ts:177-186` monkey-patches `history.pushState` /
   `replaceState` and listens `popstate`/`hashchange` to emit synthetic
   `navigation` ObservedEvents.
2. EventTap runs in the **ISOLATED world**: `src/manifest.json`
   `content_scripts[0]` (`recorder-entry.ts`) has no `world: MAIN` — only
   `network-inject.js` (`content_scripts[1]`) and `dialog-inject.js`
   (`content_scripts[2]`) are MAIN.
3. An isolated-world `history` object is a separate wrapper. Page-world code
   (React Router, inline scripts — e.g. our own
   `public/kr-app-identity-validation.html`) calls the **MAIN-world**
   `history.pushState`; the isolated patch can never observe it.
4. No SW fallback exists: 0 occurrences of `onHistoryStateUpdated` /
   `onReferenceFragmentUpdated` in `src/`.
5. Therefore on real pages: no nav ObservedEvent → no `Navigation`
   interaction → `applicationEvidence.navigation` always `[]` →
   `NavigationSignalExtractor` early-returns (`navigation-signals.ts:26`) →
   no view-change signals → `state-builder.ts:107` `currentView` stays
   `null` → views/viewTransitions never persist.

**Red herring documented:** the 7.0 dump's notification row
`text: 'view: search-results'` is the fixture's `#page-badge` text captured
by `NotificationSignalExtractor` — it can mask the dead view layer in
casual inspection. Not a defect; do not "fix".

**Secondary defect fixed for free:** `evidence-collector.ts:1211-1214`
admits `fromUrl` is faked from a module-level tracker. The MAIN-world
script tracks its own `lastKnownUrl` and will deliver a **real `fromUrl`**.

**Likely-coupled, re-measure only:** the 4 `unattr-ui` gaps
(`no-live-horizon`) in the 7.0 dumps — SPA render windows with no navigation
member in the episode may be owned by nobody. This spec records before/after
gap counts as an **observation**, not an AC (attribution semantics are not
touched).

## 3. Design — Option A (approved)

### 3.1 New MAIN-world asset: `public/assets/nav-inject.js`

Standalone, no imports, no extension APIs — exactly the network-inject
conventions:

- **Patches** `history.pushState` / `history.replaceState` (call-through
  originals first), **listens** `popstate` + `hashchange`.
- **Suppresses duplicates** via own `lastKnownUrl` (mirrors
  `emitSpaNavigation`'s existing dedup).
- **Dispatches** `CustomEvent('cmdrunner-nav', { detail: { navType,
  fromUrl, toUrl } })` on `window` (CustomEvents cross MAIN↔ISOLATED in the
  same renderer process — proven by `cmdrunner-net`).
- **Idempotency guard:** `window.__cmdrunnerNavPatched` (mirrors
  `__cmdrunnerNetPatched`).
- **Ready marker (D8 convention):** sets
  `<html data-cmdrunner-nav-ready="true">` + dispatches
  `cmdrunner-nav-ready` once — durable across the bridge-starts-later race.
- **No recording gate needed:** navigation events are cheap, rare, and the
  isolated-world side decides what becomes an ObservedEvent (the collector
  only runs while recording). Simpler than net-active gating; matches
  dialog-inject's always-on stamp model.
- **Restore path:** on `cmdrunner-nav-stop` CustomEvent, unpatch and delete
  the guard flag (mirrors network-inject's `stop()` restore).

### 3.2 Manifest: 4th content_scripts entry

`src/manifest.json`: `nav-inject.js` at `document_start`, `all_frames:
false` (**top frame only** — SPA routing is a top-frame concern; nested
iframes routing independently are out of scope), `world: 'MAIN'`,
`matches: <all_urls>` — same as entries 1-3.

### 3.3 Bridge + reuse of the existing synthetic-event factory

`src/tap/event-tap.ts`:

- Export a new `emitExternalNavigation(navType, fromUrl)` that reuses the
  **existing** `emitSpaNavigation` internals (same ObservedEvent shape:
  `navType`, `pageUrl`, `pageTitle`, enriched body identity — byte-identical
  shape to today's synthetic nav events).
- Add an **optional** `config.onExternalNavigation` hook OR install the
  `cmdrunner-nav` listener inside `createEventTap` itself (preferred: one
  place; tap already owns nav synthesis). On detail received →
  `emitSpaNavigation(navType, fromUrl)`.
- **Double-emission guard:** the existing `lastKnownUrl` check already
  suppresses a second emission for the same URL (both the dormant isolated
  patch and the bridge converge on one emit). Pin this with a unit test.
- Keep the isolated-world patch in place (dormant on real pages; jsdom
  unit tests keep working unchanged).

### 3.4 What does NOT change

- `evidence-collector.ts` nav handling (`handleNavigationEvent`, GAP-4
  windows) — consumes the same ObservedEvent shape.
- `NavigationSignalExtractor`, `ViewRegistry`, `state-builder`,
  `knowledge-persistence-service` — already correct, already unit-tested.
- IR generation, 6F-M1 gesture ownership, attribution horizons.
- No timing rules, no site-specific tokens.

## 4. Scope

### In scope
- `public/assets/nav-inject.js` (new, standalone MAIN-world).
- `src/manifest.json` (+1 content_scripts entry).
- `src/tap/event-tap.ts` (bridge listener + exported factory hook; no
  change to existing emit shape).
- Unit + integration tests (below).
- E2E: two-session real-Chrome run on the existing 7.0 fixture asserting
  views/viewTransitions land in Dexie and reinforce.

### Out of scope (explicit)
- Full-reload navigation → view rows (document destroyed; SW-side
  synthesis) — audit gap #3, follow-up hardening.
- Provenance field decision (selector|changed-element) — separate
  micro-spec per roadmap 7.1.
- KR backfill / migration of any kind.
- `unattr-ui` gap semantics (observe + report only).
- F4-L, WARN-4, display batch 2, version sync, dead code.

## 5. Test plan (TDD red-first)

**Unit — `tests/unit/tap/nav-inject-bridge-7-1-w1.test.ts`:**
1. MAIN-world detail `{navType:'pushState', fromUrl, toUrl}` → one
   synthetic `navigation` ObservedEvent via the tap (navType + pageUrl
   carried; pageTitle from document.title).
2. Same-URL duplicate detail → suppressed (lastKnownUrl dedup).
3. Isolated patch + bridge both firing for one URL change → exactly one
   ObservedEvent (double-emission pin).
4. `popstate` and `hashchange` details → navType mapped correctly.
5. Bridge absent (no MAIN script — plain jsdom) → existing isolated path
   unchanged (regression pin).

**Unit — nav-inject.js itself (node-side, no jsdom world trickery):**
6. Idempotency: double evaluation → single patch (guard flag).
7. Restore event → originals restored, guard cleared.

**Integration — `tests/understanding/knowledge-persistence.test.ts`
(extend, no new file needed if a pipeline-level case fits better as
`tests/integration/`):**
8. Full chain on synthetic nav events ALREADY EXISTS (state-builder →
   views/viewTransitions rows). Add one pin: a `pushState` nav event whose
   `toUrl` matches `/search?q=` yields `search-results` view row +
   `home → search-results` transition row through the REAL
   StateBuilder + KnowledgePersistenceService (repository-layer proof;
   uses fake-indexeddb as today).

**E2E — real Chrome (pin ⑩):**
- Reuse `public/kr-app-identity-validation.html` + `harness-7kr.mjs` flow
  (panel-first START — also re-proves 7.0 recovery), two sessions.
- Assert after s1: `knowledgeViews.length >= 2` (incl. `search-results`),
  `knowledgeViewTransitions.length >= 1` (`home → search-results`),
  `applications` still exactly 1 origin-only row (7.0 regression).
- Assert after s2: same app row `sessionCount === 2`; view rows NOT
  duplicated (shared, `lastSessionId` advanced); signature
  `occurrenceCount === 2` still holds.
- Record (observation, not AC): `unattr-ui` gap count before/after;
  whether `NAVIGATE` IR steps now appear.
- Honest-report rule: views=0 on the SPA fixture after the fix = run FAILS
  with dump preserved.

## 6. Verification gates (in order)

1. TDD red → green; full suite green (baseline 269 files / 4,584 + new).
2. `tsc` exactly the 8-error pre-existing baseline.
3. Build + ZIP repack + `serve/` mirror refresh + preview 200; verify
   `nav-inject.js` present in `dist/assets/` and in the ZIP.
4. Reviewer (spec-vs-code, security — MAIN-world script is injection
   surface: no innerHTML, no eval, no URL construction beyond read),
   doctrine check).
5. infra_verifier.
6. Real-Chrome E2E pin ⑩ + 7.0-KR harness regression (identity gate must
   still hold) + 6E-M2/M1 DatePicker regression (nav flush path touches
   component-runtime flush — verify no twin-click resurrection).
7. Owner gate report → two-commit closure (1: src+tests+asset+manifest,
   2: spec+evidence+roadmap). No push until owner says so.

## 7. Doctrine compliance

- No timing rules; bridge is event-driven (CustomEvent → ObservedEvent).
- No site-specific tokens — fixture is generic (`/search?q=`, `data-auto-id`).
- MAIN-world surface minimal: read-only history observation + event
  dispatch; no DOM mutation, no network.
- Honesty over fabrication: no MAIN world (enterprise policies can block
  MAIN injection) → existing isolated-only behavior, views stay absent,
  nothing invented.
- KR remains read-only for consumers.

## 8. Acceptance criteria (closure ticks)

- [x] AC-1 `public/assets/nav-inject.js` exists, standalone, idempotent,
      restore-capable (tests 6-7).
- [x] AC-2 `src/manifest.json` gains the 4th MAIN-world content_scripts
      entry (top frame, document_start).
- [x] AC-3 `cmdrunner-nav` CustomEvent → exactly one synthetic navigation
      ObservedEvent via the existing emit path (tests 1, 3).
- [x] AC-4 navType mapping for pushState/replaceState/popstate/hashchange
      (tests 1, 4).
- [x] AC-5 Real `fromUrl` delivered by MAIN world; collector consumes it
      (existing code path, no change — noted in diff review).
- [x] AC-6 Double-emission suppressed (test 3); isolated path unchanged
      when bridge absent (test 5).
- [x] AC-7 Integration: pushState nav → `search-results` view row +
      `home → search-results` transition row via real StateBuilder +
      persistence (test 8).
- [x] AC-8 Build artifacts: `nav-inject.js` in `dist/assets/` AND inside
      the packed ZIP; manifest lists it.
- [x] AC-9 E2E s1: `knowledgeViews >= 2`, `viewTransitions >= 1`, exactly
      one origin-only app row (7.0 regression).
- [x] AC-10 E2E s2: `sessionCount === 2`, view rows shared not duplicated,
      signature `occurrenceCount === 2`.
- [x] AC-11 E2E observations recorded (gap counts, IR NAVIGATE presence)
      without assertion relaxation.
- [x] AC-12 Full suite green; tsc = 8-baseline.
- [x] AC-13 Reviewer PASS (incl. MAIN-world security review).
- [x] AC-14 infra_verifier PASS.
- [x] AC-15 7.0-KR harness regression PASS; 6E-M2/M1 regression 9/0.
- [x] AC-16 No out-of-scope file diffs (asset + manifest + event-tap +
      tests only).
- [x] AC-17 Owner gate ticked; two-commit closure; no push until owner
      says so.

## 9. Risks / notes

- **MAIN-world injection blocked** (policy/managed Chrome): bridge absent →
  behavior identical to today (views absent). Honest degradation, tested by
  AC-6/test 5.
- **Navigation flush interplay:** synthetic nav events trigger
  `component-runtime` flush on navigation (existing step 1 behavior). The
  DatePicker family relies on lifecycle completion, not flush suppression —
  6E-M2/M1 regression re-run is mandatory (AC-15) because SPA pages
  previously never emitted nav events in the wild; if a real regression
  appears, STOP and report rather than loosen the pin.
- **Full-reload pages** still yield no view rows until the follow-up
  hardening (out of scope; documented in roadmap).
- **Vite copy:** `public/assets/*` is auto-copied to `dist/assets/`
  (network-inject/dialog-inject precedent) — build gate verifies (AC-8).
