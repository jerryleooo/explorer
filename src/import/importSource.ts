import type { GraphRepository } from "../domain/repository";
import type { Proposal, SourceKind } from "../domain/types";
import { sanitizeExtraction, type GraphExtractor } from "./extraction";
import { lexicalMergeCandidates } from "./similarity";

export interface ImportRequest {
  kind: SourceKind;
  name: string;
  content: string;
  domain?: string;
}

export const MAX_SOURCE_CHARS = 400_000;

/** Import → extract → proposed graph. Nothing touches the long-term graph until the proposal is accepted. */
export async function importSource(repo: GraphRepository, extractor: GraphExtractor, request: ImportRequest): Promise<Proposal> {
  const graph = await repo.getGraph();
  const existingIds = new Set(graph.nodes.map((n) => n.id));
  const raw = await extractor.extract({
    source: { kind: request.kind, name: request.name, content: request.content },
    existing: graph.nodes.map(({ id, type, title, domain }) => ({ id, type, title, domain })),
    domainHint: request.domain?.trim() ?? "",
  });
  const extraction = sanitizeExtraction(raw, request.content, existingIds);

  const byKey = new Map(extraction.mergeCandidates.map((m) => [m.key, m]));
  for (const lexical of lexicalMergeCandidates(extraction.nodes, graph.nodes)) {
    if (!byKey.has(lexical.key)) byKey.set(lexical.key, lexical);
  }

  return repo.createProposal({
    source: { kind: request.kind, name: request.name.trim() || "Untitled source", content: request.content },
    domain: request.domain?.trim() || extraction.domain,
    extraction,
    mergeCandidates: [...byKey.values()],
  });
}
