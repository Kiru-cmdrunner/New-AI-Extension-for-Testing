/**
 * IR Executor Implementation — orchestrates ExecutionIRPlan execution.
 *
 * This is the Phase 12 runtime orchestrator. It:
 *   1. Opens a browser tab and navigates to the test's start URL
 *   2. Injects the executor content script into the tab
 *   3. Sequences through IRStep[] in order:
 *      a. Resolves the element via the content script (locator resolver)
 *      b. If locator fails → triggers runtime healing (healElementAndPersist)
 *      c. Executes the action via the content script (action executor)
 *      d. Evaluates assertions via the content script (assertion evaluator)
 *      e. Records step results
 *   4. Produces IRExecutionResult (pass/fail/error per step + assertions)
 *   5. Persists ExecutionRun to Repository V2 (Dexie/IndexedDB)
 *
 * Design Principles:
 *   - IRExecutor executes ONE test case. SuiteExecutor (Phase 13) will
 *     orchestrate multiple IRExecutor instances.
 *   - Runtime healing is triggered ONLY for locator resolution failures.
 *     Assertion failures are normal test results — they do NOT trigger healing.
 *   - IR plan is immutable. Healed locators go into a per-run in-memory
 *     override map that is discarded after the run. The Repository Element
 *     is the persistent source of truth — after healing, its updatedAt
 *     bumps, triggering IR regeneration on the next access.
 *   - The content script is a thin execution bridge. All logic (locator
 *     resolution, action execution, assertion evaluation) is inlined in
 *     the content script. The service worker sends messages and collects
 *     results.
 */

import type {
  ExecutionIRPlan,
  IRStep,
  ResolvedLocator,
} from '../domain/execution-ir/types';
import type {
  IRExecutor,
  IRExecutionOptions,
  IRExecutionResult,
  IRStepResult,
  IRAssertionResult,
} from '../domain/execution-ir/adapters/ir-executor';
import type { ElementIdentity } from '../shared/types';

// ── Types ───────────────────────────────────────────────────

/**
 * Content script response for EXECUTE_STEP messages.
 * Mirrors the StepResult shape from executor-content-script.ts.
 */
interface StepExecutionResponse {
  stepId: string;
  action: string;
  status: 'passed' | 'failed' | 'error';
  actualValue?: unknown;
  error?: { message: string; type: string };
  durationMs: number;
  /** Element identity extracted from live DOM (for runtime healing). */
  resolvedIdentity?: Record<string, string | null> | null;
}

/**
 * Content script response for RESOLVE_LOCATOR messages.
 */
interface ResolveLocatorResponse {
  found: boolean;
  identity: Record<string, string | null> | null;
}

/**
 * Content script response for EVALUATE_ASSERTIONS messages.
 */
interface EvaluateAssertionsResponse {
  results: IRAssertionResult[];
}

/**
 * Per-run override map: elementId → healed locator strategies.
 * Discarded after the run. The Repository Element is the persistent
 * source of truth.
 */
type OverrideMap = Map<string, ResolvedLocator[]>;

/**
 * Options for creating an IRExecutorImpl.
 */
export interface IRExecutorImplOptions {
  /** Function to create a new tab and navigate to a URL. */
  readonly createTab?: (url: string) => Promise<number>;
  /** Function to inject the executor content script into a tab. */
  readonly injectScript?: (tabId: number) => Promise<void>;
  /** Function to send a message to a tab's content script. */
  readonly sendTabMessage?: <T>(tabId: number, message: unknown) => Promise<T>;
  /** Function to get the current URL of a tab. */
  readonly getTabUrl?: (tabId: number) => Promise<string>;
  /** Function to navigate an existing tab to a URL (IR navigate steps). */
  readonly updateTabUrl?: (tabId: number, url: string) => Promise<void>;
  /** Function to close a tab. */
  readonly closeTab?: (tabId: number) => Promise<void>;
}

// ── Default Chrome API bindings ─────────────────────────────

async function defaultCreateTab(url: string): Promise<number> {
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) throw new Error('Failed to create tab');
  return tab.id;
}

async function defaultInjectScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/execution/executor-content-script.js'],
  });
}

async function defaultSendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message) as Promise<T>;
}

async function defaultGetTabUrl(tabId: number): Promise<string> {
  const tab = await chrome.tabs.get(tabId);
  return tab.url ?? '';
}

async function defaultUpdateTabUrl(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
}

async function defaultCloseTab(tabId: number): Promise<void> {
  await chrome.tabs.remove(tabId);
}

// ── IRExecutorImpl ──────────────────────────────────────────

