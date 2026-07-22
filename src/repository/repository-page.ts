/**
 * Repository Browser Page — capability-centric view + legacy tree view.
 *
 * Two views:
 *   1. Capabilities View (default) — reads from Repository V2 (Dexie/IndexedDB).
 *      Shows projects → capabilities with accumulated understanding.
 *      Click a capability to see inputs, validation rules, outcomes, enrichment history.
 *
 *   2. Classic Tree View — reads from legacy RepositoryService (chrome.storage.local).
 *      Preserves the existing Project → Feature → Scenario → TestCase hierarchy
 *      for backward compatibility during the migration period.
 *
 * Phase 10 Milestone 10.4:
 *   - Capabilities view queries Dexie directly via DexieUnitOfWorkFactory.
 *   - Classic view unchanged (still uses V1 RepositoryService).
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

// ── V2 imports (Capabilities View) ────────────────────────────
import { DexieUnitOfWorkFactory } from './v2';
import type { Capability } from '../domain/entities/capability';
import type { EnrichmentEvent, CapabilityInput, CapabilityValidationRule, CapabilityOutcome } from '../domain/entities/capability';

// ── DOM References ────────────────────────────────────────────

// View tabs
const viewTabs = document.querySelectorAll<HTMLButtonElement>('.view-tab');
const capabilitiesView = document.getElementById('capabilities-view')!;
const elementsView = document.getElementById('elements-view')!;
const classicView = document.getElementById('classic-view')!;

// Capabilities View
const capabilityList = document.getElementById('capability-list')!;
const capEmpty = document.getElementById('cap-empty')!;

// Capability Detail Panel
const detailPanel = document.getElementById('detail-panel')!;
const detailTitle = document.getElementById('detail-title')!;
const detailBody = document.getElementById('detail-body')!;
const detailCloseBtn = document.getElementById('detail-close-btn')!;

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
let activeView: 'capabilities' | 'elements' | 'classic' = 'capabilities';

/** Currently displayed repository (classic view, may be filtered). */
let displayRepo: TestRepository = { projects: [] };

/** Capabilities cache for the current search. */
let displayCapabilities: Map<string, { project: string; caps: Capability[] }> = new Map();

/** Currently selected capability for detail panel. */
let selectedCapabilityId: string | null = null;

// ════════ VIEW SWITCHING ═══════════════════════════════════════

viewTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const view = tab.dataset.view;
    if (!view) return;

    activeView = view as 'capabilities' | 'elements' | 'classic';

    viewTabs.forEach((t) => t.classList.toggle('view-tab--active', t === tab));
    capabilitiesView.hidden = activeView !== 'capabilities';
    elementsView.hidden = activeView !== 'elements';
    classicView.hidden = activeView !== 'classic';

    refresh();
  });
});

// ════════ CAPABILITIES VIEW (V2) ═══════════════════════════════

async function refreshCapabilities(): Promise<void> {
  const query = searchInput.value.trim().toLowerCase();

  const uow = uowFactory.create();
  const result = await uow.execute(async (repos) => {
    const projects = await repos.projects.getAll();

    const grouped: Map<string, { project: string; caps: Capability[] }> = new Map();

    for (const project of projects) {
      const caps = await repos.capabilities.getByProject(project.id);

      // Filter by search query
      const filtered = query
        ? caps.filter(
            (c) =>
              c.name.toLowerCase().includes(query) ||
              c.purpose.toLowerCase().includes(query) ||
              project.name.toLowerCase().includes(query),
          )
        : caps;

      if (filtered.length > 0 || (!query && caps.length === 0)) {
        grouped.set(project.id, { project: project.name, caps: filtered });
      }
    }

    return grouped;
  });

  displayCapabilities = result;
  renderCapabilities();
}

function renderCapabilities(): void {
  capabilityList.innerHTML = '';

  let totalCount = 0;
  for (const [projectId, group] of displayCapabilities) {
    if (group.caps.length === 0) continue;

    totalCount += group.caps.length;

    // Project section header
    const projectHeader = document.createElement('div');
    projectHeader.className = 'cap-project-header';
    projectHeader.innerHTML = `<span class="cap-project-header__icon">📁</span><span class="cap-project-header__name">${escapeHtml(group.project)}</span>`;
    capabilityList.appendChild(projectHeader);

    // Capability cards
    for (const cap of group.caps) {
      capabilityList.appendChild(createCapabilityCard(cap));
    }
  }

  capEmpty.textContent = searchInput.value.trim()
    ? 'No capabilities match your search.'
    : 'No capabilities yet. Record a feature to build understanding.';
  if (totalCount === 0) {
    capabilityList.appendChild(capEmpty);
  }
}

