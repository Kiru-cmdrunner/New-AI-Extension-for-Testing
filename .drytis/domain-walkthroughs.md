# Architecture Walkthroughs — End-to-End Validation

**Status:** Foundation blueprint — schema stress tests
**Date:** 2026-07-20
**Companion to:** `domain-schema.md`, `domain-erd.md`, `domain-scope.md`

---

## Purpose

Three concrete scenarios, traced step-by-step through every entity they touch. The objective is to find gaps, missing fields, wrong cardinalities, or unenforced invariants **on paper** — before they become migration pain in production.

Each walkthrough follows the same structure:
1. **Scenario** — what happens, in business terms
2. **Entity trace** — which entities are created/modified/read at each step, with data examples
3. **Invariant check** — which cross-entity invariants (X1–X9) and entity invariants are exercised
4. **Deferred capability check** — does the walkthrough prove that deferred features can be added without schema changes?
5. **Findings** — any gaps, ambiguities, or schema improvements discovered

---

## Walkthrough 1: Record → AI Review → ATC → Execute → Element Changes → Self-Heal → Regeneration

This is the most complex scenario. It exercises the full lifecycle: from recording through execution, failure, healing, and regeneration. It proves the architecture supports the full round-trip without schema changes.

### Scenario

A QA engineer records a flight booking flow on the Adani One staging site. The AI reviews the recording and produces an Approved Test Case. The test case is approved and executed. During execution, the "Departure Date Picker" element cannot be found — the application's UI was refactored. The self-healing system (deferred but architected for) proposes a new locator. The element is updated, and the Execution IR is regenerated.

### Step-by-Step Trace

#### Step 1: Recording

**User action:** The QA engineer uses the CmdRunner Smart Recorder to record a flight search flow.

**Entities touched:**
- **Source Artifact** (created) — type: `interaction_timeline`

```json
{
  "id": "sa-rec-flight-001",
  "projectId": "prj-aa1b2c3d",
  "type": "interaction_timeline",
  "content": {
    "sessionEvents": [
      { "actionId": "act-001", "type": "navigate", "url": "https://staging.adanione.com/flights", "timestamp": "2026-07-20T10:00:00Z" },
      { "actionId": "act-002", "type": "text", "elementIdentity": { "tag": "INPUT", "accessibleName": "From", "role": "combobox" }, "value": "Mumbai (BOM)", "timestamp": "2026-07-20T10:00:05Z" },
      { "actionId": "act-003", "type": "text", "elementIdentity": { "tag": "INPUT", "accessibleName": "To", "role": "combobox" }, "value": "Delhi (DEL)", "timestamp": "2026-07-20T10:00:12Z" },
      { "actionId": "act-004", "type": "dateSelect", "elementIdentity": { "tag": "INPUT", "accessibleName": "Departure Date", "inputType": "text" }, "value": "2026-08-15", "timestamp": "2026-07-20T10:00:20Z" },
      { "actionId": "act-005", "type": "click", "elementIdentity": { "tag": "BUTTON", "accessibleName": "Search Flights", "role": "button" }, "timestamp": "2026-07-20T10:00:25Z" }
    ],
    "recordingMetadata": {
      "browser": "Chrome 126",
      "viewport": { "width": 1440, "height": 900 },
      "duration": 25,
      "url": "https://staging.adanione.com/flights"
    }
  },
  "metadata": { "captureMethod": "cmdrunner_recorder_v8.5", "rawEvidenceAvailable": true },
  "createdAt": "2026-07-20T10:00:30Z",
  "createdBy": "user-1862"
}
```

**Invariants exercised:**
- **INV-SA1:** Source is immutable from creation ✅
- **INV-SA2:** Source will never be deleted ✅
- **X2:** Source retains the complete raw signal ✅

#### Step 2: AI Review

**User action:** The user clicks "Generate Test Case" on the recording. The AI Workflow Review interprets the timeline.

**Entities touched:**
- **Source Artifact** (read) — the timeline is read by the AI
- **Element Repository** (created) — new elements created for each logical UI component

Elements created:
```json
[
  {
    "id": "elm-201-from-airport",
    "projectId": "prj-aa1b2c3d",
    "logicalName": "From Airport Selector",
    "pageOrComponent": "flight_search",
    "locatorStrategies": [
      { "type": "role", "value": "combobox[name=\"From\"]", "priority": 1, "confidence": 1.0 },
      { "type": "testId", "value": "[data-testid=\"from-airport\"]", "priority": 2, "confidence": 1.0 },
      { "type": "css", "value": "#from-input", "priority": 3, "confidence": null }
    ],
    "status": "active",
    "createdAt": "2026-07-20T10:01:00Z",
    "updatedAt": "2026-07-20T10:01:00Z"
  },
  {
    "id": "elm-203-departure-date",
    "projectId": "prj-aa1b2c3d",
    "logicalName": "Departure Date Picker",
    "pageOrComponent": "flight_search",
    "locatorStrategies": [
      { "type": "role", "value": "textbox[name=\"Departure Date\"]", "priority": 1, "confidence": 1.0 },
      { "type": "testId", "value": "[data-testid=\"departure-date\"]", "priority": 2, "confidence": 1.0 },
      { "type": "css", "value": ".date-picker input.departure", "priority": 3, "confidence": null }
    ],
    "status": "active",
    "createdAt": "2026-07-20T10:01:00Z",
    "updatedAt": "2026-07-20T10:01:00Z"
  }
  // ... elm-202-to-airport, elm-204-search-button
]
```

