# MS-U5 — Forward Links (Surface 3C)

Status: IMPLEMENTED (owner-approved to proceed — 'Proceed with MS-U5', 2026-08-22 14:33 UTC; post-implementation review W1 resolved)
Milestone: U-series 5 of 5 (renderer-only Application Understanding surfaces)
Depends on: MS-U3 (Session Understanding card, understanding sessionId joins), MS-U4 (KR browser tab, proven read paths)
Design source: .drytis/notes/app-understanding-panel-design-2026-08-22.md §3C, .drytis/notes/u1-u5-availability-mapping-2026-08-22.md §U5
Roadmap: Phase 6 UI track; 7.2 knowledge surfacing.

## 0. Purpose

Answer the owner's fourth question — **"How will this knowledge improve future
recordings?"** — with deterministic, recorded facts only. MS-U1..U4 answer
What happened / Why / What was learned; MS-U5 explains forward utility WITHOUT
altering capture, classification, or the KR. The panel explains; the engine
remains the sole writer. Recognition hints into definitions remain OUT (7.3,
capability-model era).

## 1. In scope

Three forward-link surfaces, all join-only reads over existing data:

1. **F1 — Forward-links block on the Session Understanding card** (side panel,
   stopped view): for each learned signature this session reinforced or
   created, one deterministic line:
   `◆ Click "search" — reinforced ×5 · recognized instantly next session`
   derived from KnowledgeActionSignatureRow (occurrenceCount, status,
   firstSeenAtSession). Plus an honest one-line summary when nothing new was
   learned (`No new signatures this session — recording reinforced existing
   knowledge.`) and when nothing at all exists (fresh install).
2. **F2 — Gaps guidance line** (same card, appended to the existing gaps
   block): deterministic count-based guidance ONLY:
   `3 observation(s) could not be attributed (no-live-horizon ×2,
   outside-horizon ×1) — recording the flow again may confirm horizons.`
   Counts come from knowledgeGaps rows for the session (already loaded by
   MS-U3 lookupSessionGaps — no new read path). NO invented fixes, no AI
   narration.
3. **F3 — Locator durability row in the KR browser** (repository page,
   Elements-adjacent, read-only cross-DB join): aggregate heal counts +
   bounded per-ELEMENT heal lines. Join: Elements.healHistory via existing
   table reads. Per-SIGNATURE attribution is deliberately NOT attempted —
   no recorded join key exists between knowledgeSignatures.normalizedTarget
   (action vocabulary) and Element.logicalName (repository vocabulary);
   inventing one would fabricate attribution (reviewer W2 resolution).
   When the Elements table is empty (healHistory `[future]`, V1 never
   writes HealEvents), render the HONEST state: `Locator healing: not yet
   observed — elements recorded, no heals on record.` This keeps the join
   real today and useful the moment healing produces history.

## 2. Out of scope (hard constraints)

- NO writes anywhere (KR, repository DB, chrome.storage). Join-only reads.
- NO engine changes: ledger, projection, definitions, IR generation,
  NOISE_TYPES, event-tap, understanding-pipeline untouched.
- NO recognition hints / no capture changes — this surface EXPLAINS; it never
  alters future classification (7.3 boundary).
- NO timing-based rules; NO site-specific tokens; NO AI narration.
- NO new Dexie methods or schema changes — reuse existing reads/indexes.

## 3. Acceptance criteria

- [ ] A1 Owner approves this spec before implementation.
- [ ] A2 F1 renders per-signature reinforcement lines for signatures present
      in the session's episodes (join MS-U3's proven episode → signatureKey
      → signatures read); new-signature lines say `◆ new signature — first
      observation; next recording reinforces it`; ×2+ lines show count and
      `recognized instantly next session` only when status='active'.
- [ ] A3 F1 stale signatures render `not seen recently` (status='stale') and
      never claim instant recognition.
- [ ] A4 F1 empty states: no signatures → honest fresh-install line; session
      with only new signatures → summary line naming the count; missing
      understanding_result → section hidden entirely (consistent with MS-U3).
