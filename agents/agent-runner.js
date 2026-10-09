// agent-runner.js — "Agents explore, rules decide."
//
// Each agent has a persona and a goal. At every step it looks at the screen (a screenshot + a numbered
// list of what can be tapped), DECIDES itself what to tap or type, and changes its plan when it is stuck.
// The AI only explores and writes descriptions.
//
// Every finding must be confirmed by a FIXED check (axe-core, tap size, spacing, font size, zoom, overflow,
// broken links, console errors, a tap that changed nothing). What an agent "feels" but no check confirms
// is reported separately as "unconfirmed" and gets no severity. Severity is decided later by fixed rules (n8n).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const gemini = require('./gemini');
const { PERSONAS, taskFor } = require('./personas');

const MAX_STEPS = 12;
const MIN_TARGET = 44, MIN_FONT = 16, NEAR_PX = 8;
const pageKey = u => { try { const x = new URL(u); return x.origin + x.pathname.replace(/\/$/, ''); } catch { return u; } };

const STEP_SCHEMA = {
  type: 'OBJECT',
  properties: {
    observation: { type: 'STRING', description: 'What you see on this screen, in your own words as the persona (1-2 sentences).' },
    plan: { type: 'STRING', description: 'Your current plan to reach the goal (short).' },
    action: { type: 'STRING', enum: ['tap', 'type', 'scroll_down', 'scroll_up', 'back', 'done', 'give_up'] },
    element: { type: 'INTEGER', description: 'Number of the element to tap or type into, from the list. -1 if none.' },
    text: { type: 'STRING', description: 'Text to type (made-up text only), or empty.' },
    difficulty: { type: 'STRING', enum: ['none', 'too-small-to-tap', 'buttons-too-close', 'hard-to-read', 'low-contrast', 'text-cut-off', 'nothing-happened', 'broken-link', 'confusing', 'scary-or-pushy'] },
    difficulty_element: { type: 'INTEGER', description: 'Element number the difficulty is about, or -1.' },
    difficulty_note: { type: 'STRING' },
    answer: { type: 'STRING', description: 'When action is done: what you found out (the answer to your goal).' }
  },
  required: ['observation', 'plan', 'action', 'element', 'difficulty']
};

// ---------- what the agent can see: numbered interactive elements ----------
async function listElements(page) {
  return page.evaluate(({ MIN_TARGET }) => {
    const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, label[for], [role=button], [role=link], [role=checkbox], [role=tab], [onclick]';
    const out = []; let n = 0;
    document.querySelectorAll('[data-agent-id]').forEach(e => e.removeAttribute('data-agent-id'));
    for (const el of document.querySelectorAll(SEL)) {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden],[inert],[aria-hidden="true"]')) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue; // only what is on screen now
      // visually hidden until focused (e.g. a "Skip to content" link): not a tap target, so not listed
      if (/rect\(0(px)?,? ?0(px)?,? ?0(px)?,? ?0(px)?\)/.test(cs.clip) || (r.width <= 3 && r.height <= 3 && cs.overflow === 'hidden')) continue;
      const own = el.matches('input[type=checkbox],input[type=radio]') ? ((el.closest('label') && el.closest('label').innerText) || el.type) : (el.value || '');
      const label = (el.getAttribute('aria-label') || el.innerText || own || el.getAttribute('placeholder') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      el.setAttribute('data-agent-id', String(n));
      out.push({ id: n++, tag: el.tagName.toLowerCase(), type: el.type || '', label, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) });
      if (n >= 45) break;
    }
    return out;
  }, { MIN_TARGET });
}
async function screenState(page) {
  const t = await page.evaluate(() => {
    if (!document.body) return '';
    const states = [...document.querySelectorAll('[aria-pressed],[aria-expanded],[aria-checked],[aria-selected],details,input,select,textarea,dialog')]
      .map(e => (e.getAttribute('aria-pressed') || '') + (e.getAttribute('aria-expanded') || '') + (e.getAttribute('aria-checked') || '') + (e.getAttribute('aria-selected') || '') + (e.open ? 'o' : '') + (e.checked ? 'c' : '') + (e.value || '')).join(',');
    const speaking = window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending) ? 'speaking' : '';
    return document.body.innerText.replace(/\s+/g, ' ').slice(0, 4000) + '|' + scrollY + '|' + states + '|' + speaking + '|' + document.querySelectorAll('*').length;
  }).catch(() => '');
  return crypto.createHash('md5').update(page.url() + t).digest('hex').slice(0, 12);
}
async function caption(page, text) {
  await page.evaluate(t => { let c = document.getElementById('agent-cap'); if (!c) { c = document.createElement('div'); c.id = 'agent-cap';
    c.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;padding:8px 10px;border-radius:12px;background:rgba(15,42,48,.92);color:#fff;font:700 16px/1.35 system-ui,sans-serif;pointer-events:none;zoom:1';
    document.documentElement.appendChild(c); } c.textContent = t; }, text).catch(() => {});
}
const describe = el => el ? `${el.tag} "${el.label || el.type || '(no label)'}"` : 'page';

