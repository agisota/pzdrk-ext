#!/usr/bin/env node

// ============ CLI ============

const puppeteer = require('puppeteer-core');

function parseArgs(argv) {
  const args = { url: '', openNew: false, port: 9222 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--new') { args.openNew = true; continue; }
    if (a === '--port') { args.port = Number(argv[++i]); continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    rest.push(a);
  }
  args.url = String(rest[0] || '').trim();
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
  process.stdout.write(`\nBrowser skill: navigate\n\n` +
    `Usage:\n` +
    `  .factory/skills/browser/nav.js <url> [--new] [--port 9222]\n\n` +
    `Flags:\n` +
    `  --new         Open a new tab\n` +
    `  --port <n>    Remote debugging port (default: 9222)\n\n`
  );
}

// ============ MAIN ============

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }
  if (!args.url) {
    process.stderr.write('✗ Missing url\n');
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
    const page = args.openNew ? await browser.newPage() : await pickActivePage(browser) || await browser.newPage();
    await page.bringToFront().catch(() => {});
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const title = await page.title().catch(() => '');
    process.stdout.write(`✓ Navigated: ${args.url}${title ? `\n  Title: ${title}` : ''}\n`);
  } finally {
    await browser.disconnect();
  }
})();
