/**
 * Unit tests for Component Runtime type contracts.
 *
 * These tests verify that the type system compiles correctly and that
 * the interfaces are structurally sound — they don't test logic (there
 * is no logic in component-types.ts), but they ensure TypeScript
 * correctly accepts valid shapes and the DEDUP_WINDOW_MS constant is
 * the value the architecture specifies.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.1
 */

import { describe, it, expect } from 'vitest';
import { DEDUP_WINDOW_MS } from '../../src/shared/component-types';
import type {
  BrowserEventType,
  ObservedEvent,
  InteractionType,
  ComponentState,
  ComponentEndState,
  ComponentTrigger,
  ComponentCompletion,
  ComponentContext,
  ComponentDefinition,
  ComponentInteraction,
  RuntimeConfig,
  DomContext,
} from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// Helper to create a minimal ElementIdentity
function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    className: null,
    name: null,
    stableId: 'test-el',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'input#test-el',
    xPath: '//input[@id=\'test-el\']',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
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

function makeObservedEvent(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  return {
    eventId: 'evt-page1-0001',
    eventType: 'click',
    timestamp: Date.now(),
    captureSeq: 1,
    isTrusted: true,
    target: makeIdentity(),
    domContext: makeDomContext(),
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
    pageUrl: 'https://example.com',
    pageTitle: 'Example',
    ...overrides,
  };
}

// ── Constants ──────────────────────────────────────────────────────────

describe('DEDUP_WINDOW_MS', () => {
  it('is 2000ms per architecture §4.3', () => {
    expect(DEDUP_WINDOW_MS).toBe(2000);
  });
});

// ── BrowserEventType ───────────────────────────────────────────────────

describe('BrowserEventType', () => {
  it('accepts all expected event types', () => {
    const types: BrowserEventType[] = [
      'click', 'mousedown', 'contextmenu', 'focus', 'blur',
      'input', 'change', 'mouseenter', 'mouseleave', 'keydown',
      'scroll', 'navigation',
      'dragstart', 'drop', 'submit',
    ];
    expect(types).toHaveLength(15);
  });
});

// ── InteractionType ────────────────────────────────────────────────────

describe('InteractionType', () => {
  it('accepts all interaction types', () => {
    const types: InteractionType[] = [
      'Click', 'TextEntry', 'Dropdown', 'Checkbox', 'RadioButton',
      'DatePicker', 'Hover', 'Link', 'FileUpload', 'Slider',
      'ColorInput', // was missing pre-7.4-B1 (stale count) — honest fix
      'Tab', 'Scroll', 'Navigation',
      'DragDrop', 'KeyboardShortcut', 'CompoundInteraction',
      'Expander', // 7.4-B1
      'Unclassified',
    ];
    expect(types).toHaveLength(19);
  });
});

// ── ComponentState ─────────────────────────────────────────────────────

describe('ComponentState', () => {
  it('accepts all 5 lifecycle states', () => {
    const states: ComponentState[] = [
      'triggering', 'active', 'completed', 'abandoned', 'interrupted',
    ];
    expect(states).toHaveLength(5);
  });
});

describe('ComponentEndState', () => {
  it('accepts the 3 terminal states', () => {
    const states: ComponentEndState[] = ['completed', 'abandoned', 'interrupted'];
    expect(states).toHaveLength(3);
  });
});

// ── ObservedEvent ──────────────────────────────────────────────────────

describe('ObservedEvent', () => {
  it('creates with all fields', () => {
    const event = makeObservedEvent();
    expect(event.eventId).toBe('evt-page1-0001');
    expect(event.eventType).toBe('click');
    expect(event.isTrusted).toBe(true);
    expect(event.target.tag).toBe('INPUT');
    expect(event.shiftKey).toBe(false);
  });

  it('creates a scroll event', () => {
    const event = makeObservedEvent({
      eventType: 'scroll',
      scrollDeltaY: 200,
      scrollDeltaX: 0,
    });
    expect(event.scrollDeltaY).toBe(200);
  });

  it('creates a keydown event', () => {
    const event = makeObservedEvent({
      eventType: 'keydown',
      key: 'Enter',
      code: 'Enter',
    });
    expect(event.key).toBe('Enter');
  });
});

// ── ComponentContext ───────────────────────────────────────────────────

