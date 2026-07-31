/**
 * TagInput Definition — Token Creation Lifecycle (Priority 45)
 *
 * Tag/chip inputs let users create discrete tokens from typed text. Each
 * Enter or comma creates a new token while focus stays on the same input.
 * The result is an array of tag values, not a single string — fundamentally
 * different from TextEntry's single-value lifecycle.
 *
 * ## Lifecycle
 *
 * ```
 * Trigger: focus on a text input inside a tag-input container
 *          (detected via ancestor classes: tag/chip/token/multi-value)
 *
 * Active:  accumulate typed text on input events.
 *          On keydown Enter/comma: create token from accumulated text,
 *          clear text buffer. Repeat for multiple tokens.
 *
 * Completion:
 *   - blur: complete, pending un-tokenized text becomes final tag
 *   - Focus elsewhere: complete (shouldCompleteOnOutside)
 *   - Flush (navigation): complete (shouldCompleteOnFlush)
 * ```
 *
 * ## Why not TextEntry?
 *
 * TextEntry captures one value per focus→blur cycle. A TagInput creates N
 * discrete tokens during a single focus session. The semantics are different:
 * "Add tag 'urgent'" × 3 produces `['urgent', 'bug', 'frontend']`, not a
 * single string with newlines or commas. The generation layer needs to emit
 * separate `press('Enter')` steps per token, which TextEntry cannot model.
 *
 * ## Browser-context agnostic
 *
 * This definition makes no assumptions about which tab, window, or frame
 * it runs in. It processes ObservedEvents regardless of origin.
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  InteractionType,
  ObservedEvent,
} from '../shared/component-types';
import { bestName } from './patterns';

// ── Tag Container Detection ────────────────────────────────────────────

/**
 * CSS class patterns that indicate a tag/chip/token input container.
 * Covers major frameworks:
 *   - React-Select / react-tag-input: .tag-input, .multi-value
 *   - MUI: .MuiChip-root, .MuiAutocomplete-tag
 *   - AntDesign: .ant-select-selection-tag, .ant-tag
 *   - Angular Material: .mat-chip, .mdc-chip
 *   - Bootstrap: .badge, .chip
 *   - Generic: .tag, .token, .pill, .label-item
 */
const TAG_CONTAINER_RE =
  /(?:tag-input|tag_input|tag-container|chip-input|token-input|multi-value|multi-value-input|tags-input|chips-input|tag-list|chip-list|tag-field|label-input)/i;

/**
 * CSS class patterns that indicate an existing tag/chip element.
 * These are displayed tokens the user already created — NOT the input field.
 */
const TAG_CHIP_RE =
  /(?:tag-item|chip-item|token-item|multi-value-tag|multi-value-label|MuiChip|ant-tag|mat-chip|mdc-chip|badge-item|pill-item|label-tag)/i;

/**
 * Check if an input element is inside a tag-input container.
 * Uses ancestor classes to detect the container pattern.
 */
function isInsideTagContainer(event: ObservedEvent): boolean {
  const { ancestorClasses } = event.domContext;
  if (ancestorClasses && ancestorClasses.length > 0) {
    return ancestorClasses.some(c => TAG_CONTAINER_RE.test(c));
  }
  return false;
}

/**
 * Keys that create a token (in addition to Enter).
 */
const TOKEN_SEPARATOR_KEYS = new Set(['Enter', ',', 'Tab', 'Space']);

/**
 * Is this key event a token-creating keystroke?
 */
function isTokenSeparator(event: ObservedEvent): boolean {
  if (event.eventType !== 'keydown') return false;
  if (!event.key) return false;
  return TOKEN_SEPARATOR_KEYS.has(event.key);
}

/**
 * Check if the input is a text-type input (not checkbox, radio, etc.).
 */
function isTextInput(tag: string, inputType: string | null): boolean {
  if (tag !== 'INPUT') return tag === 'TEXTAREA' ? false : false;
  if (!inputType) return true; // default type is text
  return ['text', 'search', 'email', 'url'].includes(inputType);
}

// ── Tag SubAction Model ────────────────────────────────────────────────

interface TagSubAction {
  /** The tag value that was created. */
  value: string;
  /** How the token was created: 'enter', 'comma', 'blur', 'pending'. */
  separator: string;
  /** The event that created this token. */
  event: ObservedEvent;
}

// ── Definition ────────────────────────────────────────────────────────

