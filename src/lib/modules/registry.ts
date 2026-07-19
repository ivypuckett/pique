import type { Component } from "svelte";
import Placeholder from "./Placeholder.svelte";
import Terminal from "../terminal/Terminal.svelte";
import Chat from "../chat/Chat.svelte";

export const registry: Record<string, Component<{ title: string; cwd?: string }>> = {
  placeholder: Placeholder,
  terminal: Terminal,
  chat: Chat,
};
