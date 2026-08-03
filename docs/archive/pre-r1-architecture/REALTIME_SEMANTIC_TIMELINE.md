# Real-Time Semantic Timeline — Architecture Requirement

**Purpose:** Define the requirement for real-time semantic interaction display during recording.  
**Problem:** The current recorder shows raw DOM events during recording. Semantic interactions only appear after STOP.  
**Goal:** Show completed SemanticInteractions in real-time, matching the old recorder's UX.  

---

## Current State vs Required State

### Current Flow (Wrong)

```
User clicks/types
    │
    ▼
Content Script captures events → RECORDED_EVENT messages
    │
    ▼
Service Worker stores RecordedEvent[] in chrome.storage
    │
    ▼
Side Panel listens to SESSION_EVENTS → renders RAW EVENTS
    │
    │  "Event Timeline"
    │  • click on DIV (id="oxd-to-...")
    │  • focus on INPUT (placeholder="yyyy-dd-mm")
    │  • input on INPUT
    │  • change on INPUT
    │  • blur on INPUT
    │  • click on LI (role="option")
    │
    ▼
User clicks STOP
    │
    ▼
Service Worker runs FULL PIPELINE (V1 + V2 + merge + semantic + domain + IR)
    │
    ▼
Side Panel shows "Observed Workflow" (semantic interactions)
    │
    │  "Observed Workflow"
    │  • Select 'Australian' from 'American' (Nationality)
    │  • Enter 'Kirubakaran' in 'First Name'
    │
    ▼
Raw events relegated to collapsible debug section
```

**The problem:** During the most important moment (when the user is actively recording and validating), they see implementation noise. The clean semantic output only appears after they stop.

### Required Flow (Correct — matches old recorder)

```
User clicks/types
    │
    ▼
Content Script captures events → RECORDED_EVENT messages
    │
    ▼
Service Worker processes events INCREMENTALLY through lifecycle engine
    │
    ├── Event arrives → lifecycle engine processes it
    ├── If session activates → no output yet (pending)
    ├── If session absorbs → no output yet (pending)
    ├── If session completes → EMIT SemanticInteraction
    ├── If session cancels → emit trigger as fallback
    └── If standalone interaction → emit immediately
    │
    ▼
Service Worker streams COMPLETED SemanticInteractions to chrome.storage
    │
    ▼
Side Panel listens to SEMANTIC_INTERACTIONS → renders BUSINESS-LEVEL TIMELINE
    │
    │  "Observed Interactions"
    │  int-01  📍 Navigate to OrangeHRM
    │  int-02  ✏️ Enter 'Kirubakaran' in 'First Name'
    │  int-03  📋 Select 'Australian' from Nationality
    │  int-04  📋 Select 'Married' from Marital Status
    │  int-05  ⭕ Select 'Female'
    │  int-06  ✅ Check 'Smoker'
    │  int-07  🖱️ Click 'Save'
    │
    ▼
User clicks STOP
    │
    ▼
Service Worker finalizes: flush pending sessions, run enrichment, generate IR
    │
    ▼
Side Panel shows final artifacts (IR steps, generated code)
```

---

## Architecture Impact

### What Changes

| Component | Current | Required |
|-----------|---------|----------|
| **Pipeline timing** | Batch at STOP | Incremental during recording + finalize at STOP |
| **Lifecycle engine** | Runs on all events at STOP | Runs per-event as events arrive |
| **Side panel recording view** | Shows raw `RecordedEvent[]` | Shows completed `SemanticInteraction[]` |
| **Storage during recording** | `SESSION_EVENTS` (raw events) | `SESSION_EVENTS` (raw, internal) + `SEMANTIC_INTERACTIONS` (public) |
| **HTML recording section** | "Event Timeline" | "Observed Interactions" |
| **Raw events during recording** | Primary view | Hidden (available in dev/debug only) |

### The Incremental Processing Requirement

