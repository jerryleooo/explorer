import { beforeEach, describe, expect, it } from "vitest";
import type { Extraction } from "../src/domain/types";
import type { GraphExtractor } from "../src/import/extraction";
import { sanitizeExtraction } from "../src/import/extraction";
import { HeuristicExtractor } from "../src/import/heuristicExtractor";
import { importSource } from "../src/import/importSource";
import { similarity } from "../src/import/similarity";
import { SqlGraphRepository } from "../src/storage/sqlGraphRepository";
import { NodeSqliteDatabase } from "./nodeSqlite";

let repo: SqlGraphRepository;
beforeEach(() => {
  repo = new SqlGraphRepository(new NodeSqliteDatabase(), { now: () => new Date("2026-10-30T10:00:00.000Z") });
});

const NOTES = `# Arbitrage
Q: Is the spread a real opportunity?
- Hypothesis: thin liquidity
  - Evidence: historical spread data widens at night
- Hypothesis: withdrawal latency
Conclusion: spread correlates with withdrawal suspension
Next: check three other exchanges
Some plain prose that should be ignored.`;

/** Stands in for an AI extractor: one extracted finding, one AI-generated frontier. */
class FakeAiExtractor implements GraphExtractor {
  readonly info = { capabilityId: "extract-exploration-graph", capabilityVersion: "1", model: "claude-test" };
  constructor(private readonly extra: Partial<Extraction> = {}) {}
  async extract(): Promise<Extraction> {
    return {
      domain: "Arbitrage",
      nodes: [
        {
          key: "f1",
          type: "finding",
          title: "Spread expands during withdrawal suspension",
          body: "",
          generationType: "ai_extracted",
          confidence: 0.9,
          anchor: { lineStart: 6, lineEnd: 6, quote: "made up quote" },
          frontier: null,
        },
        {
          key: "h1",
          type: "hypothesis",
          title: "Inventory imbalance",
          body: "",
          generationType: "ai_generated",
          confidence: 0.5,
          anchor: null,
          frontier: { nextAction: "Compare across exchanges", potential: "high", uncertainty: "high" },
        },
      ],
      edges: [
        { sourceKey: "f1", targetKey: "h1", type: "led_to", generationType: "ai_generated" },
        { sourceKey: "f1", targetKey: "ghost", type: "led_to", generationType: "ai_generated" },
      ],
      mergeCandidates: [],
      extractor: { ...this.info, traceId: "msg_1" },
      ...this.extra,
    };
  }
}

describe("structural import (no AI)", () => {
  it("builds a nested reasoning map from labelled lines and keeps it human-authored", async () => {
    const proposal = await importSource(repo, new HeuristicExtractor(), { kind: "markdown", name: "notes.md", content: NOTES });
    const { graph } = await repo.getProposal(proposal.id);
    const title = (id: string) => graph.nodes.find((n) => n.id === id)?.title;

    expect(graph.nodes.map((n) => [n.type, n.title])).toEqual([
      ["question", "Is the spread a real opportunity?"],
      ["hypothesis", "thin liquidity"],
      ["evidence", "historical spread data widens at night"],
      ["hypothesis", "withdrawal latency"],
      ["finding", "spread correlates with withdrawal suspension"],
      ["question", "check three other exchanges"],
    ]);
    expect(graph.edges.map((e) => `${title(e.sourceId)} -${e.type}-> ${title(e.targetId)}`)).toContain(
      "thin liquidity -supports-> historical spread data widens at night",
    );
    expect(graph.nodes.every((n) => n.authorship === "human" && n.provenance.generationType === "import")).toBe(true);
    expect(graph.nodes[0]?.provenance.anchor).toEqual({ lineStart: 2, lineEnd: 2, quote: "Q: Is the spread a real opportunity?" });
    expect(graph.nodes.at(-1)?.frontier).toMatchObject({ nextAction: null, authorship: "human", generationType: "import" });
  });
});

