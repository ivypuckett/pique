import { assertEquals } from "@std/assert";
import {
  approveProfile,
  listProfiles,
  listVisibleProfiles,
  rejectProfile,
  resolveBasePrompt,
  resolveProfile,
  revokeProfile,
} from "./service.ts";
import { basePromptPath, ensureProfileDirs, pendingProfilePath, profilePath } from "./paths.ts";
import { ROOT, type ScopeId } from "../scope/paths.ts";

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const prev = Deno.env.get("HOME");
  const dir = await Deno.makeTempDir();
  Deno.env.set("HOME", dir);
  try {
    await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(dir, { recursive: true });
  }
}

async function write(
  scope: ScopeId,
  name: string,
  body: string,
  state: "live" | "pending" = "live",
): Promise<void> {
  await ensureProfileDirs(scope);
  const path = state === "live" ? profilePath(scope, name) : pendingProfilePath(scope, name);
  await Deno.writeTextFile(path, body);
}

async function writeBasePrompt(scope: ScopeId, text: string): Promise<void> {
  await Deno.mkdir(`${Deno.env.get("HOME")}/.pique/scopes/${scope}/agent`, { recursive: true });
  await Deno.writeTextFile(basePromptPath(scope), text);
}

Deno.test("a scope with no profiles dir lists nothing rather than failing", async () => {
  await withTempHome(async () => {
    assertEquals(await listProfiles("ws-1"), []);
  });
});

Deno.test("live and pending profiles are listed with their state", async () => {
  await withTempHome(async () => {
    await write("ws-1", "reviewer", "---\ndescription: d\n---\nbody");
    await write("ws-1", "auditor", "---\n---\nbody", "pending");

    const got = (await listProfiles("ws-1")).map((p) => ({ name: p.name, state: p.state }));
    assertEquals(got, [
      { name: "auditor", state: "pending" },
      { name: "reviewer", state: "live" },
    ]);
  });
});

Deno.test("a quarantined profile is never resolvable", async () => {
  await withTempHome(async () => {
    await write(ROOT, "auditor", "---\ntools: [read]\n---\nbody", "pending");
    assertEquals(await resolveProfile(ROOT, "auditor"), null);
    assertEquals((await listVisibleProfiles(ROOT)).length, 0);
  });
});

Deno.test("a workspace sees root's profiles and its own", async () => {
  await withTempHome(async () => {
    await write(ROOT, "shared", "---\n---\nshared body");
    await write("ws-1", "local", "---\n---\nlocal body");

    const names = (await listVisibleProfiles("ws-1")).map((p) => p.name);
    assertEquals(names, ["shared", "local"], "root's come first");
    assertEquals((await resolveProfile("ws-1", "shared"))?.body, "shared body");
    assertEquals((await resolveProfile("ws-1", "local"))?.body, "local body");
  });
});

Deno.test("root cannot see a workspace's profiles", async () => {
  await withTempHome(async () => {
    await write("ws-1", "local", "---\n---\nlocal body");
    assertEquals(await resolveProfile(ROOT, "local"), null);
    assertEquals(await listVisibleProfiles(ROOT), []);
  });
});

Deno.test("a workspace profile shadows root's of the same name, and is listed once", async () => {
  await withTempHome(async () => {
    await write(ROOT, "reviewer", "---\n---\nroot body");
    await write("ws-1", "reviewer", "---\n---\nworkspace body");

    assertEquals((await resolveProfile("ws-1", "reviewer"))?.body, "workspace body");
    const visible = await listVisibleProfiles("ws-1");
    assertEquals(visible.map((p) => p.name), ["reviewer"]);
    assertEquals(visible[0].scope, "ws-1");
    // Root's own listing is untouched by the workspace shadowing it.
    assertEquals((await resolveProfile(ROOT, "reviewer"))?.body, "root body");
  });
});

Deno.test("a missing profile resolves to null rather than throwing", async () => {
  await withTempHome(async () => {
    assertEquals(await resolveProfile("ws-1", "ghost"), null);
  });
});

Deno.test("a file whose name is not a valid profile name is skipped, not fatal", async () => {
  await withTempHome(async () => {
    await ensureProfileDirs("ws-1");
    await Deno.writeTextFile(`${Deno.env.get("HOME")}/.pique/scopes/ws-1/profiles/Bad Name.md`, "x");
    await write("ws-1", "good", "---\n---\nbody");
    assertEquals((await listProfiles("ws-1")).map((p) => p.name), ["good"]);
  });
});

Deno.test("approve moves a profile out of quarantine; reject and revoke delete", async () => {
  await withTempHome(async () => {
    await write("ws-1", "auditor", "---\n---\nbody", "pending");
    await approveProfile("ws-1", "auditor");
    assertEquals((await listProfiles("ws-1")).map((p) => p.state), ["live"]);
    assertEquals((await resolveProfile("ws-1", "auditor"))?.body, "body");

    await revokeProfile("ws-1", "auditor");
    assertEquals(await listProfiles("ws-1"), []);

    await write("ws-1", "auditor", "---\n---\nbody", "pending");
    await rejectProfile("ws-1", "auditor");
    assertEquals(await listProfiles("ws-1"), []);
  });
});

Deno.test("a broken profile is listed with its error rather than hidden", async () => {
  await withTempHome(async () => {
    await write("ws-1", "broken", "---\ntools: [a, b\n---\nbody");
    const [p] = await listProfiles("ws-1");
    assertEquals(p.name, "broken");
    assertEquals(typeof p.error, "string");
  });
});

Deno.test("the base prompt is the nearest SYSTEM.md on the chain", async () => {
  await withTempHome(async () => {
    assertEquals(await resolveBasePrompt("ws-1"), undefined);

    await writeBasePrompt(ROOT, "root base");
    assertEquals(await resolveBasePrompt("ws-1"), "root base", "root's reaches a workspace");
    assertEquals(await resolveBasePrompt(ROOT), "root base");

    await writeBasePrompt("ws-1", "workspace base");
    assertEquals(await resolveBasePrompt("ws-1"), "workspace base", "the nearest one wins");
    assertEquals(await resolveBasePrompt(ROOT), "root base", "root is unaffected");
  });
});
