<script lang="ts">
  import { automatonBindings, type AutomatonInfo, type Item, type RunRecord } from "./bindings.ts";
  import AutomatonForm from "./AutomatonForm.svelte";
  import { normalizeColumn } from "./column.ts";
  import { kanbanBindings, type StatusRow } from "../kanban/bindings.ts";
  import { ROOT } from "../scope/paths.ts";

  // `cwd` is this workspace's working-directory override, threaded down by Column the
  // way it is to every other module. A run executes pi's builtins — bash, write, edit —
  // in it, so failing to pass it on is not cosmetic: the run would silently work on
  // root's project instead of this workspace's.
  let { workspaceId, cwd }: {
    title: string;
    cwd?: string;
    workspaceId?: string;
    viewId?: string;
    tabId?: string;
  } =
    $props();

  const b = automatonBindings();
  const kb = kanbanBindings();

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
  // This scope's own columns, so a `kanban:` naming one that no longer exists can be
  // flagged. A rename is the only way that happens, and this is the one place it shows.
  let columns = $state<StatusRow[]>([]);
  // Whether `columns` is an ANSWER or just an absence. An unread board and a board with
  // no such column are the same empty list, and calling every trigger broken because the
  // board could not be opened is a confident claim the module has no basis for.
  let boardRead = $state(false);
  // Only what the run detail needs: a card's title from the id on its record.
  let boardCards = $state<{ id: string; title: string }[]>([]);
  let error = $state("");
  let notice = $state("");
  let busy = $state(false);

  // Which of this scope's definitions may currently fire with no human present
  // (automatons/approval.ts). Names only: a definition edited since it was approved
  // drops out of this list by itself, because the approval names bytes rather than a
  // file. The expanded review, when one is open — its `digest` is what Approve sends
  // back, so what was displayed and what gets approved are provably the same bytes.
  let approved = $state<string[]>([]);
  let reviewing = $state<
    { name: string; files: { path: string; text: string }[]; digest: string } | null
  >(null);

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

  // Does the board still have the column this automaton names? An inherited definition
  // watches its OWN scope's board, which is not the one loaded here, so it is never
  // flagged — the badge only claims something about a file this scope owns.
  // Matched the way the DISPATCHER matches (automatons/column.ts), or the list would
  // badge a trigger broken that fires perfectly well.
  function columnMissing(a: AutomatonInfo): boolean {
    return boardRead && a.scope === scope && a.kanban !== undefined &&
      !columns.some((c) => normalizeColumn(c.name) === normalizeColumn(a.kanban!));
  }

  // Does this definition have an unattended trigger THIS scope would fire? Approval is
  // only meaningful for those: one with neither key runs when the button is pressed and
  // nothing else, and an inherited one fires in the scope that owns it, which is where
  // it has to be approved.
  function fires(a: AutomatonInfo): boolean {
    return a.scope === scope && (a.cron !== undefined || a.kanban !== undefined);
  }

  // Read the closure, or collapse a panel already open on this row. Read here rather
  // than in the panel so the digest Approve sends is the one THIS read produced —
  // Library.svelte:toggle does the same for the same reason.
  async function review(a: AutomatonInfo): Promise<void> {
    if (!b) return;
    if (reviewing?.name === a.name) {
      reviewing = null;
      return;
    }
    error = "";
    notice = "";
    try {
      const read = await b.automatonsReview({ scope, name: a.name });
      reviewing = { name: a.name, ...read };
    } catch (e) {
      error = message(e);
    }
  }

  async function approve(a: AutomatonInfo): Promise<void> {
    if (!b || reviewing?.name !== a.name) return;
    const expectDigest = reviewing.digest;
    busy = true;
    error = "";
    try {
      await b.automatonsApprove({ scope, name: a.name, expectDigest });
      reviewing = null;
      notice = `${a.name} may now fire unattended.`;
      await refresh();
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }

  async function revokeApproval(a: AutomatonInfo): Promise<void> {
    if (!b) return;
    busy = true;
    error = "";
    try {
      await b.automatonsRevokeApproval({ scope, name: a.name });
      notice = `${a.name} will not fire until it is approved again.`;
      await refresh();
    } catch (e) {
      error = message(e);
    } finally {
      busy = false;
    }
  }

  // The card a run was fired by, by title. Falls back to the id: a card deleted since is
  // exactly the case where the record is the only thing that still remembers it.
  function cardTitle(id: string): string {
    return boardCards.find((c) => c.id === id)?.title || id;
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
      approved = await b.automatonsApproved({ scope });
    } catch (e) {
      error = message(e);
    }
    if (kb) {
      try {
        const board = await kb.kanbanGetBoard({ scope });
        columns = board.statuses;
        boardCards = board.cards;
        boardRead = true;
      } catch {
        // A board that cannot be read is not an error strip over the whole list: the
        // trigger badge stays, uncoloured, saying which column it watches and nothing
        // about whether that column still exists — which is the truth here.
        columns = [];
        boardCards = [];
        boardRead = false;
      }
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
      // Viewing root's list means launching into root, so the workspace's own cwd must
      // not follow — `undefined` resolves to root's, per resolveModuleDir.
      const { id } = await b.automatonsLaunch({
        scope,
        name: a.name,
        args: arg || undefined,
        cwd: showRoot ? undefined : cwd,
      });
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
                  <!-- A schedule fires in the scope that OWNS the file, so an inherited
                       one is shown but does not fire here (docs/automatons.md). -->
                  {#if a.cron}
                    <span
                      class="badge badge-outline badge-xs shrink-0 font-mono"
                      title={a.scope === scope
                        ? `Runs on the schedule ${a.cron} (local time) while pique is open`
                        : `Scheduled ${a.cron} in ${a.scope}; it does not fire here`}
                    >{a.cron}</span>
                  {/if}
                  <!-- Like a schedule, a card trigger fires only in the scope that OWNS
                       the file, so an inherited one is shown but does not fire here. -->
                  {#if a.kanban}
                    <span
                      class="badge badge-xs shrink-0 {columnMissing(a) ? 'badge-error' : 'badge-outline'}"
                      title={columnMissing(a)
                        ? `No column named ${a.kanban} on this board; nothing will fire it`
                        : a.scope === scope
                        ? `Runs when a card arrives in ${a.kanban}${a.wip ? `, ${a.wip} at a time` : ""}`
                        : `Watches ${a.kanban} in ${a.scope}; it does not fire here`}
                    >{a.kanban}</span>
                  {/if}
                  <!-- A trigger is a REQUEST to run unattended, not permission to: until
                       a human reads what the run would do and approves it, the clock and
                       the board dispatcher both skip it (docs/security.md finding 1). -->
                  {#if fires(a)}
                    <span
                      class="badge badge-xs shrink-0 {approved.includes(a.name)
                        ? 'badge-success'
                        : 'badge-warning'}"
                      title={approved.includes(a.name)
                        ? "Approved to fire unattended. Editing it, or the prompt or skills it names, withdraws that."
                        : "Will not fire on its own until you read what it runs and approve it"}
                    >{approved.includes(a.name) ? "approved" : "needs review"}</span>
                  {/if}
                  {#if a.scope === scope}
                    <div class="ml-auto flex shrink-0 gap-1">
                      {#if fires(a)}
                        {#if approved.includes(a.name)}
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs"
                            disabled={busy}
                            onclick={() => revokeApproval(a)}
                          >Revoke</button>
                        {:else}
                          <button
                            type="button"
                            class="btn btn-warning btn-xs"
                            disabled={busy}
                            onclick={() => review(a)}
                          >Review</button>
                        {/if}
                      {/if}
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        disabled={busy}
                        onclick={() => editAutomaton(a)}
                      >Edit</button>
                    </div>
                  {/if}
                </div>
                <div class="truncate text-[0.65rem] opacity-60">
                  {a.description || `/${a.prompt}`}{a.model ? ` · ${a.model}` : ""}
                </div>

                {#if a.error}
                  <div class="mt-1 break-all text-[0.65rem] text-error">{a.error}</div>
                {/if}

                {#if reviewing?.name === a.name}
                  <div class="mt-1.5 rounded border border-warning/40 p-2">
                    <div class="text-[0.65rem] opacity-70">
                      Everything this run reads: the definition, the prompt it sends, and
                      every skill it names. Approving lets it fire with nobody watching.
                    </div>
                    {#each reviewing.files as f (f.path)}
                      <div class="mt-1.5 truncate font-mono text-[0.6rem] opacity-50" title={f.path}>
                        {f.path}
                      </div>
                      <pre
                        class="max-h-40 overflow-auto rounded bg-base-200 p-1 text-[0.6rem] whitespace-pre-wrap break-all">{f.text}</pre>
                    {/each}
                    <div class="mt-1.5 flex gap-1">
                      <button
                        type="button"
                        class="btn btn-warning btn-xs"
                        disabled={busy}
                        onclick={() => approve(a)}
                      >Approve</button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        disabled={busy}
                        onclick={() => (reviewing = null)}
                      >Cancel</button>
                    </div>
                  </div>
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
                <!-- The separator sits INSIDE the block and on its content's line: Svelte
                     trims a block's leading whitespace, so a "·" on its own line would
                     render flush against the trigger. -->
                {selectedRun.trigger}{#if selectedRun.card}{" · "}{cardTitle(selectedRun.card)}{/if}
                · {ago(selectedRun.startedAt)}
              </span>
              {#if selectedRun.status === "running"}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs ml-auto"
                  onclick={() => stop(selectedRun.id)}
                >Stop</button>
              {/if}
            </div>
            {#if selectedRun.model}
              <div class="font-mono text-[0.65rem] opacity-60">model: {selectedRun.model}</div>
            {/if}
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
