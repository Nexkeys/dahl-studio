---
name: web-e2e-tests
description: Writes Playwright end-to-end browser tests. Installs @playwright/test if missing, starts the app via webServer, uses role-based locators and no sleeps, runs headless and reports. Use when the user wants E2E, browser or user-flow tests for a web app.
argument-hint: "<user flow(s) to cover, e.g. sign up and create a project>"
metadata:
  dahl-mode: build
  dahl-icon: flask
compatibility: Needs Node.js 18+ and a web app with a dev or preview server. Installing Playwright and its Chromium browser needs network access.
---

# Browser end-to-end tests

Flows to cover: $ARGUMENTS

If no flow is named, read the routes and pages, then call `ask_user` with the 2 to 4 most important flows (for example sign in, the main create action, checkout), recommended one first.

## When to use
- "Add E2E tests for login", "test the checkout in a real browser", "catch regressions in the sign-up flow".
- A web app (React, Vue, Svelte, Next.js, plain HTML) with a dev or preview server.

## When not to use
- Unit tests of functions or components: use `tests`. HTTP API tests without a browser: use `api-tests`.
- A one-off manual check that a page works: load the Playwright connector with `use_connector` and look, no test files needed.
- Layout on phones and tablets: use `responsive-audit`. Accessibility checks: use `accessibility-audit`.
- A flaky existing E2E test: use `flaky-test`.

## Mode
Needs Build mode (installs packages, writes config and specs, runs the browser). In Plan or Review mode, do steps 1, 2 and 5, return the proposed playwright.config.ts and spec file in the answer, and ask the user to switch to Build.

## Checklist
1. `update_plan` with: inspect app, install, config, explore, write specs, run, stabilise.
2. Inspect the app:
   - package.json scripts (`dev`, `build`, `preview`, `start`) and the port: Vite 5173, Next.js 3000, Astro 4321, SvelteKit 5173, or the `--port` flag / `server.port` in the config.
   - Existing `playwright.config.*`, `e2e/` or `tests/e2e/`, `@playwright/test` in devDependencies. If the project already uses Cypress, `ask_user` whether to stay with Cypress (same principles apply) or add Playwright.
   - Read the pages for the flow to learn labels, button text and headings.
3. Install only if missing (each command is approved):
   `npm i -D @playwright/test` then `npx playwright install chromium` (set `timeout_seconds` to 600). Do not use `npm init playwright@latest`; it is interactive.
4. Config: create `playwright.config.ts` (use the real port and dev script):
   ```ts
   import { defineConfig, devices } from '@playwright/test'

   export default defineConfig({
     testDir: './e2e',
     fullyParallel: true,
     forbidOnly: !!process.env.CI,
     reporter: [['list'], ['html', { open: 'never' }]],
     use: {
       baseURL: 'http://localhost:5173',
       trace: 'retain-on-failure',
       screenshot: 'only-on-failure',
     },
     projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
     webServer: {
       command: 'npm run dev',
       url: 'http://localhost:5173',
       reuseExistingServer: !process.env.CI,
       timeout: 120_000,
     },
   })
   ```
   Add `"test:e2e": "playwright test"` to package.json scripts and `test-results/` and `playwright-report/` to .gitignore.
5. Explore before writing (recommended): `use_connector` with "Playwright" to open the running app, walk the flow, and read the accessible names of buttons, fields and headings from its snapshot. Otherwise take them from the component code.
6. Write specs in `e2e/<flow>.spec.ts`:
   - Locators by role and label: `page.getByRole('button', { name: 'Sign in' })`, `page.getByLabel('Email')`, `page.getByRole('link', { name: 'Settings' })`. `getByText` for static text, `getByTestId` only when nothing accessible exists.
   - Web-first assertions that wait: `await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()`, `await expect(page).toHaveURL(/\/dashboard/)`, `toHaveText`, `toHaveCount`.
   - No `page.waitForTimeout`, no fixed sleeps, no `{ force: true }` clicks, no CSS or XPath chains tied to layout.
   - Each test is independent: it creates its own data (unique emails such as `user-${Date.now()}@example.test`) and does not rely on another test. Use `test.beforeEach` for navigation; for many logged-in tests, a setup project that saves `storageState`.
   - Cover the main path plus one or two failure paths (validation message shown, wrong password rejected).
   - Third-party calls (payments, analytics) are mocked with `page.route('**/api.stripe.com/**', (route) => route.fulfill({ status: 200, body: '{}' }))`. Never run against production.
7. Run headless (the default): `npx playwright test --reporter=list`, or one file: `npx playwright test e2e/login.spec.ts`. On failure, read the error, then the screenshot in `test-results/` with `view_image` or `analyze_image`, and the `error-context.md` file if present.
8. Stabilise: once green, run `npx playwright test --repeat-each=3` to catch flakiness early.

## Verify (required before saying done)
- `npx playwright test` exits 0: show the passed count per spec.
- `--repeat-each=3` passes.
- The webServer URL in the config matches the port the dev server really uses.
- Never claim the tests pass without the run output. If the browser could not be installed (no network) or the app needs services you cannot start, say exactly what is unverified.

## Output
- **Flows covered:** table with spec file, test name, what it asserts.
- **Run:** command, passed, failed, exit code, and the repeat-each result.
- **Setup changes:** packages, config, scripts, .gitignore lines.
- **Not covered / unverified:** remaining flows, mocked services, anything not run.

## Pitfalls
- `waitForTimeout` and sleeps instead of web-first assertions.
- Brittle selectors: `nth-child`, generated class names, long CSS paths.
- Tests that depend on each other or on data left by a previous run.
- Wrong `baseURL` or port; missing `reuseExistingServer`, leading to "port already in use".
- Interactive commands that hang: `--ui`, `--headed` with `--debug`, `npx playwright codegen`, `npx playwright show-report`.
- Installing every browser when Chromium is enough.
- Leaving `test.only` in a spec.
- Chaining commands with `&&`: commands run in PowerShell, use `;`.
