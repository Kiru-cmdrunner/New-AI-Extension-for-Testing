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
 *     - Resulting state (semantic snapshot: counters, collections,
 *       entities, status badges, notifications) — Phase 4a
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
  DialogSignal,
  WindowOpenSignal,
  VisibilityChange,
  NavigationEvidence,
  NetworkActivity,
  PerformanceCondition,
} from '../shared/behavioral-evidence-types';
import type { ElementIdentity } from '../shared/types';
import type {
  WirePageContentSnapshot,
  WireObservedItem,
} from '../shared/page-content-wire';
import {
  networkSourceLabel,
  stabilityBars,
  truncateJson,
  RAW_JSON_MAX_CHARS,
} from './evidence-drilldown';

// ── Constants ────────────────────────────────────────────────────────

/** Max DOM change entries to show inline before collapsing to "show all". */
const MAX_DOM_CHANGES_DISPLAY = 10;

/** 7.2-M1: KR deep-link opener seam type (targets match kr-chip's). */
export type KnowledgeLinkOpener = (target: {
  appId?: string;
  entityId?: string;
  signatureKey?: string;
}) => void;

/** 7.2-M1: module-level opener (default null — honest absence). */
let knowledgeLink: KnowledgeLinkOpener | null = null;

/** Max network entries to show inline. */
const MAX_NETWORK_DISPLAY = 10;

/** Max surface entries to show inline. */
const MAX_SURFACES_DISPLAY = 5;

/** Max visibility entries to show inline. */
const MAX_VISIBILITY_DISPLAY = 10;

// Phase 4a — Resulting State display bounds (per-kind; INV-CS4 stays a
// capture-layer invariant — these are display-side caps only, same pattern
// as MAX_DOM_CHANGES_DISPLAY etc.).
const MAX_RESULTING_COUNTERS = 5;
const MAX_RESULTING_COLLECTIONS = 3;
const MAX_RESULTING_ENTITIES = 6;
const MAX_RESULTING_STATUS_BADGES = 3;
const MAX_RESULTING_NOTIFICATIONS = 3;

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
 * Exported for unit tests (6F-M2b renderer pin) — no behavior change.
 */
export function renderIdentity(identity: ElementIdentity | null | undefined): HTMLElement {
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
    ['controlledValue', 'date/input value'],
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

  // 6F-M3 O2: suppress no-op rows — attribute-only with every old==new, no
  // node counts, no characterData delta (nothing materialized; pure noise:
  // 1 of 5 rows in the committed 6E-M2 dump). Filter BEFORE the display cap
  // so suppressed rows never consume slots. Raw evidence objects untouched;
  // the header keeps the raw observed count and reports the hidden tally.
  const material = safeChanges.filter((c) => !isNoOpDomChange(c));
  const noOpHidden = safeChanges.length - material.length;

  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'evidence-subheader';
  const overflowText = overflow > 0 ? ` (${overflow} more dropped)` : '';
  const coarseText = coarseMode ? ' ⚠️ high-churn' : '';
  const noOpText = noOpHidden > 0 ? ` · ${noOpHidden} no-op hidden` : '';
  header.textContent = `DOM Changes (${safeChanges.length}${overflowText}${coarseText}${noOpText})`;
  container.appendChild(header);

  const visible = material.slice(0, MAX_DOM_CHANGES_DISPLAY);
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

    // MS-U2 D4 — dom-change raw detail (collapsed; recorded timings display-only)
    const rawParts: string[] = [];
    if (change.rawMutationCount != null) rawParts.push(`${change.rawMutationCount} mutations`);
    if (change.firstMutationAt != null && change.lastMutationAt != null) {
      rawParts.push(`${Math.round(change.firstMutationAt)}ms → ${Math.round(change.lastMutationAt)}ms`);
    }
    if (change.characterDataDelta) {
      rawParts.push(`text delta: ${truncate(safeText(change.characterDataDelta.old), 20)} → ${truncate(safeText(change.characterDataDelta.new), 20)}`);
    }
    if (rawParts.length > 0) {
      const details = document.createElement('details');
      details.className = 'evidence-drilldown evidence-drilldown--dom';
      const summary = document.createElement('summary');
      summary.textContent = 'raw detail';
      details.appendChild(summary);
      const body = document.createElement('div');
      body.className = 'evidence-row evidence-row--muted';
      body.textContent = rawParts.join(' · ');
      details.appendChild(body);
      container.appendChild(details);
    }
  }

  // "Show more" indicator
  if (material.length > MAX_DOM_CHANGES_DISPLAY) {
    const more = document.createElement('div');
    more.className = 'evidence-row evidence-row--muted';
    more.textContent = `… ${material.length - MAX_DOM_CHANGES_DISPLAY} more`;
    container.appendChild(more);
  }

  return container;
}

