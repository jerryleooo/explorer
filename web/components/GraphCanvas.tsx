import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStore as useFlowStore,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import type { ExplorationEdge, ExplorationNode, Graph, NodeType } from "../../src/domain/types";
import { EDGE_TYPE_LABEL, NODE_TYPE_LABEL, STATUS_LABEL, authorshipMark } from "../labels";

export type Selection = { kind: "node" | "edge"; id: string } | null;

interface CardData extends Record<string, unknown> {
  node: ExplorationNode;
  isFocus: boolean;
  hiddenBelow: number;
  collapsed: boolean;
  /** Draft nodes of a proposal render dashed until accepted. */
  draft: boolean;
  /** Long-term nodes shown inside a proposal for context. */
  existing: boolean;
  onToggleBranch?: (id: string) => void;
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 92;

const MINIMAP_COLORS: Record<NodeType, string> = {
  question: "#2f6fd6",
  hypothesis: "#8250c4",
  evidence: "#12877a",
  experiment: "#b8770b",
  finding: "#2e8540",
  opportunity: "#c2417a",
};

function layout(nodes: ExplorationNode[], edges: ExplorationEdge[]): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.sourceId, e.targetId);
  dagre.layout(g);
  return new Map(
    nodes.map((n) => {
      const p = g.node(n.id);
      return [n.id, { x: Math.round((p.x - NODE_WIDTH / 2) / 4) * 4, y: Math.round((p.y - NODE_HEIGHT / 2) / 4) * 4 }];
    }),
  );
}

