#!/usr/bin/env node

// ============ CLI PARSING ============

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    port: 9222,
    profile: false,
    connect: false,
    userDataDir: '',
    loadExtension: '',
    chromePath: '',
    disableExtensionsExcept: true
  };

  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--profile') { args.profile = true; continue; }
    if (a === '--connect') { args.connect = true; continue; }
    if (a === '--port') { args.port = Number(argv[++i]); continue; }
    if (a === '--user-data-dir') { args.userDataDir = String(argv[++i] || ''); continue; }
    if (a === '--load-extension' || a === '--extension') { args.loadExtension = String(argv[++i] || ''); continue; }
    if (a === '--chrome-path') { args.chromePath = String(argv[++i] || ''); continue; }
    if (a === '--no-disable-extensions-except') { args.disableExtensionsExcept = false; continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    rest.push(a);
  }
  args._ = rest;
  return args;
}

function expandHome(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  if (s.startsWith('~/')) return path.join(os.homedir(), s.slice(2));
  return s;
}

function resolveTmpDir() {
  const base = String(process.env.TMPDIR || '').trim();
  if (base) return base;
  return os.tmpdir();
}

function findChromeExecutable(explicitPath) {
  const p = expandHome(explicitPath);
  if (p && fs.existsSync(p)) return p;

  const env = String(process.env.CHROME_PATH || '').trim();
  if (env && fs.existsSync(env)) return env;

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  const which = (bin) => {
    try {
      const out = spawnSync('which', [bin], { encoding: 'utf8' });
      const loc = String(out.stdout || '').trim();
      return loc && fs.existsSync(loc) ? loc : '';
    } catch (e) {
      return '';
    }
  };

  return which('google-chrome') || which('chromium') || which('chromium-browser') || which('chrome') || '';
}

async function chromeIsUp(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { method: 'GET' });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return !!(json && json.webSocketDebuggerUrl);
  } catch (e) {
    return false;
  }
}

async function waitForChrome(port, timeoutMs = 15000) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    if (await chromeIsUp(port)) return true;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function enableDeveloperMode(userDataDir) {
  const prefsPath = path.join(userDataDir, 'Default', 'Preferences');
  ensureDir(path.dirname(prefsPath));
  let prefs = {};
  try {
    if (fs.existsSync(prefsPath)) prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
  } catch (e) {}
  if (!prefs.extensions) prefs.extensions = {};
  if (!prefs.extensions.ui) prefs.extensions.ui = {};
  prefs.extensions.ui.developer_mode = true;
  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), 'utf8');
}

function safeCopyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dst));
  fs.cpSync(src, dst, { recursive: true, force: true, errorOnExist: false });
}

function safeCopyFile(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dst));
  fs.cpSync(src, dst, { force: true });
}

function getDefaultChromeUserDataDir() {
  const home = os.homedir();
  const mac = [
    path.join(home, 'Library/Application Support/Google/Chrome'),
    path.join(home, 'Library/Application Support/Google/Chrome Canary'),
    path.join(home, 'Library/Application Support/Chromium')
  ];
  for (const p of mac) {
    if (fs.existsSync(p)) return p;
  }

  // Linux fallbacks
  const linux = [
    path.join(home, '.config/google-chrome'),
    path.join(home, '.config/chromium')
  ];
  for (const p of linux) {
    if (fs.existsSync(p)) return p;
  }

  return '';
}

function printHelp() {
  process.stdout.write(`\nBrowser skill: start Chrome with remote debugging\n\n` +
    `Usage:\n` +
    `  .factory/skills/browser/start.js [--profile] [--port 9222] [--load-extension /abs/path] [--connect]\n\n` +
    `Flags:\n` +
    `  --connect                     Connect to existing Chrome on --port (don't launch new instance)\n` +
    `  --profile                     Copy your Chrome profile into a temp user-data-dir (best effort)\n` +
    `  --port <n>                    Remote debugging port (default: 9222)\n` +
    `  --user-data-dir <path>        Override user-data-dir (default: $TMPDIR/factory-browser-skill/chrome-user-data[-profile])\n` +
    `  --load-extension <path>       Load unpacked extension; also sets --disable-extensions-except unless disabled\n` +
    `  --no-disable-extensions-except Keep other extensions enabled when --load-extension is used\n` +
    `  --chrome-path <path>          Explicit Chrome executable path\n\n` +
    `To use with your existing Chrome (Developer mode already enabled):\n` +
    `  1. Quit Chrome completely\n` +
    `  2. Start Chrome manually: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n` +
    `  3. Run: .factory/skills/browser/start.js --connect\n\n`
  );
}

// ============ MAIN ============

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); process.exit(0); }

  const port = Number.isFinite(Number(args.port)) ? Math.max(1, Math.min(65535, Math.round(Number(args.port)))) : 9222;

  if (await chromeIsUp(port)) {
    process.stdout.write(`✓ Chrome already listening on :${port}\n`);
    process.exit(0);
  }

  if (args.connect) {
    process.stderr.write(`✗ No Chrome found on :${port}. Start Chrome with --remote-debugging-port=${port} first.\n`);
    process.exit(2);
  }

  const tmp = resolveTmpDir();
  const baseDir = path.join(tmp, 'factory-browser-skill');
  ensureDir(baseDir);

  const loadExtension = expandHome(args.loadExtension);
  const hasExt = !!(loadExtension && fs.existsSync(loadExtension));
  const profileSuffix = args.profile ? 'profile' : 'fresh';
  const extSuffix = hasExt ? '-ext' : '';
  const defaultUserDataDir = path.join(baseDir, `chrome-user-data-${profileSuffix}${extSuffix}`);
  const userDataDir = expandHome(args.userDataDir) || defaultUserDataDir;

  if (args.profile && !fs.existsSync(userDataDir)) {
    const src = getDefaultChromeUserDataDir();
    if (!src) {
      process.stderr.write('✗ Could not locate your Chrome user data directory for --profile\n');
      process.exit(2);
    }
    process.stdout.write(`Copying Chrome profile (best effort) → ${userDataDir}\n`);
    ensureDir(userDataDir);
    safeCopyFile(path.join(src, 'Local State'), path.join(userDataDir, 'Local State'));
    safeCopyDir(path.join(src, 'Default'), path.join(userDataDir, 'Default'));
  } else {
    ensureDir(userDataDir);
  }

  if (hasExt) {
    enableDeveloperMode(userDataDir);
  }

  const chrome = findChromeExecutable(args.chromePath);
  if (!chrome) {
    process.stderr.write('✗ Chrome executable not found. Set CHROME_PATH or pass --chrome-path\n');
    process.exit(2);
  }

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-features=ExtensionsToolbarMenu'
  ];

  if (hasExt) {
    chromeArgs.push(`--load-extension=${loadExtension}`);
    chromeArgs.push(`--disable-extensions-except=${loadExtension}`);
    chromeArgs.push('--enable-automation');
  }

  const child = spawn(chrome, chromeArgs, {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  const ok = await waitForChrome(port, 20000);
  if (!ok) {
    process.stderr.write(`✗ Chrome did not start on :${port}. Try closing existing Chrome debug instances.\n`);
    process.exit(2);
  }

  process.stdout.write(`✓ Chrome started on :${port}${args.profile ? ' with profile copy' : ''}${hasExt ? ' (extension loaded)' : ''}\n`);
  process.stdout.write(`  Debug endpoint: http://127.0.0.1:${port}/json/version\n`);
})();
