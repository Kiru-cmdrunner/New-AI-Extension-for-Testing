# Capability Model — Finalized Architecture & Complete Implementation Plan

**Status**: Design finalized — approved for implementation
**Date**: 2026-08-05
**Branch**: m1-m2-complete (from 17714c1)

---

## PART I — FINALIZED ARCHITECTURE

All decisions from the design discussion, the Google Docs review, and the
four-example stress test are incorporated below. Where any earlier statement
conflicts with this document, **this document is canonical**.

---

### 1. Capability Definition and Boundary

**The Capability Model identifies what application/UI capability was exercised
based on observable recording evidence — physical interaction + observable
application effects + structural/sequence context.**

It does NOT:
- Rename or reclassify the physical interaction (ComponentInteraction stays immutable)
- Speculate about user intent or goals
- Compose multi-step workflows
- Generate assertions or natural language test steps
- Require an LLM or any non-deterministic reasoning

The Capability Model adds a **semantic label with evidence trail** as metadata
alongside each ComponentInteraction. The physical interaction remains the source
of truth for replay. The capability record is the source of truth for meaning.

---

### 2. V1 Taxonomy — 12 types + Unclassified

| Type | Core meaning | Required behavioral signal |
|---|---|---|
| FilterSelection | Narrow a result set by a criterion | content-change or visibility-change on a DIFFERENT element than the control |
| SortSelection | Change ordering of a result set | content-change on a results container (keyword + physical type distinguish from filter) |
| Search | Enter query text to find matching content | TextEntry physical type + content-change or navigation follows |
| Navigate | Move to a different page/view | URL/route change detected |
| SubmitForm | Submit form data to the application | Click on submit-type element + preceded by TextEntry on same form |
| SelectOption | Choose a value from a list of options | Dropdown selection completed + no filter/sort/paginate pattern matched |
| ToggleControl | Switch a binary state on/off | state-toggle effect (direct property: aria-checked, aria-pressed) |
| ExpandCollapse | Show/hide content in place | expand-collapse effect (direct property: aria-expanded, details open) |
| OpenDetail | Drill into a specific item's details | navigation to item-specific URL + preceded by list context |
| UploadFile | Provide a file to the application | FileUpload physical type (definitive) |
| Paginate | Move to next/previous page of results | content-change on results + keyword/physical pagination signal |
| AdjustValue | Set a numeric/range value (slider, spinbutton) | Slider/spinbutton type + userAdjusted=true |
| Unclassified | Insufficient evidence to classify | (fallback — always produces a record) |

---

### 3. Required vs Supporting Signals — THE KEY DESIGN PRINCIPLE

This is the most important architectural decision, validated against four
real-world stress-test cases. Every capability rule separates signals into
two tiers:

**Required signals**: ALL must be present for the rule to claim at all.
If any required signal is missing, the rule returns null — no claim, regardless
of how many keywords match.

**Supporting signals**: Each one present boosts confidence (LOW → MEDIUM → HIGH).
When absent, confidence drops but the rule still fires (at reduced confidence).
No supporting signal is ever mandatory.

**Critical rule**: No signal that depends on application implementation details
(framework, rendering strategy, class naming, node counts) is ever a required
signal. Implementation-dependent signals are always supporting.

#### Required vs Supporting per capability

