import type {
  EdgeType,
  ExplorationEdge,
  ExplorationNode,
  ExplorationSession,
  Extraction,
  FrontierInput,
  Graph,
  GraphEvent,
  GraphExport,
  MergeCandidate,
  NewEdge,
  NewNode,
  NodePatch,
  NodeRevision,
  Proposal,
  ProposalView,
  Source,
  SourceKind,
} from "./types";

export interface NewProposal {
  source: { kind: SourceKind; name: string; content: string };
  domain: string;
  extraction: Extraction;
  /** Merge candidates keyed by extracted node key (resolved to ids on insert). */
  mergeCandidates: Array<Omit<MergeCandidate, "proposedNodeId"> & { key: string }>;
}

/**
 * Storage port for the exploration graph. Implementations must not leak their
 * backing technology (D1, local SQLite, ...) into callers. Methods without an
 * explicit actor are human actions.
 */
export interface GraphRepository {
  /** The long-term graph only (accepted / manually created). */
  getGraph(): Promise<Graph>;
  getNode(id: string): Promise<ExplorationNode | null>;
  createNode(input: NewNode): Promise<{ node: ExplorationNode; edge: ExplorationEdge | null }>;
  updateNode(id: string, patch: NodePatch): Promise<ExplorationNode>;
  deleteNode(id: string): Promise<void>;
  /** Folds `fromId` into `intoId`: edges are re-pointed, the source reference kept, `fromId` removed. */
  mergeNodes(fromId: string, intoId: string): Promise<ExplorationNode>;
  listRevisions(nodeId: string): Promise<NodeRevision[]>;

  createEdge(input: NewEdge): Promise<ExplorationEdge>;
  updateEdge(id: string, type: EdgeType): Promise<ExplorationEdge>;
  deleteEdge(id: string): Promise<void>;

  setFrontier(nodeId: string, input: FrontierInput): Promise<ExplorationNode>;
  clearFrontier(nodeId: string): Promise<ExplorationNode>;

  createProposal(input: NewProposal): Promise<Proposal>;
  getProposal(id: string): Promise<ProposalView>;
  listProposals(): Promise<Proposal[]>;
  /** Merges the draft into the long-term graph; approval is recorded, authorship is untouched. */
  acceptProposal(id: string): Promise<Proposal>;
  discardProposal(id: string): Promise<Proposal>;
  resolveMergeCandidate(proposalId: string, proposedNodeId: string, existingNodeId: string, decision: "merge" | "keep"): Promise<ProposalView>;
  getSource(id: string): Promise<Source>;

  getActiveSession(): Promise<ExplorationSession | null>;
  startSession(title: string): Promise<ExplorationSession>;
  endSession(id: string): Promise<ExplorationSession>;

  listEvents(filter: { entityId?: string; sessionId?: string }): Promise<GraphEvent[]>;
  exportAll(): Promise<GraphExport>;
}

export class NotFoundError extends Error {}
export class ValidationError extends Error {}
