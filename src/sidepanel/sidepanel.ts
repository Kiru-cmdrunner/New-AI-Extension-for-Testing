/**
 * Side Panel — CmdRunner Smart Recorder (Phase 2 Interaction Detection)
 *
 * Views: home → new-tc → recording → stopped
 *
 * Phase 2 additions:
 *   - Detected interactions view with type badges + metadata
 *
 * D5: removed dead sections with no data writers — Raw Event Timeline,
 * Capability Analysis (residue of the capability-model removal), Element
 * Healing (no writer; service kept in healing-service.ts awaiting D3),
 * and Replay JSON (no writer since Phase 1).
 */

import {
  RecordingState, StorageKeys,
  type RecordingContext,
  type TestCaseDraft, TestCaseState,
  type Project,
} from '../shared/types';
import { StorageService } from '../storage/storage-service';
import { sendMessage } from '../shared/messaging';
import { RepositoryService } from '../repository/repository-service';
import { renderProductionInteractions, buildHiddenSummary } from './interaction-renderer';
import { attachKrChips, setKrLookup, joinSignatures } from './kr-chip';
import type { KrLookup } from './kr-chip';
import { setAssertionPlan } from './assertion-chip';
import { updateEvidenceOnInteraction } from './evidence-renderer';
import { renderUnderstandingCard } from './understanding-card';
import type { GapLike, ForwardSigLike } from './understanding-card';
import type { UnderstandingResult } from '../domain/entities/understanding-result';
import type { ComponentInteraction } from '../shared/component-types';
import type { BehavioralEvidence } from '../shared/behavioral-evidence-types';
import type { ExecutionIRPlan, IRAssertion } from '../domain/execution-ir/types';
import type { GeneratedFile } from '../domain/execution-ir/adapters/ir-code-generator';

// ── View Management ────────────────────────────────────────

type ViewName = 'home' | 'new-tc' | 'recording' | 'stopped';

const views: Record<ViewName, HTMLElement> = {
  'home': document.getElementById('home-view')!,
  'new-tc': document.getElementById('new-tc-view')!,
  'recording': document.getElementById('recording-view')!,
  'stopped': document.getElementById('stopped-view')!,
};

function showView(name: ViewName): void {
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
  }
}

// ── DOM References ─────────────────────────────────────────

// Home
const newTcBtn = document.getElementById('new-tc-btn')!;
const browseRepoBtn = document.getElementById('browse-repo-btn')!;

// New TC form
const tcProjectSelect = document.getElementById('tc-project') as HTMLSelectElement;
const tcFeatureSelect = document.getElementById('tc-feature') as HTMLSelectElement;
const tcScenarioSelect = document.getElementById('tc-scenario') as HTMLSelectElement;
const tcNameInput = document.getElementById('tc-name') as HTMLInputElement;
const tcExpectedInput = document.getElementById('tc-expected') as HTMLTextAreaElement;
const tcStartRecordingBtn = document.getElementById('tc-start-recording-btn') as HTMLButtonElement;
const tcCancelBtn = document.getElementById('tc-cancel-btn') as HTMLButtonElement;
const tcFormError = document.getElementById('tc-form-error')!;

// Inline create
const tcProjectCreate = document.getElementById('tc-project-create')!;
const tcProjectNewName = document.getElementById('tc-project-new-name') as HTMLInputElement;
const tcProjectCreateBtn = document.getElementById('tc-project-create-btn')!;
const tcProjectCancelBtn = document.getElementById('tc-project-cancel-btn')!;
const tcFeatureCreate = document.getElementById('tc-feature-create')!;
const tcFeatureNewName = document.getElementById('tc-feature-new-name') as HTMLInputElement;
const tcFeatureCreateBtn = document.getElementById('tc-feature-create-btn')!;
const tcFeatureCancelBtn = document.getElementById('tc-feature-cancel-btn')!;
const tcScenarioCreate = document.getElementById('tc-scenario-create')!;
const tcScenarioNewName = document.getElementById('tc-scenario-new-name') as HTMLInputElement;
const tcScenarioCreateBtn = document.getElementById('tc-scenario-create-btn')!;
const tcScenarioCancelBtn = document.getElementById('tc-scenario-cancel-btn')!;
const tcFeatureHint = document.getElementById('tc-feature-hint')!;
const tcScenarioHint = document.getElementById('tc-scenario-hint')!;

// Recording view
const stopBtn = document.getElementById('stop-btn')!;
const recordingContextSection = document.getElementById('recording-context')!;
const recordingContextUrl = document.getElementById('recording-context-url') as HTMLAnchorElement;
const tcBadgeRecording = document.getElementById('tc-badge-recording')!;
const tcBadgeName = document.getElementById('tc-badge-name')!;
const timelineEvents = document.getElementById('recording-interactions-list')!;
const timelineCount = document.getElementById('recording-interactions-count')!;
const csStatus = document.getElementById('cs-status')!;
const csStatusText = document.getElementById('cs-status-text')!;

// Stopped view
const tcBadgeStopped = document.getElementById('tc-badge-stopped')!;
const tcBadgeNameStopped = document.getElementById('tc-badge-name-stopped')!;
const stoppedRecordingContext = document.getElementById('stopped-recording-context')!;
const stoppedRecordingContextUrl = document.getElementById('stopped-recording-context-url') as HTMLAnchorElement;
const detectedInteractionsSection = document.getElementById('detected-interactions-section')!;
const detectedInteractionsList = document.getElementById('detected-interactions-list')!;
const detectedInteractionsCount = document.getElementById('detected-interactions-count')!;
const hiddenToggleRow = document.getElementById('hidden-interactions-toggle') as HTMLButtonElement;
const recordAnotherBtn = document.getElementById('record-another-btn')!;

// IR Plan sections (Phase 8)
const irStepsSection = document.getElementById('ir-steps-section')!;
const irStepsList = document.getElementById('ir-steps-list')!;
const irStepsCount = document.getElementById('ir-steps-count')!;
const irPlaywrightSection = document.getElementById('ir-playwright-section')!;
const irFilesList = document.getElementById('ir-files-list')!;
const irFilesCount = document.getElementById('ir-files-count')!;

// Repository status section (Phase 10.4)
const repoStatusSection = document.getElementById('repo-status-section')!;
const repoStatusBody = document.getElementById('repo-status-body')!;

// Session Understanding section (MS-U3)
const understandingSection = document.getElementById('understanding-section')!;
const understandingBody = document.getElementById('understanding-body')!;

// Execution section (Phase 12.6)
const executionSection = document.getElementById('execution-section')!;
const executionBody = document.getElementById('execution-body')!;
const runTestBtn = document.getElementById('run-test-btn') as HTMLButtonElement;
const executionRunningSection = document.getElementById('execution-running-section')!;

// Header
const settingsBtn = document.getElementById('settings-btn')!;
const repoBtn = document.getElementById('repo-btn')!;

// ── State ──────────────────────────────────────────────────

let currentProjects: Project[] = [];

const NEW_OPTION = '__new__';

// ── Repository Dropdown Population ─────────────────────────

function populateProjectDropdown(): void {
  tcProjectSelect.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a project...';
  tcProjectSelect.appendChild(placeholder);
  for (const p of currentProjects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    tcProjectSelect.appendChild(opt);
  }
  const newOpt = document.createElement('option');
  newOpt.value = NEW_OPTION;
  newOpt.textContent = '+ Create New Project';
  tcProjectSelect.appendChild(newOpt);
}

