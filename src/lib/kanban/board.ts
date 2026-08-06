// The board: owns one SQLite connection and every board operation. This single
// module is the shared surface — the frontend reaches it over win.bind (see the
// kanban* handlers in desktop.ts) and the pi agent reaches it in-process — so all
// mutations, logging, and derivation live here and nowhere else. It also announces
// a card's arrivals outward, to whoever openBoard was given a listener for.
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.ts";

export type StatusRow = {
  id: string;
  name: string;
  position: number;
};

// A step within a card. Subtasks are card content, not cards of their own: they
// have no id, no status and no place on the board, and are addressed only by
// their index in the card's list.
export type Subtask = {
  text: string;
  done: boolean;
};

export type CardRow = {
  id: string;
  statusId: string;
  position: number;
  title: string;
  description: string;
  tags: Record<string, string>;
  artifacts: string[];
  predecessors: string[];
  subtasks: Subtask[];
  // Derived on read, never stored:
  successors: string[]; // cards that list this card as a predecessor
};

export type Board = {
  statuses: StatusRow[];
  cards: CardRow[];
};

// A card ARRIVING in a column: a setStatus that changed its column, or a createCard.
// The board's only outward event, and the whole of what it says — it knows nothing about
// who listens (automatons/kanban.ts, wired up in kanban/service.ts).
//
// Not fired for a reorder within a column, a metadata edit or a connection change: none
// of those is an arrival, and firing on them would relaunch a job because somebody fixed
// a typo in a title.
export type CardArrival = {
  cardId: string;
  title: string;
  statusId: string;
  statusName: string;
};

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
};

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
  // Reorder a card within the column it is already in. Ordering is a view concern, so
  // this is not logged — same as the column edits above, and unlike setStatus.
  moveCard(arg: { cardId: string; position: number }): void;
  setStatus(
    arg: { cardId: string; statusId: string; reason: string; actor: Actor },
  ): void;
  setMetadata(arg: {
    cardId: string;
    title?: string;
    description?: string;
    tags?: Record<string, string>;
    subtasks?: Subtask[];
    actor: Actor;
  }): void;
  setConnections(arg: {
    cardId: string;
    artifacts?: string[];
    predecessors?: string[];
    successors?: string[];
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
  subtasks: string;
}

function hydrate(rows: RawCard[]): CardRow[] {
  // Build predecessor edges once, then invert for successors.
  const preds = new Map<string, string[]>();
  for (const r of rows) preds.set(r.id, JSON.parse(r.predecessors));
  const successors = new Map<string, string[]>();
  for (const r of rows) {
    for (const p of preds.get(r.id)!) {
      (successors.get(p) ?? successors.set(p, []).get(p)!).push(r.id);
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
    subtasks: JSON.parse(r.subtasks),
    successors: successors.get(r.id) ?? [],
  }));
}