/**
 * 6F-M3 O2 — true when a DomChangeSummary row materialized NOTHING for
 * display: attribute-only, every changed attribute's delta has old === new,
 * zero added/removed nodes, no characterData delta. Such rows render as
 * e.g. `class: "x" → "x"` — pure noise.
 *
 * Honesty guard: a changed attribute with a MISSING delta is NOT a no-op
 * (unknown is information). Exported for unit-test pins.
 */
export function isNoOpDomChange(change: DomChangeSummary): boolean {
  if ((change.addedNodesCount ?? 0) !== 0) return false;
  if ((change.removedNodesCount ?? 0) !== 0) return false;
  if (change.characterDataDelta != null) return false;
  const attrs = change.changedAttributes ?? [];
  for (const attr of attrs) {
    const delta = change.attributeDeltas?.[attr];
    if (!delta) return false; // unknown → treat as material
    if (delta.old !== delta.new) return false;
  }
  return true;
}

/**
 * Test seam for renderDomChanges (private renderer — 6F-M3 O2 pins).
 * Behavior-identical to the internal function.
 */
export function renderDomChangesForTest(
  changes: DomChangeSummary[],
  overflow: number,
  coarseMode: boolean,
): HTMLElement | null {
  return renderDomChanges(changes, overflow, coarseMode);
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
      surface.emergence === 'revealed' ? '· revealed' : '',
    ].filter(Boolean);
    row.textContent = parts.join(' ');
    container.appendChild(row);

    // MS-U2 D5 — surface structural detail (collapsed)
    const detParts: string[] = [];
    if (surface.descendantCount != null) detParts.push(`${surface.descendantCount} descendants`);
    if (surface.ariaRole) detParts.push(`role: ${surface.ariaRole}`);
    if (surface.accessibleName) detParts.push(`name: ${truncate(surface.accessibleName, 40)}`);
    if (surface.batchIndex != null) detParts.push(`batch ${surface.batchIndex}`);
    if (surface.relativeTime != null) detParts.push(`at ${Math.round(surface.relativeTime)}ms`);
    if (surface.emergence) detParts.push(`emergence: ${surface.emergence}`);
    if (surface.shadowContext) detParts.push(`[shadow: ${truncate(surface.shadowContext, 30)}]`);
    if (detParts.length > 0) {
      const details = document.createElement('details');
      details.className = 'evidence-drilldown evidence-drilldown--surface';
      const summary = document.createElement('summary');
      summary.textContent = 'surface detail';
      details.appendChild(summary);
      const body = document.createElement('div');
      body.className = 'evidence-row evidence-row--muted';
      body.textContent = detParts.join(' · ');
      details.appendChild(body);
      container.appendChild(details);
    }
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

    // MS-U2 D3 — network drill-down (collapsed; compact row above unchanged)
    const netDetail = renderNetworkDetail(entry);
    if (netDetail) container.appendChild(netDetail);
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
 * MS-U2 D3 — network entry drill-down.
 *
 * Recorded facts only: source label, resourceType, requestId, causal-event
 * join id, requestBody pairs (webRequest-captured POSTs). Absent fields →
 * absent rows.
 */
