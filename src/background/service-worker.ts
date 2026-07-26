/**
 * Background Service Worker — Component Runtime Architecture
 *
 * Responsibilities:
 *   1. Extension lifecycle (side panel action)
 *   2. Message routing: START_RECORDING, STOP_RECORDING, OBSERVED_EVENT
 *   3. Navigation capture via webNavigation API
 *   4. Session management via Component Runtime
 *
 * Active classification: Component Runtime with lifecycle-based definitions.
 * Events from the content script are processed through the Component Runtime
 * engine which produces ComponentInteractions. These are filtered and mapped
 * to IR actions by the presentation layer, then passed to the generation
 * pipeline (IR Bridge → Playwright code generator → Repository V2).
 *
 * Architecture: .drytis/specs/m0a-architecture-validation.md
 */

import { StorageService } from '../storage/storage-service';
import type { UnderstandingResult } from '../domain/entities/understanding-result';
import {
  RecordingState,
  StorageKeys,
  type UIState,
  type AppMessage,
} from '../shared/types';
import type { ObservedEvent, ComponentInteraction } from '../shared/component-types';
import {
  initRecording,
  stopRecording,
  processObservedEvent,
  getLiveInteractions,
  restoreFromStorage,
  resetState,
  LIVE_INTERACTIONS_KEY,
} from '../runtime/sw-integration';
import {
  filterProductionInteractions,
  toIRActions,
} from '../presentation/output-adapter';

// ── Singletons ──────────────────────────────────────────────────────────

let sessionRestored = false;
let recordingStartUrl = '';
let recordingStartTitle = '';

// ── MV3 Recovery: restore session on SW startup ─────────────────────────

async function ensureSessionRestored(): Promise<void> {
  if (sessionRestored) return;
  sessionRestored = true;
  await restoreFromStorage();
}

ensureSessionRestored();

// ── Content Script Health Check & Injection ─────────────────────────────

/**
 * Ping a tab's content script to check if it's alive and recording-capable.
 * Returns true if the content script responded with a PONG.
 *
 * This detects orphaned scripts from extension reload/update: an orphaned
 * script's chrome.runtime connection is dead, so sendMessage throws.
 */
async function pingTabContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return !!(response && response.type === 'PONG');
  } catch {
    return false;
  }
}

/**
 * Programmatically inject the content script into a tab.
 * Used when the declarative content script is missing (e.g., the tab was
 * already open when the extension was reloaded/updated).
 */
async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['src/recorder/phase5/recorder-entry.ts'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the content script is alive and recording-ready in the active tab.
 *
 * 1. Pings the tab — if no response, the script is missing/orphaned.
 * 2. Injects the script programmatically.
 * 3. Re-syncs recording state (START_RECORDING message).
 *
 * Returns true if the content script is confirmed alive after this call.
 */
async function ensureContentScriptInjected(tabId: number): Promise<boolean> {
  // Quick check — is it already alive?
  if (await pingTabContentScript(tabId)) {
    return true;
  }

  // Not alive — inject programmatically
  const injected = await injectContentScript(tabId);
  if (!injected) {
    return false;
  }

  // Give it a moment to initialize
  await new Promise((r) => setTimeout(r, 100));

  // Re-sync recording state if currently recording
  if (await isRecordingActive()) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
    } catch { /* ignore */ }
  }

  // Verify it's now alive
  return pingTabContentScript(tabId);
}

/**
 * Check content script health on the active tab and report status.
 * Called when recording starts and periodically while recording.
 */
async function checkActiveTabHealth(): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  const alive = await ensureContentScriptInjected(tab.id);

  // Broadcast status to the side panel
  broadcastToPanel({
    type: 'CONTENT_SCRIPT_STATUS',
    tabId: tab.id,
    alive,
    recording: await isRecordingActive(),
    url: tab.url ?? '',
  });
}

// ── Tab helpers ─────────────────────────────────────────────────────────

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  } catch {
    return null;
  }
}

// ── Lifecycle: Start / Stop Recording ───────────────────────────────────

