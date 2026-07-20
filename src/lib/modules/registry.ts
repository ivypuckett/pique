import type { Component } from "svelte";
import Placeholder from "./Placeholder.svelte";
import Terminal from "../terminal/Terminal.svelte";
import Chat from "../chat/Chat.svelte";

export const registry: Record<
  string,
  Component<{
    title: string;
    cwd?: string;
    viewId?: string;
    tabId?: string;
    argv?: string[];
    autoCloseOnExit?: boolean;
  }>
> = {
  placeholder: Placeholder,
  terminal: Terminal,
  chat: Chat,
};
