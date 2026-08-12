/**
 * Evidence Renderer — Behavioral Evidence Display (M7)
 *
 * Renders dual-scope BehavioralEvidence under each interaction in the
 * side panel. Two clearly separated sections:
 *
 *   🎯 Target Evidence
 *     - Element identity (tag, role, name, id, classes)
 *     - Before → After state (value, checked, disabled, ARIA states)
 *     - Focus movement
 *
 *   🌐 Application Evidence
 *     - DOM changes (summarized, collapsible, max 10 shown)
 *     - New/removed surfaces (dialogs, menus, overlays)
 *     - Visibility changes
 *     - Navigation events
 *     - Network activity (url, method, status, timing)
 *
 * All sections are collapsible to keep the UI bounded for large evidence
 * sets. Late-arriving evidence (via INTERACTION_EVIDENCE_UPDATE) replaces
 * the placeholder or updates the existing evidence section.
 *
 * INV-BEHAV-1: Display only — no causal interpretation, no "effect" labels.
 *
 * Architecture: .drytis/specs/behavioral-evidence-model.md §12.4
 */

import type {
  BehavioralEvidence,
  TargetEvidence,
  TargetStateSnapshot,
  ApplicationEvidence,
  DomChangeSummary,
  SurfaceChange,
  VisibilityChange,
  NavigationEvidence,
  NetworkActivity,
  PerformanceCondition,
} from '../shared/behavioral-evidence-types';
import type { ElementIdentity } from '../shared/types';

// ── Constants ────────────────────────────────────────────────────────

/** Max DOM change entries to show inline before collapsing to "show all". */
const MAX_DOM_CHANGES_DISPLAY = 10;

/** Max network entries to show inline. */
const MAX_NETWORK_DISPLAY = 10;

/** Max surface entries to show inline. */
const MAX_SURFACES_DISPLAY = 5;

/** Max visibility entries to show inline. */
const MAX_VISIBILITY_DISPLAY = 10;

// ── Utility ──────────────────────────────────────────────────────────

function truncate(str: string | null | undefined, max: number): string {
  if (str == null) return '—';
  if (str.length <= max) return str;
  return str.substring(0, max) + '…';
}

function safeText(text: unknown): string {
  if (text === null || text === undefined) return '—';
  return String(text);
}

// ── Target Evidence Rendering ────────────────────────────────────────

/**
 * Render the element identity section as a compact summary line.
 */
function renderIdentity(identity: ElementIdentity | null | undefined): HTMLElement {
  const container = document.createElement('div');
  container.className = 'evidence-identity';

  if (!identity) {
    const main = document.createElement('div');
    main.className = 'evidence-identity__main';
    main.textContent = 'Unknown element';
    container.appendChild(main);
    return container;
  }

  const parts: string[] = [];
  if (identity.tag) parts.push(identity.tag);
  if (identity.stableId) parts.push(`#${identity.stableId}`);
  if (identity.ariaRole) parts.push(`[role=${identity.ariaRole}]`);
  if (identity.accessibleName) {
    parts.push(`"${truncate(identity.accessibleName, 40)}"`);
  }

  const main = document.createElement('div');
  main.className = 'evidence-identity__main';
  main.textContent = parts.join(' ') || 'Unknown element';
  container.appendChild(main);

  // Secondary: class names (truncated)
  if (identity.className) {
    const cls = document.createElement('div');
    cls.className = 'evidence-identity__secondary';
    cls.textContent = truncate(identity.className, 80);
    container.appendChild(cls);
  }

  // Input type if present
  if (identity.inputType) {
    const it = document.createElement('div');
    it.className = 'evidence-identity__secondary';
    it.textContent = `type=${identity.inputType}`;
    container.appendChild(it);
  }

  return container;
}

/**
 * Format a TargetStateSnapshot as a readable list.
 */
