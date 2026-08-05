/**
 * Interaction Renderer — Component Runtime Display (v10.9.0+)
 *
 * Renders ComponentInteraction[] as a readable timeline for the side panel.
 * Displays the three-layer model:
 *   Layer 1: Interaction Type icon + label badge (Click, TextEntry, etc.)
 *   Layer 2: Component Type label (DataGrid, IconButton, SortButton, etc.)
 *   Layer 3: Business Meaning (the human-readable description)
 *
 * Each interaction is displayed as:
 *   - Type icon + label badge
 *   - Component type + framework badge (Layer 2)
 *   - Business meaning (Layer 3 — primary description)
 *   - Fallback: action description if no enrichment
 *   - Metadata details (value, selected option, date, etc.)
 *
 * Architecture: .drytis/specs/three-layer-component-model.md
 */

import type { ComponentInteraction } from '../shared/component-types';
import { renderBehavioralEvidence, renderSemanticEffects } from './behavioral-renderer';
import type { ObservationResult } from '../shared/observation-types';

// ── Layer 1: Type Display Config ──────────────────────────────────────

interface TypeDisplay {
  icon: string;
  label: string;
  color: string;
}

const TYPE_DISPLAY: Record<string, TypeDisplay> = {
  Click:        { icon: '🖱️', label: 'Click',        color: '#3b82f6' },
  TextEntry:    { icon: '⌨️',  label: 'Text Entry',   color: '#8b5cf6' },
  Dropdown:     { icon: '📋', label: 'Dropdown',      color: '#f59e0b' },
  Slider:       { icon: '🎚️', label: 'Slider',       color: '#f97316' },
  Checkbox:     { icon: '☑️',  label: 'Checkbox',     color: '#10b981' },
  FileUpload:   { icon: '📎', label: 'File Upload',  color: '#84cc16' },
  RadioButton:  { icon: '🔘', label: 'Radio Button',  color: '#ec4899' },
  DatePicker:   { icon: '📅', label: 'Date Picker',   color: '#ef4444' },
  Hover:        { icon: '👆', label: 'Hover',         color: '#6366f1' },
  Link:         { icon: '🔗', label: 'Link',          color: '#06b6d4' },
  Tab:          { icon: '📂', label: 'Tab',           color: '#8b5cf6' },
  Scroll:       { icon: '📜', label: 'Scroll',        color: '#6b7280' },
  Navigation:   { icon: '🧭', label: 'Navigation',    color: '#0ea5e9' },
};

const DEFAULT_DISPLAY: TypeDisplay = { icon: '❓', label: 'Unknown', color: '#9ca3af' };

// ── Layer 2: Component Type Display Config ────────────────────────────

interface ComponentDisplay {
  icon: string;
  color: string;
}

const COMPONENT_DISPLAY: Record<string, ComponentDisplay> = {
  DataGrid:         { icon: '📊', color: '#1e40af' },
  TreeView:         { icon: '🌲', color: '#15803d' },
  Accordion:        { icon: '📂', color: '#7c2d12' },
  TabBar:           { icon: '📑', color: '#6d28d9' },
  Dialog:           { icon: '💬', color: '#be123c' },
  Drawer:           { icon: '📦', color: '#b45309' },
  Carousel:         { icon: '🎠', color: '#0e7490' },
  ContextMenu:      { icon: '📋', color: '#4338ca' },
  Breadcrumb:       { icon: '🍞', color: '#92400e' },
  Stepper:          { icon: '🔢', color: '#155e75' },
  IconButton:       { icon: '🔘', color: '#475569' },
  SortButton:       { icon: '↕️', color: '#1d4ed8' },
  GridToggle:       { icon: '🔲', color: '#5b21b6' },
  Autocomplete:     { icon: '🔍', color: '#c2410c' },
  RichTextEditor:   { icon: '📝', color: '#166534' },
  ChipInput:        { icon: '🏷️', color: '#9f1239' },
  SplitButton:      { icon: '⚡', color: '#075985' },
  Spinner:          { icon: '⏳', color: '#6b7280' },
  Alert:            { icon: '🔔', color: '#dc2626' },
  Tooltip:          { icon: '💡', color: '#a16207' },
  ProgressBar:      { icon: '📊', color: '#4b5563' },
  Rating:           { icon: '⭐', color: '#ca8a04' },
  ToggleSwitch:     { icon: '🔌', color: '#0d9488' },
  FileUpload:       { icon: '📎', color: '#65a30d' },
  Badge:            { icon: '🎖️', color: '#9333ea' },
};

