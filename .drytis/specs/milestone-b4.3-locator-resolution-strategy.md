# Milestone B4.3 — CmdRunner Locator Resolution Strategy

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

---

## 0. Purpose of This Document

B4.1 froze the Execution Model — the conceptual framework for what CmdRunner executes. B4.2 froze the Execution Object Design — six information categories including **Locator Information** as a permanent category. But B4.2 deliberately did not define *which* locator to choose, *why* one locator is better than another, or *how* CmdRunner thinks about element identification.

This milestone fills that gap. It defines the **product philosophy** behind locator resolution — *how CmdRunner should think about identifying web elements*, *what makes a locator reliable*, and *what information CmdRunner should trust versus distrust*.

This is still **product design**. No priority order. No scoring formulas. No algorithms. No JSON fields. Only the product philosophy.

---

## Stage 0 — Identity vs Locator: A Critical Distinction

Before discussing locator resolution strategy, we must establish a precise vocabulary. Throughout this document and all subsequent milestones, **Identity** and **Locator** are related but distinct concepts. Conflating them leads to architectural confusion.

### 0.1 The Conceptual Pipeline

```
Business Identity
       │
       │  captured during recording as...
       ▼
Element Identity (raw, multi-valued)
       │
       │  evaluated by...
       ▼
Locator Resolution (product capability)
       │
       │  produces...
       ▼
Resolved Locator(s) (concrete, ordered)
       │
       │  embedded in...
       ▼
Execution Object (Locator Information category)
```

### 0.2 Definitions

**Business Identity** — *What the user intended to interact with.*

This is the human-level concept of the element. When a QA engineer clicks a "Search" button, the business identity is "the Search button." It is meaning, not markup. Business identity is how a person would describe the element to another person: "the login form's email field," "the Add to Cart button on the product card."

Business identity is not stored as a discrete field. It is **derived** from element identity — the accessible name, role, text content, and context together communicate the business identity to a human reviewer. When plain English says *"Click 'Search' button,"* the business identity is embedded in that description.

**Element Identity** — *What was captured during recording.*

This is the raw, multi-valued snapshot of the DOM element at the moment of interaction. It includes everything the content script extracted: tag, ID, classes, ARIA attributes, test attributes, computed accessible name, text content, DOM position, iframe context, Shadow DOM flags. Element identity is **descriptive** — it describes what the element *is* (its attributes, its role, its content).

Element identity is carried on the Canonical Test Step (projected from the Timeline interaction). It is **unresolved** — it contains multiple candidate attributes, any of which *could* serve as a way to find the element. No decision has been made about which to trust.

**Locator** — *How CmdRunner can reliably find that element.*

A locator is a **specific, concrete strategy for finding an element in the DOM.** It is a directive: "use this attribute with this value to locate the element." A locator is **prescriptive** — it tells the execution engine exactly what to do (`find element by test ID "submit"`, `find element by CSS selector ".checkout > button"`).

A locator is always expressed as a **strategy + value pair**: the *strategy* says which method to use (test ID, ARIA label, CSS, XPath), the *value* is the concrete data for that strategy.

**Locator Resolution** — *The product capability that determines the most reliable locator(s).*

Locator resolution is the process that sits between element identity and resolved locators. It reads the raw, multi-valued element identity and produces a **decision**: which attribute(s) to use, in what order, based on the trust principles defined in this document.

### 0.3 The Key Relationship

| Concept | Answers | Nature | Stage |
|---|---|---|---|
| **Business Identity** | "What did the user mean to interact with?" | Human meaning | Understood during recording/review |
| **Element Identity** | "What information was captured about this element?" | Raw, descriptive, multi-valued | Captured during recording, carried on Steps |
| **Locator** | "How should the machine find this element?" | Resolved, prescriptive, concrete | Produced by locator resolution, embedded in Execution Objects |

### 0.4 Why the Distinction Matters

**Identity describes what the element is. Locator describes how to find it.**

These are different questions with different answers:

- An element's identity includes its `tag: "BUTTON"` and `accessibleName: "Submit Order"`. These describe *what the element is* — a button with a specific label.
- A locator derived from that identity might be `{ strategy: "testId", value: "submit" }`. This describes *how to find it* — look for the element with `data-testid="submit"`.

The same identity can produce multiple locators (`testId: "submit"`, `ariaLabel: "Submit Order"`, `css: "button.primary"`). The same locator type (e.g., CSS selector) can be derived from different identity attributes. The relationship is **many-to-many** — but resolution picks one primary locator from the available identity, so the Execution Object carries a **decided** answer, not the raw ambiguity.

**The practical consequence:** Future architecture and implementation must treat identity and locator as separate data structures. Element identity is the *input* to locator resolution. Resolved locators are the *output*. An Execution Object's Locator Information category (B4.2 §3.3) holds the *output* — resolved locators, not raw identity. The raw identity remains on the Canonical Test Step as the input record.

### 0.5 Analogy

Consider a person in a crowd:

- **Business identity:** "My friend Sarah" — who you're looking for (meaning).
- **Element identity:** { name: "Sarah", hair: "brown", height: "5'6\"", jacket: "red", position: "near the entrance" } — everything you know about her (raw attributes).
- **Locator resolution:** "Red jacket is the most visible and stable identifier in this crowd" — the decision about which attribute to rely on.
- **Locator:** "Find the person wearing a red jacket" — the concrete instruction (strategy + value).

The identity (all attributes) is rich and descriptive. The locator (one chosen attribute) is narrow and actionable. Locator resolution is the reasoning that picks the best attribute for the task.

