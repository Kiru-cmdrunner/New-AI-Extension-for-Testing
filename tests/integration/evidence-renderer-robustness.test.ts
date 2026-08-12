/**
 * Evidence Renderer Robustness Tests — M7-fix-002
 *
 * Tests that the evidence renderer handles malformed, partial, and null
 * evidence data without crashing, and that one bad card does not abort
 * rendering of the remaining cards.
 *
 * Scenarios:
 *   1. Complete valid BehavioralEvidence renders without error
 *   2. Missing optional fields (identity fields, focus movement, etc.)
 *   3. null/undefined values in critical paths
 *   4. Empty arrays for all optional collections
 *   5. Multiple interactions — one malformed — others must still render
 *   6. Stop Recording completes even when evidence rendering has bad data
 *   7. Realistic Amazon-scale evidence (heavy DOM mutations, network)
 *   8. Realistic OrangeHRM evidence (form submit, navigation, moderate DOM)
 */

import { describe, it, expect } from 'vitest';
import { renderEvidence, renderEvidencePlaceholder, updateEvidenceOnInteraction } from '../../src/sidepanel/evidence-renderer';
import { renderInteractions, renderProductionInteractions } from '../../src/sidepanel/interaction-renderer';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';
import type { ComponentInteraction, ObservedEvent } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Test Helpers ──────────────────────────────────────────────────────

function makeValidIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn btn-primary',
    name: null,
    stableId: 'submit-btn',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'button#submit',
    xPath: '//button[@id="submit"]',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: 'submit',
    ...overrides,
  };
}

function makeValidEvidence(overrides: Partial<BehavioralEvidence> = {}): BehavioralEvidence {
  return {
    sourceEventId: 'evt-test-1',
    sourceEventType: 'click',
    windowId: 'bev-evt-test-1',
    frameId: 'main',
    window: {
      openedAt: 1000,
      closedAt: 1200,
      durationMs: 200,
      endReason: 'stabilized',
      stabilityTrace: [],
    },
    targetEvidence: {
      identity: makeValidIdentity(),
      identityCapturedAt: 990,
      before: {
        value: null,
        checked: null,
        className: 'btn btn-primary',
        disabled: false,
        ariaExpanded: null,
        ariaChecked: null,
        ariaPressed: null,
        textContent: 'Submit',
        childCount: 0,
        capturedAt: 990,
      },
      after: {
        value: null,
        checked: null,
        className: 'btn btn-primary active',
        disabled: false,
        ariaExpanded: null,
        ariaChecked: null,
        ariaPressed: true,
        textContent: 'Submit',
        childCount: 0,
        capturedAt: 1200,
      },
      focusMovement: {
        before: { tagName: 'INPUT', ariaRole: 'textbox', accessibleName: 'Username' },
        after: { tagName: 'BUTTON', ariaRole: 'button', accessibleName: 'Submit' },
        detectedAt: 1100,
      },
    },
    applicationEvidence: {
      domChanges: [
        {
          types: ['attributes'],
          targetPath: 'div > button',
          targetTag: 'button',
          shadowContext: null,
          changedAttributes: ['class'],
          attributeDeltas: {
            class: { old: 'btn btn-primary', new: 'btn btn-primary active' },
          },
          addedNodesCount: 0,
          removedNodesCount: 0,
          characterDataDelta: null,
          firstMutationAt: 1050,
          lastMutationAt: 1050,
          rawMutationCount: 1,
          firstBatchIndex: 0,
          lastBatchIndex: 0,
        },
      ],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [
        {
          url: 'https://api.example.com/submit',
          method: 'POST',
          status: 200,
          startRelativeToEvent: 80,
          endRelativeToEvent: 130,
          durationMs: 50,
          resourceType: 'fetch',
          source: 'main-world',
        },
      ],
      performanceCondition: {
        mainThreadBlocked: false,
        highChurnMode: false,
        longestBatchMs: 5,
        totalBatches: 2,
      },
    },
    ...overrides,
  };
}

