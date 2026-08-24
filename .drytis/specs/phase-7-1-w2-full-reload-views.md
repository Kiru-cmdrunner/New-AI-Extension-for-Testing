# Phase 7.1-W2 — Full-reload navigation lands in the view layer

- **Status:** SHIPPED (owner gate closed 2026-08-24 09:04 UTC; commit 1 src+fixtures+tests, commit 2 docs)
- **Baseline:** `9ad9359` (capability-surgical-removal, pushed)
- **Audit trail:** 7.1-W2 grounding audit @ `9ad9359` (this conversation,
  2026-08-24) — full-reload machinery traced end-to-end in source; zero code
  gaps found; missing artifact is PROOF, not code.

---

## 1. Problem statement

7.1-W1 (SHIPPED @ `db1232d`) proved that **SPA** navigation (pushState /
replaceState / popstate / hashchange, observed by `nav-inject.js` in the
MAIN world) lands in the KR view layer: `knowledgeViews` and
`knowledgeViewTransitions` rows were written on real Chrome for the first
time.

The **full-reload** half of the same story is machine-complete but
**unproven**:

| Chain link | State @ `9ad9359` |
|---|---|
| `webNavigation.onCommitted` (main frame) → `navTypeMap` → `NavigationEvidence { type:'full-reload', fromUrl: <DDC-2 real previous committed URL>, toUrl }` | code complete (service-worker.ts:1570–1588) |
| Synthetic nav event → `processObservedEvent` → discovery → **Navigation interaction** (production filter keeps it: `case 'Navigation': return true`, output-adapter.ts:84) | code complete |
| `attachSyntheticNavEvidence` attaches `applicationEvidence.navigation:[entry]` to the interaction by exact `sourceEventId` | code complete (:1590–1645) |
| Pipeline: `NavigationSignalExtractor(viewRegistry)` reads `applicationEvidence.navigation` → `ViewChangeSignal` → `StateBuilder.currentView` → `persistViews` / `persistViewTransitions` | code complete — the SAME path 7.1-W1 proved for SPA |
| `sessionNavRecords` retention → behavior model (episode-builder / causal-graph `postNavRecords`) | code complete |

**No real-Chrome run has ever exercised this path with a destination URL
that matches a `DEFAULT_VIEW_PATTERNS` entry.** The existing full-reload
fixture (`m9-form-submit-validation.html` → `m9-cart-landed.html`) lands on
`/m9-cart-landed.html`, which matches NO default pattern — honestly and by
design (it was built to validate network attribution, not views).

If the path works, 7.1 closes with **zero product code** and Phase 7's
ingestion foundation (views + transitions for both SPA AND full-reload
apps) is proven. If it does not, this spec's implementation phase surfaces
the exact broken link with a failing pin.

## 2. Second deliverable — the provenance field decision

Roadmap 7.1 line: "provenance field decision (origin: selector |
changed-element)". Grounded reality: `KnowledgeEntityRow.source`
(knowledge-types.ts:52) ALREADY EXISTS and is persisted from
`EntitySource` = `'target-derived' | 'view-derived' | 'content-observed' |
'inferred'` (state-builder.ts:203–697). There is no schema decision to
make — the roadmap wording predates the implemented enum.

**Decision (folded into this spec, closes the roadmap line):** KEEP the
shipped 4-value `EntitySource` vocabulary as the provenance field. Rationale:
it is strictly more informative than the roadmap's suggested
selector|changed-element split (which collapses target-derived and
view-derived), it is already persisted and read back by the KR browser, and
changing it would be a breaking rename of shipped semantics for zero
measured benefit. The roadmap line closes as "decision: keep shipped
enum; documented in this spec §2" — NO code change.

## 3. Scope — IN

1. Two tiny public fixtures with destination URLs that match
   `DEFAULT_VIEW_PATTERNS` entries (`/search` → `search-results`,
   `/cart` → `cart`), exercising a REAL full-page navigation via
   `form method=GET` submit (document replaced, content script destroyed,
   `onCommitted transitionType='form_submit'`).
2. One repository-layer integration pin (jsdom, in-memory repo) proving:
   full-reload `NavigationEvidence` on an interaction →
   `NavigationSignalExtractor` → view row + view-transition row.
3. One honesty pin: `/m9-cart-landed.html` (unmatched URL) produces NO view
   signal — graceful degradation is preserved, not "fixed".
4. Real-Chrome E2E pin ⑪: full-reload session on the new fixtures asserts
   `knowledgeViews` contains `search-results` AND `cart` rows sourced from
   the full-reload path, plus view-transition rows; regressions: 7.0-KR
   identity (one origin-only app row) and 7.1-W1 SPA (marker present).
5. Provenance decision documentation (§2 above).