---

## Stage 1 — Purpose

### 1.1 What Is Locator Resolution?

Locator resolution is the product capability by which CmdRunner **takes the raw element identity captured during recording and decides which identifying information to rely on for execution** — producing concrete, resolved locators.

As established in Stage 0, element identity and locators are distinct: identity is *what the element is* (descriptive, multi-valued), a locator is *how to find it* (prescriptive, concrete). Locator resolution is the bridge between them.

During recording, the content script captures everything available: the element's tag, ID, classes, ARIA attributes, test attributes, computed text, DOM position, and more. This raw element identity is a snapshot of what *existed* at the moment of recording.

But not all of this identity information produces equally reliable locators. An auto-generated ID like `react-abc123` existed at recording time but produces a locator that may fail on the next page load. A CSS class like `btn-primary` produces a locator that can break with a redesign. A test ID like `data-testid="submit"` produces a locator backed by a deliberate, stable contract that the development team maintains.

Locator resolution is the act of **evaluating element identity through a trust lens** — determining which identity attributes translate into trustworthy locators, and producing the resolved locator set that every code generator benefits from equally.

### 1.2 Why Does CmdRunner Require Locator Resolution?

CmdRunner requires locator resolution because **raw element identity contains too much information, and most of it is unreliable for execution.**

When a QA engineer clicks a "Submit" button, the content script captures:

- `id="react-mount-point__form__submit-btn-3"` (auto-generated)
- `class="btn btn-primary mt-4 hover:bg-blue-600"` (styling + layout)
- `data-testid="submit"` (test contract)
- `aria-label="Submit Order"` (accessibility)
- `data-cy="checkout-submit"` (E2E test attribute)
- tag: `BUTTON` (structural)
- DOM position: 3rd child of 2nd div under main (structural)
- text: "Submit Order" (content)
- and more...

Without resolution, a code generator must independently decide which of these to use. Different generators might make different choices, producing inconsistent tests. Worse, they might choose the auto-generated ID, which breaks on the next deploy.

Locator resolution makes this decision **once, centrally, based on product philosophy** — and embeds the resolved answer in the Execution Object (B4.2 §3.3). Every code generator then uses the same resolved locator, guaranteeing consistency.

### 1.3 Why Are Canonical Test Steps Not Sufficient for Execution?

Canonical Test Steps carry the element's **raw identity** — all the locator candidates captured at recording time. This is correct for the Step's purpose: a QA engineer reviewing a step needs to see the element's identity for understanding and traceability.

But for execution, raw identity is **unresolved ambiguity**. A Step says: "Here are eight ways to find this element." An Execution Object must say: "Here is the one way to find this element (plus fallbacks)."

The gap between "eight candidates" and "one decision" is precisely what locator resolution bridges. Without it, every code generator would need to implement its own resolution logic — duplicating decisions, risking inconsistency, and violating the single-point-of-resolution principle (B4.1 §1.2).

### 1.4 Why Should Locator Resolution Be Treated as a Product Capability Rather Than an Implementation Detail?

If locator resolution were an implementation detail, it would be hidden inside a code generator — a private function that maps element identity to a selector string. Its decisions would be opaque, unreviewable, and locked to one generator.

Treating locator resolution as a **product capability** means:

1. **The philosophy is frozen.** The principles that govern which locators CmdRunner prefers are product decisions, reviewed and approved. They don't change because a developer refactored a utility function.

2. **The decisions are explainable.** A QA engineer who asks "why did CmdRunner choose a CSS selector instead of the test ID?" gets an answer grounded in product philosophy, not "that's what the code does."

3. **The resolution is consistent across all consumers.** Because the philosophy is a product-level decision, it applies equally to Playwright, Cypress, Selenium, and any future generator. No generator picks its own locators.

4. **The strategy can evolve deliberately.** If the web ecosystem shifts (e.g., a new standard for element identity emerges), the locator strategy is updated as a product decision with review and freeze — not as a silent code change.

5. **The resolution is a selling point.** "CmdRunner picks the most reliable locator automatically" is a product feature that differentiates CmdRunner from tools that dump raw selectors and hope for the best.

---

## Stage 2 — Modern Web Applications

### 2.1 The Challenge Landscape

Modern web applications are the most hostile environment for element identification. CmdRunner's locator resolution strategy must be designed for this reality, not for idealized static HTML.

The following characteristics define the challenge:

### 2.2 Dynamic DOM Updates

Modern frameworks (React, Vue, Angular, Svelte) render the DOM dynamically. Elements are created, destroyed, and re-created in response to state changes. The element a user clicked at time T may be a completely different DOM node at time T+1, even though it renders identically.

**Implication for locator resolution:** CmdRunner cannot rely on element identity that is tied to a specific DOM node instance. Identity must be based on **attributes and semantics that survive re-rendering** — not on node identity or DOM position.

### 2.3 Single Page Application (SPA) Navigation

SPAs change the visible page without a full page reload. The URL changes (via History API), content is swapped, but the document persists. Elements from the "previous page" may remain in the DOM (hidden) while new elements are injected.

**Implication:** CmdRunner must not assume that a page load clears the DOM. Locators must be specific enough to target the correct element even when multiple similar elements exist across "virtual pages." A generic selector like `button.primary` might match elements from both the old and new virtual page.

### 2.4 Dynamic Content

Content is loaded asynchronously. An element may not exist in the DOM at the moment a test begins executing. Data-driven content means element counts, text, and even structure vary between sessions.