function NodeCard({ data, selected }: NodeProps<Node<CardData>>) {
  const { node, isFocus, hiddenBelow, collapsed, draft, existing, onToggleBranch } = data;
  // Semantic zoom: far out, only the title remains, larger.
  const compact = useFlowStore((s) => s.transform[2] < 0.55);
  const mark = authorshipMark(node.authorship);
  const classes = ["card", `type-${node.type}`, `status-${node.status}`];
  if (isFocus) classes.push("focus");
  if (selected) classes.push("selected");
  if (draft) classes.push("draft");
  if (node.frontier) classes.push("frontier");
  if (node.pinned) classes.push("pinned");
  if (compact) classes.push("compact");

  return (
    <div className={classes.join(" ")}>
      <Handle type="target" position={Position.Left} />
      {!compact && (
        <div className="card-meta">
          <span className="type-dot" />
          <span>{NODE_TYPE_LABEL[node.type]}</span>
          {mark && <span className="ai-mark" title={node.authorship === "ai" ? "AI generated" : "Human + AI"}>{mark}</span>}
          {existing && <span className="tag">existing</span>}
          {node.status !== "open" && <span className={`status status-${node.status}`}>{STATUS_LABEL[node.status]}</span>}
          {node.frontier && <span className="frontier-pill">◎ frontier</span>}
          {node.pinned && <span className="pin-badge" title="Position locked">⌖</span>}
        </div>
      )}
      <div className="card-title">{node.title}</div>
      {!compact && node.frontier?.nextAction && <div className="card-sub">→ {node.frontier.nextAction}</div>}
      {onToggleBranch && (hiddenBelow > 0 || collapsed) && (
        <button
          className="branch-toggle nodrag"
          onClick={(e) => {
            e.stopPropagation();
            onToggleBranch(node.id);
          }}
          title={collapsed ? "Expand branch" : "Show hidden nodes"}
        >
          +{hiddenBelow} {hiddenBelow === 1 ? "node" : "nodes"}
        </button>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { card: NodeCard };

export interface GraphCanvasProps {
  graph: Graph;
  visible?: ReadonlySet<string>;
  hiddenBelow?: ReadonlyMap<string, number>;
  collapsed?: ReadonlySet<string>;
  focusId?: string;
  selection: Selection;
  centerTarget?: { id: string; seq: number } | null;
  onSelect: (selection: Selection) => void;
  onOpen?: (nodeId: string) => void;
  onConnect: (sourceId: string, targetId: string) => void;
  onNodeMove?: (nodeId: string, x: number, y: number) => void;
  onToggleBranch?: (nodeId: string) => void;
}

export function GraphCanvas(props: GraphCanvasProps) {
  const { graph, visible, hiddenBelow, collapsed, focusId, selection, centerTarget, onSelect, onOpen, onConnect, onNodeMove, onToggleBranch } = props;
  const { setCenter, getNode } = useReactFlow();
  const shownNodes = useMemo(() => graph.nodes.filter((n) => !visible || visible.has(n.id)), [graph.nodes, visible]);
  const shownIds = useMemo(() => new Set(shownNodes.map((n) => n.id)), [shownNodes]);
  const shownEdges = useMemo(
    () => graph.edges.filter((e) => shownIds.has(e.sourceId) && shownIds.has(e.targetId)),
    [graph.edges, shownIds],
  );
  const positions = useMemo(() => layout(shownNodes, shownEdges), [shownNodes, shownEdges]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CardData>>([]);

  useEffect(() => {
    setNodes((previous) => {
      // Precedence: persisted coordinates > previously dragged in session > dagre fallback.
      const prior = new Map(previous.map((n) => [n.id, n.position]));
      return shownNodes.map((node) => ({
        id: node.id,
        type: "card",
        draggable: !node.pinned,
        position:
          node.x != null && node.y != null
            ? { x: node.x, y: node.y }
            : (prior.get(node.id) ?? positions.get(node.id)!),
        selected: selection?.kind === "node" && selection.id === node.id,
        data: {
          node,
          isFocus: node.id === focusId,
          hiddenBelow: hiddenBelow?.get(node.id) ?? 0,
          collapsed: collapsed?.has(node.id) ?? false,
          draft: node.proposalId !== null,
          existing: Boolean(graph.nodes.some((n) => n.proposalId) && node.proposalId === null),
          onToggleBranch,
        },
      }));
    });
  }, [shownNodes, positions, selection, focusId, hiddenBelow, collapsed, graph.nodes, onToggleBranch, setNodes]);

  useEffect(() => {
    if (!centerTarget) return;
    const rfNode = getNode(centerTarget.id);
    if (!rfNode) return;
    void setCenter(rfNode.position.x + NODE_WIDTH / 2, rfNode.position.y + NODE_HEIGHT / 2, { zoom: 1, duration: 280 });
  }, [centerTarget, getNode, setCenter]);

  const edges: Edge[] = useMemo(
    () =>
      shownEdges.map((e) => {
        const mark = authorshipMark(e.authorship);
        return {
          id: e.id,
          source: e.sourceId,
          target: e.targetId,
          label: `${EDGE_TYPE_LABEL[e.type]}${mark ? ` ${mark}` : ""}`,
          className: `edge-${e.type}${e.proposalId ? " edge-draft" : ""}`,
          selected: selection?.kind === "edge" && selection.id === e.id,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        };
      }),
    [shownEdges, selection],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => onSelect({ kind: "node", id: n.id })}
      onNodeDoubleClick={(_, n) => onOpen?.(n.id)}
      onNodeDragStop={(_, n) => {
        const domainNode = (n.data as CardData).node;
        if (domainNode.pinned || !onNodeMove) return;
        const x = Math.round(n.position.x / 4) * 4;
        const y = Math.round(n.position.y / 4) * 4;
        if (domainNode.x !== x || domainNode.y !== y) {
          onNodeMove(n.id, x, y);
        }
      }}
      onEdgeClick={(_, e) => onSelect({ kind: "edge", id: e.id })}
      onPaneClick={() => onSelect(null)}
      onConnect={(c) => c.source && c.target && onConnect(c.source, c.target)}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
      minZoom={0.15}
      deleteKeyCode={null}
      colorMode="system"
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => {
          const data = n.data as CardData | undefined;
          if (!data) return "#8f8a80";
          const color = MINIMAP_COLORS[data.node.type] ?? "#8f8a80";
          return data.draft ? `${color}77` : color;
        }}
        maskColor="var(--minimap-mask, rgba(0, 0, 0, 0.08))"
      />
    </ReactFlow>
  );
}
