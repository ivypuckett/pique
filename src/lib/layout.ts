import {
  EDITOR,
  isDuplicable,
  moduleDef,
  railGroups,
} from "./modules/manifest.ts";

export { EDITOR };

export type ColumnId = "center" | "right";

export interface ModuleRef {
  id: string;
  title: string;
  kind: string; // key into the module registry
  // Which rail row the tab belongs to. Its kind for an ordinary module; "editor" for
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

// The tabbed pane. One group is selected (the rail's row); the strip above the content
// shows that group's tabs and nothing else, so `tabs` is every open tab of every group
// in open order. `activeTabs` remembers a group's visible tab across a switch away and
// back, and carries no entry for a group with nothing open.
export interface RightState {
  activeGroup: string;
  tabs: ModuleRef[];
  activeTabs: Record<string, string>;
}

// Widths are measured in characters, not fractions of the window: the sized pane keeps
// the same number of columns of text however the window is resized or the workspace
// tiled, and its sibling absorbs the slack.
export interface ViewState {
  id: string; // stable across the view's lifetime; keys the tiled workspace
  chatWidthCh: number; // chat's fixed width; the tabbed pane takes the rest of the row
  // Chat itself carries no state here: it is one fixed module filling the center column,
  // mounted by Column.svelte rather than driven by a tab list.
  right: RightState; // the tabbed pane
  // The file tree's width inside the editor row, where it shares the pane with the
  // editors opened from it. The tree is never hidden there — it is that row's content.
  editorWidthCh: number;
}

export const MIN_WIDTH_CH = 10;

export function createInitialView(id = "view-1"): ViewState {
  return {
    id,
    chatWidthCh: 57,
    right: {
      activeGroup: "terminal",
      tabs: [{
        id: "right-1",
        title: "Terminal",
        kind: "terminal",
        group: "terminal",
      }],
      activeTabs: { terminal: "right-1" },
    },
    editorWidthCh: 30,
  };
}

// Visual order is chat | [tree · tabs | rail]. "center-right" is the outer splitter
// between chat and the pane; "editor-tabs" is the inner one between the file tree and
// the editors beside it, inside the editor row.
export type Boundary = "center-right" | "editor-tabs";

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
  if (b === "editor-tabs") {
    return { ...v, editorWidthCh: first };
  }
  return { ...v, chatWidthCh: first };
}

// The sized pane holds its character width and its sibling takes the rest — until the
// row is too narrow for both, where the sibling keeps MIN_WIDTH_CH (the floor the
// splitter enforces too) and the sized one gives up characters instead of vanishing.
// Widening the window hands them straight back: the stored width never changed.
export function trackPair(firstCh: number): string {
  return `minmax(0, ${firstCh}ch) ${SPLITTER_PX}px minmax(${MIN_WIDTH_CH}ch, 1fr)`;
}

