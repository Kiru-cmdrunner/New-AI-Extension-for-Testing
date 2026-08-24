# 7.2-M1 — Close the knowledge loop

**Status**: SHIPPED — awaiting two-commit closure (commit hashes below); owner gate closed 2026-08-24 15:14 UTC
**Baseline**: `5954036` (WARN-4 closure)
**Roadmap**: ROADMAP-2026-08-22.md:258-260 (7.2 Knowledge surfacing)
**Grounding**: read-only audit 2026-08-24 11:07 UTC (all file:line refs re-verified in source immediately before this spec)

---

## 0. Problem, in one paragraph

The engine now genuinely learns (7.0 app identity, 7.1 views/transitions, WARN-4-clean pairing) and the panel already *tells* the user it learned (🧠 understanding card, KR chips) — but every "knowledge" touchpoint is a dead end. The chip is display-only text (`kr-chip.ts:98-102`, no anchor, no handler). The evidence drilldown ships a tooltip that literally says *"Knowledge browser arrives in MS-U4"* (`evidence-renderer.ts:794-795`) — MS-U4 shipped long ago; the browser exists, 11 sections, populated. The only path to it is a cold `chrome.tabs.create` with no app preselection (`sidepanel.ts:1330-1332`, `:1443-1444`). This milestone closes the loop: every knowledge signal in the panel becomes a working door into the KR browser, at the exact app and row the user was looking at. **Zero new data, zero new derivation, zero schema change** — pure wiring of surfaces that already exist and are evidence-proven populated.

## 1. Audited inventory (what exists — every item verified in source)

| Surface | Where | State today |
|---|---|---|
| KR browser, 11 sections, caps | `src/repository/kr-browser/kr-browser.ts:109-149` (`renderKrBrowser`), `kr-sort.ts:20-40` | shipped, populated (7.1 dumps: views 2, viewTransitions 2, signatures 3 occ 1→2, workflows 2) |
| App selector | `kr-browser.ts:153-175`; `repository-page.ts:737-745` holds `selectedAppId` | shipped, no external entry point to set it |
| KR chips | `kr-chip.ts:85-104` (`attachKrChips`), variants `:37-54` | display-only `<span>`; idempotent; injected lookup seam `setKrLookup` `:30-33` |
| Chip data source | `sidepanel.ts:565-610` `installKrLookup` — already resolves `behaviorSession.appId` and signature rows | shipped; **discards appId + signatureKey after building chip text** |
| Dead placeholder | `evidence-renderer.ts:794-795` `summary.title = 'Knowledge browser arrives in MS-U4'` | shipped bug (stale promise text) |
| Cold open buttons | `sidepanel.ts:1330-1332` (`browse-repo-btn`), `:1443-1444` (`repo-btn`) | shipped, no context |
| Deep-link params | none — `repository-page.ts` never reads `location` | missing |
| `KrBrowserOptions` | `kr-browser.ts:93-102` — `selectedAppId`, `onAppSelected`, **`projectId` optional already** | `projectId` never passed by the only caller → heal reads unscoped (adjacent wiring gap, `kr-data.ts:135-156` supports it) |
| Manifest | `src/manifest.json:22-27` — repository page web-accessible | no change needed |

## 2. Design

### 2.1 Chip → deep link (kr-chip.ts)

- `KrChipResult` gains `appId?: string` and `signatureKey?: string` (optional — pure additive, existing tests unaffected).
- `installKrLookup` (`sidepanel.ts:565-610`) populates both from data it **already reads** (`behaviorSession.appId`, `episode.signatureKey`) — no new reads.
- `attachKrChips` renders a `<button type="button" class="interaction-chip interaction-chip--kr" data-app-id data-signature-key>` instead of a span, with the same text; Enter/Space activation (native button); existing `has-kr-new` class behavior unchanged; idempotence check unchanged (query `.interaction-chip--kr`).
- New injected seam, same pattern as `setKrLookup`: `setKnowledgeOpen(open: ((target: KnowledgeLinkTarget) => void) | null)`. Default null → chip renders but is inert (honest degradation, unit-testable without Chrome APIs).
- Click → `open({appId, signatureKey})`.

### 2.2 Panel opener + context (sidepanel.ts)