function formatSnapshot(snapshot: TargetStateSnapshot | null): string[] {
  if (!snapshot) return ['(no prior state captured)'];

  const lines: string[] = [];

  if (snapshot.value !== null && snapshot.value !== undefined && snapshot.value !== '') {
    lines.push(`value: ${truncate(snapshot.value, 50)}`);
  }
  if (snapshot.checked !== null) {
    lines.push(`checked: ${snapshot.checked}`);
  }
  if (snapshot.disabled) {
    lines.push(`disabled: true`);
  }
  if (snapshot.ariaExpanded !== null) {
    lines.push(`aria-expanded: ${snapshot.ariaExpanded}`);
  }
  if (snapshot.ariaChecked !== null) {
    lines.push(`aria-checked: ${snapshot.ariaChecked}`);
  }
  if (snapshot.ariaPressed !== null) {
    lines.push(`aria-pressed: ${snapshot.ariaPressed}`);
  }
  if (snapshot.textContent) {
    lines.push(`text: ${truncate(snapshot.textContent, 50)}`);
  }
  lines.push(`children: ${snapshot.childCount}`);

  return lines.length > 0 ? lines : ['(no state properties)'];
}

/**
 * Compute the diff between before and after snapshots.
 * Returns only changed lines.
 */
function diffSnapshots(
  before: TargetStateSnapshot | null,
  after: TargetStateSnapshot | null,
): string[] {
  if (!before && !after) return [];
  if (!before) return formatSnapshot(after);
  if (!after) return ['(element removed)'];

  const changes: string[] = [];
  const fields: Array<[keyof TargetStateSnapshot, string]> = [
    ['value', 'value'],
    ['checked', 'checked'],
    ['disabled', 'disabled'],
    ['ariaExpanded', 'aria-expanded'],
    ['ariaChecked', 'aria-checked'],
    ['ariaPressed', 'aria-pressed'],
    ['textContent', 'text'],
    ['childCount', 'children'],
    ['scrollTop', 'scroll-top'],
    ['scrollLeft', 'scroll-left'],
    ['selectedValues', 'selected-values'],
    ['controlledValue', 'controlled-value'],
  ];

  for (const [field, label] of fields) {
    const oldVal = before[field];
    const newVal = after[field];
    // P1-3: Skip null === null and identical arrays
    if (oldVal === newVal) continue;
    // Handle array comparison (selectedValues)
    if (Array.isArray(oldVal) && Array.isArray(newVal)) {
      if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;
    }
    if (oldVal === null && newVal === null) continue;
    // Skip null → null transitions (no change)
    if (oldVal == null && newVal == null) continue;

    const oldText = Array.isArray(oldVal)
      ? (oldVal as string[]).join(', ')
      : safeText(oldVal);
    const newText = Array.isArray(newVal)
      ? (newVal as string[]).join(', ')
      : safeText(newVal);
    // Show empty strings as (empty) for clarity
    const oldDisplay = oldText === '' ? '(empty)' : oldText;
    const newDisplay = newText === '' ? '(empty)' : newText;
    changes.push(`${label}: ${oldDisplay} → ${newDisplay}`);
  }

  return changes;
}

/**
 * Render the Target Evidence section.
 */
