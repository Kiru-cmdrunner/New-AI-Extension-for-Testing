# M7-Fix Manual Test Issue — Root Cause Analysis

**Build tested:** `fadb146` ZIP (`cmdrunner-extension-m7fix.zip`, SHA256: `1765dede…`)
**Site tested:** Amazon
**Date:** 2026-08-11

## Symptoms

1. **Captured Steps count increases to 8** — event capture, interaction classification, and storage writes are working
2. **Interaction cards not displayed in side panel** — the `timelineEvents` container stays empty despite count updating
3. **Stop Recording button not responding** — clicking does nothing; no view transition to 'stopped'

## Verdict

**Both symptoms have the SAME root cause: an unhandled TypeError in `evidence-renderer.ts` that aborts the `renderInteractions` loop and corrupts the side panel's event handling.**

The M7-fix is **necessary but exposed** a latent defect: `evidence-renderer.ts` was never exercised with real data before because the M7 base's eventId/interactionId mismatch prevented evidence from ever being attached to interactions. The M7-fix correctly attaches evidence, which causes `renderEvidence()` to be called for the first time with real-world evidence objects — and several code paths throw on real Amazon-scale data.

---

## Detailed Trace

### Trace 1: ComponentRuntime → SW/storage → sidepanel → interaction list rendering

**During recording (live updates):**

```
Content Script (Amazon page)
  ↓ OBSERVED_EVENT message
SW: handleObservedEvent()
  ↓ processObservedEvent() → runtime.classify() → onEmit()
sw-integration.ts: onEmit callback (L156)
  ↓ enrichInteraction(interaction)
  ↓ drainPendingEvidence(interaction)     ← M7-fix addition
  ↓ liveInteractions.push(interaction)
  ↓ persistLiveInteractions()              ← writes to chrome.storage.local

Meanwhile, content script's EvidenceCollector:
  ↓ Opens window on click/focus/input
  ↓ Collects DOM mutations (Amazon: 100s of mutations per interaction)
  ↓ Closes window → builds BehavioralEvidence
  ↓ BEHAVIORAL_EVIDENCE message to SW

SW: handleBehavioralEvidence() (L410)      ← M7-fix rewrote this
  ↓ attachEvidenceToInteraction(sourceEventId, evidence)
    ↓ Tier 1: interaction.triggerEvent.eventId === sourceEventId → MATCH
    ↓ interaction.behavioralEvidence = evidence
    ↓ persistLiveInteractions()            ← SECOND write with evidence attached
  ↓ broadcasts INTERACTION_EVIDENCE_UPDATE {interactionId, evidence}

Side Panel:
  chrome.storage.onChanged fires for LIVE_INTERACTIONS
  ↓ Listener 1 (L1004): timelineCount.textContent = "8"    ← WORKS (count shows)
  ↓ Listener 1 (L1004): renderProductionInteractions(timelineEvents, interactions)
    ↓ renderInteractions() (L304):
      ↓ container.innerHTML = ''                           ← clears container
      ↓ for (const interaction of interactions):
        ↓ createInteractionElement(interaction)            ← builds card DOM
        ↓ attachEvidenceDisplay(el, interaction):
          ↓ interaction.behavioralEvidence IS SET (M7-fix!)
          ↓ renderEvidence(container, interaction.behavioralEvidence)  ← FIRST REAL CALL
          ↓ ↓ evidence.window.durationMs  ← OK
          ↓ ↓ renderTargetEvidence(target)
          ↓ ↓   ↓ target.identity.tag     ← OK if identity exists
          ↓ ↓   ↓ diffSnapshots(before, after)  ← OK (well-guarded)
          ↓ ↓ ↓ renderApplicationEvidence(app)
          ↓ ↓ ↓   ↓ renderDomChanges(app.domChanges, ...)
          ↓ ↓ ↓ ↓   ↓ change.types.join('+')     ← CRASH if types undefined
          ↓ ↓ ↓ ↓   ↓ change.attributeDeltas[attr]  ← CRASH if attributeDeltas undefined
          ↓ ↓ ↓ ↓   ↓ ...
          ↓ ↓ ↓ ↓   ↓ truncate(change.targetPath, 30)  ← CRASH if targetPath undefined
          ↓ ↓ ↓   ↓ renderNavigation(app.navigation)
          ↓ ↓ ↓     ↓ truncate(event.fromUrl, 40)  ← CRASH if fromUrl undefined
          ↓ ↓ ↓     ↓ truncate(event.toUrl, 40)    ← CRASH if toUrl undefined
          ↓ ↓ ↓   ↓ renderVisibilityChanges(app.visibilityChanges)
          ↓ ↓ ↓     ↓ truncate(change.path, 40)    ← CRASH if path undefined
          ↓ ↓ ↓   ↓ renderNetworkActivity(app.networkActivity)
          ↓ ↓ ↓     ↓ truncate(entry.url, 60)      ← CRASH if url undefined
          ↓ ↓ ↓ TypeError THROWN → exception propagates up
          ↓ ↓ ↓ renderInteractions loop ABORTS
          ↓ ↓ ↓ container has 0 cards (or partial if crash happened after card N)
          ↓ ↓ ↓ listener callback exits via exception
```

