/**
 * Background Service Worker — Phase 1 Deterministic Recorder
 *
 * Responsibilities:
 *   1. Extension lifecycle (side panel action)
 *   2. Message routing: START_RECORDING, STOP_RECORDING, RECORDED_EVENT
 *   3. Navigation capture via webNavigation API
 *   4. Session management (start/stop/persist/restore)
 *
 * Active classification: V1 (rule-based) + V2 (evidence engine) in parallel,
 * with merge layer combining results.
 *
 * Archived (see legacy/ directory):
 *   - Per-type content scripts (click, hover, select, datepicker, etc.)
 *   - Pipeline V2 (boundary detector, state diff, pattern registry, etc.)
 */

import { RecordingSession } from '../recorder/recording-session';
import { StorageService } from '../storage/storage-service';
import { detectInteractions } from '../classifier/interaction-detector';
import { detectInteractionsV2 } from '../classifier/evidence/detector';
import { compareClassifierOutputs, logComparisonResult } from '../classifier/evidence/ab-comparison';
import { mergeV1V2, logMergeMetrics } from '../classifier/evidence/merge-layer';
import { runPipeline } from '../recorder/pipeline/pipeline-runner';
import type { DetectedInteraction } from '../classifier/interaction-types';
import type { UnderstandingResult } from '../domain/entities/understanding-result';
import {
  RecordingState,
  StorageKeys,
  type UIState,
  type AppMessage,
} from '../shared/types';

// ── Singletons ──────────────────────────────────────────────────────────

const session = new RecordingSession();

let sessionRestored = false;

// ── MV3 Recovery: restore session on SW startup ─────────────────────────

