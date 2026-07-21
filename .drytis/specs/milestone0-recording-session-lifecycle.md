# Milestone 0 — Recording Session Lifecycle

## Product Specification (Revision 3)

**Status:** DESIGN ONLY — awaiting approval before any implementation.

**Revision 3 changes:**
- Added the Interaction Pipeline contract — every interaction follows the same stages.
- Added the classification principle — an interaction is not recorded until classified.

**Revision 2 changes:**
- Starting page is now **Recording Context** (session metadata), not a Navigation event.
- Lifecycle extended with REVIEW → APPROVED → SAVED states.
- Established the foundational product principle: **intent, not browser events.**

---

## Foundational Product Principle

### The Recorder Captures User Intent, Not Browser Events

This is the single most important principle for the entire interaction engine.

When a user clicks a "Login" button, the browser fires:
```
mousedown → mouseup → click → focus → blur
```

The recorder must **never** think in these terms.

The recorder must think:
```
User intended to click Login.
```

Browser events are implementation details — the raw material from which intent is inferred. They are never the product. The product is the **intent**.

Every interaction design decision in CmdRunner flows from this principle:
- Plain English describes what the user intended to do.
- Execution JSON describes how to reproduce that intent.
- AI understanding interprets the user's purpose.
- Dedup logic prevents recording the same intent twice.

This principle is established now, before any interaction is designed, so it shapes every subsequent decision.

### An Interaction Is Not Recorded Until It Has Been Classified

Browser events are transient. They fire and vanish. A `mousedown` followed by a `mouseup` followed by a `click` is not an interaction — it's raw material.

An interaction exists only after CmdRunner has decided:

> This is a **Click** on the **Login** button.

Until that classification happens, there is **no interaction**. There is no step. There is nothing to record.

This is why classification sits at the center of the pipeline. Everything upstream is raw signal. Everything downstream is product. The classification step is the bridge — the moment raw browser events become a meaningful user action.

### Every Interaction Follows the Same Pipeline

This is the contract for the entire interaction engine. Whether it's Click, Text Entry, Dropdown, Hover, Scheduler, or Data Grid — they all pass through the exact same stages:

```
User Intent
       │
       ▼
Interaction Detection
       │  (content script observes browser events)
       ▼
Interaction Validation
       │  (is this a real user action or noise?)
       ▼
Interaction Classification
       │  (what type of interaction is this?
       │   this is where browser events become an interaction)
       ▼
Plain English Generation
       │  (describe the intent in human language)
       ▼
Execution JSON Generation
       │  (describe how to reproduce the intent)
       ▼
Timeline Rendering
       │  (show the tester what was captured)
       ▼
Review
       │  (tester reviews the generated test case)
       ▼
Approval
       │  (tester approves the test case)
       ▼
Save
       (tester saves to the repository)
```

**Only the detection logic changes per interaction type.** Everything else — validation, classification, plain English, execution JSON, timeline, review, approval, save — is identical for every interaction.

This pipeline contract is the architectural foundation. Every interaction type we design will conform to it. No exceptions.

---

## Premise

An experienced manual tester sits down to record a test case. They open the browser, navigate to the application, open CmdRunner, and click "Start Recording."

From that moment, the recorder is their assistant — silently watching, faithfully recording, never getting in the way.

When the tester clicks "Stop Recording," they expect a clean, sequential list of steps that tell the story of what they did — expressed as **what they intended**, not what the browser did internally.

This specification defines that experience.

---

## 1. What Happens Immediately After Start Recording

### Instant Activation

Recording begins **instantly**. The moment the user clicks "Start Recording," the recorder is active.

There is no initialization delay, no loading spinner, no "preparing recorder" state. The user clicked a button — they expect it to work.

### What "Active" Means

The recorder is now listening. Every interaction the user performs from this point forward is eligible for recording.

### What Is NOT Done

- **No page reload.** The recorder does not refresh the page. The user's current page state is preserved.
- **No navigation.** The recorder does not navigate the user to a "start URL." Wherever they are when they click Start is where recording begins.
- **No verification.** The recorder does not check whether the page is "ready" or "suitable." It trusts the user's judgment.
- **No warm-up period.** There is no delay between Start and the first capturable interaction.

### UI Feedback

The user must see clear, immediate feedback that recording is active:
- The button changes to "Stop Recording" (red/active state).
- A recording indicator (pulsing dot or timer) is visible.
- The timeline panel shows "Recording…" and is ready to display steps.

### Recording Context (NOT a Navigation Event)

The recorder captures the current page state as **Recording Context** — session metadata, not a recorded interaction.

