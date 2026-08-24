/**
 * Repository Browser Page — element-centric view + legacy tree view.
 *
 * Two views:
 *   1. Elements View — reads from Repository V2 (Dexie/IndexedDB).
 *      Shows projects → elements with locator strategies and heal history.
 *
 *   2. Classic Tree View — reads from legacy RepositoryService (chrome.storage.local).
 *      Preserves the existing Project → Feature → Scenario → TestCase hierarchy
 *      for backward compatibility during the migration period.
 */

// ── Legacy V1 imports (Classic Tree View) ─────────────────────
import { RepositoryService } from './repository-service';
import type {
  TestRepository,
  Project,
  Feature,
  Scenario,
  RepositoryTestCase,
} from '../shared/types';

// ── V2 imports (Elements View) ────────────────────────────────
import { DexieUnitOfWorkFactory } from './v2';

// ── MS-U4 imports (Knowledge View — KR browser, read-only) ────
import { renderKrBrowser, parseKnowledgeParams } from './kr-browser/kr-browser';

// ── DOM References ────────────────────────────────────────────

// View tabs
const viewTabs = document.querySelectorAll<HTMLButtonElement>('.view-tab');
const knowledgeView = document.getElementById('knowledge-view')!;
const elementsView = document.getElementById('elements-view')!;
const classicView = document.getElementById('classic-view')!;

// Knowledge View (MS-U4 — KR browser)
const krRoot = document.getElementById('kr-root')!;

// Elements View (Phase 11.5)
const elementList = document.getElementById('element-list')!;
const elementEmpty = document.getElementById('element-empty')!;
const elementDetailPanel = document.getElementById('element-detail-panel')!;
const elementDetailTitle = document.getElementById('element-detail-title')!;
const elementDetailBody = document.getElementById('element-detail-body')!;
const elementDetailCloseBtn = document.getElementById('element-detail-close-btn')!;

// Classic Tree View
const tree = document.getElementById('repository-tree')!;
const treeEmpty = document.getElementById('tree-empty')!;
const classicDetailPanel = document.getElementById('classic-detail-panel')!;
const classicDetailTitle = document.getElementById('classic-detail-title')!;
const classicDetailMeta = document.getElementById('classic-detail-meta')!;
const classicDetailSteps = document.getElementById('classic-detail-steps')!;
const classicDetailCloseBtn = document.getElementById('classic-detail-close-btn')!;

// Shared
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const newProjectBtn = document.getElementById('new-project-btn') as HTMLButtonElement;
const closeBtn = document.getElementById('close-btn')!;

// ── V2 Repository Factory ─────────────────────────────────────

const uowFactory = new DexieUnitOfWorkFactory();

// ── State ─────────────────────────────────────────────────────

/** Currently active view. */
let activeView: 'knowledge' | 'elements' | 'classic' = 'knowledge';

/** Selected app for the Knowledge view (appId — the KR's own scope key). */
let selectedAppId: string | null = null;

/** Currently displayed repository (classic view, may be filtered). */
let displayRepo: TestRepository = { projects: [] };

// ════════ VIEW SWITCHING ═══════════════════════════════════════

viewTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    if (!view) return;

    activeView = view as 'knowledge' | 'elements' | 'classic';

    viewTabs.forEach((t) => t.classList.toggle('view-tab--active', t === tab));
    knowledgeView.hidden = activeView !== 'knowledge';
    elementsView.hidden = activeView !== 'elements';
    classicView.hidden = activeView !== 'classic';

    refresh();
  });
});

// ════════ CLASSIC TREE VIEW (V1) ══════════════════════════════

async function refreshClassic(): Promise<void> {
  const query = searchInput.value.trim();
  displayRepo = await RepositoryService.search(query);
  renderTree();
}

function renderTree(): void {
  tree.innerHTML = '';

  if (displayRepo.projects.length === 0) {
    treeEmpty.textContent = searchInput.value.trim()
      ? 'No results match your search.'
      : 'No projects yet. Click "+ New Project" to get started.';
    tree.appendChild(treeEmpty);
    return;
  }

  for (const project of displayRepo.projects) {
    tree.appendChild(createProjectNode(project));
  }
}

