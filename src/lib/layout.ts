export type ColumnId = "left" | "center" | "right";
export type SideId = "left" | "right";

export interface ModuleRef {
  id: string;
  title: string;
  kind: string; // key into the module registry; "placeholder" for now
}

export interface ColumnState {
  widthPct: number; // share of the visible row; visible columns sum to 100
  collapsed: boolean; // center is never collapsed
  savedWidthPct: number; // width restored on expand
  rows: ModuleRef[]; // 1 for center; 1 or 2 for sides
}

export interface ViewState {
  left: ColumnState;
  center: ColumnState;
  right: ColumnState;
}

export const MIN_WIDTH_PCT = 10;

export function createInitialView(): ViewState {
  return {
    left: {
      widthPct: 20,
      collapsed: false,
      savedWidthPct: 20,
      rows: [
        { id: "left-1", title: "Left A", kind: "placeholder" },
        { id: "left-2", title: "Left B", kind: "placeholder" },
      ],
    },
    center: {
      widthPct: 60,
      collapsed: false,
      savedWidthPct: 60,
      rows: [{ id: "center-1", title: "Center", kind: "placeholder" }],
    },
    right: {
      widthPct: 20,
      collapsed: false,
      savedWidthPct: 20,
      rows: [{ id: "right-1", title: "Right", kind: "placeholder" }],
    },
  };
}

const ALL_IDS: ColumnId[] = ["left", "center", "right"];

export function visibleIds(v: ViewState): ColumnId[] {
  return ALL_IDS.filter((id) => !v[id].collapsed);
}

export type Boundary = "left-center" | "center-right";

export const SPLITTER_PX = 6;
export const RAIL_PX = 40;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function resizeBoundary(v: ViewState, b: Boundary, newFirstPct: number): ViewState {
  const [a, c]: [ColumnId, ColumnId] = b === "left-center" ? ["left", "center"] : ["center", "right"];
  const combined = v[a].widthPct + v[c].widthPct;
  const first = clamp(newFirstPct, MIN_WIDTH_PCT, combined - MIN_WIDTH_PCT);
  return {
    ...v,
    [a]: { ...v[a], widthPct: first },
    [c]: { ...v[c], widthPct: combined - first },
  };
}

export function fixedPx(v: ViewState): number {
  const splitters = (v.left.collapsed ? 0 : 1) + (v.right.collapsed ? 0 : 1);
  const rails = (v.left.collapsed ? 1 : 0) + (v.right.collapsed ? 1 : 0);
  return splitters * SPLITTER_PX + rails * RAIL_PX;
}

export function gridTemplateColumns(v: ViewState): string {
  const parts: string[] = [];
  parts.push(v.left.collapsed ? `${RAIL_PX}px` : `${v.left.widthPct}fr`);
  if (!v.left.collapsed) parts.push(`${SPLITTER_PX}px`);
  parts.push(`${v.center.widthPct}fr`);
  if (!v.right.collapsed) parts.push(`${SPLITTER_PX}px`);
  parts.push(v.right.collapsed ? `${RAIL_PX}px` : `${v.right.widthPct}fr`);
  return parts.join(" ");
}

function cap(id: SideId): string {
  return id === "left" ? "Left" : "Right";
}

// Collapse/expand use "prior width" semantics: savedWidthPct records a column's
// width the instant before it collapsed, and expand restores exactly that. A single
// collapse+expand round-trips perfectly. Interleaving collapses of BOTH side columns
// does not return to the pristine 20/60/20 — each column faithfully restores its own
// pre-collapse width, but those widths were already shifted by the earlier collapse.
// This is intended behavior for the layout-shell milestone (see design spec).
function collapse(v: ViewState, id: SideId): ViewState {
  const others = visibleIds(v).filter((x) => x !== id);
  const freed = v[id].widthPct;
  const otherSum = others.reduce((s, x) => s + v[x].widthPct, 0);
  const next: ViewState = {
    ...v,
    [id]: { ...v[id], collapsed: true, savedWidthPct: freed, widthPct: 0 },
  };
  for (const x of others) {
    next[x] = { ...v[x], widthPct: v[x].widthPct + freed * (v[x].widthPct / otherSum) };
  }
  return next;
}

function expand(v: ViewState, id: SideId): ViewState {
  const target = v[id].savedWidthPct;
  const others = visibleIds(v); // id is still collapsed, so excluded
  const otherSum = others.reduce((s, x) => s + v[x].widthPct, 0);
  const factor = (otherSum - target) / otherSum;
  const next: ViewState = {
    ...v,
    [id]: { ...v[id], collapsed: false, widthPct: target },
  };
  for (const x of others) {
    next[x] = { ...v[x], widthPct: v[x].widthPct * factor };
  }
  return next;
}

export function toggleCollapse(v: ViewState, id: SideId): ViewState {
  return v[id].collapsed ? expand(v, id) : collapse(v, id);
}

export function toggleRows(v: ViewState, id: SideId): ViewState {
  const col = v[id];
  const rows: ModuleRef[] = col.rows.length === 1
    ? [...col.rows, { id: `${id}-2`, title: `${cap(id)} B`, kind: "placeholder" }]
    : [col.rows[0]];
  return { ...v, [id]: { ...col, rows } };
}

function isModuleRef(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const row = r as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.title === "string" &&
    typeof row.kind === "string";
}

function isColumnState(c: unknown): boolean {
  if (typeof c !== "object" || c === null) return false;
  const col = c as Record<string, unknown>;
  return typeof col.widthPct === "number" && typeof col.collapsed === "boolean" &&
    typeof col.savedWidthPct === "number" &&
    Array.isArray(col.rows) && col.rows.length > 0 && col.rows.every(isModuleRef);
}

// Structural guard for persisted state: rejects valid JSON of the wrong shape so a
// stale or corrupt localStorage value falls back to defaults instead of crashing render.
export function isViewState(v: unknown): v is ViewState {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return isColumnState(obj.left) && isColumnState(obj.center) && isColumnState(obj.right);
}
