import { useMemo } from "react";
import { Link } from "react-router";
import type { ExplorationNode, Graph, Source } from "../../src/domain/types";

export interface MapSidebarProps {
  graph: Graph;
  sources: Source[];
  activeDomain: string | null;
  onlyFrontiers: boolean;
  onSelectDomain: (domain: string | null) => void;
  onSelectFrontier: (nodeId: string) => void;
  onToggleOnlyFrontiers: () => void;
  onOpenImport: () => void;
}

export function MapSidebar(props: MapSidebarProps) {
  const { graph, sources, activeDomain, onlyFrontiers, onSelectDomain, onSelectFrontier, onToggleOnlyFrontiers, onOpenImport } = props;

  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of graph.nodes) {
      const key = n.domain || "General";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [graph.nodes]);

  const scopedNodes = useMemo(
    () => (activeDomain === null ? graph.nodes : graph.nodes.filter((n) => (n.domain || "General") === activeDomain)),
    [graph.nodes, activeDomain],
  );

  const frontiers = useMemo<ExplorationNode[]>(
    () => scopedNodes.filter((n) => n.frontier !== null),
    [scopedNodes],
  );

  const scopedSources = useMemo(() => {
    const referenced = new Set<string>();
    for (const n of scopedNodes) {
      if (n.provenance.sourceId) referenced.add(n.provenance.sourceId);
      for (const id of n.sourceRefs) referenced.add(id);
    }
    if (activeDomain === null) return sources;
    return sources.filter((s) => referenced.has(s.id));
  }, [scopedNodes, sources, activeDomain]);

  return (
    <aside className="left-sidebar">
      <div className="sidebar-section">
        <div className="sidebar-title">Maps</div>
        <button className={`sidebar-nav${activeDomain === null ? " active" : ""}`} onClick={() => onSelectDomain(null)}>
          <span>◈ All maps</span>
          <span className="sidebar-count">{graph.nodes.length}</span>
        </button>
        {domainCounts.map(([domain, count]) => (
          <button
            key={domain}
            className={`sidebar-nav${activeDomain === domain ? " active" : ""}`}
            onClick={() => onSelectDomain(domain)}
          >
            <span className="truncate">◇ {domain}</span>
            <span className="sidebar-count">{count}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Frontier · {frontiers.length}</div>
        {frontiers.length === 0 ? (
          <p className="muted small">No open frontiers in this map.</p>
        ) : (
          <div className="sidebar-list">
            {frontiers.map((n) => (
              <button key={n.id} className="sidebar-card" onClick={() => onSelectFrontier(n.id)}>
                <strong className="sidebar-card-title">↗ {n.title}</strong>
                <span className="muted small">{n.frontier?.nextAction || "Continue exploring →"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">Materials · {scopedSources.length}</div>
        {scopedSources.length === 0 ? (
          <p className="muted small">No materials yet.</p>
        ) : (
          <div className="sidebar-list">
            {scopedSources.map((s) => (
              <Link key={s.id} to={`/sources/${s.id}`} className="sidebar-doc">
                <span className="doc-badge">{s.kind === "markdown" ? "MD" : s.kind === "conversation" ? "CHAT" : "TXT"}</span>
                <span className="truncate">{s.name}</span>
              </Link>
            ))}
          </div>
        )}
        <button className="btn ghost small sidebar-add" onClick={onOpenImport}>
          + Import material
        </button>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-title">View</div>
        <button className={`sidebar-nav${onlyFrontiers ? " active" : ""}`} onClick={onToggleOnlyFrontiers}>
          <span>◉ Frontier only</span>
        </button>
      </div>
    </aside>
  );
}