- **Approved Test Case** (created) + **ATC Version** (created, version 1)

```json
{
  "id": "tc-flight-search-001",
  "projectId": "prj-aa1b2c3d",
  "title": "Search for flights between two cities",
  "tags": ["smoke", "flights"],
  "priority": "high",
  "status": "draft",
  "currentVersionId": "tcv-flight-v1",
  "createdAt": "2026-07-20T10:01:00Z",
  "createdBy": "user-1862"
}
```

Version 1:
```json
{
  "id": "tcv-flight-v1",
  "testCaseId": "tc-flight-search-001",
  "versionNumber": 1,
  "steps": [
    { "id": "s1", "order": 0, "action": "navigate", "description": "Navigate to flights page", "input": "/flights" },
    { "id": "s2", "order": 1, "action": "fill", "description": "Enter departure airport", "elementId": "elm-201-from-airport", "input": "Mumbai (BOM)" },
    { "id": "s3", "order": 2, "action": "fill", "description": "Enter destination airport", "elementId": "elm-202-to-airport", "input": "Delhi (DEL)" },
    { "id": "s4", "order": 3, "action": "selectDate", "description": "Select departure date", "elementId": "elm-203-departure-date", "input": "2026-08-15" },
    { "id": "s5", "order": 4, "action": "click", "description": "Click Search Flights button", "elementId": "elm-204-search-button",
      "validations": [
        { "id": "v1", "type": "urlMatch", "comparison": "contains", "expectedValue": "/results", "severity": "hard" },
        { "id": "v2", "type": "count", "elementId": "elm-205-flight-result-card", "property": "count", "comparison": "greaterThan", "expectedValue": 0, "severity": "hard" }
      ]
    }
  ],
  "sourceArtifactIds": ["sa-rec-flight-001"],
  "aiMetadata": {
    "confidence": 0.92,
    "reasoning": "5 raw interactions interpreted as a flight search flow. Date interaction classified as selectDate based on value format matching ISO date pattern.",
    "modelVersion": "gemini-2.0-flash-001",
    "interpretationTimestamp": "2026-07-20T10:00:45Z"
  },
  "versionNumber": 1,
  "parentVersionId": null,
  "createdAt": "2026-07-20T10:01:00Z",
  "createdBy": "user-1862"
}
```

**Invariants exercised:**
- **INV-ATCV3:** Every `step.elementId` resolves to an existing Element ✅ (elements were created in the same transaction)
- **INV-ATCV4:** Steps reference Elements by stable ID ✅
- **INV-ATCV5:** `sourceArtifactIds` records provenance ✅
- **X3:** Steps reference Elements by ID, not name or selector ✅
- **INV-EL4:** Each element has ≥1 locator strategy ✅

#### Step 3: Review and Approval

**User action:** The QA lead reviews the draft test case in the UI, makes a minor edit to the description, and approves it.

**Entities touched:**
- **ATC** (updated) — status: `draft` → `in_review` → `approved`
- **ATC Version** (updated) — `approvedBy`, `approvedAt` set on version 1

```json
{
  "id": "tc-flight-search-001",
  "status": "approved",
  "updatedAt": "2026-07-20T10:05:00Z"
}
```

```json
{
  "id": "tcv-flight-v1",
  "approvedBy": "user-1862",
  "approvedAt": "2026-07-20T10:05:00Z"
}
```

**Invariants exercised:**
- **INV-ATC2:** Status transition: draft → in_review → approved ✅
- **X9:** Only `approved` test cases can be included in runs ✅

#### Step 4: Execution IR Generation

**User action:** The user triggers an execution. The system first generates the Execution IR.

**Entities touched:**
- **ATC Version** (read) — version 1's steps are read
- **Element Repository** (read) — each step's `elementId` is resolved to current locator strategies
- **Execution IR** (created) — generated artifact

```json
{
  "id": "ir-flight-v1-001",
  "testCaseVersionId": "tcv-flight-v1",
  "generatedAt": "2026-07-20T10:10:00Z",
  "generatorVersion": "ir-gen-1.0.0",
  "ir": {
    "testCaseId": "tc-flight-search-001",
    "testCaseVersionNumber": 1,
    "title": "Search for flights between two cities",
    "steps": [
      { "order": 0, "action": "navigate", "target": { "url": "/flights" } },
      { "order": 1, "action": "fill",
        "target": {
          "elementId": "elm-201-from-airport",
          "resolvedLocators": [
            { "type": "role", "value": "combobox[name=\"From\"]", "priority": 1 },
            { "type": "testId", "value": "[data-testid=\"from-airport\"]", "priority": 2 },
            { "type": "css", "value": "#from-input", "priority": 3 }
          ]
        },
        "input": "Mumbai (BOM)"
      },
      // ... steps 2-3 similar
      { "order": 3, "action": "selectDate",
        "target": {
          "elementId": "elm-203-departure-date",
          "resolvedLocators": [
            { "type": "role", "value": "textbox[name=\"Departure Date\"]", "priority": 1 },
            { "type": "testId", "value": "[data-testid=\"departure-date\"]", "priority": 2 },
            { "type": "css", "value": ".date-picker input.departure", "priority": 3 }
          ]
        },
        "input": "2026-08-15"
      }
      // ... step 5 (click + validations)
    ]
  },
  "renderings": {
    "cmdrunner": { /* CmdRunner JSON */ },
    "playwright": { /* generated Playwright test code */ }
  }
}
```

