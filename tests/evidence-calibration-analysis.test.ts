/**
 * Evidence Calibration Analysis
 *
 * Runs all evidence generators across a matrix of realistic interaction patterns
 * and reports generator fire rates, weight distributions, and potential
 * miscalibrations.
 *
 * This is run as a one-off analysis script, not part of the test suite.
 * Run with: npx vitest run tests/evidence-calibration-analysis.test.ts
 *
 * The test ALWAYS passes — it just prints the analysis.
 */

import { describe, it, expect } from 'vitest';
import type { ElementIdentity, ElementRecordedEvent, DomContext } from '../src/recorder/recorded-event';
import { classifyByEvidence } from '../src/classifier/evidence/evidence-classifier';
import { getScoreBreakdown } from '../src/classifier/evidence/diagnostics';
import type { IntentVote, SemanticIntent } from '../src/classifier/evidence/types';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null,
    stableId: null, testId: null, dataCy: null, dataQa: null,
    cssSelector: 'div', xPath: '/html/body/div',
    inIframe: false, shadowDom: false, elementId: 'elem-test',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return { inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false, ancestorRoles: [], ...overrides };
}

function makeClickEvent(target: ElementIdentity, overrides: Partial<ElementRecordedEvent> = {}): ElementRecordedEvent {
  return {
    eventId: 'evt-test', eventType: 'click', timestamp: '2026-07-31T08:00:00Z',
    target, valueBefore: null, valueAfter: null,
    checkedBefore: null, checkedAfter: null,
    domContext: makeDomContext(),
    ...overrides,
  };
}

// ── Scenario Matrix ──────────────────────────────────────────────────────

interface Scenario {
  name: string;
  domain: string;
  target: ElementIdentity;
  event: ElementRecordedEvent;
  expectedIntent: SemanticIntent;
  expectedType: string;
}

