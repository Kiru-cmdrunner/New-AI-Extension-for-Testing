# Milestone B4.4 — CmdRunner Locator Priority Strategy

**Status:** FROZEN
**Date:** 2026-07-14
**Type:** Product Design (no implementation, no architecture, no code, no JSON schema)
**Depends on:**
- Product Foundation Design v1.0 (frozen)
- Product Architecture Design v1.0 (frozen)
- Milestone B1 — Post-Recording Artifact Generation Product Design (frozen)
- Milestone B2 — Post-Recording Artifact Generation Architecture (frozen)
- Milestone B3 — Artifact Generation Engine Foundation (frozen)
- Milestone B4.1 — CmdRunner Execution Model (frozen)
- Milestone B4.2 — Execution Object Design (frozen)
- Milestone B4.3 — CmdRunner Locator Resolution Strategy (frozen)

---

## 0. Purpose of This Document

B4.3 froze the **Locator Resolution Strategy** — the product philosophy behind how CmdRunner thinks about element identification. B4.3 established:

- The distinction between Identity (what an element *is*) and Locator (how to *find* it)
- Six permanent locator categories (Business Identifiers, Accessibility Information, Stable Technical Identifiers, Content-Based Identity, Structural Identifiers, Relative Relationships)
- The trust spectrum from high-trust to low-trust identity
- Eight product principles (LR-P1 through LR-P8)

But B4.3 deliberately did not answer: *"When multiple valid locator candidates exist for the same element, which specific ones does CmdRunner choose, and in what order?"*

This milestone answers that question. It defines the **product rules for choosing locators** — the formal priority hierarchy, the roles of primary/secondary/fallback locators, acceptance and rejection rules, conflict resolution, and consistency guarantees.

This is the product policy that the Execution JSON Generator must follow. Every code generator — Playwright, Cypress, future frameworks — reads locators that were selected according to this strategy.

This is still **product design**. No algorithms. No scoring formulas. No JSON schema. Only product decisions.

---

## Stage 1 — Purpose

### 1.1 What Is Locator Priority?

Locator Priority is the **product policy that determines which locator candidates become the primary locator, which become fallbacks, and which are rejected entirely** — given the set of identity attributes captured during recording.

Where Locator Resolution (B4.3) is the *capability* of evaluating element identity and producing locators, Locator Priority is the *policy* that governs what that evaluation produces. Resolution is the engine; Priority is the rulebook.

Concretely: when an element's identity contains a test ID, an ARIA label, a developer-authored ID, visible text, and a CSS selector, Locator Priority dictates which of these becomes the primary locator (the one code generators use by default), which become fallbacks (used if the primary fails), and which are discarded (too unreliable to include).

### 1.2 Why Is Locator Priority Different from Locator Resolution?

B4.3 Stage 0 established a critical distinction: **Identity** describes what an element is (raw, multi-valued); **Locator** describes how to find it (resolved, concrete).

Locator **Resolution** is the conceptual bridge — the capability that transforms identity into locators. It answers: *"How does CmdRunner go from raw identity to concrete locators?"*

Locator **Priority** is the decision policy within that capability. It answers: *"Given multiple concrete locator candidates, which ones does CmdRunner keep and in what order?"*

| Concept | Question | Scope |
|---|---|---|
| Locator Resolution (B4.3) | "How does CmdRunner think about element identification?" | Philosophy, categories, trust spectrum |
| Locator Priority (B4.4) | "Which specific locators does CmdRunner choose?" | Rules, hierarchy, acceptance/rejection |

Resolution defines the *approach*. Priority defines the *outcome*.

### 1.3 Why Can One Element Produce Multiple Valid Locator Candidates?

A single element typically carries multiple forms of identity simultaneously. A well-developed "Submit Order" button might have:

- `data-testid="submit-order"` (Business Identifier)
- `data-cy="checkout-submit"` (Business Identifier)
- `aria-label="Submit Order"` (Accessibility Information)
- `id="submit-btn"` (Stable Technical Identifier — if developer-authored)
- `name="submit"` (Stable Technical Identifier — form name)
- visible text "Submit Order" (Content-Based Identity)
- CSS class `btn btn-primary` (Structural Identifier)
- DOM position: 3rd button in the form (Structural Identifier)

All of these are valid locator candidates — each *could* find the element. But they differ dramatically in reliability. The test ID survives restyling and refactoring. The CSS class does not. The ARIA label survives DOM restructuring. The DOM position does not.

Multiple valid candidates exist because web elements carry rich identity by default — the DOM exposes many attributes, and modern development practices add more (ARIA for accessibility, test attributes for testing). This richness is a feature, not a problem. Locator Priority is how CmdRunner harnesses it: picking the best, keeping useful fallbacks, discarding the rest.

### 1.4 Why Must CmdRunner Always Make Deterministic Locator Decisions?

