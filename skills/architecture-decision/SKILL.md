---
name: architecture-decision
description: Writes an Architecture Decision Record from the codebase with context, drivers, 2 to 4 options compared on pros, cons, cost, risk and stack fit, a recommendation and consequences, saved to docs/adr in Build mode. Use when the team must choose between technologies or designs.
argument-hint: "<the decision to make, e.g. job queue: Redis or Postgres>"
metadata:
  dahl-mode: plan
  dahl-icon: landmark
---

# Architecture decision record

Decision: $ARGUMENTS

If the decision above is empty or too broad ("improve the architecture"), call `ask_user` once with 2 to 4 concrete decisions drawn from the conversation or the codebase, then continue.

## When to use
- "Should we use X or Y?", "write an ADR for ...", "document why we chose ...".
- A choice with lasting impact: database, queue, auth provider, state management, monorepo, API style, hosting.

## When not to use
- Only facts are needed (versions, pricing, what changed): use `research` (call `use_skill`).
- The decision is made and the work needs planning: use `spec-to-tasks`.
- Explaining the current architecture without a decision: use `explain` or `onboard-project`.
- Writing general project docs: use `docs`.

## Mode
Works in any mode for the analysis. Saving the file needs Build mode: in Plan or Review mode, return the full ADR text in the answer and offer to save it in Build mode.

## Checklist
1. `update_plan` with: frame, context, drivers, options, facts, recommend, write.
2. Frame the decision as one question with its scope (which part of the system, which time horizon) and what forces it now (a bug, scale, a new feature, cost).
3. Context from the codebase, with file references:
   - `read_file` package.json, pyproject.toml, docker-compose.yml, deployment config (`vercel.json`, `Dockerfile`, `fly.toml`, CI workflows) for the stack and hosting.
   - `search` and `read_file` the code the decision touches (for example the current job runner, data access layer or state store) and note how it works today.
   - Existing ADRs: `list_dir` `docs/adr`, `docs/decisions`, `adr`, `doc/architecture/decisions`. Read them for format, numbering and earlier decisions this one must respect or supersede.
   - `git` `log` on the relevant paths for history.
4. Decision drivers: 3 to 6, ranked, specific to this project (for example "no new infrastructure on Vercel", "team knows Postgres", "must survive restarts", "under 20 USD per month"). Ask the user with `ask_user` only if a driver that decides the outcome is unknown (budget, scale, compliance).
5. Options: 2 to 4 realistic ones, including "keep the current approach" when it is viable. For each: how it would work here, pros, cons, cost (build effort and running cost), risk (lock-in, maturity, operational load, migration), and fit with the existing stack.
6. Current facts: if `web_search` is available, check versions, maintenance status, pricing and limits on primary sources with `web_fetch` and cite the URLs. If Web is off, mark such facts "not verified (training data)" and suggest the user turn on Web or run `research`.
7. Recommendation: pick one, tie it to the top drivers, and say under which conditions another option would win.
8. Consequences: positive, negative (what gets harder), and follow-up work (migrations, new env vars, docs), plus a "revisit when" trigger.
9. Write it. Build mode: next number = highest existing number plus one, zero-padded to 4 digits (first ADR is 0001); file `docs/adr/NNNN-kebab-case-title.md` (or the existing ADR folder). Match the existing template if there is one, otherwise use the template below. Status "Proposed" (the team accepts it). Get the date with `run_command` `Get-Date -Format yyyy-MM-dd`. If it supersedes an older ADR, add a "Superseded by" line to that ADR only if the user agrees. Update an ADR index or README if the folder has one.

Template:
```markdown
# NNNN. <Title>

- Status: Proposed
- Date: YYYY-MM-DD

## Context
## Decision drivers
## Considered options
## Comparison
| Option | Pros | Cons | Cost | Risk | Fit with stack |
## Decision
## Consequences
## Links
```

## Verify (required before saying done)
- Every option is compared on the same drivers in the table; none is a straw man.
- Every file reference in the context exists (checked with `search` or `list_dir`).
- Facts with versions or prices have a cited URL, or are marked not verified.
- In Build mode: the file was written with the next free number (checked with `list_dir`) and read back with `read_file`. No other files changed except an ADR index.
- Never present the ADR as accepted; it stays "Proposed" until the user says otherwise.

## Output
- **Decision:** the recommendation in one sentence.
- **Comparison:** the options table.
- **File:** path of the saved ADR, or the full ADR text when not saved.
- **Unverified facts and open questions:** what still needs checking or a decision from the team.

## Pitfalls
- Recommending the fashionable option without tying it to this project's drivers and code.
- Comparing options on different criteria, or only listing pros for the favourite.
- Ignoring the "keep what we have" option, or the migration cost from the current state.
- Reusing an ADR number, or renumbering existing ADRs.
- Stating prices, limits or versions from memory as if verified.
- Long, generic text: keep the ADR to what a reader needs to understand and revisit the decision.
