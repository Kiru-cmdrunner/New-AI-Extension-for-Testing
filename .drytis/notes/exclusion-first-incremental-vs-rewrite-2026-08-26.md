# Exclusion-First Architectural Audit — Incremental vs Rewrite Assessment

Read-only audit per owner directive (2026-08-26 13:39 UTC). No code/tests/specs/commits/ZIPs modified.

## Central Question

Can we switch from "prove this click is genuine" (inclusion-first) to "prove this click is invalid" (exclusion-first) — and can it be done incrementally, or does it require a fundamental rewrite?

## Answer: SMALL change to click.ts, MEDIUM architectural impact, LARGE downstream contract churn

The core code change is SMALL (one file, ~30 lines). But the downstream impact across lifecycle, dedup, KR, IR, and B1–B5 contracts is MEDIUM-to-LARGE. A safe incremental path exists but requires careful staging.

---

## §1 — Where Valid Clicks Currently Become Unclassified

### The single gating point: `click.ts:32-71`

```
Click.detectTrigger(event):
  Gate 1 (line 37): isInteractiveElement(tag, ariaRole, className, tabIndex)
  Gate 2 (line 45): isInsideOpenSelectionSurface(ancestorRoles, ancestorClasses)
  Gate 3 (line 56): autoId || dataAutoId
  Gate 4 (line 67): pointerCursor || clickHandler
  ALL FAIL → return null → event stays 'pending' → Projection Engine → Unclassified
```

This is the ONLY point where a valid click becomes Unclassified. The four gates are inclusion proofs — each requires POSITIVE evidence of interactivity.

### B3 Census evidence — what actually becomes Unclassified

From `b3-full-final3` (16 cards, 14 Unclassified):

| Card | tag | Evidence? | Classification |
|------|-----|-----------|---------------|
| int-5–14 (9) | INPUT | No | **Correctly rejected** — per-key keydown (no-focus typing, not click) |
| int-15 | BODY | Yes | **Legitimate interaction** (B3 S4 deliberately captured click-away) |
| int-16 | DIV (plain) | Yes | **Correctly rejected** — no handler, no affordance |
| int-17 | DIV (responding) | Yes | **Indeterminate** — div mutates text on click, but no semantic identity |
| int-20 | DIV (backdrop) | Yes | **Correctly rejected** on census fixture (no handler on backdrop div) |

### Valid / Invalid / Indeterminate classification

**VALID clicks that become Unclassified (the real problem):**
These are clicks on genuinely interactive custom elements where ALL four gates fail:
- React component using `<div onClick={...}>` with no `cursor:pointer`, no `role`, no `tabIndex`, no matching class regex, not inside an open selection surface, no QA auto-id
- This is the "MakeMyTrip A/C Sleeper" pattern: a `<div>` or `<span>` with a delegated click handler that triggers network activity, but zero structural affordance signals

**INVALID clicks correctly rejected:**
- Plain `<div>` with no handler, no affordance (int-16) — text selection, accidental clicks
- Per-key keydown on unfocused INPUT (int-5–14) — typing noise, not a discrete action

**INDETERMINATE clicks (the hard middle):**
- `responding-div` (int-17): DIV with no structural signals but DOM mutation evidence (`actionabilityEvidence=true`). Under inclusion-first: honest Unclassified with evidence flag. Under exclusion-first: would become Click — but locator is `//div` or `div.responding`, which is brittle and non-semantic.
- `BODY` click-away (int-15): B3 S4 deliberately captured this. Under exclusion-first: would become Click — but it's a dismissal gesture, not an action on a target element.

---

## §2 — Layer-by-Layer Change Impact

### Layer 1: Capture (event-tap.ts) — **NO CHANGE**
- `isTrusted` filter stays (INV-1)
- DomContext extraction stays
- Every trusted event enters the ledger regardless of classification
- This layer is already capture-first — exclusion-first doesn't change it

