# Evidence Engine Real-World Validation

## Sites Tested

### 1. Avis Ford (avisford.com/service-appointment.aspx)
- Form lives in **cross-origin iframe** at guestxpui.ford.com
- 4 native `<select class="gxp-select">`: Make (45 options), Year (47), Model (disabled), Vehicle Type (5)
- 2 text inputs: VIN (type=text), Mileage (type=text)
- **No ARIA roles, no aria-expanded, no role attributes** — pure native HTML

### 2. Google Flights (google.com/travel/flights)
- Substituted for Adani One (adanione.com) which was geo-restricted/HTTP2-blocked
- Airport autocomplete: `<input role="combobox" aria-haspopup="true" aria-expanded="false">`
- Date input: `<input type="text" aria-label="Departure">` — **no type=date, no date markers**
- Class dropdown: `<div role="combobox" aria-haspopup="listbox">` with `<ul role="listbox"><li role="option">`
- Calendar cell: `<div role="gridcell" class="calendar-day">`

---

## Results by Interaction Type

### Native Dropdown (Avis Ford Make/Year)
| Metric | V1 (detectInteractions) | V2 (detectInteractionsV2) |
|--------|------------------------|--------------------------|
| Events per dropdown | 2 (CLK + CHG) | 1 interaction (click+change grouped) |
| Type | NativeDropdown | NativeDropdown |
| Confidence | N/A (deterministic) | 0.99 (DomProvider tag=SELECT) |
| selectedValue | ✅ | ✅ |

**Evidence trail:** DomProvider (tag=SELECT → NativeDropdown @ 0.99), EventSequence (click+change pattern → NativeDropdown @ 0.7)
**V1 parity:** ✅ Identical type and metadata

### Text Entry (Avis Ford VIN/Mileage)
| Metric | V1 | V2 |
|--------|----|----|
| Events per field | 2 (FOC + BLR) | 1 interaction (focus+blur grouped) |
| Type | TextEntry | TextEntry |
| Confidence | N/A | 0.9 (DomProvider onCommit focus→blur) |
| textValue | ✅ | ✅ |

**Evidence trail:** DomProvider (inputType=text → TextEntry @ 0.85 per event), DomProvider onCommit (focus→blur → TextEntry @ 0.9)

### Autocomplete / Custom Dropdown (Google Flights Airport)
| Metric | V1 | V2 |
|--------|----|----|
| Events detected | Click(s) on input + Click on option = 2+ separate interactions | 1 CustomDropdown |
| Type | Click | CustomDropdown |
| Confidence | N/A | 0.85+ (multi-provider) |
| selectedValue | ❌ | ✅ (from option accessibleName) |

**Evidence trail:**
- AriaProvider: role=combobox → CustomDropdown @ 0.85
- AriaProvider: aria-haspopup="true" → CustomDropdown @ 0.7
- AriaProvider onCommit: combobox+option pattern → CustomDropdown @ 0.85
- DomProvider: TextEntry suppressed via hasComboboxSemantics() check

**V1 gap:** V1 cannot detect CustomDropdown — produces generic Click events

### Material Design Dropdown (Google Flights Class)
| Metric | V1 | V2 |
|--------|----|----|
| Type | Click | CustomDropdown |
| Confidence | N/A | 0.85+ |

**Evidence trail:** AriaProvider (role=combobox → CustomDropdown), AriaProvider (aria-haspopup=listbox → CustomDropdown), AriaProvider onCommit (combobox→listbox→option pattern)
**Same V1 gap as autocomplete**

### Date Picker (Google Flights Departure Date)
| Metric | V1 | V2 |
|--------|----|----|
| Events | 2 separate Clicks (input + calendar cell) | 1 DatePicker (trigger+cell grouped) |
| Type | Click | DatePicker |
| Confidence | N/A | 0.7+ |
| dateValue | ❌ | ✅ (from gridcell accessibleName) |

**Evidence trail:**
- DomProvider: calendar cell click → DatePicker @ 0.9, weight 1.0
- DomProvider onCommit: calendar cell in buffer → DatePicker @ 0.7

**V1 gap:** V1 doesn't group input+cell — two separate Click events

### Full Booking Flow (4 interactions)
| Step | V1 | V2 |
|------|----|----|
| Departure autocomplete | Click | CustomDropdown |
| Destination autocomplete | Click | CustomDropdown |
| Class dropdown | Click | CustomDropdown |
| Date picker | 2× Click | DatePicker |
| **Total** | **6 interactions** | **4 interactions** |

---

## Engine Fixes Applied During Validation

### Fix 1: Combobox TextEntry Suppression
**Problem:** Google Flights airport input is `<input type="text" role="combobox">`. DomProvider emitted TextEntry (0.85) from inputType=text, which outvoted CustomDropdown from AriaProvider.
**Fix:** Added `hasComboboxSemantics()` check in DomProvider — if element has role=combobox/listbox, aria-expanded, or aria-haspopup, suppress TextEntry evidence entirely. Applied to both `onEvent()` and `onCommit()`.

### Fix 2: Broad Calendar Cell Grouping
**Problem:** Google Flights date input has no date-specific markers (no type=date, no calendar class). Engine couldn't link it to the subsequent gridcell click.
**Fix:** In engine `isRelatedToBuffer()`, added: ANY non-calendar-cell element followed by a gridcell click → grouped. Guard: gridcell→gridcell (consecutive date selections in range picker) are NOT grouped.

### Fix 3: Calendar Cell Evidence Boost
**Problem:** DatePicker evidence from calendar cell (0.8 confidence, 0.8 weight) was outvoted by residual TextEntry evidence from the text input.
**Fix:** Increased to 0.9 confidence, 1.0 weight. Calendar cells are unambiguous — no other interaction type produces gridcell clicks.

---

## Edge Cases & Limitations

### What Works Well
1. **Native HTML elements** — near-100% accuracy via tag/inputType
2. **ARIA-compliant widgets** (Material Design, React Aria) — strong detection via role+haspopup
3. **Multi-element grouping** — combobox+option, trigger+gridcell correctly buffered together

### Current Limitations (V2 Fallbacks to Generic Click/Change)
1. **Custom dropdowns without ARIA** — class-only detection (dropdown/select in className) has low confidence; may fall back to Click if class names are obfuscated
2. **Non-gridcell calendars** — if the calendar uses buttons without gridcell role or day/cell/date classes, detection fails
3. **Ant Design / complex enterprise widgets** — known to have incomplete ARIA; V2 may produce Click instead of the specific type
4. **Shadow DOM** — DomContext capture relies on reaching the element; shadow DOM boundaries may prevent context enrichment
5. **Cross-origin iframes** — Avis Ford form is in a cross-origin iframe; recorder captures events but DOM inspection for context is limited by same-origin policy (this is a recorder limitation, not an engine limitation)

### Confidence Threshold Observations
- COMMIT_THRESHOLD=0.5 works well — all real-world interactions scored above 0.7
- Lowest confidence seen: 0.7 (date picker with inferred calendar trigger — no explicit type=date)
- Highest confidence: 0.99 (native select, native checkbox/radio)

---

## Test Coverage
- **2071 tests** across **73 test files** — all passing
- **16 real-world tests** (5 Avis Ford + 11 Google Flights) built from actual DOM inspection
- **3 regression tests** from fixes (combobox TextEntry suppression, broad calendar grouping, gridcell→gridcell separation)

## Extension Build
- Built at `/workspace/download/cmdrunner-extension.zip` (804827 bytes)
- HTTP 200 at https://ai-extension-for-cmd-pjvh6e.drytis.dev/download/cmdrunner-extension.zip
