/**
 * M9.7 — Deterministic Semantic Enrichment: Output Types
 *
 * The machine-readable Application Understanding model.
 * Produced by SemanticEnricher from M9.6 ApplicationKnowledge,
 * JourneyTimeline, and M1–M8 ComponentInteractions.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

// ── Domain Classification ──────────────────────────────────────────────

export type DomainType =
  | 'e-commerce'
  | 'authentication'
  | 'admin-crm'
  | 'content'
  | 'unknown';

export interface DomainClassification {
  /** Classified domain. */
  domain: DomainType;
  /** Confidence 0–1. */
  confidence: number;
  /** Per-signal evidence that contributed to the score. */
  evidence: DomainEvidence;
  /** Runner-up domain (second-highest score). */
  alternative: DomainType | null;
  /** Score difference between winner and alternative. */
  margin: number;
}

export interface DomainEvidence {
  viewPatternScore: number;
  entityTypeScore: number;
  apiOperationScore: number;
  notificationKeywordScore: number;
  urlStructureScore: number;
  matchedSignals: string[];
}

// ── Interaction Contract ───────────────────────────────────────────────

export interface InteractionContract {
  /** Interaction ID this contract was derived from. */
  interactionId: string;
  /** Element label / accessible name. */
  label: string;
  /** HTML tag of the element. */
  tag: string;
  /** Semantic element type derived from tag. */
  elementType: ElementType;
  /** Input type from the `type` attribute (inputs only). */
  inputType: string | null;
  /** Expected value format (email, number, date, etc.). */
  format: InputFormat | null;
  /** Whether the element is disabled. */
  disabled: boolean;
  /** Whether the element is checked/selected. */
  checked: boolean | null;
  /** Whether the element is expanded (collapsibles). */
  expanded: boolean | null;
  /** Whether the element is likely required (inferred). */
  required: boolean | null;
  /** Placeholder text, if any. */
  placeholder: string | null;
  /** Number of options for select-like elements. */
  optionCount: number | null;
  /** DOM path of the element. */
  elementPath: string;
}

export type ElementType =
  | 'text-input'
  | 'email-input'
  | 'password-input'
  | 'number-input'
  | 'date-input'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'textarea'
  | 'button'
  | 'link'
  | 'slider'
  | 'file-input'
  | 'other';

export type InputFormat =
  | 'email'
  | 'url'
  | 'tel'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'month'
  | 'week'
  | 'password'
  | 'color'
  | 'search'
  | 'text';

// ── Component Model ────────────────────────────────────────────────────

export interface ComponentModel {
  /** Interaction ID where this component was observed. */
  interactionId: string;
  /** Component type (from existing enrichment or Tier 2 detection). */
  componentType: string;
  /** Framework (when detected). */
  componentFramework: string | null;
  /** Business meaning (when available). */
  businessMeaning: string | null;
  /** How the component was recognized. */
  detectedBy: 'enrichment' | 'tier1-aria' | 'tier2-behavioral';
  /** ARIA role of the component root. */
  ariaRole: string | null;
  /** Accessible name. */
  label: string;
  /** View ID where this component was observed. */
  viewId: string | null;
}

// ── Intent Label ───────────────────────────────────────────────────────

export interface IntentLabel {
  /** Interaction ID. */
  interactionId: string;
  /** Canonical intent label (e.g., "Add product to cart"). */
  intent: string;
  /** How the intent was resolved. */
  resolutionPath: 'api-operation' | 'button-text' | 'context';
  /** Confidence 0–1. */
  confidence: number;
}

// ── Semantic Workflow ──────────────────────────────────────────────────

export interface SemanticWorkflow {
  /** Unique ID for this workflow instance. */
  workflowId: string;
  /** Session ID this workflow belongs to. */
  sessionId: string;
  /** Human-readable label derived from dominant action. */
  label: string;
  /** Ordered interaction IDs in this workflow. */
  stepIds: string[];
  /** Intents for each step (from IntentLabeler). */
  stepIntents: string[];
  /** Views visited during this workflow. */
  viewIds: string[];
  /** Outcome summary. */
  overallOutcome: 'success' | 'failure' | 'mixed' | 'unknown';
  /** Aggregated state changes produced by this workflow. */
  effects: WorkflowEffects;
}

