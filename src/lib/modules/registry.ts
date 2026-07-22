import type { Component } from "svelte";
import Placeholder from "./Placeholder.svelte";
import Terminal from "../terminal/Terminal.svelte";
import Chat from "../chat/Chat.svelte";
import FileTree from "../filetree/FileTree.svelte";
import GitDiff from "../gitdiff/GitDiff.svelte";
import Kanban from "../kanban/Kanban.svelte";

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
  placeholder: Placeholder,
  terminal: Terminal,
  chat: Chat,
  filetree: FileTree,
  gitdiff: GitDiff,
  kanban: Kanban,
};
