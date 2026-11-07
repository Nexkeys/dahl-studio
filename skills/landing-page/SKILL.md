---
name: landing-page
description: Builds a fast, accessible marketing landing page in the project's stack or plain HTML and CSS, with one clear call to action, real copy, meta and Open Graph tags, responsive images and a Lighthouse check. Use when the user wants a homepage, product page or launch page.
argument-hint: "<product, audience and call to action>"
metadata:
  dahl-mode: build
  dahl-icon: layout
---

# Landing page

Brief: $ARGUMENTS

If the brief above is empty or misses the product name, the audience or the main call to action, read README.md and package.json for them first; then call `ask_user` once (max 4 questions) for what is still missing. Never invent the product, testimonials, customer logos, prices or numbers.

## When to use
- "Make a landing page / homepage / launch page for X."
- Replacing a placeholder home page with a real marketing page.

## When not to use
- A single screen or component from a mockup inside an app: use `ui` (call `use_skill`).
- Speeding up an existing page: use `web-vitals` or `bundle-size`.
- Publishing the page: use `deploy-web` after this skill.
- SEO or copy review of an existing page only: use `review`.

## Mode
Needs Build mode (writes files, runs the dev server and Lighthouse). In Plan or Review mode, gather the inputs (steps 2 and 3), return the section outline with the actual copy and the file plan, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: inputs, stack, sections and copy, build, meta and performance, preview and Lighthouse.
2. Inputs: product name, one-sentence value proposition, audience, primary CTA (label and target URL), 3 to 6 benefits, real social proof (quotes with names, logos the user owns or may use), pricing and FAQ if given, brand colours, logo and images. Reuse the user's own words for the copy.
3. Stack: `read_file` package.json and `list_dir` the root.
   - Existing app: build the page in it: Next.js App Router `app/page.tsx` (or a route group such as `app/(marketing)/page.tsx`), Astro `src/pages/index.astro`, SvelteKit `src/routes/+page.svelte`, Vite React `src/App.tsx` or a route. Use its styling and tokens.
   - Empty folder: default to `index.html` plus `styles.css` (no build step). Use Vite + Tailwind only when the user wants components or the site will grow: `npm create vite@latest site -- --template react-ts --no-interactive` (always pass the folder and template so it does not prompt; if it still waits for input, stop and write the files by hand), then `npm install tailwindcss @tailwindcss/vite` in that folder, add the plugin to `vite.config.ts` and `@import "tailwindcss";` to the CSS (Tailwind v4).
4. Sections, in this order, skipping any without real content:
   - Header: logo, 3 to 5 anchor links, the CTA repeated as a button.
   - Hero: one `h1` with the value proposition, a one or two sentence subhead, one primary CTA (a secondary link at most), a product image or screenshot.
   - Social proof: real quotes or logos only.
   - Features: 3 to 6 benefit-led items (benefit first, feature second), each with a short heading.
   - How it works (optional, 3 steps), Pricing (only if given; mark the recommended plan in text, not colour only), FAQ (`<details>` and `<summary>`).
   - Final CTA band, then footer (product links, legal links, contact, copyright year).
5. Build with `write_file` (keep each write under about 250 lines; use `append_file` for the rest):
   - Semantic landmarks (`header`, `nav`, `main`, `section` with headings, `footer`), one `h1`, headings in order.
   - Mobile first, fluid widths, `max-width` containers, `clamp()` for headline size.
   - CTA is an `<a href>` styled as a button when it navigates. Visible focus styles, contrast at least 4.5:1.
6. Meta: `<html lang>`, `<title>` under 60 characters, meta description of about 150 characters, canonical URL (ask if unknown), `og:title`, `og:description`, `og:image` (1200 by 630), `og:url`, `og:type`, `twitter:card` `summary_large_image`, favicon. In Next.js use `export const metadata` in the page or layout.
7. Performance:
   - Images in WebP or AVIF with `width` and `height`; the hero image is not lazy and gets `fetchpriority="high"`; images below the fold get `loading="lazy"`. Next.js: `next/image` with `priority` on the hero.
   - Fonts: system stack, or one or two woff2 files with `font-display: swap` and a preload for the main one.
   - No animation or carousel libraries for a static page; little or no JavaScript.
8. Preview: start the dev server with `run_command` (`npm run dev`; for plain HTML `npx --yes serve .`). The Preview pane opens the URL. With the Playwright connector (`use_connector` "Playwright") take screenshots at 390 and 1440 px.
9. Lighthouse against the running URL, report outside the project:
   `npx --yes lighthouse http://localhost:3000 --only-categories=performance,accessibility,best-practices,seo --output=json --output-path="$env:TEMP/lh.json" --chrome-flags="--headless=new" --quiet`
   then `node -e "const r=require(process.env.TEMP+'/lh.json');for(const[k,v]of Object.entries(r.categories))console.log(k,Math.round(v.score*100))"`.
   Fix what pulls a score under 90 (largest image, render-blocking CSS or fonts, missing alt or labels, missing meta description) and run it again. Dev servers score lower on performance than production builds; for a fair number, build and serve the production output (`npm run build`, then `npm run start` or `npx --yes serve dist`).

## Verify (required before saying done)
- The page loads in the dev server without console errors, and screenshots (or the user's look in the Preview pane) at mobile and desktop widths show no horizontal scroll.
- Lighthouse scores for all four categories, from the command output. Say whether they came from a dev or production build.
- `search` the page files for `lorem`, `ipsum`, `TODO` and placeholder brand names: none left in the final page.
- Build or type check exit 0 if the project has one.
- Never claim scores you did not measure; if Lighthouse could not run, say so and why.

## Output
- **Page:** file(s) and URL.
- **Sections:** list with the headline used in each.
- **Meta:** title, description, OG image path.
- **Lighthouse:** table with columns Category, Score, Build type.
- **Needs from you:** missing assets or facts (real OG image, testimonials, canonical domain).

## Pitfalls
- Lorem ipsum, fake testimonials, invented user counts or made-up customer logos.
- Several competing CTAs in the hero; the page needs one primary action.
- A huge unoptimised hero image or a lazy-loaded hero image (bad LCP).
- Adding a UI framework, animation library or new font family for a single static page.
- Leaving the Lighthouse JSON inside the project folder.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
