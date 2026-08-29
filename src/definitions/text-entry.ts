/**
 * TextEntry Definition — Text Input Lifecycle (Priority 50)
 *
 * Triggers on focus of a text input/textarea/contentEditable.
 * Completes on blur IF the user actually typed (userTyped=true) AND
 * the value is non-empty. Otherwise, no-op (filtered by presentation).
 *
 * Bug 4 fix: userTyped flag prevents capturing focus+blur on pre-filled
 * fields without any actual typing.
 *
 * 7.4-B6: Enter-Submit commit. Completes on the trusted native `submit`
 * DOM event of the form that owns the input — the application's own
 * commitment signal. Doctrine: Enter keydown alone is a CAUSE, never a
 * completion trigger (the user directive: completion must be grounded in
 * actual application behavior, not "user pressed Enter"). Implicit
 * submission (Enter → synthetic submit-button click → native submit) and
 * mouse submission (click submit control → native submit) both land on
 * the same commit proof. The same-form submit-control click is exempted
 * from shouldCancelOnOutside because it is the commit cause, not an
 * outside interaction.
 *
 * Spec: .drytis/specs/phase-7-4-b6-enter-submit-commit.md
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
  ElementIdentity,
} from '../shared/component-types';
import { isTextEntry, bestName, elementKey, formJoinKey } from './patterns';

/**
 * 7.4-B6: this lifecycle's owner-form join key, derived from the immutable
 * trigger event (pure recorded data — never a live DOM query, never a
 * ctx.data cache that nothing populates at trigger time).
 */
function ownerFormOf(ctx: ComponentContext): string | null {
  // triggerEvent.domContext is guaranteed on live-captured events; tests and
  // restored snapshots may construct minimal contexts — null (honest no-join)
  // rather than a crash.
  return formJoinKey(ctx.trigger, ctx.triggerEvent?.domContext);
}

/**
 * 7.4-B6.1 §4.1: canonical terminal-Enter derivation — pure recorded data,
 * the SAME derivation at the nav-flush seam (live ctx) and at STOP
 * (memberEvents of an emitted interaction). "Terminal" = the last member
 * event ON THE TRIGGER ELEMENT is an Enter keydown; any later
 * trigger-element member event (input, blur, another keydown) breaks P4.
 * Returns the Enter member event, or null.
 */
export function terminalEnterMemberOf(
  events: ObservedEvent[],
  trigger: ElementIdentity,
): ObservedEvent | null {
  const key = elementKey(trigger);
  let terminal: ObservedEvent | null = null;
  for (const e of events) {
    if (elementKey(e.target) !== key) continue; // foreign-element member events don't break P4
    if (terminal) {
      // P4 exemption: the browser's own `change` fired implicitly by the
      // Enter (implicit control commit — Chrome fires change on Enter even
      // with no <form>; verified real-Chrome E2E: change lands between the
      // Enter keydown and the effect). It carries the SAME committed value,
      // never new typing (typing always produces keydown+input first), so
      // it cannot break terminality. keydown/input after Enter still break.
      if (e.eventType === 'change') continue;
      return null; // P4: something happened on the field AFTER the Enter
    }
    if (e.eventType === 'keydown' && e.key === 'Enter') terminal = e;
  }
  return terminal;
}

