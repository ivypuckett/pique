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
