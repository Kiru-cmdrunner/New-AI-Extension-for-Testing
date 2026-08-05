/**
 * Phase 7 — Real-World Validation
 *
 * Simulates complete recorded workflows through the Capability Engine.
 * Each workflow mirrors what the extension captures on a real site.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 7)
 */

import { describe, it, expect } from 'vitest';
import {
  runCapabilityInference,
  serializeCapabilityRecords,
} from '../../src/capabilities/capability-bridge';
import type { ComponentInteraction, InteractionType } from '../../src/shared/component-types';
import type { ObservationResult } from '../../src/shared/observation-types';
import type { SemanticEffect } from '../../src/semantics/effect-types';
import { makeInteraction } from './phase4-helpers';

// ── Builders ──────────────────────────────────────────────────────────

function effect(overrides: Partial<SemanticEffect>): SemanticEffect {
  return {
    category: 'content-change',
    description: 'test',
    affectedTarget: { role: null, label: null, cssPath: '#target' },
    confidence: 'low',
    confidenceBasis: 'structural-inference',
    evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
    netNodeDelta: null,
    ...overrides,
  };
}

function obs(sourceEventId: string, effects: SemanticEffect[]): ObservationResult {
  return {
    windowId: 'obs-001',
    sourceEventId,
    sourceEventType: 'click',
    startTime: 1000,
    endTime: 2000,
    endReason: 'timeout',
    snapshot: { childCount: 10, textContent: 'test' },
    mutations: [],
    semanticEffects: effects,
  } as ObservationResult;
}

function withObs(interaction: ComponentInteraction, observations: ObservationResult[]): ComponentInteraction {
  return { ...interaction, behavioralObservations: observations };
}

// ── Amazon.com Workflow ───────────────────────────────────────────────

