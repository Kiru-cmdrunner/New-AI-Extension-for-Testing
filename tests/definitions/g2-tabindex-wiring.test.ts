/**
 * M0.5 G2 Tests — tabIndex Wiring
 *
 * Validates that tabIndex is now captured in DomContext, extracted from
 * the DOM, and wired through to Click/Hover definitions' isInteractiveElement
 * check. This recovers interactive elements that use tabindex="0" on non-tag
 * elements (div, span) which were previously silently dropped.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3
 * M0.5 Fix: G2 — tabIndex hardcoded null caused dead code in patterns.ts:82
 */

import { describe, it, expect } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: '',
    ...overrides,
  };
}

function makeContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
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
    ...overrides,
  };
}

function makeEvent(
  eventId: string,
  eventType: string,
  target: Partial<ElementIdentity>,
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType: eventType as any,
    target: makeTarget(target),
    domContext: makeContext(domContext),
    ...eventOverrides,
  });
}

function setupRuntime(): { runtime: ComponentRuntime; emitted: ComponentInteraction[]; ledger: EvidenceLedger } {
  const emitted: ComponentInteraction[] = [];
  const ledger = new EvidenceLedger();
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i), evidenceLedger: ledger };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted, ledger };
}

// ── G2 Unit Tests ────────────────────────────────────────────────────

describe('G2: tabIndex Wiring', () => {
  describe('DomContext tabIndex field', () => {
    it('tabIndex is present in DomContext type', () => {
      const ctx = makeContext({ tabIndex: 0 });
      expect(ctx.tabIndex).toBe(0);
    });

    it('tabIndex defaults to null', () => {
      const ctx = makeContext();
      expect(ctx.tabIndex).toBeNull();
    });

    it('tabIndex can be set to positive values', () => {
      const ctx = makeContext({ tabIndex: 3 });
      expect(ctx.tabIndex).toBe(3);
    });

    it('tabIndex can be set to -1 (programmatically focusable but not tab-reachable)', () => {
      const ctx = makeContext({ tabIndex: -1 });
      expect(ctx.tabIndex).toBe(-1);
    });
  });

  describe('Click definition uses tabIndex from DomContext', () => {
    it('captures click on div[tabindex=0] (was previously dropped)', () => {
      const { runtime, emitted } = setupRuntime();
      runtime.process(
        makeEvent('e1', 'click',
          { tag: 'DIV', accessibleName: 'Open Card', stableId: 'card-btn' },
          { tabIndex: 0 },
        ),
      );
      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe('Click');
      expect(emitted[0].metadata.targetName).toBe('Open Card');
    });

    it('captures click on span[tabindex=0]', () => {
      const { runtime, emitted } = setupRuntime();
      runtime.process(
        makeEvent('e1', 'click',
          { tag: 'SPAN', accessibleName: 'Toggle Panel', stableId: 'toggle-span' },
          { tabIndex: 0 },
        ),
      );
      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe('Click');
    });

    it('preserves bare div with tabIndex=null as Unclassified', () => {
      const { runtime, emitted, ledger } = setupRuntime();
      const event = makeEvent('e1', 'click',
        { tag: 'DIV', accessibleName: 'Container' },
        { tabIndex: null },
      );
      // M5: capture guarantee via Projection Engine
      ledger.append(event);
      runtime.process(event);
      runtime.flush();
      const result = projectInteractions(ledger, emitted).interactions;
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Unclassified');
    });

    it('preserves div[tabindex=-1] as Unclassified (not tab-reachable)', () => {
      const { runtime, emitted, ledger } = setupRuntime();
      const event = makeEvent('e1', 'click',
        { tag: 'DIV', accessibleName: 'Hidden Focus', stableId: 'hidden-focus' },
        { tabIndex: -1 },
      );
      // M5: capture guarantee via Projection Engine
      ledger.append(event);
      runtime.process(event);
      runtime.flush();
      const result = projectInteractions(ledger, emitted).interactions;
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Unclassified');
    });

    it('higher-priority definition still wins (Checkbox on div[tabindex=0] with role=checkbox)', () => {
      const { runtime, emitted } = setupRuntime();
      runtime.process(
        makeEvent('e1', 'click',
          { tag: 'DIV', ariaRole: 'checkbox', accessibleName: 'Agree', stableId: 'agree-check' },
          { tabIndex: 0 },
        ),
      );
      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe('Checkbox');
    });
  });

  describe('Integration: tabIndex recovers card-detail interactions', () => {
    it('click on card div[tabindex=0] with onclick → Click interaction', () => {
      const { runtime, emitted } = setupRuntime();

      // Simulate user clicking a card detail button
      runtime.process(
        makeEvent('e1', 'click',
          {
            tag: 'DIV',
            accessibleName: 'View Details',
            stableId: 'card-42',
            cssSelector: '.card.detail-trigger',
            className: 'card-detail',
          },
          { tabIndex: 0 },
        ),
      );

      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe('Click');
      expect(emitted[0].metadata.targetName).toBe('View Details');
      expect(emitted[0].trigger.stableId).toBe('card-42');
    });
  });
});