async function ensureSessionRestored(): Promise<void> {
  if (sessionRestored) return;
  sessionRestored = true;
  await session.restoreFromStorage();
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
      files: ['src/recorder/deterministic-recorder.ts'],
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
  if (session.isRecording) {
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
    recording: session.isRecording,
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

  // Clear previous session and start fresh
  session.clear();
  session.start(startUrl, startTitle);

  // Record initial navigation (the page recording started on)
  if (startUrl) {
    session.addNavigation(startUrl, startTitle);
  }

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

  session.stop();

  // Produce and persist ReplayJson
  const replayJson = session.toReplayJson();
  await StorageService.setRaw(StorageKeys.REPLAY_JSON, replayJson);

  // Produce and persist DetectedInteractions (existing classifier — production)

  // Sort events by timestamp before classification to ensure correct
  // chronological ordering across frames. With all_frames:true, events
  // from different frames arrive in chrome.runtime.sendMessage delivery
  // order, which may not match timestamp order. The stable sort uses
  // eventId as a tiebreaker for events with identical timestamps.
  const events = session.getEvents();
  events.sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    if (ta !== tb) return ta - tb;
    // Stable tiebreaker: lower eventId sorts first
    return a.eventId.localeCompare(b.eventId);
  });
  const interactions = detectInteractions(events);
  await StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS, interactions);

  // ── Evidence Engine V2 + Merge Layer ──
  // V2 runs in parallel. The merge layer combines V2 (primary) with V1
  // (fallback for events V2 couldn't confidently classify). The merged
  // result is stored separately — V1 DETECTED_INTERACTIONS remains the
  // production source of truth until the UI is switched to read merged.
  let mergedInteractions: DetectedInteraction[] | null = null;
  try {
    const v2Interactions = detectInteractionsV2(events);
    await StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS_V2, v2Interactions);

    // Dev-only: log V1 vs V2 comparison disagreements to console
    const comparison = compareClassifierOutputs(
      interactions as { type: string; eventIds: string[] }[],
      v2Interactions as { type: string; eventIds: string[] }[],
    );
    logComparisonResult(comparison);

    // ── Merge Layer: V2-primary with V1 event-segment fallback ──
    const { interactions: merged, metrics: mergeMetrics } =
      mergeV1V2(v2Interactions, interactions, events.length);
    mergedInteractions = merged;
    await StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS_MERGED, merged);

    // Dev-only: log merge metrics
    logMergeMetrics(mergeMetrics);
  } catch (e) {
    console.warn('[Evidence Engine V2] error during detection:', e);
    // Fallback: if V2 or merge fails, use V1 results so the UI always has data
    await StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS_MERGED, interactions);
  }

  // ── Recognition → Enrichment Pipeline (Phase 6) ──
  // Run the analysis pipeline on the recorded session. This produces:
  //   - Domain entities (UiElement[], ObservedTransition[])
  //   - Component groupings from the recognition orchestrator
  //   - Application Knowledge Fragment from the enrichment orchestrator
  //   - Capability Candidate from the capability deriver
  //   - UnderstandingResult (aggregate of fragment + capability)
  let understandingResult: UnderstandingResult | null = null;
  try {
    const sessionId = `session-${Date.now()}`;
    const tab = await getActiveTab();
    const sourceUrl = tab?.url ?? undefined;
    const pipelineResult = runPipeline(events, mergedInteractions ?? interactions, sessionId, sourceUrl);

    await StorageService.setRaw(StorageKeys.DOMAIN_ENTITIES, {
      elements: pipelineResult.entities.elements,
      transitions: pipelineResult.entities.transitions,
    });
    await StorageService.setRaw(StorageKeys.RECOGNITION_COMPONENTS, pipelineResult.components);
    if (pipelineResult.fragment) {
      await StorageService.setRaw(StorageKeys.KNOWLEDGE_FRAGMENT, pipelineResult.fragment);
    }
    if (pipelineResult.capability) {
      await StorageService.setRaw(StorageKeys.CAPABILITY_CANDIDATE, pipelineResult.capability);
    }

    // Assemble UnderstandingResult (the layer boundary output)
    if (pipelineResult.fragment) {
      understandingResult = {
        sessionId,
        generatedAt: new Date().toISOString(),
        schemaVersion: 1,
        fragment: pipelineResult.fragment,
        capability: pipelineResult.capability,
      };
      await StorageService.setRaw(StorageKeys.UNDERSTANDING_RESULT, understandingResult);
    }
  } catch (e) {
    console.warn('[Pipeline] error during recognition/enrichment:', e);
    // Non-fatal — the existing V1/V2 classification results are already stored
  }

  // ── IR Bridge: Unified Generation Pipeline (Phase 8 + 9.5) ──
  // Build an ExecutionIRPlan from the recording outputs, then render it
  // to Playwright code using the IRCodeGenerator interface.
  // The IR Bridge consumes the UnderstandingResult as its input from the
  // Understanding Layer (fragment + capability as sibling artifacts).
  try {
    const { build: buildIRPlan } = await import('../generation/ir-bridge');
    const { PlaywrightCodeGenerator } = await import('../adapters/playwright/project-generator');

    // Read the UnderstandingResult (or fall back to direct storage for the fragment)
    let understanding = understandingResult;
    if (!understanding) {
      const fragmentResult = await chrome.storage.local.get(StorageKeys.KNOWLEDGE_FRAGMENT);
      const fragment = fragmentResult[StorageKeys.KNOWLEDGE_FRAGMENT] ?? null;
      if (fragment) {
        understanding = {
          sessionId: session.sessionId ?? '',
          generatedAt: new Date().toISOString(),
          schemaVersion: 1,
          fragment,
          capability: null,
        };
      }
    }

    const tab = await getActiveTab();
    const recordingContext = session.getRecordingContext();
    const irPlan = buildIRPlan({
      events,
      interactions: mergedInteractions ?? interactions,
      understanding,
      recordingContext: {
        startUrl: recordingContext?.startUrl ?? tab?.url ?? 'about:blank',
        title: recordingContext?.startTitle ?? tab?.title ?? null,
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
    // Non-fatal — recording still completes, but no test steps/playwright code generated
  }

  // ── Repository V2 Persistence (Phase 10.3) ──
  // Persist the UnderstandingResult, CapabilityCandidate, and ExecutionIRPlan
  // to Repository V2 (Dexie/IndexedDB). This creates a RecordingSession,
  // matches/creates the Capability, and stores the IR artifact.
  //
  // Non-fatal — if persistence fails, recording still completes.
  // The UnderstandingResult and IR plan are already in chrome.storage.local
  // for the side panel to display.
  try {
    const { DexieUnitOfWorkFactory } = await import('../repository/v2/dexie/dexie-unit-of-work-factory');
    const { persistSession } = await import('../repository/services/session-persistence-service');

    // Read back the IR plan that was just stored
    const irPlanResult = await chrome.storage.local.get(StorageKeys.EXECUTION_IR_PLAN);
    const irPlan = irPlanResult[StorageKeys.EXECUTION_IR_PLAN];

    // Read back the test case draft for projectId
    const draft = await StorageService.getTestCaseDraft();

    if (understandingResult && irPlan) {
      const uowFactory = new DexieUnitOfWorkFactory();
      const persistenceResult = await persistSession(uowFactory, {
        understanding: understandingResult,
        events,
        interactions: mergedInteractions ?? interactions,
        url: (await getActiveTab())?.url ?? '',
        irPlan,
        projectId: draft?.projectId ?? null,
        testCaseName: draft?.name ?? 'Recorded Test',
      });

      // Store the persistence result for the UI to reference
      await StorageService.setRaw(StorageKeys.REPOSITORY_SESSION_ID, persistenceResult.sessionId);
      await StorageService.setRaw(StorageKeys.REPOSITORY_CAPABILITY_ID, persistenceResult.capabilityId);
      await StorageService.setRaw(StorageKeys.REPOSITORY_CAPABILITY_DECISION, persistenceResult.capabilityDecision);

      console.info('[Repository V2] Session persisted:', {
        sessionId: persistenceResult.sessionId,
        capabilityId: persistenceResult.capabilityId,
        capabilityDecision: persistenceResult.capabilityDecision,
      });

      // ── Phase 11: Cross-Session Element Healing ──
      // Match fresh UiElements from this recording against stored Elements.
      // Heal stale locators and create new Elements for unmatched ones.
      // Non-fatal — healing failure doesn't affect the recording session.
      try {
        const { adaptToDomainEntities } = await import('../recorder/pipeline/domain-adapter');
        const { healFromRecording } = await import('../repository/services/healing-service');

        const domainEntities = adaptToDomainEntities(events, mergedInteractions ?? interactions, (await getActiveTab())?.url ?? '');
        if (domainEntities.elements.length > 0 && persistenceResult.projectId) {
          const healingResult = await healFromRecording(
            persistenceResult.projectId,
            domainEntities.elements,
            persistenceResult.sessionId,
            uowFactory,
          );

          if (healingResult.healed > 0 || healingResult.created > 0) {
            await StorageService.setRaw(StorageKeys.ELEMENT_HEAL_RESULT, healingResult);
          }

          console.info('[Healing] Result:', healingResult);
        }
      } catch (healErr) {
        console.warn('[Healing] error during cross-session healing:', healErr);
        // Non-fatal
      }
    }
  } catch (e) {
    console.warn('[Repository V2] error during session persistence:', e);
    // Non-fatal — recording completes, artifacts are in chrome.storage.local
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

// ── RECORDED_EVENT handler ──────────────────────────────────────────────

async function handleRecordedEvent(message: Extract<AppMessage, { type: 'RECORDED_EVENT' }>): Promise<void> {
  await ensureSessionRestored();
  if (!session.isRecording) return;

  session.addElementEvent(
    message.eventType,
    message.timestamp,
    message.target,
    message.valueBefore,
    message.valueAfter,
    message.checkedBefore,
    message.checkedAfter,
    message.domContext,
  );
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
  if (!session.isRecording) return;

  // Get the page title (may be empty at commit time)
  let title = '';
  try {
    const tab = await chrome.tabs.get(details.tabId);
    title = tab.title ?? '';
  } catch {}

  // Determine direction: Chrome uses 'forward_back' for both directions,
  // but transitionQualifiers includes 'forward_navigation' for forward.
  let transitionType = details.transitionType;
  if (
    transitionType === 'forward_back' &&
    details.transitionQualifiers?.includes('forward_navigation')
  ) {
    transitionType = 'forward';
  }

  session.addNavigation(details.url, title, transitionType);
});

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
      sendResponse({ type: 'PONG', recording: session.isRecording });
      return true;

    case 'RECORDED_EVENT':
      handleRecordedEvent(msg);
      break;

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
  if (alarm.name === HEALTH_CHECK_ALARM && session.isRecording) {
    checkActiveTabHealth().catch(() => {});
  }
});