function renderNetworkDetail(entry: NetworkActivity): HTMLElement | null {
  const parts: string[] = [];
  parts.push(`source: ${networkSourceLabel(entry.source ?? '')}`);
  if (entry.resourceType) parts.push(`type: ${entry.resourceType}`);
  if (entry.requestId) parts.push(`request: ${entry.requestId}`);
  if (entry.sourceEventId) parts.push(`joined to causal event ${entry.sourceEventId}`);
  const bodyEntries = Object.entries(entry.requestBody ?? {});
  for (const [k, v] of bodyEntries.slice(0, 20)) parts.push(`${k}: ${v}`);
  if (bodyEntries.length > 20) parts.push(`… ${bodyEntries.length - 20} more body fields`);

  const details = document.createElement('details');
  details.className = 'evidence-drilldown evidence-drilldown--network';
  const summary = document.createElement('summary');
  summary.textContent = 'network detail';
  details.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'evidence-row evidence-row--muted';
  body.textContent = parts.join(' · ');
  details.appendChild(body);
  return details;
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
 * Phase 4a — Render the resulting-state snapshot (semantic page content at
 * consequence settlement / destination stabilization).
 *
 * Display-only read of applicationEvidence.resultingState (Phase 1 wire
 * shape). Grouped by item kind in a fixed order (how many → what →
 * feedback): counters, collections, entities, status badges, notifications.
 *
 * - Field absent or no items → returns null → NO DOM added: old recordings
 *   and no-consequence actions render exactly as before (the observer emits
 *   null for empty scans, so absent-not-empty is the real production shape).
 * - entity-title items are NOT rendered — they are provenance carriers
 *   (title text for an entity row), redundant in this display.
 * - Entity attributes are not rendered in 4a (single-line rows).
 * - scannedAt is NOT displayed — it is a performance.now()-domain value
 *   (document-local); a raw number would be misleading to users.
 * - INV-BEHAV-1: observed-state display only, no causal language.
 * - INV-CS1: whatever snapshot THIS interaction's own evidence carries is
 *   rendered — Click and Navigation snapshots never merge here.
 */
function renderResultingState(
  rs: WirePageContentSnapshot | null | undefined,
): HTMLElement | null {
  const safeItems = rs?.items ?? [];
  if (!rs || safeItems.length === 0) return null;

  const container = document.createElement('div');

  // Header — honest capture-level count + capture-time overflow indicator
  const header = document.createElement('div');
  header.className = 'evidence-subheader';
  const overflowText = rs.itemsOverflow > 0 ? ` · +${rs.itemsOverflow} dropped at capture` : '';
  header.textContent = `📸 Resulting State (${safeItems.length} observed${overflowText})`;
  container.appendChild(header);

  // Meta — provenance line. For Navigation cards this is the destination
  // URL; for Click cards the action page. Not a timestamp (see docblock).
  const meta = document.createElement('div');
  meta.className = 'evidence-row evidence-row--muted';
  const durText = rs.scanDurationMs != null ? `${Math.round(rs.scanDurationMs)}ms` : '';
  meta.textContent = `scanned: ${truncate(rs.url, 60)}${durText ? ` · ${durText}` : ''}`;
  container.appendChild(meta);

  const counters = safeItems.filter((i) => i.kind === 'counter');
  const collections = safeItems.filter((i) => i.kind === 'collection');
  const entities = safeItems.filter((i) => i.kind === 'entity');
  const badges = safeItems.filter((i) => i.kind === 'status-badge');
  const notifications = safeItems.filter((i) => i.kind === 'notification');

  const renderGroup = (items: WireObservedItem[], cap: number, rowText: (i: WireObservedItem) => string): void => {
    if (items.length === 0) return;
    for (const item of items.slice(0, cap)) {
      const row = document.createElement('div');
      row.className = 'evidence-row';
      row.textContent = rowText(item);
      container.appendChild(row);
      // MS-U2 D2 — per-item drill-down (collapsed by default; compact row above unchanged)
      const dd = renderObservedItemDetail(item, appIdForKnowledgeLinks ?? undefined);
      if (dd) container.appendChild(dd);
    }
    if (items.length > cap) {
      const more = document.createElement('div');
      more.className = 'evidence-row evidence-row--muted';
      more.textContent = `… ${items.length - cap} more`;
      container.appendChild(more);
    }
  };

  renderGroup(counters, MAX_RESULTING_COUNTERS, (item) => {
    const value = item.numericValue != null ? `${item.numericValue}` : truncate(item.text, 30);
    return `🔢 counter: ${value} (${truncate(item.domPath, 40)})`;
  });

  renderGroup(collections, MAX_RESULTING_COLLECTIONS, (item) => {
    const count = item.numericValue != null ? `${item.numericValue}` : '—';
    return `📦 collection: ${count} items (${truncate(item.domPath, 40)})`;
  });

  renderGroup(entities, MAX_RESULTING_ENTITIES, (item) => {
    const ident = item.entityId != null
      ? `${item.entityType ?? 'entity'}:${item.entityId}`
      : truncate(item.text, 30);
    const textPart = item.text ? ` · ${truncate(item.text, 30)}` : '';
    return `🏷 ${ident}${textPart}`;
  });

  renderGroup(badges, MAX_RESULTING_STATUS_BADGES, (item) => {
    return `🚦 ${truncate(item.text, 40)}`;
  });

  renderGroup(notifications, MAX_RESULTING_NOTIFICATIONS, (item) => {
    return `💬 ${truncate(item.text, 60)}`;
  });

  return container;
}

/**
 * MS-U2 D2 — per-item drill-down for a Resulting-State row.
 *
 * Native <details> (collapsed by default): provenance (`via` selector or the
 * changed-element-seed sentinel), attributes (≤30, k="v"), visibility, and
 * observer-verified uniqueness. Recorded facts only. Returns null when the
 * item has nothing drill-able (all sections absent → honest absence).
 */
function renderObservedItemDetail(item: WireObservedItem, appId?: string | null): HTMLElement | null {
  const parts: string[] = [];
  parts.push(`via ${item.matchedSelector || '(no selector)'}`);
  const attrEntries = Object.entries(item.attributes ?? {});
  for (const [k, v] of attrEntries.slice(0, 30)) parts.push(`${k}="${v}"`);
  if (item.entityId != null) parts.push(`entity ${item.entityType ?? 'entity'}:${item.entityId}`);
  if (!item.visible) parts.push('hidden at capture');
  if (item.uniqueInSnapshot === true) parts.push('unique ✓');
  else parts.push('unverified');

  const details = document.createElement('details');
  details.className = 'evidence-drilldown evidence-drilldown--item';
  const summary = document.createElement('summary');
  summary.textContent = `item detail · ${item.kind}`;
  details.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'evidence-row evidence-row--muted';
  body.textContent = parts.join(' · ');
  details.appendChild(body);
  // 7.2-M1: close the knowledge loop — an item with an entityId gets a
  // real "Open in knowledge browser" link when an opener is installed
  // (replaces the long-stale MS-U4 tooltip promise). No opener, or no
  // entityId → honest absence, no fake affordance.
  if (item.entityId != null && knowledgeLink && appId) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'evidence-knowledge-link';
    link.textContent = 'Open in knowledge browser';
    link.addEventListener('click', () => {
      try {
        knowledgeLink?.({ appId: appId!, entityId: item.entityId! });
      } catch {
        // opener failure must never surface in the panel
      }
    });
    details.appendChild(link);
  }
  return details;
}

