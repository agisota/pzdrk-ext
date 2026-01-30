#!/usr/bin/env node

// ============ CLI ============

const puppeteer = require('puppeteer-core');

function parseArgs(argv) {
  const args = { code: '', port: 9222, json: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') { args.port = Number(argv[++i]); continue; }
    if (a === '--json') { args.json = true; continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    rest.push(a);
  }
  args.code = String(rest[0] || '').trim();
  return args;
}

function isUsablePageUrl(u) {
  const s = String(u || '');
  if (!s) return false;
  if (s.startsWith('chrome://')) return false;
  if (s.startsWith('chrome-extension://')) return false;
  if (s.startsWith('devtools://')) return false;
  return true;
}

async function pickActivePage(browser) {
  const pages = await browser.pages();
  const usable = pages.filter(p => isUsablePageUrl(p.url()));
  return usable[usable.length - 1] || pages[pages.length - 1] || null;
}

function printHelp() {
  process.stdout.write(`\nBrowser skill: eval JavaScript\n\n` +
    `Usage:\n` +
    `  .factory/skills/browser/eval.js '<expression-or-iife>' [--json] [--port 9222]\n\n` +
    `Examples:\n` +
    `  .factory/skills/browser/eval.js 'document.title'\n` +
    `  .factory/skills/browser/eval.js '(() => ({ links: [...document.querySelectorAll("a")].length }))()' --json\n\n`
  );
}

// ============ MAIN ============

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }
  if (!args.code) {
    process.stderr.write('✗ Missing code string\n');
    process.exit(2);
  }

  const port = Number.isFinite(Number(args.port)) ? Math.max(1, Math.min(65535, Math.round(Number(args.port)))) : 9222;
  const browserURL = `http://127.0.0.1:${port}`;

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL });
  } catch (e) {
    process.stderr.write(`✗ Could not connect to Chrome on :${port}. Run start.js first.\n`);
    process.exit(2);
  }

  try {
    const page = await pickActivePage(browser);
    if (!page) {
      process.stderr.write('✗ No active page found\n');
      process.exit(2);
    }

    const result = await page.evaluate(async (code) => {
      try {
        const out = (0, eval)(code);
        return await Promise.resolve(out);
      } catch (e) {
        return { __eval_error: String(e?.message || e || 'error') };
      }
    }, args.code);

    if (result && typeof result === 'object' && result.__eval_error) {
      process.stderr.write(`✗ Eval error: ${result.__eval_error}\n`);
      process.exit(2);
    }

    if (args.json || (result && typeof result === 'object')) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(String(result) + '\n');
    }
  } finally {
    await browser.disconnect();
  }
})();
