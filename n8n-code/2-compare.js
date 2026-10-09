// STEP: Compare with the previous run (مقارنة بآخر تشغيل) — fixed rules.
// Every issue gets a status: 'new' (جديدة), 'still' (لسه موجودة).
// Issues from last time that are gone become 'fixed' (اتصلحت) — but ONLY if their page was tested again.
// If the page was not tested this time, the issue is 'not-retested' (UNKNOWN), never "fixed".
const cur = data.current;
const prev = data.previous && data.previous.issues && data.previous.target === cur.target ? data.previous : null;
const key = u => { try { const x = new URL(u); return x.origin + x.pathname.replace(/\/$/, ''); } catch (e) { return u; } };
const testedNow = new Set((cur.pagesTested || []).map(p => key(p.url)));
const prevIds = new Set(prev ? prev.issues.map(i => i.id) : []);
const curIds = new Set(cur.issues.map(i => i.id));

const issues = cur.issues.map(i => ({ ...i, status: prev ? (prevIds.has(i.id) ? 'still' : 'new') : 'new' }));
const gone = prev ? prev.issues.filter(i => !curIds.has(i.id)) : [];
const fixed = gone.filter(i => testedNow.has(key(i.page))).map(i => ({ ...i, status: 'fixed' }));
const notRetested = gone.filter(i => !testedNow.has(key(i.page))).map(i => ({ ...i, status: 'not-retested' }));

const count = (list, s) => list.filter(i => i.severity === s).length;
const result = {
  ...cur,
  issues,
  fixed,
  notRetested,
  comparison: prev
    ? { hasPrevious: true, previousRunId: prev.runId, previousAt: prev.startedAt,
        new: issues.filter(i => i.status === 'new').length, still: issues.filter(i => i.status === 'still').length,
        fixed: fixed.length, notRetested: notRetested.length }
    : { hasPrevious: false },
  totals: { serious: count(issues, 'serious'), medium: count(issues, 'medium'), minor: count(issues, 'minor'), all: issues.length }
};
