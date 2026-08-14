/**
 * M9 - Application Understanding: Public API
 *
 * Barrel exports for the understanding layer.
 */

// Types (M9.1)
export type {
  Signal,
  SignalSource,
  ViewDescriptor,
  ViewPattern,
  ViewChangeSignal,
  ApiOperationType,
  ApiOperationSignal,
  OutcomeHint,
  NotificationSignal,
  CounterChangeSignal,
  ListChangeSignal,
  InputValueChangeSignal,
  SignalSet,
  SignalExtractionResult,
  SignalExtractor,
} from './types';

// Signal extraction pipeline (M9.1 + M9.2)
export { SignalExtractionCoordinator } from './signal-extractors/signal-extractor';
export { NavigationSignalExtractor } from './signal-extractors/navigation-signals';
export { NetworkSignalExtractor } from './signal-extractors/network-signals';
export {
  ViewRegistry,
  DEFAULT_VIEW_PATTERNS,
  createDefaultViewRegistry,
} from './signal-extractors/view-registry';
export { NotificationSignalExtractor } from './signal-extractors/notification-signals';
export { CounterSignalExtractor, parseCounterValue } from './signal-extractors/counter-signals';
export { ListSignalExtractor } from './signal-extractors/list-signals';
export { TargetStateSignalExtractor } from './signal-extractors/target-state-signals';

// State builder (M9.2)
export { StateBuilder } from './state-builder/state-builder';
export { EntityTracker } from './state-builder/entity-tracker';
export { CollectionTracker } from './state-builder/collection-tracker';
export { CounterTracker } from './state-builder/counter-tracker';
export { NotificationTracker } from './state-builder/notification-tracker';

// Entity type registry (M9.8)
export {
  EntityTypeRegistry,
  createEntityTypeRegistry,
} from './state-builder/entity-type-registry';
export type { EntityTypeDetectionRule } from './state-builder/entity-type-registry';

// Entity state tracker (M9.9)
export { EntityStateTracker, normalizeStateText, extractStateFromNotification } from './state-builder/entity-state-tracker';

export type {
  Entity,
  EntityType,
  EntitySource,
  EntityStateChange,
  Collection,
  CounterRecord,
  CounterValue,
  NotificationRecord,
  ApplicationState,
  StateTransition,
} from './state-builder/types';

// Outcome determination (M9.3)
export { OutcomeDeterminer } from './outcome/outcome-determiner';
export { RelationshipTracker } from './outcome/relationship-tracker';
export type {
  OutcomeCategory,
  ConfidenceLevel,
  OutcomeEvidence,
  ActionOutcome,
  OutcomeDeterminerInput,
} from './outcome/outcome-types';
export { confidenceToLevel, CONFIRMATION_VIEWS } from './outcome/outcome-types';

// Page content observer (M9.4)
export { PageContentObserver } from './page-content/page-content-observer';
export type {
  DOMAdapter,
  ElementLike,
  ScanResult,
} from './page-content/page-content-observer';
export {
  extractFromSnapshot,
  mergePageContentSignal,
} from './page-content/page-content-signals';
export type {
  PageContentSnapshot,
  ObservedItem,
  SemanticItemKind,
  PageContentSignal,
  SemanticSelector,
  PageContentConfig,
} from './page-content/page-content-types';
export {
  DEFAULT_SEMANTIC_SELECTORS,
  createDefaultPageContentConfig,
  registerDomainSelectors,
} from './page-content/page-content-config';

// Knowledge persistence (M9.5)
export { KnowledgeDatabase, createKnowledgeDatabase } from './persistence/knowledge-database';
export { KnowledgeRepository } from './persistence/knowledge-repository';
export { KnowledgePersistenceService, deriveAppId } from './persistence/knowledge-persistence-service';
export type { KnowledgePersistenceInput } from './persistence/knowledge-persistence-service';
export type {
  ApplicationRow,
  KnowledgeEntityRow,
  KnowledgeEntityStateChange,
  KnowledgeViewRow,
  KnowledgeViewTransitionRow,
  KnowledgeCollectionRow,
  KnowledgeCounterRow,
  KnowledgeCounterEntry,
  KnowledgeNotificationRow,
  KnowledgeOutcomeRow,
  KnowledgeEvidenceEntry,
  KnowledgeStateTransitionRow,
} from './persistence/knowledge-types';
export {
  MAX_COUNTER_HISTORY,
  MAX_NOTIFICATIONS_PER_APP,
  MAX_TRANSITIONS_PER_SESSION,
} from './persistence/knowledge-types';