function populateFeatureDropdown(projectId: string): void {
  tcFeatureSelect.innerHTML = '';
  tcFeatureSelect.disabled = true;
  tcFeatureHint.textContent = 'Select a project first';
  if (!projectId) return;
  const project = currentProjects.find((p) => p.id === projectId);
  if (!project || project.features.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No features yet';
    tcFeatureSelect.appendChild(opt);
    const newOpt = document.createElement('option');
    newOpt.value = NEW_OPTION;
    newOpt.textContent = '+ Create New Feature';
    tcFeatureSelect.appendChild(newOpt);
    tcFeatureSelect.disabled = false;
    tcFeatureHint.textContent = '';
    return;
  }
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a feature...';
  tcFeatureSelect.appendChild(placeholder);
  for (const f of project.features) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    tcFeatureSelect.appendChild(opt);
  }
  const newOpt = document.createElement('option');
  newOpt.value = NEW_OPTION;
  newOpt.textContent = '+ Create New Feature';
  tcFeatureSelect.appendChild(newOpt);
  tcFeatureSelect.disabled = false;
  tcFeatureHint.textContent = '';
}

function populateScenarioDropdown(projectId: string, featureId: string): void {
  tcScenarioSelect.innerHTML = '';
  tcScenarioSelect.disabled = true;
  tcScenarioHint.textContent = 'Select a feature first';
  if (!projectId || !featureId) return;
  const project = currentProjects.find((p) => p.id === projectId);
  if (!project) return;
  const feature = project.features.find((f) => f.id === featureId);
  if (!feature || feature.scenarios.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No scenarios yet';
    tcScenarioSelect.appendChild(opt);
    const newOpt = document.createElement('option');
    newOpt.value = NEW_OPTION;
    newOpt.textContent = '+ Create New Scenario';
    tcScenarioSelect.appendChild(newOpt);
    tcScenarioSelect.disabled = false;
    tcScenarioHint.textContent = '';
    return;
  }
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a scenario...';
  tcScenarioSelect.appendChild(placeholder);
  for (const s of feature.scenarios) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    tcScenarioSelect.appendChild(opt);
  }
  const newOpt = document.createElement('option');
  newOpt.value = NEW_OPTION;
  newOpt.textContent = '+ Create New Scenario';
  tcScenarioSelect.appendChild(newOpt);
  tcScenarioSelect.disabled = false;
  tcScenarioHint.textContent = '';
}

// ── Inline Create ──────────────────────────────────────────

function showInlineCreate(container: HTMLElement, input: HTMLInputElement): void {
  container.hidden = false;
  input.value = '';
  input.focus();
}

function hideInlineCreate(container: HTMLElement): void {
  container.hidden = true;
}

// ── Validation ─────────────────────────────────────────────

function validateForm(): boolean {
  const hasProject = tcProjectSelect.value !== '' && tcProjectSelect.value !== NEW_OPTION;
  const hasFeature = tcFeatureSelect.value !== '' && tcFeatureSelect.value !== NEW_OPTION;
  const hasScenario = tcScenarioSelect.value !== '' && tcScenarioSelect.value !== NEW_OPTION;
  const hasName = tcNameInput.value.trim().length > 0;
  return hasProject && hasFeature && hasScenario && hasName;
}

function updateStartButton(): void {
  tcStartRecordingBtn.disabled = !validateForm();
  tcFormError.hidden = true;
}

function showFormError(message: string): void {
  tcFormError.textContent = message;
  tcFormError.hidden = false;
}

// ── Content Script Health ──────────────────────────────────

function updateCsStatus(state: 'checking' | 'connected' | 'error'): void {
  const states = {
    checking: { text: 'Checking tab connection...', cls: 'cs-status--checking' },
    connected: { text: '✓ Connected — events will be captured', cls: 'cs-status--connected' },
    error: { text: '⚠ Tab not responding — try refreshing the page', cls: 'cs-status--error' },
  };
  const s = states[state];
  csStatusText.textContent = s.text;
  csStatus.className = `cs-status ${s.cls}`;
}

// Listen for content script status updates from the service worker
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (message && typeof message === 'object') {
    const msg = message as { type: string; [key: string]: unknown };

    if (msg.type === 'CONTENT_SCRIPT_STATUS') {
      const csMsg = msg as { type: 'CONTENT_SCRIPT_STATUS'; alive: boolean; recording: boolean; url: string };
      if (csMsg.recording) {
        updateCsStatus(csMsg.alive ? 'connected' : 'error');
      }
    }

    if (msg.type === 'EXECUTION_RESULT') {
      // Execution completed — hide running indicator, load full results from storage
      executionRunningSection.hidden = true;
      runTestBtn.disabled = false;
      loadExecutionResult().then((data) => {
        if (data) {
          renderExecutionResult(data);
        } else {
          executionBody.textContent = 'Execution completed but no result data found.';
          executionSection.hidden = false;
        }
      });
    }

    // M7: Handle late-arriving behavioral evidence overlay
    if (msg.type === 'INTERACTION_EVIDENCE_UPDATE') {
      const evMsg = msg as {
        type: 'INTERACTION_EVIDENCE_UPDATE';
        payload: { interactionId: string; evidence: BehavioralEvidence };
      };
      handleEvidenceUpdate(evMsg.payload.interactionId, evMsg.payload.evidence);
    }
  }
});

// ── Recording Context Helpers ──────────────────────────────

function showRecordingContext(
  target: { section: HTMLElement; url: HTMLAnchorElement },
  ctx: RecordingContext,
): void {
  target.url.textContent = ctx.startUrl;
  target.url.href = ctx.startUrl;
  target.section.hidden = false;
}

// ── Workflow Actions ───────────────────────────────────────

function goHome(): void {
  showView('home');
}

async function openNewTestCase(): Promise<void> {
  tcNameInput.value = '';
  tcExpectedInput.value = '';
  tcProjectSelect.value = '';
  tcFeatureSelect.innerHTML = '';
  tcFeatureSelect.disabled = true;
  tcScenarioSelect.innerHTML = '';
  tcScenarioSelect.disabled = true;
  tcFeatureHint.textContent = 'Select a project first';
  tcScenarioHint.textContent = 'Select a feature first';
  hideInlineCreate(tcProjectCreate);
  hideInlineCreate(tcFeatureCreate);
  hideInlineCreate(tcScenarioCreate);
  tcFormError.hidden = true;
  updateStartButton();

  currentProjects = (await RepositoryService.getRepository()).projects;
  populateProjectDropdown();
  showView('new-tc');
}

