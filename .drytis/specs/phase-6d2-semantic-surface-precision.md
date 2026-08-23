# Phase 6D.2 — Semantic-Surface Precision: Evidence-Gated Milestones

**Status:** CLOSED 2026-08-23 — evidence-resolved at M1; **zero implementation shipped** (all three milestones NO-GO/CLOSE-AS-IS on the evidence; owner closure directive 05:34 UTC). See §3.1 M1 outcomes.
**Baseline:** `da5e678` (capability-surgical-removal, 13 commits ahead of origin, unpushed)
**Predecessors:** 6D.0 (`568adfe`), 6A+6C (`bd8e907`), 6B (`72bb6ed`), 6D.1 (`476e086`/`da5e678`), U1–U5, doctrine pin (`153f5c2`)
**Roadmap source:** `.drytis/notes/ROADMAP-2026-08-22.md` §Phase 6 — 6D.2 entry (superseded by §1 reconciliation + §3.1 M1 outcomes)
**Grounding audit:** `.drytis/notes/` (2026-08-23 read-only audit of `da5e678` — this conversation, reported before spec)

---

## 0. Owner directives in force

1. **(2026-08-23 04:41 UTC)** M1 only, strictly evidence-gathering: real-Chrome nested-target O11 reproduction; Amazon/Avis/clone census for `aria-pressed`, `role=switch`, `data-state`, and current Click/Checkbox coverage; extended P3 popup-token re-probe. "Report the actual numbers and evidence and let those results determine whether M2, M3, or M4 should proceed."
2. Toggle stays OUT of 6D.2 **until the census proves a meaningful uncovered population**.
3. Exclusions frozen: no KR signature change, no dataAutoId fuzzy matching, no stabilityTrace fix, no 6F display work, no capture/ledger changes.
4. Write the 6D.2 spec with M1 as the first gated milestone, then **stop for approval before running implementation**.

---

## 1. Grounding reconciliation (roadmap vs. `da5e678` reality)

The 6D.2 roadmap line predates 6D.0/6D.1 and is stale in three of four clauses:

| Roadmap clause | Reality at `da5e678` | Grounding verdict |
|---|---|---|
| "ARIA dropdown remainder" | S3' containment proof role-format-aware (6D.0); `selectionConfirmed` written since `68d831e`; W3 options-list/suggestion/autocomplete/typeahead surface tokens + W4 placeholder DatePicker shipped in 6D.1 (E2E-verified: "Bengaluru" Click, zero Unclassified). Only residue: bare `role=option` with no surface ancestry stays parked-provisional → abandoned (honest, S3'). | **Already available** — no 6D.2 work item |
| "popup-token anchoring decision … frozen until then" | P3 probe ran 2026-08-21: 10 PASS / 4 true-negative FAILs (newsletter-popup, cookie-popup, popup-banner, popup-blocked-notice). Recorded verdict: bounded+honest, "not urgent, not a 6F blocker"; anchor option written (`/(listbox\|dropdown\|popover\|overlay\|modal\|dialog\|flyout\|menu)([-_]\|$)/`); **the extended anchored-regex re-probe was never run, no decision adopted**. | **Partially available** — M3 re-probe + owner decision |
| "O11 unpaired-mousedown pairing fix (containment/sequence-based)" | **Half-shipped.** Same-element S1' pairing landed `68d831e` (pinned: `tests/runtime/structural-fixes-rca2.test.ts`, 34 tests). Remainder = **nested-target press** (mousedown on child span/icon → click on parent → different `elementKey` → no collapse → orphan card). Structural containment is evaluable from data already on the ledger entry (`targetIdentity.xPath`/`cssSelector` prefix + same pageId + adjacency). **No nested-target case is pinned or exercised in any archived E2E** — zero live evidence it occurs today. | **Requires implementation — but evidence-first** (M1 repro) |
| "census-driven Toggle/filter-chip definition" (6D.1 carry-forward) | Census does NOT justify a definition: Amazon chips = `<a href>` → Link (preserved finding, architecturally correct); AdaniOne clone chips = `LI[role=listitem]` → single Clicks since 6D.0; native checkbox → full Checkbox lifecycle + IR toggle (P1/P2 43/43). `role=checkbox`/`menuitemcheckbox`/`<details>` counts on Amazon+Avis: **0**. Only unmeasured residual: plain `<button aria-pressed>` toggles (icon filters, favorite stars, grid/list switches) — currently honest Click cards; **never counted anywhere**. | **Evidence insufficient — M4 census probe gates any definition** |

