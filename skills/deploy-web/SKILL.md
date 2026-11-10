---
name: deploy-web
description: Deploys a web app to Vercel, Netlify, Cloudflare Pages or GitHub Pages with the host's CLI and the user's own login. Builds for production first, checks environment variables are set on the host, deploys a preview before production and verifies the live URL. Use when the user wants a site or web app put online.
argument-hint: "<host and target, e.g. vercel preview or netlify production>"
metadata:
  dahl-mode: build
  dahl-icon: rocket
---

# Deploy a web app

Target: $ARGUMENTS

If no host is given, use the one the project is already set up for (step 2). If none is set up, call `ask_user` with Vercel, Netlify, Cloudflare Pages and GitHub Pages (recommend Vercel for Next.js, Cloudflare Pages or Netlify for Vite and other static builds, GitHub Pages for docs and simple sites already on GitHub). Without the word "production" (or "prod", "live"), deploy a preview.

## When to use
- "Deploy this", "put it online", "publish the site", "ship it to Vercel / Netlify / Cloudflare / GitHub Pages".
- Updating an existing deployment after changes.

## When not to use
- A mobile app: use `mobile-app`.
- A CI pipeline that runs tests: use `github-actions-ci` (this skill only writes the deploy workflow for GitHub Pages).
- Versioning, tags and release notes: use `release`.
- The deployed site is slow: use `web-vitals` or `bundle-size`.
- Secrets might be committed: run `secrets-scan` before deploying.
- Databases, servers, Docker or VPS hosting: out of scope here; for a Supabase backend use `supabase-backend`.

## Mode
Needs Build mode (runs builds and deploy commands). In Plan or Review mode, do steps 1 to 3, report the host, build command, output folder, required environment variable names and the exact deploy commands, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: detect, env vars, build, login, preview deploy, verify, production (if approved), verify.
2. Detect the app and host:
   - `read_file` `package.json` (framework, `build` script) and the framework config (`vite.config.*`, `next.config.*`, `astro.config.*`, `svelte.config.js`).
   - Existing host setup: `vercel.json` or `.vercel/`, `netlify.toml` or `.netlify/`, `wrangler.toml` or `wrangler.jsonc`, a Pages workflow in `.github/workflows/`.
   - Output folder: Vite and Astro `dist`, Create React App `build`, SvelteKit with adapter-static `build`, Next.js static export (`output: 'export'`) `out`. Vercel builds Next.js itself.
3. Environment variables: `read_file` `.env.example`, `search` for `import.meta.env.`, `process.env.`, `NEXT_PUBLIC_`. List the names the build and app need.
   - They belong on the host, never in git: `.env` and `.env.local` must be in `.gitignore` (add them with `edit_file` if missing).
   - See what the host has: `npx --yes vercel env ls`, `npx --yes netlify-cli env:list`, or the Cloudflare dashboard. Missing ones: ask the user to add them on the host (dashboard, or the CLI's `env add`, which they run themselves because it prompts for the value). Never put secret values in a command.
   - Variables with `VITE_` or `NEXT_PUBLIC_` are compiled into the public bundle: never use them for secrets.
4. Production build locally with `run_command`: install with the lock file's manager (`npm ci`; skip it when there are no dependencies), then `npm run build`. It must exit 0. `list_dir` the output folder to see it has `index.html` and assets.
5. Login with the user's own account. Check: `npx --yes vercel whoami`, `npx --yes netlify-cli status`, `npx --yes wrangler whoami`. Not logged in: ask the user to run the login in the terminal themselves (`npx vercel login`, `npx netlify-cli login`, `npx wrangler login`; each opens a browser). Never ask for, paste or store tokens.
6. Preview deploy:
   - Vercel: `npx --yes vercel deploy --yes` (the first run links the project with defaults; prints a preview URL).
   - Netlify: `npx --yes netlify-cli deploy --dir dist` (draft URL). Not linked yet: add `--site <site-id>`, or the user runs `npx netlify-cli link`.
   - Cloudflare Pages: first time `npx --yes wrangler pages project create <name> --production-branch main`; then `npx --yes wrangler pages deploy dist --project-name <name> --branch preview`.
   - GitHub Pages has no preview: serve the build locally instead (`npx --yes serve dist`) and check it.
7. Verify the preview (see Verify) and give the user its URL.
8. Production only when the user asked for production in this conversation, or approves it now (`ask_user` with the preview URL):
   - Vercel: `npx --yes vercel deploy --prod --yes`.
   - Netlify: `npx --yes netlify-cli deploy --prod --dir dist`.
   - Cloudflare Pages: `npx --yes wrangler pages deploy dist --project-name <name> --branch main` (the production branch).
   - GitHub Pages: write `.github/workflows/pages.yml` with `actions/checkout@v4`, `actions/setup-node@v4`, the install and build, `actions/upload-pages-artifact@v3` (path: the output folder) and `actions/deploy-pages@v4`, with `permissions: contents: read, pages: write, id-token: write`. For Vite set `base: '/<repo>/'` in `vite.config.*` (not for a custom domain or a `<user>.github.io` repository). Commit, `git_push`, ask the user to set Settings, Pages, Source to "GitHub Actions", then `github` `ci_status`.
9. Single-page apps with client-side routing need a fallback so deep links do not 404: Netlify `public/_redirects` with `/* /index.html 200`; Vercel (non-Next) a rewrite to `/index.html` in `vercel.json`; GitHub Pages a copy of `index.html` as `404.html` in the build; Cloudflare Pages serves `index.html` for unknown paths when the build has no `404.html`.

## Verify (required before saying done)
- `npm run build` exit code 0.
- The deploy command exit code 0 and the URL it printed.
- The URL serves the app, with `run_command`:
  `try { $r = Invoke-WebRequest -Uri https://<url> -UseBasicParsing; $r.StatusCode; $r.Content -match '<title>My App' } catch { $_.Exception.Response.StatusCode.value__ }`
  Expect 200 and content that belongs to this app (its title or a heading). A host's error or login page can also return 200. For single-page apps, also request one deep link.
- With a browser connector (`use_connector` "Playwright"), open the URL and check the console for errors such as missing environment variables.
- Never say "deployed" or "live" without that check. State what is unverified (forms, API calls, logins not exercised).

## Output
- **Host and project:** host, project or site name, what was deployed (commit or folder).
- **URLs:** preview, and production if deployed.
- **Checks:** build exit code, deploy exit code, URL status and content match.
- **Environment variables:** names set on the host and names still missing (never values).
- **Next:** production promotion, custom domain, anything unverified.

## Pitfalls
- Deploying without a local production build: the host fails on the same error, only slower.
- Committing `.env`, or pasting secret values into commands where they land in logs.
- Vercel preview URLs behind Vercel Authentication return 401 to scripts. Say so instead of calling the deploy broken; ask the user to open it, or check production.
- Deploying the wrong folder (`build` instead of `dist`): an empty or stale site.
- GitHub Pages without the Vite `base` path: a blank page and 404s for assets.
- CLIs without `--yes` wait for input until the command times out.
- Going to production when the user only said "deploy".
