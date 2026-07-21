/**
 * E2E Workflow Validation — full CmdRunner lifecycle through the repository layer.
 *
 * This test validates that the repository + domain model can represent the complete
 * CmdRunner workflow without information loss:
 *
 *   1. Create Project (tenancy root)
 *   2. Simulate a recording → Create Source Artifact (Interaction Timeline)
 *   3. Simulate AI Workflow Review → extract logical Elements
 *   4. Generate an Approved Test Case (ATC) with Version 1 referencing those Elements
 *   5. Persist everything through the repository layer (via Unit of Work)
 *   6. Approve the ATC (status transition + version approval)
 *   7. Simulate a "reload" — new DB connection, same database name
 *   8. Verify the reconstructed ATC (metadata, steps, validations, element references,
 *      provenance, AI metadata, approval state) is deep-equal to the original.
 *
 * The objective is NOT to test the UI or the AI — it's to verify the repository
 * and domain model preserve the complete business intent without losing information
 * or violating any invariants.
 */
import { describe, it, expect, afterAll } from 'vitest';
import 'fake-indexeddb/auto';
import { DexieUnitOfWorkFactory } from '../../src/repository/v2/dexie/dexie-unit-of-work-factory';
import {
  StepAction,
  LocatorStrategyType,
  SourceArtifactType,
  TestCaseStatus,
  TestCasePriority,
  ValidationType,
  ValidationComparison,
  ValidationSeverity,
} from '../../src/domain/enums';
import type { ApprovedTestCase, TestCaseVersion, Step } from '../../src/domain/entities/approved-test-case';
import type { Element } from '../../src/domain/entities/element';
import type { SourceArtifact } from '../../src/domain/entities/source-artifact';
import type { Project } from '../../src/domain/entities/project';

