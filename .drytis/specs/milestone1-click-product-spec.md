# Milestone 1 — Click Interaction Product Specification

**Status:** DESIGN ONLY — awaiting approval before any architecture or implementation.

---

## 1. What Is a Click?

### Product Definition

A Click is the act of a user pressing and releasing a pointer (mouse, trackpad, or equivalent) on a specific element on the page, with the intent of **triggering an action or making a selection**.

### What It Represents

A Click represents the most fundamental unit of user intent in a web application. It is the moment the user says:

> "Do this."

Whether "this" is submitting a form, opening a menu, selecting a tab, confirming a dialog, or navigating to a new page — the Click is the trigger.

### Why It Exists

Every interactive web application is built on the paradigm of "the user points at something and activates it." The Click is the recording of that activation.

Without Click, there is no interaction engine. Every other interaction either:
- **Is** a Click (buttons, links, cards, icons).
- **Starts with** a Click (opening a dropdown, expanding an accordion).
- **Is an alternative to** a Click (keyboard activation, touch gestures — future scope).

Click is the foundation interaction. It is the default owner of every pointer activation — yielding to a specialized interaction only when that interaction has clear, unambiguous evidence that it better represents the user's intent.

### What User Intent It Captures

A Click captures the intent to **activate**. The user looked at the page, identified a target, and deliberately chose to interact with it. The target, the context, and the result of that activation are all part of what the Click records.

---

## 2. Why Would a Tester Write a Click Step?

### The Tester's Perspective

An experienced manual tester writes a Click step because the action the user takes at that point in the test flow **matters**. If the click were omitted, the test would fail or the flow would break.

A tester writes:

```
1. Click "Login"
```

Because without that click, the login form is never submitted and the rest of the test cannot proceed.

### What Outcome They Expect

The tester expects the Click step to capture:

| Aspect | Example |
|--------|---------|
| **What was clicked** | The "Login" button |
| **Why it was clicked** | To submit credentials and authenticate |
| **Where it is** | On the sign-in page, in the form area |
| **What it does** | Submits the form, triggers authentication |

### When a Tester Would NOT Write a Click

A tester omits a Click when the action is **incidental** — it's not part of the test flow:

- Clicking to focus a field before typing (the typing is the step, not the focus click).
- Clicking away from a dropdown to close it (the selection was the step, not the dismissal).
- Clicking on whitespace or non-interactive areas (no intent).

This distinction — **does this click matter to the test flow?** — is the core product rule for Click recording.

---

## 3. When Should Click Be Recorded?

Click should be recorded whenever the user deliberately activates an interactive element and that activation is a meaningful part of their test flow.

### Situations Where Click Is Correct

#### Buttons
```
✅ Click "Save"
✅ Click "Submit"
✅ Click "Delete"
✅ Click "Cancel"
✅ Click "Add New"
```
The user intends to execute an action.

#### Links
```
✅ Click "View Details"
✅ Click "Products"
✅ Click "Privacy Policy"
```
The user intends to navigate or view content.

#### Icon Buttons
```
✅ Click the search icon
✅ Click the close (×) button
✅ Click the hamburger menu
✅ Click the notification bell
```
The user intends to activate a control represented by an icon.

#### Images That Are Interactive
```
✅ Click the product image (opens product page)
✅ Click the user avatar (opens profile)
✅ Click the company logo (goes to home page)
```
The user intends to interact with an image that functions as a button or link.

#### Cards
```
✅ Click the "Premium Plan" card
✅ Click a search result card
✅ Click a dashboard widget
```
The user intends to select or open something represented as a card.

#### Menu Items
```
✅ Click "Edit" in the context menu
✅ Click "Export" in the file menu
✅ Click "Settings" in the user dropdown
```
The user intends to choose an option from a menu.

#### Checkboxes (Native)
```
✅ Click "Remember me"
```
Unless a specialized Checkbox interaction claims it (see Section 4), a click on a checkbox is valid as a Click.

#### Radio Buttons (Native)
```
✅ Click "Express Shipping"
```
Unless a specialized Radio interaction claims it.

#### Toolbar Buttons
```
✅ Click "Bold" in the editor toolbar
✅ Click "Insert Image" in the toolbar
```
The user intends to use a tool.

#### Expand/Collapse Controls
```
✅ Click the accordion header
✅ Click the expand (+) button on a tree node
```
Unless a specialized interaction claims these, Click is correct.

