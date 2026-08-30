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
import { renderEvidence, renderEvidencePlaceholder, renderEvidenceTerminal } from './evidence-renderer';
import { quoteSafeTitle, displayUrl, isUrlDerivedTitle } from '../enrichment/quote-safe';
import {
  buildUnderstandingBadge,
  buildProjectedChip,
  buildWhyBlock,
} from './understanding-badge';
import { buildEvidenceFooter } from './evidence-footer';
import { getAssertionCountFor } from './assertion-chip';
import { deriveConsequenceClasses, buildEvidenceDisclosures } from '../presentation/output-adapter';
import { foldHoverClickPairs } from './hover-pair-fold';

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
  Expander:     { icon: '🔽', label: 'Expander',      color: '#14b8a6' },
  Modal:        { icon: '🪟',  label: 'Modal',         color: '#a78bfa' }, // 7.4-B5
  Scroll:       { icon: '📜', label: 'Scroll',        color: '#6b7280' },
  Navigation:   { icon: '🧭', label: 'Navigation',   color: '#0ea5e9' },
  ColorInput:   { icon: '🎨', label: 'Color Input',   color: '#a855f7' },
  DragDrop:     { icon: '↔️', label: 'Drag & Drop',   color: '#0d9488' },
  KeyboardShortcut: { icon: '⌨️', label: 'Key Shortcut', color: '#6366f1' },
  CompoundInteraction: { icon: '🧩', label: 'Compound', color: '#64748b' },
  Unclassified: { icon: '❓', label: 'Unclassified',  color: '#f59e0b' },
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

    case 'Unclassified': {
      const physical = String(metadata.physicalEventType ?? 'click');
      if (physical === 'contextmenu') {
        return `Right-click "${targetName}"`;
      }
      return `Click "${targetName}" (unclassified ${physical})`;
    }

    case 'Scroll':
      return `Scroll page`;

    case 'Navigation': {
      const url = String(metadata.pageUrl ?? '');
      // D10 (audit D11): titles arrive raw from the page and may contain or
      // be wrapped in double quotes — normalize so the label never renders
      // nested/doubled quotes.
      const rawTitle = String(metadata.pageTitle ?? '');
      const title = quoteSafeTitle(rawTitle);
      if (title && !isUrlDerivedTitle(rawTitle, url)) return `Navigate to "${title}"`;
      // 6F-M3 O14: title absent (or Chrome's URL-synthesized pseudo-title)
      // — display form drops query/hash and truncates (panel label only;
      // IR/KR keep the raw URL).
      return `Navigate to ${displayUrl(url)}`;
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
      // 7.4-B6/B6.1 commit provenance — honest effect-grounded labels.
      // Only real commit paths carry commitSignal: 'submit' (native form
      // submit), 'navigation' (form-less SPA route change), 'network'
      // (STOP-rescued, network-joined + corroborated). Absent ⇒ blur
      // completion, and we say nothing (no fabrication).
      if (metadata.commitSignal === 'submit') parts.push('✓ committed via form submit');
      else if (metadata.commitSignal === 'navigation') parts.push('✓ committed via Enter (route change)');
      else if (metadata.commitSignal === 'network') parts.push('✓ committed via Enter (app request)');
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

    case 'Unclassified':
      // Capture-guarantee v2: show the physical event type so the user
      // understands this is a real, preserved action — not noise.
      parts.push(`physical: ${String(metadata.physicalEventType ?? 'click')}`);
      break;
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}

// ── MS-U1 helpers (pure display, recorded facts only) ──────────────────

const ENDSTATE_COLORS: Record<string, string> = {
  completed: '#10b981',
  abandoned: '#f59e0b',
  interrupted: '#f97316',
  discarded: '#9ca3af',
};

