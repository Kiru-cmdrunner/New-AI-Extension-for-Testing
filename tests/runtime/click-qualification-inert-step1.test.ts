/**
 * Capture-Time Click Qualification v1.2 — Step 1 (inert) — TDD-4 + no-consumer pin
 *
 * Part A (round-trip): ledger persistence + projection truth fix. A click
 * carrying clickQualification persists it on the ledger row; snapshot→restore
 * round-trips it (null-normalized on legacy rows); the projected Unclassified
 * twin carries the persisted vector (domContext.clickQualification +
 * metadata.invalidityCauses) and derives DomContext.disabled from FACTS
 * instead of the old hardcoded false.
 *
 * Part B (no-consumer pin, Step 1 form) — REWRITTEN by Click Qualification
 * v1.2 Step 2 (§13.1): the pre-gate is now live in ComponentRuntime.process.
 * The Step-1 inert pins ("verdict changes NO type") were contract pins for
 * the pre-wiring world and are inverted here into the Step-2 contract: the
 * runtime pre-gate IS the sole typing consumer of the verdict. The grep-pin
 * allowlist grows by component-runtime.ts, and the identical-types pins
 * are replaced by the behavioral pins in
 * tests/runtime/click-qualification-step2-wiring.test.ts (S2-1..S2-8).
 *
 * Spec: .drytis/specs/click-capture-qualification-v1.md §7, §8.1, §11, §13.1
 */

import { describe, it, expect } from 'vitest';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import type { ObservedEvent, ElementIdentity } from '../../src/shared/component-types';
import { qualifyClick, type ClickQualificationFacts } from '../../src/tap/click-qualification';

// ── Factories ──────────────────────────────────────────────────────────

function makeIdentity(over: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit',
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
    cssSelector: 'button',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: '',
    ...over,
  } as ElementIdentity;
}

function disabledClickEvent(eventId: string): ObservedEvent {
  const facts: ClickQualificationFacts = {
    disabledNative: true,
    disabledAttrNonNative: false,
    fieldsetDisabled: false,
    ariaDisabled: false,
    inertSubtree: false,
    pointerEventsNone: false,
    zeroSizeLifted: false,
    hitTest: { checked: false, miss: null },
    hitTarget: { kind: 'element', rawTag: 'BUTTON', lifted: false, liftStrategy: 'raw', rawInteractiveShaped: true },
  };
  return {
    eventId,
    eventType: 'click',
    timestamp: 1000,
    captureSeq: 1,
    isTrusted: true,
    target: makeIdentity(),
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: true,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: [],
      tabIndex: 0,
      clickQualification: qualifyClick(facts),
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 10,
    clientY: 10,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.test/',
    pageTitle: 'Test',
  } as unknown as ObservedEvent;
}

function legacyClickEvent(eventId: string): ObservedEvent {
  const ev = disabledClickEvent(eventId);
  delete (ev.domContext as any).clickQualification;
  ev.domContext.disabled = false;
  return ev;
}

// ── Part A: persistence + projection truth ─────────────────────────────

