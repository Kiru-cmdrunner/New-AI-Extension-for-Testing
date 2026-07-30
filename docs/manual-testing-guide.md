# CmdRunner Extension — Manual Validation Guide

**Phase Coverage:** Phases 0–5 (Capture → Recognition → Lifecycle → Enrichment)
**Version:** 0.1.0 (dev build, pre-Phase 6 output)

---

## 1. Build & Load

### Prerequisites

- Chrome/Chromium 116+ (Manifest V3 + Side Panel API support)
- The `dist/` build output (already generated)

### Build (if rebuilding from source)

```bash
cd /workspace
npm install
npm run build        # → dist/
```

The `dist/` directory is a self-contained, loadable extension.

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Pin the extension to the toolbar for easy access
6. Open the side panel: click the CmdRunner icon, or use `chrome://sidepanel`

**Verification:** You should see the side panel titled **"CmdRunner v0.1.0"** with:
- ▶ Start / ■ Stop buttons (Stop is disabled)
- Status: **Idle**
- Events captured: **0**
- Empty log area: "No events yet."

### Required Configuration

**None.** The extension requires no debugger permission and no infobar. It works immediately after install using standard `activeTab` + `sidePanel` + `storage` + `webNavigation` permissions (all declared in the manifest).

The `debugger` permission is declared as **optional** (not requested in Phases 0–5). Tier 2 High-Precision Mode (future) may request it.

---

## 2. Pipeline Overview (What You're Testing)

```
User interacts with page
    │
    ▼
CONTENT SCRIPT
  EventTap (13 capture-phase listeners)
    → Target Resolution (composedPath → ElementIdentity)
    → 5 Evidence Channels (A: A11y, B: DOM, C: Behavioural,
       D: Mutations, E: Focus/Overlay)
    → EvidenceBatch
    → Delivery Coordinator → Service Worker
    │
    ▼
SERVICE WORKER (STOP pipeline — runs when user clicks Stop)
  SessionManager → PipelineOrchestrator
    → Stage 1: Classification (Pattern Registry → RecognisedInteraction)
    → Stage 2: Lifecycle (Generic state machine → SemanticAction)
    → Stage 3: Enrichment (Capability + Coverage + Workflow + Surface)
    → Stage 4: Output (stub — placeholder artifact)
    │
    ▼
RecordingArtifact (placeholder until Phase 6)
```

### What You Can Observe

| Source | What to look at | What it shows |
|--------|-----------------|---------------|
| Side panel status | Status indicator | Idle → Recording → Completed |
| Side panel event counter | "Events captured" | Increments per captured DOM event |
| Side panel log view | Log area | Pipeline log entries (stage, level, message) |
| Chrome DevTools console | F12 → Console (in page context) | `[CmdRunner]` log entries from content script |

### What You Cannot Observe Yet

- **RecordingArtifact content** — Phase 4 output stage is a stub. The final artifact has empty `plainEnglishSteps`, empty `irPlan.steps`. The enrichment data (capabilities, coverage, workflows) is computed but not rendered in the side panel.
- **Playwright/IR output** — Phase 6.
- **Replay annotations** — Phase 6.

---

## 3. Manual Test Scenarios

Each scenario specifies: **actions to perform**, **what to observe**, and **expected pipeline behaviour at each stage**.

### Scenario 1: Start/Stop Cycle (Smoke Test)

**Validates:** Phase 0–2 plumbing (content script injection, message routing, session management, pipeline execution).

**Steps:**
1. Open any simple web page (e.g. `https://example.com`)
2. Open the side panel
3. Click **▶ Start**
4. Click anywhere on the page
5. Wait 2 seconds
6. Click **■ Stop**

**Expected observations:**
- **Status:** Idle → Recording (green) → Completed (blue)
- **Event counter:** Increments to ≥1 after clicking the page
- **Log entries:** `content-script: Recording started`, `content-script: Recording stopped`, `service-worker: Stage 1 stub` → (now real) pipeline stages executing
- **Stop response:** Shows total events and interaction count

**Pipeline behaviour:**
- Content script injects on page load (injection guard prevents double-inject)
- EventTap attaches 13 capture-phase listeners on START
- Events are captured, evidence collected across 5 channels, batches delivered to SW
- SessionManager transitions: IDLE → STARTING → RECORDING → STOPPING → COMPLETED
- On STOP, PipelineOrchestrator runs all 4 stages

