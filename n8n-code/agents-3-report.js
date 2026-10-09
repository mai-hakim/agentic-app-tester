// STEP: Build the HTML report for the agent run — fixed template, no AI.
const r = data;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SEV = { serious: ['#B42318', 'Serious'], medium: ['#9A4A00', 'Medium'], minor: ['#3F565C', 'Minor'] };
const c = r.consistency, t = r.totals;
const rows = r.issues.map(i => `<tr><td><span class="pill" style="--c:${SEV[i.severity][0]}">${SEV[i.severity][1]}</span></td>
  <td><b>${esc(i.rule)}</b><br><small>${esc(i.check || '')}</small></td><td>${esc(i.element)}<br><small>${esc(i.page)}</small></td>
  <td>${esc(i.aiDescription || i.detail)}${i.aiDescription ? `<br><small>Rule fact: ${esc(i.detail)}</small>` : ''}${i.agentNote ? `<br><small>Agent said: “${esc(i.agentNote)}”</small>` : ''}</td>
  <td>${esc(i.personas.join(', '))}<br><small>${i.runs.length} run(s)${i.foundByAgentReport ? ' · reported by agent + confirmed' : ' · found by check on agent path'}</small></td></tr>`).join('');
const agentRows = c.perPersona.map(p => `<tr><td><b>${esc(p.label)}</b><br><small>${esc(p.task)}</small></td>
  ${p.runs.map(x => `<td>${x.success ? '✅ goal reached' : x.gaveUp ? '✋ gave up' : '⏱ ran out of steps'}<br><small>${x.steps} steps · stuck ${x.stuck}× · new plan ${x.replans}× · ${x.findings} findings</small>${x.answer ? `<br><small>“${esc(x.answer.slice(0, 160))}”</small>` : ''}</td>`).join('')}
  <td>${p.sameOutcome == null ? '—' : p.sameOutcome ? 'same outcome' : '<b>different outcome</b>'}<br><small>finding overlap ${p.findingOverlapPct == null ? '—' : p.findingOverlapPct + '%'}</small></td></tr>`).join('');
const unconf = (r.unconfirmed || []).map(u => `<li><b>${esc(u.kind)}</b> — ${esc(u.persona)} #${u.run}, ${esc(u.element)}: “${esc(u.note)}” <small>(${esc(u.status)})</small></li>`).join('');
const steps = (r.agents || []).map(a => `<details><summary>${esc(a.personaLabel)} — run ${a.run}: ${a.success ? 'goal reached' : 'goal not reached'} in ${a.steps.length} steps</summary><ol>${a.steps.map(s =>
  `<li><b>${esc(s.action)}</b>${s.elementLabel ? ' “' + esc(s.elementLabel) + '”' : ''}${s.text ? ' typed “' + esc(s.text) + '”' : ''} ${s.changed ? '' : '<i>(screen did not change)</i>'}${s.tremorMiss ? ' <i>(shaky tap missed)</i>' : ''}<br><small>Thinks: ${esc(s.plan)}</small></li>`).join('')}</ol></details>`).join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agentic test report — ${esc(r.target)}</title>
<style>body{font:16px/1.5 system-ui,Segoe UI,sans-serif;max-width:1100px;margin:0 auto;padding:16px;color:#0F2A30;background:#EEF3F6}h1,h2{color:#0F6B6B}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}td,th{padding:8px;border-bottom:1px solid #CFDCE1;vertical-align:top;text-align:left}small{color:#3F565C}.pill{display:inline-block;padding:2px 10px;border-radius:99px;border:2px solid var(--c);color:var(--c);font-weight:700}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}.card{background:#fff;border-radius:12px;padding:12px;border:1px solid #CFDCE1}.card b{font-size:1.6em;display:block}details{background:#fff;border-radius:10px;padding:8px 12px;margin:6px 0}.note{background:#DDF0EE;padding:10px 14px;border-radius:12px}</style></head><body>
<h1>Agentic App Tester — report</h1>
<p class="note"><b>Agents explore, rules decide.</b> AI agents (Gemini, free tier) used the app as four simulated people. Every finding below was confirmed by a fixed check; severity comes from fixed rules in n8n. The AI only chose actions and wrote the descriptions.</p>
<p><b>Target:</b> ${esc(r.target)} · <b>Run:</b> ${esc(r.runId)} · ${esc(r.environment && r.environment.browser)} · AI calls: ${r.ai ? r.ai.calls + ' (' + (r.ai.models || []).join(', ') + ')' : '—'}</p>
<div class="cards"><div class="card"><b>${t.all}</b>confirmed findings</div><div class="card"><b>${t.serious}</b>serious</div><div class="card"><b>${t.medium}</b>medium</div><div class="card"><b>${t.minor}</b>minor</div>
<div class="card"><b>${c.goalsReached} / ${c.agentRuns}</b>agent runs reached their goal</div><div class="card"><b>${c.averageFindingOverlapPct == null ? '—' : c.averageFindingOverlapPct + '%'}</b>average finding overlap between runs</div><div class="card"><b>${c.personasWithSameOutcome} / ${c.personas}</b>personas with the same outcome in every run</div></div>
${r.ai && r.ai.reusedSavedRuns ? `<p class="note">${r.ai.reusedSavedRuns} of ${(r.agents || []).length} agent runs were reused from runs saved earlier with the same tool version (the free AI quota had cut other runs short, so only those were run again).</p>` : ''}
<h2>Agents and consistency (each agent ran ${r.settings.runsPerAgent}×)</h2><table><tr><th>Persona and goal</th>${Array.from({ length: r.settings.runsPerAgent }, (_, i) => `<th>Run ${i + 1}</th>`).join('')}<th>Consistency</th></tr>${agentRows}</table>
<h2>Confirmed findings (${t.all})</h2><table><tr><th>Severity</th><th>Rule / check</th><th>Where</th><th>What it means</th><th>Found by</th></tr>${rows || '<tr><td colspan=5>No confirmed findings.</td></tr>'}</table>
<h2>What agents reported that NO fixed check confirmed (${(r.unconfirmed || []).length}) — no severity</h2><ul>${unconf || '<li>None.</li>'}</ul>
<h2>Every step the agents took</h2>${steps}
${(r.harnessErrors || []).length ? '' : ''}<h2>Not checked</h2><ul>${(r.notChecked || []).map(x => '<li>' + esc(x) + '</li>').join('')}</ul>
${(r.harnessErrors || []).length ? '<h2>Tool errors</h2><ul>' + r.harnessErrors.map(e => '<li>' + esc(e.stage) + ': ' + esc(e.message) + '</li>').join('') + '</ul>' : ''}
<p><small>Generated by the n8n workflow "Agentic App Tester". Personas are simulations, not real users.</small></p></body></html>`;
const result = { html, runId: r.runId, target: r.target, totals: t, consistency: c };