**Invariants exercised:**
- **INV-IR1:** IR is generated from ATC version + Element Repository ✅
- **INV-IR4:** `resolvedLocators` matches Element Repository's current strategies ✅
- **X6:** IR is derived, not authoritative ✅
- **DP5:** Execution IR is a build artifact ✅

#### Step 5: Test Run (Execution)

**User action:** The executor runs the test against the staging environment.

**Entities touched:**
- **ATC Version** (read, pinned) — version 1 is the execution target
- **Environment Profile** (read, then snapshotted)
- **Execution IR** (read) — the IR drives the executor
- **Test Run** (created) — with step results and evidence

```json
{
  "id": "run-flight-20260720-001",
  "projectId": "prj-aa1b2c3d",
  "testCaseId": "tc-flight-search-001",
  "testCaseVersionId": "tcv-flight-v1",
  "testCaseVersionNumber": 1,
  "environmentSnapshot": {
    "name": "Staging - Chrome Desktop",
    "baseUrl": "https://staging.adanione.com",
    "browser": "chrome",
    "viewport": { "width": 1440, "height": 900 }
  },
  "status": "failed",
  "triggeredBy": "user-1862",
  "triggerType": "manual",
  "startedAt": "2026-07-20T10:10:05Z",
  "completedAt": "2026-07-20T10:10:22Z",
  "duration": 17000,
  "stepResults": [
    { "id": "sr-1", "stepId": "s1", "status": "passed", "duration": 800 },
    { "id": "sr-2", "stepId": "s2", "status": "passed", "duration": 1500 },
    { "id": "sr-3", "stepId": "s3", "status": "passed", "duration": 1400 },
    {
      "id": "sr-4",
      "stepId": "s4",
      "status": "failed",
      "duration": 3000,
      "evidence": [
        { "id": "ev-1", "type": "screenshot", "path": "/runs/run-flight-001/step-4-failure.png", "capturedAt": "2026-07-20T10:10:19Z" },
        { "id": "ev-2", "type": "domSnapshot", "path": "/runs/run-flight-001/step-4-dom.html", "capturedAt": "2026-07-20T10:10:19Z" }
      ],
      "error": {
        "message": "Element 'elm-203-departure-date' not found. All locator strategies exhausted: role=textbox[name=\"Departure Date\"], [data-testid=\"departure-date\"], .date-picker input.departure",
        "type": "element_not_found"
      }
    },
    { "id": "sr-5", "stepId": "s5", "status": "skipped", "duration": 0 }
  ],
  "retryCount": 0,
  "createdAt": "2026-07-20T10:10:00Z"
}
```

**Invariants exercised:**
- **INV-TR1:** Run pins to ATC Version, not live ATC ✅ (`testCaseVersionId: "tcv-flight-v1"`)
- **INV-TR3:** Run will be immutable after completion ✅ (terminal state: `failed`)
- **INV-TR4:** Evidence is on step results, not on the test case definition ✅
- **X4:** Run references specific version ✅
- **X5:** Environment snapshot is frozen ✅
- **X7:** Evidence belongs to runs ✅

#### Step 6: Element Changes (the failure)

**System state:** The application's date picker was refactored. The old locator strategies no longer match.

**What the schema sees:** The Element Repository still has the old locators. The Test Run captured the failure with evidence. The element's `status` is still `active` (V1 doesn't auto-detect breakage).

#### Step 7: Self-Heal (Deferred Capability — Proving Schema Support)

> **Note:** Self-healing is a **deferred capability** (see `domain-scope.md`). This step proves the schema supports it without changes.

**Hypothetical system action:** When the run fails with `element_not_found`, the self-healing system:
1. Reads the failed step's `resolvedLocators` from the IR.
2. Reads the DOM snapshot from the run's evidence.
3. AI analyzes the DOM and proposes a new locator strategy.
4. Updates the Element Repository entry.
5. Appends to `healHistory`.
6. Sets `status` to `active` (healed) and updates `lastHealedAt`.

**Entities touched (hypothetical):**
- **Element Repository** (updated) — new locator strategy added, healHistory appended

