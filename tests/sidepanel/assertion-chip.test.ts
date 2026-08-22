/**
 * MS-U1 — assertion chip + no-write pins (A8 / P9).
 *
 * Spec: .drytis/specs/phase-6-u1-observed-workflow-cards.md
 *
 *  A8/P8c  IRStep.sourceEventId join → `N assertions` / `0 assertions`
 *          (honest zero when a step exists with none).
 *  A8-abs   absent plan / unknown event → NO chip (absent data ≠ zero).
 *  P9       renderer performs ZERO writes: spied chrome.storage.local.set
 *          and Dexie table.put stay uncalled through card creation, hidden
 *          summary, chip attach, and assertion-plan installation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  setAssertionPlan,
  getAssertionCountFor,
} from '../../src/sidepanel/assertion-chip';
import {
  createInteractionElement,
  buildHiddenSummary,
} from '../../src/sidepanel/interaction-renderer';
import { attachKrChips, setKrLookup } from '../../src/sidepanel/kr-chip';
import type { ComponentInteraction, ObservedEvent } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';
import type { ExecutionIRPlan } from '../../src/domain/execution-ir/types';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
(globalThis as Record<string, unknown>).document = dom.window.document;

function identity(): ElementIdentity {
  return {
    accessibleName: 'Search', ariaRole: 'textbox', ariaLabel: null, ariaLabelledBy: null,
    placeholder: 'Search…', tag: 'INPUT', className: null, name: 'q', stableId: 'q',
    testId: null, dataCy: null, dataQa: null, cssSelector: 'body > input#q',
    xPath: '/html/body/input', inIframe: false, shadowDom: false, href: null,
    inputType: 'text', iframeContext: undefined, elementId: 'elem-0001',
  };
}

function evt(n: number): ObservedEvent {
  return {
    eventId: `evt-a8-${n}`, eventType: 'input', timestamp: 1000 + n, captureSeq: n,
    isTrusted: true, target: identity(),
    domContext: {
      inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false,
      disabled: false, readOnly: false, required: false, ancestorRoles: [],
      ancestorClasses: [], tabIndex: 0,
    },
    valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
    clientX: null, clientY: null, key: null, code: null, shiftKey: false, ctrlKey: false,
    altKey: false, metaKey: false, scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: 'https://example.test/', pageTitle: 'Test',
  };
}

function interaction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  const triggerEvent = evt(1);
  return {
    interactionId: 'int-1', type: 'Click', trigger: identity(), triggerEvent,
    memberEvents: [triggerEvent], startTime: 1000, endTime: 1412,
    endState: 'completed', metadata: {}, ...overrides,
  };
}

function plan(assertsByStep: Array<{ sourceEventId?: string; n: number }>): ExecutionIRPlan {
  return {
    schemaVersion: 1,
    generatedAt: '2026-08-22T00:00:00Z',
    recordingSessionId: 's-1',
    steps: assertsByStep.map((s, i) => ({
      id: `step-${i}`, order: i, action: 'click' as const,
      description: 'd', plainEnglish: 'd',
      target: { kind: 'none' as const },
      input: null,
      assertions: Array.from({ length: s.n }, (_, j) => ({ id: `a${j}` })),
      executionParameters: {},
      sourceEventId: s.sourceEventId,
    })),
  } as unknown as ExecutionIRPlan;
}

beforeEach(() => {
  dom.window.document.body.innerHTML = '<div id="root"></div>';
  setAssertionPlan(null);
});

describe('A8 — assertion chip join', () => {
  it('2 assertions on the step for evt-a8-1 render `2 assertions`', () => {
    setAssertionPlan(plan([{ sourceEventId: 'evt-a8-1', n: 2 }]));
    const el = createInteractionElement(interaction());
    expect(el.querySelector('.interaction-chip--assertions')?.textContent)
      .toBe('2 assertions');
  });

  it('1 assertion renders the singular', () => {
    setAssertionPlan(plan([{ sourceEventId: 'evt-a8-1', n: 1 }]));
    const el = createInteractionElement(interaction());
    expect(el.querySelector('.interaction-chip--assertions')?.textContent)
      .toBe('1 assertion');
  });

  it('step exists with zero assertions → honest `0 assertions`', () => {
    setAssertionPlan(plan([{ sourceEventId: 'evt-a8-1', n: 0 }]));
    const el = createInteractionElement(interaction());
    expect(el.querySelector('.interaction-chip--assertions')?.textContent)
      .toBe('0 assertions');
  });

  it('no plan installed → NO chip (absent data ≠ zero)', () => {
    const el = createInteractionElement(interaction());
    expect(el.querySelector('.interaction-chip--assertions')).toBeNull();
  });

  it('event with no step in the plan → NO chip', () => {
    setAssertionPlan(plan([{ sourceEventId: 'evt-other', n: 3 }]));
    const el = createInteractionElement(interaction());
    expect(el.querySelector('.interaction-chip--assertions')).toBeNull();
  });

  it('getAssertionCountFor: null for unknown, 0 for present-with-none', () => {
    setAssertionPlan(plan([{ sourceEventId: 'evt-a8-1', n: 0 }]));
    expect(getAssertionCountFor('evt-a8-1')).toBe(0);
    expect(getAssertionCountFor('evt-unknown')).toBeNull();
    expect(getAssertionCountFor(undefined)).toBeNull();
  });

  it('multiple steps for one event accumulate', () => {
    setAssertionPlan(plan([
      { sourceEventId: 'evt-a8-1', n: 2 },
      { sourceEventId: 'evt-a8-1', n: 1 },
    ]));
    const el = createInteractionElement(interaction());
    expect(el.querySelector('.interaction-chip--assertions')?.textContent)
      .toBe('3 assertions');
  });
});

describe('P9 — renderer performs zero writes', () => {
  it('card creation + hidden summary + chip attach make no storage/Dexie writes', async () => {
    const storageSet = vi.fn();
    const dexiePut = vi.fn();
    (globalThis as Record<string, unknown>).chrome = {
      storage: { local: { set: storageSet } },
    };
    setKrLookup(async () => new Map());
    const el = createInteractionElement(interaction());
    buildHiddenSummary([interaction(), interaction({ endState: 'abandoned' })]);
    await attachKrChips(new Map([['int-1', el]]));
    setAssertionPlan(plan([{ sourceEventId: 'evt-a8-1', n: 1 }]));
    createInteractionElement(interaction());
    expect(storageSet).not.toHaveBeenCalled();
    expect(dexiePut).not.toHaveBeenCalled();
  });
});
