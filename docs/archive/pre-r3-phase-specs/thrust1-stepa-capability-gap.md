# Thrust 1 Step A: Close the Capability Gap

> **Spec for:** Phase 2 Thrust 1, Step A
> **Goal:** Add Component Definitions for interaction types currently only handled by the V1 fallback classifier

## Context

The V1 fallback classifier (`interaction-detector.ts`) handles several interaction types that the Component Runtime has no definitions for. Before the V1 fallback can be safely retired (Step D), these capabilities must exist as Component Definitions.

## Current State Analysis

After code investigation:

1. **DoubleClick** — ALREADY HANDLED. The Click definition (priority 180) triggers on `dblclick` and sets `interactionSubtype = 'DoubleClick'`. The V1 detector also handles it. **No new definition needed.**

2. **RightClick** — PARTIALLY HANDLED. The Click definition triggers on `contextmenu` but produces a plain Click with no subtype. Need to add `interactionSubtype = 'RightClick'` for contextmenu events.

3. **BrowserAlert** — NOT CAPTURED. The DomContext type has no `triggeredDialog` field. The V1 type had it but no current capture code populates it. Need to: (a) add field to DomContext, (b) add capture in extractDomContext (or EventTap), (c) add definition.

4. **NewTab/NewWindow** — NOT CAPTURED. Same as BrowserAlert — `opensNewTab`/`opensNewWindow` fields exist in V1 types but no capture code populates them. Need to: (a) add fields to DomContext, (b) add capture, (c) add definitions.

5. **Breadcrumb** — NOT HANDLED. No definition exists. Detected by className patterns in V1. Need a definition.

## Files to Change

### 1. Extend DomContext (component-types.ts)

Add to `DomContext` interface:
```typescript
/** Whether a click triggered a native browser dialog (alert/confirm/prompt). */
triggeredDialog?: 'alert' | 'confirm' | 'prompt' | null;
/** Message shown in the triggered native dialog. */
dialogMessage?: string | null;
/** Dialog result: 'OK'/'Cancel' for confirm, entered text/null for prompt. */
dialogResult?: string | null;
/** Whether the clicked element opens a new browser tab (target=_blank). */
opensNewTab?: boolean | null;
/** Whether the clicked element opens a new browser window (window.open with features). */
opensNewWindow?: boolean | null;
/** URL that will be opened in the new tab/window. */
openedUrl?: string | null;
```

### 2. Extend extractDomContext (dom-context-extractor.ts)

Add detection for:
- `triggeredDialog`: Check if `window.dialogArguments` or a dialog polyfill is active. Actually, native dialogs (alert/confirm/prompt) are synchronous and block the thread — they can't be captured at event time. The V1 capture likely detected this differently (e.g., a flag set before/after the click). **Decision: Defer BrowserAlert to a later sub-step. The synchronous nature of native dialogs makes capture at event time impossible without a different mechanism (e.g., wrapping window.alert/confirm/prompt).**
- `opensNewTab`: Check if the clicked element is an `<a target="_blank">` or has an onclick that calls `window.open()`.
- `opensNewWindow`: Similar but with window features (width/height).

### 3. Add RightClick subtype to Click definition (click.ts)

In `buildResult`:
```typescript
const isRightClick = ctx.triggerEvent.eventType === 'contextmenu';
if (isRightClick) {
  ctx.data.interactionSubtype = 'RightClick';
}
```

### 4. Add NewTab/NewWindow definitions

Create `src/definitions/new-tab.ts` and `src/definitions/new-window.ts`:
- Priority: 65 (same tier as Link, before Click=180)
- Trigger: click where `domContext.opensNewTab === true` (or `opensNewWindow`)
- Immediate completion
- Metadata: `opensNewTab: true`, `openedUrl`

### 5. Add Breadcrumb definition

Create `src/definitions/breadcrumb.ts`:
- Priority: 72 (before Link=70)
- Trigger: click on element with breadcrumb CSS class patterns
- Immediate completion
- Metadata: `breadcrumbLevel` (if determinable), `crumbText`

### 6. Add Breadcrumb pattern to patterns.ts

```typescript
const BREADCRUMB_CLASS_RE = /\b(?:breadcrumb|crumb|breadcrumbs|bcrumb)\b/i;

export function isBreadcrumb(className: string | null): boolean {
  if (!className) return false;
  return BREADCRUMB_CLASS_RE.test(className);
}
```

### 7. Register new definitions in index.ts

Add NewTab, NewWindow, Breadcrumb to `ALL_DEFINITIONS`.

### 8. Add InteractionType values

Add `'NewTab'`, `'NewWindow'`, `'Breadcrumb'` to the `InteractionType` union in component-types.ts.

## Acceptance Criteria

- [ ] RightClick: contextmenu events produce Click with `interactionSubtype: 'RightClick'`
- [ ] NewTab: clicks on `target=_blank` links produce a NewTab interaction with `openedUrl`
- [ ] NewWindow: clicks triggering window.open with features produce a NewWindow interaction
- [ ] Breadcrumb: clicks on breadcrumb elements produce a Breadcrumb interaction
- [ ] BrowserAlert: DEFERRED — documented as a future enhancement (requires capture mechanism)
- [ ] All new definitions registered in ALL_DEFINITIONS
- [ ] All new types added to InteractionType union
- [ ] DomContext extended with opensNewTab/opensNewWindow/openedUrl fields
- [ ] extractDomContext populates new fields for `<a target="_blank">` elements
- [ ] Unit tests for each new definition
- [ ] `tsc --noEmit` passes with zero errors
- [ ] All existing tests pass
