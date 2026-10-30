# Explorer — Exploration Graph

Phase 0/1 prototype for [jerryleooo/business#97](https://github.com/jerryleooo/business/issues/97):
**drop in what you've explored → get back a reasoning map → adjust it → merge it into a long-term graph → continue from the frontier.**

## What's here

- **Import first.** Drop Markdown / text files or paste notes and AI conversations. An extractor turns the source into a
  *Proposed Graph* (questions, hypotheses, evidence, experiments, findings, opportunities, typed edges, frontiers).
- **AI proposes, humans decide.** Proposals are drafts (dashed) until you review them: retype, edit, delete, reconnect
  (drag between nodes), add branches, merge duplicates, then **Accept graph**. Nothing touches the long-term graph before that.
- **Source anchors.** Every extracted node cites line ranges; anchors are rebuilt from the real source text, so they can't
  point at text that isn't there. "Open source" jumps to the highlighted lines.
- **Authorship ≠ approval ≠ provenance.** Nodes, edges and frontiers store `authorship` (human / ai / mixed),
  `generationType` (human, ai_extracted, ai_generated, ai_transformed, import, external_source), capability / model / trace,
  and approval separately. Accepting AI content never turns it into human content; a human rewriting AI text makes it
  `mixed`. Every node keeps a revision chain recording who changed what. UI marks: `✦` AI, `✦·` mixed.
- **Multi-document merge.** New nodes similar to existing ones (the capability's judgement plus a lexical matcher that handles
  Chinese) show up as "Possible merge" — Merge re-points the new node's edges onto the existing node.
- **Frontier home.** "Continue exploring" card (last explored, why it stopped, next step), other frontiers grouped by
  domain with filter/sort, and a zoomed-out list of explorations.
- **Focused graph.** Local neighbourhood around a node (ancestors/descendants to a depth), expand/collapse with
  "+N nodes" summaries, breadcrumbs, semantic zoom (zoomed out shows titles only), keyboard shortcuts
  (`N` add branch, `F` frontier, `↵` focus, `⌫` delete, `[`/`]` depth, `/` search).
- **Sessions & history.** Optional exploration sessions; every mutation goes to an append-only event log.
- **Export.** `GET /api/export` returns the whole graph with sources, revisions, sessions and events as JSON.

## Extractors

| Extractor | When | Authorship |
| --- | --- | --- |
| `extract-exploration-graph` via agentaab (`src/import/agentaabExtractor.ts`) | `AGENTAAB_BUSINESS_SLUG` + `AGENTAAB_RUNTIME_TOKEN` are set | AI, per-node `generationType` |
| `structural-import` (`src/import/heuristicExtractor.ts`) | agentaab not configured, or toggled off | human (`import`) — picks up `Q:` / `Hypothesis:` / `Evidence:` / `Conclusion:` / `Next:` lines (also `问题：` `假设：` `结论：` `下一步：` …) and questions, nested by headings and indentation |

AI runs only through [agentaab](../agentaab): Explorer holds no model-provider SDK or key. Model choice, provider
credentials, cost accounting, quotas and run traces live in the agentaab Agent Business; Explorer calls its runtime
(`GET /app/{slug}/runtime-config`, then `POST` the published completion endpoint with an app-scoped `pk_app_` / `eu_rt_`
token) and validates the structured result against the contract. The invocation id and reported model are stored in
each node's provenance.

The capability's instructions, user template and input/output schemas live in `src/import/extractionContract.ts`;
`capability/extract-exploration-graph.json` is the generated Single Agent definition to publish in agentaab
(regenerate with `UPDATE_CAPABILITY=1 pnpm test`; a test keeps the two in sync). Pick the model in agentaab.

## Architecture

```
web/            React + React Flow UI (desktop-first)
worker/         Cloudflare Worker (Hono) — the only code that sees Workers/D1 bindings
src/domain/     types, GraphRepository port, pure graph/frontier logic
src/import/     extraction port + contract, agentaab and structural extractors, sanitising, merge matching
capability/     generated agentaab Single Agent definition for extract-exploration-graph
src/storage/    SqlGraphRepository over a tiny SqlDatabase port + D1 adapter
migrations/     plain SQLite-subset schema (D1 now, local SQLite for a future Tauri app)
```

Tests run the same repository against Node's built-in SQLite (`tests/nodeSqlite.ts`), which keeps the schema portable.

## Develop

```bash
pnpm install
pnpm db:migrate:local
pnpm dev            # http://localhost:5173
pnpm test
pnpm typecheck
```

To enable AI extraction locally, put the agentaab runtime settings in `.dev.vars` (git-ignored):

```
AGENTAAB_API_URL=https://api.agentaab.com/api
AGENTAAB_BUSINESS_SLUG=<business serving extract-exploration-graph>
AGENTAAB_RUNTIME_TOKEN=<eu_rt_… or pk_app_… — never a creator token or provider key>
AGENTAAB_GUEST_ID=<anon:… , only with a pk_app_ token>
```

## Deploy (Cloudflare Workers + Static Assets + D1)

```bash
wrangler d1 create explorer          # copy the id into wrangler.jsonc
pnpm db:migrate:remote
wrangler secret put AGENTAAB_BUSINESS_SLUG
wrangler secret put AGENTAAB_RUNTIME_TOKEN
pnpm deploy
```

There is no product auth: put the deployment behind Cloudflare Access for private dogfooding.

## Not yet

PDF / web page import, R2 attachments, semantic (embedding) search, reopen suggestions from new evidence,
paragraph-level provenance, restoring a prior revision from the UI, the Tauri desktop app.
