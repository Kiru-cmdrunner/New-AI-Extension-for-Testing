/**
 * FileUpload Definition — File Input (Priority 35)
 *
 * Triggers on click of an <input type="file"> element.
 * Completes immediately — the file picker dialog is a separate context.
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
import { isFileInput, bestName } from './patterns';

export const fileUploadDefinition: ComponentDefinition = {
  type: 'FileUpload',
  priority: 35,
  triggerEventTypes: new Set<BrowserEventType>(['click', 'change']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag } = event.target;
    const { inputType } = event.domContext;

    if (isFileInput(tag, inputType)) {
      return { type: 'FileUpload' };
    }

    return null;
  },

  isInScope(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return false; // immediate completion
  },

  handleEvent(_event: ObservedEvent, _ctx: ComponentContext): ComponentCompletion | null {
    return { endState: 'completed' };
  },

  shouldCancelOnOutside(_event: ObservedEvent, _ctx: ComponentContext): boolean {
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    return {
      metadata: {
        targetName: bestName(
          ctx.trigger.accessibleName,
          ctx.trigger.ariaLabel,
          ctx.trigger.placeholder,
        ),
        fileName: ctx.triggerEvent.valueAfter ?? null,
      },
    };
  },
};