**Implication:** Locator resolution must produce locators that are **semantically meaningful** — they describe *what* to find, not *where* in the DOM it currently is. A locator like "the 3rd button in the 2nd form" is positional and breaks when content changes. A locator like `data-testid="add-to-cart"` is semantic and stable.

### 2.5 Shadow DOM

Web Components and many modern UI libraries (Material, Lightning) use Shadow DOM to encapsulate component internals. Elements inside a Shadow boundary are invisible to standard DOM queries (`document.querySelector`).

**Implication:** CmdRunner's locator resolution must account for Shadow DOM boundaries. Locators that work in a flat DOM (`#my-component button`) may fail when `button` is inside a Shadow root. The resolution strategy must produce locators that either pierce Shadow boundaries or navigate through them explicitly.

### 2.6 iFrames

Applications embed content in iframes — third-party widgets, legacy systems, embedded experiences. Elements inside an iframe are in a separate document context. Standard locators cannot reach across frame boundaries.

**Implication:** Locator resolution must capture and preserve iframe context. The Execution Object's Context Information category (B4.2 §3.4) exists precisely for this — but the locator strategy must treat iframe context as a first-class concern, not an afterthought.

### 2.7 Components That Are Re-Rendered

In reactive frameworks, user interaction triggers state updates that cause components to re-render. A dropdown that was open may close and re-render with different DOM structure. A list that was sorted may re-order its elements. A form that was submitted may reset its fields.

**Implication:** Locators must target **semantic identity** (what the element *is*) rather than **structural position** (where the element *is* in the DOM). A re-rendered component may have different DOM structure but the same semantic identity.

### 2.8 Elements Whose Attributes Change Over Time

Dynamic IDs, generated class names, ARIA states that change (aria-expanded, aria-selected), framework-generated attributes (`data-reactid`, `data-v-xxxx`, `__ngcontext__`) — these are attributes that exist at recording time but may change between sessions or even within a session.

**Implication:** CmdRunner must distinguish between attributes that are **intentional contracts** (data-testid, aria-label) and attributes that are **framework byproducts** (generated IDs, hashed classes). The former are stable; the latter are not.

---

## Stage 3 — Locator Philosophy

### 3.1 Core Principle: User Intent Over DOM Implementation

The single most important principle: **CmdRunner identifies the element the user intended to interact with, not the DOM node that happened to receive the event.**

When a user clicks "Submit," they are interacting with a concept — "the submit button." They don't care whether it's the 3rd child of the 2nd div, or whether its ID is `react-7h3k2`. They care about the **business meaning**: this is the button that submits the form.

CmdRunner's locator resolution must prioritize information that captures user intent:

- What does this element *do*? (accessible name, role, test ID)
- What does this element *mean* to the application? (business identifier, test attribute)

Over information that captures DOM implementation:

- Where is this element positioned? (DOM order, structural selectors)
- What styling does this element have? (CSS classes)
- What framework generated this element? (framework attributes)

### 3.2 Prefer Semantic Identity Over Structural Identity

**Semantic identity** is information that describes *what* an element is: its role, its label, its test contract. It is identity that a human would recognize.

**Structural identity** is information that describes *where* an element is: its position in the DOM tree, its parent-child relationships, its sibling order. It is identity that only a machine sees.

Semantic identity survives DOM restructuring. If a designer moves the Submit button from the bottom of the form to the top, its semantic identity (`aria-label="Submit"`, `data-testid="submit"`) is unchanged. Its structural identity (7th child of 3rd div) is completely different.

**The philosophy:** CmdRunner prefers semantic identity because it reflects user intent and survives the most common types of UI changes. Structural identity is a fallback — used only when no semantic identity is available.

### 3.3 Prefer Business Meaning Over Technical Implementation

**Business meaning** is identity that connects an element to the application's domain: "this is the 'Add to Cart' button," "this is the 'Email' field." Test IDs like `data-testid="add-to-cart"` or `data-cy="checkout-submit"` encode business meaning.

**Technical implementation** is identity that reflects how the element was built: CSS framework classes (`btn btn-primary`), utility classes (`mt-4 flex`), framework-generated identifiers (`react-7h3k2`). These reflect the build, not the business.

**The philosophy:** Business-meaningful identifiers are maintained by the development team as intentional contracts. They exist because someone decided "this element needs to be identifiable for testing." They are the most reliable long-term identity because they serve a purpose that transcends styling and framework choices.

### 3.4 Prefer Accessibility Information Where Appropriate

Accessibility information — `aria-label`, `aria-labelledby`, `role`, accessible name — is identity that serves a dual purpose: it makes the application usable for assistive technology users AND it provides stable, semantic identity for testing.

Accessibility information is particularly valuable because:

- It is **human-meaningful**: `aria-label="Submit Order"` describes the element's purpose in plain language.
- It is **maintained for a legal/ethical reason**: accessibility is a requirement, not optional. Teams maintain it.
- It is **standardized**: ARIA is a W3C specification. It doesn't change with framework versions.
- It is **visible to the user**: assistive technology users perceive this identity. If it changes, the application breaks for real users — making it a reliable contract.

**The philosophy:** When a development team has invested in accessibility (ARIA attributes, proper labeling), that investment is a strong signal of stable identity. CmdRunner respects and prefers it.

### 3.5 Prefer Stable Identifiers Over Temporary Identifiers

**Stable identifiers** are attributes that exist by design and are maintained as contracts: test IDs, data-test attributes, deliberate IDs assigned by the developer.

