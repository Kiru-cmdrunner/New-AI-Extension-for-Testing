/**
 * UiElement entity tests.
 *
 * Tests factory validation, capability derivation, and component membership helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  createUiElement,
  deriveCapabilities,
  assignToComponent,
  removeFromComponent,
} from '../../src/domain/entities/ui-element';
import { IntrinsicCapability, ComponentRole } from '../../src/domain/enums';
import { MissingFieldError, ValueObjectError } from '../../src/domain/errors/invariant-errors';
import type { ElementIdentity } from '../../src/shared/types';

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    elementId: 'elem-0001',
    accessibleName: 'Test Button',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'button',
    className: 'btn-primary',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'button.btn-primary',
    xPath: '//button',
    inIframe: false,
    shadowDom: false,
    ...overrides,
  } as ElementIdentity;
}

describe('deriveCapabilities', () => {
  it('derives click+focus+hover for button tag', () => {
    const caps = deriveCapabilities('button', null, null);
    expect(caps).toContain(IntrinsicCapability.CLICK);
    expect(caps).toContain(IntrinsicCapability.FOCUS);
    expect(caps).toContain(IntrinsicCapability.HOVER);
  });

  it('derives acceptText for text input', () => {
    const caps = deriveCapabilities('input', null, 'text');
    expect(caps).toContain(IntrinsicCapability.ACCEPT_TEXT);
    expect(caps).toContain(IntrinsicCapability.FOCUS);
  });

  it('derives toggle for checkbox input', () => {
    const caps = deriveCapabilities('input', null, 'checkbox');
    expect(caps).toContain(IntrinsicCapability.TOGGLE);
    expect(caps).toContain(IntrinsicCapability.CLICK);
  });

  it('derives selectOption for option role', () => {
    const caps = deriveCapabilities('div', 'option', null);
    expect(caps).toContain(IntrinsicCapability.SELECT_OPTION);
    expect(caps).toContain(IntrinsicCapability.CLICK);
  });

  it('derives acceptText+focus for textarea', () => {
    const caps = deriveCapabilities('textarea', null, null);
    expect(caps).toContain(IntrinsicCapability.ACCEPT_TEXT);
    expect(caps).toContain(IntrinsicCapability.FOCUS);
  });

  it('derives toggle from aria checkbox role on generic div', () => {
    const caps = deriveCapabilities('div', 'checkbox', null);
    expect(caps).toContain(IntrinsicCapability.TOGGLE);
  });
});

describe('createUiElement', () => {
  it('creates element with all fields', () => {
    const el = createUiElement({
      elementId: 'elem-0001',
      identity: makeIdentity(),
      sourceUrl: 'https://app.example.com/login',
      domTreePath: 'html>body>div>button',
      domAttributes: { type: 'submit', 'data-testid': 'login-btn' },
    });
    expect(el.elementId).toBe('elem-0001');
    expect(el.sourceUrl).toBe('https://app.example.com/login');
    expect(el.componentId).toBeNull();
    expect(el.componentRole).toBeNull();
    expect(el.intrinsicCapabilities).toContain(IntrinsicCapability.CLICK);
    expect(el.domAttributes['type']).toBe('submit');
  });

  it('throws MissingFieldError when elementId is empty', () => {
    expect(() =>
      createUiElement({
        elementId: '',
        identity: makeIdentity(),
        sourceUrl: 'https://app.com',
        domTreePath: 'html',
      }),
    ).toThrow(MissingFieldError);
  });

  it('throws MissingFieldError when sourceUrl is empty', () => {
    expect(() =>
      createUiElement({
        elementId: 'elem-001',
        identity: makeIdentity(),
        sourceUrl: '',
        domTreePath: 'html',
      }),
    ).toThrow(MissingFieldError);
  });

  it('throws MissingFieldError when identity is null', () => {
    expect(() =>
      createUiElement({
        elementId: 'elem-001',
        identity: null as unknown as ElementIdentity,
        sourceUrl: 'https://app.com',
        domTreePath: 'html',
      }),
    ).toThrow(MissingFieldError);
  });

  it('throws ValueObjectError when componentId set without componentRole', () => {
    expect(() =>
      createUiElement({
        elementId: 'elem-001',
        identity: makeIdentity(),
        sourceUrl: 'https://app.com',
        domTreePath: 'html',
        componentId: 'comp-001',
        componentRole: null,
      }),
    ).toThrow(ValueObjectError);
  });

  it('throws ValueObjectError when componentRole set without componentId', () => {
    expect(() =>
      createUiElement({
        elementId: 'elem-001',
        identity: makeIdentity(),
        sourceUrl: 'https://app.com',
        domTreePath: 'html',
        componentId: null,
        componentRole: ComponentRole.TRIGGER,
      }),
    ).toThrow(ValueObjectError);
  });

  it('defaults domAttributes to empty object', () => {
    const el = createUiElement({
      elementId: 'elem-001',
      identity: makeIdentity(),
      sourceUrl: 'https://app.com',
      domTreePath: 'html',
    });
    expect(el.domAttributes).toEqual({});
  });
});

describe('assignToComponent', () => {
  it('assigns component ID and role', () => {
    const el = createUiElement({
      elementId: 'elem-001',
      identity: makeIdentity(),
      sourceUrl: 'https://app.com',
      domTreePath: 'html',
    });
    const updated = assignToComponent(el, 'comp-001', ComponentRole.TRIGGER);
    expect(updated.componentId).toBe('comp-001');
    expect(updated.componentRole).toBe(ComponentRole.TRIGGER);
  });

  it('throws on empty componentId', () => {
    const el = createUiElement({
      elementId: 'elem-001',
      identity: makeIdentity(),
      sourceUrl: 'https://app.com',
      domTreePath: 'html',
    });
    expect(() => assignToComponent(el, '', ComponentRole.TRIGGER)).toThrow(ValueObjectError);
  });

  it('preserves original element identity', () => {
    const el = createUiElement({
      elementId: 'elem-001',
      identity: makeIdentity({ accessibleName: 'Submit' }),
      sourceUrl: 'https://app.com',
      domTreePath: 'html',
    });
    const updated = assignToComponent(el, 'comp-001', ComponentRole.COMMIT);
    expect(updated.identity.accessibleName).toBe('Submit');
  });
});

describe('removeFromComponent', () => {
  it('removes component membership', () => {
    const el = createUiElement({
      elementId: 'elem-001',
      identity: makeIdentity(),
      sourceUrl: 'https://app.com',
      domTreePath: 'html',
      componentId: 'comp-001',
      componentRole: ComponentRole.TRIGGER,
    });
    const updated = removeFromComponent(el);
    expect(updated.componentId).toBeNull();
    expect(updated.componentRole).toBeNull();
  });
});
