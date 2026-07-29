# v10.4.18 Workflow Validation — Mismatches Against Actual User Workflow

## Actual User Workflow (OrangeHRM "My Info")
1. Login (username + password + click Login)
2. Navigate to My Info
3. Edit First Name
4. Edit Last Name
5. Select Nationality dropdown
6. Select Marital Status dropdown
7. Select Gender = Female (radio)
8. Select Date of Birth (date picker)
9. Click Save

## Recorded Mismatches

### M1: Dropdown → wrong control (Blood Type instead of Nationality/Marital Status)
- **Root cause**: resolveTarget() returns first INTERACTIVE_SELECTOR match in composedPath — no component boundary awareness. OXD dropdown trigger (`<div class="oxd-select-text-input" tabindex="0">`) has no `role="combobox"`, so V2 CssClassnameProvider doesn't recognize `oxd-select-text-input`. V1 has NO custom dropdown rule at all. Falls through to generic Click.
- **Pipeline stage**: EventTap (target resolution) + Recognition (classification)
- **Correct output**: `Select "American" from "Nationality" dropdown` / `Select "Single" from "Marital Status" dropdown`
- **Fix required**: Ancestor class scanning in target resolution + OXD dropdown pattern recognition (already in new pipeline)

### M2: Date picker fragmented into Text Entry / Popover interactions
- **Root cause**: No OXD date picker pattern recognition. resolveTarget returns the inner input or icon. Calendar cell clicks treated as generic clicks. No lifecycle grouping binds trigger→navigation→cell-click→value together.
- **Pipeline stage**: Recognition (no date picker pattern) + Lifecycle (no multi-event grouping)
- **Correct output**: `Select date "1990-01-15" from "Date of Birth" date picker`
- **Fix required**: OXD date picker pattern + lifecycle that coalesces trigger→nav→cell→value

### M3: Click "I" — incorrect target resolution
- **Root cause**: resolveTarget returns `<i>` icon element from composedPath because it matches [tabindex] or cursor:pointer. generateCssSelector produces `div > div > label > span > i` — pure positional path. accessibleName is empty for icon elements.
- **Pipeline stage**: EventTap (target resolution) + Output (locator generation)
- **Correct output**: Should resolve to the semantic parent (e.g., checkbox, button, or link) not the decorative icon
- **Fix required**: 4-strategy resolution with framework wrapper unwrapping in target-resolver.ts (already implemented in new pipeline)

### M4: Oversized/wrong click targets
- **Root cause**: No ancestor class scanning — resolveTarget can't find OXD wrapper boundaries (.oxd-checkbox-wrapper, .oxd-select-wrapper). clickable heuristic (cursor:pointer) catches too many elements.
- **Pipeline stage**: EventTap (target resolution)
- **Correct output**: Element-level precision — click on the actual checkbox/button, not the container div
- **Fix required**: captureAncestorClasses (Phase 2b ✅) + framework wrapper detection in target-resolver

## Pipeline Stage Responsibility Map

| Mismatch | EventTap | Channels | Recognition | Lifecycle | Enrichment | Output |
|----------|----------|----------|-------------|-----------|------------|--------|
| M1 Dropdown wrong | ❌ target | ✅ has data | ❌ no OXD pattern | — | — | — |
| M2 Date picker fragmented | ❌ target | ✅ has data | ❌ no OXD pattern | ❌ no grouping | — | — |
| M3 Click "I" | ❌ target | ✅ has data | ❌ generic click | — | — | ❌ bad locator |
| M4 Oversized targets | ❌ target | ✅ has data | — | — | — | ❌ bad locator |

## Key Insight
The new pipeline already addresses M3 and M4 (target-resolver.ts with 4-strategy cascade + captureAncestorClasses). M1 needs OXD dropdown pattern tuning. M2 needs OXD date picker pattern + lifecycle multi-event grouping.
