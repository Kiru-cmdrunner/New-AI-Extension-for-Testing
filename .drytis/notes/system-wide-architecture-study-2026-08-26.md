# System-Wide Architecture Study — Capture-First / Understand-Later (2026-08-26)

Read-only research per owner directive. No code/tests/specs/commits/ZIPs modified.

## 0. The Owner's Vision

> "We should capture the user's actual interaction first rather than requiring the interaction to prove its semantic meaning at capture time. The system should then understand what the interaction means and determine whether it is valid/invalid using the available application evidence."

> "Evaluate how this should ultimately support our larger vision of understanding applications like a human and producing reliable semantic/replayable IR."

This aligns with the **already-approved architecture principles** in `.drytis/notes/agreed-architecture-principles.md`:
- Principle 3: "Bounded Broad Capture + Deferred Analysis" — "During recording, optimise for evidence completeness. After recording, optimise for meaningful knowledge."
- Principle 2: "Deterministic-First, AI Only When Required" — deterministic evidence first, AI last
- Principle 4: "Region-Aware Observation" — "DO NOT assume component type first. Preserve behavioral patterns as evidence first."
- Principle 10: "Temporary Rich Evidence → Consolidation" — rich during recording, semantic after

**The architecture was DESIGNED for capture-first. The current implementation contradicts its own approved principles at one specific point: `click.ts` detectTrigger.**

---

## 1. What the System Already Does Right (Retain)

### Capture Layer — Already capture-first ✓
- **EventTap** (`event-tap.ts`): every `isTrusted` event enters the ledger (INV-1: capture precedes classification). No semantic filtering at capture time.
- **EvidenceLedger** (`evidence-ledger.ts`): append-only, filters to `DISCRETE_ACTION_TYPES` (click, contextmenu, mousedown, keydown, dragstart, drop). Every discrete physical event is stored with full `ElementIdentity` + `DomContext` + `captureOrigin`.
- **EvidenceCollector** (`evidence-collector.ts`): opens evidence windows after meaningful events, captures DOM mutations (MutationObserver), target state before/after, surface changes, network activity, visibility changes. This is the "bounded broad capture" the architecture principles call for.
- **DomContext** (`dom-context-extractor.ts`): 12 fields captured synchronously — tag, role, className, ariaExpanded/HasPopup, ancestorRoles (10-deep), ancestorClasses, tabIndex, pointerCursor, clickHandler, disabled, readOnly, inputType, ariaAutoComplete, listId.

**This entire layer is already doing what the owner wants. No change needed.**

### Semantic Definition Layer — Already priority-ordered ✓
- 18 definitions (B1–B5 + pre-existing) ordered by priority. Click(180) is the universal fallback.
- Definitions like Expander(80), Modal(75), Dropdown(20), TextEntry(50) claim events they recognize, producing typed interactions.
- This layer is correct: it's a semantic refinement layer that fires before the fallback.

### Evidence/Understanding Layer — Already deferred analysis ✓
- Understanding Pipeline (M9.1–M9.7): runs at STOP time, not during recording
- Behavior Model (CP1–CP8): pure derivation layer that builds causal episodes from recorded interactions
- Enrichment: component detection, intent vocabulary, meaning resolution — all post-hoc
- KR: knowledge repository with cross-session signatures

**The understanding layer is designed to consume captured interactions and derive meaning. It's the right shape. But it receives FEWER interactions than it should because the capture layer's Click gate rejects valid clicks before they reach understanding.**

### IR/Replay Layer — Mostly correct ✓
- IR Bridge: maps interactions to IR actions, drops noise (Unclassified, Scroll)
- Execution IR: framework-neutral, resolved locators, assertions
- Playwright code generator: produces runnable tests
- The IR layer is correct in shape. Its quality problem is upstream: it only sees what classification let through.

---

## 2. The One Point Where the System Contradicts Its Own Design

### `click.ts:32-71` — Inclusion gates at capture time

```typescript
detectTrigger(event: ObservedEvent): ComponentTrigger | null {
  // Gate 1: isInteractiveElement(tag, ariaRole, className, tabIndex)
  // Gate 2: isInsideOpenSelectionSurface(ancestorRoles, ancestorClasses)
  // Gate 3: autoId || dataAutoId
  // Gate 4: pointerCursor || clickHandler
  // ALL FAIL → return null → Unclassified
}
```

