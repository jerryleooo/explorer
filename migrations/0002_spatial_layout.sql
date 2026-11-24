-- Persist user-arranged spatial coordinates and pin locks on nodes.
ALTER TABLE nodes ADD COLUMN x REAL;
ALTER TABLE nodes ADD COLUMN y REAL;
ALTER TABLE nodes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