function renderTargetEvidence(target: TargetEvidence | null | undefined): HTMLElement {
  const section = document.createElement('div');
  section.className = 'evidence-section evidence-section--target';
  section.dataset.evidenceScope = 'target';

  // Header
  const header = document.createElement('div');
  header.className = 'evidence-section__header';
  header.innerHTML = '';
  const icon = document.createElement('span');
  icon.textContent = '🎯';
  icon.className = 'evidence-section__icon';
  const title = document.createElement('span');
  title.textContent = 'Target Evidence';
  title.className = 'evidence-section__title';
  header.append(icon, title);
  section.appendChild(header);

  // Body (collapsible)
  const body = document.createElement('div');
  body.className = 'evidence-section__body';

  if (!target) {
    const empty = document.createElement('div');
    empty.className = 'evidence-row evidence-row--muted';
    empty.textContent = 'No target evidence available';
    body.appendChild(empty);
    section.appendChild(body);
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      body.hidden = !body.hidden;
      icon.textContent = body.hidden ? '▶' : '🎯';
    });
    return section;
  }

  // Identity
  const identityHeader = document.createElement('div');
  identityHeader.className = 'evidence-subheader';
  identityHeader.textContent = 'Element';
  body.appendChild(identityHeader);
  body.appendChild(renderIdentity(target.identity));

  // State diff
  const diff = diffSnapshots(target.before, target.after);
  if (diff.length > 0) {
    const stateHeader = document.createElement('div');
    stateHeader.className = 'evidence-subheader';
    stateHeader.textContent = 'State Changes';
    body.appendChild(stateHeader);

    for (const line of diff) {
      const row = document.createElement('div');
      row.className = 'evidence-row evidence-row--diff';
      row.textContent = line;
      body.appendChild(row);
    }
  } else {
    const noChange = document.createElement('div');
    noChange.className = 'evidence-row evidence-row--muted';
    noChange.textContent = 'No observable state changes';
    body.appendChild(noChange);
  }

  // Focus movement
  if (target.focusMovement) {
    const fm = target.focusMovement;
    const focusHeader = document.createElement('div');
    focusHeader.className = 'evidence-subheader';
    focusHeader.textContent = 'Focus Movement';
    body.appendChild(focusHeader);

    const focusRow = document.createElement('div');
    focusRow.className = 'evidence-row';
    const beforeParts = fm.before
      ? [fm.before.tagName, fm.before.ariaRole ? `[${fm.before.ariaRole}]` : '', fm.before.accessibleName ? `"${truncate(fm.before.accessibleName, 30)}"` : ''].filter(Boolean).join(' ')
      : '(unknown)';
    const afterParts = fm.after
      ? [fm.after.tagName, fm.after.ariaRole ? `[${fm.after.ariaRole}]` : '', fm.after.accessibleName ? `"${truncate(fm.after.accessibleName, 30)}"` : ''].filter(Boolean).join(' ')
      : '(unknown)';
    focusRow.textContent = `${beforeParts} → ${afterParts}`;
    body.appendChild(focusRow);
  }

  section.appendChild(body);

  // Collapsible behavior
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    body.hidden = !body.hidden;
    icon.textContent = body.hidden ? '▶' : '🎯';
  });

  return section;
}

// ── Application Evidence Rendering ───────────────────────────────────

/**
 * Render DOM changes (summarized).
 */
function renderDomChanges(
  changes: DomChangeSummary[],
  overflow: number,
  coarseMode: boolean,
): HTMLElement | null {
  const safeChanges = changes ?? [];
  if (safeChanges.length === 0 && overflow === 0) return null;

  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'evidence-subheader';
  const overflowText = overflow > 0 ? ` (${overflow} more dropped)` : '';
  const coarseText = coarseMode ? ' ⚠️ high-churn' : '';
  header.textContent = `DOM Changes (${safeChanges.length}${overflowText}${coarseText})`;
  container.appendChild(header);

  const visible = safeChanges.slice(0, MAX_DOM_CHANGES_DISPLAY);
  for (const change of visible) {
    const row = document.createElement('div');
    row.className = 'evidence-row';

    const parts: string[] = [];
    parts.push((change.types ?? []).join('+'));
    parts.push(`<${change.targetTag ?? 'unknown'}>`);
    if (change.shadowContext) {
      parts.push(`[shadow: ${truncate(change.shadowContext, 30)}]`);
    }
    const attrs = change.changedAttributes ?? [];
    const deltas = change.attributeDeltas ?? {};
    if (attrs.length > 0) {
      const attrDiffs = attrs.map((attr) => {
        const delta = deltas[attr];
        if (delta) {
          return `${attr}: ${truncate(safeText(delta.old), 20)} → ${truncate(safeText(delta.new), 20)}`;
        }
        return attr;
      });
      parts.push(attrDiffs.join(', '));
    }
    if (change.addedNodesCount > 0) parts.push(`+${change.addedNodesCount} nodes`);
    if (change.removedNodesCount > 0) parts.push(`-${change.removedNodesCount} nodes`);
    if (change.characterDataDelta) {
      parts.push(`text: ${truncate(safeText(change.characterDataDelta.old), 20)} → ${truncate(safeText(change.characterDataDelta.new), 20)}`);
    }

    row.textContent = truncate(parts.join(' · '), 150);
    container.appendChild(row);
  }

  // "Show more" indicator
  if (safeChanges.length > MAX_DOM_CHANGES_DISPLAY) {
    const more = document.createElement('div');
    more.className = 'evidence-row evidence-row--muted';
    more.textContent = `… ${safeChanges.length - MAX_DOM_CHANGES_DISPLAY} more`;
    container.appendChild(more);
  }

  return container;
}

