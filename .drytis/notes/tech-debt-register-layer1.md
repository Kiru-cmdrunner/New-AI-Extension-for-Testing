# Technical Debt Register — Layer 1: Event Capture / EventTap

Baseline: deff878 | Format: ID, Severity, Description, Root Cause, Impact

## Confirmed Bugs

### TD-L1-001 — SW ACKs OBSERVED_EVENT before async processing completes
- **Severity:** Medium
- **Root Cause:** `service-worker.ts:826` calls `handleObservedEvent(msg.payload)` (async) without awaiting; `sendResponse({ ok: true })` fires immediately on line 827
- **Impact:** If `ensureSessionRestored()` or `processObservedEvent()` fails, the event is ACKed (removed from buffer) but never processed. Data loss on SW crash during first event after restart.
- **File:** `src/background/service-worker.ts:824-828`

### TD-L1-002 — Redundant resolveTarget call in assembleObservedEvent
- **Severity:** Low (performance, not correctness)
- **Root Cause:** `handleRawEvent()` calls `resolveTarget()` at line 182, then `assembleObservedEvent()` calls it again at line 215. Strategy 2 of resolveTarget calls getComputedStyle, causing a double reflow.
- **Impact:** Performance degradation on large DOMs when Strategy 2 triggers. The already-resolved element should be passed instead.
- **File:** `src/tap/event-tap.ts:182, 215`

## Technical Debt

### TD-L1-003 — Mouseenter/mouseleave not throttled
- **Severity:** Low (risk, not confirmed failure)
- **Root Cause:** Throttling exists for scroll (16ms) and mousemove (50ms) but mouseenter/mouseleave have no throttle. Rapid hovering generates many durable events.
- **Impact:** IPC pressure during rapid hovering across many elements. Mitigated by Hover definition's 50-point confidence threshold.
- **File:** `src/tap/event-tap.ts`

### TD-L1-004 — DomContext ARIA range fields defined but not populated
- **Severity:** Low
- **Root Cause:** `extractDomContext()` does not read `ariaValueNow/Text/Min/Max` or `nativeMin/Max`. Fields are defined as optional in the interface.
- **Impact:** Slider/spinbutton definitions that could use these via DomContext don't get them. Definitions use `captureValue()` instead which reads `aria-valuenow` directly.
- **File:** `src/definitions/dom-context-extractor.ts`

### TD-L1-005 — Cross-origin iframe context incomplete
- **Severity:** Low
- **Root Cause:** `extractIframeContext()` catches SecurityError for cross-origin frames; frameSelector/frameName/frameId are null.
- **Impact:** Generated Playwright test uses bare `iframe` locator, ambiguous with multiple iframes.
- **File:** `src/tap/identity-extractor.ts:301-316`

## Architectural Limitations (By design at deff878, not defects)

### TD-L1-006 — No pointer events (pointerdown/up/move)
### TD-L1-007 — No touch events (touchstart/end/move)
### TD-L1-008 — No drag events (dragstart/dragend/drop)
### TD-L1-009 — No dblclick
### TD-L1-010 — keydown captured but no definition handles it (becomes Unclassified → filtered as noise)

## Unknowns Requiring Browser Testing

### TD-L1-011 — composedPath() with deeply nested shadow roots
### TD-L1-012 — getComputedStyle performance in Strategy 2 on large DOMs
### TD-L1-013 — History API monkey-patch vs application routers (React Router, Vue Router)
### TD-L1-014 — pagehide flush reliability (async sendMessage may not complete before page destroyed)
### TD-L1-015 — sessionStorage quota limits (500 events × 18-field identity JSON)
