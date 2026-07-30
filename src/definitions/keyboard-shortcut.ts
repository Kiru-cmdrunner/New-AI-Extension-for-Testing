/**
 * Keyboard Shortcut Definition (Priority 5)
 *
 * Captures keyboard shortcuts and special key presses that are NOT part of
 * normal text entry. Two capture paths:
 *
 * 1. Modifier+key combos: Ctrl+S, Cmd+K, Shift+Tab, Ctrl+Shift+P, Alt+F4
 *    - Triggered when keydown has at least one modifier (ctrl, meta, alt)
 *      OR shift combined with a special key.
 *
 * 2. Special keys (no modifier): Escape, Enter, Tab, F1-F12, Arrow keys,
 *    Backspace, Delete, Home, End, PageUp, PageDown, Space.
 *    - Triggered when keydown produces a key in the SPECIAL_KEYS set.
 *
 * ## Text Input Exclusion
 *
 * Regular typing in text inputs, textareas, and contenteditable elements
 * is handled by TextEntry — NOT by this definition. However, modifier+key
 * combos ARE captured even in text fields (e.g., Ctrl+B in an editor).
 *
 * Architecture: `.drytis/specs/p0-4-keyboard-shortcuts.md`
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';

// ── Special Keys (captured without modifiers) ────────────────────────

/**
 * Non-printable keys that are meaningful on their own (no modifier required).
 * Single-character keys (a-z, 0-9, symbols) are NOT here — those are typing,
 * handled by TextEntry.
 */
const SPECIAL_KEYS = new Set([
  // Navigation
  'Tab', 'Escape', 'Enter',
  // Arrows
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  // Editing
  'Backspace', 'Delete', 'Insert',
  // Navigation keys
  'Home', 'End', 'PageUp', 'PageDown',
  // Function keys
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  // Space (often used for button activation, scrolling, media controls)
  ' ',
]);

/**
 * Modifier key NAMES (these are never captured as shortcuts on their own).
 */
const MODIFIER_KEY_NAMES = new Set([
  'Control', 'Shift', 'Alt', 'Meta',
  'ControlLeft', 'ControlRight',
  'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight',
]);

// ── Text Input Detection ─────────────────────────────────────────────

/**
 * Tags where typing occurs — KeyboardShortcut should not fire for single
 * keys on these elements (TextEntry handles that), unless a modifier is held.
 */
const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA']);

/**
 * Check if the event target is a text input field.
 */
