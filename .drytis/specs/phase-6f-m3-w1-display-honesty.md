# 6F-M3 Wave 1 — panel display honesty pass (O13, O2, O12, O14)

**Status:** SHIPPED — owner gate 01:33 UTC 2026-08-24; two-commit closure
(commit 1 src+tests, commit 2 spec+evidence+roadmap), unpushed. All ACs
green; suite 267 files / 4,562 tests; tsc 8-baseline; real-Chrome E2E
11 PASS / 0 FAIL (runs 1–9 logged; two genuine E2E findings folded back
into the implementation — see Errata); M1 regression 9/0; reviewer PASS
(WARNs closed); infra_verifier PASS.
**Proposed baseline:** `1c054bb` (branch `capability-surgical-removal`; 2
commits ahead of origin, unpushed — publish state deliberately unchanged).
**Owner instruction (2026-08-24 00:11 UTC):** "Write the 6F-M3 Wave 1 spec
for O13, O2, O12, and O14 only. Keep it evidence-grounded and stop for my
approval before any code changes. Keep WARN-4 as a separate micro-spec and
leave O7, drag twin, O1, and S5 deferred. No engine/IR changes and no push."
**Scope guarantee:** ALL changes live in `src/sidepanel/` (+ `src/enrichment/`
URL-formatting helper import only if shared by two render sites). Zero
engine, IR, capture, attribution, or storage-schema changes. Zero env keys,
services, proxies, deps. Classification/semantic decisions are NOT in scope.

---

## §0 Evidence base (what grounds each item — no speculative fixes)

