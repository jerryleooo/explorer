import {
  EDGE_TYPES,
  GENERATION_TYPES,
  LEVELS,
  NODE_TYPES,
  type ExplorationNode,
  type Extraction,
  type ExtractorInfo,
  type GenerationType,
  type SourceAnchor,
  type SourceKind,
} from "../domain/types";

export interface ExtractionInput {
  source: { kind: SourceKind; name: string; content: string };
  /** Long-term graph context, so the extractor can propose merges instead of duplicates. */
  existing: Array<Pick<ExplorationNode, "id" | "type" | "title" | "domain">>;
  domainHint: string;
}

/** Port for whatever turns a document into a proposed exploration graph (the agentaab capability, heuristics, ...). */
export interface GraphExtractor {
  readonly info: ExtractorInfo;
  extract(input: ExtractionInput): Promise<Extraction>;
}

export function sourceLines(content: string): string[] {
  return content.replace(/\r\n?/g, "\n").split("\n");
}

/** Prefixes each line with its 1-based number so an extractor can cite exact anchors. */
export function numberLines(content: string): string {
  return sourceLines(content)
    .map((line, i) => `L${i + 1}: ${line}`)
    .join("\n");
}

const MAX_TITLE = 280;
const MAX_QUOTE = 600;

/**
 * Makes untrusted extractor output safe to persist: drops unknown types, dangling edges and
 * duplicate keys, and rebuilds every anchor quote from the actual source lines so an anchor
 * can never cite text that is not in the document.
 */
export function sanitizeExtraction(raw: Extraction, content: string, existingIds: ReadonlySet<string>): Extraction {
  const lines = sourceLines(content);
  const seen = new Set<string>();
  const nodes = raw.nodes.flatMap((n) => {
    const title = n.title.trim().slice(0, MAX_TITLE);
    if (!title || seen.has(n.key) || !NODE_TYPES.includes(n.type)) return [];
    seen.add(n.key);
    return [
      {
        ...n,
        title,
        body: n.body.trim(),
        generationType: (GENERATION_TYPES.includes(n.generationType) ? n.generationType : "ai_generated") as GenerationType,
        confidence: n.confidence == null ? null : clamp(n.confidence, 0, 1),
        anchor: n.anchor ? resolveAnchor(n.anchor, lines) : null,
        frontier: n.frontier && {
          nextAction: n.frontier.nextAction?.trim() || null,
          potential: n.frontier.potential && LEVELS.includes(n.frontier.potential) ? n.frontier.potential : null,
          uncertainty: n.frontier.uncertainty && LEVELS.includes(n.frontier.uncertainty) ? n.frontier.uncertainty : null,
        },
      },
    ];
  });
  const edgeSeen = new Set<string>();
  const edges = raw.edges.filter((e) => {
    const key = `${e.sourceKey}|${e.targetKey}|${e.type}`;
    const ok = seen.has(e.sourceKey) && seen.has(e.targetKey) && e.sourceKey !== e.targetKey && EDGE_TYPES.includes(e.type) && !edgeSeen.has(key);
    edgeSeen.add(key);
    return ok;
  });
  const mergeCandidates = raw.mergeCandidates
    .filter((m) => seen.has(m.key) && existingIds.has(m.existingNodeId))
    .map((m) => ({ ...m, likelihood: clamp(m.likelihood, 0, 1) }));
  return { ...raw, domain: raw.domain.trim(), nodes, edges, mergeCandidates };
}

function resolveAnchor(anchor: SourceAnchor, lines: string[]): SourceAnchor | null {
  let start = Math.trunc(anchor.lineStart);
  let end = Math.trunc(anchor.lineEnd);
  if (!(start >= 1 && start <= lines.length)) {
    const found = anchor.quote ? lines.findIndex((l) => l.includes(anchor.quote.trim().slice(0, 40))) : -1;
    if (found < 0) return null;
    start = end = found + 1;
  }
  end = clamp(Number.isFinite(end) && end >= start ? end : start, start, lines.length);
  const quote = lines.slice(start - 1, end).join("\n").trim().slice(0, MAX_QUOTE);
  return { lineStart: start, lineEnd: end, quote };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