/**
 * The production IRExecutor implementation.
 *
 * Orchestrates step-by-step execution of an ExecutionIRPlan against
 * a live browser tab via the executor content script.
 */
export class IRExecutorImpl implements IRExecutor {
  private readonly createTab: (url: string) => Promise<number>;
  private readonly injectScript: (tabId: number) => Promise<void>;
  private readonly sendTabMessage: <T>(tabId: number, message: unknown) => Promise<T>;
  private readonly getTabUrl: (tabId: number) => Promise<string>;
  private readonly updateTabUrl: (tabId: number, url: string) => Promise<void>;
  private readonly closeTab: (tabId: number) => Promise<void>;

  constructor(options?: IRExecutorImplOptions) {
    this.createTab = options?.createTab ?? defaultCreateTab;
    this.injectScript = options?.injectScript ?? defaultInjectScript;
    this.sendTabMessage = options?.sendTabMessage ?? defaultSendTabMessage;
    this.getTabUrl = options?.getTabUrl ?? defaultGetTabUrl;
    this.updateTabUrl = options?.updateTabUrl ?? defaultUpdateTabUrl;
    this.closeTab = options?.closeTab ?? defaultCloseTab;
  }

  async execute(
    plan: ExecutionIRPlan,
    options?: IRExecutionOptions,
  ): Promise<IRExecutionResult> {
    const startedAt = new Date().toISOString();
    const startTime = performance.now();
    const stepResults: IRStepResult[] = [];
    const overrideMap: OverrideMap = new Map();

    let runFailed = false;

    // Determine start URL from the plan's environment
    // D9: prefer the recorded startUrl (exact page); pre-D9 cached plans
    // carry only the pathful baseUrl and fall back to it.
    const startUrl = plan.environment.startUrl ?? plan.environment.baseUrl;

    // 1. Create a tab and navigate to the start URL
    let tabId: number;
    try {
      tabId = await this.createTab(startUrl);
      // Wait for page to load
      await this.waitForPageLoad(tabId);
    } catch (e) {
      return {
        status: 'error',
        stepResults: [],
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: performance.now() - startTime,
      };
    }

    // 2. Inject executor content script
    try {
      await this.injectScript(tabId);
    } catch (e) {
      await this.closeTab(tabId).catch(() => {});
      return {
        status: 'error',
        stepResults: [],
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: performance.now() - startTime,
      };
    }

    // 3. Execute steps sequentially
    for (const step of plan.steps) {
      // Notify progress callback
      if (options?.onStepStart) {
        options.onStepStart(step);
      }

      // If a previous step errored, skip remaining steps
      if (runFailed) {
        stepResults.push({
          stepId: step.id,
          status: 'skipped',
          durationMs: 0,
          assertionResults: [],
        });
        continue;
      }

      const stepResult = await this.executeStep(tabId, step, overrideMap, options);
      stepResults.push(stepResult);

      // Notify completion callback
      if (options?.onStepComplete) {
        options.onStepComplete(step, stepResult);
      }

      // On error, mark run as failed and skip remaining steps
      if (stepResult.status === 'error') {
        runFailed = true;
      }
    }

    // 4. Clean up: close the tab
    await this.closeTab(tabId).catch(() => {});

    // 5. Determine overall status
    const hasError = stepResults.some((r) => r.status === 'error');
    const hasFailure = stepResults.some((r) => r.status === 'failed');
    const status: IRExecutionResult['status'] = hasError
      ? 'error'
      : hasFailure
        ? 'failed'
        : 'passed';

    return {
      status,
      stepResults,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: performance.now() - startTime,
    };
  }

  // ── Single Step Execution ─────────────────────────────────