function memberChipText(interaction: ComponentInteraction): string | null {
  const members = Array.isArray(interaction.memberEvents) ? interaction.memberEvents : [];
  if (members.length === 0) return null;
  const span = Math.max(0, (interaction.endTime ?? 0) - (interaction.startTime ?? 0));
  const noun = members.length === 1 ? 'event' : 'events';
  return `${members.length} ${noun} · ${span}ms`;
}

/** Suppression reason when an interaction is filtered by the production view. */
function suppressionReason(interaction: ComponentInteraction): string | null {
  if (interaction.endState !== 'completed') return interaction.endState;
  switch (interaction.type) {
    case 'TextEntry':
      return !(interaction.metadata.userTyped === true
        && String(interaction.metadata.textValue ?? '').trim() !== '')
        ? 'no typing' : null;
    case 'Dropdown':
    case 'RadioButton':
      return interaction.metadata.noOpSelection === true ? 'no-op' : null;
    case 'DatePicker':
      return String(interaction.metadata.selectedDate ?? '').trim() === '' ? 'no date' : null;
    case 'Scroll':
      return interaction.metadata.hasDelta !== true ? '0px scroll' : null;
    case 'Hover':
      // HEC v1 (§9): the recorded capture-time verdict is authoritative.
      // Gesture-only/unqualified rows surface the honest recorded reason
      // (AC-16: the classification is explained from recorded evidence —
      // 'not meaningful' alone never replaces the why-line).
      if (hoverRecordedVerdict(interaction) === 'evidenced') return null;
      return 'not meaningful';
    default:
      return null;
  }
}

/**
 * P10 — deterministic toggle-row summary. Null when nothing is suppressed
 * (toggle row hidden).
 */
export function buildHiddenSummary(interactions: ComponentInteraction[]): string | null {
  const reasons = interactions
    .map((i) => suppressionReason(i))
    .filter((r): r is string => r !== null);
  if (reasons.length === 0) return null;
  return `Show all ${interactions.length} (${reasons.length} hidden: ${reasons.join(' · ')})`;
}

/**
 * HEC v1 §9: the recorded capture-time Hover verdict (either location —
 * metadata projection or the evidence envelope; same frozen record).
 * Null when nothing was recorded (legacy rows render honestly as
 * not-evidenced).
 */
function hoverRecordedVerdict(
  interaction: ComponentInteraction,
): 'evidenced' | 'gesture-only' | null {
  const meta = (interaction.metadata ?? {}) as Record<string, unknown>;
  const fromMeta = (meta.hoverQualification as { verdict?: string } | undefined)?.verdict;
  const fromEnv = interaction.behavioralEvidence?.hoverQualification?.verdict;
  const verdict = fromMeta ?? fromEnv;
  if (verdict === 'evidenced' || verdict === 'gesture-only') return verdict;
  return null;
}

