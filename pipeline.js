// pipeline.js — runs the SAME three n8n steps (severity → compare → report) outside n8n.
// Used by run-once.js so you can test, and as a backup if n8n is not available.
const fs = require('fs');
const path = require('path');
const STEPS = ['1-severity-rules.js', '2-compare.js', '3-build-report.js'];

function runStep(file, data) {
  const body = fs.readFileSync(path.join(__dirname, 'n8n-code', file), 'utf8');
  return new Function('data', body + '\nreturn result;')(data);
}
function runPipeline(current, previous) {
  let data = { current, previous };
  for (const f of STEPS) data = runStep(f, data);
  return data;
}
module.exports = { runPipeline, STEPS };
