# 6F-M2b Evidence Pack — PROVENANCE

Phase: 6F-M2b (F4-D — sw-recovered identity seed)
Baseline: 29b6256 (capability-surgical-removal)
Pack built: 2026-08-23, after implementation + build, before commit.

## Artifact → provenance

| Artifact | Produced by | Notes |
|---|---|---|
| `harness-m2b.mjs` | leader, 2026-08-23 | Real-Chrome CDP harness; attempt loop w/ conjunction trigger (see below) |
| `run-1.log` … `run-15.log` | harness runs 1–15 | Full harness iteration history — runs 1–14 document the window-hunting methodology and its failures; kept for honesty |
| `dumps/m2b-storage.json`, `dumps/m2b-cards.json`, `dumps/m2b-attempts.json` | run-15 (the passing run) | Final storage dump, card map, attempt log |
| `m1-regression-run.log`, `m1-regression-dumps/` | 6F-M1 harness (`phase-6f-m1-e2e-2026-08-23/harness-6f.mjs`) re-run on the SAME build | 9 PASS / 0 FAIL; dumps archived here, the committed M1 dumps restored verbatim via `git checkout` |

## Build under test

- dist/ built 14:52 from src incl. `src/background/evidence-attribution.ts` (14:47 — the seed).
- ZIP md5 `8bef2ca95740052a52ddb5c4cbc8082e` (296,484 B) — byte-compared vs dist by infra_verifier: PASS.
- serve/ mirror re-synced (file-server restarted after rebuild) — `diff -rq` clean.
- The E2E drove `/workspace/dist` via `--load-extension` (house pattern).

## Harness design (runs 1–15, methodology)

The sw-recovery path requires the renderer to die AFTER the click card commit
and the durable network stamp, but BEFORE the content-script evidence flush.
Findings, all reproducible from the logs:

- runs 1–4: no injection / graceful close → pagehide emergency flush WINS
  (endReason `page-reload`, real before/after). The M9 flush feature works.
- runs 5–7: `Page.crash` at fixed +50…150 ms → Chrome re-delivers the unacked
  click to the RESTARTED renderer; the evidenced card is a TWIN from the
  reloaded page. Fixed offsets cannot hit a ~40 ms window with ±60 ms jitter.
- runs 8–9 (attempt ladder, 1× CPU): attempt 5 (+80 ms) HIT cleanly — proof
  the window is reachable — but miss rate too high for a gate.
- runs 10–11 (6× throttle, stamp-trigger): stamp fired before card commit;
  crash too early (stamp has no owner).
- run-12: harness bug — in-loop `clearSession` wiped the durable stamp before
  STOP could drain it (hit attempts 4–10 destroyed); in-loop detection looked
  for `sw-recovered-form-submit` which only materializes at STOP.
- run-14 (2× throttle + conjunction): crash dispatched promptly but the flush
  still won (card landed `page-reload`).
- run-15 (6× throttle + CONJUNCTION trigger): deterministic hit.
  Trigger = poll storage for (durable stamp ≥1 row) AND (Click card for
  `#add-to-cart-button` persisted WITHOUT behavioralEvidence), then
  `Page.crash` immediately. 6× throttle makes the flush JS slow enough that
  the native crash dispatch wins the race after the conjunction fires.

## Final results (run-15)

- C1–C8: 9 PASS / 0 FAIL — sw-recovered card carries SEEDED identity
  (BUTTON / add-to-cart-button / "Add to cart"), honest null before/after,
  netRows=1, zero null-identity sw-recovered cards.
- 6F-M1 regression (same build): 9 PASS / 0 FAIL — IR 5 steps, zero twin
  clicks, 6B/6D.1 green.
- Suite: 262 files / 4,523 tests green; tsc exactly the 8 pre-existing
  tests/ baseline errors.
- Reviewer: PASS (initially 1 WARN on AC-5 pin gap — closed by adding the
  copy-as-is pin + relabeling the clone pin AC-1b; narrow re-review PASS).
- infra_verifier: PASS, 0 failures (3 WARNs: loopback fixture server — since
  killed; benign git.drytis.dev docs literal; ZIP-at-root 404 is the
  documented 6F-M2a serving model).