export const textEntryDefinition: ComponentDefinition = {
  type: 'TextEntry',
  priority: 50,
  triggerEventTypes: new Set<BrowserEventType>(['focus']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    if (event.eventType !== 'focus') return null;

    const { tag, ariaRole } = event.target;
    const { inputType, isContentEditable } = event.domContext;

    if (!isTextEntry(tag, inputType, ariaRole, isContentEditable)) {
      return null;
    }

    return { type: 'TextEntry' };
  },

  isInScope(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Use elementKey() to avoid null === null false positives when both
    // elements lack ID attributes.
    if (elementKey(event.target) === elementKey(ctx.trigger)) return true;
    // 7.4-B6: the native `submit` DOM event targets the owner <form> (not
    // the input). It is in scope ONLY when the form join proves ownership —
    // same form as the trigger input, both sides non-null (legacy events
    // with no form data never match; no-form inputs keep blur-only
    // completion, byte-for-byte).
    if (event.eventType === 'submit') {
      const ownerForm = formJoinKey(event.target, event.domContext);
      return ownerForm != null && ownerForm === ownerFormOf(ctx);
    }
    return false;
  },

  handleEvent(event: ObservedEvent, ctx: ComponentContext): ComponentCompletion | null {
    if (event.eventType === 'input' || event.eventType === 'change') {
      // User typed something
      ctx.data.userTyped = true;
      ctx.data.textValue = event.valueAfter ?? '';
      // 6C dual-sample contract (spec §3): typedValue = user INTENT, sampled
      // on every input/change, NEVER overwritten by the committed blur value.
      // textValue keeps its committed semantics (blur-wins) so all existing
      // consumers are unchanged; IR fill reads typedValue ?? textValue.
      ctx.data.typedValue = event.valueAfter ?? '';
      return null; // still active, wait for blur or the B6 submit commit
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
        // Autofill/paste-without-input: no input/change ever fired, so no
        // typed intent existed to preserve — backfill typed := committed so
        // consumers reading typedValue ?? textValue behave exactly as before
        // (typedValue ??= blurValueAfter).
        if (ctx.data.typedValue == null) {
          ctx.data.typedValue = event.valueAfter;
        }
      }
      return { endState: 'completed' };
    }

    // 7.4-B6: submit-commit completion. The trusted native `submit` DOM
    // event on the form that OWNS this input is the application's own
    // commitment proof — the platform fired validation and the submission
    // is initiated. The Enter keydown (or the submit-control click) is
    // causally UPSTREAM; this is the downstream behavior we ground in.
    //
    // isInScope already proved the owner-form join; handleEvent guards it
    // again defensively (same-form, both non-null) so the completion can
    // never fire on a foreign form.
    if (event.eventType === 'submit') {
      const ownerForm = formJoinKey(event.target, event.domContext);
      const myForm = ownerFormOf(ctx);
      if (ownerForm != null && myForm != null && ownerForm === myForm) {
        // Display-grade honesty flag: Enter keydown on the trigger element
        // as the last keydown before the commit (recorded in ctx.data as
        // member keydowns arrive). Never used for classification or
        // generation — metadata only.
        if (ctx.data.lastKeyDownWasEnterOnTrigger === true) {
          ctx.data.enterCause = true;
        }
        ctx.data.commitSignal = 'submit';
        ctx.data.committedValue =
          (ctx.data.typedValue as string | undefined) ?? (ctx.data.textValue as string | undefined) ?? '';
        return { endState: 'completed' };
      }
      return null; // a different form's submit — not ours
    }

    // 7.4-B6.1: record the terminal Enter's exact eventId — the join key for
    // tier C network correlation at STOP. Pure fact recording, no semantics.
    if (event.eventType === 'keydown') {
      ctx.data.lastKeyDownWasEnterOnTrigger =
        event.key === 'Enter' && elementKey(event.target) === elementKey(ctx.trigger);
      if (ctx.data.lastKeyDownWasEnterOnTrigger === true) {
        ctx.data.enterEventId = event.eventId;
      }
    }

    return null;
  },

  /**
   * 7.4-B6.1 tier N: navigation-commit hook. A live form-less TextEntry
   * whose typing episode ended with a terminal Enter completes AT the
   * moment a same-document navigation arrives — the route change IS the
   * application's commitment proof (spec §4.2). The Enter keydown is the
   * CAUSE (P3/P4); the navigation event is the EFFECT. Grounded entirely
   * in recorded data; no wall-clock.
   */
  shouldCompleteOnNavigation(event: ObservedEvent, ctx: ComponentContext): boolean {
    // P5: same-document SPA navigation only — the four EventTap navTypes.
    // Full-page pull-navs (webNavigation.onCommitted, nav-{ts} eventIds)
    // carry NO navType and a fresh pageId: different document, different
    // ordering space — that family is tier C's territory at STOP.
    if (event.eventType !== 'navigation') return false;
    const navType = (event.navType ?? null) as string | null;
    if (
      navType !== 'pushState' &&
      navType !== 'replaceState' &&
      navType !== 'popstate' &&
      navType !== 'hashchange'
    ) {
      return false;
    }
    // P1: form-less only — inputs with an owner form belong to B6.
    if (ownerFormOf(ctx) != null) return false;
    // P2/P3/P4 via the canonical derivation over member events.
    const enter = terminalEnterMemberOf(ctx.memberEvents, ctx.trigger);
    if (!enter) return false;
    if (ctx.data.userTyped !== true) return false;
    const typed = ctx.data.typedValue ?? ctx.data.textValue;
    if (typeof typed !== 'string' || typed === '') return false;

    // Commit metadata is written to ctx.data HERE (buildResult reads it at
    // completeComponent time — the established B6 pattern).
    ctx.data.commitSignal = 'navigation';
    ctx.data.committedValue = (ctx.data.typedValue as string | undefined)
      ?? (ctx.data.textValue as string | undefined) ?? '';
    ctx.data.enterCause = true; // P3 guarantees the terminal member event is the Enter
    ctx.data.enterEventId = enter.eventId;
    ctx.data.navType = navType;
    // B7-P2 §5.2.6 (B-7): the commit-marker position for the generalized
    // nav-election ranking (component-runtime reads committedAt when
    // commitSignal is set; the legacy Enter-derivation stays as fallback).
    ctx.data.committedAt = enter.captureSeq || enter.timestamp;
    return true;
  },

  shouldCancelOnOutside(event: ObservedEvent, ctx: ComponentContext): boolean {
    // Only cancel on 'click' (fires AFTER blur, so the TextEntry completes
    // naturally). Never cancel on 'mousedown' — it fires BEFORE blur in the
    // browser event order (mousedown → blur → click), which would abandon
    // the TextEntry before it can complete.
    if (event.eventType === 'click') {
      // 7.4-B6: same-form submit-control click exemption. The browser's
      // implicit-submission synthetic click on the default submit button
      // (fired as the keydown's default action, BEFORE the native submit
      // event) targets a DIFFERENT element — the pre-B6 rule abandoned the
      // TextEntry here, destroying the typed value. That click is the commit
      // CAUSE, not an outside interaction: the owner-form join proves the
      // click belongs to the same submission the TextEntry is about to be
      // committed by. Both join keys must be non-null (legacy events with
      // no form data never match — old behavior preserved).
      const myForm = ownerFormOf(ctx);
      if (myForm != null) {
        const clickForm = formJoinKey(event.target, event.domContext);
        if (clickForm === myForm) return false;
      }
      return elementKey(event.target) !== elementKey(ctx.trigger);
    }
    return false;
  },

  buildResult(ctx: ComponentContext, _completion: ComponentCompletion) {
    const userTyped = ctx.data.userTyped === true;
    const textValue = (ctx.data.textValue as string) ?? '';
    // 6C: typedValue = user intent (last input/change sample). Falls back to
    // committed textValue when the field was autofilled/pasted without input
    // events (backfilled at blur) — never null when textValue exists.
    const typedValue = (ctx.data.typedValue as string) ?? textValue;
    const name = bestName(
      ctx.trigger.accessibleName,
      ctx.trigger.ariaLabel,
      ctx.trigger.placeholder,
    );

    // 7.4-B2a: comboboxSignal — distinguishes typeable comboboxes from plain
    // text inputs. Read from the trigger event's DomContext (captured at focus
    // time). Boolean-valued lesson (B1-12): undefined on legacy events stays
    // undefined (never a fabricated signal). Only present when S1 captured a
    // real attribute value.
    const ariaAC = ctx.triggerEvent.domContext?.ariaAutoComplete;
    const listId = ctx.triggerEvent.domContext?.listId;
    const comboboxSignal =
      typeof ariaAC === 'string' && ariaAC !== '' ? ariaAC
      : typeof listId === 'string' && listId !== '' ? 'datalist'
      : undefined;

    const metadata: Record<string, unknown> = {
      targetName: name,
      textValue,
      typedValue,
      userTyped,
    };
    if (comboboxSignal !== undefined) {
      metadata.comboboxSignal = comboboxSignal;
    }

    // 7.4-B6: commit metadata — present ONLY when the lifecycle was
    // completed by the native submit event (submit-commit path). Blur
    // completions never carry these (honesty: no fabricated commits).
    // formJoinKey provenance is emitted whenever the input had an owner
    // form, commit fields only on actual commit.
    const myForm = ownerFormOf(ctx);
    if (myForm != null) {
      metadata.formJoinKey = myForm;
      const fdc = ctx.triggerEvent.domContext;
      if (fdc?.formId) metadata.formId = fdc.formId;
      if (fdc?.formAction) metadata.formAction = fdc.formAction;
      if (fdc?.formMethod) metadata.formMethod = fdc.formMethod;
    }
    if (ctx.data.commitSignal === 'submit') {
      metadata.commitSignal = 'submit';
      metadata.committedValue = (ctx.data.committedValue as string | undefined) ?? typedValue;
      // enterCause: true only when the recorded last keydown before the
      // commit was Enter on the trigger element (display-grade flag).
      if (ctx.data.enterCause === true) {
        metadata.enterCause = true;
      }
    }

    // 7.4-B6.1 tier N: navigation-commit metadata. Same honesty rules as
    // the submit path — present ONLY when the navigation hook fired.
    if (ctx.data.commitSignal === 'navigation') {
      metadata.commitSignal = 'navigation';
      metadata.committedValue = (ctx.data.committedValue as string | undefined) ?? typedValue;
      if (ctx.data.enterCause === true) metadata.enterCause = true;
      if (typeof ctx.data.navType === 'string') metadata.navType = ctx.data.navType;
      // formJoinKey provenance stays absent here by construction: the hook
      // only fires for form-less inputs (P1) — metadata.formJoinKey is only
      // emitted when an owner form exists (above).
    }

    return { metadata };
  },
};
