/**
 * Delivery Coordinator + EventTap Tests — Phase 3
 *
 * Tests for the sessionStorage buffer, exponential backoff, page lifecycle,
 * and the EventTap orchestrator.
 *
 * Note: chrome.runtime APIs are mocked. JSDOM provides sessionStorage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearBuffer,
  isRecordingActive,
  setRecordingActive,
  getBufferedCount,
  deliverBatch,
  flushPendingBatches,
  installPageLifecycleHandlers,
  EVIDENCE_BATCH_MESSAGE_TYPE,
} from '../../../../src/pipeline/tap/delivery-coordinator';
import {
  createEventTap,
  processEvent,
  TEST_HOOK,
  type EventTapHandle,
} from '../../../../src/pipeline/tap/event-tap';
import type { EvidenceBatch } from '../../../../src/types/evidence';

// ── Mock chrome.runtime ───────────────────────────────────

let mockSendMessage: ReturnType<typeof vi.fn>;

function setupChromeMock(shouldSucceed = true) {
  mockSendMessage = vi.fn((_message: any, callback: any) => {
    if (callback) {
      callback({ ok: shouldSucceed });
    }
    return undefined;
  });
  (globalThis as any).chrome = {
    runtime: {
      sendMessage: mockSendMessage,
      lastError: null,
    },
  };
}

function removeChromeMock() {
  delete (globalThis as any).chrome;
}

// ── Helpers ───────────────────────────────────────────────

function makeBatch(id: string): EvidenceBatch {
  return {
    id,
    startedAt: '2025-01-01T00:00:00.000Z',
    endedAt: '2025-01-01T00:00:00.000Z',
    target: {
      tag: 'BUTTON',
      accessibleName: 'Test',
      ariaRole: 'button',
      ariaExpanded: null, ariaHasPopup: null, ariaChecked: null,
      ariaSelected: null, ariaPressed: null,
      inputType: null, isContentEditable: false,
      locators: [], primaryLocator: { kind: 'css', value: 'button', confidence: 0.4, source: 'computed' },
      inShadowDom: false, inIframe: false, frameContext: null,
    },
    domContext: {
      surfaces: [], valueTransition: null, checkedTransition: null,
      ancestorChain: [], datePicker: null, fileUpload: null, dialog: null, navigation: null,
    },
    evidence: [],
    eventSequence: ['click'],
    status: 'pending',
    correlationGroup: null,
    pageUrl: 'https://example.com',
  };
}

// ── Delivery Coordinator Tests ────────────────────────────

describe('Delivery Coordinator', () => {
  beforeEach(() => {
    sessionStorage.clear();
    removeChromeMock();
  });

  describe('Recording State', () => {
    it('should set and check recording state', () => {
      expect(isRecordingActive()).toBe(false);
      setRecordingActive(true);
      expect(isRecordingActive()).toBe(true);
      setRecordingActive(false);
      expect(isRecordingActive()).toBe(false);
    });
  });

  describe('Buffer Management', () => {
    it('getBufferedCount should return 0 for empty buffer', () => {
      expect(getBufferedCount()).toBe(0);
    });

    it('clearBuffer should remove all items', () => {
      sessionStorage.setItem('cmdrunner_evidence_buffer', JSON.stringify([makeBatch('b1')]));
      expect(getBufferedCount()).toBe(1);
      clearBuffer();
      expect(getBufferedCount()).toBe(0);
    });
  });

  describe('deliverBatch', () => {
    it('should buffer the batch and attempt delivery', () => {
      setupChromeMock(true);
      const batch = makeBatch('del-001');
      deliverBatch(batch);
      // Buffer has 1, delivery was attempted (sendMessage called)
      // Note: with synchronous mock callback, batch is immediately confirmed
      // and removed from buffer. That's correct production behavior.
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      expect(mockSendMessage).toHaveBeenCalledWith(
        { type: EVIDENCE_BATCH_MESSAGE_TYPE, batch },
        expect.any(Function),
      );
    });

    it('should remove from buffer on confirmed delivery', () => {
      setupChromeMock(true);
      const batch = makeBatch('del-002');
      deliverBatch(batch);
      // Synchronous callback in mock — should be removed immediately
      expect(getBufferedCount()).toBe(0);
    });

    it('should keep batch in buffer when delivery fails', () => {
      setupChromeMock(false);
      const batch = makeBatch('del-003');
      deliverBatch(batch);
      expect(getBufferedCount()).toBe(1);
    });

    it('should not throw when chrome.runtime is unavailable', () => {
      removeChromeMock();
      const batch = makeBatch('del-004');
      // Should not throw, just buffer
      expect(() => deliverBatch(batch)).not.toThrow();
      expect(getBufferedCount()).toBe(1);
    });
  });

  describe('flushPendingBatches', () => {
    it('should flush all buffered batches', async () => {
      setupChromeMock(true);
      // Manually add batches to buffer
      sessionStorage.setItem('cmdrunner_evidence_buffer',
        JSON.stringify([makeBatch('f1'), makeBatch('f2')]));
      expect(getBufferedCount()).toBe(2);
      await flushPendingBatches();
      expect(getBufferedCount()).toBe(0);
    });

    it('should not throw when buffer is empty', async () => {
      setupChromeMock(true);
      await flushPendingBatches();
      expect(getBufferedCount()).toBe(0);
    });

    it('should handle chrome unavailable gracefully', async () => {
      removeChromeMock();
      sessionStorage.setItem('cmdrunner_evidence_buffer',
        JSON.stringify([makeBatch('f3')]));
      await flushPendingBatches();
      // Batches stay in buffer since no SW to deliver to
      expect(getBufferedCount()).toBe(1);
    });
  });

  describe('installPageLifecycleHandlers', () => {
    it('should install pagehide and pageshow listeners', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      installPageLifecycleHandlers();
      expect(addSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith('pageshow', expect.any(Function));
      addSpy.mockRestore();
    });

    it('should call onResume on pageshow when recording is active', () => {
      setRecordingActive(true);
      const onResume = vi.fn();
      installPageLifecycleHandlers(onResume);
      // Dispatch pageshow
      window.dispatchEvent(new Event('pageshow'));
      expect(onResume).toHaveBeenCalled();
      setRecordingActive(false);
    });
  });
});

// ── EventTap Tests ────────────────────────────────────────

describe('EventTap', () => {
  let handle: EventTapHandle | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    TEST_HOOK.forceTrusted = true; // JSDOM doesn't set isTrusted
  });

  afterEach(() => {
    handle?.stop();
    TEST_HOOK.forceTrusted = false;
  });

  it('should create a tap handle with stop and isActive', () => {
    handle = createEventTap({ deliverToSW: false });
    expect(handle.isActive()).toBe(true);
    handle.stop();
    expect(handle.isActive()).toBe(false);
  });

  it('should call onBatch when an event is captured', () => {
    const onBatch = vi.fn();
    handle = createEventTap({ onBatch, deliverToSW: false });
    const btn = document.createElement('button');
    btn.textContent = 'Click';
    document.body.appendChild(btn);
    btn.click();
    expect(onBatch).toHaveBeenCalledTimes(1);
    const batch = onBatch.mock.calls[0][0] as EvidenceBatch;
    expect(batch.eventSequence).toEqual(['click']);
    expect(batch.target.tag).toBe('BUTTON');
  });

  it('should produce EvidenceBatch with evidence records', () => {
    const onBatch = vi.fn();
    handle = createEventTap({ onBatch, deliverToSW: false });
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Submit');
    btn.textContent = 'Submit';
    document.body.appendChild(btn);
    btn.click();
    const batch = onBatch.mock.calls[0][0] as EvidenceBatch;
    // Should have evidence from multiple channels
    expect(batch.evidence.length).toBeGreaterThan(0);
    const channelIds = new Set(batch.evidence.map(e => e.channelId));
    expect(channelIds.size).toBeGreaterThanOrEqual(2);
  });

  it('should not capture events after stop()', () => {
    const onBatch = vi.fn();
    handle = createEventTap({ onBatch, deliverToSW: false });
    handle.stop();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.click();
    expect(onBatch).not.toHaveBeenCalled();
  });

  it('should skip untrusted events when forceTrusted is false', () => {
    TEST_HOOK.forceTrusted = false;
    const onBatch = vi.fn();
    handle = createEventTap({ onBatch, deliverToSW: false });
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.click();
    // JSDOM events have isTrusted=false
    expect(onBatch).not.toHaveBeenCalled();
  });

  it('should capture focus events', () => {
    const onBatch = vi.fn();
    handle = createEventTap({ onBatch, deliverToSW: false, eventTypes: ['focus'] });
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    expect(onBatch).toHaveBeenCalledTimes(1);
    const batch = onBatch.mock.calls[0][0] as EvidenceBatch;
    expect(batch.eventSequence).toEqual(['focus']);
  });

  it('should capture blur events with valueAfter', () => {
    const onBatch = vi.fn();
    handle = createEventTap({ onBatch, deliverToSW: false, eventTypes: ['blur'] });
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'test@example.com';
    document.body.appendChild(input);
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    const batch = onBatch.mock.calls[0][0] as EvidenceBatch;
    expect(batch.domContext.valueTransition).not.toBeNull();
    expect(batch.domContext.valueTransition!.after).toBe('test@example.com');
  });

  it('should capture click events on checkboxes with checkedBefore', () => {
    const onBatch = vi.fn();
    handle = createEventTap({ onBatch, deliverToSW: false, eventTypes: ['click'] });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    document.body.appendChild(checkbox);
    checkbox.click();
    const batch = onBatch.mock.calls[0][0] as EvidenceBatch;
    // JSDOM toggles .checked before capture-phase dispatch (checkbox was true → false).
    // The value tracker infers after = !false = true (toggle behaviour).
    expect(batch.domContext.checkedTransition).not.toBeNull();
    expect(batch.domContext.checkedTransition!.before).toBe(false);
    expect(batch.domContext.checkedTransition!.after).toBe(true);
  });
});

// ── processEvent Unit Tests ───────────────────────────────

describe('processEvent', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    TEST_HOOK.forceTrusted = true;
  });

  afterEach(() => {
    TEST_HOOK.forceTrusted = false;
  });

  it('should return null for null event', () => {
    expect(processEvent(null)).toBeNull();
  });

  it('should return null when no target element resolves', () => {
    // No elements in the DOM, dispatch event on body — body is a structural
    // element (in NON_INTERACTIVE_TAGS), so resolveTarget returns null
    const event = new Event('click', { bubbles: true });
    document.body.dispatchEvent(event);
    expect(processEvent(event)).toBeNull();
  });

  it('should return EvidenceBatch for a button click', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Submit';
    document.body.appendChild(btn);
    const event = new MouseEvent('click', { bubbles: true });
    btn.dispatchEvent(event);
    const batch = processEvent(event);
    expect(batch).not.toBeNull();
    expect(batch!.target.tag).toBe('BUTTON');
    expect(batch!.eventSequence).toEqual(['click']);
    expect(batch!.evidence.length).toBeGreaterThan(0);
  });

  it('should populate target identity with accessible name', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Login Button');
    document.body.appendChild(btn);
    const event = new MouseEvent('click', { bubbles: true });
    btn.dispatchEvent(event);
    const batch = processEvent(event);
    expect(batch!.target.accessibleName).toBe('Login Button');
  });
});
