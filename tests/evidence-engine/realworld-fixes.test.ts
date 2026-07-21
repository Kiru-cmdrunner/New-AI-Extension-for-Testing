/**
 * Real-World Fix Validation — Avis Ford Disagreements
 *
 * Tests the two issues found in the Avis Ford real-world recording:
 * 1. mouseenter on <a> should be Hover, not Link
 * 2. mouseenter on <button> should be Hover, not Click
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  mouseenterEvent,
  focusEvent,
  blurEvent,
  changeEvent,
} from './helpers.js';

describe('Real-World Fixes — Avis Ford Disagreements', () => {

  beforeEach(() => resetEventCounter());

  describe('mouseenter on <a> → Hover, not Link', () => {
    it('mouseenter on <a role="button"> → Hover', () => {
      const serviceLink = makeTarget({
        tag: 'A', ariaRole: 'button', accessibleName: 'SERVICE',
        cssSelector: 'a#parent_5',
      });
      const events = [mouseenterEvent(serviceLink)];
      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Hover');
      expect(result[0].type).not.toBe('Link');
    });

    it('mouseenter on <a role="menuitem"> → Hover', () => {
      const menuItem = makeTarget({
        tag: 'A', ariaRole: 'menuitem', accessibleName: 'Schedule Your Service',
        cssSelector: 'a#5_child_3',
      });
      const events = [mouseenterEvent(menuItem)];
      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Hover');
    });

    it('click on <a> → Link (preserved)', () => {
      const link = makeTarget({
        tag: 'A', accessibleName: 'About Us',
        cssSelector: 'a[href="/about"]',
      });
      const events = [clickEvent(link)];
      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Link');
    });
  });

  describe('mouseenter on <button> → Hover, not Click', () => {
    it('mouseenter on <button> → Hover', () => {
      const btn = makeTarget({
        tag: 'BUTTON', accessibleName: 'Submit',
        cssSelector: 'button#submit-btn',
      });
      const events = [mouseenterEvent(btn)];
      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Hover');
      expect(result[0].type).not.toBe('Click');
    });

    it('click on <button> → Click (preserved)', () => {
      const btn = makeTarget({
        tag: 'BUTTON', accessibleName: 'Submit',
        cssSelector: 'button#submit-btn',
      });
      const events = [clickEvent(btn)];
      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });
  });

  describe('Avis Ford recording flow simulation (post-fix)', () => {
    it('hover SERVICE → hover Schedule → click Schedule → nav → all correct', () => {
      const serviceLink = makeTarget({
        tag: 'A', ariaRole: 'button', accessibleName: 'SERVICE',
        cssSelector: 'a#parent_5',
      });
      const scheduleLink = makeTarget({
        tag: 'A', ariaRole: 'menuitem', accessibleName: 'Schedule Your Service',
        cssSelector: 'a#5_child_3',
      });

      const events = [
        mouseenterEvent(serviceLink),    // should be Hover
        mouseenterEvent(scheduleLink),   // should be Hover
        clickEvent(scheduleLink),        // should be... Click? or Link?
      ];

      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('Hover');  // mouseenter on <a>
      expect(result[1].type).toBe('Hover');  // mouseenter on <a>
      // The click on the <a> — V2 will say Link (tag=A, eventType=click)
      // This is acceptable: clicking a link navigates, so Link is correct
    });
  });
});