async function handleStartRecording(): Promise<void> {
  // MS-U1: reset the stopped-view reveal state — each recording starts with
  // the production filter (view-only carryover otherwise).
  showHiddenInteractions = false;
  setAssertionPlan(null);

  if (!validateForm()) {
    showFormError('Please fill in all required fields.');
    return;
  }

  const projectId = tcProjectSelect.value;
  const projectName = currentProjects.find((p) => p.id === projectId)?.name || 'Unknown';
  const featureId = tcFeatureSelect.value;
  const featureName = currentProjects.find((p) => p.id === projectId)?.features.find((f) => f.id === featureId)?.name || 'Unknown';
  const scenarioId = tcScenarioSelect.value;
  const scenarioName = currentProjects.find((p) => p.id === projectId)?.features.find((f) => f.id === featureId)?.scenarios.find((s) => s.id === scenarioId)?.name || 'Unknown';

  const draft: TestCaseDraft = {
    id: `tc-${Date.now()}`,
    name: tcNameInput.value.trim(),
    expectedResult: tcExpectedInput.value.trim() || undefined,
    projectId,
    projectName,
    featureId,
    featureName,
    scenarioId,
    scenarioName,
    status: TestCaseState.DRAFT,
    createdAt: new Date().toISOString(),
  };

  await StorageService.setTestCaseDraft(draft);
  await sendMessage({ type: 'START_RECORDING' });

  tcBadgeName.textContent = draft.name;
  tcBadgeRecording.hidden = false;

  showView('recording');

  // Show "checking" status while content script health is verified
  updateCsStatus('checking');

  recordingContextSection.hidden = true;
  timelineEvents.innerHTML = '<p class="timeline__empty">Recording... interactions will appear here.</p>';
  timelineCount.textContent = '0';
}

async function handleStopRecording(): Promise<void> {
  await sendMessage({ type: 'STOP_RECORDING' });

  // Load recording context
  const ctx = await StorageService.getRecordingContext();
  if (ctx) {
    showRecordingContext({ section: stoppedRecordingContext, url: stoppedRecordingContextUrl }, ctx);
  }

  // Load and display detected interactions from Component Runtime.
  // The service worker writes DETECTED_INTERACTIONS_MERGED asynchronously after
  // STOP_RECORDING — it may not be ready yet. We try once here, and if empty,
  // the storage listener (setupLiveListeners) will populate when SW finishes.
  //
  // CRITICAL: Each section is wrapped in its own try/catch so that a rendering
  // error in one section does NOT prevent showView('stopped') from executing.
  try {
    const interactions = await loadDetectedInteractions();
    if (interactions && interactions.length > 0) {
      showDetectedInteractions(interactions);
    } else {
      // Not ready yet — retry once after a short delay, then rely on storage listener
      setTimeout(async () => {
        if (views['stopped'].hidden) return; // user navigated away
        const retryInteractions = await loadDetectedInteractions();
        if (retryInteractions && retryInteractions.length > 0) {
          showDetectedInteractions(retryInteractions);
        }
      }, 500);
      detectedInteractionsSection.hidden = true;
    }
  } catch (err) {
    console.warn('[StopRecording] failed to render interactions:', err);
    detectedInteractionsSection.hidden = true;
  }

  // Load and display IR Plan steps + Playwright files (Phase 8)
  try {
    const irPlan = await loadIRPlan();
    if (irPlan) {
      renderIRSteps(irPlan);
    } else {
      irStepsSection.hidden = true;
      setTimeout(async () => {
        if (views['stopped'].hidden) return;
        const retryPlan = await loadIRPlan();
        if (retryPlan) renderIRSteps(retryPlan);
      }, 1000);
    }
  } catch {
    irStepsSection.hidden = true;
  }

  try {
    const irFiles = await loadIRFiles();
    if (irFiles) {
      renderIRFiles(irFiles);
    } else {
      irPlaywrightSection.hidden = true;
      setTimeout(async () => {
        if (views['stopped'].hidden) return;
        const retryFiles = await loadIRFiles();
        if (retryFiles) renderIRFiles(retryFiles);
      }, 1000);
    }
  } catch {
    irPlaywrightSection.hidden = true;
  }

  // MS-U3 — Session Understanding card (renders from understanding_result;
  // late SW write re-triggers via the storage listener below).
  try {
    await renderSessionUnderstanding();
  } catch {
    understandingSection.hidden = true;
  }

  // Show TC badge
  const draft = await StorageService.getTestCaseDraft();
  if (draft) {
    tcBadgeNameStopped.textContent = draft.name;
    tcBadgeStopped.hidden = false;
  }

  showView('stopped');
}

/**
 * Render interactions and show the section.
 *
 * MS-U1: renders the show-hidden toggle row when any interaction is
 * suppressed (stopped view only — the live timeline stays production-
 * filtered by design D3), and kicks off the async KR-chip attach
 * (read-only, honest absence on failure).
 */
function showDetectedInteractions(interactions: ComponentInteraction[]): void {
  detectedInteractionsCount.textContent = String(interactions.length);
  renderProductionInteractions(detectedInteractionsList, interactions, {
    showHidden: showHiddenInteractions,
    view: 'stopped', // 6F-M3 O13: honest terminal note for evidence-less cards
  });
  renderHiddenToggleRow(interactions);
  void attachKrChipsToCards();
  detectedInteractionsSection.hidden = false;
}

// ── MS-U1: show-hidden toggle (stopped view) ─────────────────────────────

let showHiddenInteractions = false;
/** Whether an assertion plan is installed (first install triggers refresh). */
let assertionPlanInstalled = false;

function renderHiddenToggleRow(interactions: ComponentInteraction[]): void {
  const summary = buildHiddenSummary(interactions);
  const row = hiddenToggleRow;
  if (!summary) {
    row.hidden = true;
    row.textContent = '';
    return;
  }
  row.hidden = false;
  row.textContent = showHiddenInteractions ? 'Hide suppressed interactions' : summary;
}

async function onHiddenToggleClick(): Promise<void> {
  showHiddenInteractions = !showHiddenInteractions;
  await refreshInteractionCards();
}

/** Re-render the stopped-view cards from storage (preserves reveal state). */
async function refreshInteractionCards(): Promise<void> {
  const interactions = await loadDetectedInteractions();
  if (interactions && interactions.length > 0 && !detectedInteractionsSection.hidden) {
    showDetectedInteractions(interactions);
  }
}

// ── MS-U1: KR chip attach (read-only) ────────────────────────────────────

function collectCardMap(): Map<string, HTMLElement> {
  const cards = detectedInteractionsList.querySelectorAll<HTMLElement>('.interaction-event');
  const map = new Map<string, HTMLElement>();
  for (const card of cards) {
    const id = card.querySelector<HTMLElement>('.timeline-event__id')?.textContent;
    if (id) map.set(id, card);
  }
  return map;
}

function attachKrChipsToCards(): void {
  const cards = collectCardMap();
  if (cards.size === 0) return;
  // Display-paced async attach (honest absence on failure); never blocks render.
  void attachKrChips(cards);
}

/**
 * Real KR read (read-only, best-effort). Installed at panel load; if the
 * knowledge DB cannot be opened/read in this context the lookup stays null
 * and chips are honestly absent. One bulk read per attach, never per-card.
 */
