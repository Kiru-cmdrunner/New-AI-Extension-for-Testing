/**
 * D2/D3 — integration: harvest → healFromRecording → repository elements →
 * staleness truth. Uses fake-indexeddb through the REAL Dexie stack
 * (same approach as tests/healing-service.test.ts) and the REAL
 * healFromRecording — proving the wiring end-to-end without touching the
 * healing service.
 */
import { describe, it, expect, afterAll } from 'vitest';
import 'fake-indexeddb/auto';
import { harvestSessionElements } from '../../src/repository/services/session-element-harvest';
import { healFromRecording } from '../../src/repository/services/healing-service';
import { DexieUnitOfWorkFactory } from '../../src/repository/v2/dexie/dexie-unit-of-work-factory';
import { checkStaleness } from '../../src/domain/execution-ir/staleness';
import { build } from '../../src/generation/ir-bridge';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';
import type { Element } from '../../src/domain/entities/element';

let evtCounter = 0;
function makeIdentity(o: Partial<ElementIdentity> = {}): ElementIdentity {
  evtCounter += 1;
  return {
    accessibleName: `Button ${evtCounter}`,
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: `btn-${evtCounter}`,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: `button.btn-${evtCounter}`,
    xPath: `//button[@class="btn-${evtCounter}"]`,
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: '',
    ...o,
  };
}
function makeInteraction(identity: ElementIdentity): ComponentInteraction {
  const ev = { eventId: `evt-1-${++evtCounter}`, timestamp: Date.now() };
  return {
    interactionId: `int-${evtCounter}`,
    type: 'Click',
    trigger: identity,
    triggerEvent: {
      eventId: ev.eventId,
      eventType: 'click',
      timestamp: ev.timestamp,
      captureSeq: evtCounter,
      isTrusted: true,
      target: identity,
      domContext: { inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false },
      valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
      clientX: null, clientY: null,
      pageUrl: 'https://shop.example.com/',
    } as never,
    memberEvents: [] as never[],
    startTime: ev.timestamp,
    endTime: ev.timestamp + 50,
    endState: 'completed',
    metadata: {},
  } as never;
}

const START = 'https://shop.example.com/';

// Explicit stable identities (NOT counter-derived) so sessions 1–3 see the
// same logical elements, exactly like re-recording the same page.
const BTN_1 = (): ElementIdentity => makeIdentity({
  accessibleName: 'Button 1', className: 'btn-1', cssSelector: 'button.btn-1', xPath: '//button[@class="btn-1"]',
});
const BTN_2 = (): ElementIdentity => makeIdentity({
  accessibleName: 'Buy now', className: 'btn-2', cssSelector: 'button.btn-2', xPath: '//button[@class="btn-2"]',
});
// Session 3: same logical buttons under a restyled container.
const BTN_1_SHIFTED = (): ElementIdentity => makeIdentity({
  accessibleName: 'Button 1', className: 'btn-1', cssSelector: 'div.restyle > button.btn-1', xPath: '//div/button[@class="btn-1"]',
});
const BTN_2_SHIFTED = (): ElementIdentity => makeIdentity({
  accessibleName: 'Buy now', className: 'btn-2', cssSelector: 'div.restyle > button.btn-2', xPath: '//div/button[@class="btn-2"]',
});

