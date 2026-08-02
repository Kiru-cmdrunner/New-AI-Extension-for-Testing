/**
 * PATCH REGRESSION TESTS: isLink() corrective patch
 *
 * Permanent regression tests for the lifecycle-preemption fix.
 * Protects against:
 *   - Genuine link navigation remaining Link
 *   - Role overrides being respected
 *   - Action anchors not being silently classified as Link
 *   - Behavioral toggle evidence correcting structural ambiguity
 *   - Toggle semantics propagating to capability and P2
 */
import { describe, it, expect } from 'vitest';
import { createRuntime } from '../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../src/definitions';
import { annotateWithEvidence } from '../src/classifier/evidence/annotation-layer';
import { enrichInteraction } from '../src/enrichment';
import type {
  ComponentInteraction,
  ObservedEvent,
  ElementIdentity,
  DomContext,
  AttributeChange,
  RuntimeConfig,
} from '../src/shared/component-types';
import { isLink } from '../src/definitions/patterns';

// ── Production-faithful pipeline with annotation deferral ──

const liveInteractions: ComponentInteraction[] = [];
const pendingAnnotations: Array<{ interaction: ComponentInteraction; stableId: string }> = [];

function resetPipeline() {
  liveInteractions.length = 0;
  pendingAnnotations.length = 0;
}

function finalizeAnnotation(
  entry: { interaction: ComponentInteraction; stableId: string },
  attributeChanges?: AttributeChange[],
): void {
  const { interaction } = entry;
  if (attributeChanges && attributeChanges.length > 0) {
    interaction.metadata.attributeChanges = attributeChanges;
  }
  enrichInteraction(interaction);
  annotateWithEvidence(interaction);
  liveInteractions.push(interaction);
}

function finalizeAllPending(): void {
  for (const entry of pendingAnnotations) finalizeAnnotation(entry);
  pendingAnnotations.length = 0;
}

function runPipelineProduction(events: ObservedEvent[]): ComponentInteraction[] {
  resetPipeline();
  const config: RuntimeConfig = {
    onEmit: (interaction: ComponentInteraction) => {
      if (interaction.type === 'Click' && !interaction.interactionSubtype) {
        pendingAnnotations.push({
          interaction,
          stableId: interaction.trigger.stableId ?? '',
        });
      } else {
        enrichInteraction(interaction);
        annotateWithEvidence(interaction);
        liveInteractions.push(interaction);
      }
    },
  };
  const runtime = createRuntime(ALL_DEFINITIONS, config);

  for (const event of events) {
    if (event.eventType === 'attribute-change') {
      const stableId = event.target.stableId;
      const changes = event.domContext?.attributeChanges ?? [];
      const idx = pendingAnnotations.findIndex(p => p.stableId === stableId);
      if (idx >= 0) {
        const entry = pendingAnnotations.splice(idx, 1)[0];
        finalizeAnnotation(entry, changes);
      }
      if (pendingAnnotations.length > 0) finalizeAllPending();
    } else {
      finalizeAllPending();
      runtime.process(event);
    }
  }
  runtime.flush();
  finalizeAllPending();
  return [...liveInteractions];
}

// ── Helpers ──

function makeTarget(o: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null,
    cssSelector: 'div', xPath: '/html/body/div', inIframe: false, shadowDom: false,
    elementId: '', ...o,
  };
}

function makeContext(o: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [], ...o,
  };
}

const PAGE_URL = 'https://shop.example.com/products';

