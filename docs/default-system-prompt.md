# A default system prompt for pique — proposal

**Status: proposal. Nothing here is shipped, seeded, or written to `~/.pique`.**
Card `717e160f` asks what should go in a default prompt; this is the answer for
you to approve, reject or edit. If you approve it, the text in §5 gets pasted
into root's `APPEND_SYSTEM.md` from the Library — by you, once, deliberately.

---

## 1. The constraint this has to respect

Decision 2 in the README: *"System prompts can do more harm than good. Not
specifying one within pique removes it entirely."* A default that pique writes
onto your disk at first run contradicts that — it is a system prompt pique
specified, and one you would have to go find in order to disagree with.

So the deliverable is **text, not a file**. That is also why §5 is sized to be
read in one sitting: if you cannot read the whole thing before agreeing to it,
it should not be steering your agents.

## 2. Finding: it belongs in `APPEND_SYSTEM.md`, not `SYSTEM.md`

`SYSTEM.md` **replaces** pi's own preamble. pi's preamble is where the tool
descriptions, the tool-use guidelines and the environment framing live — a
default that replaced all of that would have to re-derive it, badly, and would
get stale every time pi changed.

`APPEND_SYSTEM.md` is added on top and keeps pi's preamble intact. It is also
inherited by concatenation (see [scopes.md](scopes.md)), which is what the
default needs: it goes in **root**, every workspace gets it, and a workspace can
still add its own archetype without restating or losing it.

**Recommendation: the default is an appendix. `SYSTEM.md` stays empty by
default, and decision 2 stands unchanged.**

## 3. Karpathy's four rules

The card names these as a must. They are:

1. **Think before coding** — state assumptions, surface tradeoffs, ask rather
   than pick silently, push back when warranted.
2. **Simplicity first** — the minimum code that solves the problem, nothing
   speculative, no abstraction for single-use code.
3. **Surgical changes** — touch only what you must; every changed line traces to
   the request.
4. **Goal-driven execution** — define verifiable success criteria and loop until
   they are met.

They target *reasoning* failures — wrong assumptions, over-engineering, scope
creep, weak success criteria — rather than formatting or tone. That is why they
survive a model change, and it is the reason to prefer them over anything mined
from a vendor prompt.

**Two honest caveats.**

