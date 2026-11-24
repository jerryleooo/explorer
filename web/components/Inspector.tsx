import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import {
  EDGE_TYPES,
  LEVELS,
  NODE_STATUSES,
  NODE_TYPES,
  type EdgeType,
  type ExplorationEdge,
  type ExplorationNode,
  type Graph,
  type Level,
  type NodeRevision,
  type NodeStatus,
  type NodeType,
} from "../../src/domain/types";
import { api } from "../api";
import {
  AUTHORSHIP_LABEL,
  EDGE_TYPE_LABEL,
  GENERATION_LABEL,
  LEVEL_LABEL,
  NODE_TYPE_LABEL,
  STATUS_LABEL,
  authorshipMark,
  relativeTime,
} from "../labels";

export type Mutate = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

interface NodeInspectorProps {
  node: ExplorationNode;
  graph: Graph;
  mutate: Mutate;
  onSelectNode: (id: string) => void;
  onCenterNode?: (id: string) => void;
  onAcceptNode?: (id: string) => void;
  onExploreNext?: (id: string) => void;
  onDeleted: () => void;
}

export function NodeInspector({ node, graph, mutate, onSelectNode, onCenterNode, onAcceptNode, onExploreNext, onDeleted }: NodeInspectorProps) {
  const [form, setForm] = useState(() => formOf(node));
  useEffect(() => setForm(formOf(node)), [node]);
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(node));

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    await mutate(() =>
      api.updateNode(node.id, {
        type: form.type,
        title: form.title,
        body: form.body,
        domain: form.domain,
        status: form.status,
        stopNote: form.status === "open" ? null : form.stopNote || null,
        confidence: form.confidence === "" ? null : Number(form.confidence) / 100,
      }),
    );
  };
  const saveOnCmdEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
  };

  const remove = async () => {
    if (!confirm(`Delete "${node.title}" and its connections?`)) return;
    await mutate(() => api.deleteNode(node.id));
    onDeleted();
  };

  return (
    <div className="inspector">
      <div className="row inspector-head">
        <strong className="grow">Node details</strong>
        {onCenterNode && (
          <button className="btn ghost small" type="button" onClick={() => onCenterNode(node.id)} title="Center on canvas">
            ◎ Center
          </button>
        )}
        {onExploreNext && node.proposalId === null && (
          <button className="btn small" type="button" onClick={() => onExploreNext(node.id)} title="Propose next-layer nodes">
            ✦ Explore
          </button>
        )}
      </div>
      <form onSubmit={save} onKeyDown={saveOnCmdEnter} className="stack">
        <div className="row">
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as NodeType })} aria-label="Node type">
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>{NODE_TYPE_LABEL[t]}</option>
            ))}
          </select>
          <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="Domain" aria-label="Domain" />
        </div>
        <textarea className="title-input" rows={2} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" />
        <textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Notes (Markdown)" aria-label="Notes" />
        <label className="field">
          <span>Exploration state</span>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as NodeStatus })}>
            {NODE_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
        {form.status !== "open" && (
          <label className="field">
            <span>Why it stopped / conclusion</span>
            <textarea rows={2} value={form.stopNote} onChange={(e) => setForm({ ...form, stopNote: e.target.value })} />
          </label>
        )}
        <label className="field">
          <span>Confidence {form.confidence === "" ? "—" : `${form.confidence}%`}</span>
          <input type="range" min={0} max={100} step={5} value={form.confidence === "" ? 50 : form.confidence} onChange={(e) => setForm({ ...form, confidence: e.target.value })} />
        </label>
        <div className="row">
          <button className="btn primary" type="submit" disabled={!dirty}>Save</button>
          {dirty && <button className="btn ghost" type="button" onClick={() => setForm(formOf(node))}>Revert</button>}
          <span className="hint">⌘↵</span>
        </div>
      </form>

      <FrontierSection node={node} mutate={mutate} />
      <SpatialSection node={node} mutate={mutate} />
      <AddChild node={node} mutate={mutate} onCreated={onSelectNode} />
      <Connections node={node} graph={graph} mutate={mutate} onSelectNode={onSelectNode} />
      <ProvenanceSection node={node} />
      <MergeInto node={node} graph={graph} mutate={mutate} onMerged={onSelectNode} />
      <Revisions node={node} />

      <div className="row">
        {node.proposalId !== null && onAcceptNode ? (
          <>
            <button className="btn primary" type="button" onClick={() => onAcceptNode(node.id)}>Accept node</button>
            <button className="btn danger ghost" type="button" onClick={remove}>Reject suggestion</button>
          </>
        ) : (
          <button className="btn danger ghost" type="button" onClick={remove}>Delete node</button>
        )}
      </div>
    </div>
  );
}

