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
import Kanban from "../kanban/Kanban.svelte";
import Library from "../library/Library.svelte";
import Automatons from "../automatons/Automatons.svelte";

export const registry: Record<
  string,
  Component<{
    title: string;
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
  kanban: Kanban,
  library: Library,
  automatons: Automatons,
};