describe('E2E Workflow Validation: Record → AI Review → ATC → Persist → Reload → Verify', () => {
  // ── Session 1: record + persist ─────────────────────────
  let factory1: DexieUnitOfWorkFactory;

  // ── Session 2: reload ────────────────────────────────────
  let factory2: DexieUnitOfWorkFactory;

  // Captured originals (post-approval, the "approved" state)
  let approvedProject: Project;
  let approvedSourceArtifact: SourceArtifact;
  let approvedElements: Element[];
  let approvedTestCase: ApprovedTestCase;
  let approvedVersion: TestCaseVersion;

  afterAll(async () => {
    // Clean up whichever factory still has an open connection.
    try {
      if (factory2) await factory2.getDatabase().delete();
    } catch { /* already deleted */ }
  });

  // Helper: deep-compare with diagnostic output
  function assertDeepEqual<T>(actual: T, expected: T, label: string): void {
    expect(actual, `${label} should survive round-trip`).toEqual(expected);
  }

  it('executes the full workflow and survives a reload without information loss', async () => {
    // ════════════════════════════════════════════════════════════════
    // PHASE 1: CREATE PROJECT
    // ════════════════════════════════════════════════════════════════

    factory1 = new DexieUnitOfWorkFactory();

    const projectId = await factory1.create().execute(async (repos) => {
      const project = await repos.projects.create({
        name: 'E-Commerce Platform',
        description: 'End-to-end checkout and account management flows',
        tags: ['e-commerce', 'checkout', 'critical-path'],
        createdBy: 'qa-lead@cmdrunner.dev',
      });
      return project.id;
    });

    // ════════════════════════════════════════════════════════════════
    // PHASE 2: SIMULATE RECORDING → CREATE SOURCE ARTIFACT
    // ════════════════════════════════════════════════════════════════

    // Simulate raw recorder output — a login + checkout flow.
    // This is what the Chrome Extension recorder would produce.
    const rawSessionEvents = [
      {
        type: 'navigation',
        timestamp: 1700000000000,
        url: 'https://shop.example.com/login',
      },
      {
        type: 'click',
        timestamp: 1700000002000,
        target: { role: 'textbox', accessibleName: 'Email Address', css: '#email-input' },
      },
      {
        type: 'input',
        timestamp: 1700000003000,
        target: { role: 'textbox', accessibleName: 'Email Address', css: '#email-input' },
        value: 'john.doe@example.com',
      },
      {
        type: 'click',
        timestamp: 1700000004000,
        target: { role: 'textbox', accessibleName: 'Password', css: '#password-input' },
      },
      {
        type: 'input',
        timestamp: 1700000005000,
        target: { role: 'textbox', accessibleName: 'Password', css: '#password-input' },
        value: 'secret123!',
      },
      {
        type: 'click',
        timestamp: 1700000006000,
        target: { role: 'button', accessibleName: 'Sign In', css: '.login-btn' },
      },
      {
        type: 'navigation',
        timestamp: 1700000007000,
        url: 'https://shop.example.com/products/widget-42',
      },
      {
        type: 'click',
        timestamp: 1700000008000,
        target: { role: 'button', accessibleName: 'Add to Cart', css: '.add-to-cart' },
      },
      {
        type: 'click',
        timestamp: 1700000009000,
        target: { role: 'button', accessibleName: 'Checkout', css: '.checkout-btn' },
      },
      {
        type: 'input',
        timestamp: 1700000010000,
        target: { role: 'textbox', accessibleName: 'Shipping Address', css: '#shipping-addr' },
        value: '123 Main St, Springfield',
      },
      {
        type: 'click',
        timestamp: 1700000011000,
        target: { role: 'button', accessibleName: 'Place Order', css: '.place-order' },
      },
      {
        type: 'navigation',
        timestamp: 1700000012000,
        url: 'https://shop.example.com/order/confirmation',
      },
    ];

    const sourceArtifactId = await factory1.create().execute(async (repos) => {
      const sa = await repos.sourceArtifacts.create({
        projectId,
        type: SourceArtifactType.INTERACTION_TIMELINE,
        content: {
          sessionEvents: rawSessionEvents,
          recordingMetadata: {
            browser: 'Chrome 127.0.6533.88',
            viewport: { width: 1440, height: 900 },
            duration: 12000,
            url: 'https://shop.example.com/login',
          },
        },
        metadata: {
          captureMethod: 'chrome_extension_recorder',
          rawEvidenceAvailable: true,
          sourceSystem: 'cmdrunner-extension@10.4.18',
        },
        createdBy: 'qa-engineer@cmdrunner.dev',
      });
      return sa.id;
    });

    // ════════════════════════════════════════════════════════════════
    // PHASE 3-5: SIMULATE AI WORKFLOW REVIEW
    // Create Elements + ATC (with Version 1) ATOMICALLY via UnitOfWork.
    // This is the critical cross-repository operation.
    // ════════════════════════════════════════════════════════════════

    const { elementIds, testCaseId } = await factory1.create().execute(async (repos) => {
      // ── AI extracts logical elements from the recording ──

      const emailInput = await repos.elements.create({
        projectId,
        logicalName: 'Email Address Input',
        description: 'Email address field on the login form',
        pageOrComponent: 'LoginPage',
        locatorStrategies: [
          { type: LocatorStrategyType.ROLE, value: 'textbox[name="Email Address"]', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.TEST_ID, value: 'email-input', priority: 2, confidence: 0.9 },
          { type: LocatorStrategyType.CSS, value: '#email-input', priority: 3, confidence: 0.85 },
        ],
      });

      const passwordInput = await repos.elements.create({
        projectId,
        logicalName: 'Password Input',
        description: 'Password field on the login form',
        pageOrComponent: 'LoginPage',
        locatorStrategies: [
          { type: LocatorStrategyType.ROLE, value: 'textbox[name="Password"]', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.TEST_ID, value: 'password-input', priority: 2, confidence: 0.9 },
          { type: LocatorStrategyType.CSS, value: '#password-input', priority: 3, confidence: 0.85 },
        ],
      });

      const signInButton = await repos.elements.create({
        projectId,
        logicalName: 'Sign In Button',
        description: 'Primary login submit button',
        pageOrComponent: 'LoginPage',
        locatorStrategies: [
          { type: LocatorStrategyType.ROLE, value: 'button[name="Sign In"]', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.CSS, value: '.login-btn', priority: 2, confidence: 0.8 },
        ],
      });

      const addToCartButton = await repos.elements.create({
        projectId,
        logicalName: 'Add to Cart Button',
        description: 'Product page add-to-cart action',
        pageOrComponent: 'ProductDetailPage',
        locatorStrategies: [
          { type: LocatorStrategyType.ROLE, value: 'button[name="Add to Cart"]', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.CSS, value: '.add-to-cart', priority: 2, confidence: 0.8 },
        ],
      });

      const checkoutButton = await repos.elements.create({
        projectId,
        logicalName: 'Checkout Button',
        description: 'Proceed to checkout from cart',
        pageOrComponent: 'CartPage',
        locatorStrategies: [
          { type: LocatorStrategyType.ROLE, value: 'button[name="Checkout"]', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.CSS, value: '.checkout-btn', priority: 2, confidence: 0.8 },
        ],
      });

      const shippingAddressInput = await repos.elements.create({
        projectId,
        logicalName: 'Shipping Address Input',
        description: 'Shipping address field on checkout form',
        pageOrComponent: 'CheckoutPage',
        locatorStrategies: [
          { type: LocatorStrategyType.ROLE, value: 'textbox[name="Shipping Address"]', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.TEST_ID, value: 'shipping-addr', priority: 2, confidence: 0.9 },
          { type: LocatorStrategyType.CSS, value: '#shipping-addr', priority: 3, confidence: 0.85 },
        ],
      });

      const placeOrderButton = await repos.elements.create({
        projectId,
        logicalName: 'Place Order Button',
        description: 'Submit order on checkout page',
        pageOrComponent: 'CheckoutPage',
        locatorStrategies: [
          { type: LocatorStrategyType.ROLE, value: 'button[name="Place Order"]', priority: 1, confidence: 0.95 },
          { type: LocatorStrategyType.CSS, value: '.place-order', priority: 2, confidence: 0.8 },
        ],
      });

      // ── AI generates the Approved Test Case from the recording ──
      // Steps reference elements by stable ID (INV-ATCV4), NOT by selectors.

      const { testCase } = await repos.testCases.create({
        projectId,
        title: 'Login and Complete Checkout',
        description: 'User logs in, adds a product to cart, and completes checkout',
        tags: ['smoke', 'checkout', 'critical-path'],
        priority: TestCasePriority.CRITICAL,
        createdBy: 'ai-review@cmdrunner.dev',
        sourceArtifactIds: [sourceArtifactId],
        aiMetadata: {
          confidence: 0.88,
          reasoning: 'Extracted 7-step login+checkout flow from interaction timeline. High confidence due to clear role-based targets and standard e-commerce pattern.',
          modelVersion: 'cmdrunner-ai-v2.1',
          interpretationTimestamp: '2026-07-20T14:30:00.000Z',
        },
        changeSummary: 'Initial AI-generated version from recording session',
        steps: [
          {
            order: 0,
            action: StepAction.NAVIGATE,
            description: 'Navigate to the login page',
            // navigate doesn't require elementId
          },
          {
            order: 1,
            action: StepAction.FILL,
            description: 'Enter email address',
            elementId: emailInput.id,
            input: 'john.doe@example.com',
          },
          {
            order: 2,
            action: StepAction.FILL,
            description: 'Enter password',
            elementId: passwordInput.id,
            input: 'secret123!',
          },
          {
            order: 3,
            action: StepAction.CLICK,
            description: 'Click the Sign In button',
            elementId: signInButton.id,
          },
          {
            order: 4,
            action: StepAction.CLICK,
            description: 'Click Add to Cart on the product page',
            elementId: addToCartButton.id,
          },
          {
            order: 5,
            action: StepAction.CLICK,
            description: 'Click Checkout to proceed',
            elementId: checkoutButton.id,
          },
          {
            order: 6,
            action: StepAction.FILL,
            description: 'Enter shipping address',
            elementId: shippingAddressInput.id,
            input: '123 Main St, Springfield',
          },
          {
            order: 7,
            action: StepAction.CLICK,
            description: 'Click Place Order to complete checkout',
            elementId: placeOrderButton.id,
            validations: [
              {
                type: ValidationType.URL_MATCH,
                comparison: ValidationComparison.CONTAINS,
                expectedValue: '/order/confirmation',
                severity: ValidationSeverity.HARD,
                property: 'url',
              },
            ],
          },
        ],
      });

      return {
        elementIds: [
          emailInput.id,
          passwordInput.id,
          signInButton.id,
          addToCartButton.id,
          checkoutButton.id,
          shippingAddressInput.id,
          placeOrderButton.id,
        ],
        testCaseId: testCase.id,
      };
    });

    // ════════════════════════════════════════════════════════════════
    // PHASE 6: REVIEW → APPROVE THE ATC
    // ════════════════════════════════════════════════════════════════

    // Transition: DRAFT → IN_REVIEW
    await factory1.create().execute(async (repos) => {
      await repos.testCases.transitionStatus(testCaseId, TestCaseStatus.IN_REVIEW);
    });

    // Transition: IN_REVIEW → APPROVED (also marks version as approved)
    await factory1.create().execute(async (repos) => {
      await repos.testCases.approve(testCaseId, 'qa-lead@cmdrunner.dev');
    });

    // ════════════════════════════════════════════════════════════════
    // CAPTURE THE APPROVED STATE (post all mutations)
    // ════════════════════════════════════════════════════════════════

    approvedProject = (await factory1.create().execute(async (repos) => {
      return repos.projects.getById(projectId);
    }))!;

    approvedSourceArtifact = (await factory1.create().execute(async (repos) => {
      return repos.sourceArtifacts.getById(sourceArtifactId);
    }))!;

    approvedElements = await factory1.create().execute(async (repos) => {
      return repos.elements.getByProject(projectId);
    });

    const capturedATC = await factory1.create().execute(async (repos) => {
      const tc = await repos.testCases.getById(testCaseId);
      const version = await repos.testCases.getCurrentVersion(testCaseId);
      return { tc: tc!, version: version! };
    });

    approvedTestCase = capturedATC.tc;
    approvedVersion = capturedATC.version;

    // ════════════════════════════════════════════════════════════════
    // PHASE 7: SIMULATE RELOAD
    // Close the first DB connection, open a fresh one to the same DB.
    // This simulates the user closing the extension and reopening it.
    // ════════════════════════════════════════════════════════════════

    factory1.getDatabase().close();
    factory2 = new DexieUnitOfWorkFactory();

    // ════════════════════════════════════════════════════════════════
    // PHASE 8: VERIFY IDENTITY — reload everything and deep-compare
    // ════════════════════════════════════════════════════════════════

    // ── 8a: Project ──
    const reloadedProject = await factory2.create().execute(async (repos) => {
      return repos.projects.getById(projectId);
    });

    assertDeepEqual(reloadedProject, approvedProject, 'Project');

    // ── 8b: Source Artifact (immutable, should be byte-identical) ──
    const reloadedSourceArtifact = await factory2.create().execute(async (repos) => {
      return repos.sourceArtifacts.getById(sourceArtifactId);
    });

    assertDeepEqual(reloadedSourceArtifact, approvedSourceArtifact, 'Source Artifact');

    // Verify the raw interaction timeline survived intact
    const reloadedContent = reloadedSourceArtifact!.content as { sessionEvents: unknown[] };
    expect(reloadedContent.sessionEvents, 'Raw session events should survive round-trip').toHaveLength(rawSessionEvents.length);
    expect(reloadedContent.sessionEvents[0], 'First session event should be the navigation event').toMatchObject({ url: 'https://shop.example.com/login' });

    // ── 8c: Element Repository (all 7 elements) ──
    const reloadedElements = await factory2.create().execute(async (repos) => {
      return repos.elements.getByProject(projectId);
    });

    expect(reloadedElements, 'Should reload all 7 elements').toHaveLength(7);
    // Deep-compare each element (sorted by logicalName for deterministic comparison)
    const sortByLogicalName = (a: Element, b: Element) => a.logicalName.localeCompare(b.logicalName);
    const expectedSorted = [...approvedElements].sort(sortByLogicalName);
    const actualSorted = [...reloadedElements].sort(sortByLogicalName);
    for (let i = 0; i < expectedSorted.length; i++) {
      assertDeepEqual(actualSorted[i], expectedSorted[i], `Element[${i}] "${expectedSorted[i].logicalName}"`);
    }

    // Verify locator strategies survived with correct ordering and confidence
    const emailEl = reloadedElements.find(e => e.logicalName === 'Email Address Input')!;
    expect(emailEl.locatorStrategies, 'Email element should have 3 locator strategies').toHaveLength(3);
    expect(emailEl.locatorStrategies[0].type, 'First strategy should be role-based').toBe(LocatorStrategyType.ROLE);
    expect(emailEl.locatorStrategies[0].priority, 'First strategy priority should be 1').toBe(1);
    expect(emailEl.locatorStrategies[0].confidence, 'First strategy confidence should be 0.95').toBe(0.95);

    // ── 8d: Approved Test Case (identity + metadata) ──
    const reloadedTestCase = await factory2.create().execute(async (repos) => {
      return repos.testCases.getById(testCaseId);
    });

    assertDeepEqual(reloadedTestCase, approvedTestCase, 'Approved Test Case');

    // Verify the critical metadata survived
    expect(reloadedTestCase!.status, 'Status should be APPROVED after reload').toBe(TestCaseStatus.APPROVED);
    expect(reloadedTestCase!.priority, 'Priority should be CRITICAL').toBe(TestCasePriority.CRITICAL);
    expect(reloadedTestCase!.tags, 'Tags should survive').toEqual(['smoke', 'checkout', 'critical-path']);

    // ── 8e: Current Version (steps + validations + provenance) ──
    const reloadedVersion = await factory2.create().execute(async (repos) => {
      return repos.testCases.getCurrentVersion(testCaseId);
    });

    assertDeepEqual(reloadedVersion, approvedVersion, 'TestCaseVersion (with all steps & validations)');

    // Deep-verify the steps (the core of business intent)
    const steps = reloadedVersion!.steps;
    expect(steps, 'Should have 8 steps').toHaveLength(8);

    // Step 0: Navigate (no elementId required)
    expect(steps[0].action, 'Step 0 action').toBe(StepAction.NAVIGATE);
    expect(steps[0].elementId, 'Step 0 elementId should be null for navigate').toBeNull();
    expect(steps[0].description, 'Step 0 description').toBe('Navigate to the login page');

    // Step 1: Fill email
    expect(steps[1].action, 'Step 1 action').toBe(StepAction.FILL);
    expect(steps[1].input, 'Step 1 input value').toBe('john.doe@example.com');
    expect(steps[1].elementId, 'Step 1 elementId should reference email element').toBe(elementIds[0]);

    // Step 7: Click Place Order (with validation)
    expect(steps[7].action, 'Step 7 action').toBe(StepAction.CLICK);
    expect(steps[7].elementId, 'Step 7 elementId').toBe(elementIds[6]);
    expect(steps[7].validations, 'Step 7 should have 1 validation').toHaveLength(1);
    expect(steps[7].validations[0].type, 'Step 7 validation type').toBe(ValidationType.URL_MATCH);
    expect(steps[7].validations[0].comparison, 'Step 7 validation comparison').toBe(ValidationComparison.CONTAINS);
    expect(steps[7].validations[0].expectedValue, 'Step 7 validation expectedValue').toBe('/order/confirmation');
    expect(steps[7].validations[0].severity, 'Step 7 validation severity').toBe(ValidationSeverity.HARD);

    // ── 8f: Provenance (source artifact link) ──
    expect(reloadedVersion!.sourceArtifactIds, 'Version should link to source artifact').toContain(sourceArtifactId);

    // ── 8g: AI Metadata ──
    expect(reloadedVersion!.aiMetadata, 'AI metadata should survive').not.toBeNull();
    expect(reloadedVersion!.aiMetadata!.confidence, 'AI confidence').toBe(0.88);
    expect(reloadedVersion!.aiMetadata!.modelVersion, 'AI model version').toBe('cmdrunner-ai-v2.1');
    expect(reloadedVersion!.aiMetadata!.reasoning, 'AI reasoning').toContain('7-step');

    // ── 8h: Approval state ──
    expect(reloadedVersion!.approvedBy, 'Approved by should survive').toBe('qa-lead@cmdrunner.dev');
    expect(reloadedVersion!.approvedAt, 'Approved at should be a valid ISO string').toBeTruthy();

    // ── 8i: Version history ──
    const allVersions = await factory2.create().execute(async (repos) => {
      return repos.testCases.listVersions(testCaseId);
    });

    expect(allVersions, 'Should have exactly 1 version').toHaveLength(1);
    expect(allVersions[0].versionNumber, 'Version 1 number').toBe(1);
    expect(allVersions[0].parentVersionId, 'Version 1 parent should be null').toBeNull();

    // ════════════════════════════════════════════════════════════════
    // PHASE 8j: INVARIANT CHECKS — verify invariants hold after reload
    // ════════════════════════════════════════════════════════════════

    // INV-ATC1: currentVersionId points to an existing version
    const currentVersion = allVersions.find(v => v.id === reloadedTestCase!.currentVersionId);
    expect(currentVersion, 'INV-ATC1: currentVersionId must resolve to a real version').toBeDefined();

    // INV-ATCV3: Every step.elementId must resolve to an existing Element
    const elementIdSet = new Set(reloadedElements.map(e => e.id));
    for (const step of reloadedVersion!.steps) {
      if (step.elementId !== null) {
        expect(
          elementIdSet.has(step.elementId),
          `INV-ATCV3: Step "${step.description}" references elementId ${step.elementId} which must exist`,
        ).toBe(true);
      }
    }

    // INV-ATCV4: Steps reference elements by stable ID, never by selector
    for (const step of reloadedVersion!.steps) {
      if (step.elementId !== null) {
        expect(
          typeof step.elementId === 'string' && step.elementId.length === 36,
          `INV-ATCV4: Step elementId must be a UUID (stable ID), got: ${step.elementId}`,
        ).toBe(true);
      }
    }

    // INV-EL4: Every element has at least one locator strategy
    for (const el of reloadedElements) {
      expect(
        el.locatorStrategies.length >= 1,
        `INV-EL4: Element "${el.logicalName}" must have ≥1 locator strategy`,
      ).toBe(true);
    }

    // INV-SA1: Source artifact is immutable (createdAt should match exactly)
    expect(reloadedSourceArtifact!.createdAt, 'INV-SA1: Source artifact createdAt must not change').toBe(approvedSourceArtifact.createdAt);

    // ════════════════════════════════════════════════════════════════
    // PHASE 8k: INV-EL3 — element deletion blocked when referenced
    // ════════════════════════════════════════════════════════════════

    const referencedElement = reloadedElements[0];
    await expect(
      factory2.create().execute(async (repos) => {
        await repos.elements.delete(referencedElement.id);
      }),
      'INV-EL3: Deleting a referenced element should throw',
    ).rejects.toThrow();

    // ════════════════════════════════════════════════════════════════
    // SUMMARY ASSERTION: the approved version is the final authority
    // ════════════════════════════════════════════════════════════════

    // The reloaded version IS the approved version — no information was lost.
    // This proves the repository layer correctly represents the complete workflow.
    assertDeepEqual(reloadedVersion, approvedVersion, 'Final: reloaded version deep-equals original approved version');
  });
});
