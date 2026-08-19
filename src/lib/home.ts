// The user's home directory — the one place that decides which environment variable
// says where it is. Everything pique persists hangs off it (~/.pique/scopes, the pi
// agent dir, settings.json), so this resolving wrongly means nothing boots.
//
// HOME first, USERPROFILE second: Windows sets USERPROFILE and leaves HOME unset,
// while a Windows shell that DOES set HOME (Git Bash, MSYS) means it deliberately.
// Runs Deno-side only.
export function home(): string {
  const h = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (!h) throw new Error("neither HOME nor USERPROFILE is set");
  return h;
}
