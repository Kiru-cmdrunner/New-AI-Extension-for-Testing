/**
 * Unit Tests: Drag and Drop Definition
 *
 * Tests both mouse-based and HTML5 DnD paths, click-after-drag suppression,
 * displacement threshold, and metadata accuracy.
 *
 * Architecture: `.drytis/specs/p0-3-drag-and-drop.md`
 */

import { describe, it, expect } from 'vitest';
import { dragAndDropDefinition } from '../../src/definitions/drag-and-drop';
import { createRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
  BrowserEventType,
} from '../../src/shared/component-types';

// Re-use ElementIdentity type for cast targets
type _ElementIdentity = ElementIdentity;

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
    ...overrides,
  };
}

function makeEvent(
  eventId: string,
  eventType: BrowserEventType,
  target: Partial<ElementIdentity> = {},
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType,
    target: makeTarget(target),
    domContext: makeContext(domContext),
    ...eventOverrides,
  });
}

function setupRuntime() {
  let emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

// ── Definition Unit Tests ────────────────────────────────────────────

describe('DragDrop Definition — Trigger', () => {
  it('triggers on mousedown', () => {
    const event = makeEvent('e1', 'mousedown', {
      tag: 'DIV',
      accessibleName: 'Draggable Item',
      stableId: 'item-1',
    });
    const result = dragAndDropDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'DragDrop' });
  });

  it('triggers on dragstart (HTML5 DnD)', () => {
    const event = makeEvent('e1', 'dragstart', {
      tag: 'DIV',
      accessibleName: 'Draggable Card',
      className: 'draggable',
    });
    const result = dragAndDropDefinition.detectTrigger(event);
    expect(result).toEqual({ type: 'DragDrop' });
  });

  it('does not trigger on other events', () => {
    const clickEvent = makeEvent('e1', 'click', { tag: 'BUTTON' });
    expect(dragAndDropDefinition.detectTrigger(clickEvent)).toBeNull();

    const mouseMoveEvent = makeEvent('e2', 'mousemove', {});
    expect(dragAndDropDefinition.detectTrigger(mouseMoveEvent)).toBeNull();
  });
});

