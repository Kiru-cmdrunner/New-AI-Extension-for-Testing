/**
 * D7.5 — synthetic-navigation label invariance to attributed-GET status.
 *
 * Regression tests for the workflow-identity variance root cause: a
 * synthetic navigation interaction (the destination twin of a full-page
 * form submit / link click) whose outcome carries an api-operation
 * evidence row for the DESTINATION document GET must NOT be labeled
 * "Fetch data" — the label must be invariant whether that GET carries an
 * HTTP status (200) or none (null), because D7's canonicalization then
 * keeps the label token in one case and drops it in the other, splitting
 * workflow identity on a capture-timing race (F1 family).
 */
import { describe, it, expect } from 'vitest';
import { labelIntent } from '../../../src/understanding/enrichment/intent-labeler';
import { canonicalizeSteps, hashPattern } from '../../../src/understanding/enrichment/recorded-workflow';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import type { ActionOutcome } from '../../../src/understanding/outcome/outcome-types';

const DEST_URL = 'http://127.0.0.1:8098/cart.html?added=P100';

/** The synthetic navigation interaction (tag HTML, accessibleName = URL). */
function syntheticNavInteraction(): ComponentInteraction {
  return {
    interactionId: 'int-12',
    lifecycleId: 'lc-6',
    type: 'Unclassified',
    endState: 'completed',
    startTime: 1000,
    endTime: 1000,
    trigger: {
      accessibleName: DEST_URL,
      ariaLabel: `Navigation to ${DEST_URL}`,
      ariaRole: 'document',
      tag: 'HTML',
      href: DEST_URL,
      cssSelector: 'html',
      xPath: '/html',
      elementId: '',
      placeholder: null,
      ariaLabelledBy: null,
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      inputType: null,
      inIframe: false,
      shadowDom: false,
    },
    triggerEvent: {
      eventId: 'nav-1',
      eventType: 'navigation',
      timestamp: 1000,
      target: undefined as never,
    } as never,
    memberEvents: [],
    metadata: {},
    // D7.5 reads the interaction's OWN navigation destinations from
    // behavioralEvidence.applicationEvidence.navigation — the synthetic-nav
    // twin carries exactly one: the committed destination URL.
    behavioralEvidence: {
      applicationEvidence: {
        navigation: [{ type: 'full-reload', fromUrl: 'http://127.0.0.1:8098/product.html?id=P100', toUrl: DEST_URL, relativeTime: 0, batchIndex: null }],
      },
    },
  } as unknown as ComponentInteraction;
}

/** Outcome carrying api-operation evidence for the destination GET. */
function outcomeWithDestinationGet(status: number | null): ActionOutcome {
  return {
    interactionId: 'int-12',
    actionType: 'Unclassified',
    actionTarget: DEST_URL,
    outcome: status === null ? 'uncertain' : 'success',
    confidence: 0.7,
    confidenceLevel: 'medium',
    supportingEvidence: [
      {
        kind: 'api-operation',
        result: status === null ? 'uncertain' : 'success',
        weight: 1,
        // Exact outcome-determiner shape: "<op> API <method> <url> -> <status>"
        detail:
          status === null
            ? `get API GET ${DEST_URL} -> null`
            : `get API GET ${DEST_URL} -> 200`,
      },
    ],
    resultingEntities: [],
  } as unknown as ActionOutcome;
}

describe('D7.5 regression test 1 — synthetic nav never labeled "Fetch data" from its own destination GET', () => {
  it('status=200: api-operation evidence for the destination URL is skipped; label resolves via context path', () => {
    const label = labelIntent(syntheticNavInteraction(), outcomeWithDestinationGet(200));
    expect(label.intent).not.toBe('Fetch data');
    expect(label.resolutionPath).toBe('context');
    expect(label.intent).toBe(DEST_URL);
  });

  it('status=null (no vote → no evidence item): label is identical', () => {
    // Status null → the api op never voted → no evidence item → the
    // labeler falls to context. Both timing outcomes must agree.
    const label = labelIntent(syntheticNavInteraction(), outcomeWithDestinationGet(null));
    expect(label.intent).not.toBe('Fetch data');
    expect(label.resolutionPath).toBe('context');
    expect(label.intent).toBe(DEST_URL);
  });

  it('a NON-destination api-operation still labels via the api-operation path (fix is scoped)', () => {
    const interaction = syntheticNavInteraction();
    const outcome: ActionOutcome = {
      ...outcomeWithDestinationGet(200),
      supportingEvidence: [
        {
          interactionId: 'int-12',
          kind: 'api-operation',
          result: 'success',
          weight: 1,
          detail: 'post API POST http://127.0.0.1:8098/cart/add -> 200',
        },
      ],
    };
    const label = labelIntent(interaction, outcome);
    expect(label.intent).toBe('Submit form');
    expect(label.resolutionPath).toBe('api-operation');
  });
});

describe('D7.5 regression test 2 — workflow identity invariant to the destination GET status', () => {
  it('identical sessions differing only in the cart-GET status canonicalize to the same patternId', () => {
    // The step token produced for the synthetic nav under both timing
    // outcomes must canonicalize identically after the D7.5 fix.
    const labelWithStatus = labelIntent(syntheticNavInteraction(), outcomeWithDestinationGet(200));
    const labelWithoutStatus = labelIntent(syntheticNavInteraction(), outcomeWithDestinationGet(null));

    // Both produce the same token (the destination URL), so the step
    // sequences — and therefore the workflow identity — are identical.
    const stepsWithStatus = ['search products', 'go', 'navigate', '/product.html?id=p100', 'add to cart', labelWithStatus.intent];
    const stepsWithoutStatus = ['search products', 'go', 'navigate', '/product.html?id=p100', 'add to cart', labelWithoutStatus.intent];

    expect(labelWithStatus.intent).toBe(labelWithoutStatus.intent);
    expect(canonicalizeSteps(stepsWithStatus)).toEqual(canonicalizeSteps(stepsWithoutStatus));
    expect(hashPattern(stepsWithStatus)).toBe(hashPattern(stepsWithoutStatus));
  });

  it('pre-fix shape (label "Fetch data") would have split identity — the assertion this fix guarantees', () => {
    // Direct proof of the failure mode being prevented: the ambient label
    // is dropped by canonicalization while the URL token survives.
    const ambientSteps = ['search products', 'go', 'navigate', '/product.html?id=p100', 'add to cart', 'Fetch data'];
    const urlSteps = ['search products', 'go', 'navigate', '/product.html?id=p100', 'add to cart', DEST_URL];

    expect(hashPattern(ambientSteps)).not.toBe(hashPattern(urlSteps));
    // After D7.5 the labeler can no longer produce the ambient form for
    // the destination-GET case (covered by test 1), so identity converges.
  });
});