// Knowledge consolidation & consistency (M9.6)
export { KnowledgeLoader, scoreConfidence, DEFAULT_CONFIDENCE_CONFIG } from './consolidation/knowledge-loader';
export type { ConfidenceConfig } from './consolidation/knowledge-loader';
export { ConflictDetector, DEFAULT_CONFLICT_CONFIG } from './consolidation/conflict-detector';
export type { ConflictDetectionConfig } from './consolidation/conflict-detector';
export { JourneyReconstructor, DEFAULT_JOURNEY_CONFIG } from './consolidation/journey-reconstructor';
export type { JourneyConfig } from './consolidation/journey-reconstructor';
export { KnowledgePreloader } from './consolidation/knowledge-preloader';
export { ConsistencyChecker } from './consolidation/consistency-checker';
export type {
  ApplicationKnowledge,
  ConsolidatedEntity,
  EntityStateChangeSummary,
  ConsolidatedView,
  ConsolidatedCollection,
  ConsolidatedCounter,
  ViewGraph,
  ViewGraphEdge,
  OutcomePattern,
  KnowledgeConfidence,
  KnowledgeConfidenceLevel,
  ConflictReport,
  KnowledgeFinding,
  DuplicateEntityFinding,
  StaleKnowledgeFinding,
  EvolvingEntityFinding,
  OrphanedTransitionFinding,
  FindingSeverity,
  JourneyTimeline,
  JourneyStep,
  JourneyGap,
  StateBuilderSeed,
  PriorSessionEntity,
  PriorSessionView,
  PriorSessionCounter,
  ConsistencyGap,
} from './consolidation/application-knowledge';

// Semantic enrichment (M9.7)
export { enrichSemantically } from './enrichment/semantic-enricher';
export type { SemanticEnricherInput } from './enrichment/semantic-enricher';
export { classifyDomain } from './enrichment/domain-classifier';
export { recognizeComponent } from './enrichment/component-recognizer';
export { extractInteractionContract } from './enrichment/interaction-contract';
export { labelIntent, labelAllIntents } from './enrichment/intent-labeler';
export { discoverWorkflows } from './enrichment/workflow-discoverer';
export {
  buildApplicationSurface,
  enrichSurfaceWithKnowledge,
} from './enrichment/application-surface';
export {
  aggregateRecordedWorkflows,
  getRecurringPatterns,
} from './enrichment/recorded-workflow';
export {
  ECOMMERCE_SIGNATURE,
  AUTHENTICATION_SIGNATURE,
  ADMIN_CRM_SIGNATURE,
  CONTENT_SIGNATURE,
  registerDomainSignature,
  getDomainSignatures,
  resetDomainSignatures,
} from './enrichment/domain-signatures';
export {
  ECOMMERCE_INTENT_VOCABULARY,
  AUTHENTICATION_INTENT_VOCABULARY,
  GENERAL_INTENT_VOCABULARY,
  getAllVocabEntries,
} from './enrichment/intent-vocabulary';
export type {
  DomainType,
  DomainClassification,
  DomainEvidence,
  InteractionContract,
  ElementType,
  InputFormat,
  ComponentModel,
  IntentLabel,
  SemanticWorkflow,
  WorkflowEffects,
  ApplicationSurface,
  SurfaceView,
  NavigationEdge,
  RecordedWorkflow,
  SemanticKnowledge,
  EnrichmentMetadata,
  EnrichmentCoverage,
} from './enrichment/semantic-types';

// Compound interaction detection (M9.10)
export { detectCompoundActions } from './enrichment/compound-detector';
export type { CompoundAction } from './enrichment/compound-detector';

// Multi-domain configuration (M9.11)
export type { DomainPack, ViewPatternSpec, NetworkPatternSpec, StateVocabEntry } from './domain-config/domain-pack-types';
export { DomainPackRegistry } from './domain-config/domain-pack-registry';
export { StateVocabularyRegistry } from './domain-config/state-vocabulary-registry';
export { IntentVocabularyRegistry } from './domain-config/intent-vocabulary-registry';
export { NetworkPatternRegistry } from './domain-config/network-pattern-registry';
export { ECOMMERCE_PACK } from './domain-config/packs/ecommerce-pack';
export { HR_PACK } from './domain-config/packs/hr-pack';
export { DEVTOOLS_PACK } from './domain-config/packs/devtools-pack';