describe('ComponentContext', () => {
  it('creates a valid context', () => {
    const triggerEvent = makeObservedEvent();
    const ctx: ComponentContext = {
      type: 'Click',
      state: 'triggering',
      lifecycleId: 'lc-001',
      trigger: triggerEvent.target,
      triggerEvent,
      memberEvents: [triggerEvent],
      scopeKeys: new Set(['test-el']),
      startTime: triggerEvent.timestamp,
      endTime: 0,
      data: {},
    };
    expect(ctx.type).toBe('Click');
    expect(ctx.state).toBe('triggering');
    expect(ctx.memberEvents).toHaveLength(1);
    expect(ctx.scopeKeys.has('test-el')).toBe(true);
  });

  it('allows arbitrary data in ctx.data', () => {
    const ctx: ComponentContext = {
      type: 'Dropdown',
      state: 'active',
      lifecycleId: 'lc-002',
      trigger: makeIdentity(),
      triggerEvent: makeObservedEvent(),
      memberEvents: [],
      scopeKeys: new Set(),
      startTime: 0,
      endTime: 0,
      data: { noOpSelection: true, selectedValue: 'India' },
    };
    expect(ctx.data.noOpSelection).toBe(true);
    expect(ctx.data.selectedValue).toBe('India');
  });
});

// ── ComponentDefinition ────────────────────────────────────────────────

describe('ComponentDefinition interface', () => {
  it('can define a minimal Click definition', () => {
    const def: ComponentDefinition = {
      type: 'Click',
      priority: 180,
      triggerEventTypes: new Set(['click', 'contextmenu'] as BrowserEventType[]),
      detectTrigger: () => ({ type: 'Click' }),
      isInScope: () => false,
      handleEvent: () => ({ endState: 'completed' }),
      shouldCancelOnOutside: () => false,
      buildResult: () => ({ metadata: { targetName: 'Submit' } }),
    };
    expect(def.type).toBe('Click');
    expect(def.priority).toBe(180);
  });

  it('can define a multi-event DatePicker definition', () => {
    const def: ComponentDefinition = {
      type: 'DatePicker',
      priority: 10,
      triggerEventTypes: new Set(['focus', 'click', 'mousedown'] as BrowserEventType[]),
      detectTrigger: () => ({ type: 'DatePicker' }),
      isInScope: () => true,
      handleEvent: () => null, // ongoing
      shouldCancelOnOutside: () => true,
      buildResult: () => ({ metadata: { selectedDate: '2026-07-26' } }),
    };
    expect(def.type).toBe('DatePicker');
    expect(def.priority).toBe(10);
  });
});

// ── ComponentInteraction ───────────────────────────────────────────────

describe('ComponentInteraction', () => {
  it('creates a completed Click interaction', () => {
    const triggerEvent = makeObservedEvent();
    const interaction: ComponentInteraction = {
      interactionId: 'int-0001',
      type: 'Click',
      trigger: triggerEvent.target,
      triggerEvent,
      memberEvents: [triggerEvent],
      startTime: triggerEvent.timestamp,
      endTime: triggerEvent.timestamp,
      endState: 'completed',
      metadata: { targetName: 'Login', clickType: 'click' },
    };
    expect(interaction.type).toBe('Click');
    expect(interaction.endState).toBe('completed');
    expect(interaction.metadata.targetName).toBe('Login');
  });

  it('creates an interrupted DatePicker interaction', () => {
    const interaction: ComponentInteraction = {
      interactionId: 'int-0002',
      type: 'DatePicker',
      trigger: makeIdentity(),
      triggerEvent: makeObservedEvent(),
      memberEvents: [],
      startTime: 1000,
      endTime: 2000,
      endState: 'interrupted',
      metadata: {},
    };
    expect(interaction.endState).toBe('interrupted');
  });
});

// ── RuntimeConfig ──────────────────────────────────────────────────────

describe('RuntimeConfig', () => {
  it('creates with onEmit callback', () => {
    const config: RuntimeConfig = {
      onEmit: (_interaction: ComponentInteraction) => { /* push to storage */ },
    };
    expect(typeof config.onEmit).toBe('function');
  });

  it('creates with initialInteractionId for MV3 recovery', () => {
    const config: RuntimeConfig = {
      onEmit: () => {},
      initialInteractionId: 5,
    };
    expect(config.initialInteractionId).toBe(5);
  });
});

// ── ComponentTrigger & ComponentCompletion ─────────────────────────────

describe('ComponentTrigger', () => {
  it('has a type field', () => {
    const trigger: ComponentTrigger = { type: 'Click' };
    expect(trigger.type).toBe('Click');
  });
});

describe('ComponentCompletion', () => {
  it('has an endState field', () => {
    const completion: ComponentCompletion = { endState: 'completed' };
    expect(completion.endState).toBe('completed');
  });

  it('can represent abandoned state', () => {
    const completion: ComponentCompletion = { endState: 'abandoned' };
    expect(completion.endState).toBe('abandoned');
  });
});