async function installKrLookup(): Promise<void> {
  try {
    const { createKnowledgeDatabase } = await import(
      '../understanding/persistence/knowledge-database'
    );
    const db = createKnowledgeDatabase();
    type KnowledgeEpisodeRow = import('../understanding/persistence/knowledge-types').KnowledgeEpisodeRow;
    const lookup: KrLookup = async (interactionIds) => {
      const idSet = new Set(interactionIds);
      // D5: session-scoped via the indexed compound [appId+sessionId]; falls
      // back to a full read only if no session/app id is known (honest
      // absence either way). Still 2 bulk reads total — never per-card.
      const sessionId = (await StorageService.getRaw(StorageKeys.REPOSITORY_SESSION_ID)) as
        | string
        | undefined;
      // D5: session-scoped via the indexed compound [appId+sessionId]. The
      // schema indexes episodes by the compound (not sessionId alone), so
      // resolve the session's appId from its behavior-session row first
      // (same DB, one indexed read). Falls back to a full read (bounded,
      // still 2–3 bulk reads total — never per-card).
      let episodes: KnowledgeEpisodeRow[];
      if (sessionId) {
        const behaviorSession = await db.knowledgeBehaviorSessions
          .where('sessionId').equals(sessionId).first().catch(() => undefined);
        const appId = behaviorSession?.appId;
        episodes = appId
          ? await db.knowledgeEpisodes
              .where('[appId+sessionId]').equals([appId, sessionId]).toArray()
          : await db.knowledgeEpisodes.toArray();
      } else {
        episodes = await db.knowledgeEpisodes.toArray();
      }
      const memberEpisodes = episodes.filter((ep) =>
        (ep.members ?? []).some((m) => idSet.has(m.interactionId)),
      );
      const sigKeys = [...new Set(memberEpisodes.map((e) => e.signatureKey))];
      if (sigKeys.length === 0) return null;
      const signatures = await db.knowledgeSignatures
        .where('key').anyOf(sigKeys).toArray();
      return joinSignatures(memberEpisodes, signatures);
    };
    setKrLookup(lookup);
  } catch {
    setKrLookup(null); // honest absence — panel works fully without chips
  }
}

// ── IR Plan Rendering (Phase 8) ────────────────────────────

/**
 * Render an ExecutionIRPlan's steps in the side panel.
 * Shows action, description, target locators, input, and assertions.
 */
export function renderIRSteps(plan: ExecutionIRPlan): void {
  // MS-U1 A8: expose assertion counts to the Observed Workflow cards
  // (display-only join; the IR itself is untouched). Cards already rendered
  // (stopped view renders interactions before the IR plan arrives) must be
  // re-rendered so the assertion chips appear without waiting for an
  // unrelated storage re-write.
  const hadNoPlan = !assertionPlanInstalled;
  setAssertionPlan(plan);
  assertionPlanInstalled = true;
  if (!hadNoPlan || !detectedInteractionsSection.hidden) {
    void refreshInteractionCards();
  }
  irStepsCount.textContent = String(plan.steps.length);
  irStepsList.innerHTML = '';

  for (const step of plan.steps) {
    const card = document.createElement('div');
    card.className = 'step-card';

    // Header: order + action + description
    const header = document.createElement('div');
    header.className = 'step-card__header';
    const actionLabel = step.plainEnglish ?? step.description;
    header.textContent = `${step.order + 1}. ${step.action} — ${actionLabel}`;
    card.appendChild(header);

    // Target info
    if (step.target.kind === 'element') {
      const target = document.createElement('div');
      target.className = 'step-card__ids';
      const loc = step.target.resolvedLocators[0];
      target.textContent = `Target: ${step.target.elementName} (${loc?.type ?? '?'}: ${loc?.value ?? '?'})`;
      card.appendChild(target);
    } else if (step.target.kind === 'url') {
      const target = document.createElement('div');
      target.className = 'step-card__ids';
      target.textContent = `Target: ${step.target.url}`;
      card.appendChild(target);
    }

    // Input value
    if (step.input !== null && step.input !== undefined) {
      const input = document.createElement('div');
      input.className = 'step-card__ids';
      input.textContent = `Input: ${step.input}`;
      card.appendChild(input);
    }

    // Assertions — D4: state unavailability explicitly instead of
    // silently omitting the row (implying assertions might exist).
    if (step.assertions.length > 0) {
      const assertDiv = document.createElement('div');
      assertDiv.className = 'step-card__ids';
      assertDiv.textContent = `Assertions: ${step.assertions.map(formatAssertion).join('; ')}`;
      card.appendChild(assertDiv);
    } else {
      const assertDiv = document.createElement('div');
      assertDiv.className = 'step-card__unavailable';
      assertDiv.textContent = 'Assertions: none — not derived for this recording';
      card.appendChild(assertDiv);
    }

    // IR Step JSON (collapsible)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'step-card__json-toggle';
    toggleBtn.type = 'button';
    toggleBtn.textContent = '▶ IR Step JSON';

    const jsonContent = document.createElement('pre');
    jsonContent.className = 'step-card__json-content';
    jsonContent.textContent = JSON.stringify(step, null, 2);
    jsonContent.hidden = true;

    toggleBtn.addEventListener('click', () => {
      jsonContent.hidden = !jsonContent.hidden;
      toggleBtn.textContent = jsonContent.hidden ? '▶ IR Step JSON' : '▼ IR Step JSON';
    });

    card.appendChild(toggleBtn);
    card.appendChild(jsonContent);
    irStepsList.appendChild(card);
  }

  irStepsSection.hidden = false;
}

function formatAssertion(a: IRAssertion): string {
  const target = a.target.kind === 'element' ? a.target.elementName : a.target.kind === 'url' ? a.target.url : '—';
  return `${a.type} ${a.comparison} ${String(a.expectedValue)} (${target})`;
}

/**
 * Render the generated Playwright project files from the IR pipeline.
 * Shows file path + collapsible code for each GeneratedFile.
 */
function renderIRFiles(files: GeneratedFile[]): void {
  irFilesCount.textContent = `${files.length} files`;
  irFilesList.innerHTML = '';

  // Find the test spec file (most interesting to the user)
  const testFile = files.find(f => f.path.endsWith('.spec.ts')) ?? files[0];

  for (const file of files) {
    const wrapper = document.createElement('div');
    wrapper.className = 'step-card';

    const header = document.createElement('div');
    header.className = 'step-card__header';
    const isTestFile = file === testFile;
    header.textContent = `${isTestFile ? '📋 ' : '📄 '}${file.path}`;
    wrapper.appendChild(header);

    // Code (collapsible)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'step-card__json-toggle';
    toggleBtn.type = 'button';
    toggleBtn.textContent = '▶ Show Code';

    const codeContent = document.createElement('pre');
    codeContent.className = 'step-card__json-content';
    codeContent.textContent = file.content;
    codeContent.hidden = true;

    // Auto-expand the test spec by default
    if (isTestFile) {
      codeContent.hidden = false;
      toggleBtn.textContent = '▼ Hide Code';
    }

    toggleBtn.addEventListener('click', () => {
      codeContent.hidden = !codeContent.hidden;
      toggleBtn.textContent = codeContent.hidden ? '▶ Show Code' : '▼ Hide Code';
    });

    // Copy button for the file
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn--secondary btn--sm';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(file.content);
        copyBtn.textContent = '✓ Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      } catch {
        copyBtn.textContent = '✗ Failed';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      }
    });

    const actionsDiv = document.createElement('div');
    actionsDiv.style.cssText = 'display:flex;gap:8px;align-items:center;';
    actionsDiv.appendChild(toggleBtn);
    actionsDiv.appendChild(copyBtn);

    wrapper.appendChild(actionsDiv);
    wrapper.appendChild(codeContent);
    irFilesList.appendChild(wrapper);
  }

  irPlaywrightSection.hidden = false;
}

