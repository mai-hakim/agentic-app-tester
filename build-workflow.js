// build-workflow.js — writes workflow.json (the file you import into n8n)
// from the same step files that run-once.js uses, so both always match.
// Optional: TARGET_URL=http://127.0.0.1:4321 node build-workflow.js  (overrides config.json targetUrl for this build only)
const fs = require('fs');
const path = require('path');
const code = f => 'const data = $input.first().json;\n\n' + fs.readFileSync(path.join(__dirname, 'n8n-code', f), 'utf8') + '\nreturn [{ json: result }];';
// Fixed workflow id: n8n 2.x CLI `import:workflow` fails with "NOT NULL constraint failed: workflow_entity.id"
// when the file has no id. A fixed id also means re-importing UPDATES the same workflow instead of adding copies,
// and `n8n execute --id=multiPersonaHrn1` always works.
const WORKFLOW_ID = 'multiPersonaHrn1';
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const nodes = [
  { id: 'a1', name: 'Click to start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
  { id: 'a2', name: 'Settings (website to test)', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [220, 0],
    parameters: { assignments: { assignments: [
      { id: 's1', name: 'targetUrl', value: process.env.TARGET_URL || cfg.targetUrl, type: 'string' },
      { id: 's2', name: 'maxPages', value: cfg.maxPages, type: 'number' } ] }, options: {} } },
  { id: 'a3', name: 'Run the tests', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [440, 0],
    parameters: { method: 'POST', url: 'http://127.0.0.1:3456/run', sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ url: $json.targetUrl, maxPages: $json.maxPages }) }}', options: { timeout: 900000 } } },
  { id: 'a4', name: 'Severity rules', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 0], parameters: { jsCode: code('1-severity-rules.js') } },
  { id: 'a5', name: 'Compare with last run', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 0], parameters: { jsCode: code('2-compare.js') } },
  { id: 'a6', name: 'Build HTML report', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 0], parameters: { jsCode: code('3-build-report.js') } },
  { id: 'a7', name: 'Save report', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1320, 0],
    parameters: { method: 'POST', url: 'http://127.0.0.1:3456/save-report', sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ html: $json.html, runId: $json.runId, target: $json.target }) }}', options: {} } },
  { id: 'a8', name: 'Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -260],
    parameters: { width: 760, height: 200, content:
      '## Automated Multi-Persona Test Harness\nBefore clicking **Test workflow**: the helper server must be running (`npm run server`).\nTo test another website, open **Settings** and change `targetUrl`.\nWhen it finishes, open http://127.0.0.1:3456/report\nFixed rules only. No AI. The low-vision and tremor personas are simulations.' } }
];
const order = ['Click to start', 'Settings (website to test)', 'Run the tests', 'Severity rules', 'Compare with last run', 'Build HTML report', 'Save report'];
const connections = {};
for (let i = 0; i < order.length - 1; i++) connections[order[i]] = { main: [[{ node: order[i + 1], type: 'main', index: 0 }]] };

fs.writeFileSync(path.join(__dirname, 'workflow.json'), JSON.stringify({ id: WORKFLOW_ID, name: 'Automated Multi-Persona Test Harness', active: false, nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} }, null, 2));
console.log('workflow.json written');
