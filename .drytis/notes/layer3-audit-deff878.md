# Layer 3 — Enrichment / Meaning Audit (deff878)

Audit performed exclusively against `/workspace/tmp/deff878-audit` at commit deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8.

## Intended Behavior

The Enrichment Layer is a three-layer model applied to each ComponentInteraction after classification:

1. **Layer 1 (Interaction Type)** — already assigned by ComponentRuntime (Click, Dropdown, etc.)
2. **Layer 2 (Component Type)** — what UI component was interacted with (DataGrid, IconButton, SortButton, etc.)
3. **Layer 3 (Business Meaning)** — human-readable description of the user's intent ("Sort by Name", "Close dialog")

Design principles: pure functions, no DOM access, operates on the triggerEvent's ElementIdentity + DomContext only. Called from the `onEmit` callback inside the SW integration layer.

## Actual Behavior

### Component Detection (component-detector.ts, 281 LOC)

**Framework detection:** 11 framework regexes (MUI, AntDesign, PrimeReact, AGGrid, ChakraUI, RadixUI, OXD, Syncfusion, DevExtreme, Quill, TinyMCE). Checks own className + ancestorClasses combined into `allClasses`. Falls back to 'Generic'.

**Component type detection:** 17 first-match-wins rules using CSS class regexes + ARIA roles:
- SortButton (sort/sortable/column-header), GridToggle, DataGrid (ag-grid/MuiDataGrid + role=grid/gridcell/columnheader), TreeView, Accordion, Dialog, Drawer, Carousel, ContextMenu, Breadcrumb, Stepper, Autocomplete, RichTextEditor, ChipInput, SplitButton, ProgressBar, Rating, ToggleSwitch.
- Post-detection: IconButton detection (BUTTON with no accessibleName/ariaLabel) with extractIconName (Font Awesome, icon-*, MUI, OXD patterns + 68-entry ICON_SEMANTIC_NAMES map).
- Fallback: Alert, Tooltip, Spinner from CSS class regexes.
- Component data extraction: DataGrid → columnName from accessibleName. SortButton → columnName from accessibleName.

### Meaning Resolution (meaning-resolver.ts, 186 LOC)

Two-stage switch:
1. **Component-type-specific** (18 cases): IconButton → "Click X button", SortButton → "Sort by column", DataGrid → "Click column in data grid", Rating → "Rate N stars for X", ToggleSwitch → "Enable/Disable X", Breadcrumb → "Navigate to X via breadcrumb", etc.
2. **Interaction-type-specific fallback** (14 cases): Click → "Click name", TextEntry → "Enter val in name", Dropdown → "Select val from name", etc.
3. Final default: `${type} on "${targetName}"`.

### Integration (enrich.ts, 54 LOC)

`enrichInteraction(interaction)`:
1. Calls `detectComponent(interaction.triggerEvent)` → ComponentDetectionResult
2. Calls `resolveMeaning(interaction, detection)` → string
3. Mutates interaction: sets `componentType`, `componentFramework`, `businessMeaning`

`enrichInteractions(interactions)`: loops over array, calls enrichInteraction on each.

### Data Consumed

- **Input:** `interaction.triggerEvent` (the first event of the lifecycle) — specifically `triggerEvent.target` (ElementIdentity: className, tag, ariaRole, accessibleName, ariaLabel) and `triggerEvent.domContext` (ancestorClasses, isContentEditable).
- **Also reads:** `interaction.metadata` (targetName, checked, textValue, selectedValue, value, dateValue/selectedDate, fileName, pageUrl/pageTitle) and `interaction.type`.
- **Does NOT read:** memberEvents, behavioralObservations, endState, interactionId.

### Data Produced

Mutates `ComponentInteraction` adding three optional fields:
- `componentType?: ComponentType` (25 possible values or 'Generic')
- `componentFramework?: ComponentFramework` (13 possible values or 'Generic')
- `businessMeaning?: string`

## Correctness Analysis

### What Works

