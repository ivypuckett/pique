<script lang="ts">
  import type { SkillInfo } from "./bindings.ts";

  // A skill's expanded row. There is nothing to enable, revoke or quarantine — only to
  // see and to name — so this shows the one thing the collapsed row cannot: where the
  // file actually is, which is what you need in order to edit it.
  let { skill }: { skill: SkillInfo } = $props();
</script>

<div class="mt-2 truncate font-mono text-[0.65rem] opacity-60" title={skill.path}>{skill.path}</div>
{#if skill.description}
  <div class="mt-1 text-xs opacity-80">{skill.description}</div>
{/if}