```
Recording Context {
  startUrl:     "https://app.example.com/dashboard"
  startTitle:   "Dashboard — Example App"
  capturedAt:   "2026-07-13T04:34:12.000Z"
}
```

This is displayed in the timeline header as context:

```
┌──────────────────────────────────────────────┐
│  📍 Recording started on:                    │
│  Dashboard — Example App                     │
│  https://app.example.com/dashboard           │
├──────────────────────────────────────────────┤
│  (steps appear below as interactions occur)  │
│  (empty until the first real interaction)    │
└──────────────────────────────────────────────┘
```

**Why not a Navigation event?**

The user did not navigate. They were already on the dashboard. Recording "Navigate to Dashboard" would be a lie — it would describe an action that never happened.

The Recording Context tells the truth: "This is where recording started." It is metadata about the session, not an interaction the user performed.

The first **Navigation** interaction is recorded only when the user actually navigates — clicks a link, submits a form that redirects, or the SPA changes routes.

---

## 2. Session Metadata

### What Is Stored

Only essential information. Nothing speculative.

| Field | Purpose | Why Essential |
|-------|---------|---------------|
| **Session ID** | Unique identifier for the session | Needed to distinguish sessions, support save/resume |
| **Recording Context** | Starting URL, title, timestamp | Defines where recording began — for playback context |
| **Start Time** | ISO timestamp when recording began | Ordering, audit trail |
| **Tab ID** | Chrome tab where recording started | The recorder is scoped to a tab |
| **Status** | Current lifecycle state | Drives UI and recorder behavior |

### Recording Context Object

```
RecordingContext {
  startUrl:     "https://app.example.com/dashboard"
  startTitle:   "Dashboard — Example App"
  capturedAt:   "2026-07-13T04:34:12.000Z"
}
```

This is session metadata. It is NOT an event in the events array. It is NOT a step in the steps array. It sits on the session object itself.

### What Is NOT Stored

- **Browser window ID** — irrelevant; tabs move between windows.
- **Viewport size** — useful for debugging but not essential for the lifecycle.
- **User agent** — available from Chrome APIs on demand.
- **Cookie state** — too complex, too volatile, out of scope.
- **DOM snapshot** — too heavy; screenshots serve this purpose per-step.
- **Session name** — assigned by the user when saving to the repository, not at creation time.

### Session Object Shape (Conceptual)

```
Session {
  id:               "session-uuid"
  startedAt:        "2026-07-13T04:34:12.000Z"
  status:           "recording" | "stopped" | "review" | "approved" | "saved"
  tabId:            42
  recordingContext: {
    startUrl:       "https://app.example.com/dashboard"
    startTitle:     "Dashboard — Example App"
    capturedAt:     "2026-07-13T04:34:12.000Z"
  }
  events:           [ ... ]    // ordered list of recorded interactions
  steps:            [ ... ]    // ordered list of generated steps
}
```

---

## 3. When Does the Recorder Become Ready?

**Immediately.** There is no separate "ready" phase.

The user clicks Start → the recorder is ready → the next interaction is captured.

The distinction between "started" and "ready" does not exist in the user's mental model. A tester who clicks Start and then immediately clicks a button expects that button click to be recorded. Any delay would feel broken.

### Exception: Content Script Injection

If the content script is not yet injected into the page (e.g., the extension was just installed and the page was already open), the recorder should inject it as part of the Start action. This should be transparent to the user and should complete in under 100ms.