## 4. Scope — OUT

- Any change to `DEFAULT_VIEW_PATTERNS`, `ViewRegistry`, extractors,
  persistence, or the service worker (unless the E2E surfaces a REAL gap —
  then the smallest honest fix goes through a spec amendment, not silently).
- WARN-4 (own micro-spec next), F4-L, O7, drag twin, O1, S5, 7.2+, version
  skew, dead code, legacy untracked files.
- View-pattern learning / per-app registry customization.

## 5. Test plan

| # | Type | File | Asserts |
|---|---|---|---|
| T1 | integration | `tests/understanding/nav-to-views-full-reload-7-1-w2.test.ts` | A Navigation interaction carrying `{type:'full-reload', fromUrl:…/search-form.html, toUrl:…/search?q=…}` produces a `search-results` view row AND a `search-results→` transition (first change from null) via the real extractor + StateBuilder + persistence |
| T2 | integration | same file | Second nav `…/search?q= → …/cart?ASIN=…` adds a `cart` view row and a `search-results→cart` transition |
| T3 | unit (honesty) | same file | `/m9-cart-landed.html` matches no pattern → NO view signal, NO view row; StateBuilder records nothing — graceful degradation intact |
| T4 | E2E | `.drytis/notes/evidence/phase-7-1-w2-e2e-2026-08-24/` (harness + dumps + PROVENANCE.md) | Real Chrome, real `form submit` full reload: views ⊇ {search-results, cart}, transitions ≥ 2, one origin-only app row, 7.1-W1 MAIN-world marker present in the app tab |

## 6. Acceptance criteria

- [x] **AC-1** Fixtures `public/search-form.html` and `public/cart.html`
  exist, self-contained, data-auto-id'd (`search-form-input`,
  `search-form-submit`, `cart-landed-note`), served by the static file
  server; submitting the form performs a REAL document navigation (no
  preventDefault), landing on `/cart?ASIN=…` whose URL matches the
  `cart` default pattern.
- [x] **AC-2** T1/T2 green: full-reload nav evidence on an interaction
  produces view + view-transition rows through the REAL
  NavigationSignalExtractor, ViewRegistry, StateBuilder, and
  KnowledgePersistenceService (in-memory repo) — no mocks of those four.
- [x] **AC-3** T3 green: unmatched URL → zero view signals/rows (honest
  degradation preserved).
- [x] **AC-4** Full suite green at the pre-existing baseline counts
  (272 files / 4,598 + these tests); `tsc --noEmit` exactly the 8-error
  pre-existing baseline.
- [x] **AC-5** Build + ZIP repack green; ZIP md5 recorded. **Amendment
  (2026-08-24, during implementation):** the fixtures do NOT ship inside
  the ZIP — `pack-zip.mjs` excludes root-level public HTML by design
  (test/validation pages must not enter the extension). Fixtures are
  served by the preview file server at `/public/search-form.html`,
  `/public/search-results.html`, `/public/cart.html` (verified 200 over
  the preview URL), which is what pin ⑪ loads. The extension bundle
  itself is unchanged by this milestone (zero src/ changes).
- [x] **AC-6** infra_verifier PASS (no new FAILs; existing advisory WARNs
  unchanged).
- [x] **AC-7** Real-Chrome E2E pin ⑪ PASS: full-reload session writes
  `search-results` + `cart` view rows and ≥2 transition rows via the
  full-reload path; 7.0-KR identity regression (exactly one origin-only
  app row) and 7.1-W1 marker regression both PASS.
- [x] **AC-8** Provenance decision recorded (§2) and roadmap line closed
  at closure time: "7.1 remaining: full-reload nav hardening +
  provenance field decision" → both CLOSED.
- [x] **AC-9** Zero product-code changes outside `public/` (fixtures) —
  **HELD at owner gate:** zero `src/` changes; the only non-fixture
  working-tree changes are the spec (with this amendment), the new test
  file, and repacked ZIP artifacts. OR any necessary fix documented as a
  spec amendment with its own AC and tests before commit.
- [x] **AC-10** Owner gate report delivered; no commit, no push until
  owner closes the gate.

## 7. Risks / honesty notes

- The integration pins run in jsdom — they prove the SOFTWARE chain, not
  that Chrome fires the events. Pin ⑪ exists precisely to prove the real
  chain. If pin ⑪ fails, the failure is a REAL defect surfaced by this
  milestone; fix under AC-9's amendment path, never by weakening the
  assertion.
- First view change has `fromView=null` by design (nothing before it) —
  pins must assert the transition shape honestly (null → search-results).
- `form method=GET` was chosen over POST deliberately: it exercises the
  identical full-reload commit path (transitionType `form_submit`) without
  needing a POST-capable server; the fixtures are static files.