describe("AI proposals", () => {
  it("keeps drafts out of the long-term graph until accepted, and acceptance never changes authorship", async () => {
    const proposal = await importSource(repo, new FakeAiExtractor(), { kind: "text", name: "chat.txt", content: NOTES });
    expect((await repo.getGraph()).nodes).toHaveLength(0);

    const { graph } = await repo.getProposal(proposal.id);
    expect(graph.edges).toHaveLength(1); // dangling edge dropped
    const finding = graph.nodes.find((n) => n.type === "finding")!;
    expect(finding.provenance.anchor?.quote).toBe("Conclusion: spread correlates with withdrawal suspension"); // rebuilt from source
    expect(finding.provenance).toMatchObject({ capabilityId: "extract-exploration-graph", model: "claude-test", traceId: "msg_1" });
    expect(finding.approvedByHuman).toBe(false);

    await repo.acceptProposal(proposal.id);
    const accepted = await repo.getGraph();
    expect(accepted.nodes).toHaveLength(2);
    const hypothesis = accepted.nodes.find((n) => n.type === "hypothesis")!;
    expect(hypothesis).toMatchObject({ authorship: "ai", approvedByHuman: true, approvedAt: "2026-10-30T10:00:00.000Z" });
    expect(hypothesis.frontier).toMatchObject({ authorship: "ai", generationType: "ai_generated", approvedByHuman: true });
    expect(accepted.edges[0]).toMatchObject({ authorship: "ai", approvedByHuman: true });
  });

  it("marks AI text edited by a human as mixed and keeps who changed what", async () => {
    const proposal = await importSource(repo, new FakeAiExtractor(), { kind: "text", name: "chat.txt", content: NOTES });
    const { graph } = await repo.getProposal(proposal.id);
    const hypothesis = graph.nodes.find((n) => n.type === "hypothesis")!;

    expect((await repo.updateNode(hypothesis.id, { type: "finding" })).authorship).toBe("ai");
    expect((await repo.updateNode(hypothesis.id, { title: "Inventory imbalance across venues" })).authorship).toBe("mixed");
    const revisions = await repo.listRevisions(hypothesis.id);
    expect(revisions.map((r) => [r.actorType, r.generationType])).toEqual([
      ["ai", "ai_generated"],
      ["human", "human"],
      ["human", "human"],
    ]);
    expect(revisions[2]?.previousRevisionId).toBe(revisions[1]?.id);
  });

  it("discarding removes the draft but keeps the source", async () => {
    const proposal = await importSource(repo, new FakeAiExtractor(), { kind: "text", name: "chat.txt", content: NOTES });
    await repo.discardProposal(proposal.id);
    expect((await repo.getProposal(proposal.id)).graph.nodes).toHaveLength(0);
    expect((await repo.getSource(proposal.sourceId)).name).toBe("chat.txt");
    await expect(repo.acceptProposal(proposal.id)).rejects.toThrow(/already discarded/);
  });
});

describe("multi-document merge", () => {
  it("proposes merging a new node into a similar existing one and re-points its edges", async () => {
    const { node: existing } = await repo.createNode({ type: "hypothesis", title: "USDC redemption latency", domain: "Arbitrage" });
    const doc = "Hypothesis: redemption latency of USDC\n  - Evidence: withdrawals paused for 3 hours";
    const proposal = await importSource(repo, new HeuristicExtractor(), { kind: "text", name: "doc-b.md", content: doc });

    expect(proposal.mergeCandidates).toHaveLength(1);
    const candidate = proposal.mergeCandidates[0]!;
    expect(candidate.existingNodeId).toBe(existing.id);

    const view = await repo.resolveMergeCandidate(proposal.id, candidate.proposedNodeId, existing.id, "merge");
    expect(view.proposal.mergeCandidates).toEqual([]);
    expect(view.graph.edges[0]?.sourceId).toBe(existing.id);
    expect(view.graph.nodes.map((n) => n.title)).toContain("USDC redemption latency");

    await repo.acceptProposal(proposal.id);
    const graph = await repo.getGraph();
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.find((n) => n.id === existing.id)?.sourceRefs).toEqual([proposal.sourceId]);
  });

  it("keep-separate dismisses only that candidate", async () => {
    const { node: existing } = await repo.createNode({ type: "hypothesis", title: "USDC redemption latency" });
    const proposal = await importSource(repo, new HeuristicExtractor(), { kind: "text", name: "b", content: "Hypothesis: USDC redemption latency" });
    const c = proposal.mergeCandidates[0]!;
    const view = await repo.resolveMergeCandidate(proposal.id, c.proposedNodeId, existing.id, "keep");
    expect(view.proposal.mergeCandidates).toEqual([]);
    expect(view.graph.nodes).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("scores similar English and Chinese titles", () => {
    expect(similarity("Redemption delay of USDC", "USDC redemption delay")).toBeGreaterThan(0.8);
    expect(similarity("提现延迟导致价差", "提现延迟")).toBeGreaterThan(0.6);
    expect(similarity("Solver latency", "Agent memory")).toBe(0);
  });

  it("drops anchors that point outside the document", () => {
    const clean = sanitizeExtraction(
      {
        domain: "",
        nodes: [{ key: "a", type: "finding", title: "x", body: "", generationType: "ai_extracted", confidence: 3, anchor: { lineStart: 99, lineEnd: 99, quote: "" }, frontier: null }],
        edges: [],
        mergeCandidates: [{ key: "a", existingNodeId: "not-real", likelihood: 1, reason: "" }],
        extractor: { capabilityId: "x", capabilityVersion: "1" },
      },
      "one line",
      new Set(),
    );
    expect(clean.nodes[0]).toMatchObject({ anchor: null, confidence: 1 });
    expect(clean.mergeCandidates).toEqual([]);
  });
});