function createProjectNode(project: Project): HTMLElement {
  const node = document.createElement('div');
  node.className = 'tree-node tree-node--project';

  const header = document.createElement('div');
  header.className = 'tree-node__header';

  const toggle = document.createElement('span');
  toggle.className = 'tree-node__toggle';
  toggle.textContent = '▶';

  const icon = document.createElement('span');
  icon.className = 'tree-node__icon';
  icon.textContent = '📁';

  const label = document.createElement('span');
  label.className = 'tree-node__label';
  label.textContent = project.name;

  const count = document.createElement('span');
  count.className = 'tree-node__count';
  count.textContent = `${project.features.length} features`;

  const actions = createNodeActions(
    () => handleRename('project', project.id, project.name),
    () => handleDeleteProject(project.id, project.name),
  );

  header.append(toggle, icon, label, count, actions);
  node.appendChild(header);

  const children = document.createElement('div');
  children.className = 'tree-node__children';
  children.hidden = true;

  const addFeatureBtn = document.createElement('button');
  addFeatureBtn.className = 'btn btn--link';
  addFeatureBtn.textContent = '+ Add Feature';
  addFeatureBtn.addEventListener('click', () => handleAddFeature(project.id));

  children.appendChild(addFeatureBtn);

  for (const feature of project.features) {
    children.appendChild(createFeatureNode(project.id, feature));
  }

  header.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.tree-node__actions')) return;
    children.hidden = !children.hidden;
    toggle.textContent = children.hidden ? '▶' : '▼';
  });

  node.appendChild(children);
  return node;
}

function createFeatureNode(projectId: string, feature: Feature): HTMLElement {
  const node = document.createElement('div');
  node.className = 'tree-node tree-node--feature';

  const header = document.createElement('div');
  header.className = 'tree-node__header';

  const toggle = document.createElement('span');
  toggle.className = 'tree-node__toggle';
  toggle.textContent = '▶';

  const icon = document.createElement('span');
  icon.className = 'tree-node__icon';
  icon.textContent = '📦';

  const label = document.createElement('span');
  label.className = 'tree-node__label';
  label.textContent = feature.name;

  const count = document.createElement('span');
  count.className = 'tree-node__count';
  count.textContent = `${feature.scenarios.length} scenarios`;

  const actions = createNodeActions(
    () => handleRenameFeature(projectId, feature.id, feature.name),
    () => handleDeleteFeature(projectId, feature.id, feature.name),
  );

  header.append(toggle, icon, label, count, actions);
  node.appendChild(header);

  const children = document.createElement('div');
  children.className = 'tree-node__children';
  children.hidden = true;

  const addScenarioBtn = document.createElement('button');
  addScenarioBtn.className = 'btn btn--link';
  addScenarioBtn.textContent = '+ Add Scenario';
  addScenarioBtn.addEventListener('click', () => handleAddScenario(projectId, feature.id));

  children.appendChild(addScenarioBtn);

  for (const scenario of feature.scenarios) {
    children.appendChild(createScenarioNode(projectId, feature.id, scenario));
  }

  header.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.tree-node__actions')) return;
    children.hidden = !children.hidden;
    toggle.textContent = children.hidden ? '▶' : '▼';
  });

  node.appendChild(children);
  return node;
}

function createScenarioNode(
  projectId: string,
  featureId: string,
  scenario: Scenario,
): HTMLElement {
  const node = document.createElement('div');
  node.className = 'tree-node tree-node--scenario';

  const header = document.createElement('div');
  header.className = 'tree-node__header';

  const toggle = document.createElement('span');
  toggle.className = 'tree-node__toggle';
  toggle.textContent = '▶';

  const icon = document.createElement('span');
  icon.className = 'tree-node__icon';
  icon.textContent = '🎬';

  const label = document.createElement('span');
  label.className = 'tree-node__label';
  label.textContent = scenario.name;

  const count = document.createElement('span');
  count.className = 'tree-node__count';
  count.textContent = `${scenario.testCases.length} test cases`;

  const actions = createNodeActions(
    () => handleRenameScenario(projectId, featureId, scenario.id, scenario.name),
    () => handleDeleteScenario(projectId, featureId, scenario.id, scenario.name),
  );

  header.append(toggle, icon, label, count, actions);
  node.appendChild(header);

  const children = document.createElement('div');
  children.className = 'tree-node__children';
  children.hidden = true;

  if (scenario.testCases.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tree-node__empty';
    empty.textContent = 'No test cases yet.';
    children.appendChild(empty);
  }

  for (const tc of scenario.testCases) {
    children.appendChild(createTestCaseNode(projectId, featureId, scenario.id, tc));
  }

  header.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.tree-node__actions')) return;
    children.hidden = !children.hidden;
    toggle.textContent = children.hidden ? '▶' : '▼';
  });

  node.appendChild(children);
  return node;
}