### Layer 2: Discovery / Claim (component-runtime.ts) — **SMALL CHANGE**
- `tryDiscovery` (line 656): iterates nonClickDefinitions first, then Click fallback
- **Current flow:** Click.detectTrigger → 4 inclusion gates → null? → event stays pending → Unclassified
- **Exclusion-first flow:** Click.detectTrigger → isProvablyInvalid? → reject : claim
- Change: rewrite `click.ts detectTrigger` from 4 inclusion gates to 1 exclusion check
- `tryDiscovery` itself doesn't change — Click is still the fallback definition at priority 180
- `createContext` doesn't change — Click still creates a ComponentContext the same way

**Files changed: 1** (`src/definitions/click.ts`)
**Lines changed: ~30** (replace 4 gates with 1 exclusion filter)

### Layer 3: Lifecycle / Absorption (component-runtime.ts) — **NO CHANGE**
- Click has `isInScope: false` (immediate completion, no lifecycle)
- Absorption only applies to definitions WITH lifecycles (Dropdown, DatePicker, Scroll)
- Click's immediate-completion shape means no lifecycle rewrite needed
- The 6F-M1 gesture ownership (mousedown→click pairing) works on elementKey, not on interaction type — compatible

### Layer 4: Deduplication (component-runtime.ts:940-982) — **MEDIUM RISK**
- Current: per-type dedup (same type + same element + within 2000ms)
- Under exclusion-first: more events become Click → more events in the Click dedup bucket
- **Risk:** rapid clicks on DIFFERENT elements within 2000ms would NOT be suppressed (dedup checks `elementKey` match — different elements = different keys = not duplicates). This is SAFE.
- **But:** the B3 S2 foldIntoPrior logic assumes the suppressed duplicate is the SAME type. If previously-Unclassified events (which had no dedup at all) now become Click, they enter the Click dedup bucket for the first time. The dedup window (2000ms) is per-type, so two Click events on the same element within 2000ms would fold — which is the correct behavior.
- **Net assessment:** dedup logic itself doesn't need changes, but the dedup behavior changes because more events are now Click-typed. Existing test pins on Unclassified counts would break.

### Layer 5: Projection Engine (projection-engine.ts) — **NO CODE CHANGE, BEHAVIORAL CHANGE**
- `createUnclassifiedFromLedger` is only called for ledger entries with disposition 'unclaimed' or 'pending'
- Under exclusion-first: fewer entries reach 'unclaimed' (more are claimed by Click)
- The Projection Engine code doesn't change — it's a pure function that reads dispositions
- But the OUTPUT changes: fewer Unclassified cards, more Click interactions

### Layer 6: Workflow Normalizer (workflow-normalizer.ts:71) — **NO CHANGE**
- Subsumption: Unclassified on same elementKey as a recognized interaction within gesture window → suppressed
- Under exclusion-first: fewer Unclassified cards → fewer subsumption candidates
- The subsumption logic itself is type-agnostic (checks `type !== 'Unclassified'` for recognized, `type === 'Unclassified'` for candidate) — it still works correctly, just has less to do

### Layer 7: isProductionInteraction (output-adapter.ts:43) — **NO CHANGE**
- Unclassified always returns true (capture guarantee v2)
- Under exclusion-first: fewer Unclassified reach this filter, but the filter code doesn't change

### Layer 8: IR Bridge (ir-bridge.ts) — **NO CODE CHANGE, BEHAVIORAL CHANGE**
- `NOISE_TYPES = {Scroll, Unclassified}` drops Unclassified before IR mapping
- Under exclusion-first: fewer Unclassified → fewer dropped → more Click IR steps
- The IR bridge code doesn't change — Click maps to CLICK in `INTERACTION_TO_IR_ACTION`
- But the OUTPUT changes: more CLICK steps in generated IR plans, some against elements with brittle locators

