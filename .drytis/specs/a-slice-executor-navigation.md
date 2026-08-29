# A-Slice: Executor Navigation + Resulting-State Ownership + textMatch Diagnostics

Audit source: `.drytis/notes/head-audit-1703e43.md` (real-Chrome E2E, HEAD 1703e43).
Scope: EXACTLY the three confirmed product issues. No COUNT/MATCHES semantic changes (4c-iii frozen). No 5b/5c. No unrelated refactors.

## Issue 1 — Resulting-state consequence mis-attribution (fill inherits click's state)

### Root cause (code-verified)
`finalizeForInteraction` (evidence-collector.ts ~1338) receives the TextEntry FINALIZE_EVIDENCE on
blur (focus moves to the button on mousedown). It deletes the lifecycle binding, finds the open
type window, and — `settleDelay = 150` (not unloading) — calls `enterSettleMode(win, metadata)`
(~1468): setHoldOpen(false) + `settleEntry(causalNetworkIdle)`. `settleEntry` re-arms
`scheduleStabilization()`, which counts ANY MutationObserver batch in the same document as
"activity" — the click's DOM changes land ~10ms later in the SAME document, re-arm the shared
DOMObserver batchCallback's stabilization timer for the type window, and the window closes
`consequence-settled` ≥300ms after the LAST mutation (i.e., after the click's consequence).
Hook A `captureResultingState(state)` (~665, ~1445) then calls
`pageContentObserver.scan(null)` — a LIVE DOM scan at close time — photographing the click's
result into the TextEntry's evidence. Two compounding factors:
(a) The quiescence clock is shared per-window but the MUTATIONS ARE NOT ATTRIBUTED: any batch in
the document re-arms every open settling window.
(b) The scan happens at close (INV-CS3: no fixed timeouts, scan at settlement) — correct for
clicks, wrong for a window whose consequence already belongs to the next interaction.

### Fix (minimal, ownership-correct)
Mechanism (verified against event ordering): EventTap listeners are capture-phase on document,
so the Click window opens at click-capture BEFORE the app's click handler mutations land. The
TextEntry window was finalized on blur (mousedown default action) and entered settle mode; its
`recordMutation` feed was disconnected when the click window registered the (single-slot)
DOMObserver batchCallback — but its stabilization TIMER keeps running, so it closes
`consequence-settled` ≥300ms later and Hook A scans the live DOM, photographing the click's
consequence that landed in between.

Ownership rule: **a window in settle mode that is superseded by a newer interaction's trigger
(window open) must not claim later DOM consequences.** Implement `settleSuperseded` on
ObservationWindowState: set for every open settle-mode window inside `openWindow` (the new
window itself excluded); `captureResultingState` (Hook A settle branch only) skips when set.
Blur-caused consequences still work: they land while the type window still owns the
batchCallback (before the next window opens), re-arming its quiescence legitimately.
Click/Nav separation unchanged (post-nav Hook B + isPostNavWindow gate untouched; windows on
the old document close via the unload path as before). INV-CS3 preserved (no fixed timeouts
introduced; scans still happen at settlement).

### Regression tests
- tests/tap/resulting-state-consequence-ownership.test.ts (new): fill → click workflow; assert
  TextEntry interaction resultingState is null/empty for click-caused DOM changes landing after
  the fill's settle entry; assert Click interaction resultingState carries them.

## Issue 2 — Executor element resolution after navigation

### Root cause (code-verified)
The IR `navigate` action is a documented NO-OP in BOTH executor layers:
- ir-executor-impl.ts executeStep: for `step.target.kind === 'url'` targets, only
  `resolveUrlTarget`-shaped navigate steps exist; executeStep has NO navigate branch — it falls
  through to sendTabMessage EXECUTE_STEP whose content-script switch `case 'navigate': return
  { success: true }` (no-op).
- The comment "Handled by service worker (chrome.tabs.update)" is FALSE — grep proves
  `tabs.update` is never called in ir-executor-impl.ts or service-worker.ts RUN_TEST path.
- Therefore the RUN tab NEVER leaves the start URL for navigate steps. In the audit, step-0003
  (navigate /cart) was a silent no-op: the executor stayed on the search page, where
  `#cart-count` does not exist → step-0004's `RESOLVE_LOCATOR` for `#add1`... wait, `#add1`
  DOES exist on the search page? NO — `#add1` is on /cart. The run tab stayed on the search
  page the whole time; `#cart-count` and `# executor resolving `#add1` correctly (button exists
  on /cart page where RUN_TEST navigated... no —

Correction (audit data): in the audit, the run stayed on the SEARCH page (navigate was a no-op),
so BOTH `#cart-count` (step-0003 assertion) and `#add1` (step-0004) genuinely did not exist on
that page — `ElementNotFound` was CORRECT given the executor stayed on the wrong page. Both
step-0003's not-found textMatch and step-0004's ElementNotFound share this single root cause.
The real defect is the silent no-op navigation (plus the stale comment), not locator resolution.

### Fix (minimal)
In `IRExecutorImpl.executeStep`, add a navigate branch for `step.target.kind === 'url'`:
`chrome.tabs.update(tabId, { url })` + `waitForPageLoad(tabId)` + re-inject executor content
script (document context destroyed on navigation). Also (belt-and-braces) after any step whose
action === 'navigate', re-inject. Re-injection is required because content scripts die on
navigation; `chrome.tabs.sendMessage` to a tab without the listener would reject (caught by
existing try/catch → error status, diagnostics preserved).

### Regression tests
- tests/execution/ir-executor-navigate.test.ts (new): fake chrome bindings; navigate step does
  tabs.update + waitForPageLoad + re-inject; subsequent element step RESOLVE_LOCATOR resolves
  on the new "page"; no-op previously (tabs.update never called).
- Keep existing content-script count tests untouched (4c-iii frozen).

## Issue 3 — textMatch "Element not found" when element exists

### Root cause (code-merged executor bundle)
The shipped content script uses a COPY of the evaluator, inlined at build time
(executor-content-script.ts lines ~459-520). In BOTH layers the element-not-found guard runs
AFTER presence/visibility/count but BEFORE textMatch:
```
if (!element) return { type, passed: false, actualValue: null, expectedValue: `Element not found — cannot evaluate ${type}` };
```
In the audit, the element `#cart-count` EXISTED (on /cart)... but the run stayed on the search
page (issue 2), so `#cart-count` genuinely did not exist AT THAT MOMENT in the run tab. The
message "Element not found — cannot evaluate textMatch" is thus ACCURATE for the run as it
happened. HOWEVER the requested diagnostic improvement stands: when element exists but text
differs, both layers already report actual text (verified lines ~303-318 assertion-evaluator.ts
and content-script mirror). When element is missing, null actualValue + "not found" is correct
behavior to preserve.

Wait — re-reading the audit: step-0003 textMatch evaluated against the SEARCH page (no-op nav),
where `#cart-` elements don't exist → correct not-found. BUT the actualValue=null + not-found
message is accurate. The user's requested improvement — "when the element exists, report actual
text" — is what the code ALREADY does when the element exists. The audit's "finding 3" was an
artifact of finding 2 (no-op navigate): on the wrong page the element truly didn't exist.

Hmm — but there IS still a genuine diagnostic gap: the textMatch-evaluated-against-wrong-page
problem is invisible. A user sees "Element not found" and cannot tell whether the element is
missing on the CURRENT page or the assertion targets a DIFFERENT page than where the run is.
Since fix 2 makes navigation actually navigate, this gap closes for the common case. Remaining
niche gap: SPA hash/soft navigations where the executor content script survives.

## Decision (per user constraints: minimal fixes, no behavior change beyond the three issues)
1. Fix 1: settle-scan ownership via `settleSuperseded` — real mis-attribution, fix with
   supersede rule. TWO symmetric halves (verified by test-driven iteration):
   (a) openWindow marks any open settle-mode window when a NEW interaction's window opens;
   (b) settle ENTRY (enterSettleMode) marks the entering window superseded when a NEWER,
   live (non-superseded) window already exists in `activeWindows` (real-Chrome order: click
   event fires synchronously BEFORE the blur-driven TextEntry finalize arrives via async SW
   round-trip — half (a) never sees the type window settling).
2. Fix 2: navigate branch (tabs.update + waitForPageLoad + re-inject). This fixes BOTH step-0003
   (assertion then sees real /cart page) and step-0004 (element resolves on /cart).
   - Fix 2 sub-item: navigate steps carry step-scoped assertions describing the DESTINATION
     page (audit: step-0003 textMatch "0 items" on #cart-count). The navigate branch evaluates
     them via EVALUATE_ASSERTIONS on the newly loaded page, using the same soft/hard semantics
     as the normal action path (soft → recorded, not step-failing).
3. Fix 3: keep evaluator semantics (not-found when missing → null + not-found message). The
   audit's "wrong message" complaint arose because the element existed in the HARNESS's mental
   model (live /cart DOM) but not in the run tab's actual DOM. With fix 2, textMatch on
   #cart-count after navigate will now see the element and report real text mismatches. No
   evaluator change needed for the exists-but-differs case (both layers already report the
   actual text when the element exists).
   - Regression tests pin BOTH behaviors on BOTH layers (canonical + shipped content-script
     copy): exists-but-differs → actual text + real mismatch message; genuinely-missing →
     null + not-found message. The canonical evaluator receives a PRE-RESOLVED element
     (mirroring the content script's own locator resolution) — earlier test failures were
     fixture errors (raw locators where resolved elements are expected), not product bugs.

## Files to change
1. src/tap/evidence-collector.ts — settle supersede rule (fix 1)
2. src/execution/ir-executor-impl.ts — navigate branch (fix 2)
3. tests/tap/resulting-state-consequence-ownership.test.ts (new)
4. tests/execution/ir-executor-navigate.test.ts (new)
5. tests/execution/executor-textmatch-diagnostics.test.ts (new)
6. .drytis/specs/a-slice-executor-navigation.md (this file)

## Acceptance criteria
- [ ] TextEntry window whose settle is superseded by a later trigger (click window opens) does NOT scan → TextEntry resultingState null
- [ ] Click window still scans (its mutations land after its own open, during its own settle) → Click resultingState captures consequence
- [ ] Navigation windows unchanged (post-nav Hook B, isPostNavWindow gate preserved)
- [ ] COUNT/MATCHES semantics untouched (4c-iii tests pass unchanged)
- [ ] navigate step performs tabs.update + waitForPageLoad + re-inject; subsequent steps resolve elements on the new page
- [ ] Prior behavior (element steps resolve) unchanged in navigate-free plans (Scenario B parity)
--free plans (Scenario B parity)
- [ ] textMatch exists-but-differs → actualValue = actual text, real mismatch message
- [ ] textMatch genuinely-missing element → actualValue null + "Element not found" preserved
- [ ] Full suite green; build green; real-Chrome audit re-run: fill assertion now correct, step-0003/0004 pass
- [ ] No changes to contract layer (5a) or payload invariants
