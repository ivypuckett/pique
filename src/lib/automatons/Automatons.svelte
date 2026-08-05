<script lang="ts">
  import { automatonBindings, type AutomatonInfo, type Item, type RunRecord } from "./bindings.ts";
  import AutomatonForm from "./AutomatonForm.svelte";
  import { ROOT } from "../scope/paths.ts";

  let { workspaceId }: { title: string; workspaceId?: string; viewId?: string; tabId?: string } =
    $props();

  const b = automatonBindings();

  // Which scope this module acts on: its own workspace's, or the shared root one it
  // inherits from. Same shape as Library and Kanban — the toggle is hidden in root,
  // which has nothing else to switch to. Held here rather than in a store so two
  // Automatons tabs in two workspaces cannot fight over one selection.
  //
  // `workspaceId` is optional only because Column threads it through as optional; every
  // real workspace has an id, and root's IS `ROOT`.
  const workspace = $derived(workspaceId ?? ROOT);
  const isRootWorkspace = $derived(workspace === ROOT);
  let showRoot = $state(false);
  const scope = $derived(showRoot ? ROOT : workspace);

  let automatons = $state<AutomatonInfo[]>([]);
  let runs = $state<RunRecord[]>([]);
  let error = $state("");
  let notice = $state("");
  let busy = $state(false);

  // Launch arguments per automaton, keyed by name. Not part of the definition — they are
  // appended to the prompt template for this one run.
  let args = $state<Record<string, string>>({});

  // The right pane shows exactly one of these two, so selecting either clears the other.
  // `editing.initial` is a snapshot taken when the user opened the form and `editing.key`
  // remounts it when they open a different automaton; a list refresh never touches it, so
  // it cannot wipe what is being typed.
  let editing = $state<{ key: string; initial: AutomatonInfo | null } | null>(null);
  let selectedRunId = $state<string | null>(null);
  let history = $state<Item[]>([]);
  // The status `history` was read at. A run that has just gone terminal is re-read once
  // more, because the transcript it had while running is not necessarily its last word.
  let historyStatus = $state("");

  const selectedRun = $derived(runs.find((r) => r.id === selectedRunId) ?? null);
  const RECENT_RUNS = 5;

  function runsOf(name: string): RunRecord[] {
    return runs.filter((r) => r.automaton === name).slice(0, RECENT_RUNS);
  }

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function refreshRuns(): Promise<void> {
    if (!b) return;
    try {
      runs = await b.automatonsRuns({ scope });
    } catch (e) {
      error = message(e);
    }
  }

  async function refresh(): Promise<void> {
    if (!b) return;
    error = "";
    notice = "";
    try {
      automatons = await b.automatonsVisible({ scope });
    } catch (e) {
      error = message(e);
    }
    await refreshRuns();
  }

  async function loadHistory(id: string, status: string): Promise<void> {
    if (!b) return;
    try {
      history = await b.automatonsHistory({ scope, id });
      historyStatus = status;
    } catch (e) {
      error = message(e);
    }
  }

  // Live updates. This polls the run RECORDS on a fixed interval; it deliberately does
  // NOT drive off automatonsRead's event stream. That call long-polls for ~20s only while
  // the run is in the live map — for an id it no longer knows it returns [] IMMEDIATELY,
  // and a run is evicted the instant it finishes, so a read-driven loop would spin at
  // full CPU from the moment a run ended. Here every iteration is separated by the timer,
  // and the timer only exists while a record says `running`, so there is no path that
  // re-polls without a delay.
  const POLL_MS = 1000;
  const anyRunning = $derived(runs.some((r) => r.status === "running"));

  $effect(() => {
    if (!b || !anyRunning) return;
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(timer);
  });

  async function tick(): Promise<void> {
    await refreshRuns();
    const sel = runs.find((r) => r.id === selectedRunId);
    if (sel && (sel.status === "running" || sel.status !== historyStatus)) {
      await loadHistory(sel.id, sel.status);
    }
  }

  function selectRun(r: RunRecord): void {
    editing = null;
    selectedRunId = r.id;
    history = [];
    historyStatus = "";
    loadHistory(r.id, r.status);
  }

  function editAutomaton(a: AutomatonInfo): void {
    selectedRunId = null;
    editing = { key: `${a.scope}/${a.name}`, initial: { ...a } };
  }

  function newAutomaton(): void {
    selectedRunId = null;
    editing = { key: "new", initial: null };
  }

  async function afterFormChange(text: string): Promise<void> {
    editing = null;
    await refresh();
    notice = text;
  }

  async function launch(a: AutomatonInfo): Promise<void> {
    if (!b) return;
    busy = true;
    error = "";
    notice = "";
    try {
      const arg = (args[a.name] ?? "").trim();
      const { id } = await b.automatonsLaunch({ scope, name: a.name, args: arg || undefined });
      await refreshRuns();
      const started = runs.find((r) => r.id === id);
      if (started) selectRun(started);
      notice = `Launched ${a.name}.`;
    } catch (e) {
      error = message(e);
    }
    // Outside the try on purpose. A refused launch — an unresolvable extension, a missing
    // prompt template — still writes a durable `failed` record before it throws, and that
    // record is the whole point of recording refusals for unattended triggers. Refreshing
    // only on success would leave it invisible until the next manual refresh.
    await refreshRuns();
    busy = false;
  }

  async function stop(id: string): Promise<void> {
    if (!b) return;
    try {
      await b.automatonsStop({ id });
    } catch (e) {
      error = message(e);
    }
    await refreshRuns();
  }

  // Coarse on purpose: a run list wants "how long ago", not a timestamp to the second.
  function ago(iso: string): string {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return iso;
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  const STATUS_BADGE: Record<string, string> = {
    running: "badge-info",
    done: "badge-success",
    failed: "badge-error",
    stopped: "badge-ghost",
  };

  // A scope switch invalidates everything on screen: run ids, definitions and any open
  // editor all belong to the scope they came from.
  $effect(() => {
    if (!b || !scope) return;
    editing = null;
    selectedRunId = null;
    history = [];
    historyStatus = "";
    // Keyed by automaton name, which is not unique across scopes — a same-named automaton
    // in the other scope would otherwise inherit whatever was typed for this one.
    args = {};
    refresh();
  });
</script>

{#if !b}
  <div class="p-4 text-xs opacity-70">Available in the desktop app only.</div>
{:else}
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-center gap-1 border-b border-base-300 px-3 py-1.5">
      {#if !isRootWorkspace}
        <div class="flex items-center gap-1" role="group" aria-label="Scope">
          <span class="mr-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-60">Scope</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            class:btn-active={!showRoot}
            aria-pressed={!showRoot}
            onclick={() => (showRoot = false)}
          >Workspace</button>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            class:btn-active={showRoot}
            aria-pressed={showRoot}
            onclick={() => (showRoot = true)}
          >Root</button>
        </div>
      {/if}
      <button type="button" class="btn btn-xs ml-auto" disabled={busy} onclick={newAutomaton}>+ New</button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        aria-label="Refresh"
        title="Re-read this scope's automatons and runs"
        onclick={refresh}
      >↻</button>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- Left: what can be launched here, each with its recent runs. -->
      <div class="min-h-0 w-1/2 shrink-0 overflow-y-auto border-r border-base-300 p-3">
        {#if automatons.length === 0}
          <div class="text-xs opacity-60">
            No automatons yet. An automaton names one prompt template plus the exact
            extensions and skills its run may load, and then runs unattended.
          </div>
        {:else}
          <ul class="divide-y divide-base-300 rounded border border-base-300">
            {#each automatons as a (`${a.scope}/${a.name}`)}
              <li class="px-3 py-2">
                <div class="flex items-center gap-2">
                  <span class="truncate font-mono text-xs">{a.name}</span>
                  {#if a.scope !== scope}
                    <span class="badge badge-ghost badge-xs shrink-0">inherited</span>
                  {/if}
                  {#if a.scope === scope}
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs ml-auto shrink-0"
                      disabled={busy}
                      onclick={() => editAutomaton(a)}
                    >Edit</button>
                  {/if}
                </div>
                <div class="truncate text-[0.65rem] opacity-60">
                  {a.description || `/${a.prompt}`}
                </div>

                {#if a.error}
                  <div class="mt-1 break-all text-[0.65rem] text-error">{a.error}</div>
                {/if}

                <div class="mt-1.5 flex items-center gap-1">
                  <input
                    class="input input-bordered input-xs min-w-0 flex-1"
                    placeholder="arguments (optional)"
                    aria-label="Arguments for {a.name}"
                    value={args[a.name] ?? ""}
                    oninput={(e) => (args[a.name] = e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="btn btn-primary btn-xs shrink-0"
                    disabled={busy || a.error !== undefined}
                    title={a.error ? "This definition cannot be launched as written" : ""}
                    onclick={() => launch(a)}
                  >Launch</button>
                </div>

                {#each runsOf(a.name) as r (r.id)}
                  <div class="mt-1 flex items-center gap-1.5">
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      class:font-medium={r.id === selectedRunId}
                      onclick={() => selectRun(r)}
                    >
                      <span class="badge badge-xs shrink-0 {STATUS_BADGE[r.status] ?? 'badge-ghost'}">
                        {r.status}
                      </span>
                      <span class="truncate text-[0.65rem] opacity-60">
                        {ago(r.startedAt)}{r.args ? ` · ${r.args}` : ""}
                      </span>
                    </button>
                    {#if r.status === "running"}
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs shrink-0"
                        onclick={() => stop(r.id)}
                      >Stop</button>
                    {/if}
                  </div>
                {/each}
              </li>
            {/each}
          </ul>
        {/if}

        {#if notice}<div class="mt-2 text-xs text-success">{notice}</div>{/if}
        {#if error}<div class="mt-2 break-all text-xs text-error">{error}</div>{/if}
      </div>

      <!-- Right: the definition editor, or the selected run's transcript. -->
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#if editing}
          {#key editing.key}
            <AutomatonForm
              {scope}
              automaton={editing.initial}
              onchanged={afterFormChange}
              oncancel={() => (editing = null)}
            />
          {/key}
        {:else if selectedRun}
          <div class="flex flex-col gap-2 p-3">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs">{selectedRun.automaton}</span>
              <span class="badge badge-xs {STATUS_BADGE[selectedRun.status] ?? 'badge-ghost'}">
                {selectedRun.status}
              </span>
              <span class="text-[0.65rem] opacity-60">
                {selectedRun.trigger} · {ago(selectedRun.startedAt)}
              </span>
              {#if selectedRun.status === "running"}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs ml-auto"
                  onclick={() => stop(selectedRun.id)}
                >Stop</button>
              {/if}
            </div>
            {#if selectedRun.args}
              <div class="font-mono text-[0.65rem] opacity-60">arguments: {selectedRun.args}</div>
            {/if}
            {#if selectedRun.error}
              <div class="break-all text-xs text-error">{selectedRun.error}</div>
            {/if}

            {#if history.length === 0}
              <div class="text-xs opacity-60">Nothing recorded for this run.</div>
            {:else}
              <div class="flex flex-col gap-1.5">
                {#each history as item, i (i)}
                  {#if item.role === "tool"}
                    <details class="rounded border border-base-300 p-2 text-[0.65rem]">
                      <summary class="cursor-pointer font-mono">
                        {item.done ? (item.isError ? "✗" : "✓") : "…"} {item.name}
                      </summary>
                      <pre class="mt-1 overflow-x-auto whitespace-pre-wrap opacity-80">{item.args}{item.result ? "\n→ " + item.result : ""}</pre>
                    </details>
                  {:else if item.role === "thinking"}
                    <div class="whitespace-pre-wrap rounded bg-base-200 p-2 text-[0.65rem] italic opacity-70">{item.text}</div>
                  {:else}
                    <div class="rounded border border-base-300 p-2 text-xs">
                      <div class="mb-0.5 text-[0.6rem] uppercase tracking-wide opacity-50">{item.role}</div>
                      <div class="whitespace-pre-wrap">{item.text}</div>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <div class="p-3 text-xs opacity-60">
            Pick a run to read its transcript, or edit an automaton to change what it may load.
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
