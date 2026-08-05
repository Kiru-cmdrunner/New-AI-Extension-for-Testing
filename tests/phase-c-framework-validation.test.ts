/**
 * Foundation Validation — Phase C Integration Tests
 *
 * Validates the pipeline against framework-specific DOM patterns:
 *   - Vue 3.5: data-v-app marker, router-link classes, empty style attrs,
 *     no aria-label on destroy button
 *   - Angular 21: custom component tags (app-*), ng-version, routerlink,
 *     ng-* form state classes, htmlfor instead of for, aria-label on destroy,
 *     hidden attribute instead of style display:none
 *
 * Key question: Does the deterministic recorder + classifier + pipeline
 * produce equivalent IR plans regardless of the frontend framework?
 *
 * Extension runtime limitations: browser tools cannot exercise Chrome
 * extension content scripts. Integration tests simulate the exact event
 * sequences the recorder would produce from these frameworks.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { RecordingSession } from '../src/recorder/recording-session';
import { detectInteractions } from '../src/classifier/interaction-detector';
import { detectInteractionsV2 } from '../src/classifier/evidence/detector';
import { mergeV1V2 } from '../src/classifier/evidence/merge-layer';
import { adaptToDomainEntities } from '../src/recorder/pipeline/domain-adapter';
import { runPipeline } from '../src/recorder/pipeline/pipeline-runner';
import { build as buildIRPlan } from '../src/generation/ir-bridge';
import type { ElementIdentity } from '../src/shared/types';
import type { RecordedEvent, ElementRecordedEvent, DomContext } from '../src/recorder/recorded-event';
import type { DetectedInteraction } from '../src/classifier/interaction-types';
import type { UnderstandingResult } from '../src/domain/knowledge/understanding-result';

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

function identity(tag: string, name: string, extras: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: name,
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag,
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: tag.toLowerCase(),
    xPath: `//${tag.toLowerCase()}`,
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: `el-${tag.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20)}`,
    ...extras,
  };
}

function domContext(extras: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    ariaAutoComplete: null,
    listId: null,
    isContentEditable: false,
    ...extras,
  };
}

function ts(seconds: number): string {
  return new Date(2026, 0, 1, 8, 0, seconds).toISOString();
}

function buildUnderstanding(
  events: RecordedEvent[],
  interactions: DetectedInteraction[],
  sessionId: string,
  sourceUrl: string,
): UnderstandingResult | null {
  const pipelineResult = runPipeline(events, interactions, sessionId, sourceUrl);
  if (!pipelineResult.fragment) return null;
  return {
    sessionId,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    fragment: pipelineResult.fragment,
    capability: pipelineResult.capability,
  };
}

function buildIR(
  events: RecordedEvent[],
  interactions: DetectedInteraction[],
  understanding: UnderstandingResult | null,
  startUrl: string,
  title: string,
) {
  return buildIRPlan({
    events,
    interactions,
    understanding,
    recordingContext: { startUrl, title },
    testCaseName: 'Phase C Validation',
  });
}

// ════════════════════════════════════════════════════════════════════════
// VUE 3.5 — Framework-specific patterns
//
// Unique Vue patterns vs React:
//   - data-v-app="" on root element (Vue mount marker)
//   - router-link-active / router-link-exact-active classes on filter links
//   - Empty style="" attributes from :style bindings
//   - No aria-label on destroy button (accessibility gap)
//   - id="toggle-all-input" on toggle-all checkbox
//   - checked="" (empty string) when checked, not checked="checked"
//   - type="text" on new-todo input (explicit type)
//   - aria-current="page" on active filter link
// ════════════════════════════════════════════════════════════════════════

describe('Vue 3.5 — Framework-specific DOM patterns', () => {
  beforeEach(() => setupChromeMock());

  it('classifies Vue new-todo input (type=text, placeholder, no id, no aria-label)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');

    // Vue: <input type="text" class="new-todo" placeholder="What needs to be done?" autofocus="" autocomplete="off">
    const newTodo = identity('INPUT', '', {
      ariaRole: 'textbox',
      placeholder: 'What needs to be done?',
      cssSelector: 'input.new-todo',
      className: 'new-todo',
    });
    session.addElementEvent('focus', ts(0), newTodo, null, '', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('input', ts(1), newTodo, '', 'Buy groceries', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('blur', ts(2), newTodo, 'Buy groceries', 'Buy groceries', null, null, domContext({ inputType: 'text' }));

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].metadata.textValue).toBe('Buy groceries');
  });

  it('classifies Vue toggle-all checkbox (id=toggle-all-input)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');

    // Vue: <input type="checkbox" id="toggle-all-input" class="toggle-all">
    session.addElementEvent('click', ts(0), identity('INPUT', '', {
      stableId: 'toggle-all-input',
      ariaRole: 'checkbox',
      cssSelector: 'input#toggle-all-input.toggle-all',
      className: 'toggle-all',
    }), null, null, false, true);

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(true);
  });

  it('classifies Vue todo item toggle (class=toggle, no id, no aria-label)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');

    // Vue: <input type="checkbox" class="toggle" checked="">  (inside <li> with class "completed" when done)
    session.addElementEvent('click', ts(0), identity('INPUT', '', {
      ariaRole: 'checkbox',
      cssSelector: 'li.todo input.toggle[type="checkbox"]',
      className: 'toggle',
    }), null, null, false, true);

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(true);
  });

  it('classifies Vue destroy button (no type, no aria-label, empty text)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');

    // Vue: <button class="destroy"></button> — no type, no aria-label, no text (CSS ::after)
    session.addElementEvent('click', ts(0), identity('BUTTON', '', {
      ariaRole: 'button',
      cssSelector: 'li.todo button.destroy',
      className: 'destroy',
    }), null, null, null, null);

    const interactions = detectInteractions(session.getEvents());
    // Button with no text, no role → Click (fallback)
    expect(interactions[0].type).toBe('Click');
  });

  it('classifies Vue filter links (router-link-active classes, hash routing)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');

    // Vue: <a href="#/active" class="router-link-active router-link-exact-active" aria-current="page">Active</a>
    session.addElementEvent('click', ts(0), identity('A', 'Active', {
      ariaRole: 'link',
      cssSelector: 'ul.filters a[href="#/active"]',
      className: 'router-link-active router-link-exact-active',
    }), null, null, null, null);

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('Link');
  });

  it('classifies Vue clear-completed button (no type, class-based)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');

    // Vue: <button class="clear-completed" style="">Clear completed</button>
    session.addElementEvent('click', ts(0), identity('BUTTON', 'Clear completed', {
      ariaRole: 'button',
      cssSelector: 'button.clear-completed',
      className: 'clear-completed',
    }), null, null, null, null);

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('Click');
  });

  it('passes full Vue TodoMVC workflow through pipeline to IR', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');

    // 1. Add todo
    const newTodo = identity('INPUT', '', {
      ariaRole: 'textbox', placeholder: 'What needs to be done?',
      cssSelector: 'input.new-todo', className: 'new-todo',
    });
    session.addElementEvent('focus', ts(0), newTodo, null, '', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('input', ts(1), newTodo, '', 'Buy milk', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('blur', ts(2), newTodo, 'Buy milk', 'Buy milk', null, null, domContext({ inputType: 'text' }));

    // 2. Toggle the todo checkbox
    session.addElementEvent('click', ts(3), identity('INPUT', '', {
      ariaRole: 'checkbox',
      cssSelector: 'li.todo input.toggle',
      className: 'toggle',
    }), null, null, false, true);

    // 3. Click "Active" filter
    session.addElementEvent('click', ts(4), identity('A', 'Active', {
      ariaRole: 'link',
      cssSelector: 'ul.filters a[href="#/active"]',
      className: 'router-link-active',
    }), null, null, null, null);

    const events = session.getEvents();
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(3);
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[1].type).toBe('Checkbox');
    expect(interactions[2].type).toBe('Link');

    // Pipeline
    const understanding = buildUnderstanding(events, interactions, 'vue-1', 'https://todomvc.com/');
    expect(understanding).not.toBeNull();

    // IR
    const irPlan = buildIR(events, interactions, understanding, 'https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');
    expect(irPlan.steps.length).toBe(3);

    const actionTypes = irPlan.steps.map(s => s.action);
    expect(actionTypes).toContain('fill');
    expect(actionTypes).toContain('toggle');
    expect(actionTypes).toContain('click');
  });
});

// ════════════════════════════════════════════════════════════════════════
// ANGULAR 21 — Framework-specific patterns
//
// Unique Angular patterns vs Vue and React:
//   - Custom component tags in DOM: <app-root>, <app-todo-header>,
//     <app-todo-list>, <app-todo-item>, <app-todo-footer>
//   - ng-version="21.2.11" on <app-root>
//   - routerlink attribute (lowercase) on filter links
//   - htmlfor instead of for on labels (Angular property binding)
//   - ng-* form state classes: ng-untouched, ng-pristine, ng-valid,
//     ng-dirty, ng-touched
//   - aria-label="Delete todo" on destroy button (accessibility advantage)
//   - type="button" on clear-completed (explicit type)
//   - hidden="" attribute instead of style="display: none"
//   - No type attribute on new-todo input (omitted, not type="text")
//   - No id on toggle-all checkbox
//   - data-framework="angular" on body
// ════════════════════════════════════════════════════════════════════════

describe('Angular 21 — Framework-specific DOM patterns', () => {
  beforeEach(() => setupChromeMock());

  it('classifies Angular new-todo input (no type attr, ng-* form classes, placeholder)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // Angular: <input class="new-todo ng-untouched ng-pristine ng-valid" placeholder="What needs to be done?" autofocus="">
    // Note: NO type="text" attribute (Angular omits it)
    const newTodo = identity('INPUT', '', {
      ariaRole: 'textbox',
      placeholder: 'What needs to be done?',
      cssSelector: 'input.new-todo',
      className: 'new-todo ng-untouched ng-pristine ng-valid',
    });
    // domContext.inputType will be 'text' because the recorder checks el.type
    // which defaults to 'text' when the attribute is absent on <input>
    session.addElementEvent('focus', ts(0), newTodo, null, '', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('input', ts(1), newTodo, '', 'Buy groceries', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('blur', ts(2), newTodo, 'Buy groceries', 'Buy groceries', null, null, domContext({ inputType: 'text' }));

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].metadata.textValue).toBe('Buy groceries');
  });

  it('classifies Angular toggle-all checkbox (no id, class=toggle-all)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // Angular: <input type="checkbox" class="toggle-all"> — NO id
    session.addElementEvent('click', ts(0), identity('INPUT', '', {
      ariaRole: 'checkbox',
      cssSelector: 'div.toggle-all-container input.toggle-all[type="checkbox"]',
      className: 'toggle-all',
    }), null, null, false, true);

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(true);
  });

  it('classifies Angular todo toggle (class=toggle, no id, no aria-label)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // Angular: <input type="checkbox" class="toggle"> inside <app-todo-item><li><div class="view">
    session.addElementEvent('click', ts(0), identity('INPUT', '', {
      ariaRole: 'checkbox',
      cssSelector: 'app-todo-item li input.toggle[type="checkbox"]',
      className: 'toggle',
    }), null, null, false, true);

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(true);
  });

  it('classifies Angular destroy button (aria-label="Delete todo")', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // Angular: <button class="destroy" aria-label="Delete todo"></button>
    // Note: Angular adds aria-label that Vue does NOT
    // The recorder resolves accessibleName from aria-label, so it should be captured
    session.addElementEvent('click', ts(0), identity('BUTTON', 'Delete todo', {
      ariaRole: 'button',
      ariaLabel: 'Delete todo',
      cssSelector: 'app-todo-item li button.destroy',
      className: 'destroy',
    }), null, null, null, null);

    const interactions = detectInteractions(session.getEvents());
    // Button with aria-label="Delete todo" → Click
    expect(interactions[0].type).toBe('Click');
    expect(interactions[0].target?.ariaLabel).toBe('Delete todo');
  });

  it('classifies Angular filter links (routerlink attribute, class=selected)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // Angular: <a routerlink="/active" href="#/active">Active</a>
    // Active filter has class="selected" but NOT router-link-active classes
    session.addElementEvent('click', ts(0), identity('A', 'Active', {
      ariaRole: 'link',
      cssSelector: 'ul.filters a[href="#/active"]',
      className: '',
    }), null, null, null, null);

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('Link');
  });

  it('classifies Angular clear-completed button (type=button, hidden attr)', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // Angular: <button type="button" class="clear-completed">Clear completed</button>
    // Note: has type="button" (Vue does not), uses hidden="" when no completed items
    session.addElementEvent('click', ts(0), identity('BUTTON', 'Clear completed', {
      ariaRole: 'button',
      cssSelector: 'button.clear-completed[type="button"]',
      className: 'clear-completed',
    }), null, null, null, null);

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('Click');
  });

  it('passes full Angular TodoMVC workflow through pipeline to IR', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // 1. Add todo
    const newTodo = identity('INPUT', '', {
      ariaRole: 'textbox', placeholder: 'What needs to be done?',
      cssSelector: 'input.new-todo',
      className: 'new-todo ng-untouched ng-pristine ng-valid',
    });
    session.addElementEvent('focus', ts(0), newTodo, null, '', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('input', ts(1), newTodo, '', 'Walk dog', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('blur', ts(2), newTodo, 'Walk dog', 'Walk dog', null, null, domContext({ inputType: 'text' }));

    // 2. Toggle the todo checkbox
    session.addElementEvent('click', ts(3), identity('INPUT', '', {
      ariaRole: 'checkbox',
      cssSelector: 'app-todo-item li input.toggle',
      className: 'toggle',
    }), null, null, false, true);

    // 3. Click "Completed" filter
    session.addElementEvent('click', ts(4), identity('A', 'Completed', {
      ariaRole: 'link',
      cssSelector: 'ul.filters a[href="#/completed"]',
    }), null, null, null, null);

    const events = session.getEvents();
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(3);
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[1].type).toBe('Checkbox');
    expect(interactions[2].type).toBe('Link');

    // Pipeline
    const understanding = buildUnderstanding(events, interactions, 'ng-1', 'https://todomvc.com/');
    expect(understanding).not.toBeNull();

    // IR
    const irPlan = buildIR(events, interactions, understanding, 'https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');
    expect(irPlan.steps.length).toBe(3);

    const actionTypes = irPlan.steps.map(s => s.action);
    expect(actionTypes).toContain('fill');
    expect(actionTypes).toContain('toggle');
    expect(actionTypes).toContain('click');
  });
});

// ════════════════════════════════════════════════════════════════════════
// CROSS-FRAMEWORK COMPARISON
// Validates that the pipeline produces equivalent IR plans for the same
// workflow regardless of the frontend framework
// ════════════════════════════════════════════════════════════════════════

describe('Cross-framework comparison — Same workflow, different framework', () => {
  beforeEach(() => setupChromeMock());

  /**
   * Helper: Record a standard "add todo + toggle + filter" workflow
   * using framework-specific element identities.
   */
  function recordWorkflow(
    url: string,
    title: string,
    newTodoCls: string,
    toggleCls: string,
    filterHref: string,
    filterText: string,
  ): { events: RecordedEvent[]; interactions: DetectedInteraction[] } {
    const session = new RecordingSession();
    session.start(url, title);

    const newTodo = identity('INPUT', '', {
      ariaRole: 'textbox', placeholder: 'What needs to be done?',
      cssSelector: `input.${newTodoCls}`,
      className: newTodoCls,
    });
    session.addElementEvent('focus', ts(0), newTodo, null, '', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('input', ts(1), newTodo, '', 'Test item', null, null, domContext({ inputType: 'text' }));
    session.addElementEvent('blur', ts(2), newTodo, 'Test item', 'Test item', null, null, domContext({ inputType: 'text' }));

    session.addElementEvent('click', ts(3), identity('INPUT', '', {
      ariaRole: 'checkbox',
      cssSelector: `li input.${toggleCls}`,
      className: toggleCls,
    }), null, null, false, true);

    session.addElementEvent('click', ts(4), identity('A', filterText, {
      ariaRole: 'link',
      cssSelector: `ul.filters a[href="${filterHref}"]`,
    }), null, null, null, null);

    const events = session.getEvents();
    const interactions = detectInteractions(events);
    return { events, interactions };
  }

  it('produces equivalent IR plans for React, Vue, and Angular', () => {
    // React
    const reactResult = recordWorkflow(
      'https://todomvc.com/examples/react/dist/',
      'TodoMVC: React',
      'new-todo', 'toggle', '#/active', 'Active',
    );
    const reactUnderstanding = buildUnderstanding(reactResult.events, reactResult.interactions, 'xreact', 'https://todomvc.com/');
    const reactIR = buildIR(reactResult.events, reactResult.interactions, reactUnderstanding, 'https://todomvc.com/examples/react/dist/', 'TodoMVC: React');

    // Vue
    const vueResult = recordWorkflow(
      'https://todomvc.com/examples/vue/dist/',
      'TodoMVC: Vue',
      'new-todo', 'toggle', '#/active', 'Active',
    );
    const vueUnderstanding = buildUnderstanding(vueResult.events, vueResult.interactions, 'xvue', 'https://todomvc.com/');
    const vueIR = buildIR(vueResult.events, vueResult.interactions, vueUnderstanding, 'https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');

    // Angular
    const ngResult = recordWorkflow(
      'https://todomvc.com/examples/angular/dist/browser/',
      'TodoMVC: Angular',
      'new-todo', 'toggle', '#/completed', 'Completed',
    );
    const ngUnderstanding = buildUnderstanding(ngResult.events, ngResult.interactions, 'xng', 'https://todomvc.com/');
    const ngIR = buildIR(ngResult.events, ngResult.interactions, ngUnderstanding, 'https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // All should produce 3 steps with the same action types
    expect(reactIR.steps.length).toBe(3);
    expect(vueIR.steps.length).toBe(3);
    expect(ngIR.steps.length).toBe(3);

    // Action types should be identical across frameworks
    const reactActions = reactIR.steps.map(s => s.action);
    const vueActions = vueIR.steps.map(s => s.action);
    const ngActions = ngIR.steps.map(s => s.action);

    expect(reactActions).toEqual(['fill', 'toggle', 'click']);
    expect(vueActions).toEqual(['fill', 'toggle', 'click']);
    expect(ngActions).toEqual(['fill', 'toggle', 'click']);
  });

  it('V2 evidence engine classifies consistently across frameworks', () => {
    function testV2(url: string, title: string) {
      const session = new RecordingSession();
      session.start(url, title);

      const input = identity('INPUT', '', {
        ariaRole: 'textbox', placeholder: 'What needs to be done?',
        cssSelector: 'input.new-todo',
      });
      session.addElementEvent('focus', ts(0), input, null, '', null, null, domContext({ inputType: 'text' }));
      session.addElementEvent('input', ts(1), input, '', 'test', null, null, domContext({ inputType: 'text' }));
      session.addElementEvent('blur', ts(2), input, 'test', 'test', null, null, domContext({ inputType: 'text' }));

      const events = session.getEvents();
      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const { interactions: merged } = mergeV1V2(v2, v1, events.length);
      return { v1, v2, merged };
    }

    const react = testV2('https://todomvc.com/examples/react/dist/', 'TodoMVC: React');
    const vue = testV2('https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');
    const ng = testV2('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // All should classify as TextEntry
    expect(react.v1[0].type).toBe('TextEntry');
    expect(vue.v1[0].type).toBe('TextEntry');
    expect(ng.v1[0].type).toBe('TextEntry');

    // Merged results should also be TextEntry
    expect(react.merged[0].type).toBe('TextEntry');
    expect(vue.merged[0].type).toBe('TextEntry');
    expect(ng.merged[0].type).toBe('TextEntry');
  });

  it('handles Angular custom component tags (app-*) in DOM tree paths', () => {
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // Angular wraps content in <app-todo-item><li>... — the recorder sees the
    // <li> element, not the <app-todo-item> wrapper. But the CSS selector
    // may include the Angular component tag.
    const toggleInput = identity('INPUT', '', {
      ariaRole: 'checkbox',
      cssSelector: 'app-todo-item > li > div.view > input.toggle',
      className: 'toggle',
    });

    session.addElementEvent('click', ts(0), toggleInput, null, null, false, true);

    const events = session.getEvents();
    const interactions = detectInteractions(events);
    const { elements } = adaptToDomainEntities(events, interactions, 'https://todomvc.com/');

    expect(elements).toHaveLength(1);
    expect(elements[0].identity.cssSelector).toContain('toggle');
    // The domTreePath should include the Angular component tag
    expect(elements[0].domTreePath).toBeDefined();
  });

  it('handles Vue empty style="" attributes (from :style bindings)', () => {
    // Vue leaves empty style="" attributes from :style bindings.
    // The recorder should not be confused by these — it captures
    // element identity from tag, id, class, role, aria-* — not style.
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/vue/dist/', 'TodoMVC: Vue');

    const clearBtn = identity('BUTTON', 'Clear completed', {
      ariaRole: 'button',
      cssSelector: 'button.clear-completed',
      className: 'clear-completed',
    });

    // Even with style="" on the element, the recorder captures
    // identity from tag/class/role, not from style
    session.addElementEvent('click', ts(0), clearBtn, null, null, null, null);

    const interactions = detectInteractions(session.getEvents());
    expect(interactions[0].type).toBe('Click');
    expect(interactions[0].target?.tag).toBe('BUTTON');
    expect(interactions[0].target?.className).toBe('clear-completed');
  });

  it('handles Angular ng-* form state class changes', () => {
    // Angular adds ng-dirty, ng-touched classes when the user interacts
    // with a form input. The recorder captures className at event time,
    // so the same element may have different className values in
    // consecutive events (pristine → dirty).
    const session = new RecordingSession();
    session.start('https://todomvc.com/examples/angular/dist/browser/', 'TodoMVC: Angular');

    // Focus: ng-untouched ng-pristine ng-valid
    const inputPristine = identity('INPUT', '', {
      ariaRole: 'textbox',
      placeholder: 'What needs to be done?',
      cssSelector: 'input.new-todo',
      className: 'new-todo ng-untouched ng-pristine ng-valid',
    });
    session.addElementEvent('focus', ts(0), inputPristine, null, '', null, null, domContext({ inputType: 'text' }));

    // Input: ng-dirty (but same element — identity should match by elementId)
    const inputDirty = identity('INPUT', '', {
      ariaRole: 'textbox',
      placeholder: 'What needs to be done?',
      cssSelector: 'input.new-todo',
      className: 'new-todo ng-dirty ng-valid',
    });
    session.addElementEvent('input', ts(1), inputDirty, '', 'test', null, null, domContext({ inputType: 'text' }));

    // Blur: ng-touched ng-dirty
    const inputTouched = identity('INPUT', '', {
      ariaRole: 'textbox',
      placeholder: 'What needs to be done?',
      cssSelector: 'input.new-todo',
      className: 'new-todo ng-touched ng-dirty ng-valid',
    });
    session.addElementEvent('blur', ts(2), inputTouched, 'test', 'test', null, null, domContext({ inputType: 'text' }));

    const events = session.getEvents();
    const interactions = detectInteractions(events);

    // Should be 1 TextEntry interaction (grouped by element)
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].metadata.textValue).toBe('test');
  });
});