```json
{
  "id": "elm-203-departure-date",
  "logicalName": "Departure Date Picker",
  "pageOrComponent": "flight_search",
  "locatorStrategies": [
    // OLD strategies remain (demoted in priority)
    { "type": "role", "value": "textbox[name=\"Departure Date\"]", "priority": 1, "confidence": 0.2 },
    // NEW strategy added by self-heal (promoted)
    { "type": "testId", "value": "[data-testid=\"dep-date-picker\"]", "priority": 1, "confidence": 0.85 },
    { "type": "css", "value": ".flight-date-picker input[type=\"text\"]", "priority": 2, "confidence": 0.80 }
  ],
  "status": "active",
  "updatedAt": "2026-07-20T10:15:00Z",
  "lastHealedAt": "2026-07-20T10:15:00Z",
  "healHistory": [
    {
      "healedAt": "2026-07-20T10:15:00Z",
      "runId": "run-flight-20260720-001",
      "reason": "element_not_found: all locator strategies exhausted",
      "proposedBy": "self-heal-ai-v1",
      "oldStrategies": [
        { "type": "role", "value": "textbox[name=\"Departure Date\"]" },
        { "type": "css", "value": ".date-picker input.departure" }
      ],
      "newStrategies": [
        { "type": "testId", "value": "[data-testid=\"dep-date-picker\"]", "confidence": 0.85 },
        { "type": "css", "value": ".flight-date-picker input[type=\"text\"]", "confidence": 0.80 }
      ],
      "evidenceRef": "run-flight-20260720-001/step-4-dom.html"
    }
  ]
}
```

**Schema support proven:**
- `healHistory[]` array ✅ — existed in schema from day one, now populated
- `lastHealedAt` timestamp ✅ — existed in schema, now set
- `status` field ✅ — can transition `active → broken → active` (healed)
- `LocatorStrategy.confidence` ✅ — existed in schema, now computed from observed success rates
- No ALTER TABLE needed ✅

**Invariants exercised:**
- **INV-EL2:** Steps still reference `elm-203-departure-date` by stable ID ✅ — the ID didn't change, only the locators did
- **INV-EL4:** Element still has ≥1 locator strategy ✅

#### Step 8: IR Regeneration

**System action:** After the element is healed, the IR is regenerated.

**Entities touched:**
- **ATC Version** (read) — same version 1, unchanged
- **Element Repository** (read) — now has updated locators for `elm-203-departure-date`
- **Execution IR** (regenerated) — new IR artifact replaces cached one

The regenerated IR step 4 now has:
```json
{
  "order": 3,
  "action": "selectDate",
  "target": {
    "elementId": "elm-203-departure-date",
    "resolvedLocators": [
      { "type": "testId", "value": "[data-testid=\"dep-date-picker\"]", "priority": 1 },
      { "type": "css", "value": ".flight-date-picker input[type=\"text\"]", "priority": 2 }
    ]
  },
  "input": "2026-08-15"
}
```

The ATC version didn't change. The steps didn't change. Only the Element Repository changed, and the IR regeneration picked up the new locators automatically.

**Invariants exercised:**
- **INV-IR1:** IR is regenerated from same ATC version + updated Element Repository ✅
- **INV-IR4:** `resolvedLocators` now reflects the healed strategies ✅
- **INV-IR5:** The diff between old IR and new IR is the self-heal review signal ✅ — it shows "the generator would now produce different locators"
- **X1:** ATC is source of truth; IR is derived ✅
- **X6:** IR is not authoritative ✅

### Walkthrough 1 Findings

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 1.1 | The self-heal scenario works entirely within the existing schema. No fields need to be added. | ✅ Confirmed | — |
| 1.2 | The `healHistory` entry references `evidenceRef` (a path to the DOM snapshot in the run). This is a string path, not a typed FK. Should it be typed? | Minor | Leave as string path in V1. Evidence is stored as files, not queryable entities. A typed FK would require evidence to be a top-level entity, which is over-engineering for V1. |
| 1.3 | The IR regeneration diff (INV-IR5) is mentioned as a "review signal" but the schema has no field to store or surface this diff. | Minor | The diff is computed on-the-fly by comparing the cached IR with a freshly generated one. No schema field needed — it's a transient comparison, not persisted state. |
| 1.4 | When an element is healed, the old locator strategies' `confidence` values are updated (demoted). But in V1, `confidence` is not actively computed. The self-heal write-path would need to manage confidence updates. | Expected | This is a deferred capability. The schema supports it; the logic is deferred. No schema change needed. |

**Verdict: Walkthrough 1 passes.** The full record → review → execute → fail → heal → regenerate cycle is supported by the schema without modifications. Deferred capabilities (self-healing, confidence ranking) activate by populating existing fields.

---

## Walkthrough 2: Natural Language → Approved Test Case → Execute

This walkthrough proves the provenance model handles a non-recording source cleanly. It verifies that the Interaction Timeline is not structurally required — the architecture is source-agnostic.

### Scenario

A product manager writes a natural-language description of a test case during sprint planning. The AI interprets the description and produces an Approved Test Case. The test case is approved and executed.

> **Note:** Natural Language authoring is a **deferred capability** in V1. This walkthrough proves the schema supports it.

### Step-by-Step Trace

#### Step 1: NL Input

