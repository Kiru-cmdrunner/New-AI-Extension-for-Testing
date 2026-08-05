/**
 * Behavioral Renderer — M1 Evidence Display (Phase E)
 *
 * Renders ObservationResult[] as a collapsible "Behavioral Evidence" section
 * under each interaction in the side panel timeline.
 *
 * M1 boundary: this module DISPLAYS evidence only. No semantic interpretation,
 * no classification, no causation claims. It shows exactly what was captured.
 *
 * Evidence is rendered from two complementary sources:
 * - Phase A (ElementStateSnapshot): DOM property before → after
 * - Phase B (MutationRecord2): attribute/text/structural old → new
 *
 * Architecture: .drytis/specs/m1-phase-e-design.md
 */

import type {
  ObservationResult,
  ElementStateSnapshot,
  MutationRecord2,
} from '../shared/observation-types';
import type { SemanticEffect, EffectCategory } from '../semantics/effect-types';

// ── Property display config ──────────────────────────────────────────

interface PropertyDisplay {
  label: string;
  format: (v: unknown) => string;
}

const STATE_PROPERTIES: { key: keyof ElementStateSnapshot; display: PropertyDisplay }[] = [
  { key: 'value',        display: { label: 'value',     format: (v) => v === null ? '(null)' : `"${String(v)}"` } },
  { key: 'checked',      display: { label: 'checked',   format: (v) => v === null ? '(null)' : String(v) } },
  { key: 'className',    display: { label: 'class',     format: (v) => `"${String(v)}"` } },
  { key: 'disabled',     display: { label: 'disabled',  format: (v) => String(v) } },
  { key: 'ariaExpanded', display: { label: 'aria-expanded', format: (v) => v === null ? '(null)' : String(v) } },
  { key: 'ariaChecked',  display: { label: 'aria-checked',  format: (v) => v === null ? '(null)' : String(v) } },
  { key: 'ariaPressed',  display: { label: 'aria-pressed',  format: (v) => v === null ? '(null)' : String(v) } },
  { key: 'textContent',  display: { label: 'text',      format: (v) => v === null ? '(null)' : `"${String(v)}"` } },
  { key: 'childCount',   display: { label: 'childCount', format: (v) => String(v) } },
];

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Format a timestamp relative to window open time.
 * @param ts mutation timestamp (performance.now)
 * @param openedAt window open timestamp (performance.now)
 */
function formatRelativeTime(ts: number, openedAt: number): string {
  const delta = Math.round(ts - openedAt);
  return `+${delta}ms`;
}

/**
 * Format duration in ms.
 */
function formatDuration(ms: number): string {
  return `${Math.round(ms)}ms`;
}

/**
 * Escape HTML to prevent XSS from DOM values in evidence display.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Truncate a string to maxLen, appending '…' if truncated.
 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '…';
}

// ── Snapshot Rendering ────────────────────────────────────────────────

/**
 * Render before → after ElementStateSnapshot comparison.
 *
 * Shows each property that has a value in at least one snapshot.
 * Changed values get a highlighted arrow. Unchanged values are greyed.
 * Properties that are null in both snapshots are omitted.
 */
function renderStateDiff(
  before: ElementStateSnapshot | null,
  after: ElementStateSnapshot | null,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'behavioral-state-diff';

  const hasAny = before || after;
  if (!hasAny) {
    const note = document.createElement('div');
    note.className = 'behavioral-state-diff__note';
    note.textContent = 'No element state captured';
    container.appendChild(note);
    return container;
  }

  for (const { key, display } of STATE_PROPERTIES) {
    const bVal = before ? before[key] : null;
    const aVal = after ? after[key] : null;

    // Skip properties that are null/absent in both
    if (bVal === null && aVal === null) continue;
    // Skip className if empty in both
    if (key === 'className' && !bVal && !aVal) continue;

    const row = document.createElement('div');
    row.className = 'behavioral-state-row';

    const label = document.createElement('span');
    label.className = 'behavioral-state-row__label';
    label.textContent = display.label;
    row.appendChild(label);

    const beforeText = display.format(bVal);
    const afterText = display.format(aVal);
    const changed = beforeText !== afterText;

    const beforeEl = document.createElement('span');
    beforeEl.className = changed
      ? 'behavioral-state-row__before behavioral-state-row__changed'
      : 'behavioral-state-row__before behavioral-state-row__unchanged';
    beforeEl.textContent = beforeText;
    row.appendChild(beforeEl);

    if (changed) {
      const arrow = document.createElement('span');
      arrow.className = 'behavioral-state-row__arrow';
      arrow.textContent = '→';
      row.appendChild(arrow);

      const afterEl = document.createElement('span');
      afterEl.className = 'behavioral-state-row__after behavioral-state-row__changed';
      afterEl.textContent = afterText;
      row.appendChild(afterEl);
    }

    container.appendChild(row);
  }

  if (container.children.length === 0) {
    const note = document.createElement('div');
    note.className = 'behavioral-state-diff__note';
    note.textContent = 'No meaningful state properties';
    container.appendChild(note);
  }

  return container;
}

