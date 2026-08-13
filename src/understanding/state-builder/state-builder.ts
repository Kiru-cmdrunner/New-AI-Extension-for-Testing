/**
 * State Builder — the stateful accumulator that processes SignalSets
 * and produces evolving ApplicationState.
 *
 * Each call to processSignals() takes a SignalSet for one interaction and
 * produces a StateTransition (before state → after state).
 *
 * The builder maintains the entity, collection, counter, and notification
 * trackers internally. The current ApplicationState is always available
 * via getCurrentState().
 *
 * M9.2 — In-memory only, no persistence.
 */

import type { SignalSet, ViewChangeSignal, ApiOperationSignal } from '../types';
import type { PageContentSignal } from '../page-content/page-content-types';
import { EntityTracker } from './entity-tracker';
import { CollectionTracker } from './collection-tracker';
import { CounterTracker } from './counter-tracker';
import { NotificationTracker } from './notification-tracker';
import type { ApplicationState, StateTransition, Entity } from './types';

export class StateBuilder {
  private currentView: import('../types').ViewDescriptor | null = null;
  private currentUrl: string | null = null;
  private readonly entityTracker = new EntityTracker();
  private readonly collectionTracker = new CollectionTracker();
  private readonly counterTracker = new CounterTracker();
  private readonly notificationTracker = new NotificationTracker();
  private interactionCount = 0;
  private lastInteractionId: string | null = null;

  /**
   * Process one interaction's signals and produce a state transition.
   */
  processSignals(signals: SignalSet): StateTransition {
    const before = this.getCurrentState();
    const changes: string[] = [];

    // ── View changes ──
    for (const vc of signals.viewChanges) {
      this.currentView = vc.toView;
      this.currentUrl = vc.toUrl;
      changes.push(`view → ${vc.toView.id}`);

      // Derive entities from view transitions
      this.deriveEntitiesFromView(vc, changes);
    }

    // ── API operations → entity derivation ──
    for (const op of signals.apiOperations) {
      this.deriveEntitiesFromApiOp(op, changes);
    }

    // ── Page content snapshot (M9.4) ──
    if (signals.pageContent) {
      this.processPageContent(signals.pageContent, changes);
    }

    // ── Notifications ──
    for (const notif of signals.notifications) {
      if (notif.kind === 'appeared') {
        this.notificationTracker.recordAppearance(
          notif.text,
          notif.severity,
          notif.elementPath,
          signals.interactionId,
        );
        changes.push(`notification: "${notif.text.substring(0, 50)}" (${notif.severity})`);
      } else {
        this.notificationTracker.recordDisappearance(notif.elementPath, signals.interactionId);
      }
    }

    // ── Counter changes ──
    for (const cc of signals.counterChanges) {
      this.counterTracker.record(cc.elementPath, cc.newValue, signals.interactionId, cc.label);
      const deltaStr = cc.numericDelta !== null ? ` (Δ${cc.numericDelta > 0 ? '+' : ''}${cc.numericDelta})` : '';
      changes.push(`counter: ${cc.oldValue ?? '?'} → ${cc.newValue}${deltaStr}`);
    }

    // ── List changes ──
    for (const lc of signals.listChanges) {
      this.collectionTracker.update(
        lc.containerPath,
        lc.addedCount,
        lc.removedCount,
        signals.interactionId,
      );
      changes.push(`list: ${lc.containerPath} (${lc.netChange >= 0 ? '+' : ''}${lc.netChange} items)`);
    }

    // ── Input value changes ──
    for (const ic of signals.inputChanges) {
      // Create or update a search-query entity if the field looks like a search input
      if (ic.field.toLowerCase().includes('search') || ic.field.toLowerCase().includes('query')) {
        if (ic.newValue && ic.newValue.trim().length > 0) {
          const entity: Entity = {
            id: `search-query:${ic.newValue}`,
            type: 'search-query',
            attributes: {
              term: ic.newValue,
              field: ic.field,
            },
            source: 'target-derived',
            firstSeenAt: signals.interactionId,
            lastUpdated: signals.interactionId,
          };
          this.entityTracker.upsert(entity);
          changes.push(`search query: "${ic.newValue}"`);
        }
      }
    }

    this.interactionCount++;
    this.lastInteractionId = signals.interactionId;

    const after = this.getCurrentState();
    return { interactionId: signals.interactionId, before, after, changes };
  }

  /**
   * Derive entities from a view change.
   * E.g., navigating to /dp/ASIN creates a Product entity.
   */
  private deriveEntitiesFromView(vc: ViewChangeSignal, changes: string[]): void {
    if (vc.toView.id === 'product-detail') {
      // Try to extract product ID from URL
      const asinMatch = vc.toUrl.match(/\/dp\/([A-Z0-9]{10})/);
      if (asinMatch) {
        const asin = asinMatch[1];
        const entity: Entity = {
          id: `product:${asin}`,
          type: 'product',
          attributes: {
            asin,
            url: vc.toUrl,
          },
          source: 'view-derived',
          firstSeenAt: vc.interactionId,
          lastUpdated: vc.interactionId,
        };
        this.entityTracker.upsert(entity);
        changes.push(`product entity: ${asin}`);
      }
    }

    if (vc.toView.id === 'search-results' && (!vc.fromView || vc.fromView.id !== vc.toView.id)) {
      // Try to extract search query from URL
      const queryMatch = vc.toUrl.match(/[?&](?:field-keywords|q|query|search|keywords|k)=([^&]+)/i);
      if (queryMatch) {
        const term = decodeURIComponent(queryMatch[1].replace(/\+/g, ' '));
        const entity: Entity = {
          id: `search-query:${term}`,
          type: 'search-query',
          attributes: {
            term,
            url: vc.toUrl,
          },
          source: 'view-derived',
          firstSeenAt: vc.interactionId,
          lastUpdated: vc.interactionId,
        };
        this.entityTracker.upsert(entity);
        changes.push(`search query (from URL): "${term}"`);
      }
    }
  }