- One helper `openKnowledgeBrowser(target: KnowledgeLinkTarget | null)`: builds `src/repository/index.html` + `URLSearchParams` (`app`, `sig`, `entity` — only keys present, `encodeURIComponent` via URLSearchParams), `chrome.tabs.create`. Target null → cold open (status quo).
- Session appId resolution: reuse the **existing** `knowledgeBehaviorSessions.where('sessionId')` pattern (already at `:587`, `:815`, `:841`) — one small shared `resolveSessionAppId()`, cached after first hit; failure → null → cold open. No new read shapes.
- Wire `setKnowledgeOpen(openKnowledgeBrowser)` at init (next to `void installKrLookup()` `:1541`).
- `browseRepoBtn` and `repoBtn` handlers pass `{appId: await resolveSessionAppId()}` — same helper, no duplication.
- Pass `appId` into the evidence-renderer via the same opener seam (below) — sidepanel resolves it; renderer stays DOM/storage-free.

### 2.3 Dead placeholder → real link (evidence-renderer.ts)

- Replace `:794-795` tooltip with: when an injected opener exists AND `item.entityId != null`, render an inline "Open in knowledge browser" link-button in the item-detail body → `open({appId, entityId})`; otherwise render the plain `entity <type>:<id>` line unchanged (honest absence — no fake affordance).
- Seam: `setKnowledgeLink(open | null)` module-level, exact `setKrLookup` pattern. No chrome.* imports into the renderer.

### 2.4 Deep-link handling (repository-page.ts + kr-browser.ts)

- New pure function (exported, unit-testable) `parseKnowledgeParams(search: string): {appId?: string; signatureKey?: string; entityId?: string; projectId?: string}` — `URLSearchParams` whitelist; unknown keys ignored; values used **only** as Dexie lookup keys / attribute values, never innerHTML.
- Init: `selectedAppId` starts at `?app=`; if that appId is not among `loadApplications()` results → fall back to `apps[0]` and drop the focus params (honest: never a blank browser).
- `KrBrowserOptions` gains `focusSignatureKey?: string | null` and `focusEntityId?: string | null` (optional, backward compatible). `renderKrBrowser` after appending sections: signature rows get `data-signature-key="<key>"` at build time; the focused row gets class `kr-highlight` + `scrollIntoView({block:'center'})`; entity rows likewise `data-entity-id`. Absent key → no crash, no highlight (pinned).
- `projectId`: page passes `?project=` through when present. Honest note: **no current caller sends it** — this closes the wiring gap flagged in the audit (`kr-data.ts:135-156` already supports scoping); callers gain the capability without behavior change.
- CSS: `.kr-highlight` outline in repository styles; chip button reset (inherits existing chip styling; add `cursor:pointer` + focus ring) in sidepanel styles.

## 3. Test matrix (TDD, red-first)

New `tests/repository/knowledge-deeplink-7-2-m1.test.ts`:
- **D1** `parseKnowledgeParams` — full param set; empty search → all undefined; unknown keys ignored; encoded values survive round-trip.
- **D2** unknown `?app=` → fallback `apps[0]`, focus dropped (via renderKrBrowser with stubbed loads — the established kr-browser test pattern).
- **D3** `focusSignatureKey` present → row carries `data-signature-key`, gets `.kr-highlight`, `scrollIntoView` called (jsdom mock); absent → no crash, zero `.kr-highlight`.
- **D4** same for `focusEntityId`.
- **D5** `projectId` passthrough → `loadHealElements` receives it (spy at options level).

New/extended `tests/sidepanel/kr-chip.test.ts`:
- **D6** attach renders `<button>` with `data-app-id`/`data-signature-key`; text/tone unchanged vs shipped expectations.
- **D7** click → injected opener called with `{appId, signatureKey}`; opener null → chip inert, no throw.
- **D8** Enter/Space keydown → opener called (native button + explicit key handler pin).
- **D9** idempotence preserved (second attach no-op).

Extended `tests/sidepanel/evidence-renderer.test.ts`:
- **D10** entityId + opener → "Open in knowledge browser" present, click → `open({appId, entityId})`; no opener → line renders, no link, **no MS-U4 string anywhere**.
- **D11** source-scan (established `kr-wiring.test.ts` d5 pattern): `evidence-renderer.ts` must NOT contain `Knowledge browser arrives in MS-U4`.

`tests/repository/kr-wiring.test.ts` extension:
- **D12** source-scan: `repository-page.ts` contains `parseKnowledgeParams` wiring at init and `projectId` passthrough.

