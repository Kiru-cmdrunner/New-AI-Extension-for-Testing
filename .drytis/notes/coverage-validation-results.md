# Pipeline V2 Real-World Coverage Validation Results

## Test Methodology
- Built the V2 observer as an injectable IIFE bundle via esbuild
- Used puppeteer-core with headless Chrome 147
- Mocked chrome.storage.local with pipeline_v2_enabled=true, ui_state.recordingState=recording
- Intercepted chrome.runtime.sendMessage to collect PIPELINE_EVENT messages
- Performed real DOM interactions on a test page with 16 widget categories
- Read back captured events after each interaction

## Results: 40/43 (93%) interaction types captured raw events

### Captured reliably (raw events observed):
- Buttons, Hyperlinks (click, focus, blur)
- Text/Password/Search/Textarea (focus, click, keydown, input, change, blur) 
- Checkboxes, Radios (click, change)
- Native select, Multi-select (change)
- Native date/time (change)
- Custom calendar (click on trigger + day cell)
- Date range (change on both inputs)
- ARIA combobox (click on trigger + option)
- CSS-only dropdown (click on trigger + option)
- ARIA checkbox, ARIA radio, Segmented control (click)
- Range slider (keydown, input)
- Tabs, Accordion custom + native (click)
- Hover menu (click)
- Autocomplete (focus, keydown, input, click on suggestion)
- Tree expand/collapse + select (click)
- Table sort + row checkbox (click, change)
- Modal/Dialog open + close (click)
- File upload click (focus, click, blur)
- Drag & drop (dragstart, dragend, drop!)
- Rich text editor (focus, click, keydown, input, blur)
- Shadow DOM button + checkbox (click, input)
- Form submit (submit event captured on FORM!)

### Not captured (3 types):
1. Toggle switch - test interaction error (node not clickable), not an observer gap
2. Virtualized list scroll - scroll listener is disabled by default (captureScroll=false)
3. Canvas click - canvas elements are not in INTERACTIVE_SELECTOR, events dropped by resolveTarget()

### Key findings:
- resolveTarget() returns null for canvas elements (no interactive ancestor)
- Scroll is intentionally disabled (captureScroll=false in DEFAULT_CONFIG)
- File upload captures focus/click/blur but does NOT read .files FileList
- Drag & drop events ARE captured (dragstart, dragend, drop) but no drop-target identification
- Rich text captures keydown/input/blur but no real-time editing state tracking
- Shadow DOM works via composedPath() for click events but state diff doesn't traverse shadow roots
- The full state snapshot includes all inputs, checkboxes, radios, toggles, ranges, open surfaces, active tabs, focused element
