// The board: owns one SQLite connection and every board operation. This single
// module is the shared surface — the frontend reaches it over win.bind (see the
// kanban* handlers in desktop.ts) and the pi agent reaches it in-process — so all
// mutations, logging, and derivation live here and nowhere else.
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.ts";

export interface StatusRow {
  id: string;
  name: string;
  position: number;
}

export interface CardRow {
  id: string;
  statusId: string;
  position: number;
  title: string;
  description: string;
  tags: Record<string, string>;
  artifacts: string[];
  predecessors: string[];
  parentId: string | null;
  // Derived on read, never stored:
  successors: string[]; // cards that list this card as a predecessor
  children: string[]; // cards whose parent_id is this card
}

export interface Board {
  statuses: StatusRow[];
  cards: CardRow[];
}

export interface BoardHandle {
  raw: DatabaseSync;
  getBoard(): Board;
  close(): void;
}

interface RawCard {
  id: string;
  status_id: string;
  position: number;
  title: string;
  description: string;
  tags: string;
  artifacts: string;
  predecessors: string;
  parent_id: string | null;
}

function hydrate(rows: RawCard[]): CardRow[] {
  // Build predecessor edges once, then invert for successors and gather children.
  const preds = new Map<string, string[]>();
  for (const r of rows) preds.set(r.id, JSON.parse(r.predecessors));
  const successors = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const r of rows) {
    for (const p of preds.get(r.id)!) {
      (successors.get(p) ?? successors.set(p, []).get(p)!).push(r.id);
    }
    if (r.parent_id) {
      (children.get(r.parent_id) ?? children.set(r.parent_id, []).get(r.parent_id)!).push(r.id);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    statusId: r.status_id,
    position: r.position,
    title: r.title,
    description: r.description,
    tags: JSON.parse(r.tags),
    artifacts: JSON.parse(r.artifacts),
    predecessors: preds.get(r.id)!,
    parentId: r.parent_id,
    successors: successors.get(r.id) ?? [],
    children: children.get(r.id) ?? [],
  }));
}

export function openBoard(
  dbPath: string,
  opts: { defaultStatuses: { name: string }[] },
): BoardHandle {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(SCHEMA);

  // Seed statuses only when the board has none, so reopening never duplicates.
  const count = (db.prepare("SELECT count(*) c FROM statuses").get() as { c: number }).c;
  if (count === 0) {
    const ins = db.prepare("INSERT INTO statuses (id, name, position) VALUES (?, ?, ?)");
    opts.defaultStatuses.forEach((s, i) => ins.run(crypto.randomUUID(), s.name, i));
  }

  return {
    raw: db,
    getBoard() {
      const statuses = db
        .prepare("SELECT id, name, position FROM statuses ORDER BY position")
        .all() as unknown as StatusRow[];
      const cards = hydrate(
        db.prepare("SELECT * FROM cards ORDER BY position").all() as unknown as RawCard[],
      );
      return { statuses, cards };
    },
    close() {
      db.close();
    },
  };
}
