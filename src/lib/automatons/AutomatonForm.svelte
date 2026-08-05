<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { automatonBindings, type AutomatonInfo } from "./bindings.ts";
  import { extensionBindings } from "../extensions/bindings.ts";
  import { promptBindings, type PromptInfo } from "../prompts/bindings.ts";
  import { skillBindings } from "../skills/bindings.ts";
  import { ROOT } from "../scope/paths.ts";

  // `automaton` is null when creating. The parent hands this component a snapshot taken
  // at the moment the user opened it and remounts it (via {#key}) when they open a
  // different one, which is what lets the fields below seed themselves ONCE per edited
  // automaton — a background refresh of the list must never overwrite what is being typed.
  let { scope, automaton, onchanged, oncancel }: {
    scope: string;
    automaton: AutomatonInfo | null;
    onchanged: (notice: string) => void;
    oncancel: () => void;
  } = $props();

  const b = automatonBindings();
  const exts = extensionBindings();
  const prompts = promptBindings();
  const skills = skillBindings();

  // The fields below are seeded from the prop at construction and never re-derived — a
  // list refresh landing mid-edit must not overwrite what is being typed. `untrack` says
  // that reading it non-reactively is the intent, the same idiom Chat.svelte uses for its
  // session; the parent's {#key} is what gives a different automaton a fresh instance.
  const initial = untrack(() => automaton);
  const creating = initial === null;

  // The name is fixed once an automaton exists: the filename IS the name, so renaming
  // means delete and recreate — the same rule prompt templates already follow.
  let name = $state(initial?.name ?? "");
  let description = $state(initial?.description ?? "");
  let prompt = $state(initial?.prompt ?? "");
  let extensionRefs = $state<string[]>([...(initial?.extensions ?? [])]);
  let skillRefs = $state<string[]>([...(initial?.skills ?? [])]);

  let templates = $state<PromptInfo[]>([]);
  type Option = { value: string; hint: string };
  let extensionOptions = $state<Option[]>([]);
  let skillOptions = $state<Option[]>([]);

  let busy = $state(false);
  let error = $state("");

  // The three compiled-in tool groups, nameable exactly as extensions are
  // (automatons/resolve.ts's BUILTIN_GROUPS). Nothing is injected: a group reaches a run
  // only because its file names it, so they lead the list.
  const BUILTIN_EXTENSIONS: Option[] = [
    { value: "pique:kanban", hint: "built-in · kanban board" },
    { value: "pique:extension-authoring", hint: "built-in · write extensions" },
    { value: "pique:prompt-authoring", hint: "built-in · write prompt templates" },
  ];

  // What this scope can actually launch. `extensionsVisible` already answers exactly the
  // question the run-time resolver asks — local modules including inherited ones, packages
  // for this scope only — so the picker offers precisely what can resolve. Only `enabled`
  // entries are offered: the resolver refuses a pending one, so naming it would build a
  // definition that cannot launch.
  async function loadOptions(): Promise<void> {
    try {
      if (prompts) {
        const own = await prompts.promptsList({ scope });
        const root = scope === ROOT ? [] : await prompts.promptsList({ scope: ROOT });
        const byName = new Map<string, PromptInfo>();
        for (const p of [...root, ...own]) if (p.state === "live") byName.set(p.name, p);
        templates = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
      }
      if (exts) {
        // Keyed by the ref string rather than collected into a list, because a local
        // extension of the same name can be enabled in root AND in this scope, and both
        // come back from extensionsVisible. They are one nameable ref, so two rows would
        // duplicate a keyed-each key and misattach checkbox state. The list arrives
        // root-first, so setting as we go leaves the nearest scope's entry — which is
        // also the one the resolver will pick.
        const byValue = new Map<string, Option>();
        for (const x of await exts.extensionsVisible({ scope })) {
          if (x.state !== "enabled") continue;
          // A package is named by its source; a local module by its name.
          const value = x.origin === "package" ? x.source : x.name;
          if (!value) continue;
          const where = x.scope === scope ? "" : ` · from ${x.scope}`;
          byValue.set(value, { value, hint: `${x.origin}${where}` });
        }
        extensionOptions = [...byValue.values()];
      }
      if (skills) {
        skillOptions = (await skills.skillsVisible({ scope })).map((s) => ({
          value: s.name,
          hint: s.scope === scope ? s.description : `from ${s.scope}${s.description ? ` · ${s.description}` : ""}`,
        }));
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  onMount(loadOptions);

  // A saved definition can name something that has since been revoked, removed or
  // renamed. Such a ref gets a row of its own rather than being dropped from the form:
  // saving a list built only from what is currently offered would silently strip it,
  // and this file's whole contract is that it names exactly what a run may load.
  function withMissing(options: Option[], selected: string[]): Option[] {
    const known = new Set(options.map((o) => o.value));
    return [
      ...options,
      ...selected.filter((r) => !known.has(r)).map((r) => ({ value: r, hint: "not available here" })),
    ];
  }
  const extensionRows = $derived(withMissing([...BUILTIN_EXTENSIONS, ...extensionOptions], extensionRefs));
  const skillRows = $derived(withMissing(skillOptions, skillRefs));
  // Same reasoning for the template: an unlisted one stays selectable rather than being
  // silently rewritten to whatever happens to sit first in the menu.
  const promptMissing = $derived(prompt !== "" && !templates.some((t) => t.name === prompt));

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function act(run: () => Promise<unknown>, notice: string): Promise<void> {
    busy = true;
    error = "";
    try {
      await run();
      onchanged(notice);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    busy = false;
  }

  function save(): void {
    if (!b) return;
    const n = name.trim();
    act(
      () =>
        b.automatonsSave({
          scope,
          name: n,
          description: description.trim(),
          prompt,
          extensions: extensionRefs,
          skills: skillRefs,
        }),
      `Saved ${n}.`,
    );
  }

  function remove(): void {
    const a = automaton;
    if (!b || !a) return;
    act(() => b.automatonsDelete({ scope, name: a.name }), `Deleted ${a.name}.`);
  }
</script>

<div class="flex flex-col gap-3 p-3">
  <div class="text-xs uppercase tracking-wide text-primary">
    {creating ? "New automaton" : `Edit ${automaton?.name}`}
  </div>
  <div class="text-xs opacity-70">
    An automaton runs unattended: it sends one prompt template, and the run may load
    exactly the extensions and skills named here — nothing else.
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs opacity-70" for="a-name">Name</label>
    <input
      id="a-name"
      class="input input-bordered input-sm font-mono"
      placeholder="lowercase, digits and dashes"
      disabled={!creating}
      bind:value={name}
    />
    {#if !creating}
      <div class="text-[0.65rem] opacity-50">
        The filename is the name. To rename, delete this one and create it again.
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs opacity-70" for="a-desc">Description</label>
    <input
      id="a-desc"
      class="input input-bordered input-sm"
      placeholder="what this run is for — shown beside its name in the list"
      bind:value={description}
    />
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs opacity-70" for="a-prompt">Prompt template</label>
    <select id="a-prompt" class="select select-bordered select-sm" bind:value={prompt}>
      <option value="">Choose a template…</option>
      {#if promptMissing}
        <option value={prompt}>/{prompt} (not found in this scope)</option>
      {/if}
      {#each templates as t (`${t.scope}/${t.name}`)}
        <option value={t.name}>/{t.name}{t.description ? ` — ${t.description}` : ""}</option>
      {/each}
    </select>
    <div class="text-[0.65rem] opacity-50">
      Sent as the run's first message. Launch arguments are appended to it.
    </div>
  </div>

  <fieldset class="flex flex-col gap-1">
    <legend class="text-xs opacity-70">Extensions</legend>
    {#if extensionRows.length === 0}
      <div class="text-xs opacity-50">None available in this scope.</div>
    {:else}
      <div class="max-h-40 overflow-y-auto rounded border border-base-300 p-2">
        {#each extensionRows as o (o.value)}
          <label class="flex items-center gap-2 py-0.5 text-xs">
            <input
              type="checkbox"
              class="checkbox checkbox-xs shrink-0"
              checked={extensionRefs.includes(o.value)}
              onchange={() => (extensionRefs = toggle(extensionRefs, o.value))}
            />
            <span class="font-mono">{o.value}</span>
            <span class="truncate opacity-50">{o.hint}</span>
          </label>
        {/each}
      </div>
    {/if}
  </fieldset>

  <fieldset class="flex flex-col gap-1">
    <legend class="text-xs opacity-70">Skills</legend>
    {#if skillRows.length === 0}
      <div class="text-xs opacity-50">None available in this scope.</div>
    {:else}
      <div class="max-h-40 overflow-y-auto rounded border border-base-300 p-2">
        {#each skillRows as o (o.value)}
          <label class="flex items-center gap-2 py-0.5 text-xs">
            <input
              type="checkbox"
              class="checkbox checkbox-xs shrink-0"
              checked={skillRefs.includes(o.value)}
              onchange={() => (skillRefs = toggle(skillRefs, o.value))}
            />
            <span class="font-mono">{o.value}</span>
            <span class="truncate opacity-50">{o.hint}</span>
          </label>
        {/each}
      </div>
    {/if}
  </fieldset>

  <div class="flex items-center gap-1">
    {#if !creating}
      <button type="button" class="btn btn-ghost btn-xs text-error" disabled={busy} onclick={remove}>
        Delete
      </button>
    {/if}
    <button type="button" class="btn btn-ghost btn-xs ml-auto" disabled={busy} onclick={oncancel}>
      Cancel
    </button>
    <button
      type="button"
      class="btn btn-primary btn-xs"
      disabled={busy || name.trim() === "" || prompt === ""}
      onclick={save}
    >Save</button>
  </div>

  {#if error}<div class="break-all text-xs text-error">{error}</div>{/if}
</div>
