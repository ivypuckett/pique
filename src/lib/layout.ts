import { isDuplicable, moduleDef, railGroups } from "./modules/manifest.ts";

export type ColumnId = "center" | "right";
export type SideId = "right";

export interface ModuleRef {
  id: string;
  title: string;
  kind: string; // key into the module registry
  // Which rail row the tab belongs to. Its kind for an ordinary module; "explorer" for
  // an editor or a path-scoped diff, which are that file rather than the module, and so
  // belong beside the file tree instead of among the terminals.
  group: string;
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

// The tabbed pane. One group is selected (the rail's row); the strip above the content
// shows that group's tabs and nothing else, so `tabs` is every open tab of every group
// in open order. `activeTabs` remembers a group's visible tab across a switch away and
// back, and carries no entry for a group with nothing open.
export interface RightState {
  collapsed: boolean;
  activeGroup: string;
  tabs: ModuleRef[];
  activeTabs: Record<string, string>;
}

export const EXPLORER = "explorer";

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
  right: RightState; // the tabbed pane
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
      rows: [{ id: "center-1", title: "Chat", kind: "chat", group: "chat" }],
    },
    right: {
      collapsed: false,
      activeGroup: "terminal",
      tabs: [{
        id: "right-1",
        title: "Terminal",
        kind: "terminal",
        group: "terminal",
      }],
      activeTabs: { terminal: "right-1" },
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

// Display label for a module kind, used for new-tab titles and the picker menu. Kinds
// with no manifest row (chat, the file tree, anything read back from another build) fall
// back to their capitalized kind.
export function moduleLabel(kind: string): string {
  return moduleDef(kind)?.label ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

function nextRightId(tabs: ModuleRef[]): string {
  const used = new Set(tabs.map((t) => t.id));
  let n = 1;
  while (used.has(`right-${n}`)) n++;
  return `right-${n}`;
}

// The selected group's tabs — what the strip shows, and what h/l and 1-9 walk.
export function groupTabs(v: ViewState, group = v.right.activeGroup): ModuleRef[] {
  return v.right.tabs.filter((t) => t.group === group);
}

// The tab on screen: the selected group's remembered one. "" when that group is empty.
export function activeTabId(v: ViewState): string {
  return v.right.activeTabs[v.right.activeGroup] ?? "";
}

// Show a rail row. Select-or-create: a module group with nothing open gets a tab, which
// is how ctrl+t k has always behaved. The explorer has no module of its own, so it is
// only ever selected — its tabs come from the tree.
export function selectGroup(v: ViewState, group: string): ViewState {
  if (groupTabs(v, group).length > 0 || group === EXPLORER) {
    return { ...v, right: { ...v.right, activeGroup: group } };
  }
  return moduleDef(group) ? addTab(v, group) : v;
}

// Move up or down the rail by `dir` (ctrl+t j/k). Clamped at the ends, like every other
// navigation. Selection only — walking past an empty row must not spawn a module in it.
export function focusAdjacentGroup(v: ViewState, dir: -1 | 1): ViewState {
  const groups = railGroups();
  const idx = groups.indexOf(v.right.activeGroup);
  if (idx === -1) return v;
  const next = Math.min(groups.length - 1, Math.max(0, idx + dir));
  return { ...v, right: { ...v.right, activeGroup: groups[next] } };
}

// Append a tab, select its group and make it that group's visible one.
function withTab(v: ViewState, tab: ModuleRef): ViewState {
  return {
    ...v,
    right: {
      ...v.right,
      tabs: [...v.right.tabs, tab],
      activeGroup: tab.group,
      activeTabs: { ...v.right.activeTabs, [tab.group]: tab.id },
    },
  };
}

// Open a module in the right pane. A singleton kind (everything but the terminal — see
// the manifest) is *revealed* rather than duplicated: a second Kanban tab is two views
// of the one board, and pressing ctrl+t k twice used to make one.
//
// Editors and path-scoped diffs are in the explorer group, not the module's, so one open
// beside the file tree never stands in for Git Diff itself.
export function addTab(v: ViewState, kind: string): ViewState {
  if (!isDuplicable(kind)) {
    const open = groupTabs(v, kind)[0];
    if (open) return setActiveTab(v, open.id);
  }
  const id = nextRightId(v.right.tabs);
  return withTab(v, { id, title: moduleLabel(kind), kind, group: kind });
}

function basename(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  return parts.length ? parts[parts.length - 1] : path;
}

// Add an explorer-group terminal tab that runs $EDITOR on `path` and closes itself on exit.
export function addEditorTab(v: ViewState, path: string): ViewState {
  return withTab(v, {
    id: nextRightId(v.right.tabs),
    title: basename(path),
    kind: "terminal",
    group: EXPLORER,
    props: { argv: ["$EDITOR", path], autoCloseOnExit: true, autoFocus: true },
  });
}

// Add an explorer-group tab showing the git diff of a single file (called by the file-tree module).
export function addDiffTab(v: ViewState, path: string): ViewState {
  return withTab(v, {
    id: nextRightId(v.right.tabs),
    title: basename(path),
    kind: "gitdiff",
    group: EXPLORER,
    props: { path },
  });
}

// Show a tab, selecting its group too — a tab is only clickable from its own strip, but
// revealing a singleton (addTab above) crosses groups.
export function setActiveTab(v: ViewState, tabId: string): ViewState {
  const tab = v.right.tabs.find((t) => t.id === tabId);
  if (!tab) return v;
  return {
    ...v,
    right: {
      ...v.right,
      activeGroup: tab.group,
      activeTabs: { ...v.right.activeTabs, [tab.group]: tab.id },
    },
  };
}

// Show the nth tab of the selected group, 1-based (ctrl+t 1-9). A no-op past the end of
// the strip.
export function focusTabAt(v: ViewState, n: number): ViewState {
  const tab = groupTabs(v)[n - 1];
  if (!tab) return v;
  return setActiveTab(v, tab.id);
}

// Move along the selected group's strip by `dir` (ctrl+t h/l). Clamped at the ends, like
// view and workspace navigation.
export function focusAdjacentTab(v: ViewState, dir: -1 | 1): ViewState {
  const tabs = groupTabs(v);
  const idx = tabs.findIndex((t) => t.id === activeTabId(v));
  if (idx === -1) return v;
  const next = Math.min(tabs.length - 1, Math.max(0, idx + dir));
  return setActiveTab(v, tabs[next].id);
}

export function closeTab(v: ViewState, tabId: string): ViewState {
  const tab = v.right.tabs.find((t) => t.id === tabId);
  if (!tab) return v;
  const activeTabs = { ...v.right.activeTabs };
  if (activeTabs[tab.group] === tabId) {
    // Prefer the previous tab of the same group; fall back to the next. A group whose
    // last tab is closed carries no entry at all — it stays selected and shows nothing.
    const siblings = groupTabs(v, tab.group);
    const idx = siblings.findIndex((t) => t.id === tabId);
    const next = siblings[idx - 1] ?? siblings[idx + 1];
    if (next) activeTabs[tab.group] = next.id;
    else delete activeTabs[tab.group];
  }
  return {
    ...v,
    right: {
      ...v.right,
      tabs: v.right.tabs.filter((t) => t.id !== tabId),
      activeTabs,
    },
  };
}

function isModuleRef(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const row = r as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.title === "string" &&
    typeof row.kind === "string" && typeof row.group === "string" &&
    row.group !== "";
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

function isRightState(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const right = r as Record<string, unknown>;
  if (typeof right.collapsed !== "boolean") return false;
  if (typeof right.activeGroup !== "string" || right.activeGroup === "") {
    return false;
  }
  if (!Array.isArray(right.tabs) || !right.tabs.every(isModuleRef)) return false;
  const active = right.activeTabs;
  if (typeof active !== "object" || active === null) return false;
  // Every remembered tab must still exist and still be in the group that remembers it.
  // A group with nothing open carries no entry, which is why absence is not checked.
  return Object.entries(active as Record<string, unknown>).every(([g, id]) =>
    (right.tabs as ModuleRef[]).some((t) => t.id === id && t.group === g)
  );
}

function isExplorerState(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const ex = e as Record<string, unknown>;
  return typeof ex.widthCh === "number" && typeof ex.hidden === "boolean";
}

// Structural guard for persisted state: rejects valid JSON of the wrong shape so a
// stale or corrupt layout.json falls back to defaults instead of crashing render.
export function isViewState(v: unknown): v is ViewState {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.chatWidthCh === "number" &&
    isColumnState(obj.center) && isRightState(obj.right) &&
    isExplorerState(obj.explorer);
}

// Adopt a view persisted before the right pane had groups: `right` was one flat list of
// `rows` with a single `activeTabId`. Returning null (rather than letting isViewState
// reject the tree three levels up) is what keeps a stale layout from resetting every
// workspace and its working directory — see migrateSession.
export function migrateView(raw: unknown): ViewState | null {
  if (isViewState(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const old = obj.right as Record<string, unknown> | undefined;
  if (!old || !Array.isArray(old.rows) || !old.rows.every(isModuleRefish)) {
    return null;
  }

  const tabs: ModuleRef[] = [];
  for (const row of old.rows as Omit<ModuleRef, "group">[]) {
    // A tab with props is that file, so it joins the explorer group beside the tree.
    const group = row.props ? EXPLORER : row.kind;
    // Singletons that were duplicated before the rule existed keep their first tab only.
    if (group !== EXPLORER && !isDuplicable(row.kind) &&
      tabs.some((t) => t.group === group)
    ) continue;
    tabs.push({ ...row, group });
  }

  const wasActive = tabs.find((t) => t.id === old.activeTabId);
  const activeTabs: Record<string, string> = {};
  for (const tab of tabs) {
    // The tab that was on screen keeps its group; every other group opens on its first.
    if (!activeTabs[tab.group]) activeTabs[tab.group] = tab.id;
  }
  if (wasActive) activeTabs[wasActive.group] = wasActive.id;

  const base = createInitialView(typeof obj.id === "string" ? obj.id : "view-1");
  const migrated: ViewState = {
    ...base,
    chatWidthCh: typeof obj.chatWidthCh === "number"
      ? obj.chatWidthCh
      : base.chatWidthCh,
    explorer: isExplorerState(obj.explorer)
      ? obj.explorer as ExplorerState
      : base.explorer,
    right: {
      collapsed: old.collapsed === true,
      // The group that was on screen; failing that the first tab's, failing that the
      // default view's, so a pane migrated empty still has a group selected.
      activeGroup: wasActive?.group ?? tabs[0]?.group ?? base.right.activeGroup,
      tabs,
      activeTabs,
    },
  };
  return isViewState(migrated) ? migrated : null;
}

// A pre-groups row: the same fields as a ModuleRef minus the group this adds.
function isModuleRefish(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const row = r as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.title === "string" &&
    typeof row.kind === "string";
}
