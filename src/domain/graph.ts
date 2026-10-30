import type { ExplorationEdge, Graph } from "./types";

export interface GraphIndex {
  outgoing: Map<string, ExplorationEdge[]>;
  incoming: Map<string, ExplorationEdge[]>;
}

export function indexGraph(graph: Graph): GraphIndex {
  const outgoing = new Map<string, ExplorationEdge[]>();
  const incoming = new Map<string, ExplorationEdge[]>();
  for (const n of graph.nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of graph.edges) {
    outgoing.get(e.sourceId)?.push(e);
    incoming.get(e.targetId)?.push(e);
  }
  return { outgoing, incoming };
}

export interface FocusOptions {
  /** How many hops of ancestors and descendants to show around the focus. */
  depth: number;
  /** Nodes whose children are shown regardless of depth. */
  expanded: ReadonlySet<string>;
  /** Nodes whose descendants are hidden. */
  collapsed: ReadonlySet<string>;
}

export interface FocusView {
  visible: Set<string>;
  /** Visible node id -> number of descendants hidden beneath it. */
  hiddenBelow: Map<string, number>;
}

/** The local neighbourhood around a focused node, rather than the whole universe. */
export function focusView(graph: Graph, focusId: string, options: FocusOptions): FocusView {
  const index = indexGraph(graph);
  const visible = new Set<string>();
  if (!index.outgoing.has(focusId)) return { visible, hiddenBelow: new Map() };
  visible.add(focusId);

  let frontier = [focusId];
  for (let hop = 0; hop < options.depth; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of index.incoming.get(id) ?? []) {
        if (!visible.has(e.sourceId)) {
          visible.add(e.sourceId);
          next.push(e.sourceId);
        }
      }
    }
    frontier = next;
  }

  const queue: Array<{ id: string; hop: number }> = [{ id: focusId, hop: 0 }];
  const expandedFrom = new Set<string>();
  while (queue.length > 0) {
    const { id, hop } = queue.shift()!;
    if (expandedFrom.has(id) || options.collapsed.has(id)) continue;
    if (hop >= options.depth && !options.expanded.has(id)) continue;
    expandedFrom.add(id);
    for (const e of index.outgoing.get(id) ?? []) {
      visible.add(e.targetId);
      queue.push({ id: e.targetId, hop: hop + 1 });
    }
  }

  const hiddenBelow = new Map<string, number>();
  for (const id of visible) {
    const hidden = new Set<string>();
    const stack = (index.outgoing.get(id) ?? []).map((e) => e.targetId).filter((t) => !visible.has(t));
    while (stack.length > 0) {
      const t = stack.pop()!;
      if (hidden.has(t) || visible.has(t)) continue;
      hidden.add(t);
      for (const e of index.outgoing.get(t) ?? []) stack.push(e.targetId);
    }
    if (hidden.size > 0) hiddenBelow.set(id, hidden.size);
  }
  return { visible, hiddenBelow };
}

/** One path from a root down to the node, following the earliest parent at each step. */
export function ancestorPath(graph: Graph, nodeId: string): string[] {
  const index = indexGraph(graph);
  const path = [nodeId];
  const seen = new Set(path);
  let current = nodeId;
  for (;;) {
    const parent = index.incoming.get(current)?.find((e) => !seen.has(e.sourceId))?.sourceId;
    if (!parent) break;
    path.unshift(parent);
    seen.add(parent);
    current = parent;
  }
  return path;
}

export function countDescendants(graph: Graph, nodeId: string): number {
  const index = indexGraph(graph);
  const seen = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    for (const e of index.outgoing.get(stack.pop()!) ?? []) {
      if (!seen.has(e.targetId) && e.targetId !== nodeId) {
        seen.add(e.targetId);
        stack.push(e.targetId);
      }
    }
  }
  return seen.size;
}