- [ ] A5 F2 renders guidance line only when gaps > 0; counts by reason;
      `no-live-horizon`, `outside-horizon`, `proof-less` vocabulary only; no
      invented remediation text.
- [ ] A6 F2 renders nothing (block absent) when gaps = 0 — absence is honest.
- [ ] A7 F3 heals row renders in KR browser under signatures when Elements
      rows exist; shows `×N heals · last <date>` when healHistory non-empty;
      honest never-healed line when empty; block absent when no Elements
      rows at all (no fabrication of an empty Elements state).
- [ ] A8 F3 join is read-only via existing Elements repository (no new Dexie
      table methods); failures degrade to honest absence, never throw in the
      panel.
- [ ] A9 All new strings user-visible in the side panel are deterministic
      templates of recorded fields — grep-verifiable: no dates/names not in
      rows, no invented confidence.
- [ ] A10 Pins: F1 tone matrix (new/reinforced/stale × occurrenceCount);
      F2 reason-grouping + zero-gaps absence; F3 join with populated
      healHistory, empty healHistory, missing Elements; wiring (card hidden
      without understanding_result; F2 appended after gaps rows).
- [ ] A11 No console errors; failure of any KR/repository read degrades to
      honest absence (no error banners).
- [ ] A12 Diff touches only renderer files (sidepanel modules, understanding
      card module, kr-browser module, styles, tests). Zero engine files.

## 4. Test plan

- Unit pins: forward-links.ts pure formatters (tone matrix, reason grouping,
  heal-line variants) — RED first.
- Wiring pins: understanding-card forward block shown/hidden; gaps guidance
  appended only when count > 0; KR browser heals row under Action Signatures.
- Real-Chrome E2E (reuse harness): record P-CLASSIC twice in one profile —
  first recording shows `◆ new signature` lines; second shows `reinforced ×2`;
  repository page shows signatures with honest never-healed line; zero
  console errors. Manual backup: owner-driven second run on live site.

## 5. Risks

- R1 Second-recording reinforcement requires same appId across sessions —
  appId derivation is origin-keyed and stable; harness uses one profile, so
  stable. Low.
- R2 Elements table may be empty in real profiles (healing V1 never writes
  HealEvents) → F3 shows honest absence. Accepted by design (A7).
- R3 Cross-DB join cost: Elements read is one bulk read per KR render;
  bounded by project count. Low.
- R4 Over-claiming "recognized instantly" when signatures are stale — tone
  matrix prevents (A3).

## 6. Pins

- P1 F1 line: new signature (occurrenceCount 1) → `◆ new signature — first
      observation; next recording reinforces it` (tone new).
- P2 F1 line: reinforced active ×5 → `◆ reinforced ×5 · recognized instantly
      next session` (tone reinforced).
- P3 F1 line: stale ×5 → `◆ reinforced ×5 · not seen recently` (tone stale,
      never claims instant recognition).
- P4 F1 summary: all-new session → `No signatures existed before this
      session — every action learned is new.` (or equivalent pinned string).
- P5 F2 grouping: gaps [no-live-horizon, no-live-horizon, outside-horizon]
      → `2 no-live-horizon · 1 outside-horizon` ordering by count desc then
      reason asc; guidance sentence appended exactly once.
- P6 F2 zero gaps → formatter returns null (block absent).
- P7 F3 heals: element with 2 healHistory entries, last 2026-08-01 →
      `2 heals · last healed 2026-08-01`.
- P8 F3 never-healed: element with empty healHistory → `recorded, no heals
      on record`.
- P9 F3 no Elements rows → heals line absent entirely (null).
- P10 wiring: understanding card renders forward block only when
      understanding_result present; F2 attaches after gaps rows.

## 7. Files (expected)

New: src/sidepanel/forward-links.ts + tests; kr-browser heals row inside
existing kr-browser.ts + tests.
Modified: understanding-card.ts (F1/F2 block), kr-browser.ts (F3),
understanding-card tests, styles.css (forward block styles), possibly
understanding-card-wiring test.
NOT touched: engine files, kr-chip.ts (U1 surface unchanged), index.html
unless block container needed inside existing card root.
