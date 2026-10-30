import { NotFoundError, ValidationError, type GraphRepository, type NewProposal } from "../domain/repository";
import {
  authorshipOf,
  type ActorType,
  type Authorship,
  type EdgeType,
  type EntityType,
  type EventType,
  type ExplorationEdge,
  type ExplorationNode,
  type ExplorationSession,
  type ExtractorInfo,
  type FrontierInput,
  type FrontierState,
  type GenerationType,
  type Graph,
  type GraphEvent,
  type GraphExport,
  type Level,
  type MergeCandidate,
  type NewEdge,
  type NewNode,
  type NodeContent,
  type NodePatch,
  type NodeRevision,
  type NodeStatus,
  type NodeType,
  type Proposal,
  type ProposalStatus,
  type ProposalView,
  type Provenance,
  type Source,
  type SourceKind,
} from "../domain/types";
import type { SqlDatabase, SqlStatement } from "./sql";

interface AttributionRow {
  authorship: string;
  generation_type: string;
  provenance: string;
  approved_by_human: number;
  approved_at: string | null;
}

interface NodeRow extends AttributionRow {
  id: string;
  proposal_id: string | null;
  type: string;
  title: string;
  body: string;
  status: string;
  stop_note: string | null;
  confidence: number | null;
  domain: string;
  source_refs: string;
  created_at: string;
  updated_at: string;
  f_node_id: string | null;
  potential: string | null;
  uncertainty: string | null;
  next_action: string | null;
  blocked_by: string | null;
  reopen_condition: string | null;
  last_explored_at: string | null;
  f_authorship: string | null;
  f_generation_type: string | null;
  f_approved: number | null;
}

interface EdgeRow extends AttributionRow {
  id: string;
  proposal_id: string | null;
  source_node_id: string;
  target_node_id: string;
  type: string;
  created_at: string;
}

interface ProposalRow {
  id: string;
  source_id: string;
  source_name: string;
  status: string;
  domain: string;
  extractor: string;
  merge_candidates: string;
  created_at: string;
  resolved_at: string | null;
}

interface SourceRow {
  id: string;
  kind: string;
  name: string;
  content: string;
  created_at: string;
}

interface RevisionRow {
  id: string;
  node_id: string;
  previous_revision_id: string | null;
  content: string;
  actor_type: string;
  generation_type: string;
  provenance: string;
  session_id: string | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  title: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
}

interface EventRow {
  id: string;
  session_id: string | null;
  actor_type: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  before: string | null;
  after: string | null;
  timestamp: string;
}

const NODE_SELECT = `
  SELECT n.*, f.node_id AS f_node_id, f.potential, f.uncertainty, f.next_action, f.blocked_by,
         f.reopen_condition, f.last_explored_at, f.authorship AS f_authorship,
         f.generation_type AS f_generation_type, f.approved_by_human AS f_approved
  FROM nodes n LEFT JOIN frontiers f ON f.node_id = n.id`;

const PROPOSAL_SELECT = `SELECT p.*, s.name AS source_name FROM proposals p JOIN sources s ON s.id = p.source_id`;

export interface RepositoryOptions {
  workspaceId?: string;
  now?: () => Date;
  newId?: () => string;
}

