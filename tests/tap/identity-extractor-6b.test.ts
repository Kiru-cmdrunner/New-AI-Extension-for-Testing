/**
 * Phase 6B — L1 vocabulary pin: extractIdentity captures dataAutoId.
 *
 * AC1 (spec .drytis/specs/phase-6b-locator-durability.md): extractIdentity()
 * populates the new optional dataAutoId field from the data-auto-id attribute;
 * absent → null. Identity remains a plain serializable object.
 */

import { describe, it, expect } from 'vitest';
import { extractIdentity } from '../../src/tap/identity-extractor';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  const found = host.firstElementChild!;
  document.body.appendChild(host);
  return found;
}

describe('6B AC1 — extractIdentity dataAutoId', () => {
  it('captures data-auto-id when present', () => {
    const target = el('<button data-auto-id="flight-card-F1">Book</button>');
    const identity = extractIdentity(target);
    expect(identity.dataAutoId).toBe('flight-card-F1');
  });

  it('null when the attribute is absent', () => {
    const target = el('<button>Book</button>');
    const identity = extractIdentity(target);
    expect(identity.dataAutoId).toBeNull();
  });

  it('empty-string attribute is normalized to null (honest absence)', () => {
    const target = el('<button data-auto-id="">Book</button>');
    const identity = extractIdentity(target);
    expect(identity.dataAutoId).toBeNull();
  });

  it('identity remains JSON-serializable with the new field', () => {
    const target = el('<input data-auto-id="from-airport" placeholder="From" />');
    const identity = extractIdentity(target);
    expect(() => JSON.stringify(identity)).not.toThrow();
    expect(JSON.parse(JSON.stringify(identity)).dataAutoId).toBe('from-airport');
  });
});
