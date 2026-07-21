# Phase 2 — Raw Interaction Type Detection

## Goal
Convert Phase 1's `RecordedEvent[]` into typed `DetectedInteraction[]`. Each interaction identifies WHAT the user did (click, text entry, checkbox toggle, etc.) using deterministic rules. No AI, no Playwright, no business intent, no plain English.

## Architecture

```
ReplayJson.events (Phase 1 output — RecordedEvent[])
    ↓
EventGrouper (segments events into interaction windows)
    ↓
TypeClassifier (applies detection rules to each window)
    ↓
DetectedInteraction[] (Phase 2 output)
```

Two new modules in `src/classifier/`:
- `interaction-types.ts` — All interaction type definitions, detection rules, metadata schemas
- `interaction-detector.ts` — EventGrouper + TypeClassifier pipeline, produces DetectedInteraction[]

## Two-Part Build

### Part A: Extend the Recorder
Phase 1 captures 5 event types (click, focus, input, change, blur). Phase 2 needs additional events for richer detection:
- `dblclick` — Double Click
- `contextmenu` — Right Click
- `scroll` — Page/Container Scroll
- `mouseenter` — Hover
- `dragstart` / `drop` — Drag & Drop
- Navigation transition type (back/forward/reload via webNavigation API)

### Part B: Classification Engine
Group raw events into interactions, then classify each group.

## Interaction Type Tiers

### Tier 1 — Deterministic from element identity + event patterns
| Type | Detection Rule | Confidence |
|------|---------------|------------|
| PageNavigation | navigation event | 1.0 |
| Back | navigation with transition type 'reload' (back/forward) | 1.0 |
| Forward | navigation with transition type 'forward_back' | 1.0 |
| Refresh | navigation with transition type 'reload' | 1.0 |
| Click | single click on non-control element | 1.0 |
| DoubleClick | dblclick event | 1.0 |
| RightClick | contextmenu event | 1.0 |
| Link | click on `<a>` element | 1.0 |
| TextEntry | focus→input(s)→blur on text input/textarea | 1.0 |
| Checkbox | click with checked transition on checkbox | 1.0 |
| RadioButton | click with checked transition on radio | 1.0 |
| ToggleSwitch | click on `[role=switch]` or `[aria-pressed]` | 1.0 |
| NativeDropdown | change on `<select>` element | 1.0 |
| Tab | click on `[role=tab]` | 1.0 |
| Menu | click on `[role=menuitem]` | 1.0 |
| FileUpload | change on `input[type=file]` | 1.0 |
| Hover | mouseenter event with no click | 1.0 |
| Scroll | scroll event | 1.0 |
| DragDrop | dragstart + drop events | 1.0 |

### Tier 2 — Defined but detected as Unknown (need future heuristics)
- CustomDropdown, Autocomplete, MultiSelect
- DatePicker, TimePicker, DateTimePicker
- Breadcrumb, BrowserAlert, Modal, Drawer, Popover, Tooltip
- NewTab, NewWindow, Iframe, InfiniteScroll, DragDropUpload

### Default
- UnknownInteraction — events that don't match any rule (confidence 0.0)

## Data Model

```typescript
interface DetectedInteraction {
  interactionId: string;        // "int-0001"
  type: InteractionType;        // e.g. "Click", "TextEntry", "Checkbox"
  eventIds: string[];           // raw event IDs that comprise this interaction
  rawEventTypes: string[];      // e.g. ["focus", "input", "blur"]
  target?: ElementIdentity;     // target element (for element interactions)
  metadata: InteractionMetadata; // type-specific captured data
  confidence: number;           // 1.0 for deterministic, 0.0 for Unknown
}

interface InteractionMetadata {
  url?: string;                  // Navigation: URL navigated to
  title?: string;                // Navigation: page title
  transitionType?: string;       // Navigation: how (link/reload/back_forward)
  textValue?: string;            // TextEntry: final text value
  checked?: boolean;             // Checkbox/Radio/Toggle: final state
  selectedValue?: string;        // Dropdown: selected option
  files?: string[];              // FileUpload: file names
  scrollPosition?: { x: number; y: number }; // Scroll: position
  hoverDuration?: number;        // Hover: milliseconds hovered
}
```

## Event Grouping Rules
1. Navigation events are standalone interactions
2. Element events on the same element within 500ms form one interaction
3. A focus→input(s)→blur sequence forms one TextEntry interaction
4. A dblclick or contextmenu is standalone (not grouped with click)
5. A scroll burst (multiple scrolls within 200ms) is one scroll interaction
6. dragstart→...→drop forms one DragDrop interaction

## Acceptance Criteria
- [ ] Recorder extended with dblclick, contextmenu, scroll, mouseenter, dragstart, drop events
- [ ] Navigation transition type captured (back/forward/reload)
- [ ] InteractionDetector takes RecordedEvent[] and produces DetectedInteraction[]
- [ ] All Tier 1 types detected deterministically (confidence 1.0)
- [ ] Tier 2 types defined but produce Unknown
- [ ] Each interaction includes interactionId, type, eventIds, rawEventTypes, target, metadata, confidence
- [ ] Event grouping correctly segments interactions (no over/under-grouping)
- [ ] Service worker produces DetectedInteraction[] on stop recording
- [ ] Side panel displays detected interactions (type badge + metadata)
- [ ] Unit tests for every Tier 1 detection rule
- [ ] Integration tests for multi-event sequences (text entry, checkbox, select, scroll)
- [ ] Extension builds without errors
- [ ] All tests pass
