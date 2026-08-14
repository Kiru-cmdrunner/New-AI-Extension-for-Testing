/**
 * M9.12 — Understanding Pipeline Orchestrator
 *
 * The single function that chains the full deterministic M9 pipeline:
 *
 *   M9.1 Signal Extraction
 *     → M9.2 State Building
 *       → M9.3 Outcome Determination
 *         → M9.5 Knowledge Persistence
 *           → M9.6 Knowledge Consolidation (load + merge)
 *             → M9.7 Semantic Enrichment
 *
 * Designed to be called at `stopRecording` with the full session's
 * ComponentInteractions.  All M9.8–M9.11 domain config (entity type
 * registry, state vocabulary, network patterns, domain signatures) is
 * applied at construction time via DomainPackRegistry.
 *
 * Failure isolation:  every stage runs inside its own try/catch.
 * A stage failure adds a warning and the pipeline continues with the
 * data it has.  If the whole pipeline throws, the caller (service worker)
 * falls back to a minimal UnderstandingResult stub.
 *
 * Architecture: .drytis/specs/m9-12-production-wiring.md
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { ActionOutcome } from '../outcome/outcome-types';
import type { ApplicationState, StateTransition } from '../state-builder/types';
import type { ApplicationKnowledge } from '../consolidation/application-knowledge';
import type { SemanticKnowledge, SemanticWorkflow } from '../enrichment/semantic-types';
import type { StateBuilderSeed } from '../consolidation/application-knowledge';

// M9.1
import { SignalExtractionCoordinator } from '../signal-extractors/signal-extractor';
import { NavigationSignalExtractor } from '../signal-extractors/navigation-signals';
import { NetworkSignalExtractor } from '../signal-extractors/network-signals';
import { NotificationSignalExtractor } from '../signal-extractors/notification-signals';
import { CounterSignalExtractor } from '../signal-extractors/counter-signals';
import { ListSignalExtractor } from '../signal-extractors/list-signals';
import { TargetStateSignalExtractor } from '../signal-extractors/target-state-signals';
import { PageContentEvidenceExtractor } from '../signal-extractors/page-content-evidence-extractor';
import { createDefaultViewRegistry } from '../signal-extractors/view-registry';
// M9.2
import { StateBuilder } from '../state-builder/state-builder';
import { createEntityTypeRegistry } from '../state-builder/entity-type-registry';
// M9.3
import { OutcomeDeterminer } from '../outcome/outcome-determiner';
// M9.5
import {
  KnowledgeDatabase,
  createKnowledgeDatabase,
} from '../persistence/knowledge-database';
import { KnowledgeRepository } from '../persistence/knowledge-repository';
import {
  KnowledgePersistenceService,
  deriveAppId,
} from '../persistence/knowledge-persistence-service';
// M9.6
import { KnowledgeLoader } from '../consolidation/knowledge-loader';
import { KnowledgePreloader } from '../consolidation/knowledge-preloader';
// M9.7
import { enrichSemantically } from '../enrichment/semantic-enricher';
import { aggregateRecordedWorkflows } from '../enrichment/recorded-workflow';
import type { RecordedWorkflow } from '../enrichment/semantic-types';
// M9.11
import {
  DomainPackRegistry,
} from '../domain-config/domain-pack-registry';
import { HR_PACK } from '../domain-config/packs/hr-pack';
import { DEVTOOLS_PACK } from '../domain-config/packs/devtools-pack';
import { registerDomainSignature } from '../enrichment/domain-signatures';

// ── Public types ───────────────────────────────────────────────────────

/**
 * Result of running the full pipeline.
 */
