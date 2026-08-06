// The automaton file format, and nothing else. Pure — no filesystem, no pi — so the
// format is testable on its own. Shaped on prompts/parse.ts.
//
// An automaton is four references: a prompt template to send, the extensions and
// skills the run may load, and a description for the human reading the list, plus an
// optional model to run them on. The BODY IS RESERVED: it is retained so a round-trip
// loses nothing, and it is never sent to a model. `prompt:` is what runs
// (docs/automatons.md).
import { extract } from "@std/front-matter/yaml";
import { cronError } from "./cron.ts";
export { PI_BUILTIN_TOOLS } from "./builtins.ts";

// A type alias rather than an interface, so it keeps TypeScript's implicit index
// signature and can cross the win.bind boundary as a JSON value.
export type Automaton = {
  name: string;
  description: string;
  // The prompt template this sends. Required; "" only when `error` is set.
  prompt: string;
  extensions: string[];
  skills: string[];
  // Which of pi's builtins (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) the
  // run may call. ABSENT and EMPTY are different: absent means every builtin, the
  // behaviour of every automaton written before this key existed, while `[]` means none
  // of them — a run that can only call what `extensions:` gave it. That distinction is
  // why this is `string[] | undefined` rather than a list defaulting to all.
  //
  // It restricts pi's builtins ONLY. Extension tools and `pique:` groups are governed by
  // `extensions:`, and nothing here can widen or narrow that.
  tools?: string[];
  // Which model the run uses, as `provider/model-id`. Absent means the scope's chat
  // default — what every automaton used before this key existed.
  model?: string;
  // A five-field cron expression, in local time. Absent means the automaton runs only
  // when a human presses Launch — which is every automaton written before this key
  // existed, and stays the default.
  cron?: string;
  // The board column whose arrivals fire this automaton, matched case-insensitively
  // against the board's column names (automatons/kanban.ts). Absent means no card ever
  // fires it, which stays the default. Only the SHAPE is checked here — whether the
  // column exists needs a board, which this module deliberately does not have, so the
  // Automatons list is what flags a name no column matches.
  kanban?: string;
  // The most runs of this automaton that may be live in one scope at once. Absent means
  // UNLIMITED: a compiled-in default would be an arbitrary number, and unlimited is what
  // "a run per card" plainly means. Inert without `kanban:` — a manual or cron launch is
  // never held.
  wip?: number;
  // Reserved. Never interpreted; see the module comment.
  body: string;
  // Set when the file cannot be launched as written. The automaton is still returned
  // so the UI can show what is wrong instead of hiding the file.
  error?: string;
};

const str = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

// A list of strings, dropping anything else. A YAML list holding a number is a typo,
// not an instruction, and coercing it would invent a reference nobody wrote.
function strList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((e): e is string => typeof e === "string")
    : [];
}

// A `model:` ref split at the FIRST slash. Provider ids never contain one
// (chat/providers.ts's PROVIDER_ID_RE), while model ids routinely do — the compiled-in
// fallback is literally `lmstudio` + `google/gemma-4-e4b` — so splitting anywhere else
// would address a model that does not exist.
export function splitModelRef(
  ref: string,
): { provider: string; modelId: string } {
  const i = ref.indexOf("/");
  // No slash at all is "no provider", not "provider is everything but the last
  // character" — which is what a bare slice(0, -1) would produce.
  if (i < 0) return { provider: "", modelId: ref };
  return { provider: ref.slice(0, i), modelId: ref.slice(i + 1) };
}

// Checked here rather than at launch for the same reason `prompt:` is: a ref that
// cannot name a model would otherwise surface as a puzzling "model unavailable" on an
// unattended run. `provider/` and `/model` are both rejected — each would send half a
// ref to getModel, which answers undefined for either.
function modelError(ref: string): string | undefined {
  const { provider, modelId } = splitModelRef(ref);
  return provider && modelId
    ? undefined
    : `model: expected "provider/model-id", got ${JSON.stringify(ref)}`;
}

