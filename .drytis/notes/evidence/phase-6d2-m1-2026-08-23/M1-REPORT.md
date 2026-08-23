# M1 Evidence Report — 6D.2 Phase Gate (2026-08-23)

**Baseline:** `da5e678` dist (v10.9.0, rebuilt fresh at 6D.1 closure; dist manifest 22:45/03:04, all markers verified at commit gate). Real Chrome 148 headless, CDP trusted input, extension loaded from `/workspace/dist`.
**Method note:** zero product-code changes; all artifacts under `.drytis/notes/evidence/phase-6d2-m1-2026-08-23/`. Suite/tsc untouched (expected baseline 254/4464 green, tsc 8 — no code touched, no re-run needed for M1 evidence; sanity hold).

---

## M1-A — O11 nested-target reproduction — **VERDICT: NOT-REPRODUCED (canonical shape); residual twin exists only for cross-target drags**

Harness: `harness-o11.mjs` + `app-o11.mjs` (final run `o11-repro-FINAL.log` — 14 PASS / 0 FAIL, exit 0; ledger + cards at `dumps/o11-storage.json`, `dumps/o11-cards.json`).

| Shape | Fixture | Observed at `da5e678` | Twin orphan? |
|---|---|---|---|
| Canonical AdaniOne int-47/48: nameless child span inside `LI[role=listitem]` "Round Trip" | `#wrap-nested` | Both mousedown and click resolve to the **same LI** (`resolveTarget` promotes nameless children to the named ancestor) → identical elementKey → **S1' pairs them** → exactly **ONE** Unclassified card, `phys: "click"`, `paired: true` | **NO** |
| Button-wrapped child icon (`<button><i class="icon-star">`) | `#btn-nested` | Child promoted → single claimed **Click** | NO |
| Target-asymmetry: named child `role=button` "Star" **removed mid-press** | `#wrap-swap` | Chrome dispatches **no click at all** (press/release resolved to different elements) → exactly ONE honest orphan mousedown card | NO (browser never emits the twin) |
| Cross-target press: down on `#pill-a`, up on `#pill-b` | `#cross-row` | Chrome synthesizes the click on the **common ancestor** → **TWO unpaired cards** (mousedown@pill-a + click@cross-row) | **YES — residual twin** |
| Flat / siblings controls | `#btn-flat`, `#sib-a/b` | 1 Click each; siblings 2 Clicks; IR 4 steps, zero Unclassified leak (NOISE_TYPES intact) | NO |

**Key structural insight:** the O11 as originally observed (every logical click = mousedown card + click card pair) was already solved at the capture resolution layer — `resolveTarget` promotes nameless children to the named ancestor, so both physical events of a canonical press resolve to the same target and S1' pairs them. The only shape that still yields twins is a **cross-target drag** (down on A, up on B, click lands on common ancestor) — arguably *honest* display for a drag-shaped gesture, and IR is unaffected either way.

**M2 go/no-go recommendation: NO-GO (descope from 6D.2).** The fix as specced (containment-based pairing for nested-target presses) has no canonical case to fix. The residual cross-drag twin is a display question (is two cards right for a drag?), belongs with 6F display hygiene, and M2's projection-only guard rails would add risk for no measured benefit.

## M1-B — aria-pressed / role=switch / data-state census — **VERDICT: NO uncovered toggle population on any surface**

Runner: `census-run.mjs` + `census-lib.mjs` (raw tables at `dumps/census.json`; run log `census-run.log`).

