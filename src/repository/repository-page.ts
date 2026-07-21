/**
 * Repository Browser Page — tree view, CRUD operations, search, and
 * test case detail viewer.
 *
 * Users can:
 *   - Browse the Project → Feature → Scenario → TestCase hierarchy
 *   - Create / Rename / Delete at every level
 *   - Search by any name
 *   - Click a Test Case to view its steps + execution JSON (read-only)
 */
import { RepositoryService } from './repository-service';
import type {
  TestRepository,
  Project,
  Feature,
  Scenario,
  RepositoryTestCase,
} from '../shared/types';

// DOM refs
const tree = document.getElementById('repository-tree')!;
const treeEmpty = document.getElementById('tree-empty')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const newProjectBtn = document.getElementById('new-project-btn') as HTMLButtonElement;
const closeBtn = document.getElementById('close-btn')!;
const detailPanel = document.getElementById('detail-panel')!;
const detailTitle = document.getElementById('detail-title')!;
const detailMeta = document.getElementById('detail-meta')!;
const detailSteps = document.getElementById('detail-steps')!;
const detailCloseBtn = document.getElementById('detail-close-btn')!;

/** Currently displayed repository (may be filtered by search). */
let displayRepo: TestRepository = { projects: [] };

// ── Render ─────────────────────────────────────────────────

async function refresh(): Promise<void> {
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

  // Children container (collapsible)
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

// ── Detail Panel ───────────────────────────────────────────

function showTestCaseDetail(tc: RepositoryTestCase): void {
  detailTitle.textContent = tc.name;
  detailMeta.innerHTML = '';
  detailSteps.innerHTML = '';

  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  const metaId = document.createElement('span');
  metaId.textContent = `ID: ${tc.id}`;
  const metaCreated = document.createElement('span');
  metaCreated.textContent = `Created: ${new Date(tc.createdAt).toLocaleString()}`;
  const metaSteps = document.createElement('span');
  metaSteps.textContent = `${tc.steps.length} steps`;
  meta.append(metaId, ' · ', metaCreated, ' · ', metaSteps);
  detailMeta.appendChild(meta);

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

    detailSteps.appendChild(el);
  }

  detailPanel.hidden = false;
}

// ── CRUD Handlers ──────────────────────────────────────────

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
  detailPanel.hidden = true;
  await refresh();
}

// ── Event Listeners ────────────────────────────────────────

searchInput.addEventListener('input', () => refresh());

newProjectBtn.addEventListener('click', () => handleNewProject());

closeBtn.addEventListener('click', () => window.close());

detailCloseBtn.addEventListener('click', () => {
  detailPanel.hidden = true;
});

// ── Init ───────────────────────────────────────────────────

refresh();
