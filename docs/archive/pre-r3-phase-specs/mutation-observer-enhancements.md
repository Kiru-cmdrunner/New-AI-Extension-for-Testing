# MutationObserver Enhancements — Modals, Drawers, Popovers, Tooltips, Infinite Scroll

## Goal
Add real DOM mutation capture to the recorder and extend MutationProvider to detect dynamic UI surfaces (Modal, Drawer, Popover, Tooltip) and InfiniteScroll — unlocking 5 interaction types from a single architectural improvement.

## Architecture

### Approach: DOM Context Enrichment (not new event types)
Instead of adding `surface_open`/`surface_close` event types (which would require engine grouping changes), we **enrich the click event's DomContext** with mutation results. The click that triggered the surface gets a `surfaceType` field. MutationProvider reads this and emits evidence.

This is the lowest-risk path:
- No new event types → engine grouping unchanged
- The triggering click IS the interaction
- MutationProvider reads domContext.surfaceType on the click event
- Surface identity captured for the Observed Workflow display

### Changes

## 1. Extend DomContext (recorded-event.ts)
Add mutation-derived fields:
```typescript
export interface DomContext {
  inputType: string | null;
  ariaExpanded: boolean | null;
  ariaHasPopup: string | null;
  isContentEditable: boolean;
  // NEW: surface that appeared after this click
  surfaceType?: SurfaceType | null;
  surfaceRole?: string | null;      // aria role of the appeared element
  surfaceLabel?: string | null;     // accessible name of the appeared element
}
```

`SurfaceType = 'modal' | 'drawer' | 'popover' | 'tooltip' | null`

## 2. Add Surface Detection Observer (deterministic-recorder.ts)
- A persistent MutationObserver on `document.body` that activates for a **500ms window** after each click
- Observes `{childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-modal']}`
- When a mutation adds a visible element, classify it via `identifySurface()`
- Store result in the click event's DomContext
- Port `identifySurface()` from v2-event-observer.ts

### identifySurface() classification logic:
| Pattern | Surface Type |
|---|---|
| `role=dialog` or `aria-modal=true` | modal |
| `<dialog open>` | modal |
| class matches `/modal.*open\|open.*modal\|MuiDialog-root\|ant-modal/` | modal |
| `role=alertdialog` | modal |
| class matches `/drawer\|sidebar\|panel-(left\|right)\|MuiDrawer-root\|ant-drawer/` | drawer |
| transform: translateX + fixed position | drawer |
| `role=tooltip` | tooltip |
| class matches `/tooltip\|MuiTooltip-popper\|ant-tooltip/` | tooltip |
| `role=menu`, `aria-haspopup=menu` | popover |
| class matches `/popover\|dropdown-menu\|MuiPopover-root\|ant-popover/` | popover |
| `role=listbox`, `role=tree` | popover |
| fixed/absolute + z-index ≥ 100 + has clickable children | popover (fallback) |

## 3. Extend MutationProvider (mutation-provider.ts)

### onEvent():
- Read `domContext.surfaceType` from the event
- If surfaceType is present, emit evidence:
  - modal → Modal, confidence 0.85, weight 0.8
  - drawer → Drawer, confidence 0.85, weight 0.8
  - popover → Popover, confidence 0.8, weight 0.75
  - tooltip → Tooltip, confidence 0.8, weight 0.75

### onCommit() — InfiniteScroll:
- Check if buffer has scroll events
- If scroll events + the same container element appears in multiple events with increasing child counts (inferred from element count changes), emit InfiniteScroll evidence
- Conservative: confidence 0.6, weight 0.5 (needs scroll + content growth correlation)

## 4. Surface Classification Utility
Create `src/recorder/surface-detector.ts` with `identifySurface(node): SurfaceType` — pure function, testable in isolation. Ported and cleaned from v2-event-observer.ts.

## Files to Create/Change
1. **Modify** `src/recorder/recorded-event.ts` — add surfaceType/surfaceRole/surfaceLabel to DomContext
2. **Create** `src/recorder/surface-detector.ts` — identifySurface() function
3. **Modify** `src/recorder/deterministic-recorder.ts` — add click-triggered MutationObserver
4. **Modify** `src/classifier/evidence/providers/mutation-provider.ts` — emit evidence for surface types
5. **Create** `tests/evidence-engine/mutation-surfaces.test.ts` — surface detection tests
6. **Create** `tests/surface-detector.test.ts` — identifySurface() unit tests

## Acceptance Criteria
- [ ] Click on "Delete" button that opens a modal → Modal interaction detected
- [ ] Click on "Filters" button that opens a drawer → Drawer interaction detected
- [ ] Hover that reveals a tooltip → Tooltip interaction detected (via existing hover mutation path)
- [ ] Click that opens a popover menu → Popover interaction detected
- [ ] MUI Dialog detected via `MuiDialog-root` class
- [ ] AntD Modal detected via `ant-modal` class
- [ ] Bootstrap modal detected via `modal show` class
- [ ] Unknown dynamically appearing elements → no false positive evidence
- [ ] Surface metadata (role, label) captured for Observed Workflow display
- [ ] All existing tests pass
- [ ] identifySurface() tested in isolation with mocked DOM elements
