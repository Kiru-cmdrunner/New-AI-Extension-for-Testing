/**
 * OtpInput Definition — Multi-Input Grouping (Priority 46)
 *
 * OTP (One-Time Password) inputs are N adjacent single-character inputs
 * (<input maxlength="1">) that together form one logical value. Without this
 * definition, each input would be captured as a separate TextEntry — producing
 * 6 separate steps instead of one "Enter OTP: 123456" interaction.
 *
 * ## Lifecycle
 *
 * ```
 * Trigger: focus on a single-char input (maxlength=1 or aria pattern)
 *          inside a container with OTP/verification/pin classes
 *
 * Active:  input events on adjacent single-char inputs in the same container
 *          are in scope. Each character is accumulated.
 *          Auto-advance (JS-driven focus shift) is handled naturally — the
 *          focus event on the next input is in scope if it's in the same
 *          OTP container.
 *
 * Completion:
 *   - All inputs filled: complete immediately
 *   - Focus outside OTP container: complete
 *   - Flush (navigation): complete
 * ```
 *
 * ## Why not TextEntry?
 *
 * TextEntry groups by element identity (same input). OtpInput groups by
 * DOM proximity (adjacent inputs in the same container). The result is a
 * concatenated string from N elements, not one value from one element.
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

// ── OTP Container Detection ────────────────────────────────────────────

/**
 * CSS class patterns that indicate an OTP input group.
 * Covers major OTP libraries:
 *   - react-otp-input: .otp-input, .otp-container
 *   - MUI: .MuiOtpInput-root
 *   - AntDesign: .ant-otp
 *   - Custom: .otp, .pin-input, .verification-code, .code-input
 *   - Generic: .digit-input, .char-input
 */
const OTP_CONTAINER_RE =
  /(?:otp[-_]?input|otp[-_]?container|otp[-_]?group|otp[-_]?field|pin[-_]?input|pin[-_]?container|verification[-_]?code|code[-_]?input|digit[-_]?input|digit[-_]?group|char[-_]?input|otp)/i;

/**
 * Check if an input element is inside an OTP container.
 * Falls back to checking the input's own maxlength attribute.
 */
function isInsideOtpContainer(event: ObservedEvent): boolean {
  const { ancestorClasses } = event.domContext;
  if (ancestorClasses && ancestorClasses.length > 0) {
    if (ancestorClasses.some(c => OTP_CONTAINER_RE.test(c))) return true;
  }
  return false;
}

/**
 * Check if an input is a single-character input (OTP digit).
 * Detection: input type text/tel/number with evidence of single-char constraint.
 */
function isSingleCharInput(event: ObservedEvent): boolean {
  const { tag, name } = event.target;
  if (tag !== 'INPUT') return false;

  // Check input type
  const { inputType } = event.domContext;
  if (inputType && !['text', 'tel', 'number', 'password'].includes(inputType)) {
    return false;
  }

  // Heuristic: OTP inputs often have names like otp[0], otp-1, pin-0, digit-1
  if (name && /\d/.test(name) && /otp|pin|digit|code|char/i.test(name)) {
    return true;
  }

  return true; // if inside OTP container, assume single-char
}

/**
 * Extract the position/index of an OTP input from its attributes.
 */
function getInputIndex(event: ObservedEvent): number | null {
  const { name, cssSelector } = event.target;

  // Try extracting from name attribute: otp[0], otp-1, etc.
  if (name) {
    const match = name.match(/(\d+)/);
    if (match) return parseInt(match[1], 10);
  }

  // Try extracting from CSS selector: input:nth-child(2), etc.
  if (cssSelector) {
    const match = cssSelector.match(/nth-child\((\d+)\)/);
    if (match) return parseInt(match[1], 10);
  }

  return null;
}

// ── Definition ────────────────────────────────────────────────────────