#### Tab Selection
```
✅ Click the "Orders" tab
```
Unless a specialized Tabs interaction claims it.

---

## 4. When Should Click NOT Be Recorded?

Click should yield ownership when another interaction type **better represents** what the user intended. The rule is:

> **If the user's intent is better described by a more specific action than "click," then Click is the wrong interaction.**

However — and this is critical — Click should only yield when the specialized interaction is **unambiguous**. If there is doubt, Click owns the interaction. False positives (wrongly classifying as specialized) are worse than false negatives (recording as Click when it could have been specialized).

### Situations Where Click Should Yield

| User Action | Better Interaction | Why |
|-------------|-------------------|-----|
| Select an option from a dropdown | **Dropdown (Select)** | "Select 'USA' from the Country dropdown" is more precise than "Click 'USA'" |
| Check/uncheck a checkbox | **Checkbox** | "Check 'Remember me'" describes the intent, not the mechanism |
| Select a radio option | **Radio** | "Select 'Express Shipping'" describes the choice |
| Toggle a switch | **Toggle** | "Turn on 'Email Notifications'" describes the state change |
| Pick a date from a calendar | **Date Picker** | "Select date 'March 15, 2026'" is more precise |
| Enter text in a field | **Text Entry** | "Type 'john@example.com' in the Email field" is not a click |
| Pick files to upload | **File Upload** | "Upload 'report.pdf'" describes the upload, not the click |
| Hover to reveal a menu | **Hover** | The intent was to hover, not to click (if no click occurred) |

### The Yielding Principle

Click is the **default owner**. It owns every pointer activation unless:

1. A specialized interaction explicitly claims the event, AND
2. The specialized interaction correctly describes what the user intended.

If either condition is false, Click retains ownership.

### What About Clicks That Don't Do Anything?

A click on a non-interactive element (blank space, a paragraph, a decorative image) should **not** be recorded. The user did not intend to interact with anything.

This is different from a click on a disabled element — see Edge Cases (Section 9).

---

## 5. User Intent

### Can Different Intents All Be Clicks?

**Yes.** A Click is defined by the **mechanism** (the user activated something by pointing and clicking), not by the **outcome**. The outcome determines the *description*, not the *interaction type*.

### Categories of Click Intent

| Intent | Example | Plain English |
|--------|---------|---------------|
| **Execute an action** | Click "Save" | Click "Save" |
| **Navigate** | Click "Products" link | Click "Products" |
| **Open something** | Click a notification | Click the notification |
| **Close something** | Click the × button | Click "Close" |
| **Select** | Click a card to select it | Click the "Premium Plan" card |
| **Confirm** | Click "OK" in a dialog | Click "OK" |
| **Expand/Reveal** | Click "Show More" | Click "Show More" |

### Should These Be Different Interaction Types?

**No.** They are all Clicks.

The reason: from the *user's* perspective, they all performed the same physical action — they pointed at something and clicked it. The *result* differs, but the *interaction* is the same.

The variation in intent is captured in the **Plain English description** and the **AI understanding**, not in the interaction type. This keeps the interaction engine simple and the test case readable:

```
1. Click "Save"               ← execute an action
2. Click "Products"            ← navigate
3. Click the notification       ← open something
4. Click "Close"                ← close something
5. Click "Premium Plan"         ← select
6. Click "OK"                   ← confirm
```

All are Clicks. All follow the same pipeline. The descriptions make the intent clear.

### When Intent Changes the Interaction Type

Intent only changes the interaction type when the **mechanism itself is different**. The user didn't just click — they typed, they selected, they toggled, they dragged. These are fundamentally different physical/mental actions that deserve their own interaction types.

Click's scope: the user activated something by pointing and clicking. Period.

---

## 6. Plain English

### How Click Should Be Expressed

The primary format is:

> Click **"[element name]"**

Where `[element name]` is the element's accessible name, visible text, or best available description.

### Naming Priority

When generating the element name, CmdRunner should use the clearest identification available:

| Priority | Source | Example |
|----------|--------|---------|
| 1 | Visible button/link text | Click "Login" |
| 2 | aria-label | Click "Close menu" |
| 3 | aria-labelledby target text | Click "Shipping Address" |
| 4 | Label associated via `<label for>` | Click "Email Address" |
| 5 | Image alt text | Click the "Search" icon |
| 6 | Title attribute | Click the "Help" button |
| 7 | Descriptive fallback | Click the profile picture |

### Standard Formats

