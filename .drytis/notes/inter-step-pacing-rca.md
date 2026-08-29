# RCA — inter-step consequence pacing gap (read-only, 2026-08-20)

**Status: read-only analysis. NOTHING modified, committed, pushed, or ZIPped.** All file:line refs
verified at working tree on dc63957 + uncommitted Defect 1+2a+2c slice.

## Verdict
**Real product defect** — a recording/execution **asymmetry**: the recorder cannot close an
evidence window until consequences settle, but the executor has ZERO post-action settle anywhere.
Not a Defect-1/2a/2c regression (baseline failures were instant ElementNotFound; post-fix failures
burn the full 10s wait = machinery works, absence is real). Not an AdaniOne-clone artifact: the
clone merely models the generic async-consequence pattern (fetch→state→render) common in SPAs.

## The asymmetry (facts)
**Recorder (settles):**
- `src/tap/adaptive-window.ts:99` — `minQuiescence = 300ms` of no MutationObserver activity before a
  window may close `stabilized`; `:310-350` stabilization timer scheduling / `checkStabilized`.
- `src/tap/evidence-collector.ts:1545` — settle mode also requires `causalNetworkIdle` (`:1555-1566`).
- Cap 10s from open (`POST_NAV_MAX_DURATION_MS=3000` for post-nav `:99`, `maxDuration=10000`).
- dc63957 added `COMPANION_WINDOW_MS=300` + both `settleSuperseded` guards (`:154-1535`).

**Executor (never settles):**
- `ir-executor-impl.ts:391-434` — `EXECUTE_STEP` → (error/failed early-returns) →
  `EVALUATE_ASSERTIONS` fires **on the same tick** as the action response; step loop `:206-235`
  runs steps back-to-back. No post-action wait, no inter-step wait, no MutationObserver, no
  network-idle check on the replay path.
- Only waits: initial `waitForPageLoad` (`:180`), navigate-branch `waitForPageLoad` (`:278`),
  pre-action `resolveWithWait` poll (content script, capped 10s).
- `retryCount`/`retryDelayMs` are declared-but-dead on the execution path; `parameterOverrides` never read.
- Content script `executeAction` case `'wait'` is a **no-op** (`executor-content-script.ts:389`) — an
  explicit wait step wouldn't pause replay either.
- Content-script EXECUTE_STEP handler responds immediately post-action; assertions are a separate
  `EVALUATE_ASSERTIONS` message from the SW.
- No `isPageStable` helper exists anywhere; `IRStep`/`ExecutionParameters` carry no recorded
  window/settle timing (ir-bridge stamps constant defaults).

## Can existing infrastructure solve it? Partially — but not by reuse
- The settle machinery (AdaptiveWindow, causal idle) lives in `src/tap/*` **modules**, imported by
  the recorder's ES-module bundle. The executor content script is a **zero-import classic-script
  IIFE** (vite.config.ts:36-65; file header requires SELF-CONTAINED). Direct reuse impossible.
- The recording-side machinery also captures far more than replay needs (stability traces, windows,
  network supplement) — importing it into the replay path would drag recorder semantics into
  execution.
