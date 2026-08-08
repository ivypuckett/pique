// Every right-pane module in one table: its tab title, the ctrl+t letter that opens it,
// and whether more than one of it may exist at a time. Four places used to carry a
// piece of this and drift apart — labels here, the picker's kind list in TabStrip, the
// chord's letters in App.svelte, the same letters again in StatusBar.
//
// Metadata only, deliberately free of Svelte imports: the pure layout reducers read it
// (moduleLabel, addTab's singleton rule) and their deno tests can't load a .svelte file.
// The component for each kind lives beside it in registry.ts.
export type ModuleDef = {
  kind: string; // key into the registry
  label: string; // tab title and picker entry
  key: string; // ctrl+t <key>
  duplicable?: boolean; // may a view hold more than one?
};

// Chat is the center column and the file tree is the explorer addon; neither is a
// right-pane module, so neither has a row here.
export const MODULES: ModuleDef[] = [
  { kind: "terminal", label: "Terminal", key: "t", duplicable: true },
  { kind: "gitdiff", label: "Git Diff", key: "g" },
  { kind: "kanban", label: "Kanban", key: "k" },
  // b, not l: "next tab" is worth more on l — the pane is a strip you move along far
  // more often than you open a library.
  { kind: "library", label: "Library", key: "b" },
  { kind: "automatons", label: "Automatons", key: "a" },
];

export function moduleDef(kind: string): ModuleDef | undefined {
  return MODULES.find((m) => m.kind === kind);
}

// Whether a view may hold a second tab of this kind. An unknown kind — one read back
// from a layout written by another build — counts as a singleton: the conservative
// answer, since it renders as "Unknown module" either way.
export function isDuplicable(kind: string): boolean {
  return moduleDef(kind)?.duplicable ?? false;
}
