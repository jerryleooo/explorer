import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { NODE_TYPE_LABEL, isEditingText } from "../labels";
import { useStore } from "../store";

export function SearchBox() {
  const { graph } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isEditingText(e.target)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !graph) return [];
    return graph.nodes
      .filter((n) =>
        [n.title, n.body, n.domain, n.stopNote, n.frontier?.nextAction, n.frontier?.blockedBy, n.frontier?.reopenCondition].some((t) =>
          t?.toLowerCase().includes(q),
        ),
      )
      .slice(0, 8);
  }, [graph, query]);

  const go = (id: string) => {
    setQuery("");
    input.current?.blur();
    navigate(`/graph/${id}`);
  };

  return (
    <div className="search">
      <input
        ref={input}
        value={query}
        placeholder="Search the graph  ( / )"
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter" && results[active]) go(results[active].id);
          if (e.key === "Escape") setQuery("");
        }}
        aria-label="Search"
      />
      {results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((n, i) => (
            <li key={n.id} className={i === active ? "active" : ""} onMouseDown={() => go(n.id)} role="option" aria-selected={i === active}>
              <span className={`type-chip type-${n.type}`}>{NODE_TYPE_LABEL[n.type]}</span>
              <span className="grow">{n.title}</span>
              {n.domain && <span className="muted small">{n.domain}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