async function handleStartRecording(): Promise<void> {
  await ensureSessionRestored();

  const tab = await getActiveTab();
  const startUrl = tab?.url ?? '';
  const startTitle = tab?.title ?? '';
  recordingStartUrl = startUrl;
  recordingStartTitle = startTitle;

  // Reset Component Runtime for a fresh recording session
  resetState();
  initRecording();

  // Ensure content script is injected in the active tab
  // (Critical: if the extension was reloaded, the content script may be
  // missing from already-open tabs.)
  if (tab?.id) {
    await ensureContentScriptInjected(tab.id);
  }

  // Update UI state
  const uiState: UIState = {
    recordingState: RecordingState.Recording,
    lastChanged: new Date().toISOString(),
  };
  await StorageService.setUIState(uiState);

  // Notify all tabs (content scripts listen for START_RECORDING to sync state)
  broadcastToTabs({ type: 'START_RECORDING' });

  // Report content script health to side panel
  await checkActiveTabHealth();
}

async function handleStopRecording(): Promise<void> {
  await ensureSessionRestored();

  // Flush runtime and get all interactions
  const allInteractions = stopRecording();

  // Filter to production interactions
  const productionInteractions = filterProductionInteractions(allInteractions);

  // Store interactions for UI display
  await StorageService.setRaw(LIVE_INTERACTIONS_KEY, allInteractions);

  // Map to IR actions for the generation pipeline
  const irActions = toIRActions(allInteractions);

  // Build a synthetic events array from interactions (for IR Bridge compatibility)
  // The IR Bridge currently expects Phase 1 DetectedInteraction[] — we adapt.
  const events: any[] = [];
  const interactionsForIR: any[] = productionInteractions.map((ci, i) => ({
    id: ci.interactionId,
    type: irActions[i]?.type ?? 'click',
    target: ci.trigger,
    value: irActions[i]?.value,
    metadata: ci.metadata,
    timestamp: new Date(ci.startTime).toISOString(),
    eventIds: ci.memberEvents.map((e) => e.eventId),
  }));

  await StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS, interactionsForIR);
  await StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS_MERGED, interactionsForIR);

  // ── IR Bridge: Unified Generation Pipeline ──
  let understandingResult: UnderstandingResult | null = null;
  try {
    const { build: buildIRPlan } = await import('../generation/ir-bridge');
    const { PlaywrightCodeGenerator } = await import('../adapters/playwright/project-generator');

    const tab = await getActiveTab();

    const irPlan = buildIRPlan({
      events,
      interactions: interactionsForIR,
      understanding: null,
      recordingContext: {
        startUrl: recordingStartUrl || tab?.url || 'about:blank',
        title: recordingStartTitle || tab?.title || null,
      },
      testCaseName: (await StorageService.getTestCaseDraft())?.name ?? 'Recorded Test',
    });

    await StorageService.setRaw(StorageKeys.EXECUTION_IR_PLAN, irPlan);

    // Render the plan to Playwright code files
    const codeGen = new PlaywrightCodeGenerator();
    const result = await codeGen.generate(irPlan, {
      language: 'typescript',
      pattern: 'flat',
      assertions: 'expect',
    });
    await StorageService.setRaw(StorageKeys.GENERATED_FILES, result);
  } catch (e) {
    console.warn('[IR Bridge] error during unified generation:', e);
  }

  // ── Repository V2 Persistence ──
  try {
    const { DexieUnitOfWorkFactory } = await import('../repository/v2/dexie/dexie-unit-of-work-factory');
    const { persistSession } = await import('../repository/services/session-persistence-service');

    const irPlanResult = await chrome.storage.local.get(StorageKeys.EXECUTION_IR_PLAN);
    const irPlan = irPlanResult[StorageKeys.EXECUTION_IR_PLAN];
    const draft = await StorageService.getTestCaseDraft();

    if (irPlan) {
      const uowFactory = new DexieUnitOfWorkFactory();
      const persistenceResult = await persistSession(uowFactory, {
        understanding: understandingResult ?? {
          sessionId: `session-${Date.now()}`,
          generatedAt: new Date().toISOString(),
          schemaVersion: 1,
          fragment: null,
          capability: null,
        },
        events,
        interactions: interactionsForIR,
        url: (await getActiveTab())?.url ?? '',
        irPlan,
        projectId: draft?.projectId ?? null,
        testCaseName: draft?.name ?? 'Recorded Test',
      });

      await StorageService.setRaw(StorageKeys.REPOSITORY_SESSION_ID, persistenceResult.sessionId);
      await StorageService.setRaw(StorageKeys.REPOSITORY_CAPABILITY_ID, persistenceResult.capabilityId);
      await StorageService.setRaw(StorageKeys.REPOSITORY_CAPABILITY_DECISION, persistenceResult.capabilityDecision);
    }
  } catch (e) {
    console.warn('[Repository V2] error during session persistence:', e);
  }

  // Update UI state
  const uiState: UIState = {
    recordingState: RecordingState.Stopped,
    lastChanged: new Date().toISOString(),
  };
  await StorageService.setUIState(uiState);

  // Notify all tabs (content scripts listen for STOP_RECORDING to sync state)
  broadcastToTabs({ type: 'STOP_RECORDING' });
}