  private async executeStep(
    tabId: number,
    step: IRStep,
    overrideMap: OverrideMap,
    options?: IRExecutionOptions,
  ): Promise<IRStepResult> {
    const stepStartTime = performance.now();

    // NAVIGATE steps are handled by the SERVICE WORKER (chrome.tabs.update):
    // the content script's document is destroyed by the navigation, so an
    // in-page action is impossible. Navigate, wait for the new document to
    // load, and re-inject the executor content script — subsequent steps
    // resolve elements and evaluate assertions on the NEW page.
    // (Audit 1703e43: previously a silent no-op — the run stayed on the
    // start URL and every destination-page element reported ElementNotFound.)
    if (step.action === 'navigate' && step.target.kind === 'url' && step.target.url) {
      try {
        await this.updateTabUrl(tabId, step.target.url);
        await this.waitForPageLoad(tabId);
        await this.injectScript(tabId);

        // Step-scoped assertions on a navigate step describe the DESTINATION
        // page (e.g. "cart count shows 0 items" recorded post-navigation) —
        // evaluate them here against the newly loaded document, using the
        // same soft/hard severity semantics as the normal action path.
        let assertionResults: IRAssertionResult[] = [];
        if (step.assertions && step.assertions.length > 0) {
          const currentUrl = await this.getTabUrl(tabId);
          const evalResponse = await this.sendTabMessage<EvaluateAssertionsResponse>(tabId, {
            type: 'EVALUATE_ASSERTIONS',
            assertions: step.assertions,
            url: currentUrl,
          });
          assertionResults = evalResponse?.results ?? [];
        }
        const hardAssertionFailed = assertionResults.some(
          (a) => !a.passed && (a.severity === 'hard' || a.severity === undefined),
        );
        return {
          stepId: step.id,
          status: hardAssertionFailed ? 'failed' : 'passed',
          durationMs: performance.now() - stepStartTime,
          assertionResults,
          error: hardAssertionFailed
            ? { message: 'One or more assertions failed', type: 'AssertionFailure' }
            : undefined,
        };
      } catch (e) {
        return {
          stepId: step.id,
          status: 'error',
          durationMs: performance.now() - stepStartTime,
          assertionResults: [],
          error: {
            message: `Navigation to "${step.target.url}" failed: ${(e as Error).message}`,
            type: 'NavigationError',
          },
        };
      }
    }

    // Resolve target
    if (step.target.kind === 'element') {
      const elementId = step.target.elementId;
      const locators = overrideMap.get(elementId) ?? step.target.resolvedLocators;

      // Try to resolve the element via content script
      const resolveResponse = await this.sendTabMessage<ResolveLocatorResponse>(tabId, {
        type: 'RESOLVE_LOCATOR',
        locators,
        requireVisible: step.executionParameters.waitStrategy !== 'none',
        // Late-rendered targets: poll up to timeoutMs (content script caps
        // at 10s). waitStrategy 'none' NEVER waits — resolveElementWithWait
        // parity ('none' = one immediate attempt).
        timeoutMs:
          step.executionParameters.waitStrategy === 'none'
            ? 0
            : (step.executionParameters.timeoutMs ?? 0),
      });

      if (!resolveResponse.found) {
        // Locator resolution failed → trigger runtime healing
        const healed = await this.attemptRuntimeHealing(
          tabId,
          step,
          overrideMap,
          options,
        );

        if (healed) {
          // Retry resolution with healed locators
          const retryResponse = await this.sendTabMessage<ResolveLocatorResponse>(tabId, {
            type: 'RESOLVE_LOCATOR',
            locators: overrideMap.get(elementId) ?? step.target.resolvedLocators,
            requireVisible: step.executionParameters.waitStrategy !== 'none',
            timeoutMs:
              step.executionParameters.waitStrategy === 'none'
                ? 0
                : (step.executionParameters.timeoutMs ?? 0),
          });

          if (!retryResponse.found) {
            // Still not found after healing — step fails
            return {
              stepId: step.id,
              status: 'failed',
              durationMs: performance.now() - stepStartTime,
              assertionResults: [],
              error: {
                message: `Element "${step.target.elementName}" not found after healing attempt`,
                type: 'ElementNotFound',
              },
            };
          }
        } else {
          // Healing not available or failed — step fails
          return {
            stepId: step.id,
            status: 'failed',
            durationMs: performance.now() - stepStartTime,
            assertionResults: [],
            error: {
              message: `Element "${step.target.elementName}" not found`,
              type: 'ElementNotFound',
            },
          };
        }
      }
    }

    // Execute the action via content script
    const actionResponse = await this.sendTabMessage<StepExecutionResponse>(tabId, {
      type: 'EXECUTE_STEP',
      step: {
        id: step.id,
        action: step.action,
        target: step.target,
        input: step.input,
        executionParameters: step.executionParameters,
      },
    });

    if (!actionResponse || actionResponse.status === 'error') {
      return {
        stepId: step.id,
        status: 'error',
        durationMs: performance.now() - stepStartTime,
        assertionResults: [],
        error: actionResponse?.error ?? { message: 'Unknown execution error', type: 'UnknownError' },
      };
    }

    // If action failed, don't evaluate assertions
    if (actionResponse.status === 'failed') {
      return {
        stepId: step.id,
        status: 'failed',
        durationMs: performance.now() - stepStartTime,
        assertionResults: [],
        error: actionResponse.error,
        actualValue: actionResponse.actualValue,
      };
    }

    // Evaluate assertions (only if action succeeded)
    let assertionResults: IRAssertionResult[] = [];
    if (step.assertions && step.assertions.length > 0) {
      const currentUrl = await this.getTabUrl(tabId);
      const evalResponse = await this.sendTabMessage<EvaluateAssertionsResponse>(tabId, {
        type: 'EVALUATE_ASSERTIONS',
        assertions: step.assertions,
        url: currentUrl,
      });
      assertionResults = evalResponse?.results ?? [];
    }

    // Determine step status: passed if action succeeded AND all hard assertions passed.
    // SOFT assertion failures are recorded in results but do NOT fail the step.
    const hardAssertionFailed = assertionResults.some(
      (a) => !a.passed && (a.severity === 'hard' || a.severity === undefined),
    );

    const actionSucceeded = actionResponse.status === 'passed';
    const stepStatus: IRStepResult['status'] = actionSucceeded && !hardAssertionFailed
      ? 'passed'
      : 'failed';

    return {
      stepId: step.id,
      status: stepStatus,
      durationMs: performance.now() - stepStartTime,
      assertionResults,
      actualValue: actionResponse.actualValue,
      error: stepStatus === 'failed' && hardAssertionFailed
        ? { message: 'One or more assertions failed', type: 'AssertionFailure' }
        : stepStatus === 'failed' && !actionSucceeded
          ? actionResponse.error
          : undefined,
    };
  }

