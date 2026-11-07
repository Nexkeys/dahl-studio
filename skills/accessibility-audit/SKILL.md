---
name: accessibility-audit
description: Audits a web UI against WCAG 2.2 AA with axe plus manual keyboard, focus, label, contrast and ARIA checks, fixes the issues and re-runs axe to zero serious violations. Use when the user asks for an accessibility or WCAG check, or reports a keyboard or screen reader problem.
argument-hint: "<page, URL or component to audit>"
metadata:
  dahl-mode: build
  dahl-icon: accessibility
---

# Accessibility audit (WCAG 2.2 AA)

Target: $ARGUMENTS

If the target above is empty, audit the home page and the most important form (sign-up, login or checkout). Say which ones you picked.

## When to use
- "Is this accessible?", "check WCAG", "make this work with a keyboard / screen reader".
- Before launch, or after a design change to forms, navigation or dialogs.

## When not to use
- Layout breaking at small widths: use `responsive-audit` (call `use_skill`).
- Building a new UI from a design: use `ui` (it covers accessibility basics while building).
- Performance or Core Web Vitals: use `web-vitals`.
- A general security or code review: use `review` or `security`.

## Mode
Needs Build mode (runs axe and the dev server, edits files). In Plan or Review mode, do the static review of steps 2 and 5 by reading the code, report findings in the output table, and ask the user to switch to Build to run axe and apply fixes.

## Checklist
1. `update_plan` with: scope, automated pass, manual checks, fix, re-run, report.
2. Scope and stack: `read_file` package.json; list the pages or components in scope; note the framework and any UI library (Radix, Headless UI, MUI already handle many patterns).
3. Start the dev server with `run_command` (`npm run dev`) and note the URL. For static HTML, any local server works (`npx --yes serve .`).
4. Automated pass (record counts by impact: critical, serious, moderate, minor):
   - Playwright connector available: `use_connector` "Playwright", `browser_navigate` to the URL, then `browser_evaluate` with:
     ```js
     async () => {
       if (!window.axe) await new Promise((ok, fail) => { const s = document.createElement('script');
         s.src = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
       const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] });
       return r.violations.map((v) => ({ id: v.id, impact: v.impact, tags: v.tags.filter((t) => t.startsWith('wcag')), count: v.nodes.length, first: v.nodes[0].target }));
     }
     ```
   - Otherwise the CLI: `npx --yes @axe-core/cli http://localhost:5173 --tags wcag2a,wcag2aa,wcag21aa,wcag22aa --exit`. If it fails on a ChromeDriver version mismatch, run `npx --yes browser-driver-manager install chrome` and retry.
   - React or JSX projects: if `eslint-plugin-jsx-a11y` is already configured, run `npx eslint src`. If it is not installed, suggest adding it; do not add dependencies without asking.
5. Manual checks (automated tools find only part of the issues). Use `read_file` on the components and, with Playwright, `browser_press_key` "Tab" plus `browser_snapshot` to follow focus:
   - Keyboard (2.1.1, 2.1.2, 2.4.3): every control reachable and usable with Tab, Enter, Space, Escape, arrows; order matches the visual order; no traps; dialogs move focus in, trap it, close on Escape and return focus.
   - Focus visible (2.4.7, 2.4.11): `search` for `outline:\s*(none|0)` without a `:focus-visible` replacement; sticky headers must not cover the focused element.
   - Names and labels (1.3.1, 3.3.2, 4.1.2): every input has a `<label>` or `aria-labelledby`; icon-only buttons have `aria-label`; link text makes sense alone (no "click here").
   - Images (1.1.1): meaningful `alt`; decorative images `alt=""`; SVG icons `aria-hidden="true"` when a text label exists.
   - Structure (1.3.1, 2.4.6, 2.4.1): one `h1`, no skipped heading levels, landmarks (`header`, `nav`, `main`, `footer`), a skip link on pages with long navigation, `lang` on `<html>`.
   - Contrast (1.4.3, 1.4.11): 4.5:1 for body text, 3:1 for large text (24 px, or 18.66 px bold) and for UI component borders and focus indicators. Check the actual token values.
   - ARIA misuse (4.1.2): `div` or `span` with `onClick` and no role, `tabindex` and key handler (use `button`); `aria-hidden` on focusable elements; roles that duplicate native semantics; `aria-label` on non-interactive `div`s.
   - Motion (2.2.2): auto-playing or moving content longer than 5 seconds can be paused; large animations respect `prefers-reduced-motion` (2.3.3 is AAA, but cheap to honour).
   - Forms (3.3.1, 3.3.7, 3.3.8): errors in text (not colour only) and linked with `aria-describedby`; no re-entering the same data; login allows paste and password managers.
   - Target size (2.5.8): at least 24 by 24 px or enough spacing.
   For more criteria and quick fixes, read `references/wcag-map.md` with `read_skill_file`.
6. Fix, native HTML first: `button`, `a href`, `label for`, `fieldset`/`legend`, `dialog`. Add ARIA only when no native element fits. Fix shared components once instead of each usage. Keep visual changes minimal; for contrast, change the token and say which colours changed.
7. Re-run the automated pass from step 4 and repeat the keyboard walk on what you changed.

## Verify (required before saying done)
- axe re-run shows zero critical and zero serious violations: show the counts before and after.
- `npx eslint src` exit 0 if jsx-a11y is configured; build or type check still passes.
- The keyboard walk on changed parts is described (what you tabbed through and what happened).
- Never claim "WCAG compliant": an audit can show conformance only for what was tested. State what is untested, for example screen reader testing with NVDA or Narrator, and pages outside the scope.

## Output
- **Scope:** pages or components, URL, tools used.
- **Automated:** violations before and after, by impact.
- **Findings:** table with columns Issue, WCAG criterion (number and name), Level, Where (`file:line`), Status (fixed or open).
- **Changes:** what changed and why.
- **Not tested:** what needs a human or assistive technology.

## Pitfalls
- Treating a clean axe run as "accessible": keyboard, focus order and meaningful text need manual checks.
- Adding `role="button"` to a `div` instead of using `<button>`.
- Removing focus outlines for looks, or adding `aria-label` that contradicts the visible label (2.5.3).
- Writing alt text like "image of" or repeating the adjacent caption.
- Fixing one page's copy of a component instead of the shared component.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