| Surface | Interactive (all/visible) | aria-pressed (any) | role=switch | role=checkbox/native | data-state non-form | chip-class family | **Uncovered toggle-shaped** |
|---|---|---|---|---|---|---|---|
| AdaniOne clone (archived app, in-container) | 9 / 9 | **0** | 0 | 0 | 0 | 1 | **0** |
| 6D.1 generic app | 5 / 5 | **0** | 0 | 0 | 0 | 0 | **0** |
| Avis Ford **LIVE** (https://www.avisford.com/, egress OK) | 249 / 76 visible | **0** | 0 | 0 | 0 | 11 (class-family only — `chip`/`toggle`/`pill`/`badge` tokens in class names; all are Link/Click/other classified) | **0** |
| Amazon (G5 archived census, live blocked from container) | — | not recorded in G5 | role=checkbox **0**, menuitemcheckbox **0**, details/summary **0** | — | not recorded | — | **0 recorded** (aria-pressed unmeasured live) |

Classification breakdowns (current-engine rules): Avis = 196 Link / 36 Click / 4 Dropdown / 2 TextEntry / 11 other; clone = 3 Link / 2 Click / 4 other; 6D.1 app = 1 Dropdown / 1 Click / 3 other.

**M4 go/no-go recommendation: NO-GO (keep Toggle parked).** The census the owner asked for returned **zero** uncovered toggle-shaped interactive elements on every measurable surface. The Toggle definition has no population to serve. Note for honesty: Amazon live aria-pressed counts remain unmeasured (container blocked; G5 tables predate the question and recorded role=checkbox=0/menuitemcheckbox=0/details=0 only). If the owner wants live Amazon numbers, that requires the user-supplied evidence loop (saved HTML or live session), which is the standing process for blocked sites.

## M1-C — Extended P3 popup-token re-probe — **VERDICT: anchoring is irreducibly over-matching; defer decision**

Harness: `p3-extended-reprobe.mjs` (table at `dumps/p3-extended-table.json`; log `p3-extended-reprobe.log`). Shipped regex extracted live from dist: `/(listbox|dropdown|popover|overlay|modal|dialog|flyout|menu|popup|suggestion|autocomplete|typeahead|options-list|MuiDialog|ant-modal|p-dialog)/i` (confirms W3 tokens shipped).

32-case corpus (14 archived P3 + 18 extended real-world shapes):

| Regex variant | Correct | Over-matches | Misses |
|---|---|---|---|
| Shipped (unanchored) | 18/32 | **14** | 0 |
| Anchored `(…)([-_]|$)` — no popup | 25/32 | 0 | **7** (traveler-popup, popup, popup-menu-toggle, suggestion-list, options-list, MuiDialog ModalDialog, "menu popup") |
| Anchored + popup w/ boundary | 20/32 | 0 | 12 |
| Kitchen-sink anchored (all tokens incl. W3, `([-_]|$)` + `^popup$`) | 12/21 | 9 | 0 |

**Irreducibility finding:** any variant that retains the `popup` token over-matches `popup-banner`/`popup-footer`/`cookie-popup` shapes; dropping `popup` misses the true `traveler-popup`/`popup` positives. There is **no structural (class-token) boundary** separating them — the 2026-08-21 P3 verdict ("anchoring cannot separate traveler-popup from popup-banner") is confirmed on the extended corpus. Also material: anchoring without popup would break the 6D.1 W3 positives (`suggestion-list`, `options-list` — suffix form, no boundary after the token).

**M3 go/no-go recommendation: DEFER / CLOSE-AS-IS.** The shipped over-match is bounded (worst case = noisier card) and honest; the anchored alternatives are strictly worse on this corpus (misses on true 6D.1 surfaces). Recommend: keep shipped regex, record the irreducibility finding in the roadmap, revisit only if a 6F display-hygiene pass introduces whitelist/anchor knobs for surface *naming* (display), not gating.

---

## Summary — M1 gate outcomes

| Milestone | M1 verdict | Recommendation |
|---|---|---|
| M2 O11 nested-target pairing | Canonical orphan **NOT-REPRODUCED** — solved by resolveTarget + S1' | **NO-GO** — descope from 6D.2; cross-drag residual → 6F display backlog |
| M3 popup-token anchoring | Irreducible over-match; anchored variants lose 6D.1 positives | **CLOSE-AS-IS** — keep shipped regex; record finding |
| M4 Toggle/filter-chip | **Zero** uncovered toggle-shaped elements on all three census surfaces | **NO-GO** — Toggle stays parked (M4 evidence requirement not met) |

**Net 6D.2 position after M1:** no implementation milestone survives the evidence gate. 6D.2's implementation scope collapses to zero under the current data; the honest next step is a roadmap update recording the three verdicts (O11 solved-by-existing-layers; popup anchoring irreducible-by-design; Toggle population = 0) and closing 6D.2, OR the owner may direct a different disposition (e.g., fold the cross-drag display question into 6F; commission the user-loop Amazon aria-pressed census before final Toggle parking).