**Result:** The count text was already set to "8" BEFORE the render call (line 1007 before 1008). The render call throws, aborting card creation. The container was already cleared (`innerHTML = ''`). **Cards are not displayed.**

### Trace 2: Stop Recording button → message → SW handler → persistence → sidepanel

```
User clicks Stop Recording
  ↓ stopBtn click handler (L1204): handleStopRecording()
  ↓ await sendMessage({ type: 'STOP_RECORDING' })
    ↓ chrome.runtime.sendMessage to SW
    ↓ SW listener (L732): case 'STOP_RECORDING': handleStopRecording()
      ↓ handleStopRecording() is async, NOT awaited by the listener
      ↓ listener returns false immediately
    ↓ sendMessage resolves (message delivered)
  ↓ side panel continues...
  ↓ await StorageService.getRecordingContext()   ← might work
  ↓ const interactions = await loadDetectedInteractions()
    ↓ reads LIVE_INTERACTIONS from storage
    ↓ interactions has 8 items WITH behavioralEvidence attached
  ↓ showDetectedInteractions(interactions)
    ↓ renderProductionInteractions(detectedInteractionsList, interactions)
    ↓ SAME CRASH PATH as above → cards not rendered

But the REAL problem with Stop Recording is subtler:

The handleStopRecording function continues through its entire body
even if rendering throws, because each section is independent.
The function should eventually call showView('stopped') at line 462.

HOWEVER: if the thrown error from renderProductionInteractions
propagates through showDetectedInteractions → handleStopRecording,
the async function rejects, and showView('stopped') at L462 is
NEVER reached. The view stays on 'recording'.

The user sees: Stop button clicked, nothing happened.
```

Wait — actually, `showDetectedInteractions` is called at L408, which is inside a try-free block. If it throws, the `handleStopRecording` async function rejects at that point, and lines 409-462 (including `showView('stopped')`) never execute.

**This is why Stop Recording "doesn't respond" — the view transition to 'stopped' never happens because `renderProductionInteractions` throws inside `showDetectedInteractions` inside `handleStopRecording`.**

### Trace 3: Console errors

The side panel would show an **uncaught TypeError** in the console:
```
Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'length')
    at truncate (evidence-renderer.ts:59)
    at renderNavigation (evidence-renderer.ts:410)
    at renderApplicationEvidence (evidence-renderer.ts:519)
    at renderEvidence (evidence-renderer.ts:591)
    at attachEvidenceDisplay (interaction-renderer.ts:295)
    at renderInteractions (interaction-renderer.ts:320)
    at renderProductionInteractions (interaction-renderer.ts:357)
    at <storage onChanged listener> (sidepanel.ts:1008)
```