async function loadIRPlan(): Promise<ExecutionIRPlan | null> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.EXECUTION_IR_PLAN);
    return (result[StorageKeys.EXECUTION_IR_PLAN] as ExecutionIRPlan) ?? null;
  } catch {
    return null;
  }
}

// ── Session Understanding Card (MS-U3) ──────────────────────

async function loadUnderstandingResult(): Promise<UnderstandingResult | null> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.UNDERSTANDING_RESULT);
    return (result[StorageKeys.UNDERSTANDING_RESULT] as UnderstandingResult) ?? null;
  } catch {
    return null;
  }
}

/**
 * Read-only gaps lookup. Joins on the JUST-RENDERED UnderstandingResult's
 * sessionId — the exact key the understanding pipeline persists its
 * knowledge rows under (knowledge-repository row keys are
 * `${appId}:${understanding sessionId}`; repo_session_id is a DIFFERENT
 * repository-v2 UUID and never matches). Probed live: joining on the
 * understanding sessionId finds the session + gaps; joining on
 * repo_session_id finds neither. Read-only, session-scoped, best-effort.
 */
async function lookupSessionGaps(sessionId: string): Promise<GapLike[]> {
  try {
    const { createKnowledgeDatabase } = await import(
      '../understanding/persistence/knowledge-database'
    );
    const db = createKnowledgeDatabase();
    const behaviorSession = await db.knowledgeBehaviorSessions
      .where('sessionId').equals(sessionId).first().catch(() => undefined);
    if (!behaviorSession) return [];
    const rows = await db.knowledgeGaps
      .where('[appId+sessionId]').equals([behaviorSession.appId, sessionId]).toArray();
    // Newest first — gaps are a backlog; the most recent head the list.
    rows.sort((a, b) => b.observedAtMs - a.observedAtMs);
    return rows;
  } catch {
    return []; // honest absence — card renders without the gaps row
  }
}

/**
 * MS-U5 F1 — read-only signatures lookup for the forward-links block.
 * Same join domain as lookupSessionGaps: the understanding sessionId (see
 * that docblock). Resolves the session's appId via the behavior-session row
 * (one indexed read), then reads the session's episodes' signatureKeys and
 * fetches those signature rows. Returns [] on any failure — honest absence.
 */
async function lookupSessionSignatures(sessionId: string): Promise<ForwardSigLike[]> {
  try {
    const { createKnowledgeDatabase } = await import(
      '../understanding/persistence/knowledge-database'
    );
    const db = createKnowledgeDatabase();
    const behaviorSession = await db.knowledgeBehaviorSessions
      .where('sessionId').equals(sessionId).first().catch(() => undefined);
    if (!behaviorSession) return [];
    const episodes = await db.knowledgeEpisodes
      .where('[appId+sessionId]')
      .equals([behaviorSession.appId, sessionId]).toArray();
    const sigKeys = [...new Set(episodes.map((e) => e.signatureKey))];
    if (sigKeys.length === 0) return [];
    const sigByKey = await db.knowledgeSignatures
      .where('key').anyOf(sigKeys).toArray();
    return sigByKey.map((s) => ({
      actionType: s.actionType,
      normalizedTarget: s.normalizedTarget,
      occurrenceCount: s.occurrenceCount,
      status: s.status,
      firstSeenAtSession: s.firstSeenAtSession,
    }));
  } catch {
    return []; // honest absence — forward block renders without F1 lines
  }
}

async function renderSessionUnderstanding(): Promise<void> {
  const result = await loadUnderstandingResult();
  if (!result) {
    understandingSection.hidden = true;
    return;
  }
  const card = renderUnderstandingCard(result);
  if (!card) {
    understandingSection.hidden = true;
    return;
  }
  understandingBody.replaceChildren(card);
  understandingSection.hidden = false;
  // Async gaps + forward links attach (best-effort, never blocks the render
  // — MS-U1 pattern). Join key = this result's own sessionId (docblocks).
  void Promise.all([
    lookupSessionGaps(result.sessionId),
    lookupSessionSignatures(result.sessionId),
  ]).then(([gaps, forwardSignatures]) => {
    if (gaps.length === 0 && forwardSignatures.length === 0) return; // honest absence
    const enriched = renderUnderstandingCard(result, { gaps, forwardSignatures });
    if (enriched) understandingBody.replaceChildren(enriched);
  });
}

async function loadIRFiles(): Promise<GeneratedFile[] | null> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.GENERATED_FILES);
    const stored = result[StorageKeys.GENERATED_FILES];
    return extractFiles(stored);
  } catch {
    return null;
  }
}

function extractFiles(stored: unknown): GeneratedFile[] | null {
  if (!stored) return null;
  if (Array.isArray(stored)) return stored as GeneratedFile[];
  if (typeof stored === 'object' && stored !== null && 'files' in stored && Array.isArray((stored as Record<string, unknown>).files)) {
    return (stored as Record<string, unknown>).files as GeneratedFile[];
  }
  return null;
}

async function loadDetectedInteractions(): Promise<ComponentInteraction[] | null> {
  try {
    // Read from Component Runtime storage key
    const result = await chrome.storage.local.get(StorageKeys.LIVE_INTERACTIONS);
    const stored = result[StorageKeys.LIVE_INTERACTIONS];
    return Array.isArray(stored) ? stored as ComponentInteraction[] : null;
  } catch {
    return null;
  }
}

// ── Repository Status (Phase 10.4) ─────────────────────────

interface RepoStatusData {
  sessionId: string | null;
}

async function loadRepositoryStatus(): Promise<RepoStatusData | null> {
  try {
    const result = await chrome.storage.local.get([
      StorageKeys.REPOSITORY_SESSION_ID,
    ]);
    const sessionId = result[StorageKeys.REPOSITORY_SESSION_ID] ?? null;
    if (!sessionId) return null;
    return {
      sessionId,
    };
  } catch {
    return null;
  }
}

function renderRepositoryStatus(data: RepoStatusData): void {
  repoStatusBody.innerHTML = '';

  // Session row (built with textContent to avoid XSS)
  const sessionRow = document.createElement('div');
  sessionRow.className = 'repo-status__row';
  const sessionLabel = document.createElement('span');
  sessionLabel.className = 'repo-status__label';
  sessionLabel.textContent = 'Session:';
  const sessionValue = document.createElement('span');
  sessionValue.className = 'repo-status__value';
  sessionValue.textContent = data.sessionId ? data.sessionId.slice(0, 8) : '—';
  sessionRow.append(sessionLabel, sessionValue);
  repoStatusBody.appendChild(sessionRow);

  repoStatusSection.hidden = false;
}

// ── Execution Results (Phase 12.6) ─────────────────────────

interface ExecutionStepDisplay {
  stepId: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  durationMs: number;
  assertionResults: Array<{ type: string; passed: boolean; message: string }>;
  error?: { message: string; type: string };
}

interface ExecutionSummaryData {
  status: 'passed' | 'failed' | 'error';
  stepCount: number;
  passedSteps: number;
  failedSteps: number;
  errorSteps: number;
  skippedSteps: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  stepResults: ExecutionStepDisplay[];
  executionRunId?: string | null;
  /** D2: true when the run executed against an IR plan whose referenced repository elements changed since generation. */
  irStale?: boolean;
}

