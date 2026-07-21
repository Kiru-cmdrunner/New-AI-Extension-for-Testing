/**
 * Interaction Type Registry — central registry for all interaction types.
 *
 * v3.0.0 — Click interaction registered (Milestone 3).
 *
 * The registry pattern is the architectural foundation for the new
 * interaction engine. Each interaction type registers a config here.
 */

import type {
  AIUnderstanding,
  ElementIdentity,
} from '../shared/types';
import type { RecordingSession } from './recording-session';

// ── Registry Types (preserved architecture) ────────────────

/** Element info sent to the AI for understanding. */
export interface ActionElementInfo {
  actionType: string;
  text: string;
  tag: string;
  role: string | null;
  className: string | null;
}

/**
 * Context passed to toPlainEnglish() for generating human-readable text.
 */
export interface PlainEnglishContext {
  identity: ElementIdentity;
  understanding: AIUnderstanding | undefined;
  extras: ActionExtras;
}

/**
 * Type-specific extra data for an action.
 * Empty in v2.2.0 — will grow as interactions are added.
 */
export interface ActionExtras {
  [key: string]: unknown;
}

/**
 * Base event shape for action events (non-navigation).
 * Will be extended by each interaction type.
 */
export interface BaseActionEvent {
  actionId: string;
  type: string;
  timestamp: string;
  elementIdentity: ElementIdentity;
  aiUnderstanding?: AIUnderstanding;
  aiError?: string;
  /** Text value (text entry, select). Present on events that carry a value. */
  value?: string;
  /** Checkbox state. Present on checkbox events. */
  checked?: boolean;
  /** Display value (date pickers). Present on dateSelect events. */
  displayValue?: string;
  /** Date picker type. Present on dateSelect events. */
  dateType?: string;
  /** ISO value. Present on dateSelect events. */
  isoValue?: string;
  /** Range start display value. Present on dateSelect range events. */
  startDisplayValue?: string;
  /** Range end display value. Present on dateSelect range events. */
  endDisplayValue?: string;
  /** Range start ISO value. Present on dateSelect range events. */
  startIsoValue?: string;
  /** Range end ISO value. Present on dateSelect range events. */
  endIsoValue?: string;
}

/**
 * Configuration for a single interaction type.
 * Each interaction type registers one of these.
 */
export interface InteractionTypeConfig {
  /** The action type string, e.g. 'click'. */
  actionType: string;
  /** ID prefix for action IDs, e.g. 'click'. */
  idPrefix: string;
  /** Badge color for timeline rendering (CSS color). */
  badgeColor: string;
  /** Badge label for timeline rendering. */
  badgeLabel: string;

  /**
   * Build the AI prompt for understanding this interaction.
   */
  buildPrompt(info: ActionElementInfo): string;

  /**
   * Generate the plain English description for this interaction.
   */
  toPlainEnglish(ctx: PlainEnglishContext): string;

  /**
   * Render a short title for the timeline element.
   */
  renderTitle(event: BaseActionEvent): string;

  /**
   * Extract type-specific fields for the execution JSON.
   */
  executionExtras(event: BaseActionEvent): Record<string, unknown>;

  /**
   * Add this action to the recording session.
   * Returns the created event, or null if recording is not active.
   */
  addToSession(
    session: RecordingSession,
    rawIdentity: import('../shared/types').RawElementIdentity,
    extras: ActionExtras,
  ): Promise<BaseActionEvent | null>;
}

// ── Shared Helpers (preserved) ─────────────────────────────

/**
 * Resolve the best display name for an element.
 * Priority:
 *   1. AI business name (if the element is NOT a misclassified icon)
 *   2. accessible name
 *   3. tag
 *
 * ICON GUARD: When the element is an icon (<i>, <svg>, etc.) with no
 * accessible name, the AI often misclassifies it as "Italic Text" or
 * "Text Formatting" because <i> historically means italic. This guard
 * detects that case and falls through to the tag-based fallback,
 * allowing isIconElement() to produce "Click the [tag] icon".
 */
export function resolveDisplayName(
  identity: ElementIdentity,
  understanding: AIUnderstanding | undefined,
): string {
  // Icon guard: if the element is an icon tag with no accessible name,
  // check whether the AI misclassified it as text formatting
  if (isIconElement(identity.tag, identity.accessibleName)) {
    const aiName = understanding?.businessName || '';
    const isMisclassified =
      /italic|text\s*format/i.test(aiName) ||
      (identity.tag === 'I' && !/\bicon\b/i.test(aiName));

    if (isMisclassified) {
      // AI misclassified the icon — fall through to accessible name or tag
      return identity.accessibleName || identity.tag;
    }
  }

  return (
    understanding?.businessName ||
    identity.accessibleName ||
    identity.tag
  );
}

