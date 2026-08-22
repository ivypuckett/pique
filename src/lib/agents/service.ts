// Backend service for subagents: discovers agent definitions (paths.ts/parse.ts) and
// runs one as an isolated, in-process nested pi session. Passed to
// chat/agent.ts's startAgent, which builds the run_subagent tool (agent-tools.ts) on
// top of it. Runs Deno-side only.
import {
  createAgentSession,
  DefaultResourceLoader,
  type ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { type AgentDef, agentFile, parseAgentDef } from "./parse.ts";
import {
  agentPath,
  agentsDir,
  assertAgentName,
  ensureAgentDirs,
} from "./paths.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

// deno-lint-ignore no-explicit-any
type Model = any;

// Agent names are the `*.md` basenames in a dir. A missing dir means "none defined
// yet", not an error — the same rule prompts/service.ts's namesIn follows.
async function namesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        names.push(entry.name.slice(0, -3));
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return names.sort();
}

// One scope's own subagent definitions.
export async function listAgents(scope: ScopeId): Promise<AgentDef[]> {
  const dir = agentsDir(scope);
  const names = await namesIn(dir);
  return await Promise.all(
    names.map(async (name) =>
      parseAgentDef(name, await Deno.readTextFile(`${dir}/${name}.md`))
    ),
  );
}

// Every agent definition invocable in `scope`: its own plus each ancestor's, root-first,
// de-duplicated by name so a workspace's definition shadows a same-named root one —
// mirrors prompts/service.ts's listVisiblePrompts.
export async function listVisibleAgents(scope: ScopeId): Promise<AgentDef[]> {
  const byName = new Map<string, AgentDef>();
  for (const s of chain(scope)) {
    for (const def of await listAgents(s)) byName.set(def.name, def);
  }
  return [...byName.values()];
}

// Write a definition into the scope's live dir, creating or replacing it. Both halves
// write through here — the Library (agents* win.bind handlers, desktop.ts) and the agent
// itself (define_subagent) — because there is no quarantine for the two to differ over,
// unlike prompts where only the human path may write live.
export async function saveAgent(
  scope: ScopeId,
  name: string,
  a: {
    description: string;
    tools?: string[];
    model?: string;
    systemPrompt: string;
  },
): Promise<void> {
  assertAgentName(name);
  await ensureAgentDirs(scope);
  await Deno.writeTextFile(agentPath(scope, name), agentFile(a));
}

export async function deleteAgent(
  scope: ScopeId,
  name: string,
): Promise<void> {
  await Deno.remove(agentPath(scope, name));
}

// The model an agent definition asks for: `provider/id`, or a bare id searched across
// every available model. Falls back to the parent conversation's own model when the
// definition names none, or when what it names cannot be found.
async function resolveModel(
  modelRuntime: ModelRuntime,
  wanted: string | undefined,
  fallback: Model,
): Promise<Model> {
  if (!wanted) return fallback;
  const slash = wanted.indexOf("/");
  if (slash !== -1) {
    const found = modelRuntime.getModel(
      wanted.slice(0, slash),
      wanted.slice(slash + 1),
    );
    if (found) return found;
  }
  const available = await modelRuntime.getAvailable();
  return available.find((m: Model) => m.id === wanted) ?? fallback;
}

// The final text a nested session produced: every assistant text block, across every
// assistant message the run produced (there can be more than one when the child makes
// tool calls between bouts of text), joined in order.
// deno-lint-ignore no-explicit-any
function finalText(messages: any[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content ?? []) {
      if (block.type === "text") parts.push(block.text);
    }
  }
  return parts.join("\n\n").trim();
}

// One progress line for a child event the parent should see while the run is still
// going, or null for the rest. Only the child's TOOL CALLS are projected: its assistant
// text is what the call returns at the end, so streaming that too would print the
// answer twice. Pure, and the shape the parent renders, so it is tested directly.
// deno-lint-ignore no-explicit-any
export function progressLine(event: any): string | null {
  if (event?.type !== "tool_execution_start") return null;
  const args = JSON.stringify(event.args ?? null);
  return `${event.toolName} ${
    args.length > 200 ? args.slice(0, 200) + "…" : args
  }`;
}

// Two limits rather than one, because they catch different failures. A child stuck in a
// tool loop burns turns quickly and would sit well inside any wall-clock budget; a child
// waiting on one hung call burns no turns at all. Both are generous — they are a backstop
// against a run that will never converge, not a budget a working delegation should feel.
export const DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_MAX_TURNS = 40;