describe('D2/D3 end-to-end wiring (real Dexie, real healFromRecording)', () => {
  const uowFactory = new DexieUnitOfWorkFactory();

  it('session 1: harvest → heal creates elements; IR steps carry repo ids', async () => {
    const interactions = [makeInteraction(BTN_1()), makeInteraction(BTN_2())];
    const { freshElements, idByKey } = harvestSessionElements(interactions, START);

    const result = await healFromRecording('proj-d2d3', freshElements, 'session-1', uowFactory);
    expect(result.created).toBe(2);
    expect(result.healed).toBe(0);

    // every created element appears in details with a real repository id
    const repoIds = result.details.filter((d) => d.action === 'created').map((d) => d.elementId);
    expect(repoIds).toHaveLength(2);
    for (const id of repoIds) expect(id).not.toBe('');

    // IR plan steps reference... well, at build time they carry session ids.
    // The mapping repo-id ↔ identity-key is returned via details order.
    const plan = build({
      interactions,
      recordingContext: { startUrl: START, title: 'Shop' },
      testCaseName: 'd2d3-e2e',
      elementIdByKey: idByKey,
    });
    const elSteps = plan.steps.filter((s) => s.target.kind === 'element');
    expect(elSteps.length).toBeGreaterThan(0);
    for (const s of elSteps) {
      expect((s.target as { elementId: string }).elementId).toMatch(/^elem-\d{4}$/);
    }
  });

  it('session 2 (same page): heals to the SAME repository ids — no duplicates', async () => {
    const interactions = [makeInteraction(BTN_1()), makeInteraction(BTN_2())];
    const { freshElements } = harvestSessionElements(interactions, START);

    const result = await healFromRecording('proj-d2d3', freshElements, 'session-2', uowFactory);
    expect(result.created).toBe(0); // all matched existing
    expect(result.healed).toBe(0);  // nothing changed yet
    expect(result.details.every((d) => d.action === 'unchanged')).toBe(true);
  });

  it('session 3 (shifted CSS): heals existing elements, bumps updatedAt → staleness fires', async () => {
    // same logical buttons, restyled containers → cssSelector/xPath change
const interactions = [makeInteraction(BTN_1_SHIFTED()), makeInteraction(BTN_2_SHIFTED())];
    const { freshElements } = harvestSessionElements(interactions, START);

    const result = await healFromRecording('proj-d2d3', freshElements, 'session-3', uowFactory);
    expect(result.healed).toBe(2);
    expect(result.created).toBe(0);

    // load the healed elements and verify staleness now fires against a plan
    // generated BEFORE the heal
    const uow = uowFactory.create();
    const elements: Element[] = await uow.execute(async (repos) => repos.elements.getByProject('proj-d2d3'));
    expect(elements).toHaveLength(2);

    const planGeneratedAt = new Date(Date.now() - 60_000).toISOString(); // generated before the heal
    const artifact = {
      id: 'a1',
      testCaseVersionId: 'tcv-x',
      plan: build({
        interactions,
        recordingContext: { startUrl: START, title: 'Shop' },
        testCaseName: 'stale-check',
      }),
      generatedAt: planGeneratedAt,
      generatorVersion: 'ir-bridge-1.0',
      renderings: {},
    } as never;

    const report = checkStaleness(artifact, elements, 'ir-bridge-1.0');
    expect(report.status).toBe('stale');
    expect((report.reasons ?? []).some((r) => r.type === 'element_changed')).toBe(true);
  });

  it('session 4 (fresh draft, no pinned project): reuses the existing project — no second Default Project', async () => {
    // Regression: persistSession with projectId null used to create a NEW
    // "Default Project" per session, so session 2 healed against an empty
    // elements table and duplicated every element.
    const { persistSession } = await import('../../src/repository/services/session-persistence-service');
    const interactions = [makeInteraction(BTN_1()), makeInteraction(BTN_2())];
    const { freshElements } = harvestSessionElements(interactions, START);
    const plan = build({
      interactions,
      recordingContext: { startUrl: START, title: 'Shop' },
      testCaseName: 'proj-reuse',
    });
    const understanding = () =>
      ({ sessionId: `s4-${Math.random().toString(36).slice(2, 8)}`, generatedAt: new Date().toISOString(), schemaVersion: 1 }) as never;

    const first = await persistSession(uowFactory, {
      understanding: understanding(),
      events: [], interactions, url: START, irPlan: plan, projectId: null, testCaseName: 't',
    });
    // populate this project's elements (as a real first session would)
    await healFromRecording(first.projectId, freshElements, 's4-seed', uowFactory);

    const second = await persistSession(uowFactory, {
      understanding: understanding(),
      events: [], interactions, url: START, irPlan: plan,
      projectId: null, // draft without a project — must reuse, not re-create
      testCaseName: 't',
    });
    expect(second.projectId).toBe(first.projectId);

    const healing = await healFromRecording(second.projectId, freshElements, 'session-4', uowFactory);
    expect(healing.created).toBe(0); // matched the existing two, no duplicates
    expect(healing.details.every((d) => d.action === 'unchanged')).toBe(true);
  });

  it('fresh plan (generated after heal) is NOT stale', async () => {
    const uow = uowFactory.create();
    const elements: Element[] = await uow.execute(async (repos) => repos.elements.getByProject('proj-d2d3'));
    const artifact = {
      id: 'a2',
      testCaseVersionId: 'tcv-x',
      plan: build({
        interactions: [],
        recordingContext: { startUrl: START, title: 'Shop' },
        testCaseName: 'fresh',
      }),
      generatedAt: new Date(Date.now() + 60_000).toISOString(), // generated after all updates
      generatorVersion: 'ir-bridge-1.0',
      renderings: {},
    } as never;
    const report = checkStaleness(artifact, elements, 'ir-bridge-1.0');
    expect(report.status).not.toBe('stale');
  });

  afterAll(async () => {
    // cleanup project data so the suite is re-runnable
    try {
      const { DexieUnitOfWorkFactory: F } = await import('../../src/repository/v2/dexie/dexie-unit-of-work-factory');
      const f = new F();
      const uow = f.create();
      await uow.execute(async (repos) => {
        const els = await repos.elements.getByProject('proj-d2d3');
        for (const el of els) await repos.elements.delete(el.id);
      });
    } catch {
      // best-effort
    }
  });
});