// ---------- fixed checks (the rules that confirm or reject) ----------
async function checkScreen(page, ctxInfo, seen) {
  const found = [];
  const url = page.url();
  // 1) axe-core accessibility rules (WCAG 2 A/AA) — once per distinct screen
  try {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    for (const v of r.violations) for (const node of v.nodes.slice(0, 5)) {
      found.push({ rule: 'axe-' + v.id, impact: v.impact, page: url, element: node.target.join(' ').slice(0, 80), detail: v.help, check: 'axe-core ' + v.id, selector: node.target.join(' ') });
    }
  } catch (e) { seen.harnessErrors.push({ stage: 'axe', page: url, message: String(e.message).slice(0, 200) }); }
  // 2) tap size + spacing + font size on what is on screen
  const geo = await page.evaluate(({ MIN_TARGET, MIN_FONT, NEAR_PX }) => {
    const tapBox = el => {
      const lab = (el.matches('input,select,textarea') && (el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]')))) || null;
      if (!lab) return el.getBoundingClientRect();
      const a = el.getBoundingClientRect(), b = lab.getBoundingClientRect();
      return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom), width: Math.max(a.right, b.right) - Math.min(a.left, b.left), height: Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top) };
    };
    const els = [...document.querySelectorAll('[data-agent-id]')].map(el => ({ el, r: tapBox(el), id: +el.getAttribute('data-agent-id') }));
    const label = el => (el.getAttribute('aria-label') || el.innerText || (el.closest('label') && el.closest('label').innerText) || (el.type === 'checkbox' || el.type === 'radio' ? el.type : el.value) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const small = [], close = [], fonts = [];
    for (const a of els) {
      if (a.r.width < MIN_TARGET || a.r.height < MIN_TARGET) {
        const inline = getComputedStyle(a.el).display === 'inline' && a.el.tagName === 'A' && a.el.closest('p, li');
        if (!inline) small.push({ id: a.id, label: label(a.el), w: Math.round(a.r.width), h: Math.round(a.r.height) });
      }
      for (const b of els) if (b !== a && !a.el.contains(b.el) && !b.el.contains(a.el)) {
        const dx = Math.max(0, Math.max(a.r.left, b.r.left) - Math.min(a.r.right, b.r.right));
        const dy = Math.max(0, Math.max(a.r.top, b.r.top) - Math.min(a.r.bottom, b.r.bottom));
        if (Math.max(dx, dy) < NEAR_PX && (a.r.width < MIN_TARGET || a.r.height < MIN_TARGET)) { close.push({ id: a.id, label: label(a.el), other: label(b.el), gap: Math.round(Math.max(dx, dy)) }); break; }
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seenEl = new Set();
    while (walker.nextNode()) {
      const p = walker.currentNode.parentElement; if (!p || seenEl.has(p) || !walker.currentNode.textContent.trim()) continue; seenEl.add(p);
      const r = p.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight || r.width < 2) continue;
      const fs = parseFloat(getComputedStyle(p).fontSize); const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      if (fs >= 1 && fs < MIN_FONT && !p.closest('[aria-hidden="true"]') && getComputedStyle(p).clip === 'auto') fonts.push({ text: walker.currentNode.textContent.trim().slice(0, 40), px: Math.round(fs * 10) / 10 });
      if (fonts.length > 8) break;
    }
    const vp = document.querySelector('meta[name=viewport]'); const c = vp ? vp.content.toLowerCase() : '';
    const ms = (c.match(/maximum-scale\s*=\s*([\d.]+)/) || [])[1];
    const zoomBlocked = /user-scalable\s*=\s*(no|0)/.test(c) || (ms && parseFloat(ms) < 2);
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    return { small, close, fonts, zoomBlocked, overflow, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  }, { MIN_TARGET, MIN_FONT, NEAR_PX }).catch(() => null);
  if (geo) {
    geo.small.forEach(s => found.push({ rule: 'small-target', page: url, element: `"${s.label}"`, detail: `Tap area is ${s.w}×${s.h} px; the rule asks for at least ${MIN_TARGET}×${MIN_TARGET}.`, check: 'tap size ≥ 44 px', agentId: s.id }));
    if (ctxInfo.tremor) geo.close.forEach(s => found.push({ rule: 'tremor-wrong-tap', page: url, element: `"${s.label}"`, detail: `A small target sits ${s.gap} px from "${s.other}"; a shaky tap can hit the wrong one.`, check: 'spacing ≥ 8 px around small targets', agentId: s.id }));
    geo.fonts.forEach(f => found.push({ rule: 'small-font', page: url, element: `text "${f.text}"`, detail: `Text is ${f.px} px; the rule asks for at least ${MIN_FONT} px.`, check: 'font size ≥ 16 px' }));
    if (geo.zoomBlocked) found.push({ rule: 'zoom-blocked', page: url, element: 'meta viewport', detail: 'The page stops people from zooming in.', check: 'viewport meta allows zoom ≥ 200%' });
    if (ctxInfo.zoom && geo.overflow) found.push({ rule: 'lowvision-horizontal-scroll', page: url, element: 'page', detail: `At 200% zoom the page is ${geo.sw} px wide on a ${geo.cw} px screen: the reader must scroll sideways.`, check: 'no sideways scroll at 200% zoom' });
  }
  // 3) broken same-origin links on this screen (checked once per link)
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin)).slice(0, 15)).catch(() => []);
  for (const l of links) {
    const k = l.split('#')[0]; if (seen.links.has(k)) continue; seen.links.add(k);
    try { const r = await page.request.get(k, { timeout: 15000 }); if (r.status() >= 400) found.push({ rule: 'broken-link', page: url, element: k, detail: `The link answers with error ${r.status()}.`, check: 'link returns HTTP < 400' }); }
    catch (e) { found.push({ rule: 'broken-link', page: url, element: k, detail: 'The link does not open.', check: 'link returns HTTP < 400' }); }
  }
  return found;
}