// ── OBSERVED_EVENT handler (Component Runtime) ──────────────────────────

async function handleObservedEvent(payload: ObservedEvent): Promise<void> {
  await ensureSessionRestored();

  // Process through the Component Runtime
  const emitted = processObservedEvent(payload);

  // Broadcast new interactions to the side panel for live display
  for (const interaction of emitted) {
    chrome.runtime.sendMessage({
      type: 'INTERACTION_CAPTURED',
      interaction,
    }).catch(() => {
      // Side panel may not be open — ignore
    });
  }
}

// ── RUN_TEST handler (Phase 12.5) ──────────────────────────────────────

/**
 * Execute the most recently generated ExecutionIRPlan.
 *
 * Flow:
 *   1. Read EXECUTION_IR_PLAN from chrome.storage.local
 *   2. Create IRExecutorImpl with Chrome API bindings
 *   3. Execute the plan against a live browser tab
 *   4. Persist the result as an ExecutionRun to Repository V2
 *   5. Store the result in chrome.storage.local for the side panel
 *   6. Broadcast EXECUTION_RESULT message to the side panel
 *
 * Non-fatal — if any step fails, an error EXECUTION_RESULT is broadcast.
 */
async function handleRunTest(): Promise<void> {
  const startTime = performance.now();

  // 1. Read the IR plan from storage
  const irPlanResult = await chrome.storage.local.get(StorageKeys.EXECUTION_IR_PLAN);
  const irPlan = irPlanResult[StorageKeys.EXECUTION_IR_PLAN];

  if (!irPlan) {
    broadcastExecutionResult('error', 0, 0, 0, 0);
    return;
  }

  // 1b. Pre-execution staleness check
  // If Repository Elements have been updated since the IR was generated
  // (e.g., via cross-session healing), the cached IR is stale and should
  // be regenerated. For now, we log the staleness report and proceed —
  // full regeneration requires the IR Bridge which needs the original
  // recording events. The staleness check ensures we're aware of drift.
  let irWasStale = false;
  try {
    const { checkStaleness } = await import('../domain/execution-ir/staleness');
    const { DexieUnitOfWorkFactory } = await import('../repository/v2/dexie/dexie-unit-of-work-factory');

    const uowFactory = new DexieUnitOfWorkFactory();
    const uow = await uowFactory.create();

    // Collect all element IDs referenced by the IR plan
    const elementIds = new Set<string>();
    for (const step of irPlan.steps) {
      if (step.target.kind === 'element') {
        elementIds.add(step.target.elementId);
      }
    }

    // Load referenced elements from the Repository
    const referencedElements: import('../domain/entities/element').Element[] = [];
    for (const elementId of elementIds) {
      const el = await uow.elements.getById(elementId);
      if (el) referencedElements.push(el);
    }

    // Build a minimal artifact-like object for staleness check
    // (The IR plan in storage doesn't have generatedAt, so we use
    // a synthetic timestamp from the plan's steps or the storage time)
    const irGeneratedAt = irPlanResult[StorageKeys.EXECUTION_IR_PLAN + '_generated_at'] as string
      ?? new Date(0).toISOString(); // epoch if unknown

    const stalenessReport = checkStaleness(
      { id: 'cached', testCaseVersionId: irPlan.testCaseVersionId, plan: irPlan, generatedAt: irGeneratedAt, generatorVersion: 'ir-bridge-1.0', renderings: {} } as import('../domain/execution-ir/types').ExecutionIRArtifact,
      referencedElements,
      'ir-bridge-1.0',
    );

    if (stalenessReport.status === 'stale') {
      irWasStale = true;
      console.warn('[Execution] IR is stale:', stalenessReport.reasons);
      // In a full implementation, we would regenerate the IR here via the IR Bridge.
      // For now, proceed with the stale IR — the runtime healing in the executor
      // will compensate by healing locators during execution.
    }

    await uow.rollback?.();
  } catch (stalenessErr) {
    // Non-fatal — staleness check is an optimization, not a requirement
    console.warn('[Execution] Staleness check failed:', stalenessErr);
  }

  // 2. Create executor and execute the plan
  const { IRExecutorImpl } = await import('../execution/ir-executor-impl');
  const executor = new IRExecutorImpl();

  // Track healed elements via a counter (the override map is internal to the executor)
  let healedCount = 0;
  const healedElementIds: string[] = [];
  const result = await executor.execute(irPlan, {
    onStepComplete: (step, stepResult) => {
      // Track healed elements for post-execution invalidation
      if (step.target.kind === 'element' && stepResult.status === 'passed') {
        // The executor's healing is internal — we detect healed elements
        // by checking if the step that initially failed now passes
      }
    },
  });

  // 2b. Post-execution: If healing occurred during execution, the Repository
  // Elements now have updated locators with bumped updatedAt. The cached IR
  // plan in chrome.storage.local is now stale. We mark it as stale so the
  // next run knows to regenerate (or at least re-check staleness).
  // For now, we store a _generated_at timestamp alongside the IR plan so
  // the pre-execution staleness check can detect drift on subsequent runs.
  if (irWasStale) {
    // Update the stored timestamp so the staleness check on next run
    // compares against the latest Repository Element updates
    try {
      await chrome.storage.local.set({
        [StorageKeys.EXECUTION_IR_PLAN + '_generated_at']: new Date().toISOString(),
      });
    } catch {
      // Non-fatal
    }
  }

  // 3. Persist the result as an ExecutionRun to Repository V2
  let executionRunId: string | null = null;
  try {
    const { createExecutionRun } = await import('../domain/entities/execution-run');
    const { DexieUnitOfWorkFactory } = await import('../repository/v2/dexie/dexie-unit-of-work-factory');

    const draft = await StorageService.getTestCaseDraft();
    const run = createExecutionRun({
      testCaseId: irPlan.testCaseId,
      testCaseVersionId: irPlan.testCaseVersionId,
      projectId: draft?.projectId ?? 'default',
      result,
      environment: {
        baseUrl: irPlan.environment.baseUrl,
        browser: irPlan.environment.browser,
        viewport: irPlan.environment.viewport,
      },
      healedElementIds: [],
    });

    const uowFactory = new DexieUnitOfWorkFactory();
    const uow = await uowFactory.create();
    await uow.executionRuns.save(run);
    await uow.commit();
    executionRunId = run.id;

    console.info('[Execution] ExecutionRun persisted:', executionRunId);
  } catch (e) {
    console.warn('[Execution] Failed to persist ExecutionRun:', e);
    // Non-fatal — the result is still in memory and can be stored in chrome.storage
  }

  // 4. Store the result in chrome.storage.local for the side panel
  const executionSummary = {
    status: result.status,
    stepCount: result.stepResults.length,
    passedSteps: result.stepResults.filter((s: { status: string }) => s.status === 'passed').length,
    failedSteps: result.stepResults.filter((s: { status: string }) => s.status === 'failed').length,
    errorSteps: result.stepResults.filter((s: { status: string }) => s.status === 'error').length,
    skippedSteps: result.stepResults.filter((s: { status: string }) => s.status === 'skipped').length,
    durationMs: result.durationMs,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    stepResults: result.stepResults,
    executionRunId,
  };

  await StorageService.setRaw(StorageKeys.EXECUTION_RESULT, executionSummary);

  // 5. Broadcast result to the side panel
  const durationMs = performance.now() - startTime;
  broadcastExecutionResult(
    result.status,
    result.stepResults.length,
    result.stepResults.filter((s: { status: string }) => s.status === 'passed').length,
    durationMs,
    healedCount,
  );
}

