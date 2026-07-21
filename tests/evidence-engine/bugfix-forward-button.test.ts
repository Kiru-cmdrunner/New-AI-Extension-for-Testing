/**
 * Tests for Bug Fixes: Forward Navigation + role=button Dead Code
 *
 * Bug 1: V2 engine never emitted Forward navigation type.
 * Bug 2: role=button was not in ROLE_TYPE_MAP, so:
 *   - Button clicks got no AriaProvider evidence
 *   - Button with aria-pressed never detected as ToggleSwitch
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.ts';
import { AriaProvider } from '../../src/classifier/evidence/providers/aria-provider.ts';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  navigationEvent,
} from './helpers.ts';

describe('Bug Fix 1: Forward Navigation Detection', () => {
  beforeEach(() => resetEventCounter());

  it('detects forward navigation with transitionType="forward"', () => {
    const events = [navigationEvent('https://example.com/next', 'Next', 'forward')];
    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Forward');
    expect(result[0].confidence).toBe(1.0);
  });

  it('detects back navigation with transitionType="forward_back" (Chrome actual value)', () => {
    // Chrome's webNavigation API reports BOTH back and forward as 'forward_back'.
    // V1 normalizes: forward → 'forward', back stays as 'forward_back'.
    // V2 must classify 'forward_back' as Back, NOT Forward.
    const events = [navigationEvent('https://example.com/prev', 'Prev', 'forward_back')];
    const result = detectInteractionsV2(events);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Back');
    expect(result[0].type).not.toBe('Forward');
  });

  it('detects back navigation with transitionType="back"', () => {
    const events = [navigationEvent('https://example.com/prev', 'Prev', 'back')];
    const result = detectInteractionsV2(events);
    expect(result[0].type).toBe('Back');
  });

  it('still detects back as Back (no regression)', () => {
    const events = [navigationEvent('https://example.com/prev', 'Prev', 'back')];
    const result = detectInteractionsV2(events);
    expect(result[0].type).toBe('Back');
  });

  it('still detects reload as Refresh (no regression)', () => {
    const events = [navigationEvent('https://example.com/page', 'Page', 'reload')];
    const result = detectInteractionsV2(events);
    expect(result[0].type).toBe('Refresh');
  });

  it('default navigation is PageNavigation (no regression)', () => {
    const events = [navigationEvent('https://example.com/new', 'New', 'link')];
    const result = detectInteractionsV2(events);
    expect(result[0].type).toBe('PageNavigation');
  });
});

describe('Bug Fix 2: role=button Click + ToggleSwitch Detection', () => {
  beforeEach(() => resetEventCounter());

  describe('AriaProvider direct tests', () => {
    const provider = new AriaProvider();
    const emptyBuffer = {
      events: [],
      startTime: Date.now(),
      endTime: Date.now(),
    };

    it('emits Click evidence for role=button without aria-pressed', () => {
      const event = clickEvent({
        tag: 'DIV',
        ariaRole: 'button',
        accessibleName: 'Submit',
      });
      const evidence = provider.onEvent(event, emptyBuffer);
      const clickEv = evidence.find(e => e.suggestedType === 'Click');
      expect(clickEv).toBeDefined();
      expect(clickEv!.confidence).toBe(0.85);
      expect(clickEv!.reason).toContain('button');
    });

    it('emits ToggleSwitch for role=button with aria-pressed (via checkedAfter)', () => {
      const event = clickEvent(
        {
          tag: 'DIV',
          ariaRole: 'button',
          cssSelector: 'div[role="button"][aria-pressed="true"]',
        },
        { checkedAfter: true },
      );
      const evidence = provider.onEvent(event, emptyBuffer);
      const toggleEv = evidence.find(e => e.suggestedType === 'ToggleSwitch');
      expect(toggleEv).toBeDefined();
      expect(toggleEv!.confidence).toBe(0.85);
      expect(toggleEv!.metadata.checked).toBe(true);
      // Should NOT also emit Click
      const clickEv = evidence.find(e => e.suggestedType === 'Click');
      expect(clickEv).toBeUndefined();
    });

    it('emits ToggleSwitch for role=button with aria-pressed=false', () => {
      const event = clickEvent(
        {
          tag: 'DIV',
          ariaRole: 'button',
          cssSelector: 'div[role="button"][aria-pressed="false"]',
        },
        { checkedAfter: false },
      );
      const evidence = provider.onEvent(event, emptyBuffer);
      const toggleEv = evidence.find(e => e.suggestedType === 'ToggleSwitch');
      expect(toggleEv).toBeDefined();
      expect(toggleEv!.metadata.checked).toBe(false);
    });

    it('emits ToggleSwitch for role=button via cssSelector aria-pressed only', () => {
      const event = clickEvent({
        tag: 'DIV',
        ariaRole: 'button',
        cssSelector: 'button[aria-pressed="true"]',
      });
      const evidence = provider.onEvent(event, emptyBuffer);
      const toggleEv = evidence.find(e => e.suggestedType === 'ToggleSwitch');
      expect(toggleEv).toBeDefined();
    });

    it('emits ToggleSwitch for role=switch with aria-pressed (no regression)', () => {
      const event = clickEvent(
        {
          tag: 'DIV',
          ariaRole: 'switch',
          cssSelector: 'div[role="switch"][aria-pressed="true"]',
        },
        { checkedAfter: true },
      );
      const evidence = provider.onEvent(event, emptyBuffer);
      const toggleEv = evidence.find(e => e.suggestedType === 'ToggleSwitch');
      expect(toggleEv).toBeDefined();
    });
  });

  describe('End-to-end V2 detection', () => {

    it('role=button click classified as Click by V2', () => {
      const events = [clickEvent({
        tag: 'DIV',
        ariaRole: 'button',
        accessibleName: 'Submit',
      })];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      // With AriaProvider + EventSequenceProvider both contributing,
      // confidence should be significantly higher than a single provider alone
      expect(result[0].confidence).toBeGreaterThan(0.7);
    });

    it('role=button with aria-pressed classified as ToggleSwitch by V2', () => {
      const events = [clickEvent(
        {
          tag: 'DIV',
          ariaRole: 'button',
          accessibleName: 'Dark mode',
          cssSelector: 'div[role="button"][aria-pressed="true"]',
        },
        { checkedAfter: true },
      )];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('ToggleSwitch');
      expect(result[0].metadata.checked).toBe(true);
    });
  });
});
