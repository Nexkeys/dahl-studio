---
name: responsive-audit
description: Checks a web UI at 360 to 1440 px widths for horizontal overflow, clipped text, small tap targets and fixed widths, fixes them with fluid layouts and re-checks. Use when a page breaks or scrolls sideways on phones or tablets, or before shipping a layout.
argument-hint: "<page, route or URL to check>"
metadata:
  dahl-mode: build
  dahl-icon: smartphone
---

# Responsive audit

Target: $ARGUMENTS

If the target above is empty, audit the main routes: find them in the router (`app/`, `pages/`, `src/routes/`, router config) and check the home page plus up to three key pages. Say which ones you picked.

## When to use
- "It scrolls sideways on my phone", "the menu overlaps on tablet", "check this on mobile".
- Before shipping a new page or layout.

## When not to use
- Building a new screen from a design: use `ui` (call `use_skill`).
- Keyboard, screen reader or contrast problems: use `accessibility-audit`.
- Slow loading or layout shift scores: use `web-vitals`.
- Native mobile apps (React Native, Flutter): use `mobile-app`.

## Mode
Needs Build mode (runs the dev server and edits styles). In Plan or Review mode, do the static checks in step 2, report the likely problems with `file:line`, and ask the user to switch to Build to measure and fix.

## Checklist
1. `update_plan` with: static checks, start server, measure all widths, fix, re-measure.
2. Static checks with `search` (then `read_file` each hit):
   - Viewport meta: `name="viewport"` in index.html, `app/layout.*` (Next.js adds a default unless overridden), `_document.*` or the root template. It must be `width=device-width, initial-scale=1` and must not disable zoom (`user-scalable=no`, `maximum-scale=1`).
   - Fixed widths: regex `width:\s*\d{3,}px`, `min-width:\s*\d{3,}px`, Tailwind `w-\[\d{3,}px\]`, `min-w-\[`, inline `style={{ width: 600 }}`.
   - `100vw` (includes the scrollbar, causes overflow), `white-space:\s*nowrap`, grid templates with fixed columns (`repeat\(\d+,\s*\d+px\)`).
   - Images and media without `max-width: 100%`, tables and code blocks without an `overflow-x: auto` wrapper.
   - Input font sizes below 16px (iOS zooms the page on focus).
3. Start the dev server with `run_command` (`npm run dev` or the project's script); note the URL. The Preview pane can open it.
4. Measure every width: 360, 390, 768, 1024, 1280, 1440 (height 800).
   - With the Playwright connector: `use_connector` "Playwright", `browser_navigate` to the URL, then for each width `browser_resize`, `browser_take_screenshot` (full page) and `browser_evaluate` with this function:
     ```js
     () => {
       const d = document.documentElement, w = d.clientWidth;
       const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
         (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
       const wide = [...document.body.querySelectorAll('*')]
         .filter((el) => el.getBoundingClientRect().right > w + 1).slice(0, 10).map(label);
       const small = [...document.querySelectorAll('a, button, input, select, textarea, [role="button"]')]
         .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); })
         .slice(0, 10).map(label);
       return { width: w, scrollWidth: d.scrollWidth, overflow: d.scrollWidth > w, wide, small };
     }
     ```
   - Without the connector, in Build mode: `npx --yes playwright screenshot --viewport-size "360, 800" --full-page http://localhost:5173 shots/360.png` per width (run `npx --yes playwright install chromium` once if it asks for a browser), then `view_image` or `analyze_image` each PNG. Put the shots folder outside the source tree or delete it afterwards. If neither works, use the Preview pane and ask the user to confirm what they see.
5. Look at each screenshot for: horizontal scrollbar, text clipped or overlapping, buttons pushed off screen, navigation unusable, images stretched, sticky headers covering content, modals taller than the screen.
6. Record a row per width: overflow (yes or no, scrollWidth vs width), offending elements, small targets, visual issues.
7. Fix at the cause, following the project's conventions (Tailwind `sm:`/`md:`/`lg:` prefixes, or the breakpoints already used in its media queries):
   - Fixed widths become `max-width` plus `width: 100%`; grids use `repeat(auto-fit, minmax(min(100%, 16rem), 1fr))`.
   - Flex rows get `flex-wrap: wrap`; flex and grid children that hold long text get `min-width: 0`.
   - `img, video { max-width: 100%; height: auto; }`; wide tables and code go in a wrapper with `overflow-x: auto`.
   - Long words and URLs: `overflow-wrap: anywhere`. Fluid type with `clamp()`.
   - Tap targets: padding to reach about 44 by 44 px (WCAG 2.5.8 minimum is 24 px; inline text links are exempt).
   - Add or correct the viewport meta.
   - Do not hide content on mobile to dodge a layout bug, and do not use `overflow-x: hidden` on `body` to mask overflow.
8. Re-run step 4 at the same six widths.

## Verify (required before saying done)
- At all six widths, `scrollWidth` is not greater than the viewport width (show the numbers before and after).
- Screenshots at each width were inspected after the fix.
- Build or type check still passes if the project has one (`npm run build`, `npx tsc --noEmit`), with exit code.
- Never say "responsive" or "fixed" without the measurements. If you could only review code, say the layout is unmeasured.

## Output
- **Pages checked:** routes and URL.
- **Results:** table with columns Width, Overflow before, Overflow after, Issues found, Fixed.
- **Changes:** files and what changed (`file:line`).
- **Remaining:** small targets or issues left, and why.
- **Proof:** how it was measured (connector or CLI), commands and exit codes.

## Pitfalls
- Checking only 375 px: tablets (768, 1024) break differently.
- `overflow-x: hidden` on `body` or `html`: hides the symptom and breaks `position: sticky`.
- Using `100vw` for full-width sections: it includes the scrollbar on Windows and causes overflow.
- Flex children without `min-width: 0`: long text forces the row wider than the screen.
- Adding new breakpoint values instead of using the project's existing ones.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