/** 7.2-M1 — injected KR-browser opener seam (setKrLookup pattern).
 * Default null → no link rendered (honest degradation). The renderer
 * stays chrome.*-free; sidepanel.ts installs the real opener. */
export function setKnowledgeLink(open: KnowledgeLinkOpener | null): void {
  knowledgeLink = open;
}

/** 7.2-M1 — app scope for knowledge links (set by sidepanel per session). */
export function setKnowledgeAppId(appId: string | null): void {
  appIdForKnowledgeLinks = appId;
}

let appIdForKnowledgeLinks: string | null = null;

/** Test visibility for the private renderer (7.2-M1 D10). */
export function renderObservedItemDetailForTest(
  item: WireObservedItem,
  appId?: string | null,
): HTMLElement | null {
  return renderObservedItemDetail(item, appId);
}

/**
 * G1 (2026-08-20) — JS dialog + window.open evidence card.
 *
 * Renders the native dialog (alert/confirm/prompt) and/or window.open
 * observed during this interaction's evidence window, as captured by the
 * MAIN-world dialog-inject.js content script. Display only (INV-BEHAV-1):
 * states WHAT was observed — type, message, dismissal result — never a
 * causal label.
 *
 * Returns null when neither signal is present, so dialog-free interactions
 * keep the exact pre-G1 layout.
 */
function renderDialogEvidence(
  dialog: DialogSignal | null | undefined,
  windowOpen: WindowOpenSignal | null | undefined,
): HTMLElement | null {
  if (!dialog && !windowOpen) return null;

  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'evidence-subheader';
  const parts: string[] = [];
  if (dialog) parts.push(dialog.type);
  if (windowOpen) parts.push(windowOpen.isWindow ? 'window.open (popup)' : 'window.open (tab)');
  header.textContent = `🔔 JS Dialog (${parts.join(' + ')})`;
  container.appendChild(header);

  if (dialog) {
    const row = document.createElement('div');
    row.className = 'evidence-row';
    const resultText = dialog.result != null ? ` → ${truncate(dialog.result, 40)}` : '';
    row.textContent = `${dialog.type}("${truncate(dialog.message, 60)}")${resultText}`;
    container.appendChild(row);
  }

  if (windowOpen) {
    const row = document.createElement('div');
    row.className = 'evidence-row';
    row.textContent = `opened ${truncate(windowOpen.url, 60)}${windowOpen.target ? ` (target: ${truncate(windowOpen.target, 20)})` : ''}`;
    container.appendChild(row);
  }

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

  // Phase 4a — Resulting State (semantic snapshot). First sub-block: it is
  // the headline semantic answer ("cart = 4"); the blocks below are
  // lower-level detail. Absent field → null → nothing rendered.
  const rsEl = renderResultingState(app.resultingState);
  if (rsEl) body.appendChild(rsEl);

  // G1 (2026-08-20) — JS dialog / window.open evidence (alert/confirm/
  // prompt/window.open captured by the MAIN-world dialog-inject.js).
  // Second sub-block: a native dialog is a high-signal, user-visible
  // consequence of the interaction. Absent → nothing rendered (dialog-free
  // interactions keep the exact pre-G1 layout).
  const dlgEl = renderDialogEvidence(app.triggeredDialog, app.openedWindow);
  if (dlgEl) body.appendChild(dlgEl);

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
    notice.textContent = '📋 Navigation evidence (page reloaded — synthetic)';
    container.appendChild(notice);
  }

  // 6F-M3 O12: no-owner recovered windows keep null identity by constraint
  // (RC7). Explain WHY "Unknown element" is honest on this path — one line,
  // same class as the synthetic notice. Silent when the 6F-M2b identity
  // seed already tells the truth.
  if (endReason === 'sw-recovered-form-submit'
      && (evidence?.targetEvidence?.identity ?? null) === null) {
    const notice = document.createElement('div');
    notice.className = 'evidence-synthetic-notice';
    notice.textContent =
      '↻ Evidence recovered after page unload — target identity not captured (no owner resolved)';
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

  // MS-U2 D6 — window internals disclosure (endReason context + stability trace)
  const winDetails = renderWindowInternals(evidence);
  if (winDetails) container.appendChild(winDetails);

  // MS-U2 D7 — raw evidence JSON disclosure (collapsed, honest truncation)
  container.appendChild(renderRawEvidenceJson(evidence));
}

