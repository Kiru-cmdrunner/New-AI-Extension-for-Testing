# Application Understanding Panel — Architecture Design (proposal, no implementation)

Date: 2026-08-22 · Basis: side-panel audit @ 64296a1 (see arch audit turn + researcher inventory)
Status: DESIGN PROPOSAL — awaiting owner review. Not a spec. No code exists for this yet.

## 0. Design principles

1. **The panel is a VIEW, not a processor.** Understanding stays upstream (runtime/pipeline).
   Panel only renders and joins already-captured data. INV-GEN-8/10 untouched (display only).
2. **Join, don't capture.** v1 surfaces use existing join keys: `sourceEventId`, `windowId`,
   `interactionId`, `signatureKey`, `entityId`, `viewId`. Zero storage-schema changes for U1–U4.
3. **Honesty doctrine in UI.** Never invent explanations. Where no decision trace exists,
   say "not recorded" and list decision-trace capture as a future ENGINE enhancement (U6),
   not a UI fabrication. Unclassified stays visible with reason. Gaps listed, not hidden.
4. **Four questions, three surfaces:**
   - What happened? → Surface 1 (Observed Workflow card)
   - Why did it understand it this way? → Surface 1 ("why" block) + Surface 2 (evidence drill-down)
   - What did it learn about this application? → Surface 3A (Session Understanding) + 3B (KR browser)
   - How will knowledge improve future recordings? → Surface 3C (forward links)

## 1. Surface 1 — Observed Workflow card (per interaction)

Progressive disclosure, three levels.

### Level 1 — card header (always visible)
- Type badge for ALL 18 types (fix ColorInput/DragDrop/KeyboardShortcut/CompoundInteraction ❓).
- Component + framework badges (existing).
- Title = businessMeaning ?? fallback (existing).
- **EndState badge for ALL states** (green completed / amber abandoned/interrupted / gray discarded) —
  today only non-completed renders, so "completed" is implicit and abandoned cards look broken.
- **Member-event chip**: `3 events · 412ms` (memberEvents.length, endTime−startTime) — stored, never shown.
- **Understanding badge**: `✓ DatePicker (prio 90)` | `❓ Unclassified — unclaimed-at-projection` |
  `⚠ projected (mousedown+click paired)`. Sources: componentType, metadata.reason, physicalEvents.
- **Assertion chip**: `2 assertions derived` (count only; detail in IR step).
- **KR linkage chip**: `◆ new signature` | `◆ reinforced ×5` | `—`. Source: knowledgeSignatures
  linkageState / occurrence count via signatureKey join (render-time).

### Level 2 — card body (expand)
- **Why this classification** (the honesty block):
  - Recognized: definition name + priority + decisive recorded evidence
    (e.g. `aria-haspopup=listbox + option child roles`; `6D.0 dialog-surface containment`;
    Hover evidenceReason; Dropdown provisionalSelection→selectionConfirmed trace).
  - Unclassified: projection reason + honest line: `definition-evaluation trace not recorded`
    (trace is U6, engine-side, deferred).
  - Lifecycle: endState + window endReason (why abandoned: displaced / element-removed / …).
- **Member events strip**: chips `[pointerdown][focus][input][change][blur]` with relative ms —
  answers "what physically happened" without opening raw JSON.
- **State delta headline**: one line `value: '' → 'Bengaluru'` (from TargetEvidence diff).
- **Evidence footer**: `window 412ms · stabilized · 7 dom changes · 2 network · 1 new surface` —
  compact counts linking into Level 3.
- **"Show hidden" toggle** (list level, not card): production filter stays DEFAULT but a toggle
  `Show all 12 (4 hidden: 2 abandoned · 1 no-op · 1 scroll 0px)` reveals suppressed states.
  Honesty: persisted-but-invisible becomes show-and-mark.

### Level 3 — Application Evidence drill-down (existing block, enhanced — Surface 2)

## 2. Surface 2 — Application Evidence detail (drill-down)

Keep all existing sections. Additions (all stored today):
- **Resulting State items**: per-item provenance row — `via [data-auto-id=cart-count]` vs
  `via changed-element-seed`; entity attributes; uniqueInSnapshot ✓. Entities hyperlink to
  KR entity row (Surface 3B).
