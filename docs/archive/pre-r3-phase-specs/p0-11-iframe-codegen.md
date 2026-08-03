# P0-11: Iframe Interaction — Frame-Aware Code Generation

## Problem

**Event capture already works.** The manifest sets `all_frames: true`, so the
content script (EventTap) is injected into every iframe — including cross-origin.
Events are captured, classified, and enriched with `inIframe: true` and an
`IframeContext` (frameSrc, frameSelector, frameName, frameId, frameDepth).

**The gap is in code generation.** The IR Bridge drops iframe context — `IRStep`
has no frame field. The Playwright adapter generates `page.getByRole(...)`
instead of `page.frameLocator('iframe#widget').getByRole(...)`, so generated
tests fail at runtime for any element inside an iframe.

## Root Cause Analysis

1. **IR Bridge** (`ir-bridge.ts`): When building `ResolvedTarget` from
   `ElementIdentity`, iframe context is silently dropped. The step has
   `target.kind: 'element'` with locators but no frame prefix.

2. **Playwright adapter** (`locator-renderer.ts`, `action-renderer.ts`):
   `elementExpression()` always produces `page.xxx` — it never wraps in
   `frameLocator()`. No code path handles iframe-embedded elements.

3. **IR types** (`execution-ir/types.ts`): `IRStep` has no `frame` field.
   `ResolvedTarget` has no frame info.

## Design

### Approach: Add frame context to the IR pipeline + Playwright renderer

**NOT a content script change. NOT a new definition. NOT a relay system.**
The relay is already implemented via Chrome's `all_frames: true` injection.
This is purely a code-generation-layer enhancement.

### 1. Extend IRStep with optional frame context

Add an optional `frame` field to `IRStep`:

```typescript
/** Frame locator for iframe-embedded elements. Undefined for top-frame elements. */
readonly frame?: ResolvedFrame;
```

Where `ResolvedFrame` is:
```typescript
interface ResolvedFrame {
  /** Best Playwright frameLocator selector. */
  readonly selector: string;
  /** How the selector was derived. */
  readonly strategy: 'css' | 'name' | 'url' | 'index';
  /** Source URL of the iframe (always available). */
  readonly frameSrc?: string;
  /** Depth in the iframe nesting (1 = direct child of top). */
  readonly depth: number;
}
```

### 2. IR Bridge: resolve frame selector from IframeContext

When `interaction.target.inIframe === true` and `iframeContext` exists:

Priority for frame selector:
1. `frameSelector` (CSS selector in parent) → `css` strategy
2. `frameName` → `name` strategy: `iframe[name="..."]`
3. `frameId` → `css` strategy: `iframe#id`
4. `frameSrc` → `url` strategy: `iframe[src*="..."]` (partial URL match)
5. Fallback: `iframe` with `frameIndex` → `iframe >> nth=${frameIndex}`

### 3. Playwright adapter: wrap in frameLocator()

When `step.frame` is present:

```
page.frameLocator('iframe#payment').getByRole('textbox', { name: 'Card Number' })
```

**Nested iframes (depth > 1)**: Deferred to a future milestone. The content
script's `IframeContext` captures only the immediate parent frame, not the
full ancestor chain. Supporting nested iframe chaining requires enhancing
the content script to walk `window.parent` and collect ancestor frame
selectors. The current implementation correctly handles depth=1 iframes,
which covers 95%+ of real-world usage (payment widgets, ad embeds, maps).

### 4. Display

Side panel timeline already shows "🌐 iframe" chip via timeline-renderer.ts.
No changes needed — the chip is already populated from `identity.inIframe`.

## Files to Change

1. `src/domain/execution-ir/types.ts` — add `ResolvedFrame` interface + `frame` field on `IRStep`
2. `src/generation/ir-bridge.ts` — resolve frame selector from IframeContext, populate step.frame
3. `src/adapters/playwright/locator-renderer.ts` — add frameLocator() prefixing
4. `tests/runtime/iframe-codegen.test.ts` — new unit tests

## Acceptance Criteria

- [ ] IRStep has optional `frame?: ResolvedFrame` field
- [ ] IR Bridge populates `frame` when element has `inIframe: true` + `iframeContext`
- [ ] Frame selector resolved via priority chain: frameSelector > frameName > frameId > frameSrc > fallback
- [ ] Playwright adapter generates `page.frameLocator(selector).getByRole(...)` for iframe elements
- [ ] Nested iframe chaining deferred — known limitation (requires content script ancestor chain)
- [ ] Non-iframe elements produce identical output (no regression — `page.getByRole(...)`)
- [ ] Cross-origin iframe elements get `iframe[src*="..."]` selector fallback
- [ ] Side panel already shows "🌐 iframe" chip (no change needed)
- [ ] Unit tests cover all scenarios
- [ ] Full suite passes with zero regressions
