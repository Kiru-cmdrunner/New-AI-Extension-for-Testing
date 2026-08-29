# Spec — Generic Surface-Detection Generification (5a descendant scan + 5b reveal)

- **Status:** DRAFT — awaiting approval. No implementation yet.
- **Date:** 2026-08-18
- **Supersedes:** none. Builds on `.drytis/specs/consequence-settling.md` (shipped as 5982534) and the RCA in `.drytis/notes/surface-evidence-rca-2026-08-18.md`.
- **Baseline:** commit `5982534` + retained uncommitted `sw-integration.ts` shape guard + 3 untouched E1-prep files.

## 1. Problem

Real-world surfaces emerge in two shapes; the current detector recognizes only one:

1. **Insertion** — a new node carrying a surface identity (`role=dialog`, `<dialog>`, …) is added to the DOM. Captured **only when the directly-added node itself** carries the role/tag (`dom-observer.ts:648-693`, `isSignificantSurface` at 699-707). A dialog nested inside plain wrapper div(s) is missed (RCA S3 repro on the shipped ZIP).
2. **Reveal** — a pre-rendered surface (hidden by CSS) is revealed via `style`/`class`/`aria-hidden` change. Produces **no childList mutation at all** → structurally invisible to `detectSurfaceChanges` (RCA S1/S2 repro; matches the manual iPhone test where `display: → block` visibility rows exist but Surface Changes is empty).

Both are meaningful **Application Knowledge** consequences of a user action and must be represented. Downstream stages (collector drain → SW projection → storage → Side Panel) are pass-through and lossless (verified in RCA) — the fix is entirely in the producer.

## 2. Goals

- **5a:** bounded descendant scan — when a `childList` mutation adds a node that is not itself a recognized surface, inspect the added subtree for a descendant carrying an existing `SURFACE_ROLES`/`SURFACE_TAGS` identity; record the matched descendant's identity/path.
- **5b:** reveal detection — when an existing element that **already satisfies the current surface-role/tag definition** undergoes a visibility-related reveal mutation, emit a surface record.
- Represent both kinds of emergence distinctly (`inserted` vs `revealed`).
- Deduplicate wrapper/descendant and insert+reveal double discoveries.

## 3. Non-goals / explicit constraints (inviolate)

- **No product-specific logic:** no Amazon selectors, no text heuristics, no name/subtree-size heuristics.
- **`region` is NOT added** to `SURFACE_ROLES` (or anywhere in the surface model) in this change. Recorded below as a separate future product decision (§15) — it may significantly increase noise.
- **No timing changes:** consequence-settling stays activity/quiescence-based; no new fixed delays; no changes to `adaptive-window.ts`, settle logic, or window lifecycles.
- **Click and Navigation remain separate interactions.** Vivo `page-reload` behavior (`finalizeAtPagehide`, INV-4) unchanged.
- **`src/runtime/sw-integration.ts` untouched** (uncommitted shape guard preserved verbatim).
- **E1-prep files untouched:** `src/understanding/consolidation/knowledge-loader.ts`, `src/understanding/contract/contract-queries.ts`, `src/understanding/contract/knowledge-contract.ts`.
- No API/database/application-state work.
- Removal-path symmetry: descendant scan applies to `removedNodes` too (a wrapper containing a dialog being removed is a surface disappearance), same budget/dedup.

## 4. Current behavior (verified)

- `detectSurfaceChanges` (dom-observer.ts:648-693): for each added/removed `Element`, `isSignificantSurface(node)` checks only the node's own `role`/tag. No descendant inspection, no reveal path.
- Reveal mutations are already *detected as visibility changes* by three functions: `detectVisibilityChange` (hidden/aria-hidden, :713-734), `detectStyleVisibilityChange` (inline display/visibility/opacity, :747-773), `detectClassVisibilityChange` (computed-style diff via `prevComputedStyles` WeakMap, GAP-3). They write only to `visibilityChanges`.
- Accumulation: `surfaceChanges: SurfaceChange[]` drained via `getSurfaceChanges()`, cleared in `clearAccumulated()` (:398-402) — called by the collector at true window boundaries.
- Collector caps: `newSurfaces`/`removedSurfaces` each `slice(0, 50)` (evidence-collector.ts:698-699); DOM 200-cap applies only to `domChanges`. No collector change is needed for this fix.

## 5. Design — 5a descendant scan

