// HTML test pages for the OCR evaluation set (rendered to PNG by render.cjs). Each page is plain HTML with no
// external resources; the ground truth is the page's visible text (innerText), so every word on screen is counted.
const base = (body, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--bg:#ffffff;--fg:#1f2328;--muted:#656d76;--card:#f6f8fa;--line:#d0d7de;--accent:#0969da;--btn:#1f883d;--btnfg:#ffffff}
html.dark{--bg:#0d1117;--fg:#e6edf3;--muted:#8d96a0;--card:#161b22;--line:#30363d;--accent:#4493f8;--btn:#238636;--btnfg:#ffffff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:"Segoe UI",Arial,sans-serif;font-size:15px}
.btn{display:inline-block;background:var(--btn);color:var(--btnfg);padding:8px 16px;border-radius:6px;font-weight:600}
.input{border:1px solid var(--line);border-radius:6px;padding:8px 10px;color:var(--muted);background:var(--bg)}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px}
${extra}</style></head><body>${body}</body></html>`

const login = base(`<div style="width:360px;margin:60px auto">
<h1 style="font-size:26px;font-weight:400;text-align:center">Sign in to Northwind</h1>
<div class="card"><div style="margin-bottom:6px">Username or email address</div><div class="input">jane.doe@example.com</div>
<div style="margin:14px 0 6px;display:flex;justify-content:space-between"><span>Password</span><span style="color:var(--accent)">Forgot password?</span></div>
<div class="input">Enter your password</div><div class="btn" style="display:block;text-align:center;margin-top:16px">Sign in</div></div>
<p style="text-align:center">New to Northwind? <span style="color:var(--accent)">Create an account</span></p></div>`)

const dashboard = base(`<div style="display:flex;min-height:560px"><div style="width:190px;background:var(--card);border-right:1px solid var(--line);padding:18px">
<div style="font-weight:700;font-size:18px;margin-bottom:18px">Acme Analytics</div><div>Overview</div><div style="margin-top:10px">Revenue</div>
<div style="margin-top:10px">Customers</div><div style="margin-top:10px">Invoices</div><div style="margin-top:10px">Settings</div></div>
<div style="flex:1;padding:24px"><h2 style="margin:0 0 16px">Overview for March 2026</h2><div style="display:flex;gap:14px">
<div class="card" style="flex:1"><div class="muted">Monthly revenue</div><div style="font-size:28px;font-weight:700">$48,213</div><div style="color:#1a7f37">+12.4% vs February</div></div>
<div class="card" style="flex:1"><div class="muted">Active customers</div><div style="font-size:28px;font-weight:700">1,284</div><div style="color:#cf222e">-3 since last week</div></div>
<div class="card" style="flex:1"><div class="muted">Open invoices</div><div style="font-size:28px;font-weight:700">37</div><div class="muted">9 overdue</div></div></div>
<h3>Recent activity</h3><div>Invoice INV-2041 was paid by Globex Corporation</div><div style="margin-top:6px">Initech upgraded to the Business plan</div>
<div style="margin-top:6px">Refund of $120.00 issued to Umbrella Ltd</div></div></div>`)

const article = base(`<div style="width:900px;margin:30px auto"><h1 style="font-size:30px">Why local-first software matters</h1>
<div class="muted" style="margin-bottom:16px">By Morgan Lee, 6 min read</div><div style="column-count:2;column-gap:40px;line-height:1.5">
<p>Local-first applications keep the primary copy of your data on your own device. The network becomes an optional extra rather than a requirement for every action.</p>
<p>This changes how fast an application feels. Opening a document, searching and editing all happen without a round trip to a distant server.</p>
<p>It also changes who controls the data. Files stay readable after a company shuts down, and backups are ordinary folders that any tool can copy.</p>
<p>Sync is still possible. Modern techniques merge changes from several devices without conflicts, so collaboration keeps working.</p></div></div>`)

const table = base(`<div style="padding:28px"><h2 style="margin-top:0">Quarterly sales by region</h2><table style="border-collapse:collapse;width:760px">
<tr style="background:var(--card)"><th style="text-align:left;padding:8px;border:1px solid var(--line)">Region</th><th style="padding:8px;border:1px solid var(--line)">Q1</th><th style="padding:8px;border:1px solid var(--line)">Q2</th><th style="padding:8px;border:1px solid var(--line)">Q3</th><th style="padding:8px;border:1px solid var(--line)">Total</th></tr>
${[['North America', '12,400', '13,950', '15,020', '41,370'], ['Europe', '9,870', '10,240', '11,805', '31,915'], ['Asia Pacific', '7,315', '8,060', '9,940', '25,315'], ['Latin America', '2,980', '3,410', '3,775', '10,165'], ['Middle East', '1,645', '1,820', '2,090', '5,555']]
  .map((r) => `<tr>${r.map((c, i) => `<td style="padding:8px;border:1px solid var(--line);text-align:${i ? 'right' : 'left'}">${c}</td>`).join('')}</tr>`).join('')}
</table><p class="muted">Figures in thousands of US dollars. Updated 2 April 2026.</p></div>`)

const settings = base(`<div style="width:720px;margin:30px auto"><h2>Notification settings</h2>
${[['Email notifications', 'Receive a summary of activity in your projects every morning.'], ['Security alerts', 'Get notified when a new device signs in to your account.'], ['Product updates', 'Occasional news about new features and improvements.'], ['Weekly report', 'A short report with usage statistics, sent every Monday.']]
  .map(([t, d], i) => `<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding:12px 0"><div><div style="font-weight:600">${t}</div><div class="muted" style="font-size:13px">${d}</div></div><div style="width:40px;height:22px;border-radius:11px;background:${i % 2 ? 'var(--line)' : 'var(--accent)'}"></div></div>`).join('')}
<div style="margin-top:18px"><span class="btn">Save changes</span> <span style="margin-left:12px;color:var(--accent)">Cancel</span></div></div>`)

const code = base(`<div style="padding:20px;font-family:Consolas,'Courier New',monospace;font-size:14px;line-height:1.55;background:var(--card)">
<div class="muted">src/server/routes.ts</div><pre style="margin:10px 0 0;font-family:inherit">import express from 'express'
import { listUsers, getUser } from './users'

const router = express.Router()

router.get('/api/users', async (req, res) => {
  const page = Number(req.query.page ?? 1)
  const users = await listUsers({ page, limit: 25 })
  res.json({ page, users })
})

router.get('/api/users/:id', async (req, res) => {
  const user = await getUser(req.params.id)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json(user)
})

export default router</pre></div>`)

const dialog = base(`<div style="padding:60px;background:var(--card);min-height:420px"><div style="width:460px;margin:0 auto;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:22px">
<div style="font-size:19px;font-weight:600;color:#cf222e">Build failed</div><p>The command npm run build exited with code 1 after 14.2 seconds.</p>
<div class="input" style="font-family:Consolas,monospace;font-size:13px">error TS2304: Cannot find name 'useStore'.</div>
<p class="muted" style="font-size:13px">See the full log in the Output panel for details.</p><div style="text-align:right"><span style="margin-right:14px">Dismiss</span><span class="btn">View log</span></div></div></div>`)

const pricing = base(`<div style="padding:30px"><h1 style="text-align:center;margin-top:0">Choose your plan</h1><div style="display:flex;gap:18px">
${[['Starter', '$0', 'For individuals', ['1 project', 'Community support', '500 MB storage']], ['Team', '$12', 'Per user per month', ['Unlimited projects', 'Email support', '50 GB storage']], ['Enterprise', '$49', 'Per user per month', ['Single sign-on', 'Audit log', 'Dedicated manager']]]
  .map(([n, p, s, f]) => `<div class="card" style="flex:1"><div style="font-size:20px;font-weight:600">${n}</div><div style="font-size:34px;font-weight:700">${p}</div><div class="muted">${s}</div><ul>${f.map((x) => `<li>${x}</li>`).join('')}</ul><div class="btn">Get ${n}</div></div>`).join('')}
</div></div>`)

module.exports = { login, dashboard, article, table, settings, code, dialog, pricing }
