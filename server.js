// server.js — the Helper Server (الخادم المساعد).
// n8n talks to it. It runs the browser tests and saves reports, so n8n does not need
// the Execute Command node (which is switched off by default in n8n 2.x for security).
// Listens only on this computer (127.0.0.1), not on the network.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { runAll } = require('./runner');
const { runAgents } = require('./agents/agent-runner');
const store = require('./store');

const PORT = 3456;
let busy = false;

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((ok, bad) => {
    let s = ''; req.on('data', c => (s += c)); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, busy });

    if (req.method === 'POST' && url.pathname === '/run') {
      if (busy) return send(res, 409, { error: 'A test run is already in progress. Wait for it to finish.' });
      busy = true;
      try {
        const body = await readBody(req);
        const opts = {};
        if (body.url) opts.targetUrl = String(body.url).trim();
        if (body.maxPages) opts.maxPages = Number(body.maxPages);
        console.log(new Date().toLocaleTimeString(), 'Run started:', opts.targetUrl || '(config.json)');
        const current = await runAll(opts);
        const previous = store.loadPrevious(current.target); // read BEFORE saving the new run
        store.saveRun(current);
        console.log(new Date().toLocaleTimeString(), `Run finished: ${current.issues.length} raw findings on ${current.pagesTested.length} page(s).`);
        return send(res, 200, { current, previous });
      } finally { busy = false; }
    }

    // Agentic App Tester: AI agents explore, fixed checks confirm (see agents/agent-runner.js)
    if (req.method === 'POST' && url.pathname === '/agents/run') {
      if (busy) return send(res, 409, { error: 'A test run is already in progress. Wait for it to finish.' });
      busy = true;
      try {
        const body = await readBody(req);
        const current = await runAgents({ url: String(body.url || '').trim(), runs: Number(body.runs) || 2, personas: body.personas });
        const dir = path.join(__dirname, 'results'); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'agents-' + current.runId + '.json'), JSON.stringify(current, null, 2));
        console.log(new Date().toLocaleTimeString(), `Agents finished: ${current.issues.length} raw confirmed findings, ${current.agents.length} agent runs.`);
        return send(res, 200, { current, previous: null });
      } finally { busy = false; }
    }
    if (req.method === 'POST' && url.pathname === '/agents/save-report') {
      const body = await readBody(req);
      if (!body.html) return send(res, 400, { error: 'No html in the request.' });
      const dir = path.join(store.REPORTS); fs.mkdirSync(dir, { recursive: true });
      const slug = String(body.target || '').replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 50);
      const file = path.join(dir, 'agents-' + slug + '-' + body.runId + '.html');
      fs.writeFileSync(file, body.html); fs.writeFileSync(path.join(dir, 'agents-latest.html'), body.html);
      return send(res, 200, { saved: true, file: path.relative(__dirname, file), openInBrowser: `http://127.0.0.1:${PORT}/agents/report` });
    }
    if (req.method === 'GET' && url.pathname === '/agents/report') {
      const f = path.join(store.REPORTS, 'agents-latest.html');
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), 'text/html; charset=utf-8') : send(res, 404, 'No agent report yet.', 'text/plain');
    }

    if (req.method === 'POST' && url.pathname === '/save-report') {
      const body = await readBody(req);
      if (!body.html) return send(res, 400, { error: 'No html in the request.' });
      const saved = store.saveReport(body.html, body.runId || Date.now(), body.target || '');
      console.log('Report saved:', saved.latest);
      return send(res, 200, { saved: true, file: path.relative(__dirname, saved.file), openInBrowser: `http://127.0.0.1:${PORT}/report` });
    }

    if (req.method === 'GET' && url.pathname === '/report') {
      const f = path.join(store.REPORTS, 'latest.html');
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), 'text/html; charset=utf-8') : send(res, 404, 'No report yet.', 'text/plain');
    }

    if (req.method === 'GET' && url.pathname.startsWith('/screens/')) {
      const f = path.join(store.REPORTS, 'screens', path.basename(url.pathname));
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), 'image/png') : send(res, 404, 'Not found', 'text/plain');
    }

    send(res, 404, { error: 'Unknown address' });
  } catch (e) {
    console.error('ERROR:', e.message);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Helper server is running on http://127.0.0.1:${PORT}`);
  console.log('Keep this window open. Press Ctrl+C to stop it.');
});