function isTextInputTarget(
  tag: string,
  ariaRole: string | null,
  isContentEditable: boolean,
  inputType: string | null,
): boolean {
  if (isContentEditable) return true;
  if (TEXT_INPUT_TAGS.has(tag)) {
    // Range, checkbox, radio, file, button, submit, etc. are NOT text inputs
    if (inputType && !['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(inputType)) {
      return false;
    }
    return true;
  }
  if (ariaRole === 'textbox') return true;
  return false;
}

// ── Shortcut Formatting ──────────────────────────────────────────────

/**
 * Build a human-readable shortcut string from modifier flags + key.
 *
 * Examples:
 *   ctrlKey=true, key='s' → "Ctrl+S"
 *   metaKey=true, key='k' → "Cmd+K"
 *   shiftKey=true, ctrlKey=true, key='P' → "Ctrl+Shift+P"
 *   key='Escape' → "Escape"
 */
export function formatShortcut(
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
  altKey: boolean,
  shiftKey: boolean,
): string {
  const parts: string[] = [];

  if (ctrlKey) parts.push('Ctrl');
  if (metaKey) parts.push('Cmd');
  if (altKey) parts.push('Alt');

  // Show Shift only if it's part of a combo (e.g., Ctrl+Shift+P).
  // Don't show Shift for plain Shift+letter (that's just uppercase typing).
  const hasOtherModifier = ctrlKey || metaKey || altKey;
  if (shiftKey && hasOtherModifier) {
    parts.push('Shift');
  }

  // Normalize the key
  let displayKey = key;

  // Space → "Space" (check before single-char branch, since ' '.length === 1)
  if (key === ' ') {
    displayKey = 'Space';
  } else if (key.length === 1) {
    // Single characters: uppercase for display
    displayKey = key.toUpperCase();
  }

  parts.push(displayKey);

  return parts.join('+');
}

/**
 * Normalize a key for the IR / Playwright layer.
 * Playwright uses specific key names: "Control+s", "Meta+k", "Escape", etc.
 */
export function normalizeKeyForPlaywright(
  key: string,
  ctrlKey: boolean,
  metaKey: boolean,
  altKey: boolean,
  shiftKey: boolean,
): string {
  const parts: string[] = [];

  if (ctrlKey) parts.push('Control');
  if (metaKey) parts.push('Meta');
  if (altKey) parts.push('Alt');
  if (shiftKey) parts.push('Shift');

  // Playwright key names
  let playKey = key;
  if (key === ' ') playKey = 'Space';
  if (key.length === 1) playKey = key.toLowerCase();

  parts.push(playKey);

  return parts.join('+');
}

// ── Definition ────────────────────────────────────────────────────────

export const keyboardShortcutDefinition: ComponentDefinition = {
  type: 'KeyboardShortcut',
  priority: 5,
  triggerEventTypes: new Set<BrowserEventType>(['keydown']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'keydown') return null;

    const key = event.key;
    if (!key) return null;

    // Ignore bare modifier key presses (Ctrl, Shift, Alt, Meta alone)
    if (MODIFIER_KEY_NAMES.has(key)) return null;

    const { ctrlKey, metaKey, altKey, shiftKey } = event;
    const { tag, ariaRole } = event.target;
    const { isContentEditable, inputType } = event.domContext;

    const hasModifier = ctrlKey || metaKey || altKey;
    const isSpecial = SPECIAL_KEYS.has(key);
    const isShiftCombo = shiftKey && SPECIAL_KEYS.has(key);

    // Path 1: Modifier+key shortcut
    if (hasModifier) {
      return { type: 'KeyboardShortcut' };
    }

    // Path 2: Shift + special key (e.g., Shift+Tab, Shift+ArrowUp)
    if (isShiftCombo) {
      return { type: 'KeyboardShortcut' };
    }

    // Path 3: Special key without modifier
    if (isSpecial) {
      // Don't capture special keys (Enter, Tab) inside text inputs —
      // TextEntry handles form submission and tab navigation.
      // Exception: Escape is always captured (user dismissing something).
      if (key === 'Escape') {
        return { type: 'KeyboardShortcut' };
      }
      if (isTextInputTarget(tag, ariaRole, isContentEditable, inputType)) {
        return null; // let TextEntry handle it
      }
      return { type: 'KeyboardShortcut' };
    }

    // Regular character key without modifiers = typing → not a shortcut
    return null;
  },

  isInScope(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Immediate completion — no lifecycle
    return false;
  },

  handleEvent(_event: ObservedEvent, _ctx: ComponentContext): ComponentCompletion | null {
    return { endState: 'completed' };
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const event = ctx.triggerEvent;
    const key = event.key ?? '';
    const code = event.code ?? '';
    const { ctrlKey, metaKey, altKey, shiftKey } = event;

    const shortcutDisplay = formatShortcut(key, ctrlKey, metaKey, altKey, shiftKey);
    const playKey = normalizeKeyForPlaywright(key, ctrlKey, metaKey, altKey, shiftKey);

    // Set subtype
    const hasModifier = ctrlKey || metaKey || altKey;
    ctx.data.interactionSubtype = hasModifier ? 'ModifierShortcut' : 'SpecialKey';

    return {
      metadata: {
        shortcutKey: shortcutDisplay,
        keyValue: key,
        keyCode: code,
        playwrightKey: playKey,
        hasCtrl: ctrlKey,
        hasShift: shiftKey,
        hasAlt: altKey,
        hasCmd: metaKey,
        targetName: shortcutDisplay,
        targetTag: ctx.trigger.tag,
        targetRole: ctx.trigger.ariaRole,
      },
    };
  },
};