- **Provenance is secondary.** What I could find are third-party write-ups
  ([1](https://aridanemartin.dev/blog/karpathy-4-lines-claude-md/),
  [2](https://lucaberton.com/blog/karpathy-claude-md-llm-coding-principles-2026/),
  [3](https://www.developersdigest.tech/blog/karpathy-claude-md-skills-menu)),
  not a primary post I could verify. The rules are sound on their own merits;
  the attribution is what I cannot stand behind. If you want the attribution in
  the shipped text, point me at the primary source and I will link it. Otherwise
  §5 states the rules without claiming an author.
- **The circulating effect sizes are marketing.** One write-up claims an error
  rate dropping from 41% to 11%. There is no methodology behind it that I could
  find. It is not a reason to adopt these, and it is not in §5.

**We already have them.** This repository's own `CLAUDE.md` is these four rules,
in this order, with a repo-specific fifth about branching. That is not a
coincidence to note and move past — it changes the proposal, see §4.

## 4. Finding: `CLAUDE.md` and an appendix are not the same lever

pi loads `AGENTS.md` / `CLAUDE.md` from the working directory as a **project
context file**. So an agent working in *this* repo already gets the four rules,
and the proposed default would be redundant here.

The difference is reach and ownership:

|                   | `CLAUDE.md`                     | root `APPEND_SYSTEM.md`               |
| ----------------- | ------------------------------- | ------------------------------------- |
| Applies to        | one project directory           | every workspace, every scope          |
| Lives in          | the repo, shared with the team  | your machine, yours alone             |
| Present when      | someone put one there           | always                                |
| Survives a `cwd`  | no — a different project, gone  | yes                                   |

The appendix is the answer to *"I want this in every conversation regardless of
which repo I am sitting in and whether its authors wrote a `CLAUDE.md`."* That
is the actual gap, and it is worth filling even though this one repo covers
itself.

**Consequence for the text:** §5 must not restate what a project's own
`CLAUDE.md` would say. It states the four rules and stops — no build commands,
no directory conventions, no house style. Those belong to a project or to a
workspace archetype.

## 5. Proposed body for root's `APPEND_SYSTEM.md`

```markdown
## Working rules

These are additions to how you already work, not a replacement.

**Think before coding.** State your assumptions where they matter. If the
request has more than one reasonable reading, say so and pick one explicitly
rather than silently. If a simpler approach exists, say so before building the
complicated one. If something is genuinely unclear and the answer changes what
you build, ask — but do everything that does not depend on the answer first.

**Simplicity first.** Write the minimum code that solves the problem. No
features that were not asked for, no abstraction for something used once, no
configurability nobody requested, no error handling for cases that cannot
happen. If you wrote 200 lines and it could be 50, rewrite it.

**Surgical changes.** Touch only what the task requires. Do not reformat, rename
or "improve" adjacent code, and match the surrounding style even where you would
have done it differently. Remove the imports and helpers YOUR change orphaned;
leave pre-existing dead code alone and mention it instead. Every changed line
should trace to the request.

**Verify, do not assert.** Turn the task into something checkable before you
start — a failing test, a command with an expected output, a specific thing to
look at. Run it. Report what actually happened, including the parts that failed
or that you skipped. "It should work" is not a result.

**Say what you did not do.** If you left part of the task undone, blocked, or
deliberately out of scope, say which part and why, in plain terms, rather than
letting a summary imply it is finished.
```

That is ~30 lines. Deliberately short: every token here is spent on every turn
in every workspace, and a long appendix is one that gets skimmed by the model
and forgotten by you.

## 6. What the leaked editor prompts have, and why almost none of it transfers

I looked at the
[collected prompts](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools)
for Cursor, Windsurf, VSCode Agent, Devin, Replit and others — ~27 tools. Taking
Cursor's agent prompt as representative, it breaks down roughly:

| Portion | What it is                                                    | Transferable? |
| ------- | ------------------------------------------------------------- | ------------- |
| ~5%     | identity, model, IDE framing                                   | no            |
| ~45%    | tool schemas, calling rules, when-to-use-which-tool            | **no**        |
| ~50%    | behavioral steering: edits, communication, search thoroughness | partly        |

**The 45% is the headline finding.** Nearly half of a leaked editor prompt is
tool mechanics — how to call an edit tool, how to format a diff marker, which
search to reach for first. pi already owns all of that, and pique deliberately
does not touch it. Copying it in would duplicate pi's preamble, conflict with it
the moment pi changes, and cost tokens on every turn to do so.

Of the behavioral half, the recurring patterns across tools are:

- **Leave the code runnable.** Imports, dependencies and wiring included, not
  left as an exercise. — *Reasonable, but it is a restatement of "verify"; a
  model that actually runs the check catches this without being told.*
- **Do not print code at the user; edit the file.** — *Product-shaped. It exists
  because those tools have a diff UI to push you toward. pique has an editor
  module and a chat, and which one you want depends on what you asked for.*
- **Bias toward finding the answer rather than asking.** — *Genuinely useful and
  genuinely dangerous, and it is the one place these prompts and Karpathy's rule
  1 openly disagree. §5 takes the middle: do the independent work first, ask
  only where the answer changes the output.*
- **Cap the retry loop** (Cursor: stop after ~3 linter-fix iterations). —
  *Concrete and worth having, but it belongs to a specific toolchain. A
  workspace archetype is the right place for it, not root.*
- **Do not name your tools to the user.** — *Tone, and wrong for pique: the
  transcript already shows the tool calls, so hiding them in prose would
  contradict what is on screen.*
- **Search broad, then narrow; re-search with different wording.** — *Good, and
  already close to what pi's own preamble says. Adding it would be restating.*

**Net: nothing from the leaks makes the cut on its own.** One idea — the
independence/asking tradeoff — is folded into §5's first rule because it
sharpens something Karpathy's rule 1 leaves ambiguous. The rest is either pi's
job, a vendor's product decision, or already covered.

That is a finding, not a shortfall. The card asked whether there was something
to pull out; the answer is "much less than the volume suggests," and the reason
is that most of that volume is describing a tool surface pique does not have.

## 7. What I deliberately left out of §5

- **Anything about tools, files or commands.** pi's preamble covers it.
- **Tone and formatting rules** (bullet limits, emoji bans, response length).
  They are the first thing that feels wrong when you disagree with it, and the
  easiest thing to add yourself later.
- **Persona.** "You are an expert…" spends tokens without changing behavior in
  any way I can verify, and it is the part of a prompt most likely to age badly.
- **Anything language- or stack-specific.** That is precisely what a workspace
  `APPEND_SYSTEM.md` is for — the Swift/Go case on card `795e0c9a`. Putting Go
  advice in root would push it into the Swift workspace too, which is the exact
  failure the appendix design exists to prevent.
- **Safety or refusal language.** Not pique's layer, and a home-rolled version
  would be worse than none.

## 8. If you approve

There is no code to write. Library → Root scope → the `APPEND_SYSTEM.md` row →
Edit → paste §5 → Save. It applies to new conversations immediately and to
running ones on `/reload`.

If you would rather it were one click, that is a separate card — a "use the
recommended default" button that fills the editor without writing anything to
disk until you press Save. It was deliberately kept out of `795e0c9a`'s scope.
