import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { AgentaabGraphExtractor, agentaabConfigFrom } from "../src/import/agentaabExtractor";
import { ExtractionInputSchema, ExtractionOutputSchema, INSTRUCTIONS, USER_TEMPLATE } from "../src/import/extractionContract";

const CONFIG = { apiUrl: "https://api.agentaab.com/api", businessSlug: "exploration-graph", runtimeToken: "eu_rt_abc" };
const INPUT = {
  source: { kind: "markdown" as const, name: "notes.md", content: "Q: Is the spread real?\nHypothesis: thin liquidity" },
  existing: [{ id: "n1", type: "question" as const, title: "Old question", domain: "Arbitrage" }],
  domainHint: "Arbitrage",
};
const OUTPUT = {
  domain: "Arbitrage",
  nodes: [
    { key: "q", type: "question", title: "Is the spread real?", body: "", generationType: "ai_extracted", confidence: 0.9, lineStart: 1, lineEnd: 1, frontier: null },
  ],
  edges: [],
  mergeCandidates: [{ key: "q", existingNodeId: "n1", likelihood: 0.7, reason: "same question" }],
};

function fakeRuntime(completion: { status?: number; body: unknown }, completionEndpoint = "/api/app/exploration-graph/completion-messages") {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/runtime-config")) {
      return Response.json({ type: "prompt", interaction_mode: "completion", runtime: { completion_endpoint: completionEndpoint } });
    }
    return Response.json(completion.body, { status: completion.status ?? 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("AgentaabGraphExtractor", () => {
  it("invokes the released completion capability and maps its structured answer", async () => {
    const { calls, fetchImpl } = fakeRuntime({ body: { id: "inv_1", answer: "```json\n" + JSON.stringify(OUTPUT) + "\n```", metadata: { model: "m-1" } } });
    const extraction = await new AgentaabGraphExtractor(CONFIG, fetchImpl).extract(INPUT);

    expect(calls.map((c) => c.url)).toEqual([
      "https://api.agentaab.com/api/app/exploration-graph/runtime-config",
      "https://api.agentaab.com/api/app/exploration-graph/completion-messages",
    ]);
    const sent = JSON.parse(String(calls[1]!.init!.body));
    expect(sent).toMatchObject({ response_mode: "blocking", inputs: { source_name: "notes.md", domain_hint: "Arbitrage" } });
    expect(sent.inputs.document).toBe("L1: Q: Is the spread real?\nL2: Hypothesis: thin liquidity");
    expect(sent.inputs.existing_graph).toBe("n1\tquestion\tArbitrage\tOld question");
    expect(sent.user).toBeUndefined();
    expect((calls[1]!.init!.headers as Record<string, string>).authorization).toBe("Bearer eu_rt_abc");

    expect(extraction.extractor).toEqual({ capabilityId: "extract-exploration-graph", capabilityVersion: "agentaab:exploration-graph", model: "m-1", traceId: "inv_1" });
    expect(extraction.nodes[0]).toMatchObject({ key: "q", anchor: { lineStart: 1, lineEnd: 1 } });
    expect(extraction.mergeCandidates).toHaveLength(1);
  });

  it("sends the guest id with a public token and accepts structured outputs", async () => {
    const { calls, fetchImpl } = fakeRuntime({ body: { data: { outputs: OUTPUT } } });
    await new AgentaabGraphExtractor({ ...CONFIG, runtimeToken: "pk_app_x", guestId: "anon:explorer" }, fetchImpl).extract(INPUT);
    expect(JSON.parse(String(calls[1]!.init!.body)).user).toBe("anon:explorer");
  });

  it("refuses endpoints outside the business and contract mismatches", async () => {
    const escaping = fakeRuntime({ body: {} }, "https://evil.example/steal");
    await expect(new AgentaabGraphExtractor(CONFIG, escaping.fetchImpl).extract(INPUT)).rejects.toMatchObject({ code: "unsafe_runtime_endpoint" });
    expect(escaping.calls).toHaveLength(1);

    const invalid = fakeRuntime({ body: { answer: '{"nodes": "nope"}' } });
    await expect(new AgentaabGraphExtractor(CONFIG, invalid.fetchImpl).extract(INPUT)).rejects.toMatchObject({ code: "report_contract_mismatch" });
  });

  it("surfaces quota errors and rejects non-runtime credentials", async () => {
    const { fetchImpl } = fakeRuntime({ status: 402, body: { code: "payment_required" } });
    await expect(new AgentaabGraphExtractor(CONFIG, fetchImpl).extract(INPUT)).rejects.toMatchObject({ status: 402, code: "payment_required" });
    expect(() => new AgentaabGraphExtractor({ ...CONFIG, runtimeToken: "sk-ant-provider-key" })).toThrow(/app-scoped/);
    expect(() => new AgentaabGraphExtractor({ ...CONFIG, runtimeToken: "pk_app_x" })).toThrow(/GUEST_ID/);
  });

  it("is configured only when a business and runtime token are set", () => {
    expect(agentaabConfigFrom({})).toBeNull();
    expect(agentaabConfigFrom({ AGENTAAB_BUSINESS_SLUG: "exploration-graph", AGENTAAB_RUNTIME_TOKEN: "eu_rt_1" })?.apiUrl).toBe("https://api.agentaab.com/api");
  });
});

describe("capability definition", () => {
  // Authoring reference for the agentaab Single Agent; regenerate with UPDATE_CAPABILITY=1 pnpm test.
  it("matches the contract in src/import/extractionContract.ts", () => {
    const definition = {
      kind: "single_agent",
      version: 1,
      interaction_mode: "completion",
      instructions: { system: INSTRUCTIONS, user_template: USER_TEMPLATE },
      tools: [],
      input_schema: z.toJSONSchema(ExtractionInputSchema),
      output_schema: z.toJSONSchema(ExtractionOutputSchema),
      limits: { timeout_ms: 180000, max_output_tokens: 32000, max_tool_calls: 0 },
    };
    const file = join(import.meta.dirname, "..", "capability", "extract-exploration-graph.json");
    const text = JSON.stringify(definition, null, 2) + "\n";
    if (process.env.UPDATE_CAPABILITY) writeFileSync(file, text);
    expect(readFileSync(file, "utf8")).toBe(text);
  });
});
