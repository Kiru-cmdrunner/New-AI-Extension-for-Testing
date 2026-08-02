/**
 * VAL-DIAGNOSTIC: Extract actual runtime values for final report.
 * Runs production pipeline for each scenario and prints a table.
 */
import { createRuntime } from '../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../src/definitions';
import { annotateWithEvidence } from '../src/classifier/evidence/annotation-layer';
import { enrichInteraction } from '../src/enrichment';
import type {
  ComponentInteraction,
  ObservedEvent,
  ElementIdentity,
  DomContext,
  RuntimeConfig,
} from '../src/shared/component-types';

function runPipelineProduction(events: ObservedEvent[]): ComponentInteraction[] {
  const interactions: ComponentInteraction[] = [];
  const config: RuntimeConfig = {
    onEmit: (i) => {
      enrichInteraction(i);
      annotateWithEvidence(i);
      interactions.push(i);
    },
  };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  for (const event of events) {
    runtime.process(event);
  }
  runtime.flush();
  return interactions;
}

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
    pageUrl: 'https://shop.example.com/products', pageTitle: 'Products',
    ...overrides,
  };
}

function diag(label: string, events: ObservedEvent[]) {
  const result = runPipelineProduction(events);
  const r = result[0];
  console.log('\n──────────────────────────────────────────────');
  console.log(`SCENARIO: ${label}`);
  console.log(`  Events emitted: ${events.length} → Interactions: ${result.length}`);
  if (!r) {
    console.log('  NO EMISSION (interaction filtered out by lifecycle definition)');
    return;
  }
  console.log(`  type=${r.type} subtype=${r.subtype ?? '—'} confidence=${r.confidence?.toFixed(3) ?? '—'}`);
  console.log(`  metadata.unrecognized=${r.metadata?.unrecognized ?? '—'}`);
  console.log(`  evidenceTrail (${r.evidenceTrail?.length ?? 0} entries):`);
  for (const e of r.evidenceTrail ?? []) {
    console.log(`    - source=${e.source} weight=${e.weight?.toFixed(3) ?? '—'} intent=${e.intent ?? '—'}`);
  }
  const hasEvidenceEval = r.evidenceTrail?.some(e => e.source !== 'lifecycle-definition') ?? false;
  console.log(`  R3 evidence evaluated: ${hasEvidenceEval}`);
}

// ── 1. Native <a href> navigation ──
diag('1. Native <a href> navigation', [
  makeEvent('click', { tag: 'A', accessibleName: 'Home', href: '/home' }),
]);

// ── 2. <a> as tab ──
diag('2. <a> as tab', [
  makeEvent('click', { tag: 'A', accessibleName: 'Products', ariaRole: 'tab', href: '#tab-products' }),
]);

// ── 3. <a> as toggle/filter ──
diag('3. <a> as toggle/filter (On Sale)', [
  makeEvent('click', { tag: 'A', accessibleName: 'On Sale', href: '#', className: 'toggle-filter' }),
]);

// ── 4. <a role="button"> that changes state ──
diag('4. <a role="button"> state change', [
  makeEvent('click', { tag: 'A', accessibleName: 'Show More', ariaRole: 'button', href: '#', className: 'expand-btn' }),
]);

// ── 5. Native checkbox ──
diag('5. Native checkbox', [
  makeEvent('change', { tag: 'INPUT', accessibleName: 'On Sale', ariaRole: 'checkbox', inputType: 'checkbox', name: 'onSale' },
    { inputType: 'checkbox' }, { checkedAfter: true }),
]);

// ── 6. Custom div toggle ──
diag('6. Custom div toggle', [
  makeEvent('click', { tag: 'DIV', accessibleName: 'On Sale', ariaRole: 'switch', className: 'toggle-switch' }),
]);

// ── 7. Button opening dropdown ──
diag('7. Button opening dropdown', [
  makeEvent('click', { tag: 'BUTTON', accessibleName: 'Category', ariaRole: 'button', className: 'dropdown-trigger' },
    { ariaHasPopup: 'listbox' }),
]);

// ── 8. Button triggering action ──
diag('8. Button triggering action (Apply Filters)', [
  makeEvent('click', { tag: 'BUTTON', accessibleName: 'Apply Filters', ariaRole: 'button', className: 'btn-primary' }),
]);

// ── 9. <a> toggle + attribute change ──
diag('9. <a> toggle with post-click attribute change', [
  makeEvent('click', { tag: 'A', accessibleName: 'On Sale', href: '#', className: 'toggle-filter' }),
  makeEvent('attribute-change', { tag: 'A', accessibleName: 'On Sale', href: '#' },
    { ariaExpanded: 'true' }, {}),
]);

// ── 10. Native SELECT change ──
diag('10. Native SELECT change', [
  makeEvent('change', { tag: 'SELECT', accessibleName: 'Category', ariaRole: 'combobox', name: 'category' },
    {}, { valueAfter: 'Electronics' }),
]);

// ── 11. Slider (custom) ──
diag('11. Custom slider drag', [
  makeEvent('mousedown', { tag: 'DIV', accessibleName: 'Maximum Price', ariaRole: 'slider', className: 'slider-handle' }),
  makeEvent('mousemove', { tag: 'DIV', accessibleName: 'Maximum Price', ariaRole: 'slider' },
    {}, { clientX: 300 }),
  makeEvent('mouseup', { tag: 'DIV', accessibleName: 'Maximum Price', ariaRole: 'slider' },
    {}, { clientX: 300 }),
]);

// ── 12. TextEntry ──
diag('12. TextEntry (input blur)', [
  makeEvent('keydown', { tag: 'INPUT', accessibleName: 'Search', ariaRole: 'textbox', name: 'query' },
    { inputType: 'text' }, { key: 'l', valueBefore: '', valueAfter: 'l' }),
  makeEvent('input', { tag: 'INPUT', accessibleName: 'Search', ariaRole: 'textbox', name: 'query' },
    { inputType: 'text' }, { valueBefore: '', valueAfter: 'laptop' }),
  makeEvent('blur', { tag: 'INPUT', accessibleName: 'Search', ariaRole: 'textbox', name: 'query' },
    { inputType: 'text' }, { valueBefore: '', valueAfter: 'laptop' }),
]);

console.log('\n════════════════════════════════════════════');
console.log('DIAGNOSTIC COMPLETE');
