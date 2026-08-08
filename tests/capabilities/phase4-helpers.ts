/**
 * Shared test helpers for Phase 4 cross-rule conflict tests.
 * Builds ComponentInteractions for engine-level testing.
 *
 * Uses DeepPartial so tests can override sub-fields (trigger.accessibleName,
 * triggerEvent.pageUrl, etc.) without providing every required field.
 * The returned object is always fully typed and complete.
 */

import type { ComponentInteraction } from '../../src/shared/component-types';
import type { DeepPartial } from '../helpers/deep-partial';
import { deepMerge } from '../helpers/deep-partial';

export function makeInteraction(overrides: DeepPartial<ComponentInteraction> = {}): ComponentInteraction {
  return deepMerge({
    interactionId: 'int-test-001',
    type: 'Click',
    trigger: {
      elementId: 'elem-001',
      accessibleName: 'Test',
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: 'body > button',
      xPath: '/html/body/button',
      inIframe: false,
      shadowDom: false,
      href: null,
    },
    triggerEvent: {
      eventId: 'evt-001',
      eventType: 'click',
      timestamp: 1000,
      captureSeq: 1,
      isTrusted: true,
      target: {
        elementId: 'elem-001',
        accessibleName: 'Test',
        ariaRole: null,
        ariaLabel: null,
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'BUTTON',
        className: null,
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        cssSelector: 'body > button',
        xPath: '/html/body/button',
        inIframe: false,
        shadowDom: false,
        href: null,
      },
      domContext: {
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
      },
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
      pageTitle: 'Example',
    },
    memberEvents: [],
    startTime: 1000,
    endTime: 2000,
    endState: 'completed',
    metadata: {},
  }, overrides);
}
