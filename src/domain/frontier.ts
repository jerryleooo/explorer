import type { ExplorationNode, FrontierState, Level } from "./types";

export type FrontierNode = ExplorationNode & { frontier: FrontierState };
export type FrontierSort = "priority" | "freshness" | "stale" | "potential" | "uncertainty";

const LEVEL_RANK: Record<Level, number> = { low: 1, medium: 2, high: 3 };

export function levelRank(level: Level | null): number {
  return level ? LEVEL_RANK[level] : 0;
}

export function frontiersOf(nodes: ExplorationNode[]): FrontierNode[] {
  return nodes.filter((n): n is FrontierNode => n.frontier !== null);
}

/**
 * Deliberately simple ranking: unblocked, high-potential, high-uncertainty frontiers first,
 * most recently explored breaking ties so "Continue" resumes the freshest thread.
 */
export function priorityScore(node: FrontierNode): number {
  const f = node.frontier;
  const blocked = node.status === "blocked" || Boolean(f.blockedBy);
  return (levelRank(f.potential) || 1) * (levelRank(f.uncertainty) || 1) * (blocked ? 0.5 : 1);
}

export function sortFrontiers(nodes: FrontierNode[], sort: FrontierSort): FrontierNode[] {
  const byRecent = (a: FrontierNode, b: FrontierNode) => b.frontier.lastExploredAt.localeCompare(a.frontier.lastExploredAt);
  const compare: Record<FrontierSort, (a: FrontierNode, b: FrontierNode) => number> = {
    priority: (a, b) => priorityScore(b) - priorityScore(a) || byRecent(a, b),
    freshness: byRecent,
    stale: (a, b) => -byRecent(a, b),
    potential: (a, b) => levelRank(b.frontier.potential) - levelRank(a.frontier.potential) || byRecent(a, b),
    uncertainty: (a, b) => levelRank(b.frontier.uncertainty) - levelRank(a.frontier.uncertainty) || byRecent(a, b),
  };
  return [...nodes].sort(compare[sort]);
}

export function groupByDomain<T extends ExplorationNode>(nodes: T[]): Array<{ domain: string; nodes: T[] }> {
  const groups = new Map<string, T[]>();
  for (const n of nodes) {
    const key = n.domain || "Uncategorized";
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return [...groups].map(([domain, nodes]) => ({ domain, nodes }));
}
