import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { indexGraph } from "../../src/domain/graph";
import { NODE_TYPES, type ProposalView } from "../../src/domain/types";
import { api } from "../api";
import { GraphCanvas, type Selection } from "../components/GraphCanvas";
import { useGraphShortcuts } from "../components/useGraphShortcuts";
import { ShortcutHelp, Workspace } from "../components/Workspace";
import { AUTHORSHIP_LABEL, NODE_TYPE_LABEL } from "../labels";
import { useStore } from "../store";

export function ProposalPage() {
  const { proposalId = "" } = useParams();
  const { refresh, setNotice } = useStore();
  const navigate = useNavigate();
  const [view, setView] = useState<ProposalView | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [centerTarget, setCenterTarget] = useState<{ id: string; seq: number } | null>(null);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

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

  const centerNode = useCallback((id: string) => {
    setSelection({ kind: "node", id });
    setCenterTarget((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

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
        escape: () => {
          if (showDiffModal) setShowDiffModal(false);
          else setSelection(null);
        },
      }),
      [selectedNode, selection, mutate, showDiffModal],
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

  const accept = async (nodeIds?: string[]) => {
    try {
      const result = await api.acceptProposal(proposal.id, nodeIds);
      await refresh();
      if (result.status === "accepted") {
        const index = indexGraph(graph);
        const acceptedPool = nodeIds ? draft.filter((n) => nodeIds.includes(n.id)) : draft;
        const root = acceptedPool.find((n) => (index.incoming.get(n.id) ?? []).length === 0) ?? acceptedPool[0];
        navigate(root ? `/graph/${root.id}` : "/map");
      } else {
        setShowDiffModal(false);
        setSelection(null);
        await load();
        setNotice(`Accepted ${nodeIds?.length ?? 0} node(s). Remaining drafts are still open for review.`);
      }
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const openDiffModal = () => {
    setCheckedIds(new Set(draft.map((n) => n.id)));
    setShowDiffModal(true);
  };

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const discard = async () => {
    if (!confirm("Discard this proposed graph? The source document is kept.")) return;
    if (await mutate(() => api.discardProposal(proposal.id))) {
      await refresh();
      navigate("/");
    }
  };

  return (
    <>
      <Workspace
        graph={graph}
        selection={selection}
        mutate={mutate}
        onSelect={setSelection}
        onCenterNode={centerNode}
        onAcceptNode={(id) => void accept([id])}
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
              <button className="btn" onClick={openDiffModal} disabled={draft.length === 0}>Review diff</button>
              <button className="btn primary" onClick={() => void accept()} disabled={draft.length === 0}>Accept graph</button>
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
            centerTarget={centerTarget}
            onSelect={setSelection}
            onConnect={(sourceId, targetId) => void mutate(() => api.createEdge({ sourceId, targetId, type: "led_to" }))}
            onNodeMove={(id, x, y) => void mutate(() => api.updateNode(id, { x, y }))}
          />
        }
      />

      {showDiffModal && (
        <div className="modal-backdrop" onClick={() => setShowDiffModal(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Review Graph Diff</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              Accepting merges selected nodes into your long-term graph without changing authorship. Unchecked nodes remain as drafts.
            </p>
            <div className="stack" style={{ maxHeight: 360, overflow: "auto", margin: "12px 0" }}>
              {draft.map((n) => (
                <label key={n.id} className="diff-check-row">
                  <input type="checkbox" checked={checkedIds.has(n.id)} onChange={() => toggleChecked(n.id)} />
                  <span className="grow">
                    <strong>{n.title}</strong>
                    <div className="muted small">
                      {NODE_TYPE_LABEL[n.type]} · {AUTHORSHIP_LABEL[n.authorship]}
                      {n.frontier ? " · ◎ Frontier" : ""}
                    </div>
                  </span>
                </label>
              ))}
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" type="button" onClick={() => setShowDiffModal(false)}>Cancel</button>
              <button
                className="btn primary"
                type="button"
                disabled={checkedIds.size === 0}
                onClick={() => void accept([...checkedIds])}
              >
                Accept selected ({checkedIds.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
