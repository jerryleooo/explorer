import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { countDescendants, indexGraph } from "../../src/domain/graph";
import { frontiersOf, groupByDomain, sortFrontiers, type FrontierNode, type FrontierSort } from "../../src/domain/frontier";
import { NODE_TYPES, type NodeType } from "../../src/domain/types";
import { api } from "../api";
import { ImportPanel } from "../components/ImportPanel";
import { LEVEL_LABEL, NODE_TYPE_LABEL, STATUS_LABEL, relativeTime } from "../labels";
import { useStore } from "../store";

type FrontierFilter = "all" | "actionable" | "blocked" | "ai";

export function HomePage() {
  const { graph, proposals } = useStore();
  const [sort, setSort] = useState<FrontierSort>("priority");
  const [filter, setFilter] = useState<FrontierFilter>("all");

  const domains = useMemo(() => [...new Set((graph?.nodes ?? []).map((n) => n.domain).filter(Boolean))].sort(), [graph]);
  const frontiers = useMemo(() => frontiersOf(graph?.nodes ?? []), [graph]);
  const hero = sortFrontiers(frontiers, "priority")[0];
  const others = useMemo(() => {
    const isBlocked = (n: FrontierNode) => n.status === "blocked" || Boolean(n.frontier.blockedBy);
    const kept = frontiers.filter((n) => {
      if (n.id === hero?.id) return false;
      if (filter === "actionable") return !isBlocked(n);
      if (filter === "blocked") return isBlocked(n);
      if (filter === "ai") return n.frontier.authorship !== "human";
      return true;
    });
    return groupByDomain(sortFrontiers(kept, sort));
  }, [frontiers, hero, filter, sort]);

  if (!graph) return <main className="page"><p className="muted">Loading…</p></main>;

  return (
    <main className="page home">
      <ImportPanel domains={domains} />

      {proposals.length > 0 && (
        <section>
          <h2>Waiting for your review</h2>
          <ul className="cards">
            {proposals.map((p) => (
              <li key={p.id}>
                <Link to={`/proposals/${p.id}`} className="proposal-row">
                  <span className="draft-badge">Proposed graph</span>
                  <span className="grow">{p.sourceName}</span>
                  <span className="muted small">{p.domain || "—"} · {relativeTime(p.createdAt)}</span>
                  <span>Review →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hero ? (
        <section>
          <h2>Continue exploring</h2>
          <HeroCard node={hero} />
        </section>
      ) : graph.nodes.length > 0 ? (
        <section className="empty">
          <h2>No open frontiers</h2>
          <p className="muted">Mark a node as a frontier to see it here: an unanswered question, an untested hypothesis, a branch you paused.</p>
        </section>
      ) : null}

      {frontiers.length > 1 && (
        <section>
          <div className="section-head">
            <h2>Other frontiers</h2>
            <div className="row">
              <select value={filter} onChange={(e) => setFilter(e.target.value as FrontierFilter)} aria-label="Filter frontiers">
                <option value="all">All</option>
                <option value="actionable">Actionable</option>
                <option value="blocked">Blocked</option>
                <option value="ai">AI-suggested</option>
              </select>
              <select value={sort} onChange={(e) => setSort(e.target.value as FrontierSort)} aria-label="Sort frontiers">
                <option value="priority">Priority</option>
                <option value="freshness">Recently explored</option>
                <option value="stale">Longest untouched</option>
                <option value="potential">Potential</option>
                <option value="uncertainty">Uncertainty</option>
              </select>
            </div>
          </div>
          {others.map((group) => (
            <div key={group.domain} className="domain-group">
              <h3>{group.domain}</h3>
              <ul className="frontier-list">
                {group.nodes.map((n) => (
                  <FrontierRow key={n.id} node={n} />
                ))}
              </ul>
            </div>
          ))}
          {others.length === 0 && <p className="muted">Nothing matches this filter.</p>}
        </section>
      )}

      {graph.nodes.length > 0 && <Explorations />}
      <NewExploration domains={domains} />
    </main>
  );
}

function stoppedBecause(n: FrontierNode): string | null {
  return n.stopNote || (n.frontier.blockedBy ? `blocked by ${n.frontier.blockedBy}` : null) || (n.status !== "open" ? STATUS_LABEL[n.status] : null);
}

function HeroCard({ node }: { node: FrontierNode }) {
  const navigate = useNavigate();
  const reason = stoppedBecause(node);
  return (
    <article className="hero">
      <div className="hero-meta">
        <span className={`type-chip type-${node.type}`}>{NODE_TYPE_LABEL[node.type]}</span>
        {node.domain && <span className="muted">{node.domain}</span>}
        {node.frontier.authorship !== "human" && <span className="ai-tag">✦ {node.frontier.generationType === "ai_generated" ? "Suggested by AI" : "AI extracted"}</span>}
      </div>
      <h3 className="hero-title">{node.title}</h3>
      <dl className="hero-facts">
        <dt>Last explored</dt>
        <dd>{relativeTime(node.frontier.lastExploredAt)}</dd>
        {reason && (
          <>
            <dt>Stopped because</dt>
            <dd>{reason}</dd>
          </>
        )}
        {node.frontier.nextAction && (
          <>
            <dt>Next step</dt>
            <dd>{node.frontier.nextAction}</dd>
          </>
        )}
        {node.frontier.reopenCondition && (
          <>
            <dt>Reopen when</dt>
            <dd>{node.frontier.reopenCondition}</dd>
          </>
        )}
      </dl>
      <button className="btn primary" onClick={() => navigate(`/graph/${node.id}`)} autoFocus>
        Continue →
      </button>
    </article>
  );
}

function FrontierRow({ node }: { node: FrontierNode }) {
  const f = node.frontier;
  const reason = stoppedBecause(node);
  return (
    <li>
      <Link to={`/graph/${node.id}`} className="frontier-row">
        <span className="grow">
          <span className="frontier-title">{node.title}</span>
          <span className="muted small">
            {f.nextAction ? `next: ${f.nextAction}` : reason ?? NODE_TYPE_LABEL[node.type]}
            {f.authorship !== "human" && " · ✦ AI suggested, not yet explored"}
          </span>
        </span>
        {f.potential && <span className={`level level-${f.potential}`}>{LEVEL_LABEL[f.potential]} potential</span>}
        {f.uncertainty && <span className="level">{LEVEL_LABEL[f.uncertainty]} uncertainty</span>}
        {node.status !== "open" && <span className={`status status-${node.status}`}>{STATUS_LABEL[node.status]}</span>}
        <span className="muted small nowrap">{relativeTime(f.lastExploredAt)}</span>
      </Link>
    </li>
  );
}

/** Zoomed-out view: one line per exploration root, grouped by domain. */
function Explorations() {
  const { graph } = useStore();
  const roots = useMemo(() => {
    if (!graph) return [];
    const index = indexGraph(graph);
    return graph.nodes.filter((n) => (index.incoming.get(n.id) ?? []).length === 0);
  }, [graph]);
  if (!graph || roots.length === 0) return null;
  return (
    <section>
      <h2>Explorations</h2>
      {groupByDomain(roots).map((group) => (
        <div key={group.domain} className="domain-group">
          <h3>{group.domain}</h3>
          <ul className="plain explorations">
            {group.nodes.map((n) => (
              <li key={n.id}>
                <Link to={`/graph/${n.id}`}>{n.title}</Link> <span className="muted small">[{countDescendants(graph, n.id) + 1} nodes]</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function NewExploration({ domains }: { domains: string[] }) {
  const { mutate } = useStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState("");
  const [type, setType] = useState<NodeType>("question");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const created = await mutate(() => api.createNode({ type, title, domain }));
    if (created) navigate(`/graph/${created.node.id}`);
  };

  if (!open) {
    return (
      <p className="manual">
        <button className="link" onClick={() => setOpen(true)}>Or start an exploration by hand</button>
      </p>
    );
  }
  return (
    <section>
      <h2>Start by hand</h2>
      <form className="row wrap" onSubmit={submit}>
        <select value={type} onChange={(e) => setType(e.target.value as NodeType)} aria-label="Type">
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>{NODE_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <input className="grow" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Can Chain X have solver-latency arbitrage?" />
        <input list="domain-options-manual" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Domain" />
        <button className="btn primary" disabled={!title.trim()}>Create</button>
      </form>
      <datalist id="domain-options-manual">
        {domains.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </section>
  );
}