function createTestCaseNode(
  projectId: string,
  featureId: string,
  scenarioId: string,
  tc: RepositoryTestCase,
): HTMLElement {
  const node = document.createElement('div');
  node.className = 'tree-node tree-node--testcase';

  const header = document.createElement('div');
  header.className = 'tree-node__header tree-node__header--leaf';

  const icon = document.createElement('span');
  icon.className = 'tree-node__icon';
  icon.textContent = '🧪';

  const label = document.createElement('span');
  label.className = 'tree-node__label';
  label.textContent = tc.name;

  const stepCount = document.createElement('span');
  stepCount.className = 'tree-node__count';
  stepCount.textContent = `${tc.steps.length} steps`;

  const actions = createNodeActions(
    undefined,
    () => handleDeleteTestCase(projectId, featureId, scenarioId, tc.id, tc.name),
  );

  header.append(icon, label, stepCount, actions);
  node.appendChild(header);

  header.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.tree-node__actions')) return;
    showTestCaseDetail(tc);
  });

  return node;
}

function createNodeActions(
  onRename?: () => void,
  onDelete?: () => void,
): HTMLElement {
  const container = document.createElement('span');
  container.className = 'tree-node__actions';

  if (onRename) {
    const renameBtn = document.createElement('button');
    renameBtn.className = 'btn btn--icon';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✏️';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRename();
    });
    container.appendChild(renameBtn);
  }

  if (onDelete) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn--icon';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete();
    });
    container.appendChild(deleteBtn);
  }

  return container;
}

// ── Classic Detail Panel ──────────────────────────────────────

function showTestCaseDetail(tc: RepositoryTestCase): void {
  classicDetailTitle.textContent = tc.name;
  classicDetailMeta.innerHTML = '';
  classicDetailSteps.innerHTML = '';

  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  const metaId = document.createElement('span');
  metaId.textContent = `ID: ${tc.id}`;
  const metaCreated = document.createElement('span');
  metaCreated.textContent = `Created: ${new Date(tc.createdAt).toLocaleString()}`;
  const metaSteps = document.createElement('span');
  metaSteps.textContent = `${tc.steps.length} steps`;
  meta.append(metaId, ' · ', metaCreated, ' · ', metaSteps);
  classicDetailMeta.appendChild(meta);

  for (let i = 0; i < tc.steps.length; i++) {
    const step = tc.steps[i];
    const el = document.createElement('div');
    el.className = 'step-detail';

    const stepHeader = document.createElement('div');
    stepHeader.className = 'step-detail__header';
    const stepNum = document.createElement('span');
    stepNum.className = 'step-detail__num';
    stepNum.textContent = String(i + 1);
    const stepText = document.createElement('span');
    stepText.className = 'step-detail__text';
    stepText.textContent = step.plainEnglish;
    stepHeader.append(stepNum, stepText);
    el.appendChild(stepHeader);

    const json = document.createElement('pre');
    json.className = 'step-detail__json';
    json.textContent = JSON.stringify(step.executionJson, null, 2);
    el.appendChild(json);

    classicDetailSteps.appendChild(el);
  }

  classicDetailPanel.hidden = false;
}

// ── CRUD Handlers (Classic View) ──────────────────────────────

async function handleNewProject(): Promise<void> {
  const name = prompt('Enter project name:');
  if (!name?.trim()) return;
  await RepositoryService.createProject(name.trim());
  await refresh();
}

async function handleRename(
  _type: string,
  projectId: string,
  currentName: string,
): Promise<void> {
  const name = prompt('Rename project:', currentName);
  if (!name?.trim() || name === currentName) return;
  await RepositoryService.renameProject(projectId, name.trim());
  await refresh();
}

async function handleDeleteProject(projectId: string, name: string): Promise<void> {
  if (!confirm(`Delete project "${name}" and all its features, scenarios, and test cases?`)) return;
  await RepositoryService.deleteProject(projectId);
  await refresh();
}

async function handleAddFeature(projectId: string): Promise<void> {
  const name = prompt('Enter feature name:');
  if (!name?.trim()) return;
  await RepositoryService.createFeature(projectId, name.trim());
  await refresh();
}

