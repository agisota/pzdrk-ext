# AGENTS.md — pzdrk Browser Extension

## Project Overview

**pzdrk** (v6.4.0) is a Chrome Extension (Manifest V3) that provides AI-powered page analysis with a glassmorphism UI. It generates summaries, mindmaps, translations, and voice interactions using LLM APIs.

**Key Features:**
- AI page analysis with Russian-language outputs using the "Monday" persona
- Floating glassmorphism UI notes with draggable interface
- Privacy protection via tracker/ad blocking (declarativeNetRequest)
- Voice chat via xAI Realtime API
- Two-column structured JSON summaries
- Mindmap generation with expandable nodes
- Page translation and selection explanation

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Extension API | Chrome Manifest V3 |
| JavaScript | ES2022 (vanilla, no build step) |
| Styling | CSS with glassmorphism effects |
| Storage | `chrome.storage.sync` (settings), `localStorage` (cache) |
| AI APIs | Groq, Cerebras, xAI, Exa |
| CI/CD | GitHub Actions |

---

## Project Structure

```
├── manifest.json          # Manifest V3 configuration
├── background.js          # Service worker (~800 lines)
│   ├── Context menu handlers
│   ├── AI API routing (Groq/Cerebras with key rotation)
│   ├── xAI Realtime token management
│   ├── Exa search integration
│   ├── Browser context collection (tabs + history)
│   └── Tracker blocking stats
├── content.js             # Main content script (~5200 lines)
│   ├── PROMPTS object (all AI prompt templates)
│   ├── UI components (floating notes, mindmap, chat)
│   ├── Page text extraction and token estimation
│   ├── Summary generation with caching
│   ├── Semantic markup parsing [[entity:]], [[action:]], etc.
│   └── Voice recording and playback (WebSocket, Web Audio API)
├── content.css            # Glassmorphism styling (~800 lines)
├── popup.js / popup.html  # Quick actions popup
├── options.js / options.html  # Settings page
├── rules/blocklist.json   # Tracker/ad blocking rules (60 domains)
├── icons/                 # Extension icons
├── scripts/               # Utility scripts (Chrome Web Store auth)
└── .github/workflows/     # CI/CD pipelines
```

---

## Build/Lint/Test Commands

```bash
# Lint JavaScript
npx eslint *.js

# No build step required — load as unpacked extension:
# 1. Open chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select project directory

# Release (creates Git tag, triggers GitHub Actions)
git tag v<version> && git push --tags
```

---

## Code Style Guidelines

### JavaScript
- **Standard**: ES2022 with async/await, arrow functions, destructuring
- **Naming**: camelCase for variables/functions, UPPER_CASE for constants
- **Globals**: `chrome` is available globally (webextensions env)
- **Quotes**: Single quotes preferred
- **Indent**: 2 spaces
- **Semicolons**: Required

### CSS
- **Prefix**: All classes use `pzdrk-` prefix to avoid conflicts
- **Design System**: Glassmorphism (transparency + blur + shadows)
- **Custom Properties**: Defined in `:root` in content.css
- **Opacity**: Use 3-digit precision (e.g., `0.085`)

### Comments
- Section headers: `// ============ SECTION NAME ============`
- Inline comments for non-obvious logic

### Storage
- User preferences: `chrome.storage.sync`
- Cache: `localStorage` with prefix `pzdrk_cache_v3_`
- Cache expiry: 7 days

### Message Passing
- Background ↔ Content: `chrome.runtime.sendMessage`
- All handlers return Promise for async operations

### Error Handling
- Critical errors: Descriptive messages with context
- Non-critical errors: Silent fails (best effort)
- Never log API keys

---

## Architecture Details

### AI Persona System (Russian Language)

All Russian AI outputs inherit the "Monday" persona:

```
MONDAY_PERSONA → STYLE_RULES → PROMPTS.*
```

**MONDAY_PERSONA Characteristics:**
- Tone: Calm, professional, laconic
- Sarcasm: Minimal (0–1 short phrase per response)
- Forbidden: "*вздох*", whining, hysteria, excessive emotions
- Evidence-based: Separate facts from assumptions
- Language: Simple Russian

