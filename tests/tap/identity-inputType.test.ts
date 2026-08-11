/**
 * M1 Unit Tests: inputType field in extractIdentity()
 *
 * Verifies that extractIdentity() correctly returns the inputType field
 * for HTMLInputElement, HTMLSelectElement, HTMLTextAreaElement, and null
 * for non-form elements.
 *
 * Architecture: Behavioral Evidence Model v3.0 §8.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { extractIdentity } from '../../src/tap/identity-extractor';

describe('extractIdentity — inputType field (M1)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns "checkbox" for checkbox input', () => {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.id = 'cb';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('checkbox');
  });

  it('returns "radio" for radio input', () => {
    const el = document.createElement('input');
    el.type = 'radio';
    el.id = 'rd';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('radio');
  });

  it('returns "text" for text input', () => {
    const el = document.createElement('input');
    el.type = 'text';
    el.id = 'txt';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('text');
  });

  it('returns "email" for email input', () => {
    const el = document.createElement('input');
    el.type = 'email';
    el.id = 'email';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('email');
  });

  it('returns "password" for password input', () => {
    const el = document.createElement('input');
    el.type = 'password';
    el.id = 'pw';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('password');
  });

  it('returns "number" for number input', () => {
    const el = document.createElement('input');
    el.type = 'number';
    el.id = 'num';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('number');
  });

  it('returns "range" for range slider', () => {
    const el = document.createElement('input');
    el.type = 'range';
    el.id = 'rng';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('range');
  });

  it('returns "date" for date input', () => {
    const el = document.createElement('input');
    el.type = 'date';
    el.id = 'dt';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('date');
  });

  it('returns "submit" for submit button', () => {
    const el = document.createElement('input');
    el.type = 'submit';
    el.id = 'sbmt';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('submit');
  });

  it('returns "select-one" for select element', () => {
    const el = document.createElement('select');
    el.id = 'sel';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('select-one');
  });

  it('returns "select-multiple" for multi-select', () => {
    const el = document.createElement('select');
    el.multiple = true;
    el.id = 'selm';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('select-multiple');
  });

  it('returns "textarea" for textarea element', () => {
    const el = document.createElement('textarea');
    el.id = 'ta';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBe('textarea');
  });

  it('returns null for button element', () => {
    const el = document.createElement('button');
    el.id = 'btn';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBeNull();
  });

  it('returns null for div element', () => {
    const el = document.createElement('div');
    el.id = 'dv';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBeNull();
  });

  it('returns null for anchor element', () => {
    const el = document.createElement('a');
    el.id = 'lnk';
    el.href = 'https://example.com';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBeNull();
  });

  it('returns null for span element', () => {
    const el = document.createElement('span');
    el.id = 'spn';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    expect(identity.inputType).toBeNull();
  });

  it('returns default "text" when input type not set', () => {
    const el = document.createElement('input');
    el.id = 'default';
    document.body.appendChild(el);

    const identity = extractIdentity(el);
    // HTMLInputElement defaults to type='text'
    expect(identity.inputType).toBe('text');
  });
});
