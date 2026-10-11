// Every right-pane module in one table: its rail row's label, the ctrl+t letter that shows
// it, and whether more than one of it may exist at a time. Four places used to carry a
// piece of this and drift apart — labels in layout.ts, the picker's kind list in TabStrip,
// the chord's letters in App.svelte, the same letters again in StatusBar.
//
// Metadata only, deliberately free of Svelte imports: the pure layout reducers read it
// (moduleLabel, addTab's singleton rule) and their deno tests can't load a .svelte file.
// The component for each kind lives beside it in registry.ts.

// The rail row that holds the file tree and the files opened from it. It has no module of
// its own, which is why it is a bare id rather than a MODULES entry. moduleLabel has no
// entry to read a label from either, so it capitalises this id — the row is named here and
// nowhere else. It was called the explorer until the rename; migrateView still answers to
// that id, since it is written into every layout.json older than the change.
export const EDITOR = "editor";

export type ModuleDef = {
  kind: string; // key into the registry
  label: string; // tab title and picker entry
  key: string; // ctrl+t <key>
  duplicable?: boolean; // may a view hold more than one?
  // For a module an extension contributed: the scope whose extensions dir holds it.
  // A workspace showing a module that root owns must address ROOT's copy — the rail is
  // per-window, modules are per-scope. Absent for the built-ins, which belong to no
  // scope at all.
  scope?: string;
};

// Chat is the center column and the file tree is the editor row's own content; neither
// is a module you open, so neither has a row here.
export const MODULES: ModuleDef[] = [
  { kind: "terminal", label: "Terminal", key: "t", duplicable: true },
  { kind: "gitdiff", label: "Git Diff", key: "g" },
  { kind: "kanban", label: "Kanban", key: "k" },
  // b, not l: "next tab" is worth more on l — the pane is a strip you move along far
  // more often than you open a library.
  { kind: "library", label: "Library", key: "b" },
];

// Modules contributed by installed extensions, set at boot and on Library refresh.
// Held apart from MODULES rather than merged into it because the ctrl+t chord reads
// MODULES directly (App.svelte, StatusBar.svelte) and must not see an install: a
// letter is a fixed namespace, and an install claiming one could shadow a built-in.
let installed: ModuleDef[] = [];

// Set once per refresh, not appended to — the argument is the whole installed set, so
// a module that was revoked between refreshes disappears rather than lingering.
export function setInstalledModules(defs: ModuleDef[]): void {
  // A built-in always wins a collision: `kind` decides which component renders, so a
  // shadowing entry would let an installed module replace Chat or Kanban.
  installed = defs.filter((d) => !MODULES.some((m) => m.kind === d.kind));
}

// Built-ins first, so the rail's order stays stable as modules come and go.
function allModules(): ModuleDef[] {
  return [...MODULES, ...installed];
}

export function moduleDef(kind: string): ModuleDef | undefined {
  return allModules().find((m) => m.kind === kind);
}

// The rail's rows, top to bottom — the order ctrl+t's arrows walk. The editor heads the
// list: it is a row without a module, holding the tree and the files opened from it.
export function railGroups(): string[] {
  return [EDITOR, ...allModules().map((m) => m.kind)];
}

// Whether a view may hold a second tab of this kind. An unknown kind — one read back
// from a layout written by another build — counts as a singleton: the conservative
// answer, since it renders as "Unknown module" either way.
export function isDuplicable(kind: string): boolean {
  return moduleDef(kind)?.duplicable ?? false;
}

// Whether a row shows a tab strip at all. A singleton row IS its module — a lone chip with
// a close button beside a rail row that already names it says nothing — so only a row that
// can hold more than one has tabs. The editor's are the files opened from the tree.
export function hasTabs(group: string): boolean {
  return group === EDITOR || isDuplicable(group);
}
