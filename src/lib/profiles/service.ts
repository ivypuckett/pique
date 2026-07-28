// Backend service for profiles: lists a scope's profiles, resolves one along the scope
// chain, and moves files between quarantine and live. The profile* win.bind handlers
// (desktop.ts) are the human half; agent-tools.ts is the agent half and can only ever
// write into pending. Shaped on tools/service.ts, which does the same job for defined
// tools. Runs Deno-side only.
import { parseProfile, type Profile } from "./parse.ts";
import {
  assertProfileName,
  basePromptPath,
  ensureProfileDirs,
  pendingDir,
  pendingProfilePath,
  profilePath,
  profilesDir,
} from "./paths.ts";
import { chain, type ScopeId } from "../scope/paths.ts";

export type ProfileState = "live" | "pending";
// An alias, not an interface, for the same reason Profile is one (parse.ts).
export type ProfileInfo = Profile & { scope: ScopeId; state: ProfileState };

// Profile names are the `*.md` basenames in a dir. A missing dir means "none yet", not
// an error. A basename that isn't a legal profile name is skipped rather than raising —
// the dir is user-editable, and one stray file must not break the whole listing.
async function namesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".md")) continue;
      const name = entry.name.slice(0, -3);
      try {
        assertProfileName(name);
      } catch {
        continue;
      }
      names.push(name);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return names.sort();
}

async function read(
  scope: ScopeId,
  name: string,
  state: ProfileState,
): Promise<ProfileInfo> {
  const path = state === "live" ? profilePath(scope, name) : pendingProfilePath(scope, name);
  return { ...parseProfile(name, await Deno.readTextFile(path)), scope, state };
}

// One scope's own profiles, both states in one call — the review UI shows them together.
export async function listProfiles(scope: ScopeId): Promise<ProfileInfo[]> {
  const [pending, live] = await Promise.all([
    namesIn(pendingDir(scope)),
    namesIn(profilesDir(scope)),
  ]);
  return [
    ...await Promise.all(pending.map((n) => read(scope, n, "pending"))),
    ...await Promise.all(live.map((n) => read(scope, n, "live"))),
  ];
}

// Every profile selectable in `scope`: its own plus each ancestor's, root-first (matching
// listVisibleTools, which the Settings UI orders by). A name defined in more than one
// scope appears ONCE, resolved to the nearest — otherwise the picker shows a duplicate
// and the two entries would disagree about which body actually runs.
export async function listVisibleProfiles(scope: ScopeId): Promise<ProfileInfo[]> {
  const byName = new Map<string, ProfileInfo>();
  for (const s of chain(scope)) {
    for (const p of await listProfiles(s)) {
      if (p.state === "live") byName.set(p.name, p);
    }
  }
  return [...byName.values()];
}

// The profile an agent in `scope` runs under. Walks the chain NEAREST FIRST — the reverse
// of listing — so a workspace's profile shadows a root profile of the same name. Missing
// → null, so a scope default left pointing at a deleted profile degrades to "no profile"
// rather than throwing at session start.
export async function resolveProfile(scope: ScopeId, name: string): Promise<Profile | null> {
  try {
    assertProfileName(name);
  } catch {
    return null;
  }
  for (const s of [...chain(scope)].reverse()) {
    try {
      return await read(s, name, "live");
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return null;
}

// The scope's base system prompt: the nearest SYSTEM.md on the chain, or undefined when
// none exists. Undefined must reach pi AS undefined — that is what keeps pi's own
// preamble as the default (see chat/agent.ts).
export async function resolveBasePrompt(scope: ScopeId): Promise<string | undefined> {
  for (const s of [...chain(scope)].reverse()) {
    try {
      return await Deno.readTextFile(basePromptPath(s));
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return undefined;
}

// Approve = move quarantine → live, within the same scope. From here a Chat module can
// select it (and, for root, so can every workspace). Rename replaces any same-named live
// profile, so re-approving a redefinition supersedes the old one.
export async function approveProfile(scope: ScopeId, name: string): Promise<void> {
  await ensureProfileDirs(scope);
  await Deno.rename(pendingProfilePath(scope, name), profilePath(scope, name));
}

export async function rejectProfile(scope: ScopeId, name: string): Promise<void> {
  await Deno.remove(pendingProfilePath(scope, name));
}

// Revoke an already-approved profile. Chat modules already running under it keep it until
// they restart, the same way a revoked tool does.
export async function revokeProfile(scope: ScopeId, name: string): Promise<void> {
  await Deno.remove(profilePath(scope, name));
}
