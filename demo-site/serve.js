// demo-site/serve.js — a small FAKE website with problems planted on purpose.
// Use it to show the harness working at the showcase even without internet.
//   node demo-site/serve.js          -> the broken version
//   node demo-site/serve.js --fixed  -> the repaired version (run the test again to see "Fixed")
const http = require('http');
const FIXED = process.argv.includes('--fixed');
const PORT = 4321;

const page = (title, body, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="${FIXED ? 'width=device-width, initial-scale=1' : 'width=device-width, initial-scale=1, maximum-scale=1'}">
<title>${title}</title><style>
body{font-family:Arial,sans-serif;margin:0;padding:24px;${FIXED ? 'font-size:18px;color:#222' : 'font-size:13px;color:#aaa'}}
.banner{${FIXED ? 'max-width:100%' : 'width:1000px'};background:#eef;padding:12px}
.tools a{display:inline-block;${FIXED ? 'padding:14px 18px;margin:6px' : 'padding:2px 4px;margin:0'};border:1px solid #888;color:#225}
</style>${extra}</head><body>${body}</body></html>`;

const homeBody = `<div id="app"></div>
<script>
  ${FIXED ? '' : 'console.error("Failed to load appointments: 500");'}
  setTimeout(function(){
    document.getElementById('app').innerHTML =
      '<h1>DocHelper demo</h1>' +
      '<div class="banner">Upload a bill or a letter and we explain it in plain words.</div>' +
      '<p>Your documents stay private.</p>' +
      '<div class="tools"><a href="/upload">Upload</a><a href="/help">Help</a><a href="/settings">Settings</a></div>' +
      '<img src="/logo-missing.png" alt="logo" width="1" height="1">' +
      '<footer><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></footer>';
  }, ${FIXED ? 200 : 3500});
</script>`;

const simple = (h) => page(h, `<h1>${h}</h1><p>This is the ${h} page of the demo site. It has enough text to count as a real page.</p><p><a href="/">Back home</a></p>`);

http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const html = (code, body) => { res.writeHead(code, { 'Content-Type': 'text/html' }); res.end(body); };
  if (p === '/') return html(200, page('DocHelper demo', homeBody));
  if (['/upload', '/help', '/settings'].includes(p)) return html(200, simple(p.slice(1)));
  if (p === '/terms') return FIXED ? html(200, simple('terms')) : html(404, 'Not Found');
  if (p === '/privacy') return html(200, FIXED ? simple('privacy') : page('Oops', '<h2>Page not found</h2>'));
  if (p === '/logo-missing.png' && FIXED) { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end('Not Found');
}).listen(PORT, '127.0.0.1', () => console.log(`Demo site (${FIXED ? 'FIXED' : 'BROKEN'} version) on http://127.0.0.1:${PORT}`));