export const tagInputDefinition: ComponentDefinition = {
  type: 'TagInput',
  priority: 45,
  triggerEventTypes: new Set<BrowserEventType>(['focus']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'focus') return null;

    const { tag, ariaRole } = event.target;
    const { inputType, isContentEditable } = event.domContext;

    // Must be a text-type input
    if (!isTextInput(tag, inputType) && !isContentEditable) return null;

    // Must be inside a tag-input container
    if (!isInsideTagContainer(event)) return null;

    // Skip if this looks like a combobox/autocomplete (Dropdown handles those)
    if (event.domContext.ariaHasPopup === 'listbox' ||
        event.domContext.ariaAutoComplete === 'list' ||
        event.domContext.ariaAutoComplete === 'both') {
      return null;
    }

    return { type: 'TagInput' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Same element events are in scope
    const sameElement =
      event.target.stableId === ctx.trigger.stableId
      || event.target.cssSelector === ctx.trigger.cssSelector;

    if (sameElement) return true;

    // Events on tag chip elements inside the same container are in scope
    // (e.g., clicking a chip to remove it)
    if (event.target.className && TAG_CHIP_RE.test(event.target.className)) {
      // Check same ancestor as the trigger
      const triggerAncestorKey = ctx.data.ancestorKey as string;
      if (triggerAncestorKey) {
        const eventAncestorKey = getAncestorKey(event);
        return eventAncestorKey === triggerAncestorKey;
      }
    }

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // Record ancestor key for grouping on first event
    if (!ctx.data.ancestorKey) {
      ctx.data.ancestorKey = getAncestorKey(event);
    }

    // Track accumulated text
    if (!ctx.data.pendingText) ctx.data.pendingText = '';
    if (!ctx.data.tags) ctx.data.tags = [];
    const tags = ctx.data.tags as TagSubAction[];

    // input event: accumulate text
    if (event.eventType === 'input' || event.eventType === 'change') {
      if (event.valueAfter != null) {
        ctx.data.pendingText = event.valueAfter;
        ctx.data.userTyped = true;
      }
      return null;
    }

    // keydown: check for token separators
    if (event.eventType === 'keydown') {
      if (isTokenSeparator(event)) {
        const pendingText = (ctx.data.pendingText as string) ?? '';
        if (pendingText.trim()) {
          tags.push({
            value: pendingText.trim(),
            separator: event.key === 'Enter' ? 'enter'
              : event.key === ',' ? 'comma'
              : event.key === 'Tab' ? 'tab'
              : 'space',
            event,
          });
          ctx.data.tags = tags;
          ctx.data.pendingText = ''; // clear for next token
        }
        return null; // stay active
      }
      return null;
    }

    // blur: complete, capturing any pending text as final tag
    if (event.eventType === 'blur') {
      const pendingText = (ctx.data.pendingText as string) ?? '';
      if (pendingText.trim()) {
        tags.push({
          value: pendingText.trim(),
          separator: 'blur',
          event,
        });
        ctx.data.tags = tags;
      }
      ctx.data.userTyped = (ctx.data.userTyped === true) || tags.length > 0;
      return { endState: 'completed' };
    }

    // Click on a chip: record removal
    if (event.eventType === 'click') {
      if (event.target.className && TAG_CHIP_RE.test(event.target.className)) {
        if (!ctx.data.removedTags) ctx.data.removedTags = [];
        const removed = ctx.data.removedTags as string[];
        const tagName = bestName(
          event.target.accessibleName,
          event.target.ariaLabel,
          null,
        );
        removed.push(tagName !== 'element' ? tagName : '');
      }
      return null;
    }

    return null;
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return false;
  },

  shouldCompleteOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Complete on focus elsewhere
    if (event.eventType === 'focus') {
      const sameElement =
        event.target.stableId === ctx.trigger.stableId ||
        event.target.cssSelector === ctx.trigger.cssSelector;
      return !sameElement;
    }
    // Complete on non-tag click
    if (event.eventType === 'click') {
      const isChip = event.target.className && TAG_CHIP_RE.test(event.target.className);
      if (!isChip) return true;
    }
    return false;
  },

  shouldCompleteOnFlush(_ctx: ComponentContext): boolean {
    return true;
  },

  downcast(ctx: ComponentContext, _completion: ComponentCompletion): InteractionType | null {
    // No tokens and no text typed → downcast to Click
    const tags = (ctx.data.tags as TagSubAction[]) ?? [];
    const userTyped = ctx.data.userTyped === true;
    if (tags.length === 0 && !userTyped) return 'Click';
    return null;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const tags = (ctx.data.tags as TagSubAction[]) ?? [];
    const removedTags = (ctx.data.removedTags as string[]) ?? [];
    const name = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    return {
      metadata: {
        targetName: name,
        tags: tags.map(t => t.value),
        tagSeparators: tags.map(t => t.separator),
        removedTags,
        tagCount: tags.length,
        subActions: tags.map(t => ({
          action: 'addTag',
          value: t.value,
          separator: t.separator,
        })),
      },
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Get the ancestor container identity for DOM-proximity grouping.
 * Reuses the same pattern as Stepper's getAncestorKey.
 */
function getAncestorKey(event: ObservedEvent): string {
  const ancestorClasses = event.domContext.ancestorClasses;
  if (ancestorClasses && ancestorClasses.length > 0) {
    return ancestorClasses.slice(0, 3).join('|');
  }
  const selector = event.target.cssSelector || '';
  const parentPath = selector.replace(/(^|>)[^>]+$/, '');
  return parentPath || selector;
}
