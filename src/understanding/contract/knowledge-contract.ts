/**
 * CP8 — Knowledge Consumer Contract v1 — FACADE
 *
 * The single public import for every consumer of the Knowledge Repository
 * (Playwright generation/execution, API testing, DB validation, Agents,
 * Assistants, LLM layers). READ-ONLY by construction: it holds only
 * references to the repository and loader and exposes query methods —
 * there is no mutation surface on this class, and none may be added
 * within contract v1 (pinned by reflection test).
 */

import type { KnowledgeRepository } from '../persistence/knowledge-repository';
import type { KnowledgeLoader } from '../consolidation/knowledge-loader';
import { CONTRACT_VERSION } from './contract-types';
import type {
  ActionContextBlock,
  ActionDescriptor,
  ApiSurfaceEntry,
  ApplicationDescriptor,
  ContractEnvelope,
  EntityDescriptor,
  EvidenceDescriptor,
  GapReport,
  GraphEdge,
  WorkflowTrace,
} from './contract-types';
import {
  describeActionAsContext,
  describeApplication,
  getActionDescriptor,
  getApiSurface,
  getConsequenceEvidence,
  getEntitySummary,
  getGapReport,
  getNavigationGraph,
  getStateGraph,
  listActions,
  listApplications,
  reconstructWorkflow,
} from './contract-queries';

export class KnowledgeContract {
  readonly contractVersion = CONTRACT_VERSION;

  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly loader: KnowledgeLoader,
  ) {}

  private envelope<T>(data: T): ContractEnvelope<T> {
    return { contractVersion: CONTRACT_VERSION, data };
  }

  async describeApplication(appId: string): Promise<ContractEnvelope<ApplicationDescriptor | null>> {
    return this.envelope(await describeApplication(this.repo, this.loader, appId));
  }

  async listApplications(): Promise<ContractEnvelope<ApplicationDescriptor[]>> {
    return this.envelope(await listApplications(this.repo, this.loader));
  }

  async listActions(
    appId: string,
    filter: { actionType?: string; status?: 'active' | 'stale' } = {},
  ): Promise<ContractEnvelope<ActionDescriptor[]>> {
    return this.envelope(await listActions(this.repo, this.loader, appId, filter));
  }

  async getAction(signatureKey: string): Promise<ContractEnvelope<ActionDescriptor | null>> {
    return this.envelope(await getActionDescriptor(this.repo, this.loader, signatureKey));
  }

  async getConsequenceEvidence(
    sampleRef: { sessionId: string; edgeKey: string },
  ): Promise<ContractEnvelope<EvidenceDescriptor | null>> {
    return this.envelope(await getConsequenceEvidence(this.repo, sampleRef));
  }

  async reconstructWorkflow(
    appId: string,
    sessionId: string,
  ): Promise<ContractEnvelope<WorkflowTrace | null>> {
    return this.envelope(await reconstructWorkflow(this.repo, appId, sessionId));
  }

  async getNavigationGraph(appId: string): Promise<ContractEnvelope<GraphEdge[]>> {
    return this.envelope(await getNavigationGraph(this.repo, this.loader, appId));
  }

  async getStateGraph(appId: string): Promise<ContractEnvelope<GraphEdge[]>> {
    return this.envelope(await getStateGraph(this.repo, this.loader, appId));
  }

  async getApiSurface(appId: string): Promise<ContractEnvelope<ApiSurfaceEntry[]>> {
    return this.envelope(await getApiSurface(this.repo, this.loader, appId));
  }

  async getEntitySummary(appId: string): Promise<ContractEnvelope<EntityDescriptor[]>> {
    return this.envelope(await getEntitySummary(this.repo, this.loader, appId));
  }

  async getGapReport(appId: string): Promise<ContractEnvelope<GapReport>> {
    return this.envelope(await getGapReport(this.repo, appId));
  }

  async describeActionAsContext(
    signatureKey: string,
  ): Promise<ContractEnvelope<ActionContextBlock | null>> {
    return this.envelope(await describeActionAsContext(this.repo, this.loader, signatureKey));
  }
}
