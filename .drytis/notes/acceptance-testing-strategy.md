# Acceptance Testing Strategy — Behavioural Validation

## Principle
Behavioural correctness is the ONLY success metric. Architecture is a means to that end.

## Test Target
OrangeHRM (opensource-demo.orangehrmlive.com) — exercises OXD components that expose all known weakness classes:
- Custom dropdowns (no role="combobox", OXD classes)
- Custom date pickers (calendar popover, nav buttons)
- Radio groups (label→input synthetic clicks)
- Checkboxes (wrapper divs)
- Text fields (blur-time value capture)
- Tables (row checkboxes, action icons)
- Navigation (sidebar links)

## Test Structure
12 interaction categories × 3 levels:
1. **Unit/Integration** (pipeline tests): EvidenceBatch → Recognition → Lifecycle → SemanticAction. Proves the pipeline produces correct output for synthetic evidence.
2. **Browser E2E** (tester sub-agent): Real interaction on OrangeHRM. Proves EventTap + Channels capture real DOM events correctly.
3. **Regression**: Suite runs on every pipeline change. Any new FAIL blocks the phase.

## 12 Categories
1. Text Entry (login, multi-field, autofill/paste)
2. Dropdown — Custom OXD (nationality, marital status, placeholder no-op)
3. Radio Button (gender)
4. Checkbox (toggle, OXD synthetic click dedup)
5. Date Picker — Custom OXD (calendar, nav buttons, typed input)
6. Button Click (save, icon-inside-button)
7. Link / Navigation (sidebar, page load)
8. Scroll (burst coalescing)
9. Hover (tooltip vs plain hover)
10. Dialog / Modal (confirm, cancel, escape)
11. Table Interactions (row checkbox, delete, download)
12. Full Integration Workflow (the user's actual 9-step My Info edit → 14 expected steps)

## Scoring
- ✅ PASS: exact match (verb + target + value)
- ⚠️ PARTIAL: correct verb, wrong target OR missing value
- ❌ FAIL: wrong verb, wrong control, fragmented, or spurious

## Gate
Recorder is NOT complete until ALL scenarios are ✅ PASS.
No partial credit. No "close enough".

## Gap Analysis (current state vs required)
| Category | Unit Tests | Pipeline Wired | Browser Tested | Status |
|----------|-----------|---------------|----------------|--------|
| Text Entry | ✅ | ❌ | ❌ | Pipeline ready, not wired |
| Dropdown | ✅ | ❌ | ❌ | Pattern needs OXD tuning |
| Radio | ✅ | ❌ | ❌ | Pipeline ready |
| Checkbox | ✅ | ❌ | ❌ | Pipeline ready |
| Date Picker | ✅ | ❌ | ❌ | Needs OXD date picker pattern |
| Button | ✅ | ❌ | ❌ | Pipeline ready |
| Navigation | ✅ | ❌ | ❌ | Pipeline ready |
| Scroll | ✅ | ❌ | ❌ | Pipeline ready |
| Hover | ✅ | ❌ | ❌ | Pipeline ready |
| Dialog | ❌ | ❌ | ❌ | Not yet implemented |
| Table | ❌ | ❌ | ❌ | Not yet implemented |
| Full Workflow | ❌ | ❌ | ❌ | Depends on all above |
