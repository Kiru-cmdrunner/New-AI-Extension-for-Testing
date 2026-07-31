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
 */

import type { ElementIdentity } from '../shared/types';
import type {
  RecordedEvent,
  NavigationRecordedEvent,
  ElementRecordedEvent,
} from '../recorder/recorded-event';
import type { DetectedInteraction } from '../classifier/interaction-types';
import { TYPE_DISPLAY } from '../classifier/interaction-types';
import { renderConfigurationSummary, type ConfigurationSession } from '../enrichment/structural-enrichment';

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

// ════════════════════════════════════════════════════════════════════════
// DETECTED INTERACTION RENDERING (Phase 2)
// ════════════════════════════════════════════════════════════════════════

/**
 * Format metadata into a readable summary string.
 */
function formatInteractionMetadata(interaction: DetectedInteraction): string {
  const m = interaction.metadata;
  const parts: string[] = [];

  // checked and scrollPosition are already conveyed in the action description
  if (m.hoverDuration) parts.push(`${m.hoverDuration}ms`);

  return parts.join(' · ');
}

/**
 * Clean up a field label by stripping leading instruction verbs.
 *
 * Input fields on real websites often have labels or placeholders like
 * "Enter your mobile phone number" or "Please enter your email". Since the
 * action description already starts with "Enter ...", we strip those prefixes
 * to avoid doubled verbs like "Enter Enter your mobile phone number".
 *
 * Additionally, date-format placeholders like "yyyy-dd-mm" are NOT useful
 * labels — they're the input's placeholder format hint, not the field name.
 * We strip them entirely so the description doesn't read e.g.
 * "Enter yyyy-dd-mm "2023-01-15"".
 */
const DATE_FORMAT_TOKENS = new Set(['yyyy', 'yy', 'mm', 'dd', 'd', 'm']);
function isDateFormatPlaceholder(str: string): boolean {
  if (!str || str.length < 4) return false;
  const tokens = str.split(/[-/_\.\s]+/).filter(Boolean);
  if (tokens.length < 2) return false;
  let dateTokenCount = 0;
  for (const token of tokens) {
    if (DATE_FORMAT_TOKENS.has(token.toLowerCase())) {
      dateTokenCount++;
    }
  }
  return dateTokenCount >= 2;
}

function cleanFieldLabel(name: string): string {
  let cleaned = name
    .replace(/^(please\s+)?enter\s+(your\s+)?/i, '')
    .replace(/^(please\s+)?type\s+(your\s+)?/i, '')
    .replace(/^(please\s+)?input\s+(your\s+)?/i, '')
    .trim();
  // Date-format placeholders are not real field labels
  if (isDateFormatPlaceholder(cleaned)) {
    cleaned = '';
  }
  return cleaned;
}

/**
 * Extract a readable hostname+path from a URL, stripping protocol and quotes.
 *
 * "https://www.avisford.com/service-appointment.aspx" → "www.avisford.com/service-appointment.aspx"
 */
function urlToDisplay(url: string): string {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    // Not a valid URL — return as-is without protocol
    return url.replace(/^https?:\/\//, '');
  }
}

/**
 * Generate an action-oriented description for an interaction.
 *
 * Examples:
 *   TextEntry  → 'Enter mobile phone number "9894438714"'
 *   NativeDropdown → 'Select "LEXUS" from Make'
 *   DatePicker → 'Select date "August 15"'
 *   Checkbox → 'Check "Enable notifications"'
 *   Click → 'Click "Continue"'
 *   Hover → 'Hover over "Service"'
 *   PageNavigation → 'Navigate to www.avisford.com/service-appointment.aspx'
 *   Link → 'Click "Schedule"'
 */

/** Generic HTML tags that are not meaningful field names for display. */
const GENERIC_TAGS = new Set([
  'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'DIV', 'SPAN',
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'OPTION',
]);

