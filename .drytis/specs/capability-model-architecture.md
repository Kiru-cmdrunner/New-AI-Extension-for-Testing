# Capability Model — Complete Architecture & Detailed Design

**Status**: Design only — not yet implemented
**Date**: 2026-08-05
**Prerequisite**: ComponentInteraction (M0.5 complete), M1 Behavioral Observation, M2 Semantic Effect Interpretation
**Pipeline position**: ComponentInteraction → M1 → M2 Semantic Effects → **Capability Model**

---

## Table of Contents

1. [Capability Definition and Boundary](#1)
2. [V1 Taxonomy](#2)
3. [Evidence Model](#3)
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
14. [M1 Raw Evidence Question](#14)
15. [Performance Architecture](#15)
16. [Extensibility](#16)
17. [Failure / Conflict Handling](#17)
18. [Testing Strategy](#18)

---

<a id="1"></a>
## 1. Capability Definition and Boundary

### Definition

The Capability Model identifies **what application/UI capability was exercised** based on observable recording evidence, without speculating about user intent or goals.

A capability is a semantic action type drawn from a universal vocabulary: filter, sort, search, navigate, submit, etc. It describes *what kind of meaningful action the user performed on the application's UI*, derived from three evidence streams:

- **Physical identity** — what control was touched (ComponentInteraction)
- **Behavioral outcome** — what the DOM did in response (M2 Semantic Effects)
- **Structural context** — where in the page the action occurred (DomContext ancestors)

### What belongs in Capability

| Responsibility | Owned by Capability |
|---|---|
| Classifying "clicked link → navigated" as `Navigate` | ✅ |
| Classifying "clicked checkbox → results list changed" as `FilterSelection` | ✅ |
| Classifying "typed text → live results changed" as `Search` | ✅ |
| Assigning confidence based on evidence quality | ✅ |
| Saying "uncertain" when evidence is ambiguous | ✅ |
| Producing a structured record with evidence references | ✅ |

### What must NOT be in Capability

| Responsibility | Belongs to | Why |
|---|---|---|
| Physical control identification (tag, role, value) | ComponentInteraction | Replayable mechanical fact — immutable |
| DOM mutation capture | M1 Observation | Raw evidence — not semantic |
| Effect classification (toggle, content-change, etc.) | M2 Semantic Effects | Behavioral abstraction — independent of action type |
| "This is step 3 of checkout" | Action Composition (future) | Cross-interaction workflow reasoning |
| "Verify only Sony products shown" | Assertion generation (future) | Domain reasoning about expected state |
| "This recording tests purchase flow" | Test intent (future) | Goal inference — explicitly excluded |
| Natural language step naming | Test Step Intelligence (future) | Language generation |

### Boundary principle

The Capability Model is a **single-interaction inference layer**. It produces one capability classification per ComponentInteraction. It does not compose actions into workflows, generate assertions, or produce natural language. It maps a physical interaction + observable evidence → a structured capability label with confidence and evidence trail.

---

<a id="2"></a>
## 2. V1 Taxonomy

### Design principle: smallest useful set

Each capability type must be:
1. **Distinguishable** from other types using observable evidence (physical + behavioral + structural)
2. **Common enough** to appear across multiple unrelated web applications
3. **Useful** — carrying different replay or verification semantics than other types

Types that cannot be reliably distinguished or that carry identical semantics are merged or deferred.

### The 12 V1 capability types + unclassified

| # | Capability | One-line meaning | Why it deserves to exist |
|---|---|---|---|
| 1 | **FilterSelection** | Narrow a result set by a criterion | Different verification: results should contain only matching items |
| 2 | **SortSelection** | Change ordering of a result set | Different verification: same items, different order |
| 3 | **Search** | Enter query text to find matching content | Different verification: results should match query text |
| 4 | **Navigate** | Move to a different page/view | Different verification: URL/route change, different page content |
| 5 | **SubmitForm** | Submit form data to the application | Different verification: application processes the submitted data |
| 6 | **SelectOption** | Choose a value from a list of options | Different verification: selected value is persisted/active |
| 7 | **ToggleControl** | Switch a binary state on/off | Different verification: element state (checked/expanded) changed |
| 8 | **ExpandCollapse** | Show/hide content in place | Different verification: content visibility without navigation |
| 9 | **OpenDetail** | Drill into a specific item's details | Different verification: item detail view appears |
| 10 | **UploadFile** | Provide a file to the application | Different verification: file accepted, file metadata shown |
| 11 | **Paginate** | Move to the next/previous page of results | Different verification: different page slice of same dataset |
| 12 | **AdjustValue** | Set a numeric/range value (slider, spinbutton) | Different verification: value applied to filter or setting |
| 0 | **Unclassified** | Insufficient evidence to classify | Explicit escape hatch — never force-fit |

### What was explicitly excluded from V1

| Excluded type | Reason |
|---|---|
| Create/Edit/Delete | These are *domain operations* (creating a user, editing a record) — they manifest as SubmitForm or SelectOption at the UI level. The application semantics (CRUD) are a future layer concern. |
| Login/Logout | Login is typically: TextEntry (username) + TextEntry (password) + SubmitForm. The "login" meaning is workflow composition, not a single-interaction capability. |
| Checkout | Multi-step workflow: Navigate → SubmitForm → SelectOption → SubmitForm. Workflow composition. |
| Add to Cart | At the physical level, this is a Click. Capability could be SubmitForm or Navigate depending on how the app works. Forcing "AddToCart" is domain-specific. |

### Generalization test

Each type must work across unrelated applications without site-specific rules:

- **FilterSelection**: Amazon brand checkbox, OXD department dropdown, React table column filter — all share: user selects a criterion → result set changes (M2 content-change on a results container)
- **SortSelection**: Amazon sort dropdown, React table header click, Bootstrap sortable list — all share: user changes ordering → same items reappear in different order
- **Search**: Amazon search bar, Avis Ford keyword search, Gmail search — all share: user enters text → live results update or navigate to search results page
- **Navigate**: Any link to a different URL, SPA route change — always detectable from navigation event + M2

---

<a id="3"></a>
## 3. Evidence Model

### Three evidence streams

The Capability Model consumes exactly these fields. Nothing else.

#### Stream 1: Physical Identity (from ComponentInteraction)

```typescript
{
  type: InteractionType;        // 'Click', 'Checkbox', 'Dropdown', 'TextEntry', 'Slider', etc.
  target: {
    tag: string;                // 'A', 'BUTTON', 'INPUT', 'DIV', etc.
    ariaRole: string | null;    // 'link', 'button', 'checkbox', 'tab', etc.
    accessibleName: string | null;
    ariaLabel: string | null;
    href: string | null;
    inputType: string | null;   // 'text', 'checkbox', 'radio', 'range', etc.
    className: string | null;
  };
  domContext: {
    inputType: string | null;
    ancestorRoles: string[];     // ['navigation', 'group', 'list', ...]
    ancestorClasses: string[];   // ['sidebar', 'filter-panel', ...]
    tabIndex: number | null;
  };
  metadata: {
    // Type-specific: textValue, value, userAdjusted, selectedDate, etc.
  };
}
```

#### Stream 2: Behavioral Outcome (from M2 Semantic Effects)

```typescript
semanticEffects: SemanticEffect[]  // 0 or more per interaction
```

Each effect carries: `category` (state-toggle, expand-collapse, enable-disable, content-change, visibility-change, no-observable-effect, unclassified), `confidence` (high/medium/low), `confidenceBasis` (direct-property / structural-inference), `affectedTarget` (cssPath, role, label).

#### Stream 3: Sequence Context (from the interaction's position in the recording)

```typescript
{
  interactionIndex: number;          // 0-based position in recording
  previousInteraction: {             // null if first
    capability?: string;             // capability of previous interaction (if already classified)
    physicalType: InteractionType;
    targetSameElement: boolean;      // did this interaction target the same element?
    targetSameForm: boolean;         // same <form> ancestor?
  } | null;
  nextInteraction: {                 // null if last — used only in batch mode
    physicalType: InteractionType;
    targetSameElement: boolean;
  } | null;
}
```

### What is NOT consumed

| Field | Source | Why excluded |
|---|---|---|
| Raw mutation records (M1 MutationRecord2[]) | M1 | Too low-level — M2 abstracts these. Consulted only in specific cases (§14). |
| PerformanceCondition | M1/ObservationResult | Performance diagnostic, not behavioral evidence |
| beforeSnapshot / finalSnapshot | M1 | Already consumed by M2 — would be redundant |
| Page URL, page title | ObservedEvent | Used by Navigate definition but not as general capability evidence |
| Coordinates (clientX/Y) | ObservedEvent | Physical replay data, not semantic |
| Scroll deltas | ObservedEvent | Physical data |

---

<a id="4"></a>
## 4. Inference Architecture

### Rule engine, not ML

The Capability Model uses a **deterministic rule engine**. Each capability type has a rule function that evaluates evidence and returns a match score or `null` (no match). The engine runs all rules and selects the best match.

### Rule evaluation flow

```
For each ComponentInteraction in the recording (batch mode):

  1. Gather evidence:
     - Physical identity fields
     - M2 Semantic Effects (already attached to the interaction)
     - Sequence context (previous/next interaction)

  2. For each capability rule in priority order:
     a. Evaluate rule(interaction, effects, context)
     b. Rule returns one of:
        - { matched: true, confidence, signals: [...] } — claim
        - { matched: false } — pass
        - { matched: true, confidence: 'low', signals: [...], blocked: true } — weak claim

  3. Resolve claims:
     - If exactly one HIGH claim → that capability wins
     - If multiple HIGH claims → conflict resolution (§17)
     - If one MEDIUM + no HIGH → MEDIUM wins
     - If only LOW claims → Unclassified (§7)
     - If no claims → Unclassified

  4. Produce CapabilityRecord with evidence trail
```

### Rule structure

Each rule is a pure function:

```typescript
interface CapabilityRule {
  capability: CapabilityType;
  priority: number;  // lower = evaluated first

  evaluate(
    physical: PhysicalEvidence,
    effects: SemanticEffect[],
    context: SequenceContext,
    keywords: KeywordDictionary,
  ): CapabilityClaim | null;
}
```

### Signal scoring

Each rule identifies **required signals** and **supporting signals**:

- **Required signal**: must be present for the rule to claim at all. If any required signal is missing, the rule returns `null`.
- **Supporting signal**: increases confidence when present, but is not mandatory. The count of supporting signals determines HIGH vs MEDIUM.

A rule with 0 supporting signals (only required signals met) claims at LOW and is typically overridden by Unclassified.

### Example: FilterSelection rule

```
Required signals (ALL must be true):
  - Physical: Click OR Checkbox OR Link OR Dropdown
  - Behavioral: at least one content-change OR visibility-change effect
    on a DIFFERENT element than the clicked target
    (the filter affects results elsewhere)

Supporting signals (each adds weight):
  - Keyword: target name/label matches filter dictionary ("filter", "brand", "category")
  - Structural: clicked element's ancestor contains "filter" or "refine" class
  - Physical: interaction is Checkbox type (checkbox-as-filter is a strong pattern)
  - Behavioral: effect target has role="list" or class containing "result" or "grid"
  - Sequence: a results container was already present on the page

Confidence:
  - Required only → LOW (something changed elsewhere, but no filter-specific signal)
  - Required + 1 supporting → MEDIUM
  - Required + 2+ supporting → HIGH
```

---

<a id="5"></a>
## 5. Keyword Dictionary Architecture

### Purpose

Keywords are ONE supporting signal among several. They generate hypotheses and boost confidence when consistent with physical + behavioral evidence. A keyword match alone **never** classifies a capability.

### Dictionary structure

```typescript
interface KeywordDictionary {
  // Maps capability type → word/phrase patterns
  filter: KeywordEntry[];
  sort: KeywordEntry[];
  search: KeywordEntry[];
  // ... one per capability type
}

interface KeywordEntry {
  pattern: RegExp;        // case-insensitive
  scope: 'label' | 'class' | 'ancestor' | 'any';
  weight: 'strong' | 'weak';
}
```

### V1 dictionary contents

**Filter dictionary:**
```
strong: /filter/i, /refine/i, /narrow.*result/i, /brand/i, /category/i
weak:   /facet/i, /criterion/i
```

**Sort dictionary:**
```
strong: /sort/i, /order.*by/i, /arrange.*by/i, /price.*low/i, /price.*high/i,
        /newest/i, /relevance/i, /rating/i, /name.*a.*z/i, /a.*to.*z/i
weak:   /ascending/i, /descending/i
```

**Search dictionary:**
```
strong: /search/i, /find/i, /query/i
weak:   /lookup/i, /locate/i
```

**Navigate dictionary:**
```
strong: /home/i, /dashboard/i, /profile/i, /settings/i, /back/i, /next/i,
        /continue/i, /proceed/i, /checkout/i, /cart/i
weak:   /go.*to/i, /visit/i
```

**Submit dictionary:**
```
strong: /submit/i, /save/i, /apply/i, /confirm/i, /send/i, /create/i, /update/i,
        /sign.*in/i, /log.*in/i, /register/i, /book.*now/i, /place.*order/i
weak:   /done/i, /finish/i, /complete/i
```

**Pagination dictionary:**
```
strong: /next.*page/i, /previous.*page/i, /page.*\d+/i, /show.*more/i,
        /load.*more/i, /view.*more/i
weak:   /pagination/i, /pager/i
```

### How keywords are matched

1. Extract candidate text from: `accessibleName`, `ariaLabel`, `className`, `ancestorClasses`
2. For each dictionary entry, test the pattern against the candidate text
3. If matched, the keyword contributes as a supporting signal to the relevant capability rule
4. **The keyword does NOT determine the classification** — it only adds weight

### False-match rejection

Keywords are filtered by the **consistency check** in the rule engine. If a keyword suggests a capability but the required signals are absent, the keyword is ignored:

| Keyword hit | Required signal present? | Outcome |
|---|---|---|
| "filter" on target label | No content-change elsewhere | Keyword ignored → Unclassified |
| "filter" on target label | content-change on results container | Keyword boosts → FilterSelection HIGH |
| "sort" on dropdown label | No content-change at all | Keyword ignored → likely SelectOption |
| "sort" on dropdown label | content-change on same list (re-ordered) | Keyword boosts → SortSelection |

### Extensibility

New words are added by appending to the dictionary arrays. No code changes needed — the dictionary is a data file loaded at runtime. Custom application dictionaries can be layered on top (future feature, not V1).

---

<a id="6"></a>
## 6. Confidence Model

### Three-tier system

| Tier | Meaning | When assigned |
|---|---|---|
| **HIGH** | Strong, multi-signal evidence. Classification is almost certainly correct. | Required signals + 2+ supporting signals (at least one non-keyword) |
| **MEDIUM** | Probable classification. Evidence is consistent but not overwhelming. | Required signals + 1 supporting signal, OR required signals from direct-property evidence |
| **LOW** | Possible but uncertain. Should not override another classification. | Required signals only, no supporting evidence |

### Key confidence rules

1. **Direct property evidence is never downgraded by noise.** If M2 produced a HIGH-confidence state-toggle from `aria-checked` changing `false→true`, that stays HIGH regardless of how many other mutations happened. The confidence reflects evidence quality, not window cleanliness.

2. **Keyword alone never produces above LOW.** A keyword match without behavioral or structural corroboration is LOW at best.

3. **Physical type contributes to confidence:**
   - Checkbox → toggle/filter is plausible (MEDIUM baseline)
   - Dropdown → sort/filter/select is plausible (MEDIUM baseline)
   - Link → navigate is plausible (MEDIUM baseline)
   - Click on a button → ambiguous (LOW baseline unless behavioral evidence clarifies)

4. **Multiple supporting signals from different streams boost confidence more than multiple from the same stream.** Physical + Behavioral + Keyword > Physical + Physical + Keyword.

5. **Absence of expected evidence degrades confidence.** If a Navigate claim expects a URL change but none is detected, confidence drops to LOW or the claim fails entirely.

### Confidence does not manufacture certainty

When evidence genuinely doesn't support HIGH, the model produces MEDIUM or LOW — or Unclassified. It never inflates confidence to make a classification "look better." A MEDIUM FilterSelection is more useful and honest than a manufactured HIGH.

---

<a id="7"></a>
## 7. Unknown / Unclassified Handling

### "Unclassified" is a valid, important output

The model must be allowed to say: "I don't have enough evidence to classify this interaction into a specific capability type." This is **better** than forcing a guess.

### When Unclassified fires

1. No capability rule's required signals are met
2. Only LOW-confidence claims exist (and no MEDIUM or HIGH)
3. Evidence is contradictory (e.g., keyword says "filter" but behavioral says "navigation")
4. The interaction is a Click on an element with no behavioral effects and no keyword matches

### What Unclassified preserves

An Unclassified capability still carries:
- The physical ComponentInteraction (fully preserved)
- Any M2 semantic effects (fully preserved)
- The raw evidence that was evaluated
- A note on why classification failed ("no behavioral effect observed", "conflicting keyword vs evidence", etc.)

### Downstream impact

Unclassified interactions are still replayable (the physical interaction is intact). They appear in test output as their physical description. Future Action Composition or AI layers can reclassify them using sequence context that the deterministic layer didn't have.

---

<a id="8"></a>
## 8. Sequence / Context Use

### Deliberate test workflow assumption

The user is recording a test scenario deliberately. This means consecutive interactions are likely related (filling a form, completing a checkout). Sequence context is **legitimate evidence** — but it must be used carefully.

### What sequence context CAN do

1. **Strengthen a weak signal.** A TextEntry followed immediately by a Click on a button labeled "Search" → the Search keyword on the button + the preceding text entry together boost Search capability to HIGH, even if neither signal alone would qualify.

2. **Disambiguate.** A Dropdown selection followed by content-change on a results container → could be FilterSelection or SortSelection. If the dropdown's ancestor is a "sort-bar" region, that's FilterSelection vs SortSelection disambiguation via sequence + structure.

3. **Provide target context.** If the previous interaction opened a dropdown and the current interaction clicks an option within it, the sequence tells us this is a SelectOption completing a dropdown interaction.

### What sequence context CANNOT do

1. **Invent a capability.** Sequence context can only boost confidence on a capability whose required signals are already met. It cannot create a classification from nothing.

2. **Override behavioral evidence.** If M2 says "content-change on results" and sequence context says "this follows a sort dropdown click," the behavioral evidence is primary. Sequence is supporting only.

3. **Speculate about intent.** "This is the third form field the user filled" does NOT mean "this is a registration form." That's workflow composition, not capability classification.

### Implementation: limited window

Sequence context looks at **one interaction back and one forward** (in batch mode). No deeper history. This prevents the model from becoming a workflow tracker while still allowing immediate-context disambiguation.

---

<a id="9"></a>
## 9. Capability Output Schema

```typescript
interface CapabilityRecord {
  // ── Identity ──
  capabilityId: string;              // 'cap-{interactionId}'
  interactionId: string;             // FK to ComponentInteraction

  // ── Classification ──
  capability: CapabilityType;        // 'FilterSelection' | 'SortSelection' | ... | 'Unclassified'
  confidence: Confidence;            // 'high' | 'medium' | 'low'

  // ── Semantic parameters ──
  parameters: {
    target?: string;                 // "Sony" (filter value), "price-low-high" (sort key), "wireless headphones" (search query)
    scope?: string;                  // "Brand" (filter scope), "Price" (sort field), "Name" (category)
    value?: string;                  // For ToggleControl: "on"/"off". For AdjustValue: "5".
  };

  // ── Evidence trail ──
  evidence: {
    physicalType: InteractionType;   // 'Click' | 'Checkbox' | 'Dropdown' | ...
    targetLabel: string | null;      // accessibleName or ariaLabel of clicked element
    semanticEffects: string[];       // ['content-change on div.results', 'visibility-change on div.product-7']
    matchedKeywords: string[];       // ['filter', 'brand'] — actual matched words
    structuralContext: string[];     // ['ancestor: navigation', 'ancestor: group[Brands]']
    sequenceNotes: string[];         // ['preceded by TextEntry on same form']
  };

  // ── Alternatives (for conflict cases) ──
  alternatives: Array<{
    capability: CapabilityType;
    confidence: Confidence;
    reason: string;                  // why this alternative was considered and rejected
  }>;

  // ── Unclassified reason (only when capability === 'Unclassified') ──
  unclassifiedReason?: string;       // "no behavioral effect", "conflicting evidence", etc.
}
```

### Design notes

- `parameters` is intentionally sparse — V1 captures only the most essential values (filter target, sort key, search query, toggle state). Richer parameterization is a future concern.
- `evidence` is a flat, human-readable trail. Every signal that contributed to the classification is listed with enough detail to audit the decision.
- `alternatives` records other capabilities that were considered. This is critical for debugging and for future AI layers that may want to reconsider.
- The record references the ComponentInteraction by `interactionId` — the physical interaction is never duplicated or replaced.

---

<a id="10"></a>
## 10. Replay Relationship

### Capability does NOT replace physical interaction

The physical ComponentInteraction is the **source of truth for replay**. When a test is executed, the replay engine uses the ComponentInteraction's IRAction (CLICK, FILL, SELECT, etc.) to mechanically reproduce the user's actions.

The Capability Record is **metadata about what those actions mean**. It is used for:

1. **Test step naming** (future): "Filter by brand Sony" instead of "Click on a.s-navigation-item"
2. **Assertion suggestion** (future): "Verify results contain only Sony products"
3. **Test organization** (future): Grouping related interactions into logical steps
4. **Reporting**: "This recording exercised: 2 filters, 1 sort, 1 search, 1 navigation"

### What Capability adds without replacing

| Replay layer | Source | Purpose |
|---|---|---|
| Physical action (how to click/type) | ComponentInteraction IRAction | Mechanical reproduction |
| Target element (what to click) | ComponentInteraction target + locator | Finding the element |
| Semantic meaning (why we clicked) | Capability Record | Test readability, assertions |

### Example

```
Physical:
  IRAction { type: 'CLICK', target: { tag: 'A', cssSelector: 'a.s-navigation-item', ... } }

Capability:
  CapabilityRecord {
    capability: 'FilterSelection',
    parameters: { target: 'Sony', scope: 'Brand' },
    confidence: 'high',
    evidence: { ... }
  }

Replay: clicks the element (from physical)
Test step: "Filter results by Brand: Sony" (from capability)
Assertion: "results should only contain Sony products" (from capability + future assertion layer)
```

---

<a id="11"></a>
## 11. Amazon Case Trace

### The interaction

User clicks the "Sony" brand filter on Amazon search results.

### DOM (real, from our investigation)

```html
<a class="a-link-normal s-navigation-item"
   href="/s?k=wireless+headphones&rh=p_123:237204&..."
   aria-label="Apply Sony filter to narrow results">
  <i class="a-icon a-icon-checkbox"></i>
  Sony
</a>
```

### Evidence available

**Stream 1 — Physical:**
```
type: 'Link'           // tag=A, href present → Link definition fires (priority 70)
target.tag: 'A'
target.ariaRole: 'link'
target.ariaLabel: 'Apply Sony filter to narrow results'
target.href: '/s?k=wireless+headphones&rh=p_123:237204...'
target.className: 'a-link-normal s-navigation-item'
domContext.ancestorRoles: ['list', 'group', 'navigation', ...]
domContext.ancestorClasses: ['', 's-navigation-slot', 's-first-column', ...]
```

**Stream 2 — Behavioral (M2 Semantic Effects from 3-second observation window):**
```
[
  SemanticEffect {
    category: 'content-change',
    description: '201 mutations across 45 paths',
    affectedTarget: { cssPath: 'div.s-main-slot', role: 'main' },
    confidence: 'medium',
    confidenceBasis: 'structural-inference'
  },
  SemanticEffect {
    category: 'visibility-change',
    description: 'element removed during rerender',
    affectedTarget: { cssPath: 'a.s-navigation-item', role: 'link' },
    confidence: 'high',
    confidenceBasis: 'element-removed'
  }
]
```

**Stream 3 — Sequence context:**
```
previousInteraction: { type: 'Navigate' or null (user arrived on search results page) }
```

**Keyword matches:**
```
ariaLabel "Apply Sony filter to narrow results" matches:
  - filter dictionary: /filter/i → strong match
  - filter dictionary: /narrow.*result/i → strong match
```

### Rule evaluation

**FilterSelection rule:**
- Required: Click/Checkbox/Link/Dropdown ✓ (Link)
- Required: content-change or visibility-change on DIFFERENT element ✓
  (content-change on `div.s-main-slot` which is not the clicked `a`)
- Supporting: keyword "filter" in ariaLabel ✓ (strong)
- Supporting: keyword "narrow results" in ariaLabel ✓ (strong)
- Supporting: ancestor class contains "navigation" (filter sidebar pattern) ✓
- Supporting: behavioral effect target has class "s-main-slot" (results container) ✓
- Result: **FilterSelection, HIGH confidence** (required + 4 supporting)

**Navigate rule:**
- Required: Link type + navigation evidence
- Navigation evidence: href present, but was there a URL change? In Amazon's case, clicking the filter DOES navigate (URL changes to include `rh=p_123:237204`). So Navigate's required signals are also met.
- Supporting: keyword "filter" contradicts navigate
- Result: **Navigate, MEDIUM confidence** (required met, but keyword evidence points elsewhere)

**Conflict resolution (§17):**
FilterSelection (HIGH) vs Navigate (MEDIUM) → FilterSelection wins.

But this is interesting — the Amazon brand filter genuinely DOES navigate (URL change). The Capability Model classifies it as FilterSelection because the behavioral evidence (massive content-change on results) and keyword evidence ("filter", "narrow results") are stronger indicators of filter semantics than the URL change. This is correct: the user's intent was to filter, not to navigate to a new section.

### Final output

```typescript
{
  capabilityId: 'cap-int-22',
  interactionId: 'int-22',
  capability: 'FilterSelection',
  confidence: 'high',
  parameters: {
    target: 'Sony',
    scope: 'Brand'
  },
  evidence: {
    physicalType: 'Link',
    targetLabel: 'Apply Sony filter to narrow results',
    semanticEffects: ['content-change on div.s-main-slot', 'visibility-change (element removed)'],
    matchedKeywords: ['filter', 'narrow results'],
    structuralContext: ['ancestor: list', 'ancestor: group', 'ancestor: navigation'],
    sequenceNotes: []
  },
  alternatives: [
    {
      capability: 'Navigate',
      confidence: 'medium',
      reason: 'URL change detected, but behavioral + keyword evidence stronger for FilterSelection'
    }
  ]
}
```

### Key point

The physical interaction remains **Link**. The capability adds **FilterSelection** as semantic metadata. The Amazon brand filter is NOT reclassified as a checkbox — it stays Link at the physical layer. The Capability Model understands it as a filter action from evidence, not from DOM structure.

---

<a id="12"></a>
## 12. Counterexamples

### "Learn about filters" link must NOT become FilterSelection

**DOM:**
```html
<a href="/help/filters">Learn about filters</a>
```

**Evidence:**
- Physical: Link type, ariaLabel "Learn about filters"
- Behavioral: Navigate (URL change to /help/filters), possibly no content-change on a results container
- Keyword: "filter" matches filter dictionary

**FilterSelection rule evaluation:**
- Required: content-change on a DIFFERENT element → **FAIL** (navigation to help page, no results container changed)
- Result: **null** — rule does not fire despite keyword match

**Navigate rule evaluation:**
- Required: Link + URL change ✓
- Supporting: keyword "learn" or "about" not in navigate dictionary, but "help" or URL path "/help/" could be weak supporting
- Result: **Navigate, MEDIUM**

**Final: Navigate, MEDIUM.** The keyword "filter" was correctly ignored because the required behavioral signal (content-change on a results container) was absent. This is the consistency check working as designed.

### Button labeled "Sort by relevance" that opens a help popup

**DOM:**
```html
<button aria-label="Sort by relevance" onclick="openHelpPopup()">Sort by relevance</button>
```

**Evidence:**
- Physical: Click on BUTTON
- Behavioral: expand-collapse or visibility-change (popup appeared) but NO content-change on a list/table
- Keyword: "sort" and "relevance" match sort dictionary

**SortSelection rule evaluation:**
- Required: content-change on a results container showing re-ordered items → **FAIL** (popup appeared, no re-ordering)
- Result: **null**

**ExpandCollapse rule evaluation:**
- Required: expand-collapse effect ✓ (popup/dialog appeared)
- Result: **ExpandCollapse, MEDIUM**

**Final: ExpandCollapse, MEDIUM.** Despite "sort" keyword, the absence of re-ordering behavioral evidence correctly blocked SortSelection.

### Checkbox that toggles dark mode

**DOM:**
```html
<input type="checkbox" id="dark-mode" aria-label="Enable dark mode">
```

**Evidence:**
- Physical: Checkbox type
- Behavioral: content-change (many style/class mutations across page as theme switches)
- Keyword: "dark mode" does NOT match filter dictionary

**FilterSelection rule evaluation:**
- Required: content-change on a different element ✓ (many mutations)
- Supporting: no keyword match for filter
- Supporting: ancestor classes unlikely to contain "filter" or "results"
- Result: **FilterSelection, LOW** (required only, no supporting) — would normally be overridden

**ToggleControl rule evaluation:**
- Required: Checkbox type + state-toggle effect ✓
- Supporting: "enable" keyword in label
- Result: **ToggleControl, HIGH**

**Final: ToggleControl, HIGH.** The behavioral signal (state-toggle from aria-checked) is stronger than the generic content-change. ToggleControl wins over the LOW FilterSelection claim.

---

<a id="13"></a>
## 13. Representative Examples

### 13.1 Search

**Scenario**: User types "wireless headphones" in Amazon search box, presses Enter.

| Evidence | Value |
|---|---|
| Physical | TextEntry (input[type=text]) |
| target.ariaLabel | "Search Amazon" |
| metadata.textValue | "wireless headphones" |
| M2 effects | content-change on results area, OR visibility-change (page navigation to results page) |
| Keyword | "search" matches search dictionary (strong) |

**Classification**: Search, HIGH
**Parameters**: { target: "wireless headphones" }

### 13.2 Filter (Checkbox-based)

**Scenario**: User checks "Free Shipping" checkbox on Amazon sidebar.

| Evidence | Value |
|---|---|
| Physical | Checkbox |
| target.ariaLabel | "Eligible for Free Shipping" |
| M2 effects | content-change on results container (filtered list) |
| Keyword | "shipping" — not directly in filter dictionary, but ancestor class "s-navigation-slot" is filter-sidebar pattern |

**Classification**: FilterSelection, MEDIUM (required + 1 structural supporting)
**Parameters**: { target: "Free Shipping" }

### 13.3 Sort (Dropdown)

**Scenario**: User selects "Price: Low to High" from sort dropdown on Amazon.

| Evidence | Value |
|---|---|
| Physical | Dropdown (select) |
| target.ariaLabel | "Sort by" or option text "Price: Low to High" |
| M2 effects | content-change on results container (re-ordered items, same count) |
| Keyword | "sort" and "price" match sort dictionary (strong) |

**Classification**: SortSelection, HIGH
**Parameters**: { target: "Price: Low to High", scope: "Price" }

### 13.4 Pagination

**Scenario**: User clicks "Next" button at bottom of search results.

| Evidence | Value |
|---|---|
| Physical | Click on BUTTON or Link |
| target.ariaLabel | "Next page" |
| M2 effects | content-change on results container (different items), possible visibility-change |
| Keyword | "next page" matches pagination dictionary (strong) |

**Classification**: Paginate, HIGH
**Parameters**: { target: "next" }

### 13.5 Submit Form

**Scenario**: User clicks "Sign In" button after entering credentials.

| Evidence | Value |
|---|---|
| Physical | Click on INPUT[type=submit] or BUTTON |
| target.ariaLabel | "Sign In" |
| M2 effects | navigation (page change) or content-change (error message) |
| Sequence | preceded by TextEntry on same `<form>` |
| Keyword | "sign in" matches submit dictionary (strong) |

**Classification**: SubmitForm, HIGH
**Parameters**: { target: "Sign In" }

### 13.6 Navigate (Link)

**Scenario**: User clicks "Home" in navigation bar.

| Evidence | Value |
|---|---|
| Physical | Link |
| target.ariaLabel | "Home" |
| M2 effects | navigation (URL/route change) |
| Keyword | "home" matches navigate dictionary (strong) |

**Classification**: Navigate, HIGH
**Parameters**: { target: "Home" }

### 13.7 Select Option (Dropdown)

**Scenario**: User selects "New" from vehicle condition dropdown on Avis Ford.

| Evidence | Value |
|---|---|
| Physical | Dropdown (select) |
| target value | "New" |
| M2 effects | possibly content-change (model dropdown updates) or no observable effect |
| Sequence | part of a search form, but no submit yet |

**Classification**: SelectOption, MEDIUM (no filter/sort behavioral pattern — just selecting a value)
**Parameters**: { target: "New", scope: "Condition" }

Note: If selecting "New" causes the Make dropdown to populate with available new vehicles (content-change), this could strengthen to FilterSelection. The rule engine handles both cases.

### 13.8 Toggle (Checkbox)

**Scenario**: User checks "Remember me" on a login form.

| Evidence | Value |
|---|---|
| Physical | Checkbox |
| M2 effects | state-toggle (aria-checked false→true), HIGH confidence |
| Keyword | "remember" not in any dictionary |

**Classification**: ToggleControl, HIGH (direct property evidence)
**Parameters**: { value: "on" }

### 13.9 Expand/Collapse

**Scenario**: User clicks "Product Details" section header on Amazon product page.

| Evidence | Value |
|---|---|
| Physical | Click |
| M2 effects | expand-collapse (aria-expanded false→true, HIGH) |
| Keyword | "details" — weak, not in any dictionary |

**Classification**: ExpandCollapse, HIGH (direct property evidence from aria-expanded)
**Parameters**: { target: "Product Details" }

### 13.10 Open Detail

**Scenario**: User clicks a product title in search results.

| Evidence | Value |
|---|---|
| Physical | Link |
| M2 effects | navigation (URL change to product page) |
| Keyword | product title text — unlikely to match any dictionary |

**Classification**: OpenDetail, MEDIUM (navigation to a specific item's page, preceded by being on a list/search results page)
Note: OpenDetail vs Navigate disambiguation — if the destination URL contains a product identifier and the source page was a list, OpenDetail wins over Navigate.

### 13.11 Upload File

**Scenario**: User clicks "Choose File" button and selects a file.

| Evidence | Value |
|---|---|
| Physical | FileUpload (input[type=file]) |
| metadata | file name captured |
| M2 effects | possibly content-change (file preview shown) or no effect |
| Keyword | "choose file" or "upload" — could match weakly |

**Classification**: UploadFile, HIGH (physical type is definitive)
**Parameters**: { target: "filename.jpg" }

### 13.12 Adjust Value (Slider)

**Scenario**: User drags price range slider from $0 to $50.

| Evidence | Value |
|---|---|
| Physical | Slider (input[type=range] or role=slider) |
| metadata.value | "50" |
| metadata.userAdjusted | true |
| M2 effects | content-change on results (price filter applied) |

**Classification**: AdjustValue, HIGH
**Parameters**: { value: "50", scope: "Price" }

Note: If the slider controls a price filter and results update, both AdjustValue and FilterSelection could claim. AdjustValue wins because the physical interaction is specifically a slider — the capability captures "adjusted a value," and the behavioral evidence confirms the filter effect. The FilterSelection alternative is recorded.

---

<a id="14"></a>
## 14. M1 Raw Evidence Question

### Normal operation: Capability operates from M2, not M1

The Capability Model normally consumes **M2 Semantic Effects** as its behavioral evidence stream. M2 has already abstracted raw mutations into semantic categories (state-toggle, content-change, etc.) with confidence levels. This is the right abstraction level for capability inference.

### When M1 raw evidence is useful

There are specific cases where M2's abstraction loses information that would help capability classification:

#### Case 1: Sort vs Filter disambiguation

Both produce content-change on a results container. M2 says "content-change" in both cases. But:
- **Sort**: same number of items, same items, different order → M1 mutation records would show equal addedNodes + removedNodes (reordering), same total count
- **Filter**: different number of items → M1 records would show net removal or addition

M2's content-change effect carries `addedNodesCount` and `removedNodesCount` per path. If we enrich M2's content-change effect to include these counts (they're already computed by M1 and partially embedded in the description string), Capability can distinguish sort from filter without consulting raw M1.

**Recommendation**: Enrich M2 content-change to include `netNodeDelta` (addedNodesCount - removedNodesCount) per affected path. This is a zero-cost M2 enhancement that gives Capability the signal it needs. No raw M1 consultation required.

#### Case 2: Multi-target effects

When one interaction affects multiple distinct containers (e.g., clicking a filter updates both a results list and a "showing X of Y" counter), M2 produces multiple content-change effects. Capability can use the count and targets of these effects. This information is already in M2's structured output — no M1 consultation needed.

#### Case 3: Mutation timing patterns

If mutations happen in a burst (synchronous app response) vs gradually over 2+ seconds (animated or async loading), this could indicate different capability semantics. M1 timestamps on mutations carry this, but M2 does not currently expose it. This is a minor signal — defer to V2.

### Conclusion

**Capability V1 can operate entirely from M2 + physical + sequence context without consulting raw M1.** The one gap (sort vs filter disambiguation) is better solved by enriching M2's content-change effect with netNodeDelta than by having Capability reach into raw mutation records. M1 remains the evidence capture layer; M2 remains the abstraction layer; Capability consumes abstractions.

---

<a id="15"></a>
## 15. Performance Architecture

### When inference runs

**Post-recording batch mode.** Capability inference runs AFTER the recording session is complete (or when the user stops recording). It processes all interactions in the recording as a batch. This gives it access to full sequence context (previous + next interaction) without real-time constraints.

### Why not real-time

1. **Sequence context needs future knowledge.** Classifying interaction N is more accurate when we know what interaction N+1 is.
2. **No performance impact during recording.** The recorder's job is to capture — adding capability inference to the real-time event pipeline would add latency to every interaction.
3. **M2 effects may arrive late.** Observation windows close 3 seconds after each interaction. Real-time capability inference would either need to wait 3s per interaction or reclassify when effects arrive.

### What data it reads

Per interaction:
- ComponentInteraction record (~200 bytes, already in memory)
- M2 Semantic Effects array (~500 bytes per interaction average)
- Sequence context (2 lookups into the interactions array)
- Keyword dictionary (loaded once, ~2KB)

Total memory per interaction: ~1KB. For a 100-interaction recording: ~100KB. Negligible.

### Computational cost

Each rule evaluation is O(1) dictionary lookups + O(effects.length) checks. With 12 rules and ~3 effects per interaction average: 36 comparisons per interaction. For 100 interactions: 3,600 comparisons. Sub-millisecond.

### No DOM traversal

The Capability Model NEVER touches the DOM. All evidence is already captured and structured by the layers below. This is by design — the recording is a snapshot, not a live page.

### No network calls

Deterministic inference only. No API calls, no LLM queries, no external lookups.

---

<a id="16"></a>
## 16. Extensibility

### Adding a new capability type

1. Add the type to `CapabilityType` union
2. Write a rule function implementing `CapabilityRule`
3. Register the rule in the rule registry
4. Add keyword entries to the dictionary (if applicable)
5. Add test cases

No existing rules or code change. New rules are additive — they compete with existing rules via the priority/confidence system.

### Adding keyword variants

Append to the dictionary data file. No code changes. The dictionary is loaded at runtime.

### Adding evidence signals

If a new evidence source becomes available (e.g., an enriched M2 effect), rules that want to use it are updated. Existing rules that don't use the new signal are unaffected.

### Versioning

Capabilities carry a `modelVersion` field. When the taxonomy or rules change, old recordings can be reclassified with the new model version. This preserves backward compatibility.

### What would break extensibility

- Hardcoding capability checks in ComponentInteraction or M2 (don't do this — Capability is a consumer, not a producer)
- Making rules depend on each other's output (rules must be independent — conflict resolution handles overlaps)
- Storing capability classification inside the physical interaction record (capability is metadata, not part of the interaction itself)

---

<a id="17"></a>
## 17. Failure / Conflict Handling

### Two capabilities both claim HIGH

**Resolution: highest signal count wins.** Each claim records how many supporting signals matched. The claim with more distinct supporting signals (from different streams) wins. If tied, the lower priority number (more specific rule) wins.

**Example**: FilterSelection (HIGH, 3 supporting) vs Navigate (HIGH, 1 supporting) → FilterSelection wins.

### Two capabilities claim MEDIUM, no HIGH

**Resolution: both recorded.** The primary classification is the higher signal count. The other goes to `alternatives`. If signal counts are identical, the rule with lower priority number wins (more specific).

**The user sees**: the primary classification with a note that another capability was considered.

### Evidence conflicts

**Example**: keyword says "filter" but behavioral evidence shows navigation with no content-change.

**Resolution: behavioral evidence wins over keyword.** Required signals override supporting signals. If the required signal for FilterSelection (content-change on results) is absent, the keyword is ignored regardless of how strongly it matched.

### Missing behavioral evidence

**Example**: user clicked something but M2 produced no-observable-effect (no mutations in 3s window).

**Resolution**: capabilities that require behavioral evidence cannot fire. Only capabilities whose required signals are purely physical can fire (e.g., UploadFile from FileUpload type, AdjustValue from Slider type with userAdjusted=true). Everything else → Unclassified.

### Noisy observation window

**Example**: 500 mutations from framework noise, M2 content-change confidence degraded to LOW.

**Resolution**: the LOW confidence propagates. FilterSelection might still fire if its required signal is met (content-change is present, just LOW), but at reduced overall confidence. The evidence trail records that the window was noisy.

### Early window close (endReason: element-removed)

**Example**: interaction target was removed from DOM during re-render, window closed early.

**Resolution**: M2's effects are still valid (visibility-change HIGH from element-removed is direct property evidence). Capability uses what's available. If only visibility-change fired and no content-change, FilterSelection may not meet required signals. Navigate might fire if URL changed.

---

<a id="18"></a>
## 18. Testing Strategy

### Unit tests

Each capability rule tested in isolation with synthetic evidence:

```
FilterSelection rule:
  ✓ claim HIGH when: Link + content-change on results + keyword "filter" + structural ancestor
  ✓ claim MEDIUM when: Link + content-change on results + keyword only
  ✓ claim LOW when: Link + content-change on results (no supporting)
  ✗ null when: Link + no content-change (keyword "filter" present but required signal missing)
  ✗ null when: TextEntry physical type (wrong physical type)

SortSelection rule:
  ✓ claim HIGH when: Dropdown + content-change with netNodeDelta=0 + keyword "sort"
  ✗ null when: Dropdown + content-change with netNodeDelta=-15 (items removed = filter, not sort)

(10-15 unit tests per rule × 12 rules = ~150 unit tests)
```

### Integration tests

Full pipeline: ComponentInteraction → M2 → Capability. Use synthetic recordings simulating real interaction sequences:

```
Test: "Amazon brand filter recording"
  - Simulate: Click on a.s-navigation-item[aria-label="Apply Sony filter"]
  - Feed M2 effects: content-change on div.s-main-slot
  - Assert: capability = FilterSelection, confidence = HIGH

Test: "Form submission recording"
  - Simulate: TextEntry(username) → TextEntry(password) → Click(submit)
  - Assert: third interaction = SubmitForm, confidence = HIGH
  - Assert: sequence context used (preceded by TextEntry on same form)
```

### Real-world validation

Deliberately chosen applications covering all V1 taxonomy types:

| App | Capabilities exercised |
|---|---|
| Amazon.com | FilterSelection, SortSelection, Search, Paginate, Navigate, OpenDetail |
| Avis Ford | SelectOption, Search, Navigate, SubmitForm |
| OrangeHRM | ToggleControl, SelectOption, SubmitForm, Navigate, ExpandCollapse |
| Demo app with sliders/spinbuttons | AdjustValue |
| Demo app with file upload | UploadFile |
| React app with accordion | ExpandCollapse |

For each: record manually with the extension, verify Capability classifications match expected, verify evidence trail is complete and accurate.

### Counterexample tests

Every counterexample from §12 is an automated test:

```
Test: "Learn about filters link must NOT be FilterSelection"
  - Simulate: Link click, ariaLabel="Learn about filters", navigate to /help/filters
  - M2: navigation effect, no content-change on results
  - Assert: capability = Navigate (NOT FilterSelection)
  - Assert: keyword "filter" was evaluated but ignored (required signal absent)
```

### Property-based tests

- For any interaction where FilterSelection fires, content-change or visibility-change MUST be present in evidence
- For any interaction where SortSelection fires, netNodeDelta should be ≈ 0
- For any Unclassified result, at least one capability rule must have been evaluated and returned null
- Confidence HIGH requires ≥2 supporting signals, at least one non-keyword

---

## End-to-End Architecture Summary

### Data flow

```
Recording session:
  User interacts with page
    ↓
  EventTap captures events
    ↓
  ComponentRuntime classifies → ComponentInteraction (physical layer)
    ↓
  ObservationCoordinator opens 3s window per click/change
    ↓
  DocumentObserver + ElementStateCache capture mutations
    ↓
  ObservationResult produced (M1)
    ↓
  EffectInterpreter runs rules → SemanticEffects (M2)
    ↓
  SemanticEffects attached to interaction
  
After recording (batch):
  For each interaction:
    ↓
  CapabilityRuleEngine.evaluate(interaction, effects, context, keywords)
    ↓
  CapabilityRecord produced
    ↓
  Stored alongside ComponentInteraction
```

### Module / file boundaries

```
src/capabilities/
  ├── capability-types.ts          — CapabilityType union, CapabilityRecord interface
  ├── capability-rule.ts           — CapabilityRule interface, CapabilityClaim type
  ├── capability-engine.ts         — Rule engine: evaluate all rules, resolve conflicts
  ├── keyword-dictionary.ts        — V1 dictionary data + matcher
  ├── evidence-extractor.ts        — Extracts structured evidence from interaction + effects
  ├── conflict-resolver.ts         — Resolves competing claims
  └── rules/
      ├── filter-selection.ts      — FilterSelection rule
      ├── sort-selection.ts        — SortSelection rule
      ├── search.ts                — Search rule
      ├── navigate.ts              — Navigate rule
      ├── submit-form.ts           — SubmitForm rule
      ├── select-option.ts         — SelectOption rule
      ├── toggle-control.ts        — ToggleControl rule
      ├── expand-collapse.ts       — ExpandCollapse rule
      ├── open-detail.ts           — OpenDetail rule
      ├── upload-file.ts           — UploadFile rule
      ├── paginate.ts              — Paginate rule
      ├── adjust-value.ts          — AdjustValue rule
      └── unclassified.ts          — Fallback (always produces a record)

~600 production lines, ~1200 test lines
```

### Phased implementation plan

| Phase | Scope | Est. size |
|---|---|---|
| **Phase 1** | Core engine + types + evidence extractor + keyword dictionary + 3 rules (FilterSelection, Navigate, SubmitForm) | ~250 prod lines, ~400 test lines |
| **Phase 2** | Remaining 9 rules + conflict resolver | ~250 prod lines, ~500 test lines |
| **Phase 3** | Integration tests + real-world validation (Amazon, Avis Ford, OrangeHRM) | ~300 test lines |
| **Phase 4** | M2 enrichment: netNodeDelta in content-change effect | ~30 prod lines, ~50 test lines |

### Known limitations (V1)

1. **Sort vs Filter** relies on netNodeDelta (M2 enrichment needed in Phase 4). Without it, both produce identical content-change and disambiguation depends on keyword + physical type.
2. **OpenDetail vs Navigate** is inherently ambiguous for many apps. V1 uses heuristics (product ID in URL, preceded by list context) that won't be perfect.
3. **Multi-capability interactions** (one interaction exercises two capabilities simultaneously) produce one primary + alternatives. Some co-occurring capabilities may be better represented as co-equal rather than winner/loser.
4. **Keyword dictionary is English-only.** Multilingual support is a future concern.
5. **No dynamic capability discovery.** If an app has a novel capability type not in V1, it falls to Unclassified. The model cannot invent new types.