**This is the ONLY point where the system requires an interaction to prove its semantic meaning at capture time.** Everywhere else, the system follows the "capture broadly, understand later" principle. But here, a click on a custom `<div>` with no ARIA role, no tabIndex, no matching class regex, no cursor:pointer, no onclick attribute, and no QA instrumentation is REJECTED — even though it's a real, trusted user click.

### What this causes in practice (AdaniOne evidence):

From `rca-adanione-custom-controls-2026-08-20.md`:
- "Nameless custom-widget elements (div/span/i; no role=button/option, no option class) match NO ComponentDefinition."
- "Run B Unclassified: EVERY logical click = mousedown card + click card pair."
- The recording produced Unclassified cards for: Round Trip toggle, Premium Economy selection, Chennai/Bangalore city selection, flight card clicks, date cell selections.
- These are ALL genuine user interactions with real consequences (DOM mutations, API calls, page transitions) that the system captured as evidence but classified as "unknown."

### What this causes on MakeMyTrip:
- Custom widget elements (div/span with delegated handlers) fall through all 4 gates
- Valid clicks become Unclassified → dropped from IR (NOISE_TYPES) → missing from generated test
- The recording is incomplete → the generated test doesn't reproduce the user's actual flow

---

## 3. The Real Problem: Not "Inclusion vs Exclusion" — It's "When to Classify"

The previous audits framed this as inclusion-first vs exclusion-first. That framing misses the point.

**The real problem is that classification happens at the WRONG TIME.** The system classifies clicks during recording (real-time, in the content script → SW pipeline) when it should be capturing them and classifying later (at STOP time, in the understanding pipeline).

The approved architecture principles already say this:
- Principle 3: "ALL correlation, noise filtering, region discovery, and interpretation are DEFERRED to deterministic analysis after the window closes."
- Principle 10: "During recording: multi-snapshot timeline, rich behavioral sequences, broad capture. After recording: analyze, extract semantic understanding."

But `click.ts` detectTrigger violates this principle by requiring positive proof of interactivity during the real-time classification pass.

---

## 4. Proposed Architecture: Capture-First Click (What Should Change)

### The Smallest Change That Fixes the Real Problem

**Change `click.ts` detectTrigger from 4 inclusion gates to 1 exclusion check:**

```typescript
// CURRENT (inclusion-first):
detectTrigger(event) {
  if (isInteractiveElement(...)) return { type: 'Click' };
  if (isInsideOpenSelectionSurface(...)) return { type: 'Click' };
  if (autoId || dataAutoId) return { type: 'Click' };
  if (pointerCursor || clickHandler) return { type: 'Click' };
  return null; // → Unclassified
}

// PROPOSED (capture-first with minimal exclusion):
detectTrigger(event) {
  if (isProvablyInvalid(event.domContext)) return null; // reject only deterministic invalidity
  return { type: 'Click' }; // retain all other trusted clicks
}
```

**Safe exclusion signals (deterministic, structural, captured at event time):**
- `disabled` / `aria-disabled="true"` (already in DomContext)
- `aria-hidden="true"` (needs DomContext field — additive)
- `pointer-events: none` (needs DomContext field — additive)

**That's it.** 3 deterministic exclusion signals. Everything else passes.

### What this means for the pipeline:

```
BEFORE (current):
  Trusted click → 4 inclusion gates → PASS? → Click(180)
                                   → FAIL? → Unclassified → NOISE_TYPES drops from IR

AFTER (proposed):
  Trusted click → isProvablyInvalid? → YES → reject (no interaction)
                                   → NO → Click(180) → semantic definitions refine if they match
                                                        → Click stays if no semantic match
                                                        → IR step produced for every valid click
```

### Why this is NOT a fundamental rewrite:

1. **click.ts**: Change 1 function (~30 lines). Replace 4 inclusion gates with 1 exclusion check.
2. **DomContext**: Add 2 fields (`pointerEvents`, `ariaHidden`) — additive, ~10 lines.
3. **Everything else stays**: EventTap, EvidenceLedger, EvidenceCollector, all 18 definitions, Projection Engine, Workflow Normalizer, IR Bridge code, Understanding Pipeline code, KR code.
4. **B1–B5 definitions**: Unchanged — they fire before Click(180) at priorities 5-80. They still claim their recognized patterns. Click is still the fallback.
5. **Lifecycle/absorption**: Click has `isInScope: false` (immediate completion, no lifecycle). No lifecycle rewrite.
6. **Dedup**: Per-type, elementKey-based. More Clicks → more dedup candidates, but the logic is correct. Different elements = different keys = not suppressed.

