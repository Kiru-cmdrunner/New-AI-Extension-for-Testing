/**
 * Integration tests for the V2 Event Observer.
 *
 * These tests run against jsdom to verify the observer correctly captures
 * DOM events and emits PipelineEvents with the canonical schema.
 *
 * LEARNING 1 (Event Schema): Tests verify element identity is ALWAYS populated
 * LEARNING 4 (Event Producers): Tests verify every event type has a producer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { V2EventObserver } from '../../src/recorder/pipeline-v2/v2-event-observer';
import type { PipelineEvent } from '../../src/recorder/pipeline-v2/canonical-event-schema';

// ── Setup ───────────────────────────────────────────────────────────────

describe('V2EventObserver', () => {
  let observer: V2EventObserver;
  let capturedEvents: PipelineEvent[];

  beforeEach(() => {
    capturedEvents = [];
    observer = new V2EventObserver({ hoverDwellThresholdMs: 50, captureHover: true });
    observer.onEvent((event) => capturedEvents.push(event));
    observer.start();
  });

  afterEach(() => {
    observer.stop();
  });

  // ── Click Events ───────────────────────────────────────────────────

  describe('click events', () => {
    it('should emit a click PipelineEvent with element identity', () => {
      document.body.innerHTML = '<button id="btn" aria-label="Submit">Submit</button>';
      const btn = document.getElementById('btn')!;

      btn.click();

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0].type).toBe('click');
      expect(capturedEvents[0].element).not.toBeNull();
      expect(capturedEvents[0].element?.accessibleName).toBe('Submit');
      expect(capturedEvents[0].element?.tag).toBe('BUTTON');
      expect(capturedEvents[0].targetTag).toBe('BUTTON');
      expect(capturedEvents[0].payload.clickCount).toBe(1);
      expect(capturedEvents[0].isTrusted).toBeDefined();
    });

    it('should emit a click for a deeply nested element', () => {
      document.body.innerHTML = `
        <div id="container">
          <span class="wrapper">
            <button id="deep-btn">Deep</button>
          </span>
        </div>
      `;
      const btn = document.getElementById('deep-btn')!;
      btn.click();

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0].type).toBe('click');
      expect(capturedEvents[0].element?.accessibleName).toBe('Deep');
    });
  });

  // ── Input/Change Events ────────────────────────────────────────────

  describe('input/change events', () => {
    it('should emit a change event with value for select', () => {
      document.body.innerHTML = `
        <select id="country">
          <option value="">Select...</option>
          <option value="ca">Canada</option>
        </select>
      `;
      const select = document.getElementById('country') as HTMLSelectElement;
      select.value = 'ca';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      const changeEvent = capturedEvents.find((e) => e.type === 'change');
      expect(changeEvent).toBeDefined();
      expect(changeEvent?.payload.value).toBe('Canada');
    });

    it('should emit an input event with value for text input', () => {
      document.body.innerHTML = '<input id="email" type="email" />';
      const input = document.getElementById('email') as HTMLInputElement;
      input.value = 'test@example.com';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const inputEvent = capturedEvents.find((e) => e.type === 'input');
      expect(inputEvent).toBeDefined();
      expect(inputEvent?.payload.value).toBe('test@example.com');
    });
  });

  // ── Focus/Blur Events ──────────────────────────────────────────────

  describe('focus/blur events', () => {
    it('should emit focus and blur events', () => {
      document.body.innerHTML = '<input id="field" type="text" />';
      const input = document.getElementById('field')!;

      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

      const focusEvent = capturedEvents.find((e) => e.type === 'focus');
      const blurEvent = capturedEvents.find((e) => e.type === 'blur');
      expect(focusEvent).toBeDefined();
      expect(blurEvent).toBeDefined();
    });
  });

  // ── Keydown Events ─────────────────────────────────────────────────

  describe('keydown events', () => {
    it('should emit keydown with key and code', () => {
      document.body.innerHTML = '<input id="search" type="search" />';
      const input = document.getElementById('search')!;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));

      const keyEvent = capturedEvents.find((e) => e.type === 'keydown');
      expect(keyEvent).toBeDefined();
      expect(keyEvent?.payload.key).toBe('Enter');
      expect(keyEvent?.payload.code).toBe('Enter');
    });
  });

  // ── Submit Events ──────────────────────────────────────────────────

  describe('submit events', () => {
    it('should emit a submit event', () => {
      document.body.innerHTML = '<form id="form"><button type="submit">Go</button></form>';
      const form = document.getElementById('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      const submitEvent = capturedEvents.find((e) => e.type === 'submit');
      expect(submitEvent).toBeDefined();
    });
  });

  // ── Navigation Events ──────────────────────────────────────────────

  describe('navigation events', () => {
    it('should emit a navigation event via ingestNavigation', () => {
      observer.ingestNavigation('https://example.com/page2', 'Page 2');

      const navEvent = capturedEvents.find((e) => e.type === 'navigation');
      expect(navEvent).toBeDefined();
      expect(navEvent?.payload.url).toBe('https://example.com/page2');
      expect(navEvent?.element).toBeNull();
    });
  });

  // ── Surface Detection ──────────────────────────────────────────────

  describe('surface detection', () => {
    it('should emit surface_open when a dialog appears', () => {
      document.body.innerHTML = '<div id="app"></div>';
      const app = document.getElementById('app')!;

      // Add a dialog element
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', 'Settings');
      dialog.id = 'settings-dialog';
      app.appendChild(dialog);

      // Wait for mutation observer (async)
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const surfaceEvent = capturedEvents.find((e) => e.type === 'surface_open');
          expect(surfaceEvent).toBeDefined();
          expect(surfaceEvent?.payload.surfaceType).toBe('dialog');
          resolve();
        }, 100);
      });
    });

    it('should emit surface_close when a dialog is removed', () => {
      document.body.innerHTML = '<div id="app"><div role="dialog" id="d">Dialog</div></div>';
      const dialog = document.getElementById('d')!;

      // Wait for initial surface_open detection
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Remove the dialog
          dialog.remove();

          setTimeout(() => {
            const closeEvent = capturedEvents.find((e) => e.type === 'surface_close');
            expect(closeEvent).toBeDefined();
            resolve();
          }, 100);
        }, 100);
      });
    });

    it('should detect aria-expanded surface lifecycle', () => {
      document.body.innerHTML = `
        <button id="dd-trigger" aria-haspopup="menu" aria-expanded="false">Menu</button>
      `;
      const trigger = document.getElementById('dd-trigger')!;

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Expand
          trigger.setAttribute('aria-expanded', 'true');

          setTimeout(() => {
            const openEvent = capturedEvents.find((e) => e.type === 'surface_open');
            expect(openEvent).toBeDefined();

            // Collapse
            trigger.setAttribute('aria-expanded', 'false');

            setTimeout(() => {
              const closeEvent = capturedEvents.find((e) => e.type === 'surface_close');
              expect(closeEvent).toBeDefined();
              resolve();
            }, 100);
          }, 100);
        }, 100);
      });
    });
  });

  // ── State Snapshot Embedding ─────────────────────────────────────

  describe('state snapshot embedding', () => {
    it('should embed a stateSnapshot in every event payload', () => {
      document.body.innerHTML = '<button id="btn">Click</button>';
      document.getElementById('btn')!.click();

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0].payload.stateSnapshot).toBeDefined();
      const snapshot = capturedEvents[0].payload.stateSnapshot as Record<string, unknown>;
      expect(snapshot.inputs).toBeDefined();
      expect(Array.isArray(snapshot.inputs)).toBe(true);
    });

    it('should capture input values in the snapshot', () => {
      document.body.innerHTML = '<input id="email" type="email" value="test@example.com" />';
      const input = document.getElementById('email') as HTMLInputElement;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      const inputEvent = capturedEvents.find((e) => e.type === 'input');
      expect(inputEvent).toBeDefined();
      const snapshot = inputEvent!.payload.stateSnapshot as { inputs: Array<{ value: string }> };
      const emailInput = snapshot.inputs.find((i) => (i as { descriptor: { id: string } }).descriptor?.id === 'email');
      expect(emailInput?.value).toBe('test@example.com');
    });
  });

  // ── Element Identity Completeness (Learning 7) ────────────────────

  describe('element identity completeness', () => {
    it('should populate ALL ElementIdentity fields for a click', () => {
      document.body.innerHTML = `
        <input id="test-input"
               type="text"
               aria-label="Full Name"
               name="fullName"
               data-testid="name-field"
               class="form-control"
               placeholder="Enter name" />
      `;
      const input = document.getElementById('test-input')!;
      input.click();

      expect(capturedEvents).toHaveLength(1);
      const identity = capturedEvents[0].element!;

      // Learning 7: ALL fields must be populated
      expect(identity.accessibleName).toBe('Full Name');
      expect(identity.ariaRole).not.toBeNull();
      expect(identity.tag).toBe('INPUT');
      expect(identity.name).toBe('fullName');
      expect(identity.testId).toBe('name-field');
      expect(identity.className).toBe('form-control');
      expect(identity.cssSelector).toContain('test-input');
      expect(identity.elementId).toBeDefined();
    });

    it('should have a unique eventId for each event', () => {
      document.body.innerHTML = `
        <button id="btn1">One</button>
        <button id="btn2">Two</button>
      `;
      document.getElementById('btn1')!.click();
      document.getElementById('btn2')!.click();

      expect(capturedEvents).toHaveLength(2);
      expect(capturedEvents[0].eventId).not.toBe(capturedEvents[1].eventId);
    });
  });

  // ── Hover Events (dwell-based) ─────────────────────────────────────

  describe('hover events', () => {
    it('should emit mouseenter after dwell threshold', () => {
      document.body.innerHTML = '<button id="hover-btn">Hover Me</button>';
      const btn = document.getElementById('hover-btn')!;
      // mouseover starts the dwell timer
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

      return new Promise<void>((resolve) => {
        // Wait past the dwell threshold (50ms in test config)
        setTimeout(() => {
          const enterEvent = capturedEvents.find((e) => e.type === 'mouseenter');
          expect(enterEvent).toBeDefined();
          resolve();
        }, 100);
      });
    });

    it('should NOT emit mouseenter if mouse leaves before dwell threshold', () => {
      document.body.innerHTML = '<button id="hover-btn">Hover Me</button>';
      const btn = document.getElementById('hover-btn')!;
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      // Leave quickly (before dwell)
      btn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const enterEvent = capturedEvents.find((e) => e.type === 'mouseenter');
          expect(enterEvent).toBeUndefined();
          resolve();
        }, 100);
      });
    });
  });
});

// ── Event Type Vocabulary Coverage (Learning 4) ─────────────────────────

describe('V2 observer event type coverage', () => {
  it('should produce events for every type in the vocabulary', () => {
    // This test verifies that the observer CAN produce every event type.
    // We test by checking the observer's methods exist and produce events.

    const events: PipelineEvent[] = [];
    const observer = new V2EventObserver();
    observer.onEvent((e) => events.push(e));
    observer.start();

    // Setup DOM
    document.body.innerHTML = `
      <button id="btn">Click</button>
      <input id="text" type="text" />
      <select id="sel"><option>A</option><option>B</option></select>
      <form id="form"><button type="submit">Submit</button></form>
    `;

    // click
    document.getElementById('btn')!.click();
    // input
    const text = document.getElementById('text') as HTMLInputElement;
    text.value = 'hello';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    // focus
    text.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    // blur
    text.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    // change
    const sel = document.getElementById('sel') as HTMLSelectElement;
    sel.value = 'B';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    // keydown
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // submit
    document.getElementById('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    // navigation
    observer.ingestNavigation('https://example.com', 'Example');

    const types = new Set(events.map((e) => e.type));

    // Every DOM-produced type should have at least one event
    expect(types.has('click')).toBe(true);
    expect(types.has('input')).toBe(true);
    expect(types.has('focus')).toBe(true);
    expect(types.has('blur')).toBe(true);
    expect(types.has('change')).toBe(true);
    expect(types.has('keydown')).toBe(true);
    expect(types.has('submit')).toBe(true);
    expect(types.has('navigation')).toBe(true);

    observer.stop();
  });
});
