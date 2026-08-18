/**
 * D10 (audit D11) — navigation label double-quoting regression tests.
 *
 * Audit symptom: `Navigate to ""Title""` — the Navigation template wraps
 * metadata.pageTitle in quotes without normalizing, so a title that itself
 * contains (or is wrapped in) quotes renders nested/doubled.
 *
 * Red phase: the quoted-title and pre-wrapped-title cases fail against the
 * unfixed template; plain and empty-title cases are regression guards.
 *
 * Architecture: .drytis/specs/d10-nav-label-quoting.md
 */

import { describe, it, expect } from 'vitest';
import { resolveMeaning } from '../../src/enrichment/meaning-resolver';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ComponentDetectionResult } from '../../src/enrichment/component-types';
import type { ObservedEvent } from '../../src/shared/component-types';

const GENERIC_DETECTION: ComponentDetectionResult = {
  componentType: 'Generic',
  componentFramework: 'Generic',
  businessMeaning: '',
  componentData: {},
};

function makeEvent(pageTitle: string, pageUrl: string): ObservedEvent {
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
  return {
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
}

function makeNavigation(pageTitle: string, pageUrl = 'https://example.com/x'): ComponentInteraction {
  const event = makeEvent(pageTitle, pageUrl);
  return {
    interactionId: 'int-nav-1',
    type: 'Navigation',
    trigger: event.target,
    triggerEvent: event,
    memberEvents: [event],
    startTime: 1000,
    endTime: 2000,
    endState: 'completed',
    metadata: {
      pageUrl,
      pageTitle,
    },
  };
}

describe('D10: resolveMeaning — Navigation label quoting', () => {
  it('title containing double quotes renders single-quoted inside one pair', () => {
    const meaning = resolveMeaning(makeNavigation('Results for "q"'), GENERIC_DETECTION);
    expect(meaning).toBe("Navigate to \"Results for 'q'\"");
  });

  it('pre-wrapped title does not double-wrap', () => {
    const meaning = resolveMeaning(makeNavigation('"Dashboard"'), GENERIC_DETECTION);
    expect(meaning).toBe('Navigate to "Dashboard"');
  });

  it('repeatedly-wrapped title strips to the bare title', () => {
    const meaning = resolveMeaning(makeNavigation('""Title""'), GENERIC_DETECTION);
    expect(meaning).toBe('Navigate to "Title"');
  });

  it('plain title keeps exactly one quote pair (regression guard)', () => {
    const meaning = resolveMeaning(makeNavigation('Your Cart'), GENERIC_DETECTION);
    expect(meaning).toBe('Navigate to "Your Cart"');
  });

  it('empty title falls back to the unquoted URL (regression guard)', () => {
    const meaning = resolveMeaning(makeNavigation(''), GENERIC_DETECTION);
    expect(meaning).toBe('Navigate to https://example.com/x');
  });

  it('whitespace-only title falls back to the unquoted URL', () => {
    const meaning = resolveMeaning(makeNavigation('   '), GENERIC_DETECTION);
    expect(meaning).toBe('Navigate to https://example.com/x');
  });

  it('breadcrumb meaning path is untouched (regression guard)', () => {
    const interaction = {
      ...makeNavigation('Home'),
      type: 'Click' as const,
      metadata: { targetName: 'Home' },
    };
    const breadcrumbDetection: ComponentDetectionResult = {
      componentType: 'Breadcrumb',
      componentFramework: 'AntDesign',
      businessMeaning: '',
      componentData: {},
    };
    expect(resolveMeaning(interaction, breadcrumbDetection)).toBe('Navigate to Home via breadcrumb');
  });
});