// ── Mutation Rendering ────────────────────────────────────────────────

/**
 * Format a mutation as a human-readable string.
 */
function formatMutationLabel(mutation: MutationRecord2): string {
  switch (mutation.type) {
    case 'attributes': {
      const attr = mutation.attributeName ?? '?';
      const oldVal = mutation.oldValue !== null ? escapeHtml(truncate(`"${mutation.oldValue}"`, 80)) : '(none)';
      const newVal = mutation.newValue !== null ? escapeHtml(truncate(`"${mutation.newValue}"`, 80)) : '(none)';
      return `${attr}: ${oldVal} → ${newVal}`;
    }
    case 'characterData': {
      const oldVal = mutation.oldValue !== null ? escapeHtml(truncate(`"${mutation.oldValue}"`, 80)) : '(none)';
      const newVal = mutation.newValue !== null ? escapeHtml(truncate(`"${mutation.newValue}"`, 80)) : '(none)';
      return `text: ${oldVal} → ${newVal}`;
    }
    case 'childList': {
      const parts: string[] = [];
      if (mutation.addedNodesCount > 0) parts.push(`+${mutation.addedNodesCount} node${mutation.addedNodesCount > 1 ? 's' : ''}`);
      if (mutation.removedNodesCount > 0) parts.push(`-${mutation.removedNodesCount} node${mutation.removedNodesCount > 1 ? 's' : ''}`);
      return parts.length > 0 ? parts.join(' · ') : 'no net change';
    }
    default:
      return 'unknown mutation type';
  }
}

/**
 * Render a single MutationRecord2 as a line item.
 */
function renderMutation(mutation: MutationRecord2, openedAt: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'behavioral-mutation-row';

  const path = document.createElement('span');
  path.className = 'behavioral-mutation-row__path';
  path.textContent = truncate(mutation.targetPath, 120);
  path.title = mutation.targetPath;
  row.appendChild(path);

  const detail = document.createElement('span');
  detail.className = 'behavioral-mutation-row__detail';
  detail.textContent = formatMutationLabel(mutation);
  row.appendChild(detail);

  const time = document.createElement('span');
  time.className = 'behavioral-mutation-row__time';
  time.textContent = formatRelativeTime(mutation.timestamp, openedAt);
  row.appendChild(time);

  return row;
}

/**
 * Render all mutations for a result, grouped by target element.
 */
function renderMutations(
  mutations: MutationRecord2[],
  openedAt: number,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'behavioral-mutations';

  if (mutations.length === 0) {
    const note = document.createElement('div');
    note.className = 'behavioral-mutations__note';
    note.textContent = 'No DOM mutations captured';
    container.appendChild(note);
    return container;
  }

  // Group by target path
  const groups = new Map<string, MutationRecord2[]>();
  for (const m of mutations) {
    const group = groups.get(m.targetPath);
    if (group) {
      group.push(m);
    } else {
      groups.set(m.targetPath, [m]);
    }
  }

  const header = document.createElement('div');
  header.className = 'behavioral-mutations__header';
  header.textContent = `Mutations (${mutations.length})`;
  container.appendChild(header);

  for (const [path, group] of groups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'behavioral-mutation-group';

    const pathLabel = document.createElement('div');
    pathLabel.className = 'behavioral-mutation-group__path';
    pathLabel.textContent = path;
    pathLabel.title = path;
    groupEl.appendChild(pathLabel);

    for (const m of group) {
      groupEl.appendChild(renderMutation(m, openedAt));
    }

    container.appendChild(groupEl);
  }

  return container;
}

// ── Window Metadata ──────────────────────────────────────────────────

/**
 * Render observation window metadata footer.
 */
function renderWindowMeta(result: ObservationResult): HTMLElement {
  const meta = document.createElement('div');
  meta.className = 'behavioral-window-meta';

  const parts: string[] = [];
  parts.push(formatDuration(result.durationMs));
  parts.push(result.endReason);
  parts.push(`${result.mutationCount} mutation${result.mutationCount !== 1 ? 's' : ''}`);

  if (result.documentWideMutationTotal !== result.mutationCount) {
    parts.push(`${result.documentWideMutationTotal} doc-wide`);
  }

  meta.textContent = parts.join(' · ');

  // Performance condition diagnostic (purely informational)
  if (result.performanceCondition) {
    const pc = result.performanceCondition;
    const badge = document.createElement('span');
    badge.className = 'behavioral-perf-badge';
    badge.textContent = `⚠️ heavy DOM (${pc.batchRecordCount} mutations in ${Math.round(pc.batchDurationMs)}ms)`;
    badge.title = 'Purely diagnostic — does not affect capture, classification, or reliability';
    meta.appendChild(badge);
  }

  return meta;
}