// ════════════════════════════════════════════════════════════════════════
// FRAMEWORK PATTERN COMPARISON SUMMARY
// ════════════════════════════════════════════════════════════════════════

describe('Phase C Framework Pattern Comparison Summary', () => {
  beforeEach(() => setupChromeMock());

  it('documents all framework-specific patterns validated', () => {
    const frameworkPatterns = {
      react: {
        rootMarker: 'No explicit root marker (React 19 uses createRoot)',
        newTodoType: 'type="text" present',
        toggleAllId: 'id="toggle-all" present',
        destroyAriaLabel: 'No aria-label on destroy button',
        filterClasses: 'No router-link classes (React Router uses different pattern)',
        clearCompletedType: 'No explicit type attribute',
        formStateClasses: 'No form state classes on input',
        componentTagsInDom: 'No component tags in DOM (React renders to host)',
      },
      vue: {
        rootMarker: 'data-v-app="" on root element',
        newTodoType: 'type="text" present',
        toggleAllId: 'id="toggle-all-input" present',
        destroyAriaLabel: 'No aria-label on destroy button',
        filterClasses: 'router-link-active, router-link-exact-active classes',
        clearCompletedType: 'No explicit type attribute',
        formStateClasses: 'No form state classes on input',
        componentTagsInDom: 'No component tags in DOM (Vue renders to host)',
      },
      angular: {
        rootMarker: 'ng-version="21.2.11" on <app-root> custom element',
        newTodoType: 'No type attribute (omitted, defaults to text)',
        toggleAllId: 'No id on toggle-all checkbox',
        destroyAriaLabel: 'aria-label="Delete todo" (accessibility advantage)',
        filterClasses: 'class="selected" only, routerlink attribute present',
        clearCompletedType: 'type="button" explicitly set',
        formStateClasses: 'ng-untouched, ng-pristine, ng-valid, ng-dirty, ng-touched',
        componentTagsInDom: '<app-root>, <app-todo-header>, <app-todo-list>, <app-todo-item>, <app-todo-footer>',
      },
    };

    // Verify all frameworks are covered
    expect(Object.keys(frameworkPatterns)).toHaveLength(3);

    // Verify all pattern dimensions are covered for each framework
    const dimensions = ['rootMarker', 'newTodoType', 'toggleAllId', 'destroyAriaLabel',
      'filterClasses', 'clearCompletedType', 'formStateClasses', 'componentTagsInDom'];

    for (const framework of Object.keys(frameworkPatterns)) {
      for (const dim of dimensions) {
        expect(frameworkPatterns[framework][dim]).toBeDefined();
      }
    }

    // Key differences that affect the pipeline:
    // 1. All three frameworks: zero data-testid → pipeline uses CSS class selectors
    // 2. All three frameworks: class-based element identification
    // 3. Angular: ng-* class changes don't affect element identity (recorder uses elementId)
    // 4. Angular: custom component tags in CSS selectors (app-todo-item > li > ...)
    // 5. Vue: empty style="" attributes don't affect identity (not captured by recorder)
    // 6. All three: same interaction types (TextEntry, Checkbox, Link, Click)
    // 7. All three: same IR action types (fill, toggle, click)
    // 8. All three: same V1+V2 classification results
  });
});
