// Runs the 3 n8n Code steps outside n8n on a saved agent result (for checking only).
const fs = require('fs'), path = require('path');
const step = (f, data) => new Function('data', fs.readFileSync(path.join(__dirname, '..', 'n8n-code', f), 'utf8') + '\nreturn result;')(data);
const cur = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let d = step('agents-1-severity.js', { current: cur, previous: null });
d = step('agents-2-consistency.js', d);
const r = step('agents-3-report.js', d);
fs.writeFileSync(process.argv[3] || 'pipe-test.html', r.html);
console.log(JSON.stringify(r.totals), JSON.stringify(r.consistency.perPersona.map(p => [p.persona, p.sameOutcome, p.findingOverlapPct])));
