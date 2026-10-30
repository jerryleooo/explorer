import { useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import type { Proposal } from "../../src/domain/types";
import { api } from "../api";
import { guessSourceKind } from "../labels";
import { useStore } from "../store";

const ACCEPTED = ".md,.markdown,.txt,.text";

export function ImportPanel({ domains }: { domains: string[] }) {
  const { aiExtraction, refresh, setNotice } = useStore();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [useAi, setUseAi] = useState(true);
  const extractor = aiExtraction && useAi ? "ai" : "structural";

  const importAll = async (sources: Array<{ name: string; content: string }>) => {
    let last: Proposal | null = null;
    try {
      for (const [i, s] of sources.entries()) {
        setBusy(`${extractor === "ai" ? "Reading" : "Structuring"} ${s.name}${sources.length > 1 ? ` (${i + 1}/${sources.length})` : ""}…`);
        last = await api.importSource({ kind: guessSourceKind(s.name, s.content), name: s.name, content: s.content, domain: domain || undefined, extractor });
      }
    } catch (e) {
      setNotice(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      await refresh();
    }
    if (last) navigate(`/proposals/${last.id}`);
  };

  const onFiles = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    const unsupported = list.filter((f) => !/\.(md|markdown|txt|text)$/i.test(f.name));
    if (unsupported.length) setNotice(`Not supported yet: ${unsupported.map((f) => f.name).join(", ")} — Markdown and plain text only for now.`);
    const readable = list.filter((f) => !unsupported.includes(f));
    if (readable.length) await importAll(await Promise.all(readable.map(async (f) => ({ name: f.name, content: await f.text() }))));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void onFiles(e.dataTransfer.files);
    else {
      const text = e.dataTransfer.getData("text/plain");
      if (text) {
        setPasting(true);
        setPasted(text);
      }
    }
  };

  return (
    <section className="import">
      <div
        className={`dropzone${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && !pasting && fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && fileInput.current?.click()}
      >
        {busy ? (
          <>
            <div className="spinner" aria-hidden />
            <p className="dz-title">{busy}</p>
            <p className="muted">Reconstructing questions, hypotheses, evidence and frontiers</p>
          </>
        ) : (
          <>
            <p className="dz-title">Drop in what you've explored</p>
            <p className="muted">Markdown · notes · AI conversations · plain text</p>
            <p className="muted small">You get back a map of where your thinking has been — and where to go next.</p>
          </>
        )}
        <input ref={fileInput} type="file" accept={ACCEPTED} multiple hidden onChange={(e) => void onFiles(e.target.files)} />
      </div>

      <div className="import-options">
        <button className="btn ghost small" onClick={() => setPasting((p) => !p)} disabled={Boolean(busy)}>
          {pasting ? "Hide paste box" : "Paste text instead"}
        </button>
        <input list="domain-options" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Domain (optional)" className="small-input" />
        <datalist id="domain-options">
          {domains.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        {aiExtraction ? (
          <label className="switch small">
            <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
            <span>AI extraction (agentaab)</span>
          </label>
        ) : (
          <span className="muted small" title="Set AGENTAAB_BUSINESS_SLUG and AGENTAAB_RUNTIME_TOKEN on the Worker to enable AI extraction">
            Structural import · AI extraction not configured
          </span>
        )}
      </div>

      {pasting && (
        <form
          className="paste stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (pasted.trim()) void importAll([{ name: name || "Pasted text", content: pasted }]).then(() => setPasted(""));
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. “ChatGPT — USDC arbitrage, 30 Oct”" />
          <textarea rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste notes, a research report or an AI conversation…" />
          <div className="row">
            <button className="btn primary" type="submit" disabled={!pasted.trim() || Boolean(busy)}>Build exploration map</button>
          </div>
        </form>
      )}
    </section>
  );
}