export function openBoard(
  dbPath: string,
  opts: {
    defaultStatuses: { name: string }[];
    onCardArrived?: (arrival: CardArrival) => void;
  },
): BoardHandle {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(SCHEMA);

  // Seed statuses only when the board has none, so reopening never duplicates.
  const count =
    (db.prepare("SELECT count(*) c FROM statuses").get() as { c: number }).c;
  if (count === 0) {
    const ins = db.prepare(
      "INSERT INTO statuses (id, name, position) VALUES (?, ?, ?)",
    );
    opts.defaultStatuses.forEach((s, i) =>
      ins.run(crypto.randomUUID(), s.name, i)
    );
  }

  const getRaw = (id: string): RawCard =>
    db.prepare("SELECT * FROM cards WHERE id = ?").get(
      id,
    ) as unknown as RawCard;

  const nextPosition = (statusId: string): number =>
    (db.prepare(
      "SELECT coalesce(max(position), -1) + 1 n FROM cards WHERE status_id = ?",
    ).get(
      statusId,
    ) as { n: number }).n;

  const statusIds = (): string[] =>
    (db.prepare("SELECT id FROM statuses ORDER BY position")
      .all() as unknown as { id: string }[])
      .map((r) => r.id);

  // Rewrite every status position to its index in `ids`, so an insert, move or delete
  // always leaves a dense 0..n-1 ordering.
  const renumber = (ids: string[]): void => {
    const upd = db.prepare("UPDATE statuses SET position = ? WHERE id = ?");
    ids.forEach((id, i) => upd.run(i, id));
  };

  // Delete a card and every edge pointing at it, so no card is left waiting on
  // something that no longer exists.
  const removeCard = (cardId: string): void => {
    db.prepare("DELETE FROM cards WHERE id = ?").run(cardId);
    // Prune the deleted id from every card's predecessor list.
    const rows = db.prepare("SELECT id, predecessors FROM cards")
      .all() as unknown as {
        id: string;
        predecessors: string;
      }[];
    const upd = db.prepare("UPDATE cards SET predecessors = ? WHERE id = ?");
    for (const r of rows) {
      const preds = JSON.parse(r.predecessors) as string[];
      if (preds.includes(cardId)) {
        upd.run(JSON.stringify(preds.filter((p) => p !== cardId)), r.id);
      }
    }
  };

  // Subtasks arrive from the pi tools as whatever the model emitted: the typebox schema
  // on the tool only describes the shape to the model, nothing validates against it on
  // the way in. An entry with no text would be stored as-is and render as a blank row,
  // so it is refused here; the message reaches the agent as a tool error it can correct.
  // A missing `done` is the one thing worth defaulting rather than rejecting.
  const cleanSubtasks = (subtasks: Subtask[]): Subtask[] => {
    if (!Array.isArray(subtasks)) throw new Error("subtasks must be an array");
    return subtasks.map((s, i) => {
      if (typeof s !== "object" || s === null || typeof s.text !== "string") {
        throw new Error(`subtask ${i} must be an object with a text string`);
      }
      const text = s.text.trim();
      if (text === "") throw new Error(`subtask ${i} cannot be empty`);
      return { text, done: s.done === true };
    });
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

  // Fire-and-forget: the write has already committed, and a consumer's failure must not
  // fail it. An unknown statusId announces nothing rather than a column with no name.
  const announce = (cardId: string, statusId: string, title: string): void => {
    if (!opts.onCardArrived) return;
    const row = db.prepare("SELECT name FROM statuses WHERE id = ?").get(
      statusId,
    ) as { name: string } | undefined;
    if (!row) return;
    try {
      opts.onCardArrived({ cardId, title, statusId, statusName: row.name });
    } catch (err) {
      console.error(
        `kanban: card ${cardId} in ${row.name}: its arrival handler failed:`,
        err,
      );
    }
  };

  return {
    raw: db,
    getBoard() {
      const statuses = db
        .prepare("SELECT id, name, position FROM statuses ORDER BY position")
        .all() as unknown as StatusRow[];
      const cards = hydrate(
        db.prepare("SELECT * FROM cards ORDER BY position")
          .all() as unknown as RawCard[],
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
      db.prepare("INSERT INTO statuses (id, name, position) VALUES (?, ?, ?)")
        .run(
          id,
          clean,
          statusIds().length,
        );
      return id;
    },

    renameStatus({ statusId, name }) {
      db.prepare("UPDATE statuses SET name = ? WHERE id = ?").run(
        cleanName(name),
        statusId,
      );
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
      const cardIds =
        (db.prepare("SELECT id FROM cards WHERE status_id = ?").all(
          statusId,
        ) as unknown as { id: string }[]).map((r) => r.id);
      if (cardIds.length > 0 && !withCards) {
        throw new Error(
          `cannot delete a column that still has cards (${cardIds.length} remaining)`,
        );
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
      announce(id, statusId, title);
      return id;
    },

    deleteCard(cardId) {
      removeCard(cardId);
    },

    moveCard({ cardId, position }) {
      const card = getRaw(cardId);
      if (!card) return;
      const ids = (db.prepare(
        "SELECT id FROM cards WHERE status_id = ? ORDER BY position",
      ).all(card.status_id) as unknown as { id: string }[]).map((r) => r.id);
      const from = ids.indexOf(cardId);
      const to = Math.max(0, Math.min(position, ids.length - 1));
      ids.splice(from, 1);
      ids.splice(to, 0, cardId);
      // Card positions are per-column and only ever appended to (nextPosition), so they
      // can carry gaps; rewriting the whole column here leaves a dense 0..n-1 ordering.
      const upd = db.prepare("UPDATE cards SET position = ? WHERE id = ?");
      ids.forEach((id, i) => upd.run(i, id));
    },

    setStatus({ cardId, statusId, reason, actor }) {
      if (!reason || reason.trim() === "") {
        throw new Error("setStatus requires a change reason");
      }
      const prev = getRaw(cardId);
      db.prepare("UPDATE cards SET status_id = ?, position = ? WHERE id = ?")
        .run(
          statusId,
          nextPosition(statusId),
          cardId,
        );
      log(
        cardId,
        "set_status",
        { statusId: prev.status_id },
        { statusId },
        reason,
        actor,
      );
      // Only a change of column is an arrival. `prev` is the row as it was BEFORE the
      // update, and a move leaves the title alone, so it is the right source for both.
      if (prev.status_id !== statusId) announce(cardId, statusId, prev.title);
    },

    setMetadata({ cardId, title, description, tags, subtasks, actor }) {
      // Checked before any write, so a rejected list can't leave a half-applied edit
      // behind (title and description are written further down).
      const clean = subtasks === undefined
        ? undefined
        : cleanSubtasks(subtasks);
      const prev = getRaw(cardId);
      const from: Record<string, unknown> = {};
      const to: Record<string, unknown> = {};
      if (title !== undefined) {
        db.prepare("UPDATE cards SET title = ? WHERE id = ?").run(
          title,
          cardId,
        );
        from.title = prev.title;
        to.title = title;
      }
      if (description !== undefined) {
        db.prepare("UPDATE cards SET description = ? WHERE id = ?").run(
          description,
          cardId,
        );
        from.description = prev.description;
        to.description = description;
      }
      if (tags !== undefined) {
        db.prepare("UPDATE cards SET tags = ? WHERE id = ?").run(
          JSON.stringify(tags),
          cardId,
        );
        from.tags = JSON.parse(prev.tags);
        to.tags = tags;
      }
      // The whole list is rewritten every time — there is no per-subtask operation, so
      // ticking one box and reordering the list are the same write.
      if (clean !== undefined) {
        db.prepare("UPDATE cards SET subtasks = ? WHERE id = ?").run(
          JSON.stringify(clean),
          cardId,
        );
        from.subtasks = JSON.parse(prev.subtasks);
        to.subtasks = clean;
      }
      log(cardId, "set_metadata", from, to, null, actor);
    },

    setConnections({ cardId, artifacts, predecessors, successors, actor }) {
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
      // A successor of A is written as "A is a predecessor of that card", so the two
      // directions can never disagree.
      if (successors !== undefined) {
        const addPred = db.prepare(
          "UPDATE cards SET predecessors = ? WHERE id = ?",
        );
        for (const sid of successors) {
          const preds = JSON.parse(getRaw(sid).predecessors) as string[];
          if (!preds.includes(cardId)) {
            addPred.run(JSON.stringify([...preds, cardId]), sid);
          }
        }
      }
      log(
        cardId,
        "set_connections",
        {
          artifacts: JSON.parse(prev.artifacts),
          predecessors: JSON.parse(prev.predecessors),
        },
        { artifacts, predecessors, successors },
        null,
        actor,
      );
    },

    close() {
      db.close();
    },
  };
}