/** Shared instruction appended to all AI prompts. */
export const SHARED_JSON_INSTRUCTION = `Respond with ONLY a JSON object (no markdown, no code blocks) with these fields:
  - businessName: a clear, human-readable name for this element (e.g. "Login Button", "Email Field")
  - controlType: the UI control type (e.g. "Button", "Link", "Text Field", "Dropdown")
  - userIntent: what the user is trying to accomplish (e.g. "Submit the login form")
  - confidenceScore: your confidence (0.0 to 1.0)`;

/**
 * Build the header lines for an AI prompt.
 */
export function buildPromptHeader(info: ActionElementInfo): string {
  const lines: string[] = [];
  lines.push(`Element: ${info.text}`);
  lines.push(`HTML tag: ${info.tag}`);
  if (info.role) {
    lines.push(`ARIA role: ${info.role}`);
  }
  if (info.className) {
    lines.push(`CSS classes: ${info.className}`);
  }
  return lines.join('\n');
}

// ── Registry ───────────────────────────────────────────────

const registry = new Map<string, InteractionTypeConfig>();

/**
 * Register an interaction type.
 */
export function registerInteractionType(config: InteractionTypeConfig): void {
  registry.set(config.actionType, config);
}

/**
 * Get the config for an interaction type.
 * Returns undefined if the type is not registered.
 */
export function getInteractionType(actionType: string): InteractionTypeConfig | undefined {
  return registry.get(actionType);
}

/**
 * Get all registered interaction types.
 */
export function getRegisteredTypes(): string[] {
  return Array.from(registry.keys());
}

// ── Click Interaction Config ───────────────────────────────

/**
 * Truncate a string to max length.
 */
function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) : str;
}

/**
 * Determine if an element is an icon (no accessible name but has a tag
 * that is typically visual: svg, path, img with no alt, i, span inside button).
 *
 * Product Spec (Milestone 1): "Click the Search icon" — when there is
 * no text content, describe the icon contextually.
 */
function isIconElement(tag: string, accessibleName: string): boolean {
  if (accessibleName) return false; // Has a name — not icon-only
  return ['SVG', 'PATH', 'I'].includes(tag);
}

/**
 * Click interaction type configuration.
 *
 * Implements the frozen product spec and architecture:
 *   - Plain English: Click "[name]" or "Click the [tag] icon"
 *   - AI prompt: Element + tag + role + intent analysis
 *   - Timeline: blue badge, "Click" label
 *   - Session: delegates to session.addAction()
 *
 * Architecture Principle 9: Single responsibility — Click owns only Click.
 */
