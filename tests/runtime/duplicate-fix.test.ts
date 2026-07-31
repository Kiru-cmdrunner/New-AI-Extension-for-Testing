/**
 * Duplicate Interaction Fix Tests
 *
 * Three production bugs found from real-world Adani One recording:
 *
 * 1. DragDrop abandonment produces Click via downcast but doesn't set
 *    handled=true, so discovery re-discovers the same click as Link/RadioButton.
 *    Fix: set handled=true when abandonment+downcast emits an interaction.
 *
 * 2. Dropdown doesn't recognize aria-haspopup="dialog" or "true", so
 *    ModalDialog claims the Economy dropdown trigger instead.
 *    Fix: Dropdown's detectTrigger checks aria-haspopup="dialog"/"true" when
 *    the element also matches dropdown CSS-class patterns.
 *
 * 3. SURFACE_COMPAT prevents Dropdown from binding 'modal' surfaces, even
 *    when Dropdown correctly triggers on a dialog-rendered dropdown panel.
 *    Fix: SURFACE_COMPAT['Dropdown'] now includes 'modal'.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions/index';
import type {
  ComponentInteraction,
  ObservedEvent,
  DomContext,
  BrowserEventType,
} from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeTarget(o: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null,
    stableId: null, testId: null, dataCy: null, dataQa: null,
    cssSelector: 'div', xPath: '/html/body/div',
    inIframe: false, shadowDom: false, elementId: '',
    ...o,
  };
}

function makeDomContext(o: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [],
    surfaceId: null, surfaceType: null, surfaceRole: null, surfaceLabel: null,
    ...o,
  };
}

let evtCounter = 0;
function makeEvent(
  et: string, to: Partial<ElementIdentity> = {}, dc: Partial<DomContext> = {},
  ex: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: `evt-${++evtCounter}`, eventType: et as BrowserEventType,
    timestamp: Date.now() + evtCounter, isTrusted: true,
    target: makeTarget(to), domContext: makeDomContext(dc),
    valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
    clientX: null, clientY: null, key: null, code: null,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: 'https://example.com', pageTitle: 'Test',
    ...ex,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Fix 1: No duplicate Click + Link for same click', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('clicking a link produces ONE interaction, not Click + Link', () => {
    const linkTarget = {
      tag: 'A',
      accessibleName: 'Book Flight',
      ariaRole: 'link',
      stableId: 'book-flight-link',
      cssSelector: 'a.book-flight',
    };

    // mousedown fires first (DragDrop may claim it)
    runtime.process(makeEvent('mousedown', linkTarget));
    // click fires
    runtime.process(makeEvent('click', linkTarget));

    // Should produce exactly ONE interaction for the link click
    const links = emitted.filter(i => i.type === 'Link');
    const clicks = emitted.filter(i => i.type === 'Click');

    // Either a Link OR a Click, not both
    const total = emitted.length;
    expect(total).toBe(1);
  });

  it('clicking a custom radio-tile produces ONE interaction', () => {
    const radioTarget = {
      tag: 'DIV',
      accessibleName: 'Sort by Early Departure',
      className: 'radio-tile sort-option',
      ariaRole: null, // custom SPA radio, no ARIA role
      stableId: 'sort-early-dep',
      cssSelector: 'div.radio-tile.sort-option',
    };

    // mousedown → click sequence
    runtime.process(makeEvent('mousedown', radioTarget));
    runtime.process(makeEvent('click', radioTarget));

    // Should produce exactly ONE interaction
    expect(emitted.length).toBe(1);
  });
});

describe('Fix 2: Dropdown recognizes aria-haspopup="dialog"', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('triggers Dropdown (not ModalDialog) for aria-haspopup="dialog" with dropdown CSS classes', () => {
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Economy',
      className: 'fare-type dropdown-trigger',
      stableId: 'economy-trigger',
      cssSelector: 'div.fare-type',
    }, {
      ariaHasPopup: 'dialog',
    }));

    // Should have started a Dropdown lifecycle, not ModalDialog
    expect(runtime.activeCount).toBe(1);
    // @ts-ignore — peek at active stack for test verification
    const activeType = (runtime as any).activeStack[0]?.type;
    expect(activeType).toBe('Dropdown');

    // Simulate panel interaction to produce a complete Dropdown
    runtime.process(makeEvent('click', {
      tag: 'DIV', accessibleName: 'Premium Economy',
      className: 'class-option', stableId: 'premium-opt',
      cssSelector: 'div.class-option',
    }, { surfaceId: 'econ-surface', surfaceType: 'modal' }));

    // Close
    runtime.process(makeEvent('click', {
      tag: 'BODY', accessibleName: '', stableId: 'body', cssSelector: 'body',
    }));

    const dropdown = emitted.find(i => i.type === 'Dropdown');
    const modal = emitted.find(i => i.type === 'ModalDialog');
    expect(dropdown).toBeDefined();
    expect(modal).toBeUndefined();
  });

  it('triggers Dropdown for aria-haspopup="true" with dropdown CSS classes', () => {
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Cabin Class',
      className: 'cabin-selector select-wrapper',
      stableId: 'cabin-trigger',
      cssSelector: 'div.cabin-selector',
    }, {
      ariaHasPopup: 'true',
    }));

    expect(runtime.activeCount).toBe(1);
    const activeType = (runtime as any).activeStack[0]?.type;
    expect(activeType).toBe('Dropdown');

    // Simulate selection
    runtime.process(makeEvent('click', {
      tag: 'DIV', accessibleName: 'Business',
      className: 'option-item', stableId: 'biz-opt',
      cssSelector: 'div.option-item',
    }, { surfaceId: 'cabin-surface', surfaceType: 'modal' }));

    runtime.process(makeEvent('click', {
      tag: 'BODY', accessibleName: '', stableId: 'body', cssSelector: 'body',
    }));

    const dropdown = emitted.find(i => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
  });

  it('does NOT claim as Dropdown when aria-haspopup="dialog" without dropdown CSS', () => {
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: 'Open Settings',
      className: 'settings-btn icon-btn',
      stableId: 'settings-btn',
      cssSelector: 'button.settings-btn',
    }, {
      ariaHasPopup: 'dialog',
    }));

    // Should NOT start a Dropdown (no dropdown CSS classes)
    const activeType = (runtime as any).activeStack[0]?.type;
    expect(activeType).not.toBe('Dropdown');
  });
});

describe('Fix 3: Dropdown binds modal-type surfaces', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('Dropdown absorbs stepper clicks from a role="dialog" panel', () => {
    // Trigger dropdown with dialog-type popup
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Passengers',
      className: 'pax-selector dropdown-trigger',
      stableId: 'pax-trigger',
      cssSelector: 'div.pax-selector',
    }, {
      ariaHasPopup: 'dialog',
    }));

    // Panel opens with role="dialog" → surfaceType: 'modal'
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      className: 'stepper-plus pax-plus',
      stableId: 'adults-plus',
      cssSelector: 'button.pax-plus',
    }, {
      surfaceId: 'pax-dialog-surface',
      surfaceType: 'modal',
    }));

    // Select option
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Premium Economy',
      className: 'class-option',
      stableId: 'premium-opt',
      cssSelector: 'div.class-option',
    }, {
      surfaceId: 'pax-dialog-surface',
      surfaceType: 'modal',
    }));

    // Done
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: 'Done',
      className: 'btn done-btn',
      stableId: 'done-btn',
      cssSelector: 'button.done-btn',
    }, {
      surfaceId: 'pax-dialog-surface',
      surfaceType: 'modal',
    }));

    const dropdown = emitted.find(i => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.subActions).toBeDefined();
    const subActions = dropdown!.metadata.subActions as any[];
    expect(subActions.some(s => s.action === 'increment')).toBe(true);
    expect(dropdown!.metadata.doneClicked).toBe(true);
  });
});