| Capability | Required (ALL must be true — framework-agnostic) | Supporting (each boosts confidence — may be absent) |
|---|---|---|
| FilterSelection | content-change OR visibility-change on a DIFFERENT element than the control | keyword "filter/refine/brand", Checkbox type, effect target recognized as results container, ancestor has "filter" context |
| SortSelection | content-change on a results container | keyword "sort/price/order", Dropdown type, netNodeDelta ≈ 0, items appear reordered |
| Search | TextEntry on a search-labeled input | keyword "search/find", content-change or navigation follows, results container updated |
| Navigate | URL/route change detected | keyword "home/back/next", Link type, page title changed |
| SubmitForm | Click on submit-type element + preceded by TextEntry on same form | keyword "submit/sign in/save", form element present, navigation or error message follows |
| ToggleControl | state-toggle effect (direct property) | keyword "enable/disable", Checkbox type |
| ExpandCollapse | expand-collapse effect (direct property) | keyword "show/hide/more/less", element was in collapsed state before |
| OpenDetail | navigation to item-specific URL + preceded by list/search context | URL contains item identifier, source page was search/list |
| UploadFile | FileUpload physical type | keyword "upload/choose", file metadata captured |
| Paginate | content-change on results container + keyword or physical pagination signal | keyword "next/previous page", button at bottom of results, different items shown |
| AdjustValue | Slider/spinbutton type + userAdjusted=true | keyword "price/range/quantity", content-change on results |
| SelectOption | Dropdown selection completed + NO other capability rule claimed above LOW | keyword "select/choose", value selected, no results container changed |

---

### 4. Confidence Model

| Tier | When assigned |
|---|---|
| HIGH | Required signals met + 2+ supporting signals (at least 1 non-keyword) |
| MEDIUM | Required signals met + 1 supporting signal, OR required signals from direct-property M2 evidence |
| LOW | Required signals met + 0 supporting signals |

**Rules:**
1. Direct property evidence (aria-checked, aria-expanded, details open) is never downgraded by window noise.
2. Keyword alone never produces above LOW.
3. Physical type is a supporting signal (Checkbox → toggle/filter plausible, but not definitive).
4. Multiple supporting signals from different streams count more than multiple from the same stream.
5. When evidence genuinely doesn't support HIGH, the model produces MEDIUM, LOW, or Unclassified — never inflated.

---

### 5. netNodeDelta — Supporting Signal, Not Required

**Design**: netNodeDelta (addedNodesCount − removedNodesCount per affected path) is computed by M1, carried in M2's content-change SemanticEffect, and consumed as a **supporting signal** for SortSelection.

**Why supporting, not required** (validated against four examples):
- Example 1: Filter with netNodeDelta = 0 (React replaces 20 cards with 20 different cards). If netNodeDelta ≈ 0 were required for SortSelection AND definitive, this filter would be misclassified. As supporting signal, SortSelection claims LOW (no keyword, no Dropdown type) and loses to FilterSelection.
- Example 2: Sort with netNodeDelta ≠ 0 (framework rebuilds subtree with extra wrapper nodes). If netNodeDelta ≈ 0 were required, this sort would be missed. As supporting signal, SortSelection still fires HIGH from keyword "sort" + Dropdown + content-change.

**When netNodeDelta helps**: ambiguous cases where keyword evidence is weak or absent. A Dropdown labeled "View" with content-change on results — netNodeDelta ≈ 0 tips toward SortSelection (MEDIUM) vs FilterSelection (LOW).

**When netNodeDelta is ignored**: whenever SortSelection already has 2+ supporting signals from other sources (keyword + physical type). The delta simply isn't needed.

---

### 6. Results-Container Detection — Supporting Signal, Not Required

FilterSelection requires "content-change on a DIFFERENT element." Recognizing
that element as a results container (via role="list", class containing
"result"/"grid", etc.) is a **supporting signal**.

When the container is unrecognized (e.g., `<div class="x7a91">`):
- FilterSelection claims LOW (required met, no supporting container evidence)
- ToggleControl or SelectOption typically claims MEDIUM+ from direct property evidence
- Conflict resolution gives the higher-confidence claim
- The Unclassified fallback fires if nothing claims above LOW

This is honest behavior — the model does not pretend to recognize a results
container when it has no evidence that it IS one.

---

### 7. Conflict Resolution

