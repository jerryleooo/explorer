import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ExplorationSession, Graph, Proposal } from "../src/domain/types";
import { api } from "./api";

interface Store {
  graph: Graph | null;
  proposals: Proposal[];
  aiExtraction: boolean;
  refresh: () => Promise<void>;
  session: ExplorationSession | null;
  sessionChanges: number;
  notice: string | null;
  setNotice: (message: string | null) => void;
  /** Runs a mutation, then reloads the graph. Errors surface as a notice and resolve to undefined. */
  mutate: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [aiExtraction, setAiExtraction] = useState(false);
  const [session, setSession] = useState<ExplorationSession | null>(null);
  const [sessionChanges, setSessionChanges] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [g, s, p] = await Promise.all([api.graph(), api.activeSession(), api.proposals()]);
    setGraph(g);
    setProposals(p);
    setSession(s);
    setSessionChanges(s ? (await api.events({ sessionId: s.id })).length : 0);
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setNotice(`Could not load graph: ${e.message}`));
    api.capabilities().then((c) => setAiExtraction(c.aiExtraction), () => undefined);
  }, [refresh]);

  const mutate = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      try {
        const result = await fn();
        await refresh();
        return result;
      } catch (e) {
        setNotice((e as Error).message);
        return undefined;
      }
    },
    [refresh],
  );

  const value = useMemo(
    () => ({ graph, proposals, aiExtraction, refresh, session, sessionChanges, notice, setNotice, mutate }),
    [graph, proposals, aiExtraction, refresh, session, sessionChanges, notice, mutate],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}