  // ── Runtime Healing ──────────────────────────────────────

  /**
   * Attempt runtime healing for a locator resolution failure.
   *
   * Flow:
   *   1. Extract live DOM context from the content script (EXTRACT_DOM_CONTEXT)
   *   2. Rank locators from the live DOM identity using rankLocatorCandidates
   *   3. Call healElementAndPersist() with the fresh locators
   *   4. Store healed locators in the override map for this run
   *
   * Returns true if healing succeeded and locators were updated.
   * Returns false if healing is not available, not needed, or failed.
   */
  private async attemptRuntimeHealing(
    tabId: number,
    step: IRStep,
    overrideMap: OverrideMap,
    _options?: IRExecutionOptions,
  ): Promise<boolean> {
    if (step.target.kind !== 'element') return false;

    const elementId = step.target.elementId;

    try {
      // 1. Extract live DOM context for the missing element
      const extractResponse = await this.sendTabMessage<{ identity: Partial<ElementIdentity> | null }>(
        tabId,
        {
          type: 'EXTRACT_DOM_CONTEXT',
          hint: { accessibleName: step.target.elementName },
        },
      );

      if (!extractResponse?.identity) return false;

      // 2. Rank locators from the live DOM identity
      const { extractCandidatesFromIdentity, rankLocatorCandidates } = await import(
        '../domain/locator-ranking'
      );
      const candidates = extractCandidatesFromIdentity(
        extractResponse.identity as ElementIdentity,
      );
      const ranked = rankLocatorCandidates(candidates);

      if (ranked.length === 0) return false;

      // 3. Call healElementAndPersist() via the Repository
      const { DexieUnitOfWorkFactory } = await import(
        '../repository/v2/dexie/dexie-unit-of-work-factory'
      );
      const { healElementAndPersist } = await import(
        '../repository/services/healing-service'
      );

      const uowFactory = new DexieUnitOfWorkFactory();
      const uow = uowFactory.create();
      const healed = await uow.execute(async (repos) => {
        return healElementAndPersist(
          {
            elementId,
            newStrategies: ranked,
          context: {
            sourceSessionId: `execution-${Date.now()}`,
            reason: 'Runtime locator resolution failure',
            proposedBy: 'runtime-healer',
          },
          },
          repos.elements,
        );
      });

      if (!healed) return false;

      // 4. Store healed locators in the override map
      const healedLocators: ResolvedLocator[] = healed.locatorStrategies.map((s) => ({
        type: s.type,
        value: s.value,
        priority: s.priority,
        confidence: s.confidence,
      }));
      overrideMap.set(elementId, healedLocators);

      return true;
    } catch (e) {
      console.warn('[IRExecutor] Runtime healing failed:', e);
      return false;
    }
  }

  // ── Page Load Wait ────────────────────────────────────────

  /**
   * Wait for the tab's page to finish loading.
   * Polls the tab status until 'complete' or timeout.
   */
  private async waitForPageLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
    const startTime = performance.now();
    while (performance.now() - startTime < timeoutMs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') return;
      } catch {
        return; // Tab may have closed
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}