async function loadExecutionResult(): Promise<ExecutionSummaryData | null> {
  try {
    const result = await chrome.storage.local.get(StorageKeys.EXECUTION_RESULT);
    const data = result[StorageKeys.EXECUTION_RESULT];
    if (!data) return null;
    return data as ExecutionSummaryData;
  } catch {
    return null;
  }
}

export function renderExecutionResult(data: ExecutionSummaryData): void {
  executionBody.innerHTML = '';

  // Status badge
  const statusRow = document.createElement('div');
  statusRow.className = 'repo-status__row';
  const statusBadge = document.createElement('span');
  statusBadge.className = `repo-status__badge repo-status__badge--${data.status === 'passed' ? 'merged' : data.status === 'failed' ? 'ambiguous' : 'new'}`;
  statusBadge.textContent = data.status.toUpperCase();
  const summaryText = document.createElement('span');
  summaryText.className = 'repo-status__value';
  summaryText.textContent = `${data.passedSteps}/${data.stepCount} steps passed · ${Math.round(data.durationMs)}ms`;
  statusRow.append(statusBadge, summaryText);
  executionBody.appendChild(statusRow);

  // D4: when no step carried assertions, say so — the run above is a
  // replay of actions with zero verification checks, and the PASS badge
  // alone would imply a verified test.
  const hasAnyAssertionResult = (data.stepResults ?? []).some(
    (s) => s.assertionResults && s.assertionResults.length > 0,
  );
  if (data.stepResults && data.stepResults.length > 0 && !hasAnyAssertionResult) {
    const assertionsRow = document.createElement('div');
    assertionsRow.className = 'repo-status__row repo-status__unavailable';
    const assertionsLabel = document.createElement('span');
    assertionsLabel.className = 'repo-status__label';
    assertionsLabel.textContent = 'Assertions:';
    const assertionsValue = document.createElement('span');
    assertionsValue.className = 'repo-status__value';
    assertionsValue.textContent = 'none evaluated — replay-only run (0 checks)';
    assertionsRow.append(assertionsLabel, assertionsValue);
    executionBody.appendChild(assertionsRow);
  }

  // D2: when the IR plan was stale (a referenced repository element changed
  // after the plan was generated), say so — the run replayed against an
  // outdated plan and runtime healing attempted to bridge the gap.
  if (data.irStale === true) {
    const staleRow = document.createElement('div');
    staleRow.className = 'repo-status__row repo-status__unavailable';
    const staleLabel = document.createElement('span');
    staleLabel.className = 'repo-status__label';
    staleLabel.textContent = 'IR stale:';
    const staleValue = document.createElement('span');
    staleValue.className = 'repo-status__value';
    staleValue.textContent = 'stale — a tracked element changed since this plan was generated; runtime healing attempted';
    staleRow.append(staleLabel, staleValue);
    executionBody.appendChild(staleRow);
  }

  // Step counts
  if (data.failedSteps > 0 || data.errorSteps > 0 || data.skippedSteps > 0) {
    const countsRow = document.createElement('div');
    countsRow.className = 'repo-status__row';
    const countsLabel = document.createElement('span');
    countsLabel.className = 'repo-status__label';
    countsLabel.textContent = 'Breakdown:';
    const countsValue = document.createElement('span');
    countsValue.className = 'repo-status__value';
    const parts: string[] = [`${data.passedSteps} passed`];
    if (data.failedSteps > 0) parts.push(`${data.failedSteps} failed`);
    if (data.errorSteps > 0) parts.push(`${data.errorSteps} errored`);
    if (data.skippedSteps > 0) parts.push(`${data.skippedSteps} skipped`);
    countsValue.textContent = parts.join(', ');
    countsRow.append(countsLabel, countsValue);
    executionBody.appendChild(countsRow);
  }

  // Timing
  const timingRow = document.createElement('div');
  timingRow.className = 'repo-status__row';
  const timingLabel = document.createElement('span');
  timingLabel.className = 'repo-status__label';
  timingLabel.textContent = 'Duration:';
  const timingValue = document.createElement('span');
  timingValue.className = 'repo-status__value';
  timingValue.textContent = `${(data.durationMs / 1000).toFixed(2)}s`;
  timingRow.append(timingLabel, timingValue);
  executionBody.appendChild(timingRow);

  // Execution Run ID
  if (data.executionRunId) {
    const idRow = document.createElement('div');
    idRow.className = 'repo-status__row';
    const idLabel = document.createElement('span');
    idLabel.className = 'repo-status__label';
    idLabel.textContent = 'Run ID:';
    const idValue = document.createElement('span');
    idValue.className = 'repo-status__value';
    idValue.textContent = data.executionRunId.slice(0, 8) + '…';
    idRow.append(idLabel, idValue);
    executionBody.appendChild(idRow);
  }

  // Step-by-step results
  if (data.stepResults && data.stepResults.length > 0) {
    for (const step of data.stepResults.slice(0, 20)) {
      const stepRow = document.createElement('div');
      stepRow.className = 'repo-status__row';
      const stepBadge = document.createElement('span');
      const badgeClass = step.status === 'passed' ? 'merged'
        : step.status === 'failed' ? 'ambiguous'
        : step.status === 'error' ? 'new'
        : 'new';
      stepBadge.className = `repo-status__badge repo-status__badge--${badgeClass}`;
      stepBadge.textContent = step.status;
      const stepInfo = document.createElement('span');
      stepInfo.className = 'repo-status__value';
      stepInfo.textContent = `${step.stepId} (${step.durationMs}ms)`;
      stepRow.append(stepBadge, stepInfo);
      executionBody.appendChild(stepRow);

      // Error message
      if (step.error) {
        const errRow = document.createElement('div');
        errRow.className = 'repo-status__row';
        errRow.style.marginLeft = '20px';
        const errText = document.createElement('span');
        errText.className = 'repo-status__label';
        errText.textContent = `  ↳ ${step.error.type}: ${step.error.message}`;
        errRow.appendChild(errText);
        executionBody.appendChild(errRow);
      }

      // Assertion results
      if (step.assertionResults && step.assertionResults.length > 0) {
        for (const ar of step.assertionResults) {
          const arRow = document.createElement('div');
          arRow.className = 'repo-status__row';
          arRow.style.marginLeft = '20px';
          const arBadge = document.createElement('span');
          arBadge.className = `repo-status__badge repo-status__badge--${ar.passed ? 'merged' : 'ambiguous'}`;
          arBadge.textContent = ar.passed ? '✓' : '✗';
          const arText = document.createElement('span');
          arText.className = 'repo-status__label';
          arText.textContent = `${ar.type}: ${ar.message}`;
          arRow.append(arBadge, arText);
          executionBody.appendChild(arRow);
        }
      }
    }

    if (data.stepResults.length > 20) {
      const moreRow = document.createElement('div');
      moreRow.className = 'repo-status__row';
      const moreText = document.createElement('span');
      moreText.className = 'repo-status__label';
      moreText.textContent = `... and ${data.stepResults.length - 20} more steps`;
      moreRow.appendChild(moreText);
      executionBody.appendChild(moreRow);
    }
  }

  executionSection.hidden = false;
}

