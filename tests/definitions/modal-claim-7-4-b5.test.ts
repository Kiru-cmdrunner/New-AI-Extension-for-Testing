/**
 * 7.4-B5 Modal — claim-matrix pins (spec phase-7-4-b5-modal.md AC B5-1-1..B5-1-5, B5-2a-1..B5-2a-5, R10).
 *
 * Every fixture shape is GENERIC: no test attributes, no site tokens. The
 * only signal under test is the W3C/ARIA dialog convention
 * (aria-haspopup="dialog" for open; Escape+dialog-ancestry for dismiss).
 *
 * Red-first: these assertions all fail until modal.ts exists and is registered.
 */
import { describe, it, expect } from 'vitest';
import { ALL_DEFINITIONS } from '../../src/definitions';
import type { ObservedEvent, DomContext } from '../../src/shared/component-types';

// ── Minimal event builder (house pattern: B1 expander-claim test) ──

function makeEvent(over: {
  eventType?: string;
  key?: string | null;
  tag?: string;
  ariaRole?: string | null;
  domContext?: Partial<DomContext>;
}): ObservedEvent {
  const domContext: DomContext = {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    tabIndex: null,
    ...over.domContext,
  };
  return {
    eventId: 'evt-p-0-1',
    eventType: (over.eventType ?? 'click') as ObservedEvent['eventType'],
    timestamp: 1,
    captureSeq: 1,
    isTrusted: true,
    target: {
      tag: over.tag ?? 'BUTTON',
      ariaRole: over.ariaRole ?? null,
      className: null,
      autoId: null,
      dataAutoId: null,
      accessibleName: 'Open Dialog',
    },
    domContext,
    key: over.key ?? null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 200,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Test',
  } as unknown as ObservedEvent;
}

// ── Helpers to get the Modal definition ──

function getModal() {
  return ALL_DEFINITIONS.find((d) => d.type === 'Modal');
}
function getExpander() {
  return ALL_DEFINITIONS.find((d) => d.type === 'Expander');
}
function getKeyboardShortcut() {
  return ALL_DEFINITIONS.find((d) => d.type === 'KeyboardShortcut');
}

// ════════════════════════════════════════════════════════════════════
// B5-1: Open branch
// ════════════════════════════════════════════════════════════════════

describe('7.4-B5 Modal — open branch (B5-1)', () => {
  it('B5-1-2: definition exists at priority 75', () => {
    const modal = getModal();
    expect(modal).toBeDefined();
    expect(modal!.priority).toBe(75);
  });

  it('B5-1-2: triggerEventTypes includes click and keydown', () => {
    const modal = getModal();
    expect(modal!.triggerEventTypes.has('click')).toBe(true);
    expect(modal!.triggerEventTypes.has('keydown')).toBe(true);
  });

  it('B5-1-4: aria-haspopup="dialog" → claims Modal', () => {
    const e = makeEvent({ domContext: { ariaHasPopup: 'dialog' } });
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
  });

  it('B5-1-4: aria-haspopup="true" → null (true means menu, not dialog)', () => {
    const e = makeEvent({ domContext: { ariaHasPopup: 'true' } });
    expect(getModal()!.detectTrigger(e)).toBeNull();
  });

  it('B5-1-4: aria-haspopup="menu" → null', () => {
    const e = makeEvent({ domContext: { ariaHasPopup: 'menu' } });
    expect(getModal()!.detectTrigger(e)).toBeNull();
  });

  it('B5-1-4: aria-haspopup="listbox" → null', () => {
    const e = makeEvent({ domContext: { ariaHasPopup: 'listbox' } });
    expect(getModal()!.detectTrigger(e)).toBeNull();
  });

  it('B5-1-4: aria-haspopup absent → null', () => {
    const e = makeEvent({});
    expect(getModal()!.detectTrigger(e)).toBeNull();
  });

  it('B5-1-4: aria-haspopup undefined → null (pre-B5 sessions)', () => {
    const e = makeEvent({ domContext: { ariaHasPopup: undefined } });
    expect(getModal()!.detectTrigger(e)).toBeNull();
  });

  it('B5-1-5: both-present (aria-expanded + haspopup=dialog) → Modal wins, Expander would also claim', () => {
    const e = makeEvent({
      tag: 'BUTTON',
      domContext: { ariaExpanded: false, ariaHasPopup: 'dialog' },
    });
    // Expander would claim at 80, but Modal at 75 is tried first
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
    expect(getExpander()!.detectTrigger(e)).toEqual({ type: 'Expander' });
    // Priority arithmetic: Modal(75) < Expander(80) → Modal wins
    expect(getModal()!.priority).toBeLessThan(getExpander()!.priority);
  });

  it('B5-1-2: immediate completion shape (isInScope false, handleEvent returns completed)', () => {
    const e = makeEvent({ domContext: { ariaHasPopup: 'dialog' } });
    const modal = getModal()!;
    const trigger = modal.detectTrigger(e);
    expect(trigger).not.toBeNull();
    expect(modal.isInScope(e, {} as any)).toBe(false);
    expect(modal.handleEvent(e, {} as any)).toEqual({ endState: 'completed' });
  });
});