Determinism is not optional. It is foundational (B4.1 EP4, B4.2 EO-P3, B4.3 LR-P7).

**Reproducibility.** The same recording must always produce the same Execution Object with the same locators. If locator selection were non-deterministic, regeneration could produce different locators — making it impossible to verify that a regenerated test is equivalent to the original.

**Consistency across generators.** Playwright, Cypress, and Selenium must all use the same primary locator. If selection were non-deterministic, different generators might pick different locators from the same Execution Object — producing tests that behave differently.

**Explainability.** A QA engineer who asks "why did CmdRunner choose the ARIA label instead of the test ID?" must get a deterministic answer: "because the test ID was absent, and ARIA label is the next priority." Non-deterministic selection would make this question unanswerable.

**Trust.** A testing tool that makes different decisions on different days cannot be trusted. QA teams rely on CmdRunner's output being stable and predictable. Non-determinism undermines that trust.

Locator Priority is deterministic by design: **the same element identity always produces the same primary locator, the same fallbacks, and the same rejections.** Always. Without exception.

---

## Stage 2 — Locator Priority Hierarchy

### 2.1 The Priority Order

Based on the trust spectrum established in B4.3 (Stage 5) and the six locator categories (B4.3 Stage 4), CmdRunner's formal locator priority is:

```
PRIORITY 1 (Highest):  Business Identifiers
PRIORITY 2:             Accessibility Information
PRIORITY 3:             Stable Technical Identifiers
PRIORITY 4:             Content-Based Identity
PRIORITY 5 (Lowest):    Structural Identifiers
```

Relative Relationships (B4.3 §4.6) are a future capability and are not part of the v1.0 priority hierarchy.

### 2.1.1 The Hierarchy Operates on Available Valid Candidates

This hierarchy is the **default product policy**, not an unconditional rule that assumes every locator category is present on every element. The hierarchy is evaluated top-down: at each level, CmdRunner checks whether a valid candidate from that category exists and passes the acceptance rules (Stage 4). The first category with a valid candidate produces the primary locator.

Concretely:

- If a valid Business Identifier exists → it becomes the primary locator. Remaining categories are evaluated for secondary/fallback.
- If no valid Business Identifier exists → Accessibility Information is evaluated. If a valid candidate exists, it becomes the primary locator.
- If neither Business Identifiers nor Accessibility Information yield valid candidates → Stable Technical Identifiers are evaluated.
- This continues down through Content-Based Identity and finally Structural Identifiers.

An element with only visible text and a CSS selector will have:
- Primary: Content-Based Identity (visible text) — Priority 4
- Secondary: Structural Identifier (CSS selector) — Priority 5
- No Business Identifier, Accessibility, or Stable Technical locators — because none were captured.

The hierarchy defines **relative preference among available candidates**, not a requirement that all categories be present. A lower-priority category becomes the primary locator simply because no higher-priority candidate was available — not because the hierarchy was overridden.

### 2.2 Rationale for Each Priority Level

**Priority 1 — Business Identifiers (test IDs)**

Business identifiers are the highest-priority locator category because they are **intentional testing contracts**. When a developer writes `data-testid="submit-order"`, they are explicitly saying: "this attribute exists for automated testing, and I will maintain it." No other locator category carries this level of intentional commitment.

Business identifiers survive restyling, DOM restructuring, framework upgrades, and content changes because they serve a purpose independent of all of those concerns. They are the clearest signal of stable identity.

Within this category, multiple business identifier attributes may be present (`data-testid`, `data-cy`, `data-qa`, `data-test`). The specific sub-priority among them is defined in §5.1 (Conflict Resolution).

**Priority 2 — Accessibility Information (ARIA)**

Accessibility information is the second-highest priority because it is **maintained for compliance**. ARIA labels and roles exist to make applications usable for assistive technology users. They are maintained because accessibility is a legal and ethical requirement — not optional, not cosmetic.

