# Test plan — SYSTEM.md and APPEND_SYSTEM.md, 2026-08-22

Cards `795e0c9a` (Library rows) and `717e160f` (default prompt research).

Everything implemented is green: **715 unit tests** (19 new), `deno check src/`,
and `deno task build` all pass. The Library module was confirmed to mount
cleanly in web mode with no console errors — but its list needs the desktop
backend, so everything below is the part a machine cannot sign off.

Run it from the real app:

```bash
deno task dev
```

Mark each ✅/❌. Anything that fails, say which step and what you saw — both
cards are in **Waiting for human** and go back to TODO.

---

## What changed, in one paragraph

pi already had `APPEND_SYSTEM.md` and an override callback for it; what it did
not have was inheritance, for the same reason `SYSTEM.md` did not — pi sees one
`agentDir`. `scope/prompt.ts` now resolves both along the chain, by **opposite**
rules: `SYSTEM.md` nearest-wins, `APPEND_SYSTEM.md` concatenates root-first.
Both are now editable in the Library as their own row kinds.

---

## 1. The four rows are there and say the right thing

1. Open **Library** in the **root** workspace. Above the extensions you should
   see exactly **two rows**: `system` / `SYSTEM.md` and `appendix` /
   `APPEND_SYSTEM.md`, both reading **"not set"** (assuming you have neither).
2. **Both rows must be present even though neither file exists.** If a row is
   missing, that is the bug — these are the only rows that show when absent.
3. Press **View** on each. It should name what the file does (replaces the
   preamble / added on top), show its full path under `~/.pique/scopes/root/agent/`,
   and say there is no file yet.
4. The **Delete** button must NOT appear on a "not set" row. There is nothing to
   delete, and offering it would be a lie.
5. Read the grey footer paragraph at the bottom of the list. It should state
   both merge rules. If it reads as though they work the same way, say so — that
   sentence is the main defence against getting this backwards.

## 2. Create root's appendix

1. Root scope → the `APPEND_SYSTEM.md` row → **Edit**.
2. The editor opens with an empty box, labelled `appendix`, saying every one on
   the chain applies root's first.
3. Type something unmistakable, e.g. `ROOT-HOUSE-RULES-XYZ`. **Save.**
4. The row now previews that first line instead of "not set", and a **Delete**
   button has appeared.
5. Open a **Chat** in the root workspace and ask the agent to repeat the last
   line of its system prompt, or just ask whether it was told anything about
   `ROOT-HOUSE-RULES-XYZ`. **It should know about it.**
6. **Crucially:** it should ALSO still behave like pi's normal agent. The
   appendix adds; it does not replace. If the agent has lost its tool knowledge,
   that is a fail.

## 3. The workspace archetype — the card's actual scenario

This is `795e0c9a`. Do it properly; it is the whole point.

1. Create two workspaces (or use two you have). Call them Swift and Go in your
   head.
2. In workspace one: Library → **Scope: Workspace** → `APPEND_SYSTEM.md` →
   Edit → `SWIFT-ARCHETYPE-XYZ` → Save.
3. In workspace two: same, with `GO-ARCHETYPE-XYZ`.
4. Back in workspace one's Library, you should now see **three** rows above the
   extensions: its own two, plus root's `APPEND_SYSTEM.md` under **Inherited
   from Root**, badged `applied first`. Its own appendix row should be badged
   `applied after root's`.
5. Root's `SYSTEM.md` should NOT appear in the inherited list — it does not
   exist. Only files that actually exist are listed as inherited.
6. Open a chat in **workspace one** and ask what it was told. It should know
   `ROOT-HOUSE-RULES-XYZ` **and** `SWIFT-ARCHETYPE-XYZ`, and know **nothing**
   about `GO-ARCHETYPE-XYZ`.
7. Open a chat in **workspace two**. Mirror image: house rules + Go, no Swift.
8. **If either workspace sees the other's archetype, stop — that is the failure
   the whole design exists to prevent.**

## 4. `SYSTEM.md` still replaces, and still shadows

