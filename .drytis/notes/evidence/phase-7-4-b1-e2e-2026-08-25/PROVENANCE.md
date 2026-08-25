# 7.4-B1 Expander — Evidence PROVENANCE

- **Status: SHIPPED @ commit 1 `5140736` (src+tests+fixture)**
- Spec: `.drytis/specs/phase-7-4-b1-expander.md` (baseline cf18d34)
- Owner approval: 2026-08-25 ("Approved" — owner gate report accepted after full verification)

## Artifacts (this directory)

| Artifact | What it proves |
|---|---|
| `harness-74b1.mjs` | Real-Chrome CDP harness (house pattern; zero-dependency :8242 fixture server + pure-Node http probe; :8190 reuse of `phase-6e-m2-e2e-2026-08-23/app-verbatim.mjs` for regressions) |
| `run-final.log` | FINAL green run: **16 PASS / 0 FAIL** from the fixed tree (post WARN fixes + registry-corruption fix) |
| `run-3-early-full-green.log` | Earlier green 15/0 run retained for history (pre X4c badge pin) |
| `dumps/b1-cards.json` | 3 Expander cards — button / role=button / bare-div shapes, `expandedAtTrigger=false` pre-flip on all three |
| `dumps/b1-ir-plan.json` | IR plan: `["click","click","click"]` — Expander→CLICK mapping, ZERO toggle actions |
| `dumps/b1-kr-dexie.json` | KR: 3 knowledgeStateTransitions carrying `expanded`, 3 knowledgeSignatures minted for Expander (fragmentation accepted + pinned) |
| `dumps/b1-storage.json` | Full chrome.storage dump — outcomes `stateChanges` "control: … (expanded) false → true" ×3, `contracts[].expanded=true` ×3 |
| `dumps/regression/6em2-run.log` | 6E-M2 DatePicker regression: 8 PASS / 0 FAIL |
| `dumps/regression/6fm1-run.log` | 6F-M1 gesture-ownership regression: 9 PASS / 0 FAIL (zero twin Click cards) |
| `dumps/regression/74m1-run.log` | 7.4-M1 affordance regression: 16 PASS / 0 FAIL |
| `dumps/regression/phase-6e-m2…-dumps/`, `phase-6f-m1…-dumps/` | Fresh regression JSON dumps preserved; the ORIGINAL dirs were restored via git checkout after the runs |

## Defects found & fixed during the cycle (honest record)

1. **Claim-gate over-claim (engine bug, caught by an OLD pin):** the first gate used
   `ariaExpanded !== null`, which is TRUE for `undefined` — legacy sessions and partial
   DomContexts omit the field, so every plain click on a `li.opt`-shaped element would
   have been stolen as Expander. Caught by `tests/definitions/click-surface-6d1.test.ts`
   AC-W3a (6D.1-era runtime pin, not one of my new pins). Fixed to a boolean-valued
   gate (`ariaExpanded === true || === false`); regression pin B1-12 added.
2. **Registry corruption (self-inflicted, caught by the full-suite gate):** a comment
   edit joined two array lines in `src/definitions/index.ts`, silently dropping
   `navigationDefinition` from `ALL_DEFINITIONS` → 13 navigation/attribution tests
   failed in full-suite. Fixed; all 51 affected tests re-verified green; full suite
   re-run green from the fixed tree. Lesson: the array block in index.ts is
   load-bearing — every registry edit gets a same-session full-suite run.
3. **Harness assertion bugs (not engine):** run-1 X5/X7 asserted the wrong storage
   paths (`knowledgeStates` table does not exist — flips live in
   `knowledgeStateTransitions`; contracts live at `understanding_result.semanticKnowledge.contracts`);
   a `getElementById('#s1')` diagnostic printed a false "undefined". All corrected;
   engine output was correct from the first run.

## Final verification state (post-fix tree)

- Suite: **286 files / 4,715 tests green** (baseline 4,694 + 21: 20 expander pins + 1 no-steal pin B1-13)
- tsc: **exactly 8** baseline errors (unchanged set)
- Build: green; ZIP v10.9.0, 40 files, 294.8 KB
- ZIP md5 **51b83f9df70e1db56c8447063b50e779** — four-way identical
  (root / download/ / serve/ / preview-served)
- Marker: `Expander` ×5 in `assets/service-worker-inline.js`
- Reviewer: PASS (4 WARNs all addressed — B1-13 no-steal pin, B1-17 real divergence
  pin, X4c panel-badge E2E assertion, stale comments + ZIP re-pack/record)
- infra_verifier: **RESULT: PASS**

## Regression-harness serving truths (relearned, for the next AI)

- The :8190 fixture harnesses expect `app-verbatim.mjs` running in the SAME shell
  invocation as the harness (a backgrounded `&` server dies when the run_bash shell
  exits — defunct zombies).
- Panel DOM badge assertions require a **panel reload AFTER STOP** (panel booted in
  Idle state renders home view; stopped-state boot renders the card list).