/**
 * Render surface changes (new/removed dialogs, menus, overlays).
 */
function renderSurfaces(
  surfaces: SurfaceChange[],
  label: string,
): HTMLElement | null {
  const safeSurfaces = surfaces ?? [];
  if (safeSurfaces.length === 0) return null;

  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'evidence-subheader';
  header.textContent = `${label} (${safeSurfaces.length})`;
  container.appendChild(header);

  for (const surface of safeSurfaces.slice(0, MAX_SURFACES_DISPLAY)) {
    const row = document.createElement('div');
    row.className = 'evidence-row';
    const parts = [
      `<${surface.tagName ?? 'unknown'}>`,
      surface.ariaRole ? `[role=${surface.ariaRole}]` : '',
      surface.accessibleName ? `"${truncate(surface.accessibleName, 40)}"` : '',
    ].filter(Boolean);
    row.textContent = parts.join(' ');
    container.appendChild(row);
  }

  if (safeSurfaces.length > MAX_SURFACES_DISPLAY) {
    const more = document.createElement('div');
    more.className = 'evidence-row evidence-row--muted';
    more.textContent = `… ${safeSurfaces.length - MAX_SURFACES_DISPLAY} more`;
    container.appendChild(more);
  }

  return container;
}

/**
 * Render visibility changes.
 */
function renderVisibilityChanges(changes: VisibilityChange[]): HTMLElement | null {
  const safeChanges = changes ?? [];
  if (safeChanges.length === 0) return null;

  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'evidence-subheader';
  header.textContent = `Visibility Changes (${safeChanges.length})`;
  container.appendChild(header);

  for (const change of safeChanges.slice(0, MAX_VISIBILITY_DISPLAY)) {
    const row = document.createElement('div');
    row.className = 'evidence-row';
    row.textContent = `${change.property ?? 'unknown'}: ${safeText(change.oldValue)} → ${safeText(change.newValue)} (${truncate(change.path, 40)})`;
    container.appendChild(row);
  }

  if (safeChanges.length > MAX_VISIBILITY_DISPLAY) {
    const more = document.createElement('div');
    more.className = 'evidence-row evidence-row--muted';
    more.textContent = `… ${safeChanges.length - MAX_VISIBILITY_DISPLAY} more`;
    container.appendChild(more);
  }

  return container;
}

/**
 * Render navigation evidence.
 */
function renderNavigation(nav: NavigationEvidence[]): HTMLElement | null {
  const safeNav = nav ?? [];
  if (safeNav.length === 0) return null;

  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'evidence-subheader';
  header.textContent = `Navigation (${safeNav.length})`;
  container.appendChild(header);

  for (const event of safeNav) {
    const row = document.createElement('div');
    row.className = 'evidence-row';
    row.textContent = `${event.type ?? 'navigation'}: ${truncate(event.fromUrl, 40)} → ${truncate(event.toUrl, 40)}`;
    container.appendChild(row);
  }

  return container;
}

/**
 * Render network activity.
 */