function appendChip(el: HTMLElement, text: string, cls: string, color?: string): void {
  const chip = document.createElement('span');
  chip.className = cls;
  chip.textContent = text;
  if (color) chip.style.color = color;
  el.appendChild(chip);
}

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

  // End state chip — MS-U1: rendered for EVERY state (completed = green,
  // terminal non-completed = amber/gray). Previously only ≠completed.
  const endColor = ENDSTATE_COLORS[interaction.endState] ?? '#9ca3af';
  const stateBadge = document.createElement('span');
  stateBadge.className = 'timeline-event__endstate';
  stateBadge.textContent = interaction.endState;
  stateBadge.style.color = endColor;
  el.appendChild(stateBadge);

  // ── MS-U1 chips row (between badges and title) ──
  const memberText = memberChipText(interaction);
  if (memberText) appendChip(el, memberText, 'interaction-chip interaction-chip--member');

  const understanding = buildUnderstandingBadge(interaction);
  if (understanding) {
    appendChip(
      el,
      understanding.text,
      'interaction-chip interaction-chip--understanding',
      understanding.tone === 'recognized' ? '#10b981' : understanding.tone === 'unclassified' ? '#f59e0b' : '#94a3b8',
    );
  }

  const projected = buildProjectedChip(interaction.metadata ?? {});
  if (projected) {
    appendChip(el, projected.text, 'interaction-chip interaction-chip--understanding', '#94a3b8');
  }

  // HEC v1 §9b: chip from the RECORDED capture-time evidence class (when a
  // qualification exists) — never a STOP-time re-derivation. Legacy rows
  // without a record render the derived display classes (display only).
  if (interaction.type === 'Hover') {
    const recorded = hoverRecordedVerdict(interaction);
    const meta = (interaction.metadata ?? {}) as Record<string, unknown>;
    const recordedClass = (meta.hoverQualification as { evidenceClass?: string | null } | undefined)
      ?.evidenceClass;
    if (recorded === 'evidenced' && recordedClass) {
      appendChip(el, recordedClass, 'interaction-chip interaction-chip--consequence', '#6366f1');
    } else if (recorded == null) {
      for (const cls of deriveConsequenceClasses(interaction)) {
        appendChip(el, cls, 'interaction-chip interaction-chip--consequence', '#6366f1');
      }
    }
  }

  const why = buildWhyBlock(interaction);
  if (why) {
    const whyEl = document.createElement('p');
    whyEl.className = 'timeline-event__why';
    whyEl.textContent = why;
    el.appendChild(whyEl);
  }

  // ── HEC v1 §9b (D-HEC-9): evidence disclosure — what evidence EXISTS
  // and what does NOT, for EVERY interaction type. Read only from recorded
  // facts via buildEvidenceDisclosures; presentation-only (AC-25/R-E4 —
  // never a classification, admission, IR, or KR input).
  const disclosure = buildEvidenceDisclosures(interaction);
  const disclosureParts: string[] = [];
  const disclosureOrder: Array<[keyof typeof disclosure, string]> = [
    ['domChanges', 'DOM'],
    ['visibilityChanges', 'visibility'],
    ['newSurfaces', 'surfaces'],
    ['network', 'network'],
    ['navigation', 'navigation'],
    ['collections', 'collections'],
    ['counters', 'counters'],
  ];
  for (const [key, label] of disclosureOrder) {
    const e = disclosure[key];
    disclosureParts.push(`${label}: ${e.available ? String(e.count) : 'not captured'}`);
  }
  const disclosureEl = document.createElement('p');
  disclosureEl.className = 'timeline-event__value interaction-disclosure';
  disclosureEl.textContent = `evidence — ${disclosureParts.join(' · ')}`;
  el.appendChild(disclosureEl);

  const footer = buildEvidenceFooter(interaction.behavioralEvidence);
  if (footer) {
    appendChip(el, footer, 'interaction-chip interaction-chip--footer', '#94a3b8');
  }

  // MS-U1 A8: assertion chip — count of IR assertions derived for this
  // interaction's source event (join: triggerEvent.eventId →
  // IRStep.sourceEventId; ir-bridge.ts:587 writes the same id on the step).
  const assertionCount = getAssertionCountFor(interaction.triggerEvent?.eventId);
  if (assertionCount !== null) {
    const noun = assertionCount === 1 ? 'assertion' : 'assertions';
    appendChip(
      el,
      `${assertionCount} ${noun}`,
      'interaction-chip interaction-chip--assertions',
      assertionCount > 0 ? '#0ea5e9' : '#94a3b8',
    );
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

  return el;
}

// ── Evidence display helpers (M7) ────────────────────────────────────

/**
 * Attach behavioral evidence (or a placeholder) to an interaction element.
 *
 * If the interaction already has behavioralEvidence, render it.
 * Otherwise, show a placeholder that will be replaced when
 * INTERACTION_EVIDENCE_UPDATE arrives.
 *
/**
 * 6F-M3 O13: which view is rendering — the live timeline keeps the
 * "Collecting…" placeholder; the stopped view must never promise collection
 * that ended. Default 'live' preserves pre-change behavior for every caller
 * that does not opt in.
 */
