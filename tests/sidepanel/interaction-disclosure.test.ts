/**
 * HEC v1 §9b (D-HEC-9) — renderer-level disclosure pins.
 *
 * Every interaction card must render the evidence-availability line built
 * from buildEvidenceDisclosures (recorded facts only), with honest
 * "not captured" for absent classes. Presentation-only — nothing in this
 * file may feed classification.
 *
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md §9b, §12 AC-23.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM(`<!doctype html><html><body><div id="host"></div></body></html>`);
  (globalThis as Record<string, unknown>).window = dom.window;
  (globalThis as Record<string, unknown>).document = dom.window.document;
  (globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
  (globalThis as Record<string, unknown>).Element = dom.window.Element;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).window = undefined;
  (globalThis as Record<string, unknown>).document = undefined;
});

function makeInteraction(overrides: Record<string, unknown> = {}): any {
  return {
    interactionId: 'int-1',
    type: 'Click',
    endState: 'completed',
    trigger: { tag: 'BUTTON', stableId: 'btn', accessibleName: 'Go' },
    memberEvents: [],
    metadata: {},
    ...overrides,
  };
}

describe('AC-23 renderer disclosure line', () => {
  it('renders the evidence — line on a card with recorded facts', async () => {
    const { createInteractionElement } = await import('../../src/sidepanel/interaction-renderer');
    const withEvidence = makeInteraction({
      behavioralEvidence: {
        applicationEvidence: {
          domChanges: [{ target: 'x', path: 'x', attributeDeltas: {} }],
          domChangeOverflow: 0,
          visibilityChanges: [],
          newSurfaces: [],
          networkActivity: [{ url: 'u' }],
          navigation: [],
        },
      },
    });
    const el = createInteractionElement(withEvidence);
    const line = el.querySelector('.interaction-disclosure');
    expect(line).toBeTruthy();
    const text = line!.textContent ?? '';
    expect(text.startsWith('evidence — ')).toBe(true);
    expect(text).toContain('DOM: 1');
    expect(text).toContain('network: 1');
    // Honest unavailability for classes with no recorded facts.
    expect(text).toContain('visibility: not captured');
    expect(text).toContain('surfaces: not captured');
  });

  it('renders all-not-captured honestly when no evidence envelope exists', async () => {
    const { createInteractionElement } = await import('../../src/sidepanel/interaction-renderer');
    const el = createInteractionElement(makeInteraction());
    const line = el.querySelector('.interaction-disclosure');
    expect(line).toBeTruthy();
    expect((line!.textContent ?? '').split('not captured').length - 1).toBe(7);
  });

  it('renders on Hover cards too (every interaction type)', async () => {
    const { createInteractionElement } = await import('../../src/sidepanel/interaction-renderer');
    const el = createInteractionElement(makeInteraction({
      type: 'Hover',
      metadata: {
        hoverQualification: { verdict: 'evidenced', evidenceClass: 'reveal', evidenceReason: 'reveal: x' },
        evidenceReason: 'reveal: x',
      },
    }));
    expect(el.querySelector('.interaction-disclosure')).toBeTruthy();
  });
});