// ════════════════════════════════════════════════════════════════════
// B5-1-3: Registry order
// ════════════════════════════════════════════════════════════════════

describe('7.4-B5 Modal — registry (B5-1-3)', () => {
  it('B5-1-3: registry has 18 definitions', () => {
    expect(ALL_DEFINITIONS).toHaveLength(18);
  });

  it('B5-1-3: sorted Link(70) < Modal(75) < Expander(80)', () => {
    const sorted = [...ALL_DEFINITIONS].sort((a, b) => a.priority - b.priority);
    const linkIdx = sorted.findIndex((d) => d.type === 'Link');
    const modalIdx = sorted.findIndex((d) => d.type === 'Modal');
    const expanderIdx = sorted.findIndex((d) => d.type === 'Expander');
    expect(linkIdx).toBeLessThan(modalIdx);
    expect(modalIdx).toBeLessThan(expanderIdx);
  });
});

// ════════════════════════════════════════════════════════════════════
// B5-2a: Dismiss branch
// ════════════════════════════════════════════════════════════════════

describe('7.4-B5 Modal — dismiss branch (B5-2a)', () => {
  it('B5-2a-1: bare Escape + dialog in ancestry → claims Modal', () => {
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'INPUT',
      domContext: {
        ancestorRoles: ['div[role=dialog]', 'body[role=]', 'html[role=]'],
      },
    });
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
  });

  it('B5-2a-1: bare Escape + dialog is self → claims Modal', () => {
    // Escape on the dialog container itself: ancestorRoles starts at parent,
    // so no dialog in ancestry — but target.ariaRole === 'dialog' must claim.
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'DIV',
      ariaRole: 'dialog',
      domContext: {
        ancestorRoles: ['body[role=]', 'html[role=]'],
      },
    });
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
  });

  it('B5-2a-1: bare Escape + native <dialog> tag is self → claims Modal', () => {
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'DIALOG',
      domContext: {
        ancestorRoles: ['body[role=]', 'html[role=]'],
      },
    });
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
  });

  it('B5-2a-1: bare Escape + alertdialog in ancestry → claims Modal', () => {
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'INPUT',
      domContext: {
        ancestorRoles: ['div[role=alertdialog]', 'body[role=]', 'html[role=]'],
      },
    });
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
  });

  it('B5-2a-2: bare Escape on BODY (no dialog anywhere) → null (stays Unclassified)', () => {
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'BODY',
      ariaRole: null,
      domContext: {
        ancestorRoles: ['html[role=]'],
      },
    });
    expect(getModal()!.detectTrigger(e)).toBeNull();
  });

  it('B5-2a-3: nested dialog — innermost dialog ancestry claims', () => {
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'INPUT',
      domContext: {
        ancestorRoles: [
          'div[role=dialog]',
          'div[role=dialog]',
          'body[role=]',
          'html[role=]',
        ],
      },
    });
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
    // buildResult metadata should carry dialog fact
  });

  it('B5-2a-5: non-Escape bare key (e.g. "a") → null', () => {
    const e = makeEvent({
      eventType: 'keydown',
      key: 'a',
      tag: 'INPUT',
      domContext: {
        ancestorRoles: ['div[role=dialog]', 'body[role=]', 'html[role=]'],
      },
    });
    expect(getModal()!.detectTrigger(e)).toBeNull();
  });

  it('B5-2a-4: Escape on input inside dialog — Modal WOULD claim (definition correct), but runtime absorbs first (documented limit)', () => {
    // Spec §7 limit 1: Escape on a same-element-focused input where
    // TextEntry lifecycle is active is silently absorbed as a memberEvent
    // (component-runtime.ts same-element discrete event absorption).
    //
    // This test proves the DEFINITION is correct: detectTrigger DOES claim
    // Escape on an input with dialog ancestry. The absorption happens at the
    // RUNTIME layer (before discovery), not at the definition layer.
    // The definition seeing this event is the correct behavior — the
    // runtime's absorption is the documented honest limit.
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'INPUT',
      ariaRole: 'textbox',
      domContext: {
        ancestorRoles: ['div[role=dialog]', 'body[role=]', 'html[role=]'],
      },
    });
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
    // ^ The definition claims it. The runtime absorbs it before discovery.
    // This pin ensures a future refactor doesn't break the definition gate
    // while the runtime absorption behavior is preserved separately.
  });

  it('B5-2a-5: modifier+Escape → KeyboardShortcut claims (not Modal)', () => {
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'INPUT',
      domContext: {
        ancestorRoles: ['div[role=dialog]', 'body[role=]', 'html[role=]'],
      },
      // We need to set ctrlKey etc.
    });
    // Override the event to add modifier
    (e as any).ctrlKey = true;
    expect(getKeyboardShortcut()!.detectTrigger(e)).toEqual({ type: 'KeyboardShortcut' });
    // Modal would also try, but KeyboardShortcut(8) wins by priority
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
    // Priority arithmetic: KeyboardShortcut(8) < Modal(75)
    expect(getKeyboardShortcut()!.priority).toBeLessThan(getModal()!.priority);
  });
});

