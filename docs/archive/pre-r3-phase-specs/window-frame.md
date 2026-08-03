# Window & Frame Completion — Browser Alert, New Tab, New Window, Iframe

## Goal
Complete detection for the final four interaction types in the Semantic Interaction Engine: BrowserAlert, NewTab, NewWindow, and Iframe. All four exist in the enum as TIER2 but have zero detection logic, no metadata, no timeline phrasing, and no tests.

## Current State

| Type | Enum | Detection | Metadata | Timeline | Tests |
|------|------|-----------|----------|----------|-------|
| **BrowserAlert** | ✅ | ❌ | ❌ | ❌ (falls through to default) | ❌ |
| **NewTab** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **NewWindow** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Iframe** | ✅ | ❌ (enrichment exists via `inIframe` on ElementIdentity) | ❌ | ❌ | ❌ |

## Architecture — Detection Strategy

Unlike previous categories (CSS classes, ARIA roles, native input types), Window & Frame types need detection signals that span the content script (DOM-level), the page world (JavaScript interception), and the service worker (Chrome API level).

### BrowserAlert — Native Dialog Interception
`window.alert()`, `window.confirm()`, `window.prompt()` are synchronous browser dialogs that block the page. They can't be captured by DOM event listeners. Content scripts run in an isolated world, so they can't directly override page-level `window.alert`.

**Solution**: Inject a page-world script at `document_start` that wraps `alert`/`confirm`/`prompt`. The wrapper sets a temporary attribute on `document` before the dialog blocks. After the click event's event loop turn completes (the dialog has been shown and dismissed), a `setTimeout(0)` callback reads the attribute, cleans it up, and augments the click event's `domContext`.

### NewTab / NewWindow — Click + Element Analysis
Two detection signals:
1. **`<a target="_blank">`**: Detected at click time by reading `element.target` or `element.getAttribute('target')`.
2. **`window.open()`**: Intercepted via the page-world script wrapper (same technique as alert/confirm/prompt).

NewTab = opens a new browser tab (target="_blank", window.open without window features).
NewWindow = opens a new browser window (window.open with width/height/features).

### Iframe — Enrichment + Navigation Detection
Two aspects:
1. **Iframe enrichment**: When an interaction occurs inside an iframe (`target.inIframe === true`), enrich metadata with iframe context. The timeline phrasing includes iframe context.
2. **Iframe navigation**: When a navigation occurs in a sub-frame (frameId !== 0 in webNavigation API), detect as an Iframe interaction.

## Implementation

### Phase 1: Metadata & Types

#### `src/classifier/interaction-types.ts` — InteractionMetadata
```typescript
// Browser Alert (alert/confirm/prompt)
dialogType?: string;         // 'alert' | 'confirm' | 'prompt'
dialogMessage?: string;      // message shown in the dialog
dialogResult?: string;       // user response (confirm: 'OK'/'Cancel', prompt: entered text or 'Cancelled')

// New Tab / New Window
openedUrl?: string;          // URL opened in the new tab/window
openedTitle?: string;        // title of the opened page (if available)

// Iframe
iframeSrc?: string;          // iframe source URL
iframeName?: string;         // iframe name attribute
iframeDepth?: number;        // nesting depth (1 = direct child of top)
```

Move all four types from TIER2 to TIER1 (now have detection logic).

#### `src/recorder/recorded-event.ts` — DomContext
```typescript
/** When a click triggers a native browser dialog. */
triggeredDialog?: 'alert' | 'confirm' | 'prompt' | null;
/** Message shown in the triggered dialog. */
dialogMessage?: string | null;
/** Dialog result: 'OK'/'Cancel' for confirm, text/null for prompt. */
dialogResult?: string | null;
/** Whether the clicked element opens a new tab (target=_blank or window.open). */
opensNewTab?: boolean | null;
/** Whether the clicked element opens a new window (window.open with features). */
opensNewWindow?: boolean | null;
/** URL that will be opened (from href or window.open argument). */
openedUrl?: string | null;
```

### Phase 2: Content Script — Page-World Interception

#### `src/recorder/deterministic-recorder.ts`

**2a. Page-world script injection** (at document_start, before any page script runs):
```javascript
(function() {
  var origAlert = window.alert;
  var origConfirm = window.confirm;
  var origPrompt = window.prompt;
  var origOpen = window.open;

  window.alert = function(msg) {
    document.documentElement.setAttribute('data-cmdrunner-dialog',
      JSON.stringify({type:'alert', message:String(msg)}));
    return origAlert.call(this, msg);
  };
  window.confirm = function(msg) {
    var result = origConfirm.call(this, msg);
    document.documentElement.setAttribute('data-cmdrunner-dialog',
      JSON.stringify({type:'confirm', message:String(msg), result:result}));
    return result;
  };
  window.prompt = function(msg, def) {
    var result = origPrompt.call(this, msg, def);
    document.documentElement.setAttribute('data-cmdrunner-dialog',
      JSON.stringify({type:'prompt', message:String(msg), result:result}));
    return result;
  };
  window.open = function(url, target, features) {
    var hasFeatures = features && (features.includes('width') || features.includes('height'));
    document.documentElement.setAttribute('data-cmdrunner-window-open',
      JSON.stringify({url:url||'', target:target||'', isWindow:!!hasFeatures}));
    return origOpen.call(this, url, target, features);
  };
})();
```