async function handleRunTest(): Promise<void> {
  // Show running indicator
  executionSection.hidden = true;
  executionRunningSection.hidden = false;
  runTestBtn.disabled = true;

  try {
    await sendMessage({ type: 'RUN_TEST' });
    // The EXECUTION_RESULT message will update the UI
  } catch (e) {
    console.error('[SidePanel] Failed to send RUN_TEST:', e);
    executionRunningSection.hidden = true;
    runTestBtn.disabled = false;
    executionSection.hidden = false;
    executionBody.textContent = 'Failed to start test execution.';
  }
}

async function handleRecordAnother(): Promise<void> {
  await StorageService.clearEvents();
  await StorageService.clearRecordingContext();
  await StorageService.clearTestCaseDraft();
  await StorageService.resetUIState();
  try { await chrome.storage.local.remove(StorageKeys.EXECUTION_IR_PLAN); } catch {}
  try { await chrome.storage.local.remove(StorageKeys.GENERATED_FILES); } catch {}
  try { await chrome.storage.local.remove(StorageKeys.UNDERSTANDING_RESULT); } catch {}
  try { await chrome.storage.local.remove(StorageKeys.REPOSITORY_SESSION_ID); } catch {}
  try { await chrome.storage.local.remove(StorageKeys.EXECUTION_RESULT); } catch {}
  irStepsSection.hidden = true;
  irPlaywrightSection.hidden = true;
  understandingSection.hidden = true; // MS-U3 — cleared with the session
  repoStatusSection.hidden = true;
  executionSection.hidden = true;
  executionRunningSection.hidden = true;
  await openNewTestCase();
}

// ── Behavioral Evidence Overlay (M7) ──────────────────────────

/**
 * Handle a late-arriving INTERACTION_EVIDENCE_UPDATE message.
 *
 * Searches all visible interaction lists (recording + stopped views) for
 * an interaction card matching the interactionId, then overlays the evidence
 * onto it. The interaction card is identified by its interactionId text
 * in the `.timeline-event__id` badge.
 *
 * If no matching card is found, no action is needed — the SW has already
 * persisted the evidence to chrome.storage.local, so the next storage-
 * triggered re-render will include behavioralEvidence on the interaction.
 */
function handleEvidenceUpdate(interactionId: string, evidence: BehavioralEvidence): void {
  // Search all timeline containers for a matching interaction card
  const containers = [
    timelineEvents,
    detectedInteractionsList,
  ];

  for (const container of containers) {
    if (!container || container.hidden) continue;

    // Look for interaction cards whose ID badge matches the interactionId
    const cards = container.querySelectorAll('.interaction-event');
    for (const card of cards) {
      const idBadge = card.querySelector('.timeline-event__id');
      if (idBadge && idBadge.textContent === interactionId) {
        // Found the matching card — update evidence
        updateEvidenceOnInteraction(card as HTMLElement, evidence);
        return;
      }
    }
  }
  // No matching card found — evidence is persisted in storage via SW.
  // When the next LIVE_INTERACTIONS storage update triggers a re-render,
  // interaction.behavioralEvidence will be present → renderEvidence directly.
}

// ── Live Updates ───────────────────────────────────────────

function setupLiveListeners(): void {
  // Live interactions update during recording
  StorageService.onKeyChanged(StorageKeys.LIVE_INTERACTIONS, (newValue) => {
    if (Array.isArray(newValue) && !views['recording'].hidden) {
      const interactions = newValue as ComponentInteraction[];
      timelineCount.textContent = String(interactions.length);
      renderProductionInteractions(timelineEvents, interactions);
    }
  });

  // Recording context
  StorageService.onKeyChanged(StorageKeys.SESSION_CONTEXT, (newValue) => {
    if (newValue && typeof newValue === 'object' && 'startUrl' in newValue) {
      const ctx = newValue as RecordingContext;
      showRecordingContext({ section: recordingContextSection, url: recordingContextUrl }, ctx);
    }
  });

  // Component Runtime interactions — fires when SW emits new interactions
  // during recording (via INTERACTION_CAPTURED messages) and after STOP.
  StorageService.onKeyChanged(StorageKeys.LIVE_INTERACTIONS, (newValue) => {
    if (Array.isArray(newValue)) {
      const interactions = newValue as ComponentInteraction[];
      // Update during recording (live timeline)
      if (!views['recording'].hidden) {
        detectedInteractionsCount.textContent = String(interactions.length);
        renderProductionInteractions(detectedInteractionsList, interactions);
        detectedInteractionsSection.hidden = false;
      }
      // Update in stopped view
      if (!views['stopped'].hidden && interactions.length > 0) {
        showDetectedInteractions(interactions);
      }
    }
  });

  // IR Plan steps — fires when the IR bridge finishes building the plan
  StorageService.onKeyChanged(StorageKeys.EXECUTION_IR_PLAN, (newValue) => {
    if (newValue && typeof newValue === 'object' && 'steps' in newValue) {
      if (!views['stopped'].hidden) {
        renderIRSteps(newValue as ExecutionIRPlan);
      }
    }
  });

  // IR Generated Files — fires when PlaywrightCodeGenerator finishes
  StorageService.onKeyChanged(StorageKeys.GENERATED_FILES, (newValue) => {
    if (newValue) {
      const files = extractFiles(newValue);
      if (files && files.length > 0 && !views['stopped'].hidden) {
        renderIRFiles(files);
      }
    }
  });

  // MS-U3 — understanding_result arrives after the understanding pipeline
  // (written by the SW before the IR plan in the same STOP handler); the
  // listener re-renders the card if the stopped view is visible.
  StorageService.onKeyChanged(StorageKeys.UNDERSTANDING_RESULT, () => {
    if (!views['stopped'].hidden) {
      void renderSessionUnderstanding();
    }
  });

  // Repository persistence status — fires when service worker finishes persisting
  // the recording session to Repository V2 (Dexie/IndexedDB).
  StorageService.onKeyChanged(StorageKeys.REPOSITORY_SESSION_ID, async (newValue) => {
    if (newValue && !views['stopped'].hidden) {
      const status = await loadRepositoryStatus();
      if (status) {
        renderRepositoryStatus(status);
      }
    }
  });

  // Live interaction updates during recording
  // The SW sends INTERACTION_CAPTURED messages as the Component Runtime
  // emits interactions. We also rely on storage updates from StorageKeys.LIVE_INTERACTIONS.
  chrome.runtime.onMessage.addListener((message: any) => {
    if (message?.type === 'INTERACTION_CAPTURED' && message.interaction) {
      if (!views['recording'].hidden) {
        // Live update: reload all interactions from storage
        chrome.storage.local.get(StorageKeys.LIVE_INTERACTIONS).then((result) => {
          const all = result[StorageKeys.LIVE_INTERACTIONS];
          if (Array.isArray(all)) {
            detectedInteractionsCount.textContent = String(all.length);
            renderProductionInteractions(detectedInteractionsList, all as ComponentInteraction[]);
            detectedInteractionsSection.hidden = false;
          }
        }).catch(() => {});
      }
    }
  });
}

// ── Event Listeners ────────────────────────────────────────

newTcBtn.addEventListener('click', () => openNewTestCase());

// MS-U1: show-hidden toggle (stopped view only, view-only — no persistence).
hiddenToggleRow.addEventListener('click', () => void onHiddenToggleClick());
browseRepoBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/repository/index.html') });
});

