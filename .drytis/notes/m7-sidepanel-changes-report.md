# M7 Side Panel Changes — Detailed User/Developer Guide

**Commit:** ac20b93 (source), b238b7a (report)
**Baseline:** b238b7a → ac20b93 → dfbb766 → 3bc28f6
**Date:** 2026-08-11

---

## 1. Before M7 vs After M7 — Structural Comparison

### Before M7 (3bc28f6 baseline)

Each interaction card in the side panel timeline displayed:

```
┌─────────────────────────────────────────┐
│ ☑️ Checkbox  🧩 ToggleSwitch      evt-3 │
│                                         │
│ Check "Enable notifications"            │
│                                         │
└─────────────────────────────────────────┘
```

- **Layer 1 badge**: type icon + label (🖱️ Click, ⌨️ Text Entry, ☑️ Checkbox, etc.)
- **Layer 2 badge**: component type icon + label (🧩 ToggleSwitch, 📊 DataGrid, etc.)
- **Framework tag**: framework name (if detected, e.g. "React", "MUI")
- **Interaction ID**: small text badge (evt-3, evt-4, etc.)
- **End state badge**: only if not "completed" (shows "failed", "partial", etc.)
- **Business meaning**: human-readable description OR fallback ("Check \"Enable notifications\"")
- **Metadata warnings**: ⚠️ warnings for edge cases ("no typing detected", "no-op selection")

**Nothing below the interaction metadata.** No evidence, no before/after state, no DOM changes.

### After M7 (b238b7a)

Same interaction card, PLUS a new evidence block appended below:

```
┌─────────────────────────────────────────────────┐
│ ☑️ Checkbox  🧩 ToggleSwitch              evt-3 │
│                                                 │
│ Check "Enable notifications"                    │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤
│ Window: 412ms · stabilized                      │
│ ┌─ 🎯 Target Evidence ──────────────── (blue) ─┐│
│ │ ELEMENT                                       ││
│ │ INPUT#notifications-toggle [role=switch]      ││
│ │   "Enable notifications"                      ││
│ │   .toggle.toggle--md                          ││
│ │   type=checkbox                               ││
│ │ STATE CHANGES                                 ││
│ │ checked: false → true         (orange diff)   ││
│ │ FOCUS MOVEMENT                                ││
│ │ INPUT → INPUT (unknown → "Enable notifs")     ││
│ └───────────────────────────────────────────────┘│
│ ────────────────────────────────────             │
│ ┌─ 🌐 Application Evidence ─────────── (green) ─┐│
│ │ DOM Changes (1)                               ││
│ │ attributes · <DIV> · class: hide → show       ││
│ │ NEW SURFACES (1)                              ││
│ │ <DIV> [role=region] "Settings panel"          ││
│ └───────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

**What changed visually:**
- Dashed separator line below interaction metadata (`.evidence-container` with `border-top: 1px dashed`)
- Window metadata line (monospace, small): duration + end reason
- **🎯 Target Evidence** section with blue left border (`#3b82f6`), collapsible
- Thin separator line between the two sections
- **🌐 Application Evidence** section with green left border (`#10b981`), collapsible
- If evidence hasn't arrived yet: italic gray placeholder text "⏳ Collecting behavioral evidence…"

---

## 2. Target Evidence Section — Detailed Breakdown

### 2.1 Element Identity

Shows a compact one-line identity summary followed by secondary details:

```
ELEMENT
INPUT#email-field [role=textbox] "Email address"
  form-field.input--large
  type=email
```

Fields displayed (from ElementIdentity):
- **tag** (INPUT, BUTTON, DIV, A, etc.)
- **stableId** (the `#id` attribute, if present)
- **ariaRole** (the `[role=...]` attribute, if present)
- **accessibleName** (computed, truncated to 40 chars with `…`)
- **className** (secondary line, truncated to 80 chars)
- **inputType** (secondary line, shown if present: `type=checkbox`, `type=email`, etc.)

If all fields are empty: displays "Unknown element".

### 2.2 Before/After State Diff