let _ec = 0;
function makeEvent(
  eventType: string,
  target: Partial<ElementIdentity>,
  domCtx: Partial<DomContext> = {},
  overrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  _ec++;
  return {
    eventId: `evt-${_ec}`, eventType: eventType as ObservedEvent['eventType'],
    timestamp: Date.now() + _ec, isTrusted: true,
    target: makeTarget(target), domContext: makeContext(domCtx),
    valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
    clientX: null, clientY: null, key: null, code: null,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: PAGE_URL, pageTitle: 'Products',
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════════

describe('PATCH-1: isLink() unit tests', () => {
  it('P1-A: Genuine link (tag A, no role override) → isLink true', () => {
    expect(isLink('A', null)).toBe(true);
  });

  it('P1-B: <a role="button"> → isLink false (role override)', () => {
    expect(isLink('A', 'button')).toBe(false);
  });

  it('P1-C: <a role="switch"> → isLink false (role override)', () => {
    expect(isLink('A', 'switch')).toBe(false);
  });

  it('P1-D: <a role="tab"> → isLink false (role override)', () => {
    expect(isLink('A', 'tab')).toBe(false);
  });

  it('P1-E: <a role="link"> → isLink true (explicit link role)', () => {
    expect(isLink('A', 'link')).toBe(true);
  });

  it('P1-F: ariaRole=link on non-A tag → isLink true', () => {
    expect(isLink('SPAN', 'link')).toBe(true);
  });
});

describe('PATCH-2: Genuine link navigation preserved', () => {
  it('P2-A: <a href="/home"> → Link type, navigate intent, confidence 1.0', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'Home', stableId: 'a-home' },
        { openedUrl: 'https://shop.example.com/home' },
      ),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Link');
    expect(result[0].intent).toBe('navigate');
    expect(result[0].confidence).toBe(1.0);
  });

  it('P2-B: <a href="/products?cat=electronics"> → Link type', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'Electronics', stableId: 'a-cat' },
        { openedUrl: 'https://shop.example.com/products?cat=electronics' },
      ),
    ]);
    expect(result[0].type).toBe('Link');
  });

  it('P2-C: Genuine link has lifecycle-definition evidence only (no R3)', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'About', stableId: 'a-about' },
        { openedUrl: 'https://shop.example.com/about' },
      ),
    ]);
    expect(result[0].evidenceTrail).toHaveLength(1);
    expect(result[0].evidenceTrail![0].source).toBe('lifecycle-definition');
  });
});

describe('PATCH-3: Role overrides respected', () => {
  it('P3-A: <a role="button"> → NOT Link', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'Show More', ariaRole: 'button', stableId: 'a-btn' },
        { openedUrl: 'https://shop.example.com/products#' },
      ),
    ]);
    expect(result[0].type).not.toBe('Link');
  });

  it('P3-B: <a role="switch"> → Checkbox (lifecycle match)', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'On Sale', ariaRole: 'switch', stableId: 'a-sw' },
        { openedUrl: 'https://shop.example.com/products#' },
      ),
    ]);
    expect(result[0].type).toBe('Checkbox');
    expect(result[0].confidence).toBe(1.0);
  });

  it('P3-C: <a role="tab"> → Tab (lifecycle match)', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'Products', ariaRole: 'tab', stableId: 'a-tab' },
        { openedUrl: 'https://shop.example.com/products#tab-products' },
      ),
    ]);
    expect(result[0].type).toBe('Tab');
    expect(result[0].confidence).toBe(1.0);
  });
});

describe('PATCH-4: Action anchors fall through to Click + R3 evidence', () => {
  it('P4-A: <a href="#"> with class change → Checkbox subtype via toggle evidence', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'On Sale', className: 'toggle-filter', stableId: 'a-onsale' },
        { openedUrl: 'https://shop.example.com/products#' },
      ),
      makeEvent('attribute-change',
        { tag: 'A', accessibleName: 'On Sale', stableId: 'a-onsale' },
        { openedUrl: 'https://shop.example.com/products#',
          attributeChanges: [{ attribute: 'class', before: 'toggle-filter', after: 'toggle-filter active' }],
        },
      ),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('Click');
    expect(result[0].interactionSubtype).toBe('Checkbox');
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.5);
    // Must have toggle evidence, not just navigate
    const hasToggleEvidence = result[0].evidenceTrail?.some(
      e => e.intent === 'toggle' && e.weight > 0,
    );
    expect(hasToggleEvidence).toBe(true);
    // Must have metadata.checked set for downstream propagation
    expect(result[0].metadata.checked).toBeDefined();
  });

  it('P4-B: <a href="#"> with aria-checked change → Checkbox subtype', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'Premium', className: 'toggle', stableId: 'a-prem' },
        { openedUrl: 'https://shop.example.com/products#' },
      ),
      makeEvent('attribute-change',
        { tag: 'A', accessibleName: 'Premium', stableId: 'a-prem' },
        { openedUrl: 'https://shop.example.com/products#',
          attributeChanges: [{ attribute: 'aria-checked', before: 'false', after: 'true' }],
        },
      ),
    ]);
    expect(result[0].interactionSubtype).toBe('Checkbox');
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('P4-C: <a href="#"> with NO behavioral change → Click, NOT Link, NOT confidence 1.0', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'Some Action', className: 'action-btn', stableId: 'a-act' },
        { openedUrl: 'https://shop.example.com/products#' },
      ),
    ]);
    expect(result[0].type).toBe('Click');
    expect(result[0].confidence).toBeLessThan(1.0);
    expect(result[0].type).not.toBe('Link');
  });

  it('P4-D: <a href="#"> with no href attribute → NOT Link', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'Toggle', stableId: 'a-no-href' },
        {}, // openedUrl not set = null
      ),
    ]);
    expect(result[0].type).not.toBe('Link');
  });
});

