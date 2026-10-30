import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ancestorPath, focusView } from "../../src/domain/graph";
import { api } from "../api";
import { GraphCanvas, type Selection } from "../components/GraphCanvas";
import { useGraphShortcuts } from "../components/useGraphShortcuts";
import { ShortcutHelp, Workspace } from "../components/Workspace";
import { useStore } from "../store";

export function GraphPage() {
  const { nodeId = "" } = useParams();
  const { graph, mutate } = useStore();
  const navigate = useNavigate();
  const [depth, setDepth] = useState(2);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>({ kind: "node", id: nodeId });

  useEffect(() => {
    setSelection({ kind: "node", id: nodeId });
    setExpanded(new Set());
    setCollapsed(new Set());
  }, [nodeId]);

  const view = useMemo(() => (graph ? focusView(graph, nodeId, { depth, expanded, collapsed }) : null), [graph, nodeId, depth, expanded, collapsed]);
  const path = useMemo(() => (graph ? ancestorPath(graph, nodeId) : []), [graph, nodeId]);
  const titleOf = (id: string) => graph?.nodes.find((n) => n.id === id)?.title ?? "";
  const selectedNode = selection?.kind === "node" ? graph?.nodes.find((n) => n.id === selection.id) : undefined;

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
            void mutate(() => api.deleteNode(selectedNode.id)).then(() => navigate(selectedNode.id === nodeId ? "/" : `/graph/${nodeId}`));
          }
        },
        escape: () => setSelection(null),
        deeper: () => setDepth((d) => Math.min(d + 1, 8)),
        shallower: () => setDepth((d) => Math.max(d - 1, 1)),
      }),
      [selectedNode, selection, mutate, navigate, nodeId],
    ),
  );

  if (!graph || !view) return <main className="page"><p className="muted">Loading…</p></main>;
  if (view.visible.size === 0) {
    return (
      <main className="page">
        <p>This node no longer exists. <Link to="/">Back to frontiers</Link></p>
      </main>
    );
  }

  return (
    <Workspace
      graph={graph}
      selection={selection}
      mutate={mutate}
      onSelect={setSelection}
      emptyInspector={<ShortcutHelp />}
      toolbar={
        <>
          <nav className="breadcrumbs" aria-label="Exploration path">
            {path.map((id, i) => (
              <span key={id}>
                {i > 0 && <span className="sep">›</span>}
                {id === nodeId ? <strong>{titleOf(id)}</strong> : <Link to={`/graph/${id}`}>{titleOf(id)}</Link>}
              </span>
            ))}
          </nav>
          <div className="row">
            {selectedNode && selectedNode.id !== nodeId && (
              <button className="btn ghost small" onClick={() => navigate(`/graph/${selectedNode.id}`)}>Focus selected</button>
            )}
            {selectedNode && <button className="btn ghost small" onClick={collapseSelected}>Collapse branch</button>}
            <span className="muted small">Depth</span>
            <button className="btn ghost small" onClick={() => setDepth((d) => Math.max(d - 1, 1))} aria-label="Less depth">−</button>
            <span>{depth}</span>
            <button className="btn ghost small" onClick={() => setDepth((d) => Math.min(d + 1, 8))} aria-label="More depth">+</button>
          </div>
        </>
      }
      canvas={
        <GraphCanvas
          key={nodeId}
          graph={graph}
          visible={view.visible}
          hiddenBelow={view.hiddenBelow}
          collapsed={collapsed}
          focusId={nodeId}
          selection={selection}
          onSelect={setSelection}
          onOpen={(id) => navigate(`/graph/${id}`)}
          onConnect={(sourceId, targetId) => void mutate(() => api.createEdge({ sourceId, targetId, type: "led_to" }))}
          onToggleBranch={toggleBranch}
        />
      }
    />
  );
}
