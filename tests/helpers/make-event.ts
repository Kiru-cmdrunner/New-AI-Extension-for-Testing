/**
 * Test Helper: Create an ObservedEvent for unit tests.
 *
 * Provides a factory function that fills in defaults so test code
 * can specify only the fields that matter.
 */

import type { ObservedEvent, BrowserEventType, ElementIdentity, DomContext } from '../../src/shared/component-types';

const DEFAULT_DOM_CONTEXT: DomContext = {
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
};

const DEFAULT_TARGET: ElementIdentity = {
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
    inputType: null,
};

export function makeObservedEvent(
  overrides: Partial<Omit<ObservedEvent, 'target'>> & {
    eventId: string;
    eventType: BrowserEventType;
    target?: Partial<ElementIdentity>;
  },
): ObservedEvent {
  const target = overrides.target
    ? { ...DEFAULT_TARGET, ...overrides.target }
    : DEFAULT_TARGET;

  const { target: _omit, ...rest } = overrides;
  return {
    timestamp: Date.now(),
    captureSeq: 0,
    isTrusted: true,
    domContext: DEFAULT_DOM_CONTEXT,
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
    pageTitle: 'Test Page',
    ...rest,
    target,
  } as ObservedEvent;
}
