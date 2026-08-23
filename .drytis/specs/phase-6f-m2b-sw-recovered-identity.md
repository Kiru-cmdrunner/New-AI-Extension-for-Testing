# 6F-M2b — sw-recovered identity seed (F4-D display honesty)

**Status:** SHIPPED — commit 1 `2bff6ed` (src+tests), commit 2 spec+evidence+
roadmap; owner gate 16:54 UTC 2026-08-23; unpushed. All 10 ACs met,
suite 262/4,523 green, tsc 8-baseline, E2E 9/0, M1 regression 9/0, reviewer
PASS (WARN closed), infra PASS. F4-D CLOSED; F4-L parked-no-repro.
**Original approval:** owner-approved 2026-08-23 14:42 UTC
("Proceed with 6F-M2b = F4-D only: first perform the consumer sweep for
`targetEvidence.identity`, then write the spec, TDD pins, implementation,
reviewer/infra verification, and real-Chrome E2E. Keep F4-L parked until a
current reproducible failure exists. No unrelated changes, no push.")
**Baseline:** `29b6256` (branch `capability-surgical-removal`, both remotes).

## §1 Problem

Fast form-submit: the click's content-script evidence window is destroyed by
pagehide before delivery. The SW's durable attribution ledger recovers the
network rows and resolves the owning interaction (two-tier join, G4-B
triple-key) — then `synthesizeMinimalEvidence`
(`src/background/evidence-attribution.ts:204`) builds the thin evidence with
`targetEvidence.identity: null` (:230). The sidepanel identity block
(`src/sidepanel/evidence-renderer.ts:97-107`) reads ONLY that field, so every
sw-recovered-form-submit card renders **"Unknown element"** — even though the
owning interaction's `trigger` (tag/stableId/ariaRole/accessibleName, from
the real captured event) sits on the very object passed into the synthesizer.

User evidence: batches 2026-08-23-0700 / -0724 (AdaniOne) — sw-recovered
cards with "Unknown element"; classified F4 family. This spec is the F4-D
(display honesty) slice. F4-L (arming/active-tab lifecycle) stays PARKED
until a current-build reproducible failure exists — no code in this phase
touches SW lifecycle.

## §2 Consumer sweep (pre-implementation grounding, 2026-08-23)

All readers of `targetEvidence.identity` / `.targetEvidence` across src:

| Consumer | Reads | Impact of non-null identity seed |
|---|---|---|
| `sidepanel/evidence-renderer.ts:97-107` (`renderIdentity`) + :275 | `target.identity` | **The fix's target** — renders real name instead of "Unknown element" |
| `understanding/signal-extractors/target-state-signals.ts:41-46` | `target.identity?.cssSelector / elementId / accessibleName / tag` — guarded by `if (!target \|\| !target.before \|\| !target.after) return []` (:34) | **None** — sw-recovered thin evidence has `before: null`, so the extractor returns `[]` before touching identity |
| `understanding/enrichment/interaction-contract.ts:34-50` | `targetEvidence?.after` only (D9 state fields) | **None** — never reads `.identity`; falls back to `triggerEvent.domContext`, unaffected |
| `runtime/sw-integration.ts` `scoreEvidenceRichness` (:615) | before/after diff fields + application arrays — **identity is not scored** | **None** — seeding identity cannot change replace-if-richer outcomes |
| `runtime/sw-integration.ts` shape-guard (:464-471) | `targetEvidence == null` whole-object check | **None** — the seed makes targetEvidence non-null, which only strengthens the guard's direction (a real target is never replaced by a null one); the seeded object is still "thin" for scoring (before/after null) |
| `background/service-worker.ts:693-698` | `fresh.identity` — 6B entity-refresh path, different object (EntityIdentity refresh), not behavioral evidence | **None** |
| `domain/entities/ui-element.ts:166-198` | `input.identity` — 6B entity ingest from its own payload | **None** |
| `execution/ir-executor-impl.ts:538-545` | `extractResponse.identity` — executor runtime extraction, not stored evidence | **None** |

Only other producer of a `sw-recovered-form-submit`-shaped target block:
`service-worker.ts:1537` — the **synthetic navigation** placeholder, which
legitimately carries a document-level identity (`tag: 'HTML'`,
`ariaRole: 'document'`, href) and is EXCLUDED from being an attach JOIN
target by `isSyntheticNavigation`. Out of scope; unchanged.

**Sweep verdict: two behavioral consumers (renderer = the target,
target-state-signals = fully guarded by before/after null-check). No scorer,
no KR writer, no executor path reads the seeded field. Safe to seed.**

## §3 Design

`ComponentInteraction.trigger` is ALREADY an `ElementIdentity`
(`component-types.ts:287` — it is the captured `event.target` from
`createContext`, carrying accessibleName/ariaRole/tag/className/stableId/
testId/dataAutoId/cssSelector/xPath/…). So the seed is a **guarded clone**,
not a field-mapping:

