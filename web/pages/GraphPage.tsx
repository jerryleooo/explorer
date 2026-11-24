import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ancestorPath, focusView } from "../../src/domain/graph";
import { NODE_TYPES, type NodeType } from "../../src/domain/types";
import { api } from "../api";
import { GraphCanvas, type Selection } from "../components/GraphCanvas";
import { ImportPanel } from "../components/ImportPanel";
import { MapSidebar } from "../components/MapSidebar";
import { useGraphShortcuts } from "../components/useGraphShortcuts";
import { ShortcutHelp, Workspace } from "../components/Workspace";
import { NODE_TYPE_LABEL } from "../labels";
import { useStore } from "../store";

export function GraphPage() {
  const { nodeId, domain: rawDomain } = useParams();
  const mapDomain = rawDomain ? decodeURIComponent(rawDomain) : null;
  const isFocusMode = Boolean(nodeId);

  const { graph, proposals, sources, aiExtraction, mutate, refresh, setNotice } = useStore();
  const navigate = useNavigate();

  const [depth, setDepth] = useState(2);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [onlyFrontiers, setOnlyFrontiers] = useState(false);
  const [selection, setSelection] = useState<Selection>(nodeId ? { kind: "node", id: nodeId } : null);
  const [centerTarget, setCenterTarget] = useState<{ id: string; seq: number } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exploring, setExploring] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<NodeType>("question");
  const [newDomain, setNewDomain] = useState("");

  useEffect(() => {
    if (nodeId) {
      setSelection({ kind: "node", id: nodeId });
      setExpanded(new Set());
      setCollapsed(new Set());
    } else if (graph) {
      const scoped = mapDomain ? graph.nodes.filter((n) => (n.domain || "General") === mapDomain) : graph.nodes;
      const preferred = scoped.find((n) => n.frontier) ?? scoped[0];
      setSelection(preferred ? { kind: "node", id: preferred.id } : null);
    }
  }, [nodeId, mapDomain]);

  const domains = useMemo(() => [...new Set((graph?.nodes ?? []).map((n) => n.domain).filter(Boolean))].sort(), [graph]);
  const focusNode = nodeId ? graph?.nodes.find((n) => n.id === nodeId) : undefined;
  const activeDomain = isFocusMode ? (focusNode ? focusNode.domain || "General" : null) : mapDomain;

  const focusResult = useMemo(
    () => (graph && nodeId ? focusView(graph, nodeId, { depth, expanded, collapsed }) : null),
    [graph, nodeId, depth, expanded, collapsed],
  );

  const visible = useMemo(() => {
    if (!graph) return new Set<string>();
    let base: Set<string>;
    if (isFocusMode && focusResult) {
      base = new Set(focusResult.visible);
    } else if (mapDomain) {
      base = new Set(graph.nodes.filter((n) => (n.domain || "General") === mapDomain).map((n) => n.id));
    } else {
      base = new Set(graph.nodes.map((n) => n.id));
    }
    if (onlyFrontiers) {
      const selectedId = selection?.kind === "node" ? selection.id : null;
      return new Set(
        graph.nodes
          .filter((n) => base.has(n.id) && (n.frontier !== null || n.id === selectedId))
          .map((n) => n.id),
      );
    }
    return base;
  }, [graph, isFocusMode, focusResult, mapDomain, onlyFrontiers, selection]);

  const path = useMemo(() => (graph && nodeId ? ancestorPath(graph, nodeId) : []), [graph, nodeId]);
  const titleOf = (id: string) => graph?.nodes.find((n) => n.id === id)?.title ?? "";
  const selectedNode = selection?.kind === "node" ? graph?.nodes.find((n) => n.id === selection.id) : undefined;

  const centerNode = useCallback((id: string) => {
    setSelection({ kind: "node", id });
    setCenterTarget((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const toggleBranch = useCallback((id: string) => {
    setCollapsed((c) => {
      if (!c.has(id)) return c;
      const next = new Set(c);
      next.delete(id);
      return next;
    });
    setExpanded((e) => new Set(e).add(id));
  }, []);

  const collapseSelected = () => {
    if (!selectedNode) return;
    setExpanded((e) => {
      const next = new Set(e);
      next.delete(selectedNode.id);
      return next;
    });
    setCollapsed((c) => new Set(c).add(selectedNode.id));
  };

  const handleExploreNext = useCallback(
    async (targetId: string) => {
      setExploring(true);
      try {
        const proposal = await api.exploreNext(targetId, aiExtraction);
        await refresh();
        navigate(`/proposals/${proposal.id}`);
      } catch (e) {
        setNotice(`Explore next failed: ${(e as Error).message}`);
      } finally {
        setExploring(false);
      }
    },
    [aiExtraction, navigate, refresh, setNotice],
  );

  const handleCreateNode = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const domainValue = newDomain.trim() || (activeDomain && activeDomain !== "General" ? activeDomain : "");
    const created = await mutate(() => api.createNode({ type: newType, title: newTitle, domain: domainValue }));
    if (created) {
      setNewTitle("");
      setShowAddModal(false);
      centerNode(created.node.id);
    }
  };

  useGraphShortcuts(
    useMemo(
      () => ({
        addChild: () => document.getElementById("quick-add-title")?.focus(),
        toggleFrontier: () => {
          if (selectedNode) void mutate(() => (selectedNode.frontier ? api.clearFrontier(selectedNode.id) : api.setFrontier(selectedNode.id, {})));
        },
        open: () => selectedNode && navigate(`/graph/${selectedNode.id}`),
        remove: () => {
          if (selection?.kind === "edge") void mutate(() => api.deleteEdge(selection.id)).then(() => setSelection(null));
          else if (selectedNode && confirm(`Delete "${selectedNode.title}"?`)) {
            void mutate(() => api.deleteNode(selectedNode.id)).then(() => {
              if (nodeId && selectedNode.id === nodeId) navigate("/map");
              else setSelection(null);
            });
          }
        },
        escape: () => {
          if (showAddModal) setShowAddModal(false);
          else if (showImportModal) setShowImportModal(false);
          else setSelection(null);
        },
        deeper: () => isFocusMode && setDepth((d) => Math.min(d + 1, 8)),
        shallower: () => isFocusMode && setDepth((d) => Math.max(d - 1, 1)),
      }),
      [selectedNode, selection, mutate, navigate, nodeId, isFocusMode, showAddModal, showImportModal],
    ),
  );

  if (!graph) return <main className="page"><p className="muted">Loading…</p></main>;
  if (isFocusMode && focusResult && focusResult.visible.size === 0) {
    return (
      <main className="page">
        <p>This node no longer exists. <Link to="/">Back to frontiers</Link></p>
      </main>
    );
  }

  const exploreTargetId = selectedNode?.id ?? nodeId ?? graph.nodes.find((n) => visible.has(n.id))?.id;
  const visibleNodes = graph.nodes.filter((n) => visible.has(n.id));
  const frontierCount = visibleNodes.filter((n) => n.frontier !== null).length;

  return (
    <>
      <Workspace
        graph={graph}
        selection={selection}
        mutate={mutate}
        onSelect={setSelection}
        onCenterNode={centerNode}
        onExploreNext={(id) => void handleExploreNext(id)}
        emptyInspector={<ShortcutHelp />}
        leftSidebar={
          <MapSidebar
            graph={graph}
            sources={sources}
            activeDomain={activeDomain}
            onlyFrontiers={onlyFrontiers}
            onSelectDomain={(domain) => {
              setOnlyFrontiers(false);
              navigate(domain ? `/map/${encodeURIComponent(domain)}` : "/map");
            }}
            onSelectFrontier={(id) => {
              if (visible.has(id)) centerNode(id);
              else navigate(`/graph/${id}`);
            }}
            onToggleOnlyFrontiers={() => setOnlyFrontiers((v) => !v)}
            onOpenImport={() => setShowImportModal(true)}
          />
        }
        toolbar={
          <>
            <div className="row grow" style={{ minWidth: 0 }}>
              {isFocusMode ? (
                <nav className="breadcrumbs" aria-label="Exploration path">
                  {path.map((id, i) => (
                    <span key={id}>
                      {i > 0 && <span className="sep">›</span>}
                      {id === nodeId ? <strong>{titleOf(id)}</strong> : <Link to={`/graph/${id}`}>{titleOf(id)}</Link>}
                    </span>
                  ))}
                </nav>
              ) : (
                <div className="row">
                  <strong>{mapDomain ?? "All maps"}</strong>
                  <span className="muted small">
                    {visibleNodes.length} nodes · {frontierCount} frontiers
                  </span>
                </div>
              )}
              {proposals.length > 0 && (
                <Link to={`/proposals/${proposals[0]!.id}`} className="pending-pill">
                  ✦ {proposals.length} pending review →
                </Link>
              )}
            </div>
            <div className="row">
              <button className="btn small" onClick={() => setShowAddModal(true)}>+ Node</button>
              {exploreTargetId && (
                <button
                  className="btn primary small"
                  disabled={exploring}
                  onClick={() => void handleExploreNext(exploreTargetId)}
                >
                  {exploring ? "Exploring…" : "✦ Explore next layer"}
                </button>
              )}
              {selectedNode && selectedNode.id !== nodeId && (
                <button className="btn ghost small" onClick={() => navigate(`/graph/${selectedNode.id}`)}>Focus</button>
              )}
              {isFocusMode && selectedNode && (
                <button className="btn ghost small" onClick={collapseSelected}>Collapse</button>
              )}
              {isFocusMode && (
                <>
                  <span className="muted small">Depth</span>
                  <button className="btn ghost small" onClick={() => setDepth((d) => Math.max(d - 1, 1))} aria-label="Less depth">−</button>
                  <span>{depth}</span>
                  <button className="btn ghost small" onClick={() => setDepth((d) => Math.min(d + 1, 8))} aria-label="More depth">+</button>
                </>
              )}
            </div>
          </>
        }
        canvas={
          <GraphCanvas
            key={nodeId ? `focus-${nodeId}` : `map-${mapDomain ?? "all"}`}
            graph={graph}
            visible={visible}
            hiddenBelow={focusResult?.hiddenBelow}
            collapsed={isFocusMode ? collapsed : undefined}
            focusId={nodeId}
            selection={selection}
            centerTarget={centerTarget}
            onSelect={setSelection}
            onOpen={(id) => navigate(`/graph/${id}`)}
            onConnect={(sourceId, targetId) => void mutate(() => api.createEdge({ sourceId, targetId, type: "led_to" }))}
            onNodeMove={(id, x, y) => void mutate(() => api.updateNode(id, { x, y }))}
            onToggleBranch={isFocusMode ? toggleBranch : undefined}
          />
        }
      />

      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Create node</h3>
            <form className="stack" onSubmit={handleCreateNode}>
              <label className="field">
                <span>Title</span>
                <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="A question, hypothesis, or finding…" />
              </label>
              <div className="row">
                <label className="field grow">
                  <span>Type</span>
                  <select value={newType} onChange={(e) => setNewType(e.target.value as NodeType)}>
                    {NODE_TYPES.map((t) => (
                      <option key={t} value={t}>{NODE_TYPE_LABEL[t]}</option>
                    ))}
                  </select>
                </label>
                <label className="field grow">
                  <span>Domain</span>
                  <input
                    list="add-node-domains"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder={activeDomain && activeDomain !== "General" ? activeDomain : "Optional"}
                  />
                  <datalist id="add-node-domains">
                    {domains.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                </label>
              </div>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
                <button className="btn ghost" type="button" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button className="btn primary" type="submit" disabled={!newTitle.trim()}>Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-backdrop" onClick={() => setShowImportModal(false)}>
          <div className="modal-card wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Import research material</h3>
              <button className="btn ghost small" type="button" onClick={() => setShowImportModal(false)}>×</button>
            </div>
            <ImportPanel domains={domains} />
          </div>
        </div>
      )}
    </>
  );
}
