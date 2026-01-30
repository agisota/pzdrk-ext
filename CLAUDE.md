# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Lint
npx eslint *.js

# Load extension
# No build step — load as unpacked extension in chrome://extensions

# Release
git tag v<version> && git push --tags
# → GitHub Actions builds zip artifact
```

## Architecture

Chrome Extension (Manifest V3) for AI-powered page analysis.

```
┌─────────────────────────────────────────────────────────────┐
│                     Chrome Extension                        │
├─────────────────────────────────────────────────────────────┤
│  background.js (Service Worker)                             │
│  ├─ Context menus                                           │
│  ├─ Browser context collection (tabs + history)             │
│  ├─ AI API calls (OpenAI, Groq, xAI)                       │
│  └─ Message routing to content script                       │
├─────────────────────────────────────────────────────────────┤
│  content.js (186KB — main logic)                            │
│  ├─ PROMPTS object — all AI prompt templates                │
│  ├─ UI components (floating notes, mindmap, chat)           │
│  ├─ Page text extraction and truncation                     │
│  ├─ Summary generation and caching                          │
│  └─ Semantic markup parsing [[entity:]], [[action:]], etc.  │
├─────────────────────────────────────────────────────────────┤
│  popup.js / popup.html                                      │
│  └─ Quick actions popup                                     │
├─────────────────────────────────────────────────────────────┤
│  options.js / options.html                                  │
│  └─ Settings: API keys, model selection, custom prompts     │
└─────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Prompt Inheritance
```
MONDAY_PERSONA → STYLE_RULES → PROMPTS.*
```
All Russian AI outputs inherit `MONDAY_PERSONA` (calm, professional, dry sarcasm) through `STYLE_RULES`.

### Semantic Markup
AI outputs use semantic markup for entity extraction:
- `[[entity:Name]]` — named entities
- `[[term:термин]]` — technical terms
- `[[evidence:fact]]` — verifiable claims
- `[[action:step]]` — actionable items

### Storage
- `chrome.storage.sync` — user preferences, API keys
- Cache prefix: `pzdrk_cache_v3_`

### Message Passing
`chrome.runtime.sendMessage` between background ↔ content scripts.

## Code Style

- ES6+ (async/await, arrow functions)
- camelCase vars/functions, UPPER_CASE constants
- `pzdrk-` CSS class prefix
- Section headers: `// ============ SECTION ============`
- Silent fails for non-critical ops, descriptive errors for critical

## CI/CD

- `.github/workflows/ci.yml` — lint + manifest validation + build artifact
- `.github/workflows/release.yml` — tag triggers GitHub Release with zip
- `scripts/chrome-webstore-auth.sh` — OAuth for Chrome Web Store (optional)
