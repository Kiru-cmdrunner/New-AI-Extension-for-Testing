/**
 * Repository Domain Types — test case lifecycle and repository structure.
 *
 * Previously in shared/types.ts. Extracted for domain cohesion.
 * Re-exported through shared/types.ts for backward compatibility.
 */

import type { TestStep } from '../shared/types';
import type { SessionEvent } from '../shared/types';

/** Lifecycle states for a Test Case (Product Architecture PA7). */
export enum TestCaseState {
  DRAFT = 'draft',
  RECORDING = 'recording',
  RECORDED = 'recorded',
  GENERATING = 'generating',
  GENERATED = 'generated',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  SAVED = 'saved',
}

/**
 * Test Case Draft — created BEFORE recording begins.
 *
 * Product Foundation Design v1.0: A Test Case comes into existence
 * before recording. The user enters metadata, then starts recording
 * within that context.
 */
export interface TestCaseDraft {
  /** Unique ID for this test case. */
  id: string;
  /** Test Case Name (required). */
  name: string;
  /** Expected Result (optional — can be added during review). */
  expectedResult?: string;
  /** Project ID from the repository (or newly created). */
  projectId: string;
  /** Project name (denormalized for display). */
  projectName: string;
  /** Feature ID. */
  featureId: string;
  /** Feature name. */
  featureName: string;
  /** Scenario ID. */
  scenarioId: string;
  /** Scenario name. */
  scenarioName: string;
  /** Current lifecycle state. */
  status: TestCaseState;
  /** ISO timestamp when the TC was created. */
  createdAt: string;
}

/** A saved test case in the repository. Contains a deep copy of steps + events. */
export interface RepositoryTestCase {
  /** Unique ID, e.g. "tc-0001". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Deep copy of the test steps (immutable). */
  steps: TestStep[];
  /** Deep copy of the session events (for context). */
  events: SessionEvent[];
  /** ISO timestamp of when this test case was saved. */
  createdAt: string;
}

/** A scenario groups test cases within a feature. */
export interface Scenario {
  /** Unique ID, e.g. "scn-0001". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Test cases under this scenario. */
  testCases: RepositoryTestCase[];
}

/** A feature groups scenarios within a project. */
export interface Feature {
  /** Unique ID, e.g. "feat-0001". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Scenarios under this feature. */
  scenarios: Scenario[];
}

/** A project is the top-level container in the repository. */
export interface Project {
  /** Unique ID, e.g. "proj-0001". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Features under this project. */
  features: Feature[];
}

/** The complete test repository persisted to storage. */
export interface TestRepository {
  /** All projects. */
  projects: Project[];
}