- **O13** — user batch 2026-08-23-0700 `image_4d5513e2`: stopped view showing
  `⏳ Collecting behavioral evidence…` placeholders LIVE on int-40 and int-52
  after STOP. The int-53/54 RCA ("placeholder is transient; stop sequence
  writes LIVE_INTERACTIONS 3×") explains screenshots BETWEEN writes, but the
  0700 batch shows placeholders persisting — some interactions honestly never
  receive behavioral evidence and keep the misleading "Collecting…" label
  forever. Display dishonesty: "Collecting…" promises arrival that will not
  happen after stop.
- **O2** — committed dump `phase-6e-m2-e2e-2026-08-23/dumps/m2-storage.json`:
  5 domChange rows across 7 cards, exactly 1 no-op row (attr-only, old==new
  on every delta, no child nodes, no characterData). 0 identical cross-card
  re-drain pairs in the same dump. The known cumulative re-drain noise
  (RC5/INV-C1) is ~absent in current DatePicker-heavy flows; S5 stays
  deferred (accepted trade-off, quantified ≈0 today). What remains is purely
  rows that materialized nothing.
- **O12** — RC7 (rca-adanione-custom-controls-2026-08-20.md): recovered
  windows with **no owner** keep null identity. The identity half for
  owner-resolved recovery CLOSED in 6F-M2b (`2bff6ed`); what remains is the
  no-owner case rendering "Unknown element" with no explanation of WHY.
- **O14** — meaning-resolver `Navigation` case (meaning-resolver.ts:187-194)
  already prefers `pageTitle` (quote-safe). The URL-named cards are the
  empty-title fallback: the nav event snapshots the title at `onCommitted`
  (service-worker.ts:1158-1161, 1216-1217) when it is frequently still empty,
  and the card label then shows the FULL raw URL (query strings, tracking
  params, tokens) — noisy and occasionally privacy-leaking in screenshots.
  No title re-read/timing fix (doctrine: no timing rules).

---

## §1 O13 — stopped-view placeholder honesty

### Problem
`attachEvidenceDisplay` (src/sidepanel/interaction-renderer.ts:408-433)
appends `renderEvidencePlaceholder()` ("⏳ Collecting behavioral evidence…",
evidence-renderer.ts:1058-1062) whenever `interaction.behavioralEvidence` is
null — in the LIVE view AND the stopped view alike. After STOP, "Collecting…"
is a lie for any card whose evidence never arrives: the recording is over,
nothing more will be collected.

### Fix (display-only, renderer)
`attachEvidenceDisplay` gains an optional `view: 'live' | 'stopped'` (default
`'live'` — current behavior preserved everywhere not opted in):
- **live view:** unchanged — "⏳ Collecting behavioral evidence…".
- **stopped view:** null evidence renders an honest terminal note:
  `No behavioral evidence captured for this interaction` (muted styling
  class `evidence-placeholder evidence-placeholder--final`, style only if a
  matching rule is absent; no layout change).
- No suppression of the card itself (P10/MS-U1 philosophy: show-and-mark,
  never hide). No storage writes. No change to which interactions render.

### Consumers (complete set — verified by read)
- `renderInteractions` (interaction-renderer.ts:442-477) — the only caller of
  `attachEvidenceDisplay`; it receives the interaction list. Render path
  currently cannot see the view; we thread `view` through
  `renderProductionInteractions(container, interactions, options)` →
  `renderInteractions` → `attachEvidenceDisplay`. `RenderOptions` gains
  optional `view?: 'live' | 'stopped'` (default `'live'`).
- Call sites that must pass `view: 'stopped'` (grep-verified complete):
  - sidepanel.ts:501 `showDetectedInteractions` (stopped view render)
  - sidepanel.ts:1466 `init()` Stopped branch is via
    `showDetectedInteractions` (same function) — covered.
  - sidepanel.ts:1254 and :1314 storage-listener re-renders in stopped view.
  - sidepanel.ts:1234/1466 live timeline renders stay `'live'` (default).
  - `refreshInteractionCards` → `showDetectedInteractions` — covered.
- MS-U1 `showHidden` path: `renderInteractions` is called with all
  interactions in the stopped view — same threading applies.

### AC-O13
- [x] AC1: In the stopped view, a card with null `behavioralEvidence` renders
  the terminal text `No behavioral evidence captured for this interaction`,
  never `Collecting behavioral evidence`.
- [x] AC2: In the live view, the placeholder text remains exactly
  `⏳ Collecting behavioral evidence…` (no regression).
- [x] AC3: Default `RenderOptions` (no `view`) is byte-identical behavior to
  pre-change live rendering (back-compat pin for any external callers/tests).
- [x] AC4: Unit pin — stopped view + null evidence + `showHidden:true` still
  renders the card (show-and-mark, no hiding) with the terminal note.
- [x] AC5: No new storage writes; no changes outside `src/sidepanel/`.

### Tests (unit, renderer-level — jsdom)
`tests/unit/sidepanel/o13-stopped-placeholder-6f-m3.test.ts`:
1. stopped view + null evidence → terminal text present, "Collecting" absent.
2. live view + null evidence → "Collecting…" present (pin AC2).
3. default options → "Collecting…" (pin AC3).
4. stopped + showHidden + null evidence → card + terminal note + suppressed
   chip co-exist (pin AC4).
5. stopped view + evidence present → evidence renders (no placeholder at all).

---

## §2 O2 — no-op DOM-change row suppression

### Problem
`renderDomChanges` (src/sidepanel/evidence-renderer.ts:336-417) renders every
`DomChangeSummary` row delivered on the evidence object. Rows where nothing
materialized — attribute-only with every `old == new`, zero added/removed
nodes, no characterData delta — display as e.g. `attributes · <div> · class:
"x" → "x"`, pure noise (1 of 5 rows in the committed 6E-M2 dump).

### Fix (display-only, renderer)
- New pure helper `isNoOpDomChange(change: DomChangeSummary): boolean` in
  evidence-renderer.ts (exported for unit tests):
  true iff —
  - `addedNodesCount === 0 && removedNodesCount === 0`, AND
  - `characterDataDelta` is null/absent, AND
  - every changed attribute has a delta with `old === new` (missing delta ⇒
    NOT no-op — unknown counts as information, honesty over fabrication).
- `renderDomChanges` filters no-op rows BEFORE the `MAX_DOM_CHANGES_DISPLAY`
  slice (so suppression never eats into the display budget).
- Header count stays the RAW `changes.length` (honesty: the panel reports
  what was observed; the rows shown are the material ones). A suppressed
  count is appended to the header only when >0:
  `DOM Changes (3 · 1 no-op hidden)`.
- Rows are NOT deleted from the evidence object (drill-down/raw data
  untouched; only the summary rows are filtered for display).
- Overflow ("… N more") and `domChangeOverflow` semantics unchanged.

**Errata (review, 2026-08-24):** (a) the "… N more" indicator now counts
MATERIAL rows (post-filter), not raw — self-consistent with "suppressed rows
never consume slots" and byte-identical when zero no-ops exist; the external
`domChangeOverflow` ("N more dropped") count is untouched. (b) The §1
consumer list mislabeled sidepanel.ts:1254/:1314 as stopped re-renders; they
are recording-view renders, and the stopped path is fully covered by the
single `showDetectedInteractions` edit (all stopped re-renders route through
it). (c) AC1 O14 gained pin AC1b (meaning-resolver fallback site with a
query-bearing URL) closing the review coverage gap.

**Errata (E2E runs 4–5, 2026-08-24):** (d) O14's title-first branch had a
REAL leak the spec's empty-title framing missed: Chrome synthesizes the tab
title from the URL for untitled pages (`chrome.tabs.get` at onCommitted
returns the full query URL — or its scheme-stripped form — as pageTitle),
so the quoted "title" rendered the raw query URL. Fixed by
`isUrlDerivedTitle(title, url)` (exact + scheme-stripped match, exported
from quote-safe.ts): URL-derived pseudo-titles fall back to the display
form; genuine titles keep title-first rendering (D10 pins green). Pins:
AC4b (both pseudo-title forms, both label sites). (e) E2E assertion scope:
the card's evidence section legitimately shows truncated raw URLs
(navigation rows); only the card LABEL line is asserted display-form, and
the IR/Playwright section is asserted to KEEP the full raw URL (AC6
verified live, M4-O14b).### AC-O2
- [x] AC1: A row with attrs-only, all old==new, 0 nodes, no characterData is
  not rendered; header shows `· 1 no-op hidden`.
- [x] AC2: A row with a real delta (old ≠ new, or any node/text delta, or a
  changed attribute with missing delta) IS rendered (no over-filtering).
- [x] AC3: Material rows render before the cap; suppressed rows never consume
  display slots (pin with 8 material + 3 no-op rows vs MAX_DOM_CHANGES_DISPLAY).
- [x] AC4: Zero no-op rows → header text identical to pre-change (pin).
- [x] AC5: `isNoOpDomChange` exported and pinned for: attrs old==new (true);
  attrs old≠new (false); nodes>0 (false); characterData present (false);
  attrs present but delta missing (false).
- [x] AC6: No changes outside `src/sidepanel/evidence-renderer.ts` (+tests).

### Tests
`tests/unit/sidepanel/o2-noop-dom-rows-6f-m3.test.ts`: the five helper-truth
pins (AC5) + the four render pins (AC1-4) against `renderDomChanges` output
DOM (import the renderer, feed synthetic DomChangeSummary objects; assert on
`.evidence-row` counts and header text).

---

## §3 O12 — no-owner recovered-evidence label

### Problem
Sw-recovered evidence with NO resolved owner renders "Unknown element"
(identity null — correct, honest) and a plain `Window: Xms ·
sw-recovered-form-submit` meta line. The user cannot tell whether "Unknown
element" means (a) capture loss expected on this recovery path, or (b) a bug
in identity extraction. For no-owner recovered windows it is (a) by design
(RC7: by-constraint artifact), and the panel should say so.

### Fix (display-only, renderer)
In `renderEvidence` (src/sidepanel/evidence-renderer.ts:923+), where the
`page-reload-synthetic` special notice is rendered today (~:956): add the
same one-line treatment for `endReason === 'sw-recovered-form-submit'` when
`evidence.targetEvidence?.identity == null`:
`↻ Evidence recovered after page unload — target identity not captured
(no owner resolved)`.
Styling reuses the existing `evidence-synthetic-notice` class — no new CSS.
When identity IS present (6F-M2b seeded path), NO notice renders (the seed
already tells the truth; a notice there would be redundant noise).

### AC-O12
- [x] AC1: endReason `sw-recovered-form-submit` + null identity → notice text
  rendered exactly once, containing "recovered after page unload".
- [x] AC2: endReason `sw-recovered-form-submit` + seeded identity → NO notice
  (pin against the 6F-M2b happy path).
- [x] AC3: `page-reload-synthetic` notice unchanged (existing pin must still
  pass unmodified).
- [x] AC4: No engine change; no change to `synthesizeMinimalEvidence` or the
  ledger (6F-M2b territory stays closed).

### Tests
`tests/unit/sidepanel/o12-recovered-noowner-label-6f-m3.test.ts` (extends the
existing 6F-M2b consumer-pin file pattern): three pins above + a fourth
asserting the notice does not render for `evidence-timeout` endReason.

---

## §4 O14 — navigation URL truncation (display)

### Problem
When `pageTitle` is empty at commit time, the Navigation label renders the
full raw URL (interaction-renderer.ts:160-170 fallback AND
meaning-resolver.ts:187-194 fallback): query strings, tracking params, and
occasionally tokens land in card labels and screenshots.

### Fix (display-only, formatting)
- New pure helper `displayUrl(raw: string, maxLen = 60): string` in
  `src/enrichment/quote-safe.ts` (already the shared label-hygiene module,
  already imported by both files): try/catch `new URL(raw)` →
  `${origin}${pathname}` (search/hash dropped; decode not attempted);
  on parse failure fall back to the raw string. Truncate to `maxLen` with an
  ellipsis `…` at a character boundary. Always returns a string.
- `meaning-resolver.ts` Navigation fallback: `Navigate to
  ${displayUrl(url)}`.
- `interaction-renderer.ts` fallbackActionDescription Navigation case:
  `Navigate to ${displayUrl(url)}`.
- IR / output-adapter / KR paths untouched (they consume `metadata.pageUrl`
  verbatim — full URL remains the machine record; this is panel display
  only). Navigation title-first priority unchanged.

### AC-O14
- [x] AC1: URL with query+hash, no title → label shows origin+path only
  (query/hash absent) in BOTH the meaning-resolver fallback and the renderer
  fallback.
- [x] AC2: Long pathname → truncated at 60 chars with `…`.
- [x] AC3: Non-URL / unparseable string → rendered unchanged (honesty; no
  throw, no swallow).
- [x] AC4: Title present → title-first rendering unchanged (existing D10 pin
  unmodified).
- [x] AC5: `displayUrl` exported and pinned: query dropped; hash dropped;
  path+origin preserved; >60 char path truncated; empty string → empty
  string; no scheme → unchanged raw.
- [x] AC6: IR plan steps / output adapter / KR ingestion unchanged (pin:
  toIRAction output for a Navigation interaction contains the full raw
  pageUrl, not the display form).

### Tests
- `tests/unit/enrichment/display-url-6f-m3.test.ts` — helper truth table (AC5).
- Navigation label pins appended to
  `tests/unit/sidepanel/o14-nav-url-display-6f-m3.test.ts` — AC1-4 via
  fallbackActionDescription + meaning-resolver outputs; AC6 via toIRAction
  assertion on `metadata.pageUrl`.

---

## §5 Non-goals (explicit, owner-directed)

- **WARN-4** (active-lifecycle click cannot supersede gesture records) —
  separate micro-spec, engine change, NOT in Wave 1.
- **O7 duplicate surfaces** — parked-no-repro (0 alert-surface entries across
  M1/M1-regression/6E-M2 dumps; per-element WeakSet dedup already ships).
- **Cross-target drag twin** — owner decision pending (accept-honest vs
  naming hint); no code.
- **O1 naming vocab** — standing process, ships with future evidence batches.
- **S5 boundary-limited re-drain** — stays deferred (accepted trade-off;
  ≈0 occurrences in the committed 6E-M2 dump).
- No engine/IR/attribution/ledger/storage changes; no title re-read timing
  fix for O14; no suppression of cards or evidence rows beyond the specified
  no-op row filter.

## §6 Doctrine compliance

- Honesty over fabrication: every fix REPLACES a misleading label with a
  truthful one, or hides a row that materialized nothing while reporting the
  hidden count. No data is invented; raw evidence objects are untouched.
- No timing rules: O14 explicitly does NOT re-read titles; O13 keys on view
  state (stopped vs live), never on elapsed time.
- Display-only: `src/sidepanel/*` (+ one pure helper in
  `src/enrichment/quote-safe.ts`). Projection, IR, KR, capture untouched.
- Evidence-gated: each item cites its grounding (batch 0700 image, committed
  6E-M2 dump counts, RC7 note, meaning-resolver source lines).

## §7 Verification plan (after owner approval)

1. **TDD:** write the four unit test files first (red), then implement, then
   green. Suite must stay 4,523+green with zero regressions.
2. **tsc:** exactly the 8-error pre-existing baseline.
3. **Build + ZIP:** vite build; pack ZIP; verify tokens (terminal-note
   string, no-op header string, recovered-notice string, displayUrl) in
   dist; serve/ re-mirror + restart bg service 3591.
4. **Reviewer** (full path — user-visible renderer change): spec-vs-code,
   AC sweep, security.
5. **infra_verifier** (full path).
6. **Real-Chrome E2E** (house CDP pattern): record a session on the local
   AdaniOne fixture that produces (a) a no-evidence card in stopped view
   (b) domChanges with a no-op row (c) a navigation with empty title; assert
   the three new display behaviors in the live panel; regression-run the M1
   DatePicker harness (9/0 expected unchanged).
7. **Owner gate** → two-commit closure (commit 1 src+tests, commit 2
   spec+evidence+roadmap) on approval. No push until owner says so.

## §8 Acceptance roll-up (owner gate checklist)

- [x] All four O13/O2/O12/O14 AC groups green (AC counts: O13=5, O2=6,
      O12=4, O14=6 → 21 ACs).
- [x] Full suite green (262+ files, 4,523+ tests); tsc 8-baseline.
- [x] Build OK; ZIP fresh with all four display tokens; preview serving
      current.
- [x] Reviewer PASS; infra_verifier PASS; E2E PASS with M1 regression 9/0.
- [x] Scope audit: zero diffs outside `src/sidepanel/`,
      `src/enrichment/quote-safe.ts`, and `tests/` (+ `.drytis/` docs).
- [x] Owner gate ticked (2026-08-24 01:33 UTC); two-commit closure executed;
      NOT pushed.
