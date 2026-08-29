# Phase 6D.0 — Normalize Semantic Surface Vocabulary

**Status:** Approved by user 2026-08-21. Do not commit until validation is reviewed.
**Parent RCA:** `card-rca-int47-53-54-2026-08-21.md` (int-47 LP1 dead role branch) and
`arch-rca-3-batches-2026-08-21.md` (Phase 6D.0 entry).
**Baseline:** b31d6c2, 220 files / 4,061 tests green.

## Goal

Align the semantic surface detection vocabulary used by Dialog enrichment (LP2,
component-detector `DIALOG_RE`) and LP1 open-selection click recognition
(`isInsideOpenSelectionSurface`), and make the role-based branch of LP1 (and its three
sibling comparisons) effective against the real capture format.

## Problem (verified)

1. **Format mismatch — role branches are dead code.** Both producers
   (`dom-context-extractor.ts:95-113`, `deterministic-recorder.ts:1058-1075`) emit
   `tag[role=x]` (e.g. `div[role=dialog]`). Four consumers compare against bare tokens:
   - `patterns.ts:185` — `OPEN_SELECTION_SURFACE_ROLES.has(r)` (Set: listbox/menu/grid/dialog)
   - `dropdown.ts:171` — `ancestorRoles.includes(ctx.data.surfaceRole)` (surfaceRole = `'listbox'`)
   - `component-runtime.ts:126` — `lifecycleOwnsTarget` Part 2, `.includes(surfaceRole)` (`'listbox'`/`'grid'`)
   - `hover.ts:253-254` — `OVERLAY_TRIGGER_ROLES.has(r)` (menuitem*/tooltip/tab)
   Existing tests pass only because fixtures hand-feed bare tokens — real captured data
   never matches. This is why int-47 ("Premium Economy", click inside role=dialog
   ancestor) stayed Unclassified.

2. **Vocabulary mismatch.** `DIALOG_RE` (component-detector.ts:57) tokens:
   modal, MuiDialog, ant-modal, p-dialog, dialog, popup, overlay.
   `OPEN_SELECTION_SURFACE_CLASS_RE` (patterns.ts:170) = listbox|dropdown|popover|
   overlay|modal|dialog|flyout|menu — genuinely missing only `popup` (the framework
   tokens are substring-covered by `dialog`/`modal`). A `popup`-class ancestor
   enriches as Dialog but does not qualify a Click.

## Design decision

Normalize **at the comparison boundary**, not the producer:
- Producer format `tag[role=x]` is information-preserving (tag + role), pinned by
  milestone-6-1 tests, and feeds knowledge-repo signatures — changing it would make
  chains ambiguous (`'dialog'` = native tag or role?) and drift persisted knowledge.
- One canonical helper in `patterns.ts` parses `tag[role=x]` entries to their semantic
  role token(s) while preserving bare entries (keeps native-tag surfaces like
  `<dialog>` matching, as they do today). All four consumers use it.
- Ledger, Projection, IR generation, NOISE_TYPES: zero behavioral change (pass-through
  of unchanged arrays).

## Changes

1. `src/definitions/patterns.ts`
   - Export `extractSemanticRoles(ancestorRoles: readonly string[]): string[]` —
     for each entry: `tag[role=r]` → each whitespace token of `r`; bare entry → kept
     as-is. Case-sensitive (ARIA roles are lowercase; existing pin).
   - `isInsideOpenSelectionSurface`: test Set membership against
     `extractSemanticRoles(ancestorRoles)` instead of raw entries.
   - `OPEN_SELECTION_SURFACE_CLASS_RE`: add `popup` token (+ explicit framework tokens
     for documented parity with DIALOG_RE; substring-redundant, cost-free). Cross-ref
     comment to component-detector.ts DIALOG_RE.
2. `src/definitions/dropdown.ts:170-171` — containment proof (b) uses
   `extractSemanticRoles(...).includes(surfaceRole)`.
3. `src/runtime/component-runtime.ts:126` — `lifecycleOwnsTarget` Part 2 uses the
   helper.
4. `src/definitions/hover.ts:253-254` — overlay-role dwell check uses the helper.
5. No changes to: evidence-ledger.ts, projection-engine.ts, ir-bridge.ts,
   NOISE_TYPES, isInteractiveElement (LP1 must not widen it), click.ts structure.

## Constraints (from user)

- Generic fix only; no AdaniOne-specific rules.
- Do not modify Evidence Ledger, Projection Engine, IR generation, NOISE_TYPES.
- Preserve deterministic structural detection; no timing-based rules.
- No commit until validation is reviewed.

## Acceptance criteria

- [x] `extractSemanticRoles(['div[role=dialog]','ul','li[role=option]'])` →
      contains 'dialog' and 'option'; bare 'ul' preserved; `[]` → `[]`.
- [x] Multi-token role (`div[role=button menuitem]`) yields both tokens.
- [x] Case-sensitive: `div[role=Dialog]` does NOT match the surface role set.
- [x] LP1 real-format pin: `isInsideOpenSelectionSurface(['div[role=dialog]'], [])` → true.
- [x] LP1 negative pins still hold: `['main','navigation','form']` → false; `[]`,`[]` → false;
      `['Dialog']` → false; `['div','span']` → false.
- [x] click.detectTrigger integration pin (int-47 regression): bare non-interactive DIV,
      `ancestorRoles: ['div','div[role=dialog]']` → `{ type: 'Click' }`.
- [x] Vocabulary pin: `isInsideOpenSelectionSurface([], ['traveler-popup'])` → true;
      `(['MuiDialog-root'])` → true; `(['row','container','flex'])` → false (unchanged).
- [x] Dropdown containment proof (b): option click with ancestorRoles
      `['div[role=listbox]']` + `ctx.data.surfaceRole='listbox'` → completes with
      selectionConfirmed ABSENT (undefined) on confirmed completion per RCA2 contract — marker is only set to false on abandoned; pinned at tests/runtime/structural-fixes-rca2.test.ts:481-492 (was parked before).
- [x] lifecycleOwnsTarget Part 2: child role + ancestor `div[role=grid]` +
      surfaceRole 'grid' → owns (true).
- [x] Hover overlay role: ancestor `div[role=tooltip]` contributes overlay evidence
      (same dwell path as before, now reachable with real format).
- [x] Full unit suite green (expect 4,061+ new pins).
- [x] Validation matrix re-run green: PaxAndClass 17/17 (superset of spec's 15), clone-audit canonical 29 PASS/0 FAIL (30 check() calls; legacy audit harness 21/1 where the 1 FAIL is the pre-existing cart-counter evolution heuristic, proven at clean b31d6c2 via stash-test baseline-gate.log), a-slice 35/35,
      R3 43/43, Amazon 8/8, ZIP-E2E dialog Fix A 5/5.
- [x] No behavior change pin: native bare-tag entries still match the role set
      (no regression for `<dialog>`/`<menu>` native elements).
- [x] tsc: 0 net-new errors (baseline has 6 pre-existing).

## Out of scope

- Producer format change / milestone-6-1 pin updates.
- New surface roles (tree/tooltip in LP1), anchoring (\b) changes to the class RE.
- Filter-chip / flight-card definitions (Phase 6D proper).
- Live-site verification (Akamai-blocked; next user manual run confirms int-47-class
  promotion — offline proof is the real-format integration pins above).
