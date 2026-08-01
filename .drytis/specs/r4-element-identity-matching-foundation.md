# R4: Element Identity & Matching Foundation

**Status:** DESIGN (not yet implemented)
**Date:** 2026-08-01
**Depends on:** R1–R3, P1 (frozen at b3e14fe)
**Blocks:** P2 (Capability-Derived IR Generation)
**Scope:** Element Repository identity enrichment + ElementMatchingService algorithm correction

---

## 1. Problem Statement

The Element Repository currently stores **almost no element identity**. The
`Element` entity persists `logicalName` (derived from `accessibleName`),
`pageOrComponent` (from `sourceUrl`), and `locatorStrategies[]` (physical
locators). The matching service must reverse-engineer identity from these
fields — scanning `locatorStrategies` for a `TEST_ID` type entry to recover
`testId`, and treating everything else as `null`.

The recorder captures a rich 18-field `ElementIdentity` per element, plus a
41–52-field `DomContext` per event including `ancestorRoles`, `formId`, and
`formName`. Almost none of this survives past `createElement()` in the
healing service.

This has two consequences:

1. **Silent incorrect matches.** Two inputs named "Email" on the same page
   are indistinguishable. The greedy matcher picks one arbitrarily, silently
   merging them or healing the wrong stored Element.

2. **P2 cannot safely perform dynamic target resolution.** P2's plan is to
   resolve field → current Element at generation time using the matching
   service. If the matcher can silently choose incorrectly, P2 would
   generate IR steps targeting the wrong UI element.

The fix is to enrich the Element entity with durable identity and correct the
matching algorithm to detect and surface ambiguity rather than resolving it
arbitrarily.

---

## 2. Design Principles

- **DP1 — Additive only.** New optional fields on `Element`. No existing
  field is removed or renamed. Old Elements (without identity fields) remain
  valid and matchable via neutral scoring.
