/**
 * Phase 4 — Content-Change Capability Rules Tests
 *
 * Tests for FilterSelection, SortSelection, and Search rules.
 * Includes cross-rule conflict tests and the Amazon brand-filter case.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 4)
 */

import { describe, it, expect } from 'vitest';
import { FilterSelectionRule } from '../../src/capabilities/rules/filter-selection';
import { SortSelectionRule } from '../../src/capabilities/rules/sort-selection';
import { SearchRule } from '../../src/capabilities/rules/search';
import { ToggleControlRule } from '../../src/capabilities/rules/toggle-control';
import { PaginateRule } from '../../src/capabilities/rules/paginate';
import { CapabilityEngine } from '../../src/capabilities/capability-engine';
import type { ExtractedEvidence } from '../../src/capabilities/evidence-extractor';

import type { InteractionType } from '../../src/shared/component-types';
import { makeInteraction } from './phase4-helpers';

// ── Test Evidence Builder ─────────────────────────────────────────────

function makeEvidence(overrides: {
  hasContentChange?: boolean;
  hasVisibilityChange?: boolean;
  hasRemoteEffect?: boolean;
  hasStateToggle?: boolean;
  hasDirectPropertyEvidence?: boolean;
  netNodeDelta?: number | null;
  isCheckboxLike?: boolean;
  interactionType?: InteractionType;
  tag?: string;
  ariaRole?: string | null;
  accessibleName?: string;
  keywordMatches?: Array<{ capability: string; matched: string[] }>;
  ancestorRoles?: string[];
  ancestorClasses?: string[];
  urlChangedAfter?: boolean;
  urlPathChangedAfter?: boolean;
  precededByTextEntryOnSameForm?: boolean;
  precededByListContext?: boolean;
}): ExtractedEvidence {
  return {
    interactionId: 'int-test-001',
    physical: {
      interactionType: overrides.interactionType ?? 'Click',
      tag: overrides.tag ?? 'BUTTON',
      ariaRole: overrides.ariaRole ?? null,
      accessibleName: overrides.accessibleName ?? 'Test Element',
      href: null,
      isCheckboxLike: overrides.isCheckboxLike ?? false,
      isSliderLike: false,
      userAdjusted: false,
      isSubmitType: false,
      isFileInput: false,
      ancestorRoles: overrides.ancestorRoles ?? [],
      ancestorClasses: overrides.ancestorClasses ?? [],
    },
    behavioral: {
      effects: [],
      hasStateToggle: overrides.hasStateToggle ?? false,
      hasExpandCollapse: false,
      hasEnableDisable: false,
      hasContentChange: overrides.hasContentChange ?? false,
      hasVisibilityChange: overrides.hasVisibilityChange ?? false,
      hasRemoteEffect: overrides.hasRemoteEffect ?? false,
      hasDirectPropertyEvidence: overrides.hasDirectPropertyEvidence ?? false,
      netNodeDelta: overrides.netNodeDelta ?? null,
    },
    sequence: {
      previousInteractionType: null,
      precededBySamePage: true,
      precededByTextEntryOnSameForm: overrides.precededByTextEntryOnSameForm ?? false,
      urlChangedAfter: overrides.urlChangedAfter ?? false,
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      urlChanged: false,
      nextUrl: null,
      hasNextItemSpecificUrl: false,
      precededByListContext: overrides.precededByListContext ?? false,
      urlPathChangedAfter: overrides.urlPathChangedAfter ?? false,
      precededByFormInteraction: false,
      triggerHasItemSpecificHref: false,
    },
    keywords: {
      matches: (overrides.keywordMatches ?? []).map((m) => ({
        capability: m.capability as any,
        matched: m.matched,
      })),
      hasAnyMatch: (overrides.keywordMatches ?? []).length > 0,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// FilterSelection Rule
// ────────────────────────────────────────────────────────────────────────
describe('FilterSelectionRule', () => {
  const rule = new FilterSelectionRule();

  it('Amazon brand filter: Link + content-change on results + keyword "brand" → HIGH', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: -10,
      interactionType: 'Link',
      keywordMatches: [{ capability: 'FilterSelection', matched: ['brand'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('FilterSelection');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(35);
  });

  it('Checkbox + content-change + no filter-specific signal → null (generic remote change)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      isCheckboxLike: true,
      interactionType: 'Checkbox',
      // No keyword, no filter ancestor, no negative delta
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('Checkbox + content-change + ancestor "filter" → MEDIUM', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      isCheckboxLike: true,
      interactionType: 'Checkbox',
      ancestorClasses: ['filter-sidebar'],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('"Learn about filters" link with NO content-change → null', () => {
    const evidence = makeEvidence({
      hasContentChange: false,
      hasRemoteEffect: false,
      interactionType: 'Link',
      keywordMatches: [{ capability: 'FilterSelection', matched: ['filter'] }],
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('content-change on SAME element (not remote) → null', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: false,
      interactionType: 'Click',
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('visibility-change with no filter-specific signal → null (generic remote change)', () => {
    const evidence = makeEvidence({
      hasVisibilityChange: true,
      hasRemoteEffect: true,
      interactionType: 'Click',
      // No keyword, no filter ancestor, no negative delta
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('content-change BUT urlPathChangedAfter → null (Navigate territory)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      urlPathChangedAfter: true,
      interactionType: 'Click',
      keywordMatches: [{ capability: 'FilterSelection', matched: ['filter'] }],
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('content-change + urlChangedAfter (query-param only) + keyword → still claims (not Navigate)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      urlChangedAfter: true,
      urlPathChangedAfter: false,
      interactionType: 'Click',
      keywordMatches: [{ capability: 'FilterSelection', matched: ['filter'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('FilterSelection');
  });

  it('Link + content-change + keyword + negative delta → HIGH', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: -8,
      interactionType: 'Link',
      keywordMatches: [{ capability: 'FilterSelection', matched: ['filter', 'category'] }],
      ancestorClasses: ['sidebar'],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('high');
  });

  it('reason string contains keyword when present', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      interactionType: 'Click',
      keywordMatches: [{ capability: 'FilterSelection', matched: ['brand'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('brand');
  });

  it('reason string describes remote content-change with filter evidence', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      interactionType: 'Click',
      netNodeDelta: -5,
      // delta provides the filter-specific signal to pass the gate
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.reason).toContain('remote content-change');
  });

  it('strongly negative netNodeDelta adds behavioral stream', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: -12,
      interactionType: 'Click',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.signalStreams.has('behavioral')).toBe(true);
  });

  // ── Tightened gate: false-positive prevention ──────────────────
  // Remote content-change alone is insufficient. These are cases where
  // the control affects something external, but it is NOT a filter.

  it('"Add to Cart" → cart badge changes: no filter signal → null', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      interactionType: 'Click',
      accessibleName: 'Add to Cart',
      // No keyword, no filter ancestor, no negative delta
      // Cart badge is a characterData change (text "0" → "1")
      netNodeDelta: 0,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('colour swatch → image src changes: no filter signal → null', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      interactionType: 'Click',
      accessibleName: 'Blue',
      // No keyword, no filter ancestor, image swap is attribute change
      netNodeDelta: 0,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('generic remote content-change with delta ≈ 0 and no context → null', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      interactionType: 'Click',
      // No keyword, no filter ancestor, delta ≈ 0
      netNodeDelta: 1,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('visibility-change + filter ancestor → claims (MEDIUM)', () => {
    // This is still a valid filter: visibility change on results within a
    // filter sidebar context
    const evidence = makeEvidence({
      hasVisibilityChange: true,
      hasRemoteEffect: true,
      interactionType: 'Click',
      ancestorClasses: ['filter-sidebar'],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('medium');
  });
});

// ────────────────────────────────────────────────────────────────────────
// SortSelection Rule
// ────────────────────────────────────────────────────────────────────────
describe('SortSelectionRule', () => {
  const rule = new SortSelectionRule();

  it('Dropdown + content-change + keyword "sort" + delta=0 → HIGH', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: 0,
      interactionType: 'Dropdown',
      keywordMatches: [{ capability: 'SortSelection', matched: ['sort'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('SortSelection');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(40);
  });

  it('Dropdown + content-change + keyword "sort" + delta≠0 → HIGH (keyword compensates)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: 6,
      interactionType: 'Dropdown',
      keywordMatches: [{ capability: 'SortSelection', matched: ['price: low'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('high');
  });

  it('Dropdown + content-change + no keyword + delta≈0 → MEDIUM', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: 1,
      interactionType: 'Dropdown',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('Dropdown + content-change + no keyword + delta≠0 → MEDIUM (Dropdown is the signal)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: 25,
      interactionType: 'Dropdown',
    });
    const claim = rule.evaluate(evidence);
    // Dropdown alone satisfies required-2. No keyword, no delta support. Medium.
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('medium');
  });

  it('Click + content-change + no keyword + no Dropdown → null', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: 0,
      interactionType: 'Click',
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('content-change on SAME element (not remote) → null', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: false,
      interactionType: 'Dropdown',
      keywordMatches: [{ capability: 'SortSelection', matched: ['sort'] }],
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('NO content-change → null', () => {
    const evidence = makeEvidence({
      hasContentChange: false,
      hasRemoteEffect: false,
      interactionType: 'Dropdown',
      keywordMatches: [{ capability: 'SortSelection', matched: ['sort'] }],
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('urlPathChangedAfter → null (Navigate territory)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      urlPathChangedAfter: true,
      interactionType: 'Dropdown',
      keywordMatches: [{ capability: 'SortSelection', matched: ['sort'] }],
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('urlChangedAfter (query-param only) + keyword → still claims (not Navigate)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      urlChangedAfter: true,
      urlPathChangedAfter: false,
      interactionType: 'Dropdown',
      keywordMatches: [{ capability: 'SortSelection', matched: ['sort'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('SortSelection');
  });

  it('keyword "newest" + Dropdown + delta≈0 → HIGH', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: -2,
      interactionType: 'Dropdown',
      keywordMatches: [{ capability: 'SortSelection', matched: ['newest'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('high');
  });

  it('reason string contains keyword', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      interactionType: 'Dropdown',
      keywordMatches: [{ capability: 'SortSelection', matched: ['relevance'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('relevance');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Search Rule
// ────────────────────────────────────────────────────────────────────────
describe('SearchRule', () => {
  const rule = new SearchRule();

  it('TextEntry + keyword "search" + content-change → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
      keywordMatches: [{ capability: 'Search', matched: ['search'] }],
      hasContentChange: true,
      hasRemoteEffect: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('Search');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(30);
  });

  it('TextEntry + no keyword + content-change follows → MEDIUM (C2 live search)', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
      hasContentChange: true,
      hasRemoteEffect: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('TextEntry + no keyword + no content-change + no context → null', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('TextEntry + keyword "search" only → MEDIUM', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
      keywordMatches: [{ capability: 'Search', matched: ['search'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('TextEntry + search ancestor context + content-change → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
      ancestorRoles: ['search'],
      hasContentChange: true,
      hasRemoteEffect: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('high');
  });

  it('TextEntry + urlChangedAfter → MEDIUM (navigate to search results)', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
      urlChangedAfter: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('medium');
  });

  it('TextEntry + searchbox role + content-change → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
      ariaRole: 'searchbox',
      hasContentChange: true,
      hasRemoteEffect: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('high');
  });

  it('Click (not TextEntry) → null', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      keywordMatches: [{ capability: 'Search', matched: ['search'] }],
      hasContentChange: true,
      hasRemoteEffect: true,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('TextEntry + ancestor class "search-box" → search context detected', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
      ancestorClasses: ['search-box'],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.signalStreams.has('structural')).toBe(true);
  });

  it('reason string mentions search evidence', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
      keywordMatches: [{ capability: 'Search', matched: ['find'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('find');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cross-Rule Conflicts
// ────────────────────────────────────────────────────────────────────────
describe('Phase 4 Cross-Rule Conflicts', () => {
  it('Amazon brand filter: FilterSelection HIGH vs SortSelection null (no sort keyword/Dropdown)', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new FilterSelectionRule());
    engine.registerRule(new SortSelectionRule());

    // Amazon: Link, content-change on results, keyword "brand", negative delta
    // No sort keyword, no Dropdown → SortSelection returns null
    const interaction = makeInteraction({
      type: 'Link',
      trigger: {
        accessibleName: 'vivo',
        tag: 'A',
        ariaRole: 'link',
      },
      triggerEvent: {
        domContext: { ancestorClasses: ['s-navigation-item'] },
      },
    });
    const effectsMap = new Map([
      ['int-test-001', [{
        category: 'content-change' as const,
        description: 'broad rerender',
        affectedTarget: { role: null, label: null, cssPath: '#results' },
        confidence: 'low' as const,
        confidenceBasis: 'structural-inference' as const,
        evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
        netNodeDelta: -15,
      }]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].capability).toBe('FilterSelection');
    expect(results[0].alternatives).toEqual([]);
  });

  it('"Email notifications" checkbox: ToggleControl HIGH, FilterSelection null (no filter signal)', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new FilterSelectionRule());
    engine.registerRule(new ToggleControlRule());

    const interaction = makeInteraction({
      type: 'Checkbox',
      trigger: {
        accessibleName: 'Email notifications',
        tag: 'INPUT',
        ariaRole: 'checkbox',
      },
      triggerEvent: {
        domContext: { inputType: 'checkbox' },
      },
    });
    const effectsMap = new Map([
      ['int-test-001', [
        {
          category: 'state-toggle' as const,
          description: 'checked: false → true',
          affectedTarget: { role: 'checkbox', label: 'Email notifications', cssPath: 'body > input' },
          confidence: 'high' as const,
          confidenceBasis: 'direct-property' as const,
          evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
        },
        {
          category: 'content-change' as const,
          description: 'Settings saved',
          affectedTarget: { role: null, label: null, cssPath: '#toast' },
          confidence: 'low' as const,
          confidenceBasis: 'structural-inference' as const,
          evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
          netNodeDelta: 1,
        },
      ]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].capability).toBe('ToggleControl');
    expect(results[0].confidence).toBe('high');
    // With tightened gate, FilterSelection returns null — no filter keyword,
    // no filter ancestor, delta ≈ 0. Remote content-change alone is insufficient.
    expect(results[0].alternatives.some((a) => a.capability === 'FilterSelection')).toBe(false);
  });

  it('Sort vs Filter conflict: Filter MEDIUM beats Sort LOW/MEDIUM by priority', () => {
    // Both claim at MEDIUM. FilterSelection priority 35 < SortSelection priority 40.
    // Lower priority number wins → FilterSelection wins.
    const engine = new CapabilityEngine();
    engine.registerRule(new FilterSelectionRule());
    engine.registerRule(new SortSelectionRule());

    // Dropdown with filter keyword and sort keyword, content-change on results
    const interaction = makeInteraction({
      type: 'Dropdown',
      trigger: {
        accessibleName: 'Filter and Sort',
        tag: 'SELECT',
        ariaRole: 'listbox',
      },
    });
    const effectsMap = new Map([
      ['int-test-001', [{
        category: 'content-change' as const,
        description: 'results reordered',
        affectedTarget: { role: null, label: null, cssPath: '#results' },
        confidence: 'low' as const,
        confidenceBasis: 'structural-inference' as const,
        evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
        netNodeDelta: 0,
      }]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);
    // Sort should win because it has keyword + Dropdown + delta≈0 → HIGH
    // while Filter has keyword but no checkbox/ancestor → MEDIUM
    expect(results[0].capability).toBe('SortSelection');
    expect(results[0].confidence).toBe('high');
  });

  it('Paginate does NOT claim (no pagination keyword) when Filter claims', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new FilterSelectionRule());
    engine.registerRule(new PaginateRule());

    const interaction = makeInteraction({
      type: 'Link',
      trigger: {
        accessibleName: 'Sony',
        tag: 'A',
        ariaRole: 'link',
      },
    });
    const effectsMap = new Map([
      ['int-test-001', [{
        category: 'content-change' as const,
        description: 'results filtered',
        affectedTarget: { role: null, label: null, cssPath: '#results' },
        confidence: 'low' as const,
        confidenceBasis: 'structural-inference' as const,
        evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
        netNodeDelta: -20,
      }]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);
    // Paginate returns null (no pagination keyword)
    // FilterSelection claims MEDIUM (remote content-change + negative delta signal)
    expect(results[0].capability).not.toBe('Paginate');
  });

  it('No content-change at all → all three return null → Unclassified', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new FilterSelectionRule());
    engine.registerRule(new SortSelectionRule());
    engine.registerRule(new SearchRule());

    const interaction = makeInteraction({
      type: 'Click',
      trigger: { accessibleName: 'About Us', tag: 'A' },
    });
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results[0].capability).toBe('Unclassified');
  });
});
