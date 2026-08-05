<script lang="ts">
  import { type SkillInfo, skillBindings } from "./bindings.ts";

  // Same prop shape as the other Library sections, so the shell drives all three
  // identically. `scopeIsRoot` is unused here — this section has nothing to enable, so
  // there is no "this reaches every workspace" warning to show — but it stays in the
  // type so the shell can keep passing one set of props.
  let { scope, refreshKey }: { scope: string; scopeIsRoot: boolean; refreshKey: number } = $props();

  const api = skillBindings();

  let skills = $state<SkillInfo[]>([]);
  let error = $state("");

  $effect(() => {
    // Both are read so this re-runs on a scope switch and on an explicit refresh.
    scope;
    refreshKey;
    if (!api) return;
    api
      .skillsVisible({ scope })
      .then((s) => {
        skills = s;
        error = "";
      })
      .catch((e) => (error = e instanceof Error ? e.message : String(e)));
  });
</script>

{#if !api}
  <div class="p-4 text-sm opacity-60">Available in the desktop app only.</div>
{:else}
  <div class="p-3">
    <!-- Read-only by design: a skill is markdown a model reads, not code that executes,
         so the review gate the Extensions section exists for does not apply. There is
         nothing to enable, revoke or quarantine — only to see and to name. -->
    <p class="mb-3 text-xs opacity-60">
      Skills a chat agent can use and an automaton can name. Read-only — add one by putting
      a <code>&lt;name&gt;/SKILL.md</code> directory or a <code>&lt;name&gt;.md</code> file in this
      scope's <code>agent/skills/</code>.
    </p>

    {#if error}
      <div class="mb-2 text-xs text-error">{error}</div>
    {/if}

    {#each skills as skill (skill.path)}
      <div class="border-b border-base-300 py-2">
        <div class="flex items-center gap-2">
          <code class="text-sm font-semibold">{skill.name}</code>
          {#if skill.scope !== scope}
            <span class="badge badge-ghost badge-xs">inherited from {skill.scope}</span>
          {/if}
        </div>
        {#if skill.description}
          <div class="text-xs opacity-60">{skill.description}</div>
        {/if}
        {#if skill.error}
          <!-- Malformed frontmatter. The skill still lists, because pi will still load it
               and the file is user-editable — but its description is missing and that is
               worth saying rather than showing a blank line. -->
          <div class="text-xs text-error">{skill.error}</div>
        {/if}
        {#if skill.frontmatterName && skill.frontmatterName !== skill.name}
          <!-- An automaton names a skill by its path basename, never by the frontmatter
               `name:` (skills/service.ts). Surfaced so the divergence is visible here
               rather than as a mysterious "skill not found" at launch time. -->
          <div class="text-xs opacity-50">
            Its frontmatter says <code>{skill.frontmatterName}</code>; name it
            <code>{skill.name}</code>.
          </div>
        {/if}
      </div>
    {:else}
      <div class="text-sm opacity-60">No skills in this scope.</div>
    {/each}
  </div>
{/if}
