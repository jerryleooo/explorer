import type { Extraction, ExtractorInfo } from "../domain/types";
import { numberLines, type ExtractionInput, type GraphExtractor } from "./extraction";
import { CAPABILITY_ID, ExtractionOutputSchema, toExtraction, type ExtractionCapabilityInput } from "./extractionContract";

const MAX_EXISTING_CONTEXT = 400;
const TIMEOUT_MS = 180_000;

export interface AgentaabConfig {
  /** e.g. https://api.agentaab.com/api */
  apiUrl: string;
  /** The Agent Business that serves the extract-exploration-graph capability. */
  businessSlug: string;
  /** App-scoped runtime token (pk_app_… or eu_rt_…), never a creator token or provider key. */
  runtimeToken: string;
  /** Required with a pk_app_ token: an app-scoped anon:… guest id. */
  guestId?: string;
}

export class AgentaabError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  401: "The agentaab runtime token is invalid or expired.",
  402: "agentaab quota or credits are exhausted for this business.",
  403: "agentaab denied access to this business.",
  413: "This source exceeds the agentaab runtime input limit.",
  429: "agentaab rate limit reached; wait before importing again.",
};

/** Reads agentaab settings from the environment; null when AI extraction is not configured. */
export function agentaabConfigFrom(env: {
  AGENTAAB_API_URL?: string;
  AGENTAAB_BUSINESS_SLUG?: string;
  AGENTAAB_RUNTIME_TOKEN?: string;
  AGENTAAB_GUEST_ID?: string;
}): AgentaabConfig | null {
  const { AGENTAAB_API_URL, AGENTAAB_BUSINESS_SLUG, AGENTAAB_RUNTIME_TOKEN, AGENTAAB_GUEST_ID } = env;
  if (!AGENTAAB_BUSINESS_SLUG || !AGENTAAB_RUNTIME_TOKEN) return null;
  return {
    apiUrl: AGENTAAB_API_URL || "https://api.agentaab.com/api",
    businessSlug: AGENTAAB_BUSINESS_SLUG,
    runtimeToken: AGENTAAB_RUNTIME_TOKEN,
    guestId: AGENTAAB_GUEST_ID,
  };
}

/**
 * Runs graph extraction through a released agentaab capability. Model choice, provider
 * credentials, cost accounting and traces stay in agentaab; this client only sends inputs
 * and validates the structured result.
 */
export class AgentaabGraphExtractor implements GraphExtractor {
  readonly info: ExtractorInfo;
  private readonly base: URL;
  private readonly root: URL;

  constructor(
    private readonly config: AgentaabConfig,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.base = new URL(config.apiUrl.replace(/\/$/, "") + "/");
    const local = this.base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(this.base.hostname);
    if ((this.base.protocol !== "https:" && !local) || this.base.username || this.base.password) {
      throw new AgentaabError("AGENTAAB_API_URL must be an HTTPS URL without credentials.", 503, "invalid_configuration");
    }
    if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(config.businessSlug)) {
      throw new AgentaabError("AGENTAAB_BUSINESS_SLUG is invalid.", 503, "invalid_configuration");
    }
    if (!/^(pk_app_|eu_rt_)[A-Za-z0-9_-]+$/.test(config.runtimeToken)) {
      throw new AgentaabError("AGENTAAB_RUNTIME_TOKEN must be an app-scoped pk_app_ or eu_rt_ token.", 503, "invalid_configuration");
    }
    if (config.runtimeToken.startsWith("pk_app_") && !/^anon:[A-Za-z0-9_-]{1,100}$/.test(config.guestId ?? "")) {
      throw new AgentaabError("AGENTAAB_GUEST_ID (anon:…) is required with a pk_app_ token.", 503, "guest_identity_required");
    }
    this.root = new URL(`app/${config.businessSlug}/`, this.base);
    this.info = { capabilityId: CAPABILITY_ID, capabilityVersion: `agentaab:${config.businessSlug}` };
  }

  async extract(input: ExtractionInput): Promise<Extraction> {
    const published = await this.request<{ type?: string; interaction_mode?: string; runtime?: { completion_endpoint?: unknown } }>(
      new URL("runtime-config", this.root),
    );
    if (published.type === "workflow" || published.interaction_mode === "chat") {
      throw new AgentaabError("Publish extract-exploration-graph as a completion Single Agent.", 422, "completion_required");
    }
    if (typeof published.runtime?.completion_endpoint !== "string") {
      throw new AgentaabError("The agentaab business has no published completion endpoint.", 502, "runtime_contract_missing");
    }
    const endpoint = this.businessUrl(published.runtime.completion_endpoint);

    const inputs: ExtractionCapabilityInput = {
      document: numberLines(input.source.content),
      source_name: input.source.name,
      source_kind: input.source.kind,
      existing_graph:
        input.existing
          .slice(0, MAX_EXISTING_CONTEXT)
          .map((n) => `${n.id}\t${n.type}\t${n.domain || "-"}\t${n.title}`)
          .join("\n") || "(empty)",
      domain_hint: input.domainHint,
    };
    const payload = await this.request<Record<string, unknown>>(endpoint, {
      inputs,
      response_mode: "blocking",
      ...(this.config.runtimeToken.startsWith("pk_app_") ? { user: this.config.guestId } : {}),
    });

    const parsed = ExtractionOutputSchema.safeParse(structuredOutput(payload));
    if (!parsed.success) {
      throw new AgentaabError("The capability returned a graph that does not match the extraction contract.", 422, "report_contract_mismatch");
    }
    const metadata = (payload.metadata ?? {}) as { model?: unknown };
    return toExtraction(parsed.data, {
      ...this.info,
      ...(typeof metadata.model === "string" ? { model: metadata.model } : {}),
      ...(typeof payload.id === "string" ? { traceId: payload.id } : {}),
    });
  }

  /** A runtime-config response must never point credentials outside this business. */
  private businessUrl(path: string): URL {
    const url = new URL(path, this.base);
    if (url.origin !== this.root.origin || !url.pathname.startsWith(this.root.pathname) || url.search || url.hash) {
      throw new AgentaabError("agentaab returned an endpoint outside this business.", 502, "unsafe_runtime_endpoint");
    }
    return url;
  }

  private async request<T>(url: URL, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${this.config.runtimeToken}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      // Single-shot: a timed-out invocation may still have run and been charged.
      throw new AgentaabError("Could not reach agentaab. A timed-out extraction may still have run; check agentaab Operations before retrying.", 503, "runtime_unavailable");
    }
    const payload = (await response.json().catch(() => null)) as (T & { code?: unknown }) | null;
    if (!response.ok) {
      const code = typeof payload?.code === "string" ? payload.code : "runtime_error";
      throw new AgentaabError(STATUS_MESSAGES[response.status] ?? `agentaab could not complete the extraction (${response.status}).`, response.status, code);
    }
    if (!payload || typeof payload !== "object") throw new AgentaabError("agentaab returned an invalid response.", 502, "invalid_runtime_response");
    return payload;
  }
}

/** Structured outputs, or a JSON answer (optionally fenced) from a completion capability. */
function structuredOutput(payload: Record<string, unknown>): unknown {
  const data = payload.data as Record<string, unknown> | undefined;
  const outputs = data?.outputs ?? payload.outputs;
  if (outputs && typeof outputs === "object" && !Array.isArray(outputs)) return outputs;
  const answer = payload.answer ?? data?.answer;
  if (typeof answer !== "string") return null;
  try {
    return JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return null;
  }
}