export function actionDescription(interaction: DetectedInteraction): string {
  const type = interaction.type;
  const m = interaction.metadata;
  // Get a meaningful name — fall back through accessibleName → ariaLabel → name
  // but skip generic tag names (INPUT, SELECT, etc.) which aren't useful to display
  const rawName = interaction.target?.accessibleName
    || interaction.target?.ariaLabel
    || interaction.target?.name
    || '';
  const nameFromTag = interaction.target?.tag || '';
  const nameCandidate = rawName || (GENERIC_TAGS.has(nameFromTag) ? '' : nameFromTag);
  const targetName = cleanFieldLabel(nameCandidate);

  let description: string;

  // ── Semantic Action Override ──
  // When the semantic reasoner enriches an interaction with a semanticAction,
  // it overrides the normal type-based description to describe what the user
  // accomplished rather than which event fired.
  if (m.semanticAction === 'configure' && m.configuredFields) {
    const fields = Object.entries(m.configuredFields)
      .map(([field, value]) => `${field}=${value}`)
      .join(', ');
    const label = m.panelLabel || targetName || 'Options';
    description = fields
      ? `Configure ${label}: ${fields}`
      : `Configure ${label}`;
    return description;
  }

  // PageNavigation with formSubmitAction: describe as authentication
  if (m.semanticAction === 'authenticate') {
    const action = m.formSubmitAction || 'Login';
    if (m.url) {
      description = `Log in (${action}) → ${urlToDisplay(m.url)}`;
    } else {
      description = `Log in (${action})`;
    }
    return description;
  }
  switch (type) {
    case 'PageNavigation':
      description = m.url ? `Navigate to ${urlToDisplay(m.url)}` : `Navigate${targetName ? ` "${targetName}"` : ''}`;
      break;

    case 'TextEntry':
      if (m.textValue !== undefined) {
        description = targetName
          ? `Enter ${targetName} "${m.textValue}"`
          : `Enter "${m.textValue}"`;
      } else {
        description = `Enter text${targetName ? ` in ${targetName}` : ''}`;
      }
      break;

    case 'NativeDropdown':
    case 'CustomDropdown':
    case 'MultiSelect': {
      // Phase 0e: Structural Semantic Enrichment
      // When configurationSession is present, render the field-based summary
      // ("Configure Economy: Adults=2, Children=1, Class=Premium Economy")
      // instead of the raw action sequence.
      const cs = m.configurationSession;
      if (cs && typeof cs === 'object' && 'fields' in cs) {
        description = renderConfigurationSummary(cs as ConfigurationSession);
        break;
      }
      // Multi-config panel: display each subAction as a separate step
      if (m.subActions && Array.isArray(m.subActions) && m.subActions.length > 0) {
        const parts = (m.subActions as Array<{ action: string; label: string; value?: string }>).map(sa => {
          switch (sa.action) {
            case 'increment':
              return `Increase ${sa.label}`;
            case 'decrement':
              return `Decrease ${sa.label}`;
            case 'toggle':
              return `${sa.value === 'checked' ? 'Check' : 'Uncheck'} ${sa.label}`;
            case 'selectOption':
              return `Select "${sa.value || sa.label}"`;
            case 'fillInput':
              return `Enter "${sa.value || ''}" in ${sa.label}`;
            case 'confirm':
              return 'Done';
            default:
              return sa.label;
          }
        });
        const prefix = targetName ? `${targetName}: ` : '';
        description = `${prefix}${parts.join(' → ')}`;
      } else if (m.selectedValue) {
        description = targetName
          ? `Select "${m.selectedValue}" from ${targetName}`
          : `Select "${m.selectedValue}"`;
      } else {
        description = `Select option${targetName ? ` from ${targetName}` : ''}`;
      }
      break;
    }

    case 'Autocomplete':
      if (m.textValue && m.selectedValue) {
        description = targetName
          ? `Search "${m.textValue}" and select "${m.selectedValue}" (${targetName})`
          : `Search "${m.textValue}" and select "${m.selectedValue}"`;
      } else if (m.selectedValue) {
        description = targetName
          ? `Search and select "${m.selectedValue}" (${targetName})`
          : `Search and select "${m.selectedValue}"`;
      } else if (m.textValue) {
        description = targetName
          ? `Search "${m.textValue}" (${targetName})`
          : `Search "${m.textValue}"`;
      } else {
        description = `Search${targetName ? ` ${targetName}` : ''}`;
      }
      break;

    case 'DatePicker':
      if (m.dateValue) {
        description = targetName
          ? `Select date "${m.dateValue}" (${targetName})`
          : `Select date "${m.dateValue}"`;
      } else {
        description = `Select date${targetName ? ` (${targetName})` : ''}`;
      }
      break;

    case 'TimePicker':
      if (m.timeValue) {
        description = targetName
          ? `Set time to "${m.timeValue}" (${targetName})`
          : `Set time to "${m.timeValue}"`;
      } else {
        description = `Set time${targetName ? ` (${targetName})` : ''}`;
      }
      break;

    case 'DateTimePicker':
      if (m.dateTimeValue) {
        description = targetName
          ? `Select date and time "${m.dateTimeValue}" (${targetName})`
          : `Select date and time "${m.dateTimeValue}"`;
      } else {
        description = `Select date and time${targetName ? ` (${targetName})` : ''}`;
      }
      break;

    case 'Checkbox':
      if (m.checked !== undefined) {
        description = `${m.checked ? 'Check' : 'Uncheck'} "${targetName}"`;
      } else {
        description = `Click checkbox "${targetName}"`;
      }
      break;

    case 'RadioButton':
      description = m.selectedValue
        ? `Select "${m.selectedValue}" radio button`
        : `Select "${targetName}"`;
      break;

    case 'ToggleSwitch':
      if (m.checked !== undefined) {
        description = `${m.checked ? 'Enable' : 'Disable'} "${targetName}"`;
      } else {
        description = `Toggle "${targetName}"`;
      }
      break;

    case 'Slider': {
      if (m.sliderValue !== undefined) {
        const range: string[] = [];
        if (m.sliderMin && m.sliderMax) {
          range.push(`range: ${m.sliderMin} – ${m.sliderMax}`);
        } else if (m.sliderMin) {
          range.push(`min: ${m.sliderMin}`);
        } else if (m.sliderMax) {
          range.push(`max: ${m.sliderMax}`);
        }
        const rangeStr = range.length ? ` (${range.join(', ')})` : '';
        description = targetName
          ? `Set "${targetName}" to ${m.sliderValue}${rangeStr}`
          : `Set slider to ${m.sliderValue}${rangeStr}`;
      } else {
        description = targetName
          ? `Adjust "${targetName}" slider`
          : 'Adjust slider';
      }
      break;
    }

    case 'Tab':
      description = targetName
        ? `Click "${targetName}" tab`
        : 'Click tab';
      break;

    case 'FileUpload': {
      const files = m.files ?? [];
      const method = m.uploadMethod === 'drag-drop' ? ' by drag-drop' : '';
      if (files.length === 1) {
        description = targetName
          ? `Upload "${files[0]}" to "${targetName}"${method}`
          : `Upload "${files[0]}"${method}`;
      } else if (files.length > 1) {
        description = targetName
          ? `Upload ${files.length} files to "${targetName}"${method}`
          : `Upload ${files.length} files${method}`;
      } else {
        description = `Upload file${targetName ? ` "${targetName}"` : ''}`;
      }
      break;
    }

    case 'DragDropUpload': {
      const files = m.files ?? [];
      const area = targetName || 'Upload Area';
      if (files.length === 1) {
        description = `Drag "${files[0]}" to "${area}"`;
      } else if (files.length > 1) {
        description = `Drag ${files.length} files to "${area}"`;
      } else {
        description = `Drag file to "${area}"`;
      }
      break;
    }

    case 'Hover':
      description = `Hover over "${targetName}"`;
      break;

    case 'PageScroll':
      description = `Scroll page${m.scrollPosition ? ` to (${m.scrollPosition.x}, ${m.scrollPosition.y})` : ''}`;
      break;

    case 'ContainerScroll':
      description = `Scroll "${targetName}"${m.scrollPosition ? ` to (${m.scrollPosition.x}, ${m.scrollPosition.y})` : ''}`;
      break;

    case 'DragDrop':
      description = m.sourceElement && m.dropTarget
        ? `Drag "${m.sourceElement}" to "${m.dropTarget}"`
        : m.sourceElement
          ? `Drag "${m.sourceElement}"`
          : m.dropTarget
            ? `Drop on "${m.dropTarget}"`
            : `Drag and drop "${targetName}"`;
      break;

    case 'Link':
      description = `Click "${targetName}"`;
      break;

    case 'Breadcrumb':
      description = targetName
        ? `Click "${targetName}" breadcrumb`
        : 'Click breadcrumb';
      break;

    case 'Menu':
      description = targetName
        ? `Click "${targetName}" menu item`
        : 'Click menu item';
      break;

    case 'BrowserAlert': {
      const dtype = m.dialogType ?? 'alert';
      const msg = m.dialogMessage;
      const prefixes: Record<string, string> = {
        alert: 'Alert',
        confirm: 'Confirm',
        prompt: 'Prompt',
      };
      const prefix = prefixes[dtype] ?? 'Alert';
      description = msg
        ? `${prefix} dialog "${msg}" appeared`
        : `${prefix} dialog appeared`;
      break;
    }

    case 'NewTab':
      description = m.openedUrl
        ? `Open "${m.openedUrl}" in new tab`
        : 'Open new tab';
      break;

    case 'NewWindow':
      description = m.openedUrl
        ? `Open "${m.openedUrl}" in new window`
        : 'Open new window';
      break;

    case 'DoubleClick':
      description = `Double-click "${targetName}"`;
      break;

    case 'RightClick':
      description = `Right-click "${targetName}"`;
      break;

    case 'Click':
      description = `Click "${targetName}"`;
      break;

    case 'Modal':
      description = m.surfaceLabel
        ? `Modal "${m.surfaceLabel}" appeared`
        : `Modal appeared after clicking "${targetName}"`;
      break;

    case 'Drawer':
      description = m.surfaceLabel
        ? `Drawer "${m.surfaceLabel}" opened`
        : `Drawer opened after clicking "${targetName}"`;
      break;

    case 'Popover':
      description = m.surfaceLabel
        ? `Popover "${m.surfaceLabel}" appeared`
        : `Popover appeared after clicking "${targetName}"`;
      break;

    case 'Tooltip':
      description = m.surfaceLabel
        ? `Tooltip "${m.surfaceLabel}" shown`
        : `Tooltip appeared after hovering "${targetName}"`;
      break;

    default:
      description = targetName
        ? `${TYPE_DISPLAY[type]?.label ?? type} "${targetName}"`
        : `${TYPE_DISPLAY[type]?.label ?? type}`;
  }

  // ── Iframe enrichment suffix ──
  // If the interaction occurred inside an iframe, append the iframe context
  // to the description. This enriches ANY interaction type with iframe info.
  if (m.iframeSrc || m.iframeName) {
    const frameName = m.iframeName || 'iframe';
    description += ` (in ${frameName})`;
  }

  return description;
}