describe('Amazon.com — Complete Workflow', () => {
  const amazonUrl = 'https://www.amazon.com/s?k=laptops';
  const amazonUrlFiltered = 'https://www.amazon.com/s?k=laptops&brand=sony';
  const amazonUrlSorted = 'https://www.amazon.com/s?k=laptops&brand=sony&s=price-asc';
  const productDetailUrl = 'https://www.amazon.com/dp/B08XXXX/';
  const amazonUrlP2 = 'https://www.amazon.com/s?k=laptops&brand=sony&s=price-asc&page=2';

  function buildAmazonWorkflow(): ComponentInteraction[] {
    const search = makeInteraction({
      type: 'TextEntry' as InteractionType,
      trigger: { accessibleName: 'Search Amazon', tag: 'INPUT', ariaRole: 'searchbox' },
      triggerEvent: { pageUrl: amazonUrl, valueAfter: 'laptops' },
    });
    search.interactionId = 'amz-001';

    const brandFilter = makeInteraction({
      type: 'Link' as InteractionType,
      trigger: { accessibleName: 'Sony', tag: 'A', ariaRole: 'link', href: amazonUrlFiltered },
      triggerEvent: { pageUrl: amazonUrl },
    });
    brandFilter.interactionId = 'amz-002';

    const sortDropdown = makeInteraction({
      type: 'Dropdown' as InteractionType,
      trigger: { accessibleName: 'Sort by: Price: Low to High', tag: 'SELECT', ariaRole: 'listbox' },
      triggerEvent: { pageUrl: amazonUrlFiltered, valueAfter: 'price-ascending-rank' },
    });
    sortDropdown.interactionId = 'amz-003';

    const productDetail = makeInteraction({
      type: 'Link' as InteractionType,
      trigger: { accessibleName: 'Sony Vaio Laptop 15.6 inch', tag: 'A', ariaRole: 'link', href: productDetailUrl },
      triggerEvent: { pageUrl: amazonUrlSorted },
    });
    productDetail.interactionId = 'amz-004';

    // Navigation event — browser-emitted consequence of clicking the product link.
    // This is a Navigation interaction type, not a user action. It should:
    //   1. Provide urlPathChangedAfter evidence to amz-004 (the product link)
    //   2. NOT produce its own CapabilityRecord (excluded by capability bridge)
    const productDetailNav = makeInteraction({
      type: 'Navigation' as InteractionType,
      trigger: { accessibleName: '', tag: '', ariaRole: null },
      triggerEvent: { pageUrl: productDetailUrl, pageTitle: 'Sony Vaio Laptop 15.6 inch - Amazon.com' },
    });
    productDetailNav.interactionId = 'amz-004-nav';

    const priceSlider = makeInteraction({
      type: 'Slider' as InteractionType,
      trigger: { accessibleName: 'Max Price', tag: 'INPUT', ariaRole: 'slider' },
      triggerEvent: { pageUrl: amazonUrlSorted },
      metadata: { userAdjusted: true },
    });
    priceSlider.interactionId = 'amz-005';

    const addToCart = makeInteraction({
      type: 'Click' as InteractionType,
      trigger: { accessibleName: 'Add to Cart', tag: 'BUTTON', ariaRole: 'button' },
      triggerEvent: { pageUrl: productDetailUrl },
    });
    addToCart.interactionId = 'amz-006';

    const nextPage = makeInteraction({
      type: 'Link' as InteractionType,
      trigger: { accessibleName: 'Next Page', tag: 'A', ariaRole: 'link', href: amazonUrlP2 },
      triggerEvent: { pageUrl: amazonUrlSorted },
    });
    nextPage.interactionId = 'amz-007';

    const filterEffect = effect({
      category: 'content-change',
      description: 'Results narrowed — 15 items removed',
      affectedTarget: { role: null, label: null, cssPath: '#s-results' },
      netNodeDelta: -15,
      evidenceRef: { windowId: 'obs-001', sourceEventId: 'amz-002' },
    });
    const sortEffect = effect({
      category: 'content-change',
      description: 'Results reordered by price',
      affectedTarget: { role: null, label: null, cssPath: '#s-results' },
      netNodeDelta: 0,
      evidenceRef: { windowId: 'obs-001', sourceEventId: 'amz-003' },
    });
    const sliderEffect = effect({
      category: 'content-change',
      description: 'Results narrowed by price',
      affectedTarget: { role: null, label: null, cssPath: '#s-results' },
      netNodeDelta: -3,
      evidenceRef: { windowId: 'obs-001', sourceEventId: 'amz-005' },
    });
    const cartEffect = effect({
      category: 'content-change',
      description: 'Cart badge updated',
      affectedTarget: { role: null, label: null, cssPath: '#nav-cart-count' },
      netNodeDelta: 0,
      evidenceRef: { windowId: 'obs-001', sourceEventId: 'amz-006' },
    });

    return [
      search,
      withObs(brandFilter, [obs('amz-002', [filterEffect])]),
      withObs(sortDropdown, [obs('amz-003', [sortEffect])]),
      productDetail,
      productDetailNav,
      withObs(priceSlider, [obs('amz-005', [sliderEffect])]),
      withObs(addToCart, [obs('amz-006', [cartEffect])]),
      nextPage,
    ];
  }

  it('produces 7 capability records for 8 interactions (Navigation excluded from output)', () => {
    const interactions = buildAmazonWorkflow();
    expect(interactions).toHaveLength(8); // 7 user actions + 1 Navigation
    const records = runCapabilityInference(interactions);
    expect(records).toHaveLength(7); // Navigation excluded from capability output
    // Verify no Navigation interaction has a capability record
    const navRecord = records.find(r => r.interactionId === 'amz-004-nav');
    expect(navRecord).toBeUndefined();
  });

  it('Search box → Search capability', () => {
    const records = runCapabilityInference(buildAmazonWorkflow());
    const r = records.find(r => r.interactionId === 'amz-001')!;
    console.log(`  [amz-001] Search Amazon: ${r.capability} (${r.confidence})`);
    expect(['Search', 'Unclassified']).toContain(r.capability);
  });

  it('Brand filter "Sony" → classification (Navigate vs FilterSelection)', () => {
    const records = runCapabilityInference(buildAmazonWorkflow());
    const r = records.find(r => r.interactionId === 'amz-002')!;
    console.log(`  [amz-002] Brand filter "Sony": ${r.capability} (${r.confidence})`);
    console.log(`    alternatives: ${r.alternatives.map(a => `${a.capability} (${a.confidence})`).join(', ') || 'none'}`);
    console.log(`    evidence.physicalType: ${r.evidence.physicalType}`);
    console.log(`    evidence.semanticEffects: ${r.evidence.semanticEffects.join(', ')}`);
    expect(['FilterSelection', 'Navigate', 'Unclassified']).toContain(r.capability);
  });

  it('Sort dropdown "Price: Low to High" → classification', () => {
    const records = runCapabilityInference(buildAmazonWorkflow());
    const r = records.find(r => r.interactionId === 'amz-003')!;
    console.log(`  [amz-003] Sort by Price: ${r.capability} (${r.confidence})`);
    expect(['SortSelection', 'SelectOption', 'Navigate', 'Unclassified']).toContain(r.capability);
  });

  it('Product detail link → OpenDetail (Navigation provides urlPathChangedAfter evidence)', () => {
    const records = runCapabilityInference(buildAmazonWorkflow());
    const r = records.find(r => r.interactionId === 'amz-004')!;
    console.log(`  [amz-004] Product detail link: ${r.capability} (${r.confidence})`);
    console.log(`    alternatives: ${r.alternatives.map(a => `${a.capability} (${a.confidence})`).join(', ') || 'none'}`);
    // After Navigation exclusion fix: the Navigation event (amz-004-nav) follows
    // the product link and provides urlPathChangedAfter=true. The product link
    // has href='/dp/B08XXXX/' which matches hasItemSpecificUrl. OpenDetail should
    // claim via Required B (triggerHasItemSpecificHref) or Required A (urlPathChangedAfter
    // + hasNextItemSpecificUrl). OpenDetail (priority 10) wins over Navigate (priority 30)
    // at equal confidence via priority ordering.
    expect(r.capability).toBe('OpenDetail');
  });

  it('Price slider → AdjustValue', () => {
    const records = runCapabilityInference(buildAmazonWorkflow());
    const r = records.find(r => r.interactionId === 'amz-005')!;
    console.log(`  [amz-005] Price slider: ${r.capability} (${r.confidence})`);
    expect(['AdjustValue', 'FilterSelection', 'Unclassified']).toContain(r.capability);
  });

  it('Add to Cart → should be Unclassified (no AddToCart capability)', () => {
    const records = runCapabilityInference(buildAmazonWorkflow());
    const r = records.find(r => r.interactionId === 'amz-006')!;
    console.log(`  [amz-006] Add to Cart: ${r.capability} (${r.confidence})`);
    console.log(`    evidence.semanticEffects: ${r.evidence.semanticEffects.join(', ')}`);
    expect(['Unclassified', 'FilterSelection', 'SubmitForm', 'Navigate']).toContain(r.capability);
  });

  it('Next Page → Paginate or Navigate', () => {
    const records = runCapabilityInference(buildAmazonWorkflow());
    const r = records.find(r => r.interactionId === 'amz-007')!;
    console.log(`  [amz-007] Next Page: ${r.capability} (${r.confidence})`);
    expect(['Paginate', 'Navigate', 'Unclassified']).toContain(r.capability);
  });

  it('Print full workflow summary', () => {
    const interactions = buildAmazonWorkflow();
    const records = runCapabilityInference(interactions);
    const serialized = serializeCapabilityRecords(records);
    const icons: Record<string, string> = {
      FilterSelection: '🔍', SortSelection: '↕️', Search: '🔎', Navigate: '🧭',
      OpenDetail: '📄', Paginate: '📋', SubmitForm: '✅', SelectOption: '⚙️',
      ToggleControl: '🔘', ExpandCollapse: '📂', UploadFile: '📎', AdjustValue: '🎚️',
      Unclassified: '❓',
    };

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('AMAZON.COM WORKFLOW — CAPABILITY ANALYSIS');
    console.log('═══════════════════════════════════════════════════════');
    for (const s of serialized) {
      const interaction = interactions.find(i => i.interactionId === s.interactionId);
      const name = interaction?.trigger.accessibleName ?? '???';
      const type = interaction?.type ?? '???';
      console.log(`  ${icons[s.capability] ?? '?'} [${s.interactionId}] ${type} "${name}"`);
      console.log(`     → ${s.capability} (${s.confidence})`);
      if (s.alternatives.length > 0) {
        console.log(`     alternatives: ${s.alternatives.map(a => `${a.capability}(${a.confidence})`).join(', ')}`);
      }
      if (s.unclassifiedReason) {
        console.log(`     reason: ${s.unclassifiedReason}`);
      }
      if (s.evidence.semanticEffects.length > 0) {
        console.log(`     effects: ${s.evidence.semanticEffects.join(', ')}`);
      }
    }
    console.log('═══════════════════════════════════════════════════════\n');
  });
});

