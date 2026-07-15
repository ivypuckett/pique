import type { Component } from "svelte";
import Placeholder from "./Placeholder.svelte";

export const registry: Record<string, Component<{ title: string }>> = {
  placeholder: Placeholder,
};
