/**
 * M9.7 — Application Surface Enrichment
 *
 * Builds the ApplicationSurface model from M9.6 ApplicationKnowledge
 * (cross-session) or M9.2 ApplicationState (current session), enriched
 * with M9.7 component models, interaction contracts, and intent labels.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type { ApplicationKnowledge } from '../consolidation/application-knowledge';
import type { ComponentInteraction } from '../../shared/component-types';
import type { ApplicationState, StateTransition } from '../state-builder/types';
import type {
  ApplicationSurface,
  NavigationEdge,
  SurfaceView,
  ComponentModel,
  InteractionContract,
  IntentLabel,
} from './semantic-types';

/**
 * Build the application surface from current-session data.
 * Uses M9.2 ApplicationState (in-memory) and M9.7 component/intent/contract models.
 */
export function buildApplicationSurface(
  state: ApplicationState | null,
  interactions: ComponentInteraction[],
  components: ComponentModel[],
  contracts: InteractionContract[],
  intents: Map<string, IntentLabel>,
  transitions: StateTransition[],
): ApplicationSurface {
  const views = new Map<string, SurfaceView>();
  const navigationEdges: NavigationEdge[] = [];

  // ── From persisted knowledge: view labels and metadata ─────────────
  // Not used here — buildApplicationSurfaceFromKnowledge handles that.
  // Here we build from current session state.

  // ── Collect view IDs from transitions ──────────────────────────────
  for (const transition of transitions) {
    const before = transition.before.currentView?.id;
    const after = transition.after.currentView?.id;

    if (before) {
      if (!views.has(before)) {
        views.set(before, createSurfaceView(before, transition.before.currentView?.label ?? before));
      }
    }

    if (after) {
      if (!views.has(after)) {
        views.set(after, createSurfaceView(after, transition.after.currentView?.label ?? after));
      }
    }

    if (before && after && before !== after) {
      addNavigationEdge(navigationEdges, before, after);
    }
  }

  // Also include the current view from state
  if (state?.currentView) {
    const viewId = state.currentView.id;
    if (!views.has(viewId)) {
      views.set(viewId, createSurfaceView(viewId, state.currentView.label));
    }
  }

  // ── Assign interactions to views ──────────────────────────────────
  for (const interaction of interactions) {
    const transition = transitions.find(
      (t) => t.interactionId === interaction.interactionId,
    );
    const viewId = transition?.after.currentView?.id ?? state?.currentView?.id;

    if (viewId) {
      const view = views.get(viewId);
      if (view) {
        const intent = intents.get(interaction.interactionId);
        if (intent) {
          view.capabilities.push(intent.intent);
        }
      }
    }
  }

  // ── Assign components and contracts to views ──────────────────────
  const componentsByView = groupBy(components, (c) => c.viewId);
  const contractsByInteraction = new Map(contracts.map((c) => [c.interactionId, c]));
  for (const [viewId, viewComponents] of componentsByView) {
    const view = views.get(viewId);
    if (view) {
      view.components.push(...viewComponents);
    }
  }

  // Assign contracts to views via interaction→view mapping
  for (const interaction of interactions) {
    const transition = transitions.find(
      (t) => t.interactionId === interaction.interactionId,
    );
    const viewId = transition?.after.currentView?.id ?? state?.currentView?.id;
    if (viewId) {
      const view = views.get(viewId);
      const contract = contractsByInteraction.get(interaction.interactionId);
      if (view && contract) {
        view.inputs.push(contract);
      }
    }
  }

  // ── Assign entity types, collections, counters from state ──────────
  // D5: scope to views where actually observed via viewIds, instead of
  // broadcasting every entity to every view. Fallback to broadcast ONLY
  // when an entity has no viewIds (e.g., legacy data without view context).
  if (state) {
    for (const entity of state.entities.values()) {
      const targetViews = entity.viewIds && entity.viewIds.length > 0
        ? entity.viewIds
        : [...views.keys()];
      for (const viewId of targetViews) {
        const view = views.get(viewId);
        if (view && !view.entityTypeRefs.includes(entity.type)) {
          view.entityTypeRefs.push(entity.type);
        }
      }
    }
    for (const collection of state.collections.values()) {
      const targetViews = collection.viewIds && collection.viewIds.length > 0
        ? collection.viewIds
        : [...views.keys()];
      for (const viewId of targetViews) {
        const view = views.get(viewId);
        if (view && !view.collectionRefs.includes(collection.id)) {
          view.collectionRefs.push(collection.id);
        }
      }
    }
    for (const counter of state.counters.values()) {
      const targetViews = counter.viewIds && counter.viewIds.length > 0
        ? counter.viewIds
        : [...views.keys()];
      for (const viewId of targetViews) {
        const view = views.get(viewId);
        if (view && !view.counterRefs.includes(counter.id)) {
          view.counterRefs.push(counter.id);
        }
      }
    }
  }

  // ── Deduplicate capabilities ──────────────────────────────────────
  for (const view of views.values()) {
    view.capabilities = [...new Set(view.capabilities)];
  }

  return {
    views: [...views.values()],
    navigationEdges,
  };
}