- **Framework detection** is sound for the 11 targeted frameworks. Regex patterns are specific enough to avoid most false positives.
- **SortButton before DataGrid ordering** is correct — grid headers with sort classes match SortButton first.
- **IconButton detection** with ICON_SEMANTIC_NAMES is a thoughtful fallback for icon-only buttons that lack accessible names.
- **Meaning resolution** produces useful human-readable strings for all 15 interaction types and 18+ component types.
- **Pure functions** — no DOM access, no side effects beyond the interaction mutation. Fully testable in jsdom.
- **Graceful degradation** — Generic + Generic + fallback meaning for unrecognized elements.

### Integration Point Analysis

Enrichment is called from exactly **2 places** in sw-integration.ts:
1. Line 136: `onEmit` callback in `initRecording()` — fires for each interaction emitted during normal `process()` calls. ✓
2. Line 333: `onEmit` callback in `restoreFromStorage()` — fires for interactions emitted after SW restart recovery. ✓

**NOT called from:**
- `stopRecording()` flush path (line 162-170) — flushed interactions are NOT enriched.
- Projection Engine output — Unclassified interactions are NOT enriched.

### Test Coverage

Single test file: `tests/enrichment.test.ts` (490 lines). Tests:
- Framework detection: MUI, AGGrid, AntDesign, OXD, ChakraUI, RadixUI (6 tests).
- Component detection: DataGrid, IconButton, SortButton, Dialog, TreeView, generic (6 tests).
- Icon extraction: fa-search → Search, fa-trash → Delete (2 tests).
- Meaning resolution: SortButton, GridToggle, IconButton, Rating, ToggleSwitch, Breadcrumb, generic Click, generic TextEntry, generic Dropdown (9 tests).
- Integration: MUI IconButton, AG Grid SortButton, field preservation, Chakra ToggleSwitch (4 tests).
- Edge cases: null className, empty ancestorClasses (2 tests).
- **MISSING tests:** Dropdown interaction meaning, Checkbox meaning, DatePicker meaning, Scroll meaning, Navigation meaning, FileUpload meaning, Slider meaning, ColorInput meaning, Hover meaning, Link meaning, Tab meaning, RadioButton meaning. (14 of 15 interaction types have no meaning-resolution test.)

## Technical Debt / Issues

### 🔴 CRITICAL

**3-C-1: Flush path does not enrich — Scroll and interrupted lifecycles have no componentType/businessMeaning**
- `stopRecording()` calls `runtime.flush()` which returns interactions directly (bypasses onEmit).
- The flush loop calls `attachPendingBehavioralObservations` but does NOT call `enrichInteraction`.
- Scroll interactions (always completed via flush on stop), interrupted TextEntry/Slider/ColorInput/DatePicker, and abandoned Dropdowns all reach the side panel and output adapter WITHOUT enrichment fields.
- **Impact:** Side panel shows no component badge and falls back to `fallbackActionDescription`. Output adapter exports `undefined` for all three fields. Playwright descriptions use the generic `getElementDisplayName` path.

**3-C-2: Unclassified interactions never enriched — no component detection, no business meaning**
- Projection Engine creates Unclassified stubs from ledger entries with minimal ElementIdentity (className=null, tag/name/role only).
- `stopRecording()` returns projection.interactions directly — no enrichInteraction call.
- Even if enrichInteraction WERE called, `detectComponent` receives the stub's `triggerEvent` whose `target.className` is `null` — detection would always return Generic/Generic.
- **Impact:** All Unclassified interactions display as Generic with fallback meaning `${type} on "${targetName}"` where targetName comes from the ledger's diagnostic identity (which may be 'element' from bestName).

**3-C-3: Enrichment data is disconnected from Capability Engine**
- The capability engine (Layer 5) has zero references to `componentType`, `componentFramework`, or `businessMeaning`.
- Capabilities are inferred purely from `ComponentInteraction.type` + `SemanticEffect[]` + keyword matching.
- Enrichment's component type detection ("SortButton", "DataGrid", etc.) is never used to inform capability inference.
- **Impact:** The three-layer enrichment model is display-only metadata. It does not contribute to semantic understanding or capability classification.

### 🟠 HIGH

