/**
 * Unit Tests: DragDrop + Dropdown Downcast to Click
 *
 * Tests both pathways where a click on an element is incorrectly absorbed
 * by a higher-priority definition:
 *
 * Pathway 1: DragDrop absorbs mousedown+mouseup without a click event
 * Pathway 2: Dropdown claims click but never completes (false-positive trigger)
 *
 * Spec: `.drytis/specs/p0-5-dropdown-downcast-to-click.md`
 */

import { describe, it, expect } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import type { ComponentInteraction, RuntimeConfig } from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';
import { ALL_DEFINITIONS } from '../../src/definitions';

function setupRuntime(): { runtime: ComponentRuntime; emitted: ComponentInteraction[] } {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

describe('Downcast to Click — full event sequences', () => {

  // ═══ Pathway 1: DragDrop absorbs mousedown + mouseup (no click) ═══

  it('mousedown + mouseup (no click) on DIV → downcasts to Click', () => {
    const { runtime, emitted } = setupRuntime();

    const target = {
      tag: 'DIV',
      className: 'fare-type',
      accessibleName: 'Armed Forces',
      ariaRole: null,
      cssSelector: 'div.fare-type',
      elementId: '',
    };

    runtime.process(makeObservedEvent({
      eventId: 'evt-1', eventType: 'mousedown', target,
      clientX: 100, clientY: 200,
    }));
    runtime.process(makeObservedEvent({
      eventId: 'evt-2', eventType: 'mouseup', target,
      clientX: 100, clientY: 200,
    }));

    runtime.flush();

    // Should be a Click, not a discarded DragDrop
    const clicks = emitted.filter(i => i.type === 'Click');
    expect(clicks.length).toBe(1);
    expect(clicks[0].endState).toBe('completed');
    expect(clicks[0].metadata.targetName).toBe('Armed Forces');
  });

  it('mousedown + mouseup + click on DIV → single Click (no duplicate)', () => {
    const { runtime, emitted } = setupRuntime();

    const target = {
      tag: 'DIV',
      className: 'fare-type',
      accessibleName: 'Armed Forces',
      ariaRole: null,
      cssSelector: 'div.fare-type',
      elementId: '',
    };

    runtime.process(makeObservedEvent({
      eventId: 'evt-1', eventType: 'mousedown', target,
      clientX: 100, clientY: 200,
    }));
    runtime.process(makeObservedEvent({
      eventId: 'evt-2', eventType: 'mouseup', target,
      clientX: 100, clientY: 200,
    }));
    runtime.process(makeObservedEvent({
      eventId: 'evt-3', eventType: 'click', target,
      clientX: 100, clientY: 200,
    }));

    runtime.flush();

    const clicks = emitted.filter(i => i.type === 'Click');
    // Should have exactly 1 Click (either from downcast DragDrop or from
    // the click event itself, but not both)
    expect(clicks.length).toBe(1);
    expect(clicks[0].endState).toBe('completed');
  });

  // ═══ Pathway 2: Dropdown false-positive trigger ═══

  it('click-only on fare-type DIV → Click (Dropdown downcast)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeObservedEvent({
      eventId: 'evt-1', eventType: 'click',
      target: {
        tag: 'DIV',
        className: 'fare-type armed-forces',
        accessibleName: 'Armed Forces',
        ariaRole: null,
        cssSelector: 'div.fare-type',
        elementId: '',
      },
    }));

    runtime.flush();

    const clicks = emitted.filter(i => i.type === 'Click');
    expect(clicks.length).toBe(1);
    expect(clicks[0].endState).toBe('completed');
    expect(clicks[0].metadata.targetName).toBe('Armed Forces');
  });

  // ═══ Non-downcast cases ═══

  it('real mouse drag (displacement > threshold) → DragDrop, not Click', () => {
    const { runtime, emitted } = setupRuntime();

    const target = {
      tag: 'DIV',
      className: 'draggable-item',
      accessibleName: 'Task Card',
      ariaRole: null,
      cssSelector: 'div.draggable-item',
      elementId: '',
    };

    runtime.process(makeObservedEvent({
      eventId: 'evt-1', eventType: 'mousedown', target,
      clientX: 100, clientY: 200,
    }));
    runtime.process(makeObservedEvent({
      eventId: 'evt-2', eventType: 'mousemove', target,
      clientX: 200, clientY: 300,
    }));
    runtime.process(makeObservedEvent({
      eventId: 'evt-3', eventType: 'mouseup', target,
      clientX: 200, clientY: 300,
    }));
    // After drag, a click event fires — consumed by DragDrop to complete
    runtime.process(makeObservedEvent({
      eventId: 'evt-4', eventType: 'click', target,
      clientX: 200, clientY: 300,
    }));

    runtime.flush();

    const dragDrops = emitted.filter(i => i.type === 'DragDrop');
    expect(dragDrops.length).toBe(1);
    expect(dragDrops[0].endState).toBe('completed');
  });

  it('real dropdown with SELECT change → Dropdown, not Click', () => {
    const { runtime, emitted } = setupRuntime();

    const target = {
      tag: 'SELECT',
      className: 'country-select',
      accessibleName: 'Country',
      ariaRole: null,
      cssSelector: 'select.country-select',
      elementId: '',
    };

    runtime.process(makeObservedEvent({
      eventId: 'evt-1', eventType: 'click', target,
    }));
    runtime.process(makeObservedEvent({
      eventId: 'evt-2', eventType: 'change', target,
      valueAfter: 'India',
    }));

    runtime.flush();

    const dropdowns = emitted.filter(i => i.type === 'Dropdown');
    expect(dropdowns.length).toBe(1);
    expect(dropdowns[0].endState).toBe('completed');
  });
});