---

## 5. What Breaks and What Doesn't

### Breaks (MEDIUM):
1. **Test pins**: ~6-10 test files assert "bare div → Unclassified." These would now assert "bare div → Click." Need updating.
2. **B3 census baselines**: Unclassified counts change. Need re-baselining.
3. **D1 (KR vocabulary freeze)**: `actionType=Unclassified` → `actionType=Click` for previously-gate-rejected clicks. This is a KR signatureKey migration. But note: the B3 census showed 0 genuinely valid clicks lost — the KR impact is on previously-Unclassified cards that are now Click. Whether this matters depends on whether those cards had KR rows (they did, since `isProductionInteraction` preserves Unclassified, and the understanding pipeline processes them).

### Does NOT break:
1. **Capture pipeline**: EventTap, EvidenceLedger, EvidenceCollector — all unchanged
2. **Semantic definitions**: B1–B5 (Expander, Modal, Dropdown, TextEntry, DatePicker, etc.) — all unchanged, same priority
3. **Projection Engine**: Pure function, reads dispositions — unchanged
4. **Workflow Normalizer**: Type-agnostic subsumption — unchanged, just less work
5. **IR Bridge code**: Click → CLICK mapping — unchanged. But more CLICK steps produced (some against non-interactive elements — this is the honest trade-off)
6. **Understanding Pipeline code**: Unchanged — processes whatever interactions exist
7. **KR code**: signatureKey function — unchanged. But signatures change for previously-Unclassified anchors.
8. **Lifecycle/absorption**: Click has no lifecycle — unchanged
9. **Dedup logic**: Per-type, elementKey-based — unchanged, correct behavior preserved

---

## 6. The Honest Trade-Off

### What we GAIN:
1. **Every valid user click reaches the IR** — no more missing test steps for custom widgets
2. **Every valid user click reaches the understanding pipeline** — the behavior model can build causal episodes for ALL user actions, not just the ones that passed inclusion gates
3. **AdaniOne/MakeMyTrip pattern fixed** — custom div/span clicks are retained as Click, not lost as Unclassified
4. **Aligns with approved architecture principles** — "capture broadly, understand later"
5. **Aligns with product vision** — "understanding applications like a human" requires seeing ALL interactions

### What we LOSE:
1. **Some non-interactive clicks become Click** — clicks on plain divs that do nothing will produce Click IR steps that replay as no-ops. The test will have extra steps that don't do anything.
2. **Click no longer means "recognized interactive"** — it means "trusted user click." The semantic meaning is weaker. But the understanding/enrichment layer can RECLASSIFY post-hoc.
3. **KR signature identity** — previously-Unclassified anchors change actionType. D1 needs to be reopened (or the migration handled).

