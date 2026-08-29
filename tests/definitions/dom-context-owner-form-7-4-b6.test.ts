/**
 * Phase 7.4-B6 — DomContext owner-form fields (extractor unit pin)
 *
 * Spec: .drytis/specs/phase-7-4-b6-enter-submit-commit.md §4.2 (AC2)
 *
 * Pins the five new extractor fields on REAL jsdom DOM:
 *  - input inside <form> → formElementKey (elementKey chain), formAction,
 *    formMethod, formId, isFormSubmitControl per HTML semantics
 *  - input outside any form → all null (honest absence)
 *  - body/document targets → all null
 *  - submit-control ground truth: input[type=submit|image], button
 *    (no type = submit per HTML), button[type=button] NOT submit
 *
 * Addresses reviewer WARN 1 (AC2 unpinned): the positive path was proven
 * only by the real-Chrome storage dump before this file.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { extractDomContext } from '../../src/definitions/dom-context-extractor';
import { formJoinKey } from '../../src/definitions/patterns';
import type { ElementIdentity } from '../../src/shared/types';

function identityOf(el: Element): ElementIdentity {
  // The production extractor uses extractIdentity(form) → elementKey. For the
  // pin we reconstruct the same chain result via the documented priority:
  // our fixtures all use DOM ids, so elementKey = `id:<id>`.
  return { stableId: (el as HTMLElement).id || null } as unknown as ElementIdentity;
}

describe('DomContext owner-form fields (7.4-B6)', () => {
  beforeAll(() => {
    document.body.innerHTML = `
      <form id="search-form" action="/search-results.html" method="GET">
        <input id="q" type="text" aria-label="Search products" />
        <button id="go" type="submit">Search</button>
        <button id="clear" type="button">Clear</button>
        <input id="img-go" type="image" src="x.png" alt="Go" />
      </form>
      <form id="other-form" action="/elsewhere" method="POST">
        <input id="other-q" type="text" />
      </form>
      <input id="free-q" type="text" />
      <div id="plain-div">x</div>
    `;
  });

  it('AC2: input inside a form → formElementKey via elementKey chain (id), action/method/id captured', () => {
    const el = document.getElementById('q')!;
    const ctx = extractDomContext(el);
    expect(ctx.formElementKey).toBe('id:search-form');
    expect(ctx.formAction).toBe('/search-results.html');
    expect(ctx.formMethod).toBe('GET');
    expect(ctx.formId).toBe('search-form');
    // Non-submit control inside a form: join present, submit flag false
    expect(ctx.isFormSubmitControl).toBe(false);
  });

  it('AC2b: input outside any form → all form fields null (honest absence)', () => {
    const ctx = extractDomContext(document.getElementById('free-q')!);
    expect(ctx.formElementKey).toBeNull();
    expect(ctx.formAction).toBeNull();
    expect(ctx.formMethod).toBeNull();
    expect(ctx.formId).toBeNull();
    expect(ctx.isFormSubmitControl).toBe(false);
  });

  it('AC2c: non-control targets (div/body) → all form fields null', () => {
    const div = extractDomContext(document.getElementById('plain-div')!);
    expect(div.formElementKey).toBeNull();
    const body = extractDomContext(document.body);
    expect(body.formElementKey).toBeNull();
  });

  it('AC2d: submit-control ground truth per HTML semantics', () => {
    // button[type=submit] → true
    expect(extractDomContext(document.getElementById('go')!).isFormSubmitControl).toBe(true);
    // button[type=button] → false (would NOT submit)
    expect(extractDomContext(document.getElementById('clear')!).isFormSubmitControl).toBe(false);
    // input[type=image] → true (submits)
    expect(extractDomContext(document.getElementById('img-go')!).isFormSubmitControl).toBe(true);
    // text input → false
    expect(extractDomContext(document.getElementById('q')!).isFormSubmitControl).toBe(false);
  });

  it('AC2e: form without id → formId null, formElementKey still keyed via the elementKey chain', () => {
    const form = document.createElement('form');
    form.action = '/anon';
    document.body.appendChild(form);
    const input = document.createElement('input');
    input.type = 'text';
    form.appendChild(input);
    const ctx = extractDomContext(input);
    expect(ctx.formId).toBeNull();
    expect(ctx.formAction).toBe('/anon');
    // No id/testId/autoId/name → elementKey falls through to the selector chain;
    // non-null by construction (the join key exists), value shape not pinned here.
    expect(typeof ctx.formElementKey).toBe('string');
    expect(ctx.formElementKey).not.toBe('');
  });

  it('AC2f: formJoinKey composes with the captured field (the definition/bridge join)', () => {
    const el = document.getElementById('q')!;
    const ctx = extractDomContext(el);
    expect(formJoinKey(identityOf(el), ctx)).toBe('form:id:search-form');
    // An input in the OTHER form joins differently — no cross-form false match
    const otherCtx = extractDomContext(document.getElementById('other-q')!);
    expect(formJoinKey(identityOf(document.getElementById('other-q')!), otherCtx)).toBe(
      'form:id:other-form',
    );
  });
});
