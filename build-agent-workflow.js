// build-agent-workflow.js — writes agent-workflow.json (import into n8n) from the n8n-code/agents-*.js step files.
// Usage: TARGET_URL=https://... RUNS=2 node build-agent-workflow.js
// No keys are put in the workflow: the Gemini key stays in test-harness/.env, read by the helper server.
const fs = require('fs');
const path = require('path');
const code = f => 'const data = $input.first().json;\n\n' + fs.readFileSync(path.join(__dirname, 'n8n-code', f), 'utf8') + '\nreturn [{ json: result }];';
const WORKFLOW_ID = 'agenticTester01';
const target = process.env.TARGET_URL || 'https://mai-hakim.github.io/papershield/';
const runs = Number(process.env.RUNS || 2);
const nodes = [
  { id: 'b1', name: 'Click to start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
  { id: 'b2', name: 'Settings (app + runs per agent)', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [220, 0],
    parameters: { assignments: { assignments: [
      { id: 't1', name: 'targetUrl', value: target, type: 'string' },
      { id: 't2', name: 'runsPerAgent', value: runs, type: 'number' } ] }, options: {} } },
  { id: 'b3', name: 'AI agents explore (4 personas)', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [440, 0],
    parameters: { method: 'POST', url: 'http://127.0.0.1:3456/agents/run', sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ url: $json.targetUrl, runs: $json.runsPerAgent }) }}', options: { timeout: 7200000 } } },
  { id: 'b4', name: 'Fixed severity rules', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, 0], parameters: { jsCode: code('agents-1-severity.js') } },
  { id: 'b5', name: 'Consistency between runs', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 0], parameters: { jsCode: code('agents-2-consistency.js') } },
  { id: 'b6', name: 'Build HTML report', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 0], parameters: { jsCode: code('agents-3-report.js') } },
  { id: 'b7', name: 'Save report', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1320, 0],
    parameters: { method: 'POST', url: 'http://127.0.0.1:3456/agents/save-report', sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ html: $json.html, runId: $json.runId, target: $json.target }) }}', options: {} } },
  { id: 'b8', name: 'Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [0, -280],
    parameters: { width: 900, height: 220, content:
      '## Agentic App Tester — Agents explore, rules decide\nAI agents (Gemini free tier) play 4 personas: low vision, hand tremor, first-time user, scam-anxious user. They look at the screen, decide where to tap, and change plan when stuck.\nEvery finding must be confirmed by a FIXED check (axe-core, tap size, spacing, font size, zoom, broken links, console errors, dead taps). Severity = fixed rules in "Fixed severity rules". AI never decides severity.\nNeeds: helper server running (`npm run server`) and GEMINI_API_KEY in test-harness/.env (not in this workflow).' } }
];
const order = ['Click to start', 'Settings (app + runs per agent)', 'AI agents explore (4 personas)', 'Fixed severity rules', 'Consistency between runs', 'Build HTML report', 'Save report'];
const connections = {};
for (let i = 0; i < order.length - 1; i++) connections[order[i]] = { main: [[{ node: order[i + 1], type: 'main', index: 0 }]] };
fs.writeFileSync(path.join(__dirname, 'agent-workflow.json'), JSON.stringify({ id: WORKFLOW_ID, name: 'Agentic App Tester', active: false, nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} }, null, 2));
console.log('agent-workflow.json written for', target);
