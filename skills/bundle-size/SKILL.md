---
name: bundle-size
description: Measures JavaScript bundle size, finds the largest modules and duplicates, and shrinks it with code splitting, lazy imports, lighter libraries and tree-shakeable imports, reporting raw and gzip sizes before and after. Use when the bundle is too big.
argument-hint: "<app, route or entry to analyse (default: the main web build)>"
metadata:
  dahl-mode: build
  dahl-icon: package
---

# Reduce JavaScript bundle size

Target: $ARGUMENTS

If this is empty, analyse the main production web build of the project. In a monorepo with several apps, call `ask_user` once with the app names as options.

## When to use
- "The bundle is huge", "main.js is 2 MB", "First Load JS is too high", "why does this page download so much?"
- After adding a heavy library, or when `web-vitals` points at too much JavaScript.

## When not to use
- Page load metrics in general (LCP, CLS, INP): `web-vitals`. Slow server code: `perf`.
- Removing unused files and exports from the codebase: `dead-code`.
- Upgrading a library to a newer, smaller version: `dependency-upgrade`.

## Mode
Needs Build mode (runs builds and analyzers, edits code). In Plan or Review mode, do a static pass (step 5 patterns with `search` and `read_file`), list suspects with `file:line` and the commands that would measure them, and ask the user to switch to Build. Never quote sizes you did not measure.

## Checklist
1. `update_plan` with: detect bundler, baseline, analyse, fix one at a time, re-measure, clean up.
2. Detect the bundler and output folder: vite.config.* (dist), next.config.* (.next), webpack.config.*, react-scripts (build), rollup, esbuild, parcel. `read_file` the build script.
3. Baseline from a production build:
   - `npm run build`. Vite prints each chunk with its gzip size; Next.js prints per-route size and First Load JS. Save these lines.
   - Totals for the output folder (raw and gzip of .js, .mjs and .css, source maps excluded):
     `node -e "const fs=require('fs'),p=require('path'),z=require('zlib');let r=0,g=0;const w=d=>{for(const f of fs.readdirSync(d)){const q=p.join(d,f);if(fs.statSync(q).isDirectory())w(q);else if(f.endsWith('.js')||f.endsWith('.mjs')||f.endsWith('.css')){const b=fs.readFileSync(q);r+=b.length;g+=z.gzipSync(b).length}}};w(process.argv[1]);console.log('raw KB',(r/1024).toFixed(1),'gzip KB',(g/1024).toFixed(1))" dist`
     (use `.next/static` for Next.js, `build/static` for Create React App).
   - Note the entry chunk separately: it is what every page pays for.
4. Analyse what is inside:
   - Any bundler with source maps: `npx source-map-explorer "dist/assets/*.js" --tsv` (or `--json`). For Vite, build with maps for the analysis only: `npx vite build --sourcemap`.
   - Vite visual treemap: `npx vite-bundle-visualizer` (writes an HTML report; open it in the Preview pane), or `rollup-plugin-visualizer` in vite.config with `template: 'list'` or `'raw-data'` and `open: false` for text output.
   - Next.js: `@next/bundle-analyzer` wrapped around next.config, then `$env:ANALYZE='true'; npm run build`.
   - webpack: `npx webpack --profile --json > stats.json`, then `npx webpack-bundle-analyzer stats.json dist -m static -r "$env:TEMP/report.html" -O`.
   - Duplicates: `npm find-dupes`, `npm ls <pkg>` for packages that appear twice (two versions of lodash, date libraries, React copies).
5. Find the causes (largest first):
   - Whole-library imports: `import _ from 'lodash'`, `import * as Icons from '...'`, `import moment from 'moment'` with all locales, `import { x } from 'big-lib'` where the library is not tree-shakeable (CommonJS).
   - Heavy code in the entry chunk that only some routes or actions need: charts, editors, PDF, maps, syntax highlighting, admin pages.
   - Barrel files (`index.ts` re-exporting everything) that pull whole folders in.
   - Large inlined JSON or data, base64 images in JS, polyfills for browsers you do not support, dev-only code shipped (`NODE_ENV` not set to production).
6. Fix one cause at a time, `read_file` before every `edit_file`:
   - Route-level splitting: `const Admin = lazy(() => import('./pages/Admin'))` with `<Suspense>`; Next.js `dynamic(() => import('./Chart'), { ssr: false })` for client-only widgets; Vue `defineAsyncComponent`.
   - Load on interaction: `const { jsPDF } = await import('jspdf')` inside the click handler.
   - Tree-shakeable imports: `import debounce from 'lodash/debounce'` or `lodash-es`, named icon imports from the per-icon entry, named `date-fns` imports.
   - Lighter alternatives: moment -> date-fns or dayjs, lodash helpers -> native code, a full chart library -> a smaller one. Swapping a library that is used in many files changes behaviour: ask with `ask_user` first.
   - Dedupe: align versions in package.json, then `npm dedupe`.
   - `manualChunks` or vendor splitting improves caching but does not reduce total size; do not report it as a reduction.
7. After each fix: rebuild, re-measure with the same commands, run tests and the type check. Keep the fix only if the numbers drop.
8. Check that lazy chunks still load: open the built app in the Preview pane (`vite preview` or `next start`) or with the Playwright connector (`use_connector` "Playwright") and visit the split routes; a missing `Suspense` or a wrong import path only fails at runtime.
9. Clean up: remove temporary analyzer plugins, `ANALYZE` wrappers, source map settings and report files you added, unless the user wants to keep them.

## Verify (required before saying done)
- Before and after sizes, raw and gzip, for the total and the entry chunk, from the same build command.
- `npm run build` and the tests exit 0 after the changes.
- Lazy-loaded routes or components were opened in a browser and rendered, or they are listed as unverified.
- Never claim a saving without measured numbers; estimates for ideas you did not apply are labelled "estimate".

## Output
- **Results:**

| Bundle | Raw before | Gzip before | Raw after | Gzip after | Change |
|---|---|---|---|---|---|
| Entry chunk | | | | | |
| Total JS and CSS | | | | | |

- **Largest contributors (before):** top 10 modules with sizes.
- **Changes:** `file:line`, what changed, measured saving.
- **Not done:** remaining ideas with estimated savings and risks.

## Pitfalls
- Measuring a dev build, or comparing builds with different modes or flags.
- Reporting raw size only; users download gzip or brotli.
- Presenting `manualChunks` vendor splitting as a size reduction.
- Lazy-loading something needed for the first paint (hurts LCP and causes layout shift).
- Swapping libraries with different parsing or formatting behaviour (moment vs dayjs) without tests.
- Leaving analyzer plugins or production source maps enabled after the analysis.
