// STEP: Severity rules for agent findings — fixed rules, no AI.
// Input:  data = { current, previous }   Output: result = same, with "severity" on every finding,
// and the same finding found by several agents/runs merged into one row.
const RULES = {
  'page-not-loading': 'serious', 'page-crash': 'serious', 'broken-link': 'serious', 'zoom-blocked': 'serious',
  'lowvision-cut-off': 'serious', 'axe-color-contrast': 'serious',
  'lowvision-horizontal-scroll': 'medium', 'small-font': 'medium', 'small-target': 'medium', 'tremor-wrong-tap': 'medium',
  'dead-tap': 'medium', 'console-error': 'medium'
};
const AXE_IMPACT = { critical: 'serious', serious: 'medium', moderate: 'minor', minor: 'minor' };
const severityOf = i => RULES[i.rule] || (i.rule.startsWith('axe-') ? (AXE_IMPACT[i.impact] || 'minor') : 'medium');

function merge(run) {
  if (!run || !run.issues) return run || null;
  const byId = new Map();
  for (const i of run.issues) {
    const k = i.id;
    if (!byId.has(k)) byId.set(k, { ...i, severity: severityOf(i), personas: [], runs: [], foundByAgentReport: false });
    const m = byId.get(k);
    const who = i.persona + ' #' + i.run;
    if (!m.runs.includes(who)) m.runs.push(who);
    if (!m.personas.includes(i.persona)) m.personas.push(i.persona);
    if (i.foundBy === 'agent-report+check') { m.foundByAgentReport = true; m.agentNote = m.agentNote || i.agentNote; }
    if (!m.aiDescription && i.aiDescription) m.aiDescription = i.aiDescription;
  }
  const order = { serious: 0, medium: 1, minor: 2 };
  const issues = [...byId.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.runs.length - a.runs.length);
  return { ...run, rawFindings: run.issues.length, issues };
}
const result = { current: merge(data.current), previous: merge(data.previous), rulesUsed: RULES };