1. **Highest confidence wins.** HIGH beats MEDIUM beats LOW.
2. **If same confidence**: most supporting signals wins (count distinct streams).
3. **If still tied**: lowest priority number wins (more specific rule).
4. **If only LOW claims exist**: Unclassified wins. The LOW claims go to alternatives.
5. **Behavioral evidence beats keyword evidence** when they conflict (required > supporting).
6. **The losing claim goes to the alternatives array** with the reason it was rejected.

---

### 8. Keyword Dictionary

Extensible data file. Keywords are **one supporting signal among several**.
Keyword match alone never classifies above LOW. Keywords are filtered by the
consistency check: if required behavioral signals are absent, keywords are
ignored entirely.

---

### 9. Batch Post-Recording Inference

Capability inference runs AFTER the recording session. Processes all interactions
as a batch with full sequence context (1 back, 1 forward). No real-time cost
during recording. No DOM access. No network calls. Pure deterministic computation.

---

### 10. Output Schema

```typescript
interface CapabilityRecord {
  capabilityId: string;
  interactionId: string;             // FK to ComponentInteraction
  capability: CapabilityType;        // 'FilterSelection' | ... | 'Unclassified'
  confidence: 'high' | 'medium' | 'low';
  parameters: {
    target?: string;                 // "Sony", "Price: Low to High"
    scope?: string;                  // "Brand", "Price"
    value?: string;                  // "on"/"off" for toggle, "5" for slider
  };
  evidence: {
    physicalType: InteractionType;
    targetLabel: string | null;
    semanticEffects: string[];
    matchedKeywords: string[];
    structuralContext: string[];
    sequenceNotes: string[];
  };
  alternatives: Array<{
    capability: CapabilityType;
    confidence: Confidence;
    reason: string;
  }>;
  unclassifiedReason?: string;
}
```

---

### 11. M1/M2 Prerequisites

**One M2 change is genuinely required before Capability V1: netNodeDelta enrichment.**

M2's content-change SemanticEffect currently embeds per-path node counts in its
description string for ≤5 paths, but discards them for >5 paths. The enrichment
adds a structured `netNodeDelta: number` field to the content-change effect,
computed as `addedNodesCount − removedNodesCount` per affected path.

**Why required**: Without it, Sort vs Filter disambiguation in ambiguous cases
(no keyword, generic dropdown) is impossible. The signal exists in M1 but is
not surfaced through M2. The enrichment is ~30 production lines in effect-rules.ts
and does not change any existing M2 behavior — it adds a field.

**No other M1/M2 changes are required.** The Capability Model operates entirely
from: ComponentInteraction records + M2 SemanticEffects + sequence context +
keyword dictionary.

---

## PART II — COMPLETE IMPLEMENTATION PLAN

Seven phases. Each phase has a testing gate that must pass before proceeding.

---

### Phase 0: M2 netNodeDelta Enrichment (prerequisite)

**Scope**: Add `netNodeDelta` to content-change SemanticEffect.

**Files**:
- `src/shared/observation-types.ts` — add `netNodeDelta?: number` to SemanticEffect
- `src/semantics/effect-rules.ts` — compute `addedNodesCount − removedNodesCount` per path in `checkContentChange`, attach to the effect

**Tests** (~15):
- content-change with 0 added, 0 removed → netNodeDelta = 0
- content-change with 10 added, 5 removed → netNodeDelta = 5
- content-change with 20 removed, 5 added → netNodeDelta = -15
- Multiple paths: each path gets its own netNodeDelta
- Pruning path (>5 paths): aggregate netNodeDelta for the pruned group
- No-observable-effect: netNodeDelta absent
- State-toggle/expand-collapse: netNodeDelta absent (not content-change)

**Gate**: Full regression passes (3,660+15 = 3,675). All existing content-change tests still pass with the new field present.

---

### Phase 1: Core Infrastructure

**Scope**: Types, engine skeleton, evidence extractor, keyword dictionary, evidence structures.

