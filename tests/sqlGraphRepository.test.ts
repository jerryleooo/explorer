import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../src/domain/repository";
import { SqlGraphRepository } from "../src/storage/sqlGraphRepository";
import { NodeSqliteDatabase } from "./nodeSqlite";

let clock: Date;
let repo: SqlGraphRepository;

function advance(minutes: number) {
  clock = new Date(clock.getTime() + minutes * 60_000);
}

beforeEach(() => {
  clock = new Date("2026-10-30T10:00:00.000Z");
  repo = new SqlGraphRepository(new NodeSqliteDatabase(), { now: () => clock });
});

describe("nodes and edges", () => {
  it("creates a child node with a typed edge and inherits the parent's domain", async () => {
    const { node: root } = await repo.createNode({ type: "question", title: "Why the spread?", domain: "Arbitrage" });
    const { node: child, edge } = await repo.createNode({
      type: "hypothesis",
      title: "Thin liquidity",
      parent: { nodeId: root.id, edgeType: "led_to" },
    });

    expect(child.domain).toBe("Arbitrage");
    expect(edge).toMatchObject({ sourceId: root.id, targetId: child.id, type: "led_to" });
    const graph = await repo.getGraph();
    expect(graph.nodes.map((n) => n.title)).toEqual(["Why the spread?", "Thin liquidity"]);
    expect(graph.edges).toHaveLength(1);
  });

  it("allows multiple parents (a DAG, not a tree)", async () => {
    const { node: a } = await repo.createNode({ type: "question", title: "A" });
    const { node: b } = await repo.createNode({ type: "question", title: "B" });
    const { node: c } = await repo.createNode({ type: "finding", title: "C", parent: { nodeId: a.id, edgeType: "led_to" } });
    await repo.createEdge({ sourceId: b.id, targetId: c.id, type: "supports" });

    const graph = await repo.getGraph();
    expect(graph.edges.filter((e) => e.targetId === c.id)).toHaveLength(2);
  });

  it("rejects self edges, empty titles and unknown nodes", async () => {
    const { node } = await repo.createNode({ type: "question", title: "A" });
    await expect(repo.createEdge({ sourceId: node.id, targetId: node.id, type: "led_to" })).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.createNode({ type: "question", title: "  " })).rejects.toBeInstanceOf(ValidationError);
    await expect(repo.updateNode("missing", { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records the stop reason when a branch is closed", async () => {
    const { node } = await repo.createNode({ type: "hypothesis", title: "Oracle lag" });
    const updated = await repo.updateNode(node.id, { status: "rejected", stopNote: "Contradicted by block data", confidence: 0.8 });

    expect(updated).toMatchObject({ status: "rejected", stopNote: "Contradicted by block data", confidence: 0.8 });
    expect(await repo.getNode(node.id)).toMatchObject({ status: "rejected", stopNote: "Contradicted by block data" });
  });

  it("deletes a node together with its edges and frontier", async () => {
    const { node: a } = await repo.createNode({ type: "question", title: "A" });
    const { node: b } = await repo.createNode({ type: "question", title: "B", parent: { nodeId: a.id, edgeType: "led_to" } });
    await repo.setFrontier(b.id, { potential: "high" });

    await repo.deleteNode(b.id);
    const graph = await repo.getGraph();
    expect(graph.nodes.map((n) => n.id)).toEqual([a.id]);
    expect(graph.edges).toEqual([]);
  });
});

describe("frontiers", () => {
  it("marks, updates and clears a frontier", async () => {
    const { node } = await repo.createNode({ type: "opportunity", title: "USDC redemption latency" });
    const marked = await repo.setFrontier(node.id, { potential: "medium", blockedBy: "withdrawal-status monitoring" });
    expect(marked.frontier).toMatchObject({ potential: "medium", blockedBy: "withdrawal-status monitoring", lastExploredAt: clock.toISOString() });

    advance(60);
    const edited = await repo.setFrontier(node.id, { nextAction: "build monitor" });
    expect(edited.frontier).toMatchObject({ potential: "medium", nextAction: "build monitor", lastExploredAt: "2026-10-30T10:00:00.000Z" });

    const cleared = await repo.clearFrontier(node.id);
    expect(cleared.frontier).toBeNull();
    expect((await repo.getNode(node.id))?.frontier).toBeNull();
  });

  it("refreshes lastExploredAt when the frontier is branched from", async () => {
    const { node } = await repo.createNode({ type: "question", title: "Solver latency" });
    await repo.setFrontier(node.id, { potential: "high" });
    advance(60 * 24);
    await repo.createNode({ type: "hypothesis", title: "Only near liquidations", parent: { nodeId: node.id, edgeType: "led_to" } });

    expect((await repo.getNode(node.id))?.frontier?.lastExploredAt).toBe(clock.toISOString());
  });
});

describe("sessions and provenance", () => {
  it("attributes mutations to the active session and summarizes on end", async () => {
    const before = await repo.createNode({ type: "question", title: "Outside session" });
    const session = await repo.startSession("Chain X solver latency");
    await expect(repo.startSession("another")).rejects.toBeInstanceOf(ValidationError);

    const { node } = await repo.createNode({ type: "finding", title: "Competition strong", parent: { nodeId: before.node.id, edgeType: "led_to" } });
    await repo.setFrontier(node.id, { potential: "high" });

    const ended = await repo.endSession(session.id);
    expect(ended.summary).toBe("1 node created, 1 edge created, 1 frontier created");
    expect(await repo.getActiveSession()).toBeNull();

    const nodeHistory = await repo.listEvents({ entityId: before.node.id });
    expect(nodeHistory).toHaveLength(1);
    expect(nodeHistory[0]?.sessionId).toBeNull();
  });

  it("keeps before/after snapshots so prior state is recoverable", async () => {
    const { node } = await repo.createNode({ type: "hypothesis", title: "v1" });
    await repo.updateNode(node.id, { title: "v2", status: "parked", stopNote: "low priority" });

    const events = await repo.listEvents({ entityId: node.id });
    expect(events.map((e) => e.eventType)).toEqual(["created", "updated"]);
    expect(events[1]?.before).toMatchObject({ title: "v1", status: "open" });
    expect(events[1]?.after).toMatchObject({ title: "v2", status: "parked" });
  });

  it("exports the full graph with history", async () => {
    const { node } = await repo.createNode({ type: "question", title: "A" });
    await repo.setFrontier(node.id, {});
    const exported = await repo.exportAll();
    expect(exported).toMatchObject({ version: 1, nodes: [{ id: node.id }], edges: [], sessions: [] });
    expect(exported.events).toHaveLength(2);
  });
});