type EvidenceView = 'live' | 'stopped';

/**
 * Wrapped in try/catch so a malformed evidence object renders a safe
 * fallback rather than aborting the entire render loop.
 */
function attachEvidenceDisplay(
  el: HTMLElement,
  interaction: ComponentInteraction,
  view: EvidenceView = 'live',
): void {
  if (interaction.behavioralEvidence) {
    try {
      const container = document.createElement('div');
      container.className = 'evidence-container';
      el.appendChild(container);
      renderEvidence(container, interaction.behavioralEvidence);
    } catch (err) {
      // Evidence is malformed — render a safe fallback instead of crashing
      console.warn(
        '[Evidence] render failed for interaction',
        interaction.interactionId,
        err,
      );
      const note = document.createElement('div');
      note.className = 'evidence-placeholder';
      note.textContent = '⚠️ Evidence data incomplete';
      el.appendChild(note);
    }
  } else if (view === 'stopped') {
    // 6F-M3 O13: the recording has ended — nothing more will arrive.
    // Honest terminal note instead of the misleading "Collecting…".
    el.appendChild(renderEvidenceTerminal());
  } else {
    el.appendChild(renderEvidencePlaceholder());
  }
}

/**
 * Render an array of ComponentInteractions into a container.
 */
export function renderInteractions(
  container: HTMLElement,
  interactions: ComponentInteraction[],
  view: EvidenceView = 'live',
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
    try {
      const el = createInteractionElement(interaction);
      attachEvidenceDisplay(el, interaction, view);
      container.appendChild(el);
    } catch (err) {
      // One card failed — render a minimal fallback so the remaining
      // cards are still visible to the user.
      console.warn(
        '[Interaction] render failed for',
        interaction?.interactionId,
        err,
      );
      const fallback = document.createElement('div');
      fallback.className = 'timeline-event interaction-event';
      const idBadge = document.createElement('span');
      idBadge.className = 'timeline-event__id';
      idBadge.textContent = interaction?.interactionId ?? 'unknown';
      fallback.appendChild(idBadge);
      const desc = document.createElement('p');
      desc.className = 'timeline-event__title interaction-action-text';
      desc.textContent = `${interaction?.type ?? 'Unknown'} (render error)`;
      fallback.appendChild(desc);
      container.appendChild(fallback);
    }
  }
}

/**
 * Render only production interactions (filtered).
 * Uses the same filter logic as the presentation layer.
 *
 * MS-U1: optional `options.showHidden` renders ALL interactions with a
 * suppression-reason chip on each suppressed card (show-and-mark, D3/D8).
 * Default (no options) preserves pre-MS-U1 behavior exactly.
 *
 * Hover-capture generic fix v1 (G5): in the STOPPED view, a completed
 * consumed-by-click hover whose trigger identity matches the following
 * click folds under that click card — one user action, one card. The live
 * timeline is unchanged (recording order remains visible while recording).
 */
export interface RenderOptions {
  showHidden?: boolean;
  /** 6F-M3 O13: 'stopped' renders the honest terminal note for cards with
   *  no behavioral evidence (default 'live' = pre-change behavior). */
  view?: 'live' | 'stopped';
}

export function renderProductionInteractions(
  container: HTMLElement,
  interactions: ComponentInteraction[],
  options?: RenderOptions,
): void {
  if (options?.showHidden === true) {
    renderInteractions(container, interactions, options?.view ?? 'live');
    for (const interaction of interactions) {
      const reason = suppressionReason(interaction);
      if (!reason) continue;
      const card = findCardById(container, interaction.interactionId);
      if (!card || card.querySelector('.interaction-chip--suppressed')) continue;
      appendChip(card, reason, 'interaction-chip interaction-chip--suppressed', '#f59e0b');
    }
    return;
  }
  const production = interactions.filter(isProductionInteraction);
  if (options?.view === 'stopped') {
    renderStoppedWithFoldedPairs(container, production);
    return;
  }
  renderInteractions(container, production, options?.view ?? 'live');
}

