/**
 * KeyboardShortcut Definition — Modifier+Key Actions (Priority 8)
 *
 * Triggers on `keydown` events that have at least one modifier key
 * (Ctrl, Meta, Alt, or Shift+non-character key). Completes immediately.
 *
 * Does NOT capture ordinary typing (TextEntry handles those keydowns
 * as part of the text entry lifecycle).
 *
 * M9.10
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';

/**
 * Keys that, when combined with Shift, constitute a shortcut (not typing).
 * Shift + letter = uppercase character (typing), so Shift alone is not enough.
 * But Shift + F1-F12, arrows, Escape, etc. = shortcut.
 */
const SHIFT_SHORTCUT_KEYS = new Set([
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
  'Escape','Tab','Enter','Delete','Insert','Home','End','PageUp','PageDown',
  'Backspace',
]);

/**
 * Format a keyboard shortcut into a display string.
 */
export function formatShortcut(event: ObservedEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.metaKey) parts.push('Cmd');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  // Map common keys to readable names
  const keyMap: Record<string, string> = {
    ' ': 'Space',
    'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
    'Escape': 'Esc', 'Backspace': 'Backspace', 'Delete': 'Del',
    'Enter': 'Enter', 'Tab': 'Tab',
  };
  const keyLabel = keyMap[event.key ?? ''] ?? event.key ?? '';
  if (keyLabel) parts.push(keyLabel);
  return parts.join('+');
}

export const keyboardShortcutDefinition: ComponentDefinition = {
  type: 'KeyboardShortcut',
  priority: 8,
  triggerEventTypes: new Set<BrowserEventType>(['keydown']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'keydown') return null;
    if (event.key === null) return null;

    // Must have at least one modifier (Ctrl, Meta, Alt)
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return { type: 'KeyboardShortcut' };
    }

    // Shift + non-character key (arrows, function keys, etc.)
    if (event.shiftKey && SHIFT_SHORTCUT_KEYS.has(event.key)) {
      return { type: 'KeyboardShortcut' };
    }

    // Function keys alone (F1-F12) are shortcuts even without modifiers
    if (/^F\d{1,2}$/.test(event.key)) {
      return { type: 'KeyboardShortcut' };
    }

    return null;
  },

  isInScope(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // Immediate completion — no lifecycle
    return false;
  },

  handleEvent(
    _event: ObservedEvent,
    _ctx: ComponentContext,
  ): ComponentCompletion | null {
    return { endState: 'completed' };
  },

  shouldCancelOnOutside(
    _event: ObservedEvent,
    _ctx: ComponentContext,
  ): boolean {
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const shortcut = formatShortcut(ctx.triggerEvent);

    return {
      metadata: {
        shortcut,
        key: ctx.triggerEvent.key,
        code: ctx.triggerEvent.code,
        ctrlKey: ctx.triggerEvent.ctrlKey,
        metaKey: ctx.triggerEvent.metaKey,
        altKey: ctx.triggerEvent.altKey,
        shiftKey: ctx.triggerEvent.shiftKey,
        targetName: ctx.trigger.accessibleName ?? ctx.trigger.ariaLabel ?? ctx.trigger.tag,
      },
    };
  },
};