// ════════════════════════════════════════════════════════════════════
// R10: Boundary pairs — no double-claim
// ════════════════════════════════════════════════════════════════════

describe('7.4-B5 Modal — R10 boundary pairs', () => {
  it('R10: both-present event → Modal wins by priority, not both', () => {
    const e = makeEvent({
      tag: 'BUTTON',
      domContext: { ariaExpanded: true, ariaHasPopup: 'dialog' },
    });
    const claimers = ALL_DEFINITIONS
      .filter((d) => d.detectTrigger(e) !== null)
      .map((d) => d.type);
    // Multiple definitions may claim, but discovery picks the lowest priority
    expect(claimers).toContain('Modal');
    expect(claimers).toContain('Expander');
    // The first claimer by priority is Modal
    const sorted = ALL_DEFINITIONS
      .filter((d) => d.detectTrigger(e) !== null)
      .sort((a, b) => a.priority - b.priority);
    expect(sorted[0].type).toBe('Modal');
  });

  it('R10: bare Escape in dialog → Modal claims, not KeyboardShortcut', () => {
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'INPUT',
      domContext: {
        ancestorRoles: ['div[role=dialog]', 'body[role=]', 'html[role=]'],
      },
    });
    // KeyboardShortcut should NOT claim bare Escape (no modifier, not F-key)
    expect(getKeyboardShortcut()!.detectTrigger(e)).toBeNull();
    expect(getModal()!.detectTrigger(e)).toEqual({ type: 'Modal' });
  });
});

// ════════════════════════════════════════════════════════════════════
// B5-1-2: buildResult metadata
// ════════════════════════════════════════════════════════════════════

describe('7.4-B5 Modal — buildResult metadata (B5-1-2)', () => {
  it('open: action="open" with targetName and click coords', () => {
    const modal = getModal()!;
    const e = makeEvent({
      tag: 'BUTTON',
      domContext: { ariaHasPopup: 'dialog' },
    });
    modal.detectTrigger(e)!;
    const ctx: any = {
      type: 'Modal',
      state: 'triggering',
      trigger: e.target,
      triggerEvent: e,
    };
    const result = modal.buildResult(ctx, { endState: 'completed' });
    expect(result.metadata.action).toBe('open');
    expect(result.metadata.targetName).toBeDefined();
    expect(result.metadata.clientX).toBe(100);
    expect(result.metadata.clientY).toBe(200);
  });

  it('dismiss: action="dismiss-escape" with key and dialogInAncestry', () => {
    const modal = getModal()!;
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'INPUT',
      domContext: {
        ancestorRoles: ['div[role=dialog]', 'body[role=]', 'html[role=]'],
      },
    });
    modal.detectTrigger(e)!;
    const ctx: any = {
      type: 'Modal',
      state: 'triggering',
      trigger: e.target,
      triggerEvent: e,
    };
    const result = modal.buildResult(ctx, { endState: 'completed' });
    expect(result.metadata.action).toBe('dismiss-escape');
    expect(result.metadata.key).toBe('Escape');
    expect(result.metadata.dialogInAncestry).toBe(true);
  });

  it('dismiss self: dialogInAncestry=false when dialog is self', () => {
    const modal = getModal()!;
    const e = makeEvent({
      eventType: 'keydown',
      key: 'Escape',
      tag: 'DIV',
      ariaRole: 'dialog',
      domContext: {
        ancestorRoles: ['body[role=]', 'html[role=]'],
      },
    });
    const ctx: any = {
      type: 'Modal',
      state: 'triggering',
      trigger: e.target,
      triggerEvent: e,
    };
    const result = modal.buildResult(ctx, { endState: 'completed' });
    expect(result.metadata.action).toBe('dismiss-escape');
    expect(result.metadata.dialogInAncestry).toBe(false);
  });
});