```
Click "Login"
Click "Save Changes"
Click "Add to Cart"
Click the notification bell
Click the user avatar
Click the "Premium Plan" card
Click "×" (close button)
```

### When Additional Context Should Be Included

Context should be added when the element name alone is **ambiguous** — when a tester reading the step would not know which element is meant.

#### Ambiguous: same name appears multiple times
```
❌ Click "Edit"
✅ Click "Edit" for "Order #1234"
✅ Click the "Edit" button in the "Billing Address" section
```

#### Clear: element is unique
```
✅ Click "Login"
✅ Click "Checkout"
```

#### Icons without text
```
✅ Click the search icon
✅ Click the close button (×)
✅ Click the hamburger menu
```

### What Plain English Should NOT Include

- ❌ DOM structure ("Click the button inside the third div")
- ❌ CSS selectors ("Click .btn-primary")
- ❌ Technical attributes ("Click [data-testid='submit']")
- ❌ Browser event names ("Click via mousedown event")

### AI-Enhanced Descriptions

When AI understanding is available, the Plain English can be enriched:

```
Without AI:  Click "Submit"
With AI:     Click "Submit" to send the application form
```

But the base format must always work without AI:

```
Click "Submit"
```

---

## 7. Execution JSON

### Minimum Product Requirements

The Execution JSON must contain enough information for the execution engine to **reliably locate and activate** the clicked element on a fresh page load.

### What Must Exist

| Field | Purpose | Example |
|-------|---------|---------|
| **Action** | What to do | `"click"` |
| **Element identification** | How to find the element | Name, role, locators (see below) |
| **Element context** | What kind of element it is | Tag, accessible name |
| **Frame context** | Whether it's in an iframe | In iframe? Which one? |
| **Shadow DOM** | Whether it's in Shadow DOM | Yes/No |

### Element Identification (Locator Hierarchy)

The execution JSON should provide multiple strategies for finding the element, in priority order:

| Priority | Strategy | Why |
|----------|----------|-----|
| 1 | Test ID (`data-testid`) | Explicitly placed for automation — most stable |
| 2 | Accessible name + role | "Find a button named 'Login'" — semantic, resilient |
| 3 | aria-label | Good for icon buttons |
| 4 | Element ID | Stable if not auto-generated |
| 5 | Visible text | "Find a link with text 'Products'" |
| 6 | Name attribute | Good for form controls |
| 7 | CSS selector | Structural fallback |
| 8 | XPath | Last resort |

### Why Multiple Strategies?

No single locator is universally reliable:
- `data-testid` is best but not always present.
- IDs may be auto-generated by frameworks.
- Text can change (internationalization, A/B tests).
- CSS selectors break when layouts change.

Providing multiple strategies lets the execution engine try the most resilient first and fall back as needed.

### What Execution JSON Should NOT Include

- ❌ Browser event details (mousedown coordinates, timing)
- ❌ DOM snapshots
- ❌ Screenshot data
- ❌ Internal recorder state

---

## 8. Real-World Examples

### SaaS — Project Management Tool

```
Test: Create a new project

1. Click "New Project"
2. (Text Entry steps for project name, description...)
3. Click "Create"
```

**Why Click is correct:** The user is activating buttons to create a project. Each click is a deliberate, meaningful action.

### Banking — Online Banking

```
Test: Transfer money between accounts

1. Click "Transfer"
2. Click "Between My Accounts"
3. (Form steps for amount, accounts...)
4. Click "Review Transfer"
5. Click "Confirm"
```

**Why Click is correct:** The user is navigating a multi-step wizard by clicking buttons. Each click advances the flow.

### E-Commerce — Online Shopping

```
Test: Add a product to cart

1. Click the "Wireless Headphones" product card
2. Click "Add to Cart"
3. Click the shopping cart icon
4. Click "Checkout"
```

**Why Click is correct:** Clicking the product card opens it. Clicking "Add to Cart" performs the action. Clicking the cart icon navigates. All are deliberate activations.

### Travel — Flight Booking

```
Test: Search for flights

1. Click "Round Trip"
2. (Date picker steps for departure and return dates...)
3. Click "Search Flights"
4. Click the "Select" button on the first result
```

**Why Click is correct:** Clicking "Round Trip" selects the trip type (could be Radio if specialized, but Click is valid). Clicking "Search" executes the search. Clicking "Select" chooses a flight.

### CRM — Customer Management