export interface WorkflowEffects {
  entitiesCreated: string[];
  entitiesModified: string[];
  counterDeltas: { counterId: string; delta: number }[];
  collectionChanges: { collectionId: string; netChange: number }[];
  notificationsEmitted: { text: string; severity: string }[];
  viewTransitions: { from: string; to: string }[];
}

// ── Application Surface ────────────────────────────────────────────────

export interface ApplicationSurface {
  /** All views in the application surface. */
  views: SurfaceView[];
  /** Navigation edges between views. */
  navigationEdges: NavigationEdge[];
}

export interface SurfaceView {
  /** View ID. */
  viewId: string;
  /** Human label. */
  label: string;
  /** Business purpose (what this view is for). */
  businessPurpose: string;
  /** Capabilities available on this view (derived from intents). */
  capabilities: string[];
  /** Components detected on this view. */
  components: ComponentModel[];
  /** Input elements on this view. */
  inputs: InteractionContract[];
  /** Entity types present on this view. */
  entityTypeRefs: string[];
  /** Collection IDs on this view. */
  collectionRefs: string[];
  /** Counter IDs on this view. */
  counterRefs: string[];
  /** Number of sessions that visited this view. */
  visitCount: number;
}

export interface NavigationEdge {
  fromViewId: string;
  toViewId: string;
  count: number;
}

// ── Recorded Workflow ──────────────────────────────────────────────────

export interface RecordedWorkflow {
  /** Stable hash of the workflow's canonical pattern. */
  patternId: string;
  /** Human label for the recurring pattern. */
  label: string;
  /** Canonical step sequence (intent names). */
  canonicalSteps: string[];
  /** View transition pattern. */
  viewSequence: string[];
  /** Sessions where this pattern was observed. */
  sessionIds: string[];
  /**
   * D6: behavior-signature keys co-occurring with this pattern — one entry
   * per signature whose episode ANCHOR interaction is part of some recorded
   * instance (pure observation: same app, same session, anchor inside the
   * instance's interaction set). Sorted. Undefined on rows written before
   * D6 (converges on next upsert).
   */
  signatureIds?: string[];
  /**
   * D6: linkage status. 'linked' once at least one signature co-occurs;
   * 'linkage-pending' when the pattern was recorded but no signature anchor
   * was observed inside any instance (honest absence — never fabricated).
   */
  linkageState?: 'linked' | 'linkage-pending';
  /**
   * D6: raw per-instance linkage — workflow instance id → sorted signature
   * keys whose anchors are steps of THAT instance. Pruned to the bounded
   * instance list. Undefined on pre-D6 rows.
   */
  instanceSignatureIds?: Record<string, string[]>;
  /** Number of occurrences across all sessions. */
  occurrenceCount: number;
  /** Workflow IDs of all instances. */
  instances: string[];
}

// ── Semantic Knowledge ─────────────────────────────────────────────────

export interface SemanticKnowledge {
  /** App ID. */
  appId: string;
  /** Domain classification. */
  domain: DomainClassification;
  /** Application surface model. */
  surface: ApplicationSurface;
  /** Interaction contracts for all observed inputs. */
  contracts: InteractionContract[];
  /** Components recognized across all interactions. */
  components: ComponentModel[];
  /** Intent labels for all observed actions. */
  intents: IntentLabel[];
  /** Semantic workflows discovered in this session. */
  workflows: SemanticWorkflow[];
  /** Cross-session recorded workflow patterns. */
  recordedWorkflows: RecordedWorkflow[];
  /** Metadata about the enrichment process. */
  metadata: EnrichmentMetadata;
}

export interface EnrichmentMetadata {
  /** Enricher version. */
  enricherVersion: string;
  /** When this knowledge was generated (epoch ms). */
  generatedAt: number;
  /** How many interactions were analyzed. */
  interactionCount: number;
  /** How many workflows were discovered. */
  workflowCount: number;
  /** How many views were enriched. */
  viewCount: number;
  /** Coverage statistics. */
  coverage: EnrichmentCoverage;
}

export interface EnrichmentCoverage {
  /** % of interactions with resolved intents. */
  intentCoverage: number;
  /** % of interactions with recognized components. */
  componentCoverage: number;
  /** % of inputs with extracted contracts. */
  contractCoverage: number;
}
