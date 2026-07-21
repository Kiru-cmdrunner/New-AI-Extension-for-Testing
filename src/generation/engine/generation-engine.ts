/**
 * Generation Engine — the sole orchestrator of artifact generation.
 *
 * Milestone B3 (v4.1.0) — Foundation
 *
 * B2 §2.3: The GenerationEngine is the sole orchestrator.
 *   - Receives the trigger (Stop Recording)
 *   - Reads frozen Timeline, Recording Context from storage
 *   - Invokes each generator in order (from registry)
 *   - Collects outputs
 *   - Writes all artifacts to storage in a single batch
 *   - Manages state transitions
 *   - Reports progress
 *
 * B2 AP4: Engine owns state, generators don't.
 * B2 AP6: Batch persistence — all artifacts written at the end.
 *
 * The engine is transient: it exists only for the duration of one
 * generation pass. If the user clicks Retry, a new engine instance
 * is created.
 *
 * MV3 note: If the SW dies during GENERATING, on restart the engine
 * detects the GENERATING state and auto-retries (Timeline is immutable).
 */

import { StorageService } from '../../storage/storage-service';
import { TestCaseState } from '../../shared/types';
import { generatorRegistry } from '../registry/generator-registry';
import { canonicalStepGenerator } from '../generators/canonical-step-generator';
import { executionJsonGenerator } from '../generators/execution-json-generator';
import { playwrightGenerator } from '../generators/playwright-generator';
import { classifyInteractions } from '../engine/semantic-classifier';
import type { GenerationResult, GeneratorError, CanonicalStep } from '../types';
import type { CanonicalStepGeneratorInput, ExecutionJsonGeneratorInput, PlaywrightGeneratorInput, PlaywrightGeneratorOutput } from '../contracts/generator-contract';

// Register generators on module load.
// B5.1 §3.6 / B6 Spec: Each generator registers with its dependencies.
// The registry's topological sort resolves execution order:
//   canonical-step-generator → execution-json-generator → playwright-generator
generatorRegistry.register(canonicalStepGenerator);
generatorRegistry.register(executionJsonGenerator);
generatorRegistry.register(playwrightGenerator);

/**
 * The Generation Engine.
 *
 * Transient: created on Stop Recording. Discarded after generation
 * completes (success or failure).
 */
export class GenerationEngine {
  private generating = false;
  private lastResult: GenerationResult | null = null;