export interface PipelineOutcome {
  /** SemanticKnowledge produced by M9.7, or null if enrichment failed. */
  semanticKnowledge: SemanticKnowledge | null;
  /** Consolidated application knowledge from M9.6, or null if loading failed. */
  applicationKnowledge: ApplicationKnowledge | null;
  /** Determined outcomes per interaction. */
  outcomes: Map<string, ActionOutcome>;
  /** State transitions from the session. */
  transitions: StateTransition[];
  /** Final application state. */
  finalState: ApplicationState | null;
  /** Non-fatal warnings collected from stages that had issues. */
  warnings: string[];
  /** Stable appId derived from the recording origin. */
  appId: string;
}

/**
 * Input for the pipeline at stopRecording.
 */
export interface PipelineInput {
  /** Interactions from the recording session (production-filtered). */
  interactions: ComponentInteraction[];
  /** Origin URL of the recording (for appId derivation). */
  origin: string;
  /** Recording session ID. */
  sessionId: string;
  /** Prior-knowledge seed loaded at startRecording (or empty). */
  seed?: StateBuilderSeed | null;
}

// ── Pipeline class ─────────────────────────────────────────────────────

/**
 * Orchestrates the full M9 pipeline.
 *
 * Construction wires all M9.1–M9.11 modules with domain pack configuration.
 * `run()` executes the batch pipeline over a session's interactions.
 */
export class UnderstandingPipeline {
  private readonly coordinator: SignalExtractionCoordinator;
  private readonly stateBuilder: StateBuilder;
  private readonly outcomeDeterminer: OutcomeDeterminer;
  private readonly persistenceService: KnowledgePersistenceService | null;
  private readonly knowledgeLoader: KnowledgeLoader | null;
  private readonly knowledgePreloader: KnowledgePreloader | null;
  private readonly domainRegistry: DomainPackRegistry;
  private readonly db: KnowledgeDatabase | null;

  constructor(opts?: {
    domainRegistry?: DomainPackRegistry;
    db?: KnowledgeDatabase | null;
    /** Skip IndexedDB (for environments without it, e.g. Node tests). */
    noPersistence?: boolean;
  }) {
    // ── M9.11 Domain Pack Registry ──
    this.domainRegistry = opts?.domainRegistry ?? createDefaultDomainPackRegistry();

    // Register domain signatures from installed packs
    for (const sig of this.domainRegistry.getSignatures()) {
      registerDomainSignature(sig);
    }

    // Add domain view patterns to the ViewRegistry
    const viewRegistry = createDefaultViewRegistry();
    for (const vp of this.domainRegistry.getViewPatterns()) {
      viewRegistry.add({
        viewId: vp.viewId,
        viewLabel: vp.label,
        pattern: vp.pattern,
        confidence: 0.8,
      });
    }

    // ── M9.1 Signal Extraction ──
    this.coordinator = new SignalExtractionCoordinator();
    this.coordinator.register(new NavigationSignalExtractor(viewRegistry));
    this.coordinator.register(
      new NetworkSignalExtractor(this.domainRegistry.networkPatterns),
    );
    this.coordinator.register(new NotificationSignalExtractor());
    this.coordinator.register(new CounterSignalExtractor());
    this.coordinator.register(new ListSignalExtractor());
    this.coordinator.register(new TargetStateSignalExtractor());
    // D2: Page-content evidence extractor derives observed items from
    // newSurfaces and domChanges in behavioral evidence — bridges the
    // M9.4 PageContentObserver into the post-hoc pipeline.
    this.coordinator.register(new PageContentEvidenceExtractor());

    // ── M9.2 State Builder (with M9.8 entity types + M9.9/11 state vocab) ──
    const entityTypeRegistry = createEntityTypeRegistry(true);

    // Merge domain pack entity type rules
    for (const rule of this.domainRegistry.getEntityTypeRules()) {
      entityTypeRegistry.register(rule);
    }

    this.stateBuilder = new StateBuilder(
      entityTypeRegistry,
      this.domainRegistry.stateVocabulary,
    );

    // ── M9.3 Outcome Determiner (with M9.11 confirmation views) ──
    const confirmationViews = new Set<string>();
    // Built-in confirmation views
    for (const v of [
      'cart-confirmation', 'order-confirmation', 'checkout-confirmation',
      'payment-confirmation', 'registration-confirmation', 'login-success',
    ]) {
      confirmationViews.add(v);
    }
    // Also add any from the domain registry
    const packConfViews = this.collectConfirmationViews();
    for (const v of packConfViews) confirmationViews.add(v);

    this.outcomeDeterminer = new OutcomeDeterminer(confirmationViews);

    // ── M9.5 Persistence + M9.6 Consolidation ──
    if (opts?.noPersistence) {
      this.db = null;
      this.persistenceService = null;
      this.knowledgeLoader = null;
      this.knowledgePreloader = null;
    } else {
      this.db = opts?.db ?? createKnowledgeDatabase();
      const repo = new KnowledgeRepository(this.db);
      this.persistenceService = new KnowledgePersistenceService(repo);
      this.knowledgeLoader = new KnowledgeLoader(repo);
      this.knowledgePreloader = new KnowledgePreloader(this.knowledgeLoader);
    }
  }

