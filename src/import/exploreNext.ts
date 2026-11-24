import { NotFoundError, type GraphRepository } from "../domain/repository";
import type { EdgeType, ExplorationNode, ExtractedNode, Extraction, Proposal } from "../domain/types";
import type { GraphExtractor } from "./extraction";
import { sanitizeExtraction } from "./extraction";

const CJK_RE = /[\u4e00-\u9fff]/;

function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Generates structured next-layer draft suggestions anchored to an existing node.
 * Suggestions are always marked `ai_generated` and land in a draft Proposal for human review.
 */
export function buildNextLayerExtraction(node: ExplorationNode): Extraction {
  const zh = hasCjk(`${node.title} ${node.body} ${node.domain}`);
  const topic = truncate(node.title, zh ? 18 : 36);
  const nextHint = node.frontier?.nextAction?.trim() || "";

  let nodes: ExtractedNode[];
  if (zh) {
    switch (node.type) {
      case "question":
        nodes = [
          {
            key: "n1",
            type: "hypothesis",
            title: nextHint ? truncate(nextHint, 36) : `核心驱动假设：${topic}`,
            body: `围绕「${node.title}」提出的首个待验证假设，需拆解关键供给或因果约束。`,
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "列出支持与反驳该假设的关键指标", potential: "high", uncertainty: "high" },
          },
          {
            key: "n2",
            type: "evidence",
            title: `关键证据核查：${topic}`,
            body: "收集一手数据、行业对比或历史案例来校验当前判断。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: null,
          },
          {
            key: "n3",
            type: "question",
            title: `什么瓶颈或反例会推翻「${topic}」？`,
            body: "识别潜在的替代路线、切换成本或结构性限制。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "梳理主要替代方案与边界条件", potential: "medium", uncertainty: "high" },
          },
        ];
        break;
      case "hypothesis":
        nodes = [
          {
            key: "n1",
            type: "experiment",
            title: nextHint ? truncate(nextHint, 36) : `验证实验：检验「${topic}」`,
            body: "设计最小成本的验证方案，明确证伪条件与量化阈值。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "确定样本范围与证伪标准", potential: "high", uncertainty: "medium" },
          },
          {
            key: "n2",
            type: "evidence",
            title: `反面信号排查：${topic}`,
            body: "主动寻找与该假设相矛盾的数据或行业反例。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: null,
          },
          {
            key: "n3",
            type: "question",
            title: `「${topic}」依赖哪些前置条件？`,
            body: "拆解上游依赖、时间窗口或关键参与者。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "逐项核查关键依赖的稳定性", potential: "medium", uncertainty: "high" },
          },
        ];
        break;
      case "opportunity":
        nodes = [
          {
            key: "n1",
            type: "hypothesis",
            title: nextHint ? truncate(nextHint, 36) : `壁垒与持续性：${topic}`,
            body: "分析该机会为何尚未被市场充分定价或套利抹平。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "评估竞争格局与进入门槛", potential: "high", uncertainty: "high" },
          },
          {
            key: "n2",
            type: "experiment",
            title: `最小可行验证：${topic}`,
            body: "小规模测算扣除摩擦与执行成本后的净收益。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: null,
          },
          {
            key: "n3",
            type: "question",
            title: `「${topic}」最大的执行风险是什么？`,
            body: "列出可能导致收益不及预期的核心风险点。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "量化最坏情况下的回撤与止损条件", potential: "medium", uncertainty: "high" },
          },
        ];
        break;
      default:
        nodes = [
          {
            key: "n1",
            type: "hypothesis",
            title: nextHint ? truncate(nextHint, 36) : `延伸推论：${topic}`,
            body: `基于「${node.title}」推导出的下一层判断，尚需验证。`,
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "补充量化数据验证该推论", potential: "high", uncertainty: "medium" },
          },
          {
            key: "n2",
            type: "opportunity",
            title: `潜在机会：${topic}`,
            body: "评估该发现是否指向可落地的决策或投资机会。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: null,
          },
          {
            key: "n3",
            type: "question",
            title: `围绕「${topic}」还有哪些未解边界？`,
            body: "梳理仍存在高不确定性的细分问题。",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "列出下一步最值得深挖的子问题", potential: "medium", uncertainty: "high" },
          },
        ];
    }
  } else {
    switch (node.type) {
      case "question":
        nodes = [
          {
            key: "n1",
            type: "hypothesis",
            title: nextHint ? truncate(nextHint, 48) : `Primary mechanism behind ${topic}`,
            body: `Candidate explanation for "${node.title}" to test against real data.`,
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "List key metrics that would confirm or falsify this", potential: "high", uncertainty: "high" },
          },
          {
            key: "n2",
            type: "evidence",
            title: `Baseline data to check: ${topic}`,
            body: "Gather primary numbers, historical cases, or benchmarks.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: null,
          },
          {
            key: "n3",
            type: "question",
            title: `What bottleneck or counter-example challenges ${topic}?`,
            body: "Identify alternative explanations, substitutes, or structural constraints.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "Compare alternative mechanisms and switching costs", potential: "medium", uncertainty: "high" },
          },
        ];
        break;
      case "hypothesis":
        nodes = [
          {
            key: "n1",
            type: "experiment",
            title: nextHint ? truncate(nextHint, 48) : `Falsification test for ${topic}`,
            body: "Design the smallest test that can cleanly disprove this hypothesis.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "Define sample, metric, and falsification threshold", potential: "high", uncertainty: "medium" },
          },
          {
            key: "n2",
            type: "evidence",
            title: `Disconfirming signals for ${topic}`,
            body: "Actively check for edge cases or counter-evidence.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: null,
          },
          {
            key: "n3",
            type: "question",
            title: `What dependencies must hold for ${topic}?`,
            body: "Break down upstream constraints and failure modes.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "Audit each dependency's reliability", potential: "medium", uncertainty: "high" },
          },
        ];
        break;
      case "opportunity":
        nodes = [
          {
            key: "n1",
            type: "hypothesis",
            title: nextHint ? truncate(nextHint, 48) : `Why edge persists: ${topic}`,
            body: "Explain why this opportunity is not already competed away.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "Check competitor coverage and entry barriers", potential: "high", uncertainty: "high" },
          },
          {
            key: "n2",
            type: "experiment",
            title: `Net-of-cost validation: ${topic}`,
            body: "Measure realistic returns after execution friction and slippage.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: null,
          },
          {
            key: "n3",
            type: "question",
            title: `What is the primary execution risk for ${topic}?`,
            body: "Identify worst-case failure scenarios and stop conditions.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "Quantify downside and define abort criteria", potential: "medium", uncertainty: "high" },
          },
        ];
        break;
      default:
        nodes = [
          {
            key: "n1",
            type: "hypothesis",
            title: nextHint ? truncate(nextHint, 48) : `Implication of ${topic}`,
            body: `Follow-up hypothesis derived from "${node.title}".`,
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "Validate implication with quantitative evidence", potential: "high", uncertainty: "medium" },
          },
          {
            key: "n2",
            type: "opportunity",
            title: `Actionable angle from ${topic}`,
            body: "Evaluate whether this finding unlocks a concrete decision or opportunity.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: null,
          },
          {
            key: "n3",
            type: "question",
            title: `What remains open around ${topic}?`,
            body: "Surface the highest-uncertainty follow-up question.",
            generationType: "ai_generated",
            confidence: 0.5,
            anchor: null,
            frontier: { nextAction: "Prioritize the next sub-question to investigate", potential: "medium", uncertainty: "high" },
          },
        ];
    }
  }

  return {
    domain: node.domain,
    nodes,
    edges: [],
    mergeCandidates: [],
    extractor: { capabilityId: "explore-next-layer", capabilityVersion: "1" },
  };
}