```
Test: Assign a lead to a sales rep

1. Click on the "John Smith" lead row
2. Click "Assign"
3. Click "Sarah Johnson" in the assign dropdown
4. Click "Confirm"
```

**Why Click is correct:** Clicking the row selects the lead. Clicking "Assign" opens the assignment. Clicking a name selects it. Clicking "Confirm" saves.

### ERP — Inventory Management

```
Test: Adjust stock quantity

1. Click the "Inventory" tab
2. Click "Edit" on the "Widget A" row
3. (Text Entry step for new quantity...)
4. Click "Save"
```

**Why Click is correct:** Tab navigation, edit activation, and save are all deliberate clicks.

### Admin Portal — User Management

```
Test: Deactivate a user

1. Click the user's row ("jane@example.com")
2. Click "Actions" dropdown
3. Click "Deactivate"
4. Click "Yes, Deactivate" (in confirmation dialog)
```

**Why Click is correct:** Each click is a deliberate step in the deactivation flow, including the confirmation dialog action.

---

## 9. Edge Cases

### Icon-Only Buttons

**Scenario:** A button with no text — only an SVG icon (e.g., a trash can, a gear, a magnifying glass).

**Expected behavior:** CmdRunner should identify the button (not the icon) and generate a meaningful name.

```
✅ Click the "Delete" button
✅ Click the search icon
✅ Click the settings (gear) icon
```

**Why:** The user clicked a button. The icon is decoration. The button is the interaction target.

### Images Inside Links

**Scenario:** An `<a>` tag containing an `<img>`.

**Expected behavior:** CmdRunner identifies the link (not the image) and uses the link's accessible name.

```
✅ Click the "Company Logo" link
✅ Click "Products" (link with image)
```

**Why:** The user intended to follow a link, not interact with an image.

### Nested Elements Inside Buttons

**Scenario:** A `<button>` containing spans, SVGs, and text.

```
<button>
  <svg class="icon"></svg>
  <span class="label">Save</span>
</button>
```

**Expected behavior:** CmdRunner identifies the button and uses "Save" as the name.

```
✅ Click "Save"
```

**Why:** The entire button is the interaction target. The nested elements are presentation.

### Cards

**Scenario:** A clickable card (e.g., a pricing plan, a search result).

**Expected behavior:** CmdRunner records a click on the card, identifying it by its title or primary content.

```
✅ Click the "Premium Plan" card
✅ Click the "Wireless Headphones" product card
```

**Why:** The user intended to open or select the card.

### Disabled Buttons

**Scenario:** A button with `disabled` attribute or `aria-disabled="true"`.

**Expected behavior:** CmdRunner should **not** record a click on a disabled element. The user cannot actually activate it.

```
❌ (disabled button click is not recorded)
```

**Why:** If the button is truly disabled, the browser won't fire a click event. But if a framework uses a CSS class or `aria-disabled` without the native `disabled` attribute, the click might fire. CmdRunner should detect the disabled state and skip the click.

**Exception:** If the user's test flow specifically requires testing disabled state, they would verify the button is disabled — but that's an assertion, not a click interaction. Out of scope for the Click specification.

### Hidden Controls

**Scenario:** An element with `display: none`, `visibility: hidden`, or `opacity: 0`.

**Expected behavior:** CmdRunner should **not** record clicks on hidden elements.

```
❌ (hidden element click is not recorded)
```

**Why:** The user cannot see or intentionally click a hidden element. If a click fires on a hidden element, it's likely programmatic — not a user action.

### Read-Only Elements

**Scenario:** A text input with `readonly` attribute.

**Expected behavior:** If the user clicks a read-only field, it's likely to read it or focus it. Click should be recorded if the click is meaningful.

```
✅ Click the "Order Number" field (read-only)
```

**Why:** The user deliberately clicked it. Even if they can't type, the click might be part of the flow (e.g., to copy the value). Don't suppress legitimate clicks.

### Dynamic Pages (Elements That Change)

**Scenario:** The element exists at click time but may be re-rendered by the framework (React, Angular, Vue) before the recording processes it.

**Expected behavior:** CmdRunner should capture the element's identity **at the moment of the click**, not after a delay.

**Why:** Virtual DOM frameworks may destroy and recreate the DOM node. If CmdRunner waits, the element may be gone. Capture immediately.

### Duplicate Elements

**Scenario:** Multiple buttons with the same text (e.g., multiple "Edit" buttons in a table).

