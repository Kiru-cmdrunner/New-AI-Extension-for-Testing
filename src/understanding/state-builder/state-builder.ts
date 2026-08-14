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
import type { PageContentSignal, ObservedItem } from '../page-content/page-content-types';
import { EntityTracker } from './entity-tracker';
import { CollectionTracker } from './collection-tracker';
import { CounterTracker } from './counter-tracker';
import { NotificationTracker } from './notification-tracker';
import {
  createEntityTypeRegistry,
  EntityTypeRegistry,
} from './entity-type-registry';
import {
  EntityStateTracker,
  normalizeStateText,
  extractStateFromNotification,
} from './entity-state-tracker';
import type { ApplicationState, StateTransition, Entity } from './types';

import type { StateVocabularyRegistry } from '../domain-config/state-vocabulary-registry';
import type { StateBuilderSeed } from '../consolidation/application-knowledge';

export class StateBuilder {
  private currentView: import('../types').ViewDescriptor | null = null;
  private currentUrl: string | null = null;
  private readonly entityTracker = new EntityTracker();
  private readonly collectionTracker = new CollectionTracker();
  private readonly counterTracker = new CounterTracker();
  private readonly notificationTracker = new NotificationTracker();
  private readonly stateTracker = new EntityStateTracker();
  private interactionCount = 0;
  private lastInteractionId: string | null = null;
  private readonly entityTypeRegistry: EntityTypeRegistry;
  private readonly stateVocabularyRegistry: StateVocabularyRegistry | null;
  /**
   * DDC-5: evidence-quality flags set by the pipeline for the NEXT
   * processSignals call (read from the interaction's behavioral evidence).
   */
  private pendingEvidenceQuality: {
    mainThreadBlocked: boolean;
    domChangeOverflow: number;
    coarseMode: boolean;
  } | null = null;

  /**
   * DDC-5: set evidence-quality flags for the next processSignals call.
   */
  setEvidenceQuality(q: {
    mainThreadBlocked: boolean;
    domChangeOverflow: number;
    coarseMode: boolean;
  } | null): void {
    this.pendingEvidenceQuality = q;
  }

  /**
   * @param entityTypeRegistry Optional registry for custom entity types.
   *   If omitted, a default-seeded registry is created. Pass `false` to
   *   create a builder with no registry (legacy behavior, no custom types).
   * @param stateVocabRegistry Optional registry for domain-specific state
   *   keywords (M9.11). When provided, badge/notification state detection
   *   checks domain vocabulary before built-in keywords.
   */
  constructor(
    entityTypeRegistry?: EntityTypeRegistry | false,
    stateVocabRegistry?: StateVocabularyRegistry | null,
  ) {
    this.entityTypeRegistry =
      entityTypeRegistry === false
        ? new EntityTypeRegistry()
        : entityTypeRegistry ?? createEntityTypeRegistry(true);
    this.stateVocabularyRegistry = stateVocabRegistry ?? null;
  }

  /**
   * Process one interaction's signals and produce a state transition.
   */
  processSignals(signals: SignalSet): StateTransition {
    const before = this.getCurrentState();
    const changes: string[] = [];

    // DDC-5: record evidence-quality degradation markers so persistence
    // (stateTransitions.changes) carries WHY confidence was downgraded.
    if (this.pendingEvidenceQuality) {
      const q = this.pendingEvidenceQuality;
      if (q.mainThreadBlocked) changes.push('evidence-degraded: main-thread-blocked');
      if (q.domChangeOverflow > 0) changes.push(`evidence-degraded: dom-change-overflow (${q.domChangeOverflow})`);
      if (q.coarseMode) changes.push('evidence-degraded: coarse-mode');
      this.pendingEvidenceQuality = null;
    }

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

    // ── Build dedup guard from signal-level changes ──
    // D2/dup fix: collect paths that CounterSignalExtractor and
    // ListSignalExtractor already handle, so processPageContent() can
    // skip re-recording them.
    const counterPaths = new Set(
      signals.counterChanges.map((cc) => cc.elementPath),
    );
    const collectionPaths = new Set(
      signals.listChanges.map((lc) => lc.containerPath),
    );

    // ── Page content snapshot (M9.4) ──
    if (signals.pageContent) {
      this.processPageContent(
        signals.pageContent,
        changes,
        counterPaths,
        collectionPaths,
      );
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

        // M9.9: Notification text may indicate a state transition.
        this.detectStateFromNotification(notif.text, signals.interactionId);
      } else {
        this.notificationTracker.recordDisappearance(notif.elementPath, signals.interactionId);
      }
    }

