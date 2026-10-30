export const NODE_TYPES = ["question", "hypothesis", "evidence", "experiment", "finding", "opportunity"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = ["led_to", "supports", "contradicts", "derived_from", "requires", "blocked_by", "similar_to"] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/** Where exploration of a node currently stands; anything other than "open" is a recorded stop reason. */
export const NODE_STATUSES = ["open", "validated", "rejected", "blocked", "parked", "low_roi", "needs_more_evidence"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const LEVELS = ["low", "medium", "high"] as const;
export type Level = (typeof LEVELS)[number];

export const GENERATION_TYPES = ["human", "ai_extracted", "ai_generated", "ai_transformed", "import", "external_source"] as const;
/**
 * How content was produced:
 * - ai_extracted: AI structured an idea explicitly stated by the user/source
 * - ai_generated: AI introduced a new idea
 * - ai_transformed: AI rewrote/summarized existing content
 * - import: deterministic structural import of human content
 */
export type GenerationType = (typeof GENERATION_TYPES)[number];

/** Who actually produced the content. Approval never changes it. */
export type Authorship = "human" | "ai" | "mixed";
export type ActorType = "human" | "ai";

export function authorshipOf(generationType: GenerationType): Authorship {
  return generationType.startsWith("ai_") ? "ai" : "human";
}

/** Where in the source document a piece of the graph came from. Lines are 1-based and inclusive. */
export interface SourceAnchor {
  lineStart: number;
  lineEnd: number;
  quote: string;
}

export interface Provenance {
  generationType: GenerationType;
  sourceId?: string;
  anchor?: SourceAnchor;
  capabilityId?: string;
  capabilityVersion?: string;
  model?: string;
  traceId?: string;
  sessionId?: string;
}

/** Shared by nodes, edges and frontiers: authorship, approval and provenance stay separable. */
export interface Attribution {
  authorship: Authorship;
  provenance: Provenance;
  approvedByHuman: boolean;
  approvedAt: string | null;
}

/** Frontier is a state attached to a node, not a node type. */
export interface FrontierState {
  potential: Level | null;
  uncertainty: Level | null;
  nextAction: string | null;
  blockedBy: string | null;
  reopenCondition: string | null;
  lastExploredAt: string;
  authorship: Authorship;
  generationType: GenerationType;
  approvedByHuman: boolean;
}

export interface ExplorationNode extends Attribution {
  id: string;
  /** Set while the node is part of a not-yet-accepted Proposed Graph. */
  proposalId: string | null;
  type: NodeType;
  title: string;
  body: string;
  status: NodeStatus;
  /** Conclusion or reason recorded when exploration stopped. */
  stopNote: string | null;
  /** 0..1 */
  confidence: number | null;
  /** Domain / project grouping (metadata, not a node). */
  domain: string;
  sourceRefs: string[];
  createdAt: string;
  updatedAt: string;
  frontier: FrontierState | null;
}

export interface ExplorationEdge extends Attribution {
  id: string;
  proposalId: string | null;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  createdAt: string;
}

export interface Graph {
  nodes: ExplorationNode[];
  edges: ExplorationEdge[];
}

export const SOURCE_KINDS = ["markdown", "text", "conversation"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface Source {
  id: string;
  kind: SourceKind;
  name: string;
  content: string;
  createdAt: string;
}

export interface ExtractorInfo {
  capabilityId: string;
  capabilityVersion: string;
  model?: string;
  traceId?: string;
}

export interface MergeCandidate {
  proposedNodeId: string;
  existingNodeId: string;
  /** 0..1 */
  likelihood: number;
  reason: string;
}

export type ProposalStatus = "open" | "accepted" | "discarded";

export interface Proposal {
  id: string;
  sourceId: string;
  sourceName: string;
  status: ProposalStatus;
  domain: string;
  extractor: ExtractorInfo;
  mergeCandidates: MergeCandidate[];
  createdAt: string;
  resolvedAt: string | null;
}

/** A proposal plus its draft graph; `graph` also contains the long-term nodes that draft edges point at. */
export interface ProposalView {
  proposal: Proposal;
  graph: Graph;
  /** Long-term nodes named by merge candidates. */
  mergeTargets: ExplorationNode[];
}

export interface NodeContent {
  type: NodeType;
  title: string;
  body: string;
  status: NodeStatus;
  stopNote: string | null;
  confidence: number | null;
  domain: string;
}

export interface NodeRevision {
  id: string;
  nodeId: string;
  previousRevisionId: string | null;
  content: NodeContent;
  actorType: ActorType;
  generationType: GenerationType;
  provenance: Provenance;
  sessionId: string | null;
  createdAt: string;
}

export interface ExplorationSession {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
}

export type EntityType = "node" | "edge" | "frontier" | "proposal";
export type EventType = "created" | "updated" | "deleted" | "merged" | "accepted" | "discarded";

export interface GraphEvent {
  id: string;
  sessionId: string | null;
  actorType: ActorType;
  eventType: EventType;
  entityType: EntityType;
  entityId: string;
  before: unknown;
  after: unknown;
  timestamp: string;
}

export interface NewNode {
  type: NodeType;
  title: string;
  body?: string;
  domain?: string;
  /** Optionally attach the new node beneath an existing one. */
  parent?: { nodeId: string; edgeType: EdgeType };
}

export type NodePatch = Partial<Pick<ExplorationNode, "type" | "title" | "body" | "status" | "stopNote" | "confidence" | "domain" | "sourceRefs">>;

export interface NewEdge {
  sourceId: string;
  targetId: string;
  type: EdgeType;
}

export type FrontierInput = Partial<Pick<FrontierState, "potential" | "uncertainty" | "nextAction" | "blockedBy" | "reopenCondition">> & {
  touch?: boolean;
};

/** Output of a graph extractor, keyed by extractor-local keys before ids are assigned. */
export interface ExtractedNode {
  key: string;
  type: NodeType;
  title: string;
  body: string;
  generationType: GenerationType;
  confidence: number | null;
  anchor: SourceAnchor | null;
  frontier: { nextAction: string | null; potential: Level | null; uncertainty: Level | null } | null;
}

export interface ExtractedEdge {
  sourceKey: string;
  targetKey: string;
  type: EdgeType;
  generationType: GenerationType;
}

export interface ExtractedMerge {
  key: string;
  existingNodeId: string;
  likelihood: number;
  reason: string;
}

export interface Extraction {
  domain: string;
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
  mergeCandidates: ExtractedMerge[];
  extractor: ExtractorInfo;
}

export interface GraphExport extends Graph {
  version: 1;
  exportedAt: string;
  sources: Source[];
  revisions: NodeRevision[];
  sessions: ExplorationSession[];
  events: GraphEvent[];
}