describe('DragDrop Definition — Mouse-Based Drag', () => {
  it('captures a full mouse drag with displacement > threshold', () => {
    const { runtime, emitted } = setupRuntime();

    // mousedown on source
    runtime.process(
      makeEvent('e1', 'mousedown', {
        tag: 'DIV',
        accessibleName: 'Task Card',
        stableId: 'task-1',
      }, {}, { clientX: 100, clientY: 100 }),
    );

    // mousemove (dragging)
    runtime.process(
      makeEvent('e2', 'mousemove', {}, {}, { clientX: 150, clientY: 120 }),
    );

    // mouseup on drop target
    runtime.process(
      makeEvent('e3', 'mouseup', {
        tag: 'DIV',
        accessibleName: 'Done Column',
        stableId: 'col-done',
      }, {}, { clientX: 150, clientY: 120 }),
    );

    // click (click-after-drag)
    runtime.process(
      makeEvent('e4', 'click', {
        tag: 'DIV',
        accessibleName: 'Done Column',
        stableId: 'col-done',
      }, {}, { clientX: 150, clientY: 120 }),
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('DragDrop');
    expect(emitted[0].endState).toBe('completed');
    expect(emitted[0].metadata.sourceElement).toBe('Task Card');
    expect(emitted[0].metadata.dropTarget).toBe('Done Column');
    expect(emitted[0].metadata.displacement).toBeGreaterThanOrEqual(10);
    expect(emitted[0].metadata.dragMethod).toBe('mouse');
    expect(emitted[0].interactionSubtype).toBe('MouseDragDrop');
  });

  it('discards when displacement < threshold (not a drag) → downcasts to Click', () => {
    const { runtime, emitted } = setupRuntime();

    // mousedown on a DIV with NO interactive classes — DragDrop triggers.
    // This simulates a genuine non-interactive container that the user
    // accidentally clicks (e.g., a card body, a layout div).
    runtime.process(
      makeEvent('e1', 'mousedown', {
        tag: 'DIV',
        accessibleName: 'Card Body',
        stableId: 'card-body-1',
        className: 'card layout-container',
      }, {}, { clientX: 100, clientY: 100 }),
    );

    // mouseup at almost the same position (displacement = ~3px)
    runtime.process(
      makeEvent('e2', 'mouseup', {
        tag: 'DIV',
        accessibleName: 'Card Body',
        className: 'card layout-container',
      }, {}, { clientX: 102, clientY: 102 }),
    );

    // click should produce a normal Click interaction via DragDrop downcast
    runtime.process(
      makeEvent('e3', 'click', {
        tag: 'DIV',
        accessibleName: 'Card Body',
        stableId: 'card-body-1',
        className: 'card layout-container',
      }, {}, { clientX: 102, clientY: 102 }),
    );

    // DragDrop was discarded and downcast to Click — no DragDrop in output
    const dragDrop = emitted.find((i) => i.type === 'DragDrop');
    expect(dragDrop).toBeUndefined();

    // The downcast Click (from the discarded DragDrop) is emitted
    const click = emitted.find((i) => i.type === 'Click');
    expect(click).toBeDefined();
    expect(click!.metadata.targetName).toBe('Card Body');

    // Exactly ONE interaction — no duplicate
    expect(emitted.length).toBe(1);
  });

  it('records source and drop target element tags', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'mousedown', {
        tag: 'LI',
        accessibleName: 'Item A',
        ariaRole: 'listitem',
      }, {}, { clientX: 50, clientY: 50 }),
    );

    runtime.process(
      makeEvent('e2', 'mousemove', {}, {}, { clientX: 200, clientY: 300 }),
    );

    runtime.process(
      makeEvent('e3', 'mouseup', {
        tag: 'UL',
        accessibleName: 'Drop Zone',
        ariaRole: 'list',
      }, {}, { clientX: 200, clientY: 300 }),
    );

    runtime.process(
      makeEvent('e4', 'click', {
        tag: 'UL',
        accessibleName: 'Drop Zone',
      }, {}, { clientX: 200, clientY: 300 }),
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].metadata.sourceTag).toBe('LI');
    expect(emitted[0].metadata.dropTargetTag).toBe('UL');
  });

  it('records start and end coordinates', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'mousedown', { tag: 'DIV', accessibleName: 'Source' }, {}, { clientX: 50, clientY: 50 }),
    );
    runtime.process(
      makeEvent('e2', 'mousemove', {}, {}, { clientX: 200, clientY: 300 }),
    );
    runtime.process(
      makeEvent('e3', 'mouseup', { tag: 'DIV', accessibleName: 'Target' }, {}, { clientX: 200, clientY: 300 }),
    );
    runtime.process(
      makeEvent('e4', 'click', { tag: 'DIV', accessibleName: 'Target' }, {}, { clientX: 200, clientY: 300 }),
    );

    expect(emitted[0].metadata.startX).toBe(50);
    expect(emitted[0].metadata.startY).toBe(50);
    expect(emitted[0].metadata.endX).toBe(200);
    expect(emitted[0].metadata.endY).toBe(300);
  });
});

describe('DragDrop Definition — Click-After-Drag Suppression', () => {
  it('does not emit a separate Click interaction after a drag', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'mousedown', { tag: 'DIV', accessibleName: 'Card' }, {}, { clientX: 100, clientY: 100 }),
    );
    runtime.process(
      makeEvent('e2', 'mousemove', {}, {}, { clientX: 300, clientY: 200 }),
    );
    runtime.process(
      makeEvent('e3', 'mouseup', { tag: 'DIV', accessibleName: 'Drop Zone' }, {}, { clientX: 300, clientY: 200 }),
    );
    runtime.process(
      makeEvent('e4', 'click', { tag: 'DIV', accessibleName: 'Drop Zone' }, {}, { clientX: 300, clientY: 200 }),
    );

    // Should be exactly 1 interaction (DragDrop), not 2 (DragDrop + Click)
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('DragDrop');
  });
});