---

### Scenario 2: Checkbox Toggle (Recognised: Checkbox Pattern)

**Validates:** Phase 3 recognition (checkbox pattern) + Phase 4 lifecycle (activate→commit, verb=Toggle).

**Steps:**
1. Open a page with a checkbox (e.g. `https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/examples/checkbox/` — the W3C APG checkbox example)
2. Click **▶ Start**
3. Click the checkbox to check it
4. Click the checkbox again to uncheck it
5. Click **■ Stop**

**Expected observations:**
- Event counter: ≥4 (2 clicks + focus/blur events)
- Log entries showing recognition and lifecycle stages executing

**Pipeline behaviour:**
- **Capture:** `click`, `focus`, `blur` events. Channel A extracts `role=checkbox` (or implicit role from `<input type="checkbox">`). Channel B extracts DOM structure. Channel E captures focus/blur.
- **Recognition (Stage 1):** Checkbox pattern matches via:
  - Channel A: `role` equals `checkbox` → match quality 1.0, weight 1.0
  - Channel B: tag is `input[type=checkbox]` or has `aria-checked` → supports match
  - Confidence ≥ 0.65 → RecognisedInteraction, ComponentType = `checkbox`
- **Lifecycle (Stage 2):** Config: `activateEvent=click, commitEvent=click`. Single click = immediate activate→commit. Two separate checkbox interactions produce two SemanticActions, both verb = **Toggle**.
- **Enrichment (Stage 3):** Capability model for checkbox has dimensions: checked-state-observable, keyboard-operable, label-present. Coverage assessment checks if observed interactions cover those dimensions.
- **Output (Stage 4):** Stub — artifact created but plainEnglishSteps and irPlan.steps are empty.

---

### Scenario 3: Combobox / Select Interaction (Recognised: Combobox Pattern)

**Validates:** Phase 3 recognition (combobox pattern) + Phase 4 lifecycle (activate→intermediate→commit, verb=Select).

**Steps:**
1. Open a page with a combobox (e.g. `https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/` — the W3C APG combobox example)
2. Click **▶ Start**
3. Click the combobox button to open it
4. Click an option to select it
5. Click **■ Stop**

**Expected observations:**
- Event counter: ≥4 (click on button, focus/blur, click on option)
- Pipeline stages execute without errors

