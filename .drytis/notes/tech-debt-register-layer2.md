# Technical Debt Register — Layer 2: ComponentRuntime / Classification

Baseline: deff878 | Format: ID, Severity, Description, Root Cause, Impact

## Confirmed Bugs

### TD-L2-001 — keydown enters DISCRETE_ACTION_TYPES but no definition handles it
- **Severity:** Medium
- **Root Cause:** `evidence-ledger.ts:32` — DISCRETE_ACTION_TYPES includes 'keydown'. But no definition lists 'keydown' in triggerEventTypes. keydown events enter the ledger as 'pending', never get absorbed, and become Unclassified at projection. Then IR Bridge filters Unclassified as NOISE → dropped from generated tests.
- **Impact:** Enter-to-submit, Escape-to-close, and all keyboard shortcuts are captured by Layer 1, sent to SW, enter ledger, but produce no output. The capture guarantee (INV-PE-2: every discrete event represented) holds — they appear as Unclassified — but they're filtered downstream.

### TD-L2-002 — EvidenceLedger has no eviction cap
- **Severity:** Low
- **Root Cause:** `evidence-ledger.ts` — entries Map grows unbounded. Comment says "1000 entries covers" but there is no FIFO or size limit in code. Only DISCRETE_ACTION_TYPES (click, contextmenu, mousedown, keydown) enter, so growth rate is moderate.
- **Impact:** Memory growth in very long recordings (1000+ discrete actions). Projection Engine still works. No data loss — just memory.
- **File:** `src/runtime/evidence-ledger.ts`

## Technical Debt

### TD-L2-003 — Scroll lifecycle uses shouldCompleteOnOutside=true on EVERY non-scroll event
- **Severity:** Low
- **Root Cause:** `scroll.ts` — `shouldCompleteOnOutside` returns true for ANY non-scroll event. This means if the user scrolls then pauses, the scroll completes on the very next non-scroll event (mousemove, focus, click, etc.). Even a mousemove (transient, rate-limited) will complete the scroll gesture.
- **Impact:** Scroll gestures may complete slightly earlier than intended. The 500ms burst gap in isInScope already handles temporal separation. The shouldCompleteOnOutside is a secondary completion path. Not a correctness issue — just means scroll completes on the next event rather than on a timer.

### TD-L2-004 — Unclassified interactions from Projection Engine have stub identity
- **Severity:** Low
- **Root Cause:** `projection-engine.ts:120` — `createUnclassifiedFromLedger` creates synthetic interactions with cssSelector='', xPath='', inIframe=false, shadowDom=false. The ledger only stores targetTag/Name/Role (diagnostic fields), not the full ElementIdentity.
- **Impact:** Unclassified interactions cannot be replayed — they have no locators. They're filtered as NOISE in the IR Bridge anyway, so this doesn't affect test output. But it means the capture guarantee produces non-actionable entries for unmatched events.

### TD-L2-005 — Navigation event flush completes all active lifecycles as interrupted
- **Severity:** Low
- **Root Cause:** `component-runtime.ts:211` — When navigation event arrives, `flush()` is called. `flush()` sets non-gesture lifecycles to 'interrupted', which means they're excluded from projection output (projection only takes 'completed'). Their absorbed events become 'unclaimed' via releaseClaims.
- **Impact:** If a Dropdown is open when SPA navigation fires (dropdown option click caused navigation), the Dropdown lifecycle gets interrupted before it can complete. The click event on the option gets released to 'unclaimed' → Unclassified. In practice this rarely matters because the click fires before navigation, and the Dropdown completes on the option click.

### TD-L2-006 — flush() completes gesture components as 'completed' but the gesture may not be finished
- **Severity:** Low
- **Root Cause:** `component-runtime.ts:410` — flush() uses `def.shouldCompleteOnOutside ? 'completed' : 'interrupted'`. Scroll has shouldCompleteOnOutside so it always flushes as 'completed'. If the user is mid-scroll when they stop recording, the partial scroll is emitted as completed.
- **Impact:** Minor — the scroll delta captures the full range scrolled so far. Partial scrolls are valid data.

## Architectural Limitations (By design at deff878)

### TD-L2-007 — No definition handles keyboard shortcuts (Ctrl+S, Alt+F4, etc.)
### TD-L2-008 — No definition handles Enter-to-submit forms
### TD-L2-009 — No definition handles Escape-to-close dialogs
### TD-L2-010 — No nested component lifecycle (a Dropdown inside a DatePicker has no parent-child relationship)
### TD-L2-011 — Multiple concurrent Dropdown/DatePicker lifecycles are not managed (last-in-first-out stack only)
### TD-L2-012 — No dblclick definition (double-click interactions classified as two separate Clicks)