function createCapabilityCard(cap: Capability): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cap-card';
  if (cap.id === selectedCapabilityId) {
    card.classList.add('cap-card--selected');
  }

  const header = document.createElement('div');
  header.className = 'cap-card__header';

  const icon = document.createElement('span');
  icon.className = 'cap-card__icon';
  icon.textContent = '⚡';

  const name = document.createElement('span');
  name.className = 'cap-card__name';
  name.textContent = cap.name;

  const confidence = document.createElement('span');
  confidence.className = `cap-card__confidence cap-badge--${cap.confidence}`;
  confidence.textContent = cap.confidence;

  header.append(icon, name, confidence);

  const purpose = document.createElement('p');
  purpose.className = 'cap-card__purpose';
  purpose.textContent = cap.purpose || 'No description available.';

  const stats = document.createElement('div');
  stats.className = 'cap-card__stats';

  const inputCount = cap.inputs.length;
  const sessionCount = cap.sessionIds.length;
  const outcomeCount = cap.observedOutcomes.length;
  const ruleCount = cap.validationRules.length;

  stats.innerHTML = `
    <span class="cap-card__stat"><span class="cap-card__stat-value">${inputCount}</span> inputs</span>
    <span class="cap-card__stat"><span class="cap-card__stat-value">${ruleCount}</span> validations</span>
    <span class="cap-card__stat"><span class="cap-card__stat-value">${outcomeCount}</span> outcomes</span>
    <span class="cap-card__stat"><span class="cap-card__stat-value">${sessionCount}</span> sessions</span>
  `;

  card.append(header, purpose, stats);

  card.addEventListener('click', () => {
    selectedCapabilityId = cap.id;
    showCapabilityDetail(cap);
    // Highlight selected card
    document.querySelectorAll('.cap-card').forEach((c) => c.classList.remove('cap-card--selected'));
    card.classList.add('cap-card--selected');
  });

  return card;
}

// ── Capability Detail Panel ───────────────────────────────────

function showCapabilityDetail(cap: Capability): void {
  detailTitle.textContent = cap.name;
  detailBody.innerHTML = '';

  // ── Meta row ──
  const metaRow = document.createElement('div');
  metaRow.className = 'cap-meta-row';
  metaRow.innerHTML = `
    <div class="cap-meta-row__item">
      <span class="cap-meta-row__label">Confidence</span>
      <span class="cap-meta-row__value">${cap.confidence}</span>
    </div>
    <div class="cap-meta-row__item">
      <span class="cap-meta-row__label">Sessions</span>
      <span class="cap-meta-row__value">${cap.sessionIds.length}</span>
    </div>
    <div class="cap-meta-row__item">
      <span class="cap-meta-row__label">Created</span>
      <span class="cap-meta-row__value">${new Date(cap.createdAt).toLocaleDateString()}</span>
    </div>
    <div class="cap-meta-row__item">
      <span class="cap-meta-row__label">Last Enriched</span>
      <span class="cap-meta-row__value">${new Date(cap.lastEnrichedAt).toLocaleDateString()}</span>
    </div>
  `;
  detailBody.appendChild(metaRow);

  // ── Purpose ──
  if (cap.purpose) {
    const purposeSection = createSection('Purpose');
    const purposeEl = document.createElement('p');
    purposeEl.style.fontSize = '13px';
    purposeEl.style.lineHeight = '1.5';
    purposeEl.textContent = cap.purpose;
    purposeSection.appendChild(purposeEl);
    detailBody.appendChild(purposeSection);
  }

  // ── Inputs ──
  if (cap.inputs.length > 0) {
    detailBody.appendChild(renderInputs(cap.inputs));
  }

  // ── Validation Rules ──
  if (cap.validationRules.length > 0) {
    detailBody.appendChild(renderValidationRules(cap.validationRules));
  }

  // ── Observed Outcomes ──
  if (cap.observedOutcomes.length > 0) {
    detailBody.appendChild(renderOutcomes(cap.observedOutcomes));
  }

  // ── Business Rules ──
  if (cap.businessRules.length > 0) {
    detailBody.appendChild(renderBusinessRules(cap.businessRules));
  }

  // ── Failure Modes ──
  if (cap.failureModes.length > 0) {
    detailBody.appendChild(renderFailureModes(cap.failureModes));
  }

  // ── Enrichment History ──
  if (cap.enrichmentHistory.length > 0) {
    detailBody.appendChild(renderEnrichmentHistory(cap.enrichmentHistory));
  }

  detailPanel.hidden = false;
}

