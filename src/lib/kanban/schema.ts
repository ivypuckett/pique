// DDL for a board DB — exactly three tables (statuses, cards, logs). Relational
// fields that would otherwise be edge tables live as JSON columns on `cards`:
// tags (kvp object), artifacts (array), predecessors (array, canonical edge
// store), and subtasks (array of {text, done}). Successors are derived on read
// from predecessors, never stored, so the two directions can't drift.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS statuses (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id           TEXT PRIMARY KEY,
  status_id    TEXT NOT NULL,
  position     INTEGER NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '{}',
  artifacts    TEXT NOT NULL DEFAULT '[]',
  predecessors TEXT NOT NULL DEFAULT '[]',
  subtasks     TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS logs (
  id      TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  action  TEXT NOT NULL,
  "from"  TEXT,
  "to"    TEXT,
  reason  TEXT
);
`;