/**
 * Explores the next layer from an existing node, creating an open Proposal attached to it
 * so the user can review, edit, selectively accept, or discard the suggested nodes.
 */
export async function exploreNextLayer(
  repo: GraphRepository,
  nodeId: string,
  aiExtractor?: GraphExtractor | null,
): Promise<Proposal> {
  const node = await repo.getNode(nodeId);
  if (!node) throw new NotFoundError(`node ${nodeId} not found`);

  const graph = await repo.getGraph();
  const neighborIds = new Set(
    graph.edges.filter((e) => e.sourceId === nodeId || e.targetId === nodeId).flatMap((e) => [e.sourceId, e.targetId]),
  );
  const neighbors = graph.nodes.filter((n) => n.id !== nodeId && neighborIds.has(n.id));

  const briefLines = [
    `Explore next layer from: [${node.type}] ${node.title}`,
    node.body ? `Notes: ${node.body}` : "",
    node.frontier?.nextAction ? `Next action: ${node.frontier.nextAction}` : "",
    node.stopNote ? `Stopped because: ${node.stopNote}` : "",
    neighbors.length > 0 ? `Connected context:\n${neighbors.map((n) => `- [${n.type}] ${n.title}`).join("\n")}` : "",
  ].filter(Boolean);
  const brief = briefLines.join("\n\n");

  let extraction: Extraction;
  if (aiExtractor) {
    const raw = await aiExtractor.extract({
      source: { kind: "text", name: `Explore: ${node.title}`, content: brief },
      existing: graph.nodes.map((n) => ({ id: n.id, type: n.type, title: n.title, domain: n.domain })),
      domainHint: node.domain,
    });
    extraction = sanitizeExtraction(raw, brief, new Set(graph.nodes.map((n) => n.id)));
  } else {
    extraction = buildNextLayerExtraction(node);
  }

  const edgeType: EdgeType = node.type === "evidence" || node.type === "experiment" ? "derived_from" : "led_to";
  return repo.createProposal({
    source: { kind: "text", name: `Explore: ${truncate(node.title, 48)}`, content: brief },
    domain: node.domain || extraction.domain,
    extraction,
    mergeCandidates: extraction.mergeCandidates,
    attachTo: { nodeId: node.id, edgeType },
  });
}
