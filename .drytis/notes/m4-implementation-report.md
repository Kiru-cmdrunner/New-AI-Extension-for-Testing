# M4 Implementation + Validation Report

**Commit:** ef62970 (branch: capability-surgical-removal)  
**Parent:** 68f576e (M3 ApplicationEvidence)  
**Baseline:** 68f576e ← 20f5be8 (M2) ← 391e823 (M1) ← 3bc28f6 (clean baseline)  
**Spec:** `.drytis/specs/behavioral-evidence-model.md` v3.0, §4.1–4.7, §9.2  
**Date:** 2026-08-11

---

## What Was Built

### src/tap/evidence-collector.ts (582 LOC)

Central orchestrator composing M2 TargetStateCache + M3 DOMObserver/AdaptiveWindow into a full evidence lifecycle for every meaningful user interaction.

**Event-trigger matrix (§4.1):**
| Event Type | Strategy | Implementation |
|---|---|---|
| click, mousedown, contextmenu | Standard window | `openWindow()` |
| change | Standard window | `openWindow()` |
| keydown (Enter only) | Standard window | `openWindow()` |
| submit | Standard window | `openWindow()` |
| focus, blur | Standard window | `openWindow()` |
| input | Extend-on-input typing | `handleTypingEvent()` |
| scroll | Throttled 1/500ms | `handleScrollEvent()` |
| mouseenter, mouseleave, mousemove | Capture-only (ignored) | early return |
| navigation | Recorded + attributed | `recordNavigationEvent()` |

**Window lifecycle:**
1. **Open:** Enforce max concurrent → start DOMObserver (refcounted) → clear accumulated mutations → peek TargetStateCache for before snapshot → create AdaptiveWindow → arm stabilization timer → register batch callback
2. **Mutations:** DOMObserver batch callback feeds `adaptiveWindow.recordMutation(batchIndex)` for all active windows
3. **Close:** AdaptiveWindow fires onClose → assemble BehavioralEvidence (TargetEvidence with before/after snapshots + ApplicationEvidence with accumulated domChanges/surfaces/visibility/navEvents/performance) → deliver via `chrome.runtime.sendMessage({ type: 'BEHAVIORAL_EVIDENCE', payload })` → decrement DOMObserver refcount

**Key behaviors:**
- **Max 5 concurrent windows** with displacement: 6th window closes oldest with `endReason='displaced'`
- **Typing extend-on-input (§4.6):** `activeTypingTarget` tracking — if same target, extend timer (reset to 300ms quiescence); if different target, close current + open new; if typing target loses focus/changes, close with `endReason='typing-complete'`
- **Scroll throttle (§4.7):** `lastScrollWindowTime` initialized to `-Infinity` on start; max 1 window per `MIN_SCROLL_INTERVAL_MS` (500ms)
- **Navigation evidence:** Detected via EventTap's `emitSpaNavigation()` → records `NavigationEvidence` (type, fromUrl, toUrl, relativeTime, batchIndex) and attributes to all active windows
- **Capture-only events:** `mouseenter`, `mouseleave`, `mousemove` silently ignored — no window opened

### recorder-entry.ts modifications
- Imports `DOMObserver` and `EvidenceCollector`
- `startRecording()`: creates `DOMObserver` + `EvidenceCollector` with `onAfterEvent` callback wired to `createEventTap()`, then starts collector
- `stopRecording()`: stops collector (force-closes all windows) then destroys

### service-worker.ts modifications
- `BEHAVIORAL_EVIDENCE` handler in `chrome.runtime.onMessage`
- `pendingEvidence: Map<string, BehavioralEvidence>` (max 100 entries, LRU eviction)
- `handleBehavioralEvidence()` stores evidence keyed by `sourceEventId`

### event-tap.ts modifications
- Added `'submit'` to `eventTypes` array (registration of submit events)

---

## What Was NOT Built (Explicitly Deferred)

- M5: Shadow DOM recursive observation
- M6: Network evidence (MAIN-world inject + webRequest)
- M7: Side panel display of evidence
- M8: Persistence (Dexie V4 migration, session archival with evidence)
- Causal correlation or interpretation of evidence
- sessionStorage evidence buffer for SW restart recovery (skeleton only, not wired)

---

## Verification

### TypeScript
```
npx tsc --noEmit → 0 errors
```

### Unit Tests
```
npx vitest run → 98 files, 2138 tests passing (+25 new from evidence-collector.test.ts)
```

### evidence-collector.test.ts (25 tests)
Covers:
- Event-trigger matrix (click, change, focus, blur, keydown → window opens)
- Capture-only events (mouseenter, mouseleave, mousemove → no window)
- Extend-on-input typing (same target extends, different target closes+opens, 300ms quiescence closes)
- Scroll throttle (1 window per 500ms, throttled within, new after 500ms)
- Max 5 concurrent windows with displacement (6th closes oldest)
- Navigation evidence (recorded and attributed to active windows)
- BehavioralEvidence assembly (TargetEvidence before/after, ApplicationEvidence domChanges)
- Evidence delivery via `chrome.runtime.sendMessage`