  /**
   * Derive entities from API operations.
   * E.g., add-to-cart creates a cart-item entity.
   */
  private deriveEntitiesFromApiOp(op: ApiOperationSignal, changes: string[]): void {
    if (op.operation === 'add-to-cart' && op.succeeded !== false) {
      // We know a cart item was added, but we may not know which product yet.
      // Create a tentative cart-item entity.
      const entity: Entity = {
        id: `cart-item:${op.interactionId}`,
        type: 'cart-item',
        attributes: {
          addedAt: op.interactionId,
          via: op.url,
        },
        source: 'inferred',
        firstSeenAt: op.interactionId,
        lastUpdated: op.interactionId,
      };
      this.entityTracker.upsert(entity);
      changes.push(`cart-item entity (from API)`);
    }
  }

  /**
   * Process a page-content snapshot (M9.4) into the state model:
   * entities, collections, counters, notifications.
   */
  private processPageContent(pc: PageContentSignal, changes: string[]): void {
    const iid = pc.interactionId;

    // Entities observed in content
    for (const obs of pc.observedEntities) {
      if (!obs.entityId) continue;
      const type = (obs.entityType ?? 'unknown') as import('./types').EntityType;
      this.entityTracker.upsert({
        id: `${type}:${obs.entityId}`,
        type,
        attributes: {
          ...obs.attributes,
          ...(obs.numericValue !== null ? { count: obs.numericValue } : {}),
          ...(textAsAttr(obs.text) ? { title: obs.text } : {}),
        },
        source: 'view-derived',
        firstSeenAt: iid,
        lastUpdated: iid,
      });
      changes.push(`page-content entity: ${type}:${obs.entityId}`);
    }

    // Counters observed in content (set absolute value)
    for (const obs of pc.observedCounters) {
      if (obs.numericValue === null) continue;
      this.counterTracker.record(
        obs.domPath,
        String(obs.numericValue),
        iid,
        obs.attributes['aria-label'] ?? null,
      );
      changes.push(`page-content counter: ${obs.domPath} = ${obs.numericValue}`);
    }

    // Collections observed in content (set absolute count)
    for (const obs of pc.observedCollections) {
      if (obs.numericValue === null) continue;
      this.collectionTracker.setCount(obs.domPath, obs.numericValue, iid);
      changes.push(`page-content collection: ${obs.domPath} = ${obs.numericValue} items`);
    }

    // Notifications observed in content
    for (const obs of pc.observedNotifications) {
      if (!obs.text) continue;
      this.notificationTracker.recordAppearance(
        obs.text,
        classifySeverity(obs.text),
        obs.domPath,
        iid,
      );
      changes.push(`page-content notification: "${obs.text.substring(0, 40)}"`);
    }
  }

  /**
   * Get the current application state snapshot.
   */
  getCurrentState(): ApplicationState {
    return {
      currentView: this.currentView ? { ...this.currentView } : null,
      currentUrl: this.currentUrl,
      entities: this.entityTracker.snapshot(),
      collections: this.collectionTracker.snapshot(),
      counters: this.counterTracker.snapshot(),
      notifications: this.notificationTracker.getAll(),
      lastInteractionId: this.lastInteractionId,
      interactionCount: this.interactionCount,
    };
  }

  /**
   * Reset the builder to initial state (for testing or new recording session).
   */
  reset(): void {
    this.currentView = null;
    this.currentUrl = null;
    this.entityTracker.clear();
    this.collectionTracker.clear();
    this.counterTracker.clear();
    this.notificationTracker.clear();
    this.interactionCount = 0;
    this.lastInteractionId = null;
  }
}

// -- Helpers --

/**
 * Decide if a text string is meaningful as an entity title attribute.
 * Must be non-trivial (longer than 2 chars, not just a number).
 */
function textAsAttr(text: string): boolean {
  return text.length >= 3 && !/^\d+$/.test(text);
}

/**
 * Classify notification severity from text content.
 * Simple heuristic - positive words suggest success, negative suggest error.
 */
function classifySeverity(text: string): 'success' | 'error' | 'warning' | 'info' {
  const lower = text.toLowerCase();
  if (lower.includes('error') || lower.includes('failed') || lower.includes('invalid')) {
    return 'error';
  }
  if (lower.includes('success') || lower.includes('added') || lower.includes('complete') || lower.includes('confirmed')) {
    return 'success';
  }
  if (lower.includes('warning') || lower.includes('caution') || lower.includes('attention')) {
    return 'warning';
  }
  return 'info';
}