### Why the loss is acceptable:
- The product has a **Review & Edit step** in the user journey (product-foundation-design-v1.0.md §1): "User can delete steps (remove false positives)." False-positive clicks from non-interactive elements are REMOVABLE by the user.
- Missing valid clicks are NOT removable — you can't edit what isn't there. This is the asymmetry that matters for a test-generation product: **present-and-wrong (user can fix) vs absent-and-missing (user can't fix).**
- The evidence layer already captures DOM mutations, network activity, and state transitions for every click. The understanding pipeline can use this evidence to mark low-quality clicks for review.
- The enrichment layer (`component-detector.ts`, `meaning-resolver.ts`, `intent-vocabulary.ts`) can add semantic labels post-hoc. A click on a `div.responding` with DOM mutations and network activity can be labeled "Click on responding element" instead of just "Click on div."

---

## 7. The Larger Vision: Understanding Applications Like a Human

The owner's vision is "understanding applications like a human and producing reliable semantic/replayable IR." Here's how the capture-first model supports this:

### How a human tester works:
1. **Sees the user click something** (capture — no judgment yet)
2. **Watches what happens** (evidence — DOM changes, page transitions, API calls)
3. **Understands what the click meant** (semantic understanding — post-hoc)
4. **Decides if it's a valid test step** (validation — post-hoc)
5. **Writes the test step** (IR generation — post-hoc)

The current system does step 1 and step 2 correctly (EventTap + EvidenceCollector). But it tries to do step 3 at capture time (click.ts inclusion gates), which fails for custom widgets. And it drops the click entirely (Unclassified → NOISE_TYPES → IR drops it), so steps 4 and 5 never happen.

### The capture-first model:
1. **Capture every trusted click** (Click.detectTrigger: reject only provably-invalid)
2. **Evidence already collected** (EvidenceCollector: DOM mutations, network, state transitions)
3. **Understanding pipeline classifies post-hoc** (enrichment, behavior model, intent vocabulary)
4. **IR includes all clicks** (IR Bridge: Click → CLICK, no NOISE_TYPES drop for Click)
5. **Review & Edit** (user removes false positives, edits descriptions)

### What the understanding pipeline should do better (future work):
1. **Post-hoc semantic classification**: Instead of requiring classification at capture time, run the definition logic at STOP time against the full evidence record. A click on a `div` with DOM mutations + network activity can be classified as "Action" (not just "Click"). A click on a plain `div` with no evidence can be marked "likely no-op" for review.
2. **Evidence-based quality scoring**: Each Click carries behavioral evidence. The understanding pipeline can score click quality: high (DOM mutations + network + state transition), medium (some evidence), low (no evidence). Low-quality clicks get flagged for review.
3. **Intent resolution**: The intent vocabulary (`intent-vocabulary.ts`) matches element labels/className to intent labels ("Add to cart", "Search products"). This should run on ALL clicks, not just recognized ones. A click on a div with className "add-to-cart-btn" gets intent "Add to cart" even without role=button.
4. **Behavior model coverage**: The behavior model builds causal episodes from anchors. Currently, only recognized interactions are anchors (DISCRETE_ACTION_TYPES). With capture-first, ALL trusted clicks are anchors — the behavior model sees the complete user action sequence.
5. **AI-assisted understanding** (Principle 2): For clicks where deterministic evidence is insufficient, the AI layer (currently dead code) can hypothesize intent. This is the "AI only when all else fails" principle — and it only works if the click is PRESENT (not dropped as Unclassified).

### IR/Replay improvements:
1. **Locator quality**: The current inclusion gates don't improve locator quality — they just reject elements that don't pass the gates. A rejected element has the same locators (cssSelector, xPath, stableId) as an accepted one. The gates are about CLASSIFICATION, not LOCATOR resolution. So removing the gates doesn't make locators worse.
2. **Assertion generation**: The IR bridge's assertion derivation (`assertion-derivation.ts`) uses resulting-state evidence to produce assertions. With more clicks in the pipeline, more assertions can be generated. This is a net positive.
3. **Replay reliability**: A Click on a non-interactive div replays as a click on that div — which is what the user did. If the div does nothing, the replay click does nothing — which is honest. If the div does something (delegated handler), the replay click does the same thing — which is correct.

---

## 8. Incremental vs Fundamental — Final Assessment

### Size: SMALL code change, MEDIUM impact, MEDIUM contract churn

| Dimension | Assessment |
|-----------|-----------|
| Code change | **SMALL** — 1 file (`click.ts`), ~30 lines. Plus 2 additive DomContext fields. |
| Architecture change | **SMALL** — no new layers, no new concepts, no rewritten pipelines |
| Contract churn | **MEDIUM** — D1 KR migration, ~6-10 test pin updates, B3 census re-baseline |
| Lifecycle/dedup | **NO CHANGE** — Click has no lifecycle, dedup is per-type/elementKey |
| B1–B5 definitions | **NO CHANGE** — same priorities, same claim logic |
| Capture/evidence | **NO CHANGE** — already capture-first |
| Understanding/KR code | **NO CODE CHANGE** — processes whatever interactions exist |
| IR bridge code | **NO CODE CHANGE** — Click → CLICK mapping unchanged |

### Can it be introduced incrementally? YES.

**Phase 0** (additive, zero risk): Add `pointerEvents` and `ariaHidden` to DomContext.
**Phase 1** (small, low risk): Add `isProvablyInvalid()` rejection gate at the TOP of Click.detectTrigger, BEFORE the existing 4 inclusion gates. This rejects provably-invalid clicks while keeping the current inclusion model for everything else. Net effect: a few more clicks correctly rejected (disabled with cursor:pointer, aria-hidden elements).

**Phase 2** (medium, requires D1 decision): Replace the 4 inclusion gates with the single exclusion check. All previously-gate-rejected clicks now become Click. Requires:
- D1 KR migration (or acceptance that previously-Unclassified anchors become Click)
- Test pin updates (~6-10 files)
- B3 census re-baseline
- E2E harness re-verification

**Phase 2 is the breaking change.** Phases 0+1 are purely additive and safe. Phase 2 can be deferred until the owner is ready to accept the KR migration.

### Alternative: Don't change click.ts at all — fix it in the IR layer

Instead of changing Click.detectTrigger, change the IR Bridge to NOT drop Unclassified:

```typescript
// CURRENT:
const NOISE_TYPES = new Set(['Scroll', 'Unclassified']);
if (NOISE_TYPES.has(interaction.type)) continue;

// ALTERNATIVE:
const NOISE_TYPES = new Set(['Scroll']); // Unclassified no longer dropped
if (NOISE_TYPES.has(interaction.type)) continue;
// For Unclassified click events, map to CLICK:
if (interaction.type === 'Unclassified' && interaction.metadata.physicalEventType === 'click') {
  // produce a CLICK IR step
}
```

This is EVEN SMALLER (1 line change in ir-bridge.ts) and doesn't touch click.ts at all. The trade-off:
- Pro: Zero contract churn, zero test pin breaks, zero KR migration
- Pro: All valid clicks reach IR (the primary goal)
- Con: Unclassified cards still show in the panel (but with CLICK IR steps — the IR is complete)
- Con: The understanding pipeline still sees them as Unclassified (not Click) — so the behavior model anchors them differently

**This alternative is the smallest possible change that fixes the primary symptom (missing IR steps for valid clicks).** It doesn't fix the classification labeling (they're still "Unclassified" in the panel), but it does fix the generated test (all clicks produce IR steps).