async function handleRenameFeature(
  projectId: string,
  featureId: string,
  currentName: string,
): Promise<void> {
  const name = prompt('Rename feature:', currentName);
  if (!name?.trim() || name === currentName) return;
  await RepositoryService.renameFeature(projectId, featureId, name.trim());
  await refresh();
}

async function handleDeleteFeature(
  projectId: string,
  featureId: string,
  name: string,
): Promise<void> {
  if (!confirm(`Delete feature "${name}" and all its scenarios and test cases?`)) return;
  await RepositoryService.deleteFeature(projectId, featureId);
  await refresh();
}

async function handleAddScenario(projectId: string, featureId: string): Promise<void> {
  const name = prompt('Enter scenario name:');
  if (!name?.trim()) return;
  await RepositoryService.createScenario(projectId, featureId, name.trim());
  await refresh();
}

async function handleRenameScenario(
  projectId: string,
  featureId: string,
  scenarioId: string,
  currentName: string,
): Promise<void> {
  const name = prompt('Rename scenario:', currentName);
  if (!name?.trim() || name === currentName) return;
  await RepositoryService.renameScenario(projectId, featureId, scenarioId, name.trim());
  await refresh();
}

async function handleDeleteScenario(
  projectId: string,
  featureId: string,
  scenarioId: string,
  name: string,
): Promise<void> {
  if (!confirm(`Delete scenario "${name}" and all its test cases?`)) return;
  await RepositoryService.deleteScenario(projectId, featureId, scenarioId);
  await refresh();
}

async function handleDeleteTestCase(
  projectId: string,
  featureId: string,
  scenarioId: string,
  testCaseId: string,
  name: string,
): Promise<void> {
  if (!confirm(`Delete test case "${name}"?`)) return;
  await RepositoryService.deleteTestCase(projectId, featureId, scenarioId, testCaseId);
  classicDetailPanel.hidden = true;
  await refresh();
}

// ════════ SHARED UTILITIES ═════════════════════════════════════

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ════════ ELEMENTS VIEW (Phase 11.5) ══════════════════════════

import type { Element } from '../domain/entities/element';
import { ElementStatus } from '../domain/enums';

async function refreshElements(): Promise<void> {
  const query = searchInput.value.trim().toLowerCase();
  const uow = uowFactory.create();
  const result = await uow.execute(async (repos) => {
    const projects = await repos.projects.getAll();
    const grouped: Map<string, { project: string; elements: Element[] }> = new Map();
    for (const project of projects) {
      const elements = await repos.elements.getByProject(project.id);
      if (elements.length === 0) continue;
      const filtered = query
        ? elements.filter((e) =>
            e.logicalName.toLowerCase().includes(query) ||
            e.pageOrComponent.toLowerCase().includes(query))
        : elements;
      grouped.set(project.id, { project: project.name, elements: filtered });
    }
    return grouped;
  });

  elementList.innerHTML = '';
  let totalCount = 0;
  for (const [, group] of result) {
    if (group.elements.length === 0) continue;
    totalCount += group.elements.length;

    const projectHeader = document.createElement('div');
    projectHeader.className = 'cap-project-header';
    projectHeader.innerHTML = `<span class="cap-project-header__icon">📁</span><span class="cap-project-header__name">${escapeHtml(group.project)}</span>`;
    elementList.appendChild(projectHeader);

    for (const el of group.elements) {
      elementList.appendChild(createElementCard(el));
    }
  }

  if (totalCount === 0) {
    elementEmpty.textContent = query
      ? 'No elements match your search.'
      : 'No elements yet. Record a feature to discover elements.';
    elementList.appendChild(elementEmpty);
  }
}

function createElementCard(el: Element): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cap-card';
  card.style.cursor = 'pointer';

  // Status badge
  const statusBadge = document.createElement('span');
  const statusClass = el.status === ElementStatus.ACTIVE ? 'repo-status__badge--merged'
    : el.status === ElementStatus.STALE ? 'repo-status__badge--ambiguous'
    : 'repo-status__badge--none';
  statusBadge.className = `repo-status__badge ${statusClass}`;
  statusBadge.textContent = el.status;
  card.appendChild(statusBadge);

  // Name
  const name = document.createElement('span');
  name.className = 'cap-card__name';
  name.textContent = el.logicalName;
  card.appendChild(name);

  // Page/component
  if (el.pageOrComponent) {
    const page = document.createElement('div');
    page.className = 'cap-card__purpose';
    page.textContent = el.pageOrComponent;
    card.appendChild(page);
  }

  // Stats row
  const stats = document.createElement('div');
  stats.className = 'cap-card__stats';
  const locCount = document.createElement('span');
  locCount.textContent = `${el.locatorStrategies.length} locators`;
  stats.appendChild(locCount);
  if (el.healHistory.length > 0) {
    const healCount = document.createElement('span');
    healCount.textContent = `${el.healHistory.length} heals`;
    stats.appendChild(healCount);
  }
  card.appendChild(stats);

  card.addEventListener('click', () => {
    renderElementDetail(el);
  });

  return card;
}

