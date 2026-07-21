/**
 * IRCodeGenerator Interface — execution-ir-design.md §4.2
 *
 * "Produce source files" — the code generator receives an IR plan plus a
 * generator configuration and produces source files. Playwright, Cypress,
 * Selenium, Appium generators all implement this interface.
 *
 * The GeneratorConfig controls HOW the IR is rendered (flat vs POM, assertion
 * library, file structure). It never influences the IR itself.
 */

import type { ExecutionIRPlan } from '../types';
import type { RenderingEngine } from '../types';

// ── Generator Interface ───────────────────────────────────

export interface IRCodeGenerator {
  /**
   * Generate source files from an IR plan.
   *
   * @param plan   The execution IR plan.
   * @param config Generator configuration (output style, framework options).
   * @returns      Generated files and project metadata.
   */
  generate(
    plan: ExecutionIRPlan,
    config: GeneratorConfig,
  ): Promise<GenerationResult>;
}

// ── GeneratorConfig ───────────────────────────────────────

/**
 * Output-style decisions for code generation.
 * This is the second input to IRCodeGenerator — it controls HOW the generator
 * renders the IR. It never influences the IR itself.
 *
 * The same IR can be rendered as flat tests, POM tests, etc. — just change
 * the GeneratorConfig and re-run the generator.
 */
export interface GeneratorConfig {
  /** Output language. */
  readonly language: 'typescript' | 'javascript';
  /** Code organization pattern — purely an output concern. */
  readonly pattern: 'flat' | 'page-object';
  /** Assertion library style for the target framework. */
  readonly assertions: 'expect' | 'chai' | 'assert';
  /** Project structure preferences. */
  readonly fileStructure?: {
    readonly testsDir?: string;
    readonly pagesDir?: string;
    readonly helpersDir?: string;
  };
  /** Framework-specific options (Playwright config, Cypress config, etc.). */
  readonly frameworkOptions?: Record<string, unknown>;
}

// ── Result Types ──────────────────────────────────────────

export interface GenerationResult {
  readonly files: GeneratedFile[];
  readonly projectMetadata: {
    readonly engine: RenderingEngine;
    readonly language: string;
    readonly pattern: string;
    readonly fileCount: number;
  };
}

export interface GeneratedFile {
  /** Relative path within the generated project (e.g., "tests/login.spec.ts"). */
  readonly path: string;
  readonly content: string;
}
