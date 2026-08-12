# M7 Real-Browser RCA — End-to-End Evidence Pipeline Analysis

**Date**: 2026-08-12
**Build analyzed**: `4635537` (Fix Round 2)
**Analysis method**: Full code trace of each interaction type: Browser Event → EventTap → EvidenceCollector → BehavioralEvidence → SW → Side Panel
**Spec reference**: behavioral-evidence-model.md v3.0

---

## Architecture Overview: The Two Parallel Paths

The evidence system has **two completely separate data paths** that never merge:

### Path A: ObservedEvent (EventTap → ComponentRuntime → ComponentInteraction)
```
Browser DOM Event
  → EventTap.handleRawEvent()
  → assembleObservedEvent() [reads value, checked from live DOM]
  → config.onEvent(observed) → content script → chrome.runtime.sendMessage → SW
  → processObservedEvent() → ComponentRuntime.processEvent()
  → ComponentInteraction emitted with triggerEvent (has valueBefore/valueAfter/checkedBefore/checkedAfter)
```

### Path B: BehavioralEvidence (EventTap.onAfterEvent → EvidenceCollector → SW)
```
EventTap.handleRawEvent()
  → config.onAfterEvent(targetEl, eventId, eventType, identity, observed)
  → EvidenceCollector.onAfterEvent()
  → openWindow() or handleTypingEvent() or handleNavigationEvent()
  → [300ms stabilization]
  → closeWindow() → builds TargetEvidence (peek+capture from TargetStateCache) + ApplicationEvidence
  → deliverEvidence() → chrome.runtime.sendMessage('BEHAVIORAL_EVIDENCE')
  → SW handleBehavioralEvidence() → attachEvidenceToInteraction(sourceEventId)
  → interaction.behavioralEvidence = evidence
```

### The Renderer: Only Shows Path B
```
Side Panel interaction-renderer.ts
  → attachEvidenceDisplay(el, interaction)
  → if interaction.behavioralEvidence → renderEvidence(container, evidence)
    → renderTargetEvidence(evidence.targetEvidence)
      → diffSnapshots(target.before, target.after)
      → Shows ONLY TargetStateSnapshot diffs (value, checked, disabled, ariaExpanded, etc.)
    → renderApplicationEvidence(evidence.applicationEvidence)
      → Shows DOM changes, surfaces, visibility, navigation, network, performance
  → else → renderEvidencePlaceholder() → "⏳ Collecting behavioral evidence…"
```

**CRITICAL FINDING**: The ObservedEvent's `valueBefore`/`valueAfter`/`checkedBefore`/`checkedAfter` (Path A) is **NEVER displayed** in the interaction card. It exists on `interaction.triggerEvent.valueBefore` but the renderer only shows `interaction.behavioralEvidence.targetEvidence`. The two paths carry complementary data but only Path B is rendered.

---

## Case-by-Case Trace

### 1. Text Entry (Username = "Admin")

**Expected** (spec §3.3 INV-TGT-2): `value: "" → "Admin"` in Target Evidence

**Actual flow**:
| Step | What happens | Problem? |
|------|-------------|----------|
| Browser fires `input` event | EventTap captures, assembles ObservedEvent with `valueAfter = "A"` (first keystroke) | No |
| EventTap `onAfterEvent` | `eventType='input'` → EvidenceCollector.handleTypingEvent() | No |
| First input → openWindow | `targetStateCache.peek(targetEl)` for beforeSnapshot | **Maybe** |
| Before snapshot from cache | TargetStateCache was populated by capture-phase `keydown` listener (P0-1 fix) | **Depends on element resolution** |
| Subsequent inputs → extend | Timer reset, no new window, no re-capture before | Correct |
| 300ms quiescence → closeWindow | `targetStateCache.capture(targetEl)` → `after.value = "Admin"` | Correct |
| closeWindow builds TargetEvidence | `before = peek result`, `after = capture result` | **before may be null** |
| BehavioralEvidence delivered | SW attaches to interaction | Correct |
| Side panel renders | `diffSnapshots(before, after)` | If `before = null` → `formatSnapshot(after)` shows static values, no diff |

