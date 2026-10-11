// Which component renders a module kind. Everything *about* a module — its label, its
// ctrl+t letter, whether it may be duplicated — is in manifest.ts instead, which keeps
// that table loadable from the pure layout reducers and their deno tests. Keys here
// cover the manifest's kinds plus the two modules that are not right-pane tabs: chat
// (the center column) and the file tree (the editor row's own content).
import type { Component } from "svelte";
import Terminal from "../terminal/Terminal.svelte";
import Chat from "../chat/Chat.svelte";
import FileTree from "../filetree/FileTree.svelte";
import GitDiff from "../gitdiff/GitDiff.svelte";
import Library from "../library/Library.svelte";
import UserModule from "./UserModule.svelte";
import { moduleDef } from "./manifest.ts";

export const registry: Record<
  string,
  Component<{
    title: string;
    // Which module this is. Only the user-module host reads it — it is what addresses
    // the frame and what every moduleCall is attributed to — but it is passed to every
    // module, because Column has one call site for all of them.
    kind?: string;
    cwd?: string;
    workspaceId?: string;
    viewId?: string;
    tabId?: string;
    argv?: string[];
    autoCloseOnExit?: boolean;
  }>
> = {
  terminal: Terminal,
  chat: Chat,
  filetree: FileTree,
  gitdiff: GitDiff,
  library: Library,
};

// Which component renders `kind`: the built-in for it, or the iframe host for a module
// an installed extension contributed. A kind that is neither — read back from a layout
// written by another build, or by a scope that has since revoked the module — returns
// undefined, and Column.svelte renders its "Unknown module" branch for it.
export function componentFor(kind: string) {
  return registry[kind] ?? (moduleDef(kind) ? UserModule : undefined);
}
