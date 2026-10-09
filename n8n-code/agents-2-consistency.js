// STEP: How consistent were the agents? — fixed maths, no AI.
// Each agent ran at least twice. For each persona we compare its runs:
//  - did both runs reach the goal (same outcome)?
//  - overlap of confirmed findings between runs (Jaccard: shared / all, 100% = identical)
//  - number of steps used
const cur = data.current;
const raw = cur.agents || [];
const personas = [...new Set(raw.map(a => a.persona))];
// raw per-run finding ids (before merge) are rebuilt from the merged rows' "runs" lists
const idsFor = (persona, run) => new Set(cur.issues.filter(i => i.runs.includes(persona + ' #' + run)).map(i => i.id));
const pct = x => Math.round(x * 100);
const perPersona = personas.map(p => {
  const runs = raw.filter(a => a.persona === p).sort((a, b) => a.run - b.run);
  const sets = runs.map(r => idsFor(p, r.run));
  let jac = null;
  if (sets.length >= 2) {
    const [a, b] = sets; const all = new Set([...a, ...b]); const both = [...a].filter(x => b.has(x)).length;
    jac = all.size ? both / all.size : 1;
  }
  return {
    persona: p, label: runs[0] && runs[0].personaLabel, task: runs[0] && runs[0].task,
    runs: runs.map(r => ({ run: r.run, success: r.success, gaveUp: r.gaveUp, steps: r.steps.length, stuck: r.stuckEvents, replans: r.replans, answer: r.answer, findings: idsFor(p, r.run).size })),
    sameOutcome: runs.length >= 2 ? runs.every(r => r.success === runs[0].success) : null,
    findingOverlapPct: jac == null ? null : pct(jac),
    stepsRange: runs.length ? [Math.min(...runs.map(r => r.steps.length)), Math.max(...runs.map(r => r.steps.length))] : null
  };
});
const withOverlap = perPersona.filter(p => p.findingOverlapPct != null);
const result = {
  ...cur,
  consistency: {
    perPersona,
    averageFindingOverlapPct: withOverlap.length ? Math.round(withOverlap.reduce((s, p) => s + p.findingOverlapPct, 0) / withOverlap.length) : null,
    personasWithSameOutcome: perPersona.filter(p => p.sameOutcome).length,
    personas: perPersona.length,
    goalsReached: raw.filter(a => a.success).length, agentRuns: raw.length
  },
  totals: { serious: cur.issues.filter(i => i.severity === 'serious').length, medium: cur.issues.filter(i => i.severity === 'medium').length, minor: cur.issues.filter(i => i.severity === 'minor').length, all: cur.issues.length,
    confirmedFromAgentReports: cur.issues.filter(i => i.foundByAgentReport).length, unconfirmedAgentReports: (cur.unconfirmed || []).length }
};