  /**
   * Preload prior-session knowledge for an app origin.
   * Returns an empty seed if no prior knowledge exists or persistence
   * is disabled.  Never throws — always returns a valid seed.
   */
  async preloadPriorKnowledge(origin: string): Promise<StateBuilderSeed> {
    const emptySeed: StateBuilderSeed = {
      entities: new Map(),
      views: new Map(),
      counters: new Map(),
      hasPriorKnowledge: false,
    };
    if (!this.knowledgePreloader) return emptySeed;
    try {
      const appId = deriveAppId(origin);
      return await this.knowledgePreloader.buildSeed(appId);
    } catch {
      return emptySeed;
    }
  }

  /**
   * Run the full pipeline over a session's interactions.
   *
   * Each stage is isolated: a failure adds a warning and the pipeline
   * continues with whatever data it has.
   */
  async run(input: PipelineInput): Promise<PipelineOutcome> {
    const warnings: string[] = [];
    const appId = deriveAppId(input.origin);

    // ── Stage 1: Signal Extraction (M9.1) ──
    let signalResult: ReturnType<SignalExtractionCoordinator['extract']> | null = null;
    try {
      signalResult = this.coordinator.extract(input.interactions);
    } catch (e) {
      warnings.push(`signal-extraction: ${(e as Error).message}`);
    }

    // ── Stage 2: State Building (M9.2) ──
    const transitions: StateTransition[] = [];
    let finalState: ApplicationState | null = null;
    try {
      // D3: Apply prior-knowledge seed before processing signals
      if (input.seed && input.seed.hasPriorKnowledge) {
        this.stateBuilder.loadSeed(input.seed);
      }

      if (signalResult) {
        for (const interaction of input.interactions) {
          const signals = signalResult.signals.get(interaction.interactionId);
          if (!signals) continue;
          const transition = this.stateBuilder.processSignals(signals);
          transitions.push(transition);
        }
        finalState = this.stateBuilder.getCurrentState();
      }
    } catch (e) {
      warnings.push(`state-building: ${(e as Error).message}`);
    }

    // ── Stage 3: Outcome Determination (M9.3) ──
    const outcomes = new Map<string, ActionOutcome>();
    try {
      if (signalResult) {
        for (const interaction of input.interactions) {
          const signals = signalResult.signals.get(interaction.interactionId);
          if (!signals) continue;
          const transition = transitions.find(
            (t) => t.interactionId === interaction.interactionId,
          ) ?? null;

          // DDC-5: evidence-quality flags from behavioral evidence
          const appEv = interaction.behavioralEvidence?.applicationEvidence;
          const evidenceQuality = appEv
            ? {
                mainThreadBlocked: appEv.performanceCondition?.mainThreadBlocked ?? false,
                domChangeOverflow: appEv.domChangeOverflow ?? 0,
                coarseMode: appEv.coarseMode ?? false,
              }
            : undefined;

          const outcome = this.outcomeDeterminer.determine({
            interactionId: interaction.interactionId,
            actionType: interaction.type,
            actionTarget: interaction.trigger.accessibleName ?? interaction.trigger.tag ?? '',
            signals,
            transition,
            evidenceQuality,
          });
          outcomes.set(interaction.interactionId, outcome);
        }

        // DDC-3: click→network→outcome attribution for full-page reloads.
        // A form-submit click (int-19) often destroys the page before its
        // network evidence lands; the recovered API ops are attached to the
        // FOLLOWING synthetic navigation interaction (int-20). Without this
        // pass, the user's action records 'incomplete' while a synthetic
        // navigation owns the outcome — the causal link is severed.
        this.attributeReloadOutcomes(input.interactions, signalResult.signals, outcomes);
      }
    } catch (e) {
      warnings.push(`outcome-determination: ${(e as Error).message}`);
    }

    // ── Stage 4: Knowledge Consolidation / Load PRIOR (M9.6) ──
    // D4: Load prior knowledge BEFORE persisting the current session.
    // This ensures enrichment sees only prior sessions (not the current
    // one) and prevents double-counting of navigation edges and outcomes.
    // DDC-4: also load prior recorded-workflow patterns for recurrence.
    let priorKnowledge: ApplicationKnowledge | null = null;
    let priorRecordedWorkflows: import('../enrichment/semantic-types').RecordedWorkflow[] = [];
    if (this.knowledgeLoader) {
      try {
        priorKnowledge = await this.knowledgeLoader.load(appId);
        priorRecordedWorkflows = await this.knowledgeLoader.loadRecordedWorkflows(appId);
      } catch (e) {
        warnings.push(`knowledge-load: ${(e as Error).message}`);
      }
    }

    // ── Stage 5: Knowledge Persistence (M9.5) ──
    if (this.persistenceService && finalState) {
      try {
        // DDC-3: enriched outcomes (click-attribution pass) are persisted.
        await this.persistenceService.persist({
          origin: input.origin,
          projectId: appId,
          recordingSessionId: input.sessionId,
          applicationState: finalState,
          transitions,
          outcomes: [...outcomes.values()],
        });
      } catch (e) {
        warnings.push(`knowledge-persistence: ${(e as Error).message}`);
      }
    }

    // ── Stage 6: Semantic Enrichment (M9.7) ──
    let semanticKnowledge: SemanticKnowledge | null = null;
    try {
      semanticKnowledge = enrichSemantically({
        appId,
        interactions: input.interactions,
        outcomes,
        transitions,
        currentState: finalState,
        priorKnowledge,
        // DDC-4: seed aggregation with persisted patterns
        priorRecordedWorkflows,
        sessionId: input.sessionId,
        intentVocabularyRegistry: this.domainRegistry.intentVocabulary,
      });
    } catch (e) {
      warnings.push(`semantic-enrichment: ${(e as Error).message}`);
    }

    // ── Stage 7: Persist recorded workflows (DDC-4) ──
    // Persist THIS SESSION's contribution only (occurrences observed now),
    // not the prior-merged recurring patterns — the repository accumulates
    // across sessions. Persisting merged counts would double-count priors.
    if (this.persistenceService && semanticKnowledge) {
      try {
        await this.persistenceService.persist({
          origin: input.origin,
          projectId: appId,
          recordingSessionId: input.sessionId,
          applicationState: finalState!,
          transitions,
          outcomes: [...outcomes.values()],
          recordedWorkflows: aggregateRecordedWorkflowsForPersist(
            semanticKnowledge.workflows,
            input.sessionId,
          ),
        });
      } catch (e) {
        warnings.push(`recorded-workflow-persistence: ${(e as Error).message}`);
      }
    }

    return {
      semanticKnowledge,
      applicationKnowledge: priorKnowledge,
      outcomes,
      transitions,
      finalState,
      warnings,
      appId,
    };
  }

