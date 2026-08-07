/**
 * Timeline Renderer — Phase 1 Deterministic Recorder
 *
 * Renders RecordedEvent[] as a readable timeline showing:
 *   - Event type badge (click, focus, input, change, blur, navigation)
 *   - Event ID
 *   - Target accessible name + tag
 *   - Value transitions (before → after)
 *   - Checked state transitions
 *   - Element identity chips
 *   - Timestamp
 *
 * Phase 1.3.6: Removed DetectedInteraction rendering functions
 * (actionDescription, createDetectedInteractionElement, renderDetectedInteractions,
 * formatInteractionMetadata). These were only consumed by action-phrasing.test.ts
 * which tested legacy 40-type vocabulary. The live sidepanel uses
 * interaction-renderer.ts for ComponentInteraction display.
 */

import type { ElementIdentity } from '../shared/types';
import type {
  RecordedEvent,
  NavigationRecordedEvent,
  ElementRecordedEvent,
} from '../recorder/recorded-event';

// ── Identity chips ──────────────────────────────────────────────────────

export function buildIdentityChips(identity: ElementIdentity): string {
  const chips: string[] = [];
  chips.push(identity.tag);
  if (identity.ariaRole) chips.push(`role="${identity.ariaRole}"`);
  if (identity.stableId) chips.push(`id="${identity.stableId}"`);
  if (identity.testId) chips.push(`testId="${identity.testId}"`);
  if (identity.dataCy) chips.push(`data-cy="${identity.dataCy}"`);
  if (identity.dataQa) chips.push(`data-qa="${identity.dataQa}"`);
  if (identity.name) chips.push(`name="${identity.name}"`);
  if (identity.ariaLabel) chips.push(`aria-label="${identity.ariaLabel}"`);
  if (identity.placeholder) chips.push(`placeholder="${identity.placeholder}"`);
  if (identity.inIframe) chips.push('🌐 iframe');
  if (identity.shadowDom) chips.push('🌑 shadow-DOM');
  return chips.join(' · ');
}

// ── Value transition text ───────────────────────────────────────────────

function formatValueTransition(before: string | null, after: string | null): string | null {
  if (before === null && after === null) return null;
  if (before === after) return `"${after ?? ''}"`;
  return `"${before ?? ''}" → "${after ?? ''}"`;
}

function formatCheckedTransition(before: boolean | null, after: boolean | null): string | null {
  if (before === null && after === null) return null;
  if (before === after) return `${after ? 'checked' : 'unchecked'}`;
  return `${before ? 'checked' : 'unchecked'} → ${after ? 'checked' : 'unchecked'}`;
}

// ── Event type styling ──────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  navigation: 'NAV',
  click: 'CLK',
  focus: 'FOC',
  input: 'INP',
  change: 'CHG',
  blur: 'BLR',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  navigation: 'timeline-event--navigation',
  click: 'timeline-event--click',
  focus: 'timeline-event--focus',
  input: 'timeline-event--input',
  change: 'timeline-event--change',
  blur: 'timeline-event--blur',
};

// ── Renderers ───────────────────────────────────────────────────────────

function renderNavigationEvent(event: NavigationRecordedEvent): HTMLElement {
  const el = document.createElement('div');
  el.className = 'timeline-event timeline-event--navigation';

  // Event type badge
  const badge = document.createElement('span');
  badge.className = 'timeline-event__type';
  badge.textContent = EVENT_TYPE_LABELS['navigation'];
  el.appendChild(badge);

  // Event ID
  const idBadge = document.createElement('span');
  idBadge.className = 'timeline-event__id';
  idBadge.textContent = event.eventId;
  el.appendChild(idBadge);

  // Title
  const title = document.createElement('p');
  title.className = 'timeline-event__title';
  title.textContent = `Navigate to ${event.url}`;
  el.appendChild(title);

  // Timestamp
  const time = document.createElement('span');
  time.className = 'timeline-event__time';
  time.textContent = new Date(event.timestamp).toLocaleTimeString();
  el.appendChild(time);

  return el;
}

function renderElementEvent(event: ElementRecordedEvent): HTMLElement {
  const el = document.createElement('div');
  el.className = `timeline-event ${EVENT_TYPE_COLORS[event.eventType] ?? ''}`;

  // Event type badge
  const badge = document.createElement('span');
  badge.className = 'timeline-event__type';
  badge.textContent = EVENT_TYPE_LABELS[event.eventType] ?? event.eventType.toUpperCase();
  el.appendChild(badge);

  // Event ID
  const idBadge = document.createElement('span');
  idBadge.className = 'timeline-event__id';
  idBadge.textContent = event.eventId;
  el.appendChild(idBadge);

  // Target name + tag
  const title = document.createElement('p');
  title.className = 'timeline-event__title';
  const name = event.target.accessibleName || event.target.tag;
  title.textContent = `${name}`;
  el.appendChild(title);

  // Value transition
  const valueText = formatValueTransition(event.valueBefore, event.valueAfter);
  if (valueText) {
    const value = document.createElement('p');
    value.className = 'timeline-event__value';
    value.textContent = `Value: ${valueText}`;
    el.appendChild(value);
  }

  // Checked transition
  const checkedText = formatCheckedTransition(event.checkedBefore, event.checkedAfter);
  if (checkedText) {
    const checked = document.createElement('p');
    checked.className = 'timeline-event__value';
    checked.textContent = `State: ${checkedText}`;
    el.appendChild(checked);
  }

  // Identity chips
  const detailsContainer = document.createElement('div');
  detailsContainer.className = 'element-identity';
  const chipsEl = document.createElement('p');
  chipsEl.className = 'element-identity__chips';
  chipsEl.textContent = buildIdentityChips(event.target);
  detailsContainer.appendChild(chipsEl);
  el.appendChild(detailsContainer);

  // Timestamp
  const time = document.createElement('span');
  time.className = 'timeline-event__time';
  time.textContent = new Date(event.timestamp).toLocaleTimeString();
  el.appendChild(time);

  return el;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Create a DOM element for any RecordedEvent.
 */
export function createRecordedEventElement(event: RecordedEvent): HTMLElement {
  if (event.eventType === 'navigation') {
    return renderNavigationEvent(event);
  }
  return renderElementEvent(event);
}

/**
 * Render a full timeline of events into a container.
 */
export function renderEventTimeline(
  container: HTMLElement,
  events: RecordedEvent[],
): void {
  container.innerHTML = '';

  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'timeline__empty';
    empty.textContent = 'No events recorded yet.';
    container.appendChild(empty);
    return;
  }

  for (const event of events) {
    container.appendChild(createRecordedEventElement(event));
  }
}