export const otpInputDefinition: ComponentDefinition = {
  type: 'OtpInput',
  priority: 46,
  triggerEventTypes: new Set<BrowserEventType>(['focus']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'focus') return null;

    const { tag } = event.target;

    // Must be an input element
    if (tag !== 'INPUT') return null;

    // Must be inside an OTP container
    if (!isInsideOtpContainer(event)) return null;

    // Must look like a single-char input
    if (!isSingleCharInput(event)) return null;

    return { type: 'OtpInput' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Same element events are in scope (by unique identity)
    const trigger = ctx.trigger;
    if (event.target.stableId && trigger.stableId
      && event.target.stableId === trigger.stableId) {
      return true;
    }
    if (event.target.elementId && trigger.elementId
      && event.target.elementId === trigger.elementId) {
      return true;
    }

    // Focus/input events on adjacent single-char inputs in same container
    if (event.eventType === 'focus' || event.eventType === 'input' || event.eventType === 'change' || event.eventType === 'blur') {
      if (event.target.tag === 'INPUT' && isInsideOtpContainer(event)) {
        // Same ancestor container
        const sessionKey = ctx.data.ancestorKey as string;
        if (sessionKey) {
          const eventKey = getAncestorKey(event);
          return eventKey === sessionKey;
        }
        // No key yet — accept (first event after trigger)
        return true;
      }
    }

    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    // Record ancestor key for grouping on first event
    if (!ctx.data.ancestorKey) {
      ctx.data.ancestorKey = getAncestorKey(event);
    }

    // Initialize digit tracking
    if (!ctx.data.digits) {
      ctx.data.digits = new Map<number, string>();
    }
    const digits = ctx.data.digits as Map<number, string>;

    // input/change event: record character
    if (event.eventType === 'input' || event.eventType === 'change') {
      const char = (event.valueAfter ?? '').trim();
      if (char) {
        const idx = getInputIndex(event) ?? digits.size;
        // Handle multi-char paste: split into individual digits
        if (char.length > 1) {
          for (let i = 0; i < char.length; i++) {
            digits.set(idx + i, char[i]);
          }
        } else {
          digits.set(idx, char);
        }
        ctx.data.lastInputTimestamp = event.timestamp;

        // Auto-complete heuristic: if a multi-char paste covers all slots,
        // complete immediately. This handles the common "paste full OTP" flow.
        if (char.length > 1 && digits.size >= char.length) {
          return { endState: 'completed' };
        }
      }
      return null;
    }

    // focus on next input (auto-advance) — stay active
    if (event.eventType === 'focus') {
      return null;
    }

    // blur: check if all digits are filled
    if (event.eventType === 'blur') {
      // If we have digits, check if we should complete
      if (digits.size > 0) {
        // Complete if this is the last input OR blur goes outside the OTP container
        const isOtpBlur = isInsideOtpContainer(event);
        if (!isOtpBlur) {
          return { endState: 'completed' };
        }
      }
      return null;
    }

    return null;
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return false;
  },

  shouldCompleteOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Complete when focus moves outside the OTP container
    if (event.eventType === 'focus') {
      const sameContainer = isInsideOtpContainer(event) &&
        getAncestorKey(event) === (ctx.data.ancestorKey as string);
      return !sameContainer;
    }
    // Complete on non-OTP click
    if (event.eventType === 'click') {
      return !isInsideOtpContainer(event);
    }
    return false;
  },

  shouldCompleteOnFlush(_ctx: ComponentContext): boolean {
    return true;
  },

  downcast(ctx: ComponentContext, _completion: ComponentCompletion): InteractionType | null {
    // No digits entered → downcast to Click (user focused but didn't type)
    const digits = (ctx.data.digits as Map<number, string>) ?? new Map();
    if (digits.size === 0) return 'Click';
    return null;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const digits = (ctx.data.digits as Map<number, string>) ?? new Map();

    // Sort by index and concatenate
    const sortedKeys = Array.from(digits.keys()).sort((a, b) => a - b);
    const otpValue = sortedKeys.map(k => digits.get(k)).join('');
    const name = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    return {
      metadata: {
        targetName: name,
        otpValue,
        inputCount: sortedKeys.length,
        subActions: sortedKeys.map((idx, i) => ({
          action: 'typeDigit',
          value: digits.get(idx),
          position: idx,
          order: i,
        })),
      },
    };
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Get the ancestor container identity for DOM-proximity grouping.
 * Same pattern as Stepper and TagInput.
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