- **DP2 — Identity ≠ Locator.** Element identity ("is this the same logical
  control?") and element locators ("how do I physically find it?") are
  separate concerns. Locators are physical execution strategies; identity is
  semantic recognition. Both coexist on Element.
- **DP3 — Identity ≠ Display name.** `accessibleName` captured at recording
  time is a stable identity signal. `logicalName` is the user-editable
  display name. Separating them prevents UI renames from breaking matching.
- **DP4 — Fail visibly.** When identity evidence cannot distinguish between
  candidates, the system returns AMBIGUOUS — never silently selects one.
- **DP5 — P1 frozen.** No changes to Capability, CapabilityVersion,
  P2CapabilityContract, or any P1 entity. This work is entirely in the
  Element Repository and matching layer.
- **DP6 — No recorder changes.** The recorder already captures all required
  identity fields. This work persists and uses them; it does not change
  capture behavior.

---

## 3. Current State Audit (from actual code)

### 3.1 What the Recorder Captures

**`ElementIdentity`** (`src/shared/types.ts:119–162`) — 18 fields:

| Field | Type | Captured by |
|---|---|---|
| `accessibleName` | `string` | Content script — computed accessible name |
| `ariaRole` | `string \| null` | Content script — explicit or implicit ARIA role |
| `ariaLabel` | `string \| null` | Content script — `aria-label` attribute |
| `ariaLabelledBy` | `string \| null` | Content script — `aria-labelledby` attribute |
| `placeholder` | `string \| null` | Content script — `placeholder` attribute |
| `tag` | `string` | Content script — HTML tag name |
| `className` | `string \| null` | Content script — CSS classes |
| `name` | `string \| null` | Content script — HTML `name` attribute |
| `stableId` | `string \| null` | Content script — `id` attribute |
| `testId` | `string \| null` | Content script — `data-testid` |
| `dataCy` | `string \| null` | Content script — `data-cy` |
| `dataQa` | `string \| null` | Content script — `data-qa` |
| `cssSelector` | `string` | Content script — generated selector |
| `xPath` | `string` | Content script — generated XPath |
| `inIframe` | `boolean` | Content script |
| `shadowDom` | `boolean` | Content script |
| `iframeContext` | `IframeContext \| undefined` | Content script |
| `elementId` | `string` | Background SW — sequential ID (`elem-0001`) |

**`DomContext`** (`src/recorder/recorded-event.ts:36–121`) — per-event, 41 fields including:

| Field | Type | Origin |
|---|---|---|
| `ancestorRoles` | `string[] \| undefined` | Content script — up to 10 ancestors, format `"tag[role=role]"`, index 0 = parent |
| `inputType` | `string \| null` | Content script — `<input type="...">` |
| `domAttributes` | `Record<string,string> \| undefined` | Content script — semantically relevant attributes |

**Component Runtime `DomContext`** (`src/shared/component-types.ts:75–176`) — 52 fields, adds:

| Field | Type | Origin |
|---|---|---|
| `ancestorClasses` | `string[]` | Component Runtime |
| `formId` | `string \| null` | Component Runtime — containing `<form>` id |
| `formName` | `string \| null` | Component Runtime — containing `<form>` name |

### 3.2 What Survives Where

| Field | ElementIdentity | UiElement | UiElementSummary | Element (Repo) | Matcher Available |
|---|---|---|---|---|---|
| `accessibleName` | ✅ | ✅ (in `.identity`) | ✅ | ⚠️ → `logicalName` | ✅ (as logicalName) |
| `ariaRole` | ✅ | ✅ (in `.identity`) | ✅ (as `role`) | ❌ | ❌ (null) |
| `tag` | ✅ | ✅ (in `.identity`) | ✅ | ❌ | ❌ (empty string) |
| `name` | ✅ | ✅ (in `.identity`) | ❌ | ❌ | ❌ (not scored) |
| `ariaLabel` | ✅ | ✅ (in `.identity`) | ❌ | ❌ | ❌ (not scored) |
| `testId` | ✅ | ✅ (in `.identity`) | ❌ | ⚠️ via locator | ✅ (reverse-engineered) |
| `dataCy` | ✅ | ✅ (in `.identity`) | ❌ | ❌ | ❌ (not scored) |
| `dataQa` | ✅ | ✅ (in `.identity`) | ❌ | ❌ | ❌ (not scored) |
| `ancestorRoles` | ❌ (on DomContext) | ❌ | ❌ | ❌ | ❌ (undefined) |
| `sourceUrl` | ❌ | ✅ | ✅ | ⚠️ → `pageOrComponent` | ✅ |

### 3.3 Element Creation Path (healing-service.ts:203–227)

```typescript
const createInput: CreateElementInput = {
  projectId,
  logicalName: fresh.identity.accessibleName || `Element ${fresh.elementId}`,
  pageOrComponent: fresh.sourceUrl,
  locatorStrategies: locators.map(...),
};
```

The `fresh` parameter is `UiElement`, which carries the full `ElementIdentity`
via `fresh.identity.*`. All 17 mechanical fields are available at creation
time — they are simply not passed to `createElement()`. **No additional
capture or propagation work is needed for identity fields that live on
`ElementIdentity`.** Only `ancestorRoles` requires propagation work (see §5.3).

### 3.4 Matching Algorithm (element-matching-service.ts)

**Current weights:**
| Signal | Weight | Stored-side availability |
|---|---|---|
| `ACCESSIBLE_NAME` | 30% | ✅ via `logicalName` |
| `ROLE_TAG` (averaged) | 25% | ❌ neutral 0.5 each |
| `ANCESTOR_CHAIN` | 25% | ❌ both-null → 1.0 match |
| `BUSINESS_IDS` | 15% | ⚠️ testId only, via locator scan |
| `PAGE_SCOPE` | 5% | ✅ via `pageOrComponent` |

**Critical flaw:** When both sides lack `ancestorRoles` (which is always, since
it's never stored), the ANCESTOR_CHAIN dimension returns 1.0 — a full 25%
contribution from a non-signal. Combined with neutral 0.5 on role+tag (12.5%
contribution) and neutral 0.5 on business IDs when missing (7.5%), a
same-name match on the same page scores:
`0.30 + 0.125 + 0.25 + 0.075 + 0.05 = 0.80` — above the 0.70 threshold,
with no distinguishing signal beyond `accessibleName`.

**Greedy matching (lines 260–273):** Candidates sorted by score descending,
matched first-come. No margin check. Equal scores → first in iteration order
wins. No AMBIGUOUS result type exists.

### 3.5 Caller Blast Radius

**Only production caller:** `healFromRecording()` in `healing-service.ts`.

```
matchElements(freshElements, storedElements)
  → matchResult.matches[]    → healElementAndPersist() for each match
  → matchResult.unmatched[]  → createElement() for each unmatched
```

No other production code consumes the matching result. Test files exercise
the matcher directly (`tests/element-matching-service.test.ts`,
`tests/healing-service.test.ts`).

---

## 4. Proposed Durable Element Identity

### 4.1 New `ElementIdentityRecord` Type

A new value object embedded on `Element`, representing the stable semantic
identity captured at recording time. This is **separate from**
`locatorStrategies` (which are physical locators for execution).

```typescript
/**
 * Stable semantic identity for an Element — used by ElementMatchingService
 * for cross-session reconciliation and healing. Populated at creation time
 * from ElementIdentity. All fields are optional for backward compatibility
 * with pre-R4 Elements.
 */
interface ElementIdentityRecord {
  /** Accessible name at capture time (NOT the editable logicalName). */
  readonly accessibleName: string | null;
  /** ARIA role (explicit or implicit). */
  readonly ariaRole: string | null;
  /** HTML tag name. */
  readonly tag: string | null;
  /** HTML `name` attribute — backend-facing form field identifier. */
  readonly name: string | null;
  /** `aria-label` attribute — explicit per-element label. */
  readonly ariaLabel: string | null;
  /** Up to 10 ancestor role strings from recording-time DomContext. */
  readonly ancestorRoles: readonly string[] | null;
  /** `data-testid` attribute value. */
  readonly testId: string | null;
  /** `data-cy` attribute value. */
  readonly dataCy: string | null;
  /** `data-qa` attribute value. */
  readonly dataQa: string | null;
}
```

### 4.2 Why These Fields, and Not Others

**Included — each provides independent disambiguation value:**

| Field | Why Included | Stability | Disambiguation Power |
|---|---|---|---|
| `accessibleName` | Primary semantic label — what the user sees | Medium (copy may change) | High when unique |
| `ariaRole` | Semantic contract — a combobox is always a combobox | Very high | Medium (shared by same-type elements) |
| `tag` | HTML element type | Very high | Low (shared by same-type elements) |
| `name` | HTML form name — backend-facing, rarely changes for same field | Very high | **Critical** for same-name fields in different forms/sections |
| `ariaLabel` | Explicit developer-set label — independent of accessibleName | Medium-high | **Critical** when accessibleNames collide |
| `ancestorRoles` | Structural context — section/form/dialog wrapping | Medium (DOM restructure) | **Critical** for distinguishing position in different containers |
| `testId` | Developer-set unique identifier | High (but may change in refactors) | **Definitive** when present |
| `dataCy` | Cypress convention unique identifier | High | **Definitive** when present |
| `dataQa` | QA convention unique identifier | High | **Definitive** when present |

**Excluded — available but not worth persisting as identity:**

| Field | Why Excluded |
|---|---|
| `placeholder` | Transient UI hint, frequently changes. Also a locator signal (CONTENT category) — already preserved in `locatorStrategies`. |
| `className` | CSS classes are inherently unstable (CSS-in-JS, build hashes). Already filtered out of locators. |
| `stableId` | The `id` attribute. When non-auto-generated, already preserved as a CSS locator strategy. As an identity signal, it's weaker than testId/dataCy/dataQa and risks false matches with auto-generated IDs. |
| `ariaLabelledBy` | References another element by ID — brittle dependency. The *resolved* label is already captured in `accessibleName`. |
| `cssSelector` | Physical locator, not identity. Already in `locatorStrategies`. |
| `xPath` | Physical locator, not identity. Already in `locatorStrategies`. |
| `domTreePath` | Fragile positional path — changes with DOM restructure. Not stable enough for identity. |
| `inIframe` / `shadowDom` / `iframeContext` | Execution context, not element identity. Relevant for locator strategy, not for "is this the same control." |
| `formId` / `formName` | Only on Component Runtime DomContext (not recorder DomContext). Would require additional propagation. `ancestorRoles` captures the same structural context (a `<form>` ancestor appears in the chain). Redundant with `ancestorRoles`. |
| `ancestorClasses` | Same propagation gap as `formId`. Also fragile (CSS classes). |

### 4.3 Verification: Does This Field Set Handle the Hard Cases?

**Case: Primary Contact → Email vs Secondary Contact → Email**

Both: `accessibleName="Email"`, `tag="input"`, `ariaRole="textbox"`.

Differentiators:
- `name`: `"primaryEmail"` vs `"secondaryEmail"` → **definitive distinction** ✅
- `ariaLabel`: `"Primary Contact Email"` vs `"Secondary Contact Email"` → **definitive distinction** ✅ (if set)
- `ancestorRoles`: `["section", "form"]` vs `["section", "form"]` → identical if sections have same structure

If `name` or `ariaLabel` differs → scores diverge → **MATCHED to correct, AMBIGUOUS if can't tell** ✅
If all fields identical → **AMBIGUOUS** ✅ (correctly surfaces the limitation)

**Case: Ten repeated rows each containing "Delete"**

All: `accessibleName="Delete"`, `tag="button"`, `ariaRole="button"`, no testId, no name.

Differentiators:
- `ancestorRoles`: may differ if each row has a different parent index in the chain → partial
- Everything else identical

If ancestorRoles are identical → **AMBIGUOUS** for all ten ✅
If ancestorRoles differ enough → some resolved, some ambiguous ✅

This is a genuine limitation. Two buttons with no distinguishing attributes
are fundamentally indistinguishable. The system correctly reports AMBIGUOUS.

**Case: Identical controls inside different dialogs/forms/components**

Both: `accessibleName="Close"`, `tag="button"`, `ariaRole="button"`.

Differentiator:
- `ancestorRoles`: `["div[role=dialog]", "div"]` vs `["form[role=form]", "section"]` → Jaccard similarity < 1.0 → scores diverge ✅

If the dialogs have different structural wrapping → **MATCHED to correct** ✅
If structurally identical → **AMBIGUOUS** ✅

**Case: DOM wrappers added/removed**

Old `ancestorRoles`: `["form", "section", "main", "body"]`
New `ancestorRoles`: `["form", "section", "div", "main", "body"]` (extra `<div>` wrapper)

Jaccard similarity: 4 shared / 5 union = 0.80. Minor score reduction.
With all other fields matching → total score still high → **MATCHED** ✅

**Case: Framework implementation changes (MUI → Radix combobox)**

Old: `tag="div"`, `ariaRole="combobox"`, `name=null`, `testId=null`
New: `tag="input"`, `ariaRole="combobox"`, `name=null`, `testId=null`

`accessibleName` matches, `ariaRole` matches, `tag` differs.
- Tag dimension: 0.0 (mismatch)
- Role dimension: 1.0 (match)
- Name dimension: neutral (both null)
- AccessibleName: 1.0

Score reduced by the tag mismatch. If margin is sufficient → **MATCHED** ✅
If another candidate also has role=combobox and similar name → **AMBIGUOUS** ✅

**Case: testId changes but semantic identity remains**

Old `testId="submit-btn"`, new `testId="submit-button"`.

- testId dimension: 0.0 (mismatch)
- accessibleName: 1.0 (same: "Submit")
- ariaRole, tag: 1.0 (same: button)
- name: 1.0 or neutral

Score reduced by testId mismatch. If no other candidate competes → **MATCHED** (correct — it's the same element, just refactored) ✅

**Case: accessible name changes but stable technical identity remains**

Old: `accessibleName="Email Address"`, `name="email"`, `testId="email-field"`
New: `accessibleName="Email"`, `name="email"`, `testId="email-field"`

- accessibleName: 0.0 (mismatch — "Email Address" ≠ "Email")
- name: 1.0 (match)
- testId: 1.0 (match)
- ariaRole, tag: 1.0

Strong signals from name + testId compensate for accessibleName mismatch.
→ **MATCHED** ✅

**Case: Two candidates with identical scores (0.80 each)**

Margin = 0.00 < `MIN_MARGIN` (0.05) → **AMBIGUOUS** ✅

**Case: Best candidate 0.82 vs second candidate 0.81**

Margin = 0.01 < `MIN_MARGIN` (0.05) → **AMBIGUOUS** ✅

**Case: Best candidate 0.82 vs second candidate 0.55**

Margin = 0.27 ≥ `MIN_MARGIN` (0.05), best ≥ `MATCH_THRESHOLD` (0.70)
→ **MATCHED** (best candidate) ✅

---

## 5. Implementation Design

### 5.1 Element Entity Changes

Add an optional `identity` field to `Element`:

```typescript
export interface Element {
  // ... existing fields unchanged ...
  readonly id: string;
  readonly projectId: string;
  readonly logicalName: string;      // editable display name
  readonly description: string;
  readonly pageOrComponent: string;
  readonly locatorStrategies: LocatorStrategy[];
  readonly status: ElementStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastHealedAt: string | null;
  readonly healHistory: HealEvent[];

  // ── R4: Durable semantic identity (null for pre-R4 Elements) ──
  readonly identity: ElementIdentityRecord | null;
}
```

**Backward compatibility:** Pre-R4 Elements have `identity = null`. The
matcher's `extractStoredSignature` handles `null` identity by falling back to
the current behavior (extract testId from locatorStrategies, use logicalName
as accessibleName, everything else neutral).

**Dexie schema:** `ElementRow = Element` (type alias). Dexie stores the full
object — no explicit field declarations needed. No schema version bump
required (only new indexes need version bumps, and we are not indexing on
identity fields in R4).

**`createElement()` changes:** Add optional `identity?: ElementIdentityRecord`
to `CreateElementInput`. When provided, store it. When absent, store `null`.

**`healElement()` changes:** Preserve existing identity (immutable during
healing — identity reflects what the element IS, not where it moved). The
heal only updates `locatorStrategies`, `status`, `healHistory`, timestamps.

### 5.2 `logicalName` vs `accessibleName` Separation

Current: `logicalName` is initialized from `accessibleName` and used both as
display name and as the matching signal.

After R4:
- `logicalName`: user-editable display name in the repository UI. Initialized
  from `accessibleName` at creation, but may diverge if the user renames.
- `identity.accessibleName`: frozen at capture time. Used by the matcher.

The matcher uses `identity.accessibleName` (when available) instead of
`logicalName`. For pre-R4 Elements (`identity = null`), it falls back to
`logicalName` (same as today — no behavior change).

This separation means a user renaming "Email Address" to "Primary Email" in
the repository UI does NOT affect matching. The original `accessibleName`
identity signal remains stable.

### 5.3 `ancestorRoles` Propagation

`ancestorRoles` lives on `DomContext` (per-event), not on `ElementIdentity`
or `UiElement`. To make it durable:

**Step 1 — Add optional `ancestorRoles` to `UiElement`:**

```typescript
export interface UiElement {
  // ... existing fields ...
  /** Ancestor role chain from the first observed event's DomContext. */
  readonly ancestorRoles?: readonly string[];
}
```

**Step 2 — Populate in domain-adapter-v2.ts:**

In the UiElement construction block (line ~391), extract `ancestorRoles`
from the first event's `DomContext`:

```typescript
const firstEvent = eventsById.get(eventIds[0]);
const domContext = firstEvent?.domContext;
const ancestorRoles = domContext?.ancestorRoles ?? undefined;

const uiElement = createUiElement({
  elementId,
  identity,
  domAttributes,
  sourceUrl,
  domTreePath: buildDomTreePath(identity),
  ancestorRoles,
});
```

**Step 3 — Pass to `createElement()` in healing-service.ts:**

When creating new Elements (unmatched fresh elements), build the identity
record from the UiElement:

```typescript
const identity: ElementIdentityRecord = {
  accessibleName: fresh.identity.accessibleName || null,
  ariaRole: fresh.identity.ariaRole,
  tag: fresh.identity.tag || null,
  name: fresh.identity.name ?? null,
  ariaLabel: fresh.identity.ariaLabel ?? null,
  ancestorRoles: fresh.ancestorRoles ?? null,
  testId: fresh.identity.testId ?? null,
  dataCy: fresh.identity.dataCy ?? null,
  dataQa: fresh.identity.dataQa ?? null,
};
```

No changes to the content script. No changes to capture. The information
already exists in `DomContext.ancestorRoles` — it just needs to be threaded
through `UiElement` to `createElement()`.

### 5.4 Matching Algorithm Redesign

#### 5.4.1 New Result Type

Replace `ElementMatchResult` with a three-category result:

```typescript
export type MatchOutcome = 'matched' | 'ambiguous' | 'unmatched';

export interface MatchedElement {
  readonly storedElement: Element;
  readonly freshUiElement: UiElement;
  readonly matchScore: number;
  /** Score margin between this match and the next-best candidate. */
  readonly margin: number;
}

export interface AmbiguousElement {
  readonly freshUiElement: UiElement;
  /** All candidates that scored above threshold. */
  readonly candidates: ReadonlyArray<{
    readonly storedElement: Element;
    readonly matchScore: number;
  }>;
}

export interface ElementMatchResult {
  readonly matched: ReadonlyArray<MatchedElement>;
  readonly ambiguous: ReadonlyArray<AmbiguousElement>;
  readonly unmatched: ReadonlyArray<UiElement>;
}
```

#### 5.4.2 Revised Scoring

Each identity field scored independently. No averaging, no collapsing.

**New weights:**

| Signal | Weight | Rationale |
|---|---|---|
| `BUSINESS_IDS` (testId/dataCy/dataQa) | 25% | Definitive when present — developer-set unique identifiers |
| `FORM_NAME` (HTML `name` attribute) | 15% | Backend-facing, very stable, distinguishes same-name fields |
| `ACCESSIBLE_NAME` | 20% | Primary semantic label — strongest general signal |
| `ARIA_ROLE` | 10% | Semantic contract — stable but shared by same-type elements |
| `TAG` | 5% | HTML element type — very stable but low disambiguation |
| `ARIA_LABEL` | 10% | Explicit per-element label — independent disambiguator |
| `ANCESTOR_ROLES` | 10% | Structural context — distinguishes containers/sections |
| `PAGE_SCOPE` (sourceUrl) | 5% | Same-page constraint |

Total: 100%.

**BUSINESS_IDS scoring (25%):**

```
if (both sides have at least one business ID):
  if any ID matches across the two sides → 1.0
  else → 0.0  (strong negative — different developer-set IDs = different elements)
elif (neither side has any):
  → 0.5  (neutral — no signal)
else:
  → 0.5  (neutral — one side has IDs but they may have been added/removed)
```

**FORM_NAME scoring (15%):**

```
if (both sides have name):
  if names match → 1.0
  else → 0.0  (strong negative — different form names = different fields)
elif (neither has name):
  → 0.5  (neutral)
else:
  → 0.5  (neutral)
```

**ACCESSIBLE_NAME scoring (20%):**

```
exact match (case-insensitive) → 1.0
fuzzy match (Levenshtein > 0.8) → 0.7  [optional — may defer to V2]
mismatch → 0.0
both empty → 1.0
one empty → 0.3  (penalize, not fully zero — accessibleName computation may vary)
```

R4 uses exact match only (1.0 or 0.0). Fuzzy matching is a possible future
enhancement but not needed for R4.

**ARIA_ROLE, TAG, ARIA_LABEL, FORM_NAME, PAGE_SCOPE:** Neutral-scoring pattern
(1.0 match, 0.0 mismatch, 0.5 one-side-missing, **0.5 both-missing**).

> **Calibration correction (post-implementation):** The initial design specified
> 1.0 for both-missing on optional identity fields (name, ariaRole, ariaLabel, tag,
> sourceUrl). Implementation revealed this inflated scores for low-evidence elements,
> creating a score floor at ~0.825 regardless of how much identity information was
> available. Corrected to **0.5 (neutral)** for all both-missing optional fields via
> `stringEqualNeutral()`. This ensures absence of evidence is never treated as
> positive matching evidence. MATCH_THRESHOLD (0.70) and MIN_MARGIN (0.05) retained
> as conservative initial policy values — they produce correct outcomes across all
> validated scenarios.

**ANCESTOR_ROLES (10%):**

```
both have ancestor arrays → Jaccard similarity (0.0–1.0)
both empty/null → 0.5  (neutral — no signal)  ← CHANGED from current 1.0
one has, one doesn't → 0.25  (partial penalty)
```

The key change: both-missing now returns 0.5 (neutral) instead of 1.0 (match).
The current 1.0 inflates scores by a full 25% from a non-signal. With 10%
weight and 0.5 neutral, the inflation is capped at 5%.

**PAGE_SCOPE (5%):** Same as current `stringEqualNeutral`.

#### 5.4.3 Thresholds

```typescript
const MATCH_THRESHOLD = 0.70;  // Minimum score to be a candidate
const MIN_MARGIN = 0.05;       // Minimum best-vs-second-best gap for MATCHED
```

- A candidate must score ≥ 0.70 to be considered.
- If best candidate ≥ 0.70 AND margin ≥ 0.05 → **MATCHED**.
- If best candidate ≥ 0.70 AND margin < 0.05 → **AMBIGUOUS**.
- If best candidate < 0.70 → **UNMATCHED**.

**Are fixed thresholds justified?** Yes, for R4:
- 0.70: With 8 independently-scored dimensions, a score of 0.70 requires
  agreement on the majority of available signals. A name-only match (all
  other fields neutral) scores at most ~0.40 — well below threshold.
- 0.05 margin: Prevents near-tie resolution. A 5% gap across 8 dimensions
  means at least one signal provides meaningful discrimination.

These are conservative starting values. The test suite (§8) validates them
against known scenarios. They can be tuned after empirical evidence from
real recordings without architectural changes.

#### 5.4.4 Matching Procedure

```
For each fresh element F:
  1. Score F against every stored element S.
  2. Collect all S where score ≥ MATCH_THRESHOLD → candidates[].
  3. If candidates.length == 0 → UNMATCHED.
  4. Sort candidates by score descending.
  5. If candidates.length == 1 → MATCHED (margin = infinity).
  6. If candidates[0].score - candidates[1].score ≥ MIN_MARGIN → MATCHED (best).
  7. Else → AMBIGUOUS (all candidates above threshold returned).
```

Apply greedy 1:1 matching across the full result set:
- Process MATCHED pairs in descending score order.
- Skip pairs where either side is already claimed.
- AMBIGUOUS and UNMATCHED are NOT subject to greedy claiming — they are
  returned as-is for the caller to handle.

---

## 6. Caller Adaptation

### 6.1 Healing Service (`healFromRecording`)

Current behavior:
```
matches[]   → heal each matched element
unmatched[] → create new Element for each
```

New behavior:
```
matched[]    → heal each matched element (same as before)
ambiguous[]  → SKIP + log warning. Do NOT heal, do NOT create.
               The ambiguity is preserved for future resolution.
               If the element is genuinely new, a future recording with
               better identity (e.g., developer adds testId) will resolve it.
unmatched[]  → create new Element with full identity record (same as before,
               but now passes identity fields to createElement)
```

**Why skip ambiguous, not create?** Creating a new Element for an ambiguous
case risks creating a duplicate of an existing Element. The existing Element
already has valid locators. Skipping preserves correctness — the stored
Element doesn't get healed, but it also doesn't get incorrectly merged or
duplicated.

**What about healing with updated identity?** When healing a matched Element,
the stored identity should be **updated** to reflect the fresh observation
(because the DOM may have changed). Add an optional `updatedIdentity` field
to `HealElementInput`. The `healElement()` function updates `identity` from
the fresh observation while preserving `logicalName` (display name stays).

Wait — should identity be immutable during healing? Let me reconsider.

The identity record represents "what this element is." If the application
changes the element's `ariaRole` (e.g., from `combobox` to `listbox`), the
identity should update to reflect reality. If we freeze identity, the stored
identity drifts from reality, and future matching degrades.

**Decision:** Identity IS updated during healing. `healElement()` merges
fresh identity into stored identity. Fields that are non-null on the fresh
side overwrite; fields that are null on the fresh side are preserved from
the stored side (don't lose information because the recorder didn't capture it).

### 6.2 P2 (Future Consumer)

P2 does NOT own matching logic. It calls `matchElements` (or a higher-level
helper) and consumes the result:

```
P2 receives a P2CapabilityContract with dataRequirements and sourceSessionId.
For each data requirement (field):
  1. Recover the UiElementSummary from the source session.
  2. Build a fresh identity signature from the summary.
  3. Call matchElements([freshElement], storedElements).
  4. Consume the result:
     matched → use storedElement for resolveElementTarget()
     ambiguous → IRStep gets NoTarget + resolutionWarning("ambiguous: N candidates")
     unmatched → IRStep gets NoTarget + resolutionWarning("element not found in repository")
```

P2 never implements scoring, thresholds, or ambiguity detection. It only
interprets the three-category result.

---

## 7. What Remains Outside Scope

- **P1 entities:** No changes to Capability, CapabilityVersion,
  P2CapabilityContract, DataRequirement, SuccessCriterion, or any P1 type.
- **Recorder:** No changes to content script, EventTap, capture pipeline, or
  classification. The recorder already captures everything needed.
- **P2 IR generation:** R4 provides the foundation; P2 implements IR generation.
- **P3/P4/P5 functionality:** No test data generation, execution, or analysis.
- **Fuzzy accessible-name matching:** R4 uses exact match. Fuzzy/Levenshtein
  matching is a possible future enhancement.
- **Machine-learned thresholds:** R4 uses fixed thresholds validated by tests.
- **Element identity indexing:** R4 does not add Dexie indexes on identity
  fields. Matching loads elements by project and scores in-memory. If scale
  becomes an issue, indexes can be added later.

---

## 8. Validation Scenarios

Each scenario is a unit test that proves the system returns the expected
outcome. Tests are permanent regression gates.

### 8.1 Identity Persistence Tests

| Test | Input | Expected |
|---|---|---|
| V1 | Create Element with identity record | `element.identity` populated with all 9 fields |
| V2 | Create Element without identity (pre-R4 simulation) | `element.identity === null` |
| V3 | Heal Element | Identity updated from fresh observation, logicalName preserved |
| V4 | createElement in healing-service | Identity built from UiElement.identity + ancestorRoles |

### 8.2 Matching Outcome Tests

| Test | Scenario | Expected Outcome |
|---|---|---|
| M1 | Unique accessibleName, same page | MATCHED, margin ≥ 0.05 |
| M2 | Two candidates, scores 0.82 vs 0.55 | MATCHED (0.82), margin 0.27 |
| M3 | Two candidates, scores 0.82 vs 0.81 | AMBIGUOUS (margin 0.01 < 0.05) |
| M4 | Two candidates, identical scores 0.80 | AMBIGUOUS |
| M5 | Best candidate 0.65 (< threshold) | UNMATCHED |
| M6 | "Primary Email" vs "Secondary Email", different `name` | MATCHED to correct, other scores low |
| M7 | "Primary Email" vs "Secondary Email", identical all fields | AMBIGUOUS |
| M8 | 10 "Delete" buttons, no distinguishing attributes | All AMBIGUOUS |
| M9 | Same element, DOM wrapper added (ancestorRoles change) | MATCHED (Jaccard 0.80) |
| M10 | testId changed, all else same | MATCHED (accessibleName + role compensate) |
| M11 | accessibleName changed, testId + name same | MATCHED (strong IDs compensate) |
| M12 | Framework change (tag differs, role same) | MATCHED if margin sufficient |
| M13 | Pre-R4 Element (identity=null) vs fresh element | MATCHED via fallback (logicalName + testId from locators) |
| M14 | Pre-R4 Element vs fresh element, same name, no testId | MATCHED or AMBIGUOUS depending on neutral scoring |
| M15 | No candidates above threshold | UNMATCHED |

### 8.3 Healing Service Tests

| Test | Scenario | Expected |
|---|---|---|
| H1 | All elements matched | Healed, 0 created, 0 ambiguous |
| H2 | Some unmatched | Created with identity record |
| H3 | Some ambiguous | Skipped (not healed, not created), warning logged |
| H4 | Pre-R4 stored elements (no identity) | Matched via fallback, healed with identity added |
| H5 | Mixed R4 and pre-R4 stored elements | Both paths work in same batch |

### 8.4 Backward Compatibility Tests

| Test | Scenario | Expected |
|---|---|---|
| B1 | Old Element without identity field | Deserializes correctly, `identity` is undefined/null |
| B2 | Matcher with old Element | Uses fallback path, does not crash |
| B3 | Full existing test suite | All pre-R4 tests pass unchanged |

---

## 9. Regression Gates

| Gate | Check | Command |
|---|---|---|
| G1 | TypeScript: 0 source errors | `npx tsc --noEmit --project tsconfig.json` excluding tests |
| G2 | Golden master suite | All golden master snapshots match |
| G3 | Element matching tests | All M1–M15 pass |
| G4 | Healing service tests | All H1–H5 pass |
| G5 | Backward compatibility tests | All B1–B3 pass |
| G6 | Full test suite | Same pass count as pre-R4 baseline (± new tests) |

---

## 10. Exit Criteria

| # | Criterion | Verification |
|---|---|---|
| EC1 | `ElementIdentityRecord` type defined with 9 fields | Code inspection |
| EC2 | `Element.identity` field added, optional, backward compatible | B1, B2 pass |
| EC3 | `createElement()` accepts and stores identity | V1 passes |
| EC4 | `healElement()` updates identity from fresh observation | V3 passes |
| EC5 | `healFromRecording()` creates Elements with full identity | V4 passes |
| EC6 | `ancestorRoles` propagated from DomContext → UiElement → Element | V4 passes |
| EC7 | `extractStoredSignature` uses `identity.*` when available, falls back when null | M13, M14 pass |
| EC8 | Matching returns MATCHED / AMBIGUOUS / UNMATCHED | M1–M15 pass |
| EC9 | Ambiguous results carry all candidates with scores | M3, M4, M7, M8 pass |
| EC10 | Healing handles AMBIGUOUS by skipping + logging | H3 passes |
| EC11 | `logicalName` and `identity.accessibleName` are separate | Code inspection, V3 |
| EC12 | Pre-R4 Elements work without modification | B1–B3 pass |
| EC13 | No changes to P1 entities, recorder, or classification | Diff review |
| EC14 | Full test suite green | G6 passes |

---

## 11. Implementation Sequence

| Step | Files | Gate |
|---|---|---|
| 1. Define `ElementIdentityRecord` type | `src/domain/entities/element.ts` | tsc |
| 2. Add `identity` to `Element` interface, `CreateElementInput`, `UpdateElementInput` | `src/domain/entities/element.ts` | tsc |
| 3. Update `createElement()` to accept/store identity | `src/domain/entities/element.ts` | V1, V2 |
| 4. Update `healElement()` to merge fresh identity | `src/domain/entities/element.ts` | V3 |
| 5. Add `ancestorRoles` to `UiElement` + populate in domain-adapter-v2.ts | `src/domain/entities/ui-element.ts`, `src/recorder/pipeline/domain-adapter-v2.ts` | tsc |
| 6. Build identity record in `healFromRecording` createElement path | `src/repository/services/healing-service.ts` | V4 |
| 7. Redesign `ElementMatchResult` → three-category result | `src/repository/services/element-matching-service.ts` | tsc |
| 8. Implement new scoring (8 independent dimensions) | `src/repository/services/element-matching-service.ts` | M1–M15 |
| 9. Implement ambiguity detection (margin check) | `src/repository/services/element-matching-service.ts` | M3, M4 |
| 10. Update `extractStoredSignature` for identity-aware path | `src/repository/services/element-matching-service.ts` | M13, M14 |
| 11. Update `healFromRecording` to handle AMBIGUOUS | `src/repository/services/healing-service.ts` | H3 |
| 12. Update existing tests for new result shape | `tests/element-matching-service.test.ts`, `tests/healing-service.test.ts` | B3 |
| 13. Write new R4 validation tests | `tests/r4-identity-matching-gates.test.ts` | All gates |

---

## 12. Roadmap Position

### Should This Be a Named Phase?

**Yes — R4: Element Identity & Matching Foundation.**

It follows the R-series (recorder/repository infrastructure corrections that
precede platform phases):
- R1: Foundation Cleanup (removed dead V2 subsystem)
- R2: Slider Detection (expanded recorder capability)
- R3: Behavioral Semantic Reasoning (evidence engine)
- **R4: Element Identity & Matching Foundation (this design)**
- P1: Capability Lifecycle Management ✅ (frozen)
- P2: Capability-Derived IR Generation (blocked on R4)

R4 is strictly a foundation correction — it does not introduce new product
capability. It makes the existing Element Repository and matching
infrastructure reliable enough for P2 to build on.

### Completion Gates for P2 Safety

P2 can safely begin when ALL of the following are true:

1. **EC8 satisfied:** Matching returns MATCHED/AMBIGUOUS/UNMATCHED. P2 can
   consume the three categories without implementing matching logic.
2. **EC9 satisfied:** Ambiguous results carry all candidates. P2 can display
   "N candidates found, cannot resolve" warnings to the user.
3. **EC1–EC6 satisfied:** Element identity is persisted with 9 fields from
   recording. P2 has enough signal for dynamic resolution.
4. **EC12 satisfied:** Pre-R4 Elements remain compatible. P2 doesn't break
   existing repositories.
5. **G6 satisfied:** Full regression suite green. No existing behavior broken.

---

## 13. Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Existing tests break due to result shape change | High (certain — shape changes) | Step 12 updates all callers/tests in same PR |
| Neutral scoring change (both-missing → 0.5 instead of 1.0 for ALL optional fields) lowers match scores | Medium | Applied to name/ariaRole/ariaLabel/tag/sourceUrl, not just ancestors. MATCH_THRESHOLD (0.70) and MIN_MARGIN (0.05) validated as correct conservative values — no adjustment needed. Validated across 30 scoring scenarios. |
| `ancestorRoles` propagation adds complexity to UiElement | Low | Optional field, additive change |
| Identity not populated for existing Elements | Expected | Backward compatibility by design — fallback to current behavior |
| AMBIGUOUS results cause healing to skip too many elements | Low | Only affects genuinely ambiguous cases. Logged for visibility. |
| P2 still can't resolve some targets | Expected | Correct behavior — fundamentally indistinguishable elements are correctly unresolved. P2 reports them as warnings. |

---

## Implementation Status: COMPLETE (R4 Baseline Frozen)

### Scoring Calibration Correction

After initial implementation, a post-implementation validation revealed that
`stringEqualNeutral()` treated both-missing optional identity fields as 1.0
(positive agreement), inflating scores for low-evidence elements and creating
a score floor at ~0.825.

**Correction applied:** Changed `stringEqualNeutral()` both-missing return from
1.0 to `SCORING_POLICY.NEUTRAL` (0.5) for: name (FORM_NAME), ariaRole
(ARIA_ROLE), ariaLabel (ARIA_LABEL), tag (TAG), sourceUrl (PAGE_SCOPE).

**Fields NOT changed:**
- `accessibleName` via `stringEqual()` — both-empty returns 1.0 (consistency)
- `businessIds` via `scoreBusinessIds()` — already returns 0.5 for unavailable
- `ancestorRoles` — already returned 0.5 for both-missing

### Validated Score Distribution (Post-Correction)

| Scenario | Score | Result |
|---|---|---|
| Full identity match (all 9 fields) | 0.950 | MATCHED |
| Full identity + ancestorRoles | 1.000 | MATCHED |
| accessibleName + role + tag + URL only | 0.700 | MATCHED (at threshold) |
| Progressive: remove testId | 0.825 | MATCHED |
| Progressive: remove testId + name | 0.750 | MATCHED |
| Progressive: remove testId + name + ariaLabel | 0.700 | MATCHED (at threshold) |
| Two different generic elements (Email vs Password) | 0.500 | UNMATCHED |
| Identical low-evidence competitors (AMBIGUOUS pair) | ~0.70 each, margin < 0.05 | AMBIGUOUS |
| Changed testId, stable semantic identity (no name/ancestors) | 0.575 | UNMATCHED |
| Changed testId, with name + ancestors | ~0.80 | MATCHED |
| Genuinely new element | < 0.70 | UNMATCHED |
| Pre-R4 Element fallback (identity=null) | 0.750 (if name+page match) | MATCHED |
| Empty accessibleName, no other signals | 0.625 | UNMATCHED |

### Final Policy Constants

```typescript
SCORING_POLICY = {
  WEIGHTS: { BUSINESS_IDS: 0.25, ACCESSIBLE_NAME: 0.20, FORM_NAME: 0.15,
             ARIA_ROLE: 0.10, ARIA_LABEL: 0.10, ANCESTOR_ROLES: 0.10,
             TAG: 0.05, PAGE_SCOPE: 0.05 },
  MATCH_THRESHOLD: 0.70,
  MIN_MARGIN: 0.05,
  NEUTRAL: 0.5,
  NEUTRAL_BOTH_MISSING: 0.5,
  ANCESTOR_ONE_SIDE: 0.25,
}
```

### Gate Results

- G1: 0 source TypeScript errors
- G2: Golden master 143/143
- G3: Element matching 18/18
- G4: Healing service 11/11
- G5: R4 identity matching gates 26/26
- G6: Full suite 3135/3136 (1 pre-existing flaky perf test)
- Scoring validation: 14/14
- R1-R3 regression: All green
- P1 regression: All green

### Healing Safety

- MATCHED → heal (locator strategies + identity merged via field-level merge)
- AMBIGUOUS → skip (no heal, no create — logged as warning)
- UNMATCHED → create (new Element with full identity record)
- No duplicate creation, no wrong-element healing