**Expected behavior:** CmdRunner records the click but includes disambiguating context.

```
✅ Click "Edit" (row 3, "Order #1234")
✅ Click the "Edit" button in the "Shipping" section
```

**Why:** The tester needs to know *which* "Edit" button was clicked. Without context, the step is ambiguous and replay may fail.

### Double-Click

**Scenario:** The user rapidly clicks the same element twice.

**Expected behavior:** If the double-click has a different semantic meaning (e.g., opening a file, editing a cell), it should be recorded as a **Double-Click** interaction.

```
✅ Double-click the "report.docx" file
```

If the double-click is just two rapid single clicks with no special meaning, record only the first.

### Right-Click

**Scenario:** The user right-clicks to open a context menu.

**Expected behavior:** This is a **Right-Click** interaction, not a Click.

```
✅ Right-click the "Orders" table row
```

### Click Outside (Dismissal)

**Scenario:** The user clicks outside a modal/dialog to close it.

**Expected behavior:** This is contextually a "close" or "dismiss" action. If a Modal/Dialog interaction is registered, it should claim this.

If no specialized interaction claims it, Click should record it:

```
✅ Click outside the dialog to close it
```

---

## 10. Success Criteria

The Click interaction is production-ready when:

### Detection Accuracy

- [ ] Click records the **correct element** — the interactive element the user intended to activate, not a decorative child (icon, span, image).
- [ ] Click does **not** record clicks on non-interactive elements (blank space, paragraphs, decorative images).
- [ ] Click does **not** record clicks on disabled elements.
- [ ] Click does **not** record clicks on hidden elements.
- [ ] Click does **not** record synthetic/programmatic clicks (only genuine user clicks).
- [ ] Click does **not** record its own extension UI interactions.

### Naming Quality

- [ ] The element name uses the clearest available identification (visible text, aria-label, alt text).
- [ ] Icon-only buttons get meaningful names (not "svg" or empty string).
- [ ] Ambiguous elements include disambiguating context.

### Ownership

- [ ] Click is the default owner of all pointer activations.
- [ ] Click yields only to specialized interactions when they explicitly claim the event.
- [ ] When ownership is ambiguous, Click retains ownership (false positive > false negative).

### Plain English

- [ ] Every click produces a natural, readable description.
- [ ] The description follows the format: `Click "[element name]"`.
- [ ] Icons are described meaningfully: `Click the search icon`.
- [ ] Cards are described by content: `Click the "Premium Plan" card`.

### Execution Reliability

- [ ] Execution JSON contains multiple locator strategies for resilience.
- [ ] Locators prioritize stable attributes (test ID, role+name) over fragile ones (positional CSS).
- [ ] Execution JSON captures element identity at click time (not after a delay).

### Interaction Quality

- [ ] Double-click is distinguished from single click.
- [ ] Right-click is not recorded as a left-click.
- [ ] Rapid clicks on different elements are all recorded (no over-suppression).
- [ ] Rapid clicks on the same element are deduplicated appropriately.

### Framework Support

- [ ] Works correctly on native HTML.
- [ ] Works correctly on React applications.
- [ ] Works correctly on Angular applications.
- [ ] Works correctly on Vue applications.
- [ ] Works correctly on Svelte applications.
- [ ] Works correctly on Shadow DOM components.
- [ ] Works correctly on iframe content.

### Pipeline Compliance

- [ ] Click follows the standard interaction pipeline: Detection → Validation → Classification → Plain English → Execution JSON → Timeline → Review → Approval → Save.
- [ ] Click is not considered recorded until it has been successfully classified.

---

## Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| What is a Click? | User activates an interactive element by pointing and clicking | Captures the most fundamental interaction intent |
| Default ownership | Click owns all pointer activations | Simplicity; specialized types must prove they're better |
| Intent variation | All handled as Click (different intents → different descriptions, not different types) | The mechanism is the same; the description varies |
| Naming | Best available identification (text → aria-label → alt → fallback) | Matches how a tester identifies elements |
| Disabled/hidden elements | Not recorded | User cannot genuinely interact with them |
| Synthetic clicks | Not recorded | Only genuine user actions are valid |
| Double-click | Separate interaction | Different semantic meaning |
| Right-click | Separate interaction | Different mechanism, different intent |
| Execution JSON | Multiple locator strategies | No single locator is universally reliable |
| Framework support | Must work across React/Angular/Vue/Svelte/Shadow DOM/iframes | Real enterprise apps use all of these |