**Temporary identifiers** are attributes that exist as byproducts of rendering: auto-generated IDs (React keys, Angular ng-ids), dynamically generated CSS classes (CSS-in-JS, Tailwind), framework-internal attributes.

**The philosophy:** CmdRunner treats stable identifiers as first-class identity and temporary identifiers as unreliable. A stable identifier that was set by a developer who wrote `data-testid="login-submit"` is a contract — the developer committed to keeping it. A temporary identifier like `id="react-7h3k2"` is an accident of rendering that could change on the next build.

### 3.6 Prefer Deterministic Identification Over Heuristic Guessing

CmdRunner's locator resolution is **deterministic** (B4.1 EP4, B4.2 EO-P3). Given the same element identity, it always selects the same primary locator. There is no machine learning model, no confidence scoring, no probabilistic matching.

Deterministic resolution means:
- The same recording always produces the same Execution Object with the same locator.
- Regeneration is idempotent (same input → same output).
- Results are explainable: "CmdRunner chose data-testid because it is the highest-priority available stable identifier."
- Results are reproducible: another developer generating from the same Steps gets the same Execution Objects.

**The philosophy:** Heuristic guessing (ML-based locator selection, fuzzy element matching) introduces non-determinism. While it might occasionally pick a "better" locator, it makes the system unpredictable — a critical flaw in a testing tool. A testing tool that is itself unreliable cannot be trusted. Determinism is a feature, not a limitation.

### 3.7 User Intent Is More Important Than DOM Structure

This is the summation of all the above principles. When CmdRunner resolves a locator, it asks:

1. What element did the user interact with?
2. What is that element's **semantic identity** — its meaning to the user and the application?
3. What stable, trustworthy information captures that identity?

It does NOT ask:
1. Where was the element in the DOM?
2. What was the element's CSS class?
3. What was the element's framework-generated ID?

The element's position and styling are incidental to its identity. Its semantic meaning is its identity.

---

## Stage 4 — Locator Categories

This section identifies the **conceptual categories** of locator information. It does not define priority order — that belongs to the next milestone (B4.4).

### 4.1 Category: Business Identifiers

**What it represents:** Attributes explicitly set by the development team to identify elements for testing purposes. These are intentional contracts between the development team and testing tools.

**Examples (conceptual):**
- `data-testid`, `data-test`, `data-qa`, `data-cy`
- Custom data attributes (`data-automation-id`, `data-e2e`)

**Why it exists:** Business identifiers exist because developers recognize that CSS classes and auto-generated IDs are unreliable for testing. They add test-specific attributes as a deliberate, maintained contract. These attributes survive restyling, refactoring, and framework migrations because they serve a different purpose than presentation or behavior.

**When it is useful:** Business identifiers are useful whenever they are present. They are the clearest signal that "this element needs to be reliably findable for testing." When available, they are the strongest form of identity.

**Product value:** CmdRunner's relationship with business identifiers is symbiotic. CmdRunner prefers them; in turn, CmdRunner encourages development teams to add them. A team that sees CmdRunner consistently choose `data-testid` understands the value of maintaining test attributes.

### 4.2 Category: Accessibility Information

**What it represents:** Identity derived from accessibility infrastructure — ARIA attributes, labels, roles, and the computed accessible name. This is identity that assistive technology also relies on.

**Examples (conceptual):**
- `aria-label`, `aria-labelledby`
- `role` attribute
- Computed accessible name (derived from multiple sources per the WAI-ARIA spec)
- `<label for>` associations

**Why it exists:** Accessibility information exists to make web applications usable for people with disabilities. It is maintained because accessibility is a legal requirement (ADA, WCAG) and an ethical imperative. Because it is maintained for an independent reason (accessibility compliance), it is a stable, reliable identity source for testing.

**When it is useful:** Accessibility information is useful when the development team has invested in ARIA compliance. It is particularly valuable for elements that have no business identifier but do have accessibility labeling — common in applications that prioritize accessibility but haven't adopted test attributes.

**Product value:** By preferring accessibility information, CmdRunner aligns testing reliability with accessibility quality. Applications that are more accessible are also more testable through CmdRunner.

### 4.3 Category: Stable Technical Identifiers

**What it represents:** Identity derived from developer-authored attributes that are not test-specific or accessibility-specific but are nonetheless stable and intentional.

**Examples (conceptual):**
- `id` attributes that are developer-authored (not auto-generated)
- `name` attributes on form controls
- Stable class names that carry business meaning (not utility classes)

**Why it exists:** Developer-authored IDs and form names are part of the application's functional architecture. A form field with `name="email"` has that name because the backend expects it — it's a functional contract. A developer-authored `id="main-navigation"` is a structural anchor the developer chose to maintain.

**When it is useful:** Stable technical identifiers are useful when business identifiers and accessibility information are absent but the developer has authored identifiers that serve a functional purpose. This is common in traditional server-rendered applications and form-heavy pages.

**Caveat:** The key word is "stable" — an `id` like `react-mount-point__form__submit` is technically an `id` but is auto-generated. The product philosophy distinguishes between intentional and generated identifiers within this category. Resolution must treat them differently. (See Stage 5 for the stability analysis.)

### 4.4 Category: Structural Identifiers

**What it represents:** Identity derived from the element's position in the DOM tree: parent-child relationships, sibling order, tag nesting.

**Examples (conceptual):**
- CSS selectors based on DOM structure: `form > div:nth-child(2) > button`
- XPath expressions: `//form/div[2]/button`
- Tag-based selectors: `button`