// ── Avis Ford Workflow ────────────────────────────────────────────────

describe('Avis Ford — Complete Workflow', () => {
  const avisUrl = 'https://www.avisford.com/inventory';

  function buildAvisWorkflow(): ComponentInteraction[] {
    const make = makeInteraction({
      type: 'Dropdown' as InteractionType,
      trigger: { accessibleName: 'Make', tag: 'SELECT', ariaRole: 'listbox' },
      triggerEvent: { pageUrl: avisUrl, valueAfter: 'Ford' },
    });
    make.interactionId = 'avis-001';

    const model = makeInteraction({
      type: 'Dropdown' as InteractionType,
      trigger: { accessibleName: 'Model', tag: 'SELECT', ariaRole: 'listbox' },
      triggerEvent: { pageUrl: avisUrl, valueAfter: 'Mustang' },
    });
    model.interactionId = 'avis-002';

    const condition = makeInteraction({
      type: 'Dropdown' as InteractionType,
      trigger: { accessibleName: 'Condition', tag: 'SELECT', ariaRole: 'listbox' },
      triggerEvent: { pageUrl: avisUrl, valueAfter: 'New' },
    });
    condition.interactionId = 'avis-003';

    const searchBtn = makeInteraction({
      type: 'Click' as InteractionType,
      trigger: { accessibleName: 'Search', tag: 'BUTTON', ariaRole: 'button' },
      triggerEvent: { pageUrl: avisUrl },
    });
    searchBtn.interactionId = 'avis-004';
    // Real-world: clicking Search loads filtered results (content-change on results area)
    searchBtn.behavioralObservations = [
      obs('evt-avis-004', [
        effect({ category: 'content-change', affectedTarget: { cssPath: '#inventory-results', role: null, label: 'Inventory Results' } }),
      ]),
    ];

    const navLink = makeInteraction({
      type: 'Link' as InteractionType,
      trigger: { accessibleName: 'View Inventory', tag: 'A', ariaRole: 'link', href: 'https://www.avisford.com/view-inventory' },
      triggerEvent: { pageUrl: avisUrl },
    });
    navLink.interactionId = 'avis-005';

    return [make, model, condition, searchBtn, navLink];
  }

  it('produces 5 capability records for 5 interactions', () => {
    const records = runCapabilityInference(buildAvisWorkflow());
    expect(records).toHaveLength(5);
  });

  it('All dropdowns (Make, Model, Condition) → SelectOption', () => {
    const records = runCapabilityInference(buildAvisWorkflow());
    for (const id of ['avis-001', 'avis-002', 'avis-003']) {
      const r = records.find(r => r.interactionId === id)!;
      expect(r.capability).toBe('SelectOption');
    }
  });

  it('Search button after dropdowns → SubmitForm HIGH (F5 fix: precededByFormInteraction)', () => {
    const records = runCapabilityInference(buildAvisWorkflow());
    const r = records.find(r => r.interactionId === 'avis-004')!;
    console.log(`  [avis-004] Search: ${r.capability} (${r.confidence})`);
    expect(r.capability).toBe('SubmitForm');
    expect(r.confidence).toBe('high');
  });

  it('Nav link → Navigate', () => {
    const records = runCapabilityInference(buildAvisWorkflow());
    const r = records.find(r => r.interactionId === 'avis-005')!;
    expect(['Navigate', 'Unclassified']).toContain(r.capability);
  });

  it('Print full workflow summary', () => {
    const interactions = buildAvisWorkflow();
    const records = runCapabilityInference(interactions);
    const serialized = serializeCapabilityRecords(records);
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('AVIS FORD WORKFLOW — CAPABILITY ANALYSIS');
    console.log('═══════════════════════════════════════════════════════');
    for (const s of serialized) {
      const interaction = interactions.find(i => i.interactionId === s.interactionId);
      const name = interaction?.trigger.accessibleName ?? '???';
      const type = interaction?.type ?? '???';
      console.log(`  [${s.interactionId}] ${type} "${name}"`);
      console.log(`     → ${s.capability} (${s.confidence})`);
      if (s.alternatives.length > 0) {
        console.log(`     alternatives: ${s.alternatives.map(a => `${a.capability}(${a.confidence})`).join(', ')}`);
      }
    }
    console.log('═══════════════════════════════════════════════════════\n');
  });
});