// ---------- one agent, one run ----------
async function runAgent(browser, { target, persona, runNo, shotsDir, recordVideoDir, captions, keepOpen, desktopLayout }) {
  const P = PERSONAS[persona]; const { appName, task } = taskFor(target, persona);
  const zoom = P.browser.zoom || 1, tremor = P.browser.tremorPx || 0;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: !desktopLayout, hasTouch: false, locale: 'en-US', ...(recordVideoDir ? { recordVideo: { dir: recordVideoDir, size: { width: 390, height: 844 } } } : {}) });
  if (zoom > 1) await ctx.addInitScript(z => { const set = () => { if (document.documentElement) document.documentElement.style.zoom = z; }; document.addEventListener('DOMContentLoaded', set); set(); }, String(zoom));
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push({ page: page.url(), text: m.text().slice(0, 200) }); });
  page.on('pageerror', e => consoleErrors.push({ page: page.url(), text: 'JavaScript crashed: ' + String(e.message).slice(0, 180) }));

  const rec = { persona, personaLabel: P.label, run: runNo, appName, task, steps: [], success: false, answer: '', gaveUp: false, replans: 0, stuckEvents: 0, checksRun: 0 };
  const seen = { states: new Set(), links: new Set(), harnessErrors: [] };
  const confirmed = new Map(); const unconfirmed = [];
  const addConfirmed = (f, how) => { const id = `${f.rule}|${pageKey(f.page)}|${f.element}`; if (!confirmed.has(id)) confirmed.set(id, { id, persona, ...f, foundBy: how }); else if (how === 'agent-report+check') confirmed.get(id).foundBy = how; };

  await page.goto(target, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);
  let lastState = null, sameCount = 0, lastPlan = '', stuckNote = '';
  for (let step = 1; step <= MAX_STEPS; step++) {
    const state = await screenState(page);
    const els = await listElements(page);
    if (!seen.states.has(state)) { seen.states.add(state); const fs_ = await checkScreen(page, { zoom: zoom > 1, tremor: tremor > 0 }, seen); rec.checksRun++; fs_.forEach(f => addConfirmed(f, 'check-on-agent-path')); }
    sameCount = state === lastState ? sameCount + 1 : 0; lastState = state;
    if (sameCount >= 2) { rec.stuckEvents++; stuckNote = 'IMPORTANT: your last ' + sameCount + ' actions did not change the screen. You are stuck. Make a NEW plan and try something different (another element, scroll, or back).'; }
    // (a screenshot 'style' would inject CSS that a strict Content-Security-Policy blocks and logs as an error — only used in demo videos)
    const shot = (await page.screenshot({ type: 'jpeg', quality: 55, ...(captions ? { style: '#agent-cap{display:none!important}' } : {}) })).toString('base64');
    const history = rec.steps.slice(-6).map(s => `step ${s.step}: ${s.action}${s.elementLabel ? ' "' + s.elementLabel + '"' : ''}${s.text ? ' text "' + s.text + '"' : ''} -> ${s.changed ? 'screen changed' : 'screen did NOT change'}`).join('\n');
    const prompt = `App: ${appName}\nYour goal: ${task}\nStep ${step} of ${MAX_STEPS}.\nWhat you did so far:\n${history || '(nothing yet)'}\n${stuckNote}\n\nThings you can tap on this screen (number: kind "label" size):\n` +
      els.map(e => `${e.id}: ${e.tag}${e.type ? '[' + e.type + ']' : ''} "${e.label}" ${e.w}x${e.h}px`).join('\n') +
      `\n\nLook at the screenshot. Choose ONE action. Use "done" only when you have really found the answer to your goal. If something was hard for you, say which element in "difficulty".`;
    let d;
    if (captions) await caption(page, '🤖 ' + P.label + ' is looking…');
    try { d = (await gemini.ask({ system: P.who + ' You are testing a website on a phone, acting exactly like this person would. Never type real personal data; only made-up text. Answer only with the JSON asked for.', text: prompt, imageJpegBase64: shot, schema: STEP_SCHEMA })).json; }
    catch (e) { seen.harnessErrors.push({ stage: 'gemini', page: page.url(), message: String(e.message).slice(0, 200) }); break; }
    stuckNote = '';
    if (captions) await caption(page, '🤖 ' + P.label.split(' (')[0] + ' thinks: ' + (d.plan || '').slice(0, 140));
    if (lastPlan && d.plan && d.plan !== lastPlan && rec.stuckEvents > 0 && rec.steps.length && !rec.steps[rec.steps.length - 1].changed) rec.replans++;
    lastPlan = d.plan || lastPlan;
    const el = els.find(e => e.id === d.element);
    const s = { step, url: page.url(), observation: d.observation, plan: d.plan, action: d.action, element: d.element, elementLabel: el ? el.label : '', text: d.action === 'type' ? (d.text || '').slice(0, 60) : '', difficulty: d.difficulty, difficultyNote: d.difficulty_note || '', changed: false, tremorMiss: false };
    // a difficulty the agent reports must be confirmed by a fixed check
    if (d.difficulty && d.difficulty !== 'none') {
      const de = els.find(e => e.id === d.difficulty_element);
      unconfirmed.push({ persona, page: page.url(), kind: d.difficulty, element: describe(de), note: d.difficulty_note || '', agentId: de ? de.id : null, step });
    }
    rec.steps.push(s);
    if (d.action === 'done') { rec.success = true; rec.answer = d.answer || ''; break; }
    if (d.action === 'give_up') { rec.gaveUp = true; rec.answer = d.answer || ''; break; }
    const before = await screenState(page);
    // tapping an option that is already selected is allowed to change nothing
    s.wasSelected = el ? await page.locator(`[data-agent-id="${d.element}"]`).evaluate(e => e.getAttribute('aria-pressed') === 'true' || e.getAttribute('aria-selected') === 'true' || e.checked === true).catch(() => false) : false;
    try {
      const loc = page.locator(`[data-agent-id="${d.element}"]`);
      if (d.action === 'tap' && el) {
        if (tremor) { // shaky finger: aim at the centre, land up to N px away
          const box = await loc.boundingBox();
          if (box) {
            const dx = (Math.random() * 2 - 1) * tremor, dy = (Math.random() * 2 - 1) * tremor;
            const x = box.x + box.width / 2 + dx * zoom, y = box.y + box.height / 2 + dy * zoom;
            s.tremorMiss = await page.evaluate(([x, y, id]) => { const hit = document.elementFromPoint(x, y); const want = document.querySelector(`[data-agent-id="${id}"]`); return !(hit && want && (want === hit || want.contains(hit) || hit.contains(want))); }, [x, y, d.element]);
            await page.mouse.click(x, y);
          } else await loc.click({ timeout: 5000 });
        } else await loc.click({ timeout: 5000 });
      } else if (d.action === 'type' && el) {
        await loc.click({ timeout: 5000 }); await loc.fill(String(d.text || 'Test note').slice(0, 60)); await page.keyboard.press('Enter');
      } else if (d.action === 'scroll_down') await page.mouse.wheel(0, 600);
      else if (d.action === 'scroll_up') await page.mouse.wheel(0, -600);
      else if (d.action === 'back') await page.goBack({ timeout: 10000 }).catch(() => {});
    } catch (e) { s.error = String(e.message).split('\n')[0].slice(0, 160); }
    await page.waitForTimeout(1200);
    s.changed = (await screenState(page)) !== before;
    // fixed check: a tap on a real button that changed nothing (and was not a tremor miss)
    if (d.action === 'tap' && el && !s.changed && !s.tremorMiss && !s.error && !s.wasSelected && ['button', 'a', 'summary'].includes(el.tag)) {
      addConfirmed({ rule: 'dead-tap', page: s.url, element: `${el.tag} "${el.label}"`, detail: 'Tapping this did not change anything on the screen.', check: 'screen changes after a tap' }, 'check-on-agent-path');
    }
    if (s.tremorMiss) addConfirmed({ rule: 'tremor-wrong-tap', page: s.url, element: `${el ? el.tag + ' "' + el.label + '"' : 'element'}`, detail: `A tap aimed at this landed on something else (simulated shake up to ${tremor} px).`, check: 'tap landed on the intended element' }, 'check-on-agent-path');
  }
  consoleErrors.forEach(c => addConfirmed({ rule: /crashed/.test(c.text) ? 'page-crash' : 'console-error', page: c.page, element: 'console', detail: c.text, check: 'no console errors' }, 'check-on-agent-path'));

  // match each agent report with the fixed check of the same kind on the same element/page
  const KIND = { 'too-small-to-tap': ['small-target'], 'buttons-too-close': ['tremor-wrong-tap', 'small-target'], 'hard-to-read': ['small-font', 'axe-color-contrast'], 'low-contrast': ['axe-color-contrast'],
    'text-cut-off': ['lowvision-horizontal-scroll', 'lowvision-cut-off'], 'nothing-happened': ['dead-tap', 'console-error'], 'broken-link': ['broken-link'] };
  const reports = [];
  for (const u of unconfirmed) {
    const rules = KIND[u.kind] || [];
    const hit = [...confirmed.values()].find(f => rules.includes(f.rule) && pageKey(f.page) === pageKey(u.page) && (f.agentId == null || u.agentId == null || f.agentId === u.agentId));
    if (hit) { hit.foundBy = 'agent-report+check'; hit.agentNote = u.note; }
    else reports.push({ ...u, status: rules.length ? 'not confirmed by any fixed check' : 'opinion only — no fixed check exists for this' });
  }
  if (keepOpen) return { rec, issues: [...confirmed.values()], unconfirmed: reports, harnessErrors: seen.harnessErrors, ctx, page };
  await ctx.close();
  return { rec, issues: [...confirmed.values()], unconfirmed: reports, harnessErrors: seen.harnessErrors };
}

