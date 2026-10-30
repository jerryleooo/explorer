import { ValidationError } from "../src/domain/repository";
import { MAX_SOURCE_CHARS, type ImportRequest } from "../src/import/importSource";
import {
  EDGE_TYPES,
  LEVELS,
  NODE_STATUSES,
  NODE_TYPES,
  SOURCE_KINDS,
  type EdgeType,
  type FrontierInput,
  type NewEdge,
  type NewNode,
  type NodePatch,
} from "../src/domain/types";

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ValidationError("expected a JSON object");
  return value as Json;
}

function oneOf<T extends string>(options: readonly T[], value: unknown, field: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new ValidationError(`${field} must be one of ${options.join(", ")}`);
  }
  return value as T;
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  return value;
}

function nullableStr(value: unknown, field: string): string | null {
  return value === null ? null : str(value, field).trim() || null;
}

export function parseNewNode(body: unknown): NewNode {
  const o = object(body);
  const parent = o.parent === undefined ? undefined : object(o.parent);
  return {
    type: oneOf(NODE_TYPES, o.type, "type"),
    title: str(o.title, "title"),
    body: o.body === undefined ? undefined : str(o.body, "body"),
    domain: o.domain === undefined ? undefined : str(o.domain, "domain"),
    parent: parent && { nodeId: str(parent.nodeId, "parent.nodeId"), edgeType: oneOf(EDGE_TYPES, parent.edgeType, "parent.edgeType") },
  };
}

export function parseNodePatch(body: unknown): NodePatch {
  const o = object(body);
  const patch: NodePatch = {};
  if (o.type !== undefined) patch.type = oneOf(NODE_TYPES, o.type, "type");
  if (o.title !== undefined) patch.title = str(o.title, "title");
  if (o.body !== undefined) patch.body = str(o.body, "body");
  if (o.status !== undefined) patch.status = oneOf(NODE_STATUSES, o.status, "status");
  if (o.stopNote !== undefined) patch.stopNote = nullableStr(o.stopNote, "stopNote");
  if (o.domain !== undefined) patch.domain = str(o.domain, "domain").trim();
  if (o.confidence !== undefined) {
    if (o.confidence !== null && typeof o.confidence !== "number") throw new ValidationError("confidence must be a number");
    patch.confidence = o.confidence;
  }
  if (o.sourceRefs !== undefined) {
    if (!Array.isArray(o.sourceRefs)) throw new ValidationError("sourceRefs must be an array");
    patch.sourceRefs = o.sourceRefs.map((r) => str(r, "sourceRefs[]"));
  }
  return patch;
}

export function parseNewEdge(body: unknown): NewEdge {
  const o = object(body);
  return { sourceId: str(o.sourceId, "sourceId"), targetId: str(o.targetId, "targetId"), type: oneOf(EDGE_TYPES, o.type, "type") };
}

export function parseEdgeType(body: unknown): EdgeType {
  return oneOf(EDGE_TYPES, object(body).type, "type");
}

export function parseFrontier(body: unknown): FrontierInput {
  const o = object(body);
  const level = (v: unknown, field: string) => (v === null ? null : oneOf(LEVELS, v, field));
  const input: FrontierInput = {};
  if (o.potential !== undefined) input.potential = level(o.potential, "potential");
  if (o.uncertainty !== undefined) input.uncertainty = level(o.uncertainty, "uncertainty");
  if (o.nextAction !== undefined) input.nextAction = nullableStr(o.nextAction, "nextAction");
  if (o.blockedBy !== undefined) input.blockedBy = nullableStr(o.blockedBy, "blockedBy");
  if (o.reopenCondition !== undefined) input.reopenCondition = nullableStr(o.reopenCondition, "reopenCondition");
  if (o.touch !== undefined) input.touch = o.touch === true;
  return input;
}

export function parseTitle(body: unknown): string {
  const o = object(body);
  return o.title === undefined ? "" : str(o.title, "title");
}

export function parseImport(body: unknown): ImportRequest & { extractor?: "ai" | "structural" } {
  const o = object(body);
  const content = str(o.content, "content");
  if (!content.trim()) throw new ValidationError("content is empty");
  if (content.length > MAX_SOURCE_CHARS) throw new ValidationError(`source is too large (max ${MAX_SOURCE_CHARS} characters)`);
  return {
    kind: oneOf(SOURCE_KINDS, o.kind ?? "text", "kind"),
    name: o.name === undefined ? "Pasted text" : str(o.name, "name"),
    content,
    domain: o.domain === undefined ? undefined : str(o.domain, "domain"),
    extractor: o.extractor === undefined ? undefined : oneOf(["ai", "structural"] as const, o.extractor, "extractor"),
  };
}

export function parseMergeDecision(body: unknown): { proposedNodeId: string; existingNodeId: string; decision: "merge" | "keep" } {
  const o = object(body);
  return {
    proposedNodeId: str(o.proposedNodeId, "proposedNodeId"),
    existingNodeId: str(o.existingNodeId, "existingNodeId"),
    decision: oneOf(["merge", "keep"] as const, o.decision, "decision"),
  };
}

export function parseMergeInto(body: unknown): string {
  return str(object(body).intoId, "intoId");
}