**User action:** The product manager enters a text description in the "New Test Case from Description" UI.

**Entities touched:**
- **Source Artifact** (created) — type: `natural_language`

```json
{
  "id": "sa-nl-checkout-001",
  "projectId": "prj-aa1b2c3d",
  "type": "natural_language",
  "content": {
    "description": "Add a flight from Mumbai to Delhi to the cart, proceed to checkout, enter passenger details for one adult, select the basic fare, and verify the total price includes taxes and fees before confirming the booking.",
    "context": "Provided by product manager during sprint planning"
  },
  "metadata": { "captureMethod": "manual_text_input" },
  "createdAt": "2026-07-20T11:00:00Z",
  "createdBy": "user-1862"
}
```

**Invariants exercised:**
- **INV-SA1:** Source is immutable ✅
- **INV-SA2:** Source retained permanently ✅

#### Step 2: AI Interpretation

**System action:** The AI reads the NL description and produces a draft test case.

**Entities touched:**
- **Source Artifact** (read)
- **Element Repository** (created/read) — elements referenced by the new steps

Elements created (or reused from existing repository):
```json
[
  // Reused from Walkthrough 1:
  { "id": "elm-201-from-airport", "logicalName": "From Airport Selector" },
  { "id": "elm-204-search-button", "logicalName": "Search Flights Button" },
  // New elements for this flow:
  {
    "id": "elm-301-add-to-cart",
    "logicalName": "Add to Cart Button",
    "pageOrComponent": "flight_results",
    "locatorStrategies": [
      { "type": "role", "value": "button[name=\"Add to Cart\"]", "priority": 1, "confidence": null },
      { "type": "testId", "value": "[data-testid=\"add-to-cart\"]", "priority": 2, "confidence": null }
    ],
    "status": "active"
  },
  {
    "id": "elm-302-proceed-checkout",
    "logicalName": "Proceed to Checkout Button",
    "pageOrComponent": "cart",
    "locatorStrategies": [
      { "type": "role", "value": "button[name=\"Proceed to Checkout\"]", "priority": 1, "confidence": null },
      { "type": "testId", "value": "[data-testid=\"checkout-btn\"]", "priority": 2, "confidence": null }
    ],
    "status": "active"
  },
  {
    "id": "elm-303-passenger-name",
    "logicalName": "Passenger Name Field",
    "pageOrComponent": "checkout_passenger_details",
    "locatorStrategies": [
      { "type": "role", "value": "textbox[name=\"Full Name\"]", "priority": 1, "confidence": null }
    ],
    "status": "active"
  },
  {
    "id": "elm-304-total-price",
    "logicalName": "Total Price Display",
    "pageOrComponent": "checkout_review",
    "locatorStrategies": [
      { "type": "testId", "value": "[data-testid=\"total-price\"]", "priority": 1, "confidence": null },
      { "type": "css", "value": ".price-summary .total", "priority": 2, "confidence": null }
    ],
    "status": "active"
  }
]
```

- **Approved Test Case** (created) + **ATC Version** (created)

```json
{
  "id": "tc-checkout-001",
  "projectId": "prj-aa1b2c3d",
  "title": "Complete flight checkout with passenger details",
  "tags": ["checkout", "regression"],
  "priority": "critical",
  "status": "draft",
  "currentVersionId": "tcv-checkout-v1",
  "testDataRefs": ["td-passenger-details"],
  "createdAt": "2026-07-20T11:05:00Z",
  "createdBy": "user-1862"
}
```

Version 1:
```json
{
  "id": "tcv-checkout-v1",
  "testCaseId": "tc-checkout-001",
  "versionNumber": 1,
  "steps": [
    // Steps 1-4: search for flight (reuse elements from Walkthrough 1)
    { "id": "s1", "order": 0, "action": "navigate", "description": "Navigate to flights page", "input": "/flights" },
    { "id": "s2", "order": 1, "action": "fill", "description": "Enter departure airport", "elementId": "elm-201-from-airport", "input": "Mumbai (BOM)" },
    // ...
    // New steps for checkout flow:
    { "id": "s5", "order": 4, "action": "click", "description": "Click Add to Cart for the first flight result", "elementId": "elm-301-add-to-cart" },
    { "id": "s6", "order": 5, "action": "click", "description": "Proceed to checkout", "elementId": "elm-302-proceed-checkout" },
    { "id": "s7", "order": 6, "action": "fill", "description": "Enter passenger full name", "elementId": "elm-303-passenger-name", "input": "{{testData.passengerName}}" },
    { "id": "s8", "order": 7, "action": "verify", "description": "Verify total price is displayed and includes taxes", "elementId": "elm-304-total-price",
      "validations": [
        { "id": "v1", "type": "visibility", "property": "visible", "comparison": "isTrue", "severity": "hard" },
        { "id": "v2", "type": "textMatch", "property": "text", "comparison": "contains", "expectedValue": "taxes", "severity": "soft" }
      ]
    }
  ],
  "sourceArtifactIds": ["sa-nl-checkout-001"],
  "aiMetadata": {
    "confidence": 0.75,
    "reasoning": "Interpreted NL description as an 8-step checkout flow. Reused existing flight search elements. Created new elements for cart, checkout, passenger details, and price display. Proposed visibility and textMatch validations for the total price based on the description's emphasis on 'includes taxes and fees'.",
    "modelVersion": "gemini-2.0-flash-001",
    "interpretationTimestamp": "2026-07-20T11:04:00Z"
  },
  "parentVersionId": null,
  "createdAt": "2026-07-20T11:05:00Z",
  "createdBy": "user-1862"
}
```