Additional layers already solved (credit where due — no re-work): 6A/6C assertion derivation (Amazon 8/8 replay-passing), 6B locator families (live in IR), MS-U1–U5 renderer/KR surfaces, Checkbox definition coverage (`input[type=checkbox]`, `role=checkbox|switch|menuitemcheckbox`, OXD/MUI wrapper classes, `captureCheckedState` → `aria-checked` → `aria-pressed` → framework checked-classes).

## 2. Architecture rules restated (binding on every milestone)

Unchanged from 6D.1 §5, with additions from this phase's owner directives:

1. **Site-agnostic engine** — genericity pin stays green; census/harness assets live under `.drytis/`, never in `src/`; no site tokens.
2. **Deterministic-first, AI-last** — no timing rules; census = structural DOM facts (attributes, roles, classes).
3. **No site-specific hacks.**
4. **No capture/projection/ledger changes without explicit phase scope** — M1 writes NO product code at all. M2 (if approved later) is projection-only. M3 (if approved later) is patterns-vocabulary-only. M4's census writes no code; any definition decision is a NEW owner gate.
5. **KR is read-only from UI; signatureKey v1 frozen; deriveAppId untouched.**
6. **Understanding never leaks into generation incorrectly.**
7. **Owner gate before commits** — and per this phase's directive: **owner gate before M1 EXECUTION too** (spec approval below).

## 3.1 M1 outcomes (2026-08-23 — CLOSED; evidence at `.drytis/notes/evidence/phase-6d2-m1-2026-08-23/`)

- **M1-A O11:** canonical nested-target orphan **NOT-REPRODUCED** — `resolveTarget` (capture layer) promotes nameless children to the named ancestor, so both physical events of a canonical press resolve to the same target and S1' pairs them (final run 14 PASS / 0 FAIL, exit 0). Only residual twin: **cross-target drag** (down on A, up on B → click synthesized on common ancestor → 2 unpaired cards) — a display question, IR unaffected. → **M2 NO-GO: descope; residual → 6F display backlog.**
- **M1-B census:** uncovered toggle-shaped population **0** on every measurable surface (clone 9 interactive/0 pressed; 6D.1 app 5/0; Avis Ford LIVE 249 interactive/0 pressed/0 switch; Amazon via archived G5 tables: role=checkbox 0, menuitemcheckbox 0, details 0 — aria-pressed unmeasured live, container blocked). → **M4 NO-GO: Toggle stays parked.**
- **M1-C P3 re-probe:** anchoring **irreducible** on a 32-case corpus — every anchored variant retaining `popup` over-matches popup-banner/footer/cookie shapes; dropping it misses traveler-popup/popup positives; anchored-without-popup would **break the 6D.1 W3 positives** (suggestion-list, options-list). Shipped regex: 0 misses. → **M3 CLOSE-AS-IS: keep shipped regex; finding recorded.**
- Net: **6D.2 implementation scope = zero**; phase closed evidence-resolved. No product code, tests, config, services, or env changed.

## 3. Milestones (gated; M1 executed, M2–M4 closed on M1 evidence)

### M1 — Evidence pack (zero product code) — THE ONLY APPROVED-FOR-SPEC MILESTONE

**Purpose:** produce the three evidence sets the owner named, with archived numbers, so M2/M3/M4 decisions are data-driven, not assumption-driven.

**M1-A: Real-Chrome nested-target O11 reproduction**
- Build (or adapt from `e2e-6d1.mjs` patterns) a harness + local app page containing at minimum:
  - `<button>` wrapping an `<i class="icon-…">` / `<span>` child — press lands mousedown on the child, click resolves on the parent (the AdaniOne int-47/48 shape);
  - a same-element control case (already pinned in unit tests; re-verify end-to-end);
  - an unrelated-adjacent control case (different siblings) — must stay TWO cards;
  - the app must contain NO interactive-element signals on the child (no role/tabindex on the inner span) so the press is not claimed by Click (mirrors RC1 shape).
