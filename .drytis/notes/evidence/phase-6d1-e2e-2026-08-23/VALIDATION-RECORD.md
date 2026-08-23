# Phase 6D.1 — Validation Record (real-Chrome E2E + full closure)

**Date:** 2026-08-23 (01:54–04:20 UTC) · **Baseline:** `92de517` + uncommitted 6D.1 working tree
**Build:** dist v10.9.0 rebuilt from the 6D.1 tree (`npm run build`, post-WARN-fixes)
**Method:** real Chrome 148 headless (CDP), trusted input only (per-char key events, mouse clicks at element centers). No product code changed during the E2E; harness/test-app fixes only.

## Coverage: W1–W4 validation + 6A/6B regression proof (per owner directive)

The final E2E explicitly proves existing 6A/6B behavior remains intact alongside each 6D.1 change:

### RUN 1 — P-CLASSIC (W1 + W2 + regression)
| Check | Result | Evidence |
|---|---|---|
| R1-6C-DROPDOWN (regression) | PASS | selectedValue "High", targetName "Priority" |
| R1-6C-TEXTENTRY (regression) | PASS | typedValue "invoice", userTyped true (dual-sample) |
| R1-W2-COUNTER-#id-only (**the audit miss**) | PASS | `body > main > p#result-count` num=2, sel `changed-element-seed`, text "2 tickets" |
| R1-6A-COLLECTION-REGRESSION | PASS | `table#results > tbody` seeded, "T-101/T-104 high" |
| R1-W1-ARIA-LIVE | PASS | `div#live-toast`, sel `[aria-live]`, text "Showing 2 results" |
| R1-W1-SNACKBAR | PASS | `div#live-snack`, sel `[class*="snackbar" i]:not([class*="snackbar-container" i])`, "Filters applied" |
| R1-W1-ROLE-LOG | PASS | `div#act-log`, sel `[role="log"]`, "Search returned 2 tickets" |

### RUN 2 — P-REACTISH (W3 + W4 + W1 badge)
| Check | Result | Evidence |
|---|---|---|
| R2-W4-DATEPICKER-PLACEHOLDER-ONLY | PASS | input has NO date class/type/name — placeholder "Choose a date" alone triggers; dateValue "05092026" |
| R2-W3-OPTIONS-LIST-CLICK (**the audit miss**) | PASS | `li.opt` inside `ul.options-list` → Click, accessibleName "Bengaluru"; no Unclassified cards in the run |
| R2-W3-NO-UNCLASSIFIED-OPTION | PASS | zero Unclassified |
| R2-W1-DATA-STATE-BADGE | PASS | `p#plan-badge` (class renamed so ONLY `[data-state]` can match), sel `[data-state]`, "Planning…" |

### RUN 3 — P-SHOP (6B locator families regression)
| Check | Result | Evidence |
|---|---|---|
| R3-6B-TESTID-CAPTURE | PASS | `data-testid="qty-up-notebook"` trigger captured w/ accessibleName |
| R3-ARIA-ICON-CAPTURE | PASS | `aria-label="Open filters"` icon captured |
| R3-COUNTER-REGRESSION | PASS | counter num=3 (aria-label cart + class count family, unchanged) |
| HARNESS-STORAGE-OK | PASS | 17 interactions with behavioralEvidence |
| CONSOLE-CLEAN | PASS | zero console errors across app+panel |

### KR Dexie probe (AC-W2f)
| Check | Result | Evidence |
|---|---|---|
| AC-W2f: #id-only counter lands in KR | PASS | `knowledgeCounters` row `app-b24aev:counter:body > main > p#result-count` currentValue "5" |
| W1 notifications land in KR | PASS | `knowledgeNotifications` rows for live-toast ("Showing 5 results"), act-log ("Search returned 5 tickets"), live-snack ("Filters applied") |

**Final archived run: 16/16 PASS** (`real-chrome-run.log`, exit 0).

## Known behavior notes (pre-existing, not 6D.1 regressions)
- The commit-click badge snapshot reads the transient `Planning…` pending text (400ms setTimeout is not causal-tracked; window settles on quiescence) — byte-identical to the archived `92de517` baseline dump (run2-storage.json int-4) and the archived MS-U1/post-6A baselines.
- `aria-pressed=false` still captures (any pressed state observable); `aria-selected=false` does not (only the true state is a badge) — pinned in unit tests.

## Test-app fixes during E2E (harness-side only, no product code)
1. Nested-quote collision in the patched reactish date-input selector broke hydration → escaped properly.
2. `out` variable scope bug in the patched classic handler (ReferenceError killed toast/snack/log updates) → stored count on `window.__lastCount`. Root cause of the only mid-run failures; the product had captured everything the page actually rendered both times.
3. SPA nav links in the audit app are decorative (classic's `nav()` never renders the reactish/shop routes) → harness uses full Page.navigate for runs 2–3, real SPA link clicks where available.

## Final state preserved at commit gate (2026-08-23 03:53 UTC)
- Full suite: **254 files / 4464 tests passed** (`suite-final.log`, exit 0, 89.15s) — run on the exact committed tree (write-tree `d5906ebf`, HEAD `92de517` + 6D.1 changes).
- tsc --noEmit: **exactly the 8 pre-existing baseline errors** (`tsc-final.log`) — 5× `ir-executor-navigate`, 1× `ir-bridge-repeated-clicks`, 1× `resulting-state-seeded-display`, 1× `changed-element-seed-honesty`. Zero 6D.1-introduced errors.
- Real Chrome: **16/16 PASS** (`real-chrome-run.log`, exit 0).

## Artifacts
- `e2e-6d1.mjs` — the final harness (16 checks)
- `kr-probe-6d1.mjs` — Dexie KR probe (AC-W2f)
- `app-6d1.mjs` — the patched test app (W1/W4 fixtures)
- `real-chrome-run.log` — final archived run, 16/16 PASS, exit 0
- `suite-final.log` / `tsc-final.log` — final-tree suite + tsc preservation logs
- `dumps/` — run1/run2/run3 storage probes, kr-dexie.json (full KR dump), results.json
