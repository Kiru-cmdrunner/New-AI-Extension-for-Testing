/**
 * Window & Frame — Browser Alert, New Tab, New Window, Iframe Detection Tests
 *
 * Validates detection, metadata extraction, and timeline phrasing for all
 * four Window & Frame interaction types. Also validates regression —
 * Navigation, Modal/Drawer/Popover, Link, and Click detection remain
 * unaffected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import { detectInteractions } from '../../src/classifier/interaction-detector.js';
import { COMMIT_THRESHOLD } from '../../src/classifier/evidence/combination.js';
import { actionDescription } from '../../src/sidepanel/timeline-renderer.js';
import type { DetectedInteraction } from '../../src/classifier/interaction-types.js';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  domContext,
} from './helpers.js';

const MIN_CONFIDENCE = COMMIT_THRESHOLD;

/** Helper: find an interaction of a specific type from results. */
function findType(result: DetectedInteraction[], type: string): DetectedInteraction | undefined {
  return result.find(r => r.type === type);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BROWSER ALERT — ALERT / CONFIRM / PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

describe('BrowserAlert — Detection', () => {
  beforeEach(() => resetEventCounter());

  describe('V2 Evidence Engine', () => {
    it('alert dialog → BrowserAlert with message', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Delete',
        cssSelector: 'button#delete',
      });
      const ctx = domContext({
        triggeredDialog: 'alert',
        dialogMessage: 'Are you sure?',
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: ctx }),
      ]);

      const alert = findType(result, 'BrowserAlert');
      expect(alert).toBeDefined();
      expect(alert!.metadata.dialogType).toBe('alert');
      expect(alert!.metadata.dialogMessage).toBe('Are you sure?');
      expect(alert!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    });

    it('confirm dialog → BrowserAlert with message and result', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Confirm',
        cssSelector: 'button#confirm',
      });
      const ctx = domContext({
        triggeredDialog: 'confirm',
        dialogMessage: 'Delete this item?',
        dialogResult: 'OK',
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: ctx }),
      ]);

      const alert = findType(result, 'BrowserAlert');
      expect(alert).toBeDefined();
      expect(alert!.metadata.dialogType).toBe('confirm');
      expect(alert!.metadata.dialogMessage).toBe('Delete this item?');
      expect(alert!.metadata.dialogResult).toBe('OK');
    });

    it('prompt dialog → BrowserAlert with message and result', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Enter Name',
        cssSelector: 'button#prompt',
      });
      const ctx = domContext({
        triggeredDialog: 'prompt',
        dialogMessage: 'Enter your name:',
        dialogResult: 'John Doe',
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: ctx }),
      ]);

      const alert = findType(result, 'BrowserAlert');
      expect(alert).toBeDefined();
      expect(alert!.metadata.dialogType).toBe('prompt');
      expect(alert!.metadata.dialogMessage).toBe('Enter your name:');
      expect(alert!.metadata.dialogResult).toBe('John Doe');
    });

    it('prompt dialog with Cancel → BrowserAlert', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Ask',
        cssSelector: 'button#ask',
      });
      const ctx = domContext({
        triggeredDialog: 'prompt',
        dialogMessage: 'Enter value:',
        dialogResult: 'Cancelled',
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: ctx }),
      ]);

      const alert = findType(result, 'BrowserAlert');
      expect(alert).toBeDefined();
      expect(alert!.metadata.dialogResult).toBe('Cancelled');
    });

    it('alert dialog NOT classified as Click or Modal', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Alert Me',
        cssSelector: 'button#alert-me',
      });
      const ctx = domContext({
        triggeredDialog: 'alert',
        dialogMessage: 'Warning!',
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: ctx }),
      ]);

      const click = findType(result, 'Click');
      const modal = findType(result, 'Modal');
      expect(click).toBeUndefined();
      expect(modal).toBeUndefined();
    });
  });

  describe('V1 Interaction Detector', () => {
    it('alert dialog → BrowserAlert', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Delete',
        cssSelector: 'button#delete',
      });
      const ctx = domContext({
        triggeredDialog: 'alert',
        dialogMessage: 'Item deleted!',
      });

      const result = detectInteractions([
        clickEvent(button, { domContext: ctx }),
      ]);

      const alert = findType(result, 'BrowserAlert');
      expect(alert).toBeDefined();
      expect(alert!.metadata.dialogType).toBe('alert');
      expect(alert!.metadata.dialogMessage).toBe('Item deleted!');
    });

    it('confirm dialog → BrowserAlert in V1', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Save',
        cssSelector: 'button#save',
      });
      const ctx = domContext({
        triggeredDialog: 'confirm',
        dialogMessage: 'Save changes?',
        dialogResult: 'Cancel',
      });

      const result = detectInteractions([
        clickEvent(button, { domContext: ctx }),
      ]);

      const alert = findType(result, 'BrowserAlert');
      expect(alert).toBeDefined();
      expect(alert!.metadata.dialogType).toBe('confirm');
      expect(alert!.metadata.dialogResult).toBe('Cancel');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. NEW TAB — TARGET=_BLANK AND WINDOW.OPEN
