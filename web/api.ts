import type {
  EdgeType,
  ExplorationEdge,
  ExplorationNode,
  ExplorationSession,
  FrontierInput,
  Graph,
  GraphEvent,
  NewEdge,
  NewNode,
  NodePatch,
  NodeRevision,
  Proposal,
  ProposalView,
  Source,
  SourceKind,
} from "../src/domain/types";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `${res.status} ${res.statusText}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  graph: () => request<Graph>("GET", "/graph"),
  createNode: (input: NewNode) => request<{ node: ExplorationNode; edge: ExplorationEdge | null }>("POST", "/nodes", input),
  updateNode: (id: string, patch: NodePatch) => request<ExplorationNode>("PATCH", `/nodes/${id}`, patch),
  deleteNode: (id: string) => request<void>("DELETE", `/nodes/${id}`),
  setFrontier: (id: string, input: FrontierInput) => request<ExplorationNode>("PUT", `/nodes/${id}/frontier`, input),
  clearFrontier: (id: string) => request<ExplorationNode>("DELETE", `/nodes/${id}/frontier`),
  createEdge: (input: NewEdge) => request<ExplorationEdge>("POST", "/edges", input),
  updateEdge: (id: string, type: EdgeType) => request<ExplorationEdge>("PATCH", `/edges/${id}`, { type }),
  deleteEdge: (id: string) => request<void>("DELETE", `/edges/${id}`),
  mergeNode: (id: string, intoId: string) => request<ExplorationNode>("POST", `/nodes/${id}/merge`, { intoId }),
  revisions: (id: string) => request<NodeRevision[]>("GET", `/nodes/${id}/revisions`),
  capabilities: () => request<{ aiExtraction: boolean }>("GET", "/capabilities"),
  importSource: (input: { kind: SourceKind; name: string; content: string; domain?: string; extractor?: "ai" | "structural" }) =>
    request<Proposal>("POST", "/imports", input),
  proposals: () => request<Proposal[]>("GET", "/proposals"),
  proposal: (id: string) => request<ProposalView>("GET", `/proposals/${id}`),
  acceptProposal: (id: string) => request<Proposal>("POST", `/proposals/${id}/accept`),
  discardProposal: (id: string) => request<Proposal>("POST", `/proposals/${id}/discard`),
  resolveMerge: (id: string, proposedNodeId: string, existingNodeId: string, decision: "merge" | "keep") =>
    request<ProposalView>("POST", `/proposals/${id}/merge-candidates`, { proposedNodeId, existingNodeId, decision }),
  source: (id: string) => request<Source>("GET", `/sources/${id}`),
  activeSession: () => request<ExplorationSession | null>("GET", "/sessions/active"),
  startSession: (title: string) => request<ExplorationSession>("POST", "/sessions", { title }),
  endSession: (id: string) => request<ExplorationSession>("POST", `/sessions/${id}/end`),
  events: (filter: { entityId?: string; sessionId?: string }) =>
    request<GraphEvent[]>("GET", `/events?${new URLSearchParams(filter as Record<string, string>)}`),
};