**Key observations:**
- The NL source produces the **same ATC structure** as a recording source. The ATC doesn't know or care where it came from.
- Elements are **reused** across test cases — `elm-201-from-airport` is shared by both the flight search test (Walkthrough 1) and this checkout test.
- The AI's confidence is **lower** (0.75 vs 0.92) because NL interpretation is inherently less certain than recorded evidence.

**Invariants exercised:**
- **INV-ATCV5:** `sourceArtifactIds` references the NL source ✅
- **INV-EL2:** Steps reference elements by stable ID ✅
- **INV-EL1:** Reused elements belong to the same project ✅
- **X3:** Elements are shared across test cases ✅

#### Step 3: Approval and Execution

The test case goes through the same approval workflow as Walkthrough 1 (status transitions, version pinning) and is executed. The execution path is identical — the executor reads the IR, which was generated from the ATC version + Element Repository, regardless of the source type.

**Schema support proven:**
- SourceArtifact `type: natural_language` ✅ — existed in schema from day one
- No special handling needed for NL sources in the execution pipeline ✅
- The ATC structure is source-agnostic ✅

### Walkthrough 2 Findings

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 2.1 | The NL source flows through the exact same pipeline as a recording. No special-case logic is needed. | ✅ Confirmed | — |
| 2.2 | Element reuse works correctly across test cases created from different source types. | ✅ Confirmed | — |
| 2.3 | The AI confidence is lower for NL interpretation than for recording interpretation. The schema handles this via `aiMetadata.confidence` — no special field needed. | ✅ Confirmed | — |
| 2.4 | The NL source references "{{testData.passengerName}}" — this template syntax must be resolved at execution time. The Test Data entity (`td-passenger-details`) must exist and have a `passengerName` key. If it doesn't, the run will error. | Expected | This is the intended behavior (INV-TD1). The executor resolves `{{testData.*}}` templates and errors clearly if the data is missing. |
| 2.5 | When elements are created during NL interpretation, their locator strategies have `confidence: null` (AI-suggested, not observed). V1 treats null as "unverified." | Expected | V1 doesn't compute confidence. This is the correct default for AI-suggested locators. Future self-healing will populate confidence from execution success rates. |

**Verdict: Walkthrough 2 passes.** The provenance model is source-agnostic. NL authoring activates by populating the existing `type: natural_language` Source Artifact — no schema changes needed. Elements are reused naturally across test cases regardless of source type.

---

## Walkthrough 3: ATC Version 3 → Test Run → ATC Updated to Version 4 → Re-run

This walkthrough stress-tests versioning. It verifies that historical runs remain stable and interpretable when the test case definition evolves.

### Scenario

An approved test case is at version 3. A run is executed against version 3 and passes. The test case is then updated to version 4 (new validation added). A new run is executed against version 4 and fails on the new validation. Both runs must remain stable, interpretable, and comparable.

### Step-by-Step Trace

#### Step 1: Version 3 Exists (Pre-condition)

**Entity state:**
- **Approved Test Case** exists, status: `approved`, `currentVersionId: "tcv-login-v3"`
- **ATC Version 3** is the current version

```json
{
  "id": "tc-login-001",
  "projectId": "prj-aa1b2c3d",
  "title": "User can log in with valid credentials",
  "status": "approved",
  "currentVersionId": "tcv-login-v3",
  "tags": ["smoke", "auth"],
  "priority": "critical"
}
```

Version 3 (abbreviated):
```json
{
  "id": "tcv-login-v3",
  "testCaseId": "tc-login-001",
  "versionNumber": 3,
  "steps": [
    { "id": "s1", "order": 0, "action": "navigate", "description": "Navigate to login page", "input": "/login" },
    { "id": "s2", "order": 1, "action": "fill", "description": "Enter email", "elementId": "elm-101-login-email", "input": "{{testData.email}}" },
    { "id": "s3", "order": 2, "action": "fill", "description": "Enter password", "elementId": "elm-102-login-password", "input": "{{testData.password}}" },
    { "id": "s4", "order": 3, "action": "click", "description": "Click Login button", "elementId": "elm-103-login-button",
      "validations": [
        { "id": "v1-url", "type": "urlMatch", "comparison": "contains", "expectedValue": "/dashboard", "severity": "hard" }
      ]
    }
  ],
  "parentVersionId": "tcv-login-v2",
  "approvedBy": "user-1862",
  "approvedAt": "2026-07-18T10:00:00Z"
}
```

#### Step 2: Run Against Version 3

**User action:** A run is triggered against version 3.

**Entities touched:**
- **Test Run** (created) — pins to version 3

