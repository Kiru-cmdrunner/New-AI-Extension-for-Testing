# Layer 4 — Capability Inference Audit (deff878)

Audit performed exclusively against `/workspace/tmp/deff878-audit` at commit deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8.

## Intended Behavior

The Capability Engine infers **semantic application capabilities** from recorded user interactions. It runs as a **batch post-recording** process (after `stopRecording()`). The goal is to answer "what did the user DO in terms of application function" — not just "what DOM element was clicked."

**13 CapabilityType:** FilterSelection, SortSelection, Search, Navigate, SubmitForm, SelectOption, ToggleControl, ExpandCollapse, OpenDetail, UploadFile, Paginate, AdjustValue, Unclassified.

**Architecture:** 1:1 mapping (one interaction → one capability). 12 independent rules evaluate evidence for each interaction. Conflict resolver picks the winning claim. Runs on `productionInteractions` only (after filtering out noise/no-ops).

**Evidence streams (5):** keyword, physical-type, behavioral, structural, sequence.

**Confidence tiers:** HIGH (required + 2+ supporting, 1+ non-keyword), MEDIUM (required + 1 supporting, or direct-property M2), LOW (required + 0 supporting). LOW-only claims → Unclassified wins (rule 4).

## Actual Behavior — Data Flow

```
stopRecording() → allInteractions
  → normalizeWorkflow (subsumption filter)
  → filterProductionInteractions (removes no-ops)
  → runCapabilityInference(productionInteractions)
    → buildEffectsMap (from behavioralObservations[].semanticEffects[])
    → createCapabilityEngine() with 12 rules
    → engine.inferCapabilities(interactions, effectsMap)
      → for each interaction: extractEvidence → run 12 rules → resolveClaims → buildRecord
    → filter out Navigation records
  → serializeCapabilityRecords → persist to chrome.storage.local
```

**Output:** SerializableCapabilityRecord[] persisted to `capability_records` storage key. Used ONLY for side-panel display. NOT passed to IR Bridge, NOT passed to Repository V2 persistSession (capability: null).

## The 12 Capability Rules

### Physical-Evidence Rules (Phase 2)

| # | Rule | Priority | Required Signal | Confidence | What It Detects |
|---|------|----------|-----------------|------------|-----------------|
| 1 | **ToggleControl** | 20 | `hasStateToggle` SemanticEffect | HIGH if isCheckboxLike + directProperty | Checkbox/radio/switch toggle via aria-checked/pressed/checked change |
| 2 | **ExpandCollapse** | 20 | `hasExpandCollapse` SemanticEffect | HIGH if isClick/Link + directProperty | Accordion/menu expand/collapse via aria-expanded change |
| 3 | **UploadFile** | 10 | `isFileInput` (physical) | Always HIGH | `<input type="file">` — definitive physical type |

### Navigation Rules (Phase 3)

| # | Rule | Priority | Required Signal | Confidence | What It Detects |
|---|------|----------|-----------------|------------|-----------------|
| 4 | **OpenDetail** | 10 | URL path changed + item-specific URL pattern, OR trigger href is item-specific | HIGH if preceded by list context + Link/Click | Product detail drill-down (detects /dp/, /product/, /item/, UUID, ASIN patterns) |
| 5 | **Navigate** | 30 | `urlPathChangedAfter` (path changed, not just query params) | HIGH if 2+ non-keyword supporting | Page-to-page navigation |
| 6 | **Paginate** | 25 | Pagination keyword ("next page", "load more", "›", etc.) + no URL change | HIGH if 2+ non-keyword supporting | Results pagination — same page, items added |

### Content-Change Rules (Phase 4)

| # | Rule | Priority | Required Signal | Confidence | What It Detects |
|---|------|----------|-----------------|------------|-----------------|
| 7 | **FilterSelection** | 35 | Remote content-change/visibility-change + ≥1 filter-specific signal (keyword/ancestor/negative delta) | HIGH if keyword + 1 non-keyword | Result narrowing via sidebar filters, facets |
| 8 | **SortSelection** | 40 | Remote content-change + sort keyword OR Dropdown type | HIGH if keyword + 1 non-keyword | Result reordering via sort controls |
| 9 | **Search** | 30 | TextEntry type + ≥1 search signal (keyword/behavioral/structural) | HIGH if keyword + 1 non-keyword or 2+ non-keyword | Search query entry with results follow-up |

### Form/Value Rules (Phase 5)

