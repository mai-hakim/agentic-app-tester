// run-once.js — test the harness WITHOUT n8n.
// Usage:  node run-once.js                 (uses targetUrl from config.json)
//         node run-once.js https://site.com (test any website)
const { runAll } = require('./runner');
const { runPipeline } = require('./pipeline');
const store = require('./store');

(async () => {
  const url = process.argv[2];
  const opts = url ? { targetUrl: url } : {};
  console.log('Testing', url || '(targetUrl from config.json)', '... this can take 1-3 minutes.');
  const current = await runAll(opts);
  const previous = store.loadPrevious(current.target);
  const out = runPipeline(current, previous);
  store.saveRun(current);
  const saved = store.saveReport(out.html, out.runId, out.target);
  console.log('\nDONE');
  console.log('Pages tested:', current.pagesTested.length);
  console.log('Problems   :', out.totals.all, `(serious ${out.totals.serious}, medium ${out.totals.medium}, minor ${out.totals.minor})`);
  if (out.comparison.hasPrevious) console.log('Compared   :', `new ${out.comparison.new}, still ${out.comparison.still}, fixed ${out.comparison.fixed}`);
  if (current.harnessErrors.length) console.log('Checks that failed to run:', current.harnessErrors.length);
  console.log('Report     :', saved.latest);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