describe('Click qualification — ledger persistence + projection truth (v1.2 Step 1)', () => {
  it('append() persists the frozen qualification record on the ledger row', () => {
    const ledger = new EvidenceLedger();
    ledger.append(disabledClickEvent('evt-pA-1'));
    const entry = ledger.get('evt-pA-1')!;
    expect(entry.clickQualification).not.toBeNull();
    expect(entry.clickQualification!.verdict).toBe('provably-invalid');
    expect(entry.clickQualification!.causes).toEqual(['disabled-native']);
    expect(entry.clickQualification!.facts.disabledNative).toBe(true);
  });

  it('legacy events (no vector) persist null — not undefined, not fabricated', () => {
    const ledger = new EvidenceLedger();
    ledger.append(legacyClickEvent('evt-pB-1'));
    const entry = ledger.get('evt-pB-1')!;
    expect(entry.clickQualification).toBeNull();
  });

  it('snapshot→restore round-trips the record (restore-stable)', () => {
    const ledger = new EvidenceLedger();
    ledger.append(disabledClickEvent('evt-pC-1'));
    const snap = ledger.snapshot();
    const json = JSON.parse(JSON.stringify(snap)); // chrome.storage serialization
    const restored = new EvidenceLedger();
    restored.restore(json);
    const entry = restored.get('evt-pC-1')!;
    expect(entry.clickQualification?.verdict).toBe('provably-invalid');
    expect(entry.clickQualification?.causes).toEqual(['disabled-native']);
    expect(entry.clickQualification?.facts.hitTarget.rawTag).toBe('BUTTON');
  });

  it('legacy ROWS restore with explicit null normalization', () => {
    const legacyRow = {
      eventId: 'evt-pD-1',
      captureSeq: 1,
      pageId: 'pD',
      eventType: 'click',
      timestamp: 1,
      disposition: 'pending',
      targetTag: 'BUTTON',
      targetName: 'Submit',
      targetRole: null,
      targetIdentity: null,
      captureOrigin: null,
      ancestorRoles: null,
      ancestorClasses: null,
    };
    const ledger = new EvidenceLedger();
    ledger.restore([legacyRow as any]);
    expect(ledger.get('evt-pD-1')!.clickQualification).toBeNull();
  });

  it('projected Unclassified twin carries the persisted vector + causes; disabled derived from FACTS', () => {
    const ledger = new EvidenceLedger();
    ledger.append(disabledClickEvent('evt-pE-1'));
    const { interactions } = projectInteractions(ledger, []);
    const card = interactions.find((i) => i.type === 'Unclassified')!;
    expect(card).toBeTruthy();
    expect(card.triggerEvent.domContext.clickQualification?.verdict).toBe('provably-invalid');
    expect(card.metadata.invalidityCauses).toEqual(['disabled-native']);
    // Truth fix: no longer the hardcoded false — derived from the vector
    expect(card.triggerEvent.domContext.disabled).toBe(true);
  });

  it('legacy projected twin keeps disabled:false and NO vector (byte-identical legacy behavior)', () => {
    const ledger = new EvidenceLedger();
    ledger.append(legacyClickEvent('evt-pF-1'));
    const { interactions } = projectInteractions(ledger, []);
    const card = interactions.find((i) => i.type === 'Unclassified')!;
    expect(card.triggerEvent.domContext.disabled).toBe(false);
    expect(card.triggerEvent.domContext.clickQualification).toBeUndefined();
    expect(card.metadata.invalidityCauses).toBeUndefined();
  });

  it('qualified clicks project WITHOUT causes but WITH the vector (insufficient marker rides)', () => {
    const facts: ClickQualificationFacts = {
      disabledNative: false,
      disabledAttrNonNative: false,
      fieldsetDisabled: false,
      ariaDisabled: false,
      inertSubtree: false,
      pointerEventsNone: false,
      zeroSizeLifted: false,
      hitTest: { checked: false, miss: null },
      hitTarget: { kind: 'canvas', rawTag: 'BODY', lifted: false, liftStrategy: 'raw', rawInteractiveShaped: false },
    };
    const ev = disabledClickEvent('evt-pG-1');
    ev.domContext.clickQualification = qualifyClick(facts);
    const ledger = new EvidenceLedger();
    ledger.append(ev);
    const { interactions } = projectInteractions(ledger, []);
    const card = interactions.find((i) => i.type === 'Unclassified')!;
    expect(card.triggerEvent.domContext.clickQualification?.verdict).toBe('qualified');
    expect(card.triggerEvent.domContext.clickQualification?.insufficient).toBe(true);
    expect(card.metadata.invalidityCauses).toBeUndefined();
  });
});

// ── Part B: consumer-allowlist pin (rewritten for Step 2) ──────────────

describe('CONSUMER-ALLOWLIST pin — the pre-gate is the ONLY typing consumer (Step 2, §13.1)', () => {
  it('a provably-invalid click is stopped at the definition layer by the runtime pre-gate, not detectTrigger', async () => {
    // Step 2: click.detectTrigger claims unconditionally (§8.5). The ONLY
    // place a verdict stops a claim is the universal pre-gate in
    // ComponentRuntime.process. detectTrigger alone cannot distinguish
    // invalid from qualified — pinned here so the authority never drifts
    // back into the definition.
    const { clickDefinition } = await import('../../src/definitions/click');
    const trigger = clickDefinition.detectTrigger!(disabledClickEvent('evt-pin-1'));
    expect(trigger).toEqual({ type: 'Click' }); // unconditional claim
  });

  it('a pending invalid click PROJECTS to Unclassified with its causes (the pre-gate terminal path)', () => {
    // In Step 2 the invalid click stays pending (no definition claims it),
    // and STOP projection mints the Unclassified card carrying the vector.
    const ledger = new EvidenceLedger();
    ledger.append(disabledClickEvent('evt-pin-3'));
    const result = projectInteractions(ledger, []);
    const card = result.interactions.find((i) => i.type === 'Unclassified');
    expect(card).toBeTruthy();
    expect(card!.metadata.invalidityCauses).toEqual(['disabled-native']);
  });

  it('grep-pin (ir-bridge-noise-drop style): the ONLY src consumers of clickQualification are capture/ledger/projection + the runtime pre-gate', async () => {
    // Source-inspection pin. Step 2 grows the allowlist by exactly one
    // entry: the universal pre-gate in component-runtime.ts — the sole
    // TYPING consumer of the verdict (§8.1). Anything else fails.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const roots = ['src/definitions', 'src/runtime', 'src/generation', 'src/understanding', 'src/presentation', 'src/tap', 'src/background', 'src/sidepanel'];
    const allow = new Set([
      'src/tap/click-qualification.ts',     // computes it
      'src/tap/event-tap.ts',               // attaches it
      'src/runtime/evidence-ledger.ts',     // persists it
      'src/runtime/projection-engine.ts',   // display carry (§7)
      'src/runtime/component-runtime.ts',   // §8.1 universal pre-gate (Step 2)
      'src/shared/component-types.ts',      // type declarations
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          const rel = path.relative(process.cwd(), p).split(path.sep).join('/');
          if (allow.has(rel)) continue;
          const src = fs.readFileSync(p, 'utf8');
          if (src.includes('clickQualification') || src.includes('invalidityCauses')) {
            offenders.push(rel);
          }
        }
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));
    expect(offenders).toEqual([]);
  });
});