**2b. Click handler augmentation**: After a click is captured, schedule a `setTimeout(0)` to check for dialog/window-open attributes:
```javascript
// In click handler, after capturing the click event:
setTimeout(function() {
  var dialogAttr = document.documentElement.getAttribute('data-cmdrunner-dialog');
  var openAttr = document.documentElement.getAttribute('data-cmdrunner-window-open');
  if (dialogAttr || openAttr) {
    // Re-send the click event with augmented domContext
    // (or send a supplementary event)
  }
  // Clean up
  document.documentElement.removeAttribute('data-cmdrunner-dialog');
  document.documentElement.removeAttribute('data-cmdrunner-window-open');
}, 0);
```

**2c. `target="_blank"` detection**: In the click handler, check the clicked element:
```javascript
if (target instanceof HTMLAnchorElement) {
  var tgt = target.getAttribute('target');
  if (tgt === '_blank') {
    domContext.opensNewTab = true;
    domContext.openedUrl = target.href;
  }
}
```

### Phase 3: V1 Interaction Detector

Add detection in `classifyGroup()`, after the element-type-specific checks and before the default Click:

**BrowserAlert**: When domContext.triggeredDialog is set on the click event.
**NewTab**: When domContext.opensNewTab is true.
**NewWindow**: When domContext.opensNewWindow is true.

For **Iframe enrichment**: After classification, if `target.inIframe` is true, add iframe metadata.

### Phase 4: V2 Evidence Engine Providers

**DomProvider**: Emit BrowserAlert evidence when triggeredDialog is set. Emit NewTab/NewWindow evidence when opensNewTab/opensNewWindow flags are set.

**EventSequenceProvider**: On click events, check domContext flags.

### Phase 5: Timeline Renderer

```
BrowserAlert:
  Alert:     `Alert dialog "Are you sure?" appeared`
  Confirm:   `Confirm dialog "Delete item?" appeared`
  Prompt:    `Prompt dialog "Enter your name:" appeared`

NewTab:
  `Open "https://example.com" in new tab`

NewWindow:
  `Open "https://example.com" in new window`

Iframe enrichment (on existing types):
  `Click "Submit" in iframe "content-frame"`
```

## Files to Change

| File | Change |
|------|--------|
| `src/recorder/recorded-event.ts` | DomContext: add dialog/window-open/iframe fields |
| `src/recorder/deterministic-recorder.ts` | Page-world interception, click augmentation, target=_blank |
| `src/classifier/interaction-types.ts` | Metadata fields, move to TIER1 |
| `src/classifier/interaction-detector.ts` | V1 BrowserAlert/NewTab/NewWindow detection + Iframe enrichment |
| `src/classifier/evidence/providers/dom-provider.ts` | V2 evidence for dialog/new-tab/new-window |
| `src/classifier/evidence/providers/event-sequence-provider.ts` | Click + dialog evidence |
| `src/sidepanel/timeline-renderer.ts` | Phrasing for all four types |
| `tests/evidence-engine/window-frame.test.ts` | NEW — comprehensive tests |

## Acceptance Criteria

### BrowserAlert
- [ ] `domContext.triggeredDialog='alert'` → BrowserAlert with dialogType, dialogMessage
- [ ] `domContext.triggeredDialog='confirm'` → BrowserAlert with dialogType, dialogMessage, dialogResult
- [ ] `domContext.triggeredDialog='prompt'` → BrowserAlert with dialogType, dialogMessage, dialogResult
- [ ] Timeline: `Alert dialog "X" appeared` / `Confirm dialog "X" appeared` / `Prompt dialog "X" appeared`
- [ ] BrowserAlert click NOT classified as Click or Link

### NewTab
- [ ] `domContext.opensNewTab=true` → NewTab with openedUrl
- [ ] Timeline: `Open "url" in new tab`
- [ ] NewTab click NOT classified as Link or Click

### NewWindow
- [ ] `domContext.opensNewWindow=true` → NewWindow with openedUrl
- [ ] Timeline: `Open "url" in new window`
- [ ] NewWindow click NOT classified as NewTab or Link

### Iframe
- [ ] Interaction with `target.inIframe=true` → metadata enriched with iframeSrc, iframeName
- [ ] Timeline includes iframe context for iframe interactions
- [ ] Iframe enrichment does not override the base interaction type

### Regression
- [ ] Navigation detection unaffected
- [ ] Modal/Drawer/Popover/Tooltip detection unaffected
- [ ] Link detection unaffected (links without target=_blank still → Link)
- [ ] Click detection unaffected (regular clicks still → Click)
- [ ] All 2567 existing tests pass