If injection fails (e.g., restricted page like chrome://, the Chrome Web Store, or a page with a strict CSP), the recorder should:
1. Capture the Recording Context.
2. Display a warning: "Recording is active, but some interactions on this page may not be captured."
3. Still attempt to capture what it can.

---

## 4. What Is the First Interaction?

### No Warm-Up Period

There is no warm-up period. The first real user interaction after Start Recording is the first recorded event.

### No Initialization Noise

The recorder must NOT capture:
- Its own UI interactions (clicking Start Recording, interacting with the side panel).
- Chrome browser chrome interactions (opening bookmarks, switching tabs).
- Page load events triggered by the Start action itself.
- The Recording Context itself (it's metadata, not an interaction).

### The Empty Timeline

When recording starts, the timeline is **empty** — it shows only the Recording Context header. No steps appear until the user performs a real interaction.

This is truthful. The user hasn't done anything yet. The timeline should reflect that.

When the first interaction occurs (e.g., the user clicks a button), that becomes step-0001.

---

## 5. What Happens During Recording

### Core Responsibilities

During recording, the recorder has four responsibilities:

#### Responsibility 1: Capture User Intent

The recorder must capture every meaningful user interaction in the order it occurs. The guiding principle is:

> **If a manual tester would write it as a step, the recorder should capture it.**
> **If a manual tester would skip it, the recorder should skip it.**

The recorder captures **what the user intended**, not raw browser events. A click that fires mousedown+mouseup+click+focus+blur is recorded as a single interaction: "Click the Login button." The browser event chain is an implementation detail.

This means:
- ✅ Click a button → captured as "Click the [name] button"
- ✅ Type text in a field → captured as "Enter [text] in the [name] field"
- ✅ Navigate to a new page → captured as "Navigate to [page]"
- ❌ Move mouse across the screen → not captured (no intent)
- ❌ Page's internal JavaScript runs → not captured (not a user action)
- ❌ Browser fires focus/blur events → not captured (implementation detail)

#### Responsibility 2: Sequential Ordering

Every captured interaction gets a sequential identifier. The order of interactions in the recording must match the order the user performed them. This is non-negotiable — a test case is a sequence.

#### Responsibility 3: Real-Time Feedback

The timeline panel must update in real time as interactions are captured. The tester should see each step appear as they perform it. This builds trust — the tester knows the recorder is working.

The timeline shows:
- The step in plain English (or a placeholder while AI is processing).
- The element's identity (tag, role, accessible name).
- A timestamp.
- A screenshot (once captured).

#### Responsibility 4: Non-Interference

The recorder must never:
- Modify the page's DOM.
- Block or intercept the user's actions.
- Slow down the page.
- Show modals or alerts during recording.
- Prevent navigation.

The recorder is a silent observer.

### Scope: One Tab

Recording is scoped to **one tab** — the tab where Start Recording was clicked. Interactions in other tabs are not captured.

If the user navigates the recording tab to a new page, recording continues on that new page (see Section 6).

If the user switches to a different tab and interacts with it, those interactions are NOT captured. The recorder stays focused on its tab.

---

## 6. What Happens When the Page Changes

### Full Page Navigation (URL Change)

When the recording tab navigates to a new URL (full page load):

1. **A navigation interaction is recorded.** The new URL and page title are captured. This is a real interaction — the user navigated.
2. **Recording continues.** No interruption — the tester is following a flow that spans pages.
3. **The content script re-injects** on the new page (content scripts don't persist across navigations). The recorder must handle this transparently.

The tester's experience: they click a link → the page changes → a new step appears in the timeline → they continue interacting. No interruption.

Note: The **Recording Context** at the top of the timeline does NOT change. It always shows where recording started. Navigation events appear as regular steps in the timeline.

### SPA Route Changes (URL Changes Without Full Load)

Single-page applications change routes without full page reloads (using History API pushState/replaceState or hash changes).

These ARE navigations from the tester's perspective:
> "I navigated from /dashboard to /orders"

The recorder should capture SPA route changes as navigation interactions.

### Page Refresh / Reload

A page refresh is a navigation. The URL might be the same, but the page state resets. The recorder should:
1. Record a navigation interaction (even if the URL is unchanged — the tester intentionally reloaded).
2. Re-inject the content script.
3. Continue recording.

### Redirect

Redirects (server-side or client-side) result in a final URL. The recorder captures the final URL, not the intermediate redirect chain. The tester doesn't care about redirects — they care about where they ended up.

### New Tab / Popup

If the user's action opens a new tab or popup window:
- The original tab continues recording.
- The new tab is NOT recorded (it's a different tab).
- This may result in an incomplete recording if the tester's flow continues in the new tab.

This is an acceptable limitation. Multi-tab recording is a future enhancement, not a lifecycle requirement.

---

## 7. What Happens When Stop Recording Is Clicked

### Immediate Stop

Recording stops **instantly**. The moment the user clicks "Stop Recording," no further interactions are captured.

Any interaction in-flight (e.g., a click that was mid-dedup-window) is either:
- Completed if it was already committed before Stop was clicked.
- Discarded if it was still pending.

### Transition to REVIEW State

After Stop, the session enters the **REVIEW** state. This is not the end — it's the beginning of the review workflow.

1. **The button changes back** to "Start Recording."
2. **The recording indicator** disappears.
3. **The timeline remains visible** with all captured steps.
4. **The session enters REVIEW** — the tester can now review, edit, approve, or discard.
5. **A test case is generated** from the recorded steps (if not already generated live).

### The Review Workflow

```
Stop Recording
      │
      ▼
  REVIEW        Tester reviews the timeline.
      │         Can edit step descriptions.
      │         Can delete incorrect steps.
      │         Can reorder steps (future).
      │
      ▼
  APPROVED      Tester is satisfied.
      │         Clicks "Approve" (or equivalent).
      │
      ▼
  SAVED         Tester saves to repository.
      │         Assigns a name.
      │         Test case is stored permanently.
      │
      ▼
  IDLE          Ready for next session.
```

### What Does NOT Happen

- **No automatic save.** The tester decides when/whether to save to the repository.
- **No automatic replay.** The tester reviews first.
- **No data loss.** Events and steps persist through REVIEW and APPROVED states. They survive until the tester explicitly clears or starts a new session.

### Pending AI Processing

If AI understanding requests are in-flight when Stop is clicked:
- The AI requests complete (they're async, non-blocking).
- The steps update in the timeline as the AI results arrive.
- The tester can begin reviewing immediately — steps finalize as AI completes.

---

## 8. What Should Persist

### Must Survive

The following must survive a browser refresh, extension reload, or service worker termination:

| Data | Storage | Reason |
|------|---------|--------|
| All recorded events | chrome.storage.local | The tester's work must not be lost |
| All generated steps | chrome.storage.local | The test case must not be lost |
| Session metadata (incl. Recording Context) | chrome.storage.local | Session identity, starting context |
| Recording state (lifecycle status) | chrome.storage.local | On SW restart, know what state to resume |

### Should Survive

| Data | Storage | Reason |
|------|---------|--------|
| Screenshots | chrome.storage.local | Visual context for each step |

### Does NOT Persist

| Data | Reason |
|------|--------|
| In-memory caches | Can be rebuilt from storage |
| Content script state | Ephemeral — content scripts are per-page |
| AI provider state | Managed separately by the AI config system |
| Temporary counters | Rebuilt from stored events on restore |

### Restore Behavior

When the service worker restarts (MV3 — Chrome kills it after ~30s idle):

1. Read session metadata from storage.
2. Restore all events and steps.
3. Restore all ID counters to continue sequentially without collisions.
4. Restore the lifecycle status:
   - If **RECORDING** → resume recording. The tester didn't ask to stop.
   - If **STOPPED** or **REVIEW** → restore to REVIEW state. The tester was reviewing.
   - If **APPROVED** → restore to APPROVED state.
   - If **IDLE** → idle, ready for next session.
5. Re-establish the content script connection.

The tester's experience: they don't notice the SW restarted. Whatever they were doing, it resumes seamlessly.

### What Happens on Start (New Session)

When the tester clicks Start Recording after a previous session:

1. **Previous session data is cleared.** Events, steps, and screenshots from the old session are deleted.
2. **New Recording Context is captured.** Current URL, page title, timestamp.
3. **New session metadata is created.** Fresh session ID, new start time.
4. **ID counters reset.** The new session starts fresh.

The tester's experience: clean slate. No leftover data from the previous recording.

---

## 9. Error Handling

### Content Script Disconnect

If the content script stops communicating (page crashed, CSP blocked it, etc.):

1. **Recording continues** — the session is still active.
2. **Navigation events still work** — those are captured via chrome.webNavigation API in the service worker, not the content script.
3. **Interaction events stop** — without the content script, no clicks/types/etc. can be captured.
4. **No error modal** — the recorder doesn't panic. When the user navigates to a new page, the content script re-injects and interactions resume.
5. **Warning in timeline** — a subtle indicator that interactions may be missed on the current page.

### Tab Closes

If the recording tab is closed:

1. **Recording stops automatically.**
2. **Session transitions to REVIEW state.**
3. **All captured events and steps are preserved** in storage.
4. **The tester can review** the recording in the side panel (which is still open).
5. **The tester can save** the recording to the repository.

### Browser Crashes

If the browser crashes:

1. **Everything in chrome.storage.local survives.** Events, steps, screenshots, session metadata.
2. **When the browser restarts** and the extension loads, the session is restored from storage.
3. **Session restored to the last persisted status** — if recording, it resumes as REVIEW (the tab is gone, recording can't continue, but data is preserved for review).

### Extension Reloads

If the extension is reloaded (developer mode, update, manual reload):

1. **Stored data survives** (chrome.storage.local persists across extension reloads).
2. **The service worker restarts** and restores from storage.
3. **Content scripts are re-injected** on the next page navigation or programmatically.
4. **Session restored to the last persisted status.**

---

## 10. Success Criteria

The recording session lifecycle is production-ready when:

### Functional

- [ ] Start Recording activates instantly with clear UI feedback.
- [ ] Recording Context (URL, title) is captured as session metadata — not as a navigation event.
- [ ] The timeline starts empty — no fake "Step 0" navigation.
- [ ] All interactions are captured in sequential order during recording.
- [ ] Navigation events (full load, SPA route, refresh) are captured correctly — only when the user actually navigates.
- [ ] Stop Recording deactivates instantly and transitions to REVIEW state.
- [ ] The tester can review, approve, and save the recording.
- [ ] The timeline updates in real time as interactions are captured.
- [ ] Recording is scoped to one tab — other tabs are not captured.

### Persistence

- [ ] Events, steps, Recording Context, and metadata survive service worker termination and restart.
- [ ] Events, steps, and metadata survive browser refresh.
- [ ] Events, steps, and metadata survive extension reload.
- [ ] Starting a new session clears the previous session's data.

### Error Handling

- [ ] Tab closure stops recording gracefully, transitions to REVIEW, preserves data.
- [ ] Content script disconnection does not crash the recorder.
- [ ] Browser crash preserves all stored data.
- [ ] The recorder never shows an unhandled error to the tester during recording.

### Performance

- [ ] Start Recording completes in under 100ms.
- [ ] Stop Recording completes in under 50ms.
- [ ] The recorder adds no perceptible latency to page interactions.
- [ ] Memory usage remains stable during long recording sessions (1+ hours).

### User Experience

- [ ] A tester can Start, perform actions, Stop, Review, Approve, and Save — without any documentation.
- [ ] The recording indicator is always visible and unambiguous.
- [ ] The tester never wonders "is this thing recording?"
- [ ] The tester never loses data due to recorder error.
- [ ] The Recording Context clearly shows where the test started without pretending the user navigated there.

---

## Lifecycle Summary

```
┌──────────────────────────────────────────────────────────────────┐
│                    RECORDING LIFECYCLE                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐                                                │
│  │  IDLE        │  Extension loaded, no recording active         │
│  └──────┬───────┘                                                │
│         │ User clicks "Start Recording"                          │
│         ▼                                                        │
│  ┌──────────────┐                                                │
│  │  STARTING    │  Instant: capture Recording Context, set state │
│  └──────┬───────┘  (< 100ms, transparent to user)                │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                                │
│  │  RECORDING   │  Listening for user intent                      │
│  │              │  Capturing interactions in real time            │
│  │              │  Updating timeline live                         │
│  │              │  Handling navigations transparently             │
│  │              │  Persisting to storage continuously             │
│  └──────┬───────┘                                                │
│         │ User clicks "Stop Recording"                            │
│         │ OR recording tab closes                                 │
│         ▼                                                        │
│  ┌──────────────┐                                                │
│  │  STOPPED     │  Recording frozen                              │
│  │              │  AI processing completes in background          │
│  │              │  (transitional — immediately enters REVIEW)    │
│  └──────┬───────┘                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────┐                                                │
│  │  REVIEW      │  Tester reviews the generated test case        │
│  │              │  Can edit descriptions, delete steps           │
│  │              │  All data preserved                            │
│  └──────┬───────┘                                                │
│         │ Tester clicks "Approve"                                │
│         ▼                                                        │
│  ┌──────────────┐                                                │
│  │  APPROVED    │  Tester is satisfied with the test case        │
│  │              │  Ready to save                                 │
│  └──────┬───────┘                                                │
│         │ Tester saves to repository                             │
│         ▼                                                        │
│  ┌──────────────┐                                                │
│  │  SAVED       │  Test case stored permanently                  │
│  │              │  Session data can now be cleared               │
│  └──────┬───────┘                                                │
│         │ Session complete                                       │
│         ▼                                                        │
│  ┌──────────────┐                                                │
│  │  IDLE        │  Ready for next session                        │
│  └──────────────┘                                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Foundational principle** | Capture user intent, not browser events | Browser events are implementation details; the product is intent |
| Start delay | Instant | Testers expect immediate response |
| Starting page | **Recording Context** (metadata, not an event) | The user didn't navigate — recording it as navigation would be a lie |
| First timeline entry | Empty until first real interaction | Truthful — the user hasn't done anything yet |
| Warm-up period | None | First interaction after Start is recorded |
| Multi-tab recording | No, single tab only | Simplicity; multi-tab is a future enhancement |
| Auto-save on Stop | No | Tester reviews, approves, then saves deliberately |
| **Post-Stop workflow** | **Stop → Review → Approve → Save** | Stopping ≠ finished; review is part of the lifecycle |
| Data on new session | Previous cleared | Clean slate; no leftover data |
| SPA route changes | Captured as navigation interaction | Tester's mental model: "I went to /orders" |
| SW termination | Transparent resume | Tester never notices |
| Error handling | Graceful, never crashes | Recorder is a silent observer |
| Content script scope | Recording tab only | Focus on the tester's flow |