```json
{
  "id": "run-login-20260720-001",
  "testCaseId": "tc-login-001",
  "testCaseVersionId": "tcv-login-v3",
  "testCaseVersionNumber": 3,
  "status": "passed",
  "stepResults": [
    { "id": "sr-1", "stepId": "s1", "status": "passed", "duration": 800 },
    { "id": "sr-2", "stepId": "s2", "status": "passed", "duration": 1200 },
    { "id": "sr-3", "stepId": "s3", "status": "passed", "duration": 1100 },
    { "id": "sr-4", "stepId": "s4", "status": "passed", "duration": 2000,
      "evidence": [{ "id": "ev-1", "type": "screenshot", "path": "/runs/run-login-001/step-4-pass.png" }]
    }
  ],
  "startedAt": "2026-07-20T12:00:00Z",
  "completedAt": "2026-07-20T12:00:04Z",
  "duration": 5100
}
```

**Invariants exercised:**
- **INV-TR1:** Run pins to `tcv-login-v3` ✅
- **INV-TR5:** `testCaseVersionNumber: 3` matches the version ✅

#### Step 3: ATC Updated to Version 4

**User action:** A QA engineer adds a new validation: after login, verify the user's name appears in the dashboard header.

This is a step change, so it creates a new version.

**Entities touched:**
- **ATC** (updated) — status: `approved` → `draft` (revision requires re-approval)
- **ATC Version 4** (created)

```json
{
  "id": "tcv-login-v4",
  "testCaseId": "tc-login-001",
  "versionNumber": 4,
  "steps": [
    { "id": "s1", "order": 0, "action": "navigate", "description": "Navigate to login page", "input": "/login" },
    { "id": "s2", "order": 1, "action": "fill", "description": "Enter email", "elementId": "elm-101-login-email", "input": "{{testData.email}}" },
    { "id": "s3", "order": 2, "action": "fill", "description": "Enter password", "elementId": "elm-102-login-password", "input": "{{testData.password}}" },
    { "id": "s4", "order": 3, "action": "click", "description": "Click Login button", "elementId": "elm-103-login-button",
      "validations": [
        { "id": "v1-url", "type": "urlMatch", "comparison": "contains", "expectedValue": "/dashboard", "severity": "hard" },
        // NEW validation added in v4:
        { "id": "v2-name", "type": "textMatch", "elementId": "elm-104-dashboard-header", "property": "text", "comparison": "contains", "expectedValue": "{{testData.firstName}}", "severity": "hard" }
      ]
    }
  ],
  "sourceArtifactIds": [],  // No new source — this is a manual edit
  "aiMetadata": null,       // Not AI-generated — manual authoring
  "changeSummary": "Added validation: verify user's first name appears in dashboard header after login.",
  "parentVersionId": "tcv-login-v3",
  "approvedBy": null,       // Not yet approved
  "approvedAt": null
}
```

ATC updated:
```json
{
  "id": "tc-login-001",
  "status": "draft",              // Revision returns to draft
  "currentVersionId": "tcv-login-v4",  // Now points to v4
  "updatedAt": "2026-07-20T12:30:00Z"
}
```

**Invariants exercised:**
- **INV-ATC2:** Status transition: approved → draft (revision) ✅
- **INV-ATCV1:** Version 3 is immutable — it was not modified ✅
- **INV-ATCV2:** `versionNumber` is monotonically increasing (3 → 4) ✅
- **INV-ATCV5:** Version 4 has empty `sourceArtifactIds` (manual edit, no source) ✅

#### Step 4: Version 4 Approved

**User action:** The QA lead reviews and approves version 4.

```json
{
  "id": "tc-login-001",
  "status": "approved"
}
```

```json
{
  "id": "tcv-login-v4",
  "approvedBy": "user-1862",
  "approvedAt": "2026-07-20T12:35:00Z"
}
```

**Invariants exercised:**
- **INV-ATC2:** Status transition: draft → in_review → approved ✅
- **X9:** Only approved versions can be run ✅

#### Step 5: Run Against Version 4

**User action:** A new run is triggered. It picks up `currentVersionId` = v4.

**Entities touched:**
- **ATC Version 4** (read, pinned)
- **Element Repository** (read) — `elm-104-dashboard-header` must exist for the new validation
- **Test Run** (created) — pins to version 4

```json
{
  "id": "run-login-20260720-002",
  "testCaseId": "tc-login-001",
  "testCaseVersionId": "tcv-login-v4",
  "testCaseVersionNumber": 4,
  "status": "failed",
  "stepResults": [
    { "id": "sr-1", "stepId": "s1", "status": "passed", "duration": 800 },
    { "id": "sr-2", "stepId": "s2", "status": "passed", "duration": 1200 },
    { "id": "sr-3", "stepId": "s3", "status": "passed", "duration": 1100 },
    {
      "id": "sr-4",
      "stepId": "s4",
      "status": "failed",
      "duration": 2200,
      "evidence": [
        { "id": "ev-2", "type": "screenshot", "path": "/runs/run-login-002/step-4-fail.png" },
        { "id": "ev-3", "type": "domSnapshot", "path": "/runs/run-login-002/step-4-dom.html" }
      ],
      "error": {
        "message": "Text validation failed on elm-104-dashboard-header: expected to contain 'Test', actual 'Welcome, Guest'",
        "type": "validation_failed",
        "validationId": "v2-name"
      }
    }
  ],
  "startedAt": "2026-07-20T12:40:00Z",
  "completedAt": "2026-07-20T12:40:06Z",
  "duration": 5300
}
```

