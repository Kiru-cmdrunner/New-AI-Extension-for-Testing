# RCA — Vivo Click (page-reload) missing VISIBILITY CHANGES (ZIP 5982534plus-surface5a5b)

Date: 2026-08-19. Read-only. Manual screenshots (userDocs image_617f6090/7f653b9b/adc86321) +
jsdom repro with the CURRENT unmodified dom-observer.ts (bundled via esbuild, /tmp/vis-rca.mjs).

## Observation
Vivo ATC Click window: `527ms · page-reload`, DOM CHANGES (2) — `attributes · <input> ·
aria-expanded: false → true` and `attributes · <span> · class: a-button a-spaci…` (AUI
`a-button-load`/`a-button-disabled` spinner swap) — NETWORK (11). **VISIBILITY CHANGES absent.**
User perceives a visible spinner/loading state. iPhone ATC Click (2828ms · consequence-settled)
has VISIBILITY CHANGES (5) + surfaces — same recorder, same page family.

## Trace (browser → storage → panel)
1. **Browser mutation**: Vivo ATC = form-submit navigation. Before unload the ONLY mutations are
   the input's `aria-expanded` attr and the button span's `class` attr. AUI spinner classes
   render via ::after pseudo-element/padding/cursor — they do NOT change computed
   display/visibility/opacity of any element.
2. **MutationObserver → accumulation**: both attribute records ARE delivered and accumulated —
   proven by the screenshot's own DOM CHANGES (2) rows (summaries for span + input). Repro V1
   confirms: 0 visibilityChanges, exactly those 2 dom summaries.
3. **Visibility detection** (THE GAP): `detectClassVisibilityChange` (dom-observer.ts:1004-1049)
   emits a row ONLY when computed display/visibility/opacity differs from the seeded
   `prevComputedStyles` baseline. Baseline seeding works (repro V2: a class that flips
   display:none→block IS captured as `display:none→block`). With AUI classes nothing differs →
   zero rows. **The visibility evidence is never produced — there is nothing to lose downstream.**
4. **pagehide/INV-4**: `onPageHide` → `finalizeAtPagehide` (action window) → synchronous
   `executeFinalization` drains ALL accumulated arrays (0 visibility) and delivers. Repro V3
   shows even a display flip delivered as a single style record still produces rows — no loss at
   unload for anything already recorded. The 2 DOM rows in the screenshot prove delivery worked.
5. **Storage/SW/projection**: pass-through (`cmdrunner_live_interactions` → renderer).
6. **Side Panel**: `renderVisibilityChanges` returns null on empty array (same pattern as
   renderSurfaces, evidence-renderer.ts:415-418) — section hidden because array is empty.

iPhone contrast (repro V4): attach sidecart reveal happens 400-900ms AFTER click on pre-rendered
elements via inline style/class that genuinely flips computed display — window stays open
(consequence-settling), seeded baseline + later reveal → 5 rows. Vivo's source page never changes
a tracked computed property before unload.

## Verdict
**Expected-by-current-model producer gap, NOT a pipeline loss.** Category: never-detected (the
visible loading state is not representable — the model only records computed
display/visibility/opacity diffs and hidden/aria-hidden attrs). No regression from
consequence-settling or 5a/5b; Vivo page-reload path and Click/Navigation partition intact.

## Smallest generic fix (NOT implemented — product decision)
Extend the visibility model with an explicit *class-state* row for action-target subtrees:
on `class` mutation inside the click target's wrapper/button subtree, push
VisibilityChange { property:'class', oldValue, newValue } (additive union member + renderer
format). Generic (any framework's loading/disabled/active classes), bounded to the target
subtree (no page-wide class noise). Alternatives: also treat `disabled`/`aria-busy` attr as
visibility-adjacent state. Risks: union widen touches behavioral-evidence-types.ts (E1-prep
files stay untouched — they don't read VisibilityChange), renderer format for class values,
test churn. Tests: unit (class swap on target emits class row; non-target class churn doesn't),
integration (Vivo shape page-reload delivers row), real-Chrome Vivo regression.

## Manual-ZIP bonus confirmations (image_adc86321)
5a/5b visibly working in manual test: NEW SURFACES (2) `role=alert` "An error occurred…" +
`role=status` "Moved to Saved for later", REMOVED SURFACES (1) — wrapper/descendant inserts
captured; `region` popover still visibility-only (deferred decision holds).
