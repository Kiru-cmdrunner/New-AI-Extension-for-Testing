# e9063df Extension Runtime Flow — Complete Analysis

## Three Browser Contexts

1. **Page/Content-Script context** — has DOM access, no Chrome extension APIs
2. **MV3 Service Worker** — has Chrome APIs (tabs, storage, sidePanel, scripting, webNavigation), NO DOM access
3. **Side Panel** — has Chrome runtime APIs + its own DOM (the panel's own HTML), NO page DOM access

## Content Script Context
- `src/recorder/phase5/recorder-entry.ts` — injected declaratively in manifest
- `src/recorder/v2/control-recorder.ts` — also injected but NEVER ACTIVATED (recorderEngine always 'legacy')
- EventTap creates capture-phase DOM listeners on `document` for 18 event types
- Captures: ElementIdentity (18 fields) + DomContext (30+ fields) + value/checked
- Has post-click value polling (50/150/400ms) — but ONLY for input values, NOT attributes/mutations/surfaces
- Sends events via `chrome.runtime.sendMessage({type: 'OBSERVED_EVENT', payload})`
- Buffers in sessionStorage for MV3 resilience, retries with exponential backoff

## Service Worker Context
- `src/background/service-worker.ts` (1037 lines) — the orchestration hub
- NO DOM access — receives serializable ObservedEvent objects only
- `processObservedEvent()` runs Component Runtime classification IN THE SW
- Runtime is singleton in sw-integration.ts — activeStack, seenEventIds, dedupByType all in SW memory
- On STOP: flush runtime → adapt → runPipeline (domain adapter → recognition → enrichment → capability) → buildIRPlan → PlaywrightCodeGenerator → persist → heal
- ALL classification + pipeline runs in SW, not content script

## Side Panel Context
- `src/sidepanel/sidepanel.ts` — UI views (home → new-tc → recording → stopped)
- Sends START_RECORDING / STOP_RECORDING to SW
- Receives INTERACTION_CAPTURED messages live during recording
- On STOP: reads DETECTED_INTERACTIONS_MERGED, REPLAY_JSON, EXECUTION_IR_PLAN, GENERATED_FILES from chrome.storage.local
- Renders timeline, detected interactions, IR steps, Playwright code

## Message Flow
Side Panel → SW: START_RECORDING, STOP_RECORDING, RUN_TEST
SW → Content Script: START_RECORDING, STOP_RECORDING (broadcastToTabs)
Content Script → SW: OBSERVED_EVENT (one per DOM event), IFRAME_SELECTORS
SW → Side Panel: INTERACTION_CAPTURED, EXECUTION_RESULT

## DOM Access Map
- EventTap (content script): FULL DOM access — capture-phase listeners, identity extraction, context extraction
- IdentityExtractor (content script): FULL DOM — 7-strategy value, 5-strategy checked state, getImplicitRole
- Component Runtime (SW): NO DOM — works purely from serialized ObservedEvent objects
- Enrichment (SW): NO DOM — component-detector uses only ElementIdentity fields
- Domain Adapter (SW): NO DOM — NoOp DomInspector
- IR Bridge (SW): NO DOM — works from ComponentInteraction metadata

## The Critical MV3 Constraint
Classification runs in the SW (no DOM). But the SW receives ObservedEvents that were captured
at a SINGLE MOMENT in time (the capture-phase click). By the time the SW classifies the event,
the page's DOM may have already changed (the page handler ran after capture).

This means: post-interaction behavioural observation MUST happen in the content script
(which has DOM access), because only the content script can re-examine the DOM after the
page handler runs. The SW can't do this — it has no DOM.

The existing post-click value polling proves the team already understood this for input values.
The gap: no equivalent for attributes, checked-state, surface emergence, or mutations.