const clickConfig: InteractionTypeConfig = {
  actionType: 'click',
  idPrefix: 'click',
  badgeColor: '#3b82f6',
  badgeLabel: 'Click',

  buildPrompt(info: ActionElementInfo): string {
    const lines: string[] = [];
    lines.push('INTERACTION TYPE: Click');
    lines.push('');
    lines.push(buildPromptHeader(info));

    // Icon-specific guidance
    const isIconTag = ['I', 'SVG', 'PATH', 'SPAN'].includes(info.tag.toUpperCase());
    const hasIconClass = info.className && (
      /\b(fa|fas|far|fab|fal|fad|material-icons|material-symbols|bi-|glyphicon|icon|oi)\b/i.test(info.className)
    );
    if (isIconTag || hasIconClass) {
      lines.push('');
      lines.push('IMPORTANT: In modern web development, <i>, <svg>, and <span> elements are');
      lines.push('commonly used for ICONS (not italic text). Icon libraries include FontAwesome');
      lines.push('(fa, fas, far), Material Icons (material-icons), Bootstrap Icons (bi-),');
      lines.push('and others. Determine what icon this is from its CSS classes.');
    }

    lines.push('');
    lines.push('The user clicked this element. Determine its purpose and intent.');
    lines.push('');
    lines.push(SHARED_JSON_INSTRUCTION);
    return lines.join('\n');
  },

  toPlainEnglish(ctx: PlainEnglishContext): string {
    const { identity, understanding } = ctx;

    // Icon guard: if this is an icon element (<i>, <svg>, etc.) with no
    // accessible name, check if the AI misclassified it as text formatting.
    // The AI often sees <i> and returns "Italic Text" — we must prevent that
    // from reaching the output.
    if (isIconElement(identity.tag, identity.accessibleName)) {
      const aiName = understanding?.businessName || '';
      const isMisclassified =
        /italic|text\s*format/i.test(aiName) ||
        (identity.tag === 'I' && !/\bicon\b/i.test(aiName));

      if (isMisclassified) {
        // AI misclassified the icon — use tag-based fallback
        const tagLower = identity.tag.toLowerCase();
        return `Click the ${tagLower} icon`;
      }
    }

    // AI enrichment: use business name if it improves the accessible name
    if (understanding?.businessName) {
      return `Click "${truncate(understanding.businessName, 100)}"`;
    }

    // Accessible name: Click "[name]"
    if (identity.accessibleName) {
      return `Click "${truncate(identity.accessibleName, 100)}"`;
    }

    // Icon element: Click the [tag] icon
    if (isIconElement(identity.tag, identity.accessibleName)) {
      const tagLower = identity.tag.toLowerCase();
      return `Click the ${tagLower} icon`;
    }

    // Fallback: Click [tag]
    return `Click ${identity.tag.toLowerCase()}`;
  },

  renderTitle(event: BaseActionEvent): string {
    // Icon guard: prevent misclassified icon elements from showing as "Italic Text"
    if (isIconElement(event.elementIdentity.tag, event.elementIdentity.accessibleName)) {
      const aiName = event.aiUnderstanding?.businessName || '';
      const isMisclassified =
        /italic|text\s*format/i.test(aiName) ||
        (event.elementIdentity.tag === 'I' && !/\bicon\b/i.test(aiName));

      if (isMisclassified) {
        return truncate(
          event.elementIdentity.accessibleName ||
          `${event.elementIdentity.tag.toLowerCase()} icon`,
          60,
        );
      }
    }

    const name =
      event.aiUnderstanding?.businessName ||
      event.elementIdentity.accessibleName ||
      event.elementIdentity.tag.toLowerCase();
    return truncate(name, 60);
  },

  executionExtras(_event: BaseActionEvent): Record<string, unknown> {
    // Click has no type-specific execution fields beyond the base ExecutionJson.
    // Future interactions may add keys here.
    return {};
  },

  async addToSession(
    session: RecordingSession,
    rawIdentity: import('../shared/types').RawElementIdentity,
    _extras: ActionExtras,
  ): Promise<BaseActionEvent | null> {
    return session.addAction(rawIdentity, 'click', 'click');
  },
};

// Register Click — the first interaction in the new engine.
registerInteractionType(clickConfig);

// ── Text Entry Interaction Config ──────────────────────────

/**
 * Text entry interaction type configuration.
 *
 * Captured when a user types into an input/textarea and moves focus
 * away (blur event). One event per field per focus, containing the
 * final value entered.
 *
 * Plain English: Enter "[value]" into "[field name]"
 */
const textConfig: InteractionTypeConfig = {
  actionType: 'text',
  idPrefix: 'text',
  badgeColor: '#10b981',
  badgeLabel: 'Text',

  buildPrompt(info: ActionElementInfo): string {
    const lines: string[] = [];
    lines.push('INTERACTION TYPE: Text Entry');
    lines.push('');
    lines.push(buildPromptHeader(info));
    lines.push('');
    lines.push('The user entered text into this field. Determine its purpose and intent.');
    lines.push('');
    lines.push(SHARED_JSON_INSTRUCTION);
    return lines.join('\n');
  },

  toPlainEnglish(ctx: PlainEnglishContext): string {
    const { identity, understanding, extras } = ctx;
    const value = (extras.value as string) || '';

    // Field name priority: AI business name > accessible name > tag
    let fieldName = '';
    if (understanding?.businessName) {
      fieldName = truncate(understanding.businessName, 100);
    } else if (identity.accessibleName) {
      fieldName = truncate(identity.accessibleName, 100);
    } else {
      fieldName = identity.tag.toLowerCase();
    }

    if (value) {
      return `Enter "${truncate(value, 100)}" into "${fieldName}"`;
    }
    return `Enter text into "${fieldName}"`;
  },

  renderTitle(event: BaseActionEvent): string {
    const name =
      event.aiUnderstanding?.businessName ||
      event.elementIdentity.accessibleName ||
      event.elementIdentity.tag.toLowerCase();
    const value = event.value;
    if (value) {
      return `${truncate(name, 40)}: ${truncate(value, 20)}`;
    }
    return truncate(name, 60);
  },

  executionExtras(event: BaseActionEvent): Record<string, unknown> {
    const value = event.value;
    return value ? { value } : {};
  },

  async addToSession(
    session: RecordingSession,
    rawIdentity: import('../shared/types').RawElementIdentity,
    extras: ActionExtras,
  ): Promise<BaseActionEvent | null> {
    const event = await session.addAction(rawIdentity, 'text', 'text', extras);
    if (event && extras.value) {
      event.value = extras.value as string;
    }
    return event;
  },
};