// ── Single Observation Result ─────────────────────────────────────────

/**
 * Render one ObservationResult as a card.
 */
function createObservationResultElement(result: ObservationResult): HTMLElement {
  const card = document.createElement('div');
  card.className = 'behavioral-result-card';

  // Window header
  const header = document.createElement('div');
  header.className = 'behavioral-result-card__header';

  const eventType = document.createElement('span');
  eventType.className = 'behavioral-result-card__event-type';
  eventType.textContent = result.sourceEventType;
  header.appendChild(eventType);

  const windowId = document.createElement('span');
  windowId.className = 'behavioral-result-card__window-id';
  windowId.textContent = result.windowId;
  header.appendChild(windowId);

  card.appendChild(header);

  // Before → After state diff
  const stateLabel = document.createElement('div');
  stateLabel.className = 'behavioral-section-label';
  stateLabel.textContent = 'Element State (before → after)';
  card.appendChild(stateLabel);
  card.appendChild(renderStateDiff(result.beforeSnapshot, result.finalSnapshot));

  // Mutations
  card.appendChild(renderMutations(result.mutations, result.openedAt));

  // Window metadata
  card.appendChild(renderWindowMeta(result));

  return card;
}

// ── Semantic Effects Rendering ────────────────────────────────────────

/**
 * Icon for each effect category.
 */
const EFFECT_ICONS: Record<EffectCategory, string> = {
  'state-toggle':         '✓',
  'expand-collapse':      '▾',
  'enable-disable':       '🔓',
  'content-change':       '⟳',
  'visibility-change':    '👁',
  'no-observable-effect': '∅',
  'unclassified':         '?',
};

/**
 * Render semantic effects as a "What happened" section.
 *
 * Always visible (not collapsed). Shows human-readable effect descriptions
 * with confidence badges. Placed ABOVE the raw behavioral evidence.
 *
 * This is a pure display function — no interpretation logic, no side effects.
 *
 * @param effects Semantic effects to display (from observation results)
 * @returns Container element, or null if no effects to show
 */
export function renderSemanticEffects(
  effects: SemanticEffect[],
): HTMLElement | null {
  if (!effects || effects.length === 0) return null;

  const container = document.createElement('div');
  container.className = 'semantic-effects';

  const label = document.createElement('div');
  label.className = 'semantic-effects__label';
  label.textContent = 'What happened';
  container.appendChild(label);

  for (const effect of effects) {
    const row = document.createElement('div');
    row.className = `semantic-effect semantic-effect--${effect.confidence}`;

    // Icon
    const icon = document.createElement('span');
    icon.className = 'semantic-effect__icon';
    icon.textContent = EFFECT_ICONS[effect.category] ?? '•';
    row.appendChild(icon);

    // Description
    const desc = document.createElement('span');
    desc.className = 'semantic-effect__description';
    desc.textContent = effect.description;
    row.appendChild(desc);

    // Confidence badge
    const badge = document.createElement('span');
    badge.className = `semantic-effect__confidence semantic-effect__confidence--${effect.confidence}`;
    badge.textContent = effect.confidence.toUpperCase();
    row.appendChild(badge);

    container.appendChild(row);
  }

  return container;
}

// ── Main Entry Point ──────────────────────────────────────────────────

/**
 * Render behavioral evidence as a collapsible section.
 *
 * Returns a container that is collapsed by default. Clicking the toggle
 * expands the evidence cards.
 *
 * @param observations The observation results to display
 * @returns Collapsible container element
 */
export function renderBehavioralEvidence(
  observations: ObservationResult[],
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'behavioral-evidence';

  // Toggle button (collapsed by default)
  const toggle = document.createElement('button');
  toggle.className = 'collapsible-toggle behavioral-evidence__toggle';
  toggle.textContent = `🔬 Behavioral Evidence (${observations.length})`;
  toggle.setAttribute('aria-expanded', 'false');

  // Content area (hidden by default)
  const content = document.createElement('div');
  content.className = 'behavioral-evidence__content';
  content.hidden = true;

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    content.hidden = expanded;
    toggle.textContent = expanded
      ? `🔬 Behavioral Evidence (${observations.length})`
      : `▼ Behavioral Evidence (${observations.length})`;
  });

  container.appendChild(toggle);

  for (const result of observations) {
    content.appendChild(createObservationResultElement(result));
  }

  container.appendChild(content);
  return container;
}