**3-H-1: detectComponent uses only triggerEvent, ignoring memberEvents**
- For a Dropdown, the triggerEvent is the opening click/mousedown/focus on the dropdown trigger. The option selection (memberEvent) carries the actual selected value and option identity.
- `detectComponent` sees the trigger element's classes (e.g., `oxd-select-text`) — this is usually correct for detecting Dropdown as a component type.
- But for DataGrid cell clicks, the triggerEvent IS the cell click — correct for detecting DataGrid. ✓
- For Autocomplete, the triggerEvent is the combobox input — correct for detecting Autocomplete from CSS classes. ✓
- **Issue:** When triggerEvent is focus (TextEntry, Slider, ColorInput, DatePicker), the focused element's identity is correct but its classes may not reveal the parent component. E.g., focusing an INPUT inside a `div.search-bar` — ancestorClasses should catch it, but detection only runs on `ownClasses + ancestorClasses.join(' ')`, which includes ancestors. ✓ Actually correct.

**3-H-2: SORT_RE is too broad — 'sort' matches any class containing 'sort'**
- `/\b(?:sort|sortable|column-header)\b/i` matches any element with 'sort' in any class.
- A CSS class like `resort-link` or `assortment-grid` would match (word boundary `\b` doesn't prevent `sort` matching within `resort` because `\b` matches at the `r|s` boundary... actually `\bsort\b` would NOT match `resort` because there's no word boundary between 're' and 'sort'. But `sort-filter` WOULD match.
- **Actual risk:** A button with class `sort-asc` correctly matches. A div with class `unsorted-list` does NOT match (because `\b` requires boundary). Low risk.

**3-H-3: DIALOG_RE matches 'overlay' and 'popup' — extremely broad**
- `/\b(?:modal|MuiDialog|ant-modal|p-dialog|dialog|popup|overlay)\b/i`
- 'overlay' appears in many non-dialog contexts: `image-overlay`, `map-overlay`, `card-overlay`, `overlay-backdrop`.
- 'popup' appears in: `popup-trigger`, `popup-menu` (which would match ContextMenu too, but Dialog is checked first).
- **Impact:** Clicking any element with 'overlay' or 'popup' in its class ancestry is classified as Dialog, overriding more specific types like ContextMenu.

**3-H-4: CAROUSEL_RE matches 'slide' — false positives on sliders/carousels**
- `/\b(?:carousel|swiper|slick|slide|slider-track)\b/i`
- 'slide' matches `slide-toggle`, `slide-menu`, `slide-reveal`, `slide-animation`, `toggleslide`.
- A range slider wrapper with class `slide-container` would be detected as Carousel.
- **Impact:** Slider/ToggleSwitch interactions inside elements with 'slide' in ancestor classes are misclassified as Carousel.

**3-H-5: TOGGLE_SWITCH_RE matches 'switch' — catches unrelated 'switch' classes**
- `/\b(?:toggle-switch|switch|MuiSwitch|ant-switch|p-toggleswitch)\b/i`
- 'switch' alone matches `switch-theme`, `switch-view`, `switch-language`, `switch-account`, `network-switch`.
- Any element with 'switch' in any ancestor class is classified as ToggleSwitch.
- **Impact:** Buttons for "Switch Language", "Switch View" are classified as ToggleSwitch components instead of Generic/IconButton.

**3-H-6: SPINNER_RE matches 'loading' and 'loader' — catches loading containers**
- `/\b(?:spinner|loading|loader|progress-spinner|preloader)\b/i`
- A form inside a `div.loading-state` would have every element classified as Spinner.
- **Impact:** Entire loading-overlay subtrees are misclassified.

**3-H-7: detection operates on triggerEvent.target only, not the interaction's full context**
- For multi-event lifecycles (Dropdown, DatePicker), the completion event (memberEvent) may carry richer identity for the option/cell element.
- But detectComponent only sees the trigger. If the trigger is a combobox INPUT with `role="combobox"`, it won't match DataGrid even if the combobox is inside a grid.
- This is by design (detection at trigger time, not completion time) but limits accuracy for compound components.

### 🟡 MEDIUM

**3-M-1: extractIconName MUI fallback iterates all ICON_SEMANTIC_NAMES entries with RegExp construction**
- For unrecognized icon classes, the fallback loop creates a new RegExp for each of the 68 entries: `new RegExp(\`\\b(?:${key}|icon-${key}|fa-${key})\\b\`, 'i')`.
- 68 regex tests per unrecognized icon button. Not a performance concern at normal scale, but inefficient.

**3-M-2: No detection for common component types: TabBar, Badge, FileUpload (as component), Autocomplete completion**
- `ComponentType` union includes 'TabBar', 'Badge', 'FileUpload' but no DETECTION_RULES exist for them.
- TabBar is never detected (tabs are caught by interaction type, not component type).
- Badge and FileUpload as component types are unreachable.

**3-M-3: meaning-resolver Scroll case always returns "Scroll page" regardless of metadata**
- Scroll metadata may include scrollType ('page' or 'container'), deltaY, deltaX — none are used.
- A scroll on a specific container is described as "Scroll page".

**3-M-4: meaning-resolver doesn't use componentFramework**
- Framework information is detected but never used in meaning generation.
- E.g., MUI vs Ant Design could provide different tooltip text, but doesn't.

**3-M-5: enrichInteraction mutates the interaction in place**
- Returns the same object. If the caller retains a reference to the pre-enrichment state, it's silently modified.
- This is documented ("mutates the interaction object") but creates coupling.

**3-M-6: Unclassified interactions would crash detectComponent if enrichment were attempted**
- Unclassified stubs have `triggerEvent.domContext` with all fields null/false/empty arrays.
- `detectComponent` accesses `domContext.ancestorClasses.join(' ')` — works on empty array (returns '').
- `domContext.isContentEditable` — works (false).
- Would NOT crash, but would always return Generic/Generic. (Corrected from initial concern.)

**3-M-7: Component detection order can cause SortButton/DataGrid conflicts**
- SortButton is checked before DataGrid (correct for headers). But if a non-header element inside a DataGrid has 'sort' in its class, it's classified as SortButton instead of DataGrid.
- E.g., a row action button with class `sort-rows-action` inside an AG Grid would be SortButton.

**3-M-8: detectFramework and detectComponent use different scope — framework from allClasses, component from allClasses**
- Both use the same `allClasses = ownClasses + ancestorClasses`. This means a framework class on a distant ancestor triggers framework detection for every descendant interaction.
- E.g., every click inside a `div.MuiDrawer-paper` is framework=MUI, even if the clicked element is a plain native button.

### 🟢 LOW

**3-L-1: ComponentDetectionResult has `businessMeaning: string` field that's always empty**
- detectComponent returns `businessMeaning: ''` at line 278. The actual meaning is resolved separately by resolveMeaning.
- The field exists for interface completeness but is dead data.

**3-L-2: meaning-resolver 'uncategorized' default case includes Scroll and Unclassified**
- Scroll has its own case in the interaction-type switch (line 173: "Scroll page").
- Unclassified would hit the final default: `Unclassified on "element"`.

**3-L-3: No HeadlessUI in FRAMEWORK_CLASS_RE despite being in ComponentFramework type**
- 'HeadlessUI' is a valid ComponentFramework but has no detection regex. HeadlessUI components would be detected as 'Generic' framework.

**3-L-4: RichTextEditor detection triggers for any contentEditable element**
- `_dc.isContentEditable` → RichTextEditor. A simple contentEditable div (not a rich text editor) is classified as RichTextEditor.
- Common in Gmail, Notion, and other apps that use contentEditable for simple text.

**3-L-5: No test covers enrichment in the flush/projection paths**
- No test verifies that stopRecording() output includes enrichment for all interaction types.
- No test verifies Unclassified interaction enrichment behavior.

## Summary

The Enrichment Layer is well-designed as a pure-function pipeline but has a fundamental **integration gap**: it only runs in the `onEmit` callback, missing the flush and projection paths. This means Scroll interactions, interrupted lifecycles, and all Unclassified interactions reach consumers without component type, framework, or business meaning data. The enrichment data is also completely disconnected from the Capability Engine — it's display-only metadata that doesn't influence semantic classification.