// Register Text Entry
registerInteractionType(textConfig);

// ── Hover Interaction Type (C3.2) ─────────────────────────

/**
 * Hover interaction type config.
 *
 * Permanently frozen C3.1: Hover is recorded when the user intentionally
 * pauses on an element and the application produces observable behavior.
 *
 * Plain English format: Hover over "[name]"
 * Naming priority: AI business name → accessible name → tag fallback.
 */
const hoverConfig: InteractionTypeConfig = {
  actionType: 'hover',
  idPrefix: 'hover',
  badgeColor: '#f59e0b',
  badgeLabel: 'Hover',

  buildPrompt(info: ActionElementInfo): string {
    const lines: string[] = [];
    lines.push('INTERACTION TYPE: Hover');
    lines.push('');
    lines.push(buildPromptHeader(info));
    lines.push('');
    lines.push('The user hovered over this element, which revealed new interactive content. Determine the purpose of this hover target.');
    lines.push('');
    lines.push(SHARED_JSON_INSTRUCTION);
    return lines.join('\n');
  },

  toPlainEnglish(ctx: PlainEnglishContext): string {
    const { identity, understanding } = ctx;

    // Naming priority: AI business name → accessible name → tag
    const name = resolveDisplayName(identity, understanding);

    return `Hover over "${truncate(name, 100)}"`;
  },

  renderTitle(event: BaseActionEvent): string {
    const name =
      event.aiUnderstanding?.businessName ||
      event.elementIdentity.accessibleName ||
      event.elementIdentity.tag.toLowerCase();
    return truncate(name, 60);
  },

  executionExtras(_event: BaseActionEvent): Record<string, unknown> {
    // Hover has no extra execution data (no value like text entry)
    return {};
  },

  async addToSession(
    session: RecordingSession,
    rawIdentity: import('../shared/types').RawElementIdentity,
    _extras: ActionExtras,
  ): Promise<BaseActionEvent | null> {
    // Hover uses the standard addAction path with 'hover' type and idPrefix.
    // No extras needed — hover has no value field.
    return session.addAction(rawIdentity, 'hover', 'hover');
  },
};

// Register Hover
registerInteractionType(hoverConfig);

// ── Checkbox Interaction Type (C4.2) ──────────────────────

/**
 * Checkbox interaction type config.
 *
 * Permanently frozen C4.1: Checkbox is recorded only when the user
 * intentionally changes the control's state. The resulting state
 * (checked=true → "Check", checked=false → "Uncheck") determines
 * the plain English and execution action.
 *
 * Plain English format: Check "[name]" / Uncheck "[name]"
 */
const checkboxConfig: InteractionTypeConfig = {
  actionType: 'checkbox',
  idPrefix: 'check',
  badgeColor: '#8b5cf6',
  badgeLabel: 'Check',

  buildPrompt(info: ActionElementInfo): string {
    const lines: string[] = [];
    lines.push('INTERACTION TYPE: Checkbox');
    lines.push('');
    lines.push(buildPromptHeader(info));
    lines.push('');
    lines.push('The user toggled this checkbox control, changing its state. Determine the purpose of this checkbox option.');
    lines.push('');
    lines.push(SHARED_JSON_INSTRUCTION);
    return lines.join('\n');
  },

  toPlainEnglish(ctx: PlainEnglishContext): string {
    const { identity, understanding, extras } = ctx;
    const checked = extras.checked as boolean;

    const name = resolveDisplayName(identity, understanding);

    return checked
      ? `Check "${truncate(name, 100)}"`
      : `Uncheck "${truncate(name, 100)}"`;
  },

  renderTitle(event: BaseActionEvent): string {
    const name =
      event.aiUnderstanding?.businessName ||
      event.elementIdentity.accessibleName ||
      event.elementIdentity.tag.toLowerCase();
    return truncate(name, 60);
  },

  executionExtras(event: BaseActionEvent): Record<string, unknown> {
    const checked = event.checked;
    return checked !== undefined ? { checked } : {};
  },

  async addToSession(
    session: RecordingSession,
    rawIdentity: import('../shared/types').RawElementIdentity,
    extras: ActionExtras,
  ): Promise<BaseActionEvent | null> {
    const event = await session.addAction(rawIdentity, 'checkbox', 'check', extras);
    if (event && extras.checked !== undefined) {
      event.checked = extras.checked as boolean;
    }
    return event;
  },
};

