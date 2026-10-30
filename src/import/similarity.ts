import type { ExplorationNode, ExtractedNode } from "../domain/types";

/** Latin words plus CJK character bigrams, so Chinese titles compare sensibly without a tokenizer. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9]+/g) ?? []) if (word.length > 1 && !STOPWORDS.has(word)) out.add(word);
  for (const run of lower.match(/[㐀-鿿]+/g) ?? []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const dice = (2 * shared) / (ta.size + tb.size);
  // One title restating the other with extra words ("提现延迟" vs "提现延迟导致价差") is still likely the same concept.
  const smaller = Math.min(ta.size, tb.size);
  const containment = smaller >= 2 ? (0.85 * shared) / smaller : 0;
  return Math.max(dice, containment);
}

export interface LexicalMatch {
  key: string;
  existingNodeId: string;
  likelihood: number;
  reason: string;
}

/** Best existing match per extracted node, for "possible merge" review. Conservative by design. */
export function lexicalMergeCandidates(extracted: ExtractedNode[], existing: ExplorationNode[], threshold = 0.6): LexicalMatch[] {
  const matches: LexicalMatch[] = [];
  for (const node of extracted) {
    let best: LexicalMatch | null = null;
    for (const candidate of existing) {
      const score = similarity(node.title, candidate.title);
      if (score >= threshold && (!best || score > best.likelihood)) {
        best = { key: node.key, existingNodeId: candidate.id, likelihood: Math.round(score * 100) / 100, reason: "Similar title" };
      }
    }
    if (best) matches.push(best);
  }
  return matches;
}

const STOPWORDS = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "for", "with", "does", "do", "why", "how", "what"]);
