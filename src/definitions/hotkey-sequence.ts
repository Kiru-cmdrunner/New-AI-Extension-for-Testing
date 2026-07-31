/**
 * HotkeySequence Definition — Two-Key Sequence Lifecycle (Priority 6)
 *
 * Some applications use two-key sequences as shortcuts (Gmail: "g then i" for
 * inbox, VS Code: "g then g" for go-to-line). The first keypress enters a
 * "listening" state with a short timeout (~700ms). If a second key arrives
 * within the window, the sequence completes. If the timeout fires, the first
 * key is emitted as a standalone KeyboardShortcut.
 *
 * ## Lifecycle
 *
 * ```
 * Trigger: keydown on a letter key (a-z) with NO modifiers, NOT inside a
 *          text input. Triggered AFTER KeyboardShortcut (priority 5) has
 *          declined to claim it (plain letter keys are not KeyboardShortcuts).
 *
 * Active:  listening for second key (~700ms timeout)
 *
 * Completion:
 *   - Second keydown within timeout: complete as sequence
 *   - Timeout: downcast to KeyboardShortcut with the single key
 *   - Flush (navigation): downcast to KeyboardShortcut
 * ```
 *
 * ## Why a new definition?
 *
 * KeyboardShortcut completes immediately on trigger — it has no "wait for
 * second key" state. The timeout-based ambiguity (is this a sequence prefix
 * or a standalone key?) requires a lifecycle with downcast.
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

// ── Constants ─────────────────────────────────────────────────────────

/**
 * Maximum time between first and second key (milliseconds).
 * Gmail uses ~750ms; we use 700ms to be slightly stricter.
 */
const SEQUENCE_TIMEOUT_MS = 700;

/**
 * Modifier key names — their presence means KeyboardShortcut handles it.
 */
const MODIFIER_KEY_NAMES = new Set([
  'Control', 'Shift', 'Alt', 'Meta',
  'ControlLeft', 'ControlRight',
  'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight',
]);

/**
 * Tags where typing occurs — HotkeySequence should NOT fire inside text inputs.
 */
const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA']);

function isTextInputTarget(
  tag: string,
  ariaRole: string | null,
  isContentEditable: boolean,
  inputType: string | null,
): boolean {
  if (isContentEditable) return true;
  if (TEXT_INPUT_TAGS.has(tag)) {
    if (inputType && !['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(inputType)) {
      return false;
    }
    return true;
  }
  if (ariaRole === 'textbox') return true;
  return false;
}

/**
 * Keys that are already captured by KeyboardShortcut as special keys.
 * These should NOT trigger HotkeySequence.
 */
const SPECIAL_KEYS = new Set([
  'Tab', 'Escape', 'Enter',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Backspace', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  ' ',
]);

// ── Definition ────────────────────────────────────────────────────────

export const hotkeySequenceDefinition: ComponentDefinition = {
  type: 'HotkeySequence',
  priority: 6,
  triggerEventTypes: new Set<BrowserEventType>(['keydown']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'keydown') return null;

    const key = event.key;
    if (!key) return null;

    // Must be a plain single-character key (a-z, 0-9)
    if (key.length !== 1) return null;

    // No modifiers — KeyboardShortcut handles modifier combos
    const { ctrlKey, metaKey, altKey, shiftKey } = event;
    if (ctrlKey || metaKey || altKey) return null;
    if (shiftKey) return null; // shift+letter = uppercase typing

    // Ignore bare modifier keys
    if (MODIFIER_KEY_NAMES.has(key)) return null;

    // Ignore special keys
    if (SPECIAL_KEYS.has(key)) return null;

    // Don't trigger inside text inputs — those are typing
    const { tag, ariaRole } = event.target;
    const { isContentEditable, inputType } = event.domContext;
    if (isTextInputTarget(tag, ariaRole, isContentEditable, inputType)) {
      return null;
    }

    // This is a candidate for a two-key sequence
    return { type: 'HotkeySequence' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Only keydown events are relevant for the second key
    if (event.eventType !== 'keydown') return false;

    const firstKeyTime = (ctx.data.firstKeyTime as number) ?? 0;
    if (!firstKeyTime) return false;

    // Must be within the timeout window
    if (event.timestamp - firstKeyTime > SEQUENCE_TIMEOUT_MS) return false;

    // Modifier keys on second press are NOT a sequence — let KeyboardShortcut handle
    if (event.ctrlKey || event.metaKey || event.altKey) return false;

    // Any non-modifier key is a valid second key
    if (MODIFIER_KEY_NAMES.has(event.key ?? '')) return false;

    return true;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // First call: this IS the trigger event (the first key).
    // Record it and stay active, waiting for the second key.
    if (!ctx.data.firstKey) {
      ctx.data.firstKey = event.key;
      ctx.data.firstKeyCode = event.code;
      ctx.data.firstKeyEvent = event;
      ctx.data.firstKeyTime = event.timestamp;
      return null; // stay active — wait for second key
    }

    // Second key — complete the sequence
    ctx.data.secondKey = event.key;
    ctx.data.secondKeyCode = event.code;
    ctx.data.secondKeyEvent = event;
    return { endState: 'completed' };
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return false;
  },

  shouldCompleteOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Complete (with downcast to KeyboardShortcut) when:
    // 1. A different event arrives after the timeout window
    // 2. Any non-keydown event arrives
    const firstKeyTime = (ctx.data.firstKeyTime as number) ?? 0;
    if (!firstKeyTime) return false;

    // After timeout window — complete and downcast
    if (event.timestamp - firstKeyTime > SEQUENCE_TIMEOUT_MS) {
      return true;
    }

    // Any event that's not the second key completing the sequence
    // (clicks, mouse events, etc. — the user moved on)
    if (event.eventType !== 'keydown') {
      return true;
    }

    return false;
  },

  shouldCompleteOnFlush(_ctx: ComponentContext): boolean {
    // On navigation flush, complete (will downcast to KeyboardShortcut
    // since no second key was received)
    return true;
  },

  downcast(ctx: ComponentContext, _completion: ComponentCompletion): InteractionType | null {
    // If only one key was captured (timeout or flush), downcast to KeyboardShortcut
    if (!ctx.data.secondKey) {
      ctx.data.downcastedToShortcut = true;
      return 'KeyboardShortcut';
    }
    return null;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const firstKey = (ctx.data.firstKey as string) ?? '';
    const firstKeyCode = (ctx.data.firstKeyCode as string) ?? '';
    const secondKey = (ctx.data.secondKey as string) ?? '';
    const secondKeyCode = (ctx.data.secondKeyCode as string) ?? '';

    if (secondKey) {
      // Complete sequence
      const sequenceDisplay = `${firstKey.toUpperCase()} then ${secondKey.toUpperCase()}`;
      ctx.data.interactionSubtype = 'TwoKeySequence';
      return {
        metadata: {
          sequenceKeys: [firstKey, secondKey],
          sequenceDisplay,
          firstKey,
          firstKeyCode,
          secondKey,
          secondKeyCode,
          playwrightSequence: `${firstKey.toLowerCase()}+${secondKey.toLowerCase()}`,
          targetName: sequenceDisplay,
        },
      };
    }

    // Downcasted — this buildResult is called as KeyboardShortcut
    // (The runtime will use KeyboardShortcut's buildResult for downcast.)
    // But in case this is called directly, return minimal data.
    return {
      metadata: {
        firstKey,
        firstKeyCode,
        targetName: firstKey.toUpperCase(),
      },
    };
  },
};