/**
 * Broadcast an EXECUTION_RESULT message to the side panel.
 */
function broadcastExecutionResult(
  status: 'passed' | 'failed' | 'error',
  stepCount: number,
  passedSteps: number,
  durationMs: number,
  healedElements: number,
): void {
  const message: AppMessage = {
    type: 'EXECUTION_RESULT',
    status,
    stepCount,
    passedSteps,
    durationMs,
    healedElements,
  };
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open — ignore
  });
}

// ── Navigation capture ──────────────────────────────────────────────────

chrome.webNavigation.onCommitted.addListener(async (details) => {
  // Only capture main frame navigations
  if (details.frameId !== 0) return;

  await ensureSessionRestored();

  // Check if recording is active by checking if we have a runtime
  const liveInts = getLiveInteractions();
  if (liveInts.length === 0 && !await isRecordingActive()) return;

  // Get the page title (may be empty at commit time)
  let title = '';
  try {
    const tab = await chrome.tabs.get(details.tabId);
    title = tab.title ?? '';
  } catch {}

  // Create a navigation ObservedEvent and process it
  const navEvent: ObservedEvent = {
    eventId: `nav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: 'navigation' as any,
    timestamp: Date.now(),
    isTrusted: true,
    target: {
      accessibleName: '',
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'HTML',
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: 'html',
      xPath: '/html',
      inIframe: false,
      shadowDom: false,
      elementId: '',
    },
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: [],
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: details.url,
    pageTitle: title,
  };

  processObservedEvent(navEvent);
});

/**
 * Check if recording is currently active.
 */
async function isRecordingActive(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get('cmdrunner_recording_active');
    return result['cmdrunner_recording_active'] === true;
  } catch {
    return false;
  }
}

// ── Message routing ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  const msg = message as AppMessage;

  switch (msg.type) {
    case 'START_RECORDING':
      handleStartRecording();
      break;

    case 'STOP_RECORDING':
      handleStopRecording();
      break;

    case 'OPEN_SETTINGS':
      chrome.runtime.openOptionsPage();
      break;

    case 'OPEN_REPOSITORY': {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/repository/index.html') });
      break;
    }

    case 'RUN_TEST': {
      handleRunTest().catch((e) => {
        console.warn('[Execution] error:', e);
        chrome.runtime.sendMessage({
          type: 'EXECUTION_RESULT',
          status: 'error',
          stepCount: 0,
          passedSteps: 0,
          durationMs: 0,
          healedElements: 0,
        }).catch(() => {});
      });
      break;
    }

    case 'PING':
      // Side panel pinging the service worker — respond with recording state
      isRecordingActive().then((recording) => {
        sendResponse({ type: 'PONG', recording });
      });
      return true;

    case 'OBSERVED_EVENT': {
      const msg = message as { type: string; payload: ObservedEvent };
      handleObservedEvent(msg.payload);
      sendResponse({ ok: true });
      return true;
    }

    default:
      // Unknown message type — ignore
      break;
  }

  return false; // synchronous response
});

// ── Broadcast helper ────────────────────────────────────────────────────

async function broadcastToTabs(message: { type: string }): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Content script may not be injected on this tab — ignore
        });
      }
    }
  } catch {
    // Tabs API may not be available — ignore
  }
}

/**
 * Broadcast a message to the side panel (if open).
 * The side panel receives CONTENT_SCRIPT_STATUS messages to update its
 * health indicator.
 */
function broadcastToPanel(message: AppMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel may not be open — ignore
  });
}

// ── Side Panel action ───────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Set the side panel to open when the extension icon is clicked
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// ── Periodic content script health check during recording ───────────────

/**
 * Periodically check that the active tab's content script is alive while
 * recording. Uses chrome.alarms (MV3-compatible — survives SW restarts).
 *
 * Every ~5 seconds while recording:
 *   1. Pings the active tab's content script
 *   2. If no response, programmatically injects it
 *   3. Broadcasts health status to the side panel
 */
const HEALTH_CHECK_ALARM = 'cs-health-check';

chrome.alarms.create(HEALTH_CHECK_ALARM, { periodInMinutes: 0.08 }); // ~5s

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEALTH_CHECK_ALARM) {
    isRecordingActive().then((active) => {
      if (active) checkActiveTabHealth().catch(() => {});
    });
  }
});
