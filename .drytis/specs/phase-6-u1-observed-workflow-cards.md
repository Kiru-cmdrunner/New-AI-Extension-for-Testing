# MS-U1 — Observed Workflow Card Upgrades

Status: APPROVED FOR IMPLEMENTATION (owner approved 2026-08-22 04:11 UTC)
Base: capability-surgical-removal @ 64296a1
Design parent: .drytis/notes/app-understanding-panel-design-2026-08-22.md (Surface 1)
Availability basis: .drytis/notes/u1-u5-availability-mapping-2026-08-22.md
Type: **renderer-only** side-panel change.

## 0. Owner constraints (binding)

- Renderer-only. **No schema changes, no capture changes, no projection changes, no IR changes.**
- No writes to any storage from the renderer. No writes to the KR. Reads allowed.
- Deterministic-first AI-last: no AI narration, no randomness, no invented explanations.
- Honesty: when data is absent, the element is absent — never a blank claim, never fabricated.
- Skip≠loss: suppressed interactions become show-and-mark, not deleted.
- No behavioral timing logic. (Display of already-recorded durations/counts is fine; a
  ~150ms UI debounce for async chip attach is display pacing, not behavior.)
- Full verification path (first build of this milestone family): infrastructure gate
  incl. infra_verifier + reviewer + real-Chrome tester.
- Owner gate before commit. Dist rebuild + fresh ZIP after owner approval.

## 1. Goal

Each Observed Workflow card answers at a glance:
1. What happened? — type badge for all 18 types, member-event count + span, endState chip
   for every state, evidence-count footer.
2. Why did the engine classify it this way? — understanding badge + why-block (recorded
   facts only).
3. How strong is the link to learned knowledge / generated tests? — KR linkage chip,
   assertion chip.
4. What was suppressed and why — show-hidden toggle (stopped view).

## 2. Data sources (verified @ 64296a1)

