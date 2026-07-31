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
import { detectInteractions } from '../classifier/interaction-detector';
import { runPipeline } from '../recorder/pipeline/pipeline-runner';
import { build as buildIRPlan } from '../generation/ir-bridge';
import { adaptInteractions as adaptToDetected } from '../generation/component-to-classifier-adapter';
import { PlaywrightCodeGenerator } from '../adapters/playwright/project-generator';
import { DexieUnitOfWorkFactory } from '../repository/v2/dexie/dexie-unit-of-work-factory';
import { persistSession } from '../repository/services/session-persistence-service';
import { adaptToDomainEntities } from '../recorder/pipeline/domain-adapter';
import { healFromRecording } from '../repository/services/healing-service';
import { checkStaleness } from '../domain/execution-ir/staleness';
import { IRExecutorImpl } from '../execution/ir-executor-impl';
import { createExecutionRun } from '../domain/entities/execution-run';
import type { DetectedInteraction } from '../classifier/interaction-types';
import type { UnderstandingResult } from '../domain/entities/understanding-result';
import {
  RecordingState,
  StorageKeys,
  type UIState,
  type AppMessage,
} from '../shared/types';
import type { ObservedEvent } from '../shared/component-types';
import { FrameTree } from './frame-tree';
import {
  initRecording,
  stopRecording,
  processObservedEvent,
  getLiveInteractions,
  restoreFromStorage,
  resetState,
  LIVE_INTERACTIONS_KEY,
} from '../runtime/sw-integration';

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
 *
 * The content script filename includes a Vite content hash that changes
 * on every build (e.g. assets/recorder-entry.ts-CP_NOlxs.js). We cannot
 * hardcode the path — we must read it from the manifest at runtime.
 */
async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    // Read ALL content script paths from the manifest (handles Vite hashing).
    // Previously only injected content_scripts[0].js[0], missing the V2
    // control-recorder. Now iterates all entries across all content_scripts.
    const manifest = chrome.runtime.getManifest();
    const allScripts = manifest.content_scripts?.flatMap(cs => cs.js ?? []) ?? [];
    if (allScripts.length === 0) return false;

    for (const script of allScripts) {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: [script],
      });
    }
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

/** Consecutive health check failures before reporting "not responding". */
const HEALTH_MAX_FAILURES = 3;
let consecutiveHealthFailures = 0;

/**
 * Check content script health on the active tab and report status.
 * Called when recording starts and periodically while recording.
 *
 * Debounce: a single transient ping failure does NOT trigger "Tab not
 * responding". Only after HEALTH_MAX_FAILURES consecutive failures.
 */