export function gridTemplateColumns(v: ViewState): string {
  // Visual order: chat (center) | the pane (right). Both are always on screen — hiding
  // the module rail (ctrl+shift+b) takes the list out of the pane, not the pane out of
  // the row, the way hiding the workspace rail leaves the workspace open.
  return trackPair(v.chatWidthCh);
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
// is how ctrl+t k has always behaved. The editor row has no module of its own, so it is
// only ever selected — its tabs come from the tree.
export function selectGroup(v: ViewState, group: string): ViewState {
  if (groupTabs(v, group).length > 0 || group === EDITOR) {
    return { ...v, right: { ...v.right, activeGroup: group } };
  }
  return moduleDef(group) ? addTab(v, group) : v;
}

// Move up or down the rail by `dir` (ctrl+t j/k). Clamped at the ends, like every other
// navigation. Select-or-create, same as clicking the row: landing on a row shows its
// module, so moving along the rail is moving between modules rather than between a
// module and an empty pane telling you which chord opens it.
export function focusAdjacentGroup(v: ViewState, dir: -1 | 1): ViewState {
  const groups = railGroups();
  const idx = groups.indexOf(v.right.activeGroup);
  if (idx === -1) return v;
  const next = Math.min(groups.length - 1, Math.max(0, idx + dir));
  return selectGroup(v, groups[next]);
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
// Editors and path-scoped diffs are in the editor group, not the module's, so one open
// beside the file tree never stands in for Git Diff itself.
export function addTab(v: ViewState, kind: string): ViewState {
  if (!isDuplicable(kind)) {
    const open = groupTabs(v, kind)[0];
    if (open) return setActiveTab(v, open.id);
  }
  const id = nextRightId(v.right.tabs);
  return withTab(v, { id, title: moduleLabel(kind), kind, group: kind });
}

// One more of what the selected row already holds (ctrl+t n, and the strip's +). A
// singleton row can't have a second, so there it does nothing — and the editor's tabs
// come from the tree, not from here.
export function newTab(v: ViewState): ViewState {
  const group = v.right.activeGroup;
  return isDuplicable(group) ? addTab(v, group) : v;
}

function basename(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  return parts.length ? parts[parts.length - 1] : path;
}

// Add an editor-group terminal tab that runs $EDITOR on `path` and closes itself on exit.
export function addEditorTab(v: ViewState, path: string): ViewState {
  return withTab(v, {
    id: nextRightId(v.right.tabs),
    title: basename(path),
    kind: "terminal",
    group: EDITOR,
    props: { argv: ["$EDITOR", path], autoCloseOnExit: true, autoFocus: true },
  });
}

// Add an editor-group tab showing the git diff of a single file (called by the file-tree module).
export function addDiffTab(v: ViewState, path: string): ViewState {
  return withTab(v, {
    id: nextRightId(v.right.tabs),
    title: basename(path),
    kind: "gitdiff",
    group: EDITOR,
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
  // A singleton row is its module, so there is nothing to close: it mounts on first visit
  // and stays for the life of the view. Editors in the editor row are closable — they
  // are files, not the module.
  if (moduleDef(tab.group) && !isDuplicable(tab.group)) return v;
  const activeTabs = { ...v.right.activeTabs };
  if (activeTabs[tab.group] === tabId) {
    // Prefer the previous tab of the same group; fall back to the next. A group whose
    // last tab is closed carries no entry at all — the editor row is the only one that
    // can end up that way, and the tree is its content.
    const siblings = groupTabs(v, tab.group);
    const idx = siblings.findIndex((t) => t.id === tabId);
    const next = siblings[idx - 1] ?? siblings[idx + 1];
    if (next) activeTabs[tab.group] = next.id;
    else delete activeTabs[tab.group];
  }
  const tabs = v.right.tabs.filter((t) => t.id !== tabId);
  // A module row always holds its module: closing the last terminal kills that shell and
  // leaves a clean one in its place rather than an empty pane. Selection stays where it
  // is — emptying a row you are not looking at must not pull you into it.
  if (moduleDef(tab.group) && !tabs.some((t) => t.group === tab.group)) {
    const fresh = nextRightId(tabs);
    tabs.push({
      id: fresh,
      title: moduleLabel(tab.group),
      kind: tab.group,
      group: tab.group,
    });
    activeTabs[tab.group] = fresh;
  }
  return { ...v, right: { ...v.right, tabs, activeTabs } };
}

function isModuleRef(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const row = r as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.title === "string" &&
    typeof row.kind === "string" && typeof row.group === "string" &&
    row.group !== "";
}

function isRightState(r: unknown): boolean {
  if (typeof r !== "object" || r === null) return false;
  const right = r as Record<string, unknown>;
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

// Structural guard for persisted state: rejects valid JSON of the wrong shape so a
// stale or corrupt layout.json falls back to defaults instead of crashing render.
export function isViewState(v: unknown): v is ViewState {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.chatWidthCh === "number" &&
    isRightState(obj.right) && typeof obj.editorWidthCh === "number";
}

// The editor row's id before it was renamed. Every layout.json written before the rename
// names it, in the group of each tab the tree opened, in activeGroup, and as a key of
// activeTabs — beside an `explorerWidthCh` that is now `editorWidthCh`.
const LEGACY_EDITOR = "explorer";

// Rewrite that id wherever a persisted view carries it. This has to run BEFORE isViewState,
// not as one of the migrations below it: a view written by the build just before the rename
// is structurally current — isRightState only asks that a group be a non-empty string — so
// it passes the guard and is adopted whole. Its tabs would then sit in a row railGroups no
// longer offers: open, mounted, and unreachable from the rail.
function renameEditorGroup(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const obj = { ...(raw as Record<string, unknown>) };
  // Moved, not copied: left behind, the old key rides along in a view the guard now
  // accepts and is written back to layout.json on every save, outliving the rename.
  if (typeof obj.explorerWidthCh === "number") {
    if (typeof obj.editorWidthCh !== "number") obj.editorWidthCh = obj.explorerWidthCh;
    delete obj.explorerWidthCh;
  }
  if (typeof obj.right !== "object" || obj.right === null) return obj;
  const pane = { ...(obj.right as Record<string, unknown>) };
  if (pane.activeGroup === LEGACY_EDITOR) pane.activeGroup = EDITOR;
  if (Array.isArray(pane.tabs)) {
    // Only the tabs that name it: a pre-groups row has no group at all, and giving it an
    // undefined one here would cost the derivation below its chance to read the kind.
    pane.tabs = pane.tabs.map((t) =>
      typeof t === "object" && t !== null &&
        (t as Record<string, unknown>).group === LEGACY_EDITOR
        ? { ...t, group: EDITOR }
        : t
    );
  }
  if (typeof pane.activeTabs === "object" && pane.activeTabs !== null) {
    const active = { ...(pane.activeTabs as Record<string, unknown>) };
    if (LEGACY_EDITOR in active) {
      active[EDITOR] = active[LEGACY_EDITOR];
      delete active[LEGACY_EDITOR];
    }
    pane.activeTabs = active;
  }
  obj.right = pane;
  return obj;
}

// Adopt a view persisted by an older build. Two shapes reach here: the pre-groups one,
// whose `right` is a flat list of `rows` with a single `activeTabId`, and the one written
// between grouping the pane and moving the tree into it, whose `right` is already grouped
// but whose width still sits in an `explorer` object. Returning null (rather than letting
// isViewState reject the tree three levels up) is what keeps a stale layout from resetting
// every workspace and its working directory — see migrateSession.
export function migrateView(rawIn: unknown): ViewState | null {
  const raw = renameEditorGroup(rawIn);
  if (isViewState(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const old = obj.right as Record<string, unknown> | undefined;
  const source = Array.isArray(old?.tabs)
    ? old!.tabs
    : Array.isArray(old?.rows)
    ? old!.rows
    : null;
  if (!source || !source.every(isModuleRefish)) return null;

  const tabs: ModuleRef[] = [];
  for (const row of source as (Omit<ModuleRef, "group"> & { group?: unknown })[]) {
    // Keep a group the tab already names. Failing that, a tab with props is that file, so
    // it joins the editor group beside the tree.
    const group = typeof row.group === "string" && row.group !== ""
      ? row.group
      : row.props
      ? EDITOR
      : row.kind;
    // Singletons that were duplicated before the rule existed keep their first tab only.
    if (group !== EDITOR && !isDuplicable(row.kind) &&
      tabs.some((t) => t.group === group)
    ) continue;
    tabs.push({ ...row, group });
  }

  // What was on screen: a pre-groups pane names one tab for the whole strip, a grouped one
  // remembers a tab per group.
  const remembered = (typeof old!.activeTabs === "object" && old!.activeTabs !== null
    ? old!.activeTabs
    : {}) as Record<string, unknown>;
  const shownId = typeof old!.activeTabId === "string"
    ? old!.activeTabId
    : remembered[String(old!.activeGroup)];
  const wasActive = tabs.find((t) => t.id === shownId);

  const activeTabs: Record<string, string> = {};
  // Anything a grouped pane remembered, as long as that tab survived in that group.
  for (const [group, id] of Object.entries(remembered)) {
    if (tabs.some((t) => t.id === id && t.group === group)) {
      activeTabs[group] = id as string;
    }
  }
  for (const tab of tabs) {
    // The tab that was on screen keeps its group; every other group opens on its first.
    if (!activeTabs[tab.group]) activeTabs[tab.group] = tab.id;
  }
  if (wasActive) activeTabs[wasActive.group] = wasActive.id;

  const base = createInitialView(typeof obj.id === "string" ? obj.id : "view-1");
  const savedWidth = typeof obj.editorWidthCh === "number"
    ? obj.editorWidthCh
    : (obj.explorer as Record<string, unknown> | undefined)?.widthCh;
  const migrated: ViewState = {
    ...base,
    chatWidthCh: typeof obj.chatWidthCh === "number"
      ? obj.chatWidthCh
      : base.chatWidthCh,
    // Both older shapes kept the width inside an `explorer` object, beside a `hidden`
    // flag the docked addon needed and the editor row does not.
    editorWidthCh: typeof savedWidth === "number"
      ? savedWidth
      : base.editorWidthCh,
    right: {
      // The group that was already selected, or the one that was on screen; failing both
      // the first tab's, failing that the default view's, so a pane migrated empty still
      // has a group selected.
      activeGroup: typeof old!.activeGroup === "string" && old!.activeGroup !== ""
        ? old!.activeGroup
        : wasActive?.group ?? tabs[0]?.group ?? base.right.activeGroup,
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
