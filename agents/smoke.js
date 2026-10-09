const { runAgents } = require('./agent-runner');
(async () => { const r = await runAgents({ url: process.argv[2], personas: [process.argv[3]], runs: 1 });
  require('fs').writeFileSync(__dirname + '/../results/agent-smoke.json', JSON.stringify(r, null, 2));
  const a = r.agents[0]; console.log('success', a && a.success, 'steps', a && a.steps.length, 'answer:', a && a.answer);
  a && a.steps.forEach(s => console.log(s.step, s.action, JSON.stringify(s.elementLabel), s.changed ? 'changed' : 'same', s.difficulty, '|', (s.plan||'').slice(0,90)));
  console.log('issues', r.issues.length, 'unconfirmed', r.unconfirmed.length, 'errors', JSON.stringify(r.harnessErrors), 'ai', JSON.stringify(r.ai)); })();