function formOf(node: ExplorationNode) {
  return {
    type: node.type,
    title: node.title,
    body: node.body,
    domain: node.domain,
    status: node.status,
    stopNote: node.stopNote ?? "",
    confidence: node.confidence == null ? "" : String(Math.round(node.confidence * 100)),
  };
}

function frontierFormOf(node: ExplorationNode) {
  return {
    potential: node.frontier?.potential ?? "",
    uncertainty: node.frontier?.uncertainty ?? "",
    nextAction: node.frontier?.nextAction ?? "",
    blockedBy: node.frontier?.blockedBy ?? "",
    reopenCondition: node.frontier?.reopenCondition ?? "",
  };
}

function FrontierSection({ node, mutate }: { node: ExplorationNode; mutate: Mutate }) {
  const [form, setForm] = useState(() => frontierFormOf(node));
  useEffect(() => setForm(frontierFormOf(node)), [node]);
  const f = node.frontier;
  const level = (v: string) => (v === "" ? null : (v as Level));
  const payload = () => ({
    potential: level(form.potential),
    uncertainty: level(form.uncertainty),
    nextAction: form.nextAction,
    blockedBy: form.blockedBy,
    reopenCondition: form.reopenCondition,
  });

  return (
    <section className="section">
      <div className="section-head">
        <h3>Frontier</h3>
        <label className="switch">
          <input
            type="checkbox"
            checked={Boolean(f)}
            onChange={() => mutate(() => (f ? api.clearFrontier(node.id) : api.setFrontier(node.id, {})))}
          />
          <span>{f ? "On" : "Off"}</span>
        </label>
      </div>
      {f && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(() => api.setFrontier(node.id, payload()));
          }}
        >
          <p className="muted small">
            {f.generationType === "ai_generated" ? "✦ Suggested by AI" : f.authorship === "ai" ? "✦ Extracted by AI from the source" : "Created by you"}
            {!f.approvedByHuman && " · pending review"} · last explored {relativeTime(f.lastExploredAt)}
          </p>
          <div className="row">
            {(["potential", "uncertainty"] as const).map((key) => (
              <label key={key} className="field">
                <span>{key === "potential" ? "Potential" : "Uncertainty"}</span>
                <select value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
                  <option value="">—</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>{LEVEL_LABEL[l]}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <input value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} placeholder="Next action if resumed" />
          <input value={form.blockedBy} onChange={(e) => setForm({ ...form, blockedBy: e.target.value })} placeholder="Blocked by" />
          <input value={form.reopenCondition} onChange={(e) => setForm({ ...form, reopenCondition: e.target.value })} placeholder="Reopen when…" />
          <div className="row">
            <button className="btn" type="submit">Save frontier</button>
            <button className="btn ghost" type="button" onClick={() => mutate(() => api.setFrontier(node.id, { ...payload(), touch: true }))}>
              Mark explored now
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function AddChild({ node, mutate, onCreated }: { node: ExplorationNode; mutate: Mutate; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<NodeType>("hypothesis");
  const [edgeType, setEdgeType] = useState<EdgeType>("led_to");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const created = await mutate(() => api.createNode({ type, title, parent: { nodeId: node.id, edgeType } }));
    if (created) {
      setTitle("");
      onCreated(created.node.id);
    }
  };
  return (
    <section className="section">
      <h3>Add branch</h3>
      <form className="stack" onSubmit={submit}>
        <div className="row">
          <select value={edgeType} onChange={(e) => setEdgeType(e.target.value as EdgeType)} aria-label="Relation">
            {EDGE_TYPES.map((t) => (
              <option key={t} value={t}>{EDGE_TYPE_LABEL[t]}</option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value as NodeType)} aria-label="New node type">
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>{NODE_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <input id="quick-add-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New node title… (press N)" />
      </form>
    </section>
  );
}

function SpatialSection({ node, mutate }: { node: ExplorationNode; mutate: Mutate }) {
  const coords = node.x != null && node.y != null ? `X ${Math.round(node.x)} · Y ${Math.round(node.y)}` : "Auto layout";
  return (
    <section className="section">
      <div className="section-head">
        <h3>Position</h3>
        <button
          className={`btn small${node.pinned ? " primary" : " ghost"}`}
          type="button"
          onClick={() => void mutate(() => api.updateNode(node.id, { pinned: !node.pinned }))}
        >
          {node.pinned ? "⌖ Locked" : "⌖ Lock position"}
        </button>
      </div>
      <p className="muted small" style={{ margin: "4px 0 0" }}>{coords}</p>
    </section>
  );
}

function Connections({
  node,
  graph,
  mutate,
  onSelectNode,
}: {
  node: ExplorationNode;
  graph: Graph;
  mutate: Mutate;
  onSelectNode: (id: string) => void;
}) {
  const [targetId, setTargetId] = useState("");
  const [edgeType, setEdgeType] = useState<EdgeType>("led_to");
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = graph.edges.filter((e) => e.targetId === node.id);
  const outgoing = graph.edges.filter((e) => e.sourceId === node.id);
  const candidates = graph.nodes.filter((n) => n.id !== node.id);

  const item = (e: ExplorationEdge, otherId: string, arrow: string) => {
    const other = byId.get(otherId);
    return (
      <li key={e.id} className="connection-row">
        <span className="muted small">{arrow}</span>
        <select
          className="edge-inline-select"
          value={e.type}
          aria-label="Relation type"
          onChange={(ev) => void mutate(() => api.updateEdge(e.id, ev.target.value as EdgeType))}
        >
          {EDGE_TYPES.map((t) => (
            <option key={t} value={t}>{EDGE_TYPE_LABEL[t]}</option>
          ))}
        </select>
        {other ? (
          <button className="link grow truncate" type="button" onClick={() => onSelectNode(other.id)} title={other.title}>
            {other.title}
          </button>
        ) : (
          <span className="muted grow">(outside this view)</span>
        )}
        <button
          className="btn ghost small"
          type="button"
          title="Remove relation"
          onClick={() => void mutate(() => api.deleteEdge(e.id))}
        >
          ×
        </button>
      </li>
    );
  };

  return (
    <section className="section">
      <h3>Connections · {incoming.length + outgoing.length}</h3>
      {incoming.length + outgoing.length > 0 && (
        <ul className="plain connection-list">
          {incoming.map((e) => item(e, e.sourceId, "←"))}
          {outgoing.map((e) => item(e, e.targetId, "→"))}
        </ul>
      )}
      {candidates.length > 0 && (
        <form
          className="stack"
          style={{ marginTop: 8 }}
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (!targetId) return;
            await mutate(() => api.createEdge({ sourceId: node.id, targetId, type: edgeType }));
            setTargetId("");
          }}
        >
          <div className="row">
            <select value={edgeType} onChange={(ev) => setEdgeType(ev.target.value as EdgeType)} aria-label="Link type">
              {EDGE_TYPES.map((t) => (
                <option key={t} value={t}>{EDGE_TYPE_LABEL[t]}</option>
              ))}
            </select>
            <select value={targetId} onChange={(ev) => setTargetId(ev.target.value)} aria-label="Target node">
              <option value="">Link to node…</option>
              {candidates.map((n) => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
          </div>
          <button className="btn small" type="submit" disabled={!targetId}>+ Add relation</button>
        </form>
      )}
    </section>
  );
}

function ProvenanceSection({ node }: { node: ExplorationNode }) {
  const p = node.provenance;
  const anchor = p.anchor;
  return (
    <section className="section">
      <h3>Provenance</h3>
      <dl className="facts">
        <dt>Created by</dt>
        <dd>{AUTHORSHIP_LABEL[node.authorship]} {authorshipMark(node.authorship)}</dd>
        <dt>Origin</dt>
        <dd>{GENERATION_LABEL[p.generationType]}</dd>
        {p.capabilityId && (
          <>
            <dt>Capability</dt>
            <dd>{p.capabilityId}@{p.capabilityVersion}</dd>
          </>
        )}
        {p.model && (
          <>
            <dt>Model</dt>
            <dd>{p.model}</dd>
          </>
        )}
        <dt>Approval</dt>
        <dd>{node.approvedByHuman ? `Approved by you${node.approvedAt ? ` · ${new Date(node.approvedAt).toLocaleString()}` : ""}` : "Pending review"}</dd>
      </dl>
      {p.sourceId && (
        <div className="anchor">
          {anchor && <blockquote>{anchor.quote}</blockquote>}
          <Link to={`/sources/${p.sourceId}${anchor ? `?lines=${anchor.lineStart}-${anchor.lineEnd}` : ""}`}>
            Open source{anchor ? ` · lines ${anchor.lineStart}${anchor.lineEnd !== anchor.lineStart ? `–${anchor.lineEnd}` : ""}` : ""} →
          </Link>
        </div>
      )}
    </section>
  );
}

function MergeInto({ node, graph, mutate, onMerged }: { node: ExplorationNode; graph: Graph; mutate: Mutate; onMerged: (id: string) => void }) {
  const [target, setTarget] = useState("");
  const options = graph.nodes.filter((n) => n.id !== node.id);
  if (options.length === 0) return null;
  return (
    <section className="section">
      <h3>Merge duplicate</h3>
      <div className="row">
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Merge into">
          <option value="">Merge this node into…</option>
          {options.map((n) => (
            <option key={n.id} value={n.id}>{n.title}</option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!target}
          onClick={async () => {
            const merged = await mutate(() => api.mergeNode(node.id, target));
            if (merged) onMerged(merged.id);
          }}
        >
          Merge
        </button>
      </div>
    </section>
  );
}

function Revisions({ node }: { node: ExplorationNode }) {
  const [revisions, setRevisions] = useState<NodeRevision[]>([]);
  useEffect(() => {
    let live = true;
    api.revisions(node.id).then((r) => live && setRevisions(r), () => undefined);
    return () => {
      live = false;
    };
  }, [node.id, node.updatedAt]);
  if (revisions.length === 0) return null;
  return (
    <section className="section">
      <h3>History</h3>
      <ol className="plain revisions">
        {revisions.map((r, i) => (
          <li key={r.id}>
            <span className="muted">
              v{i + 1} · {r.actorType === "ai" ? `✦ ${GENERATION_LABEL[r.generationType]}` : i === 0 ? GENERATION_LABEL[r.generationType] : "You edited"} ·{" "}
              {relativeTime(r.createdAt)}
            </span>
            <div>{r.content.title}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function EdgeInspector({ edge, graph, mutate, onDeleted }: { edge: ExplorationEdge; graph: Graph; mutate: Mutate; onDeleted: () => void }) {
  const title = (id: string) => graph.nodes.find((n) => n.id === id)?.title ?? "?";
  return (
    <div className="inspector">
      <h3>Relation</h3>
      <p>
        <strong>{title(edge.sourceId)}</strong>
        <br />
        <select value={edge.type} onChange={(e) => mutate(() => api.updateEdge(edge.id, e.target.value as EdgeType))} aria-label="Relation type">
          {EDGE_TYPES.map((t) => (
            <option key={t} value={t}>{EDGE_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <br />
        <strong>{title(edge.targetId)}</strong>
      </p>
      <dl className="facts">
        <dt>Created by</dt>
        <dd>{edge.authorship === "ai" ? "✦ AI inferred relation" : "You"}</dd>
        {edge.provenance.capabilityId && (
          <>
            <dt>Capability</dt>
            <dd>{edge.provenance.capabilityId}@{edge.provenance.capabilityVersion}</dd>
          </>
        )}
        <dt>Approval</dt>
        <dd>{edge.approvedByHuman ? "Accepted by you" : "Pending review"}</dd>
      </dl>
      <button
        className="btn danger ghost"
        onClick={async () => {
          await mutate(() => api.deleteEdge(edge.id));
          onDeleted();
        }}
      >
        Delete relation
      </button>
    </div>
  );
}
