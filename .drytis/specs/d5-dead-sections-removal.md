# D5 — Dead UI Sections Removal (Side Panel)

**Date:** 2026-08-18 · **Status:** approved-for-implementation
**Branch:** `capability-surgical-removal` (base `5c0fa57`) · **Type:** pure-removal hygiene, no new surface

## Root cause (verified in investigation round)

Four stopped-view sections have no backing data writer anywhere in `src/`:

1. **Raw Event Timeline** (`index.html:208–215`) — `timeline-renderer.ts` (203 lines) has **zero importers**; `#stopped-timeline-events` never receives content; the "Show Raw Events" toggle reveals an empty container forever (misleading affordance, visible always).
2. **Capability Analysis residue** (`index.html:235–242`) — `CapabilityRecord` no longer exists in src (capability model surgically removed); section is `hidden` and never referenced by JS; orphan CSS `.capability-record*` (css:~1814–1880).
3. **Element Healing** (`index.html:252–258`) — `StorageKeys.ELEMENT_HEAL_RESULT` (`element_heal_result`) has **no writer** anywhere; `healFromRecording()` exists in `healing-service.ts` but has no production caller (blocked behind D3). Section can never render.
4. **Replay JSON** (`index.html:279–286`) — `StorageKeys.REPLAY_JSON` (`replay_json`) has **no writer** anywhere; Phase 1 artifact whose emitter was never carried forward.

NOT dead (explicitly out of scope): `#status-card/#status-dot/#status-label` (static honest label), `#cs-indicator` (styling applied to parent), `#build-tag`, form-group wrappers, Repository status / IR Plan / IR Playwright / Execution / Observed Workflow sections (all live and data-backed).

## Scope — exact files

| File | Change |
|---|---|
| `src/sidepanel/index.html` | Delete 4 sections: Raw Event Timeline (208–215), Capability Analysis (235–242), Element Healing (252–258), Replay JSON (279–286) |
| `src/sidepanel/sidepanel.ts` | Delete dead consts (`stoppedTimelineEvents`, `rawEventsToggle`, `replayToggle`, `replaySection`, `replayCode`, `healingStatusSection`, `healingStatusBody`); delete `loadReplayJson`, `loadHealingSummary`, `renderHealingSummary`, `HealingSummary` interface; delete replay load blocks at both call sites (~429–440, ~1318–1324); delete healing blocks (storage listener ~1114–1121, init ~1350–1354, reset lines 994/999); delete both toggle listeners (~1257–1271); remove `ReplayJson` import; update module doc header (lines 8–11) |
| `src/sidepanel/sidepanel.css` | Delete `.capability-record*` block (~1814–1880) and `.collapsible-toggle` rules (~765–780; sole user removed) |
| `src/shared/types.ts` | Remove `REPLAY_JSON = 'replay_json'` and `ELEMENT_HEAL_RESULT = 'element_heal_result'` enum members |
| `src/storage/storage-service.ts` | Update stale comment (~306) citing REPLAY_JSON as example |
| `src/sidepanel/timeline-renderer.ts` | DELETE FILE (zero importers) |
| `tests/sidepanel/d5-dead-sections-removal.test.ts` | NEW test file |

**Explicitly untouched:** `src/repository/services/healing-service.ts` + `tests/healing-service.test.ts` (live, tested infrastructure awaiting D3 wiring); service-worker.ts; executor; D4 surfaces; D3/D8/D9/D10 work; E1-prep files; executor-content-script defect.

## Acceptance criteria

- [ ] `index.html` contains none of: `id="stopped-timeline"`, `id="raw-events-toggle"`, `id="stopped-timeline-events"`, `id="capability-records-section"`, `id="capability-records-list"`, `id="capability-records-count"`, `id="healing-status-section"`, `id="healing-status-body"`, `id="replay-section"`, `id="replay-toggle"`, `id="replay-code"`; no visible strings "Raw Event Timeline", "Capability Analysis", "Element Healing", "Replay JSON".
- [ ] Live sections still present: `detected-interactions-section`, `ir-steps-section`, `ir-playwright-section`, `repo-status-section`, `execution-section`, `recording-interactions` (and its list/count ids).
- [ ] `src/sidepanel/sidepanel.ts` has zero references to the removed ids/keys/functions.
- [ ] No file in `src/` imports `timeline-renderer`; the file is deleted.
- [ ] `StorageKeys.REPLAY_JSON` and `StorageKeys.ELEMENT_HEAL_RESULT` have zero references in `src/` and `tests/`.
- [ ] `healing-service.ts` and its test file are byte-identical to HEAD (`git diff` empty for them).
- [ ] `npx tsc --noEmit` exit 0.
- [ ] New D5 test file passes; full suite green (existing count ≥ 3,527).
- [ ] `npm run build` succeeds; dist updated.
- [ ] Real-Chrome validation: no dead-section strings in panel DOM; live sections render after record→stop; second-session reset path (handleRecordAnother) does not throw; zero console errors.

## Tests

New `tests/sidepanel/d5-dead-sections-removal.test.ts` (JSDOM harness, D4 pattern):
1. HTML scan — each removed id absent, each dead title string absent.
2. HTML scan — live-section ids present.
3. Source scan (fs) — no `timeline-renderer` import anywhere in src/, no `StorageKeys.REPLAY_JSON` / `ELEMENT_HEAL_RESULT` strings in src/, `timeline-renderer.ts` absent.
4. healing-service untouched — file exists, still exports `healFromRecording`.

Red phase: criteria 1 and 3 fail before implementation (ids/strings/import present).

## Real-Chrome validation plan

1. `npm run build`; load `dist/` unpacked in headless Chrome (CDP harness, D6/D4 method), replica app on :8098.
2. Record → stop a short purchase flow.
3. Panel DOM asserts: no "Raw Event Timeline" / "Capability Analysis" / "Element Healing" / "Replay JSON" text anywhere; Observed Workflow N steps; IR Plan, generated files, Repository status render; D4 unavailable rows unaffected.
4. Second session (New Test Case → record → stop) — reset path must not throw; console error count 0.

## Verification (full path — pure removal is still a user-visible UI change)

Infrastructure Gate (a–g), reviewer, infra_verifier, real-Chrome CDP. Report diff/tests/Chrome/scope audit. NO commit or push until user approves.
