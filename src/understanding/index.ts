/**
 * M9 — Application Understanding: Public API
 *
 * Barrel exports for the understanding layer.
 */

// Types
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

// Signal extraction pipeline
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

// State builder
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