In `detectSurfaceChanges`, for an added (or removed) `Element` that is **not itself** significant:

1. Build `SURFACE_SELECTOR` once (module-level constant) from the existing sets:
   `[role="dialog"],[role="alertdialog"],…` ∪ `dialog,details,summary` — derived mechanically from `SURFACE_ROLES`/`SURFACE_TAGS`; the sets remain the single source of truth.
2. Run **one** `node.querySelector(SURFACE_SELECTOR)` (works on detached subtrees for the removal path). First match wins — record the **matched descendant**, not the wrapper:
   `path = getElementPath(matched, shadowContext)`, `tagName`, `ariaRole`, `accessibleName = getAccessibleName(matched)`, `descendantCount = matched.childElementCount`, `kind: 'added' | 'removed'`, `emergence: 'inserted'`, plus batchIndex/relativeTime/shadowContext as today.
3. **Budgets (cost bounds):**
   - `MAX_DESCENDANT_SCANS_PER_BATCH = 32` — per MutationObserver callback, counted across added+removed nodes; once exhausted, remaining non-significant nodes in that batch are skipped (they still get their normal DOM summary + `seedComputedStylesForElement`).
   - Directly-significant nodes never consume scan budget (they are recorded without scanning).
4. **Dedup:** `recordedSurfacePaths: Set<string>` keyed `` `${shadowContext ?? ''}|${path}|${kind}` `` — first discovery wins for the accumulation lifetime (cleared in `clearAccumulated()`). Applied to ALL surface records (direct, descendant, reveal) so wrapper+descendant, and insert-then-reveal in one window, yield one record per element path.

## 6. Design — 5b reveal detection

Add one private helper used by all three visibility detectors:

```
maybeRecordRevealedSurface(el, prop, oldValue, newValue)
```

Called **after** the existing `visibilityChanges.push(...)` in each detector, only when the transition is a **reveal** for that property:

| property | reveal condition (old → new) |
|---|---|
| `display` (style or class-computed) | `none` or `''`(unset-becomes-rendered only via computed path) → value ≠ `none`/`''` |
| `visibility` | `hidden`/`collapse` → `visible` |
| `opacity` | `0` → ≠ `0` |
| `hidden` (attr) | any → removed/null (i.e. un-hidden) |
| `aria-hidden` | `true` → `false`/removed |

Rules:

- Fires **only if `isSignificantSurface(el)`** — the element's own role/tag must already be in the current sets. No new roles.
- Emits `SurfaceChange { kind: 'added', emergence: 'revealed', … }` with the element's own path/identity — "surface became present in the UI", which is the application-knowledge event.
- Hides (reverse transitions) do **not** emit surface records in this change (they already produce visibility rows; `removed`-on-hide is a possible future refinement — recorded in §15, not now, to avoid double-counting debates).
- Dedup via `recordedSurfacePaths` (same key space): an element inserted **and** revealed inside one window records once, as `inserted` (first wins).
- No changes to when detectors run, to noise filtering, or to batching.

## 7. Data model change (additive, backward compatible)

`SurfaceChange` (`src/shared/behavioral-evidence-types.ts:305-322`) gains one optional field:

```ts
/** How the surface emerged. 'inserted' — new DOM node; 'revealed' — pre-existing node became visible. Default/absent = 'inserted' (legacy records). */
emergence?: 'inserted' | 'revealed';
```

- `kind` stays `'added' | 'removed'` — downstream counting (causal-graph, notification-signals, understanding-pipeline, richness scoring in sw-integration) is unaffected.
- Optional side-panel nicety (display-only, additive): in `renderSurfaces` (`src/sidepanel/evidence-renderer.ts:376-405`), append `" · revealed"` to the row label when `emergence === 'revealed'`. No layout/count changes.

## 8. Exact files & functions to change

