export type ColumnId = "center" | "right";
export type SideId = "right";

export interface ModuleRef {
  id: string;
  title: string;
  kind: string; // key into the module registry
  props?: {
    argv?: string[];
    autoCloseOnExit?: boolean;
    autoFocus?: boolean;
    path?: string;
  }; // per-tab payload, spread into the module
}

export interface ColumnState {
  collapsed: boolean; // center is never collapsed
  rows: ModuleRef[]; // center: the tab list (N); sides: a single row
  activeTabId: string; // visible right tab; center/left carry it for shape uniformity
}

// The file explorer is a sticky addon docked at the left edge of the right pane, full
// height, sharing the pane's width with the tabs. It isn't a tab (never in col.rows);
// ctrl+e shows/hides/focuses it.
export interface ExplorerState {
  widthCh: number; // the explorer's fixed width; the tabs take the rest of the pane
  hidden: boolean;
}

// Widths are measured in characters, not fractions of the window: the sized pane keeps
// the same number of columns of text however the window is resized or the workspace
// tiled, and its sibling absorbs the slack.
export interface ViewState {
  id: string; // stable across the view's lifetime; keys the tiled workspace
  chatWidthCh: number; // chat's fixed width; the tabbed pane takes the rest of the row
  center: ColumnState; // chat
  right: ColumnState; // the tabbed pane
  explorer: ExplorerState; // file-tree addon inside the right pane
}

export const MIN_WIDTH_CH = 10;

export function createInitialView(id = "view-1"): ViewState {
  return {
    id,
    chatWidthCh: 57,
    center: {
      collapsed: false,
      activeTabId: "center-1",
      rows: [{ id: "center-1", title: "Chat", kind: "chat" }],
    },
    right: {
      collapsed: false,
      activeTabId: "right-1",
      rows: [{ id: "right-1", title: "Terminal", kind: "terminal" }],
    },
    explorer: { widthCh: 30, hidden: false },
  };
}

export function visibleIds(v: ViewState): ColumnId[] {
  return v.right.collapsed ? ["center"] : ["center", "right"];
}

// Visual order is chat | [explorer · tabs]. "center-right" is the outer splitter between
// chat and the pane; "explorer-tabs" is the inner one between the explorer and the tabs.
export type Boundary = "center-right" | "explorer-tabs";

export const SPLITTER_PX = 6;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// Only the first pane of each pair carries a width; the second one flexes, so a resize
// sets a single number. `availableCh` is how many characters the two share, which is
// what keeps the flexible pane from being dragged below its minimum.
export function resizeBoundary(
  v: ViewState,
  b: Boundary,
  newFirstCh: number,
  availableCh: number,
): ViewState {
  const first = clamp(
    newFirstCh,
    MIN_WIDTH_CH,
    Math.max(MIN_WIDTH_CH, availableCh - MIN_WIDTH_CH),
  );
  if (b === "explorer-tabs") {
    return { ...v, explorer: { ...v.explorer, widthCh: first } };
  }
  return { ...v, chatWidthCh: first };
}

export function fixedPx(v: ViewState): number {
  // Outer row: the pane contributes one splitter when open, nothing when collapsed.
  return v.right.collapsed ? 0 : SPLITTER_PX;
}

// The sized pane holds its character width and its sibling takes the rest — until the
// row is too narrow for both, where the sibling keeps MIN_WIDTH_CH (the floor the
// splitter enforces too) and the sized one gives up characters instead of vanishing.
// Widening the window hands them straight back: the stored width never changed.
export function trackPair(firstCh: number): string {
  return `minmax(0, ${firstCh}ch) ${SPLITTER_PX}px minmax(${MIN_WIDTH_CH}ch, 1fr)`;
}

export function gridTemplateColumns(v: ViewState): string {
  // Visual order: chat (center, never collapses) | the pane (right). A collapsed pane
  // takes no space at all, so chat stretches over the whole row and shrinks back on
  // expand.
  if (v.right.collapsed) return "1fr";
  return trackPair(v.chatWidthCh);
}