- **DOM changes**: `raw` disclosure adds firstMutationAt/batch range/rawMutationCount.
- **Network**: requestBody disclosure (POST), resourceType, source (main-world / webrequest /
  performance-observer — currently collapsed to a dot), sourceEventId join note.
- **Window internals** (new disclosure): endReason, duration, stabilityTrace sparkline
  (the 50-sample buffer), identityCapturedAt.
- **Raw evidence JSON**: full behavioralEvidence disclosure (trust + debuggability).

## 3. Surface 3 — Application Understanding / Knowledge Repository views

### 3A. Session Understanding card (stopped view, side panel)
Populated from `understanding_result` (written every session, zero UI today) + KR queries:
- Application identity (appId, matched ApplicationRow).
- **View map**: views discovered this session + transitions between them (list first, graph later).
- **Entities learned**: new vs reinforced; state history rows.
- Counters & collections with history (cap 100 rows each in KR).
- Outcomes & state transitions.
- **Coverage**: behaviorSession coverage stats (knowledgeBehaviorSessions).
- **Knowledge gaps** — the engine's honest "I don't understand yet" backlog:
  knowledgeGaps + Unclassified aggregation + suppressed states. Each gap deep-links to its card.
- knowledgeWarnings.
- Link → 3B.

### 3B. Knowledge Repository browser (repository page; replaces dead Capabilities tab)
Cross-session, read-only over cmdrunner_knowledge (15 tables, all written, zero UI):
- **Entities**: cross-session state history, view membership, provenance (discovering session).
- **Views & transitions**: application map (SPA route graph).
- **Action signatures** (crown jewel): signature, consequenceProfile (counters delta, surfaces,
  entities affected), divergenceFlags, occurrence count, first/last seen, linkage state.
- **Recorded workflows**: signature sequences + instance matching.
- **Episodes & edges**: T1–T4 EvidenceRef drill-down to original interactions.
- **Gaps backlog**: prioritized by recurrence.
- **API seeds** (Knowledge Contract @1703e43).

### 3C. Forward-looking ("how this improves future recordings")
Per-signature: `reinforced ×5 — recognized instantly next session` (deterministic count).
Locator durability join: signature/element → heal history (Elements view already has heals).
Gap-driven guidance: `3 unrecognized dropdown patterns captured — one more recording of this flow
would confirm generality` (counts only, deterministic; no AI narration).
Honest boundary: recognition HINTS fed back into definitions = capability-model phase (roadmap 7.3);
until then this surface explains, it does not alter capture.

## 4. Data flow (join-only)

```
STOP ──► understanding_result (exists) ──► 3A Session Understanding
      ──► cmdrunner_knowledge (exists)  ──► 3B/3C (read-only Dexie reads, panel+repo contexts)
interactions (exists) ── join signatureKey/entityId/windowId ──► card chips (1), gap links (3A)
behavioralEvidence (exists) ──► Surface 2 drill-downs
assertions (exists) ── join resultingState item ──► "derived from 📦 collection n=2 (seed)" provenance
```
No writer paths change. No new capture. Panel never writes KR.

## 5. Phasing (design-level; maps to roadmap 6F + 7.2)

- **U1** Card upgrades: all badges, endState-always, member chip, why-block (recorded facts only),
  show-hidden toggle. Pure renderer. (6F-adjacent)
- **U2** Evidence drill-downs: seed provenance, network detail, stability sparkline, raw JSON.
- **U3** Session Understanding card from understanding_result + gaps. (7.2)
- **U4** KR browser tab (entities/signatures/views/gaps). (7.2)
- **U5** Forward links: reinforcement chips, locator-durability join, gap guidance. (7.2/7.3)
- **U6** ENGINE-side (deferred, owner-gated): definition-evaluation decision trace to deepen "why";
  capability-model recognition preview. Not UI work; listed so UI never fabricates what U6 will record.

## 6. Explicitly NOT in this design
- No processing/classification in panel; no writes to KR; no new env/services; no timing logic;
  no ledger/projection/IR changes; no AI-generated explanations (deterministic-first AI-last).
