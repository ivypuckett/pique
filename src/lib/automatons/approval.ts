// Which definitions may fire UNATTENDED, and over what bytes that approval was given.
//
// The Launch button needs nothing from this module: a human pressing Launch IS the
// review, and a dropped-in file stays listable and launchable exactly as before. What
// this gates is the two callers with no human in them — schedule.ts's clock and
// kanban.ts's dispatcher. Before this existed, writing a file into automatons/ with a
// `cron:` key was enough to get it running every minute forever, with every pi builtin,
// which is the hole docs/security.md finding 1 describes.
//
// WHAT IS APPROVED IS THE CLOSURE, NOT THE FILE. An automaton is mostly an indirection:
// `prompt:` names a separate template that holds the actual instructions, and `skills:`
// names more text that steers the run. Digesting only the definition would let an agent
// approve-by-proxy — leave the approved `x.md` untouched and rewrite the prompt it
// points at, so the schedule the human approved now runs instructions nobody read. So
// the digest covers the definition, the prompt template it resolves to, and every file
// under every skill it names.
//
// WHAT THIS IS NOT: containment. approved.json is an ordinary file and the chat agent
// holds `write` and `bash`, so an agent that specifically targets the manifest can
// forge an entry — there is no location on this filesystem that it could not. This is
// the same advisory gate the extension review is (docs/extensions.md), and it buys the
// same thing: the ordinary path becomes reviewable, and code that ends up running
// unattended got there because a human said so rather than because a file appeared.
// Do not build anything on a stronger reading. Runs Deno-side only.
import { digestOf } from "../digest.ts";
import { approvalsPath, automatonPath } from "./paths.ts";
import type { Automaton } from "./parse.ts";
import { promptPath } from "../prompts/paths.ts";
import { resolveSkillPath } from "../skills/service.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

export type ClosureFile = { path: string; text: string };

// name → the closure digest that was approved. A name absent from the map has never
// been approved; a name present with a stale digest was approved over different bytes,
// and both are refusals — the difference only matters to the message a human reads.
export type Approvals = Record<string, string>;

// Every file under a skill ref. A skill is either `<name>.md` or a `<name>/` directory
// with a SKILL.md at its root (skills/service.ts), and the directory form can carry
// scripts and references alongside the instructions — all of it reaches the run, so all
// of it is part of what was approved. Sorted, because readDir order is not stable and a
// digest that depended on it would flap.
async function filesUnder(root: string): Promise<ClosureFile[]> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(root);
  } catch {
    // A ref that resolves to nothing contributes nothing. The launch refuses on it
    // separately (resolve.ts:resolveSkillRefs); this module only says what the bytes
    // are, and "absent" is a state the digest should track rather than throw on.
    return [];
  }
  if (info.isFile) {
    return [{ path: root, text: await Deno.readTextFile(root) }];
  }
  const out: ClosureFile[] = [];
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      out.push(...await filesUnder(path));
    } else if (entry.isFile) {
      // Binary content in a skill dir is not text, and decoding it lossily would still
      // digest deterministically — which is all this needs. Failing to read at all is
      // the same "absent" case as above.
      try {
        out.push({ path, text: await Deno.readTextFile(path) });
      } catch {
        continue;
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// The prompt template `a` would actually send, resolved nearest-scope-first the way a
// launch resolves it. Absent when the ref names nothing — a typo, which the launch
// refuses on its own; the closure just records that there were no bytes there, so
// creating the file later is a change and re-approval is required.
async function promptFile(
  scope: ScopeId,
  a: Automaton,
): Promise<ClosureFile[]> {
  if (!a.prompt) return [];
  for (const s of [...chain(scope)].reverse()) {
    const path = promptPath(s, a.prompt);
    try {
      return [{ path, text: await Deno.readTextFile(path) }];
    } catch {
      continue;
    }
  }
  return [];
}

// Everything a human is approving when they approve `a`: the definition plus everything
// it points at. `scope` is the scope the run belongs to, which is what the refs resolve
// against.
export async function automatonClosure(
  scope: ScopeId,
  a: Automaton,
): Promise<ClosureFile[]> {
  const defPath = automatonPath(scope, a.name);
  const files: ClosureFile[] = [
    { path: defPath, text: await Deno.readTextFile(defPath) },
    ...await promptFile(scope, a),
  ];
  for (const ref of a.skills) {
    const path = await resolveSkillPath(scope, ref);
    if (path) files.push(...await filesUnder(path));
  }
  return files;
}

export async function closureDigest(
  scope: ScopeId,
  a: Automaton,
): Promise<string> {
  return await digestOf(await automatonClosure(scope, a));
}

// A missing or unreadable manifest means "nothing is approved", which is the safe
// reading and also the ordinary one on a fresh install. A corrupt manifest reads the
// same way deliberately: the alternative is throwing inside a scheduler tick, and
// "fires nothing" is a better failure than "stops the clock for every scope".
export async function readApprovals(scope: ScopeId): Promise<Approvals> {
  let text: string;
  try {
    text = await Deno.readTextFile(approvalsPath(scope));
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ) {
      return {};
    }
    const out: Approvals = {};
    for (const [name, digest] of Object.entries(parsed)) {
      if (typeof digest === "string") out[name] = digest;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeApprovals(
  scope: ScopeId,
  approvals: Approvals,
): Promise<void> {
  await Deno.writeTextFile(
    approvalsPath(scope),
    JSON.stringify(approvals, null, 2) + "\n",
  );
}

// May this definition fire without a human? True only when the manifest holds a digest
// for it AND that digest still matches what is on disk right now — an approval names
// specific bytes, so an edit to the definition, its prompt or any of its skills revokes
// it by construction rather than by anyone remembering to.
export async function isApproved(
  scope: ScopeId,
  a: Automaton,
): Promise<boolean> {
  const approved = (await readApprovals(scope))[a.name];
  if (approved === undefined) return false;
  return approved === await closureDigest(scope, a);
}

// Record that a human read `expectDigest` and approved it. The digest is required and
// checked at runtime for the reason enableExtension's is (docs/security.md finding 4):
// the webview is an untrusted caller, so a TypeScript type does not reach it, and an
// approval that trusted whatever the caller sent would gate nothing.
export async function recordApproval(
  scope: ScopeId,
  a: Automaton,
  expectDigest: string,
): Promise<void> {
  if (typeof expectDigest !== "string" || expectDigest === "") {
    throw new Error("Cannot approve an automaton without reviewing it first.");
  }
  if (await closureDigest(scope, a) !== expectDigest) {
    throw new Error(
      "This automaton changed on disk after you reviewed it — read it again before approving.",
    );
  }
  const approvals = await readApprovals(scope);
  approvals[a.name] = expectDigest;
  await writeApprovals(scope, approvals);
}

// Stops it firing unattended, keeps the file and keeps Launch working.
export async function revokeApproval(
  scope: ScopeId,
  name: string,
): Promise<void> {
  const approvals = await readApprovals(scope);
  if (!(name in approvals)) return;
  delete approvals[name];
  await writeApprovals(scope, approvals);
}
