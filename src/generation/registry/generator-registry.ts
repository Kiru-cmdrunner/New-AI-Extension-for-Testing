/**
 * Generator Registry — registers generators and resolves execution order.
 *
 * Milestone B3 (v4.1.0) — Foundation
 *
 * B2 AP7: Extension by addition. New generators are added through the
 * registry. No existing generator is modified to support a new export
 * format. The dependency chain is resolved at runtime by the engine.
 */

import type { GeneratorContract } from '../contracts/generator-contract';

/**
 * Registry of all available generators.
 *
 * The GenerationEngine calls getOrdered() to get generators in the
 * correct execution sequence (sorted by dependency chain).
 *
 * Adding a new generator (e.g. Cypress):
 *   1. Create CypressGenerator implementing GeneratorContract
 *   2. Register: GeneratorRegistry.register(cypressContract)
 *   3. Done. No existing generator or the engine is modified.
 */
export class GeneratorRegistry {
  private readonly generators = new Map<string, GeneratorContract>();

  /**
   * Register a generator.
   * If a generator with the same name already exists, it is replaced.
   */
  register(contract: GeneratorContract): void {
    this.generators.set(contract.name, contract);
  }

  /**
   * Get a generator by name.
   * Returns undefined if not registered.
   */
  get(name: string): GeneratorContract | undefined {
    return this.generators.get(name);
  }

  /**
   * Check whether a generator is registered.
   */
  has(name: string): boolean {
    return this.generators.has(name);
  }

  /**
   * Get all registered generator names.
   */
  getAllNames(): string[] {
    return Array.from(this.generators.keys());
  }

  /**
   * Get all generators in dependency order.
   *
   * A generator runs only after all generators in its `dependencies`
   * array have been placed in the output list.
   *
   * This is a topological sort over the dependency graph.
   * Throws if a circular dependency is detected.
   */
  getOrdered(): GeneratorContract[] {
    const result: GeneratorContract[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>(); // For cycle detection

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving generator: ${name}`);
      }
      visiting.add(name);

      const gen = this.generators.get(name);
      if (!gen) {
        throw new Error(`Missing dependency: generator "${name}" is not registered`);
      }

      // Visit dependencies first
      for (const dep of gen.dependencies) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      result.push(gen);
    };

    // Visit all generators
    for (const name of this.generators.keys()) {
      visit(name);
    }

    return result;
  }
}

/**
 * The singleton registry instance.
 *
 * The GenerationEngine reads from this registry. Tests can create their
 * own GeneratorRegistry instances for isolation.
 */
export const generatorRegistry = new GeneratorRegistry();