// AI writes the plain-language description of each CONFIRMED finding (one call per run). Severity is not its job.
async function describeFindings(issues, personaLabel) {
  if (!issues.length) return;
  const schema = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' }, description: { type: 'STRING' } }, required: ['n', 'description'] } } }, required: ['items'] };
  const list = issues.slice(0, 25).map((f, i) => `${i}: rule=${f.rule}; element=${f.element}; fact=${f.detail}`).join('\n');
  try {
    const r = await gemini.ask({ system: 'You write short, plain-English bug descriptions for a test report. Do not judge severity. Do not invent facts beyond the given fact.', text: `Persona: ${personaLabel}.\nFor each confirmed problem, write ONE sentence (max 30 words) saying how it affects this person.\n${list}`, schema, temperature: 0.2 });
    (r.json.items || []).forEach(it => { if (issues[it.n]) issues[it.n].aiDescription = it.description; });
  } catch (e) { /* the report falls back to the fixed-rule text */ }
}

async function runAgents(options = {}) {
  const target = options.url; if (!/^https?:\/\//.test(target || '')) throw new Error('url must start with http(s)://');
  const personas = options.personas || Object.keys(PERSONAS);
  const runs = Math.max(1, Math.min(3, options.runs || 2));
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const shotsDir = path.join(__dirname, '..', 'reports', 'agent-screens'); fs.mkdirSync(shotsDir, { recursive: true });
  const cacheDir = path.join(__dirname, '..', 'results', 'agent-runs'); fs.mkdirSync(cacheDir, { recursive: true });
  const out = { tool: 'Agentic App Tester', runId, target, startedAt: new Date().toISOString(), settings: { maxSteps: MAX_STEPS, runsPerAgent: runs, minTargetPx: MIN_TARGET, minFontPx: MIN_FONT },
    environment: {}, agents: [], issues: [], unconfirmed: [], pagesTested: [], notChecked: [
      'The personas are AI simulations. They do not replace testing with real older adults or disabled people.',
      'The AI only chooses actions and writes descriptions. Every finding below was confirmed by a fixed check; severity comes from fixed rules.',
      'Screen readers (VoiceOver/TalkBack) were not used.'], harnessErrors: [] };
  const usage0 = JSON.parse(JSON.stringify(gemini.usage)); // count only this run's AI calls
  const browser = await chromium.launch(); out.environment.browser = 'Chromium ' + browser.version();
  try {
    for (const persona of personas) for (let r = 1; r <= runs; r++) {
      console.log(new Date().toLocaleTimeString(), `agent ${persona} run ${r} on ${target}`);
      // every finished agent run is saved at once, so a crash or restart never loses it (it is reused next time)
      const slug = target.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 50);
      const cacheFile = path.join(cacheDir, `${slug}__${persona}__run${r}.json`);
      try {
        let res;
        if (options.resume !== false && fs.existsSync(cacheFile)) { res = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); res.rec.resumedFromSavedRun = true; console.log('   (reusing saved run from ' + res.savedAt + ')'); }
        else {
          res = await runAgent(browser, { target, persona, runNo: r, shotsDir });
          await describeFindings(res.issues.filter(f => f.foundBy === 'agent-report+check' || !/^axe-/.test(f.rule)).slice(0, 25), res.rec.personaLabel);
          res.savedAt = new Date().toISOString();
          fs.writeFileSync(cacheFile, JSON.stringify({ rec: res.rec, issues: res.issues, unconfirmed: res.unconfirmed, harnessErrors: res.harnessErrors, savedAt: res.savedAt }, null, 2));
        }
        res.issues.forEach(f => { f.run = r; });
        out.agents.push(res.rec); out.issues.push(...res.issues); out.unconfirmed.push(...res.unconfirmed.map(u => ({ ...u, run: r }))); out.harnessErrors.push(...res.harnessErrors);
      } catch (e) { out.harnessErrors.push({ stage: 'agent ' + persona + ' run ' + r, page: target, message: String(e.message).slice(0, 300) }); }
    }
  } finally { await browser.close(); }
  out.pagesTested = [...new Set(out.issues.map(i => pageKey(i.page)).concat(out.agents.flatMap(a => a.steps.map(s => pageKey(s.url)))))].map(url => ({ url }));
  const u = gemini.usage, byModel = {};
  for (const m of Object.keys(u.byModel)) { const n = u.byModel[m] - (usage0.byModel[m] || 0); if (n) byModel[m] = n; }
  out.ai = { calls: u.calls - usage0.calls, retries: u.retries - usage0.retries, failures: u.failures - usage0.failures, byModel, models: Object.keys(byModel),
    reusedSavedRuns: out.agents.filter(a => a.resumedFromSavedRun).length };
  out.finishedAt = new Date().toISOString();
  return out;
}

module.exports = { runAgents, runAgent, describeFindings };
