# Milestone 4 — Click Recording + AI Understanding

## Objective
Capture only left-click actions, send each to the configured AI provider, and display AI understanding in the side panel. No JSON generation.

## Architecture — Data Flow

```
User clicks Start → background creates RecordingSession
User clicks element on page → content script captures click →
  extracts basic element info (text, tag, role) →
  sends CLICK_CAPTURED message to background →
    background generates Action ID, creates ClickEvent →
    persists to storage (side panel renders in timeline) →
    background sends click info to AI provider (Gemini) →
    AI returns: Business Name, UI Control Type, User Intent, Confidence Score →
    background updates ClickEvent with AI understanding →
    storage.onChanged → side panel re-renders with AI understanding
User clicks Stop → recording stops
```

## New Files
- `src/recorder/click-content-script.ts` — content script injected into pages, captures left-click events
- `src/ai/ai-understanding.ts` — builds prompt from click info, sends to AI provider, parses structured response
- `src/recorder/element-info.ts` — extracts basic element info (text, tag, role)
- `tests/ai-understanding.test.ts` — prompt building + response parsing tests
- `tests/click-capture.test.ts` — click capture logic tests

## Modified Files
- `src/shared/types.ts` — add ClickEvent, AIUnderstanding, CLICK_CAPTURED message, update SessionEvent union
- `src/recorder/recording-session.ts` — add addClick() method alongside addNavigation()
- `src/storage/storage-service.ts` — (no changes needed — already handles SessionEvent[])
- `src/background/service-worker.ts` — handle CLICK_CAPTURED message, invoke AI understanding pipeline
- `src/manifest.json` — add content_scripts config (all URLs, click capture script)
- `src/sidepanel/sidepanel.ts` — render click events with AI understanding in timeline
- `src/sidepanel/sidepanel.css` — AI understanding card styles

## Type Definitions

```typescript
interface AIUnderstanding {
  businessName: string;      // e.g., "Login Button"
  controlType: string;       // e.g., "Button", "Link", "Checkbox"
  userIntent: string;        // e.g., "Submit the login form"
  confidenceScore: number;   // 0.0 to 1.0
}

interface ClickEvent {
  actionId: string;          // "click-0001", "click-0002", ...
  type: 'click';
  timestamp: string;         // ISO
  element: {
    text: string;            // visible text or aria-label
    tag: string;             // 'BUTTON', 'A', 'INPUT', etc.
    role: string | null;     // aria-role or implicit role
  };
  aiUnderstanding?: AIUnderstanding;  // populated after AI call
}
```

## AI Prompt Strategy
Send element info to Gemini with a structured prompt requesting JSON output:
```
You are a UI analysis assistant. Analyze this clicked element and return a JSON object.
Element: <tag>, Text: "text", Role: role
Return ONLY valid JSON with keys: businessName, controlType, userIntent, confidenceScore (0.0-1.0)
```

## Acceptance Criteria
- [ ] Only left-click actions are captured (no right-click, no text entry, no hover)
- [ ] Each click gets a unique Action ID (click-0001, click-0002, ...)
- [ ] Basic element info captured: text, tag, role
- [ ] Each click is sent to the AI provider
- [ ] AI returns: Business Name, UI Control Type, User Intent, Confidence Score
- [ ] AI understanding is displayed in the side panel timeline
- [ ] Navigation events still work (from M2)
- [ ] No JSON test step generation (just AI understanding display)
- [ ] Unit tests pass for: AI prompt building, AI response parsing, click capture logic
- [ ] Extension builds, no console errors

## Edge Cases
- Click while not recording → ignored
- AI call fails → click event still recorded, aiUnderstanding shows error state
- Rapid clicks → each gets its own Action ID
- Element with no text → use tag + role for AI prompt
- AI not configured (no API key) → click recorded without AI understanding
