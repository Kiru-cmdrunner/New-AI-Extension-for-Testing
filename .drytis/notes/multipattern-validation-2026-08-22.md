# Multi-Pattern Real-Chrome Validation — pre-6A/6C gate (build 568adfe)

**Date:** 2026-08-22 · **Build:** dist rebuilt fresh @ 568adfe (6D.0), v10.9.0, 32 files
**Purpose:** confirm 6A+6C target the right *generic* architectural gap before implementation. No product code changed.
**Method:** real Chrome 148 + CDP harness (technique mirrors adanione-clone-audit/harness.mjs). Three generic app
patterns served from one local app (port 8177), all interactions driven by trusted CDP input events
(per-char keyDown/keyUp typing, real ArrowDown/Enter for the native select, mouse clicks at element centers).
No site-specific tokens; AdaniOne/Amazon are only benchmarks.

**Artifacts:** `evidence/multipattern-validation-2026-08-22/` — app.mjs, harness.mjs, run8/run9.log, dumps/*.json, *-spec.ts.

## Patterns
- **P-CLASSIC** — server-rendered, plain `#id` inputs/buttons, native `<select>`, table, NO data-* attributes.
- **P-REACTISH** — className-only identity (no ids/data-*), controlled-input rewrite on blur (typed "Sat, 22 Aug" → committed "Sat, 05 Sep"), debounced typeahead, async badge pending→planned.
- **P-SHOP** — aria-label icon buttons (qty steppers), `data-sku` entity cards, cart counter/total.

## Gate: 12 PASS / 3 FAIL — the 3 fails are exactly the 6A/6C gap

| # | Finding | Layer (root cause) | Evidence |
|---|---------|--------------------|----------|
| F1 | **O8 confirmed generically**: #id-only semantic surfaces produce ZERO resultingState items → zero assertions | Understanding | classic: 0 items on all windows; live DOM had counter "2 tickets", status "Search complete", 2 rows. IR: 0 assertions; spec header says "No assertions generated" |
| F2 | **6C confirmed generically**: typed intent lost on TextEntry blur-rewrite (typeahead "ben" → committed "Bengaluru"); IR fill = "Bengaluru" | Capture/definition semantics | reactish int-4 textValue="Bengaluru" (typed "ben" lost); DatePicker (correct pattern) kept typed "Sat, 22 Aug" → `selectDate` step preserved intent. Contrast proves TextEntry is the gap |
| F3 | **Transient-state pinning**: "Planning…" pinned as the click's final assertion instead of settled "Trip planned" | Understanding (settle timing vs scan moment) | reactish IR: textMatch contains "Planning…" on `#app` — the 400ms async final state never captured |
| F4 | **NEW — Dropdown completes on intermediate trusted `change`**: keyboard-driven native select fires change after every ArrowDown; lifecycle completes on FIRST change → `selectedValue: "Low"` while real committed = "high"; generated spec replays the WRONG choice (`selectOption('Low')`) | Capture/definition semantics (lifecycle completion) | classic int-3 members `['focus','keydown','keydown','input=Low','change=Low']`; live DOM = high; 2 later change events fell to Unclassified #prio interactions |
| F5 | **Planning… also matched a status-badge selector family** (`[class*="pill" i]` etc.) — semantic misclassification of a transient | Understanding | reactish Click resultingState item kind=status-badge text "Planning…" |

## What PASSED (capture layer is NOT the bottleneck — confirms RCA)
- Trusted typing → per-keystroke input capture, change, blur; TextEntry completes with correct committed value (invoice).
- Native select keyboard interaction → Dropdown lifecycle DID fire with focus+keydown+input+change members.
- aria-label icon buttons: 3 stepper clicks, correct names, repeated identical clicks stay distinct steps.
- Typeahead option click captured (Unclassified LI — matches RCA observation; dropdown option proof gap, parked as provisional).
- Cart counter + entity cards: full counter/entity items per window; 9 assertions; Playwright spec with toContainText/toBeAttached — semantically correct.
- IR fill/description: correct target names, no locator regressions; repeatability preserved.

## Root-cause classification summary
- **Capture layer: HEALTHY** (with 2 semantic-contract exceptions that live in *definitions*, not the tap): F4 Dropdown intermediate-change completion; F2 TextEntry blur-overwrites-typed (same family as DatePicker's correct contract).
- **Understanding layer: THE GAP** — F1 (selector vocabulary ceiling → zero observations on generic apps), F3/F5 (transient states pinned because scan moment precedes true settle; no transient filtering).
- **Knowledge layer: not yet exercised** (consolidation happens post-recording; out of scope this cycle).
- **Generation layer: HEALTHY** — derives correct assertions WHEN observations exist; honest "no assertions" header otherwise; renderer correct.

## Harness-realism lessons (why first runs under-reported capture quality)
1. Synthetic `change`/`input` events are **filtered by the trust gate** (event-tap.ts:204) — first run "lost" the select because the harness dispatched synthetic events. Real ArrowDown/Enter drove trusted events and the Dropdown lifecycle fired.
2. Click→STOP too tight (< settle) starves the last window of resultingState items — mirrors COMPANION_WINDOW_MS 300ms + settle semantics.
3. Reading DOM state mid-interaction (re-focus) pollutes the recording with focus events — read BEFORE focus.
4. Chrome storage evalPanel returning objects instead of JSON strings → "[object Object]" parse crash; always JSON.stringify in-page.

## Verdict
**6A+6C are aimed at the right generic gap.** The 3 FAILs map 1:1 to 6A (F1: zero observations on #id-only/class-only apps) and 6C (F2: typed vs committed semantics in TextEntry), plus F3/F5 which 6A's noise-gates + settle-aware scan partially address (transient filter). **F4 is NEW** and must be added to the 6C family: Dropdown's completion contract (first trusted change wins) must not pin an intermediate value when the user keeps driving the select — same typed/committed family, different lifecycle. Recommendations recorded in spec §11 (V-findings V1–V5); no product code touched.

**Change-set delta from validation:** spec gains V4 (Dropdown intermediate change) — proposed as 6C-family pin P11 (RED on current build; likely amber for same family reasons) — and V3/V5 (transient-state semantics) noted as 6A scope boundary: seed-pass filters transients via the 7 noise gates, but settle-moment semantics (scan before true settle) is an ownership/settle question, NOT a seeding question — do not expand 6A to fix F3; log as 6D.x candidate instead.