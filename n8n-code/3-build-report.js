// STEP: Build the HTML report (كتابة التقرير).
// Input: data = output of the compare step. Output: result = { html, runId, target, totals, comparison }.
const r = data;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortPage = u => { try { const x = new URL(u); return x.pathname === '/' ? 'Home page' : x.pathname; } catch (e) { return u; } };
const when = iso => { try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; } };

const PERSONA = { 'default': 'Every user', 'low-vision': 'Low vision (simulated)', 'tremor': 'Hand tremor (simulated)' };
const RULE_NAME = {
  'page-not-loading': 'Page does not open', 'page-crash': 'Page code crashed', 'broken-link': 'Broken link',
  'blank-screen': 'Empty screen while loading', 'slow-load': 'Slow page', 'zoom-blocked': 'Zoom is blocked',
  'lowvision-cut-off': 'Text runs off the screen at 200% zoom', 'lowvision-clipped': 'Text hidden inside boxes at 200% zoom',
  'lowvision-horizontal-scroll': 'Sideways scrolling at 200% zoom', 'small-font': 'Text too small',
  'small-target': 'Tap area too small', 'tremor-wrong-tap': 'Shaky tap hits the wrong control',
  'console-error': 'Browser error message', 'failed-request': 'Something failed to download'
};
const ruleName = i => RULE_NAME[i.rule] || (i.rule.startsWith('axe-') ? 'Accessibility: ' + i.rule.slice(4).replace(/-/g, ' ') : i.rule);
const STATUS = { 'new': 'New', 'still': 'Still there', 'fixed': 'Fixed', 'not-retested': 'Not tested again' };
const SEV = [
  ['serious', 'Serious', 'Blocks or seriously harms the user. Fix first.'],
  ['medium', 'Medium', 'Makes the app harder to use.'],
  ['minor', 'Minor', 'Small polish problems.']
];

const t = r.totals, c = r.comparison;
const summary = t.all === 0
  ? 'No problems were found by the checks that ran.'
  : `${t.all} problem${t.all === 1 ? '' : 's'} found: ${t.serious} serious, ${t.medium} medium, ${t.minor} minor.`;

const changes = c.hasPrevious
  ? `<p class="changes-intro">Compared with the run on ${esc(when(c.previousAt))}:</p>
     <ul class="changes">
       <li><strong>${c.new}</strong> new</li>
       <li><strong>${c.still}</strong> still there</li>
       <li class="good"><strong>${c.fixed}</strong> fixed</li>
       <li><strong>${c.notRetested}</strong> not tested again</li>
     </ul>`
  : `<p class="changes-intro">This is the first run for this website, so there is nothing to compare with yet. Run it again after the team makes changes.</p>`;

const row = i => `
  <li class="issue">
    <p class="issue-head"><span class="status s-${esc(i.status)}">${esc(STATUS[i.status] || i.status)}</span> <strong>${esc(ruleName(i))}</strong></p>
    <p>${esc(i.detail)}</p>
    <p class="meta">Item: ${esc(i.element)} &nbsp;|&nbsp; Where: ${esc(shortPage(i.page))} &nbsp;|&nbsp; Who it affects: ${esc(PERSONA[i.persona] || i.persona)}${i.helpUrl ? ` &nbsp;|&nbsp; <a href="${esc(i.helpUrl)}">How to fix</a>` : ''}</p>
  </li>`;

const sections = SEV.map(([key, label, help]) => {
  const list = r.issues.filter(i => i.severity === key)
    .sort((a, b) => (a.status === 'new' ? -1 : 1) - (b.status === 'new' ? -1 : 1));
  return `<section class="sev sev-${key}" aria-labelledby="h-${key}">
    <h2 id="h-${key}">${label} <span class="count">(${list.length})</span></h2>
    <p class="help">${help}</p>
    ${list.length ? `<ul class="issues">${list.map(row).join('')}</ul>` : '<p class="none">None.</p>'}
  </section>`;
}).join('');

const fixedBlock = r.fixed && r.fixed.length ? `<section class="sev sev-fixed" aria-labelledby="h-fixed">
  <h2 id="h-fixed">Fixed since last run <span class="count">(${r.fixed.length})</span></h2>
  <ul class="issues">${r.fixed.map(row).join('')}</ul></section>` : '';

const notRetestedBlock = r.notRetested && r.notRetested.length ? `<section class="sev sev-unknown" aria-labelledby="h-unk">
  <h2 id="h-unk">Not tested again — status UNKNOWN <span class="count">(${r.notRetested.length})</span></h2>
  <p class="help">These were found last time on pages this run did not reach. They are not marked fixed.</p>
  <ul class="issues">${r.notRetested.map(row).join('')}</ul></section>` : '';

const sec = ms => ms == null ? '—' : (ms / 1000).toFixed(1) + ' s';
const pages = (r.pagesTested || []).map(p => `<tr>
  <td>${esc(shortPage(p.url))}</td><td>${p.status == null ? 'did not open' : esc(p.status)}</td>
  <td>${sec(p.firstTextMs)}</td><td>${sec(p.loadMs)}</td>
  <td>${p.screenshot ? `<a href="${esc(p.screenshot)}">Normal</a>` : '—'}${p.zoomScreenshot ? ` · <a href="${esc(p.zoomScreenshot)}">200% zoom</a>` : ''}</td></tr>`).join('');