**Where evidence is lost**: Two places:
1. **Element resolution mismatch** (P0-1 fix): The capture-phase `keydown` listener now uses `resolveTarget()` but if the target element doesn't match what EvidenceCollector uses for `peek()`, `before` is null. The P0-1 fix should have resolved this, but in real browsers, `resolveTarget()` on `keydown` may resolve differently than `resolveTarget()` on the `input` event because the composedPath may differ.
2. **The bigger issue**: Even when `before.value = ""` and `after.value = "Admin"`, the diff SHOULD show `value: → Admin`. But if the before snapshot was captured by a `keydown` AFTER the first character was already typed (race condition in capture phase), `before.value = "A"` instead of `""`, and the diff shows `value: A → Admin` which is misleading.

**The REAL missing piece**: The ObservedEvent already has `valueBefore` (captured on focus/mousedown) and `valueAfter` (captured on input/blur/change). For a typing session:
- The **first** input event has `valueBefore = null` (input events don't set valueBefore) and `valueAfter = "A"` (first char)
- The typing window extends and never re-captures valueBefore

So the typing session window captures `before` from the TargetStateCache (if pre-populated by keydown/focus) and `after` from the DOM at window close. But the **ObservedEvent** that triggered the first input already has the value transition. This is just not displayed.

**Root cause**: EvidenceCollector's typing window doesn't use the ObservedEvent's valueBefore/valueAfter. It relies entirely on TargetStateCache snapshots.

**Recommended fix**:
1. For typing sessions, carry forward the ObservedEvent's valueBefore as the before-snapshot value when the cache is empty.
2. Alternatively, merge ObservedEvent valueBefore/valueAfter into TargetEvidence in the SW when BehavioralEvidence before is null.

---

### 2. Single-Select Dropdown (e.g., "Algerian" → "Costa Rican")

**Expected** (spec §3.3, §4.1): `value: Algerian → Costa Rican` + `aria-expanded: true → false` + visibility change on menu

**Actual flow**:
| Step | What happens | Problem? |
|------|-------------|----------|
| User clicks dropdown trigger | `mousedown` → `click` events fire | |
| mousedown: capture-phase listener | TargetStateCache captures before-snapshot of resolved target | **If target is the trigger div** |
| click: EventTap onAfterEvent | `WINDOW_OPEN_EVENTS.has('click')` → opens evidence window | Correct |
| Window open: peek cache | `beforeSnapshot = cache.peek(triggerEl)` | **May be null if element mismatch** |
| User clicks an option | `mousedown` → `click` on the option | |
| Custom dropdown (not native `<select>`): | `click` on option → option's click handler sets trigger textContent | |
| Native `<select>`: | `change` event fires → EventTap captures valueAfter | |
| change: EventTap onAfterEvent | `WINDOW_OPEN_EVENTS.has('change')` → opens ANOTHER evidence window | **PROBLEM** |
| Two windows now active | Click window and change window | The change window's `before` snapshot has the OLD value (from cache) |
| Change window closes (300ms) | `afterSnapshot = cache.capture(selectEl)` → value = new selection | |
| Click window closes (300ms) | Same afterSnapshot | |

**Where evidence is lost**:
1. **For custom dropdowns (OrangeHRM OXD, Amazon)**: The user clicks a div, not a `<select>`. The `captureValue()` function handles `<select>`, `<input>`, ARIA, and `aria-selected` descendants. For OXD dropdowns, the trigger div's `textContent` changes (e.g., "Algerian" → "Costa Rican"), but `captureValue()` returns `undefined` for a div unless it has `aria-valuetext` or `aria-selected` descendants. So **value is never captured** for custom dropdowns.
2. **The valueBefore/valueAfter on ObservedEvent**: For `click` events, `valueBefore` is set. For `change` events, `valueAfter` is set. But for custom dropdowns, there's no `change` event — the framework uses JavaScript to update the DOM. So `valueAfter` is never set on the ObservedEvent.
3. **`diffSnapshots` compares `value`**: The TargetStateSnapshot.value for a div is always null (snapshotElement only reads value from input/textarea/select elements). So even if before/after snapshots exist on the div, `value` is null → no diff.
4. **textContent DOES change**: "Algerian" → "Costa Rican" should appear as a `text:` diff. But only if before/after snapshots are on the same element AND before was captured before the text changed. The P0-1 fix should help here.

**Root cause**: Custom dropdowns don't fire `change` events. `captureValue()` doesn't read textContent for non-input elements. `TargetStateSnapshot.value` is null for non-input elements. The only signal that changes is `textContent`.

**Recommended fix**:
1. For custom dropdowns, rely on `textContent` diff in TargetStateSnapshot (P0-1 should make this work if element resolution is aligned).
2. Augment `captureValue()` to fall back to textContent for elements with `role="combobox"`, `role="listbox"`, or `[aria-haspopup]`.
3. The ObservedEvent's `valueBefore`/`valueAfter` should be displayed alongside the TargetEvidence when available.

---

### 3. Multi-Select Dropdown

**Expected**: All selected values captured (e.g., "English, Spanish, French")

**Actual**: 
- The `TargetStateSnapshot.value` is a single `string | null` — it can only hold one value.
- For native `<select multiple>`, `element.value` returns only the first selected option.
- For custom multi-select (checkboxes inside a dropdown), each selection is a separate click → separate interaction → separate evidence window.
- There is **no field** in the evidence model that can hold multiple selected values.

**Where evidence is lost**: The spec has no multi-select support. `TargetStateSnapshot.value` is `string | null`. Each checkbox click inside the dropdown gets its own interaction with its own evidence.

**Root cause**: Spec limitation — the model doesn't define how to represent multi-value selections.

**Recommended fix**: Add a `selectedValues: string[]` field to `TargetStateSnapshot`, populated from the textContent of all `[aria-selected="true"]` or `[selected]` descendants of the target element. Or rely on individual checkbox interactions (each click = separate evidence with its own `checked` diff).

---

### 4. Date Picker

**Expected**: Selected date value visible (e.g., "2023-09-27")

**Actual flow**:
| Step | What happens | Problem? |
|------|-------------|----------|
| User clicks date input | `click` → opens evidence window | Correct |
| Date picker popup opens | DOM mutations → captured by DOMObserver | Correct |
| User clicks a date | `click` on calendar cell → opens ANOTHER window | Correct (separate interaction) |
| Date cell click handler writes to input | Framework sets input.value = "2023-09-27" | |
| Input value change | May or may not fire `input`/`change` event depending on framework | **PROBLEM** |
| If `input` fires → typing window | `handleTypingEvent()` opens a typing window | `before` from cache, `after` = "2023-09-27" |
| If NO event fires (React controlled) | Evidence window closes with `after.value` from DOM snapshot | **If cache has before** |
| Evidence delivered | TargetEvidence has before/after value OR just after value | |

**Where evidence is lost**: Date pickers often set values programmatically without firing native events. If no `input`/`change` event fires, EvidenceCollector never opens a window for the value change. The click on the date cell captures DOM mutations (calendar closing) but the input value change is invisible unless the EvidenceCollector happens to capture an after-snapshot of the input element.

The evidence window for the date-cell click captures the **calendar cell** as the target, not the **input field**. So `before`/`after` snapshots are on the cell, not the input. The input's new value is never captured.

**Root cause**: The evidence window targets the clicked element (date cell), not the element whose value changed (input field). There's no mechanism to associate the cell click with the input value change.

**Recommended fix**: 
1. When closing an evidence window, check if any ancestor or related input element had its value changed during the window's lifetime (compare DOM at open vs close).
2. Or: add `aria-controls` resolution — if the clicked element has `aria-controls="inputId"`, also snapshot that controlled element.

---

### 5. Radio / Checkbox

**Expected** (spec §3.3): `checked: false → true` (native), `aria-checked: false → true` (custom ARIA)

**Actual flow**: This is the ONE case that mostly works.
| Step | What happens | Works? |
|------|-------------|--------|
| User clicks checkbox/radio | `mousedown` → capture-phase listener caches state | ✅ |
| `click` event | EventTap opens evidence window | ✅ |
| Window opens | `peek(targetEl)` → before.checked = false | ✅ |
| Browser updates state | `el.checked = true` | ✅ |
| Window closes (300ms) | `capture(targetEl)` → after.checked = true | ✅ |
| Evidence delivered | `checked: false → true` diff appears | ✅ |

**For custom ARIA widgets** (`role="checkbox"`, `aria-checked`):
| Step | What happens | Works? |
|------|-------------|--------|
| mousedown → capture listener | `resolveTarget(event)` → resolves the div | ✅ (P0-1 fix) |
| Cache captures | `snapshotElement(div)` reads `aria-checked` attribute → false | ✅ |
| Click handler updates | `div.setAttribute('aria-checked', 'true')` | ✅ |
| Window closes → capture | `snapshotElement(div)` → aria-checked = true | ✅ |
| Diff | `aria-checked: false → true` | ✅ |

**Where evidence is NOT lost**: This interaction type works correctly after the P0-1 fix. The `snapshotElement()` function reads all 9 properties including aria-checked. The P0-1 element resolution alignment ensures cache key consistency.

**Remaining issue**: The ObservedEvent's `checkedBefore`/`checkedAfter` (Path A) is NOT displayed in the evidence section. It's redundant with the TargetStateSnapshot diff (Path B) but could serve as a fallback when Path B fails.

---

### 6. Navigation

**Expected** (spec §7, §3.6): `NavigationEvidence { type: 'pushState', fromUrl: '...', toUrl: '...' }` in Application Evidence

**Actual flow for SPA navigation** (OrangeHRM after login):
| Step | What happens | Problem? |
|------|-------------|----------|
| User clicks Login | `click` → evidence window opens | |
| React Router calls `history.pushState` | EventTap's monkey-patched pushState fires | |
| `emitSpaNavigation('pushState')` | Creates synthetic nav ObservedEvent | |
| `onAfterEvent(body, navEventId, 'navigation', ...)` | EvidenceCollector.handleNavigationEvent() | |
| Nav window opens | Target = document.body, identity from body | |
| Nav evidence recorded | `{ type: 'pushState', fromUrl, toUrl }` pushed to active windows + new nav window | |
| Nav window stabilization (300ms) | If DOM mutations arrive (new page renders), window stays open | |
| Nav window closes | BehavioralEvidence delivered with NavigationEvidence | ✅ (if content script survives) |

**Actual flow for full-page reload** (OrangeHRM form POST login):
| Step | What happens | Problem? |
|------|-------------|----------|
| User clicks Login | click → evidence window opens | |
| Form submits → POST → 302 redirect | Content script destroyed | **PROBLEM** |
| Evidence window never closes | No BehavioralEvidence ever delivered | |
| New page loads | New content script starts (no prior state) | |
| SW webNavigation.onCommitted fires | Creates synthetic nav ObservedEvent | |
| SW processes nav event | New interaction emitted in SW | |
| SW `attachSyntheticNavEvidence()` | Creates `page-reload-synthetic` evidence with URL | **P1-3 fix** |
| 5s timeout | If no evidence arrives, `evidence-timeout` evidence attached | **P1-3 fix** |

**Where evidence is lost**: For full-page reloads, the behavioral evidence (DOM changes, network activity, element state changes from the login click) is lost because the content script is destroyed. Only the synthetic navigation evidence (with URL) survives. The click interaction that triggered the navigation gets either synthetic nav evidence or a timeout.

**For SPA navigation**: This should work correctly. The content script survives, the nav window captures post-navigation DOM changes, and real evidence is delivered.

**Distinguishing real vs synthetic**: The `endReason` field distinguishes them:
- Real evidence: `endReason: 'stabilized'` or `'navigation'`
- Synthetic: `endReason: 'page-reload-synthetic'`
- Timeout: `endReason: 'evidence-timeout'`

**Root cause**: Full-page reloads are fundamentally incompatible with content-script-based evidence capture. The P1-3 fix (synthetic + timeout) is the correct approach.

---

### 7. Scroll

**Expected** (spec §4.7): Minimal evidence. If scroll loads new content, DOM mutations captured.

**Actual flow**:
| Step | What happens | Problem? |
|------|-------------|----------|
| User scrolls | `scroll` event fires (throttled to 500ms) | |
| EventTap.onAfterEvent | `handleScrollEvent()` → opens evidence window | |
| Window opens | Target = scroll container, before/after snapshots on the container | |
| Window closes (300ms) | If no DOM mutations → near-empty evidence | Correct (spec §4.7) |
| If infinite scroll | DOM mutations keep window open → newSurfaces captured | Correct |

**What's useful**: The ObservedEvent has `scrollDeltaY` and `scrollDeltaX` but these are **NOT in BehavioralEvidence**. The spec doesn't define scroll-specific evidence fields. The scroll position is lost.

**Where evidence is lost**: `scrollDeltaY`/`scrollDeltaX` from ObservedEvent are never displayed. The evidence window only captures DOM mutations resulting from scroll (e.g., lazy-loaded content).

**Root cause**: The spec doesn't define scroll-specific evidence. The `TargetStateSnapshot` doesn't include `scrollTop`/`scrollLeft`.

**Recommended fix**: Add `scrollTop` and `scrollLeft` to `TargetStateSnapshot` so scroll position changes appear in the diff. Or accept that scroll evidence is minimal per spec.

---

### 8. Network

**Expected** (spec §6): `NetworkActivity[]` with URL, method, status, timing, resourceType, source

**Actual flow**:
| Step | What happens | Problem? |
|------|-------------|----------|
| User clicks button → XHR fires | MAIN-world fetch/XHR monkeypatch captures request | **If injection succeeded** |
| SW webRequest.onBeforeRequest | SW captures request metadata | **If SW alive** |
| SW forwards to content script | `chrome.tabs.sendMessage(tabId, NETWORK_REQUEST)` | **If content script alive** |
| NetworkBridge.handleNetEvent | Buffers entry | |
| Evidence window closes | `networkBridge.collectForRange(openedAt, closedAt)` | |
| P1-4 fix: 1000ms re-check | If in-flight requests exist, re-check after 1000ms | |
| Network entries included in BehavioralEvidence | `applicationEvidence.networkActivity` | |
| Side panel renders | `renderApplicationEvidence` → network section | |

**Where evidence is lost**: Multiple failure points:
1. **MAIN-world injection**: `chrome.scripting.executeScript({world:'MAIN'})` may fail silently due to CSP. No retry mechanism. If injection fails, only webRequest captures remain.
2. **webRequest → content script forwarding**: The SW sends `chrome.tabs.sendMessage(tabId, {type:'NETWORK_REQUEST', detail})`. If the content script is dead (page navigated), this fails silently.
3. **Timestamp normalization**: Even with the P1-4 `wallClock` fix, the normalization is approximate. `collectForRange` may filter out entries whose timestamps fall outside the window.
4. **SW lifecycle**: MV3 service workers can be killed and restarted. If the SW dies between `onBeforeRequest` and `onCompleted`, the in-flight tracking is lost.
5. **Window timing**: The click evidence window stabilizes at 300ms. A login POST request may take 500-2000ms. The P1-4 fix (1000ms re-check) helps, but the evidence may arrive AFTER the side panel has already rendered the card with empty network activity. The re-check delivers supplementary evidence via `deliverEvidence`, but the SW's `attachEvidenceToInteraction` has first-write-only semantics — if the interaction already has evidence (from the window close), the supplementary evidence is **dropped**.

**CRITICAL BUG**: The 1000ms re-check in `closeWindow` sends supplementary evidence via `deliverEvidence()`, which calls `chrome.runtime.sendMessage('BEHAVIORAL_EVIDENCE', lateEvidence)`. But `attachEvidenceToInteraction` in sw-integration.ts has **first-write-only** semantics:
```typescript
if (!interaction.behavioralEvidence) {
  interaction.behavioralEvidence = evidence;
```
If the interaction already received the initial evidence (with 0 network entries), the late evidence (with network entries) is **silently dropped**. This means the network re-check never actually updates the interaction.

**Root cause**: First-write-only prevents late network evidence from updating interactions.

**Recommended fix**: For network-only supplementary evidence (same sourceEventId, same windowId), UPDATE the existing evidence's networkActivity instead of dropping it.

---

## GAP-1 through GAP-7 Reassessment

### GAP-1: Identity Passthrough

**Expected**: Full ElementIdentity on every interaction
**Actual**: ✅ Working in real browser (confirmed by screenshots)
**Where lost**: Nowhere — fix works
**Root cause**: Previous fix (passing identity through onAfterEvent) resolved this
**Recommended fix**: None needed

### GAP-2: Text Input Before/After Value

**Expected**: `value: "" → "Admin"` in Target Evidence
**Actual**: Depends on TargetStateCache pre-population. The P0-1 fix aligned element resolution, but in real browsers the timing of when the cache is populated vs when `peek()` is called may still miss. The typing window's `before` comes from the cache which is populated by the `keydown` capture-phase listener — but the first keydown's capture-phase fires BEFORE the character is typed, so `before.value = ""`. This should work.
**Where lost**: 
  - If element resolution still doesn't match between cache and peek (need to verify with real browser DevTools)
  - If the typing window's `before` is correctly `""` and `after` is `"Admin"`, the diff SHOULD show `value: → Admin`. The empty string for before is displayed as `→` (safeText converts "" to "").
  - **formatSnapshot SKIPS empty values**: Line 126: `if (snapshot.value !== null && snapshot.value !== undefined && snapshot.value !== '')` — so `value: ''` is NOT shown in formatSnapshot. But `diffSnapshots` compares before.value ('') with after.value ('Admin') and they ARE different, so the diff line IS added: `value: → Admin`. This is correct.
**Root cause**: Likely still working after P0-1. If not, the issue is element resolution timing or cache not being populated.
**Recommended fix**: Verify in real browser DevTools that `evidence.targetEvidence.before.value === ''` for typing sessions. If null, the cache population is failing.

### GAP-3: Visibility Detection (display/visibility/opacity/class)

**Expected**: Visibility changes on dropdown menus, modals, etc.
**Actual**: The P0-2 fix (cold-start seed) should make the first visibility change detectable. But:
  - `getComputedStyle()` in a real browser content script runs in the ISOLATED world. It CAN read the page's computed styles.
  - `seedComputedStylesCache()` iterates ALL elements on the page at observation start. For large pages (Amazon), this could be slow but should work.
  - The visibility changes are stored in `ApplicationEvidence.visibilityChanges`, NOT in TargetEvidence state diff. They appear in a separate section.
**Where lost**: If `getComputedStyle` returns unexpected values, or if the page's CSS uses unusual mechanisms.
**Root cause**: Should work after P0-2. Needs real browser verification.
**Recommended fix**: Verify in DevTools that `evidence.applicationEvidence.visibilityChanges` has entries for dropdown open/close.

### GAP-4: Navigation Evidence

**Expected**: Real navigation evidence for SPA, synthetic for full-page reload
**Actual**: 
  - SPA navigation: Should work — content script survives, nav window captures mutations
  - Full-page reload: P1-3 fix adds synthetic evidence + 5s timeout
  - The synthetic evidence has `endReason: 'page-reload-synthetic'` and shows the destination URL
  - The click interaction that triggered the navigation gets evidence from its own window (if it closed before navigation) or synthetic/timeout evidence
**Where lost**: Full-page reload still loses DOM/network evidence from the triggering click. This is fundamental — the content script is destroyed.
**Root cause**: Content script lifecycle limitation.
**Recommended fix**: The P1-3 fix is the best available approach. Real browser testing needed to verify SPA navigation captures evidence correctly.

### GAP-5: Network Activity

**Expected**: NetworkActivity entries with URL, method, status, timing
**Actual**: **LIKELY STILL FAILING** due to the first-write-only bug.
**Where lost**: 
  1. MAIN-world injection may fail (CSP) — webRequest fallback exists
  2. webRequest timestamps may not align with content script timeline — P1-4 wallClock fix helps
  3. **CRITICAL**: Late network evidence (from 1000ms re-check) is DROPPED by `attachEvidenceToInteraction` because the interaction already has evidence from the initial window close. First-write-only prevents updates.
**Root cause**: First-write-only semantics in SW correlation prevent supplementary evidence from updating interactions.
**Recommended fix**: Allow network-only supplementary evidence to UPDATE existing evidence's networkActivity field, bypassing first-write-only for the network section specifically.

### GAP-6: All Observable State Changes

**Expected**: value, checked, disabled, aria-expanded, aria-checked, aria-pressed, textContent, childCount, visibility
**Actual**: After P0-1 fix:
  - `checked` ✅ (native checkboxes/radios)
  - `aria-checked` ✅ (custom ARIA checkboxes)
  - `aria-expanded` — SHOULD work if target element has the attribute AND cache was populated before the change
  - `value` — SHOULD work for inputs after P0-1
  - `disabled` — SHOULD work
  - `textContent` — SHOULD work for custom dropdowns (e.g., "Algerian" → "Costa Rican")
  - `childCount` — SHOULD work
  - Visibility — SHOULD work after P0-2
**Where lost**: Element resolution alignment is the key. If P0-1 works correctly in real browser, all 8 TargetStateSnapshot properties should diff correctly. The remaining gap is for custom dropdowns where `value` is not captured (textContent IS captured but labeled as `text:`, not `value:`).
**Root cause**: P0-1 fix should resolve most of this. Custom dropdown value capture is a separate issue.
**Recommended fix**: Verify in real browser. For custom dropdowns, consider `captureValue()` fallback to textContent for combobox-role elements.

### GAP-7: Typing keydown Filter

**Expected**: Single window per typing session
**Actual**: ✅ Working (confirmed by screenshots — single windows per field)
**Where lost**: Nowhere
**Root cause**: Previous fix (Enter-only keydown) resolved this
**Recommended fix**: None needed

---

## Summary: Where Evidence Is Lost

| Interaction Type | Primary Loss Point | Fix Status |
|---|---|---|
| **Text entry** | TargetStateCache before-snapshot timing | P0-1 should fix. Verify in DevTools. |
| **Single-select dropdown (native)** | value captured by captureValue() + snapshotElement.value — should work if element is `<select>` | Should work |
| **Single-select dropdown (custom)** | No `change` event, no `value` on div, only `textContent` changes | textContent diff should show after P0-1 |
| **Multi-select dropdown** | No multi-value field in model | Spec limitation |
| **Date picker** | Evidence targets the cell, not the input whose value changed | Need aria-controls resolution |
| **Radio/checkbox (native)** | ✅ Works | No fix needed |
| **Radio/checkbox (custom ARIA)** | ✅ Works after P0-1 | Verify in DevTools |
| **Navigation (SPA)** | Should work — content script survives | Verify |
| **Navigation (full-page reload)** | Content script destroyed | P1-3 synthetic + timeout is best available |
| **Scroll** | No scroll position in evidence | Spec doesn't define scroll evidence |
| **Network** | **First-write-only drops late network evidence** | Need to allow network updates |
| **All state changes** | Element resolution alignment | P0-1 should fix most |

---

## Key Architectural Findings

### Finding 1: Two Data Paths Never Merge
ObservedEvent.valueBefore/valueAfter (Path A) and TargetEvidence.before/after (Path B) are never combined. When Path B fails (cache miss), Path A data exists but is not displayed. **Recommendation**: Fall back to ObservedEvent values when TargetEvidence before is null.

### Finding 2: First-Write-Only Blocks Network Updates
`attachEvidenceToInteraction` has first-write-only semantics. The 1000ms network re-check delivers supplementary evidence that is silently dropped because the interaction already has evidence. **Recommendation**: Allow network-specific evidence updates.

### Finding 3: Surfaces Split Bug Still Present
Line 373: `surfaces.filter((_, i) => i % 2 === 0 || true)` — `|| true` makes the filter always true. `removedSurfaces` is always `[]`. This means all surface changes go to `newSurfaces` and none are classified as removed. This affects dropdown close evidence (menu disappearing should be a `removedSurface`).

### Finding 4: Custom Dropdown Value Capture Gap
`captureValue()` reads `.value` from `<input>`, `<textarea>`, `<select>`. For custom dropdowns (div-based), it falls back to `aria-valuetext`, `aria-valuenow`, `aria-selected`, `aria-activedescendant`. OrangeHRM OXD dropdowns don't use these ARIA attributes on the trigger — the selected value is in `textContent`. `snapshotElement()` captures `textContent` separately, so it SHOULD appear as a `text:` diff. But it won't appear as a `value:` diff.

### Finding 5: Date Picker Targets Wrong Element
When a user clicks a date cell, the evidence window targets the cell (not the input field). The input's value change is invisible because `snapshotElement()` captures the cell's properties, not the input's.

### Finding 6: scrollDeltaY/scrollDeltaX Not in BehavioralEvidence
The ObservedEvent captures scroll position, but BehavioralEvidence has no scroll-specific fields. Scroll evidence is limited to resulting DOM mutations.

---

## Recommended Priority for Next Fix Round

1. **P0 — Network first-write-only bug** (GAP-5): Allow network-only evidence to update existing evidence's networkActivity. Highest impact for Amazon/OrangeHRM where every interaction triggers API calls.

2. **P0 — Surfaces split bug** (GAP-3/GAP-6): Fix `i % 2 === 0 || true` and implement proper new/removed surface classification.

3. **P1 — ObservedEvent valueBefore/valueAfter fallback** (GAP-2/GAP-6): When TargetEvidence.before is null, use the ObservedEvent's valueBefore from triggerEvent.

4. **P1 — Custom dropdown value capture** (GAP-2): Augment `captureValue()` to fall back to textContent for combobox/listbox elements.

5. **P2 — Date picker aria-controls resolution** (GAP-6): If clicked element has `aria-controls`, also snapshot the controlled element.

6. **P2 — Scroll position in evidence** (GAP-6): Add scrollTop/scrollLeft to TargetStateSnapshot.

7. **P3 — Multi-select support** (spec gap): Add selectedValues[] field.

---

**End of RCA Report — No code changes made. No M8 started.**
