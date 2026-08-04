// Frontend half of the skills binding contract. The backend half is the skills*
// win.bind handlers in src/desktop.ts (delegating to skills/service.ts) — keep
// arg/return shapes in sync by hand (separate module graphs).
import type { SkillInfo } from "./service.ts";
export type { SkillInfo };

export interface SkillBindings {
  // Every skill nameable in this scope: its own plus inherited, nearest winning.
  skillsVisible(arg: { scope: string }): Promise<SkillInfo[]>;
}

// Null in web-dev (deno task web), where there's no desktop backend.
export function skillBindings(): SkillBindings | null {
  const b = (globalThis as unknown as { bindings?: unknown }).bindings;
  return b ? (b as SkillBindings) : null;
}