| # | Rule | Priority | Required Signal | Confidence | What It Detects |
|---|------|----------|-----------------|------------|-----------------|
| 10 | **SubmitForm** | 25 | Click on submit-type element/keyword + preceded by form interaction on same page | HIGH if keyword + 1 non-keyword or 2+ non-keyword | Form submission (login, search, checkout) |
| 11 | **SelectOption** | 50 | Dropdown type + NO remote effect | HIGH if keyword + 2 non-keyword | Plain dropdown selection (quantity, country, etc.) — residual rule |
| 12 | **AdjustValue** | 22 | isSliderLike + userAdjusted=true | HIGH if keyword + 1 non-keyword or 2+ non-keyword | Slider/spinbutton adjustment |

## Correctness Analysis

### What Works Well

1. **Conflict resolver** (6 rules) is well-designed: confidence > signal count > priority, LOW-only → Unclassified, direct-property tiebreaker.
2. **Evidence extractor** provides clean separation — rules consume ExtractedEvidence, not raw interactions.
3. **"Paginate correction principle"** applied across rules: remote content-change alone is never sufficient — each rule requires its own specific signal. This prevents over-claiming.
4. **Navigation exclusion** — Navigation interactions are excluded from output (they're consequence events) but retained for sequence evidence. Correct.
5. **URL path vs query param distinction** — Navigate and OpenDetail use `urlPathChangedAfter` (path only), while FilterSelection/SortSelection use query-param changes as same-page evidence. Correct.
6. **SubmitForm form-context scan** — scans backward on same page for any form interaction type (TextEntry, Dropdown, Checkbox, Slider). Handles forms filled with only dropdowns.
7. **SelectOption as residual** — only fires when Dropdown has no remote effect, letting Filter/Sort claim first via priority. Correct design.
8. **AdjustValue** correctly requires `userAdjusted=true` from metadata, filtering out focus-traversal.

### Critical Gap: Behavioral Evidence Dependency

4 of 12 rules **require** SemanticEffects (behavioral evidence):
- ToggleControl: `hasStateToggle` required
- ExpandCollapse: `hasExpandCollapse` required
- FilterSelection: remote content-change/visibility-change required
- SortSelection: remote content-change required

Per Layer 1 audit (1B-C-1): observation windows only open for click and change events. 70%+ of interaction types get ZERO behavioral evidence. These 4 rules are **completely inoperable** for any interaction whose trigger event is not click or change.

Even for click-triggered interactions, the behavioral evidence depends on the 3-second observation window capturing the relevant DOM mutations. The Effect Interpreter (Layer 3 semantics) must then correctly classify those mutations as state-toggle, expand-collapse, content-change, or visibility-change.

### Dead Keyword Signal in 4 Rules

ToggleControl, ExpandCollapse, OpenDetail, and UploadFile check for their own keywords in `evidence.keywords.matches`, but their capability types are NOT in the KEYWORD_DICTIONARY. The dictionary has 8 categories; these 4 rules scan matches from OTHER categories for their own keywords. None of their specific keywords ('enable', 'disable', 'on', 'off', 'toggle', 'show', 'hide', 'more', 'less', 'details', 'expand', 'collapse', 'detail', 'product', 'item', 'view', 'open', 'upload', 'browse', 'attach', 'file') appear in any dictionary entry. The keyword supporting signal in these rules is **dead code** — it will never fire.

Exception: UploadFile checks for 'choose' which IS in SelectOption's keyword list. This is an accidental cross-category match.

### Does It Classify Real Application Capabilities?

**No.** The capability engine classifies **UI interaction patterns**, not business capabilities:

- "Add to Cart" → Unclassified (no SubmitForm because no preceding TextEntry on same page in many e-commerce flows)
- "Remove from Cart" → Unclassified
- "Apply Coupon Code" → potentially SubmitForm (if preceded by TextEntry)
- "Write Review" → potentially TextEntry (classified by interaction type, not capability)
- "Add to Wishlist" → Unclassified
- "Share Product" → Unclassified

The 12 capability types describe **how** the user interacted (toggled, selected, navigated, searched) — not **why** (what business function they performed). There is no concept of "Add to Cart capability" or "User Registration capability."

The target architecture (capability-model-final-architecture.md) describes a 3-tier model (Deterministic → Interpretive AI → Persistent Knowledge Repository) and a Capability Entity domain model. At deff878, only Tier 1 (deterministic) exists, and its output is disconnected from the domain model.

## Technical Debt / Issues

### 🔴 CRITICAL

**4-C-1: Capability output is display-only — not connected to generation or persistence**
- `runCapabilityInference()` output is persisted to `capability_records` storage key.
- The side panel reads this key for display (sidepanel.ts line 720).
- `persistSession()` receives `capability: null` (line 356).
- IR Bridge does not receive capability records.
- The entire capability inference is a **side-show** — it produces metadata for the side panel but does not influence test generation, repository persistence, or any downstream decision.
- **Impact:** The capability engine's entire 2,722 LOC produces display-only data.

**4-C-2: 4 of 12 rules are inoperable without behavioral evidence — which 70%+ of interactions lack**
- ToggleControl, ExpandCollapse, FilterSelection, SortSelection all require SemanticEffects.
- Per Layer 1 audit: observation windows only open for click+change events.
- Per Layer 0 audit: 7 of 14 definitions trigger on events that don't open observation windows.
- **Impact:** Checkbox toggles, accordion expansions, filter selections, and sort operations that trigger on non-click/non-change events will NEVER produce ToggleControl/ExpandCollapse/FilterSelection/SortSelection capabilities. They default to Unclassified.

**4-C-3: Keyword signal is dead code in 4 rules — ToggleControl, ExpandCollapse, OpenDetail, UploadFile**
- These 4 rules check `evidence.keywords.matches` for their own specific keywords.
- Their capability types are NOT in the KEYWORD_DICTIONARY (only 8 of 12 types are).
- Their specific keywords ('toggle', 'expand', 'collapse', 'detail', 'product', 'upload', etc.) do not appear in any dictionary category.
- The keyword supporting signal will NEVER fire for these rules.
- **Impact:** These rules can never reach HIGH confidence via keyword support. ToggleControl/ExpandCollapse max out at MEDIUM (behavioral + physical only). OpenDetail maxes at MEDIUM (sequence + physical). UploadFile is always HIGH regardless (physical type is definitive).

**4-C-4: Engine classifies UI interactions, not application capabilities**
- The 12 capability types describe interaction patterns (toggle, select, navigate, filter), not business functions (add to cart, register, checkout, review).
- "Add to Cart" produces Unclassified. "Login" produces SubmitForm (if preceded by text entry) but could equally be SubmitForm for "Search" or "Apply Coupon."
- No mapping from interaction → business intent exists at deff878.
- The target architecture (capability-model-final-architecture.md) envisions a Capability Entity domain model with ApplicationKnowledgeFragment. This is entirely unimplemented and disconnected.

### 🟠 HIGH

**4-H-1: 'search' and 'find' appear in BOTH SubmitForm and Search keyword categories**
- SubmitForm keywords: `'search', 'find'` (line 77-78 of keyword-dictionary.ts).
- Search keywords: `'search', 'find', 'lookup', 'query', 'go'`.
- When a search box has "search" in its label, matchKeywords returns BOTH a SubmitForm match and a Search match.
- If the user types in a search box and then clicks a "Search" button: SubmitForm (Click + keyword + preceded by TextEntry) and Search (TextEntry + keyword) both claim.
- Conflict resolver resolves per-interaction, so the TextEntry gets Search and the button click gets SubmitForm. This is CORRECT but fragile — the shared keywords create unnecessary claim competition.

**4-H-2: matchKeywords uses substring matching — false positives from common words**
- `haystack.includes(kw.toLowerCase())` — substring, not word-boundary.
- 'go' (Search keyword) matches inside 'logo', 'ergonomics', 'good', 'google', 'forgot'.
- 'on' (ToggleControl dead-code check, but also appears in 'condition', 'account', 'dashboard') — though this check never fires, it illustrates the substring issue.
- 'make' (SelectOption) matches inside 'maker', 'makefile', 'smokescreen'.
- 'save' (SubmitForm) matches inside 'savings', 'saved-searches'.
- **Impact:** Over-matching produces false keyword signals, inflating confidence on wrong capabilities.

**4-H-3: precededByListContext is too narrow — only checks previous interaction**
- `precededByListContext`: previous interaction type is TextEntry, Dropdown, or Checkbox.
- A list context that ended 2+ interactions ago (e.g., search → wait → scroll → click product) is NOT detected.
- Only checks the IMMEDIATELY preceding interaction.
- **Impact:** OpenDetail loses list-context support in multi-step flows.

**4-H-4: precededByFormInteraction scans backward indefinitely on same page**
- Scans from `index-1` to `0` until a different-page URL is found.
- A form interaction 50 interactions ago on a long single-page-app counts as "preceded by form interaction."
- **Impact:** On long SPA sessions, SubmitForm can claim for clicks that are far removed from any form field, as long as they're on the same URL.

**4-H-5: isSubmitType includes heuristic "submit" in accessible name**
- `trigger.accessibleName?.toLowerCase().includes('submit')` — matches "Submit Order", "Submit Form", but also "Submit Feedback" (different business intent).
- Also matches elements where 'submit' appears as a substring of another word (unlikely but possible).
- **Impact:** Low precision for submit-button detection.

**4-H-6: netNodeDelta aggregation is lossy**
- `netNodeDelta` sums all content-change effects' deltas. If one effect adds 5 nodes and another removes 3, the net is +2.
- SortSelection checks `Math.abs(delta) <= 3` — but sort can cause re-renders with node churn (remove all + re-add all = net 0 but massive DOM activity).
- FilterSelection checks `delta < 0` — but a filter that adds items (expand result set) would have positive delta and miss the signal.
- **Impact:** Node delta is a noisy signal for distinguishing sort vs filter vs pagination.

**4-H-7: OpenDetail hasItemSpecificUrl false positives**
- UUID regex: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` — matches a full UUID path segment. Correct.
- ASIN regex: `/^[A-Z0-9]{10}$/` — matches any 10-char uppercase alphanumeric. Could match short hash-based path segments unrelated to products.
- Slug regex: `seg.length > 8 && /[-_](?:prod|sku|id)\d+/i` — requires prod/sku/id in segment. Reasonable.
- `/dp/`, `/product/`, `/item/` prefixes — reasonable but miss many real product URL patterns (e.g., `/p/12345` where 12345 is numeric).

**4-H-8: Paginate rule requires keyword match — icon-only pagination invisible**
- Pagination controls using only icons (›, ‹, «, ») are in the keyword dictionary.
- But pagination using custom SVG icons without text labels produces no keyword match.
- **Impact:** Icon-only pagination buttons (common in modern SPAs) are invisible to Paginate → Unclassified.

### 🟡 MEDIUM

**4-M-1: No capability rule for Hover interactions**
- Hover is a production interaction (if metadata.meaningful=true).
- No rule targets Hover as a physical type.
- Meaningful hovers (tooltip reveal, mega-menu navigation) are always Unclassified.

**4-M-2: No capability rule for Tab interactions**
- Tab is a production interaction (role="tab" click).
- No rule targets Tab as a physical type.
- Tab panel switches are always Unclassified.

**4-M-3: No capability rule for Checkbox interactions specifically**
- ToggleControl requires `hasStateToggle` SemanticEffect.
- A Checkbox interaction type doesn't automatically mean ToggleControl — the behavioral evidence must confirm a state change.
- If observation didn't capture the aria-checked/checked change (Layer 1 gap), the checkbox click is Unclassified despite being classified as Checkbox by the runtime.

**4-M-4: No capability rule for DatePicker/ColorInput interactions**
- DatePicker and ColorInput are production interaction types.
- No rule targets them.
- They default to Unclassified unless a generic rule (like SelectOption for DatePicker-as-Dropdown) happens to match.

**4-M-5: No capability rule for Link interactions specifically**
- Links can be Navigate, OpenDetail, Paginate, or SubmitForm depending on context.
- But a plain link click with no URL change (same-page anchor, SPA route) and no keyword → Unclassified.

**4-M-6: SelectOption automatically grants physical-type supporting signal (line 86-87)**
- `streams.add('physical-type'); supportingCount++;` unconditionally for Dropdown type.
- Combined with "no remote effect" behavioral signal (line 80-83), SelectOption starts at 2 supporting.
- This means SelectOption is always at MEDIUM minimum (2 non-keyword supporting = 2, which triggers `supportingCount >= 1` → medium).
- Actually: keyword + 2 non-keyword = HIGH. No keyword + 2 non-keyword = medium. This is correct but the unconditional physical-type signal inflates the count.

**4-M-7: Conflict resolver Rule 5 (direct-property tiebreaker) operates only within top confidence tier**
- `const topTier = sorted.filter(c => c.confidence === topConfidence)`.
- If a direct-property MEDIUM claim competes against a keyword-based HIGH claim, the direct-property evidence is NOT considered — HIGH beats MEDIUM by Rule 1 regardless of evidence quality.
- This is correct by design but means direct-property evidence can't overcome confidence-tier boundaries.

**4-M-8: EffectsMap built only from behavioralObservations[].semanticEffects[]**
- If behavioral observations were lost (SW restart, orphaned keys), effectsMap.get(id) returns undefined → effects = [].
- All behavioral evidence fields are false/null.
- Rules requiring behavioral evidence silently return null.
- **Impact:** SW restart can silently degrade capability inference without any error or warning.

**4-M-9: keyword matching creates cross-contamination via shared words**
- 'search' in both SubmitForm and Search.
- 'find' in both SubmitForm and Search.
- 'choose' in SelectOption (accidentally used by UploadFile).
- When matchKeywords runs, a single text signal can match multiple categories, producing competing claims.

**4-M-10: isCheckboxLike uses `&&` and `||` without parentheses**
- `trigger.ariaRole === 'checkbox' || trigger.tag === 'INPUT' && (inputType === 'checkbox' || inputType === 'radio')`
- JS operator precedence: `&&` binds tighter than `||`.
- So this is: `ariaRole === 'checkbox' || (tag === 'INPUT' && (inputType === 'checkbox' || inputType === 'radio'))` — actually correct due to precedence.
- But fragile — adding a third condition without parentheses would change semantics.

### 🟢 LOW

**4-L-1: No capability types for common e-commerce actions (Add to Cart, Checkout, Wishlist, Review)**
- The 12 types cover generic UI patterns. No domain-specific capabilities.
- This is a known architectural limitation — the target model has a separate Capability Entity layer.

**4-L-2: buildSequenceNotes only reports 4 of 14 sequence fields**
- Doesn't report precededByFormInteraction, precededByListContext, hasNextItemSpecificUrl, triggerHasItemSpecificHref, urlPathChangedAfter, precededByTextEntryOnSameForm.
- Diagnostic value of capability records is reduced.

**4-L-3: parameters always contains only `target` (accessible name)**
- No `scope` or `value` parameters ever populated by any rule.
- CapabilityRecord.parameters is documented as supporting {target, scope, value} but only target is used.

**4-L-4: reason strings include implementation details (effect descriptions)**
- ToggleControl reason: "state-toggle effect present (aria-checked true→false)".
- Open for the user to see in side panel — mixes diagnostic and user-facing language.

**4-L-5: UploadFileRule hasDirectProperty = false despite being definitive**
- The comment says "no M2 direct property for file uploads" — technically correct (no SemanticEffect), but the physical type IS definitive evidence.

**4-L-6: NavigateRule reason includes nextUrl verbatim**
- May expose sensitive URL parameters in side-panel display.

**4-L-7: filterProductionInteractions runs BEFORE capability inference**
- Abandoned/interrupted interactions (which have ledger entries) are excluded from capability inference.
- Their ledger entries still exist but the capability engine never sees them.
- Correct by design (only deliberate actions get capabilities) but means no capability record exists for failed interactions.

## Test Coverage

Substantial test suite: 7 phase test files (5,396 LOC total) + capabilities.test.ts (89 LOC) + capability-matching-service.test.ts (507 LOC) + domain/capability.test.ts (524 LOC).

| Phase | Tests | Coverage |
|-------|-------|----------|
| Phase 1 (core infrastructure) | Engine, conflict resolver, evidence extractor | 827 LOC |
| Phase 2 (physical rules) | ToggleControl, ExpandCollapse, UploadFile | 663 LOC |
| Phase 3 (navigation rules) | Navigate, OpenDetail, Paginate | 702 LOC |
| Phase 4 (content-change rules) | FilterSelection, SortSelection, Search | 701 LOC |
| Phase 5 (form/value rules) | SubmitForm, SelectOption, AdjustValue | 642 LOC |
| Phase 6 (engine integration) | End-to-end inference | 565 LOC |
| Phase 7 (real-world validation) | Amazon, Avis Ford scenarios | 641 LOC |

**Gaps in test coverage:**
- No test for behavioral-evidence-missing scenarios (all tests provide effects).
- No test for dead-keyword-signal behavior (tests may mock keywords directly).
- No test for capability output being disconnected from persistSession.
- No test for keyword substring false positives.
- capability-matching-service.test.ts and domain/capability.test.ts test the INACTIVE System B (domain entities) — they pass but the code they test is never called in production.

## Summary

The Capability Engine is **well-engineered internally** — clean separation of concerns, deterministic rules, principled conflict resolution, good test coverage. The engine correctly implements its design.

However, it has four critical structural problems:

1. **Display-only** (4-C-1): 2,722 LOC of inference produces metadata that never influences test generation or persistence.
2. **Evidence-starved** (4-C-2): 4 of 12 rules are inoperable for most interactions because observation windows don't capture behavioral evidence for them.
3. **Dead keyword signals** (4-C-3): 4 rules have keyword checks that can never fire because their capability types aren't in the dictionary.
4. **Wrong abstraction level** (4-C-4): It classifies UI interaction patterns (how), not application capabilities (why). "Add to Cart" is Unclassified.