**Why it exists:** Structural identity is always available — every element has a position in the DOM. When no semantic identity exists, structural identity is the only remaining option.

**When it is useful:** Structural identity is useful as a **last resort**, when no business, accessibility, or stable technical identifier is available. It is also useful as a **fallback** — a secondary locator that can find the element if the primary locator fails.

**Product value:** Structural identity is acknowledged but de-prioritized. CmdRunner uses it when nothing better is available, but never relies on it as a primary locator when semantic identity exists.

### 4.5 Category: Content-Based Identity

**What it represents:** Identity derived from the element's own content: visible text, placeholder text, alt text, title attribute.

**Examples (conceptual):**
- Visible text content: `text="Submit Order"`
- Placeholder text on inputs: `placeholder="Enter your email"`
- Alt text on images: `alt="Company logo"`
- Title attributes: `title="More information"`

**Why it exists:** Content is often the most human-recognizable form of identity. When a user thinks "click the Submit button," they are thinking of the element's text content. Content-based identity maps directly to user intent.

**When it is useful:** Content-based identity is useful for elements whose text content is meaningful and relatively stable — buttons with action labels, links with descriptive text, images with alt text. It is less useful for elements with dynamic content (data-driven text, localized strings).

**Caveat:** Content can change due to localization (the "Submit" button becomes "Envoyer" in French), A/B testing (different copy variants), or content updates. Content-based identity is valuable but should be treated with awareness of its internationalization sensitivity.

### 4.6 Category: Relative Relationships (Future Consideration)

**What it represents:** Identity derived from the relationship between the target element and a nearby, more easily identifiable element: "the button next to the 'Total' label," "the input below the 'Email' heading."

**Why it exists:** Sometimes the target element itself has no strong identity, but a nearby element does. Relative relationships allow CmdRunner to locate elements that would otherwise be unidentifiable using only their own attributes.

**When it is useful:** Relative relationships are useful when the target element has no business identifier, no accessibility information, and no stable technical identifier — but a nearby landmark element does.

**Current status:** Relative relationships are a **future consideration**, not a v1.0 capability. This category is documented to demonstrate extensibility (B4.2 EO-P5, EO-P6) — the locator information category in the Execution Object can accommodate relative locators without redesign.

---

## Stage 5 — Stable vs Unstable Identity

### 5.1 Why Stability Matters

A locator is only as good as its ability to **find the same element across executions**. If a locator works on Monday but fails on Tuesday, it is not a reliable locator.

Reliable web application testing requires locators that survive:

- Code deployments (application updates)
- DOM restructuring (refactoring)
- Styling changes (redesigns)
- Framework upgrades (React 17 → 18, Angular → Vue)
- Content updates (copy changes, localization)
- Browser updates (Chrome version changes)

Stability is the measure of how well a locator survives these changes. The more changes a locator can survive, the more stable it is. CmdRunner's locator resolution strategy **prioritizes stability above all other factors** (after user intent).

### 5.2 Relatively Stable Identity

These forms of identity are **trustworthy** because they are maintained by the development team as intentional contracts or by standards bodies as specifications:

| Identity Type | Why It's Stable | Survival Horizon |
|---|---|---|
| **Test IDs** (`data-testid`, `data-cy`, `data-qa`) | Explicitly maintained as testing contracts. Developers don't change them without considering test impact. | Survives restyling, refactoring, framework migrations. Long-term. |
| **Accessible names** (computed from ARIA + content) | Maintained for accessibility compliance. Changing them breaks assistive technology. | Survives restyling, refactoring. Medium to long-term. |
| **ARIA labels** (`aria-label`, `aria-labelledby`) | Same as accessible names — accessibility compliance. | Survives restyling, refactoring. Medium to long-term. |
| **Labels** (`<label for>`) | Part of the form's functional contract. Backend expects specific field names. | Survives restyling. Medium-term. |
| **Form names** (`name` attribute on inputs) | Backend contract. Changing the name breaks form submission. | Survives restyling, refactoring. Long-term. |
| **Business-meaningful text content** ("Submit", "Add to Cart") | Maintained by product/copy team. Relatively stable unless localized or A/B tested. | Survives restyling, refactoring. Medium-term. |
| **Developer-authored IDs** (`id="main-nav"`, not auto-generated) | Intentional structural anchors. Developers maintain them. | Survives restyling. Medium-term. |

### 5.3 Potentially Unstable Identity

These forms of identity are **unreliable** because they are generated by frameworks, derived from styling decisions, or dependent on DOM structure that changes frequently:

| Identity Type | Why It's Unstable | Failure Mode |
|---|---|---|
| **Auto-generated IDs** (`react-7h3k2`, `#__vue__3`) | Generated by the framework at runtime. Different on every page load or build. | Fails on next deploy. |
| **Dynamic CSS classes** (`css-1a2b3c`, `idx-4`, Tailwind utilities) | Generated by CSS-in-JS or utility frameworks. Change when styles change. | Fails on style update. |
| **DOM position** (3rd child of 2nd div) | Changes when elements are added, removed, or reordered. | Fails on content change. |
| **Framework-generated attributes** (`data-reactid`, `__ngcontext__`, `data-v-xxxx`) | Internal framework bookkeeping. Not public API. Removed or changed between versions. | Fails on framework upgrade. |
| **Computed styles** (computed color, font-size) | Change with any styling update. | Fails on redesign. |
| **Sibling count / index** (nth-child) | Changes when siblings are added or removed. | Fails on content change. |
| **Localized text** (if the app is multilingual) | Changes based on user locale. | Fails in different locale. |