  /**
   * Run the full generation pipeline.
   *
   * Reads the frozen Timeline and Recording Context from storage,
   * invokes generators in dependency order, writes artifacts to
   * storage, and transitions the Test Case state.
   *
   * B2 AP8: Generation is deterministic. Same input → same output.
   */
  async generate(): Promise<GenerationResult> {
    if (this.generating) {
      throw new Error('Generation already in progress');
    }

    this.generating = true;

    try {
      // 1. Transition TC to GENERATING
      await this.transitionTestCaseState(TestCaseState.GENERATING);

      // 2. Read frozen inputs from storage
      const timeline = await StorageService.getEvents();
      const recordingContext = await StorageService.getRecordingContext();


      if (!recordingContext) {
        const result: GenerationResult = {
          status: 'failure',
          steps: null,
          errors: [{
            stepIndex: null,
            message: 'No recording context found — cannot generate steps without knowing where recording started.',
            recoverable: false,
          }],
          generatedAt: new Date().toISOString(),
        };
        this.lastResult = result;
        return result;
      }

      // ── STAGE 3a: Semantic Classification ──
      // Phase 3 Integration Step 1: Classify the timeline into canonical types
      // before passing to the canonical-step-generator. The classifier is a
      // pure function — no side effects, no AI required (Tier 1 deterministic
      // rules handle all known interaction types).
      const classified = classifyInteractions(timeline);

      // 3. Get generators in dependency order
      const orderedGenerators = generatorRegistry.getOrdered();

      // 3a. Read test case draft for Playwright generator (test name)
      const draft = await StorageService.getTestCaseDraft();

      // 4. Run each generator sequentially
      let allErrors: GeneratorError[] = [];
      let steps: import('../types').CanonicalStep[] | null = null;

      for (const gen of orderedGenerators) {
        if (gen.name === 'canonical-step-generator') {
          const input: CanonicalStepGeneratorInput = {
            timeline,
            recordingContext,
            classified,
          };
          const result = gen.generate(input);

          allErrors = allErrors.concat(result.errors);

          if (result.status === 'failure') {
            // Complete failure — stop pipeline
            const failResult: GenerationResult = {
              status: 'failure',
              steps: null,
              errors: allErrors,
              generatedAt: new Date().toISOString(),
            };
            this.lastResult = failResult;
            // TC stays in GENERATING (retry available)
            return failResult;
          }

          steps = result.output as CanonicalStep[];

          // If partial, continue to next generator with available steps
          if (result.status === 'partial' && steps) {
            // Continue — future generators work with available steps
          }
        } else if (gen.name === 'execution-json-generator') {
          // B5.3: Execution JSON Generator populates executionJson on each step.
          // B5.1 §3.6: Invoked after canonical-step-generator (registry order).
          if (!steps || steps.length === 0) continue;

          const jsonInput: ExecutionJsonGeneratorInput = { steps };
          const jsonResult = gen.generate(jsonInput);

          allErrors = allErrors.concat(jsonResult.errors);

          if (jsonResult.status === 'success' || jsonResult.status === 'partial') {
            // Steps now have executionJson populated
            steps = jsonResult.output as CanonicalStep[];
          }
          // Failure is non-fatal for the overall pipeline — steps still exist,
          // just without execution JSON. The side panel will show them.
        } else if (gen.name === 'playwright-generator') {
          // B6: Playwright Generator produces one test() per Test Case.
          // B5.1 §3.6: Invoked after execution-json-generator (registry order).
          if (!steps || steps.length === 0) continue;

          const pwInput: PlaywrightGeneratorInput = {
            steps,
            recordingContext,
            testCaseName: draft?.name || 'Recorded Test',
          };
          const pwResult = gen.generate(pwInput);

          allErrors = allErrors.concat(pwResult.errors);

          if (pwResult.status === 'success' || pwResult.status === 'partial') {
            if (pwResult.output) {
              await StorageService.setGeneratedPlaywright(
                pwResult.output as PlaywrightGeneratorOutput,
              );
            }
          }
          // Failure is non-fatal — Playwright is a derived export, not source of truth.
        }
      }

      // 5. Determine overall status
      const status: 'success' | 'partial' | 'failure' =
        steps === null ? 'failure' :
        allErrors.length > 0 ? 'partial' :
        'success';

      const result: GenerationResult = {
        status,
        steps,
        errors: allErrors,
        generatedAt: new Date().toISOString(),
      };

      // 6. Batch persist all artifacts (B2 AP6)
      if (steps) {
        await StorageService.setGeneratedSteps(steps);
      }

      // 7. Transition TC state
      await this.transitionTestCaseState(TestCaseState.GENERATED);

      this.lastResult = result;
      return result;
    } finally {
      this.generating = false;
    }
  }

  /**
   * Transition the Test Case draft to a new state.
   *
   * B2 AP4: Only the engine manages state transitions.
   */
  private async transitionTestCaseState(state: TestCaseState): Promise<void> {
    const draft = await StorageService.getTestCaseDraft();
    if (draft) {
      await StorageService.setTestCaseDraft({ ...draft, status: state });
    }
  }

  /**
   * Whether generation is currently in progress.
   */
  get isGenerating(): boolean {
    return this.generating;
  }

  /**
   * Get the result of the last generation run.
   */
  getLastResult(): GenerationResult | null {
    return this.lastResult;
  }
}
