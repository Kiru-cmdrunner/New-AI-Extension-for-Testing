# Milestone 6 — Step Builder and JSON Mapping for Click

## Objective
Generate the first complete Plain English test step from each click action and attach the execution JSON directly to that step. Validates the end-to-end flow from recording → AI understanding → executable step.

## Architecture — Data Flow

```
User clicks element → content script captures full element identity →
  background assigns Action ID + Element ID →
  AI understands the click (Business Name, Intent, Confidence) →
  Step Builder generates:
    1. Plain English description
    2. Execution JSON (action type, selectors, element identity)
    3. Step ID
  Step appears immediately in side panel timeline →
  Stop Recording → Review Mode (read-only steps with full detail)
```

## Step Structure

```typescript
interface TestStep {
  stepId: string;             // "step-0001"
  plainEnglish: string;       // "Click the 'Login' button"
  actionId: string;           // "click-0001" (from recording session)
  elementId: string;          // "elem-0001"
  executionJson: ExecutionJson; // machine-readable execution payload
  aiConfidence: number;       // 0.0–1.0 from AI understanding
  timestamp: string;          // ISO timestamp
}

interface ExecutionJson {
  action: 'click';            // action type
  actionId: string;           // linked Action ID
  elementId: string;          // linked Element ID
  // Primary locator strategy (best available)
  primaryLocator: {
    type: 'css' | 'xpath' | 'testId' | 'id' | 'ariaLabel';
    value: string;
  };
  // Fallback locators
  fallbackLocators: Array<{
    type: 'css' | 'xpath' | 'testId' | 'id' | 'ariaLabel' | 'name' | 'text';
    value: string;
  }>;
  // Element metadata
  tag: string;
  accessibleName: string;
  ariaRole: string | null;
}
```

## New Files
- `src/recorder/step-builder.ts` — generates plain English + execution JSON from a ClickEvent
- `src/recorder/step-id-generator.ts` — generates step-0001, step-0002...
- `tests/step-builder.test.ts` — unit tests for step generation, JSON mapping, locator strategy

## Modified Files
- `src/shared/types.ts` — add TestStep, ExecutionJson, StorageKeys.STEPS
- `src/recorder/recording-session.ts` — store steps, expose getSteps/setSteps
- `src/background/service-worker.ts` — after AI understanding completes, call step builder, persist step
- `src/sidepanel/sidepanel.ts` — render steps in timeline, review mode after Stop
- `src/sidepanel/sidepanel.css` — step card styles, review mode styling
- `src/manifest.json` — bump to 1.5.0

## Acceptance Criteria
- [ ] Every click generates exactly one readable test step
- [ ] Every test step contains its execution JSON
- [ ] Action ID and Element ID remain linked to the step
- [ ] Plain English step uses AI understanding (Business Name + Intent)
- [ ] Execution JSON has primary locator (best available strategy) + fallbacks
- [ ] AI Confidence is attached to the step
- [ ] Generated step appears immediately in side panel
- [ ] Review mode shows steps read-only after Stop Recording
- [ ] Output is structured and ready for future CmdRunner execution
- [ ] Unit tests pass
- [ ] Extension builds, no console errors

## Edge Cases
- AI understanding fails → step still generates with "Unknown" business name, confidence 0
- Element with no test-id → falls back to id, then aria-label, then CSS selector
- Element inside iframe → execution JSON includes locator type appropriate for iframe context

## Out of Scope
- Text entry, hover, dropdown, checkbox/radio recording
- CmdRunner upload / execution engine
- Test step editing or reordering
