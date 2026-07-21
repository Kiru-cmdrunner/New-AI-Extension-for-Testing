# Milestone B1 — Post-Recording Artifact Generation Product Design

**Status:** FROZEN
**Date:** 2026-07-14
**Type:** Product Design (no implementation, no architecture, no code)
**Depends on:** Product Foundation Design v1.0 (frozen), Product Architecture Design v1.0 (frozen)
**Predecessor:** Milestone A — Test Case Creation Flow (v4.0.0, frozen)

---

## 0. Purpose of This Document

The Test Case Creation Flow has been completed and frozen. CmdRunner can now:
- Create a Test Case with metadata (name, project, feature, scenario, expected result)
- Start recording within that Test Case context
- Capture interactions in real time
- Stop recording

**This milestone defines what happens next** — the complete product workflow for transforming a finished recording into reviewable, reusable test artifacts.

No code. No architecture. No implementation details. Only the product workflow as experienced by a QA engineer.

---

## Stage 1 — Recording Completion

### 1.1 What Happens Immediately After Stop Recording?

The moment the user clicks **Stop Recording**, three things happen in sequence:

1. **Recording stops.** No further interactions are captured. The content script stops listening. The recording badge clears.

2. **Recording Session ends.** The transient session produces its output — Recording Context and Interaction Timeline — and attaches them to the Test Case. The session is then discarded. The data lives on the Test Case, not on the session.

3. **Artifact generation begins.** The Test Case transitions from `RECORDED` to `GENERATING`, and the system begins producing the three artifacts from the Interaction Timeline.

### 1.2 When Does the Recording Session End?

The Recording Session ends **the instant Stop Recording is pressed**. There is no grace period, no "are you sure?" confirmation that delays the stop. The timeline is frozen at that moment.

**Rationale:** A confirmation dialog would interrupt the tester's mental flow. The tester has already decided to stop — that's why they clicked the button. If they made a mistake, the entire recording can be discarded from the review screen.

### 1.3 What Information Becomes Available?

After Stop, the following information exists and is permanently attached to the Test Case:

| Information | Source | Permanent? |
|-------------|--------|------------|
| Test Case Metadata (name, project, feature, scenario, expected result) | User entered before recording | ✅ Yes |
| Recording Context (startUrl, startTitle, capturedAt) | Captured at Start Recording | ✅ Yes (immutable) |
| Interaction Timeline (ordered list of all captured interactions) | Content scripts during recording | ✅ Yes (deletions allowed during review) |
| Per-interaction element identity (tag, role, accessibleName, locators) | Extracted from DOM at capture time | ✅ Yes (immutable) |
| Per-interaction AI enrichment (businessName, controlType, userIntent, confidence) | AI provider during capture | ✅ Yes (immutable) |
| Screenshots | Captured per interaction | ✅ Yes (immutable) |

### 1.4 What Information Remains Temporary?

| Information | Lifespan | What Happens to It |
|-------------|----------|-------------------|
| Recording Session object | Start → Stop | Discarded after output attached to Test Case |
| Active tab reference | Start → Stop | Released |
| Live event buffer | Start → Stop | Consumed into Timeline, buffer cleared |
| Side panel recording state | Start → Stop | Replaced with review state |
| Content script listeners | Start → Stop | Detached |

### 1.5 The Transition Point

Stop Recording is the **single transition point** between two fundamentally different modes:

```
RECORDING MODE                      GENERATION MODE
─────────────                       ───────────────
User is interacting.                System is working.
Raw events are flowing.             Raw events are being interpreted.
Timeline is growing live.           Timeline is frozen and processed.
No artifacts exist yet.             Artifacts are being created.
The tester's focus is on            The tester's focus shifts to
the application under test.         reviewing what was captured.
```

Nothing crosses this boundary except the Timeline and Context data that gets attached to the Test Case. Everything else is reset.

---

## Stage 2 — Artifact Generation

### 2.1 The Three Artifacts

After Stop, CmdRunner generates exactly three artifacts:

| # | Artifact | Purpose | Form |
|---|----------|---------|------|
| 1 | **Canonical Test Steps** | Human-readable, framework-agnostic test instructions | Ordered array of structured step objects |
| 2 | **CmdRunner Execution JSON** | Machine-readable, framework-agnostic execution model | Structured JSON per step |
| 3 | **Generated Playwright Test** | Runnable TypeScript Playwright test | Single `test()` string |

### 2.2 Generation Order and Dependencies

Generation follows a strict dependency chain:

```
Interaction Timeline (frozen)
        │
        │ ① Generate
        ▼
Canonical Test Steps
        │
        │ ② Derive (from Steps)
        ▼
CmdRunner Execution JSON
        │
        │ ③ Derive (from Steps)
        ▼
Generated Playwright Test
```

**Order is mandatory:**

1. **Canonical Test Steps first.** They are the interpreted layer. Every interaction in the timeline is transformed into a structured step with plain English, action type, element identity, and AI enrichment. Steps cannot be generated without the complete timeline.

2. **Execution JSON second.** It is derived directly from the Canonical Test Steps — not from raw interactions. Each step's execution JSON contains action, target, value, locator strategy, and wait strategy. It cannot exist without steps.

3. **Playwright Test last.** It is derived from the Canonical Test Steps (via Execution JSON). The test code is generated by mapping each step's execution data to Playwright API calls. It cannot exist without steps.

**Nothing depends on Playwright.** Playwright is the end of the chain, a leaf node.

### 2.3 Which Artifact Is Primary?

**Canonical Test Steps + Execution JSON together form the primary representation.**

This pair is the single source of truth. Playwright is a derived export — one consumer of the canonical representation. Future exports (Cypress, Selenium, Cucumber) will be additional consumers of the same canonical steps.

