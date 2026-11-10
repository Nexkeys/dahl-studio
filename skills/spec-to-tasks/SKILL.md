---
name: spec-to-tasks
description: Turns a spec, feature request or issue into small, ordered tasks mapped to real files, each with acceptance criteria, a verify command and dependencies, after clarifying ambiguities. Read-only by default. Use when the user wants a feature broken down before building.
argument-hint: "<spec text, a path to a spec file, or an issue>"
metadata:
  dahl-mode: plan
  dahl-icon: list-checks
---

# Spec to tasks

Spec: $ARGUMENTS

If the spec above is empty, look for one (`search` for `spec`, `PRD`, `requirements` in `docs/` and the root); if none is found, ask the user to paste it or give a path. If it is a path, `read_file` it. If it is an issue link and `web_fetch` is available, fetch it; otherwise ask the user to paste the issue text.

## When to use
- "Break this feature down into tasks", "plan the work for this spec", "what do we need to build for X?"
- Before a multi-day feature, to agree on scope and order.

## When not to use
- The user wants one small change done now: just do it, or use `fix` for a bug (call `use_skill`).
- Choosing between architectures or technologies: use `architecture-decision`.
- Researching libraries or services first: use `research`.
- Understanding an unfamiliar codebase in general: use `onboard-project`.

## Mode
Read-only, works in any mode. Writing `docs/tasks.md` needs Build mode and is done only when the user asks for a file; in Plan or Review mode, return the list in the answer and offer to save it in Build mode.

## Checklist
1. `update_plan` with: read spec, extract requirements, clarify, map to code, write tasks, check coverage.
2. Extract requirements from the spec into a numbered list (R1, R2, ...): functional behaviour, non-functional needs (performance, security, accessibility, i18n), and what is explicitly out of scope. Quote the spec's own words.
3. List ambiguities: missing behaviour for edge cases, undefined roles or permissions, data that has no home, conflicting statements, "TBD" markers. Check the codebase first; do not ask what the code already answers.
4. Clarify: call `ask_user` with at most 4 multiple-choice questions, only for ambiguities that change the work. Put the recommended option first. Record any remaining assumptions explicitly.
5. Map each requirement to the code:
   - `list_dir` the main folders; `read_file` package.json or pyproject.toml for the stack and the test, lint and type check commands.
   - `search` for the related routes, models, components, services and tests (for example the entity name, the page title, the API path). `read_file` the main hits.
   - `git` `log` with a path to see recent work in the area.
   - For each requirement note: files to change (with paths), files to create, existing patterns to reuse, and the test file that covers it.
6. Write the tasks:
   - Small: one reviewable change each (roughly under 300 changed lines, half a day or less). Split anything bigger.
   - Prefer thin vertical slices that can be shown working (data, API and UI for one behaviour) over horizontal layers, except shared groundwork such as a migration.
   - Each task has: ID (T1, T2, ...), title starting with a verb, files, acceptance criteria (observable and testable, "Given / When / Then" or a checklist), a verify command (`npx vitest run src/invoices`, `python -m pytest tests/test_export.py -q`, or a manual check in the Preview pane), depends on (task IDs), and the requirement IDs it covers.
   - Order: unknowns and risky spikes first, then schema and data, then backend, then UI, then docs and cleanup. No task depends on a later one.
   - Where a built-in skill fits a task, name it (`db-migration`, `rest-endpoint`, `ui`, `tests`, `web-e2e-tests`, `docs`).
7. Put the tasks into `update_plan` (one step per task, the first marked in progress) so the user sees the order.
8. Only if the user asked for a file and the mode is Build: `write_file` `docs/tasks.md` (or the path they gave) with the same table and checkboxes. Keep it factual and short.

## Verify (required before answering)
- Coverage: every requirement R maps to at least one task, and every task maps to a requirement (or is marked groundwork).
- Every file path you list exists (checked with `list_dir` or `search`) or is marked "new".
- Every task has acceptance criteria and a verify command; dependencies form no cycle and point only to earlier tasks.
- No source files were changed. If `docs/tasks.md` was written, read it back.
- State the assumptions you made where the user did not answer.

## Output
- **Summary:** the feature in one or two sentences and the number of tasks.
- **Decisions and assumptions:** answers from `ask_user` and assumptions still open.
- **Tasks:** table with columns ID, Task, Files, Acceptance criteria, Verify, Depends on.
- **Coverage:** requirement to task mapping.
- **Risks and open questions:** what could change the plan.

## Pitfalls
- Tasks like "implement backend" or "add tests" with no files or criteria.
- Asking the user what a quick `search` would answer, or asking more than 4 questions.
- Inventing file paths or modules that do not exist without marking them new.
- Acceptance criteria that cannot be checked ("works well", "is fast").
- One giant task per layer ("all backend", "all UI"): it blocks review and hides progress.
- Ordering a UI task before the API or migration it depends on.
- Starting to implement in a planning skill. Keep it read-only unless the user asked for the tasks file.
