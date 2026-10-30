import type { EdgeType, ExtractedEdge, ExtractedNode, Extraction, ExtractorInfo, NodeType } from "../domain/types";
import { sourceLines, type ExtractionInput, type GraphExtractor } from "./extraction";

const PREFIXES: Array<[RegExp, NodeType | "frontier"]> = [
  [/^(?:q|question|问题)\s*[:：]\s*/i, "question"],
  [/^(?:h|hypothesis|假设|猜想)\s*[:：]\s*/i, "hypothesis"],
  [/^(?:evidence|data|证据|数据)\s*[:：]\s*/i, "evidence"],
  [/^(?:experiment|test|实验|验证)\s*[:：]\s*/i, "experiment"],
  [/^(?:finding|result|conclusion|发现|结论|结果)\s*[:：]\s*/i, "finding"],
  [/^(?:opportunity|idea|机会)\s*[:：]\s*/i, "opportunity"],
  [/^(?:next|todo|frontier|open question|下一步|待办|待探索)\s*[:：]\s*/i, "frontier"],
];

/** Lower rank = closer to the root of an exploration; used to pick a parent in flat documents. */
const RANK: Record<NodeType, number> = { question: 0, hypothesis: 1, experiment: 2, evidence: 2, finding: 3, opportunity: 3 };

/**
 * No-AI structural import: picks out explicitly labelled lines ("Hypothesis: ...", "结论：...")
 * and questions, and nests them by heading / indentation. Everything stays human-authored
 * (generationType "import"), which keeps the product useful without any AI.
 */
export class HeuristicExtractor implements GraphExtractor {
  readonly info: ExtractorInfo = { capabilityId: "structural-import", capabilityVersion: "1" };

  async extract(input: ExtractionInput): Promise<Extraction> {
    const nodes: ExtractedNode[] = [];
    const edges: ExtractedEdge[] = [];
    const stack: Array<{ depth: number; node: ExtractedNode }> = [];
    let headingDepth = 0;

    sourceLines(input.source.content).forEach((raw, index) => {
      const heading = raw.match(/^(#{1,6})\s+(.*)$/);
      let depth: number;
      let text: string;
      if (heading) {
        headingDepth = heading[1]!.length;
        depth = headingDepth * 10;
        text = heading[2]!.trim();
      } else {
        const indent = raw.match(/^\s*/)![0].replace(/\t/g, "  ").length;
        depth = headingDepth * 10 + 1 + Math.floor(indent / 2);
        text = raw.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, "").replace(/^>\s*/, "");
      }
      const classified = classify(text);
      if (!classified) return;

      const lineNo = index + 1;
      const node: ExtractedNode = {
        key: `n${nodes.length + 1}`,
        type: classified.type === "frontier" ? "question" : classified.type,
        title: classified.title,
        body: "",
        generationType: "import",
        confidence: null,
        anchor: { lineStart: lineNo, lineEnd: lineNo, quote: raw.trim() },
        // The labelled line is itself the next step, so it becomes the title rather than a duplicated nextAction.
        frontier: classified.type === "frontier" ? { nextAction: null, potential: null, uncertainty: null } : null,
      };

      while (stack.length > 0 && stack[stack.length - 1]!.depth > depth) stack.pop();
      const sameLevel = stack.filter((s) => s.depth === depth);
      const parent =
        classified.type === "frontier"
          ? stack[stack.length - 1]?.node
          : [...sameLevel].reverse().find((s) => RANK[s.node.type] < RANK[node.type])?.node ??
            stack.filter((s) => s.depth < depth).at(-1)?.node;
      if (parent) edges.push({ sourceKey: parent.key, targetKey: node.key, type: edgeType(parent.type, node.type), generationType: "import" });

      nodes.push(node);
      stack.push({ depth, node });
    });

    return { domain: input.domainHint, nodes, edges, mergeCandidates: [], extractor: this.info };
  }
}

function classify(text: string): { type: NodeType | "frontier"; title: string } | null {
  for (const [pattern, type] of PREFIXES) {
    if (pattern.test(text)) {
      const title = text.replace(pattern, "").trim();
      return title ? { type, title } : null;
    }
  }
  if (/[?？]\s*$/.test(text) && text.length > 3) return { type: "question", title: text };
  return null;
}

function edgeType(parent: NodeType, child: NodeType): EdgeType {
  if (child === "evidence" && parent === "hypothesis") return "supports";
  if (child === "finding" && (parent === "evidence" || parent === "experiment")) return "derived_from";
  return "led_to";
}