async function checkActiveTabHealth(): Promise<void> {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  const alive = await ensureContentScriptInjected(tab.id);

  if (alive) {
    consecutiveHealthFailures = 0;
  } else {
    consecutiveHealthFailures++;
  }

  // Only broadcast "not responding" after sustained failures
  if (alive || consecutiveHealthFailures >= HEALTH_MAX_FAILURES) {
    broadcastToPanel({
      type: 'CONTENT_SCRIPT_STATUS',
      tabId: tab.id,
      alive,
      recording: await isRecordingActive(),
      url: tab.url ?? '',
    });
  }
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

  // ── Guard: Block recording on browser-internal pages ──
  // Content scripts cannot execute on chrome://, chrome-extension://, edge://,
  // or about:// pages. Recording would silently fail with no feedback.
  // Surface an actionable error instead of letting the session hang.
  if (
    startUrl.startsWith('chrome://') ||
    startUrl.startsWith('chrome-extension://') ||
    startUrl.startsWith('edge://') ||
    startUrl.startsWith('about:')
  ) {
    console.warn(`[SW] Blocked recording on internal page: ${startUrl}`);
    await chrome.storage.local.set({
      [StorageKeys.UI_STATE]: {
        recordingState: RecordingState.Error,
        lastChanged: new Date().toISOString(),
        errorMessage: `Cannot record on internal page (${startUrl}). Please open a regular web page first.`,
      },
    });
    return;
  }

  recordingStartUrl = startUrl;
  recordingStartTitle = startTitle;

  // Reset Component Runtime for a fresh recording session
  resetState();
  initRecording();

  // Persist recording context (start URL + title) so the side panel
  // can display the current page URL immediately.
  try {
    await chrome.storage.local.set({
      [StorageKeys.SESSION_CONTEXT]: {
        startUrl,
        startTitle,
        capturedAt: new Date().toISOString(),
      },
    });
  } catch { /* non-fatal */ }

  // Ensure content script is injected in the active tab
  // (Critical: if the extension was reloaded, the content script may be
  // missing from already-open tabs.)
  if (tab?.id) {
    await ensureContentScriptInjected(tab.id);

    // ── Phase 2: Build initial frame tree ──
    // The FrameTree provides authoritative frame topology for all iframes
    // in the tab, regardless of origin. Events from iframe content scripts
    // are enriched with this data when they arrive via sender.tab.frameId.
    try {
      await FrameTree.forTab(tab.id).refresh(tab.id);
    } catch {
      // webNavigation may not be available — non-fatal
    }
  }

  // Update UI state (preserve recorderEngine flag for Stage 2 feature flag)
  const prevUiState = await StorageService.getUIState();
  const uiState: UIState = {
    recordingState: RecordingState.Recording,
    lastChanged: new Date().toISOString(),
    recorderEngine: prevUiState.recorderEngine || 'legacy',
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

  // Store interactions for UI display
  await StorageService.setRaw(LIVE_INTERACTIONS_KEY, allInteractions);

  // ── Collect raw ObservedEvents from ComponentInteractions ──
  // The Component Runtime stores triggerEvent + memberEvents on each
  // ComponentInteraction. We extract ALL unique ObservedEvents so the
  // V1 classifier + semantic reasoner can process them.
  const seenEventIds = new Set<string>();
  const observedEvents: ObservedEvent[] = [];
  for (const ci of allInteractions) {
    for (const evt of [ci.triggerEvent, ...ci.memberEvents]) {
      if (evt && !seenEventIds.has(evt.eventId)) {
        seenEventIds.add(evt.eventId);
        observedEvents.push(evt);
      }
    }
  }

  // Sort observed events by timestamp for correct chronological ordering
  observedEvents.sort((a, b) => {
    const ta = typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime();
    const tb = typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime();
    if (ta !== tb) return ta - tb;
    return a.eventId.localeCompare(b.eventId);
  });

  // Convert ObservedEvent[] → RecordedEvent[] for V1 classifier compatibility
  const events: import('./recorder/recorded-event').RecordedEvent[] = observedEvents.map((oe) => {
    if (oe.eventType === 'navigation') {
      return {
        eventId: oe.eventId,
        eventType: 'navigation' as const,
        timestamp: new Date(oe.timestamp).toISOString(),
        url: oe.pageUrl,
        title: oe.pageTitle,
      };
    }
    return {
      eventId: oe.eventId,
      eventType: oe.eventType as any,
      timestamp: new Date(oe.timestamp).toISOString(),
      target: oe.target,
      valueBefore: oe.valueBefore,
      valueAfter: oe.valueAfter,
      checkedBefore: oe.checkedBefore,
      checkedAfter: oe.checkedAfter,
      domContext: oe.domContext as any,
    };
  });

  // ── Unified Classifier Path (replaces V1/V2/Merge/Reasoner) ──
  // The Component Runtime already classified every interaction with the
  // correct lifecycle, subActions, and metadata. Instead of re-classifying
  // the raw events through the V1/V2 detector pipeline, we adapt the
  // ComponentInteractions directly to DetectedInteractions.
  //
  // This eliminates the dual-classification problem where the same events
  // were classified twice through different logic, producing divergent results.
  let mergedInteractions: DetectedInteraction[];

  try {
    mergedInteractions = adaptToDetected(allInteractions);
    console.info('[Component Adapter]', `Adapted ${mergedInteractions.length} interactions from ${allInteractions.length} component interactions`);
  } catch (e) {
    console.warn('[Component Adapter] error during adaptation, falling back to V1 classifier:', e);
    // Fallback: V1 classifier from raw events (safety net)
    mergedInteractions = detectInteractions(events);
  }

  await StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS, mergedInteractions);
  await StorageService.setRaw(StorageKeys.DETECTED_INTERACTIONS_MERGED, mergedInteractions);

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
    const pipelineResult = runPipeline(events, mergedInteractions, sessionId, sourceUrl, 'legacy');

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

    const tab = await getActiveTab();

    const irPlan = buildIRPlan({
      events,
      interactions: mergedInteractions,
      understanding: understandingResult,
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
    const uowFactory = new DexieUnitOfWorkFactory();

    const irPlanResult = await chrome.storage.local.get(StorageKeys.EXECUTION_IR_PLAN);
    const irPlan = irPlanResult[StorageKeys.EXECUTION_IR_PLAN];
    const draft = await StorageService.getTestCaseDraft();

    if (understandingResult && irPlan) {
      const persistenceResult = await persistSession(uowFactory, {
        understanding: understandingResult ?? {
          sessionId: `session-${Date.now()}`,
          generatedAt: new Date().toISOString(),
          schemaVersion: 1,
          fragment: null,
          capability: null,
        },
        events,
        interactions: mergedInteractions,
        url: (await getActiveTab())?.url ?? '',
        irPlan,
        projectId: draft?.projectId ?? null,
        testCaseName: draft?.name ?? 'Recorded Test',
      });

      await StorageService.setRaw(StorageKeys.REPOSITORY_SESSION_ID, persistenceResult.sessionId);
      await StorageService.setRaw(StorageKeys.REPOSITORY_CAPABILITY_ID, persistenceResult.capabilityId);
      await StorageService.setRaw(StorageKeys.REPOSITORY_CAPABILITY_DECISION, persistenceResult.capabilityDecision);

      console.info('[Repository V2] Session persisted:', {
        sessionId: persistenceResult.sessionId,
        capabilityId: persistenceResult.capabilityId,
        capabilityDecision: persistenceResult.capabilityDecision,
      });

      // ── Phase 11: Cross-Session Element Healing ──
      try {
        const domainEntities = adaptToDomainEntities(events, mergedInteractions, (await getActiveTab())?.url ?? '');
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
  }

  // Update UI state (preserve recorderEngine flag)
  const prevUiState = await StorageService.getUIState();
  const uiState: UIState = {
    recordingState: RecordingState.Stopped,
    lastChanged: new Date().toISOString(),
    recorderEngine: prevUiState.recorderEngine || 'legacy',
  };
  await StorageService.setUIState(uiState);

  // Notify all tabs (content scripts listen for STOP_RECORDING to sync state)
  broadcastToTabs({ type: 'STOP_RECORDING' });
}

// ── OBSERVED_EVENT handler (Component Runtime) ──────────────────────────

async function handleObservedEvent(
  payload: ObservedEvent,
  sender?: chrome.runtime.MessageSender,
): Promise<void> {
  await ensureSessionRestored();

  // ── Phase 2: Enrich with Frame Tree context ──
  // The service worker is the only component that can see the complete frame
  // tree across all origins. Use sender.tab.frameId to look up the authoritative
  // frame context and enrich the event's IframeContext.
  if (sender?.tab?.id !== undefined && sender.frameId !== undefined) {
    enrichEventWithFrameTree(payload, sender.tab.id, sender.frameId);
  }

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

/**
 * Enrich an ObservedEvent with authoritative frame tree data from the SW.
 *
 * The content script inside a cross-origin iframe can only provide frameSrc
 * and frameDepth. The SW's FrameTree (built from chrome.webNavigation) knows
 * the complete topology: all ancestor URLs and the true depth.
 *
 * This enrichment replaces the content script's limited single-parent view
 * with the SW's authoritative frame chain — essential for nested iframe codegen.
 */
function enrichEventWithFrameTree(
  event: ObservedEvent,
  tabId: number,
  frameId: number,
): void {
  if (frameId === 0) return; // top frame — no enrichment needed

  const tree = FrameTree.forTab(tabId);
  const node = tree.get(frameId);
  if (!node) return;

  // If the element already has an iframeContext (from the content script),
  // enhance it with the SW's authoritative ancestor data.
  if (event.target.inIframe && event.target.iframeContext) {
    const ctx = event.target.iframeContext;
    ctx.swFrameId = node.frameId;
    ctx.swDepth = node.depth;
    ctx.swAncestorUrls = [...node.ancestorUrls, node.url];
  } else if (event.target.inIframe) {
    // Content script detected iframe but no context was extracted (cross-origin)
    event.target.iframeContext = {
      frameSrc: node.url,
      frameName: null,
      frameId: null,
      frameSelector: null,
      frameXPath: null,
      frameIndex: null,
      frameDepth: node.depth,
      swFrameId: node.frameId,
      swDepth: node.depth,
      swAncestorUrls: [...node.ancestorUrls, node.url],
    };
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

/**
 * Debounced frame tree refresh — coalesces bursts of simultaneous navigations
 * (e.g. SPA loading many iframes at once) into a single getAllFrames call.
 */
const frameTreeRefreshTimers = new Map<number, ReturnType<typeof setTimeout>>();

function scheduleFrameTreeRefresh(tabId: number): void {
  // Clear any pending refresh for this tab
  const existing = frameTreeRefreshTimers.get(tabId);
  if (existing) clearTimeout(existing);
  // Schedule a trailing refresh after 100ms of quiet
  frameTreeRefreshTimers.set(tabId, setTimeout(async () => {
    frameTreeRefreshTimers.delete(tabId);
    try {
      await FrameTree.forTab(tabId).refresh(tabId);
    } catch {
      // Tab may be closed or permission denied
    }
  }, 100));
}

chrome.webNavigation.onCommitted.addListener(async (details) => {
  // ── Phase 2: Refresh the frame tree for ALL navigations ──
  // Previously filtered non-top-frame navigations entirely (frameId !== 0 → return),
  // which left the frame tree stale for iframe navigations. Now we refresh the
  // tree for every navigation (debounced), then only emit synthetic navigation
  // events for the top frame.
  scheduleFrameTreeRefresh(details.tabId);

  // Only emit synthetic navigation events for main frame navigations
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

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
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
      handleObservedEvent(msg.payload, sender);
      sendResponse({ ok: true });
      return true;
    }

    case 'IFRAME_SELECTORS': {
      // Phase 4: Hybrid locator strategy
      // Top-frame content script reports same-origin iframe selectors.
      // The SW merges these into the FrameTree for precise CSS-based
      // frameLocator() codegen (replacing URL-guess fallbacks).
      if (sender.tab?.id !== undefined) {
        const msg = message as {
          type: string;
          payload: import('../background/frame-tree').FrameSelectorEntry[];
        };
        FrameTree.forTab(sender.tab.id).mergeSelectors(msg.payload);
      }
      break;
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

// ── Tab lifecycle: clean up per-tab resources ───────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  FrameTree.clearTab(tabId);
  const timer = frameTreeRefreshTimers.get(tabId);
  if (timer) {
    clearTimeout(timer);
    frameTreeRefreshTimers.delete(tabId);
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
