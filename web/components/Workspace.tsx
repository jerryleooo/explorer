import { ReactFlowProvider } from "@xyflow/react";
import type { ReactNode } from "react";
import type { Graph } from "../../src/domain/types";
import { EdgeInspector, NodeInspector, type Mutate } from "./Inspector";
import type { Selection } from "./GraphCanvas";

/** Optional left sidebar + canvas in center + inspector on right. */
export function Workspace(props: {
  toolbar: ReactNode;
  leftSidebar?: ReactNode;
  canvas: ReactNode;
  aside?: ReactNode;
  graph: Graph;
  selection: Selection;
  mutate: Mutate;
  onSelect: (s: Selection) => void;
  onCenterNode?: (id: string) => void;
  onAcceptNode?: (id: string) => void;
  onExploreNext?: (id: string) => void;
  emptyInspector: ReactNode;
}) {
  const { toolbar, leftSidebar, canvas, aside, graph, selection, mutate, onSelect, onCenterNode, onAcceptNode, onExploreNext, emptyInspector } = props;
  const node = selection?.kind === "node" ? graph.nodes.find((n) => n.id === selection.id) : undefined;
  const edge = selection?.kind === "edge" ? graph.edges.find((e) => e.id === selection.id) : undefined;
  return (
    <main className={`workspace${leftSidebar ? " with-sidebar" : ""}`}>
      <div className="toolbar">{toolbar}</div>
      {leftSidebar}
      <div className="canvas">
        <ReactFlowProvider>{canvas}</ReactFlowProvider>
      </div>
      <aside className="side">
        {aside}
        {node ? (
          <NodeInspector
            key={node.id}
            node={node}
            graph={graph}
            mutate={mutate}
            onSelectNode={(id) => onSelect({ kind: "node", id })}
            onCenterNode={onCenterNode}
            onAcceptNode={onAcceptNode}
            onExploreNext={onExploreNext}
            onDeleted={() => onSelect(null)}
          />
        ) : edge ? (
          <EdgeInspector key={edge.id} edge={edge} graph={graph} mutate={mutate} onDeleted={() => onSelect(null)} />
        ) : (
          emptyInspector
        )}
      </aside>
    </main>
  );
}

export function ShortcutHelp() {
  return (
    <div className="inspector muted small">
      <p>Click a node to inspect it. Drag nodes to arrange and persist coordinates. Drag from a node's right edge to another node to connect them.</p>
      <ul className="plain kbd-list">
        <li><kbd>N</kbd> add branch</li>
        <li><kbd>F</kbd> toggle frontier</li>
        <li><kbd>↵</kbd> focus selected</li>
        <li><kbd>⌫</kbd> delete selected</li>
        <li><kbd>[</kbd> <kbd>]</kbd> depth</li>
        <li><kbd>/</kbd> search</li>
      </ul>
    </div>
  );
}