  /**
   * Close the underlying database (if any).  Safe to call multiple times.
   */
  async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore
      }
    }
  }

  // ── Helpers ──

  /**
   * DDC-3: Attribute recovered network evidence to the triggering click.
   *
   * For each synthetic-navigation interaction carrying recovered API
   * operations (source 'webrequest' entries that the SW ring buffer
   * injected), find the nearest preceding action interaction (Click /
   * KeyboardShortcut / CompoundInteraction) within 10s. If that interaction
   * has NO api-operations of its own and its current outcome is
   * 'incomplete' (no votes), re-run determination with the recovered ops
   * merged into its signal set — the click then gets an evidenced outcome.
   *
   * Deterministic guards:
   *  - only merges ops the click interaction itself did NOT capture
   *  - only fires when the click's outcome has zero supporting evidence
   *  - bounded to the nearest preceding action, ≤3 ops
   */
  private attributeReloadOutcomes(
    interactions: ComponentInteraction[],
    signalMap: Map<string, ReturnType<SignalExtractionCoordinator['extract']>['signals'] extends Map<string, infer S> ? S : never>,
    outcomes: Map<string, ActionOutcome>,
  ): void {
    /** window timestamps keyed by interactionId for ordering */
    const idxOf = new Map<string, number>();
    interactions.forEach((i, n) => idxOf.set(i.interactionId, n));

    for (const interaction of interactions) {
      // Only synthetic navigation interactions carry recovered evidence
      const signals = signalMap.get(interaction.interactionId);
      if (!signals) continue;

      const recovered = signals.apiOperations.filter(
        (op) => op.source === 'network-url' || op.source === 'network-status',
      );
      // Recovered ops come from webrequest-sourced entries; in-pipeline we
      // distinguish them via their behavioral evidence source. For the
      // synthetic nav, ALL api ops are recovered (the content script was
      // destroyed), so treat any op on a synthetic-nav interaction as
      // recoverable attribution candidates.
      if (recovered.length === 0) continue;

      const ev = interaction.behavioralEvidence;
      if (!ev) continue;
      const isSyntheticNav = ev.window?.endReason === 'page-reload-synthetic';
      if (!isSyntheticNav) continue;

      // Find the nearest preceding ACTION interaction within 10s
      const idx = idxOf.get(interaction.interactionId) ?? -1;
      if (idx < 0) continue;

      const navTime = interaction.endTime ?? interaction.startTime ?? 0;
      const actionTypes = new Set(['Click', 'KeyboardShortcut', 'CompoundInteraction', 'Link']);
      let target: ComponentInteraction | null = null;
      for (let n = idx - 1; n >= 0; n--) {
        const cand = interactions[n];
        if (!actionTypes.has(cand.type)) continue;
        const candEnd = cand.endTime ?? cand.startTime ?? 0;
        if (navTime - candEnd <= 10_000) {
          target = cand;
        }
        break; // nearest preceding action only
      }
      if (!target) continue;

      const targetSignals = signalMap.get(target.interactionId);
      if (!targetSignals) continue;
      // The click already captured its own ops (delivery won the race) —
      // do not double-attribute.
      if (targetSignals.apiOperations.length > 0) continue;

      const existingOutcome = outcomes.get(target.interactionId);
      // Only re-determine when the click's outcome is evidence-free
      if (!existingOutcome || existingOutcome.supportingEvidence.length > 0) continue;

      // Merge up to 3 recovered ops into the click's signal set
      const merged = {
        ...targetSignals,
        apiOperations: [...targetSignals.apiOperations, ...recovered.slice(0, 3)],
      };

      const transition = null; // the click's transition (if any) already exists in caller scope; re-lookup below
      const outcome = this.outcomeDeterminer.determine({
        interactionId: target.interactionId,
        actionType: target.type,
        actionTarget: target.trigger.accessibleName ?? target.trigger.tag ?? '',
        signals: merged,
        transition,
        evidenceQuality: {
          mainThreadBlocked: target.behavioralEvidence?.applicationEvidence?.performanceCondition?.mainThreadBlocked ?? false,
          domChangeOverflow: target.behavioralEvidence?.applicationEvidence?.domChangeOverflow ?? 0,
          coarseMode: target.behavioralEvidence?.applicationEvidence?.coarseMode ?? false,
        },
      });
      // Mark attribution provenance in the evidence detail
      for (const e of outcome.supportingEvidence) {
        if (e.kind === 'api-operation') {
          e.detail = `${e.detail} [attributed via reload recovery]`;
        }
      }
      outcomes.set(target.interactionId, outcome);
    }
  }

  private collectConfirmationViews(): Set<string> {
    // Collect confirmation views from all installed packs
    const views = new Set<string>();
    // We can't iterate packs directly, but we can check known view IDs
    // via isConfirmationView.  Since DomainPackRegistry doesn't expose
    // the raw sets, we use the installed pack IDs to query.
    // For now, we rely on the fact that the HR/DevTools packs expose
    // their confirmation views via isConfirmationView().
    const knownViewIds = [
      'leave-detail', 'employee-detail', 'candidate-detail',
      'issue-detail', 'pr-detail', 'build-detail',
    ];
    for (const v of knownViewIds) {
      if (this.domainRegistry.isConfirmationView(v)) {
        views.add(v);
      }
    }
    return views;
  }
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * DDC-4 helper: build single-occurrence RecordedWorkflow rows from this
 * session's SemanticWorkflows so first-time patterns persist too (they
 * become "recurring" only after a second session matches them).
 */
