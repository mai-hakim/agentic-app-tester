// runner.js — the Runner (المشغّل) + Checker (الفاحص) + the two simulated personas.
// Opens a website like a user would, runs fixed-rule checks, and returns raw findings.
// No AI. No paid services. Severity is NOT decided here — n8n decides it with fixed rules.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');

const INTERACTIVE =
  'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], ' +
  '[role=checkbox], [role=tab], [role=menuitem], [onclick], [tabindex]:not([tabindex="-1"])';

function slug(u) {
  try {
    const x = new URL(u);
    return (x.pathname === '/' ? 'home' : x.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')).slice(0, 50) || 'home';
  } catch { return 'page'; }
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

function pageKey(u) {
  try { const x = new URL(u); return x.origin + x.pathname.replace(/\/$/, ''); } catch { return u; }
}

function issue(rule, persona, page, element, detail, extra = {}) {
  return { id: `${rule}|${pageKey(page)}|${element}`, rule, persona, page, element, detail, ...extra };
}

// ---------- in-browser helpers (run inside the page) ----------

function inPageDescribe() {
  window.__describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') ||
      el.getAttribute('placeholder') || el.getAttribute('value') || el.getAttribute('href') || '')
      .replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${tag}${el.id ? '#' + el.id : ''}${label ? ' "' + label + '"' : ''}`;
  };
  // "Screen-reader only" elements (e.g. a skip link hidden with the usual .sr-only 1x1px + clip trick).
  // They are invisible on purpose, so tap-size and clipping rules must not judge them.
  window.__srOnly = (el) => {
    const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    const tiny = b.width <= 1 && b.height <= 1;
    const clipped = /rect\(0(px)?,\s*0(px)?,\s*0(px)?,\s*0(px)?\)/.test(cs.clip) || /inset\(50%\)/.test(cs.clipPath);
    return tiny && (clipped || cs.overflow === 'hidden');
  };
}

async function waitForText(page, maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const len = await page.evaluate(() => (document.body ? document.body.innerText.trim().length : 0)).catch(() => 0);
    if (len > 0) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function measureFirstText(page, url, cfg) {
  const t0 = Date.now();
  const resp = await page.goto(url, { waitUntil: 'commit', timeout: cfg.pageTimeoutMs });
  let firstTextMs = null;
  while (Date.now() - t0 < 15000) {
    const len = await page.evaluate(() => (document.body ? document.body.innerText.trim().length : 0)).catch(() => 0);
    if (len > 0) { firstTextMs = Date.now() - t0; break; }
    await page.waitForTimeout(100);
  }
  await page.waitForLoadState('load', { timeout: cfg.pageTimeoutMs }).catch(() => {});
  const loadMs = Date.now() - t0;
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  return { status: resp ? resp.status() : null, firstTextMs, loadMs };
}

// ---------- main ----------

async function runAll(options = {}) {
  const cfg = { ...JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')), ...options };
  const target = cfg.targetUrl;
  if (!/^https?:\/\//i.test(target || '')) throw new Error('targetUrl must start with http:// or https://');

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const screensDir = path.join(__dirname, 'reports', 'screens');
  fs.mkdirSync(screensDir, { recursive: true });

  const authFile = path.join(__dirname, 'auth.json');
  const loggedIn = !!cfg.useSavedLogin && fs.existsSync(authFile);
  const storage = loggedIn ? { storageState: authFile } : {};

  const result = {
    tool: 'Automated Multi-Persona Test Harness',
    runId, target, startedAt: new Date().toISOString(),
    settings: { maxPages: cfg.maxPages, minFontPx: cfg.minFontPx, minTargetPx: cfg.minTargetPx, blankScreenLimitMs: cfg.blankScreenLimitMs },
    environment: { loggedIn },
    pagesTested: [], issues: [], notChecked: [], harnessErrors: []
  };
  const fail = (stage, page, e) => result.harnessErrors.push({ stage, page, message: String(e && e.message || e).slice(0, 300) });

  const browser = await chromium.launch();
  result.environment.browser = 'Chromium ' + browser.version();

  try {
    // ================= 1) Default user: crawl + checks =================
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...storage });
    await ctx.addInitScript(inPageDescribe);

    const queue = [target, ...(cfg.extraPaths || []).map(p => new URL(p, target).href)];
    const visited = new Set();
    const allLinks = new Map(); // href -> first page found on
    const pageResults = new Map(); // pageKey -> {status, text}

    while (queue.length && result.pagesTested.length < cfg.maxPages) {
      const url = queue.shift();
      const key = pageKey(url);
      if (visited.has(key)) continue;
      visited.add(key);

      const page = await ctx.newPage();
      const consoleErrors = [], pageErrors = [], badRequests = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
      page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 200)));
      page.on('requestfailed', r => badRequests.push(`${r.failure() ? r.failure().errorText : 'failed'} — ${r.url().slice(0, 120)}`));
      page.on('response', r => { if (r.status() >= 400) badRequests.push(`HTTP ${r.status()} — ${r.url().slice(0, 120)}`); });

      const info = { url, status: null, firstTextMs: null, loadMs: null, screenshot: null };
      try {
        Object.assign(info, await measureFirstText(page, url, cfg));
      } catch (e) {
        result.issues.push(issue('page-not-loading', 'default', url, 'page', `The page did not open: ${String(e.message).slice(0, 150)}`));
        result.pagesTested.push(info); await page.close(); continue;
      }

      const bodyText = await page.evaluate(() => (document.body ? document.body.innerText.trim() : '')).catch(() => '');
      pageResults.set(key, { status: info.status, text: bodyText, title: await page.title().catch(() => '') });

      if (info.status && info.status >= 400) {
        result.issues.push(issue('page-not-loading', 'default', url, 'page', `The server answered with error ${info.status}.`));
        result.pagesTested.push(info); await page.close(); continue; // no point checking an error page
      }
      if (info.firstTextMs === null) {
        result.issues.push(issue('blank-screen', 'default', url, 'page', 'No text appeared on screen within 15 seconds.', { value: 15000 }));
      } else if (info.firstTextMs > cfg.blankScreenLimitMs) {
        result.issues.push(issue('blank-screen', 'default', url, 'page', `The screen stayed empty for ${(info.firstTextMs / 1000).toFixed(1)} seconds before any text appeared.`, { value: info.firstTextMs }));
      }
      if (info.loadMs > 5000) {
        result.issues.push(issue('slow-load', 'default', url, 'page', `The page took ${(info.loadMs / 1000).toFixed(1)} seconds to finish loading.`, { value: info.loadMs }));
      }

      try {
        const shot = `${runId}-${slug(url)}-desktop.png`;
        await page.screenshot({ path: path.join(screensDir, shot) });
        info.screenshot = 'screens/' + shot;
      } catch (e) { fail('screenshot', url, e); }

      // Zoom blocked? (checked here once per page, belongs to the low-vision persona)
      try {
        const vp = await page.evaluate(() => { const m = document.querySelector('meta[name="viewport"]'); return m ? m.getAttribute('content') : null; });
        if (vp) {
          const max = /maximum-scale\s*=\s*([\d.]+)/i.exec(vp);
          const noScale = /user-scalable\s*=\s*(no|0)\b/i.test(vp);
          if ((max && parseFloat(max[1]) < 2) || noScale) {
            result.issues.push(issue('zoom-blocked', 'low-vision', url, 'meta viewport', `Zooming is blocked by the page settings: "${vp}". People with low vision cannot pinch to enlarge text on phones.`));
          }
        }
      } catch (e) { fail('viewport-check', url, e); }

      // Accessibility rules (axe-core)
      try {
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .disableRules(['meta-viewport', 'target-size']) // checked by our own stricter rules below
          .analyze();
        for (const v of axe.violations) {
          const examples = v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ');
          result.issues.push(issue('axe-' + v.id, 'default', url, v.id, `${v.help} — found on ${v.nodes.length} element(s). Examples: ${examples}`, { impact: v.impact, helpUrl: v.helpUrl }));
        }
      } catch (e) { fail('axe', url, e); }

      // Font size (custom fixed rule — axe-core has no font-size rule)
      try {
        const small = await page.evaluate((min) => {
          const out = []; const seen = new Set();
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (w.nextNode()) {
            const t = w.currentNode; const txt = t.textContent.trim();
            const el = t.parentElement;
            if (!txt || !el || seen.has(el)) continue; seen.add(el);
            if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') continue;
            const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
            const fs = parseFloat(cs.fontSize);
            if (fs < min) out.push(`${fs}px "${txt.slice(0, 30)}"`);
          }
          return out;
        }, cfg.minFontPx);
        if (small.length) {
          result.issues.push(issue('small-font', 'default', url, `text under ${cfg.minFontPx}px`, `${small.length} piece(s) of text are smaller than ${cfg.minFontPx}px. Examples: ${small.slice(0, 4).join('; ')}`, { value: small.length }));
        }
      } catch (e) { fail('font-size', url, e); }

      // Console + crashes + failed requests (collected during load)
      await page.waitForTimeout(500);
      [...new Set(consoleErrors)].filter(m => !/^Failed to load resource/i.test(m)).slice(0, 10).forEach(m => result.issues.push(issue('console-error', 'default', url, m.slice(0, 60), `Browser console error: ${m}`)));
      [...new Set(pageErrors)].slice(0, 10).forEach(m => result.issues.push(issue('page-crash', 'default', url, m.slice(0, 60), `JavaScript crashed: ${m}`)));
      [...new Set(badRequests)].slice(0, 10).forEach(m => result.issues.push(issue('failed-request', 'default', url, m.slice(0, 80), `A file or data request failed: ${m}`)));

      // Collect links for crawling + checking
      try {
        const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 40) })));
        for (const h of hrefs) {
          if (!/^https?:/i.test(h.href)) continue;
          const clean = h.href.split('#')[0];
          if (!allLinks.has(clean)) allLinks.set(clean, { foundOn: url, text: h.text });
          if (sameOrigin(clean, target) && !visited.has(pageKey(clean))) queue.push(clean);
        }
      } catch (e) { fail('collect-links', url, e); }

      result.pagesTested.push(info);
      await page.close();
    }

    // ================= 2) Broken links =================
    let checked = 0;
    for (const [href, meta] of allLinks) {
      if (checked >= cfg.maxLinksToCheck) { result.notChecked.push(`${allLinks.size - checked} more link(s) were not checked (limit is ${cfg.maxLinksToCheck}).`); break; }
      checked++;
      const label = meta.text ? `"${meta.text}" → ${href}` : href;
      try {
        if (sameOrigin(href, target)) {
          let pr = pageResults.get(pageKey(href));
          if (!pr) {
            const p = await ctx.newPage();
            try {
              const r = await p.goto(href, { waitUntil: 'load', timeout: cfg.pageTimeoutMs });
              await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
              await p.waitForTimeout(1500);
              pr = { status: r ? r.status() : null, text: await p.evaluate(() => document.body ? document.body.innerText.trim() : ''), title: await p.title() };
            } finally { await p.close(); }
          }
          const looks404 = /\b404\b|page not found|not found|doesn.t exist|does not exist/i;
          let reason = null;
          if (pr.status && pr.status >= 400) reason = `server error ${pr.status}`;
          else if (looks404.test(pr.title) || (pr.text.length < 400 && looks404.test(pr.text))) reason = 'the page opens but says "not found"';
          else if (pr.text.length < 20) reason = 'the page opens but is empty';
          if (reason) result.issues.push(issue('broken-link', 'default', meta.foundOn, label, `Link is broken: ${reason}.`));
        } else {
          const r = await ctx.request.get(href, { timeout: 15000, failOnStatusCode: false, maxRedirects: 5 });
          if (r.status() >= 400) result.issues.push(issue('broken-link', 'default', meta.foundOn, label, `External link answered with error ${r.status()}${r.status() === 403 ? ' (some sites block automated checks — confirm by hand)' : ''}.`));
        }
      } catch (e) {
        result.issues.push(issue('broken-link', 'default', meta.foundOn, label, `Link could not be reached: ${String(e.message).slice(0, 100)}`));
      }
    }
    await ctx.close();

    const pagesToRetest = result.pagesTested.filter(p => p.status && p.status < 400).map(p => p.url);

    // ================= 3) Low-vision persona (simulation): 200% zoom =================
    // 640x450 CSS pixels at scale 2 = the same layout as a 1280x900 screen zoomed to 200%.
    const lv = await browser.newContext({ viewport: { width: 640, height: 450 }, deviceScaleFactor: 2, ...storage });
    await lv.addInitScript(inPageDescribe);
    for (const url of pagesToRetest) {
      const page = await lv.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: cfg.pageTimeoutMs });
        await waitForText(page);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(800);
        const r = await page.evaluate(() => {
          const vw = window.innerWidth;
          const out = { hScroll: document.documentElement.scrollWidth > vw + 2, scrollWidth: document.documentElement.scrollWidth, vw, cut: [], clipped: [] };
          const insideScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
          for (const el of document.body.querySelectorAll('*')) {
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'].includes(el.tagName.toUpperCase())) continue;
            const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
            if (!ownText) continue;
            const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
            if ((b.right > vw + 2 || b.left < -2) && !insideScroller(el)) out.cut.push(window.__describe(el));
            if (window.__srOnly(el)) continue; // hidden on purpose for screen readers
            const hid = [cs.overflow, cs.overflowX, cs.overflowY].some(v => v === 'hidden' || v === 'clip');
            if (hid && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)) out.clipped.push(window.__describe(el));
          }
          return out;
        });
        if (r.hScroll) result.issues.push(issue('lowvision-horizontal-scroll', 'low-vision', url, 'whole page', `At 200% zoom the page is ${r.scrollWidth}px wide on a ${r.vw}px screen, so the reader must scroll sideways to read each line.`));
        if (r.cut.length) result.issues.push(issue('lowvision-cut-off', 'low-vision', url, 'text outside the screen', `At 200% zoom, ${r.cut.length} piece(s) of text go off the edge of the screen. Examples: ${r.cut.slice(0, 4).join('; ')}`, { value: r.cut.length }));
        if (r.clipped.length) result.issues.push(issue('lowvision-clipped', 'low-vision', url, 'text cut inside boxes', `At 200% zoom, ${r.clipped.length} box(es) hide part of their text. Examples: ${r.clipped.slice(0, 4).join('; ')}`, { value: r.clipped.length }));
        const shot = `${runId}-${slug(url)}-zoom200.png`;
        await page.screenshot({ path: path.join(screensDir, shot) });
        const pt = result.pagesTested.find(p => p.url === url); if (pt) pt.zoomScreenshot = 'screens/' + shot;
      } catch (e) { fail('low-vision', url, e); }
      await page.close();
    }
    await lv.close();

    // ================= 4) Tremor persona (simulation): small targets + near-miss taps =================
    // Phone-size screen. "Taps" are simulated by asking the browser what sits 8px outside each
    // small button. Nothing is really clicked, so no data is changed or submitted.
    const tr = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...storage });
    await tr.addInitScript(inPageDescribe);
    for (const url of pagesToRetest) {
      const page = await tr.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: cfg.pageTimeoutMs });
        await waitForText(page);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(800);
        const found = await page.evaluate(({ sel, min }) => {
          const all = [...document.querySelectorAll(sel)].filter(el => {
            const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !window.__srOnly(el);
          });
          const isInline = (el) => el.tagName === 'A' && el.parentElement && ['P', 'LI', 'SPAN', 'TD'].includes(el.parentElement.tagName) &&
            (el.parentElement.innerText || '').length > (el.innerText || '').length + 20;
          const interactiveAt = (x, y) => { const e = document.elementFromPoint(x, y); return e ? e.closest(sel) : null; };
          const small = [], risky = []; let inlineSkipped = 0;
          for (const el of all) {
            if (isInline(el)) { inlineSkipped++; continue; }
            const b = el.getBoundingClientRect();
            if (b.width >= min && b.height >= min) continue;
            const name = window.__describe(el);
            small.push(`${name} (${Math.round(b.width)}×${Math.round(b.height)}px)`);
            if (risky.length >= 25) continue;
            // only probe elements currently on screen (elementFromPoint needs visible area)
            const pad = 8, cx = b.left + b.width / 2, cy = b.top + b.height / 2;
            const probes = [[b.left - pad, cy], [b.right + pad, cy], [cx, b.top - pad], [cx, b.bottom + pad]];
            const neighbours = new Set();
            for (const [x, y] of probes) {
              if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
              const n = interactiveAt(x, y);
              if (n && n !== el && !n.contains(el) && !el.contains(n)) neighbours.add(window.__describe(n));
            }
            if (neighbours.size) risky.push({ name, neighbours: [...neighbours] });
          }
          return { small, risky, inlineSkipped };
        }, { sel: INTERACTIVE, min: cfg.minTargetPx });
        for (const s of found.small.slice(0, 30)) {
          const el = s.replace(/ \(\d+×\d+px\)$/, '');
          result.issues.push(issue('small-target', 'tremor', url, el, `Tap area is smaller than ${cfg.minTargetPx}×${cfg.minTargetPx}px: ${s}`));
        }
        if (found.small.length > 30) result.notChecked.push(`${found.small.length - 30} more small tap areas on ${url} were not listed.`);
        for (const r of found.risky) {
          result.issues.push(issue('tremor-wrong-tap', 'tremor', url, r.name, `A shaky tap 8px off ${r.name} would hit a different control instead: ${r.neighbours.join(', ')}.`));
        }
      } catch (e) { fail('tremor', url, e); }
      await page.close();
    }
    await tr.close();
  } finally {
    await browser.close();
  }

  // ================= Honest list of what this run did NOT check =================
  if (!loggedIn) result.notChecked.push('Pages behind a login were NOT tested (no saved login was used). Their results are UNKNOWN.');
  result.notChecked.push('Uploading documents and checking the AI summaries, appointments and warnings is NOT automated in this version.');
  result.notChecked.push('Overlapping elements at 200% zoom are not detected; check the zoom screenshots by eye.');
  result.notChecked.push('Links that are buttons or JavaScript actions (not normal links) are not followed.');
  result.notChecked.push('The low-vision and tremor personas are simulations. They do not replace testing with real older adults.');

  result.finishedAt = new Date().toISOString();
  result.durationMs = Date.parse(result.finishedAt) - Date.parse(result.startedAt);
  return result;
}

module.exports = { runAll };
