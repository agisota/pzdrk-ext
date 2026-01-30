#!/usr/bin/env node

// ============ CLI ============

const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');

function parseArgs(argv) {
  const args = { port: 9222, out: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') { args.port = Number(argv[++i]); continue; }
    if (a === '--out') { args.out = String(argv[++i] || ''); continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    rest.push(a);
  }
  args._ = rest;
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

function pad2(n) { return String(n).padStart(2, '0'); }

function defaultOutPath() {
  const tmp = String(process.env.TMPDIR || '').trim() || os.tmpdir();
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return path.join(tmp, `factory-browser-screenshot-${stamp}.png`);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function printHelp() {
  process.stdout.write(`\nBrowser skill: screenshot\n\n` +
    `Usage:\n` +
    `  .factory/skills/browser/screenshot.js [--out /path/to/file.png] [--port 9222]\n\n`
  );
}

// ============ MAIN ============

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

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

    const out = String(args.out || '').trim() || defaultOutPath();
    ensureDir(path.dirname(out));
    await page.screenshot({ path: out, fullPage: false });
    process.stdout.write(out + '\n');
  } finally {
    await browser.disconnect();
  }
})();