Shows ONLY properties that changed between the pre-interaction snapshot (captured by M2's capture-phase listener) and the post-interaction snapshot (captured at window close).

Format: `property: oldValue → newValue` in orange/amber color (`#d97706`).

Properties tracked (9 TargetStateSnapshot fields):
- `value` → displayed as `value: old → new`
- `checked` → displayed as `checked: false → true`
- `disabled` → displayed as `disabled: true → false`
- `ariaExpanded` → displayed as `aria-expanded: false → true`
- `ariaChecked` → displayed as `aria-checked: …`
- `ariaPressed` → displayed as `aria-pressed: …`
- `textContent` → displayed as `text: "Old" → "New"`
- `childCount` → displayed as `children: 3 → 5`

If NO properties changed: "No observable state changes" (gray italic).

If no prior snapshot was captured (first interaction with this element): all "after" properties are shown as the full list, since the `before` is null.

If the element was removed from the DOM during the window: "(element removed)".

### 2.3 Focus Movement

Shows where focus moved after the interaction. Only rendered if `focusMovement` is non-null.

Format: `beforeTag [beforeRole] "beforeName" → afterTag [afterRole] "afterName"`

Example: `INPUT [textbox] "Search" → BUTTON [button] "Submit"`

Note: In the current implementation, `before` is always `null` (the focus-movement "before" is not yet reconstructed from prior windows). So it displays as: `(unknown) → BUTTON [button] "Submit"`.

---

## 3. Application Evidence Section — Detailed Breakdown

### 3.1 DOM Changes

Summarized mutation groups. Each group is one or more MutationRecords collapsed onto the same target element.

Header: `DOM Changes (N)` or `DOM Changes (N) (M more dropped)` or `DOM Changes (N) ⚠️ high-churn`

Each row format: `mutationType · <targetTag> [shadow: context] · attr: old → new · +N nodes · -M nodes · text: old → new`

Truncated to 150 characters per row with `…`.

Max 10 rows shown inline. Beyond that: `… N more` in muted gray.

If the 200-cap was hit: header shows `⚠️ high-churn` and `(N more dropped)` count.

### 3.2 New Surfaces

Elements detected as dialogs, menus, panels, or overlays that appeared during the window.

Header: `New Surfaces (N)`

Each row: `<tagName> [role=role] "accessibleName"`

Max 5 shown inline. Beyond: `… N more`.

### 3.3 Removed Surfaces

Same format as New Surfaces. In the current M4 implementation, all surfaces go to `newSurfaces` and `removedSurfaces` is always empty — the DOMObserver tracks surface appearances but not removals yet. This is a known implementation gap.

### 3.4 Visibility Changes

Elements whose `display`, `visibility`, `opacity`, `hidden`, or `aria-hidden` changed.

Header: `Visibility Changes (N)`

Each row: `property: oldValue → newValue (css/path)`

Max 10 shown inline. Beyond: `… N more`.

### 3.5 Navigation

SPA or full-page navigation events detected during the window.

Header: `Navigation (N)`

Each row: `type: fromUrl → toUrl`

Navigation types: `pushState`, `replaceState`, `hashchange`, `popstate`, `full-reload`.

### 3.6 Network Activity

HTTP requests observed during the evidence window.

Header: `Network (N)`

Each row: `🔵 METHOD STATUS url durationMs` or `🟣 METHOD STATUS url durationMs`

- 🔵 = captured by MAIN-world interceptor (full metadata)
- 🟣 = captured by chrome.webRequest (metadata only)
- STATUS shows as `…` if request was still in-flight when the window closed
- Duration shown only if completed: `312ms`

Max 10 shown inline (single-line, truncated with ellipsis). Beyond: `… N more`.

### 3.7 Performance Condition

Shown only if `performanceCondition` is non-null.

Header: `Performance`

Row: `N batches · longest: Xms · ⚠️ main thread blocked · ⚠️ high-churn`

Warnings (`⚠️`) appear conditionally:
- `main thread blocked` if any mutation batch took >15ms
- `high-churn` if the 200-cap was hit

### 3.8 Empty State

If no application-level evidence was captured at all: "No application-level changes detected" (gray italic).

---

## 4. Collapsible Sections & Evidence Caps

Both sections (🎯 Target and 🌐 Application) are independently collapsible:
- Click the header to toggle body visibility
- When collapsed, the 🎯/🌐 icon changes to ▶
- Sections default to EXPANDED

Caps (to keep UI bounded):

| Data Type | Stored Cap | Displayed Cap |
|-----------|-----------|---------------|
| DOM change summaries | 200 per window | 10 inline, rest collapsed |
| Network activity | 50 per window | 10 inline, rest collapsed |
| New surfaces | 50 per window | 5 inline, rest collapsed |
| Visibility changes | 50 per window | 10 inline, rest collapsed |
| Navigation | unlimited (typically 1-2) | all shown |

Beyond display caps: `… N more` in muted gray.

---

## 5. Late-Arriving Evidence

When an interaction card is first rendered, evidence may not be available yet (the observation window is still open). The card shows:

```
┌─────────────────────────────────────────┐
│ 🖱️ Click  🔘 IconButton           evt-7 │
│                                         │
│ Click "Submit"                          │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
│ ⏳ Collecting behavioral evidence…      │
└─────────────────────────────────────────┘
```

When the `INTERACTION_EVIDENCE_UPDATE` message arrives from the service worker:
1. Side panel searches all visible interaction cards for one whose ID badge matches `eventId`
2. If found: placeholder is removed, evidence sections are rendered in place
3. If the card already has evidence (update): existing evidence is replaced with the new data
4. If no matching card found yet (interaction not yet displayed): evidence is stored in a deferred Map for later application

---

## 6. Concrete Examples — What the User Sees

### Example 1: Checkbox Toggle

User clicks a "Enable notifications" checkbox.

```
┌─────────────────────────────────────────────────┐
│ ☑️ Checkbox  🧩 ToggleSwitch              evt-3 │
│ Check "Enable notifications"                    │
├──────────────────────────────────────────────────┤
│ Window: 380ms · stabilized                      │
│                                                  │
│ 🎯 Target Evidence                               │
│   ELEMENT                                        │
│   INPUT#notif-toggle [role=switch]               │
│     "Enable notifications"                       │
│     .pref-toggle                                 │
│     type=checkbox                                │
│   STATE CHANGES                                  │
│     checked: false → true         (orange)       │
│   FOCUS MOVEMENT                                 │
│     (unknown) → INPUT [switch] "Enable notifs"   │
│                                                  │
│ ─────────────────────                            │
│                                                  │
│ 🌐 Application Evidence                          │
│   DOM Changes (1)                                │
│     attributes · <DIV> · class: hidden → visible │
│   New Surfaces (1)                               │
│     <DIV> [role=group] "Notification settings"   │
└──────────────────────────────────────────────────┘
```

**What is raw evidence:** `checked: false → true`, the DOM mutation on the DIV, the new surface. These are observed facts.

**What is NOT interpreted:** The side panel does NOT say "checking this checkbox revealed a settings panel." That causal connection is deferred to the correlation layer.

---

### Example 2: Text Input / Autocomplete

User types "Re" in a search box, waits, autocomplete suggestions appear, then types "act".

```
┌─────────────────────────────────────────────────┐
│ ⌨️ Text Entry  🔍 Autocomplete           evt-5 │
│ Enter "React" in "Search frameworks"            │
├──────────────────────────────────────────────────┤
│ Window: 1,840ms · typing-complete               │
│                                                  │
│ 🎯 Target Evidence                               │
│   ELEMENT                                        │
│   INPUT#framework-search [role=combobox]         │
│     "Search frameworks"                          │
│     .autocomplete-input                          │
│     type=text                                    │
│   STATE CHANGES                                  │
│     value: → Re         (orange)                 │
│     value: Re → React  (orange)                 │
│     aria-expanded: false → true   (orange)       │
│                                                  │
│ ─────────────────────                            │
│                                                  │
│ 🌐 Application Evidence                          │
│   DOM Changes (3)                                │
│     childList · <UL> · +4 nodes                  │
│     childList · <UL> · -2 nodes                  │
│     attributes · <LI> · class: → selected        │
│   New Surfaces (1)                               │
│     <UL> [role=listbox] "Framework suggestions"  │
│   Network (2)                                    │
│     🔵 GET 200 /api/search?q=Re 145ms            │
│     🔵 GET 200 /api/search?q=React 89ms          │
│   Performance                                    │
│     4 batches · longest: 3ms                     │
└──────────────────────────────────────────────────┘
```

**What is raw evidence:** The value changes, the DOM additions/removals in the UL, the two network requests with timing, the surface detection.

**What is NOT interpreted:** The panel does NOT say "typing triggered API calls which returned suggestions." It simply shows the facts side-by-side. The temporal ordering (value changed → network request → DOM nodes added) is available via timing, but no causal claim is made.

---

### Example 3: Native Dropdown (Select)

User selects "Medium" from a native `<select>`.

```
┌─────────────────────────────────────────────────┐
│ 📋 Dropdown  🧩 Generic                  evt-8 │
│ Select "Medium" from "Priority"                 │
├──────────────────────────────────────────────────┤
│ Window: 320ms · stabilized                       │
│                                                  │
│ 🎯 Target Evidence                               │
│   ELEMENT                                        │
│   SELECT#priority [role=listbox]                 │
│     "Priority"                                   │
│     .form-select                                 │
│   STATE CHANGES                                  │
│     value: low → medium          (orange)        │
│                                                  │
│ ─────────────────────                            │
│                                                  │
│ 🌐 Application Evidence                          │
│   No application-level changes detected          │
└──────────────────────────────────────────────────┘
```

Native `<select>` dropdowns typically don't cause DOM mutations outside the element itself, so Application Evidence is often empty. This is correct behavior — the absence of mutations is itself evidence.

---

### Example 4: Custom Dropdown

User clicks a custom dropdown button, a menu appears, user clicks an option.

**Interaction 1 (open dropdown):**
```
┌─────────────────────────────────────────────────┐
│ 🖱️ Click  🔘 IconButton                  evt-9 │
│ Click "Status" dropdown                         │
├──────────────────────────────────────────────────┤
│ Window: 290ms · stabilized                       │
│                                                  │
│ 🎯 Target Evidence                               │
│   ELEMENT                                        │
│   BUTTON#status-trigger [role=button]            │
│     "Status"                                     │
│     .dropdown-trigger                            │
│   STATE CHANGES                                  │
│     aria-expanded: false → true   (orange)       │
│                                                  │
│ ─────────────────────                            │
│                                                  │
│ 🌐 Application Evidence                          │
│   DOM Changes (1)                                │
│     childList · <BODY> · +12 nodes               │
│   New Surfaces (1)                               │
│     <UL> [role=menu] "Status options"            │
│   Visibility Changes (1)                         │
│     display: none → block (.dropdown-menu)       │
└──────────────────────────────────────────────────┘
```

**Interaction 2 (select option):**
```
┌─────────────────────────────────────────────────┐
│ 🖱️ Click  🧩 Generic                   evt-10 │
│ Click "Active"                                  │
├──────────────────────────────────────────────────┤
│ Window: 310ms · stabilized                       │
│                                                  │
│ 🎯 Target Evidence                               │
│   ELEMENT                                        │
│   LI#status-active [role=menuitem]               │
│     "Active"                                     │
│   STATE CHANGES                                  │
│     (no observable state changes on the LI)      │
│                                                  │
│ ─────────────────────                            │
│                                                  │
│ 🌐 Application Evidence                          │
│   DOM Changes (2)                                │
│     childList · <BODY> · -12 nodes               │
│     attributes · <BUTTON> · text: Status → Active│
│   Visibility Changes (1)                         │
│     display: block → none (.dropdown-menu)       │
└──────────────────────────────────────────────────┘
```

**What is raw evidence:** Opening the dropdown shows aria-expanded change + new surface + visibility change. Selecting shows the dropdown removal + button text update.

**What is NOT interpreted:** The panel does NOT link the two interactions as "open menu" → "select option." Each interaction gets its own evidence window independently.

---

### Example 5: Multi-Level Dropdown (Filters → Industry → Technology → Software)

User navigates: clicks "Filters" → menu opens → hovers/clicks "Industry" → submenu opens → clicks "Technology" → submenu opens → clicks "Software".

Each click generates its own interaction card with its own evidence:

**Click "Filters":**
```
Window: 280ms · stabilized

🎯 Target Evidence
  BUTTON#filters [role=button] "Filters"
  STATE: aria-expanded: false → true

🌐 Application Evidence
  DOM Changes (1): childList · <DIV> · +8 nodes
  New Surfaces (1): <DIV> [role=menu] "Filter categories"
```

**Click "Industry":**
```
Window: 340ms · stabilized

🎯 Target Evidence
  A#industry [role=menuitem] "Industry"
  STATE: aria-expanded: null → true

🌐 Application Evidence
  DOM Changes (2):
    childList · <UL> · +5 nodes
    attributes · <DIV> · class: → submenu-open
  New Surfaces (1): <UL> [role=menu] "Industry options"
```

**Click "Technology":**
```
Window: 310ms · stabilized

🎯 Target Evidence
  A#technology [role=menuitem] "Technology"
  STATE: aria-expanded: null → true

🌐 Application Evidence
  DOM Changes (2):
    childList · <UL> · +7 nodes
    childList · <UL> · -5 nodes   (previous submenu closed)
  New Surfaces (1): <UL> [role=menu] "Technology options"
```

**Click "Software":**
```
Window: 265ms · stabilized

🎯 Target Evidence
  A#software [role=menuitem] "Software"
  STATE: (no observable state changes)

🌐 Application Evidence
  DOM Changes (3):
    childList · <BODY> · -20 nodes  (all menus closed)
    attributes · <INPUT> · value: → software
    attributes · <SPAN> · text: → Software
  Visibility Changes (1): display: block → none (.all-menus)
```

**What is raw evidence:** Each step captures the surface appearance/disappearance, DOM node additions/removals, and aria-expanded changes independently.

**What is NOT interpreted:** The panel does NOT identify this as a 4-step cascade through nested menus. It does NOT correlate that "Industry submenu closing" happened because "Technology was selected." Each interaction is a standalone evidence snapshot. The temporal sequence and timing data are available for a future correlation layer to reconstruct the hierarchy.

---

### Example 6: Modal

User clicks a "Delete" button, a confirmation modal appears.

```
┌─────────────────────────────────────────────────┐
│ 🖱️ Click  🔘 IconButton                 evt-12 │
│ Click "Delete"                                  │
├──────────────────────────────────────────────────┤
│ Window: 420ms · stabilized                       │
│                                                  │
│ 🎯 Target Evidence                               │
│   BUTTON#delete-btn [role=button]                │
│     "Delete"                                     │
│     .btn.btn-danger                              │
│   STATE CHANGES                                  │
│     aria-pressed: null → true     (orange)       │
│   FOCUS MOVEMENT                                 │
│     (unknown) → BUTTON [button] "Confirm delete" │
│                                                  │
│ ─────────────────────                            │
│                                                  │
│ 🌐 Application Evidence                          │
│   DOM Changes (2)                                │
│     childList · <BODY> · +1 node                 │
│     attributes · <BODY> · class: → modal-open    │
│   New Surfaces (1)                               │
│     <DIV> [role=dialog] "Confirm deletion"       │
│   Visibility Changes (1)                         │
│     display: none → block (.modal-overlay)       │
└──────────────────────────────────────────────────┘
```

**What is raw evidence:** The modal appearance (new surface), body class change, overlay visibility change, focus movement to the confirm button.

**What is NOT interpreted:** The panel does NOT say "clicking Delete opened a confirmation dialog." The surface detection reports the dialog as a fact; the correlation layer would interpret the intent.

---

### Example 7: Shadow DOM Interaction

User clicks a button inside a web component with a shadow root.

```
┌─────────────────────────────────────────────────┐
│ 🖱️ Click  🧩 Generic                   evt-14 │
│ Click "Add to cart"                             │
├──────────────────────────────────────────────────┤
│ Window: 300ms · stabilized                       │
│                                                  │
│ 🎯 Target Evidence                               │
│   BUTTON [role=button] "Add to cart"             │
│     .product-action                              │
│   STATE CHANGES                                  │
│     aria-pressed: null → true                    │
│                                                  │
│ ─────────────────────                            │
│                                                  │
│ 🌐 Application Evidence                          │
│   DOM Changes (2)                                │
│     childList · <DIV> · +1 node                  │
│     attributes · <SPAN> · text: 0 → 1            │
│       [shadow: product-card]                     │
│   DOM Changes (1)                                │
│     childList · <DIV> · +1 node                  │
│       [shadow: cart-widget]                      │
└──────────────────────────────────────────────────┘
```

The `[shadow: context]` annotation appears next to DOM change entries that occurred inside a shadow root. The context string identifies which shadow root the mutation was in (truncated to 30 chars).

**What is raw evidence:** The button press, the shadow-root internal mutations, the shadow context labels.

**What is NOT interpreted:** The panel does NOT say "clicking the add-to-cart button in the product component updated the cart counter in a different component." Cross-component causal attribution is deferred.

---

### Example 8: Click Causing Changes Elsewhere

User clicks a "Sort by Date" button. A table on the other side of the page re-sorts.

```
┌─────────────────────────────────────────────────┐
│ 🖱️ Click  ↕️ SortButton                evt-16 │
│ Click "Sort by Date"                            │
├──────────────────────────────────────────────────┤
│ Window: 520ms · stabilized                       │
│                                                  │
│ 🎯 Target Evidence                               │
│   BUTTON#sort-date [role=button]                 │
│     "Sort by Date"                               │
│   STATE CHANGES                                  │
│     aria-pressed: null → true                    │
│                                                  │
│ ─────────────────────                            │
│                                                  │
│ 🌐 Application Evidence                          │
│   DOM Changes (5)                                │
│     childList · <TBODY> · -15 nodes              │
│     childList · <TBODY> · +15 nodes              │
│     attributes · <TH> · class: → sorted-asc      │
│     attributes · <TH> · class: sorted-asc →      │
│     characterData · <TD> · text: Z → A           │
│   Performance                                    │
│     3 batches · longest: 8ms                     │
└──────────────────────────────────────────────────┘
```

**What is raw evidence:** The TBODY child removals and additions (table re-sort), the header class changes, the character data changes. All happen in the same window — they're temporally correlated but causally uninterpreted.

**What is NOT interpreted:** The panel does NOT say "clicking sort reordered the table rows." The fact that 15 nodes were removed and 15 added is the evidence; the interpretation that this is a re-sort is a future correlation-layer task.

---

### Example 9: Navigation

User clicks a link that triggers SPA navigation via `history.pushState`.

```
┌─────────────────────────────────────────────────┐
│ 🧭 Navigation  🔗 Generic              evt-18  │
│ Navigate to "Dashboard"                         │
├──────────────────────────────────────────────────┤
│ Window: 450ms · navigation                       │
│                                                  │
│ 🎯 Target Evidence                               │
│   A#nav-dashboard [role=link]                    │
│     "Dashboard"                                  │
│     .nav-link                                    │
│     href=/dashboard                              │
│   STATE CHANGES                                  │
│     No observable state changes                  │
│                                                  │
│ ─────────────────────                            │
│                                                  │
│ 🌐 Application Evidence                          │
│   DOM Changes (8)                                │
│     childList · <MAIN> · -20 nodes               │
│     childList · <MAIN> · +18 nodes               │
│     attributes · <A> · class: → active           │
│     attributes · <A> · class: active →           │
│   Navigation (1)                                 │
│     pushState: → /dashboard                      │
│   Network (1)                                    │
│     🔵 GET 200 /api/dashboard 234ms              │
└──────────────────────────────────────────────────┘
```

The window's `endReason` is `navigation` (the SPA navigation event closed the window).

**What is raw evidence:** The URL change, the main-content DOM replacement, the network fetch, the nav-link class change.

**What is NOT interpreted:** The panel does NOT say "navigating to Dashboard replaced the page content and fetched dashboard data." These are independent facts in the same temporal window.

---

## 7. Raw Evidence vs Not-Yet-Interpreted Information

### What IS Raw Evidence (Displayed)

Everything shown in both sections is raw, uninterpreted evidence:

| Evidence Type | What's Shown | Why It's Raw |
|---------------|-------------|--------------|
| Element identity | tag, id, role, name, classes, type | Extracted at capture time by identity-extractor |
| State diff | before → after for 8 properties | Mechanical comparison of two snapshots |
| DOM changes | mutation types, target tags, attribute deltas, node counts | Summarized MutationRecords with timing |
| Surfaces | tag, role, name of dialog/menu/overlay | Detected by tag/role heuristics |
| Visibility changes | property: old → new + CSS path | Mechanical property comparison |
| Navigation | type, from/to URL | From EventTap history API patches |
| Network | method, status, URL, timing, source | From MAIN-world interceptor or webRequest |
| Performance | batch count, longest batch, churn flags | Mechanical timing measurements |
| Window metadata | duration, end reason | From AdaptiveWindow lifecycle |

**Key invariant (INV-BEHAV-1):** No causal claims. No "effect" labels. No confidence scores. No "what happened" summaries. Just observed facts with timing.

### What Is NOT Yet Interpreted/Correlated

| Not Shown | Why | Where It Will Come From |
|-----------|-----|------------------------|
| "This click caused the dropdown to open" | Causal attribution | Future correlation layer |
| "These network requests were triggered by typing" | Request-to-action linkage | Future correlation layer |
| "This is a multi-step wizard navigation" | Sequence recognition | Future semantic interpretation |
| "The table re-sorted because of this click" | Cross-element causality | Future correlation layer |
| "This modal appeared as a result of the delete action" | Intent inference | Future correlation layer |
| Element → mutation causal ordering | Which mutations were caused by this interaction vs coincidental | Future correlation layer (will use batchIndex + relativeTime) |
| Confidence scores | How certain we are about any interpretation | Future correlation layer |
| "This interaction is part of a form submission flow" | Flow/context recognition | Future semantic layer |

The timing data (`relativeTime`, `batchIndex`, `firstMutationAt`, `lastMutationAt`) and stability trace are captured as raw evidence precisely so a future layer CAN perform this correlation — but the M7 display layer makes no attempt to do so.

---

## 8. What Is NOT Shown Yet (M7 Scope Boundaries)

The following are explicitly out of M7 scope:

1. **No persistence to IndexedDB** — Evidence exists only in memory (service worker `pendingEvidence` Map, capped at 100 entries) and in the live side panel DOM. No Dexie table for behavioral evidence yet (that's M8).

2. **No causal correlation** — No arrows, no "caused by" labels, no effect chains linking Target Evidence to Application Evidence.

3. **No semantic interpretation** — No "this is a form submission" or "this opened a wizard" labels.

4. **No request/response bodies** — Network evidence shows URL, method, status, timing only. No payloads.

5. **No removed surfaces** — The `removedSurfaces` array is always empty. Surface removal detection is not yet implemented in DOMObserver.

6. **No focus-movement "before"** — `focusMovement.before` is always `null`. Focus history reconstruction is deferred.

7. **No evidence export** — Cannot export evidence to JSON/file from the UI.

8. **No evidence filtering/search** — All evidence for all interactions is shown. No way to filter by "only show interactions with network activity" or "only show DOM changes."

9. **No multi-frame evidence** — Evidence is only captured from the main frame. `frameId` is always `'main'`.

10. **No historical evidence replay** — Once the page is refreshed or recording stops, evidence in the side panel is gone (not persisted).

11. **No test HTML cleanup** — Four test HTML pages from `public/` still leak into the extension ZIP (tracked as TD-M4-001, Low severity). These are inert files, not loaded by the extension.

12. **No evidence-based assertion suggestions** — Evidence is displayed as-is. No "suggest an assertion based on this evidence" feature.

---

## 9. Interaction Card Changes Summary

| Component | Before M7 | After M7 |
|-----------|-----------|----------|
| Type badge | ✅ Unchanged | ✅ Unchanged |
| Component type badge | ✅ Unchanged | ✅ Unchanged |
| Framework tag | ✅ Unchanged | ✅ Unchanged |
| Interaction ID | ✅ Unchanged | ✅ Unchanged |
| End state badge | ✅ Unchanged | ✅ Unchanged |
| Business meaning | ✅ Unchanged | ✅ Unchanged |
| Metadata warnings | ✅ Unchanged | ✅ Unchanged |
| Dashed separator | ❌ Did not exist | ✅ New — below metadata |
| Window metadata line | ❌ Did not exist | ✅ New — duration + end reason |
| 🎯 Target Evidence section | ❌ Did not exist | ✅ New — blue-bordered, collapsible |
| 🌐 Application Evidence section | ❌ Did not exist | ✅ New — green-bordered, collapsible |
| ⏳ Placeholder | ❌ Did not exist | ✅ New — while evidence pending |
| Late-arriving update | ❌ Did not exist | ✅ New — INTERACTION_EVIDENCE_UPDATE |

**Recording/classification/generation pipeline: UNCHANGED.** M7 only adds a display layer. The recording entry, event tap, component runtime, classification, enrichment, IR generation, and Playwright code generation are not modified. Evidence flows parallel to the existing pipeline via a separate message channel.