- Recorded settle timings (window durationMs etc.) do NOT flow into IR — pacing replay from
  recorded evidence would require extending IRStep (spec'd in consequence-settling.md §"Future:
  replay parity" but never built). Larger blast radius; changes wire shape.

## Smallest SAFE fix (recommendation, not implemented)
**Executor-side fixed short settle: between the post-action assertion evaluation and the next
step, poll DOM mutation quiescence for ≤300ms (matching the recorder's minQuiescence constant),
capped at 1s, inlined in the executor content script.**

Shape (sketch, NOT implemented): content-script handler for a new `SETTLE` message (or a settle
flag on EXECUTE_STEP response): install a MutationObserver on document.body, resolve when (a) 300ms
with zero mutations AND no in-flight fetch/XHR initiated after the action, or (b) 1s cap. The SW
executor awaits it after EXECUTE_STEP before EVALUATE_ASSERTIONS and before the next step.

Why smallest-safe:
1. Mirrors the recorder's own constant (`minQuiescence` 300ms) — no new tuning philosophy; cap 1s
   = maxDuration/10, far below any step timeout.
2. Inlined in the executor IIFE (~40 lines incl. in-flight tracking via PerformanceObserver /
   patched fetch counting — same pattern the content script already uses for classic-script safety).
3. No IR/wire changes (message stays backward compatible: absent settle flag = today's behavior).
4. No reuse of tap/ modules → no recorder-semantics leakage, no new imports in a classic script.
5. Bounded worst-case: +1s/step; steps already tolerate 10s waits.

Rejected alternatives: (a) replay from recorded window timings — correct but large (IR schema +
bridge + determinism considerations, "timing rules" the user explicitly excluded from OR-1 scope);
(b) fixed sleep(500ms) between steps — dead time always, ignores DOM quiet signal, no better than
(c); (c) click→settle only when next step's target misses — already happens implicitly via
resolveWithWait failure; adding settle **after** resolution failure (healing fallback) would be the
truly minimal variant but doesn't fix assertion timing (step-0006's `[data-sku="MEAL"]` presence
failed at skeleton phase).

**Caveat to flag for the design discussion:** a 300ms-quiescence settle WOULD have fixed the clone
failure (meal lands ~500ms after add-meal click; the cart soft-nav re-render happens ~immediately;
300ms of quiet wouldn't elapse until the meal landed and re-rendered). It would NOT cover
slow-consequence chains (>1s after quiet) — a purposeful boundary, matching the recorder's own
settle contract. Cross-step evolving expectations ("1"→"2"→"3" on #cart-root) are the 2b-held
policy's outcome, not pacing.

## Defect 1+2a+2c — commit-readiness (verified this session)
- 5 modified files, every hunk in scope (verified hunk-by-hunk). 3 new test files + appended
  wait-wiring block in `tests/execution/ir-executor-navigate.test.ts` (+50 lines).
- Full suite green at current tree: **3944/3944** (216 files).
- Build green; dist executor content script verified (poll loop + 1e4 cap).
- Gates: AdaniOne clone 27/0, a-slice regression 35/0. Reviewer: no FAILs. Infra: PASS.
- **4 net-new `tsc --noEmit` errors in my appended test block** (`tabsUpdate` should be
  `updateTabUrl`; `{ tabId: 7 }` is not a valid `IRExecutionOptions` — committed tests call
  `execute(plan)` with no second arg and define `tabsUpdate` binding only as a mock). Vitest
  transpiles without typecheck so runtime is green, but these should be fixed BEFORE commit (the
  file's committed block establishes the correct pattern at lines 161-167/212-218).
- `tests/tap/consequence-settling.test.ts` (untracked) is an **orphan of commit 5982534's red-phase
  work**, NOT this task: it pins AdaptiveWindow/NetworkBridge/EvidenceCollector settle behavior that
  is fully committed; zero references to this slice's APIs; mtime Aug 18 15:13 (23 min before
  5982534). Currently passing 23/23. EXCLUDE from this task's commit; candidate for a separate
  housekeeping commit.
- Suggested commit composition (separately committable): (1) Defect 1 — executor-content-script.ts,
  ir-executor-impl.ts, executor-resolve-wait.test.ts, ir-executor-navigate.test.ts appended block;
  (2) Defect 2a — page-content-config.ts + page-content-alt-testid.test.ts; (3) Defect 2c —
  assertion-derivation.ts + assertion-derivation-alt-testid.test.ts; (4) docs —
  .drytis/specs/defect1-2a-2c-*.md + notes/defect1-2a-2c-validation-record.md + evidence dir.
  Cross-file dependencies are minimal (2c's tests pin 2a capture semantics; committed together or
  in order 2a → 2c; Defect 1 fully independent). No commit until explicit approval per handover.