Or similar for whichever specific field is undefined. The exact line depends on which field is missing in the Amazon evidence data.

### Trace 4: Does the M7-fix interfere with normal rendering?

**YES — it is the direct cause.** Here's why:

In the M7 base (`ac20b93`):
- `handleBehavioralEvidence` always broadcast `INTERACTION_EVIDENCE_UPDATE` with `{eventId, evidence}`
- Side panel's `handleEvidenceUpdate` searched for a card by `eventId` — NEVER matched (badges show `interactionId`)
- `interaction.behavioralEvidence` was NEVER set on any interaction
- `attachEvidenceDisplay` always went to the `else` branch → `renderEvidencePlaceholder()`
- `renderEvidence()` was **never called with real data**
- Cards rendered fine (just with placeholder text)

In the M7-fix (`fadb146`):
- `handleBehavioralEvidence` calls `attachEvidenceToInteraction` which **successfully** matches evidence to interactions
- `interaction.behavioralEvidence` IS now set
- `persistLiveInteractions()` is called, writing the updated interactions (with evidence) to storage
- Storage `onChanged` fires, side panel re-renders
- `attachEvidenceDisplay` now calls `renderEvidence(container, interaction.behavioralEvidence)`
- `renderEvidence()` is called with **real Amazon-scale evidence data** for the first time
- **TypeError thrown** — renderer has ~18 unsafe property access paths
- Rendering aborts, cards not displayed, Stop handler fails

### Trace 5: Same root cause or separate issues?

**SAME ROOT CAUSE.** Both symptoms stem from the same TypeError:

1. **Cards not displayed:** TypeError in `renderEvidence` aborts `renderInteractions` loop after clearing the container
2. **Stop not responding:** TypeError propagates through `showDetectedInteractions` → `handleStopRecording`, preventing `showView('stopped')` from executing

---

## The Defect: evidence-renderer.ts Has No Runtime Validation

The researcher's audit found **18 crash paths** in `evidence-renderer.ts`. The root cause is that the renderer trusts TypeScript types at runtime — there is zero validation that the evidence object's fields actually exist when received from `chrome.storage.local` or `chrome.runtime.onMessage`.

### Most Likely Crash Path on Amazon

The highest-probability crash on Amazon is in `renderDomChanges`:

```typescript
// Line 290
parts.push(change.types.join('+'));
// Line 295
if (change.changedAttributes.length > 0) {
// Line 297
const delta = change.attributeDeltas[attr];
```

If ANY `DomChangeSummary` in the array has a missing `types`, `changedAttributes`, or `attributeDeltas` field (which can happen when the DOMObserver summarizes mutations on complex Amazon elements), the renderer throws.

Amazon's DOM is extremely complex with:
- React/custom element frameworks that mutate attributes in batches
- Shadow DOM usage
- Dynamic class/attribute changes on thousands of elements
- A/B testing infrastructure that adds/removes attributes

This increases the likelihood that some `DomChangeSummary` objects have incomplete fields.

### The `truncate` Function Is the Single Most Dangerous Utility

```typescript
function truncate(str: string, max: number): string {
  if (str.length <= max) return str;  // throws if str is null/undefined
  return str.substring(0, max) + '…';
}
```

Called 9 times across the file. Any caller passing a nullable value without a prior null check will throw. The `safeText` function exists for this purpose but is not used consistently.

### The Render Loop Has No Error Boundary

```typescript
// interaction-renderer.ts L318-321
for (const interaction of interactions) {
  const el = createInteractionElement(interaction);
  attachEvidenceDisplay(el, interaction);  // ← can throw
  container.appendChild(el);               // ← never reached if above throws
}
```

No try/catch. One throw from any card's evidence rendering aborts the entire loop.

---

## Impact Assessment