---

## 9. Recommendation

### For the immediate problem (missing IR steps for valid clicks):
**IR layer fix** — remove Unclassified from NOISE_TYPES for click events. ~5 lines in ir-bridge.ts. Zero contract breakage. Fixes the primary symptom immediately.

### For the architectural alignment (capture-first classification):
**Phase 0 + Phase 1** — add deterministic exclusion signals to DomContext, add isProvablyInvalid() rejection gate. Additive, safe, no contract breakage. Improves the inclusion model without breaking it.

### For the full vision (when the owner is ready):
**Phase 2** — replace inclusion gates with exclusion check. Requires D1 decision, test pin updates, census re-baseline. This aligns the system with its own approved architecture principles and fixes the root cause for MakeMyTrip/AdaniOne/custom-widget patterns.

### For the larger product vision (understanding like a human):
**Future work** — post-hoc semantic enrichment for all retained clicks, evidence-based quality scoring, intent resolution on all clicks, AI-assisted understanding for indeterminate clicks. This builds on the capture-first foundation and requires the AI understanding layer (currently dead code) to be implemented.

---

## 10. What Should Be Retained Unchanged

| Layer | Retain? | Why |
|-------|---------|-----|
| EventTap | ✓ | Already capture-first (INV-1) |
| EvidenceLedger | ✓ | Append-only, DISCRETE_ACTION_TYPES filter is correct |
| EvidenceCollector | ✓ | Bounded broad capture is the right model |
| DomContext | ✓ (extend) | 12 fields correct, add 2 more |
| 18 definitions (B1–B5) | ✓ | Priority-ordered semantic refinement is correct |
| Projection Engine | ✓ | Pure function, correct shape |
| Workflow Normalizer | ✓ | Subsumption is correct |
| Understanding Pipeline | ✓ | Deferred analysis is correct |
| Behavior Model (CP1–CP8) | ✓ | Pure derivation is correct |
| KR / signatureKey | ✓ (code) | Function correct; actionType assignment may change |
| IR Bridge | ✓ (code) | Click → CLICK mapping correct; NOISE_TYPES may change |
| Execution IR | ✓ | Framework-neutral design is correct |
| Playwright generator | ✓ | Code generation is correct |
| Product foundation | ✓ | User journey with Review & Edit step is the safety net |

**The system's architecture is fundamentally sound. The problem is one function in one file that gates capture-time classification too tightly. The fix is small and incremental.**