**Pipeline behaviour:**
- **Capture:** Two click sequences + focus changes. Channel A extracts `role=combobox` on the button, `role=option` on the selected item.
- **Recognition (Stage 1):** Combobox pattern matches. Two clicks → two RecognisedInteractions: one on the combobox button (ComponentType = `combobox`), one on the option (ComponentType may be `combobox` again if the option is within the combobox subtree, or `unrecognised` if pattern doesn't match the option element).
- **Lifecycle (Stage 2):** Config: `activateEvent=click, intermediateEvents=[], commitEvent=click`. First click activates the combobox lifecycle. Second click (on option) triggers segmentation Rule A (new activate event) → commits the first action and starts a second. Both produce SemanticActions. If grouped correctly (option click is within the same combobox interaction), it produces a single action with verb = **Select**.
- **Enrichment (Stage 3):** Combobox capability model covers: opens-list, selects-option, keyboard-navigable, dismissible. Coverage assessment evaluates whether the observed flow exercised these.
- **Output (Stage 4):** Stub.

---

### Scenario 4: Tab Navigation (Recognised: Tabs Pattern)

**Validates:** Phase 3 recognition (tabs pattern) + Phase 4 lifecycle (activate→commit, verb=Switch).

**Steps:**
1. Open a page with tabs (e.g. `https://www.w3.org/WAI/ARIA/apg/patterns/tabs/examples/tabs-automatic/` — the W3C APG tabs example)
2. Click **▶ Start**
3. Click a different tab
4. Click another tab
5. Click **■ Stop**

**Expected observations:**
- Event counter: ≥6
- Pipeline processes multiple tab interactions

**Pipeline behaviour:**
- **Capture:** Click events on `role=tab` elements.
- **Recognition (Stage 1):** Tabs pattern matches via Channel A (`role=tab`, parent `role=tablist`) + Channel B (DOM structure within tablist). Confidence ≥ 0.65.
- **Lifecycle (Stage 2):** Config: `activateEvent=click, commitEvent=click`. Each tab click is a discrete activate→commit. Multiple tab clicks produce multiple SemanticActions, all verb = **Switch**.
- **Enrichment (Stage 3):** Tabs capability model covers: activates-tab, shows-panel, keyboard-arrow-nav. Multiple tab switches may register as a branch point (multiple alternatives exercised).
- **Output (Stage 4):** Stub.

---

### Scenario 5: Modal Dialog Open/Close (Recognised: Modal Pattern)

**Validates:** Phase 3 recognition (modal pattern) + Phase 4 lifecycle with cancel path.

**Steps:**
1. Open a page with a modal dialog (e.g. `https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/` — the W3C APG modal dialog example)
2. Click **▶ Start**
3. Click the button that opens the modal
4. Press Escape to close the modal (or click a close button)
5. Click **■ Stop**

**Expected observations:**
- Event counter increments
- Pipeline processes modal open/close

**Pipeline behaviour:**
- **Capture:** Click to open (Channel D captures DOM mutation showing overlay appearance). Escape key or close button (Channel E captures focus return to trigger).
- **Recognition (Stage 1):** Modal pattern matches. Channel D (runtime mutation — overlay appears) contributes weight 0.5. Channel E (focus trapped in dialog) contributes weight 0.7.
- **Lifecycle (Stage 2):** Config: `activateEvent=click, commitEvent=click, cancelEvent=blur`. The modal open is a recognised interaction. The close (Escape/blur) may trigger cancel path → no SemanticAction produced for the cancel itself.
- **Enrichment (Stage 3):** Modal capability model covers: opens-on-trigger, traps-focus, dismissible, restores-focus. The open/close cycle exercises opens-on-trigger and dismissible.
- **Output (Stage 4):** Stub.

---

### Scenario 6: Menu Interaction (Recognised: Menu Pattern)

**Validates:** Phase 3 recognition (menu pattern) + Phase 4 lifecycle with intermediates.

**Steps:**
1. Open a page with a menu (e.g. `https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/examples/menu-button-actions-active/` — the W3C APG menu button example)
2. Click **▶ Start**
3. Click the menu button to open it
4. Hover over menu items
5. Click a menu item
6. Click **■ Stop**

**Expected observations:**
- Event counter: ≥6 (click, mouseover, mouseout, focus)
- Pipeline processes menu with intermediate events

**Pipeline behaviour:**
- **Capture:** Click to open (activate). `mouseover`/`mouseout` on items (intermediates). Click on item (commit). Channel C (behavioural) captures the hover-then-click sequence.
- **Recognition (Stage 1):** Menu pattern matches via Channel A (`role=menuitem`, `role=menu`, `aria-haspopup`) + Channel B (DOM structure).
- **Lifecycle (Stage 2):** Config: `activateEvent=click, intermediateEvents=[mouseover], commitEvent=click`. The full sequence: click button → ACTIVATE, mouseover item → INTERMEDIATE, click item → COMMIT. Produces one SemanticAction, verb = **Click** or **Select** depending on lifecycle path.
- **Enrichment (Stage 3):** Menu capability model covers: opens-on-trigger, navigates-items-via-hover, selects-item, keyboard-arrow-nav. The hover-then-select flow exercises navigates-items-via-hover and selects-item.
- **Output (Stage 4):** Stub.

---

### Scenario 7: Unrecognised Interaction (No Pattern Match)

**Validates:** Phase 3 confidence gate (below threshold) + Phase 4 transparent passthrough.

**Steps:**
1. Open any web page
2. Click **▶ Start**
3. Click on a plain `<div>` or `<span>` with no ARIA role, no special structure — just a generic container
4. Click a paragraph of text
5. Click **■ Stop**

**Expected observations:**
- Event counter increments
- Pipeline executes without errors — unrecognised interactions do NOT crash the pipeline
- No error logs from the pipeline stages

**Pipeline behaviour:**
- **Capture:** Click events captured normally. Evidence collected across all 5 channels.
- **Recognition (Stage 1):** No pattern matches. All 5 seed patterns (combobox, menu, tabs, checkbox, modal) are checked. For a generic `<div>`, Channel A reports no role, Channel B reports generic structure. Confidence for all patterns < 0.65 → **UnrecognisedInteraction** produced (reason: below-threshold or no-pattern-match).
- **Lifecycle (Stage 2):** UnrecognisedInteractions pass through transparently — no state machine effect, no flush, no segmentation trigger. They appear in the lifecycle stage's output as-is.
- **Enrichment (Stage 3):** UnrecognisedInteractions are partitioned at the boundary into a side-channel. They are NOT enriched. They are carried in `EnrichedRecording.unrecognisedInteractions[]`.
- **Output (Stage 4):** Stub — but `metadata.unrecognisedCount` in the artifact reflects the count.

---

### Scenario 8: Mixed Recognised + Unrecognised (Realistic Recording)

**Validates:** End-to-end pipeline with a realistic mix of interactions on a real application.

**Steps:**
1. Open a complex page (e.g. `https://www.w3.org/WAI/ARIA/apg/` — the APG index, which has many patterns)
2. Click **▶ Start**
3. Interact naturally: click links, toggle a checkbox if present, open/close a menu, click on text areas
4. Perform 8–10 different interactions of varying types
5. Click **■ Stop**

**Expected observations:**
- Event counter: 30+ events (each interaction generates multiple DOM events)
- Pipeline processes the full mixed stream
- No crashes or unhandled errors
- The log shows all 4 stages executing

**Pipeline behaviour:**
- **Capture:** Full event stream captured across all 5 channels. Delivery Coordinator batches and delivers to SW.
- **Recognition (Stage 1):** Each EvidenceBatch is evaluated against all 5 patterns. Some match (RecognisedInteraction), some don't (UnrecognisedInteraction). The output is a mixed stream.
- **Lifecycle (Stage 2):** Recognised interactions are grouped by lifecycle state machine. Unrecognised pass through. Segmentation rules (A: restart, B: unexpected event, C: temporal gap disabled by default) determine action boundaries.
- **Enrichment (Stage 3):** Recognised SemanticActions are enriched with behavioural contracts, capability coverage, workflow derivation, and surface derivation. Unrecognised are side-channelled.
- **Output (Stage 4):** Stub artifact with metadata reflecting counts. Full output in Phase 6.

---

### Scenario 9: Navigation Between Pages

**Validates:** Phase 2 NavigationCapture (webNavigation API → EvidenceBatch).

**Steps:**
1. Open page A (e.g. `https://example.com`)
2. Click **▶ Start**
3. Click a link to navigate to page B (e.g. `https://example.com/domains` or any link on the page)
4. Interact with page B briefly
5. Click **■ Stop**

**Expected observations:**
- Event counter continues incrementing across navigation
- Content script re-injects on the new page (injection guard works per-page)
- Status stays "Recording" across the navigation
- Pipeline processes events from both pages

**Pipeline behaviour:**
- **Capture:** Content script injects at `document_start` on new page. New EventTap instance starts. Events from page A and page B are captured separately.
- **Navigation (SW):** `webNavigation.onCompleted` fires → NavigationCapture creates an EvidenceBatch with navigation metadata → ingested into SessionManager buffer.
- **Recognition/Lifecycle/Enrichment:** Navigation batches may not match any pattern (they're not component interactions). They flow through as UnrecognisedInteraction or are filtered by the classification stage.
- **Surface Derivation (Enrichment):** Actions from different URLs are grouped into separate `ApplicationSurface` entries — one per URL.

---

### Scenario 10: MV3 Crash Recovery

**Validates:** Phase 2 SessionManager recovery logic.

**Steps:**
1. Start a recording on any page
2. Without stopping, go to `chrome://extensions` and manually reload the extension (refresh icon)
3. Open the side panel again
4. Check the status

**Expected observations:**
- Side panel shows "Recording" state restored from chrome.storage.local
- A `recover()` is attempted on the SessionManager
- The recording session is recovered (events in buffer are preserved in storage)

**Pipeline behaviour:**
- On SW re-init, `chrome.storage.local.get(RECORDING_STATE)` finds stored state `RECORDING`.
- `SessionManager.recover(state)` attempts to restore the session context.
- Buffer contents persisted via `PERSIST_DEBOUNCE_MS` debounce may be partially available.
- This is a best-effort recovery — the design spec notes that some events between last persist and crash may be lost.

---

## 4. Known Limitations (Intentional — Future Phases)

| Limitation | Phase |
|------------|-------|
| **No output rendering** — the side panel shows event counts and logs but not the recording artifact (no semantic actions, no Playwright code, no IR plan) | Phase 6 |
| **No IR/Playwright generation** — Output stage is a stub returning a placeholder artifact | Phase 6 |
| **No replay annotations** — evidence traces are collected but not rendered as annotations | Phase 6 |
| **No Behavioural Probe** — a stub (`BehaviouralProbeStub`) is wired but performs no real probing. All interactions below 0.65 confidence that could benefit from a probe are simply unrecognised. | Phase 8 |
| **5 seed patterns only** — combobox, menu, tabs, checkbox, modal. Many component types (buttons, links, radio groups, sliders, accordions, etc.) will be unrecognised. Adding them is a data task (new PatternDefinition + LifecycleConfig + CapabilityModel), not a code change. | Phase 8 |
| **No Tier 2 High-Precision Mode** — the `debugger` permission is declared as optional but never requested. Tier 2 precision improvements are deferred. | Phase 8 |
| **No settings/options page** — manifest declares `options_page` but no functional settings UI exists yet. | Phase 7 |
| **No diagnostic export** — the PipelineLogger ring buffer captures entries but there's no export-to-file mechanism yet. | Phase 6/7 |
| **Performance thresholds are assumptions** — CONFIDENCE_THRESHOLD=0.65, AMBIGUITY_EPSILON=0.10, channel weights (A=1.0, B=0.8, C=0.6, D=0.5, E=0.7) are calibration assumptions that will be tuned against real-world data. | Phase 9 |
| **Navigation across SPA route changes** — client-side routing (React Router, Vue Router, etc.) may not trigger `webNavigation.onCompleted`. Only full page navigations are captured. SPA route detection is a Phase 8 enhancement. | Phase 8 |
| **No recording persistence** — artifacts are held in memory; there's no save/load mechanism yet. | Phase 6+ |
| **Shadow DOM** — capture handles open Shadow DOM via `composedPath()`. Closed Shadow DOM is not penetrable (browser limitation). | Limitation |
| **Cross-origin iframes** — content script injects in all frames (`all_frames: true`), but cross-origin frames have isolated JS contexts. Events are captured per-frame. | Limitation |

---

## 5. Debugging Tips

### View content script logs

Open DevTools on the page you're recording. Look for `[CmdRunner][content-script]` entries in Console. These show:
- Injection confirmation
- Recording start/stop
- Evidence batch delivery stats

### View service worker logs

Go to `chrome://extensions` → CmdRunner → **Service worker** (link under the extension card). This opens a DevTools window for the service worker context. Look for `[CmdRunner][service-worker]` entries.

### View pipeline logs

The side panel log view shows pipeline log entries in real time. Each entry has a timestamp, level (info/warn/error), stage name, and message.

### Verify content script injection

If events aren't being captured:
1. Open DevTools Console on the target page
2. Check for `Content script injected` log entry
3. Check `window.__CMDRUNNER_CS_ACTIVE__` — should be `true`
4. If not injected, reload the page

### Check evidence buffer

```javascript
// In service worker DevTools console:
chrome.storage.local.get(null, (result) => console.log(result));
```

This shows all stored state including recording state, event count, and any persisted evidence.

---

## 6. Summary: What This Validation Proves

| Phase | What's validated | How to verify |
|-------|-----------------|---------------|
| 0 | Extension loads, side panel works, message routing functional | Scenario 1 |
| 1 | Event capture, 5-channel evidence collection, delivery to SW | Scenarios 1–8 |
| 2 | Session management, pipeline orchestration, health monitor, nav capture | Scenarios 1, 9, 10 |
| 3 | Pattern recognition (5 patterns), confidence evaluation, UnrecognisedInteraction | Scenarios 2–8 |
| 4 | Lifecycle state machine, SemanticAction grouping, transparent passthrough | Scenarios 2–8 |
| 5 | Capability registry, enrichment pipeline (coverage, workflow, surface) | Scenarios 2–6, 8 |

The pipeline is fully functional from capture through enrichment. **Output generation (IR, Playwright, plain English) is Phase 6.** The validation goal is to confirm the engine processes interactions correctly — not to inspect final artifacts.