### 5.4 The Trust Spectrum

Identity is not binary (stable vs unstable). It exists on a spectrum:

```
HIGH TRUST                                                        LOW TRUST
    │                                                                  │
    ▼                                                                  ▼
Test IDs → ARIA labels → Accessible names → Form names → Dev IDs → Content text → Stable CSS → Structural → Generated IDs
    │           │              │               │            │           │              │           │            │
  contract    compliance      compliance     functional   intentional  semantic     design     positional   accidental
```

CmdRunner's resolution strategy follows this trust spectrum: **prefer high-trust identity, use low-trust identity only as fallback.** The exact priority order will be defined in B4.4; this document establishes only the philosophical direction.

### 5.5 The Distinguishing Question

The simplest test for whether a piece of identity is stable or unstable:

> **"Would a developer need to update this attribute for a non-testing reason?"**

- `data-testid="submit"` — **No.** A developer only changes a test ID if they are removing or renaming the test contract. They don't change it for styling, layout, or framework reasons. → **Stable.**
- `aria-label="Submit Order"` — **No.** A developer only changes an ARIA label for accessibility or copy reasons. → **Stable.**
- `class="btn btn-primary"` — **Yes.** A developer changes CSS classes during redesigns, style updates, framework migrations. → **Unstable.**
- `id="react-7h3k2"` — **Yes.** A developer doesn't control this — the framework generates it. It changes every build. → **Unstable.**

This question — "would a developer change this for non-testing reasons?" — is the philosophical anchor of CmdRunner's stability assessment.

---

## Stage 6 — Robustness

### 6.1 Why Multiple Ways to Identify the Same Target

A single locator is a single point of failure. If that locator breaks — the test ID is removed, the ARIA label is changed, the content is updated — the test fails. There is no recovery.

CmdRunner's locator resolution strategy dictates that **an Execution Object carries not just a primary locator but also fallback locators.** The primary locator is the highest-trust available identifier. Fallback locators are the next-best identifiers, in trust order.