// Register Checkbox
registerInteractionType(checkboxConfig);

// ── Radio Interaction Type (C4.2) ─────────────────────────

/**
 * Radio interaction type config.
 *
 * Permanently frozen C4.1: Radio is recorded only when the user
 * selects a radio that was not previously selected. The resulting
 * action is always "Select".
 *
 * Plain English format: Select "[name]"
 */
const radioConfig: InteractionTypeConfig = {
  actionType: 'radio',
  idPrefix: 'radio',
  badgeColor: '#ec4899',
  badgeLabel: 'Select',

  buildPrompt(info: ActionElementInfo): string {
    const lines: string[] = [];
    lines.push('INTERACTION TYPE: Radio Button');
    lines.push('');
    lines.push(buildPromptHeader(info));
    lines.push('');
    lines.push('The user selected this radio button option from a group. Determine what this option represents.');
    lines.push('');
    lines.push(SHARED_JSON_INSTRUCTION);
    return lines.join('\n');
  },

  toPlainEnglish(ctx: PlainEnglishContext): string {
    const { identity, understanding } = ctx;

    const name = resolveDisplayName(identity, understanding);

    return `Select "${truncate(name, 100)}"`;
  },

  renderTitle(event: BaseActionEvent): string {
    const name =
      event.aiUnderstanding?.businessName ||
      event.elementIdentity.accessibleName ||
      event.elementIdentity.tag.toLowerCase();
    return truncate(name, 60);
  },

  executionExtras(_event: BaseActionEvent): Record<string, unknown> {
    // Radio has no extra execution data (selection is always "select")
    return {};
  },

  async addToSession(
    session: RecordingSession,
    rawIdentity: import('../shared/types').RawElementIdentity,
    _extras: ActionExtras,
  ): Promise<BaseActionEvent | null> {
    return session.addAction(rawIdentity, 'radio', 'radio');
  },
};

// Register Radio
registerInteractionType(radioConfig);

// ── Select (Dropdown) Interaction Type ──────────────────────

/**
 * Dropdown & Select Interaction Type — Value-Based Recording
 *
 * Permanently frozen C5.1: Records the user's selected value from a
 * dropdown control. Only meaningful value changes are recorded.
 * The Canonical Step shows the selected option label: Select "India".
 */
const selectConfig: InteractionTypeConfig = {
  actionType: 'select',
  idPrefix: 'select',
  badgeColor: '#06b6d4', // cyan
  badgeLabel: 'Select',

  buildPrompt(info: ActionElementInfo): string {
    const lines: string[] = [];
    lines.push('INTERACTION TYPE: Dropdown / Select');
    lines.push('');
    lines.push(buildPromptHeader(info));
    lines.push('');
    lines.push('The user selected an option from this dropdown control. Determine the business purpose of this dropdown and the selected option.');
    lines.push('');
    lines.push(SHARED_JSON_INSTRUCTION);
    return lines.join('\n');
  },

  toPlainEnglish(ctx: PlainEnglishContext): string {
    const { identity, understanding, extras } = ctx;

    // The selected value is in extras.value (user-visible option label)
    const selectedValue = (extras.value as string) || '';
    if (selectedValue) {
      return `Select "${truncate(selectedValue, 100)}"`;
    }

    // Fallback: use the control's display name
    const name = resolveDisplayName(identity, understanding);
    return `Select "${truncate(name, 100)}"`;
  },

  renderTitle(event: BaseActionEvent): string {
    // Use the selected value if available, otherwise the control name
    const title = event.value ||
      event.aiUnderstanding?.businessName ||
      event.elementIdentity.accessibleName ||
      event.elementIdentity.tag.toLowerCase();
    return truncate(title, 60);
  },

  executionExtras(event: BaseActionEvent): Record<string, unknown> {
    return event.value !== undefined ? { value: event.value } : {};
  },

  async addToSession(
    session: RecordingSession,
    rawIdentity: import('../shared/types').RawElementIdentity,
    extras: ActionExtras,
  ): Promise<BaseActionEvent | null> {
    const event = await session.addAction(rawIdentity, 'select', 'select', extras);
    if (event && extras.value !== undefined) {
      event.value = extras.value as string;
    }
    return event;
  },
};