const DEFAULT_COMPONENT_DISPLAY: ComponentDisplay = { icon: '🧩', color: '#64748b' };

// ── Fallback Action Description (no enrichment) ───────────────────────

function fallbackActionDescription(interaction: ComponentInteraction): string {
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
      return `Select "${val}" from "${targetName}"`;
    }

    case 'Checkbox': {
      const checked = metadata.checked === true;
      return `${checked ? 'Check' : 'Uncheck'} "${targetName}"`;
    }

    case 'Slider': {
      const val = metadata.value != null ? String(metadata.value) : '';
      return `Set slider "${targetName}" to ${val}`;
    }

    case 'FileUpload': {
      const fileName = metadata.fileName ? String(metadata.fileName) : '';
      return fileName ? `Upload file "${fileName}"` : `Click file upload "${targetName}"`;
    }

    case 'Tab': {
      return `Click "${targetName}" tab`;
    }

    case 'RadioButton': {
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

  // ── Layer 1: Type badge ──
  const badge = document.createElement('span');
  badge.className = 'timeline-event__type interaction-badge';
  badge.textContent = `${display.icon} ${display.label}`;
  badge.style.backgroundColor = `${display.color}15`;
  badge.style.color = display.color;
  el.appendChild(badge);

  // ── Layer 2: Component type badge ──
  if (interaction.componentType && interaction.componentType !== 'Generic') {
    const compDisplay = COMPONENT_DISPLAY[interaction.componentType] ?? DEFAULT_COMPONENT_DISPLAY;
    const compBadge = document.createElement('span');
    compBadge.className = 'timeline-event__component interaction-badge';
    compBadge.textContent = `${compDisplay.icon} ${interaction.componentType}`;
    compBadge.style.backgroundColor = `${compDisplay.color}10`;
    compBadge.style.color = compDisplay.color;
    compBadge.style.marginLeft = '4px';
    compBadge.style.fontSize = '0.75em';
    el.appendChild(compBadge);

    // Framework tag
    if (interaction.componentFramework && interaction.componentFramework !== 'Generic') {
      const fwTag = document.createElement('span');
      fwTag.className = 'timeline-event__framework';
      fwTag.textContent = interaction.componentFramework;
      fwTag.style.fontSize = '0.7em';
      fwTag.style.color = '#94a3b8';
      fwTag.style.marginLeft = '2px';
      el.appendChild(fwTag);
    }
  }

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

  // ── Layer 3: Business Meaning (primary) or fallback description ──
  const title = document.createElement('p');
  title.className = 'timeline-event__title interaction-action-text';
  title.textContent = interaction.businessMeaning ?? fallbackActionDescription(interaction);
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

  // ── Semantic Effects (Sub-phase 3) ──
  // "What happened" section displayed ABOVE raw behavioral evidence.
  // Collects all semanticEffects from all observations and renders them.
  // If no observations have semanticEffects, section is absent (invisible).
  if (
    interaction.behavioralObservations &&
    interaction.behavioralObservations.length > 0
  ) {
    const allEffects = interaction.behavioralObservations
      .flatMap((obs: ObservationResult) => obs.semanticEffects ?? []);
    const effectsEl = renderSemanticEffects(allEffects);
    if (effectsEl) {
      el.appendChild(effectsEl);
    }
  }

  // ── Semantic Effects (Sub-phase 3) ──
  // "What happened" section displayed ABOVE raw behavioral evidence.
  // Collects all semanticEffects from all observations and renders them.
  // If no observations have semanticEffects, section is absent (invisible).
  if (
    interaction.behavioralObservations &&
    interaction.behavioralObservations.length > 0
  ) {
    const allEffects = interaction.behavioralObservations
      .flatMap((obs: ObservationResult) => obs.semanticEffects ?? []);
    const effectsEl = renderSemanticEffects(allEffects);
    if (effectsEl) {
      el.appendChild(effectsEl);
    }
  }

  // ── Behavioral Evidence (M1 Phase E) ──
  // Collapsible section showing before/after snapshots and mutation evidence.
  // Only renders if observations were captured (additive — absent = invisible).
  if (
    interaction.behavioralObservations &&
    interaction.behavioralObservations.length > 0
  ) {
    const evidenceSection = renderBehavioralEvidence(
      interaction.behavioralObservations,
    );
    el.appendChild(evidenceSection);
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
      case 'Hover':
        // Evidence-based hover: only meaningful hovers are shown
        return i.metadata.meaningful === true;
      default:
        return true;
    }
  });

  renderInteractions(container, production);
}