Accessibility information is semantic (it describes what the element *is* for human use), not structural (it doesn't depend on DOM position). It survives restyling and refactoring. It is slightly lower priority than business identifiers only because business identifiers are *explicitly* testing contracts, while accessibility information is *incidentally* useful for testing.

**Priority 3 — Stable Technical Identifiers**

Stable technical identifiers — developer-authored IDs, form `name` attributes — are functional contracts. An `id="main-navigation"` exists because the developer needed a structural anchor. A `name="email"` exists because the backend expects that field name. These are stable because changing them breaks functionality.

They are lower priority than business identifiers and accessibility information because they serve a *functional* purpose (not a testing or accessibility purpose). They are more likely to change during a refactor that preserves functionality but restructures code — e.g., renaming `id="main-nav"` to `id="primary-nav"` during a component reorganization.

**Important distinction:** This category includes only **developer-authored, intentionally stable** identifiers. Auto-generated IDs (`react-7h3k2`, `vue-3a7b`) are NOT stable technical identifiers — they are framework byproducts. The acceptance rules (Stage 4) define how CmdRunner distinguishes between them.

**Priority 4 — Content-Based Identity**

Content-based identity — visible text, placeholder, alt text — is semantic and human-meaningful. "Submit Order" as button text is immediately recognizable and maps directly to user intent.

However, content is ranked lower than the above categories because:
- **Localization** changes text across locales ("Submit" → "Envoyer" in French).
- **A/B testing** serves different copy to different users.
- **Content updates** change text for product reasons (rewording a call-to-action).

Content is relatively stable within a single locale and deployment, but it is less stable than intentional contracts (test IDs) or compliance requirements (ARIA). It is a good fallback when no higher-priority identity exists.

**Priority 5 — Structural Identifiers (Last Resort)**

Structural identifiers — CSS selectors, XPath expressions, DOM position — are the lowest priority because they describe *where* an element is, not *what* it is. They break on DOM restructuring, content reordering, and component reorganization.

Structural identifiers are used **only when no higher-priority locator category is available**. They are always fallbacks, never primary locators (unless they are the only option). The acceptance rules (Stage 4) define minimum quality thresholds for structural locators.

### 2.3 Which Categories Should Never Become Primary Locators

No category is *categorically* banned from being a primary locator. However:

| Category | Can Be Primary? | Condition |
|---|---|---|
| Business Identifiers | ✅ Always (when present) | Highest priority |
| Accessibility Information | ✅ Yes (when no business identifier) | Second priority |
| Stable Technical Identifiers | ✅ Yes (when no business/accessibility) | Third priority |
| Content-Based Identity | ✅ Yes (when no higher category) | Fourth priority |
| Structural Identifiers | ⚠️ Only as absolute last resort | When no other category is available at all |

Structural identifiers can become primary locators **only when the element has no business identifier, no accessibility information, no stable technical identifier, and no content-based identity.** This is expected to be rare — most interactive elements have at least text content or a role.

### 2.4 Which Categories Should Be Used Only as a Last Resort

Structural Identifiers are last-resort locators. Within this category:

- **CSS selectors** are preferred over XPath (CSS is more widely supported and more readable).
- **Shallow selectors** (few nesting levels) are preferred over deep selectors (many nesting levels).
- **Specific selectors** (including element-specific attributes) are preferred over generic selectors (tag-only).

These sub-priorities within structural locators are implementation details that B4.5/B4 will formalize. The product principle is: **if you must use a structural locator, use the most specific, shallowest one available.**

---

## Stage 3 — Primary, Secondary, and Fallback Locators

### 3.1 The Three Locator Roles

An Execution Object's Locator Information (B4.2 §3.3) carries locators in three roles:

| Role | Purpose | Used By Code Generators |
|---|---|---|
| **Primary Locator** | The default, most-reliable way to find the element | Used as the primary selector in generated test code |
| **Secondary Locator** | An alternative reliable way to find the element | Used when the primary locator fails, or when a framework supports auto-fallback |
| **Fallback Locator** | Additional alternatives of decreasing reliability | Available for advanced retry logic or manual fallback chains |

### 3.2 What Makes a Primary Locator

A primary locator is the **single highest-priority available locator** for the element. It must satisfy:

1. **It exists** — the identity attribute it derives from was captured during recording.
2. **It is the highest-priority category present** — per the hierarchy in §2.1.
3. **It passes acceptance rules** — per Stage 4.
4. **It is deterministic** — the same identity always yields the same primary locator.

There is always exactly **one** primary locator per Execution Object (for element actions; navigation steps have no element locator per B2 §3.3).

### 3.3 What Makes a Secondary Locator

A secondary locator is the **next best available locator after the primary** — from a different category or a different attribute within the same category.

A secondary locator must:
1. Derive from a different identity attribute than the primary locator.
2. Pass acceptance rules.
3. Be from a priority category at or below the primary's category (it cannot be higher priority than the primary — if it were, it would be the primary).

Secondary locators provide **diversity of identification strategy**. If the primary locator is a test ID and the secondary is an ARIA label, a test that fails on the test ID (because a developer removed it) can still find the element via the ARIA label. This cross-category diversity is the key value of secondary locators.

### 3.4 What Makes a Fallback Locator

A fallback locator is any additional locator beyond primary and secondary — progressively lower in the priority hierarchy.

Fallback locators:
1. Include the remaining accepted locator candidates.
2. May include structural locators (CSS, XPath) even when higher categories are available — these are the "last chance" locators.
3. Are ordered by priority within the fallback set.

### 3.5 When Should Only One Locator Be Stored?

Only one locator is stored when **the element identity yields exactly one accepted locator candidate**. This happens when:

- The element has only one identity attribute (e.g., only visible text, nothing else).
- Other identity attributes exist but fail acceptance rules (e.g., an auto-generated ID is rejected).

In this case, the single locator is the primary locator. There is no secondary or fallback.

### 3.6 When Should Multiple Locators Be Stored?

Multiple locators are stored when **the element identity yields multiple accepted locator candidates from different categories or attributes**. This is the normal case for well-developed applications.

The product rule is: **store up to three locators — one primary, one secondary, and one fallback.** This provides:
- The primary for default execution.
- The secondary for cross-category resilience.
- The fallback for last-resort recovery.

**Rationale for the maximum of three:**

1. **Sufficient diversity for reliable execution.** Three locators — each typically from a different category (e.g., Business Identifier, Accessibility, Content-Based) — provide enough cross-category resilience to survive most routine application changes. If one locator strategy fails (e.g., test ID removed during a refactor), the others likely survive because they depend on different attributes.
2. **Avoids unnecessary storage and redundancy.** Most locator candidates from the same category are correlated — if `data-testid` changes, `data-cy` on the same element likely changes too. Storing 8 locators per step provides marginal resilience over 3 while multiplying storage size across every step in every test case.
3. **Keeps Execution Objects understandable and maintainable.** A QA engineer reviewing an Execution Object with three locators can quickly understand the identification strategy. An Execution Object with 8+ locators becomes noise — the reviewer cannot distinguish the primary signal from the background.
4. **Prevents accumulation of low-value locator information.** Without a cap, every structural locator variant (the CSS selector, the XPath, the short CSS, the long CSS, the tag-only selector) would be stored. These low-trust locators add clutter without meaningful resilience — they are all likely to break together during DOM restructuring.

If only two candidates pass acceptance, store two (primary + secondary). If only one passes, store one (primary only). The count is driven by available candidates, capped at three.

### 3.7 What Responsibility Does Each Locator Have During Execution?

| Role | Execution Responsibility |
|---|---|
| **Primary** | Code generators use this locator by default in generated test code. It is the selector that appears in `page.click(...)`, `cy.get(...)`, etc. |
| **Secondary** | Available for frameworks that support automatic locator fallback (e.g., Playwright's `locator.or()`). Can also be used by QA engineers manually improving the test. |
| **Fallback** | Available for advanced retry logic or manual debugging. Not typically used in generated code unless the code generator has an explicit fallback mechanism. |

Code generators are not required to use secondary or fallback locators in generated code. They are available as metadata. The primary locator is the only one that must appear in generated test code.

---

## Stage 4 — Locator Acceptance Rules

### 4.1 Purpose of Acceptance Rules

Not every identity attribute that was captured should become a locator. Some attributes are too unreliable, too ambiguous, or too unstable to include. Acceptance rules are the **product-level gate** that determines which candidates are kept and which are rejected.

### 4.2 Minimum Characteristics for Acceptance

Every accepted locator must satisfy ALL of the following:

**AC-1: Non-empty value.** The identity attribute must have a meaningful, non-empty value. Empty strings, whitespace-only strings, and `null` values are rejected.

**AC-2: Element-specific.** The locator must target the specific element, not a broad category of elements. A CSS selector that matches 50 elements on the page is not a useful locator. The locator must be specific enough to identify the intended element uniquely (or with high confidence in typical page layouts).

**AC-3: Syntactically valid.** The locator value must be expressible in its strategy's syntax. A CSS selector with unescaped special characters is invalid. A test ID with spaces is problematic. The locator must be representable.

**AC-4: Not a framework byproduct.** The identity attribute must not be a framework-generated artifact that changes between builds. This includes:
- Auto-generated IDs matching known framework patterns (React keys, Vue UIDs, Angular ng-ids)
- CSS-in-JS generated class names (hashed class names like `css-1a2b3c`)
- Framework-internal attributes (`data-reactid`, `__ngcontext__`, `data-v-xxxx`)

These are rejected because they fail the stability test (B4.3 §5.3).

### 4.3 Automatic Disqualification

A locator candidate is **automatically rejected** if any of the following are true:

**DQ-1: Auto-generated ID detected.** The `id` attribute matches a known auto-generation pattern. Known patterns include (non-exhaustive):
- React: `react-` prefix + alphanumeric hash
- Vue: `vue-` or app-specific prefix + hash
- Angular: `ng-` prefix or dynamic component IDs
- GWT: `gwt-uid-` prefix + number
- Generic: pure hash strings (e.g., `aria-owns=":r1:"`, `id="headlessui-menu-button-1"`)

The detection of these patterns is an implementation detail (B4/B4.5). The product rule is: **auto-generated IDs are always rejected as locator candidates.**

**DQ-2: CSS-in-JS class name detected.** A CSS class name that appears to be generated by a CSS-in-JS library (e.g., `css-1a2b3c`, `sc-abc123`, `emotion-cache-xyz`). These are generated at build time and change between builds.

**DQ-3: Ambiguous structural locator.** A structural locator (CSS/XPath) that is so generic it matches multiple elements on a typical page. For example, a bare tag selector (`button`, `div`) or a very shallow selector (`form > button` on a page with multiple forms).

**DQ-4: Placeholder-only on non-input elements.** A `placeholder` attribute is only meaningful on input/textarea elements. On other elements, it is ignored.

### 4.4 When Is a Locator Considered Too Unstable for Execution?

A locator is too unstable when its survival across routine application changes is unlikely. The stability assessment follows the trust spectrum (B4.3 §5.4):

| Stability Level | Examples | Accepted? |
|---|---|---|
| **High stability** | Test IDs, ARIA labels, accessible names | ✅ Always accepted (when non-empty) |
| **Medium stability** | Developer IDs, form names, visible text | ✅ Accepted (with awareness of localization sensitivity for text) |
| **Low stability** | CSS classes (if not CSS-in-JS), shallow structural selectors | ✅ Accepted as fallback only |
| **Unstable** | Auto-generated IDs, CSS-in-JS classes, framework attributes | ❌ Rejected |
| **Brittle** | Deep structural selectors, nth-child chains, absolute XPath | ⚠️ Accepted as last resort only — when no other locator is available |

The product principle: **CmdRunner would rather store one stable locator than three unstable ones.** Stability trumps quantity.

### 4.5 The Navigation Exception

Navigation interactions have no element identity (B2 §3.3, B4.1 §7.1 Assumption 5). Locator acceptance rules do not apply to navigation steps. Navigation Execution Objects represent URL transitions, not element interactions. They carry a target URL, not element locators.

---

## Stage 5 — Conflict Resolution

### 5.1 Ties Within the Same Category

When multiple locator candidates exist within the **same priority category**, CmdRunner resolves the tie deterministically:

**Within Business Identifiers (Priority 1):**

If multiple test attributes are present (e.g., `data-testid` AND `data-cy`), the sub-priority is:

```
data-testid → data-cy → data-qa → data-test → data-automation-id
```

`data-testid` wins because it is the most widely adopted test attribute convention across the web development ecosystem. The remaining attributes become secondary/fallback candidates.

**Within Accessibility Information (Priority 2):**

If multiple accessibility attributes are present, the sub-priority is:

```
aria-label → aria-labelledby → accessible name (computed)
```

`aria-label` wins because it is self-contained (the label text is in the attribute value). `aria-labelledby` requires resolving a reference to another element's text, which is an indirection. Computed accessible name is a synthesis of multiple sources and is less specific than a direct attribute.

**Within Stable Technical Identifiers (Priority 3):**

```
developer-authored id → form name attribute
```

Developer-authored `id` wins because it is a direct, element-level identifier. Form `name` is functional but shared across form submissions and may not be unique on the page.

**Within Content-Based Identity (Priority 4):**

```
visible text (innerText) → textContent → placeholder → alt → title
```

Visible text wins because it is what the user actually saw and interacted with. It is the most human-faithful representation of the element's identity.

**Within Structural Identifiers (Priority 5):**

```
specific CSS selector → general CSS selector → XPath
```

Specific CSS (including element-specific attributes) wins because it is the most targeted structural identifier. XPath is last because it is the most verbose and framework-specific.

### 5.2 Ties Across Categories

Ties across categories do not occur because the priority hierarchy (§2.1) is strictly ordered. A Priority 1 candidate always beats a Priority 2 candidate. There is no "equal priority across categories" scenario — the categories are ranked, not scored.

The hierarchy is: **1 > 2 > 3 > 4 > 5**. Always. No exceptions.

### 5.3 Can Multiple Locators Share Equal Importance?

**No.** All locators on an Execution Object are strictly ordered: primary > secondary > fallback. There is never a tie between two locators. The priority hierarchy and intra-category sub-priority (§5.1) produce a total ordering with no ambiguity.

If two candidates would theoretically tie (e.g., two test attributes of equal sub-priority — which does not occur in the current sub-priority lists), the first one in recording order wins. This is a deterministic tiebreaker that requires no judgment.

### 5.4 When Should CmdRunner Preserve Multiple Locators Rather Than Selecting Only One?

CmdRunner always preserves multiple locators when multiple candidates pass acceptance rules (per §3.6: up to three). This is not a "sometimes" decision — it is the default behavior.

The only case where a single locator is stored is when only one candidate passes acceptance. CmdRunner does not artificially limit to one locator when more are available — diversity of identification strategy improves resilience.

### 5.5 How Should CmdRunner Resolve Ties Between Equally Valid Cross-Category Candidates?

This situation does not arise because categories are strictly ranked (§5.2). But to address the spirit of the question: if a future product decision introduces a new category that sits between two existing priorities, the category's position in the hierarchy determines its resolution relative to all others. There is no floating comparison — the hierarchy is fixed and total.

---

## Stage 6 — Consistency

### 6.1 The Consistency Guarantee

**The same element identity always produces the same locator selection.** This is a hard guarantee, not a best-effort aspiration.

Given an element identity with:
- `data-testid="submit"` (Business Identifier)
- `aria-label="Submit Order"` (Accessibility Information)
- visible text "Submit Order" (Content-Based Identity)

CmdRunner will **always** produce:
- Primary: `data-testid="submit"`
- Secondary: `aria-label="Submit Order"`
- Fallback: visible text "Submit Order"

Never a different order. Never a different primary. Never a different set. The priority hierarchy and acceptance rules are deterministic functions — same input, same output, every time.

### 6.2 Regeneration Consistency

Regeneration (per B4.2 §4.5) creates new Execution Objects from the same Steps. If the Step's structural data is unchanged:

- Same element identity → same locator selection. ✅
- The regenerated Execution Object has identical primary, secondary, and fallback locators.
- Only generation metadata (timestamp) changes.

If the Step's structural data **did** change (e.g., the Step was re-derived from a different Timeline interaction):

- New element identity → potentially new locator selection.
- This is correct behavior — the element is different, so its locators may be different.

**Regeneration never changes locator selection unless the underlying element identity changes.** (Consistent with B4.2 EO-P4: Stable Identity.)

### 6.3 Cross-Generator Consistency

Different code generators (Playwright, Cypress, Selenium) consume the **same Execution Object**. They read the same primary locator and produce framework-specific syntax from it. They never re-resolve locators — the resolution is already done.

This means:
- Playwright generates `page.click('[data-testid="submit"]')`.
- Cypress generates `cy.get('[data-testid="submit"]')`.
- Selenium generates `driver.findElement(By.css('[data-testid="submit"]'))`.

All three use the same primary locator (`data-testid="submit"`), expressed in their own syntax. The locator selection is identical across all frameworks — because the selection happened once, in the Execution Object, before any framework was involved.

### 6.4 Why Consistency Matters

**Test reliability.** If locator selection were inconsistent, a test that passes today might fail tomorrow after regeneration — not because the application changed, but because CmdRunner picked a different locator. This undermines the entire purpose of automated testing.

**Review trust.** QA engineers review Canonical Test Steps and trust that the generated artifacts are stable. If regeneration changes locators unpredictably, the review process loses its value — the reviewed artifacts are ephemeral.

**Framework portability.** If Playwright and Cypress used different locators, a team switching frameworks would need to re-review every test. Consistent selection means switching frameworks is a syntax change, not a semantic change.

**Debugging.** When a test fails, the QA engineer needs to know which locator was used and why. Consistent selection makes this answerable: "the primary locator is test ID 'submit' because it's the highest-priority available business identifier." Always the same answer for the same element.

---

## Stage 7 — Product Principles

### LP-P1 — Selection Must Always Be Deterministic

Given the same element identity, CmdRunner always selects the same primary locator, the same secondary, and the same fallbacks. The priority hierarchy, acceptance rules, and conflict resolution are all deterministic functions. No randomness, no probabilistic selection, no environmental variation. (Reinforces B4.3 LR-P7.)

### LP-P2 — Prefer Stable Locator Information

When multiple locator candidates exist, CmdRunner prefers the most stable one as primary. Stability is assessed per the trust spectrum (B4.3 §5.4): business identifiers and accessibility information are more stable than content, which is more stable than structure. The primary locator should always be the most stable available candidate. (Reinforces B4.3 LR-P3.)

### LP-P3 — Prefer Meaningful Locator Information

Among candidates of similar stability, CmdRunner prefers locators that carry semantic meaning (ARIA label: "Submit Order") over locators that carry structural information (CSS selector: `div > button:nth-child(3)`). Meaningful locators are more readable, more debuggable, and more resilient to structural changes. (Reinforces B4.3 LR-P2.)

### LP-P4 — Prefer User-Facing Identity Over Implementation Details

CmdRunner prefers locators derived from attributes the user perceives or the development team intentionally maintains (test IDs, ARIA, visible text) over locators derived from implementation artifacts (generated IDs, CSS classes, DOM structure). User-facing identity is semantic; implementation details are accidental. (Reinforces B4.3 LR-P1.)

### LP-P5 — Avoid Brittle Locators

CmdRunner avoids locators that are likely to break across routine application changes: auto-generated IDs, CSS-in-JS classes, deep structural selectors. These are rejected outright (auto-generated) or used only as last-resort fallbacks (deep structural). A primary locator must never be brittle. (Reinforces B4.3 LR-P4.)

### LP-P6 — Store Only the Locator Information Required for Reliable Execution

CmdRunner stores up to three locators (primary, secondary, fallback). It does not store every identity attribute as a locator. Storing more increases complexity without improving reliability. Storing fewer (when more are available) wastes resilience. Three is the balance point — enough for cross-category diversity, not so many that the Execution Object becomes cluttered.

### LP-P7 — Multiple Locators Should Increase Reliability Rather Than Complexity

The secondary and fallback locators exist to provide resilience — if the primary fails, the secondary can find the element. They should come from *different categories* (e.g., primary = test ID, secondary = ARIA label) to maximize the diversity of identification strategy. Multiple locators from the same category (e.g., two test IDs) do not meaningfully increase resilience — if one test ID fails, the other likely fails too (same maintenance commitment).

### LP-P8 — The Strategy Should Remain Framework-Agnostic

The priority hierarchy, acceptance rules, and conflict resolution contain no framework-specific logic. No "Playwright prefers getByRole" or "Cypress prefers data-cy." The strategy produces abstract locators (strategy + value) that any framework can consume. (Reinforces B4.3 LR-P6.)

### LP-P9 — Future Improvements Should Extend the Strategy Without Redesigning It

New locator categories (e.g., Relative Relationships from B4.3 §4.6, visual locators) are inserted into the priority hierarchy at their appropriate trust level. Existing priorities don't change — the new category is added between existing ones. New acceptance rules (e.g., detecting a new framework's auto-generated ID pattern) extend the rejection list without restructuring it. (Reinforces B4.3 LR-P8.)

---

## Stage 8 — Assumptions and Open Questions

### 8.1 Assumptions (Inherited from Frozen Predecessors)

1. **Element identity is captured at click time and is immutable.** The locator candidates available are exactly what was recorded. No post-recording discovery. (B2 §3.2)

2. **The priority hierarchy is consistent with B2 §3.3.** B2 previewed: testId → dataCy → dataQa → id → ariaLabel → name → css → xpath. B4.4 formalizes this as: Business Identifiers (testId, dataCy, dataQa) → Accessibility (ariaLabel) → Stable Technical (id, name) → Content-Based → Structural (css, xpath). Same order, same decisions — B4.4 adds the product reasoning. No conflict.

3. **Navigation steps have no element locators.** (B2 §3.3, B4.3 §4.5 exception)

4. **A maximum of three locators per Execution Object.** Primary, secondary, fallback. (§3.6)

5. **Determinism is absolute.** Same identity → same selection. Always. (B4.1 EP4, B4.3 LR-P7)

6. **Auto-generated ID detection patterns will be refined during implementation.** B4.4 defines the product rule ("reject auto-generated IDs"). The specific regex patterns for detecting them are implementation details. (§4.3 DQ-1)

### 8.2 Open Questions (Deferred to Later Milestones)

1. **How are auto-generated IDs detected algorithmically?** The product rule is "reject them." The detection patterns (regex for React, Vue, Angular, etc.) are implementation details for B4/B4.5.

2. **How specific must a structural locator be to pass acceptance?** §4.3 DQ-3 says "ambiguous" selectors are rejected, but does not define the threshold (e.g., minimum specificity score, minimum uniqueness). This is an implementation detail for B4.5/B4.

3. **Should CmdRunner validate locators at generation time?** E.g., count how many elements a CSS selector matches. This is a runtime concern, not a product rule. Deferred to B4.5 (architecture).

4. **How are fallback locators expressed in generated code?** Playwright supports `locator.or()`. Cypress doesn't have native fallback. How code generators use (or ignore) secondary/fallback locators is a code generator concern, not a locator priority concern.

5. **What happens when the primary locator is the only accepted candidate AND it's structural?** §2.3 allows structural locators as primary when nothing else is available. Should the Execution Object carry a warning flag? Should the UI show a "low confidence" indicator? This is a UX concern, deferred to the UI milestone.

6. **Will the sub-priority within Business Identifiers be configurable?** A future capability where users configure their preferred test attribute (e.g., prefer `data-cy` over `data-testid`). This is additive to the sub-priority list and does not change the strategy.

---

## Stage 9 — Consistency with Frozen Predecessors

### 9.1 Alignment with B4.3 (Locator Resolution Strategy)

| B4.3 Decision | B4.4 Alignment |
|---|---|
| Six locator categories (§4) | ✅ B4.4 uses exactly these six categories in its priority hierarchy. No new categories introduced. |
| Trust spectrum (§5.4) | ✅ B4.4's priority hierarchy IS the trust spectrum formalized as an ordered list. High-trust categories are high priority; low-trust categories are low priority. |
| Identity ≠ Locator (§0) | ✅ B4.4 operates on locators (the output of resolution). Element identity is the input; B4.4 never conflates them. |
| Avoid brittle locators (LR-P4) | ✅ LP-P5 + acceptance rules (DQ-1 through DQ-4) reject brittle locators. |
| Deterministic (LR-P7) | ✅ LP-P1: selection is always deterministic. |
| Framework-agnostic (LR-P6) | ✅ LP-P8: strategy contains no framework-specific logic. |

### 9.2 Alignment with B2 (Architecture)

| B2 Decision | B4.4 Alignment |
|---|---|
| Priority: testId → dataCy → dataQa → id → ariaLabel → name → css → xpath (§3.3) | ✅ B4.4 formalizes this exact order into category-based priority: Business IDs (testId, dataCy, dataQa) → Accessibility (ariaLabel) → Stable Tech (id, name) → Content → Structural (css, xpath). Same order, same decisions. B4.4 adds product reasoning. |
| Navigation uses synthetic locator (§3.3) | ✅ §4.5: locator rules do not apply to navigation. |
| Locator Resolution Engine resolves locators (§3.3) | ✅ B4.4 defines the policy that the engine implements. |

### 9.3 Alignment with B4.2 (Execution Object Design)

| B4.2 Decision | B4.4 Alignment |
|---|---|
| Locator Information category holds primary + fallbacks (§3.3) | ✅ B4.4 defines three roles: primary, secondary, fallback — all within the Locator Information category. |
| Execution Objects are deterministic (EO-P3) | ✅ LP-P1: deterministic selection. |
| Extensible categories (EO-P5) | ✅ LP-P9: future categories extend the hierarchy without redesign. |

### 9.4 Alignment with B4.1 (Execution Model)

| B4.1 Decision | B4.4 Alignment |
|---|---|
| Deterministic (EP4) | ✅ LP-P1. |
| Framework-agnostic (EP3) | ✅ LP-P8. |
| Execution Objects represent intent (EP2) | ✅ LP-P4: prefer user-facing identity over implementation details. |

### 9.5 No Conflicts Found

This document formalizes what B4.3 philosophically established and what B2 architecturally previewed. The priority order is identical across all three documents — expressed at different levels of abstraction:

- **B2 (architecture):** testId → dataCy → dataQa → id → ariaLabel → name → css → xpath
- **B4.3 (philosophy):** trust spectrum from high-trust to low-trust
- **B4.4 (product policy):** Business IDs → Accessibility → Stable Tech → Content → Structural

No frozen decision is modified, contradicted, or overridden.

---

## Stage 10 — Non-Goals (Restated)

This milestone explicitly does **not** define:

- ❌ CSS selector generation algorithm (how to build the CSS string)
- ❌ XPath generation algorithm (how to build the XPath string)
- ❌ Locator scoring algorithm (numerical quality scores)
- ❌ Confidence formulas (mathematical confidence calculations)
- ❌ JSON schema (field names, types, serialization)
- ❌ Execution algorithms (how engines retry with fallback locators)
- ❌ Implementation classes (LocatorResolver, LocatorStrategy, etc.)
- ❌ Playwright-specific locator behavior (`getByRole`, `getByTestId`, etc.)

These belong to B4.5 (Architecture) and B4 (Implementation).

---

## Stage 11 — Freeze Declaration

Upon approval, the following is declared **frozen**:

### Frozen Product Policy

1. **The locator priority hierarchy is fixed:** Business Identifiers → Accessibility Information → Stable Technical Identifiers → Content-Based Identity → Structural Identifiers. This order is permanent for v1.0. (§2.1)

2. **An Execution Object carries at most three locators:** one primary, one secondary, one fallback. (§3.6)

3. **The primary locator is always the highest-priority accepted candidate.** There is exactly one primary locator per element-action Execution Object. (§3.2)

4. **Secondary and fallback locators provide cross-category resilience.** They should come from different categories than the primary when possible. (§3.3, LP-P7)

5. **Auto-generated IDs, CSS-in-JS classes, and framework-internal attributes are always rejected.** (DQ-1, DQ-2, AC-4)

6. **Ambiguous structural locators are rejected.** A locator that cannot uniquely identify the element is not a locator. (DQ-3)

7. **Intra-category sub-priority is fixed** for each category, producing a total ordering with no ties. (§5.1)

8. **The same element identity always produces the same locator selection.** Determinism is absolute. (LP-P1, §6.1)

9. **Navigation steps are exempt from locator rules.** They carry a target URL, not element locators. (§4.5)

10. **Future locator categories extend the hierarchy by insertion, not reordering.** Existing priorities are stable. (LP-P9)

### What This Freeze Means

- B4.5 (Architecture) must design the Locator Resolution Engine to implement this priority hierarchy and acceptance rules.
- B4 (Implementation) must implement the engine to produce deterministic locator selections matching this policy.
- The Execution JSON Specification must define how primary, secondary, and fallback locators are serialized — but the selection logic is frozen here.
- No future milestone may change the priority hierarchy, the three-locator maximum, the acceptance rules, or the determinism guarantee.
- No future milestone may make locator selection non-deterministic or framework-specific.

---

*This document defines the CmdRunner Locator Priority Strategy. All subsequent architecture and implementation milestones must conform to this strategy.*
