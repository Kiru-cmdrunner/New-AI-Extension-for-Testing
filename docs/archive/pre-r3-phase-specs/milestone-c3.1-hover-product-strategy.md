# Milestone C3.1 — Hover Recording Product Strategy

**Type:** Product Design and Planning (no implementation)
**Status:** PERMANENTLY FROZEN (2026-07-15T07:18:23Z)
**Date:** 2026-07-15
**Depends on:** Product Foundation, Product Architecture, Milestone 1 (Click Product Spec), Milestone 2 (Click Architecture), B1–B8, Post-B8 Capability Prioritization

---

## Table of Contents

1. [Product Purpose](#1-product-purpose)
2. [User Intent](#2-user-intent)
3. [Recording Rules](#3-recording-rules)
4. [Canonical Test Steps](#4-canonical-test-steps)
5. [Execution Model](#5-execution-model)
6. [Interaction Boundaries](#6-interaction-boundaries)
7. [Validation Strategy](#7-validation-strategy)
8. [Product Principles](#8-product-principles)
9. [Known Assumptions](#9-known-assumptions)
10. [Potential Risks](#10-potential-risks)
11. [Consistency Review Against Frozen Milestones](#11-consistency-review-against-frozen-milestones)
12. [Next Milestone Directive — C3.2 Implementation](#12-next-milestone-directive--c32-implementation)

---

## 1. Product Purpose

### 1.1 What Is a Hover Interaction?

A Hover interaction is the act of a user deliberately positioning the mouse pointer over a specific element on the page and remaining there long enough to **trigger observable application behavior** — opening a menu, revealing a tooltip, expanding a panel, or activating a UI state that the user intends to interact with next.

Hover is distinct from click and text entry in a critical way: it is a **dwell-based** interaction. There is no discrete activation event (like `mousedown`/`mouseup` for click, or `blur` for text entry). Instead, the user's intent is expressed by the combination of **targeting an element** and **remaining on it**.

### 1.2 Why Should Hover Be Recorded?

Hover recording serves three user purposes:

1. **Tooltip verification.** Many enterprise applications display contextual information on hover — tooltips, help text, data previews. A tester may need to verify that a tooltip appears and contains the correct text. The generated Playwright test must include a `.hover()` step followed by an assertion on the tooltip content.

2. **Menu and navigation access.** Many web applications use hover-triggered dropdown menus (mega-menus, cascading navigation, context menus). The user hovers over "Products" to reveal a submenu, then clicks a submenu item. Without a recorded hover, the generated Playwright test would attempt to click a submenu item that is not yet visible — the test would fail.

3. **UI state transitions.** Some applications reveal interactive elements only on hover — action buttons that appear when hovering over a table row, edit icons that appear on hover over a card, quick-action toolbars. The hover is a prerequisite for the subsequent interaction. The generated test must include the hover step so the target element becomes visible and clickable.

### 1.3 What User Value Does Hover Provide?

| User Value | Scenario | Without Hover Recording |
|---|---|---|
| **Test completeness** | Hover-triggered menus: user hovers "Products" → clicks "Categories" | Playwright clicks "Categories" but it's not visible → test fails |
| **Tooltip/assertion support** | User hovers a help icon → tooltip "Enter your 6-digit code" appears | Generated test has no hover step → tooltip assertion has no trigger |
| **Workflow fidelity** | User hovers a table row → edit/delete buttons appear → user clicks Edit | Generated test clicks Edit but it's hidden → element not found |

### 1.4 Which Testing Scenarios Genuinely Require Hover?

| Scenario | Requires Hover? | Why |
|---|---|---|
| Mega-menu navigation (hover "Products" → click "Laptops") | ✅ Yes | Submenu is not visible without hover. Click fails without preceding hover. |
| Tooltip verification (hover help icon → assert tooltip text) | ✅ Yes | Tooltip does not exist in DOM without hover. |
| Hover-revealed action buttons (hover row → click "Delete") | ✅ Yes | Delete button is `display:none` or `visibility:hidden` until hover. |
| Cascading menu (hover "Menu" → hover "Submenu" → click item) | ✅ Yes | Each level requires the preceding hover to be visible. |
| Standard form fill (click input → type text → click submit) | ❌ No | Hover serves no purpose — the form elements are always visible. |
| Simple button click on a visible button | ❌ No | The button is always visible — hover is incidental. |
| Scanning the page (mouse moves around while user reads) | ❌ No | No observable behavior change. Pure incidental movement. |

### 1.5 Differentiation: Intentional Hover vs. Incidental Movement

This is the **central design challenge** of hover recording. The previous implementation (removed in v2.2.0) recorded every `mouseover` event, producing massive noise. The product must distinguish:

| Intentional Hover | Incidental Movement |
|---|---|
| User moves to "Products" and **stops** — the menu opens | User moves mouse across "Products" while heading to "Login" — menu may flash but user didn't stop |
| User hovers a help icon and **reads** the tooltip | User's mouse passes over a help icon en route to another element |
| User hovers a table row and **waits** for action buttons | User scrolls past table rows — mouse technically enters row boundaries |
| User deliberately positions cursor on a menu trigger | User's cursor drifts during page load or animation |

**The discriminating principle:**

> **An intentional hover is one where the user intentionally pauses on the element and the application produces observable behavior that the user then acts upon (or intends to verify).**

This principle has two components that must BOTH be present:
1. **Intentional pause** — the user's pointer remained on the element deliberately (not a pass-through).
2. **Observable application behavior** — hovering the element caused the application to change its UI in a meaningful way (menu appeared, tooltip showed, buttons became visible — not just cosmetic changes).

---

## 2. User Intent

### 2.1 What Constitutes User Intent for Hover?

Following Milestone 2's Principle 8 ("Confident classification or nothing") and Principle 9 ("Single responsibility"), hover must have its own clear intent definition:

> **Hover intent is the deliberate positioning of the pointer on an element for the purpose of revealing or activating UI state that the user intends to interact with or verify.**

This is fundamentally different from click intent ("activate this element") or text intent ("enter a value into this field"). Hover intent is about **revealing** — making something visible, accessible, or active through an intentional pause.

### 2.2 The Intent Hierarchy

| Level | Description | Record? |
|---|---|---|
| **Level 1 — Incidental pass** | Mouse enters element during travel to another target. No pause. | ❌ Never |
| **Level 2 — Brief pause** | Mouse pauses on element momentarily, then leaves. May trigger a CSS `:hover` state but the user didn't interact with the result. | ❌ No (see §3.2 for dwell threshold) |
| **Level 3 — Intentional pause + observable effect** | User intentionally pauses on element. Application reveals new UI (menu, tooltip, panel). User then interacts with the revealed content or moves on after observing. | ✅ Yes |
| **Level 4 — Pause + no observable effect** | User pauses on element but nothing meaningful happens. The element has no hover behavior. | ❌ No (no purpose) |

**Only Level 3 produces a recorded Hover interaction.** Levels 1, 2, and 4 are not recorded.

### 2.3 Examples

**Intentional Hover (record):**

| Scenario | Why Intentional |
|---|---|
| Hover "Products" menu → dropdown appears → click "Laptops" | Dwell + observable effect (menu opened). User acted on the result (clicked submenu). |
| Hover help icon "?" → tooltip appears → user reads it | Dwell + observable effect (tooltip). User's intent was to see the information. |
| Hover table row → edit/delete buttons appear → click "Edit" | Dwell + observable effect (buttons revealed). User acted on the result. |

**Not Intentional Hover (do not record):**

| Scenario | Why Not Intentional |
|---|---|
| Mouse passes over "Products" while heading to "Login" | No dwell. Pass-through. |
| Mouse pauses on a paragraph of text while reading | Dwell but no observable UI effect. The paragraph has no hover behavior. |
| Mouse enters a div with `:hover { background: #f0f0f0 }` briefly | Brief dwell. CSS hover state changed but user didn't interact with anything revealed by it. Background color change is not a meaningful UI reveal. |
| Mouse enters a button, then immediately clicks it | The hover is incidental to the click. The click is the interaction. Hover should not be separately recorded. |

---

## 3. Recording Rules

### 3.1 The Hover Decision Tree

Following the Click Architecture's 5-gate pattern (Milestone 2, frozen), Hover has its own decision tree. **All gates must pass for a Hover to be recorded.**

```
GATE 1 — Is it genuine?
  event.isTrusted === true?
  → NO: DISCARD (synthetic/programmatic event)

GATE 2 — Does another interaction own it?
  element has data-cmdrunner-handled attribute?
  → YES: DISCARD (already captured by click/text entry)

GATE 3 — Is the target a hover-responsive element?
  Does the element have hover behavior?
  (Check: has onmouseenter/onmouseover handler, or :hover CSS rule
   with display/visibility/opacity changes, or ARIA attributes
   suggesting interactive disclosure)
  → NO: DISCARD (hovering a non-responsive element produces nothing)

GATE 4 — Did the user intentionally pause over the element?
  Pointer remained on element for a meaningful duration?
  (Current implementation: ≥ DWELL_THRESHOLD ms — see §3.2)
  → NO: DISCARD (pass-through, not intentional)

GATE 5 — Did hovering produce observable application behavior?
  Did the application reveal new interactive content?
  (Current implementation: DOM mutation detected via MutationObserver — see §3.3)
  → NO: DISCARD (hover had no meaningful effect)

GATE 6 — Is the hover followed by an interaction on the revealed content?
  (Optional confidence boost — see §3.3)
  → YES: High-confidence intentional hover → RECORD
  → NO (dwell + effect but no subsequent interaction):
     Medium-confidence → RECORD (user may have been verifying tooltip text)

ALL GATES PASS → RECORD HOVER
```

### 3.2 Intentional Pause — Product Rule

**Product Rule:** Hover should be recorded only when the user **intentionally pauses** over an element. The discriminating principle is user intent: a deliberate stop, not a pass-through.

**Implementation Detail — Dwell Threshold:**

The current implementation detects intentional pause using a fixed dwell threshold:

**`DWELL_THRESHOLD = 500ms`**

Rationale for 500ms (implementation-level):
- Human reaction time to visual stimuli is ~250ms. A user who intentionally hovers to reveal a menu will dwell for at least 500ms while they read the menu items.
- Mouse cursor travel between elements rarely pauses for more than 200-300ms unless the user is intentionally hovering.
- 500ms aligns with CSS `:hover` transition durations in most UI frameworks (0.3s–0.5s is standard for menu reveals).
- The threshold is a constant, not user-configurable. It must be deterministic and consistent.

**Why not shorter (e.g., 200ms)?** Too many false positives. Rapid mouse movement across a nav bar would trigger hover recordings for every element passed.

**Why not longer (e.g., 1000ms)?** Too restrictive. Users who hover a menu and quickly scan the items may move on within 800ms. A 1000ms threshold would miss these.

> **Product Stability Note:** The dwell threshold is an implementation detail that may evolve based on future validation without changing the product rule. The product requirement is "intentional pause." The threshold of 500ms is the current implementation's choice for detecting that intent.

### 3.3 Observable Application Behavior — Product Rule

**Product Rule:** Hover should produce **observable application behavior** before it is considered a meaningful interaction. Observable application behavior means the application reveals new interactive content — menus, tooltips, panels, action buttons — that changes what the user can do next.

**Purely cosmetic visual changes do not, by themselves, constitute sufficient evidence of a meaningful hover interaction.** Cosmetic changes include:
- `background-color` change on the hovered element itself
- `cursor` change (e.g., `cursor: pointer`)
- `text-decoration` change (e.g., underline on link hover)

These are styling effects, not content reveals. They do not indicate that the hover produced new interactive content.

**Implementation Detail — Detection Mechanism:**

The current implementation detects observable application behavior using:

1. **DOM MutationObserver.** A `MutationObserver` is attached when the pointer enters the target element. If any child elements are added, removed, or have visibility/display/opacity changes during the dwell period, the hover is considered to have produced an observable effect.

2. **CSS `:hover` analysis (lightweight).** Before committing to a MutationObserver, the content script checks whether the element or its children have `:hover` CSS rules that modify `display`, `visibility`, `opacity`, `transform`, or `height`. If so, the element is a candidate for hover-responsive behavior.

3. **Event handler presence.** If the element has `onmouseenter`, `onmouseover`, or jQuery `.hover()` / `.mouseenter()` bindings (detected via heuristic), it is hover-responsive.

> **Product Stability Note:** The detection mechanism is an implementation detail that may evolve without changing the product rule. The product requirement is "observable application behavior." Future implementations may incorporate additional evidence such as visibility changes, previously hidden content becoming available, accessibility tree changes, or other reliable indicators of meaningful application behavior. The current DOM mutation + CSS analysis approach is the implementation's choice for detecting that behavior.

### 3.4 When Hover Should NOT Be Recorded

| Scenario | Gate That Fails | Why |
|---|---|---|
| Mouse passes over element without pausing | Gate 4 (dwell) | <500ms — pass-through |
| User hovers a paragraph of text | Gate 3 (hover-responsive) | No hover behavior — pure content element |
| User hovers a button then clicks it | Gate 2 (ownership) | Click interaction will own the element |
| Mouse enters element, dwells, nothing happens | Gate 5 (observable behavior) | No content revealed — no meaningful application behavior |
| Mouse enters element, CSS `:hover` changes background color only | Gate 5 | Background change is purely cosmetic, not observable application behavior |
| Mouse enters element during page scroll | Gate 4 (dwell) | Scroll movement resets dwell timer |

### 3.5 Debounce and Noise Suppression

Multiple mouseenter/mouseleave events may fire in rapid succession (e.g., when the cursor crosses child elements within a container). The recorder must:

1. **Track dwell on the outermost hover-responsive ancestor.** If the pointer enters a child element inside a hover-responsive container, the dwell timer continues on the container — it does not reset.

2. **Use `mouseenter`/`mouseleave` (not `mouseover`/`mouseout`).** `mouseenter` fires once when the pointer enters the element boundary and does not re-fire for child elements. This naturally debounces nested element traversal.

3. **Cancel pending hover on rapid exit.** If the pointer leaves the element before the dwell threshold is reached, the pending hover is cancelled. No interaction is recorded.

---

## 4. Canonical Test Steps

### 4.1 Plain English Format

Hover interactions follow the naming priority established by the Click product spec (Milestone 1 §3):

| Priority | Source | Example |
|---|---|---|
| 1 | AI business name | Hover over "Products Navigation" |
| 2 | Accessible name (aria-label, text content) | Hover over "Products" |
| 3 | ARIA role | Hover over the "navigation" region |
| 4 | Tag fallback | Hover over the "nav" element |

Format: `Hover over "[name]"`

### 4.2 When Hover Generates a Step

A Hover interaction always generates a Canonical Test Step if it passes all gates in the decision tree (§3.1). There is no "silent" hover — if the recorder determines the hover was intentional, it becomes a step.

### 4.3 When Hover Should Be Omitted

Hover is omitted (not recorded) when any gate fails. The most common omission cases:

| Case | Omitted Because |
|---|---|
| Hover a button before clicking it | The click interaction owns the element. Hover is incidental to the click. |
| Hover a non-interactive area | Gate 3 fails — no hover behavior. |
| Brief hover during mouse travel | Gate 4 fails — insufficient dwell. |

### 4.4 Merging with Adjacent Interactions

**Hover should NOT be merged with adjacent interactions by the Readability Optimizer.**

| Sequence | Merge? | Why |
|---|---|---|
| Hover "Products" → Click "Laptops" | ❌ No | The hover and click are on **different elements**. The hover reveals the menu; the click selects an item within the menu. Merging would lose the hover step that makes the submenu visible in Playwright. |
| Hover "Help" → Read tooltip | ❌ No | Hover is a standalone interaction. There is no subsequent click to merge with (the user reads the tooltip and moves on). |
| Hover row → Click "Edit" | ❌ No | Different elements. The hover reveals the edit button; the click activates it. Both are meaningful. |

**Why Hover is never merged:**
1. Hover and the subsequent interaction always target **different elements** (the hover target is the container; the click target is the revealed child).
2. The hover step is **execution-necessary** — without it, the subsequent click target is not visible in Playwright. Removing it would break the test.
3. OR-1 (focus-click + text-entry merge) works because the click and text entry target the **same** element. Hover interactions never share an element with their follow-up.

### 4.5 Readability Optimizer Impact

| Rule | Applies to Hover? | Why |
|---|---|---|
| OR-1 (focus-click + text-entry merge) | ❌ No | Different interaction types. Hover is not a click or text entry. |
| OR-2 (consecutive text entry) | ❌ No | Hover is not text entry. |
| OR-3 (duplicate click removal) | ❌ No | Hover is not a click. |

**No existing readability rule applies to Hover.** The Readability Optimizer does not need modification for Hover support. Hover steps pass through the optimizer unchanged.

---

## 5. Execution Model

### 5.1 Execution Action Type

Hover requires a new execution action type: `"hover"`.

| Property | Value |
|---|---|
| `action.type` | `"hover"` |
| `action.value` | `null` (hover carries no value) |

### 5.2 Execution JSON Structure

Per the B5.2 contract, the Hover interaction produces:

```json
{
  "action": {
    "type": "hover",
    "value": null
  },
  "target": {
    "kind": "element",
    "tag": "LI",
    "role": "menuitem",
    "name": "Products"
  },
  "locators": [
    { "strategy": "text", "value": "Products", "role": "primary" },
    { "strategy": "css", "value": "nav > ul > li:first-child", "role": "secondary" }
  ],
  "context": {
    "iframe": null,
    "shadowDom": false
  },
  "trace": {
    "interactionId": "hover-0001",
    "stepId": "step-0003"
  },
  "meta": {
    "status": "generated",
    "warnings": [],
    "generatedAt": "2026-07-15T..."
  }
}
```

This follows the exact same contract structure as click and text — only `action.type` differs.

### 5.3 Locator Resolution

Hover uses the same Locator Resolution Engine (B4.4) as all other interactions. No changes to the priority hierarchy:

```
testId → dataCy → dataQa → ariaLabel → id → name → text → css → xpath
```

The hover target's `ElementIdentity` is resolved through the same engine.

### 5.4 Playwright Mapping

| Execution JSON Action | Playwright Statement |
|---|---|
| `action.type = "hover"` | `await [locator].hover();` |

Example:
```typescript
// Step 1: Hover over "Products"
await getByText('Products').hover();

// Step 2: Click "Laptops"
await getByText('Laptops').click();
```

The Playwright Generator's `translateAction()` function gains one new case:
```typescript
case 'hover':
  return `${selector}.hover();`;
```

### 5.5 Pipeline Integration Confirmation

| Pipeline Stage | Impact of Hover |
|---|---|
| Interaction Timeline | New event type `hover` added. Same event structure (actionId, type, timestamp, elementIdentity). |
| Canonical Step Generator | New interaction type config registered. `toPlainEnglish()` produces `Hover over "[name]"`. |
| Readability Optimizer | No change — no rule applies to hover steps. |
| Execution JSON Generator | `action.type` mapping extended: `hover` → `{ type: "hover", value: null }`. |
| Playwright Generator | `translateAction()` extended: `hover` → `.hover()`. |

**No new pipeline stage. No new artifact. No architectural change.** Hover follows the exact same pipeline as click and text entry. The Milestone 2 architecture principle applies: "Only detection logic changes per interaction type; pipeline is identical."

---

## 6. Interaction Boundaries

### 6.1 Hover vs. Other Interactions

| Sequence | How It Works |
|---|---|
| **Hover → Click** | Hover is recorded (it revealed the click target). Click is recorded on the revealed element. Both are separate steps. Example: Hover "Products" → Click "Laptops". |
| **Hover → Navigation** | Hover is recorded (it revealed the nav menu). Navigation is recorded when the page changes. Both are separate steps. |
| **Hover → Text Entry** | Hover is recorded (it revealed an input, e.g., a search bar in a mega-menu). Text entry is recorded when the user types and blurs. Both are separate steps. |
| **Hover → Hover** | Each hover is a separate step if it passes all gates. Cascading menus: Hover "Menu" → Hover "Submenu" → Click "Item" = 3 steps. |
| **Click → Hover** | Click is recorded (it opened a context where hover is meaningful, e.g., clicking a tab to reveal a panel with hover-tooltips). Hover is recorded separately if it passes all gates. |
| **Hover → Nothing** | Hover is recorded if it passed Gate 5 (observable UI change). The user hovered, observed the result, and moved on. This is valid — the tester may want to assert on the revealed content. |

### 6.2 Ownership Model

Following Milestone 2's ownership principle (`data-cmdrunner-handled`), Hover respects the same ownership:

1. **Click claims ownership first.** If the user clicks an element, the click content script sets `data-cmdrunner-handled` on the element. Hover's Gate 2 checks for this attribute — if present, the hover is discarded (the click interaction owns the element).

2. **Hover does NOT claim ownership.** Hover is a transient state. It does not set `data-cmdrunner-handled`. The hover target remains available for subsequent click/text interactions on revealed child elements.

3. **Hover and text entry do not conflict.** Text entry's blur-based capture is on input elements. Hover targets are containers, menu items, icons — not input elements. There is no overlap.

### 6.3 Hover Remains Independent

Hover is always an **independent interaction** — it is never merged into a compound interaction. Each intentional hover produces one Canonical Test Step. This is because:

1. Hover targets are always **different elements** from subsequent interactions (the hover target reveals content; the user then interacts with the revealed content).
2. Hover is **execution-necessary** — removing it would break Playwright tests by making target elements invisible.
3. The Readability Optimizer has no rule that applies to hover (§4.5).

---

## 7. Validation Strategy

### 7.1 Validation Scenarios

Using the B8 Validation Framework's workflow categories:

| Scenario | B8 Category | Expected Behavior |
|---|---|---|
| **Mega-menu navigation** | W12 Navigation | Hover "Products" (intentional pause) → menu appears → Click "Laptops". Two steps: Hover + Click. |
| **Tooltip verification** | W2 Search / W5 Tables | Hover help icon → tooltip appears. One step: Hover. |
| **Hover-revealed actions** | W5 Tables | Hover table row → edit/delete buttons appear → Click "Edit". Two steps: Hover + Click. |
| **Cascading menu** | W12 Navigation | Hover "Menu" → Hover "Submenu" → Click "Item". Three steps: Hover + Hover + Click. |
| **Form with no hover** | W1 Auth / W4 Form Entry | Fill username, password, click Login. No hover steps. Mouse movement over form elements is incidental. |
| **Pass-through noise** | All categories | Mouse moves across nav bar without pausing. No hover steps recorded. |
| **Hover on non-responsive element** | All categories | Hover a paragraph or image with no hover behavior. No hover step recorded. |
| **Hover followed by click on same element** | W3 CRUD | Hover a button then click it. Only click recorded. Hover discarded (Gate 2 — click owns element). |

### 7.2 Pass Criteria

| Check | Pass When |
|---|---|
| **Hover captured** | Intentional hover (dwell + observable effect) appears in Timeline and Canonical Steps |
| **Noise excluded** | Incidental pass-throughs, brief dwells, and non-responsive hovers do NOT appear |
| **Element identity complete** | Hover event has full ElementIdentity (tag, accessibleName, cssSelector, etc.) |
| **Execution JSON valid** | `action.type = "hover"`, locators follow B4.4 priority |
| **Playwright correct** | `.hover()` statement present for each hover step; no `.hover()` for non-recorded hovers |
| **No click interference** | Click events on hover-revealed elements are captured normally (hover didn't block click detection) |

### 7.3 Common Failure Cases

| Failure | Likely Root Cause | Defect Code |
|---|---|---|
| Hover step missing from Timeline | Dwell threshold too high, or observable-behavior detection missed the UI change | REC |
| Excessive hover noise in Timeline | Dwell threshold too low, or Gate 3 (hover-responsive check) too permissive | REC |
| Hover step present but Playwright `.hover()` missing | Playwright Generator doesn't map `hover` action type | PWG |
| Hover and click on same element both recorded | Ownership model (Gate 2) failed | REC |
| Hover step has empty element identity | Identity extraction failed on hover target | REC |

### 7.4 Regression Scenarios

| Regression Check | What to Verify |
|---|---|
| **Existing click recording** | Hover content script does not interfere with click-content-script's event listeners |
| **Existing text entry recording** | Hover content script does not interfere with text-entry-content-script's blur handler |
| **Existing OR-1 optimization** | Readability Optimizer behavior unchanged for click+text pairs |
| **Existing pipeline** | Execution JSON and Playwright generation for existing click/text/navigation steps unchanged |

### 7.5 Evidence Required

Per B8 §6, plus hover-specific evidence:
- **Video** showing the mouse movement and intentional pause (critical for hover — screenshots don't show dwell duration)
- **Observable behavior log** showing what application changes occurred during hover (confirms Gate 5 — current implementation: MutationObserver log)
- **Hover dwell timing** (ms between mouseenter and mouseleave/recording)

---

## 8. Product Principles

### HP1: Record User Intent, Not Browser Events

The recorder captures intentional hovers, not raw `mouseover` events. An intentional hover requires an intentional pause that produces observable application behavior. Everything else is noise.

### HP2: Minimize Recording Noise

The primary failure mode of hover recording is over-recording. A noisy timeline is worse than no hover recording at all. When uncertain, do not record.

### HP3: Preserve Deterministic Execution

Hover recording must be deterministic: the same user actions produce the same recorded interactions. The detection criteria (intentional pause, observable application behavior) must be structural and reliable — not based on timing variability or heuristic guessing.

### HP4: Preserve Execution Semantics

Hover steps in the Execution JSON and Playwright output must accurately represent the recorded interaction. `.hover()` in Playwright must target the same element the user hovered.

### HP5: Framework-Agnostic

Hover recording must work across React, Vue, Angular, and plain HTML. The detection logic (dwell + DOM mutation) does not depend on framework internals. Framework-specific hover components (React Tooltip, Vue Popover) produce the same DOM mutations as plain HTML.

### HP6: Clean Integration with Existing Architecture

Hover follows the same content script pattern as click and text entry. Same ownership model. Same identity extraction. Same interaction type registration. Same pipeline. No new architectural patterns.

### HP7: No Regression to Existing Pipeline

Hover content script must not interfere with click or text entry recording. The three content scripts operate independently — each listens for its own event types and respects the `data-cmdrunner-handled` ownership flag.

### HP8: When Uncertain, Do Not Record

If the recorder cannot confidently determine that a hover was intentional (dwell too short, no observable effect, ambiguous target), it does not record. This follows Milestone 2 Principle 8: "Uncertainty is never an interaction."

---

## 9. Known Assumptions

| # | Assumption | Risk | Mitigation |
|---|---|---|---|
| A1 | **(Implementation)** 500ms dwell threshold separates intentional pause from pass-through | Medium — some users hover intentionally for <500ms | Conservative. Better to miss a fast hover than record noise. User can manually add hover steps during review. Threshold is tunable without changing the product rule. |
| A2 | **(Implementation)** MutationObserver + CSS `:hover` analysis detects all meaningful hover UI changes | Medium — some frameworks use CSS-only transitions (no DOM mutation) | Supplement with CSS `:hover` rule analysis. If element has `:hover` rules that change `display`/`visibility`/`opacity`, consider it hover-responsive even without DOM mutation. Future implementations may add additional detection evidence (accessibility tree changes, etc.). |
| A3 | `mouseenter`/`mouseleave` correctly bound hover targets across frameworks | Low — `mouseenter` is a standard DOM event | Standard browser behavior. Frameworks may stop propagation, but `mouseenter` doesn't bubble. |
| A4 | Hover-revealed elements are always visible in Playwright after `.hover()` | Medium — some reveals require JavaScript timing | Playwright's `.hover()` waits for the element to be visible (auto-wait). If the reveal has a delay, Playwright handles it. |
| A5 | Users will not be confused by hover steps they didn't expect | Low — the 6-gate decision tree is conservative | Steps are clearly labeled `Hover over "X"`. Users can delete unwanted steps during review. |

---

## 10. Potential Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **(Implementation) MutationObserver performance overhead.** Attaching a MutationObserver on every hover-responsive element may impact page performance. | Medium | Attach observer only on dwell (after threshold is met), not on mouseenter. Detach immediately after checking. Observe only `childList` and `attributes` (not `subtree` by default). |
| R2 | **Hover recording interferes with click detection.** If the hover content script's event listeners conflict with click-content-script. | High | Separate content scripts. Hover listens for `mouseenter`/`mouseleave`; click listens for `mousedown`/`mouseup`. No event overlap. Ownership model prevents double-recording. |
| R3 | **Dwell threshold too aggressive for some use cases.** Power users who hover quickly may have hovers missed. | Medium | Conservative by design. Missed hovers are less harmful than noise. Users can manually add hover steps during review. |
| R4 | **Hover on dynamically loaded content.** SPA route changes may load new hover-responsive elements after page load. | Low | Content script runs in the page context and reacts to events in real time. Dynamic elements are captured as they appear. |
| R5 | **Shadow DOM hover targets.** Hover events on Shadow DOM elements may not propagate to the document. | Medium | Use `composedPath()` on the mouseenter event (same approach as click-content-script). If the target is inside a Shadow root, traverse to the shadow host. |

---

## 11. Consistency Review Against Frozen Milestones

### 11.1 Product Foundation

| Frozen Decision | Hover Strategy | Consistent? |
|---|---|---|
| Canonical Test Steps have plain English, action type, locator | Hover step: `Hover over "Products"` with actionType `hover` | ✅ |
| Pipeline: Timeline → Steps → JSON → Playwright | Hover flows through existing pipeline unchanged | ✅ |
| Plain English is editable | User can edit/delete hover steps during review | ✅ |

### 11.2 Product Architecture

| Frozen Decision | Hover Strategy | Consistent? |
|---|---|---|
| Single editable surface (Canonical Test Steps) | Hover steps are part of the same surface | ✅ |
| No new artifacts | No new artifact — hover is a new interaction type, not a new pipeline stage | ✅ |

### 11.3 Milestone 1 (Click Product Spec)

| Frozen Decision | Hover Strategy | Consistent? |
|---|---|---|
| Click is the canonical interaction template | Hover follows the same product model: definition, intent, recording rules, decision tree | ✅ |
| "Does this interaction matter to the test flow?" | Hover matters only when it reveals content the user interacts with or verifies | ✅ |

### 11.4 Milestone 2 (Click Architecture)

| Frozen Decision | Hover Strategy | Consistent? |
|---|---|---|
| Principle 4: "Only detection logic changes per interaction type; pipeline is identical" | Hover has its own content script + detection logic; pipeline is identical | ✅ |
| Principle 8: "Confident classification or nothing" | Hover's 6-gate decision tree enforces confident classification (dwell + observable effect) | ✅ |
| Principle 9: "Single responsibility" | Hover answers only "Did the user intentionally hover?" — it does not infer click, navigation, or dropdown | ✅ |
| `data-cmdrunner-handled` ownership model | Hover respects ownership (Gate 2) and does not claim ownership (hover is transient) | ✅ |

### 11.5 B1–B6 (Generation Pipeline)

| Frozen Decision | Hover Strategy | Consistent? |
|---|---|---|
| B2 AP3: Pure function generators | Hover interaction type config is a pure function (same as click/text configs) | ✅ |
| B4.4: Locator Priority Strategy | Hover uses same locator resolution — no change to priority | ✅ |
| B5.2: Execution JSON Contract | Hover adds `action.type: "hover"` — same contract structure, new enum value | ✅ |
| B6: Playwright Generator | Hover adds `.hover()` mapping — same generator, new action case | ✅ |

### 11.6 B7.1–B7.2 (Readability Optimizer)

| Frozen Decision | Hover Strategy | Consistent? |
|---|---|---|
| OR-1: Focus-click + text-entry merge | Does not apply to hover (different interaction types) | ✅ |
| Step IDs preserved | Hover steps get their own stepIds from StepIdGenerator | ✅ |
| Optimizer is internal to Canonical Step Generator | Hover steps pass through optimizer unchanged | ✅ |

### 11.7 B8 (Validation Framework)

| Frozen Decision | Hover Strategy | Consistent? |
|---|---|---|
| Capability Status: Hover is "Not Yet Implemented" | After C3 implementation, transitions to "Supported" | ✅ |
| Regression suite must pass for Supported capabilities | Hover validation scenarios added to regression suite after implementation | ✅ |
| Defect classification applies | Hover-specific defects classified as REC (recording), PWG (Playwright), etc. | ✅ |

### 11.8 Post-B8 Capability Prioritization

| Frozen Decision | Hover Strategy | Consistent? |
|---|---|---|
| Hover recommended as Milestone C3, priority High, effort Medium | This strategy document is the product design for C3 | ✅ |
| Hover must be rebuilt with new architecture | This strategy defines hover within the frozen Milestone 2 architecture | ✅ |

**No conflicts found.** Hover recording is fully compatible with every frozen milestone. No architectural changes required.

---

## Freeze Declaration

This document is **PERMANENTLY FROZEN** as of 2026-07-15T07:18:23Z. It defines the Hover Recording Product Strategy and is the authoritative product design for Milestone C3. All subsequent implementation milestones (C3.2+) must build upon this frozen strategy and must not revisit product strategy, redesign Hover behavior, or modify previously frozen product or architecture decisions.

**Modification Policy:** This strategy shall not be modified unless a genuine architectural conflict or functional defect is discovered during implementation or validation. If such a conflict is found, it must be formally documented with evidence and an impact analysis before any change is made.

**Implementation Independence:** Implementation decisions may evolve where explicitly identified as implementation details (dwell threshold value, detection mechanism specifics). The frozen product rules and architectural principles must remain unchanged.

### Product Rule Stability

The product rules are implementation-independent:

1. **Intentional Pause** — The product rule is that hover is recorded only when the user intentionally pauses over an element. The current implementation may detect this using a fixed 500ms dwell threshold. This threshold is an implementation detail that may evolve based on future validation without changing the product rule.

2. **Observable Application Behavior** — The product rule is that hover must produce observable application behavior (new interactive content revealed) to be considered a meaningful interaction. The current implementation may detect this using DOM mutation observation and CSS `:hover` rule analysis. Future implementations may incorporate additional evidence (visibility changes, accessibility tree changes, etc.). The detection mechanism is an implementation detail.

3. **Cosmetic vs. Meaningful** — Purely cosmetic visual changes (cursor changes, color changes, hover highlighting, text-decoration changes) are explicitly documented as insufficient evidence of a meaningful hover interaction. This distinction is a permanent product rule, not an implementation detail.

These distinctions ensure that the product rules remain stable even if the detection implementation evolves.

Implementation is deferred to C3.2 (implementation milestone — see §12 below).

All frozen milestones (Product Foundation, Product Architecture, Milestones 1–2, B1–B8) remain unchanged. This strategy is consistent with every frozen decision.

---

## 12. Next Milestone Directive — C3.2 Implementation

C3.2 is an **implementation milestone only**. Its scope is strictly limited to:

1. Implementing the Hover content script according to the frozen 6-gate decision tree (§3.1).
2. Using the current implementation choices (500ms dwell threshold, DOM mutation + CSS analysis for observable-behavior detection).
3. Registering the `hover` interaction type in the existing pipeline (Canonical Step Generator → Execution JSON Generator → Playwright Generator).
4. Validating the implementation using the B8 Validation Framework.

C3.2 must NOT:
- Revisit product strategy or Hover behavior design.
- Modify any previously frozen product or architecture decision.
- Introduce new product rules or architectural principles.
- Redesign the 6-gate decision tree or the product principles.

If a genuine conflict is discovered during implementation, it must be formally documented with evidence and presented for review before any change to this frozen strategy is made.

---

*End of Milestone C3.1 — Hover Recording Product Strategy*
