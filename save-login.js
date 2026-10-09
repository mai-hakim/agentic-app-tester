// save-login.js — OPTIONAL. Lets the harness test pages behind a login.
// It opens a real browser window. YOU log in by hand. Then press Enter here.
// The login session is saved to auth.json (no password is stored in the code).
// Then set "useSavedLogin": true in config.json.
// Usage: node save-login.js https://the-site.com/sign-in
const { chromium } = require('playwright');
const readline = require('readline');
(async () => {
  const url = process.argv[2];
  if (!url) { console.log('Usage: node save-login.js https://the-site.com/sign-in'); process.exit(1); }
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  console.log('Log in inside the browser window. When you see the logged-in page, come back here and press Enter.');
  await new Promise(ok => readline.createInterface({ input: process.stdin }).once('line', ok));
  await ctx.storageState({ path: 'auth.json' });
  console.log('Saved to auth.json. Keep this file private — anyone with it is logged in as you.');
  await browser.close(); process.exit(0);
})();