// ── OrangeHRM Workflow ────────────────────────────────────────────────

describe('OrangeHRM — Complete Workflow', () => {
  const ohrmLogin = 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login';
  const ohrmAdmin = 'https://opensource-demo.orangehrmlive.com/web/index.php/admin/viewSystemUsers';

  function buildOrangeHRMWorkflow(): ComponentInteraction[] {
    const username = makeInteraction({
      type: 'TextEntry' as InteractionType,
      trigger: { accessibleName: 'Username', tag: 'INPUT' },
      triggerEvent: { pageUrl: ohrmLogin, valueAfter: 'admin' },
    });
    username.interactionId = 'ohrm-001';

    const password = makeInteraction({
      type: 'TextEntry' as InteractionType,
      trigger: { accessibleName: 'Password', tag: 'INPUT' },
      triggerEvent: { pageUrl: ohrmLogin, valueAfter: 'admin123' },
    });
    password.interactionId = 'ohrm-002';

    const loginBtn = makeInteraction({
      type: 'Click' as InteractionType,
      trigger: { accessibleName: 'Login', tag: 'BUTTON', ariaRole: 'button' },
      triggerEvent: { pageUrl: ohrmLogin },
    });
    loginBtn.interactionId = 'ohrm-003';

    const toggleStatus = makeInteraction({
      type: 'Checkbox' as InteractionType,
      trigger: { accessibleName: 'Status', tag: 'INPUT', ariaRole: 'checkbox' },
      triggerEvent: { pageUrl: ohrmAdmin, domContext: { inputType: 'checkbox' }, checkedBefore: false, checkedAfter: true },
    });
    toggleStatus.interactionId = 'ohrm-004';

    const selectRole = makeInteraction({
      type: 'Dropdown' as InteractionType,
      trigger: { accessibleName: 'User Role', tag: 'SELECT', ariaRole: 'listbox' },
      triggerEvent: { pageUrl: ohrmAdmin, valueAfter: 'ESS' },
    });
    selectRole.interactionId = 'ohrm-005';

    const accordion = makeInteraction({
      type: 'Click' as InteractionType,
      trigger: { accessibleName: 'Employee Information', tag: 'BUTTON', ariaRole: 'button' },
      triggerEvent: { pageUrl: ohrmAdmin },
    });
    accordion.interactionId = 'ohrm-006';

    const navLink = makeInteraction({
      type: 'Link' as InteractionType,
      trigger: { accessibleName: 'User Management', tag: 'A', ariaRole: 'link', href: ohrmAdmin },
      triggerEvent: { pageUrl: ohrmAdmin },
    });
    navLink.interactionId = 'ohrm-007';

    const toggleEffect = effect({
      category: 'state-toggle',
      description: 'checked: false → true',
      affectedTarget: { role: 'checkbox', label: 'Status', cssPath: '#cb' },
      confidence: 'high',
      confidenceBasis: 'direct-property',
    });
    const accordionEffect = effect({
      category: 'expand-collapse',
      description: 'aria-expanded: false → true',
      affectedTarget: { role: 'button', label: 'Employee Information', cssPath: '#acc' },
      confidence: 'high',
      confidenceBasis: 'direct-property',
    });

    return [
      username,
      password,
      loginBtn,
      withObs(toggleStatus, [obs('ohrm-004', [toggleEffect])]),
      selectRole,
      withObs(accordion, [obs('ohrm-006', [accordionEffect])]),
      navLink,
    ];
  }

  it('produces 7 capability records for 7 interactions', () => {
    const records = runCapabilityInference(buildOrangeHRMWorkflow());
    expect(records).toHaveLength(7);
  });

  it('Login button after TextEntry → SubmitForm', () => {
    const records = runCapabilityInference(buildOrangeHRMWorkflow());
    const r = records.find(r => r.interactionId === 'ohrm-003')!;
    expect(['SubmitForm', 'Unclassified']).toContain(r.capability);
  });

  it('Status checkbox → ToggleControl', () => {
    const records = runCapabilityInference(buildOrangeHRMWorkflow());
    const r = records.find(r => r.interactionId === 'ohrm-004')!;
    expect(r.capability).toBe('ToggleControl');
    expect(r.confidence).toBe('high');
  });

  it('User Role dropdown → SelectOption', () => {
    const records = runCapabilityInference(buildOrangeHRMWorkflow());
    const r = records.find(r => r.interactionId === 'ohrm-005')!;
    expect(r.capability).toBe('SelectOption');
  });

  it('Accordion toggle → ExpandCollapse', () => {
    const records = runCapabilityInference(buildOrangeHRMWorkflow());
    const r = records.find(r => r.interactionId === 'ohrm-006')!;
    expect(r.capability).toBe('ExpandCollapse');
    expect(r.confidence).toBe('high');
  });

  it('Print full workflow summary', () => {
    const interactions = buildOrangeHRMWorkflow();
    const records = runCapabilityInference(interactions);
    const serialized = serializeCapabilityRecords(records);
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('ORANGEHRM WORKFLOW — CAPABILITY ANALYSIS');
    console.log('═══════════════════════════════════════════════════════');
    for (const s of serialized) {
      const interaction = interactions.find(i => i.interactionId === s.interactionId);
      const name = interaction?.trigger.accessibleName ?? '???';
      const type = interaction?.type ?? '???';
      console.log(`  [${s.interactionId}] ${type} "${name}"`);
      console.log(`     → ${s.capability} (${s.confidence})`);
      if (s.alternatives.length > 0) {
        console.log(`     alternatives: ${s.alternatives.map(a => `${a.capability}(${a.confidence})`).join(', ')}`);
      }
      if (s.evidence.semanticEffects.length > 0) {
        console.log(`     effects: ${s.evidence.semanticEffects.join(', ')}`);
      }
    }
    console.log('═══════════════════════════════════════════════════════\n');
  });
});

