// The board: owns one SQLite connection and every board operation. This single
// module is the shared surface — the frontend reaches it over win.bind (see the
// kanban* handlers in desktop.ts) and the pi agent reaches it in-process — so all
// mutations, logging, and derivation live here and nowhere else.
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.ts";

export type StatusRow = {
  id: string;
  name: string;
  position: number;
}

export type CardRow = {
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

export type Board = {
  statuses: StatusRow[];
  cards: CardRow[];
}

export type Actor = "human" | "agent";

export type LogRow = {
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
  // Column edits. Ids are stable across a rename, so cards and existing log payloads
  // are untouched by one. None of these are logged: the logs table is card-scoped.
  addStatus(arg: { name: string }): string;
  renameStatus(arg: { statusId: string; name: string }): void;
  moveStatus(arg: { statusId: string; position: number }): void;
  // `withCards` deletes the column's cards along with it; without it a non-empty
  // column is refused. Opt-in so only the human path (which confirms first) can cascade.
  deleteStatus(arg: { statusId: string; withCards?: boolean }): void;
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

  const statusIds = (): string[] =>
    (db.prepare("SELECT id FROM statuses ORDER BY position").all() as unknown as { id: string }[])
      .map((r) => r.id);

  // Rewrite every status position to its index in `ids`, so an insert, move or delete
  // always leaves a dense 0..n-1 ordering.
  const renumber = (ids: string[]): void => {
    const upd = db.prepare("UPDATE statuses SET position = ? WHERE id = ?");
    ids.forEach((id, i) => upd.run(i, id));
  };

  // Delete a card and every edge pointing at it, so no card is left parented under or
  // waiting on something that no longer exists.
  const removeCard = (cardId: string): void => {
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
  };

  const cleanName = (name: string): string => {
    const n = name.trim();
    if (n === "") throw new Error("column name cannot be empty");
    return n;
  };

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

    addStatus({ name }) {
      const clean = cleanName(name);
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO statuses (id, name, position) VALUES (?, ?, ?)").run(
        id,
        clean,
        statusIds().length,
      );
      return id;
    },

    renameStatus({ statusId, name }) {
      db.prepare("UPDATE statuses SET name = ? WHERE id = ?").run(cleanName(name), statusId);
    },

    moveStatus({ statusId, position }) {
      const ids = statusIds();
      const from = ids.indexOf(statusId);
      if (from === -1) return;
      const to = Math.max(0, Math.min(position, ids.length - 1));
      ids.splice(from, 1);
      ids.splice(to, 0, statusId);
      renumber(ids);
    },

    deleteStatus({ statusId, withCards = false }) {
      const ids = statusIds();
      if (ids.length <= 1) throw new Error("a board needs at least one column");
      const cardIds = (db.prepare("SELECT id FROM cards WHERE status_id = ?").all(
        statusId,
      ) as unknown as { id: string }[]).map((r) => r.id);
      if (cardIds.length > 0 && !withCards) {
        throw new Error(`cannot delete a column that still has cards (${cardIds.length} remaining)`);
      }
      for (const id of cardIds) removeCard(id);
      db.prepare("DELETE FROM statuses WHERE id = ?").run(statusId);
      renumber(ids.filter((id) => id !== statusId));
    },

    createCard({ statusId, title = "", description = "", actor: _actor }) {
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO cards (id, status_id, position, title, description) VALUES (?,?,?,?,?)",
      ).run(id, statusId, nextPosition(statusId), title, description);
      return id;
    },

    deleteCard(cardId) {
      removeCard(cardId);
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
      // Reject a parent that would make the card its own ancestor (self-parent or a
      // cycle). Checked before any write so a rejected edit leaves the card untouched.
      if (parentId !== undefined && parentId !== null) {
        if (parentId === cardId) throw new Error("a card cannot be its own parent");
        const seen = new Set<string>();
        let cur: string | null = parentId;
        while (cur) {
          if (cur === cardId) throw new Error("cannot set parent: would create a cycle");
          if (seen.has(cur)) break; // guard against a pre-existing cycle in the data
          seen.add(cur);
          cur = (getRaw(cur)?.parent_id) ?? null;
        }
      }
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
