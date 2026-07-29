# Three-Layer Component Model

## Overview

Every captured interaction is enriched with three layers of meaning:

1. **Layer 1 — Interaction Type** (already existed)
   - What the user *did*: Click, TextEntry, Dropdown, Checkbox, RadioButton,
     DatePicker, Slider, FileUpload, Tab, Hover, Link, Scroll, Navigation

2. **Layer 2 — Component Type** (NEW: `src/enrichment/component-detector.ts`)
   - What UI component was interacted with: DataGrid, TreeView, SortButton,
     IconButton, Dialog, Drawer, Accordion, ContextMenu, Breadcrumb, Stepper,
     Autocomplete, RichTextEditor, ChipInput, SplitButton, Rating, ToggleSwitch,
     GridToggle, Carousel, ProgressBar, Alert, Tooltip, Spinner, FileUpload, Badge

3. **Layer 3 — Business Meaning** (NEW: `src/enrichment/meaning-resolver.ts`)
   - Human-readable description of the user's intent:
     "Sort by Name", "Close dialog", "Switch to Grid View", "Rate 4 stars"

## Architecture

```
ObservedEvent → ComponentRuntime → ComponentInteraction (Layer 1)
                                        ↓
                                  enrichInteraction()
                                        ↓
                                detectComponent() → Layer 2
                                        ↓
                                resolveMeaning() → Layer 3
                                        ↓
                              ComponentInteraction {
                                type, metadata,           // Layer 1
                                componentType,            // Layer 2
                                componentFramework,       // Layer 2
                                businessMeaning           // Layer 3
                              }
```

### Integration Point

The enrichment runs in the `onEmit` callback in `src/runtime/sw-integration.ts`,
immediately after the Component Runtime emits a completed interaction. This is
the single integration point — all emitted interactions are enriched before
being persisted or displayed.

### Framework Detection

Detects MUI, AntDesign, PrimeReact, AG Grid, ChakraUI, RadixUI, OXD, Syncfusion,
DevExtreme, Quill, TinyMCE from CSS class patterns.

### Component Type Detection

Cascading rule system (first match wins):
1. Specific structural elements first (SortButton, GridToggle before DataGrid)
2. Framework-specific CSS class patterns
3. Semantic ARIA roles + structural patterns
4. IconButton detection (button with no text)
5. Generic fallback

### Icon Detection

Recognizes common icon patterns (Font Awesome, Material Icons, Heroicons) and
maps them to semantic names: Close, Delete, Edit, Add, Search, Filter, Download,
Refresh, Settings, Notifications, Menu, More options, etc.

## Files

- `src/enrichment/component-types.ts` — Type definitions (ComponentType, ComponentFramework, etc.)
- `src/enrichment/component-detector.ts` — Layer 2: Component type detection
- `src/enrichment/meaning-resolver.ts` — Layer 3: Business meaning resolution
- `src/enrichment/enrich.ts` — Integration entry point
- `src/enrichment/index.ts` — Public API barrel
- `src/shared/component-types.ts` — Extended ComponentInteraction with enrichment fields
- `src/runtime/sw-integration.ts` — Wired enrichInteraction into onEmit
- `src/sidepanel/interaction-renderer.ts` — Displays all three layers
- `src/presentation/output-adapter.ts` — Passes enrichment data to IR actions
- `tests/enrichment.test.ts` — 28 tests covering all layers

## Acceptance Criteria

- [x] ComponentInteraction type includes componentType, componentFramework, businessMeaning
- [x] enrichInteraction() called in onEmit pipeline
- [x] detectComponent() identifies 25+ component types
- [x] detectComponent() identifies 12 frameworks
- [x] resolveMeaning() generates human-readable descriptions
- [x] Icon buttons detected and named (search, filter, close, delete, etc.)
- [x] SortButton → "Sort by Name"
- [x] GridToggle → "Switch to Grid View"
- [x] IconButton → "Click [icon] button"
- [x] Rating → "Rate N stars for [target]"
- [x] ToggleSwitch → "Enable/Disable [target]"
- [x] Side panel displays component type badge + framework tag
- [x] Side panel displays business meaning as primary description
- [x] IR actions carry componentType, componentFramework, businessMeaning
- [x] All 3,361 tests pass (28 new enrichment tests)