/**
 * Create a DOM element for a DetectedInteraction.
 *
 * Card structure:
 *   [Summary]  (always visible)
 *     type badge · interaction ID · action description · metadata
 *   [▶ Details] (collapsed by default)
 *     raw event types · confidence · engine badge
 */
export function createDetectedInteractionElement(interaction: DetectedInteraction): HTMLElement {
  const el = document.createElement('div');
  el.className = 'timeline-event interaction-event';

  const display = TYPE_DISPLAY[interaction.type] ?? TYPE_DISPLAY.Unknown;

  // Border color by type
  el.style.borderLeft = `3px solid ${display.color}`;

  // ── Summary section (always visible) ───────────────────────────────────

  const summary = document.createElement('div');
  summary.className = 'interaction-summary';

  // Type icon + label badge
  const badge = document.createElement('span');
  badge.className = 'timeline-event__type interaction-badge';
  badge.textContent = `${display.icon} ${display.label}`;
  badge.style.backgroundColor = `${display.color}15`;
  badge.style.color = display.color;
  summary.appendChild(badge);

  // Interaction ID
  const idBadge = document.createElement('span');
  idBadge.className = 'timeline-event__id';
  idBadge.textContent = interaction.interactionId;
  summary.appendChild(idBadge);

  // Action-oriented description
  const title = document.createElement('p');
  title.className = 'timeline-event__title interaction-action-text';
  title.textContent = actionDescription(interaction);
  summary.appendChild(title);

  // Additional metadata (non-value metadata)
  const metaText = formatInteractionMetadata(interaction);
  if (metaText) {
    const meta = document.createElement('p');
    meta.className = 'timeline-event__value';
    meta.textContent = metaText;
    summary.appendChild(meta);
  }

  el.appendChild(summary);

  // ── Developer details toggle (collapsed by default) ────────────────────

  const detailsToggle = document.createElement('button');
  detailsToggle.className = 'collapsible-toggle interaction-details-toggle';
  detailsToggle.textContent = '▶ Details';

  const detailsContent = document.createElement('div');
  detailsContent.className = 'interaction-details';
  detailsContent.hidden = true;

  // Raw event types
  const eventsEl = document.createElement('p');
  eventsEl.className = 'element-identity__chips';
  eventsEl.textContent = `Events: [${interaction.rawEventTypes.join(', ')}]`;
  detailsContent.appendChild(eventsEl);

  // Confidence badge — now in developer details only
  if (interaction.confidence < 1.0) {
    const confEl = document.createElement('p');
    confEl.className = 'timeline-event__value';
    confEl.textContent = `Confidence: ${(interaction.confidence * 100).toFixed(0)}%`;
    detailsContent.appendChild(confEl);
  }

  // Engine badge — also in developer details
  if (interaction.engine) {
    const engineEl = document.createElement('p');
    engineEl.className = 'timeline-event__value';
    engineEl.textContent = `Engine: ${interaction.engine === 'v2' ? 'V2' : interaction.engine === 'control' ? 'Control' : 'V1'}`;
    detailsContent.appendChild(engineEl);
  }

  detailsToggle.addEventListener('click', () => {
    detailsContent.hidden = !detailsContent.hidden;
    detailsToggle.textContent = detailsContent.hidden ? '▶ Details' : '▼ Details';
  });

  el.appendChild(detailsToggle);
  el.appendChild(detailsContent);

  return el;
}

/**
 * Render detected interactions into a container.
 */
export function renderDetectedInteractions(
  container: HTMLElement,
  interactions: DetectedInteraction[],
): void {
  container.innerHTML = '';

  if (interactions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'timeline__empty';
    empty.textContent = 'No interactions detected.';
    container.appendChild(empty);
    return;
  }

  for (const interaction of interactions) {
    // Suppress internal-tier types (standalone Stepper should never appear)
    if (interaction.type === 'Stepper') continue;
    container.appendChild(createDetectedInteractionElement(interaction));
  }
}
