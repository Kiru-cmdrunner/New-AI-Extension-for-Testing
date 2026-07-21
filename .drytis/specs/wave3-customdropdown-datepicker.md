# Wave 3 — CustomDropdown + DatePicker Migration Spec

## Goal

Validate that V2 outperforms V1 on multi-element interactions:
1. Custom Dropdowns (MUI, Ant Design, PrimeReact, custom implementations)
2. Date Pickers (native inputs, calendar popup widgets, React date pickers)

## Research Findings

### CustomDropdown — V2 mostly works, has one gap
- V1 **cannot** detect CustomDropdown at all (falls through to Click)
- V2 works for ARIA-compliant patterns via `isRelatedToBuffer()` + AriaProvider.onCommit()
- **Gap**: `isRelatedToBuffer()` checks cssSelector for aria-expanded/aria-haspopup but ignores `domContext.ariaExpanded/ariaHasPopup`. Fix: add domContext checks.
- **Gap**: Engine's option class detection (`option|choice|result`) is narrower than MutationProvider's (`option|item|choice|result`). Align.

### DatePicker — V2 is WORSE than V1
- V1 has 3 detection paths: native date inputs, calendar gridcell clicks, date-keyword text inputs
- V2 has only native date input detection (via DomProvider + domContext.inputType)
- **No calendar relationship detection** in `isRelatedToBuffer()` — trigger and gridcell are separate buffers
- **No provider logic** for calendar patterns (gridcell roles, calendar class names)
- Need to add: (a) calendar trigger→cell relationship in engine, (b) DatePicker detection logic in providers

## Implementation Plan

### Phase 1: Fix CustomDropdown engine gaps
1. Update `isRelatedToBuffer()` in engine.ts to check `domContext.ariaExpanded/ariaHasPopup`
2. Align option class pattern between engine and MutationProvider (`option|item|choice|result`)

### Phase 2: Add DatePicker calendar detection
1. Add calendar relationship detection to `isRelatedToBuffer()` — trigger (date input/calendar button) ↔ gridcell/calendar cell
2. Add calendar cell detection logic to DomProvider (gridcell role, calendar class patterns)
3. Add commit-time DatePicker detection to DomProvider or EventSequenceProvider

### Phase 3: Framework-specific tests
1. MUI Autocomplete (role=combobox, role=listbox, role=option — full ARIA)
2. Ant Design Select (role=combobox, partial option ARIA)
3. PrimeReact Dropdown (class-based, partial ARIA)
4. Native date input (inputType=date)
5. React DatePicker (calendar popup with gridcell)
6. Custom calendar widget (class-based)

## Acceptance Criteria

- [ ] MUI combobox: click trigger → click option → produces 1 CustomDropdown (not 2 Clicks)
- [ ] Ant Design Select: click trigger → click option → produces 1 CustomDropdown
- [ ] PrimeReact: click trigger → click option → produces 1 CustomDropdown
- [ ] Custom div dropdown: click trigger → click option → produces 1 CustomDropdown
- [ ] V2 detects CustomDropdown where V1 produces Click (V2 outperforms V1)
- [ ] Native date input (inputType=date) → 1 DatePicker with dateValue
- [ ] Calendar gridcell click → DatePicker with dateValue
- [ ] Calendar trigger → cell click → 1 DatePicker (not 2 Clicks)
- [ ] V2 matches or outperforms V1 on all date picker patterns
- [ ] Confidence scores and evidence trail present for all V2 detections
- [ ] Real-world scenario: form with custom dropdown + date picker → correct types