function renderNetworkActivity(network: NetworkActivity[]): HTMLElement | null {
  const safeNetwork = network ?? [];
  if (safeNetwork.length === 0) return null;

  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'evidence-subheader';
  header.textContent = `Network (${safeNetwork.length})`;
  container.appendChild(header);

  for (const entry of safeNetwork.slice(0, MAX_NETWORK_DISPLAY)) {
    const row = document.createElement('div');
    row.className = 'evidence-row evidence-row--network';

    const statusText = entry.status != null ? `${entry.status}` : '…';
    const durationText = entry.durationMs != null ? `${Math.round(entry.durationMs)}ms` : '';
    const srcLabel = entry.source === 'main-world' ? '🔵' : '🟣';

    row.textContent = `${srcLabel} ${entry.method ?? '?'} ${statusText} ${truncate(entry.url, 60)} ${durationText}`;
    container.appendChild(row);
  }

  if (safeNetwork.length > MAX_NETWORK_DISPLAY) {
    const more = document.createElement('div');
    more.className = 'evidence-row evidence-row--muted';
    more.textContent = `… ${safeNetwork.length - MAX_NETWORK_DISPLAY} more`;
    container.appendChild(more);
  }

  return container;
}

/**
 * Render performance condition.
 */
function renderPerformanceCondition(perf: PerformanceCondition | null): HTMLElement | null {
  if (!perf) return null;

  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'evidence-subheader';
  header.textContent = 'Performance';
  container.appendChild(header);

  const row = document.createElement('div');
  row.className = 'evidence-row';
  const parts: string[] = [];
  parts.push(`${perf.totalBatches} batches`);
  parts.push(`longest: ${Math.round(perf.longestBatchMs)}ms`);
  if (perf.mainThreadBlocked) parts.push('⚠️ main thread blocked');
  if (perf.highChurnMode) parts.push('⚠️ high-churn');
  row.textContent = parts.join(' · ');
  container.appendChild(row);

  return container;
}

/**
 * Render the full Application Evidence section.
 */
function renderApplicationEvidence(app: ApplicationEvidence | null | undefined): HTMLElement {
  const section = document.createElement('div');
  section.className = 'evidence-section evidence-section--application';
  section.dataset.evidenceScope = 'application';

  // Header
  const header = document.createElement('div');
  header.className = 'evidence-section__header';
  const icon = document.createElement('span');
  icon.textContent = '🌐';
  icon.className = 'evidence-section__icon';
  const title = document.createElement('span');
  title.textContent = 'Application Evidence';
  title.className = 'evidence-section__title';
  header.append(icon, title);
  section.appendChild(header);

  // Body (collapsible)
  const body = document.createElement('div');
  body.className = 'evidence-section__body';

  if (!app) {
    const empty = document.createElement('div');
    empty.className = 'evidence-row evidence-row--muted';
    empty.textContent = 'No application evidence available';
    body.appendChild(empty);
    section.appendChild(body);
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      body.hidden = !body.hidden;
      icon.textContent = body.hidden ? '▶' : '🌐';
    });
    return section;
  }

  // DOM changes
  const domEl = renderDomChanges(app.domChanges, app.domChangeOverflow ?? 0, app.coarseMode ?? false);
  if (domEl) body.appendChild(domEl);

  // New surfaces
  const newSurfEl = renderSurfaces(app.newSurfaces, 'New Surfaces');
  if (newSurfEl) body.appendChild(newSurfEl);

  // Removed surfaces
  const remSurfEl = renderSurfaces(app.removedSurfaces, 'Removed Surfaces');
  if (remSurfEl) body.appendChild(remSurfEl);

  // Visibility changes
  const visEl = renderVisibilityChanges(app.visibilityChanges);
  if (visEl) body.appendChild(visEl);

  // Navigation
  const navEl = renderNavigation(app.navigation);
  if (navEl) body.appendChild(navEl);

  // Network activity
  const netEl = renderNetworkActivity(app.networkActivity);
  if (netEl) body.appendChild(netEl);

  // Performance
  const perfEl = renderPerformanceCondition(app.performanceCondition);
  if (perfEl) body.appendChild(perfEl);

  // Empty state
  if (body.children.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'evidence-row evidence-row--muted';
    empty.textContent = 'No application-level changes detected';
    body.appendChild(empty);
  }

  section.appendChild(body);

  // Collapsible behavior
  header.style.cursor = 'pointer';
  header.addEventListener('click', () => {
    body.hidden = !body.hidden;
    icon.textContent = body.hidden ? '▶' : '🌐';
  });

  return section;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Container attribute marking where evidence is rendered within an interaction element.
 */