/** GraphRepository over any SQLite-dialect database (D1 in web mode, local SQLite later). */
export class SqlGraphRepository implements GraphRepository {
  private readonly ws: string;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: RepositoryOptions = {},
  ) {
    this.ws = options.workspaceId ?? "default";
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  async getGraph(): Promise<Graph> {
    const [nodeRows, edgeRows] = await Promise.all([
      this.db.all<NodeRow>(`${NODE_SELECT} WHERE n.workspace_id = ? AND n.proposal_id IS NULL ORDER BY n.created_at`, [this.ws]),
      this.db.all<EdgeRow>(`SELECT * FROM edges WHERE workspace_id = ? AND proposal_id IS NULL ORDER BY created_at`, [this.ws]),
    ]);
    return { nodes: nodeRows.map(toNode), edges: edgeRows.map(toEdge) };
  }

  async getNode(id: string): Promise<ExplorationNode | null> {
    const row = await this.db.first<NodeRow>(`${NODE_SELECT} WHERE n.workspace_id = ? AND n.id = ?`, [this.ws, id]);
    return row ? toNode(row) : null;
  }

  async createNode(input: NewNode): Promise<{ node: ExplorationNode; edge: ExplorationEdge | null }> {
    const title = input.title.trim();
    if (!title) throw new ValidationError("title is required");
    const parent = input.parent ? await this.requireNode(input.parent.nodeId) : null;
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    const proposalId = parent?.proposalId ?? null;
    const node: ExplorationNode = {
      id: this.newId(),
      proposalId,
      type: input.type,
      title,
      body: input.body ?? "",
      status: "open",
      stopNote: null,
      confidence: null,
      domain: input.domain?.trim() || parent?.domain || "",
      sourceRefs: [],
      createdAt: ts,
      updatedAt: ts,
      frontier: null,
      ...this.humanAttribution(proposalId, session, ts),
    };
    const statements = this.insertNode(node, "human", session, null, ts);
    let edge: ExplorationEdge | null = null;
    if (parent && input.parent) {
      edge = {
        id: this.newId(),
        proposalId,
        sourceId: parent.id,
        targetId: node.id,
        type: input.parent.edgeType,
        createdAt: ts,
        ...this.humanAttribution(proposalId, session, ts),
      };
      statements.push(...this.insertEdge(edge, "human", session, ts), ...this.touchFrontier(parent, ts));
    }
    await this.db.batch(statements);
    return { node, edge };
  }

  async updateNode(id: string, patch: NodePatch): Promise<ExplorationNode> {
    const before = await this.requireNode(id);
    if (patch.title !== undefined && !patch.title.trim()) throw new ValidationError("title cannot be empty");
    if (patch.confidence != null && (patch.confidence < 0 || patch.confidence > 1)) {
      throw new ValidationError("confidence must be between 0 and 1");
    }
    const ts = this.timestamp();
    const after: ExplorationNode = { ...before, ...patch, title: patch.title?.trim() ?? before.title, updatedAt: ts };
    // A human rewriting AI-authored text makes it mixed; accepting or re-classifying it does not.
    const textChanged = after.title !== before.title || after.body !== before.body;
    if (textChanged && before.authorship === "ai") after.authorship = "mixed";
    if (after.frontier) after.frontier = { ...after.frontier, lastExploredAt: ts };

    const session = await this.getActiveSession();
    const statements: SqlStatement[] = [
      {
        sql: `UPDATE nodes SET type = ?, title = ?, body = ?, status = ?, stop_note = ?, confidence = ?, domain = ?,
              source_refs = ?, authorship = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
        params: [
          after.type,
          after.title,
          after.body,
          after.status,
          after.stopNote,
          after.confidence,
          after.domain,
          JSON.stringify(after.sourceRefs),
          after.authorship,
          ts,
          id,
          this.ws,
        ],
      },
      ...this.touchFrontier(before, ts),
      this.event(session, "human", "updated", "node", id, before, after, ts),
    ];
    if (JSON.stringify(contentOf(before)) !== JSON.stringify(contentOf(after))) {
      const previous = await this.latestRevisionId(id);
      statements.push(this.revision(after, "human", { generationType: "human" }, session, previous, ts));
    }
    await this.db.batch(statements);
    return after;
  }

  async deleteNode(id: string): Promise<void> {
    const before = await this.requireNode(id);
    const edges = await this.edgesTouching([id]);
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    await this.db.batch([
      ...edges.map((e) => this.event(session, "human", "deleted", "edge", e.id, e, null, ts)),
      { sql: `DELETE FROM edges WHERE workspace_id = ? AND (source_node_id = ? OR target_node_id = ?)`, params: [this.ws, id, id] },
      { sql: `DELETE FROM frontiers WHERE node_id = ?`, params: [id] },
      { sql: `DELETE FROM nodes WHERE id = ? AND workspace_id = ?`, params: [id, this.ws] },
      this.event(session, "human", "deleted", "node", id, before, null, ts),
    ]);
  }

  async mergeNodes(fromId: string, intoId: string): Promise<ExplorationNode> {
    if (fromId === intoId) throw new ValidationError("cannot merge a node into itself");
    const [from, into] = await Promise.all([this.requireNode(fromId), this.requireNode(intoId)]);
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    const statements: SqlStatement[] = [];

    const edges = await this.edgesTouching([fromId, intoId]);
    const kept = new Set(edges.filter((e) => e.sourceId !== fromId && e.targetId !== fromId).map(edgeKey));
    for (const e of edges.filter((e) => e.sourceId === fromId || e.targetId === fromId)) {
      const moved = { ...e, sourceId: e.sourceId === fromId ? intoId : e.sourceId, targetId: e.targetId === fromId ? intoId : e.targetId };
      if (moved.sourceId === moved.targetId || kept.has(edgeKey(moved))) {
        statements.push({ sql: `DELETE FROM edges WHERE id = ?`, params: [e.id] });
        statements.push(this.event(session, "human", "deleted", "edge", e.id, e, null, ts));
      } else {
        kept.add(edgeKey(moved));
        statements.push({ sql: `UPDATE edges SET source_node_id = ?, target_node_id = ? WHERE id = ?`, params: [moved.sourceId, moved.targetId, e.id] });
        statements.push(this.event(session, "human", "updated", "edge", e.id, e, moved, ts));
      }
    }

    if (from.frontier && !into.frontier) {
      statements.push({ sql: `UPDATE frontiers SET node_id = ? WHERE node_id = ?`, params: [intoId, fromId] });
    } else {
      statements.push({ sql: `DELETE FROM frontiers WHERE node_id = ?`, params: [fromId] });
    }

    const sourceRefs = [...new Set([...into.sourceRefs, ...from.sourceRefs, ...(from.provenance.sourceId ? [from.provenance.sourceId] : [])])];
    const merged: ExplorationNode = { ...into, sourceRefs, frontier: into.frontier ?? from.frontier, updatedAt: ts };
    statements.push(
      { sql: `UPDATE nodes SET source_refs = ?, updated_at = ? WHERE id = ?`, params: [JSON.stringify(sourceRefs), ts, intoId] },
      { sql: `DELETE FROM nodes WHERE id = ? AND workspace_id = ?`, params: [fromId, this.ws] },
      this.event(session, "human", "merged", "node", fromId, from, { mergedInto: intoId }, ts),
    );
    await this.db.batch(statements);
    return merged;
  }

  async listRevisions(nodeId: string): Promise<NodeRevision[]> {
    const rows = await this.db.all<RevisionRow>(
      `SELECT * FROM node_revisions WHERE workspace_id = ? AND node_id = ? ORDER BY created_at, rowid`,
      [this.ws, nodeId],
    );
    return rows.map(toRevision);
  }

  async createEdge(input: NewEdge): Promise<ExplorationEdge> {
    if (input.sourceId === input.targetId) throw new ValidationError("an edge cannot connect a node to itself");
    const [source, target] = await Promise.all([this.requireNode(input.sourceId), this.requireNode(input.targetId)]);
    const duplicate = await this.db.first<EdgeRow>(
      `SELECT * FROM edges WHERE workspace_id = ? AND source_node_id = ? AND target_node_id = ? AND type = ?`,
      [this.ws, input.sourceId, input.targetId, input.type],
    );
    if (duplicate) return toEdge(duplicate);
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    const proposalId = source.proposalId ?? target.proposalId;
    const edge: ExplorationEdge = { id: this.newId(), proposalId, ...input, createdAt: ts, ...this.humanAttribution(proposalId, session, ts) };
    await this.db.batch([...this.insertEdge(edge, "human", session, ts), ...this.touchFrontier(source, ts)]);
    return edge;
  }

  async updateEdge(id: string, type: EdgeType): Promise<ExplorationEdge> {
    const before = await this.requireEdge(id);
    const after = { ...before, type };
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    await this.db.batch([
      { sql: `UPDATE edges SET type = ? WHERE id = ? AND workspace_id = ?`, params: [type, id, this.ws] },
      this.event(session, "human", "updated", "edge", id, before, after, ts),
    ]);
    return after;
  }

  async deleteEdge(id: string): Promise<void> {
    const before = await this.requireEdge(id);
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    await this.db.batch([
      { sql: `DELETE FROM edges WHERE id = ? AND workspace_id = ?`, params: [id, this.ws] },
      this.event(session, "human", "deleted", "edge", id, before, null, ts),
    ]);
  }

  async setFrontier(nodeId: string, input: FrontierInput): Promise<ExplorationNode> {
    const node = await this.requireNode(nodeId);
    const ts = this.timestamp();
    const before = node.frontier;
    const after: FrontierState = {
      potential: pick(input.potential, before?.potential),
      uncertainty: pick(input.uncertainty, before?.uncertainty),
      nextAction: pick(input.nextAction, before?.nextAction),
      blockedBy: pick(input.blockedBy, before?.blockedBy),
      reopenCondition: pick(input.reopenCondition, before?.reopenCondition),
      lastExploredAt: before && !input.touch ? before.lastExploredAt : ts,
      // Editing an AI-suggested frontier does not make it human-originated.
      authorship: before?.authorship ?? "human",
      generationType: before?.generationType ?? "human",
      approvedByHuman: before?.approvedByHuman ?? node.proposalId === null,
    };
    const session = await this.getActiveSession();
    await this.db.batch([
      {
        sql: `INSERT INTO frontiers (node_id, workspace_id, potential, uncertainty, next_action, blocked_by, reopen_condition,
                authorship, generation_type, approved_by_human, last_explored_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (node_id) DO UPDATE SET potential = excluded.potential, uncertainty = excluded.uncertainty,
                next_action = excluded.next_action, blocked_by = excluded.blocked_by,
                reopen_condition = excluded.reopen_condition, last_explored_at = excluded.last_explored_at`,
        params: [
          nodeId,
          this.ws,
          after.potential,
          after.uncertainty,
          after.nextAction,
          after.blockedBy,
          after.reopenCondition,
          after.authorship,
          after.generationType,
          after.approvedByHuman ? 1 : 0,
          after.lastExploredAt,
          ts,
        ],
      },
      this.event(session, "human", before ? "updated" : "created", "frontier", nodeId, before, after, ts),
    ]);
    return { ...node, frontier: after };
  }

  async clearFrontier(nodeId: string): Promise<ExplorationNode> {
    const node = await this.requireNode(nodeId);
    if (!node.frontier) return node;
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    await this.db.batch([
      { sql: `DELETE FROM frontiers WHERE node_id = ?`, params: [nodeId] },
      this.event(session, "human", "deleted", "frontier", nodeId, node.frontier, null, ts),
    ]);
    return { ...node, frontier: null };
  }

  async createProposal(input: NewProposal): Promise<Proposal> {
    const { extraction } = input;
    if (extraction.nodes.length === 0) throw new ValidationError("nothing to extract from this source");
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    const sourceId = this.newId();
    const proposalId = this.newId();
    const ids = new Map(extraction.nodes.map((n) => [n.key, this.newId()]));
    const baseProvenance = (generationType: GenerationType, extra: Partial<Provenance> = {}): Provenance => ({
      generationType,
      sourceId,
      ...extractorProvenance(extraction.extractor),
      ...(session ? { sessionId: session.id } : {}),
      ...extra,
    });

    const mergeCandidates: MergeCandidate[] = input.mergeCandidates.flatMap((c) => {
      const proposedNodeId = ids.get(c.key);
      return proposedNodeId ? [{ proposedNodeId, existingNodeId: c.existingNodeId, likelihood: c.likelihood, reason: c.reason }] : [];
    });
    const proposal: Proposal = {
      id: proposalId,
      sourceId,
      sourceName: input.source.name,
      status: "open",
      domain: input.domain,
      extractor: extraction.extractor,
      mergeCandidates,
      createdAt: ts,
      resolvedAt: null,
    };

    const statements: SqlStatement[] = [
      {
        sql: `INSERT INTO sources (id, workspace_id, kind, name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        params: [sourceId, this.ws, input.source.kind, input.source.name, input.source.content, ts],
      },
      {
        sql: `INSERT INTO proposals (id, workspace_id, source_id, status, domain, extractor, merge_candidates, created_at)
              VALUES (?, ?, ?, 'open', ?, ?, ?, ?)`,
        params: [proposalId, this.ws, sourceId, input.domain, JSON.stringify(extraction.extractor), JSON.stringify(mergeCandidates), ts],
      },
    ];

    for (const extracted of extraction.nodes) {
      const authorship = authorshipOf(extracted.generationType);
      const actor: ActorType = authorship === "ai" ? "ai" : "human";
      const node: ExplorationNode = {
        id: ids.get(extracted.key)!,
        proposalId,
        type: extracted.type,
        title: extracted.title,
        body: extracted.body,
        status: "open",
        stopNote: null,
        confidence: extracted.confidence,
        domain: input.domain,
        sourceRefs: [sourceId],
        createdAt: ts,
        updatedAt: ts,
        frontier: extracted.frontier && {
          ...extracted.frontier,
          blockedBy: null,
          reopenCondition: null,
          lastExploredAt: ts,
          authorship,
          generationType: extracted.generationType,
          approvedByHuman: false,
        },
        authorship,
        provenance: baseProvenance(extracted.generationType, extracted.anchor ? { anchor: extracted.anchor } : {}),
        approvedByHuman: false,
        approvedAt: null,
      };
      statements.push(...this.insertNode(node, actor, session, null, ts));
      if (node.frontier) statements.push(this.insertFrontier(node.id, node.frontier, ts));
    }

    for (const extracted of extraction.edges) {
      const edge: ExplorationEdge = {
        id: this.newId(),
        proposalId,
        sourceId: ids.get(extracted.sourceKey)!,
        targetId: ids.get(extracted.targetKey)!,
        type: extracted.type,
        createdAt: ts,
        authorship: authorshipOf(extracted.generationType),
        provenance: baseProvenance(extracted.generationType),
        approvedByHuman: false,
        approvedAt: null,
      };
      statements.push(...this.insertEdge(edge, edge.authorship === "ai" ? "ai" : "human", session, ts));
    }
    statements.push(this.event(session, extraction.extractor.model ? "ai" : "human", "created", "proposal", proposalId, null, proposal, ts));
    await this.db.batch(statements);
    return proposal;
  }

  async getProposal(id: string): Promise<ProposalView> {
    const proposal = await this.requireProposal(id);
    const [nodeRows, edgeRows] = await Promise.all([
      this.db.all<NodeRow>(`${NODE_SELECT} WHERE n.workspace_id = ? AND n.proposal_id = ? ORDER BY n.created_at, n.rowid`, [this.ws, id]),
      this.db.all<EdgeRow>(`SELECT * FROM edges WHERE workspace_id = ? AND proposal_id = ? ORDER BY created_at, rowid`, [this.ws, id]),
    ]);
    const nodes = nodeRows.map(toNode);
    const edges = edgeRows.map(toEdge);
    const draftIds = new Set(nodes.map((n) => n.id));
    const linkedIds = [...new Set(edges.flatMap((e) => [e.sourceId, e.targetId]).filter((nid) => !draftIds.has(nid)))];
    const candidateIds = proposal.mergeCandidates.map((c) => c.existingNodeId).filter((nid) => !draftIds.has(nid));
    const existing = await this.nodesByIds([...new Set([...linkedIds, ...candidateIds])]);
    const existingIds = new Set(existing.map((n) => n.id));
    return {
      proposal: {
        ...proposal,
        mergeCandidates: proposal.mergeCandidates.filter((c) => draftIds.has(c.proposedNodeId) && existingIds.has(c.existingNodeId)),
      },
      graph: { nodes: [...nodes, ...existing.filter((n) => linkedIds.includes(n.id))], edges },
      mergeTargets: existing.filter((n) => candidateIds.includes(n.id)),
    };
  }

  async listProposals(): Promise<Proposal[]> {
    const rows = await this.db.all<ProposalRow>(`${PROPOSAL_SELECT} WHERE p.workspace_id = ? AND p.status = 'open' ORDER BY p.created_at DESC`, [this.ws]);
    return rows.map(toProposal);
  }

  async acceptProposal(id: string): Promise<Proposal> {
    const proposal = await this.requireOpenProposal(id);
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    const accepted: Proposal = { ...proposal, status: "accepted", resolvedAt: ts, mergeCandidates: [] };
    await this.db.batch([
      {
        sql: `UPDATE frontiers SET approved_by_human = 1 WHERE node_id IN (SELECT id FROM nodes WHERE proposal_id = ? AND workspace_id = ?)`,
        params: [id, this.ws],
      },
      { sql: `UPDATE edges SET proposal_id = NULL, approved_by_human = 1, approved_at = ? WHERE proposal_id = ? AND workspace_id = ?`, params: [ts, id, this.ws] },
      { sql: `UPDATE nodes SET proposal_id = NULL, approved_by_human = 1, approved_at = ? WHERE proposal_id = ? AND workspace_id = ?`, params: [ts, id, this.ws] },
      { sql: `UPDATE proposals SET status = 'accepted', resolved_at = ?, merge_candidates = '[]' WHERE id = ?`, params: [ts, id] },
      this.event(session, "human", "accepted", "proposal", id, proposal, accepted, ts),
    ]);
    return accepted;
  }

  async discardProposal(id: string): Promise<Proposal> {
    const proposal = await this.requireOpenProposal(id);
    const ts = this.timestamp();
    const session = await this.getActiveSession();
    const discarded: Proposal = { ...proposal, status: "discarded", resolvedAt: ts, mergeCandidates: [] };
    const draftNodes = `SELECT id FROM nodes WHERE proposal_id = ? AND workspace_id = ?`;
    await this.db.batch([
      {
        sql: `DELETE FROM edges WHERE workspace_id = ? AND (proposal_id = ? OR source_node_id IN (${draftNodes}) OR target_node_id IN (${draftNodes}))`,
        params: [this.ws, id, id, this.ws, id, this.ws],
      },
      { sql: `DELETE FROM frontiers WHERE node_id IN (${draftNodes})`, params: [id, this.ws] },
      { sql: `DELETE FROM nodes WHERE proposal_id = ? AND workspace_id = ?`, params: [id, this.ws] },
      { sql: `UPDATE proposals SET status = 'discarded', resolved_at = ?, merge_candidates = '[]' WHERE id = ?`, params: [ts, id] },
      this.event(session, "human", "discarded", "proposal", id, proposal, discarded, ts),
    ]);
    return discarded;
  }

  async resolveMergeCandidate(
    proposalId: string,
    proposedNodeId: string,
    existingNodeId: string,
    decision: "merge" | "keep",
  ): Promise<ProposalView> {
    const proposal = await this.requireOpenProposal(proposalId);
    const candidate = proposal.mergeCandidates.find((c) => c.proposedNodeId === proposedNodeId && c.existingNodeId === existingNodeId);
    if (!candidate) throw new NotFoundError("merge candidate not found");
    if (decision === "merge") await this.mergeNodes(proposedNodeId, existingNodeId);
    const remaining = proposal.mergeCandidates.filter((c) =>
      decision === "merge" ? c.proposedNodeId !== proposedNodeId : c !== candidate,
    );
    await this.db.batch([{ sql: `UPDATE proposals SET merge_candidates = ? WHERE id = ?`, params: [JSON.stringify(remaining), proposalId] }]);
    return this.getProposal(proposalId);
  }

  async getSource(id: string): Promise<Source> {
    const row = await this.db.first<SourceRow>(`SELECT * FROM sources WHERE workspace_id = ? AND id = ?`, [this.ws, id]);
    if (!row) throw new NotFoundError(`source ${id} not found`);
    return toSource(row);
  }

  async getActiveSession(): Promise<ExplorationSession | null> {
    const row = await this.db.first<SessionRow>(
      `SELECT * FROM exploration_sessions WHERE workspace_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
      [this.ws],
    );
    return row ? toSession(row) : null;
  }

  async startSession(title: string): Promise<ExplorationSession> {
    const active = await this.getActiveSession();
    if (active) throw new ValidationError(`session "${active.title}" is still active`);
    const ts = this.timestamp();
    const session: ExplorationSession = { id: this.newId(), title: title.trim() || "Untitled session", startedAt: ts, endedAt: null, summary: null };
    await this.db.batch([
      {
        sql: `INSERT INTO exploration_sessions (id, workspace_id, title, started_at, ended_at, summary) VALUES (?, ?, ?, ?, NULL, NULL)`,
        params: [session.id, this.ws, session.title, ts],
      },
    ]);
    return session;
  }

  async endSession(id: string): Promise<ExplorationSession> {
    const row = await this.db.first<SessionRow>(`SELECT * FROM exploration_sessions WHERE workspace_id = ? AND id = ?`, [this.ws, id]);
    if (!row) throw new NotFoundError(`session ${id} not found`);
    if (row.ended_at) return toSession(row);
    const events = await this.listEvents({ sessionId: id });
    const ts = this.timestamp();
    const summary = summarizeEvents(events);
    await this.db.batch([{ sql: `UPDATE exploration_sessions SET ended_at = ?, summary = ? WHERE id = ?`, params: [ts, summary, id] }]);
    return { ...toSession(row), endedAt: ts, summary };
  }

  async listEvents(filter: { entityId?: string; sessionId?: string }): Promise<GraphEvent[]> {
    const where = ["workspace_id = ?"];
    const params: string[] = [this.ws];
    if (filter.entityId) {
      where.push("entity_id = ?");
      params.push(filter.entityId);
    }
    if (filter.sessionId) {
      where.push("session_id = ?");
      params.push(filter.sessionId);
    }
    const rows = await this.db.all<EventRow>(`SELECT * FROM session_events WHERE ${where.join(" AND ")} ORDER BY timestamp, rowid`, params);
    return rows.map(toEvent);
  }

  async exportAll(): Promise<GraphExport> {
    const [graph, sources, revisions, sessions, events] = await Promise.all([
      this.getGraph(),
      this.db.all<SourceRow>(`SELECT * FROM sources WHERE workspace_id = ? ORDER BY created_at`, [this.ws]),
      this.db.all<RevisionRow>(`SELECT * FROM node_revisions WHERE workspace_id = ? ORDER BY created_at, rowid`, [this.ws]),
      this.db.all<SessionRow>(`SELECT * FROM exploration_sessions WHERE workspace_id = ? ORDER BY started_at`, [this.ws]),
      this.listEvents({}),
    ]);
    return {
      version: 1,
      exportedAt: this.timestamp(),
      ...graph,
      sources: sources.map(toSource),
      revisions: revisions.map(toRevision),
      sessions: sessions.map(toSession),
      events,
    };
  }

  private humanAttribution(proposalId: string | null, session: ExplorationSession | null, ts: string) {
    const approved = proposalId === null;
    return {
      authorship: "human" as Authorship,
      provenance: { generationType: "human" as GenerationType, ...(session ? { sessionId: session.id } : {}) },
      approvedByHuman: approved,
      approvedAt: approved ? ts : null,
    };
  }

  private async requireNode(id: string): Promise<ExplorationNode> {
    const node = await this.getNode(id);
    if (!node) throw new NotFoundError(`node ${id} not found`);
    return node;
  }

  private async requireEdge(id: string): Promise<ExplorationEdge> {
    const row = await this.db.first<EdgeRow>(`SELECT * FROM edges WHERE workspace_id = ? AND id = ?`, [this.ws, id]);
    if (!row) throw new NotFoundError(`edge ${id} not found`);
    return toEdge(row);
  }

  private async requireProposal(id: string): Promise<Proposal> {
    const row = await this.db.first<ProposalRow>(`${PROPOSAL_SELECT} WHERE p.workspace_id = ? AND p.id = ?`, [this.ws, id]);
    if (!row) throw new NotFoundError(`proposal ${id} not found`);
    return toProposal(row);
  }

  private async requireOpenProposal(id: string): Promise<Proposal> {
    const proposal = await this.requireProposal(id);
    if (proposal.status !== "open") throw new ValidationError(`proposal is already ${proposal.status}`);
    return proposal;
  }

  private async nodesByIds(ids: string[]): Promise<ExplorationNode[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.all<NodeRow>(
      `${NODE_SELECT} WHERE n.workspace_id = ? AND n.id IN (${ids.map(() => "?").join(", ")})`,
      [this.ws, ...ids],
    );
    return rows.map(toNode);
  }

  private async edgesTouching(ids: string[]): Promise<ExplorationEdge[]> {
    const marks = ids.map(() => "?").join(", ");
    const rows = await this.db.all<EdgeRow>(
      `SELECT * FROM edges WHERE workspace_id = ? AND (source_node_id IN (${marks}) OR target_node_id IN (${marks}))`,
      [this.ws, ...ids, ...ids],
    );
    return rows.map(toEdge);
  }

  private async latestRevisionId(nodeId: string): Promise<string | null> {
    const row = await this.db.first<{ id: string }>(
      `SELECT id FROM node_revisions WHERE node_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      [nodeId],
    );
    return row?.id ?? null;
  }

  private insertNode(
    node: ExplorationNode,
    actor: ActorType,
    session: ExplorationSession | null,
    previousRevisionId: string | null,
    ts: string,
  ): SqlStatement[] {
    return [
      {
        sql: `INSERT INTO nodes (id, workspace_id, proposal_id, type, title, body, status, stop_note, confidence, domain, source_refs,
                authorship, generation_type, provenance, approved_by_human, approved_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          node.id,
          this.ws,
          node.proposalId,
          node.type,
          node.title,
          node.body,
          node.status,
          node.stopNote,
          node.confidence,
          node.domain,
          JSON.stringify(node.sourceRefs),
          node.authorship,
          node.provenance.generationType,
          JSON.stringify(node.provenance),
          node.approvedByHuman ? 1 : 0,
          node.approvedAt,
          ts,
          ts,
        ],
      },
      this.revision(node, actor, node.provenance, session, previousRevisionId, ts),
      this.event(session, actor, "created", "node", node.id, null, node, ts),
    ];
  }

  private insertFrontier(nodeId: string, f: FrontierState, ts: string): SqlStatement {
    return {
      sql: `INSERT INTO frontiers (node_id, workspace_id, potential, uncertainty, next_action, blocked_by, reopen_condition,
              authorship, generation_type, approved_by_human, last_explored_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        nodeId,
        this.ws,
        f.potential,
        f.uncertainty,
        f.nextAction,
        f.blockedBy,
        f.reopenCondition,
        f.authorship,
        f.generationType,
        f.approvedByHuman ? 1 : 0,
        f.lastExploredAt,
        ts,
      ],
    };
  }

  private insertEdge(edge: ExplorationEdge, actor: ActorType, session: ExplorationSession | null, ts: string): SqlStatement[] {
    return [
      {
        sql: `INSERT INTO edges (id, workspace_id, proposal_id, source_node_id, target_node_id, type, metadata,
                authorship, generation_type, provenance, approved_by_human, approved_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)`,
        params: [
          edge.id,
          this.ws,
          edge.proposalId,
          edge.sourceId,
          edge.targetId,
          edge.type,
          edge.authorship,
          edge.provenance.generationType,
          JSON.stringify(edge.provenance),
          edge.approvedByHuman ? 1 : 0,
          edge.approvedAt,
          ts,
        ],
      },
      this.event(session, actor, "created", "edge", edge.id, null, edge, ts),
    ];
  }

  private revision(
    node: ExplorationNode,
    actor: ActorType,
    provenance: Provenance,
    session: ExplorationSession | null,
    previousRevisionId: string | null,
    ts: string,
  ): SqlStatement {
    return {
      sql: `INSERT INTO node_revisions (id, workspace_id, node_id, previous_revision_id, content, actor_type, generation_type, provenance, session_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        this.newId(),
        this.ws,
        node.id,
        previousRevisionId,
        JSON.stringify(contentOf(node)),
        actor,
        provenance.generationType,
        JSON.stringify(provenance),
        session?.id ?? null,
        ts,
      ],
    };
  }

  /** Working on a frontier (editing it or branching from it) counts as exploring it. */
  private touchFrontier(node: ExplorationNode, ts: string): SqlStatement[] {
    if (!node.frontier) return [];
    return [{ sql: `UPDATE frontiers SET last_explored_at = ? WHERE node_id = ?`, params: [ts, node.id] }];
  }

  private event(
    session: ExplorationSession | null,
    actor: ActorType,
    eventType: EventType,
    entityType: EntityType,
    entityId: string,
    before: unknown,
    after: unknown,
    ts: string,
  ): SqlStatement {
    return {
      sql: `INSERT INTO session_events (id, workspace_id, session_id, actor_type, event_type, entity_type, entity_id, before, after, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        this.newId(),
        this.ws,
        session?.id ?? null,
        actor,
        eventType,
        entityType,
        entityId,
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
        ts,
      ],
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function pick<T>(value: T | null | undefined, fallback: T | null | undefined): T | null {
  return value === undefined ? (fallback ?? null) : value;
}

function edgeKey(e: { sourceId: string; targetId: string; type: string }): string {
  return `${e.sourceId}|${e.targetId}|${e.type}`;
}

function contentOf(n: ExplorationNode): NodeContent {
  return { type: n.type, title: n.title, body: n.body, status: n.status, stopNote: n.stopNote, confidence: n.confidence, domain: n.domain };
}

function extractorProvenance(e: ExtractorInfo): Partial<Provenance> {
  return {
    capabilityId: e.capabilityId,
    capabilityVersion: e.capabilityVersion,
    ...(e.model ? { model: e.model } : {}),
    ...(e.traceId ? { traceId: e.traceId } : {}),
  };
}

export function summarizeEvents(events: GraphEvent[]): string {
  if (events.length === 0) return "No graph changes.";
  const counts = new Map<string, number>();
  for (const e of events) {
    const key = `${e.entityType} ${e.eventType}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => `${n} ${key}`).join(", ");
}

function attribution(row: AttributionRow) {
  return {
    authorship: row.authorship as Authorship,
    provenance: JSON.parse(row.provenance) as Provenance,
    approvedByHuman: row.approved_by_human === 1,
    approvedAt: row.approved_at,
  };
}

function toNode(row: NodeRow): ExplorationNode {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    type: row.type as NodeType,
    title: row.title,
    body: row.body,
    status: row.status as NodeStatus,
    stopNote: row.stop_note,
    confidence: row.confidence,
    domain: row.domain,
    sourceRefs: JSON.parse(row.source_refs) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...attribution(row),
    frontier: row.f_node_id
      ? {
          potential: row.potential as Level | null,
          uncertainty: row.uncertainty as Level | null,
          nextAction: row.next_action,
          blockedBy: row.blocked_by,
          reopenCondition: row.reopen_condition,
          lastExploredAt: row.last_explored_at ?? row.updated_at,
          authorship: (row.f_authorship ?? "human") as Authorship,
          generationType: (row.f_generation_type ?? "human") as GenerationType,
          approvedByHuman: row.f_approved === 1,
        }
      : null,
  };
}

function toEdge(row: EdgeRow): ExplorationEdge {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    sourceId: row.source_node_id,
    targetId: row.target_node_id,
    type: row.type as EdgeType,
    createdAt: row.created_at,
    ...attribution(row),
  };
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    status: row.status as ProposalStatus,
    domain: row.domain,
    extractor: JSON.parse(row.extractor) as ExtractorInfo,
    mergeCandidates: JSON.parse(row.merge_candidates) as MergeCandidate[],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function toSource(row: SourceRow): Source {
  return { id: row.id, kind: row.kind as SourceKind, name: row.name, content: row.content, createdAt: row.created_at };
}

function toRevision(row: RevisionRow): NodeRevision {
  return {
    id: row.id,
    nodeId: row.node_id,
    previousRevisionId: row.previous_revision_id,
    content: JSON.parse(row.content) as NodeContent,
    actorType: row.actor_type as ActorType,
    generationType: row.generation_type as GenerationType,
    provenance: JSON.parse(row.provenance) as Provenance,
    sessionId: row.session_id,
    createdAt: row.created_at,
  };
}

function toSession(row: SessionRow): ExplorationSession {
  return { id: row.id, title: row.title, startedAt: row.started_at, endedAt: row.ended_at, summary: row.summary };
}

function toEvent(row: EventRow): GraphEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    actorType: row.actor_type as ActorType,
    eventType: row.event_type as EventType,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    before: row.before == null ? null : JSON.parse(row.before),
    after: row.after == null ? null : JSON.parse(row.after),
    timestamp: row.timestamp,
  };
}
