/**
 * TextEntry Definition — Text Input Lifecycle (Priority 50)
 *
 * Triggers on focus of a text input/textarea/contentEditable.
 * Also triggers on input events as a fallback when no focus event was
 * captured (programmatic value changes, autofill, incomplete event streams).
 * Completes on blur IF the user actually typed (userTyped=true) AND
 * the value is non-empty. Otherwise, no-op (filtered by presentation).
 *
 * Bug 4 fix: userTyped flag prevents capturing focus+blur on pre-filled
 * fields without any actual typing.
 *
 * Input-only fallback (GROUP-D fix): if input events arrive without a
 * preceding focus, TextEntry starts on the first input event and completes
 * on flush or blur.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3
 */

import type {
  BrowserEventType,
  ComponentDefinition,
  ComponentTrigger,
  ComponentContext,
  ComponentCompletion,
  ObservedEvent,
} from '../shared/component-types';
import { isTextEntry, bestName } from './patterns';
import { detectEditor } from './editor-adapters';

export const textEntryDefinition: ComponentDefinition = {
  type: 'TextEntry',
  priority: 50,
  triggerEventTypes: new Set<BrowserEventType>(['focus', 'input']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // Primary path: focus triggers TextEntry
    if (event.eventType === 'focus') {
      const { tag, ariaRole } = event.target;
      const { inputType, isContentEditable } = event.domContext;

      if (!isTextEntry(tag, inputType, ariaRole, isContentEditable)) {
        return null;
      }

      return { type: 'TextEntry' };
    }

    // Fallback path: input events without a preceding focus.
    // This captures programmatic value changes, autofill, and incomplete
    // event streams where focus was missed. The runtime only calls
    // detectTrigger when no active component claimed the event (step 4),
    // so this won't fire if a focus-triggered TextEntry session is already
    // active for this element.
    // (Expanded validation finding GROUP-D, CI-04.)
    if (event.eventType === 'input') {
      const { tag, ariaRole } = event.target;
      const { inputType, isContentEditable } = event.domContext;

      if (!isTextEntry(tag, inputType, ariaRole, isContentEditable)) {
        return null;
      }

      // Only trigger if there's actual value being entered
      if (event.valueAfter == null || event.valueAfter === '') {
        return null;
      }

      return { type: 'TextEntry' };
    }

    return null;
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Events on the same element are in scope
    return event.target.stableId === ctx.trigger.stableId
      || event.target.cssSelector === ctx.trigger.cssSelector;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    if (event.eventType === 'input' || event.eventType === 'change') {
      // User typed something
      ctx.data.userTyped = true;
      ctx.data.textValue = event.valueAfter ?? '';
      return null; // still active, wait for blur
    }

    if (event.eventType === 'blur') {
      // Complete on blur — the presentation layer will filter if userTyped=false.
      // Also capture the value from the blur event as a fallback in case input
      // events were missed (autofill, paste, React controlled inputs).
      if (event.valueAfter != null && event.valueAfter !== '') {
        ctx.data.textValue = event.valueAfter;
        if (ctx.data.userTyped !== true) {
          ctx.data.userTyped = true;
        }
      }
      return { endState: 'completed' };
    }

    return null;
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    // TextEntry should NEVER be cancelled by outside events. The blur event
    // (which may be deferred in SPA frameworks) is the authoritative completion
    // signal. If we cancel on click, we lose the deferred blur's value update.
    //
    // Previous behavior: cancelled on outside click. This caused a race condition
    // in autocomplete flows where click fires BEFORE deferred blur:
    //   mousedown → click → [deferred] blur
    // The click would abandon the TextEntry before blur could update the value.
    return false;
  },

  /**
   * Auto-complete TextEntry when the user focuses a different element.
   * This ensures the value is captured before the deferred blur arrives.
   * Navigation still flushes as 'interrupted' via the runtime's flush() method.
   */
  shouldCompleteOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Complete on focus elsewhere — the user moved to a new field.
    // This captures the value before the deferred blur arrives.
    if (event.eventType === 'focus') {
      const sameElement =
        event.target.stableId === ctx.trigger.stableId ||
        event.target.cssSelector === ctx.trigger.cssSelector;
      return !sameElement;
    }
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const userTyped = ctx.data.userTyped === true;
    const textValue = (ctx.data.textValue as string) ?? '';
    const name = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    // ── Rich Text Editor Detection ──
    // When the trigger element is contentEditable, run the editor adapter
    // chain to identify the specific editor framework (Quill, CKEditor, etc.).
    // This sets interactionSubtype and editorType metadata for downstream layers.
    const isContentEditable = ctx.triggerEvent.domContext.isContentEditable;
    if (isContentEditable) {
      const editorType = detectEditor(ctx.trigger, ctx.triggerEvent.domContext);
      ctx.data.interactionSubtype = 'RichTextEditor';
      return {
        metadata: {
          targetName: name,
          textValue,
          userTyped,
          editorType: editorType ?? 'ContentEditable',
          isRichTextEditor: true,
        },
      };
    }

    return {
      metadata: {
        targetName: name,
        textValue,
        userTyped,
      },
    };
  },
};
