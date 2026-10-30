import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { Source } from "../../src/domain/types";
import { api } from "../api";
import { relativeTime } from "../labels";

export function SourcePage() {
  const { sourceId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const [start, end] = (params.get("lines") ?? "").split("-").map(Number);

  useEffect(() => {
    api.source(sourceId).then(setSource, (e: Error) => setError(e.message));
  }, [sourceId]);
  useEffect(() => {
    highlight.current?.scrollIntoView({ block: "center" });
  }, [source]);

  if (error) return <main className="page"><p>{error}</p></main>;
  if (!source) return <main className="page"><p className="muted">Loading source…</p></main>;
  const lines = source.content.replace(/\r\n?/g, "\n").split("\n");
  const inRange = (n: number) => start !== undefined && n >= start && n <= (end || start);

  return (
    <main className="page source-page">
      <button className="btn ghost small" onClick={() => navigate(-1)}>← Back</button>
      <h2>{source.name}</h2>
      <p className="muted small">{source.kind} · imported {relativeTime(source.createdAt)} · {lines.length} lines</p>
      <div className="source-text">
        {lines.map((line, i) => (
          <div key={i} ref={i + 1 === start ? highlight : undefined} className={inRange(i + 1) ? "line hl" : "line"}>
            <span className="ln">{i + 1}</span>
            <span className="lt">{line || " "}</span>
          </div>
        ))}
      </div>
    </main>
  );
}
