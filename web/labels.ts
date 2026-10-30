import type { Authorship, EdgeType, GenerationType, Level, NodeStatus, NodeType, SourceKind } from "../src/domain/types";

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  question: "Question",
  hypothesis: "Hypothesis",
  evidence: "Evidence",
  experiment: "Experiment",
  finding: "Finding",
  opportunity: "Opportunity",
};

export const EDGE_TYPE_LABEL: Record<EdgeType, string> = {
  led_to: "led to",
  supports: "supports",
  contradicts: "contradicts",
  derived_from: "derived from",
  requires: "requires",
  blocked_by: "blocked by",
  similar_to: "similar to",
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  open: "Open",
  validated: "Validated",
  rejected: "Rejected",
  blocked: "Blocked",
  parked: "Parked",
  low_roi: "Low ROI",
  needs_more_evidence: "Needs evidence",
};

export const LEVEL_LABEL: Record<Level, string> = { low: "Low", medium: "Medium", high: "High" };

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** True when typing in a form field, so single-key shortcuts should not fire. */
export function isEditingText(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export const GENERATION_LABEL: Record<GenerationType, string> = {
  human: "Written by you",
  ai_extracted: "Your idea · AI extracted",
  ai_generated: "AI generated",
  ai_transformed: "AI summarized",
  import: "Imported from your notes",
  external_source: "External source",
};

export const AUTHORSHIP_LABEL: Record<Authorship, string> = { human: "You", ai: "AI", mixed: "You + AI" };

/** Lightweight marks instead of loud colours: ✦ AI generated, ✦· mixed. */
export function authorshipMark(authorship: Authorship): string {
  return authorship === "ai" ? "✦" : authorship === "mixed" ? "✦·" : "";
}

export function guessSourceKind(name: string, content: string): SourceKind {
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  if (/^(user|assistant|you|chatgpt|claude|human|ai)\s*(said)?\s*[:：]/im.test(content)) return "conversation";
  return /^#{1,6}\s/m.test(content) ? "markdown" : "text";
}