1. Root scope → `SYSTEM.md` → Edit → `ROOT-BASE-XYZ` → Save.
2. New chat in root. The agent should now be steered by `ROOT-BASE-XYZ` and
   should have **lost** pi's usual preamble — ask it something pi's preamble
   would normally tell it. It should still know `ROOT-HOUSE-RULES-XYZ`: the
   appendix applies on top of whichever base won.
3. In workspace one: Library → Scope: Workspace → `SYSTEM.md` → Edit →
   `WORKSPACE-BASE-XYZ` → Save.
4. Root's `SYSTEM.md` row (under Inherited from Root) must now be badged
   **`shadowed`**.
5. New chat in workspace one: it should know `WORKSPACE-BASE-XYZ` and **not**
   `ROOT-BASE-XYZ`. Nearest wins — one base prompt, not two.
6. It should still know both appendices. The two rules are independent.

## 5. Clearing a file deletes it

The one behavior that could surprise you, so check it deliberately.

1. Workspace one → `SYSTEM.md` → Edit → **select all, delete**.
2. The button relabels itself from **Save** to **Clear**, and a note appears
   saying the file will be deleted and the chain will take over. If it still
   says Save with no warning, that is a fail — silently deleting a file behind a
   Save button is exactly what this wording exists to prevent.
3. Press it. The row goes back to **"not set"**, and root's `SYSTEM.md` row
   should lose its `shadowed` badge.
4. New chat in workspace one: `ROOT-BASE-XYZ` is back.

## 6. `/reload` picks up an edit mid-conversation

1. Start a chat in root and send a message so there is a real transcript.
2. Without closing it: Library → root `APPEND_SYSTEM.md` → Edit → change the
   text → Save.
3. Back in the chat, type `/reload`. **It should report that the prompt
   changed**, and the transcript should survive.
4. Ask the agent about the new text. It should know it.
5. Repeat with `SYSTEM.md`. Same result.
6. Now delete root's `APPEND_SYSTEM.md` entirely and `/reload` again — it should
   report a change, and the agent should no longer know it.

## 7. Automatons get the same steering

Easy to forget, and the reason it is here: an archetype that applies to your
chats but silently not to the automatons working the same board is worse than
no archetype.

1. With a workspace `APPEND_SYSTEM.md` set, launch an automaton in that
   workspace whose prompt asks it to state what it was told.
2. Its output should reflect both root's appendix and the workspace's.

## 8. Nothing was seeded

1. Check `~/.pique/scopes/root/agent/`. There should be **no** `SYSTEM.md` or
   `APPEND_SYSTEM.md` except the ones you created above.
2. Delete the ones you made. A brand-new chat should come back up on pi's own
   preamble, unmodified. Decision 2 holds: pique specifies nothing.

---

## Card `717e160f` — read, don't run

The research card produced [docs/default-system-prompt.md](default-system-prompt.md).
Nothing was written to disk and no code shipped for it. Read it and decide.

Three things in there want your judgement specifically:

1. **§3, the attribution.** The four rules are sound, but the sources I could
   find are third-party write-ups, not a primary Karpathy post. The drafted text
   states the rules without claiming an author. If you want the attribution,
   point me at the primary source.
2. **§4.** Karpathy's four rules are already this repo's `CLAUDE.md`, and pi
   loads `CLAUDE.md` as project context — so in *this* repo the proposal is
   redundant. The argument for it anyway is reach: it applies in every workspace
   regardless of what repo you are in. Agree or not.
3. **§6, the survey result.** ~45% of a leaked editor prompt is tool mechanics
   pi already owns, and on inspection **nothing from the leaks made the cut on
   its own merits**. That is a real finding rather than an unfinished search, but
   it is the part most worth disagreeing with if you think I dismissed something
   too fast.

If you approve §5, it is a copy-paste into root's `APPEND_SYSTEM.md` from the
Library — no code, no follow-up card needed unless you want the one-click
version mentioned in §8.

---

## Known and deliberately not done

- **No agent tool writes these files.** No quarantine, no approve/reject pair —
  the human half is the only half. If you want the agent able to propose an
  archetype, that is a new card and it needs the review gate that prompt
  templates have.
- **No "use the recommended default" button.** Kept out of `795e0c9a`'s scope
  on purpose; see §8 of the proposal.
- **A file edited on disk while the Library is open** does not update the list
  by itself. Press ↻. Same as every other kind.