| File | Change |
|---|---|
| `src/tap/dom-observer.ts` | (1) module const `SURFACE_SELECTOR` derived from `SURFACE_ROLES`/`SURFACE_TAGS`; (2) `MAX_DESCENDANT_SCANS_PER_BATCH = 32`; (3) `detectSurfaceChanges` — descendant scan on non-significant added/removed Elements with budget + dedup, records matched descendant with `emergence:'inserted'`; (4) new private `recordSurface(el, kind, emergence, batchIndex, now, shadowContext)` helper that applies dedup and pushes (refactor of the two existing push blocks); (5) new private `maybeRecordRevealedSurface(el, prop, oldVal, newVal, batchIndex, now, shadowContext)` called from `detectVisibilityChange`, `detectStyleVisibilityChange`, `detectClassVisibilityChange`; (6) `recordedSurfacePaths` Set + clear in `clearAccumulated()`. |
| `src/shared/behavioral-evidence-types.ts` | add optional `emergence` field to `SurfaceChange` (+ doc comment). |
| `src/sidepanel/evidence-renderer.ts` | optional `" · revealed"` label suffix in `renderSurfaces`. |
| `tests/tap/dom-observer.test.ts` | new SD-* unit tests (§10). |
| `tests/tap/surface-reveal.test.ts` (new) | collector-level settle/pagehide/partition tests (§11). |
| `.drytis/notes/evidence/surface-rca-harness.mjs` | extend with S5–S7 reveal scenarios + Vivo nav regression; harness artifact only. |

**Explicitly NOT changed:** `src/runtime/sw-integration.ts`, `src/tap/evidence-collector.ts` (drain/caps already pass surfaces through), `src/tap/adaptive-window.ts`, `src/tap/network-bridge.ts`, the 3 E1-prep files, `manifest.json`, build config.

## 9. Acceptance criteria

- [ ] AC1 Directly-added `role=dialog` still records a surface (`emergence` absent or `'inserted'`) — existing tests stay green unmodified.
- [ ] AC2 Wrapper div containing descendant `role=dialog` records the **descendant's** identity/path.
- [ ] AC3 Wrapper containing a recognized surface **tag** (`<dialog>`, `<details>`, `<summary>`) records the descendant.
- [ ] AC4 Hidden recognized surface revealed via `display:none → block` records surface `emergence:'revealed'` **and** the visibility row.
- [ ] AC5 Same via `aria-hidden:true → false`.
- [ ] AC6 Same via class reveal (computed display `none → block`).
- [ ] AC7 Wrapper+descendant double discovery and insert+reveal-in-one-window produce exactly ONE record per element path (dedup).
- [ ] AC8 Surface arrays remain bounded: collector 50-cap intact; descendant scans per batch ≤ 32; pathological batches (100 wrappers) don't crash or stall (assert total surface records bounded, batch completes).
- [ ] AC9 A consequence-settled window delivers revealed + inserted surfaces intact (`newSurfaces` in delivered evidence, `endReason:'consequence-settled'`).
- [ ] AC10 Vivo shape unchanged: Click window `page-reload` + separate Navigation window `stabilized`; nav evidence only on the Navigation interaction; no new timing.
- [ ] AC11 Real-Chrome (replica of the manual Amazon iPhone flow): delayed causal burst → pre-rendered hidden `role=dialog` revealed + wrapper-inserted dialog both appear in `newSurfaces` with correct `emergence`; `region`-role popover still produces **no** surface record (deferred decision guarded by test).
- [ ] AC12 Real-Chrome Vivo regression: partition and endReasons identical to pre-change baseline.
- [ ] AC13 `tsc` clean; full vitest suite green; no changes to sw-integration.ts / E1-prep files in the diff.

## 10. Red-phase unit tests — `tests/tap/dom-observer.test.ts` (jsdom, existing conventions)

- **SD1** direct `role=dialog` insert → 1 surface, `kind:'added'`, no `emergence`/`'inserted'`. *(regression, green today)*
- **SD2** `div > div[role=dialog]` wrapper insert → 1 surface recorded for the descendant (path ends at the dialog, `ariaRole:'dialog'`).
- **SD3** wrapper containing `<dialog>`/`<details>` descendant → surface with matching tagName.
- **SD4** pre-existing `role=dialog` with `style="display:none"`, then `style.display='block'` → visibility row `display none→block` AND surface `emergence:'revealed'`.
- **SD5** pre-existing `role=alert` `aria-hidden=true → false` → surface `revealed`.
- **SD6** pre-existing `role=menu` hidden by class (`display:none`), reveal class swap → computed-style path fires surface `revealed` (exercises `prevComputedStyles` baseline, incl. P0-2 seeding).
- **SD7 dedup:** (a) outer wrapper `role=dialog` containing inner `role=dialog` → 2 records (distinct paths), no path duplicated; (b) insert + reveal of the same element within one accumulation → exactly 1 record, `inserted`.
- **SD8 budget:** batch adding 100 plain wrappers each containing a `role=dialog` → scans bounded (≤ 32 recorded from scans), no throw; `clearAccumulated()` resets dedup (re-adding same path after clear records again).
- **SD9 removal:** removing a wrapper containing `role=dialog` → surface `kind:'removed'` for the descendant.
- **SD10 negative:** reveal of a `role=region` element → visibility row only, **no** surface record. *(guards the deferred-region decision)*
- **SD11 negative:** hide transitions (`block → none`, `aria-hidden false → true`) → no surface records.

