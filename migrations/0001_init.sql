-- Exploration Graph schema. Kept within the common SQLite subset so it runs on both D1 and local SQLite.
--
-- Authorship (who produced it), approval (who accepted it) and provenance (where it came from)
-- are stored separately on nodes, edges and frontiers: human acceptance never converts AI authorship.
-- Rows with a proposal_id belong to a not-yet-accepted Proposed Graph; the long-term graph is proposal_id IS NULL.

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES sources (id),
  status TEXT NOT NULL DEFAULT 'open',
  domain TEXT NOT NULL DEFAULT '',
  extractor TEXT NOT NULL,
  merge_candidates TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  proposal_id TEXT REFERENCES proposals (id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  stop_note TEXT,
  confidence REAL,
  domain TEXT NOT NULL DEFAULT '',
  source_refs TEXT NOT NULL DEFAULT '[]',
  authorship TEXT NOT NULL DEFAULT 'human',
  generation_type TEXT NOT NULL DEFAULT 'human',
  provenance TEXT NOT NULL DEFAULT '{}',
  approved_by_human INTEGER NOT NULL DEFAULT 1,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_nodes_workspace ON nodes (workspace_id, proposal_id);

CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  proposal_id TEXT REFERENCES proposals (id),
  source_node_id TEXT NOT NULL REFERENCES nodes (id),
  target_node_id TEXT NOT NULL REFERENCES nodes (id),
  type TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  authorship TEXT NOT NULL DEFAULT 'human',
  generation_type TEXT NOT NULL DEFAULT 'human',
  provenance TEXT NOT NULL DEFAULT '{}',
  approved_by_human INTEGER NOT NULL DEFAULT 1,
  approved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_edges_workspace ON edges (workspace_id, proposal_id);
CREATE INDEX idx_edges_source ON edges (source_node_id);
CREATE INDEX idx_edges_target ON edges (target_node_id);

CREATE TABLE frontiers (
  node_id TEXT PRIMARY KEY REFERENCES nodes (id),
  workspace_id TEXT NOT NULL,
  potential TEXT,
  uncertainty TEXT,
  next_action TEXT,
  blocked_by TEXT,
  reopen_condition TEXT,
  authorship TEXT NOT NULL DEFAULT 'human',
  generation_type TEXT NOT NULL DEFAULT 'human',
  approved_by_human INTEGER NOT NULL DEFAULT 1,
  last_explored_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Who changed what: preserved even when the current node is 'mixed'.
CREATE TABLE node_revisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  previous_revision_id TEXT,
  content TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  generation_type TEXT NOT NULL,
  provenance TEXT NOT NULL DEFAULT '{}',
  session_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_revisions_node ON node_revisions (node_id, created_at);

CREATE TABLE exploration_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  summary TEXT
);

-- Append-only mutation log.
CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT REFERENCES exploration_sessions (id),
  actor_type TEXT NOT NULL DEFAULT 'human',
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before TEXT,
  after TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX idx_events_entity ON session_events (entity_id);
CREATE INDEX idx_events_session ON session_events (session_id);
