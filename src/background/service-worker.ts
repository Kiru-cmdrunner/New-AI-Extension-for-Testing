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
import {
  RecordingState,
  StorageKeys,
  type UIState,
  type AppMessage,
} from '../shared/types';
import type { ObservedEvent } from '../shared/component-types';
import {
  initRecording,
  stopRecording,
  processObservedEvent,
  getLiveInteractions,
  restoreFromStorage,
  resetState,
  storePendingEvidence,
  attachEvidenceToInteraction,
  persistLiveInteractions,
} from '../runtime/sw-integration';
import {
  filterProductionInteractions,
} from '../presentation/output-adapter';
import { normalizeWorkflow } from '../presentation/workflow-normalizer';
import {
  startNetworkObservation,
  stopNetworkObservation,
  setLastTrustedAction,
  consumeMainFrameCorrelation,
  snapshotInFlightForTab,
  getNetworkEvidenceForNavigation,
  getAttributionLedger,
} from '../background/network-observation';
import type { NavigationEvidence, NetworkActivity } from '../shared/behavioral-evidence-types';

// ── Singletons ──────────────────────────────────────────────────────────

let sessionRestored = false;
let recordingStartUrl = '';
let recordingStartTitle = '';

// M9.12: Prior-knowledge seed loaded at startRecording, passed to
// the understanding pipeline at stopRecording.  Null = preload failed
// or first session on this app.
let understandingSeed: import('../understanding/consolidation/application-knowledge').StateBuilderSeed | null = null;

// ── MV3 Recovery: restore session on SW startup ─────────────────────────

async function ensureSessionRestored(): Promise<void> {
  if (sessionRestored) return;
  sessionRestored = true;
  await restoreFromStorage();

  // ── Boot reconciliation (form-submit recovery, event-driven) ──
  // Rehydrate the durable attribution ledger and attach any stamped
  // requests whose owning interactions now exist. Covers crash-point B
  // (stored, never attached) and crash-point A cleanup (attached, not
  // acked). Unresolved entries stay durable — retried on the next
  // BEHAVIORAL_EVIDENCE / onCommitted / STOP event.
  try {
    const { getLiveInteractions, persistLiveInteractions } =
      await import('../runtime/sw-integration');
    const live = getLiveInteractions();
    const ledger = getAttributionLedger();
    const result = await ledger.rehydrate(live);
    if (result.attached.length > 0) {
      persistLiveInteractions(); // persist BEFORE ack (delete-after-persist)
      console.info(
        `[AttributionLedger] boot reconciliation attached ${result.attached.length} request(s)`,
      );
    }
    if (result.unresolved.length > 0) {
      console.info(
        `[AttributionLedger] ${result.unresolved.length} stored request(s) awaiting owning interaction`,
      );
    }
  } catch (e) {
    console.warn('[AttributionLedger] boot reconciliation failed:', (e as Error).message);
  }
}

ensureSessionRestored();

// ── Content Script Health Check & Injection ─────────────────────────────

/**
 * Ping result returned by pingTabContentScript.
 */
interface PingResult {
  /** Content script is injected and responding. */
  alive: boolean;
  /** Content script's local recording flag. False if not recording or not alive. */
  recording: boolean;
}

/**
 * Ping a tab's content script to check if it's alive AND recording.
 *
 * Returns both the alive flag (script injected and responding) and the
 * recording flag (EventTap installed and listening). A tab can be alive
 * but not recording — this happens when navigation clears sessionStorage,
 * preventing auto-resume of recording state.
 *
 * The caller (ensureContentScriptInjected) uses the recording flag to
 * decide whether a START_RECORDING re-sync is needed.
 */
