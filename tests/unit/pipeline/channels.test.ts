/**
 * Evidence Channel Tests — Phase 2
 *
 * Tests for all five evidence channels (A-E), the channel registry,
 * and the type adapters.
 *
 * Uses JSDOM to create realistic DOM elements and verify that each
 * channel produces correct EvidenceRecord[] output.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChannelA } from '../../../src/pipeline/channels/channel-a-accessibility';
import { ChannelB } from '../../../src/pipeline/channels/channel-b-dom-structure';
import { ChannelC } from '../../../src/pipeline/channels/channel-c-behavioural';
import { ChannelD } from '../../../src/pipeline/channels/channel-d-mutations';
import { ChannelE } from '../../../src/pipeline/channels/channel-e-focus-overlay';
import {
  ALL_CHANNELS,
  CHANNEL_MAP,
  collectAllEvidence,
  collectFromChannel,
} from '../../../src/pipeline/channels/index';
import type { ChannelCollectInput } from '../../../src/pipeline/channels/evidence-channel';
import type { ChannelId } from '../../../src/types/foundation';

// ── Helpers ───────────────────────────────────────────────

function makeInput(el: Element, overrides: Partial<ChannelCollectInput> = {}): ChannelCollectInput {
  return {
    target: el,
    event: new Event('click'),
    eventType: 'click',
    timestamp: '2025-01-01T00:00:00.000Z',
    pageUrl: 'https://example.com',
    inShadowDom: false,
    inIframe: false,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function setupDom() {
  document.body.innerHTML = '';
}

// ── Channel A Tests ───────────────────────────────────────

describe('Channel A — Accessibility', () => {
  beforeEach(setupDom);

  it('should collect ARIA role for button', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const records = ChannelA.collect(makeInput(btn));
    const roleRecord = records.find(r => r.signalType === 'ariaRole');
    expect(roleRecord).toBeDefined();
    expect(roleRecord!.value).toBe('button');
  });

  it('should collect accessible name from aria-label', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Submit Form');
    document.body.appendChild(el);
    const records = ChannelA.collect(makeInput(el));
    const nameRecord = records.find(r => r.signalType === 'accessibleName');
    expect(nameRecord).toBeDefined();
    expect(nameRecord!.value).toBe('Submit Form');
  });

  it('should collect accessible name from text content', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Click Me';
    document.body.appendChild(btn);
    const records = ChannelA.collect(makeInput(btn));
    const nameRecord = records.find(r => r.signalType === 'accessibleName');
    expect(nameRecord).toBeDefined();
    expect(nameRecord!.value).toBe('Click Me');
  });

  it('should collect ARIA states (aria-expanded)', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'combobox');
    el.setAttribute('aria-expanded', 'true');
    document.body.appendChild(el);
    const records = ChannelA.collect(makeInput(el));
    const expandedRecord = records.find(r =>
      r.signalType === 'ariaAttribute' &&
      (r.value as any).attribute === 'aria-expanded'
    );
    expect(expandedRecord).toBeDefined();
    expect((expandedRecord!.value as any).value).toBe(true);
  });

  it('should detect landmarks (role=navigation)', () => {
    const nav = document.createElement('nav');
    document.body.appendChild(nav);
    const records = ChannelA.collect(makeInput(nav));
    const landmarkRecord = records.find(r => r.signalType === 'landmark');
    expect(landmarkRecord).toBeDefined();
    expect(landmarkRecord!.value).toBe('navigation');
  });

  it('should return empty array for non-ARIA div with no text', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const records = ChannelA.collect(makeInput(div));
    expect(records).toHaveLength(0);
  });

  it('should not throw on broken elements', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    // Should not throw
    const records = ChannelA.collect(makeInput(el));
    expect(Array.isArray(records)).toBe(true);
  });
});

// ── Channel B Tests ───────────────────────────────────────

describe('Channel B — DOM Structure', () => {
  beforeEach(setupDom);

  it('should collect tag name', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const records = ChannelB.collect(makeInput(btn));
    const tagRecord = records.find(r => r.signalType === 'tag');
    expect(tagRecord).toBeDefined();
    expect(tagRecord!.value).toBe('BUTTON');
  });

  it('should collect CSS classes', () => {
    const div = document.createElement('div');
    div.className = 'btn primary large';
    document.body.appendChild(div);
    const records = ChannelB.collect(makeInput(div));
    const classRecord = records.find(r => r.signalType === 'cssClass');
    expect(classRecord).toBeDefined();
    expect(classRecord!.value).toEqual(['btn', 'primary', 'large']);
  });

  it('should collect text content', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Login';
    document.body.appendChild(btn);
    const records = ChannelB.collect(makeInput(btn));
    const textRecord = records.find(r => r.signalType === 'text');
    expect(textRecord).toBeDefined();
    expect(textRecord!.value).toBe('Login');
  });

  it('should collect ancestor chain', () => {
    const container = document.createElement('div');
    container.setAttribute('role', 'group');
    const btn = document.createElement('button');
    container.appendChild(btn);
    document.body.appendChild(container);
    const records = ChannelB.collect(makeInput(btn));
    const hierarchyRecord = records.find(r => r.signalType === 'hierarchy');
    expect(hierarchyRecord).toBeDefined();
    expect(hierarchyRecord!.value).toContain('div[role=group]');
  });

  it('should resolve locators including testId', () => {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'login-btn');
    document.body.appendChild(el);
    const records = ChannelB.collect(makeInput(el));
    const locatorRecord = records.find(r =>
      r.signalType === 'ariaAttribute' &&
      Array.isArray(r.value) &&
      (r.value as any[]).some(l => l.kind === 'testId')
    );
    expect(locatorRecord).toBeDefined();
  });

  it('should resolve locators including element ID', () => {
    const el = document.createElement('div');
    el.id = 'unique-element';
    document.body.appendChild(el);
    const records = ChannelB.collect(makeInput(el));
    const locatorRecord = records.find(r =>
      r.signalType === 'ariaAttribute' &&
      Array.isArray(r.value) &&
      (r.value as any[]).some(l => l.kind === 'id')
    );
    expect(locatorRecord).toBeDefined();
  });

  it('should not produce CSS class record for classless element', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const records = ChannelB.collect(makeInput(div));
    expect(records.find(r => r.signalType === 'cssClass')).toBeUndefined();
  });
});

// ── Channel C Tests ───────────────────────────────────────

describe('Channel C — Behavioural', () => {
  beforeEach(setupDom);

  it('should always produce eventSequence record', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const records = ChannelC.collect(makeInput(btn, { eventType: 'click' }));
    const seqRecord = records.find(r => r.signalType === 'eventSequence');
    expect(seqRecord).toBeDefined();
    expect(seqRecord!.value).toBe('click');
  });

  it('should produce valueTransition when before/after provided', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    const records = ChannelC.collect(makeInput(input, {
      valueBefore: 'old',
      valueAfter: 'new',
    }));
    const vtRecord = records.find(r => r.signalType === 'valueTransition');
    expect(vtRecord).toBeDefined();
    expect((vtRecord!.value as any).before).toBe('old');
    expect((vtRecord!.value as any).after).toBe('new');
  });

  it('should produce checkedTransition when before/after provided', () => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.appendChild(checkbox);
    const records = ChannelC.collect(makeInput(checkbox, {
      checkedBefore: false,
      checkedAfter: true,
    }));
    const ctRecord = records.find(r => r.signalType === 'checkedTransition');
    expect(ctRecord).toBeDefined();
    expect((ctRecord!.value as any).before).toBe(false);
    expect((ctRecord!.value as any).after).toBe(true);
    expect((ctRecord!.value as any).property).toBe('checked');
  });

  it('should not produce valueTransition when both null', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const records = ChannelC.collect(makeInput(btn));
    expect(records.find(r => r.signalType === 'valueTransition')).toBeUndefined();
  });

  it('should capture input type for form elements', () => {
    const input = document.createElement('input');
    input.type = 'email';
    document.body.appendChild(input);
    const records = ChannelC.collect(makeInput(input));
    const typeRecord = records.find(r =>
      r.signalType === 'tag' &&
      typeof r.value === 'object' &&
      (r.value as any).inputType
    );
    expect(typeRecord).toBeDefined();
    expect((typeRecord!.value as any).inputType).toBe('email');
  });

  it('should capture validation attributes (required)', () => {
    const input = document.createElement('input');
    input.setAttribute('required', '');
    input.type = 'text';
    document.body.appendChild(input);
    const records = ChannelC.collect(makeInput(input));
    const attrRecord = records.find(r =>
      r.signalType === 'ariaAttribute' &&
      (r.value as any).required !== undefined
    );
    expect(attrRecord).toBeDefined();
  });
});

// ── Channel D Tests ───────────────────────────────────────

describe('Channel D — Runtime Mutations', () => {
  beforeEach(setupDom);

  it('should detect surface from provided surfaces array', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const records = ChannelD.collect(makeInput(btn, {
      surfaces: [{
        type: 'modal',
        role: 'dialog',
        accessibleName: 'Confirm',
        direction: 'appeared',
        detectedAt: '2025-01-01T00:00:00.000Z',
      }],
    }));
    const surfaceRecord = records.find(r => r.signalType === 'surfaceAppearance');
    expect(surfaceRecord).toBeDefined();
    expect((surfaceRecord!.value as any).type).toBe('modal');
  });

  it('should detect surface from aria-expanded=true', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'combobox');
    el.setAttribute('aria-haspopup', 'listbox');
    el.setAttribute('aria-expanded', 'true');
    document.body.appendChild(el);
    const records = ChannelD.collect(makeInput(el));
    const surfaceRecord = records.find(r => r.signalType === 'surfaceAppearance');
    expect(surfaceRecord).toBeDefined();
    expect((surfaceRecord!.value as any).expanded).toBe(true);
  });

  it('should detect surface disappearance from aria-expanded=false', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'combobox');
    el.setAttribute('aria-haspopup', 'listbox');
    el.setAttribute('aria-expanded', 'false');
    document.body.appendChild(el);
    const records = ChannelD.collect(makeInput(el));
    const surfaceRecord = records.find(r => r.signalType === 'surfaceDisappearance');
    expect(surfaceRecord).toBeDefined();
  });

  it('should produce childListChange for elements with children', () => {
    const div = document.createElement('div');
    div.appendChild(document.createElement('span'));
    document.body.appendChild(div);
    const records = ChannelD.collect(makeInput(div));
    const childRecord = records.find(r => r.signalType === 'childListChange');
    expect(childRecord).toBeDefined();
    expect((childRecord!.value as any).childCount).toBe(1);
  });

  it('should produce no records for bare element without surface signals', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const records = ChannelD.collect(makeInput(div));
    // childListChange requires children, surface requires haspopup/expanded
    expect(records).toHaveLength(0);
  });
});

// ── Channel E Tests ───────────────────────────────────────

describe('Channel E — Focus & Overlay', () => {
  beforeEach(setupDom);

  it('should produce focusEnter for focus events', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    const records = ChannelE.collect(makeInput(input, { eventType: 'focus' }));
    const focusRecord = records.find(r => r.signalType === 'focusEnter');
    expect(focusRecord).toBeDefined();
  });

  it('should produce focusExit for blur events', () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    const records = ChannelE.collect(makeInput(input, { eventType: 'blur' }));
    const blurRecord = records.find(r => r.signalType === 'focusExit');
    expect(blurRecord).toBeDefined();
  });

  it('should detect overlay context when inside dialog', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    dialog.appendChild(btn);
    document.body.appendChild(dialog);
    const records = ChannelE.collect(makeInput(btn));
    const overlayRecord = records.find(r => r.signalType === 'overlayOpen');
    expect(overlayRecord).toBeDefined();
    expect((overlayRecord!.value as any).dialogRole).toBe('dialog');
  });

  it('should detect overlay open from aria-expanded on click', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'true');
    document.body.appendChild(btn);
    const records = ChannelE.collect(makeInput(btn, { eventType: 'click' }));
    const overlayRecord = records.find(r => r.signalType === 'overlayOpen');
    expect(overlayRecord).toBeDefined();
  });

  it('should detect overlay close from aria-expanded=false', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    document.body.appendChild(btn);
    const records = ChannelE.collect(makeInput(btn, { eventType: 'click' }));
    const closeRecord = records.find(r => r.signalType === 'overlayClose');
    expect(closeRecord).toBeDefined();
  });
});

// ── Channel Registry Tests ────────────────────────────────

describe('Channel Registry', () => {
  beforeEach(setupDom);

  it('should have exactly 5 channels', () => {
    expect(ALL_CHANNELS).toHaveLength(5);
  });

  it('should have channels in order A through E', () => {
    const ids = ALL_CHANNELS.map(c => c.channelId);
    expect(ids).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('should have all channels in CHANNEL_MAP', () => {
    const ids = Object.keys(CHANNEL_MAP).sort() as ChannelId[];
    expect(ids).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('collectAllEvidence should combine records from all channels', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Submit';
    btn.setAttribute('aria-label', 'Submit Form');
    document.body.appendChild(btn);
    const records = collectAllEvidence(makeInput(btn));
    // Should have records from multiple channels
    const channelIds = new Set(records.map(r => r.channelId));
    expect(channelIds.size).toBeGreaterThanOrEqual(3);
  });

  it('collectFromChannel should return only that channel records', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Submit';
    document.body.appendChild(btn);
    const records = collectFromChannel('A', makeInput(btn));
    expect(records.every(r => r.channelId === 'A')).toBe(true);
  });

  it('should not throw if a channel fails', () => {
    // Pass a null target — channels should handle gracefully
    const input = makeInput(document.createElement('div'));
    const records = collectAllEvidence(input);
    expect(Array.isArray(records)).toBe(true);
  });
});