In `synthesizeMinimalEvidence`, seed `targetEvidence.identity` from
`interaction.trigger` when it carries a real element shape (guard: truthy
`tag` — every real capture has one; typing-safety via the
RawElementIdentity fields). Copy as-is (a shallow clone), including nulls —
no fabrication, no trimming to a subset.

Rules:
1. **No fabrication.** Only what the capture already holds. `before`/`after`
   stay `null` (honest — no state was observed). `endReason`,
   `stabilityTrace`, `durationMs`, network synthesis, INV-4/INV-7 semantics,
   richness-0 classification, and replace-if-richer monotonicity UNCHANGED.
2. Shape-less triggers (no `tag` — e.g. a synthetic/document-level trigger)
   keep `identity: null` — honesty over fabrication ("Unknown element"
   remains for genuinely unknown elements).
3. Idempotence preserved: existing evidence returned untouched (:208).
4. `identityCapturedAt` stays `0` (no new measurement; the window is
   synthetic).

## §4 Acceptance criteria — ALL MET (owner gate 2026-08-23)

- [x] AC-1: `synthesizeMinimalEvidence` on an element-trigger click seeds
  identity — `tag`, `stableId`, `ariaRole`, `accessibleName` copied from
  `trigger`; before/after remain null. (unit pin + E2E C3/C4/C5)
- [x] AC-2: rich `attributes` map through (className, inputType, testId,
  dataQa, dataCy, href); absent attributes stay null. (unit pin; href copied
  via whole-object clone — reviewer note, no risk)
- [x] AC-3: non-element trigger (missing shape) keeps `identity: null` — no
  invention. (unit pin)
- [x] AC-4: interaction that already HAS behavioralEvidence returns it
  unchanged (idempotence pin, existing behavior). (unit pin)
- [x] AC-5: copy-as-is honesty — empty-string `elementId` is copied verbatim,
  never trimmed/normalized and never promoted to a stableId invention; an
  already-normalized null `elementId` stays null. (unit pin added after
  reviewer WARN; the spec's original wording — "'' → stableId: null" — was
  MIS-SPECIFIED: normalization is capture-side authority, the seed must not
  re-normalize; pinned honestly instead)
- [x] AC-6: renderer renders the seeded identity — "INPUT #add-to-cart-button
  [role=button] "Add to cart"" instead of "Unknown element" (unit pin via
  exported `renderIdentity`; "Unknown element" retained for genuinely null
  identity — honesty preserved).
- [x] AC-7: consumer-regression pins — `TargetStateSignalExtractor.extract`
  on a seeded thin evidence returns `[]` (before/after null guard) and
  `extractInteractionContract` state fields remain domContext-fallback. (pins)
- [x] AC-8: full suite green — 262 files / 4,523 tests; tsc exactly the 8
  pre-existing baseline errors (all in tests/).
- [x] AC-9: real-Chrome E2E — 9 PASS / 0 FAIL (run-15): recovered Click card
  carries SEEDED identity (BUTTON / add-to-cart-button / "Add to cart"),
  endReason `sw-recovered-form-submit`, netRows=1, zero null-identity
  sw-recovered cards. 6F-M1 regression on the same build: 9 PASS / 0 FAIL
  (5 cards / 5 IR steps, zero twin clicks). Harness required a renderer-crash
  injection design (conjunction trigger + 6× CPU throttle) — see evidence
  PROVENANCE.md runs 1–15.
- [x] AC-10: reviewer PASS (single AC-5 WARN closed by the added pin; narrow
  re-review PASS) + infra_verifier PASS (0 failures); ZIP rebuilt with the
  fix (md5 8bef2ca95740052a52ddb5c4cbc8082e; seeded-identity marker
  `Vd(t.trigger) ? { ...t.trigger } : null` verified in
  service-worker-inline.js).

## §5 Verification path

1. TDD: extend `tests/unit/background/evidence-attribution.test.ts` with a
   6F-M2b block (AC-1..5, 7) + a renderer unit pin (AC-6) near the existing
   renderer tests.
2. Full suite + tsc-8.
3. Build → ZIP repack (remember: `procmgr restart service-bg-service-3591`
   so `serve/` re-mirrors — 6F-M2a note).
4. Reviewer + infra_verifier.
5. Real-Chrome E2E: m9 fast-form-submit script (panel-driven, like the m2
   harness) asserting the recovered card identity; then the m2 harness
   regression re-run.
6. Stop at owner gate. No push.

## §6 Doctrine

Honesty over fabrication: the seed copies real captured data only; no field
is invented, no snapshot faked. Skip ≠ loss stays true — a non-element
trigger honestly renders "Unknown element". Evidence-gated: user batches
0700/0724 are the repro evidence; E2E closes the loop. F4-L untouched.