async function pingTabContentScript(tabId: number): Promise<PingResult> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (response && response.type === 'PONG') {
      return { alive: true, recording: !!response.recording };
    }
    return { alive: false, recording: false };
  } catch {
    return { alive: false, recording: false };
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
    // Read the content script path from the manifest (handles Vite hashing)
    const manifest = chrome.runtime.getManifest();
    const csEntry = manifest.content_scripts?.[0]?.js?.[0];
    if (!csEntry) return false;

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [csEntry],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the content script is alive AND recording in the active tab.
 *
 * Three scenarios:
 * 1. Alive and recording → done.
 * 2. Alive but NOT recording → re-sync by sending START_RECORDING.
 *    This is the primary fix for intermittent click loss: navigation to a
 *    new page can clear sessionStorage, preventing auto-resume. The content
 *    script is injected and responds to PING, but the EventTap is never
 *    installed. Without this re-sync, all clicks on that page are silently
 *    lost.
 * 3. Not alive → inject programmatically, then re-sync recording state.
 *
 * Returns true if the content script is confirmed alive after this call.
 */
async function ensureContentScriptInjected(tabId: number): Promise<boolean> {
  const ping = await pingTabContentScript(tabId);

  // Scenario 1: alive and recording → healthy
  if (ping.alive && ping.recording) {
    return true;
  }

  // Scenario 2: alive but NOT recording → re-sync without re-injecting
  if (ping.alive && !ping.recording) {
    if (await isRecordingActive()) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
      } catch { /* ignore — will retry on next health check */ }
    }
    return true;
  }

  // Scenario 3: not alive — inject programmatically
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
  const rePing = await pingTabContentScript(tabId);
  return rePing.alive;
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
  recordingStartUrl = startUrl;
  recordingStartTitle = startTitle;

  // Reset Component Runtime for a fresh recording session
  resetState();
  initRecording();

  // Session-end cleanup for the durable attribution ledger (INV session
  // scoping): stale entries from a prior session never join this session's
  // interactions.
  await getAttributionLedger().clearAll().catch(() => {});

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

  // M9.12: Preload prior application knowledge for this origin so the
  // understanding pipeline can recognize cross-session entities/views.
  // Non-fatal — a preload failure never blocks recording start.
  understandingSeed = null;
  try {
    if (startUrl) {
      const { preloadPriorKnowledge } = await import('../understanding/pipeline/understanding-pipeline');
      understandingSeed = await preloadPriorKnowledge(startUrl);
    }
  } catch (e) {
    console.warn('[M9] prior-knowledge preload failed:', e);
    understandingSeed = null;
  }

  // Ensure content script is injected in the active tab
  // (Critical: if the extension was reloaded, the content script may be
  // missing from already-open tabs.)
  if (tab?.id) {
    await ensureContentScriptInjected(tab.id);

    // M6: Start network observation (webRequest + MAIN-world injection).
    // webRequest listeners are registered IMMEDIATELY for race coverage,
    // then MAIN-world injection follows. Both run in parallel.
    startNetworkObservation(tab.id);
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

  // Normalize: remove Unclassified interactions subsumed by recognized
  // interactions on the same element (e.g., mousedown→click gesture pairs).
  // This is a view filter — subsumed interactions remain in liveInteractions
  // and the Evidence Ledger. M4 verification already ran on raw output.
  const normalizedInteractions = normalizeWorkflow(allInteractions);

  // Filter to production interactions — removes incidental Hovers, Scrolls,
  // abandoned/discarded interactions, and no-op selections.
  const productionInteractions = filterProductionInteractions(normalizedInteractions);

  // Store production interactions for UI display
  await StorageService.setRaw(StorageKeys.LIVE_INTERACTIONS, productionInteractions);

  // ── RACE FIX: stop-recording network evidence drain ──
  // Second recovery pass for requests whose evidence delivery was
  // destroyed by a full-page reload and whose commit-time consumer missed
  // them (onBeforeRequest → onCompleted → onCommitted ordering race).
  // Joins ring entries to interactions by exact sourceEventId BEFORE the
  // understanding pipeline consumes them. Exactly-once: requestIds already
  // captured directly are skipped; telemetry/noise filtered here too.
  try {
    const { getCompletedBySourceEventId } = await import('./network-observation');
    const { drainNetworkEvidence } = await import('./network-drain');
    const stamped: import('./network-drain').DrainEntry[] = [];
    for (const i of productionInteractions) {
      const evId = i.behavioralEvidence?.sourceEventId;
      if (!evId) continue;
      for (const r of getCompletedBySourceEventId(evId)) {
        stamped.push({
          url: r.url,
          method: r.method,
          status: r.status,
          requestId: r.requestId,
          sourceEventId: r.sourceEventId,
          requestBody: r.requestBody,
          documentRequest: r.documentRequest,
        });
      }
    }
    const { updatedInteractions, mergedRequestIds } =
      drainNetworkEvidence(productionInteractions, stamped);
    if (mergedRequestIds.length > 0) {
      console.info(
        `[NetworkDrain] recovered ${mergedRequestIds.length} request(s) onto ` +
        `${updatedInteractions.length} interaction(s) by sourceEventId`,
      );
      await StorageService.setRaw(StorageKeys.LIVE_INTERACTIONS, productionInteractions);
    }

    // ── Durable ledger drain (form-submit recovery, T11–T16 path) ──
    // Third pass: entries the ring lost (TTL/capacity) or that only exist
    // in the durable store (captured pre-completion / SW restart survivors).
    // Identity join, synthesize-on-missing — exactly-once via ownership.
    const ledger = getAttributionLedger();
    const attachedCount = ledger.attachToInteractions(productionInteractions);
    if (attachedCount > 0) {
      console.info(
        `[AttributionLedger] stop drain attached ${attachedCount} request(s)`,
      );
      await StorageService.setRaw(StorageKeys.LIVE_INTERACTIONS, productionInteractions);
    }
    // Session-end cleanup (INV session scoping): the ledger never outlives
    // its recording session.
    await ledger.clearAll().catch(() => {});
  } catch (e) {
    // Non-fatal — pipeline runs on whatever evidence already exists
    console.warn('[NetworkDrain] drain failed:', (e as Error).message);
  }

  // ── M9.12: Application Understanding Pipeline ──
  // Runs the full deterministic understanding chain (M9.1→M9.7) over
  // the session's interactions.  Non-fatal: if M9 throws, recording
  // still completes with a minimal understanding stub.
  let understandingResult: import('../domain/entities/understanding-result').UnderstandingResult = {
    sessionId: `session-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };

  try {
    if (productionInteractions.length > 0) {
      const { runUnderstandingPipeline } = await import('../understanding/pipeline/understanding-pipeline');
      const { serializeStateTransitions } = await import('../understanding/state-builder/serialize');
      const origin = recordingStartUrl || (await getActiveTab())?.url || '';
      const sessionId = `session-${Date.now()}`;

      const pipelineOutcome = await runUnderstandingPipeline({
        interactions: productionInteractions,
        origin,
        sessionId,
        seed: understandingSeed,
      });

      understandingResult = {
        sessionId,
        generatedAt: new Date().toISOString(),
        schemaVersion: 2,
        semanticKnowledge: pipelineOutcome.semanticKnowledge ?? undefined,
        applicationKnowledge: pipelineOutcome.applicationKnowledge ?? undefined,
        knowledgeWarnings: pipelineOutcome.warnings.length > 0 ? pipelineOutcome.warnings : undefined,
        // D12: carry pipeline artifacts that were previously dropped.
        // Serialize transitions to JSON-safe form (Maps → Records) so
        // chrome.storage, side-panel, export, and API consumers all work.
        outcomes: [...pipelineOutcome.outcomes.values()],
        transitions: serializeStateTransitions(pipelineOutcome.transitions),
        appId: pipelineOutcome.appId,
      };

      // Store for side-panel display (best-effort)
      await StorageService.setRaw(StorageKeys.UNDERSTANDING_RESULT, understandingResult);
    }
  } catch (e) {
    console.warn('[M9] understanding pipeline failed:', e);
  } finally {
    understandingSeed = null; // clear for next session
  }

  // ── Generation Layer: compile interactions → ExecutionIRPlan ──
  try {
    const { build: buildIRPlan } = await import('../generation/ir-bridge');
    const { PlaywrightCodeGenerator } = await import('../adapters/playwright/project-generator');

    const tab = await getActiveTab();

    const irPlan = buildIRPlan({
      interactions: productionInteractions,
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
        understanding: understandingResult,
        events: [],
        interactions: productionInteractions,
        url: (await getActiveTab())?.url ?? '',
        irPlan,
        projectId: draft?.projectId ?? null,
        testCaseName: draft?.name ?? 'Recorded Test',
      });

      await StorageService.setRaw(StorageKeys.REPOSITORY_SESSION_ID, persistenceResult.sessionId);

      // M8.2: Persist behavioral evidence to the dedicated table.
      // Runs after persistSession returns sessionId. Non-fatal — wrapped in
      // the outer try/catch. Idempotent via windowId primary key (put).
      //
      // M8.5: Use dedup guard to skip evidence already persisted in this
      // recording cycle (e.g., from SW restart recovery re-persist).
      try {
        const {
          persistBehavioralEvidence,
        } = await import('../repository/services/session-persistence-service');
        const {
          filterUnpersistedEvidence,
          markEvidencePersisted,
        } = await import('../runtime/sw-integration');

        const unpersisted = filterUnpersistedEvidence(productionInteractions);
        if (unpersisted.length > 0) {
          await persistBehavioralEvidence(
            uowFactory,
            persistenceResult.sessionId,
            unpersisted,
          );
          markEvidencePersisted(
            unpersisted
              .filter((i) => i.behavioralEvidence)
              .map((i) => i.behavioralEvidence!.windowId),
          );
        }
      } catch (evErr) {
        console.warn('[Repository V2] error during evidence persistence:', evErr);
      }
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

  // M6: Stop network observation (webRequest listeners removed).
  // MAIN-world restoration is handled by the content script's NetworkBridge.
  const stopTab = await getActiveTab();
  if (stopTab?.id) {
    stopNetworkObservation(stopTab.id);
  }
}

// ── OBSERVED_EVENT handler (Component Runtime) ──────────────────────────

async function handleObservedEvent(payload: ObservedEvent): Promise<void> {
  await ensureSessionRestored();

  // CER-2: track the last trusted user action per tab. Network requests
  // that start while this action is current are stamped with its eventId —
  // the exact-event join for click→request attribution (replaces the
  // 10s timestamp window).
  if (payload.isTrusted && payload.eventType !== 'navigation') {
    const actionTab = await getActiveTab().catch(() => null);
    if (actionTab?.id != null) {
      setLastTrustedAction(actionTab.id, {
        eventId: payload.eventId,
        // interactionId unknown at this point; the eventId is the join key
        // (interactions carry triggerEvent.eventId / memberEvents[].eventId).
        interactionId: '',
      });
    }
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

// ── BEHAVIORAL_EVIDENCE handler (M7-fix-001 — Correlation Contract) ───

/**
 * Handle incoming BehavioralEvidence from the content script.
 *
 * Two-tier matching using existing triggerEvent.eventId:
 *   Tier 1: interaction.triggerEvent.eventId === sourceEventId (preferred)
 *   Tier 2: interaction.memberEvents[].eventId === sourceEventId (fallback)
 *
 * If matched: attaches evidence to interaction.behavioralEvidence,
 * re-persists liveInteractions, and broadcasts INTERACTION_EVIDENCE_UPDATE
 * with the real interactionId.
 *
 * If unmatched: stores in pendingEvidence for later drain on onEmit.
 *
 * Architecture: .drytis/notes/event-interaction-evidence-correlation-contract.md
 */
function handleBehavioralEvidence(
  evidence: import('../shared/behavioral-evidence-types').BehavioralEvidence,
): void {
  // Try to match to a live interaction
  const interactionId = attachEvidenceToInteraction(
    evidence.sourceEventId,
    evidence,
  );

  if (interactionId) {
    // Match found — broadcast update with interactionId
    chrome.runtime.sendMessage({
      type: 'INTERACTION_EVIDENCE_UPDATE',
      payload: { interactionId, evidence },
    }).catch(() => {
      // Side panel may not be open — ignore
    });
  } else {
    // No match — store for later drain when interaction is emitted
    storePendingEvidence(evidence);
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
    const uow = uowFactory.create();

    // Collect all element IDs referenced by the IR plan
    const elementIds = new Set<string>();
    for (const step of irPlan.steps) {
      if (step.target.kind === 'element') {
        elementIds.add(step.target.elementId);
      }
    }

    // Load referenced elements from the Repository within a transaction
    const referencedElements: import('../domain/entities/element').Element[] = [];
    if (elementIds.size > 0) {
      const elements = await uow.execute(async (repos) => {
        const result: import('../domain/entities/element').Element[] = [];
        for (const elementId of elementIds) {
          const el = await repos.elements.getById(elementId);
          if (el) result.push(el);
        }
        return result;
      });
      referencedElements.push(...elements);
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
  } catch (stalenessErr) {
    // Non-fatal — staleness check is an optimization, not a requirement
    console.warn('[Execution] Staleness check failed:', stalenessErr);
  }

  // 2. Create executor and execute the plan
  const { IRExecutorImpl } = await import('../execution/ir-executor-impl');
  const executor = new IRExecutorImpl();

  // Track healed elements via a counter (the override map is internal to the executor)
  let healedCount = 0;
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
    const uow = uowFactory.create();
    await uow.execute(async (repos) => {
      await repos.executionRuns.save(run);
    });
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
 * DDC-2: Last committed main-frame URL per tab. Written on every
 * webNavigation.onCommitted BEFORE synthetic evidence is created, so
 * synthetic navigation evidence can carry a real `fromUrl` (the PREVIOUS
 * committed URL) instead of ''. Without it, the view-transition graph has
 * no edges for full-page-reload apps (traditional form submits).
 * Memory-bounded: MAX_TRACKED_TABS entries, shift-evict.
 */
const lastCommittedUrls = new Map<number, string>();
const MAX_TRACKED_TABS = 50;

chrome.webNavigation.onCommitted.addListener(async (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
  // Only capture main frame navigations
  if (details.frameId !== 0) return;

  await ensureSessionRestored();

  // Check if recording is active by checking if we have a runtime
  const liveInts = getLiveInteractions();
  if (liveInts.length === 0 && !await isRecordingActive()) return;

  // DDC-2: capture the PREVIOUS committed URL for this tab before
  // overwriting the map — this is the synthetic nav's fromUrl.
  const previousCommittedUrl = lastCommittedUrls.get(details.tabId) ?? '';

  // Update the per-tab committed-URL map (bounded)
  lastCommittedUrls.set(details.tabId, details.url);
  if (lastCommittedUrls.size > MAX_TRACKED_TABS) {
    const oldestKey = lastCommittedUrls.keys().next().value;
    if (oldestKey !== undefined) lastCommittedUrls.delete(oldestKey);
  }

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
    captureSeq: performance.now(),
    isTrusted: true,
    target: {
      accessibleName: details.url,
      ariaRole: 'document',
      ariaLabel: `Navigation to ${details.url}`,
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
      href: details.url,
      inputType: null,
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
      tabIndex: null,
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

  // P1-3 Fix: For full-page reloads, the content script is destroyed
  // before the EvidenceCollector can close its window and deliver evidence.
  // The SW should create synthetic navigation evidence so the interaction
  // card shows navigation details instead of "Collecting…" forever.
  //
  // transitionType 'reload', 'auto_subframe', 'form_submit' indicate the
  // page is being replaced — content script destroyed.
  const fullReloadTypes = ['reload', 'form_submit', 'auto_toplevel', 'auto_subframe', 'link', 'typed'];
  if (fullReloadTypes.includes(details.transitionType)) {
    // CER-2: Tag in-flight requests from the destroyed document with this
    // navEvent — lifecycle membership (started, not finished), not timestamps.
    snapshotInFlightForTab(details.tabId, navEvent.eventId);

    // CER-2: attach evidence IMMEDIATELY (event-driven) — the interaction
    // may not be emitted yet, but pendingEvidence drain (sw-integration)
    // attaches by sourceEventId when it arrives. The old 200ms timer raced
    // the document download and is removed. Exact-ID recovery happens at
    // stop-recording time via getNetworkEvidenceForNavigation(navEventId),
    // which reads the ring buffer THEN (by then onCompleted has fired) —
    // so late completions are not lost.
    attachSyntheticNavEvidence(navEvent.eventId, details, previousCommittedUrl);
  }
});

/**
 * CER-2: Recover network evidence for a synthetic navigation by EXACT ID.
 *
 * Replaces the timing-based design (onCommitted+200ms + 10s lookback),
 * which could never see the main-frame POST: ring entries were written at
 * onCompleted — strictly after onCommitted — and the ring entry's URL was
 * the post-redirect final URL.
 *
 * New flow:
 *  - At onBeforeRequest, main-frame POSTs are registered per-tab with their
 *    ORIGINAL url/method/body (pendingMainFrame).
 *  - At onCommitted, all in-flight requests from the destroyed document are
 *    tagged with the navEventId (lifecycle membership, no timestamps).
 *  - Here (called from attachSyntheticNavEvidence, which the SW calls at
 *    stop-recording and at commit for display), we join by navEventId and
 *    by the pending main-frame POST — IDs only, no time math.
 *
 * Document-request handling: the navigation request itself is EXCLUDED
 * unless it is a POST with a request body (form-submit POST-is-navigation,
 * e.g. Amazon Add to Cart) — the exact case we must recover.
 */
function recoverNetworkForNavigationById(
  navEventId: string,
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): NetworkActivity[] {
  try {
    // Exact-ID evidence: ring entries + in-flight entries tagged with this navEvent
    const byId = getNetworkEvidenceForNavigation(navEventId);

    // RACE FIX: CONSUME the pending main-frame record here — onCommitted is
    // the single owner allowed to delete it. If onCompleted already fired
    // (losing race order: onBeforeRequest → onCompleted → onCommitted), the
    // record survives with completionStatus stamped; otherwise it carries
    // undefined (= still in flight at commit → honest status null).
    const pendingDoc = consumeMainFrameCorrelation(details.tabId);

    const activities: NetworkActivity[] = [];
    const seenRequestIds = new Set<string>();

    // 1. The form-submit POST itself (Amazon case) — authoritative record.
    if (pendingDoc && pendingDoc.method !== 'GET' && pendingDoc.requestBody) {
      seenRequestIds.add(pendingDoc.requestId);
      activities.push({
        url: pendingDoc.originalUrl,
        method: pendingDoc.method,
        // RACE FIX: use the stamped completion status when the race was
        // lost (onCompleted arrived first). undefined = still in flight.
        status: pendingDoc.completionStatus ?? null,
        startRelativeToEvent: 0,
        endRelativeToEvent: null,
        durationMs: null,
        resourceType: 'unknown',
        source: 'webrequest',
        requestBody: pendingDoc.requestBody,
        // CER-4: exact-event join key for pipeline attribution
        sourceEventId: pendingDoc.sourceEventId ?? undefined,
      });
    }

    // 2. ID-tagged entries (in-flight at commit or completed since).
    for (const req of byId) {
      if (seenRequestIds.has(req.requestId)) continue;
      seenRequestIds.add(req.requestId);

      // Document request without a body = plain GET navigation — the
      // navigation evidence already records it. Skip (no double-count).
      if (req.documentRequest && !req.requestBody) continue;

      // Skip static resources and analytics — they add noise and can
      // fabricate outcome votes for attributed clicks.
      if (/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf)(\?|$)/i.test(req.url)) continue;
      if (/\/unagi|\/events\/|\/beacon|\/pixel|\/csm|\/aax2|\/impression|fls-|\/1\/batch\/|uedata/i.test(req.url)) continue;

      // status -1 = still in flight → null (honest unknown)
      const status = req.status === -1 ? null : req.status;

      activities.push({
        url: req.url,
        method: req.method,
        status,
        startRelativeToEvent: 0,
        endRelativeToEvent: null,
        durationMs: null,
        resourceType: 'unknown',
        source: 'webrequest',
        requestBody: req.requestBody,
        sourceEventId: req.sourceEventId ?? undefined,
      });
    }

    // Cap at 20 to avoid flooding synthetic evidence
    return activities.slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Create and attach synthetic navigation evidence for full-page-reload
 * navigations where the content script is destroyed before evidence delivery.
 *
 * P1-3 Fix: This ensures navigation interactions always show evidence with
 * the actual URL and navigation type, rather than staying in "Collecting…"
 * state forever.
 */
function attachSyntheticNavEvidence(navEventId: string, details: chrome.webNavigation.WebNavigationTransitionCallbackDetails, previousCommittedUrl: string = ''): void {
  // ── Commit-time causal routing (INV-5, form-submit recovery) ──
  // Entries recovered for this navigation that carry a trusted-action stamp
  // belong to the CLICK that caused the navigation — route them to that
  // interaction via the durable attribution ledger (identity join,
  // synthesize-on-missing), not to the synthetic nav. Only unstamped /
  // unresolved entries remain for the synthetic nav's own network evidence.
  const recovered = recoverNetworkForNavigationById(navEventId, details);
  const routedToClick: NetworkActivity[] = [];
  const forSyntheticNav: NetworkActivity[] = [];
  {
    // getLiveInteractions / persistLiveInteractions are imported at top of
    // file from ../runtime/sw-integration (ESM — no require).
    const live = getLiveInteractions();
    const ledger = getAttributionLedger();
    for (const activity of recovered) {
      const stamped = activity.sourceEventId;
      if (!stamped) {
        forSyntheticNav.push(activity);
        continue;
      }
      // Feed the stamp to the ledger (idempotent — already durable at
      // capture; this only enriches status/url if completion data is newer).
      ledger.attachStampedActivity({
        url: activity.url,
        method: activity.method,
        status: activity.status ?? 0,
        requestId: (activity as NetworkActivity & { requestId?: string }).requestId
          ?? `${activity.method}:${activity.url}:${stamped}`,
        sourceEventId: stamped,
        requestBody: activity.requestBody,
        documentRequest: true,
        mainFrame: activity.resourceType === 'navigation' || activity.method !== 'GET',
      }, live).then((routed) => {
        if (routed) persistLiveInteractions(); // persist BEFORE ack
      });
      routedToClick.push(activity);
    }
  }

  // Map webNavigation transitionType to NavigationEvidence.type
  const navTypeMap: Record<string, NavigationEvidence['type']> = {
    'link': 'full-reload',
    'typed': 'full-reload',
    'reload': 'full-reload',
    'form_submit': 'full-reload',
    'auto_toplevel': 'full-reload',
    'auto_subframe': 'full-reload',
  };
  const navType: NavigationEvidence['type'] = navTypeMap[details.transitionType] ?? 'full-reload';

  const navEvidenceEntry: NavigationEvidence = {
    type: navType,
    // DDC-2: real previous committed URL (was '' — broke the view graph)
    fromUrl: previousCommittedUrl,
    toUrl: details.url,
    relativeTime: 0,
    batchIndex: null,
  };

  const interactionId = attachEvidenceToInteraction(navEventId, {
    sourceEventId: navEventId,
    sourceEventType: 'navigation',
    windowId: `synthetic-nav-${navEventId}`,
    frameId: 'main',
    window: {
      openedAt: 0,
      closedAt: 0,
      durationMs: 0,
      endReason: 'page-reload-synthetic',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: {
        accessibleName: details.url,
        ariaRole: 'document',
        ariaLabel: `Navigation to ${details.url}`,
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
        href: details.url,
        inputType: null,
        elementId: '',
      },
      identityCapturedAt: performance.now(),
      before: null,
      after: null,
      focusMovement: null,
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [navEvidenceEntry],
      // INV-5: only unstamped/unresolved entries — stamped form-submit POSTs
      // were routed to their causal owner above; the nav records the link
      // via causedByInteractionId (stamped by the ledger on attach).
      networkActivity: forSyntheticNav,
      performanceCondition: {
        mainThreadBlocked: false,
        highChurnMode: false,
        longestBatchMs: 0,
        totalBatches: 0,
      },
    },
  });

  if (interactionId) {
    // Successfully attached — broadcast the evidence update
    const evidence = getLiveInteractions().find(i => i.interactionId === interactionId)?.behavioralEvidence;
    if (evidence) {
      chrome.runtime.sendMessage({
        type: 'INTERACTION_EVIDENCE_UPDATE',
        payload: { interactionId, evidence },
      }).catch(() => {});
    }
  }
  // If no match (interaction not yet emitted), the evidence will be stored
  // in pendingEvidence and drained when the interaction is emitted.
  // The 5s timeout is still the fallback.
}

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

    case 'BEHAVIORAL_EVIDENCE': {
      const msg = message as { type: string; payload: import('../shared/behavioral-evidence-types').BehavioralEvidence };
      handleBehavioralEvidence(msg.payload);
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
