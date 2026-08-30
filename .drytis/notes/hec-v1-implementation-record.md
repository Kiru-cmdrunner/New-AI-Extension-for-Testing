# HEC v1 implementation — session record (2026-08-30)

## Final state
- Spec `.drytis/specs/hover-capture-evidence-contract-v1.md` (Rev 2.1, decisions locked D1/D2/D3) — implemented, no spec changes needed during build.
- Suite: 368 files / 5254 tests green (was 364/5241 at handover).
- Real-Chrome matrix: `.drytis/hec-v1-real-chrome-matrix.mjs` — 20/20 checks (rows 1, 2, 2b, 3, 3b, 4, 4b, 5, 6, 7, 8, 9, 10, `*`), archives to `.drytis/notes/evidence/hover-evidence-contract-v1/` (4 runs; final 04:54:48 20/20). Rebuild first: `npm run build && node scripts/sw-inline-finalize.mjs`.
- NOT published/deployed (per user instruction). ~86 modified/untracked files on branch capability-surgical-removal.

## Files added (src)
- `src/tap/hover-qualification.ts` — computeHoverQualification (pure, frozen, ≤200-char reason).
- `src/shared/surface-join.ts` — joinsRecordedSurface + ' > ' DOM-path grammar.

## Files changed (src, key deltas)
- `src/tap/event-tap.ts` — mouseenter branch records hoverAnchorKey/hoverClickAnchorKey/hoverAnchorResolution (R-A1/R-A4 writer) via resolveHoverAnchor.
- `src/tap/identity-extractor.ts` — resolveHoverAnchor returns {target, resolution} ('self'|'ancestor-lift'|'reveal-target'|'body'); legacy resolveHoverTarget delegates.
- `src/shared/component-types.ts` — DomContext declares the three anchor fields.
- `src/tap/hover-qualification.ts` — hidden-removal earning FIXED round 2: guard was inverted (`o !== ''` rejected old='hidden'); now `o === '' → reject, n !== '' → reject, else baseline.anchor.hidden === true` → earns. Null-coalescing on delta.old/new (dom-observer records new:null after removal).
- `src/definitions/hover.ts` — terminal 'consumed-by-click'; retainsDiscreteEvents:false.
- `src/runtime/component-runtime.ts:431` — R-C3 unconditional pop for non-retaining definitions.
- `src/presentation/output-adapter.ts` — Hover admission = recorded verdict only (D2 legacy → not admitted); buildEvidenceDisclosures exported.
- `src/sidepanel/interaction-renderer.ts` — 'evidence — …' disclosure line on EVERY card (both views); folded-hover row carries verdict+reason.
- `src/sidepanel/hover-pair-fold.ts` — unmatched consumed hovers keep recorded position (reserved-slot splice).

## Tests added (11 files → 5254 total)
- tests/tap/hover-qualification-verdict.test.ts, hover-baseline-qualification.test.ts (+2 hidden-removal pins), hover-anchor-facts.test.ts (5), hover-collector-anchor-facts.test.ts (seam pin), tests/runtime/hover-click-precedence.test.ts, tests/presentation/hover-admission-verdict.test.ts, hover-reveal-then-click-independence.test.ts, tests/sidepanel/interaction-disclosure.test.ts (3), hover-pair-fold.test.ts (+2).

## Key learnings
1. **Natively-disabled controls dispatch NOTHING in real Chrome** (click/mousedown/mouseenter all platform-suppressed). CQ-invalid fixtures must use aria-disabled (still dispatches; isAriaDisabled records it). The CQ truth-table disabled-native row is unit-fixture-only by necessity.
2. **The 22112-numeric-key storage corruption was a harness-era artifact** (tool-output corruption injecting garbage into eval strings), NOT a product bug. Storage watcher (.drytis/hec-storage-watcher.mjs) proves clean object-literal writes in dist. No string-writer exists in src or dist.
3. **MV3 SW idles ~15s after page load** — drive the extension via its own sidepanel target (panelCmd chrome.runtime.sendMessage), not raw SW evals. Content-verify blocks direct src/sidepanel/index.html; use dist via --load-extension.
4. **dom-observer records attribute REMOVAL as new: null** (getAttribute) — any predicate comparing String(new) must null-coalesce ('' semantics) or the branch is dead. Reviewer caught this by executing computeHoverQualification directly; pin both sides.
5. Matrix row assertions must test the CONTRACT (click on non-Hover card, e.g. carrier=Expander/Link/Click), not literal type==='Click' — generic definitions legitimately claim clicks.

## Reviewer rounds
- Round 1: core mechanics PASS; 3 FAILs (R-A1 unwired, AC-23 unwired, AC-19 unarchived) + WARNs.
- Round 2 (after fixes): all 3 FAILs → PASS; 4 WARNs addressed; surfaced dead hidden-removal branch (fixed + pinned), vacuous AC-23 matrix row (fixed), row-10 predicate (fixed). All coverage-gap pins added.

## Remaining risks (known, accepted)
- RC-B residual: clickAnchorKey is a compensating record; anchors unified at the qualification layer, not at capture resolution (per spec §11 footnote).
- collections/counters disclosures are reserved stubs (always 'not captured') until per-window structured collections are recorded.
- Spec §13 row 11 (11/13 → now 14 rows incl. 3b/4b/`*` in harness; spec matrix rows 11-13 multi-element/page states not in the Chrome harness — unit-pinned only).