### Layer 9: Understanding Pipeline (understanding-pipeline.ts) — **BEHAVIORAL CHANGE**
- DDC-3 allowlist (line 587): `['Click', 'KeyboardShortcut', 'CompoundInteraction', 'Link', 'Expander', 'Modal']`
- Under exclusion-first: more events are Click → more events are eligible for reload attribution
- This is actually BETTER for attribution — fewer lost clicks
- But the episode builder uses `actionType = s.anchor.raw.type` (line 557) — if previously-Unclassified events are now Click, their episode anchor type changes
- KR signatureKey changes: `Unclassified|target` → `Click|target` — **this is the KR identity migration problem (D1)**

### Layer 10: KR / signatureKey (behavior-knowledge-mapper.ts) — **BREAKS D1 (vocabulary freeze)**
- `signatureKey(appId, actionType, normalizedTarget, anchorViewId)` — FROZEN at v1
- Changing `actionType` from `Unclassified` to `Click` is a KR identity migration
- All existing KR rows with `actionType=Unclassified` would no longer match new sessions
- Cross-session correlation breaks for any interaction that was previously Unclassified
- This is the SAME D1 issue that B4 explicitly closed — reopening it requires owner approval

### Layer 11: Understanding Badge (understanding-badge.ts:64) — **NO CODE CHANGE**
- Unclassified renders as `❓ Unclassified — reason`
- Under exclusion-first: fewer Unclassified cards → fewer badges rendered
- Code doesn't change

### Layer 12: sw-integration.ts (lines 1060-1082) — **NO CODE CHANGE**
- Unclassified-specific enrichment and evidence drain still runs for remaining Unclassified cards
- Fewer cards to process, but code paths are identical

---

## §3 — What Would Break

### Test pins that would break (MEDIUM count):
1. `tests/definitions/core-definitions.test.ts:140` — `expect(result[0].type).toBe('Unclassified')` for bare div → would now be `Click`
2. `tests/definitions/click-claim-affordance-7-4-m1.test.ts:82` — plain DIV with NEITHER → null (honest Unclassified pin) → would now return Click
3. `tests/definitions/click-claim-wb-7-3.test.ts:90` — rejects plain DIV with no QA instrumentation → would now return Click
4. All B3 census tests pinning Unclassified counts (14 Unclassified → fewer)
5. All B4 NOISE_TYPES tests pinning Unclassified drop behavior
6. E2E harness checks for Unclassified card counts

### Contracts that would break:
1. **D1 (vocabulary freeze)** — `actionType=Unclassified` → `actionType=Click` is a KR migration
2. **B3 S4 BODY capture** — BODY clicks would become Click instead of Unclassified (but B3 deliberately captured them as Unclassified for honest display)
3. **B3 census baselines** — all counts invalidated
4. **B4 D2 DROP** — fewer Unclassified to drop, but the policy still applies
5. **M5 self-consistency check** — still passes (every event is represented), but the type distribution changes

### What would NOT break:
1. EventTap capture (INV-1)
2. Ledger dispositions (INV-2)
3. Projection Engine (pure function)
4. Lifecycle/absorption (Click has no lifecycle)
5. B1–B5 definition claim logic (they fire before Click at priority < 180)
6. IR bridge code (Click → CLICK mapping unchanged)
7. Workflow normalizer subsumption (type-agnostic logic)
8. Dedup logic (per-type, elementKey-based — still correct)

---

## §4 — Three-Model Comparison

