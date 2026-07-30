/**
 * Unit Tests: stopRecording double-push fix
 *
 * Bug: runtime.flush() emits interactions via the onEmit callback
 * (which pushes to liveInteractions), and then stopRecording()
 * pushed the return value again — duplicating every flushed interaction.
 *
 * Fix: stopRecording() calls flush() but does NOT push the return value.
 * The onEmit callback already handles persistence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome.storage.local before importing
const storageData: Record<string, unknown> = {};
const chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        const result: Record<string, unknown> = {};
        for (const k of keyArr) {
          if (k in storageData) result[k] = storageData[k];
        }
        return result;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storageData, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyArr = Array.isArray(keys) ? keys : [keys];
        for (const k of keyArr) delete storageData[k];
      }),
    },
  },
  runtime: {
    id: 'test-extension-id',
  },
};

// @ts-expect-error — mock global
globalThis.chrome = chrome;

// Import after mock
const { initRecording, stopRecording, processObservedEvent, resetState, LIVE_INTERACTIONS_KEY } =
  await import('../../src/runtime/sw-integration');

// Mock chrome.runtime.sendMessage at the module level (sidepanel message)
globalThis.chrome.runtime.sendMessage = vi.fn();

describe('stopRecording double-push fix', () => {
  beforeEach(async () => {
    // Reset storage and state
    for (const k of Object.keys(storageData)) delete storageData[k];
    resetState();
  });

  it('does NOT duplicate flushed interactions', async () => {
    // When stopRecording calls flush(), the onEmit callback pushes
    // emitted interactions to liveInteractions. Before the fix,
    // stopRecording also pushed the return value of flush(),
    // producing duplicates.
    initRecording();

    // Feed a focus + click that opens a DatePicker lifecycle but doesn't complete it
    const dateInput = {
      eventId: 'evt-focus-1',
      eventType: 'focus',
      timestamp: 1000,
      isTrusted: true,
      target: {
        tag: 'INPUT',
        stableId: 'date-field',
        className: 'react-datepicker__input',
        accessibleName: 'Departure',
        ariaRole: 'textbox',
        ariaLabel: null,
        ariaLabelledBy: null,
        placeholder: null,
        name: 'date',
        testId: null,
        dataCy: null,
        dataQa: null,
        cssSelector: 'input#date-field',
        xPath: '/html/body/input',
        inIframe: false,
        shadowDom: false,
        elementId: '',
      },
      domContext: {
        inputType: 'text',
        ariaExpanded: null,
        ariaHasPopup: 'dialog',
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: [],
      },
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: null,
      clientY: null,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://test.example.com',
      pageTitle: 'Test Page',
    };

    processObservedEvent(dateInput as any);

    // stopRecording flushes active components (the pending DatePicker)
    const result = stopRecording();

    // Should have at most 1 interaction — NOT 2 (which would indicate double-push)
    expect(result.length).toBeLessThanOrEqual(1);

    // Check storage matches
    const stored = storageData[LIVE_INTERACTIONS_KEY] as unknown[];
    expect(stored).toBeDefined();
    expect(stored!.length).toBe(result.length);

    // CRITICAL: no duplicate interaction IDs
    if (result.length > 0) {
      const ids = result.map((i: any) => i.interactionId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }
  });

  it('preserves completed interactions without duplicating on flush', async () => {
    initRecording();

    // Feed a simple click (completes immediately)
    const clickEvent = {
      eventId: 'evt-click-1',
      eventType: 'click',
      timestamp: 1000,
      isTrusted: true,
      target: {
        tag: 'BUTTON',
        stableId: 'submit-btn',
        className: 'btn-primary',
        accessibleName: 'Submit',
        ariaRole: 'button',
        ariaLabel: null,
        ariaLabelledBy: null,
        placeholder: null,
        name: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        cssSelector: 'button#submit-btn',
        xPath: '/html/body/button',
        inIframe: false,
        shadowDom: false,
        elementId: '',
      },
      domContext: {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: [],
      },
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: 100,
      clientY: 200,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://test.example.com',
      pageTitle: 'Test Page',
    };

    processObservedEvent(clickEvent as any);

    // The click completed immediately → 1 interaction in liveInteractions
    // stopRecording has nothing to flush (no active components)
    const result = stopRecording();

    // Exactly 1 — no duplicates from flush
    expect(result.length).toBe(1);
    expect(result[0]!.interactionId).toBe('int-1');
  });
});
