#!/usr/bin/env node
// Skill evaluation harness.
//   node scripts/skill-evals.mjs validate
//       Loads every skill in skills/ and checks its frontmatter, required sections and evals.json (no model, no network).
//   node scripts/skill-evals.mjs --model <model id> [--skill fix,tests] [--base-url <url>] [--allow-commands] [--web] [--out <file>]
//       Runs each skill's evals.json tasks with the real agent loop against an OpenAI-compatible endpoint
//       (default: the Dahl API) and grades them. The key comes from DAHL_EVAL_KEY or DAHL_API_KEY, never from
//       the command line. A "dahl:" style provider prefix on the model id is removed. Commands the model runs are
//       declined unless --allow-commands is given (they would run on this PC, inside a temp folder).
import { spawn } from 'node:child_process'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const opt = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const vitest = (files, env) =>
  new Promise((resolve) => {
    const p = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vitest', 'run', ...files], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } })
    p.on('exit', (code) => resolve(code ?? 1))
  })

if (argv[0] === 'validate' || !argv.length) {
  process.exit(await vitest(['tests/builtinSkills.test.ts'], {}))
}

const model = opt('model')
if (!model) {
  console.error('Usage: node scripts/skill-evals.mjs --model <model id> [--skill a,b] [--base-url url] [--allow-commands] [--web] [--out file]')
  process.exit(2)
}
if (!process.env.DAHL_EVAL_KEY && !process.env.DAHL_API_KEY) {
  console.error('Set DAHL_EVAL_KEY (or DAHL_API_KEY) to an API key for the endpoint first.')
  process.exit(2)
}
const env = {
  DAHL_EVAL_MODEL: model.replace(/^(dahl|openai|gemini|nvidia):/, ''),
  ...(opt('skill') ? { DAHL_EVAL_SKILL: opt('skill') } : {}),
  ...(opt('base-url') ? { DAHL_EVAL_BASE_URL: opt('base-url') } : {}),
  ...(opt('out') ? { DAHL_EVAL_OUT: opt('out') } : {}),
  DAHL_EVAL_COMMANDS: flag('allow-commands') ? '1' : '0',
  DAHL_EVAL_WEB: flag('web') ? '1' : '0'
}
console.log(`Running skill evals with ${env.DAHL_EVAL_MODEL}${env.DAHL_EVAL_SKILL ? ` (skills: ${env.DAHL_EVAL_SKILL})` : ''}; commands ${env.DAHL_EVAL_COMMANDS === '1' ? 'allowed' : 'declined'}, web ${env.DAHL_EVAL_WEB === '1' ? 'on' : 'off'}.`)
process.exit(await vitest(['tests/skillEvals.live.test.ts'], env))
