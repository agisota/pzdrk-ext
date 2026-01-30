---
name: browser
description: Minimal Chrome DevTools Protocol helpers for local Chrome automation and evidence capture.
---

# Browser Automation Skill

Minimal CDP helpers for Chrome automation and extension testing.

## Setup

```bash
npm install --prefix .factory/skills/browser
chmod +x .factory/skills/browser/*.js
```

## Option 1: Connect to Your Existing Chrome (Recommended for Extension Testing)

This preserves Developer mode and loaded extensions:

```bash
# 1. Quit Chrome completely
# 2. Start Chrome with remote debugging:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# 3. Verify connection:
.factory/skills/browser/start.js --connect
```

## Option 2: Start Fresh Chrome (No Extension)

```bash
.factory/skills/browser/start.js                    # Fresh profile
.factory/skills/browser/start.js --profile          # Copy your profile
```

Note: `--load-extension` requires Developer mode enabled manually in Chrome.

## Navigate

```bash
.factory/skills/browser/nav.js https://example.com --new
```

## Evaluate JavaScript

```bash
.factory/skills/browser/eval.js 'document.title'
.factory/skills/browser/eval.js '(() => ({ links: document.querySelectorAll("a").length }))()' --json
```

## Screenshot

```bash
.factory/skills/browser/screenshot.js
```

Returns a PNG path in `$TMPDIR`.

## Pick DOM elements

```bash
.factory/skills/browser/pick.js "Click the submit button"
```

Click to select, Cmd/Ctrl+Click for multi-select, Enter to finish, Esc to cancel.

## Automated Extension Tests

Run without Chrome (validates code structure, syntax, manifest, security):

```bash
.factory/skills/browser/test-extension.js
```

Tests include:
- Manifest validation (MV3, files exist, icons)
- JavaScript syntax check (all .js files)
- Background message handlers (callGroq, searchExa, etc.)
- Content script structure (getSettings, summarizePage, createNote)
- Options page DOM/JS consistency
- Multi-provider integration (Groq, Cerebras, key rotation)
- Security basics (no key logging, labeled defaults only)
