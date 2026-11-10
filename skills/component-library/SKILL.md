---
name: component-library
description: Creates or extends reusable React, Vue or Svelte components that follow the project's tokens and conventions, with consistent props, variants, keyboard and ARIA support, tests and an index export. Use when the user wants shared components or repeated UI made reusable.
argument-hint: "<components to create or extend>"
metadata:
  dahl-mode: build
  dahl-icon: layers
---

# Component library

Components: $ARGUMENTS

If the request above is empty, inventory the project (step 2), then call `ask_user` once with the 2 to 4 most useful components to add or consolidate (for example the ones copy-pasted most often).

## When to use
- "Create a Button / Input / Select / Modal / Tabs component we can reuse."
- The same markup is copy-pasted across pages and should become one component.
- Adding variants or sizes to existing shared components.

## When not to use
- One screen or section from a mockup: use `ui` (call `use_skill`).
- Restructuring code without new components: use `refactor`.
- Auditing existing components for WCAG: use `accessibility-audit`.
- Only adding tests to existing components: use `tests`.

## Mode
Needs Build mode (writes files, runs type check and tests). In Plan or Review mode, do steps 2 to 4 and report the inventory, the proposed API (props, variants, keyboard behaviour) and the file list, then ask the user to switch to Build.

## Checklist
1. `update_plan` with: inventory, API design, implement, tests, exports and docs, verify.
2. Inventory before writing:
   - `list_dir` the component folders (`src/components`, `components/ui`, `packages/ui`, `src/lib/components`); `read_file` 2 or 3 existing components fully.
   - Tokens: `search` for `--color-`, `--space-`, `theme.extend`, `@theme` (Tailwind v4), `tokens.ts`.
   - Helpers and libraries already used: `clsx`, `tailwind-merge`, `class-variance-authority` (cva), Radix, Headless UI, Bits UI, Reka UI, styled-components, CSS modules.
   - Tests: vitest or jest with `@testing-library/react`, `@testing-library/vue` or `@vue/test-utils`, `@testing-library/svelte`. Storybook: a `.storybook/` folder or a `storybook` script.
   - Copies to consolidate: `search` for repeated class strings or markup (for example `className="btn` or `role="dialog"`).
3. Design the API once for the whole set, matching existing conventions:
   - Same prop names everywhere: `variant`, `size`, `disabled`, `className` (or `class`), `children`; event props named like the framework (`onClick`, `onValueChange` / `update:modelValue`).
   - React: extend the native element props (`React.ComponentPropsWithoutRef<'button'>`), spread the rest onto the element, merge `className`, pass `ref` (a regular prop in React 19; `forwardRef` in React 18).
   - Vue 3: `<script setup lang="ts">`, typed `defineProps`, `defineEmits`, `defineModel` for v-model (Vue 3.4+), attribute fallthrough on the root element.
   - Svelte 5: `let { variant = 'primary', children, ...rest } = $props()`, snippets for slots, spread `rest`.
   - Variants map to tokens, not hardcoded colours. Support controlled and uncontrolled use where state exists (`value` plus `defaultValue`).
   - If the API choice is genuinely the user's (a headless library or not, naming), call `ask_user`.
4. Accessible by default:
   - Use the native element (`button`, `input`, `select`, `dialog`) when one exists; default `type="button"` on buttons.
   - Inputs render a label or require `aria-label`; errors are linked with `aria-describedby`.
   - Composite widgets follow the WAI-ARIA Authoring Practices: Tabs (arrow keys, roving `tabindex`, `role="tablist"`/`tab`/`tabpanel`, `aria-selected`), Dialog (focus moves in and is trapped, Escape closes, focus returns to the trigger, `aria-modal`, labelled by its title), Menu, Combobox. If the project already uses Radix, Headless UI or similar, build on it instead.
   - Visible `:focus-visible` styles, disabled state not by colour only.
5. Implement one component at a time with `write_file`, following the existing layout, for example:
   - `src/components/Button/Button.tsx`, `Button.test.tsx`, `index.ts`, and `Button.stories.tsx` only when Storybook is already set up or the user asked for it.
   - Keep each file focused; no business logic or data fetching in library components.
6. Tests next to each component, through the public API and accessible queries:
   - Renders with defaults; each variant and size produces the expected class or attribute; `disabled` blocks clicks; keyboard interaction for composite widgets; `getByRole('button', { name: 'Save' })` finds it.
7. Exports: add each component to the barrel file (`src/components/index.ts` or the package entry) with named exports and exported prop types.
8. Docs per component: JSDoc on the props type plus one short usage example (in the stories, an MDX page, or a short section in the components README if one exists). Keep it factual and brief.
9. Replace the copies found in step 2 only if the user asked for consolidation; otherwise list them.
10. Render each component in the dev server (an existing page, or a temporary demo route you remove afterwards) with `run_command` (`npm run dev`); with the Playwright connector (`use_connector` "Playwright") take a screenshot of the variants.

## Verify (required before saying done)
- Type check exit 0: `npx tsc --noEmit` (React), `npx vue-tsc --noEmit` (Vue), `npx svelte-check` (Svelte).
- Component tests pass: `npx vitest run src/components` or `npx jest src/components`, with pass counts.
- Lint exit 0 if configured (`npm run lint`).
- The components render in the dev server (screenshot or the user's confirmation in the Preview pane). If rendering was not checked, say so.
- Never say done without this evidence; list anything unverified.

## Output
- **Components:** table with columns Component, Files, Props and variants, Keyboard and ARIA behaviour.
- **Conventions followed:** tokens, helpers and patterns reused from the inventory.
- **Exports:** the barrel file and what it exports.
- **Proof:** type check, test counts, lint, render check.
- **Not done:** copies not yet replaced, components deferred.

## Pitfalls
- Skipping the inventory and creating a second Button next to the existing one.
- Inconsistent APIs (`kind` on one component, `variant` on the next; `isDisabled` vs `disabled`).
- Not spreading rest props or forwarding refs, so consumers cannot add `id`, `aria-*` or focus the element.
- Hardcoded colours in variants instead of tokens.
- Adding Storybook, a new styling library or a headless UI dependency without asking.
- Modal without focus trap and focus return; Tabs without arrow-key support.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