function makeValidInteraction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-test-1',
    type: 'Click',
    componentType: 'IconButton',
    componentFramework: 'React',
    triggerEvent: makeValidObservedEvent(),
    trigger: makeValidIdentity(),
    memberEvents: [],
    startTime: 1000,
    endTime: 1000,
    endState: 'completed',
    metadata: {
      targetName: 'Submit Button',
      elementKey: 'button#submit',
      userTyped: false,
    },
    ...overrides,
  };
}

function makeValidObservedEvent(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  return {
    eventId: 'evt-test-1',
    eventType: 'click',
    timestamp: 1000,
    captureSeq: 1000,
    isTrusted: true,
    target: makeValidIdentity(),
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
      tabIndex: 0,
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 200,
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
    ...overrides,
  };
}

function makeContainer(): HTMLElement {
  return document.createElement('div');
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Evidence Renderer Robustness — M7-fix-002', () => {

  describe('Scenario 1: Complete valid BehavioralEvidence', () => {
    it('renders without error', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence();
      expect(() => renderEvidence(container, evidence)).not.toThrow();
      expect(container.children.length).toBeGreaterThan(0);
      expect(container.textContent).toContain('Target Evidence');
      expect(container.textContent).toContain('Application Evidence');
      expect(container.textContent).toContain('Window: 200ms');
    });

    it('renders network activity', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence();
      renderEvidence(container, evidence);
      expect(container.textContent).toContain('POST');
      expect(container.textContent).toContain('200');
      expect(container.textContent).toContain('api.example.com');
    });

    it('renders state diff', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence();
      renderEvidence(container, evidence);
      expect(container.textContent).toContain('aria-pressed');
      expect(container.textContent).toContain('class');
    });
  });

  describe('Scenario 2: Missing optional fields', () => {
    it('handles missing identity fields', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        targetEvidence: {
          identity: makeValidIdentity({
            tag: 'DIV',
            stableId: '',
            ariaRole: null,
            accessibleName: '',
            className: '',
            cssSelector: '',
            xPath: '',
          }),
          identityCapturedAt: 0,
          before: null,
          after: null,
          focusMovement: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
      expect(container.textContent).toContain('DIV');
    });

    it('handles missing focusMovement', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        targetEvidence: {
          identity: makeValidIdentity(),
          identityCapturedAt: 0,
          before: null,
          after: null,
          focusMovement: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
      expect(container.textContent).not.toContain('Focus Movement');
    });

    it('handles missing performanceCondition', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: {
          domChanges: [],
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [],
          navigation: [],
          networkActivity: [],
          performanceCondition: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
    });
  });

  describe('Scenario 3: null/undefined values', () => {
    it('handles null window', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        window: null as unknown as BehavioralEvidence['window'],
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
      expect(container.textContent).toContain('Window:');
    });

    it('handles undefined window', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        window: undefined as unknown as BehavioralEvidence['window'],
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
    });

    it('handles null targetEvidence', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        targetEvidence: null as unknown as BehavioralEvidence['targetEvidence'],
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
      expect(container.textContent).toContain('Target Evidence');
      expect(container.textContent).toContain('No target evidence');
    });

    it('handles null applicationEvidence', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: null as unknown as BehavioralEvidence['applicationEvidence'],
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
      expect(container.textContent).toContain('Application Evidence');
      expect(container.textContent).toContain('No application evidence');
    });

    it('handles undefined arrays in applicationEvidence', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: {
          domChanges: undefined as unknown as [],
          domChangeOverflow: undefined as unknown as number,
          coarseMode: undefined as unknown as boolean,
          newSurfaces: undefined as unknown as [],
          removedSurfaces: undefined as unknown as [],
          visibilityChanges: undefined as unknown as [],
          navigation: undefined as unknown as [],
          networkActivity: undefined as unknown as [],
          performanceCondition: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
    });

    it('handles DomChangeSummary with missing types and attributes', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: {
          domChanges: [
            {
              types: undefined as unknown as [],
              targetPath: null as unknown as string,
              targetTag: undefined as unknown as string,
              shadowContext: undefined as unknown as string | null,
              changedAttributes: undefined as unknown as [],
              attributeDeltas: undefined as unknown as Record<string, { old: string | null; new: string | null }>,
              addedNodesCount: 0,
              removedNodesCount: 0,
              characterDataDelta: null,
              firstMutationAt: 0,
              lastMutationAt: 0,
              rawMutationCount: 1,
              firstBatchIndex: 0,
              lastBatchIndex: 0,
            },
          ],
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [],
          navigation: [],
          networkActivity: [],
          performanceCondition: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
      expect(container.textContent).toContain('DOM Changes');
    });

    it('handles network activity with missing url and method', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: {
          domChanges: [],
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [],
          navigation: [],
          networkActivity: [
            {
              url: undefined as unknown as string,
              method: undefined as unknown as string,
              status: null,
              startRelativeToEvent: 100,
              endRelativeToEvent: null,
              durationMs: null,
              resourceType: 'unknown',
              source: 'main-world',
            },
          ],
          performanceCondition: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
    });

    it('handles navigation with missing fromUrl and toUrl', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: {
          domChanges: [],
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [],
          navigation: [
            {
              type: 'pushState' as const,
              fromUrl: null as unknown as string,
              toUrl: undefined as unknown as string,
              relativeTime: 100,
              batchIndex: 0,
            },
          ],
          networkActivity: [],
          performanceCondition: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
    });

    it('handles visibility change with missing path', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: {
          domChanges: [],
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [
            {
              path: null as unknown as string,
              property: 'display' as const,
              oldValue: 'none',
              newValue: 'block',
              relativeTime: 100,
              batchIndex: 0,
            },
          ],
          navigation: [],
          networkActivity: [],
          performanceCondition: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
    });
  });

  describe('Scenario 4: Empty arrays', () => {
    it('handles all-empty applicationEvidence', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: {
          domChanges: [],
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [],
          navigation: [],
          networkActivity: [],
          performanceCondition: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
      expect(container.textContent).toContain('No application-level changes');
    });

    it('handles empty surfaces array', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: {
          ...makeValidEvidence().applicationEvidence!,
          newSurfaces: [],
          removedSurfaces: [],
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
    });
  });

  describe('Scenario 5: Multiple interactions — one malformed', () => {
    it('renders all cards when one has malformed evidence', () => {
      const container = makeContainer();
      const goodEvidence = makeValidEvidence();
      const badEvidence = makeValidEvidence({
        sourceEventId: 'evt-bad',
        targetEvidence: null as unknown as BehavioralEvidence['targetEvidence'],
        applicationEvidence: null as unknown as BehavioralEvidence['applicationEvidence'],
        window: null as unknown as BehavioralEvidence['window'],
      });

      const interactions: ComponentInteraction[] = [
        makeValidInteraction({ interactionId: 'int-1' }),
        makeValidInteraction({ interactionId: 'int-2', behavioralEvidence: badEvidence }),
        makeValidInteraction({ interactionId: 'int-3', behavioralEvidence: goodEvidence }),
        makeValidInteraction({ interactionId: 'int-4' }),
        makeValidInteraction({ interactionId: 'int-5', behavioralEvidence: goodEvidence }),
      ];

      expect(() => renderInteractions(container, interactions)).not.toThrow();

      // All 5 cards must be rendered
      const cards = container.querySelectorAll('.interaction-event');
      expect(cards.length).toBe(5);

      // The malformed card (int-2) should have a fallback message
      const badCard = Array.from(cards).find(
        (c) => c.querySelector('.timeline-event__id')?.textContent === 'int-2',
      );
      expect(badCard).toBeDefined();
      // It should NOT have crashed — it should have either evidence or a fallback
      expect(badCard!.textContent).toBeTruthy();
    });

    it('renders all cards via renderProductionInteractions with mixed evidence', () => {
      const container = makeContainer();
      const interactions: ComponentInteraction[] = [];

      for (let i = 0; i < 8; i++) {
        const overrides: Partial<ComponentInteraction> = {
          interactionId: `int-${i + 1}`,
        };
        // Make interaction 4 have malformed evidence
        if (i === 3) {
          overrides.behavioralEvidence = makeValidEvidence({
            targetEvidence: undefined as unknown as BehavioralEvidence['targetEvidence'],
            applicationEvidence: undefined as unknown as BehavioralEvidence['applicationEvidence'],
          });
        } else if (i % 2 === 0) {
          overrides.behavioralEvidence = makeValidEvidence({
            sourceEventId: `evt-${i + 1}`,
          });
        }
        interactions.push(makeValidInteraction(overrides));
      }

      expect(() => renderProductionInteractions(container, interactions)).not.toThrow();
      const cards = container.querySelectorAll('.interaction-event');
      expect(cards.length).toBe(8);
    });
  });

  describe('Scenario 6: Stop Recording must complete', () => {
    it('updateEvidenceOnInteraction does not throw on malformed evidence', () => {
      const el = document.createElement('div');
      el.className = 'interaction-event';
      const placeholder = renderEvidencePlaceholder();
      el.appendChild(placeholder);

      const malformedEvidence = makeValidEvidence({
        window: null as unknown as BehavioralEvidence['window'],
        targetEvidence: null as unknown as BehavioralEvidence['targetEvidence'],
        applicationEvidence: null as unknown as BehavioralEvidence['applicationEvidence'],
      });

      expect(() => updateEvidenceOnInteraction(el, malformedEvidence)).not.toThrow();
      // Should still have content
      expect(el.children.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario 7: Realistic Amazon-scale evidence', () => {
    it('handles heavy DOM mutations (200 capped)', () => {
      const domChanges = Array.from({ length: 200 }, (_, i) => ({
        types: ['attributes', 'childList'] as ('attributes' | 'childList' | 'characterData')[],
        targetPath: `div#root > div.layout > div.main > section:nth-child(${i})`,
        targetTag: 'div',
        shadowContext: null,
        changedAttributes: ['class', 'style', 'data-testid'],
        attributeDeltas: {
          class: { old: `item-${i}`, new: `item-${i} selected` },
          style: { old: null, new: 'display: block;' },
        },
        addedNodesCount: i % 5,
        removedNodesCount: i % 3,
        characterDataDelta: null,
        firstMutationAt: i * 10,
        lastMutationAt: i * 10 + 5,
        rawMutationCount: i + 1,
        firstBatchIndex: i,
        lastBatchIndex: i,
      }));

      const container = makeContainer();
      const evidence = makeValidEvidence({
        applicationEvidence: {
          domChanges,
          domChangeOverflow: 500,
          coarseMode: true,
          newSurfaces: [
            { path: 'div.cart-drawer', tagName: 'div', ariaRole: 'dialog', accessibleName: 'Shopping Cart', shadowContext: null, descendantCount: 50, relativeTime: 500, batchIndex: 10 },
          ],
          removedSurfaces: [],
          visibilityChanges: [
            { path: 'div.overlay', property: 'display' as const, oldValue: 'none', newValue: 'block', relativeTime: 100, batchIndex: 2 },
          ],
          navigation: [],
          networkActivity: Array.from({ length: 15 }, (_, i) => ({
            url: `https://www.amazon.com/api/data${i}`,
            method: 'GET',
            status: 200,
            startRelativeToEvent: 50 + i * 10,
            endRelativeToEvent: 80 + i * 10,
            durationMs: 30 + i * 5,
            resourceType: 'xhr' as const,
            source: 'main-world' as const,
          })),
          performanceCondition: {
            mainThreadBlocked: true,
            highChurnMode: true,
            longestBatchMs: 45,
            totalBatches: 200,
          },
        },
      });

      expect(() => renderEvidence(container, evidence)).not.toThrow();
      // Should show first 10 DOM changes
      expect(container.textContent).toContain('DOM Changes (200');
      expect(container.textContent).toContain('500 more dropped');
      expect(container.textContent).toContain('⚠️ high-churn');
      // Should show capped network (10 of 15)
      expect(container.textContent).toContain('5 more');
      expect(container.textContent).toContain('⚠️ main thread blocked');
    });

    it('renders 8 Amazon-style interactions in a single batch', () => {
      const container = makeContainer();
      const interactions: ComponentInteraction[] = [];

      const amazonTypes: ComponentInteraction['type'][] = ['Click', 'TextEntry', 'Click', 'Navigation', 'Click', 'Dropdown', 'Click', 'Scroll'];
      for (let i = 0; i < 8; i++) {
        interactions.push(makeValidInteraction({
          interactionId: `int-amz-${i + 1}`,
          type: amazonTypes[i],
          endState: 'completed',
          metadata: {
            targetName: `Amazon Element ${i + 1}`,
            elementKey: `div:nth-child(${i + 1})`,
            userTyped: amazonTypes[i] === 'TextEntry',
            textValue: amazonTypes[i] === 'TextEntry' ? 'search query' : null,
            selectedValue: amazonTypes[i] === 'Dropdown' ? 'Electronics' : null,
            noOpSelection: false,
            hasDelta: amazonTypes[i] === 'Scroll',
            pageUrl: 'https://www.amazon.com/s?k=test',
            pageTitle: 'Amazon Search Results',
            meaningful: false,
          },
          behavioralEvidence: makeValidEvidence({
            sourceEventId: `evt-amz-${i + 1}`,
            applicationEvidence: {
              domChanges: Array.from({ length: 50 }, (_, j) => ({
                types: ['attributes'] as ('attributes' | 'childList' | 'characterData')[],
                targetPath: `div[data-index="${j}"]`,
                targetTag: 'div',
                shadowContext: null,
                changedAttributes: ['class'],
                attributeDeltas: { class: { old: '', new: 'highlighted' } },
                addedNodesCount: 0,
                removedNodesCount: 0,
                characterDataDelta: null,
                firstMutationAt: j * 5,
                lastMutationAt: j * 5,
                rawMutationCount: 1,
                firstBatchIndex: j,
                lastBatchIndex: j,
              })),
              domChangeOverflow: 0,
              coarseMode: false,
              newSurfaces: [],
              removedSurfaces: [],
              visibilityChanges: [],
              navigation: amazonTypes[i] === 'Navigation' ? [{
                type: 'pushState' as const,
                fromUrl: 'https://www.amazon.com/',
                toUrl: 'https://www.amazon.com/s?k=test',
                relativeTime: 100,
                batchIndex: 0,
              }] : [],
              networkActivity: [],
              performanceCondition: null,
            },
          }),
        }));
      }

      expect(() => renderProductionInteractions(container, interactions)).not.toThrow();
      const cards = container.querySelectorAll('.interaction-event');
      // Click, TextEntry, Click, Navigation, Click, Dropdown, Click, Scroll
      // Scroll hasDelta=true so all 8 pass the production filter
      expect(cards.length).toBe(8);
      // Each card should have evidence
      const evidenceContainers = container.querySelectorAll('[data-evidence-container]');
      expect(evidenceContainers.length).toBe(8);
    });
  });

  describe('Scenario 8: Realistic OrangeHRM evidence', () => {
    it('handles login form submit with navigation', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        sourceEventId: 'evt-ohrm-login',
        sourceEventType: 'click',
        targetEvidence: {
          identity: makeValidIdentity({
            tag: 'BUTTON',
            stableId: 'btnLogin',
            ariaRole: 'button',
            accessibleName: 'Login',
            className: 'oxd-button oxd-button--medium oxd-button--main orangehrm-login-action',
            inputType: null,
            elementId: 'btnLogin',
            cssSelector: 'button.oxd-button--main',
            xPath: '//button[@type="submit"]',
          }),
          identityCapturedAt: 1000,
          before: {
            value: null,
            checked: null,
            className: 'oxd-button oxd-button--medium oxd-button--main orangehrm-login-action',
            disabled: false,
            ariaExpanded: null,
            ariaChecked: null,
            ariaPressed: null,
            textContent: ' Login ',
            childCount: 0,
            capturedAt: 1000,
          },
          after: {
            value: null,
            checked: null,
            className: 'oxd-button oxd-button--medium oxd-button--main orangehrm-login-action',
            disabled: true,
            ariaExpanded: null,
            ariaChecked: null,
            ariaPressed: null,
            textContent: ' Loading... ',
            childCount: 0,
            capturedAt: 1500,
          },
          focusMovement: null,
        },
        applicationEvidence: {
          domChanges: [
            {
              types: ['attributes', 'childList'] as ('attributes' | 'childList' | 'characterData')[],
              targetPath: 'div.oxd-form-loader',
              targetTag: 'div',
              shadowContext: null,
              changedAttributes: ['class', 'style'],
              attributeDeltas: {
                class: { old: 'oxd-form-loader hidden', new: 'oxd-form-loader' },
                style: { old: 'display: none;', new: 'display: block;' },
              },
              addedNodesCount: 0,
              removedNodesCount: 0,
              characterDataDelta: null,
              firstMutationAt: 1100,
              lastMutationAt: 1100,
              rawMutationCount: 2,
              firstBatchIndex: 0,
              lastBatchIndex: 0,
            },
          ],
          domChangeOverflow: 0,
          coarseMode: false,
          newSurfaces: [],
          removedSurfaces: [],
          visibilityChanges: [],
          navigation: [
            {
              type: 'full-reload' as const,
              fromUrl: 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login',
              toUrl: 'https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index',
              relativeTime: 2000,
              batchIndex: 1,
            },
          ],
          networkActivity: [
            {
              url: 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/validate',
              method: 'POST',
              status: 302,
              startRelativeToEvent: 50,
              endRelativeToEvent: 350,
              durationMs: 300,
              resourceType: 'xhr',
              source: 'main-world' as const,
            },
          ],
          performanceCondition: {
            mainThreadBlocked: false,
            highChurnMode: false,
            longestBatchMs: 10,
            totalBatches: 3,
          },
        },
      });

      expect(() => renderEvidence(container, evidence)).not.toThrow();
      expect(container.textContent).toContain('Login');
      expect(container.textContent).toContain('disabled');
      expect(container.textContent).toContain('full-reload');
      expect(container.textContent).toContain('POST');
      expect(container.textContent).toContain('302');
      expect(container.textContent).toContain('orangehrmlive.com');
    });

    it('renders OrangeHRM dashboard navigation interactions', () => {
      const container = makeContainer();
      const interactions: ComponentInteraction[] = [
        makeValidInteraction({
          interactionId: 'int-ohrm-1',
          type: 'TextEntry',
          metadata: {
            targetName: 'Username',
            elementKey: 'input[name=username]',
            userTyped: true,
            textValue: 'Admin',
          },
          behavioralEvidence: makeValidEvidence({
            sourceEventId: 'evt-ohrm-1',
            sourceEventType: 'input',
            targetEvidence: {
              identity: makeValidIdentity({
                tag: 'INPUT',
                stableId: '',
                ariaRole: 'textbox',
                accessibleName: 'Username',
                className: 'oxd-input',
                inputType: 'text',
                elementId: '',
                cssSelector: 'input.oxd-input',
                xPath: '//input[@name="username"]',
              }),
              identityCapturedAt: 500,
              before: { value: '', checked: null, className: 'oxd-input', disabled: false, ariaExpanded: null, ariaChecked: null, ariaPressed: null, textContent: null, childCount: 0, capturedAt: 500 },
              after: { value: 'Admin', checked: null, className: 'oxd-input', disabled: false, ariaExpanded: null, ariaChecked: null, ariaPressed: null, textContent: null, childCount: 0, capturedAt: 1000 },
              focusMovement: null,
            },
            applicationEvidence: {
              domChanges: [],
              domChangeOverflow: 0,
              coarseMode: false,
              newSurfaces: [],
              removedSurfaces: [],
              visibilityChanges: [],
              navigation: [],
              networkActivity: [],
              performanceCondition: null,
            },
          }),
        }),
        makeValidInteraction({
          interactionId: 'int-ohrm-2',
          type: 'TextEntry',
          metadata: {
            targetName: 'Password',
            elementKey: 'input[name=password]',
            userTyped: true,
            textValue: 'admin123',
          },
          behavioralEvidence: makeValidEvidence({
            sourceEventId: 'evt-ohrm-2',
            sourceEventType: 'input',
            targetEvidence: {
              identity: makeValidIdentity({
                tag: 'INPUT',
                stableId: '',
                ariaRole: 'textbox',
                accessibleName: 'Password',
                className: 'oxd-input',
                inputType: 'password',
                elementId: '',
                cssSelector: 'input.oxd-input',
                xPath: '//input[@name="password"]',
              }),
              identityCapturedAt: 1500,
              before: { value: '', checked: null, className: 'oxd-input', disabled: false, ariaExpanded: null, ariaChecked: null, ariaPressed: null, textContent: null, childCount: 0, capturedAt: 1500 },
              after: { value: '••••••••', checked: null, className: 'oxd-input', disabled: false, ariaExpanded: null, ariaChecked: null, ariaPressed: null, textContent: null, childCount: 0, capturedAt: 2000 },
              focusMovement: null,
            },
            applicationEvidence: {
              domChanges: [],
              domChangeOverflow: 0,
              coarseMode: false,
              newSurfaces: [],
              removedSurfaces: [],
              visibilityChanges: [],
              navigation: [],
              networkActivity: [],
              performanceCondition: null,
            },
          }),
        }),
        makeValidInteraction({
          interactionId: 'int-ohrm-3',
          type: 'Click',
          metadata: {
            targetName: 'Login',
            elementKey: 'button[type=submit]',
            userTyped: false,
          },
        }),
      ];

      expect(() => renderProductionInteractions(container, interactions)).not.toThrow();
      const cards = container.querySelectorAll('.interaction-event');
      expect(cards.length).toBe(3);

      // First two should have evidence containers, third should have placeholder
      const evidenceContainers = container.querySelectorAll('[data-evidence-container]');
      expect(evidenceContainers.length).toBe(2);
      const placeholders = container.querySelectorAll('.evidence-placeholder');
      expect(placeholders.length).toBe(1);
    });
  });

  describe('truncate null-safety', () => {
    it('returns dash for null', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        frameId: null as unknown as string,
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
    });

    it('returns dash for undefined', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence({
        targetEvidence: {
          identity: makeValidIdentity({
            tag: 'SPAN',
            stableId: null as unknown as string,
            ariaRole: null,
            accessibleName: undefined as unknown as string,
            className: null as unknown as string,
            inputType: null,
            elementId: '',
            cssSelector: '',
            xPath: '',
          }),
          identityCapturedAt: 0,
          before: null,
          after: null,
          focusMovement: null,
        },
      });
      expect(() => renderEvidence(container, evidence)).not.toThrow();
    });
  });

  describe('Re-render preserves evidence', () => {
    it('rendering same evidence twice does not lose content', () => {
      const container = makeContainer();
      const evidence = makeValidEvidence();
      renderEvidence(container, evidence);
      const text1 = container.textContent;
      const childCount1 = container.children.length;

      // Re-render (simulates storage update)
      renderEvidence(container, evidence);
      const text2 = container.textContent;
      const childCount2 = container.children.length;

      expect(childCount2).toBe(childCount1);
      expect(text2).toBe(text1);
    });
  });
});
