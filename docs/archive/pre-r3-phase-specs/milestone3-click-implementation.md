# Milestone 3 — Click Interaction Implementation

**Status:** Implementation only. Faithful realization of frozen Milestone 1 (Product Spec) and Milestone 2 (Architecture).

**Product Spec:** `.drytis/specs/milestone1-click-product-spec.md`
**Architecture:** `.drytis/specs/milestone2-click-architecture.md`
**Session Lifecycle:** `.drytis/specs/milestone0-recording-session-lifecycle.md`

---

## Implementation Plan

### Phase A — click-content-script.ts (NEW)
- INTERACTIVE_SELECTOR constant (native tags, ARIA roles, interactivity signals)
- `resolveClickTarget(event)` using `composedPath()` + fallback parent walk
- `computeAccessibleName(el)` — 9-level priority chain
- `getImplicitRole(el)` — tag→role and input-type→role mapping
- `generateCssSelector(el)` — id-based shortcut or nth-of-type chain (depth ≤ 5)
- `generateXPath(el)` — id-based shortcut or positional path (depth ≤ 10)
- `isInShadowDom(el)` — checks if rootNode is ShadowRoot
- `extractIframeContext()` — same-origin parent walk, cross-origin best-effort
- `extractIdentity(el)` — builds full `RawElementIdentity` at click time
- Recording state sync via `chrome.storage.onChanged`
- Click listener (capture phase): isTrusted → button 0 → recording → resolve → ownership → dedup → extract → sendMessage
- Double-click detection: holding window, identity key comparison (not Element ref)

### Phase B — types.ts
- Add `ClickEvent` to the `SessionEvent` union
- Add `CLICK_CAPTURED` message type to `AppMessage`
- Update `isAppMessage` type guard

### Phase C — interaction-types.ts
- Register `clickConfig` with:
  - `buildPrompt`: uses ActionElementInfo (actionType, text, tag, role)
  - `toPlainEnglish`: `Click "[name]"` with icon/image/card fallbacks
  - `renderTitle`: short title for timeline
  - `executionExtras`: empty (click has no type-specific extras)
  - `addToSession`: delegates to `session.addAction()`
- Call `registerInteractionType(clickConfig)`

### Phase D — service-worker.ts
- Add `CLICK_CAPTURED` case:
  - `processAction(identity, 'click', sender.tabId)` — calls `session.addAction`, screenshot, AI, buildStep, addStep
- Refactor navigation screenshot/AI/step logic into shared `processAction` helper

### Phase E — manifest.json
- Register `click-content-script.ts` in `content_scripts` (all frames, capture phase)

### Phase F — Tests
- Unit: accessible name, role mapping, CSS selector, XPath, interactive selector
- Integration: pipeline (addAction → buildStep → plain English), registry, service-worker routing, timeline rendering
- Decision tree: genuine, ownership, resolution, classification

---

## Acceptance Criteria

- [ ] Click detects only genuine user clicks (isTrusted)
- [ ] Click resolves correct interactive element via composedPath (SVG, span, image, nested)
- [ ] Click defers when `data-cmdrunner-handled` is present
- [ ] Click suppresses duplicates from double-click (same identity key)
- [ ] Click extracts identity at click time (not after delay)
- [ ] Click classified only when CLICK_CAPTURED message is sent
- [ ] Identity is immutable after classification
- [ ] Plain English follows `Click "[name]"` format
- [ ] Execution JSON has multiple locators in priority order
- [ ] Click appears in timeline only after classification
- [ ] Build succeeds, all tests pass

---

## Lifecycle: 5-Stage Model

1. ~~Recording Session Lifecycle~~ (Milestone 0 — approved)
2. ~~Product Specification~~ (Milestone 1 — approved)
3. ~~Architecture & Technical Design~~ (Milestone 2 — frozen)
4. **Implementation + Self-Review** (Milestone 3 — this milestone)
5. Validation on Real Applications (Milestone 4 — future)
