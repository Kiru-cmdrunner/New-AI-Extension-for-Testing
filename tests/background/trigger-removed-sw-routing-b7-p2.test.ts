/**
 * B7-P2 §5.2.2 T4 — SW-side TRIGGER_REMOVED routing contract.
 *
 * Spec line 130's missing half: the CS notification must reach the
 * ComponentRuntime and complete the hover lifecycle with terminal
 * 'target-removed'. The SW switch case calls an exported pure seam in
 * sw-integration.ts (the reconcileFormlessEnterCommits precedent).
 *
 * Contracts:
 *   - handleTriggerRemovedNotification(lifecycleId) completes the live
 *     Hover → INTERACTION_CAPTURED broadcast + onEmit path runs (the
 *     runtime method returns the emitted interaction);
 *   - triggerEventId fallback join: when the CS notify carries only the
 *     triggerEventId (unbound window at removal time), the runtime
 *     lifecycle whose triggerEvent.eventId matches is completed;
 *   - unknown ids: no-op (nothing emitted);
 *   - TextEntry (no declaration) is untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('B7-P2 T4: SW routing — handleTriggerRemovedNotification', () => {
  let broadcasts: Array<{ type: string; interaction?: unknown }>;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    broadcasts = [];
    global.chrome = {
      runtime: {
        sendMessage: vi.fn((msg: { type: string }) => {
          if (msg.type === 'INTERACTION_CAPTURED') broadcasts.push(msg);
          return Promise.resolve();
        }),
        lastError: undefined,
      },
      tabs: { sendMessage: vi.fn(() => Promise.resolve()) },
      storage: {
        local: {
          get: vi.fn(() => Promise.resolve({})),
          set: vi.fn(() => Promise.resolve()),
          remove: vi.fn(() => Promise.resolve()),
        },
      },
    } as unknown as typeof chrome;
  });

  afterEach(async () => {
    cleanup?.();
    cleanup = null;
    // Stop recording + clear module state between tests (module-scope state
    // like liveInteractions must not leak across tests).
    try {
      const mod = await import('../../src/runtime/sw-integration');
      (mod as unknown as { stopRecording: () => void }).stopRecording();
      (mod as unknown as { resetState?: () => void }).resetState?.();
    } catch { /* best effort */ }
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function setup() {
    const mod = await import('../../src/runtime/sw-integration');
    const { initRecording } = mod as unknown as { initRecording: () => void };
    initRecording();
    const { processObservedEvent, handleTriggerRemovedNotification } = mod as unknown as {
      processObservedEvent: (e: unknown) => unknown[];
      handleTriggerRemovedNotification: (p: { lifecycleId?: string; triggerId?: string; triggerEventId?: string }) => number;
    };
    return { mod, processObservedEvent, handleTriggerRemovedNotification };
  }

  function enterEvent(id: string): unknown {
    return {
      eventId: id,
      eventType: 'mouseenter',
      timestamp: Date.now(),
      captureSeq: 1,
      isTrusted: true,
      target: {
        accessibleName: 'Menu', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
        placeholder: null, tag: 'BUTTON', className: null, name: null, stableId: null,
        testId: null, dataCy: null, dataQa: null, cssSelector: 'button',
        inputType: null,
        xPath: '/html/body/button', inIframe: false, shadowDom: false, elementId: '',
        href: null,
      },
      domContext: {
        inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false,
        disabled: false, readOnly: false, required: false, ancestorRoles: [],
        ancestorClasses: [], tabIndex: 0,
      },
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
      clientX: null, clientY: null, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null, pageUrl: 'https://example.test/', pageTitle: 'Test',
    };
  }

  it('completes the live Hover via lifecycleId join → INTERACTION_CAPTURED broadcast', async () => {
    const { processObservedEvent, handleTriggerRemovedNotification } = await setup();
    processObservedEvent(enterEvent('evt-sw1'));
    const before = broadcasts.length;

    const n = handleTriggerRemovedNotification({ lifecycleId: 'lc-1' });
    expect(n).toBe(1);
    const after = broadcasts.filter((b) => b.type === 'INTERACTION_CAPTURED').length;
    expect(after).toBe(before + 1);
    const last = broadcasts[broadcasts.length - 1] as { interaction: { type: string; endState: string; metadata: Record<string, unknown> } };
    expect(last.interaction.type).toBe('Hover');
    expect(last.interaction.endState).toBe('completed');
    expect(last.interaction.metadata.terminal).toBe('target-removed');
  });

  it('triggerEventId fallback join completes the matching lifecycle (unbound window case)', async () => {
    const { processObservedEvent, handleTriggerRemovedNotification } = await setup();
    processObservedEvent(enterEvent('evt-sw2'));
    const n = handleTriggerRemovedNotification({ triggerEventId: 'evt-sw2' });
    expect(n).toBe(1);
  });

  it('unknown ids are no-ops (nothing completed, nothing broadcast)', async () => {
    const { processObservedEvent, handleTriggerRemovedNotification } = await setup();
    processObservedEvent(enterEvent('evt-sw3'));
    const before = broadcasts.length;
    const n = handleTriggerRemovedNotification({ lifecycleId: 'lc-none' });
    expect(n).toBe(0);
    expect(broadcasts.length).toBe(before);
  });

  it('TextEntry lifecycle (no completesOnTriggerRemoved declaration) is untouched', async () => {
    const { processObservedEvent, handleTriggerRemovedNotification } = await setup();
    const focus = enterEvent('evt-sw4');
    (focus as Record<string, unknown>).eventType = 'focus';
    (focus as Record<string, unknown>).domContext = { ...(focus as any).domContext, inputType: 'text' };
    (focus as Record<string, unknown>).target = { ...(focus as any).target, tag: 'INPUT', inputType: 'text' };
    processObservedEvent(focus);
    const before = broadcasts.length;
    const n = handleTriggerRemovedNotification({ lifecycleId: 'lc-1' });
    expect(n).toBe(0);
    expect(broadcasts.length).toBe(before);
  });
});
