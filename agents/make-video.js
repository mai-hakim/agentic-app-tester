// make-video.js — records the Project A demo: one AI agent (hand tremor) uses a public app,
// its thoughts are shown as captions, then the fixed checks and fixed severity rules produce the report.
// Usage: node agents/make-video.js [url] [persona]
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { runAgent, describeFindings } = require('./agent-runner');
const target = process.argv[2] || 'https://demo.playwright.dev/todomvc/';
const persona = process.argv[3] || 'hand-tremor';
const OUT = path.join(__dirname, '..', 'docs', 'demo', 'agents-demo.webm');
const step = (f, data) => new Function('data', fs.readFileSync(path.join(__dirname, '..', 'n8n-code', f), 'utf8') + '\nreturn result;')(data);
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tmp = path.join(path.dirname(OUT), 'tmp'); fs.mkdirSync(tmp, { recursive: true });
  const b = await chromium.launch(); const t0 = Date.now();
  const res = await runAgent(b, { target, persona, runNo: 1, recordVideoDir: tmp, captions: true, keepOpen: true });
  const { page, ctx } = res;
  await describeFindings(res.issues.filter(f => !/^axe-/.test(f.rule)).slice(0, 25), res.rec.personaLabel);
  res.issues.forEach(f => { f.run = 1; });
  const current = { tool: 'Agentic App Tester', runId: 'video-' + Date.now(), target, startedAt: new Date(t0).toISOString(), settings: { runsPerAgent: 1 }, environment: { browser: 'Chromium ' + b.version() },
    agents: [res.rec], issues: res.issues, unconfirmed: res.unconfirmed, pagesTested: [{ url: target }], notChecked: ['Demo video: one agent, one run.'], harnessErrors: res.harnessErrors, ai: null };
  let d = step('agents-1-severity.js', { current, previous: null }); d = step('agents-2-consistency.js', d); const r = step('agents-3-report.js', d);
  await page.setContent(r.html); await page.evaluate(() => document.documentElement.style.zoom = '0.8');
  const cap = t => page.evaluate(t => { let c = document.getElementById('cap2'); if (!c) { c = document.createElement('div'); c.id = 'cap2'; c.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:9;padding:9px 11px;border-radius:12px;background:rgba(15,42,48,.93);color:#fff;font:700 15px/1.35 system-ui;pointer-events:none'; document.body.appendChild(c); } c.textContent = t; }, t);
  await cap('The agent is done. Now FIXED checks confirm what it found, and fixed rules in n8n set the severity.'); await wait(5000);
  await page.evaluate(() => document.querySelector('h2:nth-of-type(2)') && document.querySelectorAll('h2')[1].scrollIntoView()); await cap('Confirmed findings — each one names the check that proved it. The AI only wrote the plain words.'); await wait(7000);
  await page.mouse.wheel(0, 500); await wait(4000);
  await cap('Agents explore, rules decide. Project A by Mai Hakim — code written with Claude.'); await wait(4000);
  const secs = Math.round((Date.now() - t0) / 1000);
  const v = page.video(); await ctx.close(); fs.mkdirSync(path.dirname(OUT), { recursive: true }); await v.saveAs(OUT); await v.delete(); fs.rmSync(tmp, { recursive: true, force: true }); await b.close();
  console.log('saved', OUT, '~' + secs + ' s', 'steps', res.rec.steps.length, 'success', res.rec.success, 'findings', d.totals ? JSON.stringify(d.totals) : res.issues.length);
})();
