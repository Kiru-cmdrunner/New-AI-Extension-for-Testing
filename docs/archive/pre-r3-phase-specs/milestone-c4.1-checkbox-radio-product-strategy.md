# Milestone C4.1 — Checkbox & Radio Button Product Strategy

**Type:** Product Design and Planning (no implementation)
**Status:** PERMANENTLY FROZEN (2026-07-16T04:08:00Z)
**Date:** 2026-07-16
**Depends on:** Product Foundation, Product Architecture, Milestone 1 (Click Product Spec), Milestone 2 (Click Architecture), B1–B8, C3.1–C3.3 (FROZEN)

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
12. [Next Milestone Directive — C4.2 Implementation](#12-next-milestone-directive--c42-implementation)

---

## 1. Product Purpose

### 1.1 What Is a Checkbox Interaction?

A Checkbox interaction is the act of a user toggling a checkbox control from one state to another — **unchecked → checked** (Check) or **checked → unchecked** (Uncheck) — thereby changing the boolean state of a form option. The interaction represents the resulting state, not the physical input that achieved it.

Checkbox is distinct from click in a critical way: it is a **state-based** interaction. A generic click records "I clicked this element." A checkbox interaction records "I checked (or unchecked) this control." The resulting state — not the input device — is what matters for test correctness. A Playwright test that calls `.check()` or `.uncheck()` will succeed regardless of whether the original user used a mouse, keyboard (Space), or assistive technology.

### 1.2 What Is a Radio Button Interaction?

A Radio Button interaction is the act of a user selecting one option from a mutually exclusive group — **unselected → selected** (Select). Radio buttons are fundamentally different from checkboxes: selecting a radio button cannot be undone by clicking it again (only by selecting a different radio in the same group). The interaction records the selection, not the click.

### 1.3 Why Should Checkbox and Radio Button Be Recorded?

Checkbox and radio recording serves three user purposes:

1. **Form state verification.** Testers need to verify that specific options are selected or deselected. A test that says "Check 'Remember Me'" followed by an assertion on the checkbox state is far more meaningful than a generic "Click" step that doesn't convey whether the checkbox was being checked or unchecked.

2. **Execution accuracy.** Playwright's `.check()`, `.uncheck()`, and `.check()` (for radio) methods are semantically correct — they ensure the target state is achieved regardless of the element's current state. A generic `.click()` is fragile: if the checkbox was already checked, clicking unchecks it, producing the wrong result. State-based recording eliminates this fragility.

3. **Test readability.** "Check 'Subscribe to Newsletter'" is immediately understandable. "Click 'Subscribe to Newsletter'" is ambiguous — did the user subscribe or unsubscribe? The state-based model removes ambiguity.

### 1.4 What User Value Do Checkbox and Radio Button Provide?

| User Value | Scenario | Without State-Based Recording |
|---|---|---|
| **Unambiguous intent** | User checks "Remember Me" | Generic "Click" — was it checked or unchecked? |
| **Deterministic execution** | Uncheck "Subscribe" | `.click()` toggles — if already unchecked, clicking checks it (wrong result). `.uncheck()` is idempotent — always results in unchecked. |
| **Test readability** | Select "Express Delivery" | "Click 'Express Delivery'" vs "Select 'Express Delivery'" — the latter conveys exclusive selection semantics |
| **Form completeness** | Multi-option preferences form | Each checkbox/radio state change is a distinct, meaningful step |

### 1.5 Differentiation: Meaningful State Changes vs. Incidental Clicks

This is the **central design challenge** of checkbox/radio recording. Not every click on a checkbox or radio button changes state. The product must distinguish:

| Meaningful State Change | Incidental Click |
|---|---|
| User checks "Remember Me" (unchecked → checked) | User clicks an already-checked checkbox (no state change) |
| User selects "Credit Card" (different radio selected → Credit Card) | User clicks an already-selected radio button (no state change) |
| User unchecks "Email Notifications" (checked → unchecked) | User clicks a disabled checkbox (no state change possible) |
| User toggles a custom ARIA checkbox widget | User clicks a read-only radio (state cannot change) |

**The discriminating principle:**

> **A meaningful checkbox or radio interaction is one where the control's state actually changed as a result of user action. Clicks that do not produce a state change are incidental and must not be recorded.**

This principle has one component that must be present:
1. **Actual state transition** — the control's `checked` property changed from one value to another as a direct result of the user's action.

This is simpler than hover's dual-component principle (dwell + observable behavior). State-based interactions have a definitive, binary signal: the state either changed or it didn't. There is no ambiguity and no threshold to tune.

### 1.6 State-Based Interaction Model

Checkbox and Radio Button interactions represent the **intended state transition** rather than the physical click:

| Control | Before | After | Recorded Action |
|---|---|---|---|
| Checkbox | Unchecked | Checked | **Check** |
| Checkbox | Checked | Unchecked | **Uncheck** |
| Radio | Not selected | Selected | **Select** |

The recorded interaction describes the resulting state, not the input device used to achieve it. This keeps the product model implementation-independent and allows future execution using different interaction methods (mouse click, keyboard Space/Arrow, programmatic) without changing the product behavior.

---

## 2. User Intent

### 2.1 What Constitutes User Intent for Checkbox and Radio?

Following Milestone 2's Principle 8 ("Confident classification or nothing") and Principle 9 ("Single responsibility"), checkbox and radio must have their own clear intent definitions:

> **Checkbox intent is the deliberate toggling of a boolean option to a specific state — checked or unchecked — for the purpose of configuring form behavior, preferences, or application state.**

> **Radio intent is the deliberate selection of one option from a mutually exclusive group, replacing any previous selection in that group.**

### 2.2 The Intent Classification

| Level | Description | Record? |
|---|---|---|
| **Level 1 — No-op click** | User clicks an already-checked checkbox. State does not change. | ❌ Never |
| **Level 2 — No-op radio click** | User clicks an already-selected radio. State does not change. | ❌ Never |
| **Level 3 — Disabled/read-only click** | User clicks a disabled or read-only control. Interaction is rejected by the browser. | ❌ Never |
| **Level 4 — Meaningful state change** | User interacts with the control and its `checked` property transitions. | ✅ Yes |

**Only Level 4 produces a recorded interaction.** Levels 1–3 are not recorded because no state change occurred.

### 2.3 Examples

**Meaningful (record):**

| Scenario | Why Meaningful |
|---|---|
| Check "Remember Me" (was unchecked, now checked) | State transitioned: false → true |
| Uncheck "Subscribe to Newsletter" (was checked, now unchecked) | State transitioned: true → false |
| Select "Express Delivery" (was "Standard", now "Express") | State transitioned: selection changed |
| Toggle custom ARIA checkbox via keyboard (Space) | State transitioned — input method is irrelevant |

**Not meaningful (do not record):**

| Scenario | Why Not Meaningful |
|---|---|
| Click "Remember Me" when it's already checked | No state change — checked stays checked |
| Click "Express Delivery" when it's already selected | No state change — radio stays selected |
| Click a greyed-out (disabled) checkbox | Browser rejects the interaction — no state change |
| JavaScript sets checkbox.checked = true programmatically | Not user-initiated — no genuine user intent |

---

## 3. Recording Rules

### 3.1 The Checkbox/Radio Decision Tree

Following the Click Architecture's gate pattern (Milestone 2, frozen) and the Hover decision tree pattern (C3.1, frozen), Checkbox/Radio has its own decision tree. **All gates must pass for an interaction to be recorded.**

```
GATE 1 — Is it genuine?
  PRODUCT REQUIREMENT: The state change was triggered by a real user
  action, not by JavaScript or other programmatic code.
  → NO: DISCARD (programmatic/synthetic change)

GATE 2 — Does another interaction own it?
  PRODUCT REQUIREMENT: The element has not already been claimed by
  another interaction handler in the same recording session.
  → YES: DISCARD (already captured by click or another handler)

GATE 3 — Is the target a checkbox or radio control?
  PRODUCT REQUIREMENT: The element is semantically a toggle or
  single-select control — either a native checkbox/radio input or
  an element with the appropriate ARIA role.
  → NO: DISCARD (not a toggle/select control)

GATE 4 — Did the state actually change?
  PRODUCT REQUIREMENT: The control's state was different after the
  user's interaction compared to before it. The user intentionally
  changed the control's state.
  → NO: DISCARD (no-op click — state unchanged)

GATE 5 — Is the control enabled and interactive?
  PRODUCT REQUIREMENT: The control is not disabled, read-only, or
  otherwise non-interactive. The user's action was not rejected.
  → NO: DISCARD (control cannot be interacted with)

ALL GATES PASS → RECORD STATE TRANSITION
  Checkbox: state → checked   → Record "Check"
  Checkbox: state → unchecked → Record "Uncheck"
  Radio:    state → selected  → Record "Select"
```

> **Product Stability Note (Decision Tree):** The gates above express **product requirements** — what must be true for a checkbox or radio interaction to be recorded. They do not prescribe detection mechanisms. The current implementation may satisfy each gate using specific browser APIs:
>
> | Gate | Product Requirement | Possible Implementation Mechanisms |
> |---|---|---|
> | Gate 1 | Genuine user action | `event.isTrusted`, trusted-event flag, user activation API |
> | Gate 2 | Not already claimed | `data-cmdrunner-handled` attribute, ownership registry |
> | Gate 3 | Semantic toggle/select control | `<input type>` check, `role` attribute, ARIA tree walk |
> | Gate 4 | Actual state transition | `change` event, `aria-checked` observation, pre/post state comparison |
> | Gate 5 | Control is interactive | `disabled`/`readonly` attribute, `aria-disabled`, computed style |
>
> Future implementations may incorporate additional deterministic evidence sources (e.g., user activation API, accessibility tree inspection, framework-specific state readers) without changing any gate's product requirement. The product rule is stable; the detection mechanism may evolve.

### 3.2 State Transition Detection — Product Rule

**Product Rule:** A Checkbox or Radio interaction should be recorded only when the user intentionally changes the control's state. A click that does not change the state is incidental noise and must not be recorded.

> **Product Stability Note:** The product requirement is that the user intentionally changed the control's state. The detection mechanism — how the recorder determines that a genuine state transition occurred — is an implementation detail. Current and future implementations may use native browser events (`change`), checked-state comparisons (pre/post `checked` property), accessibility state observation (`aria-checked` transitions), or other deterministic browser mechanisms. The choice and combination of evidence sources is the implementation's decision and may evolve without changing the product rule.

**Implementation Detail — Detection Mechanism (current reference implementation):**

The natural browser signal for state changes is the `change` event. The `change` event fires on `<input type="checkbox">` and `<input type="radio">` elements only when the `checked` property actually changes. This means:

- Clicking an unchecked checkbox → `change` fires (unchecked → checked) → **Record "Check"**
- Clicking an already-checked checkbox → `change` does NOT fire (no state change) → **Do not record**
- Clicking an unselected radio → `change` fires (and `change` fires on the previously-selected radio in the group as it deselects) → **Record "Select"**
- Clicking an already-selected radio → `change` does NOT fire → **Do not record**

The `change` event is the definitive signal for native HTML checkbox/radio controls. For ARIA-based custom controls (`role="checkbox"`, `role="radio"`), the `change` event does not fire natively — the application must dispatch it or toggle `aria-checked`. The implementation detail of detecting state changes on custom controls is deferred to C4.2.

> **Product Stability Note:** The detection mechanism (change event, aria-checked observation, pre/post state comparison) is an implementation detail that may evolve without changing the product rule. The product requirement is "actual state transition." Future implementations may detect this via change events, aria-checked attribute observation, or pre/post state comparison. The choice of mechanism is the implementation's decision.

### 3.3 Pre-State Evidence — Product Rule

**Product Rule:** The recorder must confirm that a genuine state transition occurred as a result of the user's action. Only actual state changes are recorded; clicks that do not change the state are excluded.

> **Product Stability Note:** The product requirement is that the recorder confirms a genuine state transition. How it obtains the evidence to make this determination — the pre-state capture mechanism — is an implementation detail. Current and future implementations may use event signals that inherently confirm a transition (e.g., the `change` event), pre/post state comparisons (reading `checked` or `aria-checked` before and after), accessibility state observation, or other deterministic evidence. The product rule remains stable regardless of the evidence mechanism used.

**Implementation Detail — How to capture pre-state (current reference implementation):**

The current architecture's content script pattern captures state at event time. For checkbox/radio, the recorder needs to know the state before the user's click. Options include:

1. Listen for `change` events (which inherently confirm a transition occurred) and read `event.target.checked` at that point.
2. Capture pre-state on `focus` or `mousedown` and compare to post-state on `change`/`click`.
3. Maintain a weak map of element → last-known-state, updated on each observed interaction.

Option 1 is the simplest for native controls. For ARIA custom controls, option 2 or 3 may be needed.

> **Product Stability Note:** The pre-state capture mechanism is an implementation detail. The product requirement is "the recorder must confirm a genuine state transition." How it captures pre-state is the implementation's decision.

### 3.4 When Checkbox/Radio Should NOT Be Recorded

| Scenario | Gate That Fails | Why |
|---|---|---|
| Click an already-checked checkbox | Gate 4 (state change) | No state change — checked stays checked |
| Click an already-selected radio | Gate 4 (state change) | No state change — selected stays selected |
| Click a disabled checkbox | Gate 5 (enabled) | `disabled` attribute prevents state change |
| Click a read-only radio | Gate 5 (enabled) | `readonly` prevents state change |
| Programmatic `el.checked = true` | Gate 1 (genuine) | Not user-initiated — synthetic state change |
| Click a div styled like a checkbox (no role/semantics) | Gate 3 (control type) | Not a recognized checkbox/radio control |

### 3.5 Debounce and Noise Suppression

Unlike hover (which requires dwell threshold tuning), checkbox/radio noise suppression is **inherent in the state-based product model**. The product rule requires an actual state transition — clicks that do not change the state are excluded by definition. There is no debounce threshold to tune, no timing sensitivity, no false positive risk from rapid mouse movement.

> **Product Stability Note:** The noise suppression is a consequence of the product rule ("record only when the user intentionally changes the control's state"), not a consequence of any specific detection mechanism. Whether the implementation uses `change` events, pre/post state comparison, or other deterministic evidence, the product requirement for actual state transition ensures noise-free recording.

The only edge case is rapid toggling: a user checks a checkbox, then immediately unchecks it. Both are genuine state changes and both should be recorded. The Readability Optimizer may optionally collapse consecutive check+uncheck pairs on the same element into a single step showing the final state — see §4.4.

---

## 4. Canonical Test Steps

### 4.1 Plain English Format

Checkbox and Radio interactions follow the naming priority established by the Click product spec (Milestone 1 §3):

| Priority | Source | Example |
|---|---|---|
| 1 | AI business name | Check "Remember Login Preference" |
| 2 | Associated `<label>` text | Check "Remember Me" |
| 3 | Accessible name (aria-label) | Check "Subscribe to Marketing Emails" |
| 4 | `value` or `name` attribute | Check the "newsletter_optin" control |
| 5 | Tag fallback | Check the checkbox control |

**Formats:**

| Action | Format | Example |
|---|---|---|
| Check | `Check "[name]"` | Check "Remember Me" |
| Uncheck | `Uncheck "[name]"` | Uncheck "Subscribe to Newsletter" |
| Select (Radio) | `Select "[name]"` | Select "Express Delivery" |

### 4.2 When Checkbox/Radio Generates a Step

A Checkbox or Radio interaction always generates a Canonical Test Step if it passes all gates in the decision tree (§3.1). There is no "silent" toggle — if the recorder determines the state changed, it becomes a step.

### 4.3 When Checkbox/Radio Should Be Omitted

| Case | Omitted Because |
|---|---|
| Click checkbox without state change | Gate 4 fails — no transition |
| Click radio that's already selected | Gate 4 fails — no transition |
| Disabled control click | Gate 5 fails — not interactive |
| Programmatic state change | Gate 1 fails — not genuine |

### 4.4 Merging with Adjacent Interactions

**Readability Optimizer Impact:**

| Sequence | Merge? | Why |
|---|---|---|
| Check "Subscribe" → Uncheck "Subscribe" (same element) | ⚠️ Optional (see below) | Consecutive opposite actions on the same element. The net effect is "unchanged." |
| Check "Option A" → Check "Option B" (different elements) | ❌ No | Independent choices. Both are meaningful. |
| Select "Standard" → Select "Express" (same radio group) | ❌ No | The second selection is meaningful — it changes the group's value. The first is the user changing their mind. Both steps show the user's exploration. (See §4.5 for alternative.) |
| Check "Remember Me" → Click "Login" | ❌ No | Different elements, different interaction types. |
| Text into "Email" → Check "Remember Me" → Click "Login" | ❌ No | All three are independent meaningful interactions. |

**OR-4: Consecutive Opposite Checkbox Toggle (DEFERRED):**

If a user checks then immediately unchecks the same checkbox (or vice versa), the net effect is no change. The Readability Optimizer *could* collapse these into zero steps (since the final state equals the initial state). However, this optimization is **deferred** for the following reasons:

1. The user's exploration (checking then unchecking) may be intentional — they may be verifying the checkbox works.
2. Collapsing removes evidence of the interaction, which could confuse users reviewing the test.
3. The existing OR-1 rule merges focus-click + text-entry because the click is *incidental* to the text entry. Opposite toggles are not incidental — each is a deliberate action.

This optimization may be revisited in a future milestone if real-world validation shows it causes confusion. For C4.1, **no new readability rule is introduced**. Checkbox/radio steps pass through the optimizer unchanged.

### 4.5 Radio Group — Previous Selection

When a user selects radio "Express" after previously having "Standard" selected, only the selection of "Express" is recorded. The deselection of "Standard" is **implicit** — radio button semantics guarantee only one selection per group. Recording the deselection separately would be redundant noise.

This is consistent with the state-based model: the recorded interaction describes the user's intent ("Select 'Express Delivery'"), not the mechanical side effect ("Standard was deselected by the browser").

---

## 5. Execution Model

### 5.1 Interaction Types

Two new interaction types are introduced:

| Interaction Type | `actionType` | `idPrefix` | Badge Color | Badge Label |
|---|---|---|---|---|
| Checkbox | `checkbox` | `check` | `#8b5cf6` (purple) | Check / Uncheck |
| Radio | `radio` | `radio` | `#ec4899` (pink) | Select |

### 5.2 Execution Action Types

Three new execution action verbs are required:

| Interaction | State | Execution Verb | `action.type` |
|---|---|---|---|
| Checkbox → Checked | `checked: true` | Check | `"check"` |
| Checkbox → Unchecked | `checked: false` | Uncheck | `"uncheck"` |
| Radio → Selected | — | Select | `"select"` |

### 5.3 Execution JSON Structure

Per the B5.2 contract, Checkbox and Radio interactions produce:

**Checkbox — Check:**
```json
{
  "action": {
    "type": "check",
    "value": null
  },
  "target": {
    "kind": "element",
    "tag": "INPUT",
    "role": "checkbox",
    "name": "Remember Me"
  },
  "locators": [
    { "strategy": "ariaLabel", "value": "Remember Me", "role": "primary" },
    { "strategy": "css", "value": "input#remember-me", "role": "secondary" }
  ],
  "context": { "iframe": false, "shadowDom": false, "frame": null },
  "trace": { "interactionId": "check-0001", "stepId": "step-0003" },
  "meta": { "status": "generated", "warnings": [], "generatedAt": "..." }
}
```

**Checkbox — Uncheck:**
```json
{
  "action": {
    "type": "uncheck",
    "value": null
  },
  "target": {
    "kind": "element",
    "tag": "INPUT",
    "role": "checkbox",
    "name": "Subscribe to Newsletter"
  },
  "locators": [
    { "strategy": "ariaLabel", "value": "Subscribe to Newsletter", "role": "primary" }
  ],
  "context": { "iframe": false, "shadowDom": false, "frame": null },
  "trace": { "interactionId": "check-0002", "stepId": "step-0005" },
  "meta": { "status": "generated", "warnings": [], "generatedAt": "..." }
}
```

**Radio — Select:**
```json
{
  "action": {
    "type": "select",
    "value": null
  },
  "target": {
    "kind": "element",
    "tag": "INPUT",
    "role": "radio",
    "name": "Express Delivery"
  },
  "locators": [
    { "strategy": "ariaLabel", "value": "Express Delivery", "role": "primary" }
  ],
  "context": { "iframe": false, "shadowDom": false, "frame": null },
  "trace": { "interactionId": "radio-0001", "stepId": "step-0004" },
  "meta": { "status": "generated", "warnings": [], "generatedAt": "..." }
}
```

This follows the exact same contract structure as click, text, and hover — only `action.type` differs.

### 5.4 Type-Specific Event Data

The Checkbox event carries a `checked` field indicating the **resulting state**:

```typescript
interface CheckboxEvent {
  actionId: string;       // "check-0001"
  type: 'checkbox';
  elementIdentity: ElementIdentity;
  checked: boolean;       // true = checked, false = unchecked (RESULTING state)
  timestamp: string;
}
```

The Radio event carries no extra field (selection is always "selected"):

```typescript
interface RadioEvent {
  actionId: string;       // "radio-0001"
  type: 'radio';
  elementIdentity: ElementIdentity;
  timestamp: string;
}
```

The `checked` field on CheckboxEvent is the **resulting state** — `true` means the user checked the box, `false` means they unchecked it. This drives the plain English ("Check" vs "Uncheck") and the execution verb (`check` vs `uncheck`).

### 5.5 Playwright Mapping

| Execution JSON Action | Playwright Statement |
|---|---|
| `action.type = "check"` | `await [locator].check();` |
| `action.type = "uncheck"` | `await [locator].uncheck();` |
| `action.type = "select"` | `await [locator].check();` |

Examples:
```typescript
// Step 1: Check "Remember Me"
await getByLabel('Remember Me').check();

// Step 2: Uncheck "Subscribe to Newsletter"
await getByLabel('Subscribe to Newsletter').uncheck();

// Step 3: Select "Express Delivery"
await getByLabel('Express Delivery').check();
```

Note: Playwright uses `.check()` for both checkbox-checking and radio-selection because both set `checked=true` on an `<input>`. The distinction is in the plain English step description, not the Playwright method. The Playwright Generator's `translateAction()` function gains two new cases (plus reuses existing logic for radio):

```typescript
case 'check':
  return `${selector}.check();`;
case 'uncheck':
  return `${selector}.uncheck();`;
case 'select':
  return `${selector}.check();`;   // Radio buttons use .check() in Playwright
```

### 5.6 Locator Resolution

Checkbox and Radio use the same Locator Resolution Engine (B4.4) as all other interactions. No changes to the priority hierarchy:

```
testId → dataCy → dataQa → ariaLabel → id → name → text → css → xpath
```

An important consideration: checkbox/radio `<label>` associations are the primary accessible name source. The recorder should resolve the associated label text (via `<label for="id">`, `aria-label`, `aria-labelledby`, or wrapping `<label>`) as the element's accessible name — exactly as the existing `computeAccessibleName()` function does.

### 5.7 Pipeline Integration Confirmation

| Pipeline Stage | Impact of Checkbox/Radio |
|---|---|
| Interaction Timeline | Two new event types: `checkbox` (with `checked` field) and `radio`. Same event structure (actionId, type, timestamp, elementIdentity). |
| Canonical Step Generator | Two new interaction type configs registered. `toPlainEnglish()` produces `Check "[name]"`, `Uncheck "[name]"`, or `Select "[name]"`. |
| Readability Optimizer | No change — no new rule applies to checkbox/radio steps (OR-4 deferred per §4.4). |
| Execution JSON Generator | `mapActionType()` extended: checkbox+checked=true → `"check"`, checkbox+checked=false → `"uncheck"`, radio → `"select"`. |
| Playwright Generator | `translateAction()` extended: `"check"` → `.check()`, `"uncheck"` → `.uncheck()`, `"select"` → `.check()`. |

**No new pipeline stage. No new artifact. No architectural change.** Checkbox/Radio follows the exact same pipeline as click, text, and hover. The Milestone 2 architecture principle applies: "Only detection logic changes per interaction type; pipeline is identical."

### 5.8 Architecture Touchpoints for C4.2

The following implementation-specific changes are required (not part of this product strategy, noted here for completeness):

1. **`interaction-types.ts`** — Two new `InteractionTypeConfig` registrations (checkbox, radio). Checkbox config's `toPlainEnglish()` must inspect the `checked` extra to produce "Check" or "Uncheck".

2. **`shared/types.ts`** — Add `CheckboxEvent` and `RadioEvent` interfaces. Add to `SessionEvent` union. Add `CHECKBOX_CAPTURED` and `RADIO_CAPTURED` to `AppMessage` union and `isAppMessage()` valid types.

3. **New content script** — `checkbox-radio-content-script.ts` (or two separate scripts). Listens for `change` events on checkbox/radio inputs, resolves identity, captures resulting state, sends message.

4. **`service-worker.ts`** — Two new message handlers (`CHECKBOX_CAPTURED`, `RADIO_CAPTURED`) calling existing `processAction()`.

5. **`execution-json-generator.ts`** — `mapActionType()` extension: checkbox needs state-aware mapping (check vs uncheck based on `checked` field). This is a slight extension of the current single-string-in → single-string-out pattern — the generator may need to inspect `step.value` or a new `step.checked` field.

6. **`playwright-generator.ts`** — Three new cases in `translateAction()`: `check`, `uncheck`, `select`.

7. **`manifest.json`** — Register the new content script(s).

8. **`readability-optimizer.ts`** — No change required (OR-4 deferred).

---

## 6. Interaction Boundaries

### 6.1 Checkbox/Radio vs. Other Interactions

| Sequence | How It Works |
|---|---|
| **Check → Click** | Check is recorded (state changed). Click is recorded on the next element. Both are separate steps. Example: Check "Remember Me" → Click "Login". |
| **Check → Navigation** | Check is recorded. Navigation is recorded when page changes. Both are separate steps. Example: Check "Accept Terms" → page navigates to dashboard. |
| **Check → Text Entry** | Check is recorded. Text entry is recorded when user types and blurs. Both are separate steps. Example: Check "Custom Amount" → type "500" in the amount field. |
| **Select (Radio) → Select (Radio)** | Each selection is a separate step if the radio group changed. Example: Select "Standard" → Select "Express" (user changed their mind). Both recorded. |
| **Check → Uncheck (same element)** | Both recorded. See §4.4 for optional future OR-4 merge rule (deferred). |
| **Hover → Check** | Hover is recorded if it passed C3.1 gates. Check is recorded when state changes. Both are separate steps. Example: Hover "Advanced Settings" → Check "Enable Debug Mode". |

### 6.2 Ownership Model

Following Milestone 2's ownership principle (`data-cmdrunner-handled`), Checkbox/Radio respects the same ownership:

1. **Click does NOT claim checkbox/radio elements.** The click content script listens for click events on all interactive elements, including `input[type=checkbox]` and `input[type=radio]`. However, when a checkbox/radio state change is detected, the checkbox/radio content script should claim ownership to prevent the click content script from also recording a generic click.

2. **Priority: checkbox/radio > click.** When a user interacts with a checkbox or radio, the state-based interaction takes precedence over the generic click. The `data-cmdrunner-handled` attribute is set by the checkbox/radio content script after recording, preventing duplicate click recording.

3. **Checkbox/radio and text entry do not conflict.** Text entry's blur-based capture is on text input elements. Checkbox/radio targets are toggle/select controls. There is no overlap.

4. **Checkbox/radio and hover do not conflict.** Hover targets are containers, menu items, icons. Checkbox/radio targets are form controls. No overlap.

### 6.3 Checkbox/Radio Remains Independent

Checkbox and Radio are always **independent interactions** — they are never merged into compound interactions (OR-4 deferred). Each meaningful state change produces one Canonical Test Step. This is because:

1. Each state change is a **deliberate user action** with a specific intent (check, uncheck, or select).
2. The state change is **execution-necessary** — without it, the Playwright test would not reproduce the form state.
3. No existing readability rule applies to checkbox/radio (§4.4).

### 6.4 Relationship to Click — The Specialization Rule

Checkbox and Radio are **specialized interactions derived from click**. A user physically clicks a checkbox or radio button, but the recorded interaction is NOT a click — it is a state-based action. This specialization follows the same principle as text entry: a user physically clicks an input field and types, but the recorded interaction is "Text Entry," not "Click + Keystrokes."

| Physical Action | Click Content Script | Checkbox/Radio Content Script | Recorded As |
|---|---|---|---|
| Click checkbox (state changes) | Detects click on INPUT | Detects change event, claims ownership | **Check/Uncheck** (not Click) |
| Click checkbox (no state change) | Detects click on INPUT | No change event fires | **Nothing** (no state change) |
| Click radio (state changes) | Detects click on INPUT | Detects change event, claims ownership | **Select** (not Click) |
| Click radio (already selected) | Detects click on INPUT | No change event fires | **Nothing** (no state change) |

The ownership model ensures that when both content scripts detect activity on the same element, only the state-based interaction is recorded.

---

## 7. Validation Strategy

### 7.1 Validation Scenarios

Using the B8 Validation Framework's workflow categories:

| Scenario | B8 Category | Expected Behavior |
|---|---|---|
| **Check a checkbox** | W4 Form Entry | Check "Remember Me" (unchecked → checked). One step: Check. |
| **Uncheck a checkbox** | W4 Form Entry | Uncheck "Subscribe" (checked → unchecked). One step: Uncheck. |
| **Select a radio** | W4 Form Entry | Select "Express Delivery". One step: Select. |
| **Click already-checked checkbox** | W4 Form Entry | No step recorded — no state change. |
| **Click already-selected radio** | W4 Form Entry | No step recorded — no state change. |
| **Disabled checkbox click** | W4 Form Entry | No step recorded — control not interactive. |
| **Read-only radio click** | W4 Form Entry | No step recorded — control not interactive. |
| **Multiple checkboxes in a form** | W4 Form Entry | Each state change is a separate step. Example: Check "Option A" → Check "Option B" → Uncheck "Option A". Three steps. |
| **Radio group exploration** | W4 Form Entry | Select "Standard" → Select "Express". Two steps — user changed their mind. |
| **Checkbox → Navigation** | W12 Navigation | Check "Accept Terms" → page navigates. Two steps: Check + Navigate. |
| **Checkbox → Validation message** | W4 Form Entry | Uncheck "Required Consent" → validation error appears. One step: Uncheck. (Validation is not separately recorded — it's an application response.) |
| **Radio → Dynamic form update** | W4 Form Entry | Select "Business Account" → additional fields appear. One step: Select. (Form update is an application response.) |
| **Custom ARIA checkbox** | W4 Form Entry | Toggle `div[role="checkbox"][aria-checked]`. State change detected via aria-checked transition. One step: Check/Uncheck. |
| **Keyboard toggle (Space)** | W4 Form Entry | Focus checkbox → press Space. State changes. One step: Check/Uncheck. (Input method irrelevant — state-based model.) |
| **Checkbox in Shadow DOM** | W4 Form Entry | Checkbox inside custom web component. State change detected via composedPath. One step: Check/Uncheck. |
| **Required field validation** | W4 Form Entry | Submit form without checking required checkbox → validation error. The checkbox was never interacted with → no step. |

### 7.2 Pass Criteria

| Check | Pass When |
|---|---|
| **State change captured** | Meaningful check/uncheck/select appears in Timeline and Canonical Steps |
| **No-op excluded** | Clicks that don't change state do NOT appear |
| **Correct verb** | Unchecked→checked shows "Check", checked→unchecked shows "Uncheck", radio shows "Select" |
| **Element identity complete** | Event has full ElementIdentity (tag, accessibleName via label, cssSelector, etc.) |
| **Execution JSON valid** | `action.type = "check"/"uncheck"/"select"`, locators follow B4.4 priority |
| **Playwright correct** | `.check()` for check/select, `.uncheck()` for uncheck. No `.click()` for checkbox/radio interactions. |
| **No click interference** | Click events on non-checkbox/radio elements are captured normally |
| **Disabled/read-only excluded** | Interactions with disabled or read-only controls are not recorded |

### 7.3 Common Failure Cases

| Failure | Likely Root Cause | Defect Code |
|---|---|---|
| Checkbox step missing from Timeline | Change event not captured, or ownership conflict with click content script | REC |
| Both Click and Check recorded for same action | Ownership model failed — click content script didn't check `data-cmdrunner-handled` | REC |
| Check shows as Uncheck (or vice versa) | Pre-state capture failed — recorder read wrong state | REC |
| No-op clicks recorded as interactions | Gate 4 (state change) failed — not comparing pre/post state | REC |
| Playwright `.click()` instead of `.check()` | Playwright Generator doesn't map `check`/`uncheck`/`select` action types | PWG |
| Disabled checkbox click recorded | Gate 5 (enabled check) failed | REC |
| Custom ARIA checkbox not detected | Gate 3 (control type) doesn't recognize `role="checkbox"` | REC |

### 7.4 Regression Scenarios

| Regression Check | What to Verify |
|---|---|
| **Existing click recording** | Checkbox/radio content script does not interfere with click-content-script's event listeners on non-checkbox/radio elements |
| **Existing text entry recording** | Checkbox/radio content script does not interfere with text-entry-content-script's blur handler |
| **Existing hover recording** | Checkbox/radio content script does not interfere with hover-content-script's mouseenter/mouseleave handlers |
| **Existing OR-1 optimization** | Readability Optimizer behavior unchanged for click+text pairs |
| **Existing pipeline** | Execution JSON and Playwright generation for existing click/text/hover/navigation steps unchanged |

### 7.5 Evidence Required

Per B8 §6, plus checkbox/radio-specific evidence:
- **Before/after state** showing the `checked` property before and after the interaction (confirms genuine state transition)
- **Element identity** showing the label text resolved as accessible name
- **Disabled/read-only attribute** showing the control was interactive at interaction time

### 7.6 Future Interaction Method Compatibility

The state-based model is designed to remain compatible with future interaction methods:

| Method | Example | Product Model |
|---|---|---|
| Mouse click | Click checkbox | State change detected → Record "Check"/"Uncheck" |
| Keyboard | Space on focused checkbox | State change detected → Record "Check"/"Uncheck" |
| Touch | Tap checkbox on mobile | State change detected → Record "Check"/"Uncheck" |
| Assistive technology | Screen reader toggle | State change detected → Record "Check"/"Uncheck" |
| Programmatic | `el.checked = true` | NOT recorded (Gate 1 — not genuine user action) |

The product rules do not change regardless of input method. Only the detection mechanism adapts. This ensures the product model remains stable as new interaction methods emerge.

---

## 8. Product Principles

### CP1: Record User Intent, Not Raw Clicks

The recorder captures state transitions, not click events. A checkbox interaction records "Check 'Remember Me'" — the user's intent to enable that option — not "Click on the checkbox element." A click on a checkbox that doesn't change state is noise.

### CP2: Record Only Meaningful State Changes

The product rule requires an actual state transition — clicks that do not change the state are excluded by definition. This is a consequence of the state-based product model, not of any specific detection mechanism. No threshold tuning, no timing sensitivity, no heuristics. Either the state changed or it didn't.

### CP3: Preserve Deterministic Execution

Checkbox/radio recording must be deterministic: the same user actions produce the same recorded interactions. The detection criteria (genuine event + actual state change) are binary and structural — not based on timing or heuristic guessing.

### CP4: Preserve Execution Semantics

State-based steps in the Execution JSON and Playwright output must use semantically correct methods. `.check()` and `.uncheck()` are idempotent — they guarantee the target state regardless of the element's current state. This is more robust than `.click()`, which toggles and can produce the wrong result if the element's initial state differs.

### CP5: Framework-Agnostic

Checkbox/radio recording must work across React, Vue, Angular, and plain HTML. Native HTML controls and custom ARIA controls all expose standard accessibility semantics (`role`, `aria-checked`, `checked` property) regardless of framework. The product requirement is that the recorder detects the state transition; which deterministic evidence source it uses to satisfy this requirement is an implementation detail.

### CP6: Clean Integration with Existing Architecture

Checkbox/radio follows the same content script pattern as click, text entry, and hover. Same ownership model. Same identity extraction. Same interaction type registration. Same pipeline. No new architectural patterns.

### CP7: No Regression to Existing Pipeline

Checkbox/radio content script must not interfere with click, text entry, or hover recording. The content scripts operate independently — each listens for its own event types and respects the `data-cmdrunner-handled` ownership flag.

### CP8: State-Based, Not Input-Based

The product model records the resulting state, not the input method. "Check 'Remember Me'" describes what the user achieved, not how they achieved it. This ensures the model remains valid as interaction methods evolve.

---

## 9. Known Assumptions

| # | Assumption | Risk | Mitigation |
|---|---|---|---|
| A1 | **(Implementation)** The `change` event reliably fires on all native checkbox/radio state changes across browsers | Low — `change` is a well-established DOM event | Standard browser behavior. If edge cases are found, pre/post state comparison can supplement. |
| A2 | **(Implementation)** ARIA custom controls (`role="checkbox"`, `role="radio"`) can be detected via `aria-checked` attribute transitions | Medium — applications may use non-standard state management | Fallback to pre/post state comparison or click + post-state read. Product rule ("actual state transition") remains stable. |
| A3 | The click content script can be prevented from recording checkbox/radio clicks via the ownership model | Low — `data-cmdrunner-handled` is already established | Content scripts operate in the same isolated world. Ownership flag is reliable. |
| A4 | Label text is available as the accessible name for checkbox/radio elements | Low — standard accessibility pattern | `computeAccessibleName()` already resolves labels via `<label for>`, `aria-label`, `aria-labelledby`, wrapping `<label>`. Falls back to value/name attributes. |
| A5 | Users will not be confused by Check/Uncheck/Select steps | Low — state-based verbs are more intuitive than generic "Click" | Steps are clearly labeled. Users can edit/delete during review. |
| A6 | Radio button deselection (selecting a different radio in the same group) should not be separately recorded | Low — radio semantics guarantee exclusivity | Only the user's selection is recorded. Implicit deselection is not noise — it's a side effect. |

---

## 10. Potential Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Ownership conflict with click content script.** Both scripts may detect activity on the same checkbox/radio element. | High | Checkbox/radio content script sets `data-cmdrunner-handled` after recording. Click content script checks this attribute (Gate 2). Priority: state-based > click. |
| R2 | **Custom ARIA checkbox/radio not detected.** Frameworks may implement toggle controls with `role="checkbox"` but without standard `change` events. | Medium | Detect `aria-checked` attribute transitions as an alternative signal. Product rule remains "actual state transition" regardless of detection mechanism. |
| R3 | **Rapid toggle noise.** User rapidly checks/unchecks a checkbox multiple times. | Low | Each toggle is a genuine state change — all are recorded. OR-4 readability rule (deferred) could collapse opposite pairs in a future milestone. |
| R4 | **Checkbox/radio inside Shadow DOM.** Change events may not propagate to document level. | Medium | Use `composedPath()` on the event (same approach as click-content-script). If event is composed, it crosses shadow boundaries. |
| R5 | **Dynamically created checkbox/radio controls.** SPA route changes may load new form controls after page load. | Low | Content script runs in the page context and uses event delegation (listening on document, not individual elements). Dynamic controls are captured as they appear. |
| R6 | **`mapActionType` extension for checkbox.** The current `mapActionType()` takes a single string and returns a single string. Checkbox needs state-aware mapping (check vs uncheck). | Low | The execution JSON generator already has per-step context (`step.value`). Extend the mapping to inspect the `checked` field for checkbox steps. This is an implementation detail — the product requirement is that check and uncheck produce distinct execution verbs. |

---

## 11. Consistency Review Against Frozen Milestones

### 11.1 Product Foundation

| Frozen Decision | Checkbox/Radio Strategy | Consistent? |
|---|---|---|
| Canonical Test Steps have plain English, action type, locator | Checkbox step: `Check "Remember Me"` with actionType `checkbox`. Radio step: `Select "Express"` with actionType `radio`. | ✅ |
| Pipeline: Timeline → Steps → JSON → Playwright | Checkbox/Radio flows through existing pipeline unchanged | ✅ |
| Plain English is editable | User can edit/delete checkbox/radio steps during review | ✅ |

### 11.2 Product Architecture

| Frozen Decision | Checkbox/Radio Strategy | Consistent? |
|---|---|---|
| Single editable surface (Canonical Test Steps) | Checkbox/Radio steps are part of the same surface | ✅ |
| No new artifacts | No new artifact — checkbox/radio are new interaction types, not new pipeline stages | ✅ |

### 11.3 Milestone 1 (Click Product Spec)

| Frozen Decision | Checkbox/Radio Strategy | Consistent? |
|---|---|---|
| Click is the canonical interaction template | Checkbox/Radio follows the same product model: definition, intent, recording rules, decision tree | ✅ |
| "Does this interaction matter to the test flow?" | Checkbox/Radio matters only when the state actually changes | ✅ |

### 11.4 Milestone 2 (Click Architecture)

| Frozen Decision | Checkbox/Radio Strategy | Consistent? |
|---|---|---|
| Principle 4: "Only detection logic changes per interaction type; pipeline is identical" | Checkbox/Radio has its own content script + detection logic; pipeline is identical | ✅ |
| Principle 8: "Confident classification or nothing" | Checkbox/Radio's 5-gate decision tree enforces confident classification (genuine + actual state change) | ✅ |
| Principle 9: "Single responsibility" | Checkbox answers only "Did the checkbox state change?" — it does not infer click, navigation, or form submission | ✅ |
| `data-cmdrunner-handled` ownership model | Checkbox/Radio respects ownership (Gate 2) and claims ownership after recording (priority over click) | ✅ |

### 11.5 B1–B6 (Generation Pipeline)

| Frozen Decision | Checkbox/Radio Strategy | Consistent? |
|---|---|---|
| B2 AP3: Pure function generators | Checkbox/Radio interaction type configs are pure functions (same as click/text/hover configs) | ✅ |
| B4.4: Locator Priority Strategy | Checkbox/Radio uses same locator resolution — no change to priority | ✅ |
| B5.2: Execution JSON Contract | Checkbox/Radio adds `action.type: "check"/"uncheck"/"select"` — same contract structure, new enum values | ✅ |
| B6: Playwright Generator | Checkbox/Radio adds `.check()`, `.uncheck()` mappings — same generator, new action cases | ✅ |

### 11.6 B7.1–B7.2 (Readability Optimizer)

| Frozen Decision | Checkbox/Radio Strategy | Consistent? |
|---|---|---|
| OR-1: Focus-click + text-entry merge | Does not apply to checkbox/radio (different interaction types) | ✅ |
| Step IDs preserved | Checkbox/Radio steps get their own stepIds from StepIdGenerator | ✅ |
| Optimizer is internal to Canonical Step Generator | Checkbox/Radio steps pass through optimizer unchanged (OR-4 deferred) | ✅ |

### 11.7 B8 (Validation Framework)

| Frozen Decision | Checkbox/Radio Strategy | Consistent? |
|---|---|---|
| Capability Status: Checkbox/Radio not yet in scope | After C4 implementation, transitions to "Supported" | ✅ |
| Regression suite must pass for Supported capabilities | Checkbox/Radio validation scenarios added to regression suite after implementation | ✅ |
| Defect classification applies | Checkbox/Radio-specific defects classified as REC (recording), PWG (Playwright), etc. | ✅ |

### 11.8 C3.1–C3.3 (Hover — FROZEN)

| Frozen Decision | Checkbox/Radio Strategy | Consistent? |
|---|---|---|
| C3.1: 6-Gate hover architecture | Checkbox/Radio has its own 5-gate decision tree — does not modify hover gates | ✅ |
| C3.2: Hover content script | Checkbox/Radio content script is separate — does not interfere with hover listeners | ✅ |
| C3.3: Visibility transition detection | No interaction with hover detection mechanisms | ✅ |
| C3.1 §3.5: Debounce and noise suppression | Checkbox/Radio has inherent noise suppression via the state-based product model (actual state transition required) — no debounce needed | ✅ |

### 11.9 Interaction Type Coexistence

| Interaction Type | Overlap with Checkbox/Radio? | Resolution |
|---|---|---|
| Click | **Yes** — user physically clicks checkbox/radio | Ownership: checkbox/radio claims element, click discarded |
| Text Entry | No — text targets text inputs, checkbox/radio targets toggle controls | No conflict |
| Hover | No — hover targets containers/menus, checkbox/radio targets form controls | No conflict |
| Navigation | No — navigation is page-level, checkbox/radio is element-level | No conflict |

**No conflicts found.** Checkbox/Radio recording is fully compatible with every frozen milestone. No architectural changes required.

---

## 12. Next Milestone Directive — C4.2 Implementation

C4.2 is an **implementation milestone only**. Its scope is strictly limited to:

1. Implementing the Checkbox/Radio content script according to the frozen 5-gate decision tree (§3.1).
2. Using deterministic browser evidence to detect state transitions — native browser events, checked state transitions, accessibility state observation, or other deterministic mechanisms, per the Product Stability Notes in §3.1–§3.3.
3. Registering the `checkbox` and `radio` interaction types in the existing pipeline (Canonical Step Generator → Execution JSON Generator → Playwright Generator).
4. Implementing the ownership model so checkbox/radio takes priority over click on the same element.
5. Validating the implementation using the B8 Validation Framework.

C4.2 must NOT:
- Revisit product strategy or Checkbox/Radio behavior design.
- Modify any previously frozen product or architecture decision.
- Introduce new product rules or architectural principles.
- Redesign the 5-gate decision tree or the product principles.
- Implement the OR-4 readability rule (deferred).

If a genuine conflict is discovered during implementation, it must be formally documented with evidence and presented for review before any change to this frozen strategy is made.

---

## Freeze Declaration

This document defines the **Checkbox & Radio Button Product Strategy** and is the authoritative product design for Milestone C4. Upon review and approval, it will be **PERMANENTLY FROZEN**.

**Modification Policy:** This strategy shall not be modified unless a genuine architectural conflict or functional defect is discovered during implementation or validation. If such a conflict is found, it must be formally documented with evidence and an impact analysis before any change is made.

**Implementation Independence:** Implementation decisions may evolve where explicitly identified as implementation details (detection mechanism specifics, evidence sources, pre-state capture approach). The frozen product rules and architectural principles must remain unchanged.

### Product Rule Stability

The product rules are implementation-independent:

1. **State-Based, Not Click-Based** — The product rule is that checkbox/radio interactions represent the user's intended state, not the physical click. The product behavior is "Check 'Remember Me'", "Uncheck 'Receive Notifications'", "Select 'Credit Card'" — these are product behaviors that describe the resulting state. How the recorder detects state changes is an implementation detail.

2. **Meaningful State Changes Only** — The product requirement is that an interaction should be recorded only when the user intentionally changes the control's state. No-op clicks, disabled controls, and programmatic changes are excluded. How the recorder determines that a genuine state transition occurred — native browser events, checked-state transitions, accessibility state observation, pre/post state comparisons, or other deterministic evidence — is an implementation detail that may evolve without changing the product rule.

3. **Evidence Mechanism Independence** — The product rule does not require a specific browser event. The product requirement is "the user intentionally changed the control's state." Current implementations may use native browser events (`change`), accessibility state observation (`aria-checked`), checked-state comparisons, or other deterministic browser mechanisms. Future implementations may incorporate additional deterministic evidence sources without changing the product behavior.

4. **Ownership Priority** — The product rule is that state-based interactions take precedence over generic clicks on the same element. How the ownership model implements this priority is an implementation detail.

These distinctions ensure that the product rules remain stable even as detection mechanisms and evidence sources evolve.

---

## Permanent Regression Coverage

The following scenarios must become part of the permanent regression suite once C4.2 implementation is complete. These scenarios must not be removed in future milestones:

| Scenario | Description | Product Rule Verified |
|---|---|---|
| **Check operation recorded** | Unchecked checkbox → user toggles → `Check "[name]"` in Timeline + Canonical Steps + Execution JSON (`action.type: "check"`) + Playwright (`.check()`) | State-Based (Rule 1) |
| **Uncheck operation recorded** | Checked checkbox → user toggles → `Uncheck "[name]"` in Timeline + Canonical Steps + Execution JSON (`action.type: "uncheck"`) + Playwright (`.uncheck()`) | State-Based (Rule 1) |
| **Radio selection recorded** | Unselected radio → user selects → `Select "[name]"` in Timeline + Canonical Steps + Execution JSON (`action.type: "select"`) + Playwright (`.check()`) | State-Based (Rule 1) |
| **No-op checkbox click ignored** | Already-checked checkbox → user clicks → nothing recorded | Meaningful Changes Only (Rule 2) |
| **No-op radio click ignored** | Already-selected radio → user clicks → nothing recorded | Meaningful Changes Only (Rule 2) |
| **Disabled control ignored** | `disabled` checkbox/radio → user clicks → nothing recorded | Meaningful Changes Only (Rule 2) |
| **Read-only control ignored** | `readonly` radio → user clicks → nothing recorded | Meaningful Changes Only (Rule 2) |
| **Existing click recording unaffected** | Non-checkbox/radio elements record as clicks normally | No Regression (Rule / CP7) |
| **Existing hover recording unaffected** | Hover interactions on menus/containers work normally | No Regression (Rule / CP7) |
| **Existing text entry unaffected** | Text input blur-based capture works normally | No Regression (Rule / CP7) |
| **Existing navigation unaffected** | Page navigation events captured normally | No Regression (Rule / CP7) |

---

## Freeze Declaration

**Milestone C4.1 is PERMANENTLY FROZEN as of 2026-07-16T04:08:00Z.**

### Frozen Product Rules

The following product principles are permanent and implementation-independent:

1. **State transitions, not physical clicks.** Checkbox and Radio Button interactions represent the user's intended state — Check, Uncheck, Select — not the input device event that achieved it.

2. **Only meaningful user-initiated state changes are recorded.** No-op clicks (already checked/selected), disabled controls, read-only controls, and programmatic changes are excluded.

3. **Product model is independent of detection mechanism.** The product rule does not require a specific browser event. Native browser events, checked-state transitions, accessibility state observation, pre/post state comparisons, and other deterministic evidence sources are all valid implementation mechanisms that may evolve without changing the product rule.

4. **Detection mechanisms are implementation details.** How the recorder determines that a genuine state transition occurred may change across versions. The product requirement ("the user intentionally changed the control's state") remains stable.

5. **Execution model preserves semantic actions.** The execution verbs `check`, `uncheck`, and `select` are permanent. They map to deterministic Playwright methods (`.check()`, `.uncheck()`) that guarantee target state regardless of initial state.

### Modification Policy

This strategy shall not be modified unless a genuine architectural conflict or functional defect is discovered during implementation (C4.2) or validation. If such a conflict is found, it must be formally documented with evidence and an impact analysis before any change to this frozen strategy is made.

### Implementation Independence

All detection mechanisms, evidence sources, and browser API references in this document are implementation details. They are documented for guidance and may evolve. The frozen product rules and architectural principles must remain unchanged.

---

*End of Milestone C4.1 — Checkbox & Radio Button Product Strategy*
