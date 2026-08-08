# Capability Readiness Review — Complete Gap Analysis

**Date:** 2026-08-08
**Status:** Design review only — no implementation

## Summary
- 14 component definitions registered, 12 capability rules, 7 semantic effect categories
- **7 Critical gaps**, 28 High, 24 Medium, 18 Low
- Single highest-impact gap: observation windows only open for `click` and `change` events

## Top 5 Most Impactful Gaps

1. **Observation windows only for click/change** (recorder-entry.ts:362-365)
   - 70%+ of interactions (TextEntry, Slider, Hover, Scroll, DatePicker, ColorInput) have ZERO behavioral evidence
   - Fix: expand `onAfterEvent` triggers to all event types

2. **No drag/drop, pointer, or touch event capture** (event-tap.ts:298-305)
   - Entire class of modern interactions invisible
   - Fix: add pointerdown/up/move, drag/drop, touchstart/end/move event listeners

3. **CSS visibility / aria-hidden changes not interpreted** (effect-rules.ts)
   - Most common SPA show/hide mechanism produces "unclassified" mutations
   - Fix: add visibility-change effect rule for aria-hidden and computed style changes

4. **No aria-selected tracking**
   - Tab/listbox/tree selection invisible to both snapshot and effect rules
   - Fix: add aria-selected to ElementStateSnapshot, add selection-change effect rule

5. **No network/focus/selection evidence**
   - Cannot correlate actions with API calls, focus management, or text selection
   - Fix: add XHR/fetch interception, focus tracking, selection API capture

## Missing Interaction Types (No Definition)
- Drag-and-drop (HTML5 DnD + pointer-based)
- Multi-select (Ctrl/Shift+click)
- Rich text editor (formatting commands)
- Date range picker
- Carousel/gallery
- Canvas/drawing
- Autocomplete/typeahead (fragmented across TextEntry + Click)
- Map interaction (pan/zoom)
- Tag/chip input
- Rating/star selector
- Tree view
- Stepper/quantity counter
- Wizard/multi-step form
- Context menu (custom)
- Time picker (custom)

## Missing Capabilities (No Rule)
- DragAndDrop, MultiSelect, OpenModal/CloseModal
- EditText/FormatText, Draw/Sign, PanMap/ZoomMap
- RateItem, AddToCart, CopyText/PasteText, SelectText
- ZoomIn/ZoomOut, HoverReveal, ScrollToContent
- SetColor, SelectDate, SwitchTab, PlayMedia

## Missing Evidence Types
- Element value (post-interaction) not in PhysicalEvidence
- Form state (all field values at submit time)
- Focus state (active element before/after)
- Network request correlation
- Selection range
- Visual/spatial (bounding rect, computed style)
- Timing/dwell (general, not just Hover)
- Keyboard modifier state for clicks

## Proposed Roadmap (5 Phases)
1. **Observation Expansion** — open windows for all event types, add aria-selected/aria-hidden to snapshot
2. **Event Coverage Expansion** — pointer, drag, touch, clipboard, selection events
3. **Effect Interpretation Enhancement** — CSS visibility, class-based state, focus, network correlation
4. **New Component Definitions** — drag-drop, multi-select, autocomplete, carousel, rich text
5. **New Capability Rules** — match new definitions + fill gaps for existing types
