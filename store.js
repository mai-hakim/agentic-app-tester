// store.js — saves every run, remembers the last run PER WEBSITE, saves reports.
const fs = require('fs');
const path = require('path');
const RESULTS = path.join(__dirname, 'results');
const REPORTS = path.join(__dirname, 'reports');
fs.mkdirSync(RESULTS, { recursive: true });
fs.mkdirSync(REPORTS, { recursive: true });

const siteName = (url) => { try { return new URL(url).host.replace(/[^a-z0-9.-]/gi, '_'); } catch { return 'unknown-site'; } };
const latestFile = (url) => path.join(RESULTS, `latest-${siteName(url)}.json`);

function loadPrevious(url) {
  try { return JSON.parse(fs.readFileSync(latestFile(url), 'utf8')); } catch { return null; }
}
function saveRun(run) {
  fs.writeFileSync(path.join(RESULTS, `run-${siteName(run.target)}-${run.runId}.json`), JSON.stringify(run, null, 2));
  fs.writeFileSync(latestFile(run.target), JSON.stringify(run, null, 2));
}
function saveReport(html, runId, target) {
  const name = `report-${siteName(target)}-${runId}.html`;
  fs.writeFileSync(path.join(REPORTS, name), html);
  fs.writeFileSync(path.join(REPORTS, 'latest.html'), html);
  return { file: path.join(REPORTS, name), latest: path.join(REPORTS, 'latest.html') };
}
module.exports = { loadPrevious, saveRun, saveReport, REPORTS };
