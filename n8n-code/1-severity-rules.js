// STEP: Severity rules (قواعد الخطورة) — fixed rules, no AI.
// Input:  data = { current, previous }   Output: result = same, with "severity" on every issue.
// To change a rule, edit the word next to it: 'serious' (خطير), 'medium' (متوسط), 'minor' (بسيط).
const RULES = {
  'page-not-loading':            'serious', // page does not open
  'page-crash':                  'serious', // JavaScript crashed
  'broken-link':                 'serious', // link leads nowhere
  'blank-screen':                'serious', // empty screen longer than the limit
  'zoom-blocked':                'serious', // user cannot zoom (maximum-scale / user-scalable=no)
  'lowvision-cut-off':           'serious', // text runs off the screen at 200%
  'axe-color-contrast':          'serious', // text too faint — older users are the audience
  'lowvision-horizontal-scroll': 'medium',
  'lowvision-clipped':           'medium',
  'small-font':                  'medium',
  'small-target':                'medium',
  'tremor-wrong-tap':            'medium',
  'console-error':               'medium',
  'failed-request':              'medium',
  'slow-load':                   'medium'
};
// Any other accessibility (axe-core) rule: decided by how bad axe-core says it is.
const AXE_IMPACT = { critical: 'serious', serious: 'medium', moderate: 'minor', minor: 'minor' };

function severityOf(i) {
  if (RULES[i.rule]) return RULES[i.rule];
  if (i.rule.startsWith('axe-')) return AXE_IMPACT[i.impact] || 'minor';
  return 'medium';
}
function tag(run) {
  if (!run || !run.issues) return run || null;
  return { ...run, issues: run.issues.map(i => ({ ...i, severity: severityOf(i) })) };
}
const result = { current: tag(data.current), previous: tag(data.previous), rulesUsed: RULES };