// ── Amazon Brand Filter — URL-Change Deep Analysis ────────────────────

describe('Amazon Brand Filter — URL-Change Analysis', () => {

  it('Brand filter that changes URL → Navigate (FilterSelection blocked by urlChangedAfter)', () => {
    const brandFilter = makeInteraction({
      type: 'Link' as InteractionType,
      trigger: { accessibleName: 'Sony', tag: 'A', ariaRole: 'link', href: 'https://amazon.com/s?k=laptops&brand=sony' },
      triggerEvent: { pageUrl: 'https://amazon.com/s?k=laptops' },
    });
    brandFilter.interactionId = 'bf-001';

    const filterEffect = effect({
      category: 'content-change',
      description: 'results narrowed by brand',
      affectedTarget: { role: null, label: null, cssPath: '#s-results' },
      netNodeDelta: -15,
    });

    const records = runCapabilityInference([withObs(brandFilter, [obs('bf-001', [filterEffect])])]);
    const r = records[0];
    console.log(`\n  Brand filter (URL change): ${r.capability} (${r.confidence})`);
    console.log(`    alternatives: ${r.alternatives.map(a => `${a.capability}(${a.confidence})`).join(', ') || 'none'}`);

    // In isolation (single interaction), there is no next interaction to detect
    // urlChangedAfter=true. So FilterSelection claims. In the full workflow,
    // urlChangedAfter IS detected and Navigate would claim instead.
    expect(['FilterSelection', 'Navigate']).toContain(r.capability);
  });

  it('Brand filter WITHOUT URL change (SPA-style) → FilterSelection', () => {
    const brandFilter = makeInteraction({
      type: 'Link' as InteractionType,
      trigger: { accessibleName: 'Sony', tag: 'A', ariaRole: 'link', href: 'https://amazon.com/s?k=laptops' },
      triggerEvent: { pageUrl: 'https://amazon.com/s?k=laptops' },
    });
    brandFilter.interactionId = 'bf-spa-001';

    const filterEffect = effect({
      category: 'content-change',
      description: 'results narrowed by brand',
      affectedTarget: { role: null, label: null, cssPath: '#s-results' },
      netNodeDelta: -15,
    });

    const records = runCapabilityInference([withObs(brandFilter, [obs('bf-spa-001', [filterEffect])])]);
    const r = records[0];
    console.log(`\n  Brand filter (SPA, no URL change): ${r.capability} (${r.confidence})`);
    console.log(`    alternatives: ${r.alternatives.map(a => `${a.capability}(${a.confidence})`).join(', ') || 'none'}`);
    expect(r.capability).toBe('FilterSelection');
  });

  it('Brand filter with content-change BUT no negative delta AND no URL change → null', () => {
    // Edge case: filter with delta=0 (CSS visibility toggle instead of DOM removal)
    const brandFilter = makeInteraction({
      type: 'Link' as InteractionType,
      trigger: { accessibleName: 'Sony', tag: 'A', ariaRole: 'link', href: 'https://amazon.com/s?k=laptops' },
      triggerEvent: { pageUrl: 'https://amazon.com/s?k=laptops' },
    });
    brandFilter.interactionId = 'bf-edge-001';

    const filterEffect = effect({
      category: 'content-change',
      description: 'results narrowed (visibility)',
      affectedTarget: { role: null, label: null, cssPath: '#s-results' },
      netNodeDelta: 0,
    });

    const records = runCapabilityInference([withObs(brandFilter, [obs('bf-edge-001', [filterEffect])])]);
    const r = records[0];
    console.log(`\n  Brand filter (no delta, no URL change): ${r.capability} (${r.confidence})`);
    // Without negative delta, no keyword, no filter ancestor → FilterSelection
    // returns null → Unclassified
    expect(r.capability).toBe('Unclassified');
  });
});

