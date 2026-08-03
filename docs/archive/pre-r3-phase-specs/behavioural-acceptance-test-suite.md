# Behavioural Acceptance Test Suite — Recorder Interaction Quality

> The recorder is NOT complete until it passes every scenario below.
> Each scenario defines: the user action, the expected recorded output, and
> the failure modes that must NOT appear.

---

## Methodology

Test against **OrangeHRM** (https://opensource-demo.orangehrmlive.com) as the
primary test target — it exercises OXD components, custom dropdowns, custom
date pickers, radio groups, checkboxes, text fields, tables, and navigation.

The QA engineer performs each workflow. After Stop, the Observed Workflow
panel must show exactly the expected steps — no more, no fewer.

A step is "correct" when:
1. **Verb** matches the interaction type (fill, select, selectDate, toggle, click, navigate, scroll)
2. **Target** is the semantic element (not a child icon, not a container)
3. **Value** captures the meaningful data (selected option, entered text, checked state)
4. **Locator** is stable and human-readable (role+name preferred, not `div > div > span > i`)

---

## 1. Text Entry

### Scenario: Login Form
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 1.1 | Click Username field, type "Admin" | `Fill "Username" with "Admin"` |
| 1.2 | Click Password field, type "admin123" | `Fill "Password" with "admin123"` |

**Must NOT produce**: Focus event as separate step. Blur without typing (no-op). Two steps for one field.

### Scenario: Multi-field Edit
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 1.3 | Edit First Name → "John" | `Fill "First Name" with "John"` |
| 1.4 | Edit Last Name → "Doe" | `Fill "Last Name" with "Doe"` |
| 1.5 | Tab to next field without typing | *(no step — no-op filtered)* |

### Scenario: Autofill / Paste
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 1.6 | Paste value into field | `Fill "<field>" with "<pasted value>"` |
| 1.7 | Browser autofill on focus | *(no step if value unchanged by user — autofill is not a user action)* |

---

## 2. Dropdown (Custom — OXD)

### Scenario: Nationality Dropdown
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 2.1 | Click Nationality dropdown trigger | *(no step — lifecycle activated)* |
| 2.2 | Click "American" option | `Select "American" from "Nationality"` |
| 2.3 | Re-open dropdown, click same option | *(no step — no-op, same value)* |
| 2.4 | Re-open dropdown, click "British" | `Select "British" from "Nationality"` |

**Must NOT produce**: Click "Blood Type". Click on trigger as separate step. Click on wrong dropdown.

### Scenario: Marital Status Dropdown
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 2.5 | Open Marital Status, select "Single" | `Select "Single" from "Marital Status"` |
| 2.6 | Open Marital Status, select "Married" | `Select "Married" from "Marital Status"` |

### Scenario: Placeholder Selection (No-Op)
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 2.7 | Open dropdown, select "-- Select --" | *(no step — placeholder filtered)* |

---

## 3. Radio Button

### Scenario: Gender Selection
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 3.1 | Click "Female" radio | `Select "Female" from "Gender"` |
| 3.2 | Click "Male" radio | `Select "Male" from "Gender"` |

**Must NOT produce**: Click on the radio's label text as separate step. Click on wrapper div. Click on `<i>` icon.

---

## 4. Checkbox

### Scenario: Checkbox Toggle
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 4.1 | Check "Smoker" checkbox | `Toggle "Smoker" → checked` |
| 4.2 | Uncheck "Smoker" checkbox | `Toggle "Smoker" → unchecked` |

**Must NOT produce**: Two steps for one toggle (OXD label→input synthetic click). Click on `<input>` and Click on `<label>` as separate steps.

---

## 5. Date Picker

### Scenario: Date of Birth (OXD Custom)
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 5.1 | Click Date of Birth trigger | *(no step — lifecycle activated)* |
| 5.2 | Click "Next Month" nav button | *(no step — lifecycle-internal)* |
| 5.3 | Click day "15" | `Select date "15" from "Date of Birth"` |
| 5.4 | Click trigger again, type "1990-01-15", blur | `Select date "1990-01-15" from "Date of Birth"` |

**Must NOT produce**: Fragmented Click + Fill steps. Click on nav buttons. Click on calendar container div.

---

## 6. Button Click

### Scenario: Save Button
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 6.1 | Click "Save" button | `Click "Save"` |

**Must NOT produce**: Click on `<i>` icon inside button. Click on `<span>` inside button. Click on container div.

---

## 7. Link / Navigation

### Scenario: Menu Navigation
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 7.1 | Click "My Info" in left nav | `Navigate to "My Info"` OR `Click "My Info"` |
| 7.2 | Page loads new URL | `Page navigation to <url>` |

**Must NOT produce**: Click on nav icon `<i>`. Click on nav container `<div>`. Missing navigation step.

---

## 8. Scroll

### Scenario: Page Scroll
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 8.1 | Scroll down 3 times rapidly | `Scroll page` (ONE step, coalesced) |
| 8.2 | Scroll, pause 1s, scroll again | `Scroll page` × 2 (burst gap exceeded) |

**Must NOT produce**: One step per scroll event. Scroll step when clicking after scrolling.

---

## 9. Hover

### Scenario: Tooltip on Hover
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 9.1 | Hover over element with tooltip | `Hover over "<element>"` (only if UI state changes) |
| 9.2 | Hover over plain text | *(no step — no UI state change)* |

**Must NOT produce**: Hover on every mouseenter. Sustained-dwell false positive.

---

## 10. Dialog / Modal

### Scenario: Confirmation Dialog
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 10.1 | Click action that opens dialog | *(dialog open captured as part of parent action)* |
| 10.2 | Click "Confirm" in dialog | `Click "Confirm"` |
| 10.3 | Click "Cancel" or press Escape | `Click "Cancel"` or *(dialog dismissed, no separate step)* |

**Must NOT produce**: Click on dialog backdrop. Click on dialog container div. Missing dialog context.

---

## 11. Table Interactions

### Scenario: Attachment Table
| Step | User Action | Expected Output |
|------|-------------|-----------------|
| 11.1 | Click checkbox in table row | `Toggle row checkbox` |
| 11.2 | Click "Delete Selected" | `Click "Delete Selected"` |
| 11.3 | Click download icon for a file | `Click "Download" for "test.png"` |

---

## 12. Full Integration Workflow

### Scenario: Complete "My Info" Edit (the user's actual workflow)

| # | User Action | Expected Step |
|---|-------------|---------------|
| 1 | Navigate to OrangeHRM login | `Page navigation to OrangeHRM` |
| 2 | Type username "Admin" | `Fill "Username" with "Admin"` |
| 3 | Type password "admin123" | `Fill "Password" with "admin123"` |
| 4 | Click Login | `Click "Login"` |
| 5 | Page loads dashboard | `Page navigation to dashboard` |
| 6 | Click "My Info" | `Click "My Info"` / `Navigate to "My Info"` |
| 7 | Page loads personal details | `Page navigation to personal details` |
| 8 | Edit First Name → "John" | `Fill "First Name" with "John"` |
| 9 | Edit Last Name → "Doe" | `Fill "Last Name" with "Doe"` |
| 10 | Select Nationality → "American" | `Select "American" from "Nationality"` |
| 11 | Select Marital Status → "Single" | `Select "Single" from "Marital Status"` |
| 12 | Select Gender → Female | `Select "Female" from "Gender"` |
| 13 | Select Date of Birth → 15th | `Select date "15" from "Date of Birth"` |
| 14 | Click Save | `Click "Save"` |

**Total expected steps: 14** (not counting no-ops, intermediate dropdown opens, or date picker nav clicks).

If the recorder produces MORE than 14 steps, it has noise (intermediate clicks not filtered).
If the recorder produces FEWER than 14, it has missing interactions.
If any step has the wrong target/value/verb, it has classification or target resolution failures.

---

## Scoring Criteria

| Grade | Meaning |
|-------|---------|
| ✅ PASS | Exact match: correct verb, correct target, correct value |
| ⚠️ PARTIAL | Correct verb but wrong target OR correct target but missing value |
| ❌ FAIL | Wrong verb, wrong control, fragmented interaction, or spurious step |

**The recorder passes the suite only when every scenario is ✅ PASS.**

---

## Execution Plan

1. **Unit/Integration**: Each scenario has corresponding pipeline tests (EvidenceBatch → Recognition → Lifecycle → SemanticAction).
2. **E2E (Browser)**: Tester sub-agent performs the workflow on OrangeHRM preview and verifies the side panel output.
3. **Regression**: Suite runs on every pipeline change. Any new FAIL blocks the phase.
