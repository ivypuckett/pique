import type { Component } from "svelte";
import Placeholder from "./Placeholder.svelte";
import Terminal from "../terminal/Terminal.svelte";

export const registry: Record<string, Component<{ title: string }>> = {
  placeholder: Placeholder,
  terminal: Terminal,
};