| Component | Impact | Details |
|-----------|--------|---------|
| `evidence-renderer.ts` | **PRIMARY DEFECT** | 18 unsafe property access paths, no runtime validation, no error boundary |
| `interaction-renderer.ts` | **AMPLIFIER** | `renderInteractions` loop has no try/catch — one card's failure kills all cards |
| `sidepanel.ts` | **VICTIM** | `handleStopRecording` calls `showDetectedInteractions` which calls the broken renderer; if it throws, `showView('stopped')` never executes |
| `sw-integration.ts` (M7-fix) | **CORRECT** | The two-tier matching, evidence attachment, and persistence are working correctly. The fix is not defective — it exposed a latent defect |
| `service-worker.ts` (M7-fix) | **CORRECT** | The `handleBehavioralEvidence` rewrite is correct. Evidence is properly matched and broadcast |
| M1–M6 source | **UNAFFECTED** | No changes made to evidence collection, DOM observation, or event capture |

### Why Tests Didn't Catch This

The 20 integration tests in `evidence-correlation.test.ts` test the **matching algorithm** (sw-integration.ts) with well-formed synthetic evidence objects. They do NOT test the **rendering path** (evidence-renderer.ts) with real-world evidence data that may have missing fields.

The test suite has no tests that:
1. Feed evidence with missing/undefined fields to `renderEvidence`
2. Verify that `renderInteractions` doesn't abort on one bad card
3. Verify that `handleStopRecording` completes even if rendering throws

### Why the Validation Page Didn't Catch This

The `m7fix-validation.html` page tests the correlation algorithm using vanilla JS with well-formed evidence objects. It doesn't exercise the TypeScript rendering code path at all.

### Why the Manual Amazon Test Caught This

Amazon produces real-world evidence data with:
- Large numbers of DOM mutations (complex SPA)
- Edge cases in DOMObserver summarization (attributes, character data, child lists)
- Navigation events during SPA transitions
- Network activity entries with varying field completeness

This real data exercises code paths that synthetic tests never reach.

---

## Proposed Fix Direction (NOT YET IMPLEMENTED)

### Layer 1: Error boundary in the render loop

```typescript
for (const interaction of interactions) {
  try {
    const el = createInteractionElement(interaction);
    attachEvidenceDisplay(el, interaction);
    container.appendChild(el);
  } catch (err) {
    // Render the card WITHOUT evidence rather than skipping it entirely
    const el = createInteractionElement(interaction);
    el.appendChild(renderEvidencePlaceholder());
    container.appendChild(el);
    console.warn('[Evidence] render failed for', interaction.interactionId, err);
  }
}
```

### Layer 2: Null-safe `truncate`

```typescript
function truncate(str: string | null | undefined, max: number): string {
  if (str == null) return '—';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}
```

### Layer 3: Defensive defaults in sub-renderers

Every array parameter should default to `[]`, every object access should be guarded. Or, better:

### Layer 4 (preferred): Normalization at the boundary

Add a `normalizeEvidence(evidence): BehavioralEvidence` function that fills in defaults for all missing fields, called at the point where evidence enters the renderer (both from `INTERACTION_EVIDENCE_UPDATE` messages and from `interaction.behavioralEvidence` during rendering).

### Layer 5: try/catch in handleStopRecording

Wrap the `showDetectedInteractions` call so that `showView('stopped')` always executes even if rendering throws.

---

## Summary

| Question | Answer |
|----------|--------|
| Root cause | `evidence-renderer.ts` has 18 unsafe property access paths that throw TypeError on real-world evidence data |
| Why now? | M7-fix correctly attaches evidence to interactions (the M7 base never did), so `renderEvidence()` is called with real data for the first time |
| Are both symptoms the same issue? | YES — the TypeError from rendering aborts both the live card display AND the Stop Recording view transition |
| Is the M7-fix wrong? | NO — the correlation logic is correct. It exposed a latent defect in the renderer that was never exercised before |
| What about M1–M6? | Unaffected — no source changes to evidence collection or event capture |
| Fix complexity | Low — error boundary + null-safe truncate + defensive defaults. ~50-80 lines changed in `evidence-renderer.ts` and `interaction-renderer.ts` |
