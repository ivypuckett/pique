<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { automatonBindings, type AutomatonInfo } from "./bindings.ts";
  import { PI_BUILTIN_TOOLS as PI_BUILTINS } from "./builtins.ts";
  import { normalizeColumn } from "./column.ts";
  import { cronError } from "./cron.ts";
  import { wipError } from "./wip.ts";
  import { extensionBindings } from "../extensions/bindings.ts";
  import { kanbanBindings, type StatusRow } from "../kanban/bindings.ts";
  import { type ModelOption, providerBindings } from "../chat/bindings.ts";
  import { promptBindings, type PromptInfo } from "../prompts/bindings.ts";
  import { skillBindings } from "../skills/bindings.ts";
  import { scopeBindings } from "../scope/bindings.ts";
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
  const providers = providerBindings();
  const scopes = scopeBindings();
  const kanban = kanbanBindings();

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
  // pi's builtins this run may call. `undefined` is "no restriction" and is NOT the same
  // as the empty list, so the checkbox group is gated behind its own toggle rather than
  // inferring the difference from an empty selection — and an existing restriction is
  // carried through a save untouched, because dropping the key would quietly hand a
  // deliberately-restricted automaton every builtin back.
  let restrictTools = $state(initial?.tools !== undefined);
  let toolRefs = $state<string[]>([...(initial?.tools ?? [])]);
  // `provider/model-id`. Starts empty only for the moment before loadOptions seeds it
  // with the scope's default — the picker has no "inherit" entry, so what it shows is
  // always the model the run will use.
  let model = $state(initial?.model ?? "");
  // A five-field cron expression, in this machine's local time. Empty is the default and
  // means the Launch button is the only way this runs.
  let cron = $state(initial?.cron ?? "");
  // The columns of THIS scope's own board — the only board that can fire this file, since
  // the trigger does not inherit (docs/automatons.md).
  let columns = $state<StatusRow[]>([]);
  // The column whose arrivals fire this automaton, by name. Empty is the default: no card
  // ever fires it.
  let kanbanColumn = $state(initial?.kanban ?? "");
  // Max concurrent runs. Empty means unlimited — there is no compiled-in default.
  let wip = $state(initial?.wip === undefined ? "" : String(initial.wip));

  let templates = $state<PromptInfo[]>([]);
  let models = $state<ModelOption[]>([]);
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
      if (providers) models = await providers.providerModels();
      // A definition with no `model:` of its own — one written before the key existed,
      // or a new one — opens on the scope's chat default, and saving pins it. Asked of
      // the backend rather than guessed: the fallback model is compiled into
      // chat/agent.ts, so an unset config cannot be read off the config. Only when the
      // form has nothing saved, so this can never overwrite what the file names.
      if (scopes && model === "") {
        const d = await scopes.scopeChatDefaults({ scope });
        model = `${d.provider}/${d.modelId}`;
      }
      if (kanban) {
        try {
          columns = (await kanban.kanbanGetBoard({ scope })).statuses;
          // The file's spelling and the board's may differ in case or padding and still
          // be the same column to the dispatcher. Snap to the board's spelling: the
          // <option> values are the board's exact names, so leaving the file's variant
          // bound would match no option and render the picker BLANK while the value
          // silently survives. Saving then writes the spelling the board shows.
          const canonical = columns.find(
            (c) => normalizeColumn(c.name) === normalizeColumn(kanbanColumn),
          );
          if (canonical && canonical.name !== kanbanColumn) kanbanColumn = canonical.name;
        } catch {
          // A board that cannot be read leaves the picker with only the file's own value,
          // which is still editable. Not worth failing the whole form for.
        }
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
  // And again for the model: a saved ref whose provider has since been disconnected
  // stays selected rather than being silently rewritten to whatever heads the list.
  const modelMissing = $derived(
    model !== "" && !models.some((m) => `${m.provider}/${m.id}` === model),
  );

  // Checked as it is typed, by the same function the backend parses with. A schedule
  // saved broken would be a definition that says it runs daily and never does — the
  // parser marks it an error, but catching it here means it is never written at all.
  const scheduleError = $derived(cron.trim() === "" ? undefined : cronError(cron));

  // The same treatment `modelMissing` gives an unavailable model: a column the board no
  // longer has stays selected rather than being silently rewritten to "no trigger".
  // Matched the way the DISPATCHER matches, so the form cannot call a trigger broken
  // that would in fact fire.
  const columnMissing = $derived(
    kanbanColumn !== "" &&
      !columns.some((c) => normalizeColumn(c.name) === normalizeColumn(kanbanColumn)),
  );

  // Checked as it is typed, by the same function the backend parses with — a limit that
  // is not a limit must never be written in the first place. Only while a column is
  // chosen: the field is hidden without one, so a message from it could disable Save
  // with nothing on screen to explain why, and `wip` is not written then either.
  const wipMessage = $derived(
    kanbanColumn === "" || wip.trim() === ""
      ? undefined
      // `Number("abc")` is NaN, which JSON-quotes as `null` — report what was actually
      // typed instead. Corrected here rather than in wip.ts, which parse.ts also calls
      // with raw YAML values that are genuinely null.
      : wipError(Number.isNaN(Number(wip)) ? wip.trim() : Number(wip)),
  );

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
          tools: restrictTools ? toolRefs : undefined,
          model,
          cron: cron.trim(),
          kanban: kanbanColumn,
          // Only meaningful with a column to limit. Dropped without one, or clearing the
          // trigger would leave a `wip:` behind in the file — `automatonFile` writes the
          // key whenever it is defined.
          wip: kanbanColumn === "" || wip.trim() === "" ? undefined : Number(wip),
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

  <div class="flex flex-col gap-1">
    <label class="text-xs opacity-70" for="a-model">Model</label>
    <select id="a-model" class="select select-bordered select-sm" bind:value={model}>
      {#if modelMissing}
        <option value={model}>{model} (not available here)</option>
      {/if}
      {#each models as m (`${m.provider}/${m.id}`)}
        <option value={`${m.provider}/${m.id}`}>{m.provider} · {m.name}</option>
      {/each}
    </select>
    <div class="text-[0.65rem] opacity-50">
      The run uses this model whatever the scope's chat is later set to. A run whose
      model is unavailable fails rather than falling back.
    </div>
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs opacity-70" for="a-cron">Schedule</label>
    <input
      id="a-cron"
      class="input input-bordered input-sm font-mono"
      placeholder="0 9 * * 1-5 — leave empty to run only when launched"
      bind:value={cron}
    />
    {#if scheduleError}
      <div class="break-all text-[0.65rem] text-error">{scheduleError}</div>
    {:else}
      <div class="text-[0.65rem] opacity-50">
        minute hour day-of-month month day-of-week, in this machine's local time. Fires
        only in this scope, only while pique is running, and never while its previous
        run is still going.
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-1">
    <label class="text-xs opacity-70" for="a-kanban">Kanban column</label>
    <select id="a-kanban" class="select select-bordered select-sm" bind:value={kanbanColumn}>
      <option value="">— none —</option>
      {#if columnMissing}
        <option value={kanbanColumn}>{kanbanColumn} (no such column)</option>
      {/if}
      {#each columns as c (c.id)}
        <option value={c.name}>{c.name}</option>
      {/each}
    </select>
    <div class="text-[0.65rem] opacity-50">
      A card arriving in this column — moved in, or created there, by a human or an agent
      — launches this automaton on that card. Only this scope's own board fires it, and
      only while pique is running.
    </div>
  </div>

  {#if kanbanColumn !== ""}
    <div class="flex flex-col gap-1">
      <label class="text-xs opacity-70" for="a-wip">Concurrent runs</label>
      <input
        id="a-wip"
        class="input input-bordered input-sm"
        placeholder="leave empty for no limit"
        bind:value={wip}
      />
      {#if wipMessage}
        <div class="break-all text-[0.65rem] text-error">{wipMessage}</div>
      {:else}
        <div class="text-[0.65rem] opacity-50">
          The most runs of this automaton at once. Cards over the limit wait their turn,
          and one that has left the column by then is dropped rather than worked late.
        </div>
      {/if}
    </div>
  {/if}

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

  <fieldset class="flex flex-col gap-1">
    <legend class="text-xs opacity-70">Built-in tools</legend>
    <label class="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        class="checkbox checkbox-xs shrink-0"
        checked={restrictTools}
        onchange={() => (restrictTools = !restrictTools)}
      />
      <span>Restrict which of pi's built-ins this run may call</span>
    </label>
    {#if restrictTools}
      <div class="rounded border border-base-300 p-2">
        {#each PI_BUILTINS as t (t)}
          <label class="flex items-center gap-2 py-0.5 text-xs">
            <input
              type="checkbox"
              class="checkbox checkbox-xs shrink-0"
              checked={toolRefs.includes(t)}
              onchange={() => (toolRefs = toggle(toolRefs, t))}
            />
            <span class="font-mono">{t}</span>
          </label>
        {/each}
        {#if toolRefs.length === 0}
          <div class="mt-1 text-[0.65rem] opacity-60">
            None selected — the run can call only the tools its extensions provide.
          </div>
        {/if}
      </div>
    {:else}
      <div class="text-[0.65rem] opacity-60">
        Unrestricted: every built-in, including <span class="font-mono">bash</span>,
        <span class="font-mono">write</span> and <span class="font-mono">edit</span>.
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
      disabled={busy || name.trim() === "" || prompt === "" || scheduleError !== undefined ||
        wipMessage !== undefined}
      onclick={save}
    >Save</button>
  </div>

  {#if error}<div class="break-all text-xs text-error">{error}</div>{/if}
</div>