export const EVIDENCE_CONTAINER_ATTR = 'data-evidence-container';

/**
 * Render full BehavioralEvidence into a container element.
 * Creates two clearly separated sections (Target + Application).
 *
 * If called on a container that already has evidence, replaces the
 * existing content (supports late-arriving evidence updates).
 *
 * P1-3 Fix: If the evidence has endReason 'evidence-timeout' or
 * 'page-reload-synthetic', renders a special timeout/synthetic notice
 * instead of the normal evidence display.
 */
export function renderEvidence(
  container: HTMLElement,
  evidence: BehavioralEvidence,
): void {
  // Clear any existing evidence
  container.innerHTML = '';
  container.setAttribute(EVIDENCE_CONTAINER_ATTR, 'true');

  // P1-3: Handle timeout / synthetic evidence
  const endReason = evidence?.window?.endReason ?? 'unknown';
  if (endReason === 'evidence-timeout') {
    const notice = document.createElement('div');
    notice.className = 'evidence-timeout-notice';
    notice.textContent = '⏱ No behavioral evidence (5s timeout)';
    container.appendChild(notice);
    return;
  }

  // Window metadata line
  const windowMeta = document.createElement('div');
  windowMeta.className = 'evidence-window-meta';
  const win = evidence?.window;
  const durationMs = win?.durationMs ?? 0;
  const durationText = `${Math.round(durationMs)}ms`;
  windowMeta.textContent = `Window: ${durationText} · ${endReason}`;
  if (evidence?.frameId && evidence.frameId !== 'main') {
    windowMeta.textContent += ` · frame: ${truncate(evidence.frameId, 30)}`;
  }
  container.appendChild(windowMeta);

  // P1-3: Show synthetic notice for page-reload navigations
  if (endReason === 'page-reload-synthetic') {
    const notice = document.createElement('div');
    notice.className = 'evidence-synthetic-notice';
    notice.textContent = '📋 Navigation evidence (page reloaded — behavioral details unavailable)';
    container.appendChild(notice);
  }

  // Target evidence section
  container.appendChild(renderTargetEvidence(evidence?.targetEvidence));

  // Separator
  const separator = document.createElement('div');
  separator.className = 'evidence-separator';
  container.appendChild(separator);

  // Application evidence section
  container.appendChild(renderApplicationEvidence(evidence?.applicationEvidence));
}

/**
 * Create a placeholder element for evidence that hasn't arrived yet.
 * Shown initially, replaced when evidence arrives via INTERACTION_EVIDENCE_UPDATE.
 */
export function renderEvidencePlaceholder(): HTMLElement {
  const placeholder = document.createElement('div');
  placeholder.className = 'evidence-placeholder';
  placeholder.textContent = '⏳ Collecting behavioral evidence…';
  return placeholder;
}

/**
 * Check whether an interaction element already has an evidence container.
 */
export function hasEvidenceContainer(el: HTMLElement): HTMLElement | null {
  return el.querySelector(`[${EVIDENCE_CONTAINER_ATTR}]`) as HTMLElement | null;
}

/**
 * Update evidence on an existing interaction element.
 * If evidence is already displayed, replaces it.
 * If a placeholder exists, replaces the placeholder.
 * If neither exists, appends a new evidence container.
 */
export function updateEvidenceOnInteraction(
  interactionEl: HTMLElement,
  evidence: BehavioralEvidence,
): void {
  // Check for existing evidence container
  const existing = hasEvidenceContainer(interactionEl);
  if (existing) {
    renderEvidence(existing, evidence);
    return;
  }

  // Check for placeholder
  const placeholder = interactionEl.querySelector('.evidence-placeholder');
  if (placeholder) {
    placeholder.remove();
  }

  // Append new evidence container
  const container = document.createElement('div');
  container.className = 'evidence-container';
  interactionEl.appendChild(container);
  renderEvidence(container, evidence);
}
