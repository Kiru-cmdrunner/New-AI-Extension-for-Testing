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
export type {
  Entity,
  EntityType,
  EntitySource,
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