- Real Chrome (CDP, trusted input, mouse-down at child center, mouse-up at parent center — the natural press), extension loaded from dist, storage-probe the ledger + projected interactions.
- **Determine:** does the orphan/twin Unclassified card actually occur at `da5e678`? Record the exact card sequence (types, `physicalEventType`, `pairedAtProjection`), ledger dispositions, and IR step count impact (expected: none — NOISE_TYPES filters Unclassified).
- Output: run log + storage dumps + verdict (CONFIRMED / NOT-REPRODUCED) archived under `.drytis/notes/evidence/phase-6d2-m1-<date>/`.

**M1-B: aria-pressed / role=switch / data-state census**
- **Clone census** (in-container, deterministic): run the toggle-census script over the archived clone app (`adanione-clone-audit/app.mjs`) — and the 6D.1 app (`app-6d1.mjs`) for contrast; count per surface: total interactive elements, elements with `aria-pressed` (and value distribution true/false), `role=switch`, `data-state` (non-form-control), `class~chip`-family, current classification (Link/Click/Checkbox/other) where derivable from archived run dumps.
- **Avis Ford live census** (container egress OK — verified 200 in this audit): same counting script over `https://www.avisford.com/` (G5 method: live DOM inspection via CDP `browser_evaluate`-equivalent; G5 recorded 212 links / 45 buttons / 4 selects / 0 checkboxes / 0 radios).
- **Amazon census** — Amazon 503s from this container (bot-blocked, matches archived validation constraints; re-verified 503 at spec time). Options, in order:
  1. Count from the G5 archived census tables where the relevant fields exist (role=checkbox 0, menuitemcheckbox 0, details 0 — already recorded; aria-pressed NOT recorded there);
  2. If fresh live numbers are required, the owner/user supplies a saved-HTML or live-session path (user remains the live evidence loop per archived constraints);
  3. Amazon-checkout-style fixture from the clone corpus as a bounded third surface (recorded as fixture, not live).
- **Determine:** the uncovered-population number the owner's gate needs: elements that are interactive, toggle-shaped (aria-pressed/switch/data-state), and NOT covered today by Link/Checkbox/Click-with-state. That number vs. the definition threshold drives M4.
- Output: census JSON/MD tables archived with the M1 pack.

**M1-C: Extended P3 popup-token re-probe**
- Re-run the archived negative/positive corpus from `.drytis/notes/evidence/|phase-6d0-int47-probe/p3-popup-negative-probe.mjs` + the 4 true negatives + traveler-popup positive + role-path positives — this time with BOTH regexes:
  1. current shipped `/(listbox|dropdown|popover|overlay|modal|dialog|flyout|menu|popup|MuiDialog|ant-modal|p-dialog)/i`
   corpus extension: additional real-world popup-class shapes (banner-, cookie-, newsletter-, chat-, filter-popup conventions, `popup-` prefix forms, `Dropdown-menu`/`Popover-trigger` compound forms) — the "extended" corpus the roadmap promised.
- For each token: current-regex match / anchored-regex match / verdict (over-match without anchor; safe with anchor; true surface).
- Output: comparison table + go/no-go recommendation for M3 (adopt anchored vocabulary or defer to 6F).
- **Constraint:** the re-probe runs against regex fixtures in a harness file; the shipped `src/definitions/patterns.ts` regexes are NOT modified by M1-C.

### M2 — O11 nested-target pairing (GATED on M1-A: proceeds only if the orphan is CONFIRMED)
- Authorized files: `src/runtime/projection-engine.ts` (`pairPhysicalPress` neighborhood) + `tests/runtime/structural-fixes-rca2.test.ts` (nested pin + unrelated-pair negative) + new test file(s).
- Structural rule: adjacent mousedown→click, same pageId, **xPath or cssSelector prefix containment** (same generator → ancestor test), no timing. Unrelated different-element stays two cards (pinned).
- Projection-only; capture/ledger/IR/KR untouched. Pre-commit: nested containment must not collapse deliberate two-element presses (scrollbar/drag shapes) — M1-A control cases inform the guard.
- Full MS discipline if it proceeds: TDD → reviewer → infra → real-Chrome evidence → owner gate → commits.

### M3 — Popup-token anchoring decision (GATED on M1-C + owner)
- If M1-C shows the anchored regex is materially safer with no true-surface loss → propose adopting in `patterns.ts` OPEN_SELECTION_SURFACE_CLASS_RE + DROPDOWN_SURFACE_CLASS_RE with full STAB re-pinning; owner decides adopt vs. defer-to-6F. No code before that decision.