// What the parent gets back when a limit stopped the run. The child's own text comes
// first and the notice qualifies it, rather than an error that throws the work away:
// the parent can usually still act on a partial answer, and always needs to know it is
// looking at one. Pure, so the wording is pinned by a test.
export function truncatedResult(
  name: string,
  limit: string,
  text: string,
): string {
  const trimmed = text.trim();
  const why = `subagent ${name} was stopped early: it ${limit}`;
  return trimmed === ""
    ? `[${why}, and produced no output.]`
    : `${trimmed}\n\n[${why}. The text above is what it produced before then, and may be incomplete.]`;
}

export type RunSubagentOptions = {
  def: AgentDef;
  task: string;
  cwd: string;
  modelRuntime: ModelRuntime;
  // The parent conversation's already-resolved model, used when the definition names
  // none of its own (or an unavailable one).
  fallbackModel: Model;
  // The parent tool call's abort signal, so aborting the parent kills the nested run
  // rather than orphaning it.
  signal?: AbortSignal;
  // Called with one progressLine per tool call the child makes, as it starts. Without
  // it the run is silent until it returns, and a long delegation looks like a hang.
  onProgress?: (line: string) => void;
  // Both default as above; a caller overrides them to bound one particular run.
  timeoutMs?: number;
  maxTurns?: number;
};

// Runs one subagent definition against one task and returns its final text — to
// completion, or to whichever limit it hits first. The child is isolated from everything
// the parent conversation carries: a fresh temp agentDir (so DefaultResourceLoader finds
// no extensions/prompts/skills — no pique customTools, no recursive subagent spawning)
// and an in-memory session (nothing persisted to disk).
export async function runSubagent(opts: RunSubagentOptions): Promise<string> {
  const {
    def,
    task,
    cwd,
    modelRuntime,
    fallbackModel,
    signal,
    onProgress,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxTurns = DEFAULT_MAX_TURNS,
  } = opts;
  const model = await resolveModel(modelRuntime, def.model, fallbackModel);
  const agentDir = await Deno.makeTempDir();
  try {
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      systemPromptOverride: () => def.systemPrompt,
    });
    // createAgentSession only reloads a loader it creates itself (chat/agent.ts), so
    // one handed in explicitly — needed here for systemPromptOverride — must be
    // reloaded by hand first or it yields no system prompt override at all.
    await resourceLoader.reload();
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime,
      model,
      tools: def.tools,
      sessionManager: SessionManager.inMemory(cwd),
      resourceLoader,
    });
    // Which limit ended the run, or null if it finished on its own. Recorded BEFORE the
    // abort, so the error the abort leaves behind is recognised as ours rather than
    // reported as a failure of the child's.
    let stoppedBy: string | null = null;
    let turns = 0;
    const stop = (limit: string) => {
      if (stoppedBy !== null) return;
      stoppedBy = limit;
      void session.abort();
    };

    const timer = setTimeout(
      () => stop(`hit its ${Math.round(timeoutMs / 1000)}s time limit`),
      timeoutMs,
    );
    // Subscribed unconditionally now, not only for onProgress: turn_end is how the turn
    // cap is counted, and pi fires it once per model response with its tool results.
    const unsubscribe = session.subscribe((event: unknown) => {
      const e = event as { type?: string };
      if (e?.type === "turn_end" && ++turns >= maxTurns) {
        stop(`hit its ${maxTurns}-turn limit`);
      }
      const line = progressLine(event);
      if (line) onProgress?.(line);
    });

    const onAbort = () => {
      session.abort();
    };
    signal?.addEventListener("abort", onAbort);
    try {
      await session.prompt(task);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      unsubscribe();
    }
    const text = finalText(session.messages);
    // Ahead of the error check on purpose: aborting is how a limit is enforced, and pi
    // records that as an error on the session. Throwing here would discard the partial
    // answer this whole path exists to preserve.
    if (stoppedBy !== null) return truncatedResult(def.name, stoppedBy, text);
    const error = session.agent?.state?.errorMessage;
    if (error) throw new Error(`subagent ${def.name} failed: ${error}`);
    return text;
  } finally {
    await Deno.remove(agentDir, { recursive: true }).catch(() => {});
  }
}
