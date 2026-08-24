# 7.2-M1 closure — evidence provenance

**Milestone**: 7.2-M1 'Close the knowledge loop'
**Date**: 2026-08-24
**Baseline**: 5954036 (WARN-4 closure)
**Spec**: `.drytis/specs/phase-7-2-m1-knowledge-deeplink.md` (all ACs ticked, SHIPPED)
**Owner gate**: closed 2026-08-24 15:14 UTC; reviewer WARNs recorded as followups per owner instruction

## Change (commit 1 — src + tests)

- `src/sidepanel/kr-chip.ts` — chip becomes `<button type="button">`
  with `data-app-id`/`data-signature-key`; `setKnowledgeOpen` seam
  (default null → inert chip, honest degradation); Enter/Space activation
  with preventDefault (no double-tab); idempotence preserved;
  `KrChipResult` gains optional appId/signatureKey (additive).
- `src/sidepanel/sidepanel.ts` — `openKnowledgeBrowser` (URLSearchParams-
  encoded deep link, never interpolation); `resolveSessionAppId` (cached,
  same join domain as existing lookups: sessionId → behavior-session →
  appId); seams installed at init; `browse-repo-btn` + `repo-btn` carry
  `?app=`; `installKrLookup` enrichment passes signature-row appId (no
  key parsing) and session scoping via `resolveUnderstandingSessionId()`
  (live-probe-validated key domain — see WARN-3 note).
- `src/sidepanel/evidence-renderer.ts` — MS-U4 placeholder string
  REMOVED; "Open in knowledge browser" link rendered only when
  opener+entityId+appId all present; `setKnowledgeLink`/`setKnowledgeAppId`
  seams (renderer stays chrome.*-free); `renderObservedItemDetailForTest`.
- `src/repository/kr-browser.ts` — `parseKnowledgeParams` strict
  whitelist; `focusSignatureKey`/`focusEntityId` options; `data-signature-
  key`/`data-entity-id` on rows; `.kr-highlight` + scrollIntoView with
  CSS.escape; unknown-app fallback drops focus params.
- `src/repository/repository-page.ts` — init reads params; projectId
  passthrough to heal reads (receive-side).
- `src/repository/repository.css`, `src/sidepanel/styles.css` — highlight
  outline; chip button cursor/focus-visible.
- Tests: `tests/repository/knowledge-deeplink-7-2-m1.test.ts` (11 pins,
  D1–D12 incl. D12 source-scan), extended `kr-chip.test.ts` (8) and
  `evidence-drilldown.test.ts` (superseded MS-U4 pin → honest absence).

## Gate record

| Gate | Result |
|---|---|
| Red-first | reviewer independently reproduced on clean HEAD worktree: 21/24 red pre-implementation (D2/D3b/D5 pre-pass = already-shipped tolerant behavior per spec §1) |
| Full suite | 277 files / 4,630 tests, 0 failed |
| tsc --noEmit | exactly the 8-error pre-existing baseline |
| Reviewer | PASS — AC-1..AC-8 actionable PASS; security clean (params → textContent/dataset/URLSearchParams only; cssEscape on focus selector; no chrome.* in pure modules); 3 non-blocking WARNs → recorded as followups in `../../reviewer-warns-7-2-m1.md` |
| infra_verifier | PASS (0 failures) — ZIP md5 `7057aa6b742126f35bf83049c0a7287a` four-way identical (root = download/ = serve mirror = preview), 301,425 B, 40 entries; repository bundle md5-identical across chain with data-app-id/data-signature-key/kr-highlight markers verified IN the shipped artifact |
| Real-Chrome E2E pin ⑫ | **7 PASS / 0 FAIL** (`run-1.log`; re-run after session recovery) — W1 chip button w/ params, W2 deep-link tab `?app=&sig=`, W3 app selected + `.kr-highlight` on the exact signature row, W4 repo-btn app-scoped, W5 stopped view/understanding card intact + zero console errors |

## Honesty notes

1. Session was interrupted twice mid-milestone; E2E re-run from scratch
   after the second recovery — `run-1.log` is the authoritative full pass.
2. Entity deep-link branch not exercised in E2E (unit-pinned D10) —
   followup WARN-2.
3. `installKrLookup` scoping change beyond spec text, validated by live
   probe dump (`dumps/dbg-cards-vs-episodes.json`): old key domain
   (`REPOSITORY_SESSION_ID`) finds nothing post-7.0; new one matches the
   chip join — accepted, not reverted (followup WARN-3 folds remaining
   lookups onto the shared helper).
4. ZIP size 301,425 B here vs 294.1 KB pack output: KB display rounding
   in the packer log; the md5 chain is the identity of record.

## Followups (owner-approved record)

All three reviewer WARNs recorded with concrete followup actions in
`.drytis/notes/reviewer-warns-7-2-m1.md`. Out of 7.2-M1 scope.
