/**
 * Semantic Reasoning Module — Stage 5
 *
 * Public API for the stream-based semantic reasoning engine.
 *
 * Exports:
 *   reasonAboutInteractions() — main entry point
 *   SemanticReasoner          — class for direct use/testing
 *   resetSessionCounter()     — reset ID counter (testing)
 *   Types                     — SemanticReasoningResult, ComponentSession, etc.
 */

export { reasonAboutInteractions, SemanticReasoner, resetSessionCounter } from './reasoner';
export type {
  ComponentType,
  SessionPhase,
  ComponentSession,
  SemanticReasoningResult,
} from './types';
