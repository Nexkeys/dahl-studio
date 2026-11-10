---
name: ui
description: Builds a polished screen or component from a design image or description. Analyses the design, maps it to the project's components and tokens, implements it and compares the running result. Use when the user shares a mockup or asks for UI with a specific look.
argument-hint: "<what to build, plus the image path or a description>"
metadata:
  dahl-mode: build
  dahl-icon: palette
---

# Build UI from a design

Design and request: $ARGUMENTS

If the request above is empty and no image is attached, call `ask_user` once: what to build (page, section, component) and whether there is a design image (path) or only a description. Then continue.

## When to use
- The user attaches or names a mockup, screenshot, sketch or design export and wants it built.
- The user describes a screen or component with a specific look ("a dark pricing card with three tiers").
- An existing screen must be restyled to match a design.

## When not to use
- A whole marketing page with copy, meta tags and Lighthouse: use `landing-page` (call `use_skill`).
- A reusable set of components with variants, tests and docs: use `component-library`.
- Checking existing layouts at many widths: use `responsive-audit`. Accessibility problems only: use `accessibility-audit`.
- The UI crashes or shows wrong data: use `fix`.

## Mode
Needs Build mode (writes files, runs the dev server). In Plan or Review mode, do steps 1 to 4, report the design analysis, the token mapping and the files you would create or change, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: analyse design, map to stack, implement, run and compare, fix differences, verify.
2. Analyse the design before writing any code:
   - Image given: `view_image` (vision models) or `analyze_image` (any model) on the path.
   - Write down: layout grid (columns, max width, gutters, alignment), spacing steps, colours as hex, typography (family, sizes, weights, line heights), radii, borders, shadows, icons, every visible text string word for word, and the states shown (hover, active, disabled, empty, error).
   - Description only: build the same list from the text, and fill gaps from the project's existing look, not from a new style.
   - This list is the checklist for the comparison in step 8. Keep it.
3. Map to the stack: `read_file` package.json (React, Vue, Svelte, Angular, plain HTML) and find the styling approach: Tailwind (`tailwind.config.*`, or `@theme` in a CSS file for Tailwind v4), CSS modules, SCSS, styled-components, plain CSS.
4. Find existing tokens and components: `search` for `--color-`, `theme.extend`, `tokens`, `colors.ts`; `list_dir` the components folder and `read_file` the Button, Card, Input and Icon components you can reuse. Map each design value to the closest existing token. Add a new token (in the token file, not inline) only when nothing is close, and say so.
5. Read one sibling component or page first and copy its conventions: file naming, export style, prop typing, class naming, where styles live.
6. Implement with `write_file` / `edit_file`:
   - Semantic HTML: `header`, `nav`, `main`, `section`, lists for lists, `button` for actions, `a` for navigation. No clickable `div`.
   - Layout with flex or grid, relative units and `max-width`; no fixed pixel widths on containers; mobile first, then the design's breakpoint.
   - The exact copy from the design. Images get `width`, `height` and a meaningful `alt` (`alt=""` when decorative).
   - Accessibility basics: a visible label for every input, visible focus styles (`:focus-visible`), text contrast at least 4.5:1, `aria-label` on icon-only buttons, hit targets around 44 px.
   - No new UI library or dependency without asking the user first.
7. Run it: find the dev script in package.json (`npm run dev`, `pnpm dev`, `npx vite`) and start it with `run_command`; the Preview pane opens the local URL it prints. Route or mount the new UI so it is visible.
8. Compare with the analysis from step 2:
   - If a "Playwright" connector is listed, `use_connector` "Playwright", then `browser_navigate` to the URL, `browser_resize` to the design's width, `browser_take_screenshot`, and compare the screenshot with your list: layout, spacing, colours, type sizes, copy, alignment, states. Also check `browser_console_messages` for errors.
   - Without Playwright, ask the user to look at the Preview pane, and compare the code against the list item by item.
9. Fix the differences with `edit_file`, then compare again. Stop after three rounds and list what still differs.

## Verify (required before saying done)
- Type check, lint and build pass if the project has them (`npx tsc --noEmit`, `npm run lint`, `npm run build`): show the exit codes.
- The page renders in the dev server with no console errors.
- A screenshot comparison against the step 2 list, with each item marked as matching or not. Also check a narrow width (375 px) for horizontal scrolling.
- Never claim the UI "matches the design" without a screenshot comparison. If no browser connector was available, say the visual match is unverified and what the user should look at in the Preview pane.

## Output
- **Built:** files created and changed, and where the UI is mounted (route or parent component).
- **Design mapping:** table of design value, token or class used, new token (yes or no).
- **Comparison:** what matches, what still differs and why.
- **Proof:** commands run with exit codes, and the screenshot widths checked.
- **Unverified:** anything you could not check.

## Pitfalls
- Writing code before analysing the image, then guessing colours and spacing.
- Inventing a new palette or font instead of using the project's tokens.
- Recreating the mockup with absolute positioning and fixed pixel sizes; it breaks at any other width.
- Placeholder text or lorem ipsum when the design shows real copy.
- Duplicating an existing Button or Card instead of reusing it.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
