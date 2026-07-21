import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { RepositoryService, resetIdCounter } from '../src/repository/repository-service';
import { StorageKeys, type TestStep, type SessionEvent } from '../src/shared/types';

const SAMPLE_STEP: TestStep = {
  stepId: 'step-0001',
  plainEnglish: 'Click the Login button',
  actionId: 'act-0001',
  elementId: 'el-abc123',
  executionJson: {
    action: 'click',
    actionId: 'act-0001',
    elementId: 'el-abc123',
    primaryLocator: { type: 'css', value: 'button.login' },
    fallbackLocators: [],
    tag: 'BUTTON',
    accessibleName: 'Login',
    ariaRole: 'button',
    inIframe: false,
    shadowDom: false,
  },
  aiConfidence: 0.95,
  timestamp: '2026-07-11T00:00:00Z',
};

const SAMPLE_EVENT: SessionEvent = {
  actionId: 'act-0001',
  type: 'click',
  timestamp: '2026-07-11T00:00:00Z',
  elementIdentity: {
    accessibleName: 'Login',
    ariaRole: 'button',
    ariaLabel: '',
    tag: 'BUTTON',
    name: '',
    stableId: '',
    testId: '',
    dataCy: '',
    dataQa: '',
    className: null,
    cssSelector: 'button.login',
    xPath: '//button',
    inIframe: false,
    shadowDom: false,
  },
} as SessionEvent;

