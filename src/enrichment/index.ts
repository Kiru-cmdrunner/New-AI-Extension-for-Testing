/**
 * Enrichment Layer — Public API
 *
 * Re-exports the three modules consumers need:
 *   - enrichInteraction / enrichInteractions: the integration entry point
 *   - detectComponent: Layer 2 (component type detection)
 *   - resolveMeaning: Layer 3 (business meaning resolution)
 *   - types: ComponentType, ComponentFramework, etc.
 */

export { enrichInteraction, enrichInteractions } from './enrich';
export { detectComponent } from './component-detector';
export { resolveMeaning } from './meaning-resolver';
export {
  type ComponentType,
  type ComponentFramework,
  type ComponentDetectionResult,
  ICON_SEMANTIC_NAMES,
} from './component-types';