const errors = (r.harnessErrors || []).length
  ? `<h3>Checks that failed to run</h3><ul>${r.harnessErrors.map(e => `<li>${esc(e.stage)} on ${esc(shortPage(e.page))}: ${esc(e.message)}</li>`).join('')}</ul>`
  : '<p>Every planned check ran.</p>';

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test report — ${esc(r.target)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root { --ink:#1f2430; --muted:#4a5263; --paper:#ffffff; --panel:#f2f4f7; --line:#d5dae2;
          --serious:#a61b1b; --medium:#8a4b00; --minor:#2b5a86; --fixed:#1e6b34; --unknown:#5b5f6b; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:18px/1.55 "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
  main { max-width: 52rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  h1 { font-size: 2rem; line-height:1.2; margin:0 0 .4rem; }
  h2 { font-size: 1.45rem; margin: 0 0 .25rem; }
  .target { font-size:1.15rem; margin:0; word-break: break-all; }
  .when { color:var(--muted); margin:.2rem 0 1.5rem; }
  .summary { font-size:1.35rem; font-weight:700; margin: 0 0 .5rem; }
  .changes-intro { margin: .5rem 0 .3rem; color:var(--muted); }
  .changes { display:flex; flex-wrap:wrap; gap:.5rem 1.5rem; list-style:none; padding:0; margin:0 0 2rem; }
  .changes li { font-size:1.1rem; } .changes .good strong { color:var(--fixed); }
  .sev { border-left: 6px solid var(--line); padding: .25rem 0 .25rem 1.1rem; margin: 0 0 2.25rem; }
  .sev-serious { border-color: var(--serious); } .sev-serious h2 { color: var(--serious); }
  .sev-medium { border-color: var(--medium); } .sev-medium h2 { color: var(--medium); }
  .sev-minor { border-color: var(--minor); } .sev-minor h2 { color: var(--minor); }
  .sev-fixed { border-color: var(--fixed); } .sev-fixed h2 { color: var(--fixed); }
  .sev-unknown { border-color: var(--unknown); }
  .count { font-weight:400; color:var(--muted); }
  .help { color:var(--muted); margin:0 0 .75rem; }
  .issues { list-style:none; padding:0; margin:0; }
  .issue { border-top:1px solid var(--line); padding: .8rem 0; }
  .issue p { margin: .15rem 0; overflow-wrap:anywhere; }
  .meta { color:var(--muted); font-size: .95rem; }
  .status { display:inline-block; font-size:.85rem; font-weight:700; padding:.05rem .5rem; border-radius:4px; border:1.5px solid currentColor; margin-right:.35rem; }
  .s-new { color: var(--serious); } .s-still { color: var(--muted); } .s-fixed { color: var(--fixed); } .s-not-retested { color: var(--unknown); }
  .none { color:var(--muted); }
  .table-wrap { overflow-x:auto; }
  table { border-collapse: collapse; width:100%; font-size:1rem; }
  th, td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
  th { background: var(--panel); }
  a { color: #1a4fa0; } a:focus-visible { outline:3px solid #1a4fa0; outline-offset:2px; }
  .honest { background: var(--panel); padding: 1rem 1.25rem; border-radius: 6px; margin-top: 2.5rem; }
  .honest h2 { font-size:1.25rem; } .honest h3 { font-size:1.05rem; margin:1rem 0 .25rem; }
  footer { margin-top:2rem; color:var(--muted); font-size:.95rem; }
</style></head>
<body><main>
  <h1>Accessibility and quality test report</h1>
  <p class="target">${esc(r.target)}</p>
  <p class="when">Run on ${esc(when(r.startedAt))} · took ${Math.round((r.durationMs || 0) / 1000)} seconds · ${r.environment && r.environment.loggedIn ? 'logged in' : 'not logged in'} · ${esc(r.environment && r.environment.browser)}</p>
  <p class="summary">${esc(summary)}</p>
  ${changes}
  ${sections}
  ${fixedBlock}
  ${notRetestedBlock}
  <section aria-labelledby="h-pages">
    <h2 id="h-pages">Pages tested (${(r.pagesTested || []).length})</h2>
    <p class="help">"First text" is how long the screen stayed empty. Screenshots open in the same folder as this report.</p>
    <div class="table-wrap"><table>
      <thead><tr><th scope="col">Page</th><th scope="col">Answer</th><th scope="col">First text</th><th scope="col">Fully loaded</th><th scope="col">Screenshots</th></tr></thead>
      <tbody>${pages || '<tr><td colspan="5">No pages could be opened.</td></tr>'}</tbody>
    </table></div>
  </section>
  <section class="honest" aria-labelledby="h-honest">
    <h2 id="h-honest">What this run did not check</h2>
    <ul>${(r.notChecked || []).map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    ${errors}
  </section>
  <footer>Automated Multi-Persona Test Harness · fixed rules, no AI · run ID ${esc(r.runId)}</footer>
</main></body></html>`;

const result = { html, runId: r.runId, target: r.target, totals: r.totals, comparison: r.comparison };