// The one place the `wip:` rule is written. The field-derivation site needs the
// narrowed `number` type to keep `wip` typed, and wipError needs the message — a second
// copy of the predicate would let the two drift.
function isValidWip(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

// The error message for a `wip:` value, or undefined when it is fine. The `cronError` of
// this module: a limit that is not a limit — `0`, `1.5`, `"3"` — must fail the definition
// rather than be quietly ignored, or a file that says it holds itself to three at a time
// would run unbounded.
export function wipError(value: unknown): string | undefined {
  return isValidWip(value)
    ? undefined
    : `wip: expected a whole number of 1 or more, got ${JSON.stringify(value)}`;
}

export function parseAutomaton(name: string, text: string): Automaton {
  const empty = {
    name,
    description: "",
    prompt: "",
    extensions: [],
    skills: [],
  };
  let attrs: Record<string, unknown> = {};
  let body = text;
  try {
    // Throws on a file with no frontmatter, and on malformed YAML. Unlike a prompt
    // template — which is legitimately body-only — an automaton with no frontmatter
    // carries no `prompt:` and so cannot run either way; the distinction only changes
    // which error the UI shows.
    const extracted = extract(text);
    // extract() only throws on missing/malformed frontmatter — valid-but-non-object
    // YAML (e.g. a bare `null` or scalar body) succeeds with attrs of that type, and
    // reading a key off it below would throw outside this try/catch. Coerce it to {}
    // so that case falls through to the ordinary "no prompt" report instead of a crash.
    attrs = (extracted.attrs && typeof extracted.attrs === "object")
      ? extracted.attrs as Record<string, unknown>
      : {};
    body = extracted.body;
  } catch (err) {
    if (text.trimStart().startsWith("---")) {
      return {
        ...empty,
        body: text.trim(),
        error: `frontmatter: ${(err as Error).message}`,
      };
    }
    return { ...empty, body: text.trim(), error: "prompt: required" };
  }
  // Trimmed so a whitespace-only value collapses to "" and reports the same error as
  // an absent one, per the type comment above.
  const prompt = (str(attrs.prompt) ?? "").trim();
  const model = (str(attrs.model) ?? "").trim();
  const cron = (str(attrs.cron) ?? "").trim();
  const kanban = (str(attrs.kanban) ?? "").trim();
  const wip = attrs.wip;
  // Absent stays absent; a present-but-not-a-list value reads as an empty restriction
  // rather than as "unrestricted", because a `tools:` the writer meant as a limit must
  // never fail open.
  const tools = attrs.tools === undefined ? undefined : strList(attrs.tools);
  return {
    name,
    description: str(attrs.description) ?? "",
    prompt,
    extensions: strList(attrs.extensions),
    skills: strList(attrs.skills),
    tools,
    // "" and absent are the same thing — inherit the scope's default.
    model: model || undefined,
    // "" and absent are both "launch button only".
    cron: cron || undefined,
    // "" and absent are both "no card fires this".
    kanban: kanban || undefined,
    // Kept only when it is a usable limit; a bad value is reported as the definition's
    // error below rather than stored as a number it is not.
    wip: isValidWip(wip) ? wip : undefined,
    body: body.trim(),
    // One error field, so a file missing its prompt reports that first; the model and
    // the schedule are checked only once there is something to run. A bad `cron:` is an
    // error on the whole definition rather than a schedule that is merely ignored: a
    // file that says it runs daily and silently never does is the failure this module
    // keeps refusing to ship.
    error: prompt
      ? (model && modelError(model)) || (cron && cronError(cron)) ||
        (wip !== undefined && wipError(wip)) || undefined
      : "prompt: required",
  };
}

// Serialize back to the on-disk format. Frontmatter is emitted by hand rather than
// with a YAML writer, as prompts/parse.ts does: the schema is four keys wide, and
// JSON's encoding of a string is valid YAML flow syntax — which is what keeps a
// description holding `---` or a newline inside its quoted scalar.
//
// The body is not written. It is reserved (see the module comment), and the editor
// has no field for it, so emitting one would create content nothing can edit.
export function automatonFile(
  a: {
    description: string;
    prompt: string;
    extensions: string[];
    skills: string[];
    tools?: string[];
    model?: string;
    cron?: string;
    kanban?: string;
    wip?: number;
  },
): string {
  const list = (xs: string[]) =>
    `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  const model = a.model?.trim();
  const cron = a.cron?.trim();
  const kanban = a.kanban?.trim();
  return [
    "---",
    `description: ${JSON.stringify(a.description)}`,
    `prompt: ${JSON.stringify(a.prompt)}`,
    `extensions: ${list(a.extensions)}`,
    `skills: ${list(a.skills)}`,
    // Written whenever it is defined, INCLUDING when empty: `tools: []` is a real
    // restriction, and omitting it would silently hand the run every builtin back.
    ...(a.tools ? [`tools: ${list(a.tools)}`] : []),
    // Omitted rather than written empty, so a file inheriting the scope's model looks
    // like every automaton written before the key existed.
    ...(model ? [`model: ${JSON.stringify(model)}`] : []),
    // Same treatment: no key at all is "launch button only", so clearing the form's
    // schedule field removes the schedule rather than leaving an empty one behind.
    ...(cron ? [`cron: ${JSON.stringify(cron)}`] : []),
    // Same treatment as `cron:` — omitted rather than written empty, so clearing the
    // form's column picker removes the trigger instead of leaving a blank one behind.
    ...(kanban ? [`kanban: ${JSON.stringify(kanban)}`] : []),
    ...(a.wip === undefined ? [] : [`wip: ${a.wip}`]),
    "---",
    "",
  ].join("\n");
}