**Files** (new):
- `src/capabilities/capability-types.ts` — CapabilityType union (13 values), CapabilityRecord interface, CapabilityClaim type, Confidence type
- `src/capabilities/capability-rule.ts` — CapabilityRule interface (evaluate method, priority, capability type)
- `src/capabilities/keyword-dictionary.ts` — V1 dictionary data (6 categories: filter, sort, search, navigate, submit, paginate), KeywordEntry interface, matcher function
- `src/capabilities/evidence-extractor.ts` — extracts PhysicalEvidence, BehavioralEvidence, SequenceContext from a ComponentInteraction + its SemanticEffects + recording array
- `src/capabilities/capability-engine.ts` — CapabilityEngine class: registerRule(), inferCapabilities(interactions[]) → CapabilityRecord[]. Iterates all interactions, runs all rules, collects claims, delegates to conflict resolver.
- `src/capabilities/conflict-resolver.ts` — resolve(claims[]) → { primary, alternatives }. Implements the 6 conflict resolution rules from §7.

**Tests** (~60):
- CapabilityType union has exactly 13 values
- CapabilityRecord round-trip serialization
- KeywordDictionary: filter matches "filter", "refine", "brand"; does NOT match "learn"
- KeywordDictionary: sort matches "sort by price"; does NOT match "filter"
- EvidenceExtractor: extracts physical type, target label, effects, ancestor roles from a synthetic interaction
- EvidenceExtractor: extracts sequence context (previous/next interaction, same-form detection)
- CapabilityEngine: empty interactions → empty results
- CapabilityEngine: single interaction with no rules registered → Unclassified
- ConflictResolver: single HIGH claim wins
- ConflictResolver: HIGH beats MEDIUM beats LOW
- ConflictResolver: same confidence → most supporting signals wins
- ConflictResolver: same confidence + same signal count → lowest priority number wins
- ConflictResolver: only LOW claims → Unclassified, LOWs go to alternatives
- ConflictResolver: zero claims → Unclassified with "no rule claimed" reason

**Gate**: All 60+ infrastructure tests pass. Full regression: 3,675 + 60 = 3,735.

---

### Phase 2: High-Confidence Physical Rules (3 rules)

**Scope**: Three rules whose classification is driven primarily by physical type + direct property M2 evidence. These are the most reliable rules and validate the engine end-to-end.

**Files** (new):
- `src/capabilities/rules/toggle-control.ts` — Checkbox/switch + state-toggle effect → ToggleControl
- `src/capabilities/rules/expand-collapse.ts` — expand-collapse effect (aria-expanded, details open) → ExpandCollapse
- `src/capabilities/rules/upload-file.ts` — FileUpload physical type → UploadFile (definitive, no behavioral evidence needed)

**ToggleControl rule**:
- Required: state-toggle SemanticEffect present (any confidence)
- Supporting: keyword "enable/disable/on/off", Checkbox physical type, aria-checked changed
- Confidence: state-toggle HIGH → ToggleControl HIGH; state-toggle MEDIUM → MEDIUM
- Counterexample: "Email notifications" checkbox with remote content-change → ToggleControl HIGH beats FilterSelection LOW

**ExpandCollapse rule**:
- Required: expand-collapse SemanticEffect present
- Supporting: keyword "show/hide/more/less/details", summary/button target
- Confidence: direct-property aria-expanded → HIGH; structural inference → MEDIUM

**UploadFile rule**:
- Required: FileUpload physical type
- Supporting: keyword "upload/choose/browse", file metadata present
- Confidence: HIGH always (physical type is definitive)

**Tests** (~45):
- ToggleControl: checkbox + aria-checked false→true → HIGH
- ToggleControl: checkbox + state-toggle MEDIUM → MEDIUM
- ToggleControl: checkbox + NO state-toggle (focus only) → null
- ToggleControl: "Email notifications" with remote content-change → ToggleControl HIGH, FilterSelection LOW in alternatives
- ToggleControl: dark-mode toggle with page-wide content-change → ToggleControl HIGH
- ExpandCollapse: aria-expanded false→true → HIGH
- ExpandCollapse: details open attribute null→"" → HIGH
- ExpandCollapse: no expand-collapse effect → null
- UploadFile: FileUpload type → HIGH
- UploadFile: Click type → null
- Each rule: correct capability type in output
- Each rule: correct evidence trail fields populated

