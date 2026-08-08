/**
 * Shared test fixture builders for the Semantic Test Intelligence codebase.
 *
 * These are STRICT fixture builders — they produce complete, type-correct
 * objects with inert defaults for every required field. Tests override only
 * the fields relevant to their assertions.
 *
 * Policy:
 *   - A test's intent lives in its expect() calls. Helpers fill non-assertion
 *     fields with inert defaults so the compiler is satisfied without weakening
 *     any assertion or broadening any expectation.
 *   - Every fixture uses the REAL type interface — no casts, no suppressions.
 *   - Overrides are typed as DeepPartial<T> — callers can override sub-fields
 *     (e.g. trigger.accessibleName) without providing every field.
 */

import type {
  ElementIdentity,
  DomContext,
  ObservedEvent,
  ComponentInteraction,
  BrowserEventType,
} from '../../src/shared/component-types';
import type { Element, LocatorStrategy } from '../../src/domain/entities/element';
import { ElementStatus, LocatorStrategyType } from '../../src/domain/enums';
import type { DeepPartial } from './deep-partial';
import { deepMerge } from './deep-partial';

// ── ElementIdentity ────────────────────────────────────────────────────

function defaultElementIdentity(): ElementIdentity {
  return {
    elementId: 'elem-001',
    accessibleName: 'Test Element',
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
  };
}

export function makeElementIdentity(
  overrides: DeepPartial<ElementIdentity> = {},
): ElementIdentity {
  return deepMerge(defaultElementIdentity(), overrides);
}

// ── DomContext ─────────────────────────────────────────────────────────

function defaultDomContext(): DomContext {
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
  };
}

export function makeDomContext(
  overrides: DeepPartial<DomContext> = {},
): DomContext {
  return deepMerge(defaultDomContext(), overrides);
}

// ── ObservedEvent ──────────────────────────────────────────────────────

function defaultObservedEvent(): ObservedEvent {
  return {
    eventId: 'evt-001',
    eventType: 'click' as BrowserEventType,
    timestamp: 1000,
    captureSeq: 1,
    isTrusted: true,
    target: defaultElementIdentity(),
    domContext: defaultDomContext(),
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
  };
}

export function makeObservedEvent(
  overrides: DeepPartial<ObservedEvent> = {},
): ObservedEvent {
  return deepMerge(defaultObservedEvent(), overrides);
}

// ── ComponentInteraction ───────────────────────────────────────────────

export function makeInteraction(
  overrides: DeepPartial<ComponentInteraction> = {},
): ComponentInteraction {
  return deepMerge({
    interactionId: 'int-test-001',
    type: 'Click',
    trigger: defaultElementIdentity(),
    triggerEvent: defaultObservedEvent(),
    memberEvents: [],
    startTime: 1000,
    endTime: 2000,
    endState: 'completed',
    metadata: {},
  }, overrides);
}

// ── LocatorStrategy ────────────────────────────────────────────────────

export function makeLocatorStrategy(
  overrides: DeepPartial<LocatorStrategy> = {},
): LocatorStrategy {
  return deepMerge({
    type: LocatorStrategyType.CSS,
    value: 'body > button',
    priority: 1,
    confidence: 1.0,
  }, overrides);
}

// ── Element (domain entity) ────────────────────────────────────────────

export function makeElement(
  overrides: DeepPartial<Element> = {},
): Element {
  return deepMerge({
    id: 'elem-001',
    projectId: 'proj-001',
    logicalName: 'Test Element',
    description: 'A test element',
    pageOrComponent: 'default',
    locatorStrategies: [makeLocatorStrategy()],
    status: ElementStatus.ACTIVE,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastHealedAt: null,
    healHistory: [],
  }, overrides);
}
