# Capability Model — Final Architecture & Detailed Design (v2)

**Status**: Design only — not yet implemented
**Date**: 2026-08-05 (finalized)
**Supersedes**: capability-model-architecture.md (v1)
**Pipeline position**: ComponentInteraction → M1 → M2 Semantic Effects → **Capability Model**

---

## Table of Contents

1. [Capability Definition and Boundary](#1)
2. [V1 Taxonomy](#2)
3. [Evidence Model — Required vs Supporting Signals](#3)
4. [Inference Architecture](#4)
5. [Keyword Dictionary Architecture](#5)
6. [Confidence Model](#6)
7. [Unknown / Unclassified Handling](#7)
8. [Sequence / Context Use](#8)
9. [Capability Output Schema](#9)
10. [Replay Relationship](#10)
11. [Amazon Case Trace](#11)
12. [Counterexamples](#12)
13. [Representative Examples](#13)
14. [M1/M2 Dependency — What Is Genuinely Required](#14)
15. [Performance Architecture](#15)
16. [Extensibility](#16)
17. [Failure / Conflict Handling](#17)
18. [Testing Strategy](#18)
19. [Implementation Plan](#19)

---

<a id="1"></a>
## 1. Capability Definition and Boundary

### Definition

The Capability Model identifies **what application/UI capability was exercised** based on observable recording evidence — physical interaction type, observable application effects (DOM changes), and structural/sequence context. It does not speculate about user intent, goals, or test structure.

### What the Capability Model IS

A deterministic, single-interaction inference layer that maps:

```
ComponentInteraction + M2 Semantic Effects + Sequence Context
  → one CapabilityRecord with confidence and evidence trail
```

It describes *what kind of meaningful action the user performed on the application's UI* — not just "clicked an element" but "filtered results," "sorted a list," "searched for content," "navigated to a page," etc.

### What the Capability Model is NOT

| Responsibility | Belongs to | Why |
|---|---|---|
| Physical control identification | ComponentInteraction | Replayable mechanical fact — tag, role, value |
| DOM mutation capture | M1 Observation | Raw evidence — not semantic |
| Effect classification (toggle, content-change) | M2 Semantic Effects | Behavioral abstraction — independent of action type |
| "This is step 3 of checkout" | Action Composition (future) | Cross-interaction workflow reasoning |
| "Verify only Sony products shown" | Assertion generation (future) | Domain reasoning about expected state |
| "Filter results by brand Sony" (prose) | Test Step Intelligence (future) | Natural language generation |
| "This recording tests purchase flow" | Test intent (future) | Goal inference — explicitly excluded |

### Core principle

The Capability Model is NOT "renaming interactions." It synthesizes three independent evidence streams that individually cannot determine the action's meaning:

- **Physical identity alone** cannot distinguish filter from toggle (both are Checkbox)
- **Behavioral outcome alone** cannot distinguish sort from filter (both are content-change)
- **Keywords alone** produce false matches ("Learn about filters" is not FilterSelection)

Only the **combination** of all three streams, with required signals gating and supporting signals boosting, produces reliable classification.

---

<a id="2"></a>
## 2. V1 Taxonomy

### 12 capability types + Unclassified

| # | Capability | One-line meaning | Key distinguishing evidence |
|---|---|---|---|
| 1 | **FilterSelection** | Narrow a result set by a criterion | Content-change on a *different* element + filter-specific supporting signals |
| 2 | **SortSelection** | Change ordering of a result set | Content-change on results + sort keyword/label + typically Dropdown |
| 3 | **Search** | Enter query text to find matching content | TextEntry on search-labeled input + results/navigation follows |
| 4 | **Navigate** | Move to a different page/view | URL/route change |
| 5 | **SubmitForm** | Submit form data to the application | Submit-type Click preceded by TextEntry on same form |
| 6 | **SelectOption** | Choose a value from a list of options | Dropdown selection without filter/sort/paginate behavioral pattern |
| 7 | **ToggleControl** | Switch a binary state on/off | State-toggle effect (direct property: aria-checked/aria-pressed) |
| 8 | **ExpandCollapse** | Show/hide content in place | Expand-collapse effect (direct property: aria-expanded/details open) |
| 9 | **OpenDetail** | Drill into a specific item's details | Navigation to item-specific URL from list/search context |
| 10 | **UploadFile** | Provide a file to the application | FileUpload physical type |
| 11 | **Paginate** | Move to next/previous page of results | Content-change on results + pagination keyword/physical pattern |
| 12 | **AdjustValue** | Set a numeric/range value (slider/spinbutton) | Slider/spinbutton type + userAdjusted=true |
| 0 | **Unclassified** | Insufficient evidence | Explicit escape hatch — never force-fit |

### Explicitly excluded from V1

| Excluded | Reason |
|---|---|
| Create/Edit/Delete | Domain operations manifested as SubmitForm/SelectOption at UI level |
| Login/Logout | Multi-step workflow: TextEntry × 2 + SubmitForm |
| Checkout | Multi-step workflow: Navigate + SubmitForm + SelectOption |
| Add to Cart | Physical Click; meaning is domain-specific (SubmitForm or Navigate) |

---

<a id="3"></a>
## 3. Evidence Model — Required vs Supporting Signals

### The critical design clarification

Every capability rule distinguishes:

- **Required signals**: ALL must be present for the rule to fire at all. These are **framework-agnostic** — they rely on universal patterns (content changed elsewhere, URL changed, direct property effect).
- **Supporting signals**: Each boosts confidence when present. These **may or may not appear** depending on application implementation (keywords, container roles, structural markers). When absent, confidence drops — it does not block classification.

### Nothing in the "Required" column is framework-dependent

Required signals use only:
- DOM-level facts observable by MutationObserver (universal)
- ARIA/W3C standard properties (universal)
- Physical interaction type (already classified by ComponentInteraction)

Everything in "Supporting" depends on how the application is built — and when absent, the model lowers confidence rather than refusing to classify.

### Signal table (finalized)

| Capability | Required (ALL must be true) | Supporting (each boosts confidence) |
|---|---|---|
| FilterSelection | content-change OR visibility-change on a DIFFERENT element than the clicked target | (1) keyword "filter/refine/brand/category" in label/ancestor (2) Checkbox/Link physical type (3) effect target has role=list/class containing result/grid/product (4) ancestor class contains "filter/sidebar/refine" |
| SortSelection | content-change on a results-area element | (1) keyword "sort/order by/price/relevance" in label/option (2) Dropdown physical type (3) netNodeDelta ≈ 0 (same items reordered) (4) no items permanently removed (all re-added) |
| Search | TextEntry physical type + (content-change or navigation follows) | (1) keyword "search/find/query" in label/placeholder (2) input has role=searchbox or type=search (3) results container updated (4) query text captured in metadata |
| Navigate | URL or route change detected | (1) keyword "home/dashboard/back/next/continue" (2) Link physical type (3) page title changed (4) SPA route change (popstate/pushState) |
| SubmitForm | Click on submit-type element + preceded by TextEntry on same `<form>` | (1) keyword "submit/sign in/save/apply/create" (2) button type=submit (3) navigation or error message follows (4) form ancestor present |
| SelectOption | Dropdown selection completed (no filter/sort/paginate behavioral pattern matched) | (1) keyword matching the option's category in label/ancestor (2) no content-change on results (3) selected value captured |
| ToggleControl | state-toggle M2 effect (direct property: aria-checked/aria-pressed/aria-pressed) | (1) Checkbox/RadioButton physical type (2) keyword "enable/disable/on/off" (3) no content-change on results container |
| ExpandCollapse | expand-collapse M2 effect (direct property: aria-expanded/details open) | (1) keyword "show/hide/more/expand" (2) no navigation occurred (3) content changed locally (not on results container) |
| OpenDetail | navigation to item-specific destination + source was list/search context | (1) URL/path contains item identifier (product ID, article ID) (2) source page was search results or list view (3) keyword "view/details/open" |
| UploadFile | FileUpload physical type | (1) keyword "upload/choose file/browse" (2) file name captured in metadata (3) content-change showing file preview/metadata |
| Paginate | content-change on results area + pagination physical/keyword signal | (1) keyword "next page/previous page/load more/show more" (2) button/link at bottom of results region (3) different items with same count shown |
| AdjustValue | Slider/spinbutton physical type + userAdjusted=true | (1) keyword "price/range/quantity/amount" (2) content-change on results container (3) value captured in metadata |

### Why this distinction matters

**Required signals gate classification.** If FilterSelection's required signal (content-change on a different element) is absent, the rule returns null — no claim at all. This is what prevents a checkbox toggle with no remote effect from being classified as a filter.

**Supporting signals determine confidence level.** When required signals are met but all supporting signals are absent, the rule claims LOW. With 1 supporting, MEDIUM. With 2+, HIGH. This is what allows the model to say "something changed elsewhere, but I'm not confident it's a filter" rather than forcing HIGH or refusing to classify.

---

<a id="4"></a>
## 4. Inference Architecture

### Deterministic rule engine

Each capability type has one rule function — a pure function that evaluates evidence and returns a claim or null. The engine runs all 12+1 rules per interaction and resolves competing claims.

### Evaluation flow

```
For each ComponentInteraction in the recording (batch mode):

  1. Gather evidence from three streams:
     - Physical identity (ComponentInteraction fields)
     - Behavioral outcome (M2 SemanticEffects)
     - Sequence context (previous interaction, same form ancestor)

  2. For each rule (in parallel — all rules evaluate):
     a. Check ALL required signals
     b. If any required signal missing → return null
     c. Count supporting signals present
     d. Return claim: { capability, confidence, signals, alternatives_considered }

  3. Resolve competing claims:
     - Exactly one HIGH → wins
     - Multiple HIGH → highest supporting-signal count wins; tie → lower priority number
     - Only MEDIUM claims → highest signal count wins
     - Only LOW claims → Unclassified (§7)
     - No claims → Unclassified
```

### Rule structure

```typescript
interface CapabilityRule {
  capability: CapabilityType;
  priority: number;  // lower = more specific, wins ties

  evaluate(
    physical: PhysicalEvidence,
    effects: SemanticEffect[],
    context: SequenceContext,
    keywords: KeywordDictionary,
  ): CapabilityClaim | null;
}

interface CapabilityClaim {
  capability: CapabilityType;
  confidence: 'high' | 'medium' | 'low';
  supportingSignals: string[];     // names of signals that matched
  requiredSignalsMet: string[];    // names of required signals satisfied
  parameters: Record<string, string>;  // target, scope, value
}
```

### Priority ordering (tiebreaker only — not evaluation order)

| Priority | Capability | Why this priority |
|---|---|---|
| 5 | UploadFile | Physical type is definitive — no ambiguity |
| 10 | ToggleControl | Direct property evidence (aria-checked) is very strong |
| 10 | ExpandCollapse | Direct property evidence (aria-expanded) is very strong |
| 15 | AdjustValue | Physical type (Slider) + userAdjusted is strong |
| 20 | FilterSelection | More specific than Navigate (a filter that navigates is still a filter) |
| 25 | SortSelection | More specific than FilterSelection (sort is a special case of content change) |
| 30 | Search | More specific than TextEntry alone |
| 35 | SubmitForm | More specific than Click (submit is a special click) |
| 40 | Paginate | More specific than Navigate or FilterSelection |
| 45 | OpenDetail | More specific than Navigate (drill-in is a special navigation) |
| 50 | Navigate | General movement between pages |
| 90 | SelectOption | Generic dropdown — fallback when no filter/sort/paginate pattern matched |
| 99 | Unclassified | Always produces a record as last resort |

---

<a id="5"></a>
## 5. Keyword Dictionary Architecture

### Keywords are ONE supporting signal — never sole classifier

A keyword match generates a hypothesis and boosts confidence when consistent with physical + behavioral evidence. **Keyword alone never classifies.** The consistency check ensures this: if a keyword suggests a capability but required signals are absent, the keyword is ignored.

### Dictionary structure

```typescript
interface KeywordDictionary {
  filter: KeywordEntry[];
  sort: KeywordEntry[];
  search: KeywordEntry[];
  navigate: KeywordEntry[];
  submit: KeywordEntry[];
  paginate: KeywordEntry[];
}

interface KeywordEntry {
  pattern: RegExp;
  scope: 'label' | 'class' | 'ancestor' | 'any';
  weight: 'strong' | 'weak';
}
```

### V1 dictionary

**Filter:** `/filter/i`, `/refine/i`, `/narrow.*result/i`, `/brand/i`, `/category/i`, `/facet/i`
**Sort:** `/sort/i`, `/order.*by/i`, `/price.*low/i`, `/price.*high/i`, `/newest/i`, `/relevance/i`, `/rating/i`, `/a.*to.*z/i`
**Search:** `/search/i`, `/find/i`, `/query/i`, `/lookup/i`
**Navigate:** `/home/i`, `/dashboard/i`, `/profile/i`, `/settings/i`, `/back/i`, `/next/i`, `/continue/i`, `/checkout/i`, `/cart/i`
**Submit:** `/submit/i`, `/save/i`, `/apply/i`, `/confirm/i`, `/sign.*in/i`, `/log.*in/i`, `/register/i`, `/book/i`, `/create/i`, `/update/i`
**Paginate:** `/next.*page/i`, `/previous.*page/i`, `/load.*more/i`, `/show.*more/i`, `/page.*\d+/i`

### How keywords participate in classification

| Scenario | Keyword | Required signal | Outcome |
|---|---|---|---|
| Amazon brand filter: "Apply Sony filter" | "filter" ✓ | content-change on results ✓ | FilterSelection HIGH |
| Help link: "Learn about filters" | "filter" ✓ | NO content-change on results ✗ | Keyword ignored → Navigate |
| Sort dropdown: "Price: Low to High" | "sort" ✓ | content-change on results ✓ | SortSelection HIGH |
| Checkbox: "Remember me" | no match | state-toggle ✓ | ToggleControl HIGH |
| Settings checkbox: "Email notifications" + "Settings saved" | no match | state-toggle ✓ + content-change elsewhere | ToggleControl HIGH (state-toggle direct property >> content-change) |

### Extensibility

New words appended to dictionary data file — no code changes. The dictionary is loaded at runtime and can be extended per-project (future feature).

---

<a id="6"></a>
## 6. Confidence Model

### Three tiers

| Tier | Condition | Meaning |
|---|---|---|
| **HIGH** | Required signals met + 2+ supporting signals (at least 1 non-keyword) | Strong multi-signal evidence |
| **MEDIUM** | Required signals met + 1 supporting signal, OR required signals from direct property evidence | Probable classification |
| **LOW** | Required signals met, no supporting | Possible but uncertain — usually overridden |

### Key confidence rules

1. **Direct property evidence is never downgraded.** If M2 produced HIGH-confidence state-toggle from aria-checked false→true, ToggleControl claims HIGH regardless of window noise. Confidence reflects evidence quality, not window cleanliness.

2. **Keyword alone never produces above LOW.** A keyword match without behavioral or structural corroboration is LOW at best.

3. **Physical type contributes baseline plausibility:**
   - Checkbox → toggle/filter plausible (MEDIUM baseline)
   - Dropdown → sort/filter/select plausible (MEDIUM baseline)
   - Link → navigate plausible (MEDIUM baseline)
   - Click on generic button → ambiguous (LOW baseline unless behavioral evidence clarifies)

4. **Supporting signals from different streams boost more than same-stream duplicates.** Physical + Behavioral + Keyword > Physical + Physical + Keyword.

5. **Absence of expected evidence degrades confidence.** If Navigate expects URL change but none detected, confidence drops to LOW or claim fails.

---

<a id="7"></a>
## 7. Unknown / Unclassified Handling

### Unclassified is a valid, important output

The model must be allowed to say "insufficient evidence." This is better than forcing a guess.

### When Unclassified fires

1. No rule's required signals are met
2. Only LOW claims exist (no MEDIUM or HIGH)
3. Evidence is contradictory (keyword says "filter" but behavioral says "navigation")
4. Click on element with no behavioral effects and no keyword matches

### What Unclassified preserves

- The physical ComponentInteraction (fully intact)
- Any M2 semantic effects (fully intact)
- Raw evidence that was evaluated
- Note on why classification failed

### Downstream impact

Unclassified interactions are still replayable (physical interaction preserved). They appear in test output as physical descriptions. Future AI/composition layers can reclassify using broader context.

---

<a id="8"></a>
## 8. Sequence / Context Use

### Deliberate test workflow assumption

The user is recording test steps deliberately, so consecutive interactions are likely related. Sequence context is legitimate evidence but must be used carefully.

### What sequence context CAN do

1. **Strengthen weak signals.** TextEntry followed by Click on "Search" button → together they boost Search to HIGH.
2. **Disambiguate.** Dropdown selection followed by content-change on results → could be filter or sort. If dropdown's ancestor is a "sort-bar," structural disambiguation.
3. **Provide form context.** If previous interaction was TextEntry on same `<form>`, current submit click strengthens SubmitForm.

### What sequence context CANNOT do

1. **Invent a capability.** Can only boost existing claims whose required signals are already met.
2. **Override behavioral evidence.** Behavioral evidence is primary. Sequence is supporting only.
3. **Speculate about intent.** "Third form field filled" does NOT mean "registration form." That's workflow composition.

### Implementation: limited window

Sequence context looks at **one interaction back and one forward** (in batch mode). No deeper history.

---

<a id="9"></a>
## 9. Capability Output Schema

```typescript
interface CapabilityRecord {
  capabilityId: string;
  interactionId: string;

  capability: CapabilityType;
  confidence: 'high' | 'medium' | 'low';

  parameters: {
    target?: string;   // "Sony" (filter value), "price-low-high" (sort key)
    scope?: string;    // "Brand" (filter scope), "Price" (sort field)
    value?: string;    // "on"/"off" (toggle), "50" (slider value)
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
    confidence: 'high' | 'medium' | 'low';
    reason: string;
  }>;

  unclassifiedReason?: string;
}
```

---

<a id="10"></a>
## 10. Replay Relationship

### Capability does NOT replace physical interaction

The physical ComponentInteraction + IRAction is the **source of truth for replay**. The Capability Record is **metadata about meaning** — used for naming, assertions, organization, reporting.

| Layer | Source | Purpose |
|---|--- vs. Avis Ford SelectOption | Navigation from URL change |
| Checkbox + content-change elsewhere + no filter keyword | ToggleControl | State-toggle direct property evidence is stronger |
| Checkbox + "Settings saved" appears | ToggleControl | Content-change is on notification, not results container |
| Sort dropdown + netNodeDelta=0 + no keyword | SortSelection LOW vs FilterSelection LOW | Both LOW → Unclassified (honest ambiguity) |
| Checkbox + content-change on results + no keyword | ToggleControl HIGH vs FilterSelection LOW | ToggleControl wins (direct property >> generic content-change) |

---

<a id="14"></a>
## 14. M1/M2 Dependency — What Is Genuinely Required

### The bottom line: NO M1/M2 changes are required for Capability V1

The existing M1 capture and M2 semantic effect taxonomy already provide sufficient evidence for all 12 capability types to fire at usable confidence levels. The model works with what exists today.

### What we WOULD like (optional M2 enrichment, defer to Phase 4)

**netNodeDelta in content-change effects**: M2's content-change effect currently describes mutation counts in prose ("201 mutations across 45 paths"). Adding a structured `netNodeDelta` field (addedNodesCount - removedNodesCount per affected path) would let SortSelection distinguish "same items reordered" from "items removed."

**This is NOT required for V1.** Without it:
- SortSelection fires from keyword + Dropdown + content-change (easily HIGH)
- FilterSelection fires from content-change-on-different-element + keyword + Checkbox type (easily HIGH)
- The ambiguity only arises when keyword is absent AND the control type is ambiguous — a rare edge case

**When it becomes required**: if real-world validation shows Sort vs Filter misclassification at a rate that matters. Defer until evidence demands it.

### What we do NOT need from M1

| M1 field | Needed by Capability? | Why |
|---|---|---|
| MutationRecord2[] (raw mutations) | ❌ No | M2 abstracts these. Capability consumes M2. |
| addedNodesCount / removedNodesCount | ❌ No (directly) | Would be nice as M2 enrichment (netNodeDelta) but not required for V1 |
| PerformanceCondition | ❌ No | Performance diagnostic |
| beforeSnapshot / finalSnapshot | ❌ No | Already consumed by M2 |
| ElementStateSnapshot | ❌ No | Already consumed by M2 |

### What we DO consume from M2 (already present)

| M2 field | How Capability uses it |
|---|---|
| SemanticEffect.category | Primary behavioral evidence (content-change, state-toggle, expand-collapse, etc.) |
| SemanticEffect.confidence | Propagates into capability confidence |
| SemanticEffect.confidenceBasis | Determines if evidence is direct-property (strong) or structural-inference (weaker) |
| SemanticEffect.affectedTarget.cssPath | Identifies WHICH element changed (same vs different from clicked target) |
| SemanticEffect.affectedTarget.role | Results container recognition (role=list, etc.) |

### What we consume from ComponentInteraction (already present)

| Field | How Capability uses it |
|---|---|
| type (InteractionType) | Physical identity baseline |
| target.tag, target.ariaRole | Physical identity |
| target.accessibleName, target.ariaLabel | Keyword extraction |
| target.href | Navigate/OpenDetail signal |
| target.className, domContext.ancestorClasses | Structural context |
| domContext.ancestorRoles | Structural context (navigation, group, list) |
| metadata (type-specific) | Parameter extraction (value, textValue, etc.) |

---

<a id="15"></a>
## 15. Performance Architecture

### When inference runs

**Post-recording batch mode.** Runs after the recording session completes. No real-time constraints, no recording performance impact.

### Why not real-time

1. Sequence context needs future knowledge (interaction N is more accurately classified knowing N+1)
2. No performance impact during recording
3. M2 observation windows close 3s after each interaction — real-time would need to wait

### Cost

- Per interaction: ~1KB evidence data
- 12 rules × ~3 effects = ~36 comparisons
- For 100 interactions: ~100KB, sub-millisecond computation
- No DOM traversal, no network calls, no LLM queries

---

<a id="16"></a>
## 16. Extensibility

### Adding a capability type
1. Add type to CapabilityType union
2. Write a rule function
3. Register in rule registry
4. Add keyword entries if applicable
5. Write tests

No existing rules change. New rules are additive — they compete via priority/confidence.

### Adding keywords
Append to dictionary data file. No code changes.

### Versioning
CapabilityRecord carries `modelVersion`. Old recordings can be reclassified.

---

<a id="17"></a>
## 17. Failure / Conflict Handling

### Two capabilities both claim HIGH
Highest supporting-signal count wins. Tie → lower priority number (more specific rule). Loser goes to alternatives array with reason.

### Two MEDIUM, no HIGH
Primary = higher signal count. Other goes to alternatives. If tied, lower priority number wins.

### Evidence conflicts
Behavioral evidence beats keyword. If required signal for FilterSelection (content-change on results) is absent, keyword "filter" is ignored.

### Missing behavioral evidence
Capabilities requiring behavioral evidence cannot fire. Only capabilities with purely physical required signals can fire (UploadFile, AdjustValue).

### Noisy observation window
LOW M2 confidence propagates. Capability may still fire at reduced confidence.

---

<a id="18"></a>
## 18. Testing Strategy

### Unit tests (~150)

Each rule tested in isolation with synthetic evidence:
- Required signals met + multiple supporting → HIGH
- Required signals met + one supporting → MEDIUM
- Required signals met + no supporting → LOW
- Required signal missing → null
- Counterexample conditions → null or overridden

10-15 tests per rule × 13 rules = ~150 unit tests

### Integration tests (~50)

Full pipeline: ComponentInteraction → M2 → Capability using synthetic recordings:
- Amazon brand filter sequence
- Form submission sequence
- Sort + filter disambiguation
- Counterexample: "Learn about filters" link
- Counterexample: "Settings saved" checkbox

### Real-world validation

| App | Capabilities exercised |
|---|---|
| Amazon.com | FilterSelection, SortSelection, Search, Paginate, Navigate, OpenDetail |
| Avis Ford | SelectOption, Search, Navigate, SubmitForm |
| OrangeHRM | ToggleControl, SelectOption, SubmitForm, Navigate, ExpandCollapse |
| Demo (slider/spinbutton) | AdjustValue |
| Demo (file upload) | UploadFile |

### Counterexample tests (automated)

Every counterexample from §12 is an automated test asserting correct classification (or correct Unclassified).

### Property-based tests

- FilterSelection requires content-change on different element
- ToggleControl requires state-toggle effect
- SortSelection requires content-change
- Unclassified requires at least one rule evaluated and returned null
- HIGH confidence requires ≥2 supporting signals, at least 1 non-keyword

---

<a id="19"></a>
## 19. Implementation Plan

### Smallest ordered plan with validation gates

---

#### Phase 1: Core engine + FilterSelection + Navigate (FOUNDATION)

**Scope:**
- `src/capabilities/capability-types.ts` — CapabilityType union, CapabilityRecord, CapabilityClaim interfaces (~80 lines)
- `src/capabilities/capability-rule.ts` — CapabilityRule interface (~30 lines)
- `src/capabilities/keyword-dictionary.ts` — V1 dictionary data + matcher (~120 lines)
- `src/capabilities/evidence-extractor.ts` — Extract structured evidence from interaction + effects + context (~100 lines)
- `src/capabilities/capability-engine.ts` — Rule engine: run all rules, resolve conflicts, produce record (~120 lines)
- `src/capabilities/conflict-resolver.ts` — Resolve competing claims by confidence + signal count + priority (~60 lines)
- `src/capabilities/rules/filter-selection.ts` — FilterSelection rule (~80 lines)
- `src/capabilities/rules/navigate.ts` — Navigate rule (~60 lines)

**Tests:** ~60 unit tests + 10 integration tests

**Validation gate:**
- All unit tests pass
- Run against real Amazon recording: brand filter → FilterSelection HIGH
- Run against real Amazon recording: product link → Navigate/OpenDetail
- Counterexample: "Learn about filters" → Navigate (NOT FilterSelection)

---

#### Phase 2: ToggleControl + ExpandCollapse + SubmitForm + Search (HIGH-VALUE RULES)

**Scope:**
- `src/capabilities/rules/toggle-control.ts` — ToggleControl rule (~50 lines)
- `src/capabilities/rules/expand-collapse.ts` — ExpandCollapse rule (~50 lines)
- `src/capabilities/rules/submit-form.ts` — SubmitForm rule (~70 lines)
- `src/capabilities/rules/search.ts` — Search rule (~60 lines)

**Tests:** ~50 unit tests + 10 integration tests

**Validation gate:**
- All Phase 1 + Phase 2 unit tests pass
- Run against OrangeHRM: checkbox toggle → ToggleControl HIGH
- Run against Amazon: search box → Search HIGH
- Run against Avis Ford: search form submit → SubmitForm HIGH
- Counterexample: "Remember me" → ToggleControl (NOT FilterSelection)
- Counterexample: "Email notifications + Settings saved" → ToggleControl (NOT FilterSelection)

---

#### Phase 3: SortSelection + SelectOption + Paginate + OpenDetail + UploadFile + AdjustValue + Unclassified (REMAINING RULES)

**Scope:**
- `src/capabilities/rules/sort-selection.ts` (~70 lines)
- `src/capabilities/rules/select-option.ts` (~50 lines)
- `src/capabilities/rules/paginate.ts` (~60 lines)
- `src/capabilities/rules/open-detail.ts` (~60 lines)
- `src/capabilities/rules/upload-file.ts` (~30 lines)
- `src/capabilities/rules/adjust-value.ts` (~40 lines)
- `src/capabilities/rules/unclassified.ts` (~30 lines)

**Tests:** ~50 unit tests + 10 integration tests

**Validation gate:**
- All 170 unit tests pass (150 rule + 20 engine)
- Full regression suite: 3,660 existing + ~170 new = ~3,830 tests, 0 failures
- Real-world validation:
  - Amazon: sort dropdown → SortSelection HIGH
  - Amazon: pagination → Paginate HIGH
  - Amazon: product click → OpenDetail
  - Avis Ford: vehicle dropdown → SelectOption
  - OrangeHRM: accordion → ExpandCollapse
  - Counterexample: sort dropdown + help popup → ExpandCollapse (NOT SortSelection)

---

#### Phase 4: Integration wiring + real-world validation (PRODUCTION)

**Scope:**
- Wire capability engine into the recording pipeline (runs after recording stops)
- Side panel: display capability labels alongside interactions
- Extension build

**Tests:** ~20 integration tests

**Validation gate:**
- Full regression suite: ~3,830+ tests, 0 failures
- Manual real-world testing on Amazon, Avis Ford, OrangeHRM
- Extension ZIP built and downloadable
- Every capability type exercised at least once across real apps
- Counterexamples verified: false classifications do not occur

---

#### Deferred: Phase 5 (OPTIONAL M2 ENRICHMENT)

**Scope:**
- M2 content-change effect enriched with `netNodeDelta` per affected path
- SortSelection rule updated to use netNodeDelta as supporting signal

**Only triggered if:** Phase 3 real-world validation shows Sort vs Filter misclassification at a meaningful rate.

**Not required for V1 classification correctness.** Sort vs Filter is already HIGH confidence from keyword + physical type + content-change. netNodeDelta is a tiebreaker for the edge case where keyword is absent.

---

### Implementation size summary

| Phase | Production lines | Test lines | Rules |
|---|---|---|---|
| Phase 1 | ~550 | ~700 | FilterSelection, Navigate |
| Phase 2 | ~230 | ~600 | ToggleControl, ExpandCollapse, SubmitForm, Search |
| Phase 3 | ~330 | ~600 | SortSelection, SelectOption, Paginate, OpenDetail, UploadFile, AdjustValue, Unclassified |
| Phase 4 | ~100 | ~300 | Integration wiring + side panel |
| **Total** | **~1,210** | **~2,200** | **12 + Unclassified** |

### No M1/M2 changes required for any phase

All phases consume existing M1/M2 output as-is. Phase 5 (netNodeDelta enrichment) is optional and deferred.
