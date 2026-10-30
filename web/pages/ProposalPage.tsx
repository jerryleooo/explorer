import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { indexGraph } from "../../src/domain/graph";
import { NODE_TYPES, type ProposalView } from "../../src/domain/types";
import { api } from "../api";
import { GraphCanvas, type Selection } from "../components/GraphCanvas";
import { useGraphShortcuts } from "../components/useGraphShortcuts";
import { ShortcutHelp, Workspace } from "../components/Workspace";
import { NODE_TYPE_LABEL } from "../labels";
import { useStore } from "../store";

export function ProposalPage() {
  const { proposalId = "" } = useParams();
  const { refresh, setNotice } = useStore();
  const navigate = useNavigate();
  const [view, setView] = useState<ProposalView | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  const load = useCallback(() => api.proposal(proposalId).then(setView), [proposalId]);
  useEffect(() => {
    load().catch((e: Error) => setNotice(e.message));
  }, [load, setNotice]);

  const mutate = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      try {
        const result = await fn();
        await load();
        return result;
      } catch (e) {
        setNotice((e as Error).message);
        return undefined;
      }
    },
    [load, setNotice],
  );

  const draft = useMemo(() => view?.graph.nodes.filter((n) => n.proposalId === proposalId) ?? [], [view, proposalId]);
  const selectedNode = selection?.kind === "node" ? view?.graph.nodes.find((n) => n.id === selection.id) : undefined;

  useGraphShortcuts(
    useMemo(
      () => ({
        addChild: () => document.getElementById("quick-add-title")?.focus(),
        toggleFrontier: () => {
          if (selectedNode) void mutate(() => (selectedNode.frontier ? api.clearFrontier(selectedNode.id) : api.setFrontier(selectedNode.id, {})));
        },
        remove: () => {
          if (selection?.kind === "edge") void mutate(() => api.deleteEdge(selection.id)).then(() => setSelection(null));
          else if (selectedNode?.proposalId) void mutate(() => api.deleteNode(selectedNode.id)).then(() => setSelection(null));
        },
        escape: () => setSelection(null),
      }),
      [selectedNode, selection, mutate],
    ),
  );

  if (!view) return <main className="page"><p className="muted">Loading proposal…</p></main>;
  const { proposal, graph } = view;
  if (proposal.status !== "open") {
    return (
      <main className="page">
        <p>This proposal was {proposal.status}. <Link to="/">Back to frontiers</Link></p>
      </main>
    );
  }

  const counts = NODE_TYPES.map((t) => [t, draft.filter((n) => n.type === t).length] as const).filter(([, n]) => n > 0);
  const frontierCount = draft.filter((n) => n.frontier).length;
  const aiGenerated = draft.filter((n) => n.provenance.generationType === "ai_generated").length;
  const byId = new Map([...graph.nodes, ...view.mergeTargets].map((n) => [n.id, n]));

  const accept = async () => {
    // Not via mutate(): reloading would briefly render the now-closed proposal before navigating away.
    try {
      await api.acceptProposal(proposal.id);
    } catch (e) {
      setNotice((e as Error).message);
      return;
    }
    await refresh();
    const index = indexGraph(graph);
    const root = draft.find((n) => (index.incoming.get(n.id) ?? []).length === 0) ?? draft[0];
    navigate(root ? `/graph/${root.id}` : "/");
  };
  const discard = async () => {
    if (!confirm("Discard this proposed graph? The source document is kept.")) return;
    if (await mutate(() => api.discardProposal(proposal.id))) {
      await refresh();
      navigate("/");
    }
  };

  return (
    <Workspace
      graph={graph}
      selection={selection}
      mutate={mutate}
      onSelect={setSelection}
      emptyInspector={<ShortcutHelp />}
      toolbar={
        <>
          <div className="diff">
            <span className="draft-badge">Proposed graph</span>
            <Link to={`/sources/${proposal.sourceId}`} className="muted">{proposal.sourceName}</Link>
            {counts.map(([t, n]) => (
              <span key={t} className={`diff-chip type-${t}`}>+ {NODE_TYPE_LABEL[t]} {n}</span>
            ))}
            {frontierCount > 0 && <span className="diff-chip">+ Frontier {frontierCount}</span>}
            <span className="diff-chip">+ Edges {graph.edges.length}</span>
            {aiGenerated > 0 && <span className="ai-tag">✦ {aiGenerated} AI generated</span>}
            <span className="muted small">via {proposal.extractor.capabilityId}{proposal.extractor.model ? ` · ${proposal.extractor.model}` : ""}</span>
          </div>
          <div className="row">
            <button className="btn ghost" onClick={discard}>Discard</button>
            <button className="btn primary" onClick={accept}>Accept graph</button>
          </div>
        </>
      }
      aside={
        proposal.mergeCandidates.length > 0 && (
          <section className="merges">
            <h3>Possible merges</h3>
            {proposal.mergeCandidates.map((c) => (
              <div key={`${c.proposedNodeId}-${c.existingNodeId}`} className="merge">
                <div className="small muted">New</div>
                <button className="link" onClick={() => setSelection({ kind: "node", id: c.proposedNodeId })}>{byId.get(c.proposedNodeId)?.title}</button>
                <div className="small muted">≈ Existing · {Math.round(c.likelihood * 100)}% likely same concept</div>
                <div>{byId.get(c.existingNodeId)?.title ?? "(existing node)"}</div>
                {c.reason && <div className="small muted">{c.reason}</div>}
                <div className="row">
                  <button className="btn small" onClick={() => mutate(() => api.resolveMerge(proposal.id, c.proposedNodeId, c.existingNodeId, "merge"))}>Merge</button>
                  <button className="btn ghost small" onClick={() => mutate(() => api.resolveMerge(proposal.id, c.proposedNodeId, c.existingNodeId, "keep"))}>Keep separate</button>
                </div>
              </div>
            ))}
          </section>
        )
      }
      canvas={
        <GraphCanvas
          graph={graph}
          selection={selection}
          onSelect={setSelection}
          onConnect={(sourceId, targetId) => void mutate(() => api.createEdge({ sourceId, targetId, type: "led_to" }))}
        />
      }
    />
  );
}