#### Step 6: Historical Stability Check

**Verify:** Both runs remain stable and interpretable after the version update.

| Check | Run 1 (v3) | Run 2 (v4) | Status |
|-------|-----------|-----------|--------|
| `testCaseVersionId` | `tcv-login-v3` | `tcv-login-v4` | ✅ Different versions pinned |
| `testCaseVersionNumber` | 3 | 4 | ✅ Denormalized correctly |
| Step results | 4 steps, all passed | 4 steps, 1 failed (new validation) | ✅ Run 1 is unaffected by v4 changes |
| Environment snapshot | Frozen at run time | Frozen at run time | ✅ Both independent |
| Evidence | Points to run-001 paths | Points to run-002 paths | ✅ No cross-contamination |
| Immutability | Run 1 is terminal (`passed`) — frozen | Run 2 is terminal (`failed`) — frozen | ✅ Neither was modified by the version update |

**The critical test:** Run 1 was created against version 3. Version 3 is immutable — it was NOT modified when version 4 was created. Run 1's `testCaseVersionId` still points to `tcv-login-v3`, which still has exactly the same steps and validations it had when Run 1 executed. Run 1's results are stable and interpretable forever.

**Invariants exercised:**
- **INV-TR1:** Both runs pin to their respective versions ✅
- **INV-TR3:** Both runs are immutable after completion ✅
- **INV-TR5:** Denormalized version numbers match ✅
- **INV-ATCV1:** Version 3 was not modified by the creation of version 4 ✅
- **INV-ATCV2:** Version numbers are monotonic and never reused ✅
- **X4:** Runs reference specific versions ✅

### Walkthrough 3 Findings

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| 3.1 | Version pinning works correctly. Historical runs are immune to test case evolution. | ✅ Confirmed | — |
| 3.2 | The `parentVersionId` chain enables version diffing: v4's `changeSummary` + `parentVersionId: tcv-login-v3` provides the audit trail. | ✅ Confirmed | — |
| 3.3 | Version 4 was created by a manual edit (empty `sourceArtifactIds`, null `aiMetadata`). The schema handles this correctly — sources and AI metadata are optional. | ✅ Confirmed | — |
| 3.4 | The `changeSummary` field is a free-text string. There's no structured diff. For V1, free-text is sufficient. | Minor | `[future]` A structured diff (added/removed/modified step IDs) could be computed from `parentVersionId` comparison. Not needed for V1 — the parent chain exists; the diff computation is a UI concern. |
| 3.5 | When the ATC status goes from `approved` → `draft` (revision), any scheduled runs or CI triggers pointing to this test case would need to handle the non-approved state. | Expected | X9 prevents running non-approved cases. CI/scheduling (deferred) should check status before triggering. The schema enforces this via the status field. |

**Verdict: Walkthrough 3 passes.** Versioning is robust. Historical runs are stable across test case evolution. The parent-version chain provides auditability. Manual edits (no source, no AI metadata) are handled naturally by optional fields.

---

## Summary: Cross-Walkthrough Findings

| ID | Finding | Severity | Affects Schema? |
|----|---------|----------|-----------------|
| F1 | All three walkthroughs complete successfully within the existing schema. No schema changes are required. | ✅ Pass | No |
| F2 | Self-healing (deferred) activates by populating existing `healHistory`, `confidence`, `lastHealedAt` fields. | ✅ Confirmed | No |
| F3 | Natural Language authoring (deferred) activates by populating existing `type: natural_language` Source Artifact. | ✅ Confirmed | No |
| F4 | Element reuse across test cases and across source types works correctly via stable ID references. | ✅ Confirmed | No |
| F5 | Version pinning ensures historical run stability across test case evolution. | ✅ Confirmed | No |
| F6 | The `healHistory.evidenceRef` is a string path, not a typed FK to evidence. Acceptable for V1. | Minor | No |
| F7 | IR regeneration diff (INV-IR5) is computed on-the-fly, not persisted. No schema field needed. | Minor | No |
| F8 | `changeSummary` on ATC Version is free-text. Structured diff deferred to UI layer. | Minor | No |
| F9 | Manual test case edits (no source, no AI metadata) are handled by optional fields. | ✅ Confirmed | No |
| F10 | CI/scheduling (deferred) must check ATC status before triggering runs (X9). | Expected | No |

**Architecture validation result: PASS.**

All three end-to-end scenarios complete within the nine-entity schema. No missing entities, no missing fields, no wrong cardinalities, and no invariant violations were discovered. The deferred capabilities (self-healing, NL authoring, regeneration from source) are proven to activate without schema migrations. The foundation is stable for implementation.