describe('RepositoryService', () => {
  beforeEach(() => {
    setupChromeMock();
    resetIdCounter();
  });

  // ── Project CRUD ────────────────────────────────────────

  describe('Project CRUD', () => {
    it('creates a project with a unique ID', async () => {
      const project = await RepositoryService.createProject('CmdRunner Demo');
      expect(project.id).toBe('proj-0001');
      expect(project.name).toBe('CmdRunner Demo');
      expect(project.features).toEqual([]);
    });

    it('lists created projects', async () => {
      await RepositoryService.createProject('Project A');
      await RepositoryService.createProject('Project B');
      const projects = await RepositoryService.getProjects();
      expect(projects.length).toBe(2);
      expect(projects[0].name).toBe('Project A');
      expect(projects[1].name).toBe('Project B');
    });

    it('renames a project', async () => {
      const project = await RepositoryService.createProject('Old Name');
      await RepositoryService.renameProject(project.id, 'New Name');
      const projects = await RepositoryService.getProjects();
      expect(projects[0].name).toBe('New Name');
    });

    it('deletes a project and all its children', async () => {
      const project = await RepositoryService.createProject('To Delete');
      await RepositoryService.createFeature(project.id, 'Feature 1');
      const projects = await RepositoryService.getProjects();
      expect(projects.length).toBe(1);

      await RepositoryService.deleteProject(project.id);
      const after = await RepositoryService.getProjects();
      expect(after.length).toBe(0);
    });
  });

  // ── Feature CRUD ────────────────────────────────────────

  describe('Feature CRUD', () => {
    it('creates a feature under a project', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'Flight Booking');
      expect(feature.id).toBe('feat-0001');
      expect(feature.name).toBe('Flight Booking');
      expect(feature.scenarios).toEqual([]);

      const features = await RepositoryService.getFeatures(project.id);
      expect(features.length).toBe(1);
    });

    it('throws when creating a feature under a non-existent project', async () => {
      await expect(RepositoryService.createFeature('nonexistent', 'F1'))
        .rejects.toThrow('Project not found');
    });

    it('renames a feature', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'Old');
      await RepositoryService.renameFeature(project.id, feature.id, 'New Name');
      const features = await RepositoryService.getFeatures(project.id);
      expect(features[0].name).toBe('New Name');
    });

    it('deletes a feature and its children', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      await RepositoryService.createScenario(project.id, feature.id, 'S1');

      await RepositoryService.deleteFeature(project.id, feature.id);
      const features = await RepositoryService.getFeatures(project.id);
      expect(features.length).toBe(0);
    });
  });

  // ── Scenario CRUD ───────────────────────────────────────

  describe('Scenario CRUD', () => {
    it('creates a scenario under a feature', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, 'One Way Booking');
      expect(scenario.id).toBe('scn-0001');
      expect(scenario.name).toBe('One Way Booking');
      expect(scenario.testCases).toEqual([]);
    });

    it('renames a scenario', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, 'Old');
      await RepositoryService.renameScenario(project.id, feature.id, scenario.id, 'New');
      const scenarios = await RepositoryService.getScenarios(project.id, feature.id);
      expect(scenarios[0].name).toBe('New');
    });

    it('deletes a scenario and its test cases', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, 'S1');
      await RepositoryService.saveTestCase(project.id, feature.id, scenario.id, 'TC1', [SAMPLE_STEP], [SAMPLE_EVENT]);

      await RepositoryService.deleteScenario(project.id, feature.id, scenario.id);
      const scenarios = await RepositoryService.getScenarios(project.id, feature.id);
      expect(scenarios.length).toBe(0);
    });
  });

  // ── Test Case Save ──────────────────────────────────────

  describe('Save Test Case', () => {
    it('saves a test case with steps and events', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, 'S1');

      const tc = await RepositoryService.saveTestCase(
        project.id, feature.id, scenario.id,
        'Verify user can book a one-way flight',
        [SAMPLE_STEP], [SAMPLE_EVENT],
      );

      expect(tc.id).toBe('tc-0001');
      expect(tc.name).toBe('Verify user can book a one-way flight');
      expect(tc.steps).toHaveLength(1);
      expect(tc.events).toHaveLength(1);
      expect(tc.createdAt).toBeDefined();
    });

    it('makes a deep copy of steps — original is not modified', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, 'S1');

      const originalSteps: TestStep[] = [
        { ...SAMPLE_STEP, stepId: 'step-orig' },
      ];

      await RepositoryService.saveTestCase(project.id, feature.id, scenario.id, 'TC1', originalSteps, []);

      // Mutate the original
      originalSteps[0].plainEnglish = 'CHANGED';

      // Repository copy should be unaffected
      const testCases = await RepositoryService.getTestCases(project.id, feature.id, scenario.id);
      expect(testCases[0].steps[0].plainEnglish).toBe('Click the Login button');
    });

    it('preserves execution JSON exactly', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, 'S1');

      await RepositoryService.saveTestCase(
        project.id, feature.id, scenario.id, 'TC1',
        [SAMPLE_STEP], [SAMPLE_EVENT],
      );

      const testCases = await RepositoryService.getTestCases(project.id, feature.id, scenario.id);
      expect(testCases[0].steps[0].executionJson).toEqual(SAMPLE_STEP.executionJson);
    });

    it('test cases appear under the correct scenario', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario1 = await RepositoryService.createScenario(project.id, feature.id, 'Scenario 1');
      const scenario2 = await RepositoryService.createScenario(project.id, feature.id, 'Scenario 2');

      await RepositoryService.saveTestCase(project.id, feature.id, scenario1.id, 'TC-A', [SAMPLE_STEP], []);
      await RepositoryService.saveTestCase(project.id, feature.id, scenario2.id, 'TC-B', [SAMPLE_STEP], []);

      const tc1 = await RepositoryService.getTestCases(project.id, feature.id, scenario1.id);
      const tc2 = await RepositoryService.getTestCases(project.id, feature.id, scenario2.id);
      expect(tc1[0].name).toBe('TC-A');
      expect(tc2[0].name).toBe('TC-B');
    });

    it('deletes a test case', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, 'S1');
      const tc = await RepositoryService.saveTestCase(project.id, feature.id, scenario.id, 'TC1', [SAMPLE_STEP], []);

      await RepositoryService.deleteTestCase(project.id, feature.id, scenario.id, tc.id);
      const testCases = await RepositoryService.getTestCases(project.id, feature.id, scenario.id);
      expect(testCases.length).toBe(0);
    });
  });

  // ── Search ─────────────────────────────────────────────

  describe('Search', () => {
    beforeEach(async () => {
      const project = await RepositoryService.createProject('CmdRunner Demo');
      const feature = await RepositoryService.createFeature(project.id, 'Flight Booking');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, 'One Way Booking');
      await RepositoryService.saveTestCase(project.id, feature.id, scenario.id, 'Verify one-way flight booking', [SAMPLE_STEP], []);

      const project2 = await RepositoryService.createProject('HR Portal');
      const feature2 = await RepositoryService.createFeature(project2.id, 'Employee Management');
      const scenario2 = await RepositoryService.createScenario(project2.id, feature2.id, 'Add Employee');
      await RepositoryService.saveTestCase(project2.id, feature2.id, scenario2.id, 'Add new employee to system', [SAMPLE_STEP], []);
    });

    it('returns everything when query is empty', async () => {
      const repo = await RepositoryService.search('');
      expect(repo.projects.length).toBe(2);
    });

    it('searches by project name', async () => {
      const repo = await RepositoryService.search('CmdRunner');
      expect(repo.projects.length).toBe(1);
      expect(repo.projects[0].name).toBe('CmdRunner Demo');
    });

    it('searches by feature name', async () => {
      const repo = await RepositoryService.search('Flight');
      expect(repo.projects.length).toBe(1);
      expect(repo.projects[0].features[0].name).toBe('Flight Booking');
    });

    it('searches by scenario name', async () => {
      const repo = await RepositoryService.search('One Way');
      expect(repo.projects.length).toBe(1);
      expect(repo.projects[0].features[0].scenarios[0].name).toBe('One Way Booking');
    });

    it('searches by test case name', async () => {
      const repo = await RepositoryService.search('employee');
      expect(repo.projects.length).toBe(1);
      expect(repo.projects[0].name).toBe('HR Portal');
      expect(repo.projects[0].features[0].scenarios[0].testCases[0].name).toContain('employee');
    });

    it('search is case-insensitive', async () => {
      const repo = await RepositoryService.search('FLIGHT BOOKING');
      expect(repo.projects.length).toBe(1);
    });

    it('returns empty when no match', async () => {
      const repo = await RepositoryService.search('nonexistent thing');
      expect(repo.projects.length).toBe(0);
    });
  });

  // ── Persistence ─────────────────────────────────────────

  describe('Persistence', () => {
    it('repository persists across reads', async () => {
      await RepositoryService.createProject('Persistent Project');
      const repo = await RepositoryService.getRepository();
      expect(repo.projects.length).toBe(1);
      expect(repo.projects[0].name).toBe('Persistent Project');

      // Second read should return same data
      const repo2 = await RepositoryService.getRepository();
      expect(repo2.projects.length).toBe(1);
    });

    it('repository is stored under the correct storage key', async () => {
      await RepositoryService.createProject('Test Project');
      // Verify data was stored under the correct key
      const result = await chrome.storage.local.get(StorageKeys.REPOSITORY);
      expect(result[StorageKeys.REPOSITORY]).toBeDefined();
      expect(result[StorageKeys.REPOSITORY].projects[0].name).toBe('Test Project');
    });
  });

  // ── Hierarchy Rules ─────────────────────────────────────

  describe('Hierarchy Rules', () => {
    it('every test case belongs to exactly one scenario', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const s1 = await RepositoryService.createScenario(project.id, feature.id, 'S1');
      const s2 = await RepositoryService.createScenario(project.id, feature.id, 'S2');

      const tc = await RepositoryService.saveTestCase(project.id, feature.id, s1.id, 'TC1', [SAMPLE_STEP], []);
      expect(tc.id).toBeDefined();

      // TC is only under s1, not s2
      const tc1 = await RepositoryService.getTestCases(project.id, feature.id, s1.id);
      const tc2 = await RepositoryService.getTestCases(project.id, feature.id, s2.id);
      expect(tc1.length).toBe(1);
      expect(tc2.length).toBe(0);
    });

    it('cascading delete: project → feature → scenario → test case', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, 'S1');
      await RepositoryService.saveTestCase(project.id, feature.id, scenario.id, 'TC1', [SAMPLE_STEP], []);

      // Delete project → everything gone
      await RepositoryService.deleteProject(project.id);
      const repo = await RepositoryService.getRepository();
      expect(repo.projects.length).toBe(0);
    });
  });

  // ── ID Generation ───────────────────────────────────────

  describe('ID Generation', () => {
    it('generates sequential IDs with correct prefixes', async () => {
      const p = await RepositoryService.createProject('P');
      expect(p.id).toBe('proj-0001');
      const f = await RepositoryService.createFeature(p.id, 'F');
      expect(f.id).toBe('feat-0001');
      const s = await RepositoryService.createScenario(p.id, f.id, 'S');
      expect(s.id).toBe('scn-0001');
      const tc = await RepositoryService.saveTestCase(p.id, f.id, s.id, 'TC', [SAMPLE_STEP], []);
      expect(tc.id).toBe('tc-0001');
    });
  });

  // ── Duplicate Name Validation ───────────────────────────

  describe('Duplicate Name Validation', () => {
    it('rejects duplicate project name (case-insensitive)', async () => {
      await RepositoryService.createProject('Airline Portal');

      await expect(RepositoryService.createProject('Airline Portal'))
        .rejects.toThrow('already exists');
    });

    it('rejects duplicate project name with different case', async () => {
      await RepositoryService.createProject('Airline Portal');

      await expect(RepositoryService.createProject('AIRLINE PORTAL'))
        .rejects.toThrow('already exists');
    });

    it('rejects empty project name', async () => {
      await expect(RepositoryService.createProject('   '))
        .rejects.toThrow('cannot be empty');
    });

    it('trims whitespace from project names', async () => {
      const project = await RepositoryService.createProject('  My Project  ');
      expect(project.name).toBe('My Project');
    });

    it('allows same feature name in different projects', async () => {
      const projectA = await RepositoryService.createProject('Project A');
      const projectB = await RepositoryService.createProject('Project B');

      // Both can have a feature named "Login" — different parent
      const fA = await RepositoryService.createFeature(projectA.id, 'Login');
      const fB = await RepositoryService.createFeature(projectB.id, 'Login');
      expect(fA.name).toBe('Login');
      expect(fB.name).toBe('Login');
    });

    it('rejects duplicate feature name within the same project', async () => {
      const project = await RepositoryService.createProject('P1');
      await RepositoryService.createFeature(project.id, 'Login');

      await expect(RepositoryService.createFeature(project.id, 'Login'))
        .rejects.toThrow('already exists');
    });

    it('rejects duplicate feature name within same project (case-insensitive)', async () => {
      const project = await RepositoryService.createProject('P1');
      await RepositoryService.createFeature(project.id, 'Flight Booking');

      await expect(RepositoryService.createFeature(project.id, 'FLIGHT BOOKING'))
        .rejects.toThrow('already exists');
    });

    it('rejects empty feature name', async () => {
      const project = await RepositoryService.createProject('P1');
      await expect(RepositoryService.createFeature(project.id, ''))
        .rejects.toThrow('cannot be empty');
    });

    it('trims whitespace from feature names', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, '  Login  ');
      expect(feature.name).toBe('Login');
    });

    it('allows same scenario name in different features', async () => {
      const project = await RepositoryService.createProject('P1');
      const featureA = await RepositoryService.createFeature(project.id, 'Feature A');
      const featureB = await RepositoryService.createFeature(project.id, 'Feature B');

      const sA = await RepositoryService.createScenario(project.id, featureA.id, 'One Way');
      const sB = await RepositoryService.createScenario(project.id, featureB.id, 'One Way');
      expect(sA.name).toBe('One Way');
      expect(sB.name).toBe('One Way');
    });

    it('rejects duplicate scenario name within the same feature', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      await RepositoryService.createScenario(project.id, feature.id, 'One Way');

      await expect(RepositoryService.createScenario(project.id, feature.id, 'One Way'))
        .rejects.toThrow('already exists');
    });

    it('rejects duplicate scenario name within same feature (case-insensitive)', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      await RepositoryService.createScenario(project.id, feature.id, 'Round Trip');

      await expect(RepositoryService.createScenario(project.id, feature.id, 'round trip'))
        .rejects.toThrow('already exists');
    });

    it('rejects empty scenario name', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      await expect(RepositoryService.createScenario(project.id, feature.id, '  '))
        .rejects.toThrow('cannot be empty');
    });

    it('trims whitespace from scenario names', async () => {
      const project = await RepositoryService.createProject('P1');
      const feature = await RepositoryService.createFeature(project.id, 'F1');
      const scenario = await RepositoryService.createScenario(project.id, feature.id, '  One Way  ');
      expect(scenario.name).toBe('One Way');
    });
  });
});
