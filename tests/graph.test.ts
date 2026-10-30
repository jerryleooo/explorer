import { describe, expect, it } from "vitest";
import { ancestorPath, countDescendants, focusView } from "../src/domain/graph";
import { sortFrontiers, type FrontierNode } from "../src/domain/frontier";
import type { Attribution, ExplorationEdge, ExplorationNode, Graph } from "../src/domain/types";

const human: Attribution = { authorship: "human", provenance: { generationType: "human" }, approvedByHuman: true, approvedAt: null };

function node(id: string, extra: Partial<ExplorationNode> = {}): ExplorationNode {
  return {
    id,
    proposalId: null,
    ...human,
    type: "question",
    title: id,
    body: "",
    status: "open",
    stopNote: null,
    confidence: null,
    domain: "",
    sourceRefs: [],
    createdAt: "",
    updatedAt: "",
    frontier: null,
    ...extra,
  };
}

function graphOf(pairs: Array<[string, string]>): Graph {
  const ids = new Set(pairs.flat());
  const edges: ExplorationEdge[] = pairs.map(([s, t], i) => ({ id: `e${i}`, proposalId: null, ...human, sourceId: s, targetId: t, type: "led_to", createdAt: "" }));
  return { nodes: [...ids].map((id) => node(id)), edges };
}

// root -> a -> b -> c -> d,  root -> x,  y -> b (second parent)
const deep = graphOf([
  ["root", "a"],
  ["a", "b"],
  ["b", "c"],
  ["c", "d"],
  ["root", "x"],
  ["y", "b"],
]);

describe("focusView", () => {
  const none = new Set<string>();

  it("shows ancestors and descendants within depth and counts hidden descendants", () => {
    const view = focusView(deep, "b", { depth: 1, expanded: none, collapsed: none });
    expect([...view.visible].sort()).toEqual(["a", "b", "c", "y"]);
    expect(view.hiddenBelow.get("c")).toBe(1);
  });

  it("expands a node beyond depth and collapses another", () => {
    const expanded = focusView(deep, "b", { depth: 1, expanded: new Set(["c"]), collapsed: none });
    expect(expanded.visible.has("d")).toBe(true);

    const collapsed = focusView(deep, "root", { depth: 4, expanded: none, collapsed: new Set(["a"]) });
    expect([...collapsed.visible].sort()).toEqual(["a", "root", "x"]);
    expect(collapsed.hiddenBelow.get("a")).toBe(3);
  });

  it("returns nothing for an unknown focus and survives cycles", () => {
    expect(focusView(deep, "nope", { depth: 2, expanded: none, collapsed: none }).visible.size).toBe(0);
    const cyclic = graphOf([["p", "q"], ["q", "p"]]);
    expect(focusView(cyclic, "p", { depth: 5, expanded: none, collapsed: none }).visible.size).toBe(2);
    expect(ancestorPath(cyclic, "p")).toEqual(["q", "p"]);
  });
});

describe("ancestorPath / countDescendants", () => {
  it("walks to a root through the first parent", () => {
    expect(ancestorPath(deep, "d")).toEqual(["root", "a", "b", "c", "d"]);
    expect(countDescendants(deep, "root")).toBe(5);
  });
});

describe("sortFrontiers", () => {
  const f = (id: string, potential: "low" | "medium" | "high", lastExploredAt: string, blockedBy: string | null = null): FrontierNode =>
    node(id, { frontier: { potential, uncertainty: "high", nextAction: null, blockedBy, reopenCondition: null, lastExploredAt, authorship: "human", generationType: "human", approvedByHuman: true } }) as FrontierNode;

  const items = [f("old-high", "high", "2026-09-01"), f("new-low", "low", "2026-10-29"), f("blocked-high", "high", "2026-10-30", "infra")];

  it("ranks unblocked high-potential frontiers first", () => {
    expect(sortFrontiers(items, "priority").map((n) => n.id)).toEqual(["old-high", "blocked-high", "new-low"]);
  });

  it("sorts by freshness and staleness", () => {
    expect(sortFrontiers(items, "freshness").map((n) => n.id)).toEqual(["blocked-high", "new-low", "old-high"]);
    expect(sortFrontiers(items, "stale")[0]?.id).toBe("old-high");
  });
});