/**
 * MS-U2 D6 — window internals drill-down.
 *
 * endReason already appears on the meta line; this adds the recorded
 * stability trace (sample count, last gap, ≤12 static bars from
 * msSinceLastMutation — pure CSS heights, display only). No samples →
 * no stability content (honest absence).
 */
function renderWindowInternals(evidence: BehavioralEvidence): HTMLElement | null {
  const win = evidence?.window;
  if (!win) return null;
  const samples = win.stabilityTrace ?? [];
  if (samples.length === 0) return null;

  const details = document.createElement('details');
  details.className = 'evidence-drilldown evidence-drilldown--window';
  const summary = document.createElement('summary');
  summary.textContent = 'window internals';
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'evidence-row evidence-row--muted';
  const lastGap = samples[samples.length - 1].msSinceLastMutation;
  body.textContent = `endReason: ${win.endReason} · stability: ${samples.length} samples · last gap ${Math.round(lastGap)}ms`;
  details.appendChild(body);

  const bars = stabilityBars(samples);
  if (bars.length > 0) {
    const chart = document.createElement('div');
    chart.className = 'stability-chart';
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `stability trace, ${bars.length} bars, last gap ${Math.round(lastGap)}ms`);
    for (const bar of bars) {
      const b = document.createElement('div');
      b.className = 'stability-bar';
      b.style.height = `${Math.max(bar.heightPct, 4)}%`;
      b.title = `+${Math.round(bar.msSinceLastMutation)}ms since last mutation (batch ${bar.globalBatchCount})`;
      chart.appendChild(b);
    }
    details.appendChild(chart);
  }

  return details;
}

/**
 * MS-U2 D7 — raw evidence JSON disclosure.
 * textContent-set <pre>; honest truncation marker past RAW_JSON_MAX_CHARS.
 */
function renderRawEvidenceJson(evidence: BehavioralEvidence): HTMLElement {
  const details = document.createElement('details');
  details.className = 'evidence-drilldown raw-evidence';
  const summary = document.createElement('summary');
  summary.textContent = 'Raw evidence JSON';
  details.appendChild(summary);

  const { text, truncated } = truncateJson(evidence);
  const pre = document.createElement('pre');
  pre.className = 'raw-evidence-json';
  pre.textContent = text;
  details.appendChild(pre);

  if (truncated) {
    const note = document.createElement('div');
    note.className = 'evidence-row evidence-row--muted';
    note.textContent = `… truncated at ${RAW_JSON_MAX_CHARS.toLocaleString('en-US')} characters (full evidence in storage)`;
    details.appendChild(note);
  }

  return details;
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
 * 6F-M3 O13 — honest terminal note for cards with NO behavioral evidence
 * in the STOPPED view. "Collecting…" is a lie after stop: nothing more will
 * arrive. Used by interaction-renderer's attachEvidenceDisplay (view =
 * 'stopped'); never in the live timeline.
 */
export function renderEvidenceTerminal(): HTMLElement {
  const note = document.createElement('div');
  note.className = 'evidence-placeholder evidence-placeholder--final';
  note.textContent = 'No behavioral evidence captured for this interaction';
  return note;
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
