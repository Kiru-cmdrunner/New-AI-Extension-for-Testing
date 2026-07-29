/**
 * Recognition Pipeline Index — Phase 4
 *
 * Barrel export for all recognition modules.
 */

export {
  groupBatches,
  type InteractionCandidate,
  elementKey,
  isStandaloneEvent,
  isSameElement,
  areSemanticallyRelated,
} from './event-grouper';

export {
  evaluateOperator,
  evaluatePattern,
  type PatternEvalResult,
  type ConditionEvalResult,
} from './pattern-evaluator';

export {
  getAllPatterns,
  getPatternsForEvent,
  getPatternById,
  ALL_PATTERNS,
} from './pattern-registry';

export {
  recogniseInteractions,
  type RecognitionOptions,
  resetRecognitionCounter,
} from './recognition-pipeline';
