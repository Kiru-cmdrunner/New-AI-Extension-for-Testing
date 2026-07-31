/**
 * Shared test fixture helpers for the unified type system.
 *
 * These helpers create ComponentInteraction objects for tests that previously
 * built DetectedInteraction fixtures. They bridge the gap by producing valid
 * ComponentInteraction objects whose resolved type (via interactionSubtype)
 * matches what the old DetectedInteraction.type would have been.
 */

import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ObservedEvent } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Reverse mapping: classifier type → component type ────────────────

const CLASSIFIER_TO_COMPONENT: Record<string, string> = {
  // Click family
  Click: 'Click', DoubleClick: 'Click', RightClick: 'Click',
  // Text
  TextEntry: 'TextEntry', RichTextEditor: 'TextEntry',
  // Dropdowns
  NativeDropdown: 'Dropdown', CustomDropdown: 'Dropdown',
  Autocomplete: 'Dropdown', MultiSelect: 'Dropdown',
  // Toggles
  Checkbox: 'Checkbox', ToggleSwitch: 'Checkbox',
  // Radio
  RadioButton: 'RadioButton',
  // Date
  DatePicker: 'DatePicker', TimePicker: 'DatePicker', DateTimePicker: 'DatePicker',
  // Other interactions
  Hover: 'Hover', Link: 'Link', FileUpload: 'FileUpload',
  Slider: 'Slider', Tab: 'Tab',
  PageScroll: 'Scroll', ContainerScroll: 'Scroll', InfiniteScroll: 'Scroll',
  DragDrop: 'DragDrop', KeyboardShortcut: 'KeyboardShortcut',
  ModalDialog: 'ModalDialog', Stepper: 'Stepper',
  TagInput: 'TagInput', OtpInput: 'OtpInput', HotkeySequence: 'HotkeySequence',
  NewTab: 'NewTab', NewWindow: 'NewWindow', Breadcrumb: 'Breadcrumb',
  // Navigation
  PageNavigation: 'Navigation', Back: 'Navigation', Forward: 'Navigation', Refresh: 'Navigation',
  // Types with no component mapping (will default to Click)
  Menu: 'Click', BrowserAlert: 'Click', Modal: 'ModalDialog',
  Drawer: 'Click', Popover: 'Click', Tooltip: 'Hover',
  Iframe: 'Click', DragDropUpload: 'FileUpload', Unknown: 'Click',
};

// ── Helpers ──────────────────────────────────────────────────────────

let eventCounter = 0;
function nextEventId(): string {
  eventCounter++;
  return `evt-${String(eventCounter).padStart(4, '0')}`;
}

let interactionCounter = 0;
function nextInteractionId(): string {
  interactionCounter++;
  return `int-${String(interactionCounter).padStart(4, '0')}`;
}

export function resetCounters(): void {
  eventCounter = 0;
  interactionCounter = 0;
}

export function makeElementIdentity(
  overrides: Partial<ElementIdentity> = {},
): ElementIdentity {
  return {
    accessibleName: 'Test Element',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn',
    name: '',
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'body > button',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

/**
 * Make an ObservedEvent for use as triggerEvent / memberEvents.
 */
export function makeObservedEvent(
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  const target = overrides.target ?? makeElementIdentity();
  return {
    eventId: nextEventId(),
    eventType: 'click',
    timestamp: Date.now(),
    isTrusted: true,
    target,
    domContext: {},
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 0,
    clientY: 0,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Test Page',
    ...overrides,
  };
}

/**
 * Build a ComponentInteraction from a resolved (classifier-style) type.
 *
 * This is the primary test fixture builder. Pass the type that the old
 * DetectedInteraction.type would have had (e.g., 'NativeDropdown',
 * 'DoubleClick', 'PageNavigation'). The helper maps it to the correct
 * ComponentInteraction.type and sets interactionSubtype accordingly.
 */
export function makeComponentInteraction(
  resolvedType: string,
  overrides: {
    trigger?: ElementIdentity | null;
    metadata?: Record<string, unknown>;
    endState?: 'completed' | 'abandoned' | 'interrupted' | 'discarded';
    triggerEvent?: ObservedEvent;
    memberEvents?: ObservedEvent[];
    interactionId?: string;
    pageUrl?: string;
    pageTitle?: string;
  } = {},
): ComponentInteraction {
  const componentType = CLASSIFIER_TO_COMPONENT[resolvedType] ?? 'Click';
  const isSubtype = resolvedType !== componentType;

  // Trigger: use override if explicitly provided (including null), else default
  const hasExplicitTrigger = 'trigger' in overrides;
  const trigger: ElementIdentity = hasExplicitTrigger
    ? (overrides.trigger as ElementIdentity)
    : makeElementIdentity();

  const triggerEvent = overrides.triggerEvent ?? makeObservedEvent({
    target: trigger,
    pageUrl: overrides.pageUrl,
    pageTitle: overrides.pageTitle,
  });
  const memberEvents = overrides.memberEvents ?? [triggerEvent];

  return {
    interactionId: overrides.interactionId ?? nextInteractionId(),
    type: componentType as ComponentInteraction['type'],
    ...(isSubtype ? { interactionSubtype: resolvedType } : {}),
    trigger,
    triggerEvent,
    memberEvents,
    startTime: Date.now(),
    endTime: Date.now(),
    endState: overrides.endState ?? 'completed',
    metadata: overrides.metadata ?? {},
  };
}
