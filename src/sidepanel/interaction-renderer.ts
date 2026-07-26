/**
 * Interaction Renderer — Component Runtime Display (v10.9.0+)
 *
 * Renders ComponentInteraction[] as a readable timeline for the side panel.
 * Replaces the old DetectedInteraction renderer which showed evidence/confidence/engine badges.
 *
 * Each interaction is displayed as:
 *   - Type icon + label badge (Click, TextEntry, Dropdown, etc.)
 *   - Interaction ID
 *   - Human-readable action description
 *   - Metadata details (value, selected option, date, etc.)
 *
 * Architecture: .drytis/specs/m0a-architecture-validation.md §2.2 Stage 6
 */

import type { ComponentInteraction } from '../shared/component-types';

// ── Type Display Config ──────────────────────────────────────────────

interface TypeDisplay {
  icon: string;
  label: string;
  color: string;
}

const TYPE_DISPLAY: Record<string, TypeDisplay> = {
  Click:        { icon: '🖱️', label: 'Click',        color: '#3b82f6' },
  TextEntry:    { icon: '⌨️',  label: 'Text Entry',   color: '#8b5cf6' },
  Dropdown:     { icon: '📋', label: 'Dropdown',      color: '#f59e0b' },
  Checkbox:     { icon: '☑️',  label: 'Checkbox',     color: '#10b981' },
  RadioButton:  { icon: '🔘', label: 'Radio Button',  color: '#ec4899' },
  DatePicker:   { icon: '📅', label: 'Date Picker',   color: '#ef4444' },
  Hover:        { icon: '👆', label: 'Hover',         color: '#6366f1' },
  Link:         { icon: '🔗', label: 'Link',          color: '#06b6d4' },
  Scroll:       { icon: '📜', label: 'Scroll',        color: '#6b7280' },
  Navigation:   { icon: '🧭', label: 'Navigation',    color: '#0ea5e9' },
};

const DEFAULT_DISPLAY: TypeDisplay = { icon: '❓', label: 'Unknown', color: '#9ca3af' };

// ── Action Description ───────────────────────────────────────────────

function actionDescription(interaction: ComponentInteraction): string {
  const { type, metadata } = interaction;
  const targetName = String(metadata.targetName ?? 'element');

  switch (type) {
    case 'Click':
      return `Click "${targetName}"`;

    case 'TextEntry': {
      const val = String(metadata.textValue ?? '');
      return `Enter "${val}" in "${targetName}"`;
    }

    case 'Dropdown': {
      const val = String(metadata.selectedValue ?? '');
      const noOp = metadata.noOpSelection === true;
      if (noOp) return `Select "${val}" from "${targetName}" (no change)`;
      return `Select "${val}" from "${targetName}"`;
    }

    case 'Checkbox': {
      const checked = metadata.checked === true;
      return `${checked ? 'Check' : 'Uncheck'} "${targetName}"`;
    }

    case 'RadioButton': {
      const noOp = metadata.noOpSelection === true;
      if (noOp) return `Select "${targetName}" (already selected)`;
      return `Select "${targetName}"`;
    }

    case 'DatePicker': {
      const date = String(metadata.dateValue ?? metadata.selectedDate ?? '');
      return `Select date "${date}" (${targetName})`;
    }

    case 'Hover':
      return `Hover over "${targetName}"`;

    case 'Link':
      return `Click "${targetName}" link`;

    case 'Scroll':
      return `Scroll page`;

    case 'Navigation': {
      const url = String(metadata.pageUrl ?? '');
      const title = String(metadata.pageTitle ?? '');
      if (title) return `Navigate to "${title}"`;
      return `Navigate to ${url}`;
    }

    default:
      return `${type} on "${targetName}"`;
  }
}

// ── Metadata Formatting ──────────────────────────────────────────────

function formatMetadata(interaction: ComponentInteraction): string | null {
  const { type, metadata } = interaction;
  const parts: string[] = [];

  switch (type) {
    case 'TextEntry':
      if (metadata.userTyped === false) parts.push('⚠️ no typing detected');
      break;

    case 'Dropdown':
      if (metadata.noOpSelection === true) parts.push('⚠️ no-op (already selected)');
      break;

    case 'RadioButton':
      if (metadata.noOpSelection === true) parts.push('⚠️ no-op (already selected)');
      break;

    case 'Scroll':
      if (metadata.hasDelta === false) parts.push('⚠️ 0px scroll');
      break;
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

// ── Renderers ────────────────────────────────────────────────────────

/**
 * Create a DOM element for a single ComponentInteraction.
 */
export function createInteractionElement(interaction: ComponentInteraction): HTMLElement {
  const el = document.createElement('div');
  el.className = 'timeline-event interaction-event';

  const display = TYPE_DISPLAY[interaction.type] ?? DEFAULT_DISPLAY;

  // Border color by type
  el.style.borderLeft = `3px solid ${display.color}`;

  // Type badge
  const badge = document.createElement('span');
  badge.className = 'timeline-event__type interaction-badge';
  badge.textContent = `${display.icon} ${display.label}`;
  badge.style.backgroundColor = `${display.color}15`;
  badge.style.color = display.color;
  el.appendChild(badge);

  // Interaction ID
  const idBadge = document.createElement('span');
  idBadge.className = 'timeline-event__id';
  idBadge.textContent = interaction.interactionId;
  el.appendChild(idBadge);

  // End state badge (only show if not 'completed')
  if (interaction.endState !== 'completed') {
    const stateBadge = document.createElement('span');
    stateBadge.className = 'timeline-event__id';
    stateBadge.textContent = interaction.endState;
    stateBadge.style.color = '#f59e0b';
    el.appendChild(stateBadge);
  }

  // Action description
  const title = document.createElement('p');
  title.className = 'timeline-event__title interaction-action-text';
  title.textContent = actionDescription(interaction);
  el.appendChild(title);

  // Metadata warnings
  const metaText = formatMetadata(interaction);
  if (metaText) {
    const meta = document.createElement('p');
    meta.className = 'timeline-event__value';
    meta.style.color = '#f59e0b';
    meta.style.fontSize = '0.8em';
    meta.textContent = metaText;
    el.appendChild(meta);
  }

  return el;
}

/**
 * Render an array of ComponentInteractions into a container.
 */
export function renderInteractions(
  container: HTMLElement,
  interactions: ComponentInteraction[],
): void {
  container.innerHTML = '';

  if (interactions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'timeline__empty';
    empty.textContent = 'No interactions captured.';
    container.appendChild(empty);
    return;
  }

  for (const interaction of interactions) {
    container.appendChild(createInteractionElement(interaction));
  }
}

/**
 * Render only production interactions (filtered).
 * Uses the same filter logic as the presentation layer.
 */
export function renderProductionInteractions(
  container: HTMLElement,
  interactions: ComponentInteraction[],
): void {
  const production = interactions.filter((i) => {
    if (i.endState !== 'completed') return false;
    switch (i.type) {
      case 'TextEntry':
        return i.metadata.userTyped === true && String(i.metadata.textValue ?? '').trim() !== '';
      case 'Dropdown':
        return i.metadata.noOpSelection !== true;
      case 'RadioButton':
        return i.metadata.noOpSelection !== true;
      case 'DatePicker':
        return String(i.metadata.selectedDate ?? '').trim() !== '';
      case 'Scroll':
        return i.metadata.hasDelta === true;
      default:
        return true;
    }
  });

  renderInteractions(container, production);
}
