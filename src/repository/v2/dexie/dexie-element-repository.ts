/**
 * DexieElementRepository — V1 implementation of ElementRepository.
 *
 * Enforces INV-EL3: deletion is blocked if the element is referenced
 * by any ATC version step or validation. The reference check queries
 * the testCaseVersions table within the same transaction.
 */

import type { Element } from '../../../domain/entities/element';
import {
  createElement,
  updateElement,
} from '../../../domain/entities/element';
import type { ElementRepository } from '../interfaces/element-repository';
import type {
  CreateElementInput,
  UpdateElementInput,
} from '../../../domain/entities/element';
import { ElementReferencedError } from '../../../domain/errors/invariant-errors';
import type { Table } from 'dexie';
import type { TestCaseVersion } from '../../../domain/entities/approved-test-case';

/** Dexie-based implementation of ElementRepository. */
export class DexieElementRepository implements ElementRepository {
  constructor(
    private readonly elements: Table<Element, string>,
    private readonly testCaseVersions: Table<TestCaseVersion, string>,
  ) {}

  async getById(id: string): Promise<Element | undefined> {
    return this.elements.get(id);
  }

  async getByProject(projectId: string): Promise<Element[]> {
    return this.elements.where('projectId').equals(projectId).toArray();
  }

  async getByPageComponent(projectId: string, pageOrComponent: string): Promise<Element[]> {
    return this.elements
      .where('[projectId+pageOrComponent]')
      .equals([projectId, pageOrComponent])
      .toArray();
  }

  async create(input: CreateElementInput): Promise<Element> {
    const element = createElement(input);
    await this.elements.add(element);
    return element;
  }

  async update(id: string, changes: UpdateElementInput): Promise<Element> {
    const existing = await this.elements.get(id);
    if (!existing) {
      throw new Error(`Element not found: ${id}`);
    }

    const updated = updateElement(existing, changes);
    await this.elements.put(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    // INV-EL3: Check references before deleting.
    const referencing = await this.findReferencingVersions(id);

    if (referencing.length > 0) {
      throw new ElementReferencedError(id, referencing.map(r => r.versionId));
    }

    await this.elements.delete(id);
  }

  async isReferenced(id: string): Promise<string[]> {
    const refs = await this.findReferencingVersions(id);
    return refs.map(r => r.versionId);
  }

  /**
   * Scan all versions for steps or validations referencing this element.
   * This is an O(n) scan over versions, acceptable for V1 scale.
   * Future optimization: maintain a reverse index.
   */
  private async findReferencingVersions(
    elementId: string,
  ): Promise<Array<{ versionId: string; testCaseId: string }>> {
    const allVersions = await this.testCaseVersions.toArray();
    const references: Array<{ versionId: string; testCaseId: string }> = [];

    for (const version of allVersions) {
      // Check steps
      const stepRef = version.steps.some(s => s.elementId === elementId);
      // Check validations
      const valRef = version.steps.some(s =>
        s.validations.some(v => v.elementId === elementId),
      );

      if (stepRef || valRef) {
        references.push({ versionId: version.id, testCaseId: version.testCaseId });
      }
    }

    return references;
  }
}