tcProjectSelect.addEventListener('change', () => {
  if (tcProjectSelect.value === NEW_OPTION) {
    showInlineCreate(tcProjectCreate, tcProjectNewName);
  } else {
    hideInlineCreate(tcProjectCreate);
    populateFeatureDropdown(tcProjectSelect.value);
    populateScenarioDropdown('', '');
    updateStartButton();
  }
});

tcFeatureSelect.addEventListener('change', () => {
  if (tcFeatureSelect.value === NEW_OPTION) {
    showInlineCreate(tcFeatureCreate, tcFeatureNewName);
  } else {
    hideInlineCreate(tcFeatureCreate);
    populateScenarioDropdown(tcProjectSelect.value, tcFeatureSelect.value);
    updateStartButton();
  }
});

tcScenarioSelect.addEventListener('change', () => {
  if (tcScenarioSelect.value === NEW_OPTION) {
    showInlineCreate(tcScenarioCreate, tcScenarioNewName);
  } else {
    hideInlineCreate(tcScenarioCreate);
    updateStartButton();
  }
});

tcNameInput.addEventListener('input', () => updateStartButton());

// Inline create handlers
tcProjectCreateBtn.addEventListener('click', async () => {
  const name = tcProjectNewName.value.trim();
  if (!name) return;
  await RepositoryService.createProject(name);
  currentProjects = (await RepositoryService.getRepository()).projects;
  hideInlineCreate(tcProjectCreate);
  populateProjectDropdown();
  tcProjectSelect.value = currentProjects[currentProjects.length - 1].id;
  populateFeatureDropdown(tcProjectSelect.value);
  updateStartButton();
});

tcProjectCancelBtn.addEventListener('click', () => {
  hideInlineCreate(tcProjectCreate);
  tcProjectSelect.value = '';
  updateStartButton();
});

tcFeatureCreateBtn.addEventListener('click', async () => {
  const name = tcFeatureNewName.value.trim();
  if (!name) return;
  const projectId = tcProjectSelect.value;
  await RepositoryService.createFeature(projectId, name);
  currentProjects = (await RepositoryService.getRepository()).projects;
  hideInlineCreate(tcFeatureCreate);
  populateFeatureDropdown(projectId);
  const project = currentProjects.find((p) => p.id === projectId);
  const lastFeature = project?.features[project.features.length - 1];
  if (lastFeature) tcFeatureSelect.value = lastFeature.id;
  populateScenarioDropdown(projectId, tcFeatureSelect.value);
  updateStartButton();
});

tcFeatureCancelBtn.addEventListener('click', () => {
  hideInlineCreate(tcFeatureCreate);
  tcFeatureSelect.value = '';
  updateStartButton();
});

tcScenarioCreateBtn.addEventListener('click', async () => {
  const name = tcScenarioNewName.value.trim();
  if (!name) return;
  const projectId = tcProjectSelect.value;
  const featureId = tcFeatureSelect.value;
  await RepositoryService.createScenario(projectId, featureId, name);
  currentProjects = (await RepositoryService.getRepository()).projects;
  hideInlineCreate(tcScenarioCreate);
  populateScenarioDropdown(projectId, featureId);
  const project = currentProjects.find((p) => p.id === projectId);
  const feature = project?.features.find((f) => f.id === featureId);
  const lastScenario = feature?.scenarios[feature.scenarios.length - 1];
  if (lastScenario) tcScenarioSelect.value = lastScenario.id;
  updateStartButton();
});

tcScenarioCancelBtn.addEventListener('click', () => {
  hideInlineCreate(tcScenarioCreate);
  tcScenarioSelect.value = '';
  updateStartButton();
});

// Form actions
tcCancelBtn.addEventListener('click', () => goHome());
tcStartRecordingBtn.addEventListener('click', () => handleStartRecording());

// Recording
stopBtn.addEventListener('click', () => handleStopRecording());

// Stopped
recordAnotherBtn.addEventListener('click', () => handleRecordAnother());

// Execution (Phase 12.6)
runTestBtn.addEventListener('click', () => handleRunTest());

// Header
settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
repoBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/repository/index.html') });
});

// ── Init ───────────────────────────────────────────────────

async function init(): Promise<void> {
  setupLiveListeners();

  const uiState = await StorageService.getUIState();
  const ctx = await StorageService.getRecordingContext();

  if (uiState.recordingState === RecordingState.Recording) {
    const draft = await StorageService.getTestCaseDraft();
    if (draft) {
      tcBadgeName.textContent = draft.name;
      tcBadgeRecording.hidden = false;
    }
    if (ctx) showRecordingContext({ section: recordingContextSection, url: recordingContextUrl }, ctx);
    // Load live interactions from Component Runtime
    const liveResult = await chrome.storage.local.get(StorageKeys.LIVE_INTERACTIONS);
    const liveInts = liveResult[StorageKeys.LIVE_INTERACTIONS];
    if (Array.isArray(liveInts) && liveInts.length > 0) {
      timelineCount.textContent = String(liveInts.length);
      renderProductionInteractions(timelineEvents, liveInts as ComponentInteraction[]);
    } else {
      timelineEvents.innerHTML = '<p class="timeline__empty">Recording... interactions will appear here.</p>';
      timelineCount.textContent = '0';
    }
    showView('recording');
  } else if (uiState.recordingState === RecordingState.Stopped) {
    if (ctx) {
      showRecordingContext({ section: stoppedRecordingContext, url: stoppedRecordingContextUrl }, ctx);
    }

    // Load detected interactions
    const interactions = await loadDetectedInteractions();
    if (interactions && interactions.length > 0) {
      showDetectedInteractions(interactions);
    } else {
      detectedInteractionsSection.hidden = true;
    }

    // Load IR Plan steps + Playwright files (Phase 8)
    const irPlan = await loadIRPlan();
    if (irPlan) {
      renderIRSteps(irPlan);
    } else {
      irStepsSection.hidden = true;
    }

    const irFiles = await loadIRFiles();
    if (irFiles) {
      renderIRFiles(irFiles);
    } else {
      irPlaywrightSection.hidden = true;
    }

    // MS-U3 — restore the Session Understanding card on panel reopen /
    // MV3 revival (same render path as the stop button; idempotent with
    // the storage listener).
    try {
      await renderSessionUnderstanding();
    } catch {
      understandingSection.hidden = true;
    }

    // Load repository persistence status (Phase 10.4)
    const repoStatus = await loadRepositoryStatus();
    if (repoStatus) {
      renderRepositoryStatus(repoStatus);
    } else {
      repoStatusSection.hidden = true;
    }

    // Load execution results (Phase 12.6)
    const executionData = await loadExecutionResult();
    if (executionData) {
      renderExecutionResult(executionData);
    } else {
      // Show the execution section with a Run button even if no prior result
      executionBody.textContent = 'No execution results yet. Click "Run Test" to execute the generated test plan.';
      executionSection.hidden = false;
    }

    const draft = await StorageService.getTestCaseDraft();
    if (draft) {
      tcBadgeNameStopped.textContent = draft.name;
      tcBadgeStopped.hidden = false;
    }
    showView('stopped');
  } else {
    showView('home');
  }
}

init();
// MS-U1: install the read-only KR lookup (best-effort; honest absence).
void installKrLookup();
