import { Hono } from "hono";
import { NotFoundError, ValidationError, type GraphRepository } from "../src/domain/repository";
import { ClaudeGraphExtractor } from "../src/import/claudeExtractor";
import type { GraphExtractor } from "../src/import/extraction";
import { HeuristicExtractor } from "../src/import/heuristicExtractor";
import { importSource } from "../src/import/importSource";
import { D1SqlDatabase } from "../src/storage/d1";
import { SqlGraphRepository } from "../src/storage/sqlGraphRepository";
import {
  parseEdgeType,
  parseFrontier,
  parseImport,
  parseMergeDecision,
  parseMergeInto,
  parseNewEdge,
  parseNewNode,
  parseNodePatch,
  parseTitle,
} from "./validation";

/** Secrets are not part of the generated Env: set with `wrangler secret put` or .dev.vars. */
type Bindings = Env & { ANTHROPIC_API_KEY?: string; EXTRACTION_MODEL?: string };
type AppEnv = { Bindings: Bindings; Variables: { repo: GraphRepository } };

const app = new Hono<AppEnv>().basePath("/api");

// The only place Workers/D1 bindings meet the domain: everything below talks to GraphRepository.
app.use(async (c, next) => {
  c.set("repo", new SqlGraphRepository(new D1SqlDatabase(c.env.DB)));
  await next();
});

app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  console.error(err);
  return c.json({ error: err instanceof Error ? err.message : "internal error" }, 500);
});

function extractorFor(env: Bindings, requested: "ai" | "structural" | undefined): GraphExtractor {
  if (requested === "structural" || !env.ANTHROPIC_API_KEY) {
    if (requested === "ai") throw new ValidationError("AI extraction is not configured (ANTHROPIC_API_KEY is missing)");
    return new HeuristicExtractor();
  }
  return new ClaudeGraphExtractor(env.ANTHROPIC_API_KEY, env.EXTRACTION_MODEL || undefined);
}

app.get("/capabilities", (c) => c.json({ aiExtraction: Boolean(c.env.ANTHROPIC_API_KEY) }));

app.get("/graph", async (c) => c.json(await c.var.repo.getGraph()));

app.post("/nodes", async (c) => c.json(await c.var.repo.createNode(parseNewNode(await c.req.json())), 201));
app.patch("/nodes/:id", async (c) => c.json(await c.var.repo.updateNode(c.req.param("id"), parseNodePatch(await c.req.json()))));
app.delete("/nodes/:id", async (c) => {
  await c.var.repo.deleteNode(c.req.param("id"));
  return c.body(null, 204);
});
app.post("/nodes/:id/merge", async (c) => c.json(await c.var.repo.mergeNodes(c.req.param("id"), parseMergeInto(await c.req.json()))));
app.get("/nodes/:id/revisions", async (c) => c.json(await c.var.repo.listRevisions(c.req.param("id"))));

app.put("/nodes/:id/frontier", async (c) => c.json(await c.var.repo.setFrontier(c.req.param("id"), parseFrontier(await c.req.json()))));
app.delete("/nodes/:id/frontier", async (c) => c.json(await c.var.repo.clearFrontier(c.req.param("id"))));

app.post("/edges", async (c) => c.json(await c.var.repo.createEdge(parseNewEdge(await c.req.json())), 201));
app.patch("/edges/:id", async (c) => c.json(await c.var.repo.updateEdge(c.req.param("id"), parseEdgeType(await c.req.json()))));
app.delete("/edges/:id", async (c) => {
  await c.var.repo.deleteEdge(c.req.param("id"));
  return c.body(null, 204);
});

app.post("/imports", async (c) => {
  const { extractor, ...request } = parseImport(await c.req.json());
  return c.json(await importSource(c.var.repo, extractorFor(c.env, extractor), request), 201);
});
app.get("/proposals", async (c) => c.json(await c.var.repo.listProposals()));
app.get("/proposals/:id", async (c) => c.json(await c.var.repo.getProposal(c.req.param("id"))));
app.post("/proposals/:id/accept", async (c) => c.json(await c.var.repo.acceptProposal(c.req.param("id"))));
app.post("/proposals/:id/discard", async (c) => c.json(await c.var.repo.discardProposal(c.req.param("id"))));
app.post("/proposals/:id/merge-candidates", async (c) => {
  const { proposedNodeId, existingNodeId, decision } = parseMergeDecision(await c.req.json());
  return c.json(await c.var.repo.resolveMergeCandidate(c.req.param("id"), proposedNodeId, existingNodeId, decision));
});
app.get("/sources/:id", async (c) => c.json(await c.var.repo.getSource(c.req.param("id"))));

app.get("/sessions/active", async (c) => c.json(await c.var.repo.getActiveSession()));
app.post("/sessions", async (c) => c.json(await c.var.repo.startSession(parseTitle(await c.req.json())), 201));
app.post("/sessions/:id/end", async (c) => c.json(await c.var.repo.endSession(c.req.param("id"))));

app.get("/events", async (c) =>
  c.json(await c.var.repo.listEvents({ entityId: c.req.query("entityId"), sessionId: c.req.query("sessionId") })),
);

app.get("/export", async (c) => {
  const data = await c.var.repo.exportAll();
  c.header("Content-Disposition", `attachment; filename="exploration-graph-${data.exportedAt.slice(0, 10)}.json"`);
  return c.json(data);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

export default app satisfies ExportedHandler<Env>;
