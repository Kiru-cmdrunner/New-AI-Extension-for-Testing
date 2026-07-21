/**
 * Source Artifact Entity — domain-schema.md §3.3
 *
 * The immutable raw input from which an Approved Test Case is (or can be)
 * generated. A Source Artifact captures the original signal — recorder
 * interactions, a natural-language description, a screenshot, an imported
 * document — and retains it permanently.
 *
 * Source Artifacts are polymorphic — one entity with a `type` discriminator.
 *
 * Invariants:
 *   INV-SA1: Source Artifacts are immutable once created.
 *   INV-SA2: Source Artifacts are never deleted.
 *   INV-SA3: Interaction Timeline content stores the complete raw signal.
 */

import { SourceArtifactType } from '../enums';
import { MissingFieldError, ValueObjectError } from '../errors/invariant-errors';

// ── Type-specific content interfaces ──────────────────────

/** Content for an interaction_timeline source (recorder output). */
export interface InteractionTimelineContent {
  /** SessionEvent[] — the raw interactions from the recorder. */
  readonly sessionEvents: unknown[];
  /** Metadata about the recording session. */
  readonly recordingMetadata: {
    readonly browser?: string;
    readonly viewport?: { width: number; height: number };
    readonly duration?: number;
    readonly url?: string;
  };
}

/** Content for a natural_language source. */
export interface NaturalLanguageContent {
  readonly description: string;
  readonly context?: string;
}

/** Content for an image/screenshot source. */
export interface ImageContent {
  readonly imagePath: string;
  readonly caption?: string;
  readonly annotations?: unknown[];
}

/** Content for an imported document source. */
export interface ImportedDocumentContent {
  readonly documentPath: string;
  readonly documentType: string;
  readonly extractedText?: string;
}

/** Content for a manually-authored source. */
export interface ManualContent {
  readonly description: string;
}

/** Discriminated union of all content types. */
export type SourceArtifactContent =
  | InteractionTimelineContent
  | NaturalLanguageContent
  | ImageContent
  | ImportedDocumentContent
  | ManualContent;

/** Capture metadata — how this source was captured. */
export interface SourceArtifactMetadata {
  readonly captureMethod: string;
  readonly rawEvidenceAvailable?: boolean;
  readonly sourceSystem?: string;
}

// ── Source Artifact entity ────────────────────────────────

/** A Source Artifact — immutable raw input for test case generation. */
export interface SourceArtifact {
  readonly id: string;
  readonly projectId: string;
  readonly type: SourceArtifactType;
  readonly content: SourceArtifactContent;
  readonly metadata: SourceArtifactMetadata;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** Input for creating a new Source Artifact. */
export interface CreateSourceArtifactInput {
  projectId: string;
  type: SourceArtifactType;
  content: SourceArtifactContent;
  metadata?: SourceArtifactMetadata;
  createdBy: string;
}

/**
 * Create a Source Artifact entity with invariant validation.
 *
 * Invariants enforced:
 *   - projectId, type, content, createdBy required
 *   - content must match the type discriminator
 *
 * @throws MissingFieldError if required fields are empty
 * @throws ValueObjectError if content doesn't match the type
 */
export function createSourceArtifact(input: CreateSourceArtifactInput): SourceArtifact {
  if (!input.projectId?.trim()) {
    throw new MissingFieldError('SourceArtifact', 'projectId');
  }

  if (!input.type) {
    throw new MissingFieldError('SourceArtifact', 'type');
  }

  if (!input.content || typeof input.content !== 'object') {
    throw new MissingFieldError('SourceArtifact', 'content');
  }

  const createdBy = input.createdBy?.trim();
  if (!createdBy) {
    throw new MissingFieldError('SourceArtifact', 'createdBy');
  }

  // Validate content matches type
  validateContentForType(input.type, input.content);

  return {
    id: crypto.randomUUID(),
    projectId: input.projectId.trim(),
    type: input.type,
    content: input.content,
    metadata: input.metadata ?? { captureMethod: 'unknown' },
    createdAt: new Date().toISOString(),
    createdBy,
  };
}

/**
 * Validate that the content object matches the expected shape for the type.
 */
function validateContentForType(type: SourceArtifactType, content: SourceArtifactContent): void {
  switch (type) {
    case SourceArtifactType.INTERACTION_TIMELINE: {
      const c = content as Partial<InteractionTimelineContent>;
      if (!Array.isArray(c.sessionEvents)) {
        throw new ValueObjectError(
          'SourceArtifact',
          'interaction_timeline content must have a sessionEvents array',
        );
      }
      break;
    }
    case SourceArtifactType.NATURAL_LANGUAGE: {
      const c = content as Partial<NaturalLanguageContent>;
      if (!c.description?.trim()) {
        throw new ValueObjectError(
          'SourceArtifact',
          'natural_language content must have a description string',
        );
      }
      break;
    }
    case SourceArtifactType.IMAGE: {
      const c = content as Partial<ImageContent>;
      if (!c.imagePath?.trim()) {
        throw new ValueObjectError(
          'SourceArtifact',
          'image content must have an imagePath string',
        );
      }
      break;
    }
    case SourceArtifactType.IMPORTED_DOCUMENT: {
      const c = content as Partial<ImportedDocumentContent>;
      if (!c.documentPath?.trim()) {
        throw new ValueObjectError(
          'SourceArtifact',
          'imported_document content must have a documentPath string',
        );
      }
      break;
    }
    case SourceArtifactType.MANUAL: {
      const c = content as Partial<ManualContent>;
      if (!c.description?.trim()) {
        throw new ValueObjectError(
          'SourceArtifact',
          'manual content must have a description string',
        );
      }
      break;
    }
    default:
      throw new ValueObjectError(
        'SourceArtifact',
        `unknown source artifact type: ${type}`,
      );
  }
}