async function renderElementDetail(el: Element): Promise<void> {
  elementDetailTitle.textContent = el.logicalName;
  elementDetailBody.innerHTML = '';

  // Status row
  const statusRow = document.createElement('div');
  statusRow.className = 'detail-section';
  const statusLabel = document.createElement('span');
  statusLabel.textContent = 'Status: ';
  statusLabel.style.fontWeight = 'bold';
  const statusValue = document.createElement('span');
  const statusClass = el.status === ElementStatus.ACTIVE ? 'repo-status__badge--merged'
    : el.status === ElementStatus.STALE ? 'repo-status__badge--ambiguous'
    : 'repo-status__badge--none';
  statusValue.className = `repo-status__badge ${statusClass}`;
  statusValue.textContent = el.status;
  statusRow.append(statusLabel, statusValue);
  elementDetailBody.appendChild(statusRow);

  // Page/component
  if (el.pageOrComponent) {
    const pageRow = document.createElement('div');
    pageRow.className = 'detail-section';
    pageRow.textContent = `Page: ${el.pageOrComponent}`;
    elementDetailBody.appendChild(pageRow);
  }

  // Locator strategies
  const locSection = document.createElement('div');
  locSection.className = 'detail-section';
  const locHeader = document.createElement('h3');
  locHeader.textContent = 'Locator Strategies';
  locSection.appendChild(locHeader);
  for (const loc of el.locatorStrategies) {
    const locRow = document.createElement('div');
    locRow.style.display = 'flex';
    locRow.style.justifyContent = 'space-between';
    locRow.style.padding = '4px 0';
    const locType = document.createElement('span');
    locType.textContent = `${loc.priority}. ${loc.type}`;
    locType.style.fontWeight = 'bold';
    const locValue = document.createElement('span');
    locValue.textContent = loc.value;
    locValue.style.fontFamily = 'monospace';
    locRow.append(locType, locValue);
    locSection.appendChild(locRow);
  }
  elementDetailBody.appendChild(locSection);

  // Heal history
  if (el.healHistory.length > 0) {
    const healSection = document.createElement('div');
    healSection.className = 'detail-section';
    const healHeader = document.createElement('h3');
    healHeader.textContent = 'Heal History';
    healSection.appendChild(healHeader);
    for (const event of el.healHistory) {
      const eventRow = document.createElement('div');
      eventRow.style.padding = '8px 0';
      eventRow.style.borderTop = '1px solid var(--color-border, #e0e0e0)';

      const eventMeta = document.createElement('div');
      eventMeta.style.display = 'flex';
      eventMeta.style.justifyContent = 'space-between';
      const eventDate = document.createElement('span');
      eventDate.textContent = new Date(event.healedAt).toLocaleString();
      eventDate.style.fontSize = '0.85em';
      eventDate.style.color = '#666';
      const eventReason = document.createElement('span');
      eventReason.textContent = `${event.reason} (by ${event.proposedBy})`;
      eventReason.style.fontStyle = 'italic';
      eventMeta.append(eventDate, eventReason);
      eventRow.appendChild(eventMeta);

      const sessionRef = document.createElement('div');
      sessionRef.textContent = `Session: ${event.runId.slice(0, 12)}`;
      sessionRef.style.fontSize = '0.85em';
      sessionRef.style.color = '#666';
      eventRow.appendChild(sessionRef);

      healSection.appendChild(eventRow);
    }
    elementDetailBody.appendChild(healSection);
  }

  // Last healed
  if (el.lastHealedAt) {
    const lastHealRow = document.createElement('div');
    lastHealRow.className = 'detail-section';
    lastHealRow.textContent = `Last healed: ${new Date(el.lastHealedAt).toLocaleString()}`;
    lastHealRow.style.fontSize = '0.85em';
    lastHealRow.style.color = '#666';
    elementDetailBody.appendChild(lastHealRow);
  }

  // IR staleness note: healing updates element locators and bumps
  // updatedAt. Any cached IR artifact referencing this element will be
  // detected as stale by checkStaleness() on the next Run Test — the Side
  // Panel then reports the run as executed against a stale plan (D2).
  // Regenerating the plan is NOT automatic: it requires a fresh recording.
  if (el.healHistory.length > 0) {
    const staleNote = document.createElement('div');
    staleNote.className = 'detail-section';
    staleNote.style.padding = '8px';
    staleNote.style.backgroundColor = '#fff3cd';
    staleNote.style.borderRadius = '4px';
    const staleIcon = document.createElement('span');
    staleIcon.textContent = '⚠️ ';
    const staleText = document.createElement('span');
    staleText.textContent = 'Cached IR artifacts referencing this element are detected as stale on the next run; the Side Panel flags the run accordingly. Re-record to regenerate the plan with fresh locators.';
    staleNote.append(staleIcon, staleText);
    elementDetailBody.appendChild(staleNote);
  }

  elementDetailPanel.hidden = false;
}