**Existing suites that must stay green**: `kr-chip.test.ts` (shipped pins), `kr-browser.test.ts`, `kr-sort.test.ts`, `kr-wiring.test.ts`, `evidence-renderer.test.ts`, `understanding-card*.test.ts`, `forward-links.test.ts` — plus the full suite (expected 274+2 files / ~4,620 tests).

## 4. Real-Chrome E2E pin ⑫

House CDP pattern, AdaniOne clone fixture (`:8190`, self-started by harness, killed after):

1. START recording (panel context) → one DatePicker cell click → STOP.
2. Panel DOM: at least one `.interaction-chip--kr` button present with `data-app-id` = the session's app (origin `http://127.0.0.1:8190`).
3. Click the chip → a new tab opens with URL `src/repository/index.html?app=…&sig=…`.
4. Repository tab DOM: app selector shows the session's origin as selected; the signature row with matching `data-signature-key` carries `.kr-highlight`.
5. Back in panel: evidence drilldown item with entityId renders "Open in knowledge browser"; click → second tab `?app=…&entity=…`, entities section highlights (fixture may legitimately have 0 entities → honest path: link present, browser opens at the app, no highlight, **no crash** — assert that branch too if hit).
6. `repo-btn` click → tab URL carries `?app=` of the session.
7. Regression guard on the same run: stopped-view cards and understanding card unchanged (no reflow/duplication), zero console errors in panel + repository tabs.

## 5. Acceptance criteria

- [x] **AC-1** D1–D12 written first, red on the untouched tree for the new behaviors (D1–D10 new-surface red; D11/D12 source-scan red via the shipped placeholder), green post-implementation. Reviewer independently reproduced red-first on a clean HEAD worktree: 21/24 red; D2/D3b/D5 pre-passing pins documented as already-shipped tolerant behavior per §1.
- [x] **AC-2** Full suite green (277 files / 4,630 tests); tsc exactly the 8-error baseline.
- [x] **AC-3** Chip is a real button, keyboard-activatable (Enter/Space, preventDefault — no double-tab), deep-links app+signature; inert-but-rendered when no opener (honest degradation).
- [x] **AC-4** MS-U4 placeholder string gone; replaced by honest link/absence pair.
- [x] **AC-5** Deep-link handling with unknown-app fallback pinned; params never rendered as HTML (textContent/dataset/URLSearchParams only; CSS.escape on the focus selector).
- [x] **AC-6** `projectId` passthrough wired (receive-side only, no caller change).
- [x] **AC-7** E2E pin ⑫ passes 7/7 (W1–W5; entity branch unit-pinned D10 — WARN-2 followup recorded).
- [x] **AC-8** Reviewer PASS (7/8 actionable ACs; 3 non-blocking WARNs recorded as followups in .drytis/notes/reviewer-warns-7-2-m1.md) + infra_verifier PASS (0 failures; ZIP md5 7057aa6b… four-way identical, markers verified inside the shipped artifact).
- [x] **AC-9** Two-commit closure: 1) src+tests, 2) spec+evidence+roadmap (7.2-M1 SHIPPED; browser-in-panel explicitly NOT DONE — roadmap records the decision; reviewer WARNs recorded as followup items per owner instruction).
- [x] **AC-10** Owner gate report before commit (delivered 14:40 UTC; approved 15:14 UTC). No push until owner publishes.

## 6. Honesty notes

- The roadmap's "KR browser in panel" is deliberately NOT in this milestone: the narrow side panel already has the in-panel "what was learned" surface (understanding card, `understanding-card.ts:179-315`); embedding the 11-section browser would duplicate it. The loop closes via the panel → browser tab, not via duplication. Roadmap entry will record this decision.
- `knowledgeCounters` = 0 in 7.x dumps is fixture-explained (AdaniOne clone shows counters=1) — audit non-defect, not touched here.
- D5's `projectId` has no sender today; the spec wires the receive side only and says so. No invented mapping between repository-v2 projects and KR apps.
- `resolveSessionAppId` adds one cached Dexie read at STOP-time chip attach; the three existing session-appId lookups (`:587/:815/:841`) are left as-is in this milestone — refactoring them onto the shared helper is tempting but touches proven understanding-card paths; deferred to a hygiene pass if the owner prefers (default: defer).
- No new dependencies, no env keys, no schema, no manifest change (page already web-accessible, `manifest.json:22-27`).

## 7. Out of scope (parked)

7.3 capability derivation; 7.4 cross-session proof; embedding the browser in the panel; counters surfacing; version skew; deterministic-recorder dead code; legacy untracked files; the three-lookup refactor noted above.
