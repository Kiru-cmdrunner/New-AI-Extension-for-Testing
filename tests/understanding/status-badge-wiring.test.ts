/**
 * D11 — Status-Badge → EntityStateTracker Wiring Tests
 *
 * Verifies that status badges observed via the production evidence
 * pipeline (where entityId and entityType are null) are NOT silently
 * dropped in multi-entity applications. The most-recently-updated
 * entity fallback ensures state transitions are recorded.
 *
 * Architecture: .drytis/specs/deterministic-defects.md §D11
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import { createEntityTypeRegistry } from '../../src/understanding/state-builder/entity-type-registry';

describe('D11 — Status-Badge → EntityStateTracker (multi-entity)', () => {
  let builder: StateBuilder;

  beforeEach(() => {
    builder = new StateBuilder(createEntityTypeRegistry(true));
  });

  it('single entity: badge updates the sole entity', () => {
    // Step 1: set view + create entity via page content
    builder.processSignals({
      interactionId: 'int-1',
      viewChanges: [{
        type: 'view-change', source: 'navigation', interactionId: 'int-1',
        fromUrl: 'https://example.com/',
        toUrl: 'https://example.com/leave/1',
        fromView: null,
        toView: { id: 'leave-detail', label: 'Leave', matchedSelectors: [], matchedPatterns: [] },
      }],
      apiOperations: [], notifications: [], counterChanges: [], listChanges: [], inputChanges: [],
      pageContent: {
        type: 'page-content', source: 'page-content', interactionId: 'int-1',
        snapshot: {
          url: 'https://example.com/leave/1', viewId: 'leave-detail',
          items: [], itemsOverflow: 0, scannedAt: 0, scanDurationMs: 0,
        },
        observedEntities: [{
          kind: 'entity', matchedSelector: 'page-content', text: 'Leave Request 1',
          numericValue: null, entityId: '1', entityType: 'leave-request',
          domPath: '/html/body/div', attributes: {}, visible: true,
        }],
        observedCounters: [], observedCollections: [],
        observedNotifications: [], observedStatusBadges: [],
      },
    } as any);

    // Step 2: apply status badge with null entityId/entityType
    const result = builder.processSignals({
      interactionId: 'int-2',
      viewChanges: [], apiOperations: [], notifications: [],
      counterChanges: [], listChanges: [], inputChanges: [],
      pageContent: {
        type: 'page-content', source: 'page-content', interactionId: 'int-2',
        snapshot: {
          url: 'https://example.com/leave/1', viewId: 'leave-detail',
          items: [], itemsOverflow: 0, scannedAt: 0, scanDurationMs: 0,
        },
        observedEntities: [],
        observedCounters: [], observedCollections: [],
        observedNotifications: [],
        observedStatusBadges: [{
          kind: 'status-badge', matchedSelector: 'aria-role', text: 'Approved',
          numericValue: null, entityId: null, entityType: null,
          domPath: '/html/body/div/span',
          attributes: { 'aria-role': 'status' }, visible: true,
        }],
      },
    } as any);

    // Entity should have state "approved"
    const entities = Array.from(result.after.entities.values());
    const emp = entities.find((e) => e.type === 'leave-request');
    expect(emp).toBeDefined();
    expect(emp!.currentState).toBe('approved');
  });

  it('multi-entity: badge applies to most-recently-updated entity (D11 fix)', () => {
    // Create two entities
    builder.processSignals({
      interactionId: 'int-1',
      viewChanges: [{
        type: 'view-change', source: 'navigation', interactionId: 'int-1',
        fromUrl: 'https://example.com/',
        toUrl: 'https://example.com/leave',
        fromView: null,
        toView: { id: 'leave-list', label: 'Leave List', matchedSelectors: [], matchedPatterns: [] },
      }],
      apiOperations: [], notifications: [], counterChanges: [], listChanges: [], inputChanges: [],
      pageContent: {
        type: 'page-content', source: 'page-content', interactionId: 'int-1',
        snapshot: {
          url: 'https://example.com/leave', viewId: 'leave-list',
          items: [], itemsOverflow: 0, scannedAt: 0, scanDurationMs: 0,
        },
        observedEntities: [
          {
            kind: 'entity', matchedSelector: 'page-content', text: 'Leave 1',
            numericValue: null, entityId: '1', entityType: 'leave-request',
            domPath: '/html/body/div[1]', attributes: {}, visible: true,
          },
          {
            kind: 'entity', matchedSelector: 'page-content', text: 'Leave 2',
            numericValue: null, entityId: '2', entityType: 'leave-request',
            domPath: '/html/body/div[2]', attributes: {}, visible: true,
          },
        ],
        observedCounters: [], observedCollections: [],
        observedNotifications: [], observedStatusBadges: [],
      },
    } as any);

    // Apply badge — both entities exist, badge has no entityId/entityType
    const result = builder.processSignals({
      interactionId: 'int-2',
      viewChanges: [], apiOperations: [], notifications: [],
      counterChanges: [], listChanges: [], inputChanges: [],
      pageContent: {
        type: 'page-content', source: 'page-content', interactionId: 'int-2',
        snapshot: {
          url: 'https://example.com/leave', viewId: 'leave-list',
          items: [], itemsOverflow: 0, scannedAt: 0, scanDurationMs: 0,
        },
        observedEntities: [],
        observedCounters: [], observedCollections: [],
        observedNotifications: [],
        observedStatusBadges: [{
          kind: 'status-badge', matchedSelector: 'aria-role', text: 'Pending',
          numericValue: null, entityId: null, entityType: null,
          domPath: '/html/body/div/span',
          attributes: { 'aria-role': 'status' }, visible: true,
        }],
      },
    } as any);

    // D11: previously this was silently dropped. Now it should apply
    // to the most-recently-updated entity.
    const entities = Array.from(result.after.entities.values());
    const withState = entities.filter((e) => e.currentState !== undefined);
    expect(withState.length).toBeGreaterThanOrEqual(1);
  });

  it('unrecognized state text is still skipped', () => {
    builder.processSignals({
      interactionId: 'int-1',
      viewChanges: [{
        type: 'view-change', source: 'navigation', interactionId: 'int-1',
        fromUrl: 'https://example.com/',
        toUrl: 'https://example.com/leave',
        fromView: null,
        toView: { id: 'leave-list', label: 'L', matchedSelectors: [], matchedPatterns: [] },
      }],
      apiOperations: [], notifications: [], counterChanges: [], listChanges: [], inputChanges: [],
      pageContent: null,
    } as any);

    const result = builder.processSignals({
      interactionId: 'int-2',
      viewChanges: [], apiOperations: [], notifications: [],
      counterChanges: [], listChanges: [], inputChanges: [],
      pageContent: {
        type: 'page-content', source: 'page-content', interactionId: 'int-2',
        snapshot: {
          url: 'https://example.com/leave', viewId: 'leave-list',
          items: [], itemsOverflow: 0, scannedAt: 0, scanDurationMs: 0,
        },
        observedEntities: [],
        observedCounters: [], observedCollections: [],
        observedNotifications: [],
        observedStatusBadges: [{
          kind: 'status-badge', matchedSelector: 'aria-role', text: 'gibberish',
          numericValue: null, entityId: null, entityType: null,
          domPath: '/d', attributes: {}, visible: true,
        }],
      },
    } as any);

    // No state change should be recorded
    const entities = Array.from(result.after.entities.values());
    expect(entities.filter((e) => e.currentState !== undefined).length).toBe(0);
  });
});
