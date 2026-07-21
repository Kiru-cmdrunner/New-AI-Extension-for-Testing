/**
 * ElementRepository Interface — domain-schema.md §3.4
 *
 * Repository contract for Element aggregate root.
 * Implementations: DexieElementRepository (V1), ApiElementRepository (future).
 */

import type {
  Element,
  CreateElementInput,
  UpdateElementInput,
} from '../../../domain/entities/element';

/** Repository interface for Element CRUD operations. */
export interface ElementRepository {
  /** Get an element by its stable ID. Returns undefined if not found. */
  getById(id: string): Promise<Element | undefined>;

  /** Get all elements in a project. */
  getByProject(projectId: string): Promise<Element[]>;

  /** Get elements filtered by pageOrComponent scope. */
  getByPageComponent(projectId: string, pageOrComponent: string): Promise<Element[]>;

  /** Create a new element. Throws on invariant violation. */
  create(input: CreateElementInput): Promise<Element>;

  /** Update an element's fields. Returns the updated element. */
  update(id: string, changes: UpdateElementInput): Promise<Element>;

  /**
   * Delete an element. Throws ElementReferencedError if the element is
   * referenced by any ATC version step or validation (INV-EL3).
   */
  delete(id: string): Promise<void>;

  /**
   * Check if an element is referenced by any ATC version.
   * Used for pre-delete validation and UI feedback.
   * Returns the list of version IDs that reference this element.
   */
  isReferenced(id: string): Promise<string[]>;
}