| UI element | Source | Citation |
|---|---|---|
| 18 type badges | `InteractionType` union (Click…CompoundInteraction) | component-types.ts:200-218 |
| endState chips | `ComponentInteraction.endState` | component-types.ts:241, 435-483 |
| member chip | `memberEvents[]`, `startTime`, `endTime` | component-types.ts:435-483 |
| understanding badge | `componentType`; Unclassified metadata `recognized`, `reason`, `physicalEvents`, `pairedAtProjection` | projection-engine.ts:152-171 |
| why-block facts | Hover `evidenceReason`; Dropdown `provisionalSelection`/`selectionConfirmed`; DatePicker semantic child roles | hover.ts:207, dropdown.ts:270-280, date-picker.ts:183-195 |
| definition priorities | `priority:` values in the 16 definition files (drag-drop 5 … click 180) | src/definitions/*.ts (verified this session) |
| assertion chip | ExecutionIRPlan.steps[].target.elementId join vs `trigger.elementId` | architecture-types.ts:282; ir-bridge.ts:565/587 |
| KR linkage chip | knowledgeEpisodes.members[].interactionId → signatureKey → knowledgeSignatures.occurrenceCount/firstSeenAtSession/status | knowledge-types.ts (EpisodeRow, ActionSignatureRow) |
| show-hidden toggle | production filter predicate (mirror of current logic) | interaction-renderer.ts:370-399 |

**Not available — must NOT be fabricated:** which definitions were evaluated and rejected
(definition-evaluation decision trace) — engine-side, deferred to U6 (7.3 era). The panel
never invents it.

## 3. Design decisions (resolved at spec time)

D1 **Definition priorities render from a frozen map** keyed by interaction type, pinned by a
test that parses the 16 definition files and fails if the map drifts. Rationale: priorities
are properties of definition files, stable and deterministic; reading them live would need a
registry export (engine-adjacent). The pin makes drift explicit and reviewed.

D2 **Why-block derives from EXISTING metadata keys only** (evidenceReason,
provisionalSelection/selectionConfirmed, DatePicker child-role facts). A dialog-surface
why-line for 6D.0-promoted clicks requires a definition to WRITE a new metadata token —
that is an engine change → out of scope, deferred to U6. Dialog-contained clicks render the
normal `✓ Click (prio 180)` badge, exactly as today.

D3 **Show-hidden toggle applies to the STOPPED view only.** The live recording timeline
keeps the production filter (live signal density; existing owner-approved pattern). The
stopped view is the honest archive.

D4 **KR chip is presence-optional with honest absence.** The panel opens the existing
cmdrunner_knowledge Dexie DB read-only through a thin injectable wrapper
(`setKrLookup(fn)` module DI point for tests). Any failure (DB absent, unreadable, throw) →
no chip, no error surfaced. Bundle note: sidepanel imports the knowledge-database module
(read-only usage); INV-GEN-8/10 forbid generation→understanding imports — nothing forbids
sidepanel reads. Accepted, flagged for reviewer.

D5 **One bulk read per render batch**: fetch this session's episodes once, build
Map<interactionId, signatureKey>, then one signatures bulk read → chips. NEVER per-card
queries. Async attach after cards render (debounce ~150ms, display pacing only).

D6 **Chips live in a dedicated `.interaction-chips` row** between the badge row and the
title. Evidence block stays untouched at the bottom of the card.

D7 **`renderProductionInteractions(container, interactions, options?)`** — options is an
optional third parameter `{ showHidden?: boolean }`. Default call sites unchanged,
byte-for-byte behavior preserved.

D8 **Suppression chips** (abandoned / no-op / 0px scroll / not meaningful) render ONLY on
cards that are suppressed — completed production cards get no suppression chip.

## 4. File plan

| File | Change | Renderer-only |
|---|---|---|
| src/sidepanel/interaction-renderer.ts | TYPE_DISPLAY +4 (ColorInput 🎨, DragDrop ↔️, KeyboardShortcut ⌨️, CompoundInteraction 🧩); endState chip always; chips row; why-block; evidence footer; showHidden option + suppression chips | ✅ |
| src/sidepanel/understanding-badge.ts (NEW) | pure `buildUnderstandingBadge(interaction, priorityMap)` → {text, tone} \| null | ✅ |
| src/sidepanel/evidence-footer.ts (NEW) | pure `buildEvidenceFooter(bev)` → counts string \| null | ✅ |
| src/sidepanel/kr-chip.ts (NEW) | injectable lookup + bulk-join helpers, async chip attach | ✅ |
| src/sidepanel/index.html | toggle row under Observed Workflow header (stopped view), hidden when 0 suppressed | ✅ |
| src/sidepanel/styles.css | chips, tones, toggle row | ✅ |
| src/sidepanel/sidepanel.ts | wire toggle (stopped view), KR lookup injection + attach | ✅ |
| tests/sidepanel/interaction-card-u1.test.ts (NEW) | P1–P3, P7 series | ✅ |
| tests/sidepanel/understanding-badge.test.ts (NEW) | P4 series + priority pin (parses definition files) | ✅ |
| tests/sidepanel/evidence-footer.test.ts (NEW) | P6 series | ✅ |
| tests/sidepanel/kr-chip.test.ts (NEW) | P8 series + no-write spy | ✅ |

**Files NOT touched (explicit confirmation):** evidence-ledger, projection-engine,
component-runtime, all 16 definitions, ir-bridge, assertion-derivation,
assertion-renderer, event-tap, evidence-collector, dom-observer, network-drain,
post-nav-capture, sw-integration, service-worker, storage-service, knowledge-database
schema, understanding-pipeline, understanding-result entity, repository page, ir-types.
No storage key, Dexie table/version, or wire type changes. No env/service/proxy/deps/
setup-script changes.

## 5. Test strategy (TDD — pins red before implementation)

- **P1 type badges**: each of the 18 InteractionType values renders a badge with a real
  entry (ColorInput/DragDrop/KeyboardShortcut/CompoundInteraction asserted explicitly);
  'Unknown' remains only as defensive fallback for unmapped future values.
- **P2 endState always**: completed → green chip; abandoned/interrupted/discarded →
  amber/gray; every card carries exactly one endState chip.
- **P3 member chip**: 3 memberEvents + span 412ms → `3 events · 412ms`; singular
  `1 event`; absent when memberEvents missing.
- **P4 understanding badge**: recognized → `✓ DatePicker (prio 10)`; Unclassified with
  reason `unclaimed-at-projection` → `❓ Unclassified — unclaimed-at-projection`; paired
  physicalEvents (2+) → `⚠ projected (mousedown+click paired)` line.
- **P4b honesty**: no reason metadata → badge contains `reason not recorded`, never blank.
- **P4c priority pin**: frozen map matches the 16 definition files parsed from source
  (fails on drift).
- **P5 why-block**: Hover evidenceReason rendered; Dropdown `provisional: low → final: high`
  style trace from provisionalSelection/selectionConfirmed; DatePicker `detected via
  gridcell children`. No dialog-surface line (D2).
- **P6 evidence footer**: `7 dom changes · 2 network · 1 new surface` from
  ApplicationEvidence; `+N dropped` suffix from domChangeOverflow; absent when no evidence.
- **P7 show-hidden**: mixed fixture [completed TextEntry, abandoned Click, no-op Dropdown,
  0px Scroll, meaningful Hover]: showHidden=true → 5 cards, suppression chips on the two
  suppressed; false → 3 cards; toggle row text `Show all 5 (2 hidden)`.
- **P7b default regression pin**: default call → same badge-set + titles + evidence-section
  headers as the classic 3-card fixture (multipattern evidence dumps).
- **P7c**: toggle row hidden when 0 suppressed.
- **P8 KR chip**: lookup result {occurrenceCount:5, firstSeenAtSession:'s-1', status:active}
  → `◆ reinforced ×5 · first seen s-1`; first occurrence → `◆ new signature`; lookup
  failure/absent → no chip. Bulk-join helper: one episodes read + one signatures read for
  the batch (spy counts).
- **P8b async attach**: chips attach after initial render without blocking it.
- **P9 no-write pin**: during render + chip attach with spied chrome.storage.local.set and
  Dexie table.put → zero calls. Reads allowed.
- **P10 string pin**: exact suppression/toggle/why-line strings pinned (deterministic).
- **P11 presence guards**: any chip whose data is absent renders nothing (incl. minimal
  Unclassified cards).

## 6. Acceptance criteria

- [ ] A1 18/18 type badges render distinct icon+label; four former `❓ Unknown` types fixed.
- [ ] A2 every card shows one endState chip, color-coded by state.
- [ ] A3 member chip on cards with memberEvents; absent otherwise.
- [ ] A4 understanding badge on every card (recognized / Unclassified+reason / projected),
      honest `reason not recorded` fallback.
- [ ] A5 why-block renders recorded facts only (Hover/Dropdown/DatePicker); no fabricated
      dialog token.
- [ ] A6 evidence footer counts; absent when no evidence.
- [ ] A7 KR chip async, read-only, bulk-joined, injectable; honest absence on failure.
- [ ] A8 assertion chip: `N assertions` joined via IRStep elementId; absent when 0 or no plan.
- [ ] A9 chips in dedicated row; evidence block placement unchanged.
- [ ] A10 show-hidden toggle: stopped view only; view-only (no persistence change); default
      output identical to pre-MS-U1.
- [ ] A11 no regression on classic fixtures (P7b) + full existing suite green.
- [ ] A12 all new strings deterministic; no timing behavior; no site tokens; no engine-file
      edits (git diff scope = renderer + tests only).

## 7. Real-Chrome validation expectations (tester / harness)

Stopped view, multipattern apps:
- classic: 3 cards (TextEntry/Dropdown/Click) all `✓ … (prio N)` + member chips + footers;
  Dropdown why-line `provisional → final` where applicable.
- reactish: DatePicker card `✓ DatePicker (prio 10)`; typed intent preserved (6C) in evidence.
- shop: Click cards with aria-name titles + counter footers.
- Toggle row appears only if something was suppressed; toggling reveals suppressed cards
  with reason chips.
- KR chips: if the knowledge DB is readable from the panel context, chips appear; if not,
  honest absence — harness asserts BOTH branches correctly (chip present iff signature row
  exists and DB readable).
- Console: zero new errors.

## 8. Implementation order

1. Pins P1–P11 red.
2. Pure modules: understanding-badge.ts, evidence-footer.ts.
3. interaction-renderer.ts: TYPE_DISPLAY +4, endState always, chips row, why-block,
   footer, showHidden option + suppression chips.
4. kr-chip.ts + sidepanel.ts wiring (toggle stopped-view only, async chip attach).
5. Full suite green + new pins green.
6. Infrastructure gate (full) + reviewer + tester (real Chrome).
7. Owner gate → commit → dist rebuild + ZIP + download link.

## 9. Review-round amendments (owner-review record)

- **A8 assertion chip** was absent from §4/§5 in the original draft (spec-internal
  inconsistency flagged by reviewer round 1); implemented in round 2 — module
  `assertion-chip.ts`, join `triggerEvent.eventId → IRStep.sourceEventId` (the exact
  key ir-bridge.ts:587 writes), honest `0 assertions` vs no-chip-for-absent-data.
- **styles.css** now linked from index.html (round-1 dead-file fix).
- **P9 spy pin** added (round-2); Dexie half is inert by design — the renderer holds
  no Dexie instance (lookup injected), the chrome.storage spy is the operative guard.
- **KR lookup session-scoped** via [appId+sessionId] compound with full-read fallback.
- **Dropdown why-line is a DEAD PATH** (real-Chrome finding, round 2): dropdown.ts
  buildResult never writes `selectionConfirmed: true` into metadata (the confirmed
  path copies selectedValue only; the provisional branch writes `false` for parked
  selections), so both `why: provisional: X → final: Y` and `why: selection confirmed`
  variants are structurally unproducible from real recordings. Renderer honestly
  renders nothing today. Fixing this requires a DEFINITION metadata write (engine
  change) — deferred to the definitions/understanding backlog, NOT solved in MS-U1
  (renderer-only scope). Pins for these variants in understanding-badge.test.ts are
  unit-level only (they pin the renderer logic against synthetic metadata; the
  metadata itself never occurs in the wild yet).
- **Assertion-chip refresh**: renderIRSteps triggers a card re-render on first plan
  install (stopped view renders interactions before the IR plan arrives — chips
  would otherwise wait for an unrelated storage re-write). showHiddenInteractions +
  assertion plan are reset on each new recording start.
