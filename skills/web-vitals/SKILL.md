---
name: web-vitals
description: Measures Core Web Vitals (LCP, INP, CLS, TTFB, FCP) with Lighthouse on a local production build, fixes top causes like late or unsized images, render-blocking resources and long tasks, and re-measures. Use when pages load slowly or for Lighthouse questions.
argument-hint: "<page URL or route to measure (default: the home page)>"
metadata:
  dahl-mode: build
  dahl-icon: gauge
---

# Measure and improve Core Web Vitals

Page: $ARGUMENTS

If this is empty, measure the home page (`/`) of the production build. If the user gave a public URL, measure the same route on a local production build instead and only read field data for the public URL.

## When to use
- "The landing page is slow", "our Lighthouse score dropped", "fix our LCP / CLS / INP".
- Before a launch, to check a page against the Web Vitals thresholds.

## When not to use
- The JavaScript bundle is too large and you know it: `bundle-size` (this skill hands off to it for heavy JS).
- A slow API or backend function: `perf`. Slow database queries: `slow-queries`.
- Layout broken on phones: `responsive-audit`. Accessibility score: `accessibility-audit`.

## Mode
Needs Build mode (builds, starts a local server, runs Lighthouse, edits files). In Plan or Review mode, do a static pass (step 6 causes, found with `search` and `read_file`), list the likely issues with `file:line` and the exact measurement commands, and ask the user to switch to Build. Never present unmeasured numbers.

## Thresholds (good, at the 75th percentile)
- LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1. Supporting: FCP <= 1.8 s, TTFB <= 0.8 s.
- Lab proxy for INP: Total Blocking Time (TBT) <= 200 ms. Lighthouse navigation runs cannot measure INP; it needs field data (CrUX, PageSpeed Insights, or the `web-vitals` library's `onINP` in the app) or a scripted interaction.

## Checklist
1. `update_plan` with: production build, serve, baseline, diagnose, fix, re-measure.
2. Build and serve the production build, never the dev server. `read_file` package.json scripts to pick the commands:
   - Vite: `npm run build`, then serve with `npx vite preview --port 4173`.
   - Next.js: `npm run build`, then `npx next start -p 3000`.
   - Create React App or a static `dist`/`build` folder: `npx serve -s build -l 5000`.
   - Start the server in the background so the command returns, and keep its process id: `$p = Start-Process -FilePath npx.cmd -ArgumentList 'vite','preview','--port','4173' -WindowStyle Hidden -PassThru; $p.Id`. Wait until `Invoke-WebRequest http://localhost:4173/ -UseBasicParsing` returns 200.
3. Baseline with Lighthouse, 3 runs, same settings each time (mobile emulation is the default; keep it unless the user wants desktop, then add `--preset=desktop` to every run):
   `npx lighthouse http://localhost:4173/ --output=json --output-path="$env:TEMP/lh-before-1.json" --quiet --only-categories=performance --chrome-flags="--headless"`
   If Chrome is not found, set `$env:CHROME_PATH` to Chrome or Edge (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`) and retry.
4. Read the numbers without loading the huge JSON into context:
   `$r = Get-Content "$env:TEMP/lh-before-1.json" -Raw | ConvertFrom-Json; 'largest-contentful-paint','cumulative-layout-shift','total-blocking-time','first-contentful-paint','server-response-time' | ForEach-Object { '{0}: {1}' -f $_, $r.audits.$_.displayValue }; $r.categories.performance.score`
   Use the median of the 3 runs for each metric.
5. Diagnose from the same report: list `$r.audits.PSObject.Properties.Name` and read the audits that apply, for example `largest-contentful-paint-element`, `lcp-lazy-loaded`, `prioritize-lcp-image`, `render-blocking-resources`, `unsized-images`, `layout-shifts` or `layout-shift-elements`, `long-tasks`, `bootup-time`, `mainthread-work-breakdown`, `third-party-summary`, `unused-javascript`, `uses-responsive-images`, `modern-image-formats`, `font-display`. Newer Lighthouse versions also report insight audits (ids ending in `-insight`). Audit ids vary by version: check what exists.
6. Fix the top causes, one metric at a time, `read_file` before every `edit_file`:
   - LCP image: remove `loading="lazy"` from it, add `fetchpriority="high"`, preload it, serve a right-sized AVIF or WebP with `srcset` and `sizes`; Next.js `<Image priority>`.
   - LCP text or late first paint: render-blocking CSS or scripts in `<head>` (add `defer` or `async`, move third-party scripts later), web fonts (`font-display: swap`, preload the main font, self-host), slow TTFB (server work, missing caching).
   - CLS: `width` and `height` or `aspect-ratio` on images, video and iframes; reserved space for banners, embeds and ads; no content inserted above existing content after load; font fallback metrics (`size-adjust`); animate `transform` and `opacity` only.
   - TBT and INP: split long tasks, defer non-critical third-party scripts, lazy-load heavy components below the fold, reduce hydration work, debounce input handlers, yield in long loops (`await new Promise(r => setTimeout(r))` or `scheduler.yield()` where supported), move heavy work to a Web Worker. Large JS payloads: hand off with `use_skill` `bundle-size`.
7. Rebuild, restart the server, re-run Lighthouse 3 times with the same URL and flags, and compare medians. Keep only changes that help; run the project's tests after the edits.
8. Stop the server: `Stop-Process -Id <id>`. Leave the Lighthouse reports in `$env:TEMP`, not in the repository.

## Verify (required before saying done)
- A before and after table from Lighthouse runs with identical settings (URL, form factor, runs, production build), medians stated.
- Build and tests pass after the changes (command and exit code).
- Never claim a metric improved without these numbers. INP is unverified unless field data or a scripted interaction measured it; say so and give TBT as the lab proxy.
- Lab results on this machine are not field results on real devices; say that too.

## Output
- **Setup:** URL, build and serve commands, Lighthouse version, form factor and throttling, number of runs.
- **Results:**

| Metric | Good threshold | Before (median) | After (median) | Status |
|---|---|---|---|---|
| LCP | <= 2.5 s | | | |
| CLS | <= 0.1 | | | |
| TBT (INP proxy) | <= 200 ms | | | |
| FCP | <= 1.8 s | | | |
| TTFB | <= 0.8 s | | | |

- **Changes:** `file:line`, what changed, which metric it targets.
- **Remaining opportunities:** ranked, with the audit that reported them.

## Pitfalls
- Measuring the dev server: unminified code and HMR make every number meaningless.
- Comparing single runs, or a mobile run with a desktop run.
- Lazy-loading the LCP image, which delays it.
- Reporting INP from a Lighthouse navigation run.
- Leaving the preview server running, so the next run hits a port conflict.
- Committing Lighthouse JSON reports into the repository.
