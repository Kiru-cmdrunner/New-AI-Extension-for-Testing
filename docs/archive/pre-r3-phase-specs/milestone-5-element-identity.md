# Milestone 5 — Element Identity for Click

## Objective
Build a reliable Element Identity engine for click actions. Capture stable execution information for every clicked element. No Plain English, no JSON generation.

## Architecture — Data Flow

```
User clicks element → content script captures click →
  ElementIdentityEngine.extract(element) returns full identity →
  CLICK_CAPTURED message now includes full ElementIdentity payload →
    background generates Element ID (elem-0001) →
    associates Element ID with Action ID (click-0001) →
    persists ClickEvent with elementIdentity →
    side panel renders Element ID + identity details in timeline
```

## Type Definitions

```typescript
interface ElementIdentity {
  elementId: string;           // "elem-0001"
  accessibleName: string;      // computed accessible name
  ariaRole: string | null;     // explicit or implicit aria role
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
  placeholder: string | null;
  tag: string;
  name: string | null;         // form element name attribute
  stableId: string | null;     // element id attribute
  testId: string | null;       // data-testid
  dataCy: string | null;       // data-cy
  dataQa: string | null;       // data-qa
  // Hidden fallbacks
  cssSelector: string;
  xPath: string;
  // Context
  inIframe: boolean;
  shadowDom: boolean;
}

// ClickEvent.element is replaced by ClickEvent.elementIdentity
```

## New Files
- `src/recorder/element-identity-engine.ts` — full identity extraction
- `src/recorder/element-id-generator.ts` — generates elem-0001, elem-0002...
- `tests/element-identity.test.ts` — ElementIdGenerator + extraction tests

## Modified Files
- `src/shared/types.ts` — add ElementIdentity interface, update ClickEvent
- `src/recorder/click-content-script.ts` — use ElementIdentityEngine, include full identity in message
- `src/background/service-worker.ts` — generate Element ID, associate with Action ID
- `src/sidepanel/sidepanel.ts` — render Element ID badge + identity details
- `src/sidepanel/sidepanel.css` — element identity badge styles

## Acceptance Criteria
- [ ] Every click has a unique Element ID (elem-0001, elem-0002, ...)
- [ ] Captures: accessibleName, ariaRole, placeholder, ariaLabel, ariaLabelledBy, tag, name, stableId, testId, dataCy, dataQa
- [ ] CSS and XPath captured as hidden fallback selectors
- [ ] Works on normal pages
- [ ] Works inside iframes (inIframe flag set)
- [ ] Works with Shadow DOM elements (shadowDom flag set)
- [ ] Element ID is associated with the Action ID in the ClickEvent
- [ ] Element identity details displayed in side panel
- [ ] No Plain English or JSON generation
- [ ] Unit tests pass
- [ ] Extension builds, no console errors

## Edge Cases
- Element with no stable id or test attributes → CSS/XPath fallback
- Element inside iframe → content script in iframe captures, inIframe=true
- Element inside Shadow DOM → shadowDom=true, CSS selector includes host element
- Rapid clicks → each gets unique Element ID