    // ── Counter changes ──
    for (const cc of signals.counterChanges) {
      this.counterTracker.record(
        cc.elementPath,
        cc.newValue,
        signals.interactionId,
        cc.label,
        this.currentView?.id,
      );
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
        'unknown',
        this.currentView?.id,
      );
      changes.push(`list: ${lc.containerPath} (${lc.netChange >= 0 ? '+' : ''}${lc.netChange} items)`);
    }

    // ── Input value changes ──
    for (const ic of signals.inputChanges) {
      const fieldName = ic.field.toLowerCase();

      // D6: Generalized form-field entity creation.
      // First try the EntityTypeRegistry for domain-specific field patterns.
      const registryType = this.entityTypeRegistry.resolveFromFormField(ic.field);

      // Legacy: search/query fields always produce search-query entities.
      if (fieldName.includes('search') || fieldName.includes('query')) {
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
            viewIds: this.currentView ? [this.currentView.id] : undefined,
          };
          this.entityTracker.upsert(entity);
          changes.push(`search query: "${ic.newValue}"`);
        }
      } else if (registryType && ic.newValue && ic.newValue.trim().length > 0) {
        // D6: Registry-based form-field entity creation for non-search domains.
        const entity: Entity = {
          id: `${registryType}:${ic.newValue}`,
          type: registryType,
          attributes: {
            value: ic.newValue,
            field: ic.field,
          },
          source: 'target-derived',
          firstSeenAt: signals.interactionId,
          lastUpdated: signals.interactionId,
          viewIds: this.currentView ? [this.currentView.id] : undefined,
        };
        this.entityTracker.upsert(entity);
        changes.push(`form field entity (${registryType}): "${ic.newValue}"`);
      }
    }

    // ── Control state changes (DDC-6) ──
    // Checkbox toggles, accordion expand/collapse, toggle buttons,
    // multi-select changes. Recorded as transition changes; the interacted
    // element's entity attribute is updated when a form-field entity for
    // the same field exists.
    for (const csc of signals.controlStateChanges ?? []) {
      const desc = csc.elementLabel ? `${csc.elementLabel} (${csc.property})` : csc.property;
      changes.push(`control: ${desc} ${csc.oldValue ?? '∅'} → ${csc.newValue ?? '∅'}`);

      // Update the attribute on any entity created from this same field
      // (e.g., form-field entity keyed by the field's value).
      const attrKey = `control.${csc.property}`;
      for (const [id, entity] of this.entityTracker.snapshot()) {
        if (
          entity.attributes &&
          (entity.attributes['field'] === csc.field ||
            (entity.attributes['field'] as string | undefined)?.includes(csc.field))
        ) {
          this.entityTracker.upsert({
            ...entity,
            attributes: { ...entity.attributes, [attrKey]: csc.newValue ?? '' },
            lastUpdated: signals.interactionId,
          });
          changes.push(`entity attribute: ${id} ${attrKey}=${csc.newValue}`);
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
          viewIds: [vc.toView.id],
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
          viewIds: [vc.toView.id],
        };
        this.entityTracker.upsert(entity);
        changes.push(`search query (from URL): "${term}"`);
      }
    }

    // M9.8: Registry-based view entity detection (non-e-commerce domains).
    // Runs after legacy logic so existing behavior is never overridden.
    const registryResult = this.entityTypeRegistry.resolveFromView(
      vc.toView.id,
      vc.toUrl,
    );
    if (registryResult) {
      const entityId = registryResult.id
        ? `${registryResult.type}:${registryResult.id}`
        : `${registryResult.type}:${vc.interactionId}`;
      // Don't overwrite an entity created by legacy logic
      if (!this.entityTracker.get(entityId)) {
        const entity: Entity = {
          id: entityId,
          type: registryResult.type,
          attributes: {
            url: vc.toUrl,
            ...(registryResult.id ? { id: registryResult.id } : {}),
          },
          source: 'view-derived',
          firstSeenAt: vc.interactionId,
          lastUpdated: vc.interactionId,
          viewIds: [vc.toView.id],
        };
        this.entityTracker.upsert(entity);
        changes.push(`${registryResult.type} entity (from registry)`);
      }
    }
  }

  /**
   * Derive entities from API operations.
   * E.g., add-to-cart creates a cart-item entity.
   *
   * Network Hardening: When the request body contains product identifiers
   * (ASIN, productId), the cart-item entity is linked to the product
   * entity via attributes.productId.
   */
  private deriveEntitiesFromApiOp(op: ApiOperationSignal, changes: string[]): void {
    if (op.operation === 'add-to-cart' && op.succeeded !== false) {
      // Extract product ID from entity hints if available
      const productIdHint = op.entityHints?.find(h => h.hint === 'product-id');
      const quantityHint = op.entityHints?.find(h => h.hint === 'quantity');

      const entity: Entity = {
        id: productIdHint
          ? `cart-item:${productIdHint.value}`
          : `cart-item:${op.interactionId}`,
        type: 'cart-item',
        attributes: {
          addedAt: op.interactionId,
          via: op.url,
          ...(productIdHint ? { productId: productIdHint.value } : {}),
          ...(quantityHint ? { quantity: quantityHint.value } : {}),
        },
        source: productIdHint ? 'inferred' : 'inferred',
        firstSeenAt: op.interactionId,
        lastUpdated: op.interactionId,
        viewIds: this.currentView ? [this.currentView.id] : undefined,
      };
      this.entityTracker.upsert(entity);
      changes.push(`cart-item entity (from API${productIdHint ? ', productId=' + productIdHint.value : ''})`);
    }

    // M9.8: Registry-based API operation entity detection.
    if (op.operation !== 'add-to-cart') {
      const registryResult = this.entityTypeRegistry.resolveFromApiOperation(
        op.operation,
        op.interactionId,
      );
      if (registryResult && !this.entityTracker.get(registryResult.id)) {
        const entity: Entity = {
          id: registryResult.id,
          type: registryResult.type,
          attributes: {
            via: op.url,
            operation: op.operation,
          },
          source: 'inferred',
          firstSeenAt: op.interactionId,
          lastUpdated: op.interactionId,
          viewIds: this.currentView ? [this.currentView.id] : undefined,
        };
        this.entityTracker.upsert(entity);
        changes.push(`${registryResult.type} entity (from API registry)`);
      }
    }
  }

  /**
   * Process a page-content snapshot (M9.4) into the state model:
   * entities, collections, counters, notifications.
   *
   * D2/dup fix: counterPaths and collectionPaths contain DOM paths that
   * CounterSignalExtractor / ListSignalExtractor already handle for this
   * interaction. We skip those paths here to prevent double-recording.
   */
  private processPageContent(
    pc: PageContentSignal,
    changes: string[],
    counterPaths?: Set<string>,
    collectionPaths?: Set<string>,
  ): void {
    const iid = pc.interactionId;

    // Entities observed in content
    for (const obs of pc.observedEntities) {
      if (!obs.entityId) continue;

      // M9.8: Try the registry first for custom domain types.
      // Falls back to the observed kind or 'unknown'.
      const registryType = this.entityTypeRegistry.resolveFromPageContent(
        obs.entityType,
        obs.entityId,
      );
      const type = registryType ?? (obs.entityType ?? 'unknown');
      const viewId = this.currentView?.id ?? pc.snapshot.viewId ?? undefined;
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
        viewIds: viewId ? [viewId] : undefined,
      });
      changes.push(`page-content entity: ${type}:${obs.entityId}`);
    }

    // Counters observed in content — skip paths already handled by
    // CounterSignalExtractor to prevent double-recording (D2/dup fix).
    for (const obs of pc.observedCounters) {
      if (obs.numericValue === null) continue;
      if (counterPaths?.has(obs.domPath)) continue; // already processed
      const counterViewId = this.currentView?.id ?? pc.snapshot.viewId ?? undefined;
      this.counterTracker.record(
        obs.domPath,
        String(obs.numericValue),
        iid,
        obs.attributes['aria-label'] ?? null,
        counterViewId,
      );
      changes.push(`page-content counter: ${obs.domPath} = ${obs.numericValue}`);
    }

    // Collections observed in content — skip paths already handled by
    // ListSignalExtractor to prevent corrupted counts (D2/dup fix).
    for (const obs of pc.observedCollections) {
      if (obs.numericValue === null) continue;
      if (collectionPaths?.has(obs.domPath)) continue; // already processed
      const collViewId = this.currentView?.id ?? pc.snapshot.viewId ?? undefined;
      this.collectionTracker.setCount(obs.domPath, obs.numericValue, iid, collViewId);
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

    // M9.9: Status badges → entity lifecycle state.
    for (const obs of pc.observedStatusBadges) {
      this.processStatusBadge(obs, iid, changes);
    }
  }

  // ── M9.9: Entity State Detection ──────────────────────────────────────

  /**
   * M9.9: Process a status badge observation into an entity state change.
   */
  private processStatusBadge(obs: ObservedItem, iid: string, changes: string[]): void {
    const state = normalizeStateText(obs.text, this.stateVocabularyRegistry ?? undefined);
    if (!state) return; // unrecognized state keyword — skip silently

    // Case 1: the badge carries an entity reference.
    if (obs.entityId) {
      const target = this.resolveEntityId(obs.entityId, obs.entityType);
      if (target) {
        const changed = this.stateTracker.observe(
          target,
          state,
          iid,
          `status-badge "${obs.text}" (${obs.domPath})`,
        );
        if (changed) changes.push(`state: ${target} → "${state}"`);
      }
      return;
    }

    // Case 2: no entity reference — associate with the single tracked entity.
    const entities = this.entityTracker.snapshot();
    if (entities.size === 0) return;
    if (entities.size === 1) {
      const [onlyId] = [...entities.keys()];
      const changed = this.stateTracker.observe(
        onlyId,
        state,
        iid,
        `status-badge "${obs.text}" (${obs.domPath}, sole entity)`,
      );
      if (changed) changes.push(`state: ${onlyId} → "${state}"`);
      return;
    }

    // Case 3: multiple entities — apply to all entities matching the badge's
    // entity type (if the badge names one). Otherwise apply to the most
    // recently-updated entity (D11: previously skipped silently, which lost
    // all state transitions in multi-entity apps).
    if (obs.entityType) {
      const matching = [...entities.entries()].filter(([, e]) => e.type === obs.entityType);
      if (matching.length >= 1) {
        for (const [id] of matching) {
          const changed = this.stateTracker.observe(
            id,
            state,
            iid,
            `status-badge "${obs.text}" (${obs.domPath}, type match)`,
          );
          if (changed) changes.push(`state: ${id} → "${state}"`);
        }
        return;
      }
    }

    // D11: No entityType match — fall back to most-recently-updated entity.
    // This mirrors the notification path's strategy and prevents badges
    // from being silently dropped in multi-entity applications.
    let latestId: string | null = null;
    let latestUpdated = '';
    for (const [id, e] of entities) {
      if (String(e.lastUpdated) > latestUpdated) {
        latestUpdated = String(e.lastUpdated);
        latestId = id;
      }
    }
    if (latestId) {
      const changed = this.stateTracker.observe(
        latestId,
        state,
        iid,
        `status-badge "${obs.text}" (${obs.domPath}, most-recent entity)`,
      );
      if (changed) changes.push(`state: ${latestId} → "${state}"`);
    }
  }

  /**
   * M9.9: Resolve a badge's entity reference to an actual tracked entity ID.
   */
  private resolveEntityId(entityId: string, entityType: string | null): string | null {
    // Direct hit on a tracked entity.
    if (this.entityTracker.get(entityId)) return entityId;

    // Try prefixed form ("leave-request:123" for observed entityId "123").
    if (entityType) {
      const prefixed = `${entityType}:${entityId}`;
      if (this.entityTracker.get(prefixed)) return prefixed;
    }

    // Try suffix match on tracked entities.
    for (const candidate of this.entityTracker.snapshot().keys()) {
      if (candidate.endsWith(`:${entityId}`)) return candidate;
    }
    return null;
  }

  /**
   * M9.9: Notification text may indicate a state transition.
   * E.g., "Leave request approved" → state "approved".
   *
   * Association: if only one entity exists, apply to it. Otherwise pick the
   * most-recently-updated entity (deterministic tie-break).
   */
  private detectStateFromNotification(text: string, iid: string): void {
    const state = extractStateFromNotification(text, this.stateVocabularyRegistry ?? undefined);
    if (!state) return;

    const entities = this.entityTracker.snapshot();
    if (entities.size === 0) return;

    if (entities.size === 1) {
      const [onlyId] = [...entities.keys()];
      this.stateTracker.observe(
        onlyId,
        state,
        iid,
        `notification "${text.substring(0, 60)}"`,
      );
      return;
    }

    // Multiple entities: pick the most recently updated.
    let latestId: string | null = null;
    let latestUpdated = '';
    for (const [id, e] of entities) {
      if (String(e.lastUpdated) > latestUpdated) {
        latestUpdated = String(e.lastUpdated);
        latestId = id;
      }
    }
    if (latestId) {
      this.stateTracker.observe(
        latestId,
        state,
        iid,
        `notification "${text.substring(0, 60)}" (most-recent entity)`,
      );
    }
  }

  /**
   * Get the current application state snapshot.
   */
  getCurrentState(): ApplicationState {
    // M9.9: apply tracked state to entity snapshot before returning.
    const entities = this.entityTracker.snapshot();
    this.stateTracker.applyToEntities(entities);

    return {
      currentView: this.currentView ? { ...this.currentView } : null,
      currentUrl: this.currentUrl,
      entities,
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
    this.stateTracker.clear();
    this.interactionCount = 0;
    this.lastInteractionId = null;
  }

  /**
   * D3: Load a prior-knowledge seed (from M9.6 KnowledgePreloader).
   *
   * Pre-populates entity, view, and counter trackers with cross-session
   * knowledge so the builder recognizes previously-seen entities from
   * the first interaction of the new session.
   */
  loadSeed(seed: StateBuilderSeed): void {
    for (const [, entity] of seed.entities) {
      this.entityTracker.upsert({
        id: entity.id,
        type: entity.type,
        attributes: entity.attributes,
        source: 'inferred', // prior-session knowledge
        firstSeenAt: 'prior-session',
        lastUpdated: 'prior-session',
        viewIds: entity.viewIds,
      });
    }
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