### M4 — Census-driven Toggle verdict (GATED on M1-B + owner)
- If M1-B shows a meaningful uncovered population of toggle-shaped interactive elements → owner gate on the graduation path: (a) park the definition again (census recorded), or (b) approve the **Click pressed-state metadata enrichment** as the definition-free first slice (reads already-captured `checkedBefore/After` into Click metadata; additive key; no enum change), or (c) approve a full Toggle definition (enum change — its own phase with schema-impact analysis).
- Default posture: park. The census decides.

## 4. M1 acceptance criteria (all satisfied at closure)

- [x] AC-M1a: nested-target repro harness exists, runs against dist build at `da5e678`+working tree, logs archived; verdict CONFIRMED or NOT-REPRODUCED with exact card/disposition evidence. — **NOT-REPRODUCED** (canonical); 5 shapes tested; `o11-repro-FINAL.log` 14/0, dumps `o11-storage.json`/`o11-cards.json`.
- [x] AC-M1b: census tables for all three surfaces (clone, Avis live, Amazon per constraints) archived; the uncovered-population number is stated explicitly per surface. — `dumps/census.json`; 0/0/0(+0 recorded).
- [x] AC-M1c: P3 extended re-probe table (current vs anchored regex, token by token) archived; adopt/defer recommendation stated. — `dumps/p3-extended-table.json`; CLOSE-AS-IS.
- [x] AC-M1d: zero changes to `src/`, `tests/`, config, services, env — `git status` shows only untracked `.drytis/` evidence files. — verified at closure (0 tracked modifications).
- [x] AC-M1e: archived pack contains M1-REPORT.md summarizing numbers + per-milestone go/no-go recommendation. — present.
- [x] AC-M1f: suite/tsc baseline unchanged. — no code touched; baseline 254 files/4464 tests green + tsc 8 stands as committed at `da5e678` (6D.1 closure evidence).

## 5. Risks (M1)

- **Live-site drift:** Avis/Amazon DOMs change; census is point-in-time. Mitigate: archive raw census queries, date-stamp, and treat as directionally binding only for the M4 threshold.
- **Amazon unreachable:** recorded constraint; census falls back to archived G5 tables + fixture third surface, clearly labeled (live vs fixture) in the report.
- **O11 not reproducible:** that IS the result — M2 dies and the roadmap entry closes as already-solved-by-S1' + honest two-card display for unrelated presses. The harness still ships as archived evidence.
- **P3 corpus shape gaps:** extended corpus is curated, not exhaustive; anchored-regex verdicts are per-shape, and adoption (M3) still needs the owner gate + STAB re-pin, so a partial corpus cannot ship code by itself.

## 6. Out of scope (explicit, frozen)

- dataAutoId fuzzy/alias-family matching (6D/7.1 backlog).
- `deriveAppId` path-sensitivity (7.x).
- stabilityTrace delivery discard (6F-eng, `evidence-collector.ts:1841`).
- 6F display hygiene items (O1/O2/O7/O13/O14, O12 RC7).
- Flight-card entity breadth (6E-slice).
- Any Toggle/filter-chip InteractionType change (gated on M4 census + owner; default park).
- KR signatureKey v1, schema, or any KR write path from UI.
- Any capture/EventTap/projection/ledger change (M1 writes nothing; M2 is projection-only IF approved).
- Executor/renderer (6B parity frozen).

## 7. Approval

- [x] Owner approves 6D.2 spec with M1 as the first gated milestone (this file). — "Yes — approve M1 exactly as specced." (04:47 UTC)
- [x] Owner approves M1's zero-product-code constraint (evidence pack only; untracked `.drytis/` additions only). — same directive; AC-M1d verified.
- [x] Owner confirms the stop point: report M1 numbers → wait for approval before any M2/M3/M4 work. — M1 reported at the gate; no M2/M3/M4 work was run.
- [x] Owner closes 6D.2 on the M1 findings — "Close 6D.2 based on the M1 findings. No implementation changes. Update the roadmap/spec and prepare the docs/evidence-only closure commit. Do not push." (05:34 UTC)

**Baseline for implementation:** `da5e678` · suite 254/4464 · tsc 8 · dist v10.9.0.
**Closed state:** zero implementation shipped; M2 descope (residual → 6F), M3 close-as-is, M4 Toggle parked (population 0). Evidence: `.drytis/notes/evidence/phase-6d2-m1-2026-08-23/`.
