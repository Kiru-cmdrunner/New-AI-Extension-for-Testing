/**
 * Value Tracker + Batch Assembler Tests — Phase 3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { captureValueSnapshot } from '../../../../src/pipeline/tap/value-tracker';
import { assembleBatch, nextBatchId, resetBatchCounter } from '../../../../src/pipeline/tap/batch-assembler';
import type { TargetElementIdentity } from '../../../../src/types/element';
import type { EvidenceRecord } from '../../../../src/types/foundation';

function makeTargetIdentity(overrides: Partial<TargetElementIdentity> = {}): TargetElementIdentity {
  return {
    tag: 'BUTTON',
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaExpanded: null,
    ariaHasPopup: null,
    ariaChecked: null,
    ariaSelected: null,
    ariaPressed: null,
    inputType: null,
    isContentEditable: false,
    locators: [],
    primaryLocator: { kind: 'css', value: 'button', confidence: 0.4, source: 'computed' },
    inShadowDom: false,
    inIframe: false,
    frameContext: null,
    ...overrides,
  };
}

describe('Value Tracker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should capture valueBefore on focus events', () => {
    const input = document.createElement('input');
    input.value = 'existing value';
    document.body.appendChild(input);
    const snapshot = captureValueSnapshot(input, 'focus');
    expect(snapshot.valueBefore).toBe('existing value');
    expect(snapshot.valueAfter).toBeNull();
  });

  it('should capture valueAfter on input events', () => {
    const input = document.createElement('input');
    input.value = 'new value';
    document.body.appendChild(input);
    const snapshot = captureValueSnapshot(input, 'input');
    expect(snapshot.valueAfter).toBe('new value');
    expect(snapshot.valueBefore).toBeNull();
  });

  it('should capture valueAfter on blur events', () => {
    const input = document.createElement('input');
    input.value = 'final value';
    document.body.appendChild(input);
    const snapshot = captureValueSnapshot(input, 'blur');
    expect(snapshot.valueAfter).toBe('final value');
  });

  it('should capture checkedBefore on click events', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = false;
    document.body.appendChild(checkbox);
    const snapshot = captureValueSnapshot(checkbox, 'click');
    expect(snapshot.checkedBefore).toBe(false);
  });

  it('should capture checkedAfter on change events', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    document.body.appendChild(checkbox);
    const snapshot = captureValueSnapshot(checkbox, 'change');
    expect(snapshot.checkedAfter).toBe(true);
  });

  it('should return null for events without value relevance', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const snapshot = captureValueSnapshot(div, 'mouseenter');
    expect(snapshot.valueBefore).toBeNull();
    expect(snapshot.valueAfter).toBeNull();
    expect(snapshot.checkedBefore).toBeNull();
    expect(snapshot.checkedAfter).toBeNull();
  });
});

describe('Batch Assembler', () => {
  beforeEach(() => {
    resetBatchCounter();
  });

  it('should assemble a minimal EvidenceBatch', () => {
    const target = makeTargetIdentity();
    const evidence: EvidenceRecord[] = [
      { channelId: 'A', signalType: 'ariaRole', timestamp: '2025-01-01T00:00:00.000Z', value: 'button', confidence: 1.0 },
    ];
    const batch = assembleBatch({
      batchId: 'test-001',
      timestamp: '2025-01-01T00:00:00.000Z',
      target,
      eventType: 'click',
      evidence,
      pageUrl: 'https://example.com',
      inShadowDom: false,
      inIframe: false,
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
    });
    expect(batch.id).toBe('test-001');
    expect(batch.eventSequence).toEqual(['click']);
    expect(batch.status).toBe('pending');
    expect(batch.evidence).toHaveLength(1);
    expect(batch.target.tag).toBe('BUTTON');
  });

  it('should include value transition in domContext', () => {
    const target = makeTargetIdentity();
    const batch = assembleBatch({
      batchId: 'test-002',
      timestamp: '2025-01-01T00:00:00.000Z',
      target,
      eventType: 'blur',
      evidence: [],
      pageUrl: 'https://example.com',
      inShadowDom: false,
      inIframe: false,
      valueBefore: 'old@example.com',
      valueAfter: 'new@example.com',
      checkedBefore: null,
      checkedAfter: null,
    });
    expect(batch.domContext.valueTransition).not.toBeNull();
    expect(batch.domContext.valueTransition!.before).toBe('old@example.com');
    expect(batch.domContext.valueTransition!.after).toBe('new@example.com');
  });

  it('should include checked transition with correct property', () => {
    const target = makeTargetIdentity({ tag: 'INPUT', inputType: 'checkbox' });
    const batch = assembleBatch({
      batchId: 'test-003',
      timestamp: '2025-01-01T00:00:00.000Z',
      target,
      eventType: 'click',
      evidence: [],
      pageUrl: 'https://example.com',
      inShadowDom: false,
      inIframe: false,
      valueBefore: null,
      valueAfter: null,
      checkedBefore: false,
      checkedAfter: true,
    });
    expect(batch.domContext.checkedTransition).not.toBeNull();
    expect(batch.domContext.checkedTransition!.before).toBe(false);
    expect(batch.domContext.checkedTransition!.after).toBe(true);
    expect(batch.domContext.checkedTransition!.property).toBe('checked');
  });

  it('should use aria-pressed for toggle elements', () => {
    const target = makeTargetIdentity({ ariaPressed: true });
    const batch = assembleBatch({
      batchId: 'test-004',
      timestamp: '2025-01-01T00:00:00.000Z',
      target,
      eventType: 'click',
      evidence: [],
      pageUrl: 'https://example.com',
      inShadowDom: false,
      inIframe: false,
      valueBefore: null,
      valueAfter: null,
      checkedBefore: false,
      checkedAfter: true,
    });
    expect(batch.domContext.checkedTransition!.property).toBe('aria-pressed');
  });

  it('nextBatchId should generate sequential IDs', () => {
    expect(nextBatchId()).toBe('batch-0001');
    expect(nextBatchId()).toBe('batch-0002');
    expect(nextBatchId()).toBe('batch-0003');
  });
});
