# AGENTS.md - Guidelines for pzdrk Browser Extension

## Build/Lint/Test Commands
- **Build**: No build step (load as unpacked extension in chrome://extensions)
- **Lint**: `npx eslint *.js` (see .eslintrc.json)
- **Test**: No testing framework

## Code Style Guidelines
- **JavaScript**: ES6+ (async/await, arrow functions, destructuring)
- **Naming**: camelCase for vars/functions, UPPER_CASE constants, `pzdrk-` CSS prefix
- **CSS**: Custom properties (:root), glassmorphism design, 3-digit precision opacity
- **Comments**: Section headers with `// ============ SECTION ============`
- **Storage**: `chrome.storage.sync` for user preferences
- **Message Passing**: `chrome.runtime.sendMessage` between scripts
- **Security**: Never log API keys; use fallback defaults
- **Error Handling**: Try/catch with descriptive messages; silent fails for non-critical ops

## Semantic Markup Syntax

All AI-generated Russian content uses semantic markup for entity extraction and linking:

| Syntax | Purpose | Example |
|--------|---------|---------|
| `[[entity:Name]]` | Named entities (people, companies, products) | `[[entity:OpenAI]]` |
| `[[term:термин]]` | Technical terms requiring definition | `[[term:transformer architecture]]` |
| `[[wiki:article]]` | Wikipedia reference | `[[wiki:Machine Learning]]` |
| `[[evidence:fact]]` | Evidential statements (verifiable claims) | `[[evidence:GPT-4 released March 2023]]` |
| `[[action:step]]` | Actionable items | `[[action:Review API documentation]]` |

**Usage rules:**
- Apply in all Russian prompts inheriting `STYLE_RULES`
- Wrap important concepts, not every word
- `[[evidence:]]` requires source or verification method
- `[[action:]]` should be concrete and measurable

## AI Persona (MONDAY_PERSONA)

All Russian outputs use the "Monday" persona:
- **Tone**: Calm, professional, laconic
- **Sarcasm**: Точечно (0–1 short phrase per response), no drama
- **Forbidden**: "*вздох*", whining, hysteria, excessive emotions
- **Evidence-based**: Separate facts from assumptions, note confidence level
- **Language**: Simple Russian

Applies to: `summary`, `summaryJson`, `sectionEnrich`, `voiceScript`, `mindmap`, `twitter`, `deepdive`, all action prompts.

## Prompt Variables

Standard template variables used in prompts:

| Variable | Source | Description |
|----------|--------|-------------|
| `{url}` | Page | Current page URL |
| `{title}` | Page | Page title |
| `{content}` | Page | Truncated page text |
| `{summary}` | AI | Generated summary |
| `{browserContext}` | Background | Tabs + history + pathway |
| `{tags}` | Settings | User-defined tags |
| `{selection}` | User | Selected text (for selection-scoped commands) |

## Cursor/Copilot Rules
No Cursor or Copilot rules configured.
