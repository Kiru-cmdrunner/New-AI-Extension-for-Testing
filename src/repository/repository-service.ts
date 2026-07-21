/**
 * Repository Service — CRUD operations for the test repository.
 *
 * Hierarchy: Project → Feature → Scenario → TestCase
 *
 * All operations persist to chrome.storage.local via StorageService.
 * The service generates unique IDs and maintains referential integrity
 * (deleting a parent removes all children).
 */
import { StorageService } from '../storage/storage-service';
import {
  Project,
  Feature,
  Scenario,
  RepositoryTestCase,
  TestRepository,
  TestStep,
  SessionEvent,
} from '../shared/types';

// ── ID Generation ──────────────────────────────────────────

/** Counters per ID prefix, so proj-0001 and feat-0001 are independent. */
const idCounters = new Map<string, number>();

function nextId(prefix: string): string {
  const current = idCounters.get(prefix) ?? 0;
  const next = current + 1;
  idCounters.set(prefix, next);
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

/** Reset all ID counters (for testing). */
export function resetIdCounter(): void {
  idCounters.clear();
}

// ── Repository CRUD ────────────────────────────────────────

export class RepositoryService {
  // ── Read ────────────────────────────────────────────────

  /** Get the full repository. */
  static async getRepository(): Promise<TestRepository> {
    return StorageService.getRepository();
  }

  /** Get all projects. */
  static async getProjects(): Promise<Project[]> {
    const repo = await this.getRepository();
    return repo.projects;
  }

  /** Get features for a project. */
  static async getFeatures(projectId: string): Promise<Feature[]> {
    const project = await this.findProject(projectId);
    return project?.features ?? [];
  }

  /** Get scenarios for a feature. */
  static async getScenarios(projectId: string, featureId: string): Promise<Scenario[]> {
    const feature = await this.findFeature(projectId, featureId);
    return feature?.scenarios ?? [];
  }

  /** Get test cases for a scenario. */
  static async getTestCases(
    projectId: string,
    featureId: string,
    scenarioId: string,
  ): Promise<RepositoryTestCase[]> {
    const scenario = await this.findScenario(projectId, featureId, scenarioId);
    return scenario?.testCases ?? [];
  }

  // ── Project CRUD ────────────────────────────────────────

  /** Create a new project. Returns the created project.
   * @throws if a project with the same name (case-insensitive, trimmed) already exists. */
  static async createProject(name: string): Promise<Project> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Project name cannot be empty.');

    const repo = await this.getRepository();
    const exists = repo.projects.some(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) throw new Error(`A project named "${trimmed}" already exists.`);

    const project: Project = {
      id: nextId('proj'),
      name: trimmed,
      features: [],
    };
    repo.projects.push(project);
    await StorageService.setRepository(repo);
    return project;
  }

  /** Rename a project. */
  static async renameProject(projectId: string, name: string): Promise<void> {
    const repo = await this.getRepository();
    const project = repo.projects.find((p) => p.id === projectId);
    if (project) {
      project.name = name;
      await StorageService.setRepository(repo);
    }
  }

  /** Delete a project and all its children. */
  static async deleteProject(projectId: string): Promise<void> {
    const repo = await this.getRepository();
    repo.projects = repo.projects.filter((p) => p.id !== projectId);
    await StorageService.setRepository(repo);
  }

  // ── Feature CRUD ────────────────────────────────────────

  /** Create a feature under a project.
   * @throws if the project doesn't exist.
   * @throws if a feature with the same name (case-insensitive, trimmed) already exists under this project. */
  static async createFeature(projectId: string, name: string): Promise<Feature> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Feature name cannot be empty.');

    const repo = await this.getRepository();
    const project = repo.projects.find((p) => p.id === projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const exists = project.features.some(
      (f) => f.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) throw new Error(`A feature named "${trimmed}" already exists in this project.`);

    const feature: Feature = {
      id: nextId('feat'),
      name: trimmed,
      scenarios: [],
    };
    project.features.push(feature);
    await StorageService.setRepository(repo);
    return feature;
  }

  /** Rename a feature. */
  static async renameFeature(
    projectId: string,
    featureId: string,
    name: string,
  ): Promise<void> {
    const repo = await this.getRepository();
    const feature = this.locateFeature(repo, projectId, featureId);
    if (feature) {
      feature.name = name;
      await StorageService.setRepository(repo);
    }
  }

  /** Delete a feature and all its scenarios + test cases. */
  static async deleteFeature(projectId: string, featureId: string): Promise<void> {
    const repo = await this.getRepository();
    const project = repo.projects.find((p) => p.id === projectId);
    if (project) {
      project.features = project.features.filter((f) => f.id !== featureId);
      await StorageService.setRepository(repo);
    }
  }

  // ── Scenario CRUD ───────────────────────────────────────

  /** Create a scenario under a feature.
   * @throws if the feature doesn't exist.
   * @throws if a scenario with the same name (case-insensitive, trimmed) already exists under this feature. */
  static async createScenario(
    projectId: string,
    featureId: string,
    name: string,
  ): Promise<Scenario> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Scenario name cannot be empty.');

    const repo = await this.getRepository();
    const feature = this.locateFeature(repo, projectId, featureId);
    if (!feature) throw new Error(`Feature not found: ${featureId}`);

    const exists = feature.scenarios.some(
      (s) => s.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) throw new Error(`A scenario named "${trimmed}" already exists in this feature.`);

    const scenario: Scenario = {
      id: nextId('scn'),
      name: trimmed,
      testCases: [],
    };
    feature.scenarios.push(scenario);
    await StorageService.setRepository(repo);
    return scenario;
  }

  /** Rename a scenario. */
  static async renameScenario(
    projectId: string,
    featureId: string,
    scenarioId: string,
    name: string,
  ): Promise<void> {
    const repo = await this.getRepository();
    const scenario = this.locateScenario(repo, projectId, featureId, scenarioId);
    if (scenario) {
      scenario.name = name;
      await StorageService.setRepository(repo);
    }
  }

  /** Delete a scenario and all its test cases. */
  static async deleteScenario(
    projectId: string,
    featureId: string,
    scenarioId: string,
  ): Promise<void> {
    const repo = await this.getRepository();
    const feature = this.locateFeature(repo, projectId, featureId);
    if (feature) {
      feature.scenarios = feature.scenarios.filter((s) => s.id !== scenarioId);
      await StorageService.setRepository(repo);
    }
  }

  // ── Test Case Save ──────────────────────────────────────

  /**
   * Save a recorded test case into the repository.
   * Makes a deep copy of steps and events — the original session is not modified.
   */
  static async saveTestCase(
    projectId: string,
    featureId: string,
    scenarioId: string,
    name: string,
    steps: TestStep[],
    events: SessionEvent[],
  ): Promise<RepositoryTestCase> {
    const repo = await this.getRepository();
    const scenario = this.locateScenario(repo, projectId, featureId, scenarioId);
    if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);

    const testCase: RepositoryTestCase = {
      id: nextId('tc'),
      name,
      steps: structuredClone(steps),
      events: structuredClone(events),
      createdAt: new Date().toISOString(),
    };
    scenario.testCases.push(testCase);
    await StorageService.setRepository(repo);
    return testCase;
  }

  /** Delete a test case. */
  static async deleteTestCase(
    projectId: string,
    featureId: string,
    scenarioId: string,
    testCaseId: string,
  ): Promise<void> {
    const repo = await this.getRepository();
    const scenario = this.locateScenario(repo, projectId, featureId, scenarioId);
    if (scenario) {
      scenario.testCases = scenario.testCases.filter((tc) => tc.id !== testCaseId);
      await StorageService.setRepository(repo);
    }
  }

  // ── Search ──────────────────────────────────────────────

  /**
   * Search the repository by text. Matches project, feature, scenario,
   * or test case names (case-insensitive).
   *
   * @returns A filtered repository containing only matching branches.
   */
  static async search(query: string): Promise<TestRepository> {
    const repo = await this.getRepository();
    if (!query.trim()) return repo;

    const lower = query.toLowerCase();

    const matchedProjects: Project[] = [];

    for (const project of repo.projects) {
      const projectMatches = project.name.toLowerCase().includes(lower);
      const matchedFeatures: Feature[] = [];

      for (const feature of project.features) {
        const featureMatches = feature.name.toLowerCase().includes(lower);
        const matchedScenarios: Scenario[] = [];

        for (const scenario of feature.scenarios) {
          const scenarioMatches = scenario.name.toLowerCase().includes(lower);
          const matchedTestCases = scenario.testCases.filter(
            (tc) => tc.name.toLowerCase().includes(lower),
          );

          if (scenarioMatches || matchedTestCases.length > 0) {
            matchedScenarios.push({
              ...scenario,
              testCases: scenarioMatches ? scenario.testCases : matchedTestCases,
            });
          }
        }

        if (featureMatches || matchedScenarios.length > 0) {
          matchedFeatures.push({
            ...feature,
            scenarios: featureMatches ? feature.scenarios : matchedScenarios,
          });
        }
      }

      if (projectMatches || matchedFeatures.length > 0) {
        matchedProjects.push({
          ...project,
          features: projectMatches ? project.features : matchedFeatures,
        });
      }
    }

    return { projects: matchedProjects };
  }

  // ── Internal locators (operate on in-memory repo) ───────

  private static async findProject(projectId: string): Promise<Project | undefined> {
    const repo = await this.getRepository();
    return repo.projects.find((p) => p.id === projectId);
  }

  private static async findFeature(
    projectId: string,
    featureId: string,
  ): Promise<Feature | undefined> {
    const project = await this.findProject(projectId);
    return project?.features.find((f) => f.id === featureId);
  }

  private static async findScenario(
    projectId: string,
    featureId: string,
    scenarioId: string,
  ): Promise<Scenario | undefined> {
    const feature = await this.findFeature(projectId, featureId);
    return feature?.scenarios.find((s) => s.id === scenarioId);
  }

  private static locateFeature(
    repo: TestRepository,
    projectId: string,
    featureId: string,
  ): Feature | undefined {
    return repo.projects
      .find((p) => p.id === projectId)
      ?.features.find((f) => f.id === featureId);
  }

  private static locateScenario(
    repo: TestRepository,
    projectId: string,
    featureId: string,
    scenarioId: string,
  ): Scenario | undefined {
    return this.locateFeature(repo, projectId, featureId)
      ?.scenarios.find((s) => s.id === scenarioId);
  }
}