### Model A: Inclusion-first (current)
```
Trusted click → isInteractiveElement? → YES → Click
                                      → NO → isInsideOpenSelectionSurface? → YES → Click
                                                                          → NO → autoId? → YES → Click
                                                                                  → NO → cursor/handler? → YES → Click
                                                                                                        → NO → Unclassified
```
- **False positives:** LOW (must pass 4 gates)
- **False negatives:** MEDIUM (gate miss → visible Unclassified, fixable)
- **React compatibility:** MEDIUM (M1 affordance gate helps but doesn't catch everything)
- **Test quality:** HIGH (Click means "recognized interactive")
- **Locator quality:** HIGH (element passed interactivity gates)
- **KR safety:** HIGH (stable actionType vocabulary)
- **Implementation:** Already built and verified (B1–B5)

### Model B: Pure exclusion-first
```
Trusted click → isProvablyInvalid? → YES → reject (no interaction)
                                   → NO → Click (always)
```
- **False positives:** HIGH (any non-proven-invalid click retained)
- **False negatives:** LOW (only provably-invalid rejected)
- **React compatibility:** HIGH (no framework knowledge needed)
- **Test quality:** LOW (Click means "not-proven-non-interactive" — weaker semantic)
- **Locator quality:** LOW (may be `//div` against non-interactive elements)
- **KR safety:** LOW (previously-Unclassified → Click = KR migration)
- **Implementation:** Rewrite click.ts, break D1, update all test pins

### Model C: Hybrid (exclusion filter + semantic definitions + Click fallback)
```
Trusted click → isProvablyInvalid? → YES → reject
                                   → NO → tryDiscovery (semantic definitions first)
                                          → claimed? → typed interaction (Modal/Expander/etc.)
                                          → not claimed? → Click fallback → emit
```
- **False positives:** MEDIUM (deterministic filter catches clear cases, but non-proven-invalid non-interactive elements still pass)
- **False negatives:** LOW-MEDIUM
- **React compatibility:** HIGH
- **Test quality:** MEDIUM (Click means "not-rejected, not-semantic" — better than B but weaker than A)
- **Locator quality:** MEDIUM
- **KR safety:** LOW (same D1 issue as B)
- **Implementation:** Rewrite click.ts detectTrigger, break D1, update test pins

**Key insight:** Model C is functionally identical to Model B for Click typing. The only difference is that C preserves the semantic definition priority chain (B1–B5 definitions still claim first). But that's ALREADY how the current system works — the semantic definitions already fire before Click(180). The ONLY change in C vs A is rewriting Click.detectTrigger from inclusion to exclusion.

---

## §5 — Smallest Safe Migration Path

### Phase 0: Add deterministic invalidity signals to DomContext (ADDITIVE, ZERO RISK)
- Add `pointerEvents: string` (computed style `pointer-events` value) to DomContext
- Add `ariaHidden: boolean` to DomContext
- These are new fields, additive, no existing code changes
- `disabled` and `aria-disabled` are already captured

**Files changed: 2** (`dom-context-extractor.ts`, `component-types.ts` DomContext interface)
**Lines: ~10**
**Risk: ZERO** — additive fields, no behavior change

### Phase 1: Add invalidity filter to Click.detectTrigger (SMALL, LOW RISK)
- Insert a new check at the TOP of Click.detectTrigger:
  ```
  if (isProvablyInvalid(domContext)) return null;  // new rejection gate
  ```
- `isProvablyInvalid` checks: `disabled`, `aria-disabled`, `pointer-events:none`, `aria-hidden=true`
- THEN proceed with the existing 4 inclusion gates as before
- This is ADDITIVE to the current model — it rejects clicks that are PROVABLY invalid before they even reach the inclusion gates
- Net effect: a few more clicks correctly rejected (instead of passing inclusion gates incorrectly)

**Files changed: 1** (`click.ts`)
**Lines: ~15** (new function + one early-return)
**Risk: LOW** — only rejects provably-invalid clicks that currently might pass inclusion gates on `disabled` elements with `cursor:pointer` (edge case)

### Phase 2: Flip Click.detectTrigger from inclusion to exclusion (MEDIUM, BREAKS CONTRACTS)
- Replace the 4 inclusion gates with: `if (!isProvablyInvalid(domContext)) return { type: 'Click' };`
- Remove gates 1–4 entirely
- All previously-gate-rejected clicks now become Click

**Files changed: 1** (`click.ts`)
**Lines: ~30** (remove 4 gates, keep 1 exclusion check)
**Risk: HIGH** — breaks D1, changes Unclassified counts, changes KR signatures, changes IR output quality

**This is the phase that requires owner approval and D1 reopening.**

### Phase 3: Migrate KR signatures (LARGE, HIGH RISK)
- Recompute all existing KR rows where `actionType=Unclassified` → `actionType=Click`
- This is a one-time migration script
- After migration, new sessions and old sessions share the same `Click` actionType

**Risk: HIGH** — cross-session correlation depends on clean migration

### Recommended path: **Phase 0 + Phase 1 only**

Phase 0 + Phase 1 gives the exclusion-first model's safe benefits (rejecting provably-invalid clicks) without its dangerous costs (fabricating Click interactions for indeterminate elements). The inclusion gates remain as the qualification mechanism, now with an additional rejection layer on top.

Phase 2+ is only needed if the owner decides that the MakeMyTrip A/C Sleeper pattern (valid clicks on custom divs with zero structural signals) is a frequent enough problem to justify the KR migration and test pin churn. The B3 census evidence suggests this is RARE — the census fixture's `responding-div` is the only case, and it's an artificial test element, not a real-world pattern.

---

## §6 — Impact on B1–B5 Work

| Milestone | Impact of exclusion-first | Severity |
|-----------|--------------------------|----------|
| M1 affordance | Gate 4 (pointerCursor/clickHandler) becomes redundant — exclusion-first would claim these anyway. But Gate 4 is still useful for REJECTING (cursor:pointer on disabled element). | LOW |
| B1 Expander | No change — Expander claims at priority 80, before Click 180 | NONE |
| B2 Combobox | No change — TextEntry claims at priority 50, Dropdown at 20, both before Click 180 | NONE |
| B3 Capture completeness | S1 evidence drain: fewer Unclassified cards to drain. S2 dedup fold: more Click-typed events enter dedup. S3 typed-text: unchanged (keydown). S4 BODY: BODY clicks become Click instead of Unclassified. S5 actionabilityEvidence: fewer Unclassified cards to flag. Census baselines: ALL INVALIDATED. | MEDIUM |
| B4 Output policy | D2 DROP: fewer Unclassified to drop, but policy still applies. D1: REOPENED (actionType migration). | HIGH |
| B5 Modal | No change — Modal claims at priority 75, before Click 180 | NONE |

---

## §7 — Final Assessment

### Architecture change size: **SMALL code, MEDIUM impact, LARGE contract churn**

- **Code change:** 1 file (`click.ts`), ~30 lines — SMALL
- **Architecture impact:** Click typing changes, KR signatures change, IR output changes — MEDIUM
- **Contract churn:** D1 reopened, B3 census invalidated, B4 D2 affected, all Unclassified test pins break — LARGE
- **What can remain unchanged:** EventTap, ledger, projection engine, lifecycle/absorption, semantic definitions (B1–B5), workflow normalizer, IR bridge code, understanding pipeline code — ALL UNCHANGED
- **What breaks:** D1 vocabulary freeze, test pins, KR cross-session correlation, census baselines

### The honest truth about the asymmetry:

**Inclusion miss → visible Unclassified card → KR learning signal → owner can see and fix → fixable**
**Exclusion miss → silent Click IR step against nameless div → test replays to nothing → not fixable in post**

For a test-generation product, silently-wrong is worse than visibly-missing. The B3 census shows 0 invalid clicks (no genuinely interactive element was lost) and 1 indeterminate click (responding-div with no semantic identity). The exclusion-first model would trade 1 visible indeterminate card for N silent fabricated Click steps against non-interactive elements.

### Recommendation:

**Phase 0 + Phase 1** (additive invalidity signals + rejection gate) — SMALL, safe, no contract breakage.

**Phase 2+** (full exclusion-first) — only if the owner determines that valid clicks lost to inclusion gates are a real-world problem frequent enough to justify reopening D1, migrating KR signatures, and re-pinning all test suites. The B3 census evidence does not support this frequency.

The current inclusion-first model with M1 affordance gates already catches the most common React patterns (cursor:pointer, click handler attribute). The remaining gap is elements with delegated handlers and zero structural signals — which is a real but seemingly rare pattern.