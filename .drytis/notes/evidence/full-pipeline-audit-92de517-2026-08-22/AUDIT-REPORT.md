# Full-Pipeline Audit — committed HEAD `92de517` (pre-6D.1 gate)

**Date:** 2026-08-22/23 (23:54–00:45 UTC) · **Build:** dist v10.9.0 rebuilt from `92de517`
**Method:** real Chrome 148 (CDP), trusted input only (per-char key events, mouse clicks at element centers, keyboard-driven native select). No product code changed, nothing committed.
**App:** archived generic multipattern app (P-CLASSIC/P-REACTISH/P-SHOP) + 6B attribute families added (data-auto-id, data-cy, data-testid, class-only icon). A real `fetch('/api/cities')` typeahead was added to P-REACTISH to exercise the network-evidence layer.

## Verdict per layer — ALL PASS

| Layer | Verdict | Evidence |
|---|---|---|
| Real user interaction (trusted CDP input) | PASS | 4+3+4+3 interactions across 4 recordings |
| EventTap capture | PASS | TextEntry 18 events, Dropdown 10, DatePicker 20 — member chips |
| Component/runtime recognition | PASS | TextEntry/Dropdown/Click/DatePicker all recognized, no Unknown in classic/shop; reactish options-click Unclassified = archived MS-U1 baseline |
| Evidence Ledger | PASS | 15 entries; owner-gated ring joins |
| Behavioral Evidence | PASS | 100% of interactions carry BE; window endReasons stabilized/consequence-settled |
| DOM/surface/visibility evidence | PASS | Dropdown 3 + Click 3 + shop clicks 4 domChanges; MS-U2 drill census 11 `<details>` incl. dom ×6, window ×1, item ×1, raw JSON |
| Network evidence | PASS | TextEntry typeahead netActivity=4 (real fetch) |
| Semantic resulting-state capture (6A) | PASS | classic click → collection; reactish click → status-badge; shop clicks → counter "3"→"4" + entities; classic #id counter absent = archived O8 baseline |
| Interaction storage | PASS | `cmdrunner_live_interactions` carries full BE envelopes |
| Side Panel rendering (MS-U1) | PASS | cards, endState chips, understanding badges w/ prios, member chips, footer evidence chips, assertion chips |
| Application Evidence drill-downs (MS-U2) | PASS | 11 drill-downs rendered |
| Session Understanding card (MS-U3) | PASS | session, appId, outcomes counters |
| Forward Links (MS-U5) | PASS | "What this recording improves" block present both passes |
| IR generation | PASS | fill/selectOption/click steps, 3 assertions/shop click |
| Assertions | PASS | soft expects incl. dual-sample fill (typed intent) + resulting-state seeds |
| Locator generation (6B) | PASS | `getByTestId('qty-up-notebook')` bare; `[class~="icon-filter"]` icon; aria `getByLabel('Open filters')` correctly outranks class tier; zero nth-of-type |
| KR persistence + browser (MS-U4) | PASS | Dexie `cmdrunner_knowledge`: 4 apps, 6 signatures, 7 episodes, 12 outcomes, 8 gaps, 4 workflows; Knowledge tab renders all sections |
| KR reinforcement | **PASS** | archived MS-U5 harness re-run verbatim on HEAD: 11/11 — `◆ reinforced ×2` fires |
| Doctrine (site-agnostic, read-only KR) | PASS | no site tokens; KR consumed read-only |

## The three audit-harness FAILs — root-caused, all harness-side (no product defect)

1. **KR-REINFORCE "×2" miss in the v2 audit** — `handleStartRecording` stamps `recordingStartUrl` from the *active tab at START time*. My harness activated the app tab *after* sending the panel message, so RUN 1's origin was the panel page and RUN 4's the app page → different `deriveAppId()` keys → signatures stored under different apps (row dump: `app-b24aev` = panel origin vs `app-eketi1` = app origin). With consistent activation (MS-U5 flow), reinforcement fires. Product behavior is deterministic and correct; the harness controlled tab activation in the wrong order.
2. **KR-STORE probe** — probed `chrome.storage` for a key; KR lives in Dexie/IndexedDB `cmdrunner_knowledge`. Fixed probe returned full table counts.
3. **"2 sessions" / section-header regexes** — path-sensitive `deriveAppId` (documented hash of full origin string) made `/` vs `/reactish` vs `/shop` distinct apps; my `\b`-escaped regexes missed lowercase header text. Fixed probes pass.

## Observations for the roadmap (not defects)

- **`deriveAppId` hashes the full URL including path** (`knowledge-persistence-service.ts:55`). `/` vs `/reactish` vs `/shop` on one origin become three apps. SPA route changes never split (origin captured once at start), but multi-path recorded apps fragment KR per path. Candidate for 7.x review — NOT a 6B regression, predates it (matches MS-U4 archived dumps where the same three paths appeared as separate apps).
- **Recording origin = active tab at START_RECORDING time.** If the user starts recording from the side panel (whose tab is active), the panel page's origin is captured. Starting from the panel is the normal UX — MS-U5 shows both recordings consistently captured the panel origin, so reinforcement works in that flow; a flow that switches activation mid-run can split appIds. Worth a design note for 7.x.
- **Unclassified options-list click (reactish)** — unchanged from archived MS-U1 baseline; 6D.1 scope (universal interaction classes) exactly as roadmap says.
- **Classic #id-only counter** (`p#result-count`) still matches no selector family — the archived O8 limitation, folded to 6D.1.

## Conclusion

**Committed HEAD `92de517` is safe to proceed with 6D.1.** All pipeline layers verified end-to-end with real user input; no regressions across 6A/6B/6C, MS-U1–U5. Evidence: this directory (harness, FINAL log, row dumps, MS-U5 verbatim re-run 11/11).