The lifecycle engine must process events **as they arrive**, not as a batch. This is actually simpler than it sounds because the semantic reasoner is already a stream processor:

```typescript
// Current: batch at STOP
function processRecording(events: RecordedEvent[]): SemanticInteraction[] {
  const v1 = detectInteractions(events);
  const v2 = detectInteractionsV2(events);
  const merged = mergeV1V2(v1, v2);
  return reasonAboutInteractions(merged);
}

// Required: incremental during recording
function onRecordedEvent(event: RecordedEvent): void {
  // 1. Run evidence classification on this event
  const evidence = collectEventEvidence(event);
  
  // 2. Feed to lifecycle engine (stream processor)
  const output = lifecycleEngine.process(event, evidence);
  
  // 3. If lifecycle engine emitted a SemanticInteraction, stream it to UI
  if (output) {
    semanticInteractions.push(output);
    chrome.storage.local.set({ [SEMANTIC_INTERACTIONS]: semanticInteractions });
  }
  
  // 4. Also store raw event (internal, for debugging/reprocessing)
  rawEvents.push(event);
  chrome.storage.local.set({ [SESSION_EVENTS]: rawEvents });
}

// At STOP: finalize
function onStopRecording(): void {
  // Flush any pending lifecycle sessions (with timeout fallback)
  const flushed = lifecycleEngine.flush();
  semanticInteractions.push(...flushed);
  
  // Run enrichment, IR generation, code generation
  const ir = generateIR(semanticInteractions);
  const code = generateCode(ir);
  
  // Store everything
  persistAll(semanticInteractions, ir, code);
}
```

### Why This Works with the Target Architecture

The unified lifecycle engine (from the architecture review) is already designed as a **stream processor**. The semantic reasoner's 7-check flow (navigation lookback → stale cleanup → cancellation → completion → absorption → activation → pass-through) operates per-interaction. Moving from batch to incremental is a natural fit.

The key insight: **standalone interactions (Click, Navigate, Toggle, etc.) emit immediately. Composite interactions (dropdown, date picker, autocomplete, multiConfig) emit when their lifecycle completes — which may be seconds later. Both are correct behavior for a real-time timeline.**

### What the User Sees During Recording

| User Action | What Appears in Timeline | When |
|------------|------------------------|------|
| Navigate to a page | `📍 Navigate to /login` | Immediately (standalone) |
| Click "Login" button | `🖱️ Click 'Login'` | Immediately (standalone) |
| Type in username field | `✏️ Enter 'admin' in 'Username'` | On blur (text entry lifecycle completes) |
| Open dropdown, browse, select | `📋 Select 'Belgian' from 'Nationality'` | On option click (dropdown lifecycle completes) |
| Click date input, navigate calendar, click day | `📅 Select 2023-10-21 for 'Date of Birth'` | On day click (date picker lifecycle completes) |
| Check a checkbox | `✅ Check 'Remember me'` | Immediately (standalone) |
| Select a radio | `⭕ Select 'Female'` | Immediately (standalone) |
| Click inside a config panel, configure fields, click Done | `⚙️ Configure Flight Options: Cabin=Premium, Adults=2` | On Done click (multiConfig lifecycle completes) |

**The user sees business-level intent in real-time.** If they open a dropdown and haven't selected yet, nothing appears (the session is pending). When they select, the complete interaction appears.

### Pending State Indication (Optional Enhancement)

For composite interactions that take multiple events (dropdowns, date pickers), the user might wonder if their click registered. An optional "pending" indicator could show:

```
📋 Observed Interactions
  int-01  📍 Navigate to /pim/my-info
  int-02  ✏️ Enter 'Kirubakaran' in 'First Name'
  int-03  ⟳ Selecting from Nationality...     ← pending indicator
```

This would disappear when the dropdown selection completes and is replaced by:
```
  int-03  📋 Select 'Australian' from 'Nationality'
```