elementDetailCloseBtn.addEventListener('click', () => {
  elementDetailPanel.hidden = true;
});

// ════════ KNOWLEDGE VIEW (MS-U4 — KR browser) ═════════════════
// Read-only cross-session surface over cmdrunner_knowledge. All reads by
// appId (NEVER repo_session_id — wrong key domain; see MS-U3 RCA). The
// panel never writes the KR. Renderer delegating to kr-browser modules.

async function refreshKnowledge(): Promise<void> {
  // 7.2-M1 deep-link fallback: a ?app= that is not among recorded apps
  // (stale link, wrong profile) must never render a blank browser —
  // fall back to the first app and drop the row focus params.
  if (selectedAppId) {
    try {
      const { loadApplications } = await import('./kr-browser/kr-data');
      const apps = await loadApplications();
      if (!apps.some((a) => a.appId === selectedAppId)) {
        selectedAppId = apps[0]?.appId ?? null;
      }
    } catch {
      // membership check is best-effort; renderKrBrowser handles null
    }
  }
  selectedAppIdWasLinked = selectedAppId === knowledgeParams.appId;
  await renderKrBrowser(krRoot, {
    selectedAppId,
    onAppSelected: (appId) => {
      selectedAppId = appId;
      void refreshKnowledge();
    },
    ...(focusSignatureKey && selectedAppIdWasLinked
      ? { focusSignatureKey }
      : {}),
    ...(focusEntityId && selectedAppIdWasLinked ? { focusEntityId } : {}),
    ...(knowledgeProjectId ? { projectId: knowledgeProjectId } : {}),
  });
}

/** True when the deep-linked app survived the fallback check above. */
let selectedAppIdWasLinked = false;

// ════════ REFRESH DISPATCHER ═══════════════════════════════════

async function refresh(): Promise<void> {
  if (activeView === 'knowledge') {
    await refreshKnowledge();
  } else if (activeView === 'elements') {
    await refreshElements();
  } else {
    await refreshClassic();
  }
}

// ════════ EVENT LISTENERS ══════════════════════════════════════

searchInput.addEventListener('input', () => refresh());

newProjectBtn.addEventListener('click', () => handleNewProject());

closeBtn.addEventListener('click', () => window.close());

classicDetailCloseBtn.addEventListener('click', () => {
  classicDetailPanel.hidden = true;
});

// ════════ 7.2-M1: KNOWLEDGE DEEP LINKS ════════════════════════
// Panel chips/links open this page with ?app=&sig=&entity=&project=.
// The pure parser lives in kr-browser.ts (this page module has
// module-level DOM listeners and cannot be imported by unit tests);
// values are used ONLY as Dexie lookup keys / data attributes.

// Deep-link state (set once at init from the URL; unknown-app fallback
// is handled by refreshKnowledge via loadApplications membership).
const knowledgeParams = parseKnowledgeParams(window.location.search);
const focusSignatureKey = knowledgeParams.signatureKey ?? null;
const focusEntityId = knowledgeParams.entityId ?? null;
const knowledgeProjectId = knowledgeParams.projectId ?? null;

// ════════ INIT ═════════════════════════════════════════════════

selectedAppId = knowledgeParams.appId ?? null;
refresh();
