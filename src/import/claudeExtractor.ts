import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { EDGE_TYPES, LEVELS, NODE_TYPES, type Extraction, type ExtractorInfo } from "../domain/types";
import { numberLines, type ExtractionInput, type GraphExtractor } from "./extraction";

export const CAPABILITY_ID = "extract-exploration-graph";
const CAPABILITY_VERSION = "1";
const MAX_EXISTING_CONTEXT = 400;

const AI_GENERATION = ["ai_extracted", "ai_generated", "ai_transformed"] as const;

const ExtractionSchema = z.object({
  domain: z.string(),
  nodes: z.array(
    z.object({
      key: z.string(),
      type: z.enum(NODE_TYPES),
      title: z.string(),
      body: z.string(),
      generationType: z.enum(AI_GENERATION),
      confidence: z.number(),
      lineStart: z.number().int().nullable(),
      lineEnd: z.number().int().nullable(),
      frontier: z
        .object({
          nextAction: z.string().nullable(),
          potential: z.enum(LEVELS).nullable(),
          uncertainty: z.enum(LEVELS).nullable(),
        })
        .nullable(),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      type: z.enum(EDGE_TYPES),
      generationType: z.enum(AI_GENERATION),
    }),
  ),
  mergeCandidates: z.array(
    z.object({
      key: z.string(),
      existingNodeId: z.string(),
      likelihood: z.number(),
      reason: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You reconstruct how a person's exploration evolved from a document they give you (notes, a research report, an AI conversation, a GitHub issue).
Return a reasoning map, not a summary: the questions they asked, the hypotheses they considered, the evidence and experiments, the findings, the opportunities, and where exploration stopped.

Node types: question, hypothesis, evidence, experiment, finding, opportunity.
Edge types: led_to, supports, contradicts, derived_from, requires, blocked_by, similar_to.
Edges always point down the exploration, from the earlier/parent step to the later/child step, like a reasoning tree read top to bottom:
- a question led_to its hypotheses; a finding led_to the new questions it raised.
- a hypothesis supports its supporting evidence, and contradicts the evidence against it (source = hypothesis, target = evidence).
- evidence or an experiment derived_from the finding drawn from it (source = evidence/experiment, target = finding).
- requires / blocked_by point from the dependent node to what it needs; similar_to links related branches.

Frontiers: unresolved questions, untested hypotheses, open opportunities, or explicit "further work" items. Mark them by setting "frontier" (with a concrete nextAction when one is stated or obvious); leave "frontier" null otherwise.

Be conservative. Each node must be a meaningful reasoning unit, not a sentence. Prefer fewer, well-connected nodes; a long document rarely needs more than 40.
Titles are short (under 15 words) and in the document's language.

Provenance is mandatory and must be honest:
- generationType "ai_extracted": the idea is explicitly stated in the source; you only structured it.
- generationType "ai_transformed": you summarized or rephrased several source passages into one node.
- generationType "ai_generated": an idea you are introducing that the source does not state (for example a follow-up direction). Use sparingly, at most 3 nodes, and never present your own idea as extracted.
- For every node grounded in the source, set lineStart/lineEnd to the cited line numbers (the L-numbers in the document). Set both to null only for ai_generated nodes.
- Edges: "ai_extracted" when the relation is stated in the source, otherwise "ai_generated".
- confidence (0..1) is how sure you are that the node faithfully reflects the source.

The user's existing exploration graph is listed with ids. When an extracted node is the same concept as an existing node, still emit the node but add a mergeCandidates entry (key = your node key, existingNodeId = the existing id, likelihood 0..1, reason). Never invent ids.
Set "domain" to a short project/domain label (reuse an existing one when it fits).`;

/** Calls Claude directly; the same port can later be served by the agentaab capability. */
export class ClaudeGraphExtractor implements GraphExtractor {
  readonly info: ExtractorInfo;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = "claude-opus-5-5",
  ) {
    this.client = new Anthropic({ apiKey });
    this.info = { capabilityId: CAPABILITY_ID, capabilityVersion: CAPABILITY_VERSION, model };
  }

  async extract(input: ExtractionInput): Promise<Extraction> {
    const existing = input.existing
      .slice(0, MAX_EXISTING_CONTEXT)
      .map((n) => `${n.id}\t${n.type}\t${n.domain || "-"}\t${n.title}`)
      .join("\n");

    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: betaZodOutputFormat(ExtractionSchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            `<existing_graph>\n${existing || "(empty)"}\n</existing_graph>`,
            input.domainHint ? `<domain_hint>${input.domainHint}</domain_hint>` : "",
            `<document name="${input.source.name}" kind="${input.source.kind}">\n${numberLines(input.source.content)}\n</document>`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });

    if (response.stop_reason === "refusal") throw new Error("The model declined to process this document.");
    if (response.stop_reason === "max_tokens") throw new Error("The document produced too large a graph; try a shorter source.");
    const out = response.parsed_output;
    if (!out) throw new Error("The model returned an unreadable graph.");

    return {
      domain: out.domain,
      nodes: out.nodes.map((n) => ({
        key: n.key,
        type: n.type,
        title: n.title,
        body: n.body,
        generationType: n.generationType,
        confidence: n.confidence,
        anchor: n.lineStart == null ? null : { lineStart: n.lineStart, lineEnd: n.lineEnd ?? n.lineStart, quote: "" },
        frontier: n.frontier,
      })),
      edges: out.edges.map((e) => ({ sourceKey: e.source, targetKey: e.target, type: e.type, generationType: e.generationType })),
      mergeCandidates: out.mergeCandidates,
      // Record the model that actually answered (a fallback may have served the request).
      extractor: { ...this.info, model: response.model, traceId: response.id },
    };
  }
}
