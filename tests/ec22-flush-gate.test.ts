/**
 * EC22: flush() handles pending Click lifecycle
 *
 * Verifies that stopRecording() during an active pending Click annotation
 * correctly finalizes the deferred annotation.
 *
 * Architecture: .drytis/specs/r3-behavioral-semantic-reasoning.md §10 EC22
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome.storage.local before importing
const storageData: Record<string, unknown> = {};
const chromeMock = {
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
    sendMessage: vi.fn(async () => {}),
  },
};

// @ts-expect-error — mock global
globalThis.chrome = chromeMock;

const { initRecording, stopRecording, processObservedEvent, resetState } =
  await import('../src/runtime/sw-integration');

function makeClickEvent(stableId: string, text: string, timestamp: number) {
  return {
    eventId: `evt-${stableId}`,
    eventType: 'click',
    timestamp,
    isTrusted: true,
    target: {
      tag: 'BUTTON',
      stableId,
      className: 'btn',
      accessibleName: text,
      ariaRole: 'button',
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      name: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: `button#${stableId}`,
      xPath: `/html/body/button`,
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
}

describe('EC22: flush() handles pending Click lifecycle', () => {
  beforeEach(() => {
    for (const k of Object.keys(storageData)) delete storageData[k];
    resetState();
  });

  it('completes pending Click annotation on stopRecording', () => {
    initRecording();

    processObservedEvent(makeClickEvent('btn-submit', 'Submit', 1000) as any);

    const result = stopRecording();

    // The pending click should now be in the final result
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(i => i.type === 'Click')).toBe(true);
  });

  it('preserves interaction ordering when flush during pending state', () => {
    initRecording();

    processObservedEvent(makeClickEvent('btn-first', 'First', 1000) as any);
    processObservedEvent(makeClickEvent('btn-second', 'Second', 2000) as any);

    const result = stopRecording();

    // Both clicks should be present
    expect(result.length).toBeGreaterThanOrEqual(2);
    const clicks = result.filter(i => i.type === 'Click');
    expect(clicks.length).toBeGreaterThanOrEqual(2);
    // Verify ordering
    expect(clicks[0]!.startTime).toBeLessThanOrEqual(clicks[1]!.startTime);
  });

  it('flush produces no duplicate interaction IDs', () => {
    initRecording();

    processObservedEvent(makeClickEvent('btn-a', 'Alpha', 1000) as any);
    processObservedEvent(makeClickEvent('btn-b', 'Beta', 2000) as any);

    const result = stopRecording();

    const ids = result.map(i => i.interactionId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