/**
 * G5: stopped view with hover→click pair folding. Folded hovers render as a
 * nested detail row inside their click card (collapsed by default) instead
 * of a separate card.
 */
function renderStoppedWithFoldedPairs(
  container: HTMLElement,
  interactions: ComponentInteraction[],
): void {
  const fold = foldHoverClickPairs(interactions);
  const byId = new Map(interactions.map((i) => [i.interactionId, i]));
  container.innerHTML = '';

  if (interactions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'timeline__empty';
    empty.textContent = 'No interactions captured.';
    container.appendChild(empty);
    return;
  }

  for (const interactionId of fold.order) {
    const interaction = byId.get(interactionId);
    if (!interaction) continue;
    try {
      const el = createInteractionElement(interaction);
      attachEvidenceDisplay(el, interaction, 'stopped');
      const pairIdx = fold.foldedUnder.get(interaction.interactionId);
      if (pairIdx !== undefined) {
        for (const foldedHover of fold.pairs[pairIdx].folded) {
          el.appendChild(buildFoldedHoverRow(foldedHover));
        }
      }
      container.appendChild(el);
    } catch (err) {
      console.warn('[Interaction] render failed for', interaction?.interactionId, err);
      const fallback = document.createElement('div');
      fallback.className = 'timeline-event interaction-event';
      const idBadge = document.createElement('span');
      idBadge.className = 'timeline-event__id';
      idBadge.textContent = interaction.interactionId;
      fallback.appendChild(idBadge);
      const desc = document.createElement('p');
      desc.className = 'timeline-event__title interaction-action-text';
      desc.textContent = `${interaction.type ?? 'Unknown'} (render error)`;
      fallback.appendChild(desc);
      container.appendChild(fallback);
    }
  }
}

/** G5: the nested row for a folded hover inside its click card. */
function buildFoldedHoverRow(hover: ComponentInteraction): HTMLElement {
  const row = document.createElement('details');
  row.className = 'interaction-folded-hover';
  const summary = document.createElement('summary');
  // HEC v1 §9b/AC-16: the nested row carries the RECORDED verdict + reason
  // — the folded hover's classification is still explained from capture
  // evidence, never just a duration line.
  const meta = (hover.metadata ?? {}) as Record<string, unknown>;
  const verdict = (meta.hoverQualification as { verdict?: string } | undefined)?.verdict;
  const reason = typeof meta.evidenceReason === 'string' ? meta.evidenceReason : null;
  const dwell = String(meta.dwellMs ?? 0);
  const verdictNote = verdict
    ? ` — hover ${verdict}${reason ? `: ${reason}` : ''}`
    : '';
  summary.textContent = `↳ hovered before click (${dwell}ms)${verdictNote}`;
  row.appendChild(summary);
  const inner = document.createElement('div');
  inner.className = 'interaction-folded-hover__body';
  try {
    attachEvidenceDisplay(inner, hover, 'stopped');
  } catch {
    // Folded hover evidence failed to render — keep the row honest but empty.
  }
  row.appendChild(inner);
  return row;
}

function findCardById(container: HTMLElement, interactionId: string): HTMLElement | null {
  for (const card of container.querySelectorAll<HTMLElement>('.interaction-event')) {
    if (card.querySelector<HTMLElement>('.timeline-event__id')?.textContent === interactionId) {
      return card;
    }
  }
  return null;
}

/** Production filter — single source shared by default render + hidden count. */
function isProductionInteraction(i: ComponentInteraction): boolean {  if (i.endState !== 'completed') return false;
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
      // HEC v1 §9: same recorded-verdict admission as suppressionReason —
      // a single derivation source for the panel.
      return hoverRecordedVerdict(i) === 'evidenced';
    default:
      return true;
  }
}