## 11. Integration tests — new `tests/tap/surface-reveal.test.ts` (collector-level, mock chrome runtime, existing settle-test conventions from `consequence-settling.test.ts`)

- **IA1** open click window → reveal `role=dialog` during settle (after FINALIZE_EVIDENCE, before quiescence+causal-idle) → delivered `newSurfaces[0].emergence==='revealed'`, `endReason:'consequence-settled'`.
- **IA2** wrapper+descendant insert during settle → delivered with descendant identity, `emergence:'inserted'`.
- **IA3** 60 surfaces in one window → delivered `newSurfaces.length===50` (cap intact), no overflow side-effects.
- **IA4** Vivo shape: click → submit navigation → pagehide: Click window delivers pre-unload revealed surface with `endReason:'page-reload'`; Navigation window separate (`stabilized`/post-nav path), carries nav evidence; exactly 2 interactions.
- **IA5** overlapping windows (click + submit) share accumulation → dedup prevents duplicate surface records across the shared drain (per-window `clearAccumulated` boundary respected).
- **IA6** `emergence` field absent on legacy-shaped records — collector/projection tolerate both (type-level + runtime).

## 12. Real-Chrome validation (extend `surface-rca-harness.mjs`; shipped-build path unchanged — validation runs on the NEW build)

- **RC-S5** iPhone-flow replica: causal 34-fetch burst → slow `/add` → pre-rendered hidden `role=dialog` popover revealed via inline style → expect `newSurfaces:[{role:'dialog', emergence:'revealed'}]`, visibility row, `consequence-settled`. *(This is the RCA S1 shape with a recognized role — proves 5b end-to-end on the manual-test flow.)*
- **RC-S6** same flow, reveal via class swap → same expectations (computed-style path in real Chrome).
- **RC-S7** same flow, wrapper-inserted descendant dialog after slow fetch → `emergence:'inserted'` surface captured (was RCA S3 FAIL).
- **RC-S1/S2 re-run (controls):** `role=region` popover reveals → still **no** surface record (region deferred), visibility rows still captured.
- **RC-S4 re-run:** direct dialog → still captured.
- **RC-V1** Vivo regression: form-submit nav → Click `page-reload` (2 DOM changes scale), Navigation `stabilized`, separate interactions, no surface on nav window.
- **RC-N** console-error sweep across all scenarios.

## 13. Regression risks & mitigations

- **Scan cost** on huge inserted subtrees → single `querySelector` per node, hard budget 32/batch; budget-exceeded batches are observable (nothing crashes; DOM summaries unaffected).
- **Duplicate/adjacent records** → path-keyed dedup, first-wins, cleared per accumulation boundary.
- **Reveal double-count on repeated toggles** → dedup makes first reveal in a window the only record; subsequent toggles still produce visibility rows.
- **Downstream semantics** — consumers treat surfaces as insertions; `emergence` is additive and `kind` unchanged, so counts behave identically. `notification-signals`/`causal-graph` see at-most-more (never different-shaped) records.
- **Panel count inflation** on churny pages → still bounded by the 50 cap; revealed surfaces only fire for already-recognized roles.

## 14. Rollout / verification order

Red phase (SD+IA failing for the right reasons) → implement dom-observer + types (+renderer nicety) → unit green → full suite + tsc → Infrastructure Gate (light path: no env/service/proxy changes; production services already registered) → reviewer (spec compliance) → real-Chrome RC suite → report. **No commit/push until approved.**

## 15. Deferred decisions (explicitly out of scope, recorded for product)

1. **`role="region"` in the surface model** — Amazon's real attach popover carries it; adding it likely increases noise materially (region is a generic landmark). Needs product call + separate spec.
2. **`kind:'removed'` on hide** (surface disappears when hidden rather than DOM-removed).
3. **Reveal-of-descendant** (recognized surface revealed via a *wrapper's* style change — wrapper visibility inherited). Currently only the surface element's own mutation triggers 5b.