This is a UX enhancement, not a core requirement. The old recorder didn't show pending states — it just showed completed interactions.

---

## Implementation Changes Required

### 1. Service Worker: Incremental Pipeline

**Current:** `handleStopRecording()` runs the entire pipeline.

**Required:** Add an incremental handler in the `RECORDED_EVENT` message handler that:
1. Runs evidence classification on the incoming event
2. Feeds the classified event to the lifecycle engine
3. Streams any completed SemanticInteraction to `chrome.storage.local[SEMANTIC_INTERACTIONS]`
4. Continues storing raw events in `chrome.storage.local[SESSION_EVENTS]`

At STOP:
1. Flush pending lifecycle sessions
2. Run enrichment (assertions, labels) on the complete SemanticInteraction[]
3. Generate IR and code
4. Persist everything

### 2. Side Panel: Semantic Timeline During Recording

**Current:** Recording view listens to `SESSION_EVENTS` → renders `RecordedEvent[]` via `renderEventTimeline()`.

**Required:** Recording view listens to `SEMANTIC_INTERACTIONS` → renders `SemanticInteraction[]` via `renderDetectedInteractions()` (or a new `renderSemanticTimeline()`).

### 3. HTML: Recording View Section

**Current:**
```html
<div class="timeline" id="timeline">
  <div class="timeline__header">
    <h2 class="timeline__title">Event Timeline</h2>
    <span class="timeline__count" id="timeline-count">0</span>
  </div>
  <div class="timeline__events" id="timeline-events">
    <p class="timeline__empty">Recording... events will appear here.</p>
  </div>
</div>
```

**Required:**
```html
<div class="timeline" id="timeline">
  <div class="timeline__header">
    <h2 class="timeline__title">📋 Observed Interactions</h2>
    <span class="timeline__count" id="timeline-count">0</span>
  </div>
  <div class="timeline__events" id="timeline-events">
    <p class="timeline__empty">Recording... interactions will appear as you use the page.</p>
  </div>
</div>
```

### 4. Stopped View: Raw Events as Debug-Only

The stopped view already has the right structure:
- "Observed Workflow" (primary) ✅
- "Raw Event Timeline" (collapsible, hidden by default) ✅

No changes needed here. The stopped view is already correct.

### 5. New Storage Key

Add `SEMANTIC_INTERACTIONS` to `StorageKeys`:

```typescript
SEMANTIC_INTERACTIONS: 'semantic_interactions',
```

This is written incrementally during recording and finalized at STOP.

---

## Impact on Architecture Freeze

### New Requirement Added to Success Criteria

> **Success Criterion: Real-Time Semantic Timeline**
> During recording, the side panel shows completed SemanticInteractions in real-time. Raw events are never shown to the user during recording. Raw events remain available in the stopped view's collapsible debug section.

### Impact on Migration Phases

This requirement affects Phase 3 (Lifecycle Unification). The unified lifecycle engine must be designed for **incremental processing** from the start, not just batch processing. This is already a natural property of the stream-processor design but should be called out explicitly.

| Phase | Impact |
|-------|--------|
| Phase 0 (Freeze) | Add real-time timeline to success criteria |
| Phase 1 (Guard rails) | No impact |
| Phase 2 (Remove V1) | Must implement incremental V2 classification (per-event, not batch) |
| Phase 3 (Unify lifecycle) | Lifecycle engine must process per-event and emit incrementally |
| Phase 4+ | No additional impact |

### Revised Lifecycle Engine Requirement

The lifecycle engine must support BOTH modes:
1. **Incremental mode** (during recording): `process(event)` → optional `SemanticInteraction` output
2. **Batch mode** (for reprocessing/debugging): `processAll(events)` → `SemanticInteraction[]`

Both modes use the same lifecycle definitions and session management. The difference is only in how events are fed to the engine.

---

*This document defines the real-time semantic timeline requirement. It is a user experience requirement that drives the pipeline architecture toward incremental processing.*