const scenarios: Scenario[] = [
  // Toggle scenarios (should all be toggle)
  { name: 'Amazon filter (a+checked)', domain: 'ecommerce', expectedIntent: 'toggle', expectedType: 'Checkbox',
    target: makeIdentity({ tag: 'A', ariaRole: 'link', className: 's-navigation-item', accessibleName: 'vivo' }),
    event: makeClickEvent(makeIdentity(), { checkedBefore: false, checkedAfter: true }) },
  { name: 'Native checkbox (input)', domain: 'ecommerce', expectedIntent: 'toggle', expectedType: 'Checkbox',
    target: makeIdentity({ tag: 'INPUT', ariaRole: 'checkbox', className: 'checkbox' }),
    event: makeClickEvent(makeIdentity(), { checkedBefore: false, checkedAfter: true }) },
  { name: 'aria-checked div', domain: 'banking', expectedIntent: 'toggle', expectedType: 'Checkbox',
    target: makeIdentity({ tag: 'DIV', ariaRole: 'checkbox', className: 'toggle-container' }),
    event: makeClickEvent(makeIdentity(), { checkedBefore: false, checkedAfter: true }) },
  { name: 'role=switch', domain: 'saas', expectedIntent: 'toggle', expectedType: 'ToggleSwitch',
    target: makeIdentity({ tag: 'DIV', ariaRole: 'switch', className: 'switch-control' }),
    event: makeClickEvent(makeIdentity(), { checkedBefore: false, checkedAfter: true }) },
  { name: 'MUI checkbox', domain: 'component-lib', expectedIntent: 'toggle', expectedType: 'Checkbox',
    target: makeIdentity({ tag: 'INPUT', ariaRole: 'checkbox', className: 'MuiCheckbox-input' }),
    event: makeClickEvent(makeIdentity(), { checkedBefore: false, checkedAfter: true }) },
  { name: 'AntD checkbox', domain: 'component-lib', expectedIntent: 'toggle', expectedType: 'Checkbox',
    target: makeIdentity({ tag: 'INPUT', ariaRole: 'checkbox', className: 'ant-checkbox-input' }),
    event: makeClickEvent(makeIdentity(), { checkedBefore: false, checkedAfter: true }) },
  { name: 'Radix checkbox (button)', domain: 'component-lib', expectedIntent: 'toggle', expectedType: 'Checkbox',
    target: makeIdentity({ tag: 'BUTTON', ariaRole: 'checkbox', className: 'radix-checkbox' }),
    event: makeClickEvent(makeIdentity(), { checkedBefore: false, checkedAfter: true }) },
  { name: 'Like button (button+checked)', domain: 'social', expectedIntent: 'toggle', expectedType: 'ToggleSwitch',
    target: makeIdentity({ tag: 'BUTTON', ariaRole: 'button', className: 'like-button' }),
    event: makeClickEvent(makeIdentity(), { checkedBefore: false, checkedAfter: true }) },
  { name: 'menuitemcheckbox', domain: 'a11y', expectedIntent: 'toggle', expectedType: 'Checkbox',
    target: makeIdentity({ tag: 'DIV', ariaRole: 'menuitemcheckbox', className: '' }),
    event: makeClickEvent(makeIdentity(), { checkedBefore: false, checkedAfter: true }) },

  // Navigate scenarios (should all be navigate)
  { name: 'Plain anchor link', domain: 'ecommerce', expectedIntent: 'navigate', expectedType: 'Link',
    target: makeIdentity({ tag: 'A', ariaRole: 'link', className: 'product-link' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Breadcrumb link', domain: 'saas', expectedIntent: 'navigate', expectedType: 'Link',
    target: makeIdentity({ tag: 'A', ariaRole: 'link', className: 'breadcrumb-item' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'WordPress admin menu', domain: 'cms', expectedIntent: 'navigate', expectedType: 'Link',
    target: makeIdentity({ tag: 'A', ariaRole: 'link', className: 'wp-first-item' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Gov portal link', domain: 'government', expectedIntent: 'navigate', expectedType: 'Link',
    target: makeIdentity({ tag: 'A', ariaRole: 'link', className: 'usa-nav__link' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Opens new tab', domain: 'enterprise', expectedIntent: 'navigate', expectedType: 'NewTab',
    target: makeIdentity({ tag: 'A', ariaRole: 'link', className: '' }),
    event: makeClickEvent(makeIdentity(), { domContext: makeDomContext({ opensNewTab: true, openedUrl: 'https://example.com' }) }) },

  // Trigger scenarios (should all be trigger)
  { name: 'Add to Cart button', domain: 'ecommerce', expectedIntent: 'trigger', expectedType: 'Click',
    target: makeIdentity({ tag: 'INPUT', ariaRole: 'button', className: 'a-button-input' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Salesforce Submit', domain: 'enterprise', expectedIntent: 'trigger', expectedType: 'Click',
    target: makeIdentity({ tag: 'BUTTON', ariaRole: 'button', className: '' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Analytics chart', domain: 'saas', expectedIntent: 'trigger', expectedType: 'Click',
    target: makeIdentity({ tag: 'DIV', ariaRole: 'button', className: '' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Appointment slot', domain: 'healthcare', expectedIntent: 'trigger', expectedType: 'Click',
    target: makeIdentity({ tag: 'BUTTON', ariaRole: 'button', className: 'time-slot' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Seat selection', domain: 'travel', expectedIntent: 'trigger', expectedType: 'Click',
    target: makeIdentity({ tag: 'DIV', ariaRole: 'button', className: 'seat available' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Publish button', domain: 'cms', expectedIntent: 'trigger', expectedType: 'Click',
    target: makeIdentity({ tag: 'BUTTON', ariaRole: 'button', className: 'components-button' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Generic div (no signals)', domain: 'non-semantic', expectedIntent: 'trigger', expectedType: 'Click',
    target: makeIdentity({ tag: 'DIV', ariaRole: null, className: null }),
    event: makeClickEvent(makeIdentity()) },

  // Tricky scenarios (SPA toggles without checked transition)
  { name: 'SPA filter (a, no checked)', domain: 'travel', expectedIntent: 'navigate', expectedType: 'Link',
    target: makeIdentity({ tag: 'A', ariaRole: 'link', className: 'amenity-filter' }),
    event: makeClickEvent(makeIdentity()) },
  { name: 'Follow button (no checked)', domain: 'social', expectedIntent: 'trigger', expectedType: 'Click',
    target: makeIdentity({ tag: 'BUTTON', ariaRole: 'button', className: 'follow-btn' }),
    event: makeClickEvent(makeIdentity()) },
];

// ── Analysis ─────────────────────────────────────────────────────────────

describe('Evidence Calibration Analysis', () => {
  it('reports generator fire rates and weight distributions', () => {
    const generatorStats = new Map<string, { fires: number; totalWeight: number; samples: number[] }>();
    const intentStats = new Map<string, number>();
    const misclassifications: string[] = [];
    const lowConfidenceCases: string[] = [];
    const fallbackClicks: string[] = [];

    for (const scenario of scenarios) {
      const target = scenario.target;
      const event = scenario.event;
      // Fix: the event needs to reference the correct target
      const fixedEvent = { ...event, target };
      const result = classifyByEvidence(target, fixedEvent);
      const breakdown = getScoreBreakdown(result.evidence);

      // Check classification correctness
      if (result.intent !== scenario.expectedIntent) {
        misclassifications.push(
          `${scenario.name}: expected ${scenario.expectedIntent}, got ${result.intent} (type: ${result.type})`,
        );
      }

      if (result.confidence === 0 && scenario.expectedIntent !== 'trigger') {
        lowConfidenceCases.push(`${scenario.name}: confidence=0, expected ${scenario.expectedIntent}`);
      }

      if (result.type === 'Click' && scenario.expectedType !== 'Click') {
        fallbackClicks.push(`${scenario.name}: fell back to Click, expected ${scenario.expectedType}`);
      }

      // Track generator stats
      for (const vote of result.evidence) {
        if (!generatorStats.has(vote.source)) {
          generatorStats.set(vote.source, { fires: 0, totalWeight: 0, samples: [] });
        }
        const stats = generatorStats.get(vote.source)!;
        stats.fires++;
        stats.totalWeight += Math.abs(vote.weight);
        stats.samples.push(vote.weight);
      }

      // Track intent distribution
      intentStats.set(result.intent, (intentStats.get(result.intent) ?? 0) + 1);
    }

    // ── Print analysis report ──
    const lines: string[] = [];
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════');
    lines.push('                    EVIDENCE CALIBRATION ANALYSIS REPORT');
    lines.push('═══════════════════════════════════════════════════════════════════════════');
    lines.push('');

    // Summary
    lines.push(`Total scenarios: ${scenarios.length}`);
    lines.push(`Correct: ${scenarios.length - misclassifications.length} / ${scenarios.length}`);
    lines.push(`Misclassifications: ${misclassifications.length}`);
    lines.push(`Low confidence (0.0): ${lowConfidenceCases.length}`);
    lines.push(`Unexpected Click fallbacks: ${fallbackClicks.length}`);
    lines.push('');

    // Intent distribution
    lines.push('── Intent Distribution ──');
    for (const [intent, count] of [...intentStats.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${intent.padEnd(12)} ${count} (${((count / scenarios.length) * 100).toFixed(0)}%)`);
    }
    lines.push('');

    // Generator fire rates
    lines.push('── Generator Fire Rates ──');
    const sortedGens = [...generatorStats.entries()].sort((a, b) => b[1].fires - a[1].fires);
    for (const [source, stats] of sortedGens) {
      const avgWeight = stats.totalWeight / stats.fires;
      const maxAbs = Math.max(...stats.samples.map(Math.abs));
      const minAbs = Math.min(...stats.samples.map(Math.abs));
      const fireRate = ((stats.fires / scenarios.length) * 100).toFixed(0);
      lines.push(
        `  ${source.padEnd(24)} fires ${stats.fires}/${scenarios.length} (${fireRate}%)  ` +
        `avg=${avgWeight.toFixed(2)}  range=[${minAbs.toFixed(2)}, ${maxAbs.toFixed(2)}]`,
      );
    }
    lines.push('');

    // Missing generators (zero fires)
    const knownGenerators = ['aria-checked', 'aria-pressed', 'checked-transition', 'tag-anchor', 'native-checkbox', 'class-checkbox', 'ancestor-list', 'button-element', 'opens-new-tab', 'opens-new-window'];
    for (const gen of knownGenerators) {
      if (!generatorStats.has(gen)) {
        lines.push(`  ⚠ NEVER FIRED: ${gen}`);
      }
    }
    lines.push('');

    // Misclassifications
    if (misclassifications.length > 0) {
      lines.push('── ⚠ Misclassifications ──');
      for (const m of misclassifications) lines.push(`  ${m}`);
      lines.push('');
    }

    // Low confidence
    if (lowConfidenceCases.length > 0) {
      lines.push('── ⚠ Low Confidence (0.0) ──');
      for (const lc of lowConfidenceCases) lines.push(`  ${lc}`);
      lines.push('');
    }

    // Fallback clicks
    if (fallbackClicks.length > 0) {
      lines.push('── ⚠ Unexpected Click Fallbacks ──');
      for (const fc of fallbackClicks) lines.push(`  ${fc}`);
      lines.push('');
    }

    // Confidence distribution
    lines.push('── Confidence Distribution ──');
    const buckets = { '0.00': 0, '0.01-0.30': 0, '0.31-0.60': 0, '0.61-0.80': 0, '0.81-1.00': 0 };
    for (const scenario of scenarios) {
      const fixedEvent = { ...scenario.event, target: scenario.target };
      const result = classifyByEvidence(scenario.target, fixedEvent);
      const c = result.confidence;
      if (c === 0) buckets['0.00']++;
      else if (c <= 0.3) buckets['0.01-0.30']++;
      else if (c <= 0.6) buckets['0.31-0.60']++;
      else if (c <= 0.8) buckets['0.61-0.80']++;
      else buckets['0.81-1.00']++;
    }
    for (const [bucket, count] of Object.entries(buckets)) {
      lines.push(`  ${bucket.padEnd(12)} ${count} scenarios`);
    }
    lines.push('');

    // Weight calibration recommendations
    lines.push('── Calibration Recommendations ──');

    // Check if aria-checked dominates
    const ariaChecked = generatorStats.get('aria-checked');
    if (ariaChecked && ariaChecked.fires > 0) {
      const toggleWins = scenarios.filter(s => {
        const fixedEvent = { ...s.event, target: s.target };
        const r = classifyByEvidence(s.target, fixedEvent);
        return r.intent === 'toggle';
      }).length;
      const ariaCheckedToggleWins = scenarios.filter(s => {
        const fixedEvent = { ...s.event, target: s.target };
        const r = classifyByEvidence(s.target, fixedEvent);
        return r.intent === 'toggle' && r.evidence.some(e => e.source === 'aria-checked');
      }).length;
      lines.push(`  aria-checked contributes to ${ariaCheckedToggleWins}/${toggleWins} toggle wins`);
    }

    // Check confidence for trigger cases
    const triggerScenarios = scenarios.filter(s => s.expectedIntent === 'trigger');
    const triggerZeroConf = triggerScenarios.filter(s => {
      const fixedEvent = { ...s.event, target: s.target };
      const r = classifyByEvidence(s.target, fixedEvent);
      return r.confidence === 0;
    });
    if (triggerZeroConf.length > 0) {
      lines.push(`  ⚠ ${triggerZeroConf.length}/${triggerScenarios.length} trigger scenarios have 0.0 confidence — no positive evidence for trigger intent`);
      lines.push(`    Consider adding a generator that votes for 'trigger' on generic elements`);
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════');

    // Print to console
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    // Always pass — this is analysis, not assertions
    expect(misclassifications.length).toBe(0);
  });
});
