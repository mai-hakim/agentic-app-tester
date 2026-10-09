// gemini.js — the only place that talks to an AI model (Google Gemini, free tier).
// The key is read from test-harness/.env (never committed, never put in the n8n workflow).
// The AI is used for two things only: choosing the next action, and writing a plain description.
// It never decides severity and never decides whether a problem is real.
const fs = require('fs');
const path = require('path');

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const f = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(f)) return null;
  const m = fs.readFileSync(f, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m);
  const k = m && m[1].trim();
  return k && !/PASTE_YOUR_KEY_HERE/.test(k) ? k : null;
}

// Free tier: a few requests per minute. We wait between calls and fall back to a lighter model on "429 too many requests".
const MODELS = ['gemini-3.1-flash-lite', 'gemini-3.6-flash']; // free tier; each model has its own daily limit (500 requests for the lite models)
const MIN_GAP_MS = 4500;
let last = 0;
const usage = { calls: 0, retries: 0, byModel: {}, failures: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ask({ system, text, imageJpegBase64, schema, temperature = 0.4 }) {
  const key = loadKey();
  if (!key) throw new Error('No Gemini key. Put GEMINI_API_KEY=... in test-harness/.env');
  const parts = [{ text }];
  if (imageJpegBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageJpegBase64 } });
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature, responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) }
  };
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const model = MODELS[Math.min(attempt >= 2 ? 1 : 0, MODELS.length - 1)];
    const wait = last + MIN_GAP_MS - Date.now(); if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body)
      });
      if (res.status === 429 || res.status >= 500) { usage.retries++; lastErr = new Error('HTTP ' + res.status + ' from ' + model); await sleep(attempt < 2 ? 15000 : 30000); continue; }
      const j = await res.json();
      if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + JSON.stringify(j).slice(0, 200));
      const out = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts.map(p => p.text || '').join('');
      usage.calls++; usage.byModel[model] = (usage.byModel[model] || 0) + 1;
      return { model, json: JSON.parse(out) };
    } catch (e) { lastErr = e; usage.retries++; await sleep(5000); }
  }
  usage.failures++;
  throw lastErr || new Error('Gemini failed');
}

module.exports = { ask, loadKey, usage };
