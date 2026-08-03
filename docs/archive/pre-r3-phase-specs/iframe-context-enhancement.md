# Iframe Context Enhancement

## Goal

When an action occurs inside an iframe, capture enough iframe context in the
execution JSON for CmdRunner to reliably locate the correct iframe during
execution. This is purely an enhancement to the execution metadata — the
recording pipeline and user experience remain unchanged.

## Current State

- `RawElementIdentity.inIframe: boolean` — just a flat boolean
- `ExecutionJson.inIframe: boolean` — same flat boolean
- No frame selector, src, name, index, depth, or hierarchy
- Content scripts run with `all_frames: true` so they execute inside every iframe

## Design

### IframeContext Interface

```ts
interface IframeContext {
  /** The iframe's own URL (window.location.href). */
  frameSrc: string;
  /** The <iframe> element's name attribute, if accessible. */
  frameName: string | null;
  /** The <iframe> element's id attribute, if accessible. */
  frameId: string | null;
  /** CSS selector for the <iframe> element in the parent document. */
  frameSelector: string | null;
  /** XPath for the <iframe> element in the parent document. */
  frameXPath: string | null;
  /** 0-based index of this iframe among siblings of the same tag. */
  frameIndex: number | null;
  /** How many levels deep this frame is (1 = direct child of top). */
  frameDepth: number;
}
```

### Same-origin vs Cross-origin

- **Same-origin iframe**: `window.frameElement` returns the `<iframe>` element
  in the parent document. We can read its id, name, attributes, generate CSS/XPath
  selectors, and compute its index among siblings.

- **Cross-origin iframe**: `window.frameElement` is `null`. We still capture
  `frameSrc` (from `window.location.href`) and `frameDepth` (from counting
  parent accesses). The element-specific fields (`frameName`, `frameId`,
  `frameSelector`, `frameXPath`, `frameIndex`) will be `null`.

### Propagation Path

```
Content Script → RawElementIdentity.iframeContext? → ElementIdentity → ExecutionJson.iframeContext?
```

No changes to:
- Recording session (addClick/addTextEntry/addDropdown just pass raw identity through)
- Service worker processAction (passes raw identity through)
- AI understanding prompts (unaffected)
- Plain English generation (unaffected)

## Files to Change

- `src/shared/types.ts` — IframeContext interface, add to RawElementIdentity + ExecutionJson
- `src/recorder/click-content-script.ts` — add extractIframeContext() inline
- `src/recorder/text-entry-content-script.ts` — same
- `src/recorder/dropdown-content-script.ts` — same
- `src/recorder/step-builder.ts` — propagate iframeContext in buildExecutionJson
- Tests — verify context is captured and propagated

## Acceptance Criteria

- [ ] IframeContext captures frameSrc (always), frameName, frameId, frameSelector, frameXPath, frameIndex, frameDepth
- [ ] Same-origin iframes: frameSelector, frameXPath, frameId, frameName, frameIndex are populated
- [ ] Cross-origin iframes: frameSrc + frameDepth captured, element-specific fields null
- [ ] Top-level frame: inIframe=false, iframeContext is undefined
- [ ] iframeContext flows through to ExecutionJson
- [ ] Existing inIframe boolean still works (backward compat)
- [ ] No changes to recording pipeline or user experience
- [ ] All existing tests pass
- [ ] Build succeeds
