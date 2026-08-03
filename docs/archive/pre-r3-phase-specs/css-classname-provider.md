# CSS/Classname Provider

## Goal
Add a 5th evidence provider that detects UI framework component types by pattern-matching CSS class names. This unlocks detection for framework widgets without ARIA roles (older MUI, custom jQuery UI, Bootstrap patterns).

## Framework Class Patterns to Detect

### Material UI (MUI)
| Pattern | Type | Confidence |
|---|---|---|
| `MuiButton-root`, `MuiButtonBase-root` | Click | 0.75 |
| `MuiCheckbox-root` | Checkbox | 0.85 |
| `MuiRadio-root` | RadioButton | 0.85 |
| `MuiSwitch-root` | ToggleSwitch | 0.85 |
| `MuiSelect-root`, `MuiSelect-select` | NativeDropdown/CustomDropdown | 0.8 |
| `MuiTextField-root` with input | TextEntry | 0.6 |
| `MuiAutocomplete-root` | CustomDropdown | 0.8 |
| `MuiPickersDay-root`, `MuiCalendarPicker-root` | DatePicker | 0.9 |
| `MuiTabs-root`, `MuiTab-root` | Tab | 0.8 |
| `MuiAccordionSummary-root` | Click | 0.75 |
| `MuiSlider-root` | Click | 0.7 |

### Ant Design (AntD)
| Pattern | Type | Confidence |
|---|---|---|
| `ant-btn` | Click | 0.75 |
| `ant-checkbox` | Checkbox | 0.85 |
| `ant-radio` | RadioButton | 0.85 |
| `ant-switch` | ToggleSwitch | 0.85 |
| `ant-select` | CustomDropdown | 0.8 |
| `ant-input` | TextEntry | 0.6 |
| `ant-picker` (date picker) | DatePicker | 0.85 |
| `ant-tabs-tab` | Tab | 0.8 |
| `ant-slider` | Click | 0.7 |

### Bootstrap
| Pattern | Type | Confidence |
|---|---|---|
| `btn`, `btn-*` | Click | 0.6 |
| `form-check-input` with checkbox | Checkbox | 0.7 |
| `form-control`, `form-select` | NativeDropdown/TextEntry | 0.6 |
| `dropdown-item` | CustomDropdown | 0.7 |

### Tailwind / Generic UI Libraries
These don't have reliable class patterns — skip. Focus on MUI, AntD, Bootstrap.

## Architecture

- Provider name: `'css-classname'`
- Input: `event.target.className` (space-delimited string)
- Strategy: convert className to a set, check each class against pattern maps
- Output: Evidence with suggestedType + confidence + weight
- Event-type gating: same principle as other providers — Click-type suggestions only on click events

## Pattern Matching Approach

1. Split `className` into individual class tokens
2. For each token, check against framework-specific prefix patterns:
   - MUI: `/^Mui([A-Z][a-zA-Z]+)(?:-(root|root|contained|outlined|text))?$/`
   - AntD: `/^ant-([a-z]+(?:-[a-z]+)*)$/`
   - Bootstrap: `/^btn(?:-(primary|secondary|...))?$/`, `form-check-input`, etc.
3. Map matched component names to interaction types
4. Use conservative confidence (0.6-0.9) since class names are a heuristic signal

## Files to Create/Change
1. **Create** `src/classifier/evidence/providers/css-classname-provider.ts`
2. **Update** `src/classifier/evidence/detector.ts` — register provider
3. **Create** `tests/evidence-engine/css-classname-provider.test.ts`

## Acceptance Criteria
- [ ] MUI checkbox class detected as Checkbox
- [ ] MUI switch class detected as ToggleSwitch
- [ ] MUI select class detected as CustomDropdown
- [ ] MUI date picker day class detected as DatePicker
- [ ] MUI tab class detected as Tab
- [ ] AntD checkbox class detected as Checkbox
- [ ] AntD switch class detected as ToggleSwitch
- [ ] AntD select class detected as CustomDropdown
- [ ] AntD date picker class detected as DatePicker
- [ ] Bootstrap btn class detected as Click
- [ ] Unknown class names produce no evidence (no false positives)
- [ ] Provider does not emit evidence for navigation events
- [ ] Click-type suggestions only fire on click events (not mouseenter)
- [ ] All existing tests pass
- [ ] Provider registered in createDefaultProviders()