describe('PATCH-5: No regression for existing interaction types', () => {
  it('P5-A: Native checkbox on click → Checkbox, confidence 1.0', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'INPUT', accessibleName: 'On Sale', ariaRole: 'checkbox', inputType: 'checkbox', name: 'onSale', stableId: 'chk-onsale' },
        { inputType: 'checkbox' },
        { checkedBefore: true },
      ),
    ]);
    expect(result[0].type).toBe('Checkbox');
    expect(result[0].confidence).toBe(1.0);
  });

  it('P5-B: Native SELECT change → Dropdown, confidence 1.0', () => {
    const result = runPipelineProduction([
      makeEvent('change',
        { tag: 'SELECT', accessibleName: 'Category', ariaRole: 'combobox', name: 'category', stableId: 'sel-cat' },
        {},
        { valueAfter: 'Electronics' },
      ),
    ]);
    expect(result[0].type).toBe('Dropdown');
    expect(result[0].confidence).toBe(1.0);
  });

  it('P5-C: TextEntry (keydown+blur) → TextEntry, confidence 1.0', () => {
    const result = runPipelineProduction([
      makeEvent('keydown',
        { tag: 'INPUT', accessibleName: 'Search', ariaRole: 'textbox', name: 'query', stableId: 'inp-search' },
        { inputType: 'text' },
        { key: 'l', code: 'KeyL', valueBefore: '', valueAfter: 'l' },
      ),
      makeEvent('input',
        { tag: 'INPUT', accessibleName: 'Search', ariaRole: 'textbox', name: 'query', stableId: 'inp-search' },
        { inputType: 'text' },
        { valueBefore: '', valueAfter: 'laptop' },
      ),
      makeEvent('blur',
        { tag: 'INPUT', accessibleName: 'Search', ariaRole: 'textbox', name: 'query', stableId: 'inp-search' },
        { inputType: 'text' },
        { valueBefore: '', valueAfter: 'laptop' },
      ),
    ]);
    // TextEntry might consolidate to 1 interaction or emit differently.
    // Verify at least one interaction was emitted.
    expect(result.length).toBeGreaterThanOrEqual(1);
    const te = result.find(r => r.type === 'TextEntry');
    expect(te).toBeDefined();
    expect(te!.confidence).toBe(1.0);
  });

  it('P5-D: Button click → Click, R3 evidence runs', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'BUTTON', accessibleName: 'Apply Filters', ariaRole: 'button', className: 'btn-primary', stableId: 'btn-apply' },
        {},
      ),
    ]);
    expect(result[0].type).toBe('Click');
    // R3 evidence should have run (not lifecycle-definition)
    const hasNonLifecycle = result[0].evidenceTrail?.some(
      e => e.source !== 'lifecycle-definition',
    );
    expect(hasNonLifecycle).toBe(true);
  });
});

describe('PATCH-6: Existing tests from val-frozen-baseline still hold', () => {
  it('P6-A: Native <a href="/home"> still Link at confidence 1.0', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'A', accessibleName: 'Home', stableId: 'a-home2' },
        { openedUrl: 'https://shop.example.com/home' },
      ),
    ]);
    expect(result[0].type).toBe('Link');
    expect(result[0].confidence).toBe(1.0);
    expect(result[0].intent).toBe('navigate');
  });

  it('P6-B: R3 evidence runs for Click fallback (not lifecycle)', () => {
    const result = runPipelineProduction([
      makeEvent('click',
        { tag: 'BUTTON', accessibleName: 'Submit', ariaRole: 'button', stableId: 'btn-sub' },
        {},
      ),
    ]);
    expect(result[0].type).toBe('Click');
    expect(result[0].evidenceTrail?.some(e => e.source !== 'lifecycle-definition')).toBe(true);
  });
});
