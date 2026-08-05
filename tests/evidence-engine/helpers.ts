/**
 * Evidence Engine — Test Helpers
 *
 * Factory functions for creating RecordedEvent objects for testing.
 * These mirror the real event shapes from the recorder.
 */

import type { RecordedEvent, ElementRecordedEvent, DomContext } from '../../src/recorder/recorded-event.ts';
import type { ElementIdentity } from '../../src/shared/types.ts';

let eventCounter = 0;

function nextId(): string {
  return `evt-${String(++eventCounter).padStart(4, '0')}`;
}

export function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: '',
    ariaLabel: '',
    ariaLabelledBy: '',
    placeholder: '',
    tag: 'DIV',
    className: '',
    name: '',
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '',
    xPath: '',
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: `el-${eventCounter}`,
    ...overrides,
  };
}

function makeEvent(
  eventType: ElementRecordedEvent['eventType'],
  targetOverrides: Partial<ElementIdentity>,
  extras: Partial<ElementRecordedEvent>,
): ElementRecordedEvent {
  return {
    eventId: nextId(),
    eventType,
    timestamp: new Date().toISOString(),
    target: makeTarget(targetOverrides),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...extras,
  };
}

// ── DomContext helpers ─────────────────────────────────────────────────

export function domContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    ...overrides,
  };
}

/** Create a checkbox DomContext (inputType='checkbox') */
export function checkboxDomContext(): DomContext {
  return domContext({ inputType: 'checkbox' });
}

/** Create a radio DomContext (inputType='radio') */
export function radioDomContext(): DomContext {
  return domContext({ inputType: 'radio' });
}

/** Create a text input DomContext (inputType='text') */
export function textInputDomContext(): DomContext {
  return domContext({ inputType: 'text' });
}

/** Create a date input DomContext (inputType='date') */
export function dateInputDomContext(): DomContext {
  return domContext({ inputType: 'date' });
}

/** Create a combobox DomContext (ariaExpanded=true, ariaHasPopup='listbox') */
export function comboboxDomContext(expanded: boolean = true): DomContext {
  return domContext({ ariaExpanded: expanded, ariaHasPopup: 'listbox' });
}

/** Create an autocomplete DomContext (role=combobox, ariaAutoComplete='list') */
export function autocompleteDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return domContext({
    inputType: 'text',
    ariaExpanded: true,
    ariaHasPopup: 'listbox',
    ariaAutoComplete: 'list',
    ...overrides,
  });
}

/** Create a native datalist DomContext (listId set) */
export function datalistDomContext(listId: string = 'options'): DomContext {
  return domContext({
    inputType: 'text',
    listId,
  });
}

// ── Event factories ────────────────────────────────────────────────────

export function clickEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('click', targetOverrides, extras);
}

export function focusEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('focus', targetOverrides, extras);
}

export function blurEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('blur', targetOverrides, extras);
}

export function changeEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('change', targetOverrides, extras);
}

export function inputEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('input', targetOverrides, extras);
}

export function scrollEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('scroll', targetOverrides, extras);
}

export function dblclickEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('dblclick', targetOverrides, extras);
}

export function contextmenuEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('contextmenu', targetOverrides, extras);
}

export function mouseenterEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('mouseenter', targetOverrides, extras);
}

export function dragstartEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('dragstart', targetOverrides, extras);
}

export function dropEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  extras: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return makeEvent('drop', targetOverrides, extras);
}

export function navigationEvent(
  url: string,
  title = 'Test Page',
  transitionType?: string,
): RecordedEvent {
  return {
    eventId: nextId(),
    eventType: 'navigation',
    timestamp: new Date().toISOString(),
    url,
    title,
    transitionType,
  };
}

export function resetEventCounter(): void {
  eventCounter = 0;
}