// ═══════════════════════════════════════════════════════════════════════════════

describe('NewTab — Detection', () => {
  beforeEach(() => resetEventCounter());

  describe('V2 Evidence Engine', () => {
    it('target=_blank → NewTab with URL', () => {
      const link = makeTarget({
        tag: 'A', accessibleName: 'Open in Tab',
        cssSelector: 'a#new-tab-link',
      });
      const ctx = domContext({
        opensNewTab: true,
        openedUrl: 'https://example.com/page',
      });

      const result = detectInteractionsV2([
        clickEvent(link, { domContext: ctx }),
      ]);

      const newTab = findType(result, 'NewTab');
      expect(newTab).toBeDefined();
      expect(newTab!.metadata.openedUrl).toBe('https://example.com/page');
    });

    it('NewTab NOT classified as Link or Click', () => {
      const link = makeTarget({
        tag: 'A', accessibleName: 'External',
        cssSelector: 'a#external',
      });
      const ctx = domContext({
        opensNewTab: true,
        openedUrl: 'https://external.com',
      });

      const result = detectInteractionsV2([
        clickEvent(link, { domContext: ctx }),
      ]);

      const linkResult = findType(result, 'Link');
      const click = findType(result, 'Click');
      expect(linkResult).toBeUndefined();
      expect(click).toBeUndefined();
    });

    it('window.open without features → NewTab', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Open Popup',
        cssSelector: 'button#open-popup',
      });
      const ctx = domContext({
        opensNewTab: true,
        openedUrl: 'https://popup.com',
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: ctx }),
      ]);

      const newTab = findType(result, 'NewTab');
      expect(newTab).toBeDefined();
    });
  });

  describe('V1 Interaction Detector', () => {
    it('target=_blank → NewTab', () => {
      const link = makeTarget({
        tag: 'A', accessibleName: 'New Tab',
        cssSelector: 'a#nt',
      });
      const ctx = domContext({
        opensNewTab: true,
        openedUrl: 'https://example.com',
      });

      const result = detectInteractions([
        clickEvent(link, { domContext: ctx }),
      ]);

      const newTab = findType(result, 'NewTab');
      expect(newTab).toBeDefined();
      expect(newTab!.metadata.openedUrl).toBe('https://example.com');
    });

    it('NewTab NOT classified as Link in V1', () => {
      const link = makeTarget({
        tag: 'A', accessibleName: 'Tab Link',
        cssSelector: 'a#tl',
      });
      const ctx = domContext({
        opensNewTab: true,
        openedUrl: 'https://example.com',
      });

      const result = detectInteractions([
        clickEvent(link, { domContext: ctx }),
      ]);

      const linkResult = findType(result, 'Link');
      expect(linkResult).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. NEW WINDOW — WINDOW.OPEN WITH FEATURES
// ═══════════════════════════════════════════════════════════════════════════════

describe('NewWindow — Detection', () => {
  beforeEach(() => resetEventCounter());

  describe('V2 Evidence Engine', () => {
    it('window.open with width/height → NewWindow', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Open Window',
        cssSelector: 'button#open-win',
      });
      const ctx = domContext({
        opensNewWindow: true,
        openedUrl: 'https://popup.example.com',
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: ctx }),
      ]);

      const newWin = findType(result, 'NewWindow');
      expect(newWin).toBeDefined();
      expect(newWin!.metadata.openedUrl).toBe('https://popup.example.com');
    });

    it('NewWindow NOT classified as NewTab', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Popup',
        cssSelector: 'button#popup',
      });
      const ctx = domContext({
        opensNewWindow: true,
        openedUrl: 'https://popup.com',
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: ctx }),
      ]);

      const newTab = findType(result, 'NewTab');
      expect(newTab).toBeUndefined();
    });
  });

  describe('V1 Interaction Detector', () => {
    it('window.open with features → NewWindow', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Open',
        cssSelector: 'button#open',
      });
      const ctx = domContext({
        opensNewWindow: true,
        openedUrl: 'https://window.example.com',
      });

      const result = detectInteractions([
        clickEvent(button, { domContext: ctx }),
      ]);

      const newWin = findType(result, 'NewWindow');
      expect(newWin).toBeDefined();
      expect(newWin!.metadata.openedUrl).toBe('https://window.example.com');
    });

    it('NewWindow NOT classified as NewTab or Click in V1', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Win',
        cssSelector: 'button#win',
      });
      const ctx = domContext({
        opensNewWindow: true,
        openedUrl: 'https://example.com',
      });

      const result = detectInteractions([
        clickEvent(button, { domContext: ctx }),
      ]);

      const newTab = findType(result, 'NewTab');
      const click = findType(result, 'Click');
      expect(newTab).toBeUndefined();
      expect(click).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. IFRAME — ENRICHMENT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Iframe — Enrichment', () => {
  beforeEach(() => resetEventCounter());

  describe('V1 Interaction Detector', () => {
    it('Click inside iframe → Click with iframe metadata', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Submit',
        cssSelector: 'button#submit',
        inIframe: true,
        iframeContext: {
          frameSrc: 'https://embed.example.com/form',
          frameName: 'form-frame',
          frameId: 'form-iframe',
          frameSelector: 'iframe#form-iframe',
          frameXPath: '/html/body/iframe',
          frameIndex: 0,
          frameDepth: 1,
        },
      });

      const result = detectInteractions([
        clickEvent(button, { domContext: domContext() }),
      ]);

      const click = findType(result, 'Click');
      expect(click).toBeDefined();
      expect(click!.metadata.iframeSrc).toBe('https://embed.example.com/form');
      expect(click!.metadata.iframeName).toBe('form-frame');
      expect(click!.metadata.iframeDepth).toBe(1);
    });

    it('Iframe enrichment does NOT change interaction type', () => {
      const checkbox = makeTarget({
        tag: 'INPUT', accessibleName: 'Agree',
        ariaRole: 'checkbox',
        cssSelector: 'input#agree',
        inIframe: true,
        iframeContext: {
          frameSrc: 'https://embed.example.com',
          frameName: 'content',
          frameId: null,
          frameSelector: null,
          frameXPath: null,
          frameIndex: null,
          frameDepth: 1,
        },
      });

      const result = detectInteractions([
        clickEvent(checkbox, {
          checkedAfter: true,
          domContext: domContext({ inputType: 'checkbox' }),
        }),
      ]);

      const checkboxResult = findType(result, 'Checkbox');
      expect(checkboxResult).toBeDefined();
      expect(checkboxResult!.metadata.iframeSrc).toBe('https://embed.example.com');
    });

    it('Top-level interaction has no iframe metadata', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Submit',
        cssSelector: 'button#submit',
        inIframe: false,
      });

      const result = detectInteractions([
        clickEvent(button, { domContext: domContext() }),
      ]);

      const click = findType(result, 'Click');
      expect(click).toBeDefined();
      expect(click!.metadata.iframeSrc).toBeUndefined();
      expect(click!.metadata.iframeName).toBeUndefined();
    });
  });

  describe('V2 Evidence Engine', () => {
    it('V2: Click inside iframe → Click with iframe metadata', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Submit',
        cssSelector: 'button#submit',
        inIframe: true,
        iframeContext: {
          frameSrc: 'https://embed.example.com/form',
          frameName: 'form-frame',
          frameId: 'form-iframe',
          frameSelector: 'iframe#form-iframe',
          frameXPath: '/html/body/iframe',
          frameIndex: 0,
          frameDepth: 1,
        },
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: domContext() }),
      ]);

      const click = findType(result, 'Click');
      expect(click).toBeDefined();
      expect(click!.metadata.iframeSrc).toBe('https://embed.example.com/form');
      expect(click!.metadata.iframeName).toBe('form-frame');
      expect(click!.metadata.iframeDepth).toBe(1);
    });

    it('V2: iframe enrichment does NOT change interaction type', () => {
      const checkbox = makeTarget({
        tag: 'INPUT', accessibleName: 'Agree',
        ariaRole: 'checkbox',
        cssSelector: 'input#agree',
        inIframe: true,
        iframeContext: {
          frameSrc: 'https://embed.example.com',
          frameName: 'content',
          frameId: null,
          frameSelector: null,
          frameXPath: null,
          frameIndex: null,
          frameDepth: 1,
        },
      });

      const result = detectInteractionsV2([
        clickEvent(checkbox, {
          checkedAfter: true,
          domContext: domContext({ inputType: 'checkbox' }),
        }),
      ]);

      const cb = findType(result, 'Checkbox');
      expect(cb).toBeDefined();
      expect(cb!.metadata.iframeSrc).toBe('https://embed.example.com');
      expect(cb!.metadata.iframeName).toBe('content');
    });

    it('V2: top-level interaction has no iframe metadata', () => {
      const button = makeTarget({
        tag: 'BUTTON', accessibleName: 'Submit',
        cssSelector: 'button#submit',
        inIframe: false,
      });

      const result = detectInteractionsV2([
        clickEvent(button, { domContext: domContext() }),
      ]);

      const click = findType(result, 'Click');
      expect(click).toBeDefined();
      expect(click!.metadata.iframeSrc).toBeUndefined();
      expect(click!.metadata.iframeName).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TIMELINE PHRASING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Timeline Phrasing', () => {
  function makeInteraction(
    type: string,
    metadata: Record<string, unknown>,
    targetName = '',
  ): DetectedInteraction {
    return {
      interactionId: 'test-1',
      type: type as any,
      eventIds: ['evt-0001'],
      rawEventTypes: ['click'],
      target: makeTarget({ accessibleName: targetName }),
      metadata: metadata as any,
      confidence: 0.9,
    };
  }

  describe('BrowserAlert phrasing', () => {
    it('alert → Alert dialog "X" appeared', () => {
      const interaction = makeInteraction('BrowserAlert', {
        dialogType: 'alert',
        dialogMessage: 'Warning!',
      });
      expect(actionDescription(interaction)).toBe('Alert dialog "Warning!" appeared');
    });

    it('confirm → Confirm dialog "X" appeared', () => {
      const interaction = makeInteraction('BrowserAlert', {
        dialogType: 'confirm',
        dialogMessage: 'Delete?',
      });
      expect(actionDescription(interaction)).toBe('Confirm dialog "Delete?" appeared');
    });

    it('prompt → Prompt dialog "X" appeared', () => {
      const interaction = makeInteraction('BrowserAlert', {
        dialogType: 'prompt',
        dialogMessage: 'Enter name:',
      });
      expect(actionDescription(interaction)).toBe('Prompt dialog "Enter name:" appeared');
    });

    it('alert without message → Alert dialog appeared', () => {
      const interaction = makeInteraction('BrowserAlert', {
        dialogType: 'alert',
      });
      expect(actionDescription(interaction)).toBe('Alert dialog appeared');
    });
  });

  describe('NewTab phrasing', () => {
    it('with URL → Open "url" in new tab', () => {
      const interaction = makeInteraction('NewTab', {
        openedUrl: 'https://example.com',
      });
      expect(actionDescription(interaction)).toBe('Open "https://example.com" in new tab');
    });

    it('without URL → Open new tab', () => {
      const interaction = makeInteraction('NewTab', {});
      expect(actionDescription(interaction)).toBe('Open new tab');
    });
  });

  describe('NewWindow phrasing', () => {
    it('with URL → Open "url" in new window', () => {
      const interaction = makeInteraction('NewWindow', {
        openedUrl: 'https://popup.example.com',
      });
      expect(actionDescription(interaction)).toBe('Open "https://popup.example.com" in new window');
    });

    it('without URL → Open new window', () => {
      const interaction = makeInteraction('NewWindow', {});
      expect(actionDescription(interaction)).toBe('Open new window');
    });
  });

  describe('Iframe enrichment in phrasing', () => {
    it('Click inside iframe → Click "X" (in frame-name)', () => {
      const interaction = makeInteraction('Click', {
        iframeSrc: 'https://embed.example.com',
        iframeName: 'content-frame',
      }, 'Submit');
      expect(actionDescription(interaction)).toBe('Click "Submit" (in content-frame)');
    });

    it('Click inside iframe without name → Click "X" (in iframe)', () => {
      const interaction = makeInteraction('Click', {
        iframeSrc: 'https://embed.example.com',
      }, 'Submit');
      expect(actionDescription(interaction)).toBe('Click "Submit" (in iframe)');
    });

    it('Top-level Click has no iframe suffix', () => {
      const interaction = makeInteraction('Click', {}, 'Submit');
      expect(actionDescription(interaction)).toBe('Click "Submit"');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. REGRESSION — NAVIGATION, DIALOGS, LINK, CLICK
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression — Existing Types Unaffected', () => {
  beforeEach(() => resetEventCounter());

  it('regular link click (no target=_blank) → Link (NOT NewTab)', () => {
    const link = makeTarget({
      tag: 'A', accessibleName: 'About Us',
      cssSelector: 'a#about',
    });

    const result = detectInteractionsV2([
      clickEvent(link, { domContext: domContext() }),
    ]);

    const linkResult = findType(result, 'Link');
    const newTab = findType(result, 'NewTab');
    expect(linkResult).toBeDefined();
    expect(newTab).toBeUndefined();
  });

  it('plain button click (no dialog, no new tab) → Click', () => {
    const button = makeTarget({
      tag: 'BUTTON', accessibleName: 'Submit',
      cssSelector: 'button#submit',
    });

    const result = detectInteractionsV2([
      clickEvent(button, { domContext: domContext() }),
    ]);

    const click = findType(result, 'Click');
    const alert = findType(result, 'BrowserAlert');
    const newTab = findType(result, 'NewTab');
    expect(click).toBeDefined();
    expect(alert).toBeUndefined();
    expect(newTab).toBeUndefined();
  });

  it('V1: regular link → Link (NOT NewTab)', () => {
    const link = makeTarget({
      tag: 'A', accessibleName: 'Home',
      cssSelector: 'a#home',
    });

    const result = detectInteractions([
      clickEvent(link, { domContext: domContext() }),
    ]);

    const linkResult = findType(result, 'Link');
    const newTab = findType(result, 'NewTab');
    expect(linkResult).toBeDefined();
    expect(newTab).toBeUndefined();
  });

  it('V1: plain button → Click (NOT BrowserAlert or NewTab)', () => {
    const button = makeTarget({
      tag: 'BUTTON', accessibleName: 'Save',
      cssSelector: 'button#save',
    });

    const result = detectInteractions([
      clickEvent(button, { domContext: domContext() }),
    ]);

    const click = findType(result, 'Click');
    const alert = findType(result, 'BrowserAlert');
    const newTab = findType(result, 'NewTab');
    expect(click).toBeDefined();
    expect(alert).toBeUndefined();
    expect(newTab).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. FULL WORKFLOW — MIXED WINDOW & FRAME INTERACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full Window & Frame Workflow', () => {
  beforeEach(() => resetEventCounter());

  it('Mixed: BrowserAlert + NewTab + Click in sequence', () => {
    const alertBtn = makeTarget({
      tag: 'BUTTON', accessibleName: 'Delete',
      cssSelector: 'button#delete',
    });
    const newTabLink = makeTarget({
      tag: 'A', accessibleName: 'Help',
      cssSelector: 'a#help',
    });
    const normalBtn = makeTarget({
      tag: 'BUTTON', accessibleName: 'Save',
      cssSelector: 'button#save',
    });

    const result = detectInteractionsV2([
      clickEvent(alertBtn, {
        domContext: domContext({
          triggeredDialog: 'confirm',
          dialogMessage: 'Delete?',
          dialogResult: 'OK',
        }),
      }),
      clickEvent(newTabLink, {
        domContext: domContext({
          opensNewTab: true,
          openedUrl: 'https://help.example.com',
        }),
      }),
      clickEvent(normalBtn, { domContext: domContext() }),
    ]);

    const alert = findType(result, 'BrowserAlert');
    const newTab = findType(result, 'NewTab');
    const click = findType(result, 'Click');

    expect(alert).toBeDefined();
    expect(newTab).toBeDefined();
    expect(click).toBeDefined();

    // Distinct event IDs
    expect(alert!.eventIds).not.toEqual(newTab!.eventIds);
    expect(newTab!.eventIds).not.toEqual(click!.eventIds);
  });
});
