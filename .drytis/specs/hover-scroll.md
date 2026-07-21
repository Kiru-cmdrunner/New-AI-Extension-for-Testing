# Milestone – Enterprise Hover & Scroll Recording

## Objective
Implement Hover and Scroll recording through the existing Interaction Registry. Only meaningful interactions are recorded — not every mouse movement or accidental scroll.

## Files to Change

### types.ts
- Add `HoverEvent` interface: `{ actionId, type:'hover', timestamp, elementIdentity, hoverTarget?: string }`
- Add `ScrollEvent` interface: `{ actionId, type:'scroll', timestamp, elementIdentity, scrollDirection:'up'|'down', scrollTarget?: string, scrollPosition?: number }`
- Widen `SessionEvent` union to include HoverEvent | ScrollEvent
- Widen `ActionType` to include `'hover' | 'scroll'`
- Add execution JSON fields: `hoverTarget`, `scrollDirection`, `scrollTarget`, `scrollPosition`
- Add messages: `HOVER_DETECTED` (payload: HoverPayload), `SCROLL_DETECTED` (payload: ScrollPayload)
- Add `HoverPayload` and `ScrollPayload` interfaces
- Add new message types to `AppMessage` union and `isAppMessage` validator

### interaction-types.ts
- Import HoverEvent, ScrollEvent
- Widen `ActionEventType`, `ActionExtras` (add hoverTarget, scrollDirection, scrollTarget, scrollPosition)
- Register `hoverConfig` and `scrollConfig`
- hover: badgeColor=#7c3aed, badgeLabel='HOVER', idPrefix='hover'
- scroll: badgeColor=#6b7280, badgeLabel='SCROLL', idPrefix='scroll'

### recording-session.ts
- Add generators: ['hover', new ActionIdGenerator('hover')], ['scroll', new ActionIdGenerator('scroll')]
- Add switch cases for 'hover' and 'scroll' in addAction
- Widen addAction signature and return type

### service-worker.ts
- Add HOVER_DETECTED and SCROLL_DETECTED message routing via processAction

### step-builder.ts
- Widen ActionEvent union, generatePlainEnglish signature, buildStep event field access

### timeline-renderer.ts
- Widen ActionEvent union

### ai-understanding.ts
- Add hoverTarget, scrollDirection, scrollTarget, scrollPosition to ActionElementInfo

### New files
- `src/recorder/hover-content-script.ts` — meaningful hover detection
- `src/recorder/scroll-content-script.ts` — meaningful scroll detection

### manifest.json
- Add 2 content script entries
- Bump version to 1.13.0

### sidepanel.css
- Add badge colors for hover and scroll

## Hover Detection Strategy
- Listen to `mouseover` with debounce (500ms settle)
- Only record hovers on interactive elements: links, buttons, nav items, elements with role=menuitem/menu/tab/tooltip, elements that have hover-triggered behavior
- Skip: mouseover on body, plain text, divs without interactive semantics
- Dedup: don't record the same element twice within 2s
- Framework support: native HTML, MUI (Tooltip, Menu), Ant Design (Dropdown, Menu), React/Angular components

## Scroll Detection Strategy
- Listen to `scroll` events on window AND scrollable containers
- Debounce: wait 500ms after scroll stops
- Threshold: minimum 200px total scroll distance per debounce window
- Direction: 'up' or 'down' based on net delta
- Target: identify what section was scrolled to (nearest heading/section before viewport center)
- Dedup: don't record scroll on same container within 1.5s

## Plain English
- Hover: `Hover over the "Flights" menu.`
- Scroll: `Scroll to the "Payment Details" section.` or `Scroll down on the page.`

## Execution JSON
```json
// Hover
{ "action": "hover", "hoverTarget": "Flights menu" }

// Scroll
{ "action": "scroll", "direction": "down", "target": "Payment Details" }
```

## Acceptance Criteria
- [ ] Meaningful hover actions are recorded (not every mouse movement)
- [ ] Meaningful scroll actions are recorded (not every scroll tick)
- [ ] Duplicate hover/scroll events are prevented (debounce + dedup)
- [ ] Hover plain English: `Hover over the "X" menu.`
- [ ] Scroll plain English: `Scroll to the "X" section.` / `Scroll down on the page.`
- [ ] Execution JSON includes action, hoverTarget / direction + target
- [ ] Action IDs: `hover-NNNN`, `scroll-NNNN`
- [ ] Element ID, iframeContext, Screenshot, Repository reused
- [ ] All 377 existing tests pass without modification
- [ ] New tests added for hover and scroll
