/**
 * D10 (audit D11) — navigation label quoting (side panel fallback renderer)
 *
 * The Observed Workflow card renders `interaction.businessMeaning ?? fallbackActionDescription(interaction)`.
 * When businessMeaning is absent, the Navigation fallback must be quote-safe:
 * a page title containing (or wrapped in) double quotes must not render as
 * nested/doubled quotes.
 *
 * Follows the jsdom pattern of tests/sidepanel/d4-assertion-availability.test.ts.
 * Spec: .drytis/specs/d10-nav-label-quoting.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderInteractions } from '../../src/sidepanel/interaction-renderer';
import type { ComponentInteraction } from '../../src/shared/component-types';

let domInitialized = false;

function setupDom(): void {
  if (domInitialized) {
    document.getElementById('detected-interactions-list')!.innerHTML = '';
    return;
  }
  domInitialized = true;
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../src/sidepanel/index.html'),
    'utf8',
  );
  const dom = new JSDOM(html, { url: 'chrome-extension://test-id/src/sidepanel/index.html' });
  const w = dom.window as unknown as typeof globalThis;
  (globalThis as Record<string, unknown>).document = w.document;
  (globalThis as Record<string, unknown>).window = w;
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage: async () => {},
      onMessage: { addListener: () => {} },
      getURL: (p: string) => `chrome-extension://test-id/${p}`,
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    tabs: { query: async () => [], create: async () => ({}) },
  };
}

function makeNavigation(pageTitle: string, pageUrl = 'https://example.com/x'): ComponentInteraction {
  const target = {
    accessibleName: pageUrl,
    ariaRole: 'document',
    ariaLabel: `Navigation to ${pageUrl}`,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'HTML',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'html',
    xPath: '/html',
    inIframe: false,
    shadowDom: false,
    href: pageUrl,
    inputType: null,
    elementId: '',
  };
  const triggerEvent = {
    eventId: 'evt-nav-1',
    eventType: 'navigation' as any,
    timestamp: 1000,
    captureSeq: 1,
    isTrusted: true,
    target,
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
      tabIndex: null,
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
    pageUrl,
    pageTitle,
  };
  return {
    interactionId: 'int-nav-1',
    type: 'Navigation',
    trigger: target,
    triggerEvent,
    memberEvents: [triggerEvent],
    startTime: 1000,
    endTime: 2000,
    endState: 'completed',
    metadata: {
      pageUrl,
      pageTitle,
    },
  };
}

function renderOne(interaction: ComponentInteraction): string {
  const container = document.getElementById('detected-interactions-list')!;
  container.innerHTML = '';
  renderInteractions(container, [interaction]);
  const el = container.querySelector('.interaction-action-text');
  return el ? (el.textContent ?? '') : '<missing>';
}

describe('D10: fallbackActionDescription — Navigation label quoting (side panel)', () => {
  beforeEach(() => setupDom());

  it('title containing double quotes renders single-quoted inside one pair', () => {
    expect(renderOne(makeNavigation('Results for "q"'))).toBe("Navigate to \"Results for 'q'\"");
  });

  it('pre-wrapped title does not double-wrap', () => {
    expect(renderOne(makeNavigation('"Dashboard"'))).toBe('Navigate to "Dashboard"');
  });

  it('repeatedly-wrapped title strips to the bare title', () => {
    expect(renderOne(makeNavigation('""Title""'))).toBe('Navigate to "Title"');
  });

  it('plain title keeps exactly one quote pair (regression guard)', () => {
    expect(renderOne(makeNavigation('Your Cart'))).toBe('Navigate to "Your Cart"');
  });

  it('empty title falls back to the unquoted URL (regression guard)', () => {
    expect(renderOne(makeNavigation(''))).toBe('Navigate to https://example.com/x');
  });

  it('no rendered label anywhere contains doubled quotes', () => {
    const container = document.getElementById('detected-interactions-list')!;
    container.innerHTML = '';
    renderInteractions(container, [
      makeNavigation('Results for "q"'),
      makeNavigation('"Dashboard"'),
      makeNavigation('""Title""'),
      makeNavigation('Your Cart'),
    ]);
    const labels = Array.from(container.querySelectorAll('.interaction-action-text')).map(
      (el) => el.textContent ?? '',
    );
    expect(labels).toHaveLength(4);
    for (const label of labels) {
      expect(label.includes('""')).toBe(false);
    }
  });
});
