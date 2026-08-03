# Value/State Capture Expansion

## Goal

Fix value/state capture gaps across ALL interaction types for modern custom web components. Currently the recorder correctly *detects* interaction types (Slider, Checkbox, RadioButton, TextEntry) but fails to *capture the values* when elements are custom framework components (MUI, AntD, Headless UI, Radix UI, contenteditable editors) rather than native HTML elements.

## Root Causes

1. **`captureValue()` is HTML-native-only** — reads `el.value` on `<input>/<textarea>/<select>` but never reads `aria-valuenow`, `aria-valuetext`, or `textContent` for custom components.
2. **`captureCheckedState()` lacks CSS-class fallback** — reads `aria-checked` but not framework-specific checked classes (`.Mui-checked`, `.ant-checkbox-checked`).
3. **`DomContext` lacks value-state fields** — no `ariaValueNow`, `ariaValueMin`, `ariaValueMax`.
4. **`InteractionMetadata` incomplete** — no `sliderMin`, `sliderMax`.
5. **RadioButton `selectedValue` not mapped** — `accessibleName` available but never assigned to `selectedValue`.
6. **Timeline renderer** — no slider value/min/max phrasing.

## Phases

### Phase 1: Slider Value Capture (P0 Critical)
- Extend `captureValue()` to read `aria-valuenow`/`aria-valuetext` for `role="slider"`
- Extend `captureDomContext()` to capture `ariaValueNow`, `ariaValueText`, `ariaValueMin`, `ariaValueMax`
- Read native `el.min`/`el.max` for `<input type="range">`
- Add fields to `DomContext`: `ariaValueNow`, `ariaValueText`, `ariaValueMin`, `ariaValueMax`
- Add fields to `InteractionMetadata`: `sliderMin`, `sliderMax`
- Update DomProvider/AriaProvider to extract slider values from DomContext
- Update timeline renderer: "Adjust Price slider to ₹48,598 (range: ₹10,276 – ₹57,150)"

### Phase 2: Contenteditable Text Capture (P0 Critical)
- Extend `captureValue()` to read `textContent`/`innerText` for `isContentEditable` elements
- Fixes Quill, Draft.js, Slate, TinyMCE, CKEditor rich text editors

### Phase 3: RadioButton selectedValue (P1)
- Map `event.target.accessibleName` to `selectedValue` for RadioButton in AriaProvider and DomProvider
- Update timeline renderer: "Select 'Premium' radio button"

### Phase 4: Checkbox CSS-class Fallback (P1)
- Add framework-specific checked class detection to `captureCheckedState()`
- Check `.Mui-checked`, `.ant-checkbox-checked`, `.ant-radio-button-checked`, `[aria-checked="true"]`
- Relax `mousedown` snapshot gate to also snapshot when CSS-class-based checked state is available

### Phase 5: Slider Metadata Completeness (P2)
- Capture native `el.min`/`el.max` for native range inputs
- Update timeline renderer with min/max phrasing

## Constraints
- No content script recording behavior changes (event capture unchanged)
- No new providers
- Backward compatible — all 2,431 tests must pass
- Extended fields must be optional (not required)

## Acceptance Criteria
- [ ] Slider values captured for MUI/AntD/custom sliders (aria-valuenow + aria-valuetext)
- [ ] Slider min/max captured (aria-valuemin/aria-valuemax + native el.min/el.max)
- [ ] Contenteditable text captured (Quill/Draft.js/Slate)
- [ ] RadioButton selectedValue populated from accessibleName
- [ ] Checkbox CSS-class fallback for frameworks without ARIA
- [ ] Timeline renderer shows slider values
- [ ] All 2,431 existing tests pass
- [ ] ≥30 new tests
- [ ] Reviewer PASS, Infra_verifier PASS
