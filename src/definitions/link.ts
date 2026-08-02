/**
 * Link Definition — Link Click (Priority 70)
 *
 * Triggers on click of an <a> tag or role=link element.
 * Completes immediately. Links are navigation triggers.
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
import { isLink, bestName } from './patterns';

/**
 * Determine whether an `<a>` tag's href indicates an action anchor (SPA
 * toggle/button) rather than genuine navigation.
 *
 * Action anchors: href="#", href="", no href attribute, javascript: URLs.
 * These return to the Click fallback so R3 behavioral evidence can classify
 * the actual intent (toggle, trigger, navigate).
 *
 * Genuine navigation: any real URL path that differs from the bare current
 * page URL. E.g. "/home", "/products?category=electronics".
 *
 * @param openedUrl - The absolute href from domContext.openedUrl (may be null)
 * @param pageUrl   - The page URL where the event occurred
 */
function isActionAnchor(openedUrl: string | null, pageUrl: string): boolean {
  if (openedUrl === null) return true; // no href attribute

  // javascript: protocol — SPA action anchor
  if (openedUrl.toLowerCase().startsWith('javascript:')) return true;

  // Bare fragment: href="#" resolves to <pageUrl>#
  if (openedUrl.endsWith('#')) return true;

  // Same as current page URL (href="" or href with same path and no fragment)
  // This catches href="" which resolves to the page URL itself.
  if (openedUrl === pageUrl) return true;

  return false;
}

export const linkDefinition: ComponentDefinition = {
  type: 'Link',
  priority: 70,
  triggerEventTypes: new Set<BrowserEventType>(['click']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    const { tag, ariaRole } = event.target;
    if (!isLink(tag, ariaRole)) return null;

    // Action-anchor disambiguation: an `<a>` with href="#", href="",
    // javascript:, or no href at all is a common SPA button/toggle idiom.
    // These should NOT be classified as navigation links — they fall through
    // to the Click definition so R3 behavioral evidence can determine intent.
    const openedUrl = event.domContext.openedUrl ?? null;
    const pageUrl = event.pageUrl;
    if (isActionAnchor(openedUrl, pageUrl)) return null;

    return { type: 'Link' };
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
        href: null, // href not available in ElementIdentity; could be added
      },
    };
  },
};