describe('DragDrop Definition — HTML5 DnD', () => {
  it('captures dragstart → drop as HTML5 DnD', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'dragstart', {
        tag: 'DIV',
        accessibleName: 'File Icon',
        className: 'draggable',
        stableId: 'file-1',
      }, {}, { clientX: 50, clientY: 50 }),
    );

    runtime.process(
      makeEvent('e2', 'dragover', {
        tag: 'DIV',
        accessibleName: 'Upload Area',
        stableId: 'upload-zone',
      }, {}, { clientX: 100, clientY: 100 }),
    );

    runtime.process(
      makeEvent('e3', 'drop', {
        tag: 'DIV',
        accessibleName: 'Upload Area',
        stableId: 'upload-zone',
      }, {}, { clientX: 100, clientY: 100 }),
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('DragDrop');
    expect(emitted[0].endState).toBe('completed');
    expect(emitted[0].metadata.sourceElement).toBe('File Icon');
    expect(emitted[0].metadata.dropTarget).toBe('Upload Area');
    expect(emitted[0].metadata.dragMethod).toBe('html5');
    expect(emitted[0].interactionSubtype).toBe('Html5DragDrop');
  });

  it('discards when drag is cancelled without drop (dragend only)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'dragstart', {
        tag: 'DIV',
        accessibleName: 'Draggable',
      }, {}, { clientX: 50, clientY: 50 }),
    );

    runtime.process(
      makeEvent('e2', 'dragend', {}, {}, { clientX: 50, clientY: 50 }),
    );

    // The DragDrop was cancelled — downcasts to Click (the drag never happened)
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
    expect(emitted[0].endState).toBe('completed');
  });
});

describe('DragDrop Definition — Priority and Integration', () => {
  it('has priority 15 (before Dropdown at 20)', () => {
    expect(dragAndDropDefinition.priority).toBe(15);
  });

  it('is registered in ALL_DEFINITIONS', () => {
    expect(ALL_DEFINITIONS).toContain(dragAndDropDefinition);
  });

  it('triggers on mousedown when using full definition set', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(
      makeEvent('e1', 'mousedown', {
        tag: 'DIV',
        accessibleName: 'Draggable',
        className: 'draggable-item',
      }, {}, { clientX: 100, clientY: 100 }),
    );

    // Should create a DragDrop session (even if not yet emitted)
    // Move mouse > threshold, then mouseup + click to complete
    runtime.process(
      makeEvent('e2', 'mousemove', {}, {}, { clientX: 200, clientY: 200 }),
    );
    runtime.process(
      makeEvent('e3', 'mouseup', { tag: 'DIV', accessibleName: 'Target' }, {}, { clientX: 200, clientY: 200 }),
    );
    runtime.process(
      makeEvent('e4', 'click', { tag: 'DIV', accessibleName: 'Target' }, {}, { clientX: 200, clientY: 200 }),
    );

    expect(emitted.some((i) => i.type === 'DragDrop')).toBe(true);
  });
});

describe('DragDrop Definition — No Regression', () => {
  it('normal click still produces Click (not DragDrop)', () => {
    const { runtime, emitted } = setupRuntime();

    // A normal click without prior mousedown event — Click definition handles it
    runtime.process(
      makeEvent('e1', 'click', {
        tag: 'BUTTON',
        accessibleName: 'Submit',
        stableId: 'submit-btn',
      }),
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
  });

  it('slider still works (mousedown on slider via click)', () => {
    const { runtime, emitted } = setupRuntime();

    // Slider triggers on click, not mousedown — so DragDrop should not interfere
    runtime.process(
      makeEvent('e1', 'click', {
        tag: 'INPUT',
        ariaRole: 'slider',
        accessibleName: 'Volume',
      }, { inputType: 'range' }),
    );

    expect(emitted.some((i) => i.type === 'Slider')).toBe(true);
  });
});
