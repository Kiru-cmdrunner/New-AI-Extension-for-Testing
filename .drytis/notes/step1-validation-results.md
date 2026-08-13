# Step 1 Real-Browser Validation Results

**Date:** 2026-08-13
**Commit:** `cc830b1` (tag: `step1-validated-browser`)
**Baseline:** `f87fcb4`/`2828c4e` → `6132571` (Step 1 impl) → `cc830b1` (freeze)

## PASS — Lifecycle-Driven Evidence Finalization

### Text Input ✅
- **Before:** Partial values (`"" → "A"`, `Joh → ""`), 5s timeout on slow typing
- **After:** Captures complete values regardless of typing speed
- **Root cause fixed:** holdOpen window + lifecycle-driven finalization (FINALIZE_EVIDENCE)
- **Architecture:** Window opens on input event, holdOpen=true, finalizes when blur/focus-shift triggers lifecycle completion

### Custom Dropdown ✅
- **Before:** 5s timeout, evidence orphaned (lifecycle completed on mousedown before click)
- **After:** Lifecycle-driven evidence, no timeout, correct values
- **Architecture:** LIFECYCLE_BOUND + FINALIZE_EVIDENCE bridge connects lifecycle completion to evidence finalization

### Date Picker ✅
- **Before:** 5s timeout, same mousedown/click lifecycle gap
- **After:** Lifecycle-driven evidence, no timeout, correct date

### Checkbox/Radio ✅
- Regression-free, same behavior as baseline

### Click Evidence ✅
- Regression-free

---

## TECHNICAL DEBT — Recorded, NOT Fixed

### TD-1: Dropdown/DatePicker "Unknown element" despite correct values
- **Severity:** Medium (UX/display)
- **Symptom:** Evidence shows correct selected value but identity shows "Unknown element"
- **Likely cause:** IdentityExtractor fails to resolve the trigger element (dropdown button or date picker input) into a meaningful label/identity. The evidence value extraction works (lifecycle captures the value), but the element identity for the trigger is poor.
- **Deferral reason:** Identity extraction is a separate concern from lifecycle/evidence finalization. Fixing it requires changes to IdentityExtractor, not the lifecycle bridge.
- **Action:** Address after all lifecycle/evidence steps complete.

### TD-2: Scroll captures excessive container text
- **Severity:** Low-Medium (noise/clarity)
- **Behavior:** Scroll evidence includes large amounts of container text in the behavioral evidence snapshot.
- **Likely cause:** TargetStateCache capture() or evidence enrichment pulls too much textContent from parent containers. Scroll definition may need tighter scope on what DOM state to capture.
- **Deferral reason:** Scroll is a lower-priority interaction type. Text capture limits affect evidence clarity but not correctness of lifecycle/evidence.
- **Action:** Address after all lifecycle/evidence steps complete, before M8.

---

## Architecture Summary (v3, Step 1 Implemented)
- `adaptive-window.ts`: holdOpen flag + setHoldOpen() method
- `component-types.ts`: onLifecycleStart callback, lastActivityTime on ComponentContext
- `behavioral-evidence-types.ts`: lifecycle-complete/lifecycle-abandoned/page-reload endReasons
- `types.ts`: LIFECYCLE_BOUND + FINALIZE_EVIDENCE message types
- `component-runtime.ts`: idle-time stale eviction (300s), onLifecycleStart call, lastActivityTime update
- `sw-integration.ts`: EMERGENCY_TIMEOUT_MS=300000, sendLifecycleBound(), sendFinalizeEvidence(), wiring
- `recorder-entry.ts`: LIFECYCLE_BOUND + FINALIZE_EVIDENCE handlers, onPageHide
- `evidence-collector.ts`: lifecycleBindings map, handleLifecycleBound(), finalizeForInteraction(), settle delay (150ms), companion event suppression, onPageHide