function renderInputs(inputs: readonly CapabilityInput[]): HTMLElement {
  const section = createSection('Inputs');

  const list = document.createElement('div');
  list.className = 'cap-input-list';

  for (const input of inputs) {
    const item = document.createElement('div');
    item.className = 'cap-input-item';

    const label = document.createElement('span');
    label.className = 'cap-input-item__label';
    label.textContent = input.label;

    const type = document.createElement('span');
    type.className = 'cap-input-item__type';
    type.textContent = input.fieldType;

    item.append(label, type);

    if (input.required) {
      const required = document.createElement('span');
      required.className = 'cap-input-item__required';
      required.textContent = 'required';
      item.appendChild(required);
    }

    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function renderValidationRules(rules: readonly CapabilityValidationRule[]): HTMLElement {
  const section = createSection('Validation Rules');

  const list = document.createElement('div');
  list.className = 'cap-validation-list';

  for (const rule of rules) {
    const item = document.createElement('div');
    item.className = 'cap-validation-item';

    const field = document.createElement('span');
    field.className = 'cap-validation-item__field';
    field.textContent = rule.fieldLabel;

    const colon = document.createElement('span');
    colon.textContent = ': ';

    const ruleText = document.createElement('span');
    ruleText.className = 'cap-validation-item__rule';
    ruleText.textContent = rule.ruleType;

    const sourceBadge = document.createElement('span');
    sourceBadge.className = 'cap-validation-item__type';
    sourceBadge.textContent = rule.source;
    sourceBadge.style.cssText = 'font-size:10px;color:var(--color-text-secondary);margin-left:auto;';

    item.append(field, colon, ruleText, sourceBadge);
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function renderOutcomes(outcomes: readonly CapabilityOutcome[]): HTMLElement {
  const section = createSection('Observed Outcomes');

  const list = document.createElement('div');
  list.className = 'cap-outcome-list';

  for (const outcome of outcomes) {
    const item = document.createElement('div');
    item.className = 'cap-outcome-item';

    const desc = document.createElement('div');
    desc.className = 'cap-outcome-item__desc';
    desc.textContent = outcome.description;

    item.appendChild(desc);

    if (outcome.successIndicators.length > 0) {
      const indicators = document.createElement('div');
      indicators.className = 'cap-outcome-item__indicators';

      for (const indicator of outcome.successIndicators) {
        const badge = document.createElement('span');
        badge.className = 'cap-outcome-item__indicator';
        badge.textContent = indicator;
        indicators.appendChild(badge);
      }

      item.appendChild(indicators);
    }

    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function renderBusinessRules(rules: readonly Capability['businessRules']): HTMLElement {
  const section = createSection('Business Rules');

  const list = document.createElement('div');
  list.className = 'cap-input-list';

  for (const rule of rules) {
    const item = document.createElement('div');
    item.className = 'cap-input-item';

    const desc = document.createElement('span');
    desc.className = 'cap-input-item__label';
    desc.textContent = rule.description;

    const source = document.createElement('span');
    source.className = 'cap-input-item__type';
    source.textContent = rule.source;

    const confirmed = document.createElement('span');
    confirmed.className = 'cap-input-item__type';
    confirmed.textContent = rule.confirmed ? '✓ confirmed' : '? unconfirmed';
    confirmed.style.color = rule.confirmed ? '#065f46' : '#92400e';

    item.append(desc, source, confirmed);
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function renderFailureModes(modes: readonly Capability['failureModes']): HTMLElement {
  const section = createSection('Known Failure Modes');

  const list = document.createElement('div');
  list.className = 'cap-input-list';

  for (const mode of modes) {
    const item = document.createElement('div');
    item.className = 'cap-input-item';
    item.style.background = '#fef2f2';

    const desc = document.createElement('span');
    desc.className = 'cap-input-item__label';
    desc.style.color = '#991b1b';
    desc.textContent = mode.description;

    const trigger = document.createElement('span');
    trigger.className = 'cap-input-item__type';
    trigger.textContent = mode.trigger;

    item.append(desc, trigger);
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function renderEnrichmentHistory(history: readonly EnrichmentEvent[]): HTMLElement {
  const section = createSection('Enrichment History');

  const list = document.createElement('div');
  list.className = 'cap-enrichment-list';

  // Show most recent first
  const sorted = [...history].reverse();

  for (const event of sorted) {
    const item = document.createElement('div');
    item.className = 'cap-enrichment-item';

    const type = document.createElement('span');
    type.className = 'cap-enrichment-item__type';
    type.textContent = event.type.replace(/-/g, ' ');

    const time = document.createElement('span');
    time.className = 'cap-enrichment-item__time';
    time.textContent = new Date(event.timestamp).toLocaleDateString();

    const desc = document.createElement('span');
    desc.className = 'cap-enrichment-item__desc';
    desc.textContent = event.description;

    item.append(type, time, desc);
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function createSection(title: string): HTMLElement {
  const section = document.createElement('div');
  section.className = 'cap-section';

  const heading = document.createElement('h3');
  heading.className = 'cap-section__title';
  heading.textContent = title;

  section.appendChild(heading);
  return section;
}

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
import { ElementStatus, LocatorStrategyType } from '../domain/enums';

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
  for (const [projectId, group] of result) {
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

function renderElementDetail(el: Element): void {
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

  elementDetailPanel.hidden = false;
}

elementDetailCloseBtn.addEventListener('click', () => {
  elementDetailPanel.hidden = true;
});

// ════════ REFRESH DISPATCHER ═══════════════════════════════════

async function refresh(): Promise<void> {
  if (activeView === 'capabilities') {
    await refreshCapabilities();
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

detailCloseBtn.addEventListener('click', () => {
  detailPanel.hidden = true;
  selectedCapabilityId = null;
  document.querySelectorAll('.cap-card').forEach((c) => c.classList.remove('cap-card--selected'));
});

classicDetailCloseBtn.addEventListener('click', () => {
  classicDetailPanel.hidden = true;
});

// ════════ INIT ═════════════════════════════════════════════════

refresh();
