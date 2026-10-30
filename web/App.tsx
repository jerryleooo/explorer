import { BrowserRouter, Link, Route, Routes } from "react-router";
import { SearchBox } from "./components/SearchBox";
import { SessionControl } from "./components/SessionControl";
import { GraphPage } from "./pages/GraphPage";
import { HomePage } from "./pages/HomePage";
import { ProposalPage } from "./pages/ProposalPage";
import { SourcePage } from "./pages/SourcePage";
import { StoreProvider, useStore } from "./store";

export function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <div className="app">
          <header className="topbar">
            <Link to="/" className="brand">
              <span className="brand-mark" aria-hidden>◇</span> Explorer
            </Link>
            <SearchBox />
            <div className="topbar-right">
              <SessionControl />
              <a className="btn ghost" href="/api/export" download>
                Export JSON
              </a>
            </div>
          </header>
          <Notice />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/graph/:nodeId" element={<GraphPage />} />
            <Route path="/proposals/:proposalId" element={<ProposalPage />} />
            <Route path="/sources/:sourceId" element={<SourcePage />} />
          </Routes>
        </div>
      </BrowserRouter>
    </StoreProvider>
  );
}

function Notice() {
  const { notice, setNotice } = useStore();
  if (!notice) return null;
  return (
    <div className="notice" role="status">
      <span>{notice}</span>
      <button className="btn ghost small" onClick={() => setNotice(null)}>
        Dismiss
      </button>
    </div>
  );
}
