---
name: docs
description: Writes or updates the README and docs from the real code (setup, run, test, structure, env vars) and checks that every documented command exists and runs. Use when the user asks for a README, setup instructions or docs that match the code.
argument-hint: "<what to document, e.g. README or docs/config.md; empty for the README>"
metadata:
  dahl-mode: build
  dahl-icon: file-text
---

# Write docs from the code

Target: $ARGUMENTS

If the target is empty, update README.md at the project root (create it if missing). If it names a topic ("configuration", "deployment"), update that section or the matching file under `docs/`.

## When to use
- "Write a README", "the setup steps are out of date", "document the env vars", "add a docs page for configuration".
- After a change that adds scripts, env vars or setup steps.

## When not to use
- The user wants an explanation in chat, not a file: use `explain`.
- A guided tour of the repo for a new developer: use `onboard-project`.
- Recording why an architecture was chosen: use `architecture-decision`. Release notes and changelogs: use `release`.
- Reference docs for new endpoints you are building: write them with the endpoint (`rest-endpoint`).

## Mode
Needs Build mode (writes files and runs the documented commands). In Plan or Review mode, do steps 1 to 3, return the proposed README text in the answer with the list of commands still to check, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: read existing docs, collect facts, check commands, write, read back.
2. Read what exists: README.md, `docs/`, CONTRIBUTING.md, `.env.example`. Keep what is correct and the user's own sections (badges, license, credits). Note what is stale.
3. Collect facts from the code, not from memory:
   - Package manager from the lockfile: package-lock.json npm, pnpm-lock.yaml pnpm, yarn.lock yarn, bun.lockb bun. Python: pyproject.toml, requirements*.txt, uv.lock, poetry.lock.
   - Commands: the exact script names in package.json `scripts`, Makefile targets, pyproject `[project.scripts]`. Runtime version from `engines`, `.nvmrc`, `.python-version`, `requires-python`.
   - Environment variables: `search` with regex `process\.env\.[A-Z_]+`, `import\.meta\.env\.[A-Z_]+`, `os\.environ`, `os\.getenv\(`. For each: name, required or optional, default, where it is used. Compare with `.env.example`.
   - Ports and URLs: `listen(`, `port:` in vite.config.* or next.config.*, `--port` in scripts.
   - Structure: `list_dir` the top two levels; one line per important folder.
4. Check every command you plan to document:
   - It must exist (script name present, file present). Never document a script that is not in package.json.
   - Run the safe, finite ones with `run_command`: install (`npm ci` when a lockfile exists, `npm install` otherwise; `python -m pip install -r requirements.txt`), `npm test`, `npm run build`, `npm run lint`, `python -m pytest -q`. Record exit codes.
   - Do not run commands that never exit (`dev`, `start`, `watch`) or that touch real systems (`deploy`, `release`, `db:reset`, migrations against a real database). Confirm they exist and say they were not run.
5. Write short, factual docs. Use `edit_file` on an existing README to keep the user's content; `write_file` only for new files. README sections, in this order, only when they apply:
   - Name and one-sentence purpose.
   - Requirements (runtime versions, tools).
   - Setup (install, copy `.env.example` to `.env`).
   - Run (dev and production commands, the local URL).
   - Test (and lint or type check).
   - Configuration: table with variable, required, default, purpose.
   - Project structure: a short tree or list of key folders.
6. Secrets: never copy values from `.env`. Use placeholders (`your-api-key`). If env vars are used but `.env.example` is missing, offer to create it with placeholders (`ask_user`).
7. Commands for Windows users: when you show shell syntax, give PowerShell (`Copy-Item .env.example .env`, `$env:PORT=4000; npm start`), or a cross-platform npm script.
8. Long material (deployment, architecture) goes in `docs/<topic>.md`, linked from the README. Do not duplicate it.

## Verify (required before saying done)
- `read_file` the written files back and check the Markdown renders sensibly (closed code fences, table rows with the same column count).
- Every command in a code block maps to a script, Makefile target or file you read. List the mapping in the answer.
- Commands you ran show their exit codes. Commands you did not run (dev servers, deploy) are listed as not run.
- The env var table matches the `search` results: same names, none missing, none invented.
- Never say the docs are accurate without this evidence. State what remains unverified.

## Output
- **Files changed:** paths, and whether created or updated.
- **Commands checked:** table with command, defined in, ran, result.
- **Env vars documented:** count, and any that are used in code but missing from `.env.example`.
- **Not verified:** commands not run and why; sections you could not confirm from the code.

## Pitfalls
- Inventing commands (`npm run test:e2e`, `npm run lint`) that are not in package.json.
- Mixing package managers: `yarn` instructions in an npm project.
- Documenting what the project should do instead of what the code does.
- Copying secret values from `.env` into docs.
- Overwriting the user's README and losing the license, badges or credits.
- Long prose, marketing tone, pasted source code. Keep the README short; readers want commands.
- Chaining commands with `&&` in PowerShell instructions: use `;`.