**Gate**: All 45+ rule tests pass. Full regression: 3,735 + 45 = 3,780.

---

### Phase 3: Navigation-Dependent Rules (3 rules)

**Scope**: Three rules that depend on detecting URL/route changes or physical navigation patterns.

**Files** (new):
- `src/capabilities/rules/navigate.ts` — Link/Click + URL change → Navigate
- `src/capabilities/rules/open-detail.ts` — Navigate + item-specific URL + list context → OpenDetail
- `src/capabilities/rules/paginate.ts` — content-change on results + pagination keyword/signal → Paginate

**Navigate rule**:
- Required: URL/route change detected (from SPA navigation event or page URL delta)
- Supporting: keyword "home/back/next/continue", Link physical type, page title changed
- Note: Amazon brand filter fires Navigate (MEDIUM) but loses to FilterSelection (HIGH)

**OpenDetail rule**:
- Required: navigation to item-specific URL + source page was list/search context
- Supporting: URL contains product/item identifier (ASIN, UUID, slug), preceded by search/filter
- Note: more specific than Navigate (lower priority number) so wins when both claim

**Paginate rule**:
- Required: content-change on results container + (keyword "next/previous page" OR physical pattern: button/link at bottom of results area)
- Supporting: different items shown (netNodeDelta ≠ 0 but moderate), "showing X–Y of Z" text changed
- Counterexample: "Load more" that appends rather than paginates — classify as Paginate (both are "show more data")