### 2.4 Why Not Generate Everything Simultaneously?

Because the dependency chain is real. Each artifact needs the preceding one to exist:

- Steps need the complete Timeline (can't generate a step for an interaction that hasn't been captured yet).
- Execution JSON needs Steps (it's a projection of step data into machine format).
- Playwright needs Steps + Execution JSON (it maps execution data to specific API calls).

Generating them out of order would require placeholder objects or partial data, which violates the principle that artifacts are only created when their input is complete.

---

## Stage 3 — Canonical Test Steps

### 3.1 What Are Canonical Test Steps?

Canonical Test Steps are the **interpreted, structured representation** of the recording. They transform raw captured interactions into human-readable, executable test instructions.

Each step answers the question: **"What did the user do here, and what should the test do?"**

### 3.2 Why Do They Exist?

1. **To separate raw capture from interpretation.** The Interaction Timeline is a factual record of what happened. Canonical Test Steps interpret those facts into meaningful test instructions. This separation allows the user to review and refine the interpretation without altering the raw record.

2. **To be framework-agnostic.** Canonical Test Steps know nothing about Playwright, Cypress, or Selenium. They describe *what* to do, not *how* a specific framework should do it. This ensures the steps remain valid regardless of which execution framework is used.

3. **To be the single editable surface.** During review, the user edits plain English descriptions and deletes false positives on the steps — not on raw events or on generated code. This concentrates all human review into one place.

### 3.3 What Information Does Each Step Contain?

```
Canonical Test Step:
  ├── stepNumber: 1
  ├── actionType: "click" | "navigation" | ...
  ├── plainEnglish: "Click 'Submit' button"
  ├── elementIdentity:
  │     ├── tag: "button"
  │     ├── role: "button"
  │     ├── accessibleName: "Submit"
  │     └── locators: [testId, dataCy, dataQa, id, ariaLabel, name, css, xpath]
  ├── executionJson: { action, target, value, locator, waitStrategy }
  ├── aiEnrichment: { businessName, controlType, userIntent, confidenceScore }
  ├── linkedInteractionId: "click-0001"
  └── timestamp: "2026-07-14T05:04:52Z"
```

### 3.4 What Should They Never Contain?

| Must NOT Contain | Why |
|------------------|-----|
| Playwright syntax (`page.click(...)`, `expect(...)`) | Framework-specific. Steps are framework-agnostic. |
| Cypress syntax (`cy.get(...)`, `cy.click()`) | Same. |
| Raw browser event data (`event.clientX`, `event.timeStamp`) | Too low-level. Steps are interpreted, not raw. |
| Other steps' data | Each step is self-contained. Cross-step references go through step ordering, not direct links. |
| User authentication tokens or session IDs | Security. Steps should be executable in any authenticated context. |
| Hardcoded URLs from the recording environment | Steps use Recording Context for the starting URL. Subsequent navigations are relative to the test flow, not absolute environment addresses. |

### 3.5 Why Are They Framework Independent?

Because they describe **intent and action**, not framework API calls:

- A step says: "Click 'Submit' button" (plain English) + `{ action: "click", target: "Submit", locator: "[data-testid='submit']" }` (execution JSON).
- Playwright translates this to: `await page.click('[data-testid="submit"]')`.
- Cypress would translate this to: `cy.get('[data-testid="submit"]').click()`.
- Cucumber would translate this to: `When I click the "Submit" button`.

The step itself never changes. Only the translation differs. This is why future export formats can be added without touching the steps.

### 3.6 Why Are They the Primary Human-Readable Representation?

Because they are the **only representation that combines**:

- **Human language** (plain English description)
- **Structural clarity** (step number, action type, ordered sequence)
- **Technical detail** (element identity, locators)
- **AI context** (business name, control type, user intent)
- **Traceability** (linked interaction ID)

The Interaction Timeline is factual but not interpreted. The Execution JSON is machine-readable but not human-friendly. The Playwright Test is executable but framework-specific. Canonical Test Steps sit in the middle — the one representation that humans review, edit, and approve.

---

## Stage 4 — CmdRunner Execution JSON

### 4.1 Why Does CmdRunner Generate Execution JSON?

Execution JSON exists to **bridge human-readable steps and machine-executable code**. It provides:

1. **Structured execution data** that code generators can consume without parsing natural language.
2. **Locator strategy** — which selector to use, in priority order, for finding the target element during playback.
3. **Action semantics** — what kind of action (click, type, select, navigate) and any associated value (text to type, option to select).
4. **Wait strategy** — what condition must be true before proceeding to the next step (element visible, URL changed, network idle).

Without Execution JSON, every code generator (Playwright today, Cypress tomorrow) would need to independently parse the same step data and make the same decisions about locators and waits. Execution JSON centralizes those decisions.

### 4.2 How Is It Related to Canonical Test Steps?

Execution JSON is **embedded within** each Canonical Test Step. It is not a separate object with its own lifecycle — it is a property of the step:

```
Canonical Test Step
  ├── stepNumber: 1
  ├── plainEnglish: "Click 'Submit' button"
  ├── executionJson:    ← this is part of the step
  │     {
  │       action: "click",
  │       target: "Submit",
  │       locator:
  │         {
  │           strategy: "testId",
  │           value: "submit"
  │         },
  │       waitStrategy: "elementAttached"
  │     }
  └── ...
```

The relationship is 1:1 — each step has exactly one execution JSON. The execution JSON is never independent of its step.

### 4.3 What Responsibility Does It Own?

Execution JSON owns **"how to execute this step mechanically"**:

| Responsibility | Detail |
|----------------|--------|
| Action type | click, type, select, navigate, assert |
| Target element | What element to act on (by accessible name) |
| Locator | Which selector strategy to use + the selector value |
| Value | Input data for text entry, option for selects |
| Wait strategy | What to wait for before the next step |

It does NOT own:
- Plain English text (that's the step's human layer)
- Playwright syntax (that's the Playwright generator's job)
- Element identity details beyond what's needed for execution (tag, role are for the step; locator is for execution JSON)

### 4.4 Why Should It Remain Framework Agnostic?

The same reasoning as Canonical Test Steps: framework-specific execution data would lock the Test Case to one framework. If Execution JSON contained `page.click(...)`, it would be Playwright execution JSON, not CmdRunner execution JSON.

By keeping the execution model abstract (`action: "click"` instead of `page.click(...)`), every future code generator reads the same data and applies its own syntax. Adding Cypress support means writing a Cypress translator — not re-recording the test.

---

## Stage 5 — Generated Playwright Test

### 5.1 Why Does CmdRunner Generate a Playwright Test?

Playwright is the **primary execution format for v1.0**. Most QA teams adopting CmdRunner will want runnable Playwright tests immediately, without manually translating steps into code.

The Generated Playwright Test is the artifact that makes CmdRunner immediately useful: record a workflow, get a runnable test.

### 5.2 When Should It Be Generated?

The Playwright Test is generated **after** Canonical Test Steps and Execution JSON are complete. It is the final artifact in the generation chain.

It is generated:
1. **Automatically after Stop Recording** — as part of the initial generation pipeline.
2. **Automatically on regeneration** — when Canonical Steps change during review (and the Playwright test has not been manually edited).
3. **Manually on user request** — when the user has manually edited the Playwright test and wants to regenerate from canonical steps (overwriting their edits).

### 5.3 Why Should One Test Case Generate Exactly One Playwright test()?

| Reason | Detail |
|--------|--------|
| **Semantic match** | A Test Case represents one complete test scenario. A Playwright `test()` represents one complete test scenario. The mapping is 1:1. |
| **Independent execution** | Each test case should be runnable independently. Splitting into multiple `test()` calls would create inter-test dependencies, which are an anti-pattern. |
| **Approval granularity** | The user approves one Test Case at a time. Generating one test per Test Case keeps the approval boundary clean. |
| **Repository consistency** | When saved, one Test Case in the repository maps to one test file. Browsing, searching, and managing tests is simpler with a 1:1 mapping. |
| **Suite composition** | When future suite generation combines approved Test Cases, each contributes one `test()`. Multiple `test()` calls per Test Case would complicate suite assembly. |

### 5.4 Why Should Playwright Remain a Derived Artifact?

**Because the canonical representation is the source of truth.**

If Playwright were the source of truth, then:
- Adding Cypress support would require re-recording tests in Cypress.
- Updating Playwright API (e.g., locator strategy changes) would require re-recording.
- The Test Case would be locked to Playwright forever.
- Editing steps during review would require reverse-engineering Playwright code back into steps.

By keeping Playwright as a derived artifact:
- Adding Cypress means writing a Cypress code generator that reads the same canonical steps.
- Updating Playwright syntax means regenerating from canonical steps.
- Editing steps during review automatically regenerates the Playwright test.
- The Test Case remains valuable even if the team switches from Playwright to another framework.

### 5.5 What Should the Generated Test Look Like?

```typescript
import { test, expect } from '@playwright/test';

test('Book a one-way flight on Adani One', async ({ page }) => {
  // Recording Context: Started on https://www.adanione.com/
  await page.goto('https://www.adanione.com/');

  // Step 1: Click "Book Flight"
  await page.click('[data-testid="book-flight"]');

  // Step 2: Navigate to flight-booking
  await page.waitForURL('**/flight-booking');

  // Step 3: Click "One Way"
  await page.click('button:has-text("One Way")');

  // Expected Result (if provided during review)
  // await expect(page.locator('.confirmation')).toBeVisible();
});
```

**Rules:**
- Test name comes from Test Case Name.
- Recording Context becomes the initial `page.goto()`.
- Each canonical step becomes one or more Playwright actions.
- Comments mirror the plain English descriptions.
- Locator comes from the Execution JSON's locator strategy.
- Expected Result becomes a commented assertion (active if the user provides one).

---

## Stage 6 — Artifact Relationships

### 6.1 The Relationship Diagram

```
INTERACTION TIMELINE
(factual record — what the user did)
        │
        │  generated from
        ▼
CANONICAL TEST STEPS
(interpreted instructions — what the test should do)
        │
        ├──→ EMBEDDED: Execution JSON per step
        │    (machine model — how to execute each step)
        │
        │  derived from
        ▼
GENERATED PLAYWRIGHT TEST
(TypeScript code — how Playwright executes the test)
        │
        │  future derived from Canonical Steps
        ├──→ CYPRESS TEST (future)
        ├──→ SELENIUM TEST (future)
        └──→ CUCUMBER FEATURE (future)
```

### 6.2 Source of Truth Model

| Artifact | Role | Derived From |
|----------|------|--------------|
| **Interaction Timeline** | Raw input (factual record) | Nothing — it is captured data |
| **Canonical Test Steps** | **Source of truth** (interpreted record) | Interaction Timeline |
| **Execution JSON** | Embedded property of Steps (machine model) | Canonical Test Steps |
| **Generated Playwright Test** | Derived export (executable code) | Canonical Test Steps |

### 6.3 Which Objects Should Never Be Edited Directly?

| Object | Editable? | Why |
|--------|-----------|-----|
| **Interaction Timeline** | Delete only | It's a factual record. You can remove false positives, but you cannot alter what was captured. |
| **Execution JSON** | ❌ Never directly | It is always derived from Steps. If Steps change, JSON regenerates automatically. No manual editing. |
| **Recording Context** | ❌ Never | Factual metadata. The recording started where it started. |
| **Element Identity** | ❌ Never | Extracted from the DOM. Factual data. |
| **Screenshots** | ❌ Never | Visual evidence. |

| Object | Editable? | What Can Be Edited |
|--------|-----------|-------------------|
| **Canonical Test Steps** | ✅ | Plain English text. Step deletion (via timeline deletion). |
| **Generated Playwright Test** | ✅ | Full code text. User can modify the generated code. Flagged as manual edit. |
| **Expected Result** | ✅ | Can be added or refined during review. |

### 6.4 The Authority Rule

**When in doubt, Canonical Test Steps are authoritative.**

If the Playwright Test (manually edited) says something different from the Canonical Test Steps, the Steps win. The manual Playwright edit is preserved as an override, but the canonical representation remains the record of truth.

This rule ensures that:
- Future exports always read from Steps, never from a previous Playwright export.
- Re-generating the Playwright test always produces code consistent with the Steps.
- The user always has one clear place to look for "what does this test actually do?"

### 6.5 Regeneration Semantics (Definitive)

This section resolves the four edge cases raised during design review.

#### Q1 — Do plain English edits trigger regeneration?

**No.** Plain English is a human-readable layer on top of a step. It describes the step in words; it does not define the step's execution.

When a tester changes `Click "Login"` to `Click "Sign In"`, they are changing the **description**, not the **action**. The element identity, locators, action type, and execution data are unchanged. Regenerating Execution JSON and Playwright would produce identical code — the regeneration would be a wasteful no-op.

| Type of step edit | Execution JSON? | Playwright? | Why |
|---|---|---|---|
| Plain English text only | ❌ No | ❌ No | Human layer. No execution impact. |
| Step deletion | ✅ Yes (always) | ✅ Yes (if `isManualEdit === false`) | Structural change. Step count changed. |
| Action type, target, or element identity change | ✅ Yes (always) | ✅ Yes (if `isManualEdit === false`) | Execution semantics changed. |

**Why this matters:** If any plain English edit triggered full regeneration, the user would lose manual Playwright edits every time they fix a typo. That would be destructive and frustrating.

#### Q2 — Is Playwright directly editable?

**Yes.** QA engineers often need to make small adjustments to generated code (add a wait, change a selector, add an assertion).

Once the user edits Playwright code directly:
- `isManualEdit` is set to `true`.
- The Test Case is flagged: "Playwright test has manual edits."
- Future step changes prompt: *"Canonical steps have changed. Regenerate Playwright test? This will overwrite your edits."* — User chooses: **Regenerate** (overwrites, `isManualEdit → false`) or **Keep** (preserves edits, canonical steps remain authoritative).
- Canonical Test Steps always remain the source of truth. The manual Playwright edit is an override, not a new source.

#### Q3 — Generation Idempotency

All three artifacts are **deterministic** for the same input state. Pressing "Regenerate" three times on the same unchanged input produces identical output each time.

| Regenerate | Source | Idempotent? | User data risk |
|---|---|---|---|
| Canonical Steps | Current Interaction Timeline | ✅ Yes | **Yes** — user plain English edits are lost. Regeneration re-derives from raw timeline, which does not contain human-edited descriptions. |
| Execution JSON | Current Canonical Steps | ✅ Yes | No — JSON is auto-managed, never user-edited. |
| Playwright | Current Steps + JSON | ✅ Yes | **If `isManualEdit`**: prompts before overwriting. If `isManualEdit === false`: overwrites without prompt (no user data to lose). |

**"Regenerate Steps" is a reset.** It replaces the current step set with a fresh machine derivation from the raw timeline. Any plain English edits, any manual refinements on steps — gone. The system should warn: *"Regenerating steps from the raw timeline will discard your plain English edits. Continue?"*

#### Q4 — Artifact Versioning

**v1.0 replaces. No version history.**

| Scenario | v1.0 Behavior |
|---|---|
| Steps change → Playwright regenerates | Previous Playwright code is **replaced**. Not retained. |
| User edits Playwright manually | Previous auto-generated code is **replaced** by the manual edit. `isManualEdit = true`. |
| Test Case approved | The frozen version is the **only** version. No history of intermediate states. |

**Future:** The Product Architecture Design §1.1 already lists "Test Case Version" as a Future Object (Post-v1.0). When versioning is implemented:
- Each regeneration snapshots the previous artifacts before replacing.
- The repository holds a versioned history of canonical steps and derived exports.
- Users can diff versions, roll back, and compare.
- This is a **when, not if** — but it is explicitly out of scope for v1.0.

### 6.6 Regeneration Summary Table

| Trigger | Steps | Execution JSON | Playwright | User Prompt? |
|---|---|---|---|---|
| Stop Recording (initial generation) | Generated from Timeline | Generated from Steps | Generated from Steps | No |
| Edit plain English on a Step | ❌ | ❌ | ❌ | No |
| Delete interaction from Timeline | Step removed | ✅ Regenerated | ✅ If `!isManualEdit` | Only if `isManualEdit` |
| Step structural change (action, target) | ✅ Changed | ✅ Regenerated | ✅ If `!isManualEdit` | Only if `isManualEdit` |
| Edit Playwright code directly | ❌ | ❌ | ✅ Changed, `isManualEdit = true` | No |
| "Regenerate Steps" button | ✅ Re-derived from Timeline (plain English edits lost) | ✅ Regenerated | ✅ If `!isManualEdit` | Warns: discards plain English edits |
| "Regenerate Playwright" button | ❌ | ❌ | ✅ Re-derived from Steps | Warns if `isManualEdit`: overwrites edits |
| Approve Test Case | ❌ Frozen | ❌ Frozen | ❌ Frozen | No |

---

## Stage 7 — State Transition

### 7.1 Full State Machine

```
DRAFT
  │  Test Case created. Metadata entered.
  │  No recording yet.
  │
  ▼
RECORDING
  │  Recording Session active.
  │  Interactions flowing into Timeline.
  │  Recording Context captured.
  │
  ▼
RECORDED
  │  Stop Recording pressed.
  │  Timeline is complete and frozen.
  │  No artifacts generated yet.
  │
  ▼
GENERATING
  │  System is producing artifacts.
  │  Steps → Execution JSON → Playwright Test.
  │  User sees progress indication.
  │
  ▼
GENERATED
  │  All three artifacts exist.
  │  Ready for review.
  │
  ▼
UNDER_REVIEW
  │  User reviews Timeline, Steps, Playwright.
  │  User can edit steps, delete interactions, modify code.
  │  Artifacts may change (with regeneration rules).
  │
  ▼
APPROVED
  │  User clicks "Approve Test Case".
  │  All artifacts frozen.
  │
  ▼
SAVED
  │  Test Case persisted to Repository.
  │  Immutable. Complete. Self-contained.
```

### 7.2 Is a GENERATING State Required?

**Yes.** A `GENERATING` state is required for the following reasons:

1. **Transparency.** The user must know that the system is working, not frozen or broken. A visible "Generating..." state with progress indication tells the user "your recording is being processed."

2. **Atomicity.** Generation produces three artifacts in sequence. If the system fails partway through (e.g., Steps generated but Playwright failed), the `GENERATING` state clearly signals that the Test Case is in an incomplete state. Without it, a Test Case could appear to be in `GENERATED` state with missing artifacts.

3. **Prevents premature interaction.** While generation is in progress, the review controls (edit, delete, approve) should be disabled. The `GENERATING` state makes this gating explicit.

4. **Enables retry.** If generation fails, the Test Case is still in `GENERATING` state — the user can retry without having to re-record.

### 7.3 When Does Generation Begin?

Generation begins **immediately** after Stop Recording. There is no user action required to trigger it. The transition from `RECORDED` → `GENERATING` is automatic and instantaneous.

**Rationale:** The user has already decided to stop recording. They expect the system to produce results. Requiring an additional "Generate" button click would add friction without value.

### 7.4 When Does Generation Complete?

Generation completes when **all three artifacts have been successfully produced**:

1. ✅ Canonical Test Steps generated from Timeline.
2. ✅ Execution JSON embedded in each Step.
3. ✅ Generated Playwright Test produced from Steps.

At this point, the Test Case transitions from `GENERATING` → `GENERATED`, and then immediately to `UNDER_REVIEW` (since the user should begin reviewing as soon as artifacts are ready).

**Note:** The transition from `GENERATED` → `UNDER_REVIEW` is automatic. There is no "Start Review" button. As soon as artifacts are ready, the review screen appears.

### 7.5 What Should Happen If Generation Fails?

See Stage 9 — Failure Handling.

### 7.6 What About the Empty Recording Edge Case?

If the user starts recording and stops without capturing any interactions:

- The timeline is empty.
- Canonical Test Steps would be empty.
- Execution JSON would be empty.
- Playwright Test would be an empty `test()` with only the `page.goto()` from Recording Context.

**Decision:** Generation should still succeed. An empty recording is valid — the user may have stopped accidentally or is testing the start/stop flow. The empty Test Case enters `UNDER_REVIEW` with zero steps.

**Approval is blocked** for empty Test Cases: "Cannot approve an empty Test Case. Record at least one interaction." (Per Product Foundation Design §4.5.)

---

## Stage 8 — User Experience

### 8.1 What Should the User See Immediately After Stop Recording?

The user should see:

1. **Recording status clears.** The red "Recording" indicator disappears. The recording badge clears.

2. **Brief progress indication.** The system shows that it is generating artifacts. This should be lightweight — not a full-screen loading overlay, but a clear status that work is in progress.

   Examples of appropriate progress indication:
   - "Generating test steps..."
   - "Generating execution JSON..."
   - "Generating Playwright test..."
   - Or a single "Generating artifacts..." with a spinner.

3. **Transition to review view.** Once generation completes, the user sees the review view with all three artifacts.

### 8.2 Should Generation Be Visible?

**Yes, but briefly and non-intrusively.**

The user should know that:
- Stop was successful (recording ended).
- The system is working (generating).
- Results are coming (review will appear).

They should NOT see:
- Technical details of the generation process.
- Error logs or stack traces (unless something fails — see Stage 9).
- A complex progress bar with percentages (overkill for a sub-second operation on a typical recording).

### 8.3 Should Progress Be Displayed?

For typical recordings (1–50 interactions), generation completes in under a second. A simple "Generating..." message is sufficient.

For large recordings (100+ interactions), a slightly more detailed progress indication is appropriate — perhaps "Generating steps (15 of 142 interactions)..." — but this is a refinement, not a requirement for v1.0.

### 8.4 When Should the User Be Allowed to Continue?

The user should be allowed to interact with the review screen **only after generation completes** (all artifacts produced). During generation:

- The review controls (edit, delete, approve) are disabled.
- The artifacts are not yet displayed (or displayed as "generating..." placeholders).
- The user cannot approve or discard.

Once generation completes:
- All artifacts are displayed.
- Review controls are enabled.
- The user can review, edit, delete, approve, or discard.

### 8.5 What Should the Review Experience Feel Like?

The review experience should feel like **three synchronized views of the same test**:

1. **"What I did"** — Interaction Timeline (factual, read-only except deletion).
2. **"What it means"** — Canonical Test Steps (editable plain English).
3. **"How it runs"** — Generated Playwright Test (editable code).

The user should be able to switch between these views without losing context. Selecting a step in one view should highlight the corresponding interaction in the timeline and the corresponding code line in the Playwright test.

This synchronization is a **product goal**, not a v1.0 requirement. v1.0 can ship with three independently scrollable sections. Synchronized highlighting is a refinement.

---

## Stage 9 — Failure Handling

### 9.1 Failure Philosophy

**Generation failures should be recoverable without re-recording.**

The Interaction Timeline is the most valuable artifact — it represents real user effort and cannot be easily reproduced. Generation transforms the timeline into artifacts; if transformation fails, the timeline is still intact and generation can be retried.

Principle: **Never destroy input because output generation failed.**

### 9.2 Canonical Test Step Generation Fails

**Scenario:** The system cannot transform one or more interactions into Canonical Test Steps.

**Product behavior:**

1. The Test Case remains in `GENERATING` state.
2. The user sees: "Unable to generate test steps. [Retry] [Discard Recording]".
3. The Interaction Timeline is preserved.
4. On retry, generation starts fresh from the Timeline.
5. If a specific interaction is problematic (e.g., element identity is incomplete), the step is generated with available data and flagged: "Low confidence — element details incomplete."

**Key principle:** A partial step is better than no step. The user can review and refine during the review phase.

### 9.3 Execution JSON Generation Fails

**Scenario:** Steps were generated, but Execution JSON could not be produced for one or more steps.

**Product behavior:**

1. Steps remain available — they are the more important artifact.
2. The affected step(s) have a placeholder in their executionJson field: `{ error: "generation_failed", retry: true }`.
3. The Playwright Test cannot be generated for steps with failed Execution JSON.
4. The user sees: "Execution data incomplete for N step(s). Steps are available for review. [Retry Generation]".
5. On retry, only the failed execution JSONs are regenerated — successful ones are preserved.

**Key principle:** Execution JSON is a derived property. Its failure should not cascade to destroying Steps.

### 9.4 Playwright Generation Fails

**Scenario:** Steps and Execution JSON are complete, but the Playwright code generator fails.

**Product behavior:**

1. Steps and Execution JSON remain available.
2. The Playwright Test field shows: "Playwright generation failed. [Retry]".
3. The user can still review and edit Canonical Test Steps.
4. The user can still approve the Test Case — but the Playwright Test will be empty or marked as "generation failed."
5. On retry, Playwright generation starts fresh from the current Steps.

**Key principle:** Playwright is a derived export. Its failure should not block review of the canonical artifacts.

### 9.5 Only Part of the Generation Succeeds

**Scenario:** Steps generated successfully. Execution JSON generated for 8 of 10 steps. Playwright generated but with 2 missing actions.

**Product behavior:**

1. The Test Case enters `GENERATED` state with the partial artifacts.
2. Each incomplete artifact is clearly marked.
3. The user sees a summary: "Generation completed with warnings: 2 steps have incomplete execution data. Playwright test is missing 2 actions."
4. The user can:
   - Review and approve the partial Test Case (the missing actions are commented out in the Playwright test).
   - Retry generation for the failed parts.
   - Manually fix the Playwright test during review.

**Key principle:** Partial generation is not a failure — it's a warning. The user decides whether to fix, retry, or accept.

### 9.6 Complete Generation Failure

**Scenario:** None of the three artifacts could be generated.

**Product behavior:**

1. The Test Case remains in `GENERATING` state.
2. The user sees: "Generation failed. Your recording is preserved. [Retry] [Discard Recording]".
3. The Interaction Timeline and Recording Context are intact.
4. Retry starts the full generation pipeline from the beginning.
5. Discard returns the Test Case to `DRAFT` state (metadata preserved, timeline cleared).

### 9.7 Failure Handling Summary

| Failure | Steps | Exec JSON | Playwright | User Options |
|---------|-------|-----------|------------|--------------|
| Step generation fails | ❌ | ❌ | ❌ | Retry, Discard |
| Execution JSON fails | ✅ | ⚠️ Partial | ⚠️ Partial | Review steps, Retry, Approve partial |
| Playwright fails | ✅ | ✅ | ❌ | Review steps + JSON, Retry Playwright, Approve without Playwright |
| Partial failure | ✅ | ⚠️ | ⚠️ | Review, Retry failed parts, Fix manually, Approve partial |
| Complete failure | ❌ | ❌ | ❌ | Retry, Discard |

**Core principle across all failure modes:** The Interaction Timeline is never destroyed by a generation failure. It is the product of real user effort and must survive any generation problem.

---

## Stage 10 — Product Principles

### P1 — Recording Is Temporary; the Test Case Is Permanent

A recording is raw, messy, and may contain false positives. A Test Case is reviewed, refined, and approved. After Stop, the recording's output (Timeline + Context) is permanently attached to the Test Case, and the recording session is discarded.

### P2 — Artifact Generation Begins Only After Recording Is Complete

No artifacts are generated during recording. The user's focus during recording is on the application under test, not on generated output. Generation starts the moment Stop is pressed.

### P3 — Canonical Test Steps Are the Primary Human-Readable Representation

Steps combine human language, structural clarity, technical detail, AI context, and traceability. They are the single editable surface during review. Every other representation is derived from them.

### P4 — CmdRunner Execution JSON Is the Primary Execution Representation

Execution JSON bridges human-readable steps and machine-executable code. It centralizes locator decisions, action semantics, and wait strategies. Code generators consume it without parsing natural language.

### P5 — Generated Playwright Tests Are Derived Artifacts

Playwright is one consumer of the canonical representation. It is generated from Steps, never the other way around. Adding a new execution format (Cypress, Selenium, Cucumber) means writing a new translator — not re-recording.

### P6 — Every Generated Artifact Belongs to Exactly One Test Case

No artifact exists in isolation. Every step, every execution JSON, every Playwright test belongs to exactly one Test Case. No sharing, no cross-references between Test Cases at the artifact level.

### P7 — One Test Case Generates One Playwright test()

The mapping is 1:1. One Test Case → one test file → one `test()`. This keeps approval boundaries clean, enables independent execution, and simplifies future suite composition.

### P8 — Future Execution Formats Must Be Generated from the Canonical Representation

Cypress, Selenium, Cucumber — all future exports read from Canonical Test Steps and Execution JSON. They never read from a previous Playwright export. The canonical representation is the single derivation source.

### P9 — Artifact Generation Must Not Change the Recorded Interactions

Generation is a read-only transformation of the Timeline. It produces new artifacts (Steps, JSON, Playwright) but never modifies, reorders, or augments the raw interactions. The Timeline is immutable input.

### P10 — The Workflow Must Remain Framework Agnostic

The generation workflow — Timeline → Steps → JSON → Playwright — contains no framework-specific assumptions at the Steps or JSON level. Framework-specificity is isolated to the final derived artifact (Playwright Test). This ensures the workflow survives framework changes.

### P11 — Generation Failure Never Destroys Input

The Interaction Timeline represents real user effort. If any stage of generation fails, the Timeline is preserved. The user can always retry generation or discard the entire Test Case — but generation failure alone never destroys captured data.

### P12 — Partial Generation Is a Warning, Not a Failure

If some steps generate successfully and others don't, the Test Case enters review with the successful artifacts and clear warnings about what's incomplete. The user decides whether to fix, retry, or accept.

### P13 — Plain English Edits Do Not Trigger Regeneration

Plain English is a human-readable layer on top of Canonical Test Steps. Changing the description (`"Login"` → `"Sign In"`) does not change the execution data (element identity, locators, action type). Only structural changes (step deletion, action type change, target change) trigger regeneration of derived artifacts.

### P14 — Regeneration Is Idempotent and Destructive

Regenerating artifacts from the same input state always produces identical output. However, "Regenerate Steps" re-derives from the raw timeline and **discards** plain English edits. "Regenerate Playwright" overwrites the current Playwright code. Both are deliberate destructive actions that should warn the user before proceeding.

### P15 — v1.0 Replaces Without Version History

Regeneration replaces the previous artifact. No intermediate versions are retained in v1.0. Test Case Versioning is a documented future capability (Architecture §1.1) but is explicitly out of scope for v1.0.

---

## 11. Deliverable Summary

### 11.1 Complete Artifact Generation Workflow

```
User clicks Stop Recording
        │
        ▼
Recording Session ends
  • Timeline frozen
  • Context + Timeline attached to Test Case
  • Session discarded
  • Test Case → RECORDED
        │
        ▼
Artifact generation begins (automatic)
  • Test Case → GENERATING
        │
        ├── ① Canonical Test Steps
        │     Generated from Interaction Timeline
        │     Each interaction → one structured step
        │
        ├── ② Execution JSON
        │     Embedded in each Step
        │     Locator, action, value, wait strategy
        │
        └── ③ Generated Playwright Test
              Derived from Steps + Execution JSON
              One test() for the entire Test Case
        │
        ▼
Generation complete
  • Test Case → GENERATED → UNDER_REVIEW
  • Review screen displayed
  • All artifacts visible and editable (per mutability rules)
        │
        ▼
User reviews and edits
  • Delete false positives from Timeline → removes linked Step
  • Edit plain English on Steps
  • Edit Playwright code directly (sets isManualEdit = true)
  • Add/refine Expected Result
  • Regeneration follows mutability rules
        │
        ▼
User clicks Approve Test Case
  • Test Case → APPROVED
  • All artifacts frozen
  • Ready for repository save
```

### 11.2 Lifecycle After Stop Recording

```
Stop Recording
  │
  ├─ RECORDED (instant)
  │    Timeline + Context attached to Test Case
  │
  ├─ GENERATING (automatic)
  │    Steps → JSON → Playwright
  │
  ├─ GENERATED → UNDER_REVIEW (automatic)
  │    All artifacts ready, review begins
  │
  ├─ APPROVED (user action)
  │    Artifacts frozen
  │
  └─ SAVED (user action or automatic)
       Test Case persisted to Repository
```

### 11.3 Source-of-Truth Model

```
Interaction Timeline (raw input)
        ↓
Canonical Test Steps (SOURCE OF TRUTH)
  ├── Execution JSON (embedded property, auto-derived)
  ↓
Generated Playwright Test (derived export)
  ├── Future: Cypress (derived export)
  ├── Future: Selenium (derived export)
  └── Future: Cucumber (derived export)
```

### 11.4 Failure Handling Summary

| Failure | Impact | User Recovery |
|---------|--------|---------------|
| Step generation fails | No artifacts produced | Retry or Discard (Timeline preserved) |
| Execution JSON fails | Steps available, JSON partial | Review steps, retry JSON |
| Playwright fails | Steps + JSON available | Review canonical, retry Playwright |
| Partial failure | Some artifacts complete | Review, retry failed parts, or accept partial |
| Complete failure | No artifacts | Retry or Discard (Timeline preserved) |

---

## 12. Suggested Roadmap

The implementation of Post-Recording Artifact Generation should follow this milestone sequence:

### Milestone B2 — Artifact Generation Architecture & Technical Design

**Type:** Architecture design (no code)
**Depends on:** This document (B1, frozen)

Define the technical architecture for:
- The generation pipeline (Timeline → Steps → JSON → Playwright)
- The GENERATING state and its transitions
- How artifacts are stored (on the Test Case, in chrome.storage.local)
- Regeneration logic (when Steps change, what regenerates)
- Failure detection and retry mechanism
- The `isManualEdit` flag and Playwright override logic

**Freeze gate:** Architecture must be reviewed and frozen before implementation begins.

---

### Milestone B3 — Canonical Test Step Generation (Implementation)

**Type:** Implementation
**Depends on:** B2 (frozen architecture)

Implement:
- Step generator: Interaction → Canonical Test Step transformation
- Plain English generation per interaction type
- Element identity projection into steps
- AI enrichment attachment to steps
- linkedInteractionId mapping
- Step numbering (sequential, stable on deletion)
- Unit tests for step generation
- Integration tests: Timeline → Steps pipeline

---

### Milestone B4 — Execution JSON Generation (Implementation)

**Type:** Implementation
**Depends on:** B3 (Steps exist)

Implement:
- Execution JSON generator: Canonical Test Step → executionJson
- Locator strategy resolution (priority: testId → dataCy → dataQa → id → ariaLabel → name → css → xpath)
- Action semantics mapping (click, navigate, future: type, select)
- Wait strategy assignment
- Auto-regeneration when Steps change
- Unit tests for execution JSON generation
- Integration tests: Steps → JSON pipeline

---

### Milestone B5 — Playwright Test Generation (Implementation)

**Type:** Implementation
**Depends on:** B3 + B4 (Steps + JSON exist)

Implement:
- Playwright code generator: Canonical Steps + Execution JSON → TypeScript test string
- Test scaffolding (imports, test() wrapper, name from Test Case Name)
- Recording Context → page.goto()
- Step → Playwright action mapping (click → page.click, navigate → page.waitForURL)
- Locator resolution from Execution JSON
- Comment generation from plain English
- Expected Result → assertion (commented if not provided)
- isManualEdit flag and regeneration guard
- Unit tests for Playwright generation
- Integration tests: Steps → Playwright pipeline

---

### Milestone B6 — Generation Pipeline Integration & State Management (Implementation)

**Type:** Implementation
**Depends on:** B3 + B4 + B5

Implement:
- GENERATING state in Test Case lifecycle
- Automatic transition: RECORDED → GENERATING → GENERATED → UNDER_REVIEW
- Generation progress indication in side panel
- Review controls gating (disabled during GENERATING, enabled in UNDER_REVIEW)
- Failure handling: detection, user messaging, retry mechanism
- Discard Recording option (returns to DRAFT)
- Integration tests: full Stop → Generate → Review pipeline

---

### Milestone B7 — Artifact Generation Validation & Freeze

**Type:** Validation + Freeze
**Depends on:** B3 + B4 + B5 + B6

Validate:
- Full pipeline: Stop Recording → all artifacts generated → Review screen
- Each artifact matches the definitions in this document
- Failure scenarios produce expected user experience
- Regeneration rules work correctly
- isManualEdit flag prevents unwanted overwrites
- Reviewer verification
- Tester browser tests
- Freeze Milestone B as complete

---

## 13. Freeze Declaration

Upon approval, the following is declared **frozen** and must not be redesigned:

### Frozen Decisions

1. **Generation order:** Timeline → Canonical Steps → Execution JSON → Playwright. This order is mandatory and non-negotiable.

2. **Canonical Test Steps + Execution JSON is the source of truth.** All exports derive from them. Playwright is a derived artifact, not a primary representation.

3. **One Test Case generates one Playwright test().** The mapping is 1:1.

4. **A GENERATING state is required.** The Test Case lifecycle includes GENERATING between RECORDED and GENERATED.

5. **Generation begins automatically after Stop.** No user action required to trigger generation.

6. **Generation never modifies the Interaction Timeline.** The Timeline is immutable input to the generation process.

7. **Execution JSON is always derived from Steps.** It is never manually edited. It regenerates when Steps change structurally (not on plain English edits).

8. **Playwright regenerates when Steps change structurally — unless manually edited.** If `isManualEdit === true`, the user is prompted before overwriting. Plain English edits never trigger Playwright regeneration.

9. **Partial generation is a warning, not a failure.** The user can review, retry, or accept partial artifacts.

10. **Generation failure never destroys the Interaction Timeline.** The user can always retry or discard.

11. **Future execution formats (Cypress, Selenium, Cucumber) derive from Canonical Test Steps.** They never derive from a Playwright export.

12. **The workflow is framework-agnostic at the Steps and JSON level.** Framework-specificity is isolated to derived exports.

13. **Plain English edits are a human layer.** They do not change execution data and do not trigger regeneration of Execution JSON or Playwright.

14. **Regeneration is idempotent but destructive.** Same input → same output. "Regenerate Steps" discards plain English edits. "Regenerate Playwright" overwrites current code. Both warn before proceeding.

15. **v1.0 replaces without version history.** Regeneration replaces the previous artifact. Test Case Versioning is a future capability (Architecture §1.1), not in v1.0 scope.

### What This Freeze Means

- Implementation milestones (B2–B7) must follow this design without redesigning the workflow.
- If implementation reveals a flaw in the design, the flaw is documented and escalated — not silently worked around.
- Future interaction types (Text Entry, Dropdown, Checkbox, etc.) plug into this generation pipeline without changing it.
- Future export formats plug into this pipeline as additional derived artifacts from Canonical Test Steps.

---

*This document defines the Post-Recording Artifact Generation workflow for CmdRunner. All implementation must conform to this design.*