export function toggleCollapse(v: ViewState, _id: SideId): ViewState {
  return { ...v, right: { ...v.right, collapsed: !v.right.collapsed } };
}

export function setExplorerHidden(v: ViewState, hidden: boolean): ViewState {
  return { ...v, explorer: { ...v.explorer, hidden } };
}

// Display label for a module kind, used for new-tab titles and the picker menu.
const LABELS: Record<string, string> = { gitdiff: "Git Diff" };
export function moduleLabel(kind: string): string {
  return LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

function nextRightId(rows: ModuleRef[]): string {
  const used = new Set(rows.map((r) => r.id));
  let n = 1;
  while (used.has(`right-${n}`)) n++;
  return `right-${n}`;
}

export function addTab(v: ViewState, kind: string): ViewState {
  const id = nextRightId(v.right.rows);
  const tab: ModuleRef = { id, title: moduleLabel(kind), kind };
  return {
    ...v,
    right: { ...v.right, rows: [...v.right.rows, tab], activeTabId: id },
  };
}

function basename(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  return parts.length ? parts[parts.length - 1] : path;
}

// Add a right-column terminal tab that runs $EDITOR on `path` and closes itself on exit.
export function addEditorTab(v: ViewState, path: string): ViewState {
  const id = nextRightId(v.right.rows);
  const tab: ModuleRef = {
    id,
    title: basename(path),
    kind: "terminal",
    props: { argv: ["$EDITOR", path], autoCloseOnExit: true, autoFocus: true },
  };
  return {
    ...v,
    right: { ...v.right, rows: [...v.right.rows, tab], activeTabId: id },
  };
}

// Add a right-column tab showing the git diff of a single file (called by the file-tree module).
export function addDiffTab(v: ViewState, path: string): ViewState {
  const id = nextRightId(v.right.rows);
  const tab: ModuleRef = {
    id,
    title: basename(path),
    kind: "gitdiff",
    props: { path },
  };
  return {
    ...v,
    right: { ...v.right, rows: [...v.right.rows, tab], activeTabId: id },
  };
}

export function setActiveTab(v: ViewState, tabId: string): ViewState {
  if (!v.right.rows.some((r) => r.id === tabId)) return v;
  return { ...v, right: { ...v.right, activeTabId: tabId } };
}

export function closeTab(v: ViewState, tabId: string): ViewState {
  const rows = v.right.rows;
  const idx = rows.findIndex((r) => r.id === tabId);
  if (idx === -1) return v;
  const nextRows = rows.filter((r) => r.id !== tabId);
  let activeTabId = v.right.activeTabId;
  if (activeTabId === tabId) {
    // Prefer the previous tab; fall back to the next (now at idx after removal).
    // Empty right column (last tab closed) carries no active id.
    activeTabId = (nextRows[idx - 1] ?? nextRows[idx])?.id ?? "";
  }
  return { ...v, right: { ...v.right, rows: nextRows, activeTabId } };
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
  return typeof col.collapsed === "boolean" &&
    typeof col.activeTabId === "string" &&
    Array.isArray(col.rows) && col.rows.every(isModuleRef) &&
    // The center may hold zero tabs (all closed); sides always have rows. When the
    // column is non-empty the active id must point at one of them.
    (col.rows.length === 0 ||
      (col.rows as ModuleRef[]).some((r) => r.id === col.activeTabId));
}

function isExplorerState(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const ex = e as Record<string, unknown>;
  return typeof ex.widthCh === "number" && typeof ex.hidden === "boolean";
}

// Structural guard for persisted state: rejects valid JSON of the wrong shape so a
// stale or corrupt localStorage value falls back to defaults instead of crashing render.
export function isViewState(v: unknown): v is ViewState {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.chatWidthCh === "number" &&
    isColumnState(obj.center) && isColumnState(obj.right) &&
    isExplorerState(obj.explorer);
}