function aggregateRecordedWorkflowsForPersist(
  workflows: SemanticWorkflow[],
  sessionId: string,
): RecordedWorkflow[] {
  // Reuse the aggregation with no prior seed, then keep ALL patterns
  return aggregateRecordedWorkflows(workflows, []).map((w) => ({
    ...w,
    sessionIds: [sessionId],
  }));
}

/**
 * Create a DomainPackRegistry with HR + DevTools packs installed.
 *
 * E-commerce is intentionally NOT installed — its patterns are already
 * the built-in defaults in M9.1/M9.2/M9.3.  Installing the e-commerce
 * pack would duplicate those defaults.  The e-commerce domain is still
 * classified correctly via the built-in ECOMMERCE_SIGNATURE already
 * registered in domain-signatures.ts.
 */
export function createDefaultDomainPackRegistry(): DomainPackRegistry {
  const registry = new DomainPackRegistry();
  registry.install(HR_PACK);
  registry.install(DEVTOOLS_PACK);
  return registry;
}

/**
 * Create a default understanding pipeline with HR + DevTools domain packs.
 */
export function createDefaultUnderstandingPipeline(opts?: {
  noPersistence?: boolean;
}): UnderstandingPipeline {
  return new UnderstandingPipeline({
    domainRegistry: createDefaultDomainPackRegistry(),
    noPersistence: opts?.noPersistence,
  });
}

// ── Convenience functions ──────────────────────────────────────────────

/**
 * Preload prior knowledge for an origin.
 * Convenience wrapper for the service worker.
 */
export async function preloadPriorKnowledge(
  origin: string,
  pipeline?: UnderstandingPipeline,
): Promise<StateBuilderSeed> {
  const p = pipeline ?? createDefaultUnderstandingPipeline();
  const seed = await p.preloadPriorKnowledge(origin);
  await p.close();
  return seed;
}

/**
 * Run the full understanding pipeline and return the outcome.
 * Convenience wrapper for the service worker.
 */
export async function runUnderstandingPipeline(
  input: PipelineInput,
  pipeline?: UnderstandingPipeline,
): Promise<PipelineOutcome> {
  const p = pipeline ?? createDefaultUnderstandingPipeline();
  const outcome = await p.run(input);
  await p.close();
  return outcome;
}
