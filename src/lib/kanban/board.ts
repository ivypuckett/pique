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

export type Actor = "human" | "agent";

export interface LogRow {
  id: string;
  cardId: string;
  ts: number;
  actor: Actor;
  action: "set_status" | "set_metadata" | "set_connections";
  from: string | null;
  to: string | null;
  reason: string | null;
}

export interface BoardHandle {
  raw: DatabaseSync;
  getBoard(): Board;
  getLogs(cardId?: string): LogRow[];
  createCard(arg: {
    statusId: string;
    title?: string;
    description?: string;
    actor: Actor;
  }): string;
  deleteCard(cardId: string): void;
  setStatus(arg: { cardId: string; statusId: string; reason: string; actor: Actor }): void;
  setMetadata(arg: {
    cardId: string;
    title?: string;
    description?: string;
    tags?: Record<string, string>;
    actor: Actor;
  }): void;
  setConnections(arg: {
    cardId: string;
    artifacts?: string[];
    predecessors?: string[];
    successors?: string[];
    parentId?: string | null;
    actor: Actor;
  }): void;
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

  const getRaw = (id: string): RawCard =>
    db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as unknown as RawCard;

  const nextPosition = (statusId: string): number =>
    (db.prepare("SELECT coalesce(max(position), -1) + 1 n FROM cards WHERE status_id = ?").get(
      statusId,
    ) as { n: number }).n;

  const log = (
    cardId: string,
    action: LogRow["action"],
    from: unknown,
    to: unknown,
    reason: string | null,
    actor: Actor,
  ) =>
    db.prepare(
      `INSERT INTO logs (id, card_id, ts, actor, action, "from", "to", reason) VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      crypto.randomUUID(),
      cardId,
      Date.now(),
      actor,
      action,
      from === undefined ? null : JSON.stringify(from),
      to === undefined ? null : JSON.stringify(to),
      reason,
    );

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

    getLogs(cardId) {
      const sql = cardId
        ? `SELECT id, card_id AS cardId, ts, actor, action, "from", "to", reason FROM logs WHERE card_id = ? ORDER BY ts`
        : `SELECT id, card_id AS cardId, ts, actor, action, "from", "to", reason FROM logs ORDER BY ts`;
      const stmt = db.prepare(sql);
      return (cardId ? stmt.all(cardId) : stmt.all()) as unknown as LogRow[];
    },

    createCard({ statusId, title = "", description = "", actor: _actor }) {
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO cards (id, status_id, position, title, description) VALUES (?,?,?,?,?)",
      ).run(id, statusId, nextPosition(statusId), title, description);
      return id;
    },

    deleteCard(cardId) {
      db.prepare("DELETE FROM cards WHERE id = ?").run(cardId);
      db.prepare("UPDATE cards SET parent_id = NULL WHERE parent_id = ?").run(cardId);
      // Prune the deleted id from every card's predecessor list.
      const rows = db.prepare("SELECT id, predecessors FROM cards").all() as unknown as {
        id: string;
        predecessors: string;
      }[];
      const upd = db.prepare("UPDATE cards SET predecessors = ? WHERE id = ?");
      for (const r of rows) {
        const preds = JSON.parse(r.predecessors) as string[];
        if (preds.includes(cardId)) upd.run(JSON.stringify(preds.filter((p) => p !== cardId)), r.id);
      }
    },

    setStatus({ cardId, statusId, reason, actor }) {
      if (!reason || reason.trim() === "") throw new Error("setStatus requires a change reason");
      const prev = getRaw(cardId);
      db.prepare("UPDATE cards SET status_id = ?, position = ? WHERE id = ?").run(
        statusId,
        nextPosition(statusId),
        cardId,
      );
      log(cardId, "set_status", { statusId: prev.status_id }, { statusId }, reason, actor);
    },

    setMetadata({ cardId, title, description, tags, actor }) {
      const prev = getRaw(cardId);
      const from: Record<string, unknown> = {};
      const to: Record<string, unknown> = {};
      if (title !== undefined) {
        db.prepare("UPDATE cards SET title = ? WHERE id = ?").run(title, cardId);
        from.title = prev.title;
        to.title = title;
      }
      if (description !== undefined) {
        db.prepare("UPDATE cards SET description = ? WHERE id = ?").run(description, cardId);
        from.description = prev.description;
        to.description = description;
      }
      if (tags !== undefined) {
        db.prepare("UPDATE cards SET tags = ? WHERE id = ?").run(JSON.stringify(tags), cardId);
        from.tags = JSON.parse(prev.tags);
        to.tags = tags;
      }
      log(cardId, "set_metadata", from, to, null, actor);
    },

    setConnections({ cardId, artifacts, predecessors, successors, parentId, actor }) {
      const prev = getRaw(cardId);
      if (artifacts !== undefined) {
        db.prepare("UPDATE cards SET artifacts = ? WHERE id = ?").run(
          JSON.stringify(artifacts),
          cardId,
        );
      }
      if (predecessors !== undefined) {
        db.prepare("UPDATE cards SET predecessors = ? WHERE id = ?").run(
          JSON.stringify(predecessors),
          cardId,
        );
      }
      if (parentId !== undefined) {
        db.prepare("UPDATE cards SET parent_id = ? WHERE id = ?").run(parentId, cardId);
      }
      // A successor of A is written as "A is a predecessor of that card", so the two
      // directions can never disagree.
      if (successors !== undefined) {
        const addPred = db.prepare("UPDATE cards SET predecessors = ? WHERE id = ?");
        for (const sid of successors) {
          const preds = JSON.parse(getRaw(sid).predecessors) as string[];
          if (!preds.includes(cardId)) addPred.run(JSON.stringify([...preds, cardId]), sid);
        }
      }
      log(
        cardId,
        "set_connections",
        { artifacts: JSON.parse(prev.artifacts), predecessors: JSON.parse(prev.predecessors), parentId: prev.parent_id },
        { artifacts, predecessors, successors, parentId },
        null,
        actor,
      );
    },

    close() {
      db.close();
    },
  };
}