// Register Select
registerInteractionType(selectConfig);

// ════════════════════════════════════════════════════════════════
// Date Select (C6.1 / C6.2)
// ════════════════════════════════════════════════════════════════

/**
 * Date Select interaction type configuration.
 *
 * Permanently frozen C6.1: Records the user's selected date, time, or
 * date-range value. Only meaningful committed value changes are recorded.
 *
 * Canonical Step formats:
 *   Select Date "15 July 2026"
 *   Select Date Range "1 July 2026" to "10 July 2026"
 *   Select Time "09:30 AM"
 *   Select Date & Time "15 July 2026 09:30"
 *
 * The extras payload from the content script carries:
 *   dateType, displayValue, isoValue (required)
 *   startDisplayValue, endDisplayValue, startIsoValue, endIsoValue (ranges only)
 */
const dateSelectConfig: InteractionTypeConfig = {
  actionType: 'dateSelect',
  idPrefix: 'dateSelect',
  badgeColor: '#f59e0b', // amber
  badgeLabel: 'Date',

  buildPrompt(info: ActionElementInfo): string {
    const lines: string[] = [];
    lines.push('INTERACTION TYPE: Date Picker / Date Selection');
    lines.push('');
    lines.push(buildPromptHeader(info));
    lines.push('');
    lines.push('The user selected a date, time, or date-range value from a date picker control. Determine the business purpose of this date field (e.g., "Departure Date", "Start Date", "Meeting Time").');
    lines.push('');
    lines.push(SHARED_JSON_INSTRUCTION);
    return lines.join('\n');
  },

  toPlainEnglish(ctx: PlainEnglishContext): string {
    const { extras } = ctx;
    const dateType = (extras.dateType as string) || 'date';
    const displayValue = (extras.displayValue as string) || '';
    const startDisplay = (extras.startDisplayValue as string) || '';
    const endDisplay = (extras.endDisplayValue as string) || '';

    switch (dateType) {
      case 'dateRange':
        if (startDisplay && endDisplay) {
          return `Select Date Range "${truncate(startDisplay, 60)}" to "${truncate(endDisplay, 60)}"`;
        }
        return `Select Date Range "${truncate(displayValue, 100)}"`;

      case 'time':
        return `Select Time "${truncate(displayValue, 40)}"`;

      case 'dateTime':
        return `Select Date & Time "${truncate(displayValue, 60)}"`;

      case 'month':
      case 'week':
      case 'date':
      default:
        return `Select Date "${truncate(displayValue, 60)}"`;
    }
  },

  renderTitle(event: BaseActionEvent): string {
    const title = event.displayValue ||
      event.aiUnderstanding?.businessName ||
      event.elementIdentity.accessibleName ||
      'Date';
    return truncate(title, 60);
  },

  executionExtras(event: BaseActionEvent): Record<string, unknown> {
    const extras: Record<string, unknown> = {};
    if (event.dateType) extras.dateType = event.dateType;
    if (event.displayValue) extras.displayValue = event.displayValue;
    if (event.isoValue) extras.isoValue = event.isoValue;
    if (event.startDisplayValue) extras.startDisplayValue = event.startDisplayValue;
    if (event.endDisplayValue) extras.endDisplayValue = event.endDisplayValue;
    if (event.startIsoValue) extras.startIsoValue = event.startIsoValue;
    if (event.endIsoValue) extras.endIsoValue = event.endIsoValue;
    return extras;
  },

  async addToSession(
    session: RecordingSession,
    rawIdentity: import('../shared/types').RawElementIdentity,
    extras: ActionExtras,
  ): Promise<BaseActionEvent | null> {
    const event = await session.addAction(rawIdentity, 'dateSelect', 'dateSelect', extras);
    if (event) {
      event.dateType = (extras.dateType as string) || 'date';
      event.displayValue = (extras.displayValue as string) || '';
      event.isoValue = (extras.isoValue as string) || '';
      if (extras.startDisplayValue) event.startDisplayValue = extras.startDisplayValue as string;
      if (extras.endDisplayValue) event.endDisplayValue = extras.endDisplayValue as string;
      if (extras.startIsoValue) event.startIsoValue = extras.startIsoValue as string;
      if (extras.endIsoValue) event.endIsoValue = extras.endIsoValue as string;
    }
    return event;
  },
};

// Register Date Select
registerInteractionType(dateSelectConfig);