This multi-locator approach means:
- If the primary locator fails at runtime, the execution engine can try the fallback.
- Different frameworks can use different locators based on their capabilities (e.g., Playwright supports text locators natively; some frameworks don't).
- A QA engineer reviewing the Execution Object can see all the ways the element can be found, not just one.

### 6.2 Robustness Against Minor UI Changes

Minor UI changes — adjusting padding, changing a color, reordering toolbar items — should not break CmdRunner's locators. By preferring semantic identity over structural identity, CmdRunner is naturally robust against these changes:

- A restyle changes CSS classes → primary locator (test ID) unaffected.
- A layout reflow changes DOM position → primary locator (ARIA label) unaffected.
- A minor copy edit changes button text → primary locator (test ID) unaffected.

**The philosophy:** Semantic locators decouple test reliability from visual presentation. A test should not break because someone changed a margin.

### 6.3 Robustness Against DOM Restructuring

More significant changes — restructuring a form, moving a section, refactoring a component — change the DOM tree. Structural locators (`form > div:nth-child(2) > button`) break because the structure changed. But semantic locators (`data-testid="submit"`) survive because the element's identity didn't change — only its location in the tree did.

**The philosophy:** By preferring locators that are independent of DOM structure, CmdRunner's tests survive the most common type of front-end change: restructuring.

### 6.4 Robustness Against Styling Changes

Redesigns, CSS framework migrations (Bootstrap → Tailwind), and theme changes alter CSS classes completely. A locator based on `.btn-primary` breaks when the class becomes `.button--primary`. A locator based on `data-testid` is unaffected.

**The philosophy:** CmdRunner's locators should be as independent of styling as possible. Styling is the most frequently changed aspect of a web application. Locators that depend on styling are locators that break frequently.

### 6.5 Robustness Against Framework Upgrades

Framework upgrades (React 17 → 18, Angular.js → Angular, jQuery → Vue) often change internal DOM structure, remove deprecated attributes, and alter rendering behavior. Semantic locators (test IDs, ARIA, content) survive framework upgrades because they are framework-independent. Structural locators and framework-generated attributes do not.

**The philosophy:** CmdRunner's locators should be as independent of the rendering framework as possible. A test recorded today should still work after the team migrates from React to Vue (assuming the test IDs and ARIA labels are preserved).

### 6.6 Robustness Through Additional Attributes

As web standards evolve, new forms of stable identity may emerge. CmdRunner's locator resolution strategy accommodates new identifier types without redesign:

- A future W3C standard for element identity → new category or new type within Business Identifiers.
- A new testing framework convention (`data-e2e-id`) → new type within Business Identifiers.
- Visual AI-based identification → new type within Locator Information (B4.2 §3.3).

**The philosophy:** The locator strategy is extensible. New identifier types are additive. The trust spectrum and category framework accommodate them naturally.

---

## Stage 7 — Product Principles

### LR-P1 — Identify User Intent Rather Than DOM Implementation

CmdRunner locates the element the user intended to interact with, based on its semantic meaning — not the DOM node that happened to receive the event. A locator should answer "what element is this?" not "where is this element in the DOM?"

### LR-P2 — Prefer Semantic Identity Over Structural Identity

Semantic identity (test IDs, ARIA, accessible name, content) is preferred over structural identity (DOM position, nth-child, XPath structure). Semantic identity reflects user intent and survives DOM restructuring. Structural identity reflects implementation and breaks on restructuring.

### LR-P3 — Prefer Stable Information Over Generated Information

Stable information (maintained contracts: test IDs, ARIA, developer IDs) is preferred over generated information (framework byproducts: auto-IDs, generated classes). Stable information survives changes. Generated information does not.

### LR-P4 — Avoid Brittle Locators

CmdRunner actively avoids locators that are likely to break: auto-generated IDs, dynamic CSS classes, deep structural selectors, framework-internal attributes. These locators are unreliable and would produce tests that fail on routine application changes. When no better option exists, they are used as last-resort fallbacks — never as primary locators.

### LR-P5 — Support Reliable Execution of Modern Web Applications

The locator strategy is designed for the reality of modern web applications: dynamic DOMs, SPAs, Shadow DOM, iframes, reactive re-rendering, and generated attributes. It does not assume static HTML or stable DOM structure. Every design decision is made with modern application characteristics in mind.

### LR-P6 — Remain Framework-Agnostic

The locator strategy produces locators in abstract terms (strategy + value), not in framework-specific syntax. `page.click()` vs `cy.get()` is the code generator's concern. The locator strategy is concerned only with *what* to locate and *how to describe* it, never *which automation tool* will do the locating.

### LR-P7 — Remain Deterministic

Given the same element identity, the locator strategy always produces the same resolved locator(s). No randomness, no probabilistic matching, no machine learning. Determinism guarantees reproducibility and explainability — essential qualities in a testing tool.

### LR-P8 — Allow Future Enhancements Without Requiring Redesign

The locator categories, trust spectrum, and multi-locator model accommodate future capabilities (visual locators, relative locators, new identifier standards) as additive extensions. No existing category needs to change. No existing principle needs to be relaxed. The strategy is designed to grow.

---

## Stage 8 — Assumptions and Open Questions

### 8.1 Assumptions (Inherited from Frozen Predecessors)

1. **Element identity is captured at click time and is immutable.** The locator candidates available at resolution time are exactly what was captured during recording. No new candidates are discovered after recording. (B2 §3.2, Milestone 2 Architecture)

2. **The Locator Resolution Engine is deterministic.** Given the same identity, it always picks the same primary locator. (B2 §3.3, B4.1 EP4)

3. **B2 §3.3 established a priority order.** testId → dataCy → dataQa → id → ariaLabel → name → css → xpath. This priority order was described at the architecture level in B2. This document (B4.3) establishes the **product philosophy** that justifies that order. B4.4 will define the **formal locator priority strategy** that formalizes it. No conflict: B4.3 is the "why," B4.4 will be the "what," and B2 was the preview.

4. **Navigation interactions have no element identity.** Navigation Execution Objects represent URL transitions, not element actions. Locator resolution does not apply to navigation steps. (B2 §3.3, B4.1 §7.1 Assumption 5)

5. **Shadow DOM and iframe context are captured during recording.** The content script extracts Shadow DOM flags and iframe context at click time. This information is available for locator resolution. (Milestone 2 Architecture, B2 §3.2)

6. **Execution Objects carry both primary and fallback locators.** B4.2 §3.3 established that the Locator Information category includes primary locator + fallbacks. This document establishes *why* multiple locators are needed.

### 8.2 Open Questions (Deferred to Later Milestones)

1. **What is the formal priority order?** This document establishes the trust spectrum (Stage 5) and the philosophical direction (prefer stable, semantic identity). B4.4 will define the formal priority order as a frozen product decision.

2. **How are fallback locators ordered?** This document establishes that fallbacks exist. B4.4/B4.5 will define how many fallbacks to retain and their ordering.

3. **How are auto-generated IDs detected?** This document establishes that auto-generated IDs are unreliable. The algorithm for detecting them (pattern matching on React/Vue/Angular generated ID formats) is an implementation concern for B4 implementation.

4. **How is CSS selector specificity determined?** This document establishes that structural CSS selectors are brittle. The algorithm for generating and evaluating CSS selector quality is an implementation concern.

5. **How does locator resolution handle Shadow DOM in generated selectors?** This document establishes that Shadow DOM context must be preserved. How code generators translate that context into Shadow-piercing selectors is a code generator concern, not a locator strategy concern.

6. **How does locator resolution handle elements with no semantic identity?** This document establishes that structural locators are a last resort. The exact behavior when an element has only structural identity (generate a brittle locator? warn the user? mark the step as low-confidence?) is deferred to B4.4.

7. **Will CmdRunner support custom test attribute configuration?** A future capability where users configure which attributes CmdRunner treats as test IDs (e.g., `data-e2e`, `data-automation`). This is additive to the Business Identifiers category and does not require redesign.

---

## Stage 9 — Consistency with Frozen Predecessors

### 9.1 Alignment with B4.2 (Execution Object Design)

| B4.2 Decision | B4.3 Alignment |
|---|---|
| Locator Information is a permanent information category (§3.3) | ✅ This document defines the philosophy behind what goes into that category. |
| Execution Object carries primary locator + fallbacks (§3.3) | ✅ §6.1 explains why multiple locators are needed. |
| Locator resolution is centralized in the Execution JSON Generator (§3.3) | ✅ §1.4 establishes locator resolution as a product capability, not a generator detail. |
| Future locator strategies are additive (EO-P5) | ✅ §6.6 + §4.6 (relative relationships as future). New strategies are additive. |
| Framework-agnostic locators (EO-P2) | ✅ LR-P6. Locators are abstract (strategy + value). |

### 9.2 Alignment with B2 (Architecture)

| B2 Decision | B4.3 Alignment |
|---|---|
| Locator Resolution Engine resolves locators (§3.3) | ✅ This document defines the product philosophy that the engine implements. |
| Priority: testId → dataCy → dataQa → id → ariaLabel → name → css → xpath (§3.3) | ✅ This document establishes the trust spectrum (Stage 5) that justifies this ordering. Test IDs (business identifiers) are highest trust; CSS and XPath (structural) are lowest trust. No conflict — B4.3 is the philosophical foundation for B2's architecture-level ordering. |
| Navigation uses synthetic locator (§3.3) | ✅ §8.1 Assumption 4: locator resolution does not apply to navigation. |
| Generators are pure functions (AP1) | ✅ LR-P7: deterministic resolution. Same identity → same locator. |

### 9.3 Alignment with B4.1 (Execution Model)

| B4.1 Decision | B4.3 Alignment |
|---|---| 
| Deterministic (EP4) | ✅ LR-P7: deterministic locator resolution. |
| Framework-agnostic (EP3) | ✅ LR-P6: framework-agnostic locators. |
| Execution Objects represent intent, not events (EP2) | ✅ LR-P1: identify user intent, not DOM implementation. |

### 9.4 Alignment with B1 (Artifact Generation)

| B1 Decision | B4.3 Alignment |
|^^---|^^---|
| Execution JSON is always derived from Steps (Decision 7) | ✅ Locator resolution is part of derivation — it reads Step identity and produces resolved locators. |
| Workflow is framework-agnostic at Steps and JSON level (Decision 12) | ✅ LR-P6: locators are framework-agnostic. |

### 9.5 No Conflicts Found

This document introduces the **Locator Resolution Strategy** as the product philosophy behind locator selection. It is fully consistent with all frozen predecessors:

- B2's priority order (testId → ... → xpath) is the architecture-level preview. B4.3 is the product-level **why**. B4.4 will be the product-level **what** (formal priority). No conflict — these are different levels of abstraction over the same decision.
- B4.2's Locator Information category is the container. B4.3 defines the philosophy for what goes into it. No conflict — container and content.
- No frozen decision is modified, contradicted, or overridden.

---

## Stage 10 — Non-Goals (Restated)

This milestone explicitly does **not** define:

- ❌ Locator priority order (which locator wins in which scenario)
- ❌ Confidence scoring (numerical reliability scores)
- ❌ JSON schema (field names, types, serialization)
- ❌ CSS selector generation algorithm
- ❌ XPath generation algorithm
- ❌ Playwright-specific selectors (`page.locator()`, `page.getByRole()`)
- ❌ Execution algorithms (how engines consume locators)
- ❌ Implementation classes (LocatorResolver, LocatorStrategy, etc.)

These belong to B4.4 (Locator Priority Strategy), B4.5 (Architecture), and B4 (Implementation).

---

## Stage 11 — Freeze Declaration

Upon approval, the following is declared **frozen**:

### Frozen Philosophy

0. **Identity and Locator are distinct concepts.** Identity describes *what the element is* (raw, descriptive, multi-valued, captured during recording). Locator describes *how to find it* (resolved, prescriptive, concrete, produced by locator resolution). The relationship is: Business Identity → Element Identity → Locator Resolution → Resolved Locator(s) → Execution Object. Future architecture and implementation must treat identity and locator as separate data structures. (§0)

1. **CmdRunner identifies user intent, not DOM implementation.** Locators target semantic meaning, not structural position. (LR-P1)

2. **Semantic identity is preferred over structural identity.** Test IDs, ARIA, accessible names, and content are preferred over DOM position and CSS selectors. (LR-P2)

3. **Stable information is preferred over generated information.** Maintained contracts are preferred over framework byproducts. (LR-P3)

4. **Brittle locators are avoided.** Auto-generated IDs, dynamic classes, and deep structural selectors are last-resort fallbacks only. (LR-P4)

5. **The locator strategy is designed for modern web applications.** Dynamic DOMs, SPAs, Shadow DOM, iframes, and reactive re-rendering are first-class concerns. (LR-P5)

6. **The locator strategy is framework-agnostic.** Locators are abstract (strategy + value). No framework-specific syntax. (LR-P6)

7. **The locator strategy is deterministic.** Same identity → same resolved locator(s). Always. (LR-P7)

8. **The locator strategy is extensible.** New identifier types fit as additive categories. No redesign required. (LR-P8)

9. **Six locator categories are permanent:** Business Identifiers, Accessibility Information, Stable Technical Identifiers, Content-Based Identity, Structural Identifiers, and Relative Relationships (future). These categories are the conceptual framework for all locator decisions. (§4)

10. **The trust spectrum is the philosophical anchor.** Identity ranges from high-trust (test IDs, ARIA) to low-trust (generated IDs, DOM position). CmdRunner resolves locators from the high-trust end. (§5.4)

### What This Freeze Means

- B4.4 (Locator Priority Strategy) must define a formal priority order consistent with this philosophy.
- B4.5 (Architecture) must design the Locator Resolution Engine treating identity and locator as separate data structures, consistent with these principles.
- B4 (Implementation) must implement locator resolution that is deterministic, framework-agnostic, and robust — with identity as input and resolved locators as output.
- No future milestone may conflate identity and locator into a single concept or data structure.
- No future milestone may make locator resolution non-deterministic, framework-specific, or reliant on brittle identifiers as primary locators.
- No future milestone may remove or restructure the six locator categories.

---

*This document defines the CmdRunner Locator Resolution Strategy. All subsequent locator and Execution JSON milestones must conform to this strategy.*