**Tests** (~45):
- Navigate: Link + URL change + keyword "home" → HIGH
- Navigate: Click + URL change + no keyword → MEDIUM
- Navigate: Link + no URL change → null (SPA that didn't actually navigate)
- OpenDetail: Navigate + URL contains "dp/B08WM3LMJF" + preceded by search → HIGH
- OpenDetail: Navigate + generic URL + no list context → null (falls to Navigate)
- OpenDetail vs Navigate conflict: OpenDetail wins (lower priority number)
- Paginate: content-change + keyword "next page" → HIGH
- Paginate: content-change + button at bottom of results → MEDIUM
- Paginate: content-change + no pagination keyword or pattern → null (falls to FilterSelection or Unclassified)
- Amazon pagination button trace

**Gate**: All 45+ tests pass. Full regression: 3,780 + 45 = 3,825.

---

### Phase 4: Content-Change-Dependent Rules (3 rules)

**Scope**: The three rules that depend on content-change behavioral evidence to distinguish their capability type. This is where netNodeDelta, keyword consistency, and physical type interact most.

**Files** (new):
- `src/capabilities/rules/filter-selection.ts` — content-change on different element + filter evidence → FilterSelection
- `src/capabilities/rules/sort-selection.ts` — content-change on results + sort evidence → SortSelection
- `src/capabilities/rules/search.ts` — TextEntry on search input + results changed → Search

**FilterSelection rule**:
- Required: content-change OR visibility-change on a DIFFERENT element than the control
- Supporting: keyword "filter/refine/brand/category", Checkbox type, effect target recognized as results container, ancestor has "filter/sidebar" context
- Counterexample trace: Amazon brand filter → HIGH; "Email notifications" → loses to ToggleControl HIGH

**SortSelection rule**:
- Required: content-change on a results container
- Supporting: keyword "sort/order/price/relevance", Dropdown type, netNodeDelta ≈ 0, items appear reordered
- Key: netNodeDelta is supporting (not required). Example 2 (sort with delta≠0) → SortSelection HIGH from keyword + Dropdown.

**Search rule**:
- Required: TextEntry physical type + (keyword "search" in label/ancestor OR content-change/navigation follows)
- Supporting: content-change on results, navigation to search results page, search-box ancestor context
- Note: C2 text-field live search → Search MEDIUM (TextEntry + content-change, keyword may be absent)

**Tests** (~60):
- FilterSelection: Link + content-change on results + keyword "filter" → HIGH
- FilterSelection: Checkbox + content-change on results + no keyword → LOW (loses to ToggleControl HIGH)
- FilterSelection: Checkbox + content-change on results + ancestor "filter" → MEDIUM
- FilterSelection: "Learn about filters" link → null (no content-change on results — required signal missing)
- FilterSelection: dark-mode toggle → LOW (loses to ToggleControl HIGH)
- SortSelection: Dropdown + content-change + keyword "sort" + netNodeDelta=0 → HIGH
- SortSelection: Dropdown + content-change + keyword "sort" + netNodeDelta≠0 → HIGH (keyword compensates)
- SortSelection: Dropdown + content-change + no keyword + netNodeDelta=0 → MEDIUM (delta supports)
- SortSelection: Dropdown + content-change + no keyword + netNodeDelta≠0 → LOW (ambiguous)
- FilterSelection vs SortSelection conflict: Filter (Checkbox, keyword "filter") vs Sort (delta=0, no keyword) → Filter MEDIUM beats Sort LOW
- Search: TextEntry + keyword "search" + content-change → HIGH
- Search: TextEntry + no keyword + content-change follows → MEDIUM
- Search: TextEntry + no behavioral follow → null

**Gate**: All 60+ tests pass. Full regression: 3,825 + 60 = 3,885.

---

### Phase 5: Form and Value Rules (3 rules + Unclassified fallback)

**Scope**: Remaining rules + the fallback that guarantees every interaction gets a capability record.

**Files** (new):
- `src/capabilities/rules/submit-form.ts` — Click on submit + preceded by TextEntry on same form → SubmitForm
- `src/capabilities/rules/select-option.ts` — Dropdown selection + no other capability claimed above LOW → SelectOption
- `src/capabilities/rules/adjust-value.ts` — Slider/spinbutton + userAdjusted=true → AdjustValue
- `src/capabilities/rules/unclassified.ts` — fallback: always produces a CapabilityRecord with reason

**SubmitForm rule**:
- Required: Click on submit-type element (input[type=submit], button[type=submit], or keyword "submit/sign in/save") + preceded by TextEntry on same `<form>`
- Supporting: keyword "submit/login/register/book", navigation follows, error message appears
- Note: Avis Ford "Search" button after form fields → SubmitForm HIGH

**SelectOption rule**:
- Required: Dropdown selection completed + NO other rule claimed above LOW for this interaction
- Supporting: keyword "select/choose", value persisted, no results container changed
- Note: This is the "dropdown that didn't filter or sort" — Avis Ford Make/Model dropdowns

**AdjustValue rule**:
- Required: Slider or spinbutton physical type + metadata.userAdjusted=true
- Supporting: keyword "price/range/quantity/volume", content-change on results
- Note: Amazon price slider + results change → AdjustValue HIGH (with FilterSelection alternative noted)

**Unclassified fallback**:
- Fires when no other rule claimed above LOW
- Produces CapabilityRecord with capability='Unclassified', confidence='low', unclassifiedReason explaining what evidence was evaluated and why it was insufficient
- The interaction's physical type and any LOW claims are preserved in alternatives

**Tests** (~50):
- SubmitForm: Click[submit] + preceded by TextEntry[username] on same form → HIGH
- SubmitForm: Click[submit] + no preceding TextEntry → null
- SubmitForm: Click[submit] + TextEntry on DIFFERENT form → null
- SelectOption: Dropdown + no other claim → SelectOption MEDIUM
- SelectOption: Dropdown + FilterSelection LOW → SelectOption (no rule above LOW)
- SelectOption: Dropdown + SortSelection MEDIUM → null (SortSelection wins)
- AdjustValue: Slider + userAdjusted=true → HIGH
- AdjustValue: Slider + userAdjusted=false → null (filtered at physical layer)
- AdjustValue: Slider + userAdjusted=true + content-change → HIGH with FilterSelection alternative
- Unclassified: Click on unknown button + no effects + no keyword → Unclassified
- Unclassified: TextEntry + no follow-up effect → Unclassified
- Unclassified: conflicting keyword vs behavioral → Unclassified with reason

**Gate**: All 50+ tests pass. Full regression: 3,885 + 50 = 3,935.

---

### Phase 6: Engine Integration & Wiring

**Scope**: Wire the CapabilityEngine into the recording pipeline. Connect it to the post-recording flow so capabilities are computed when the user stops recording.

**Files** (modified):
- `src/background/service-worker.ts` — on stopRecording: after M2 effects are finalized, call CapabilityEngine.inferCapabilities(interactions) and store results
- `src/recorder/phase5/recorder-entry.ts` or relevant session manager — pass interaction + effects arrays to engine
- Storage: capability records stored alongside interactions (IndexedDB or chrome.storage)

**Tests** (~20):
- Integration: recording with 3 interactions → 3 capability records produced
- Integration: Amazon-like recording (TextEntry → Click[filter] → Dropdown[sort]) → Search + FilterSelection + SortSelection
- Integration: form recording (TextEntry × 3 → Click[submit]) → SubmitForm with sequence context
- Integration: all-Unclassified recording (random clicks with no effects) → all Unclassified
- Integration: capability records persisted and retrievable
- Integration: empty recording → empty capability array

**Gate**: All integration tests pass. Full regression: 3,935 + 20 = 3,955.

---

### Phase 7: Real-World Validation

**Scope**: Manual testing against live applications. No automated tests — this is empirical validation.

**Applications**:
- **Amazon.com**: Search, FilterSelection (brand), SortSelection (price), Paginate, Navigate, OpenDetail, AdjustValue (price slider)
- **Avis Ford**: SelectOption (Make/Model/Condition), SubmitForm (Search button), Navigate (nav links)
- **OrangeHRM**: ToggleControl, SelectOption, SubmitForm, Navigate, ExpandCollapse

**For each interaction**:
1. Record with extension
2. Stop recording
3. Inspect capability records in side panel / storage
4. Verify: correct capability type, correct confidence, correct parameters, evidence trail complete, alternatives reasonable

**Validation gate**: All real-world interactions classify correctly OR have honest Unclassified/LOW with explainable reasons. No misclassifications at HIGH confidence.

**Deliverable**: Validation report saved to notes, extension ZIP with capability display in side panel.

---

## Summary

| Phase | Scope | New Tests | Cumulative |
|---|---|---|---|
| 0 | M2 netNodeDelta enrichment | ~15 | 3,675 |
| 1 | Core infrastructure (types, engine, dictionary, evidence extractor, conflict resolver) | ~60 | 3,735 |
| 2 | Physical-evidence rules (ToggleControl, ExpandCollapse, UploadFile) | ~45 | 3,780 |
| 3 | Navigation rules (Navigate, OpenDetail, Paginate) | ~45 | 3,825 |
| 4 | Content-change rules (FilterSelection, SortSelection, Search) | ~60 | 3,885 |
| 5 | Form/value rules + Unclassified fallback | ~50 | 3,935 |
| 6 | Engine integration & wiring | ~20 | 3,955 |
| 7 | Real-world validation (Amazon, Avis Ford, OrangeHRM) | manual | — |

**Production code**: ~650 lines across `src/capabilities/`
**Test code**: ~1,300 lines
**M2 prerequisite**: ~30 lines in effect-rules.ts + observation-types.ts

Each phase has a hard gate: all new tests pass AND full regression passes before proceeding to the next phase.
