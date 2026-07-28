// Frontend half of the profiles binding contract. The backend half is the profiles*
// win.bind handlers in src/desktop.ts (delegating to profiles/service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { ProfileInfo, ProfileState } from "./service.ts";
export type { ProfileInfo, ProfileState };

// Every call names the scope it acts on: a profile belongs to one scope, and approving
// in root is what makes it selectable in every workspace. `profilesList` is a scope's
// own profiles (the ones it can approve or revoke); `profilesVisible` is what a Chat
// module there can actually select — its own plus root's, shadowed names resolved.
export interface ProfileBindings {
  profilesList(arg: { scope: string }): Promise<ProfileInfo[]>;
  profilesVisible(arg: { scope: string }): Promise<ProfileInfo[]>;
  profilesApprove(arg: { scope: string; name: string }): Promise<unknown>;
  profilesReject(arg: { scope: string; name: string }): Promise<unknown>;
  profilesRevoke(arg: { scope: string; name: string }): Promise<unknown>;
}

// Null in web-dev (deno task web), where there's no desktop backend — the Profiles
// section then shows a desktop-only note, same as providers/extensions/tools.
export function profileBindings(): ProfileBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as ProfileBindings) : null;
}