### Semantic Markup Syntax

AI outputs use semantic markup for entity extraction:

| Syntax | Purpose | Example |
|--------|---------|---------|
| `[[entity:Name]]` | Named entities (people, companies, products) | `[[entity:OpenAI]]` |
| `[[term:термин]]` | Technical terms requiring definition | `[[term:transformer]]` |
| `[[wiki:article]]` | Wikipedia reference | `[[wiki:Machine Learning]]` |
| `[[evidence:fact]]` | Verifiable claims | `[[evidence:GPT-4 released 2023]]` |
| `[[action:step]]` | Actionable items | `[[action:Review docs]]` |

### Prompt Variables

Standard template variables available in prompts:

| Variable | Source | Description |
|----------|--------|-------------|
| `{url}` | Page | Current page URL |
| `{title}` | Page | Page title |
| `{content}` | Page | Truncated page text |
| `{summary}` | AI | Generated summary |
| `{browserContext}` | Background | Tabs + history + pathway |
| `{tags}` | Settings | User-defined tags |
| `{selection}` | User | Selected text |

### LLM Provider Routing

**Primary:** Groq (default)
- Default model: `moonshotai/kimi-k2-instruct-0905`
- Built-in key available (BYOK mode optional)

**Fallback:** Cerebras
- Models: `gpt-oss-120b`, `llama-3.3-70b`, `qwen-3-32b`, etc.
- BYOK only (no built-in key)

**Key Rotation:** Multiple API keys supported with cooldown handling on rate limits.

### UI Components

**Note System (`createNote`):**
- Glassmorphism floating panels
- Draggable and resizable
- Collapsible/expandable
- Token count badges
- Action panels (right-side flyouts)
- Per-note chat history

**Voice Features:**
- Browser TTS fallback
- xAI Grok voice API
- xAI Realtime WebSocket (low-latency conversation)
- Voice recording via MediaRecorder API

---

## Security Considerations

1. **API Keys:**
   - Built-in keys for Groq/xAI (limited quota)
   - BYOK mode for unlimited usage
   - Keys stored in `chrome.storage.sync`
   - Never logged to console

2. **Privacy:**
   - Tracker blocking via declarativeNetRequest (60+ domains)
   - Page content only sent to AI APIs
   - No telemetry or analytics

3. **Permissions:**
   - `host_permissions: <all_urls>` — required for page analysis
   - `declarativeNetRequest` — for tracker blocking

---

## CI/CD Pipeline

### CI Workflow (`.github/workflows/ci.yml`)
- Triggers: Push to main/develop, PR to main
- Jobs:
  1. Lint with ESLint
  2. Validate manifest.json (MV3, semver)
  3. Security audit for dangerous permissions
  4. Build extension zip artifact

### Release Workflow (`.github/workflows/release.yml`)
- Triggers: Tag push `v*`
- Jobs:
  1. Lint and validate
  2. Verify version matches manifest.json
  3. Build extension zip
  4. Create GitHub Release with zip attachment
  5. (Optional) Chrome Web Store upload

---

## Development Notes

### Adding New Prompts

1. Add to `PROMPTS` object in `content.js`
2. Inherit `STYLE_RULES` for Russian outputs
3. Use semantic markup for entities/terms
4. Document in `PROMPTS.md`

### Adding New UI Components

1. Use `createNote()` factory function
2. Add CSS classes with `pzdrk-` prefix
3. Update `content.css` for glassmorphism styling
4. Handle cleanup in note close handlers

### Testing Changes

1. Load extension as unpacked in Chrome
2. Open DevTools for background script (chrome://extensions → Service Worker)
3. Open DevTools for content script (page DevTools → Content scripts)
4. Check console for errors

---

## File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| content.js | ~5,200 | Main logic, prompts, UI |
| background.js | ~800 | Service worker, APIs |
| options.js | ~400 | Settings page logic |
| content.css | ~800 | Glassmorphism styles |
| options.html | ~550 | Settings UI |

---

## Related Documentation

- `CLAUDE.md` — High-level architecture and commands
- `PROMPTS.md` — Complete prompt catalog (in Russian)
- `.eslintrc.json` — Linting rules