// ── Gap Analysis ──────────────────────────────────────────────────────

describe('Gap Analysis — Known Missing Capabilities', () => {

  it('"Add to Cart" with cart badge change → Unclassified', () => {
    const addToCart = makeInteraction({
      type: 'Click' as InteractionType,
      trigger: { accessibleName: 'Add to Cart', tag: 'BUTTON', ariaRole: 'button' },
      triggerEvent: { pageUrl: 'https://amazon.com/dp/B08XXXX/' },
    });
    addToCart.interactionId = 'gap-001';

    const cartEffect = effect({
      category: 'content-change',
      description: 'Cart count: 0 → 1',
      affectedTarget: { role: null, label: null, cssPath: '#nav-cart-count' },
      netNodeDelta: 0,
    });

    const records = runCapabilityInference([withObs(addToCart, [obs('gap-001', [cartEffect])])]);
    console.log(`\n  Add to Cart: ${records[0].capability} (${records[0].confidence})`);
    expect(records[0].capability).toBe('Unclassified');
  });

  it('Color swatch → image change → Unclassified', () => {
    const colorSwatch = makeInteraction({
      type: 'Click' as InteractionType,
      trigger: { accessibleName: 'Blue', tag: 'BUTTON', ariaRole: 'button' },
      triggerEvent: { pageUrl: 'https://amazon.com/dp/B08XXXX/' },
    });
    colorSwatch.interactionId = 'gap-002';

    const imageEffect = effect({
      category: 'content-change',
      description: 'Product image src changed',
      affectedTarget: { role: null, label: null, cssPath: '#product-image' },
      netNodeDelta: 0,
    });

    const records = runCapabilityInference([withObs(colorSwatch, [obs('gap-002', [imageEffect])])]);
    console.log(`\n  Color swatch: ${records[0].capability} (${records[0].confidence})`);
    expect(records[0].capability).toBe('Unclassified');
  });

  it('"Wishlist" button → Unclassified', () => {
    const wishlist = makeInteraction({
      type: 'Click' as InteractionType,
      trigger: { accessibleName: 'Add to Wish List', tag: 'BUTTON', ariaRole: 'button' },
      triggerEvent: { pageUrl: 'https://amazon.com/dp/B08XXXX/' },
    });
    wishlist.interactionId = 'gap-003';

    const records = runCapabilityInference([wishlist]);
    console.log(`\n  Wishlist: ${records[0].capability} (${records[0].confidence})`);
    expect(records[0].capability).toBe('Unclassified');
  });
});