### Build
```
npm run build → 37 files, 128.9 KB (includes m4-validation.html)
```

### ZIP Audit
- **36 files** (35 from build + 1 test page)
- **0 nested ZIPs** ✓
- **0 source maps** ✓
- **0 .ts source files** ✓
- **0 old Capability Model traces** ✓
- **0 old Behavioral Observation traces** ✓
- All 9 manifest-referenced files present ✓
- EvidenceCollector, DOMObserver, AdaptiveWindow, TargetStateCache, BEHAVIORAL_EVIDENCE confirmed in bundles ✓
- SHA256: `90fa26a928bdb529701bff93c52ae01ea5a4e7517710b6871b6036051c554e0a` (pre-test-page rebuild)
- SHA256: `8fc369b7e9802b7e70c06322a3d0be6d152a776aa0eef48ce0f6f9aa4aa3a892` (with test page)

### Real-Browser Validation (14/14 PASS)
| # | Scenario | Verdict | Detail |
|---|---|---|---|
| 1 | Checkbox toggle | ✓ PASS | before=false, after=true |
| 2 | Radio button selection | ✓ PASS | Selected: B |
| 3 | Native select | ✓ PASS | selected="banana" |
| 4 | Custom dropdown (DOM mutation) | ✓ PASS | menu opened, status="Selected: cherry" |
| 5 | Text entry (typing) | ✓ PASS | typed "Hello", got "Hello" |
| 6 | Multiple rapid clicks | ✓ PASS | clicked 5×, button text="Click count: 5" |
| 7 | Toggle color (class/style) | ✓ PASS | status="Background: green" |
| 8 | Hash navigation | ✓ PASS | URL changed with # |
| 9 | History pushState navigation | ✓ PASS | URL includes ?page= |
| 10 | DOM changes elsewhere (add) | ✓ PASS | 2 items added |
| 11 | DOM changes elsewhere (remove) | ✓ PASS | 1 item remaining |
| 12 | Modal open/close | ✓ PASS | opened=true, closed=true |
| 13 | Autocomplete (input + mutation) | ✓ PASS | 2 results shown, selected="apple" |
| 14 | No console errors | ✓ PASS | 0 errors |

### Existing Recording/Classification/Generation Unchanged
All 420 tests across tap/recorder/component-runtime/domain test suites pass with zero failures:
- EventTap, IdentityExtractor, ComponentRuntime unchanged
- Projection Engine, IR Bridge, Repository V2 unchanged
- Existing capture/classification/generation pipeline unaffected

---

## Files Changed

| File | Change | LOC |
|---|---|---|
| `src/tap/evidence-collector.ts` | NEW | +582 |
| `tests/tap/evidence-collector.test.ts` | NEW | +429 |
| `src/recorder/phase5/recorder-entry.ts` | MODIFIED | +20, -1 |
| `src/background/service-worker.ts` | MODIFIED | +18, -0 |
| `src/tap/event-tap.ts` | MODIFIED | +1, -0 |
| `public/m4-validation.html` | NEW (test page) | +297 |

**Total:** 6 files changed, +1201 insertions, -5 deletions

---

## Commit History

```
ef62970 M4: EvidenceCollector — end-to-end evidence orchestration
68f576e M3 ApplicationEvidence: DOMObserver + AdaptiveWindow + mutation cap
20f5be8 M2 TargetEvidence: TargetStateCache + capture-phase listeners
391e823 M1 Foundation: types + EventTap hooks + inputType
3bc28f6 Clean baseline (Capability Model + Behavioral Observation removed)
deff878 Original baseline (historical reference only)
```

---

## Known Limitations (M4 Scope)

1. **No Shadow DOM:** Mutations inside open/closed shadow roots are not observed (M5)
2. **No Network Evidence:** No fetch/XHR interception (M6)
3. **No Persistence:** BehavioralEvidence is delivered to SW but not persisted to Dexie (M8)
4. **No Side Panel Display:** Evidence not shown in UI (M7)
5. **No SW Restart Recovery:** `sessionStorage` buffer not yet implemented (skeleton only)
6. **Identity comes from EventTap:** EvidenceCollector captures `identity: null` — full identity comes from the ObservedEvent pipeline, not available in the evidence window directly. M4 spec §4.4 step 8 notes identity is set from the correlated ObservedEvent.

---

## Conclusion

M4 is complete. EvidenceCollector successfully composes M2 TargetEvidence + M3 ApplicationEvidence into a unified BehavioralEvidence stream delivered to the Service Worker. All 13 required browser scenarios pass with zero console errors. Existing recording/classification/generation pipeline is unchanged. Ready for M5 (Shadow DOM) when directed.