/**
 * Enrich surface views with cross-session knowledge from M9.6.
 * Updates visitCount and adds labels from persisted knowledge.
 */
export function enrichSurfaceWithKnowledge(
  surface: ApplicationSurface,
  knowledge: ApplicationKnowledge,
): ApplicationSurface {
  const knowledgeViews = new Map(
    knowledge.views.map((v) => [v.viewId, v]),
  );

  const enrichedViews = surface.views.map((view) => {
    const known = knowledgeViews.get(view.viewId);
    if (known) {
      return {
        ...view,
        label: known.label || view.label,
        businessPurpose: inferBusinessPurpose(view.viewId),
        visitCount: known.visitCount,
      };
    }
    return {
      ...view,
      businessPurpose: inferBusinessPurpose(view.viewId),
      visitCount: view.visitCount,
    };
  });

  return {
    views: enrichedViews,
    navigationEdges: mergeNavigationEdges(surface.navigationEdges, knowledge.viewGraph.edges),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function createSurfaceView(viewId: string, label: string): SurfaceView {
  return {
    viewId,
    label,
    businessPurpose: '',
    capabilities: [],
    components: [],
    inputs: [],
    entityTypeRefs: [],
    collectionRefs: [],
    counterRefs: [],
    visitCount: 1,
  };
}

function inferBusinessPurpose(viewId: string): string {
  const purposeMap: Record<string, string> = {
    'product-detail': 'Display product information for purchase decision',
    'search-results': 'Present search results for browsing',
    'cart': 'Review selected items before checkout',
    'cart-confirmation': 'Confirm item was added to cart',
    'checkout': 'Complete purchase transaction',
    'login': 'Authenticate user identity',
    'register': 'Create a new user account',
    'home': 'Application landing page',
    'orders': 'View past order history',
    'wishlist': 'View saved items',
  };
  return purposeMap[viewId] ?? '';
}

function addNavigationEdge(
  edges: NavigationEdge[],
  from: string,
  to: string,
): void {
  const existing = edges.find((e) => e.fromViewId === from && e.toViewId === to);
  if (existing) {
    existing.count++;
  } else {
    edges.push({ fromViewId: from, toViewId: to, count: 1 });
  }
}

function mergeNavigationEdges(
  current: NavigationEdge[],
  knowledgeEdges: { fromViewId: string; toViewId: string; count: number }[],
): NavigationEdge[] {
  const merged = [...current];
  for (const edge of knowledgeEdges) {
    addNavigationEdge(merged, edge.fromViewId, edge.toViewId);
  }
  return merged;
}

function groupBy<T>(
  items: T[],
  keyFn: (item: T) => string | null,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (key === null) continue;
    const arr = map.get(key);
    if (arr) {
      arr.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
