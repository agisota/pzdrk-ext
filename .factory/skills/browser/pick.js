#!/usr/bin/env node

// ============ CLI ============

const puppeteer = require('puppeteer-core');

function parseArgs(argv) {
  const args = { prompt: '', port: 9222 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') { args.port = Number(argv[++i]); continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    rest.push(a);
  }
  args.prompt = String(rest[0] || '').trim();
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
  process.stdout.write(`\nBrowser skill: pick DOM elements\n\n` +
    `Usage:\n` +
    `  .factory/skills/browser/pick.js "Click the submit button" [--port 9222]\n\n` +
    `Controls:\n` +
    `  Click          Select\n` +
    `  Cmd/Ctrl+Click Multi-select\n` +
    `  Enter          Finish\n` +
    `  Escape         Cancel\n\n`
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
    await page.bringToFront().catch(() => {});

    const prompt = args.prompt || 'Click an element to capture metadata';

    const picked = await page.evaluate((promptText) => {
      const make = (tag, attrs = {}, children = []) => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
        for (const c of children) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        return el;
      };

      const state = {
        selected: new Set(),
        hoverEl: null,
        resolve: null
      };

      const style = make('style', {}, [
        `#factory-pick-overlay{position:fixed;inset:0;z-index:2147483647;pointer-events:none;}` +
        `#factory-pick-hud{position:fixed;top:12px;left:12px;max-width:520px;padding:10px 12px;border-radius:10px;` +
        `background:rgba(10,10,16,0.72);border:1px solid rgba(255,255,255,0.10);color:rgba(255,255,255,0.92);` +
        `font:12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,sans-serif;backdrop-filter:blur(14px);}` +
        `#factory-pick-hint{opacity:0.75;font-size:11px;margin-top:4px;}` +
        `#factory-pick-box{position:fixed;border:2px solid rgba(0,217,255,0.95);border-radius:6px;box-shadow:0 0 0 2px rgba(0,217,255,0.12);pointer-events:none;}` +
        `.factory-pick-selected{outline:2px solid rgba(255, 183, 77, 0.95) !important;outline-offset:2px;}`
      ]);

      const overlay = make('div', { id: 'factory-pick-overlay' });
      const hud = make('div', { id: 'factory-pick-hud' }, [
        make('div', {}, [promptText]),
        make('div', { id: 'factory-pick-hint' }, ['Click to select • Cmd/Ctrl+Click multi • Enter finish • Esc cancel'])
      ]);
      const box = make('div', { id: 'factory-pick-box' });
      overlay.appendChild(hud);
      overlay.appendChild(box);
      document.documentElement.appendChild(style);
      document.documentElement.appendChild(overlay);

      const cssPath = (el) => {
        if (!el || !el.nodeType || el.nodeType !== 1) return '';
        if (el.id) return `#${el.id}`;
        const parts = [];
        let cur = el;
        for (let i = 0; i < 5 && cur && cur.nodeType === 1; i++) {
          const tag = cur.tagName.toLowerCase();
          let part = tag;
          const cls = String(cur.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (cls.length) part += '.' + cls.join('.');
          const parent = cur.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
            if (siblings.length > 1) {
              const idx = siblings.indexOf(cur) + 1;
              part += `:nth-of-type(${idx})`;
            }
          }
          parts.unshift(part);
          cur = parent;
        }
        return parts.join(' > ');
      };

      const metaFor = (el) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id || '';
        const className = String(el.className || '').trim();
        const classes = className ? className.split(/\s+/).filter(Boolean).slice(0, 6) : [];
        const text = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        const ariaLabel = el.getAttribute('aria-label') || '';
        const name = el.getAttribute('name') || '';
        const href = el.getAttribute('href') || '';
        const role = el.getAttribute('role') || '';
        return { tag, id, classes, text, ariaLabel, name, href, role, selector: cssPath(el) };
      };

      const updateBox = (el) => {
        if (!el) { box.style.display = 'none'; return; }
        const r = el.getBoundingClientRect();
        box.style.display = 'block';
        box.style.left = `${Math.max(0, r.left)}px`;
        box.style.top = `${Math.max(0, r.top)}px`;
        box.style.width = `${Math.max(0, r.width)}px`;
        box.style.height = `${Math.max(0, r.height)}px`;
      };

      const onMove = (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === overlay || el === hud || el === box || el === document.documentElement) return;
        state.hoverEl = el;
        updateBox(el);
      };

      const toggleSelected = (el) => {
        if (!el) return;
        if (state.selected.has(el)) {
          state.selected.delete(el);
          el.classList.remove('factory-pick-selected');
        } else {
          state.selected.add(el);
          el.classList.add('factory-pick-selected');
        }
        hud.firstChild.textContent = `${promptText} — selected: ${state.selected.size}`;
      };

      const onClick = (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === overlay || el === hud || el === box || el === document.documentElement) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey) {
          toggleSelected(el);
        } else {
          state.selected.forEach(x => x.classList.remove('factory-pick-selected'));
          state.selected.clear();
          state.selected.add(el);
          el.classList.add('factory-pick-selected');
          hud.firstChild.textContent = `${promptText} — selected: 1`;
        }
      };

      const cleanup = () => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        try { state.selected.forEach(x => x.classList.remove('factory-pick-selected')); } catch (e) {}
        try { overlay.remove(); } catch (e) {}
        try { style.remove(); } catch (e) {}
      };

      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          state.resolve([]);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const out = Array.from(state.selected).map(metaFor);
          cleanup();
          state.resolve(out);
        }
      };

      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);

      return new Promise((resolve) => {
        state.resolve = resolve;
        hud.firstChild.textContent = promptText;
      });
    }, prompt);

    process.stdout.write(JSON.stringify({ picked }, null, 2) + '\n');
  } finally {
    await browser.disconnect();
  }
})();
