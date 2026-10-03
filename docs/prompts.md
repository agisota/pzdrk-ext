# Prompts and custom instructions

This catalog describes executable prompt defaults and editable instructions. It distinguishes the root unpacked Manifest V3 extension from the separate TypeScript/Vite extension. The classic `prompt-defaults.js` script is the shared source for root runtime defaults and the options editor; Vite packages that file for the shared options page, but its modular content script keeps its own summary prompt. For exact current text, read the named source files rather than relying on copied prompt wording here.

## Root shared instruction layers

`prompt-defaults.js` defines:

- `MONDAY_PERSONA`: calm, professional Russian voice; separates facts, conclusions and assumptions.
- `EVIDENCE_RULES`: the provided page excerpt is not independent verification. Quotations must be exact excerpts. External claims/references are verified only when independently checked; otherwise label searches as unverified leads. Do not invent quotes, URLs, DOIs, statistics or sources.
- `STYLE_RULES`: persona + evidence rules + compact, structured output guidance.

Many templates compose `STYLE_RULES`, but there is no universal persona inheritance chain. `generateTitle` and `pageRanking` use their own task instructions; realtime spoken-browser instructions are assembled dynamically; `voiceScript` uses the persona without all shared style/evidence rules. Inspect the call site before changing or describing inheritance. Avoid repeating the shared style/evidence layer in both a system prompt and action user prompt.

`content.js` also has its own runtime-only `MONDAY_PERSONA` and `STYLE_RULES` for assembled Q&A, hover definitions, selection explanations and commands without a custom system message. These are distinct from the shared registry strings. The background worker forwards the selected system and user strings to the provider; it does not silently attach a second global instruction. The modular Vite system constants are distinct again.

## Root named prompt registry — 18 prompts

The `prompts` object in `prompt-defaults.js` contains these 18 keys:

| Key | Purpose |
|---|---|
| `summary` | Compact, practical direct Markdown page summary. |
| `summaryJson` | Compact JSON transport without fences; selective safe inline Markdown in strings, source-grounded explanations and complete contextual follow-up prompts when useful. |
| `sectionEnrich` | JSON enrichment for one existing section with useful context rather than repeated left-column points; inline Markdown in strings is allowed. See the required envelope below. |
| `generateTitle` | Short Russian title that captures the page's angle. |
| `pageRanking` | JSON classification of depth, domain, confidence and useful tags. |
| `voiceScript` | Spoken guide assembled around page, browser context and summary. |
| `mindmap` | Clustered, source-scaled JSON research map rather than a fixed-size outline. |
| `mindmapExpand` | Context-aware JSON children for a selected map branch. |
| `challenge` | Scaled critical questions, alternative hypotheses and concrete checks. |
| `twitter` | Short X/Twitter thread based on the supplied content. |
| `deepdive` | Deeper analysis of mechanisms, assumptions and risks. |
| `automation` | Practical automation options at quick-win, robust and scale levels. |
| `learning` | Two-week learning plan with practice and deliverables. |
| `share` | Adapted Slack, email, LinkedIn and Telegram draft copy (generation only; it does not send). |
| `followUp` | Answer to a follow-up using note history and the question. |
| `actionToPrompt` | Generate one reusable prompt for an action and its source context. |
| `createCommand` | Generate a JSON extension command from the request. |
| `workflowSuggestions` | Source-scaled next-work scenarios with complete executable prompt text. |

The two direct summary modes share the compactness and evidence contract. JSON mode requires only the fields consumed by the renderer; additional sections, right-side enrichment, TILs, actions, concrete prompts and references are optional when supported. Evidence is not a required citation quota: do not invent one to fill a field. Malformed/empty JSON is not a successful empty summary.

Section enrichment must return a JSON object with the same section key and a `right` object, for example `{"key":"core","right":{"commentary":[],"terms":[],"entities":[],"refs":[]}}`. The matching `key` and object-valued `right` are required; individual `right` fields are optional, and any included arrays must contain useful supported entries. Do not repeat the section's left-side claims or create unsupported references.

### Direct summary versus long-page map-reduce

When a page is short enough for direct summarization, the runtime uses the editable `summary` or `summaryJson` prompt according to the selected output mode. When map-reduce is enabled and the page crosses the runtime threshold, it instead uses chunk extraction and JSON repair prompts, then merges valid results deterministically. The direct `summary`/`summaryJson` editor templates do not customize that map-reduce path. Long-page output reports processed/failed chunk coverage and indicates partial results rather than silently implying complete coverage. Disabling map-reduce constrains extracted input instead of processing the full long page.

## Shared root action defaults — 17 templates

The `actions` object in `prompt-defaults.js` is the single runtime/editor default source. These are distinct from same-named entries in the 18-key registry: the registry's `twitter`, `share`, `challenge`, and similar prompts are not automatically the action-rail templates.

| Key | Purpose |
|---|---|
| `twitter` | Operator-style X/Twitter thread. |
| `deepdive` | Strategy/engineering analysis. |
| `automation` | Automation architecture and rollout plan. |
| `learning` | 14-day learning sprint. |
| `share` | Multi-channel sharing packet. |
| `challenge` | Critical challenge and verification questions. |
| `timeline` | Chronology, dependencies and uncertainty. |
| `extract` | Structured extraction of claims, entities, metrics and next steps. |
| `briefing` | Decision-focused briefing and recommendation. |
| `matrix` | Trade-off comparison matrix. |
| `sources` | Evidence/source map with gaps and next checks; it must not claim unperformed verification. |
| `opsplan` | Executable operational plan with dependencies and completion criteria. |
| `faq` | Source-grounded FAQ. |
| `compare` | Practical comparison of approaches. |
| `localization` | Russian localization of supplied content; it does not imply unseen HTML/control access. |
| `frontendBuilder` | Frontend concept and implementation brief. |
| `renderHost` | Render deployment guide based on available material, not a claim that external checks were run. |

Root action execution still resolves a deliberate action override before its shared default. These templates remain available for explicit commands; the single-page workspace no longer displays the action rail or schedules speculative workspace command calls. Hover definitions remain an explicit opt-in.

## Options editor: effective values, sources and save effects

The options page loads `prompt-defaults.js` before `options.js`; the Vite build copies the same script for the reused options page. That does not make the modular Vite content script consume root prompts.

- The registry editor exposes only the 12 root-consumed keys: `summary`, `summaryJson`, `sectionEnrich`, `generateTitle`, `pageRanking`, `workflowSuggestions`, `voiceScript`, `mindmap`, `mindmapExpand`, `followUp`, `actionToPrompt` and `createCommand`. The shared root registry still contains all 18 defaults. The 17 action templates have their own editor. Edits are drafts until saved; change/reset controls do not persist immediately.
- `summaryPrompt`, `summaryJsonPrompt` and `sectionEnrichPrompt` are legacy free-text controls. Effective precedence is **legacy value > registry override > shared default**. A nonempty legacy value wins over the corresponding `promptOverrides` entry; if blank, the registry override wins, then the shared default. Reset removes both stored legacy and registry values for these keys.
- For the other 9 editable registry keys, a nonempty saved `promptOverrides[key]` overrides the shared default. Reset removes that stored override so runtime returns to the current shared default. The remaining six defaults remain available in the shared registry but are not exposed by this editor.
- Each action editor starts from a saved action override when present, otherwise from the shared action default. Save stores only nonempty values that intentionally differ from that shared default; merely saving another setting must not persist all displayed defaults as overrides. Resetting one action returns it to the shared default.
- Action previews substitute sample values only for renderer-supported tokens: `{url}`, `{title}`, `{summary}`, `{content}`, `{browserContext}`, `{noteTitle}`, `{noteExcerpt}` and `{selection}`. Other placeholders remain visibly unchanged and are flagged as unsupported. Previews are not live execution; after saving, run the corresponding generation again. Existing summaries/cache are not rewritten just because a prompt changed.
- The page is also reused by Vite, but its action prompt editor configures root action defaults; modular content uses its own prompt and summary contract.
- Prompt editor navigation links jump between the summary, JSON/enrichment, registry and action sections. The page shows unsaved state; ordinary controls and mode changes take effect only after Save.
- Telegram Test prompts for confirmation and uses only saved settings. Global Settings Reset confirms first, clears sync settings plus local Telegram/Obsidian bridge configuration and supported tracker statistics, but preserves the artifact archive.

An optional packaged `local-overrides.json` is applied by background/options settings code but is not loaded by root `content.js`. It can therefore affect what settings the editor displays without making every such override effective in content. Do not mistake a displayed local override for a content prompt override. Inspect actual storage and the runtime branch when diagnosing precedence.

## Dynamic and generated instructions in root runtime

These are the remaining active instruction families assembled at their call sites in `content.js`, rather than extra editable keys. Exact strings and inserted page context are in that file; the table lists the *use* of each instruction without duplicating a second copy that can drift.

| Call site or route | Instruction and input |
|---|---|
| `buildXaiRealtimeInstructions` | Browser voice assistant's concise Russian answer using URL, title, recent browser context and partial summary; sent in realtime session configuration. |
| `translateChunk`, `translateLargeText`, `translatePage` | Per-target-language translation preserving headings, lists and meaning; larger inputs are split into chunks, with empty-output and wrong-language repair instructions. |
| `ensureTILBullets`, `generateTILList` | Rebuild or create short «Выяснилось» insights from supplied page/summary context. |
| Workspace question handler | Concise answer using only the current source, summary, explicitly mentioned completed sections and the last six local conversation messages. No browser history. Append safe Markdown inline; do not claim actions were executed. |
| `getTermTooltip`, `getEntityTooltip` | Short contextual definition and uncertainty notice on click (or hover after prefetch opt-in); entity lookup may additionally use Exa, which is a search lead, not independent validation. |
| Selection explanation handlers | ELI5/contextual explanation of explicitly selected text, framed by page and browser context. |
| `summarizeMapReduce` and `callGroqJsonWithRepair` | Per-chunk JSON extraction of bullets, terms, entities, actions and risks; repair malformed JSON. Valid chunks are merged in code, not by a separate model prompt. |
| Direct summary | One `summaryJson` request, validated before rendering; use `summary` only as malformed-JSON fallback. Approximately 120–220 words, fewer if the source is brief; no mandatory second section/filler. No automatic title/ranking/enrichment/search call. |
| `prefetchRelatedSummary` | Named `workflowSuggestions` template receives a clipped page seed only when the user enabled speculative generation; related search uses Exa and does not mean the result was verified. |
| Inline map / Mindweb | One named `mindmap` request against the current source/summary; normally up to 18 nodes, at most 24. Both visual views use the same normalized graph; explicit source-backed cross-links only. Outline folds, fit/readable size and node details are local controls, not provider calls. |
| Voice script route | Named `voiceScript` template receives URL, title, classification, browser context and summary, with a text-only output instruction. |
| Explicit commands | Saved action override/shared template or custom command system text; results remain inline on the continuous workspace rather than hidden command tabs. |
| `createCustomCommandFromRequest`, `actionToPrompt` route | Named `createCommand` produces a validated command object; named `actionToPrompt` turns the source action and its note/section/page context into a reusable prompt. |
| Follow-up suggestions | A suggestion fills the question field, without making a provider call. Sending runs the workspace dialogue and appends the answer. Markdown exports preserve the complete suggestion prompt. |

Generated content is not evidence of a provider call until the corresponding user action runs. With speculative generation off, hovering or merely opening the workspace does not start related-search, workflow or action generation.

## Separate TypeScript/Vite summary contract

The Vite extension's `src/content/main.ts` owns a distinct English instruction that requests concise Russian JSON. It serializes `{url, title, body}` as quoted untrusted page data, tells the model not to follow embedded instructions or invent evidence, and requests required renderer fields: nonempty `core`, arrays of strings for `keyPoints`, `til`, `actions`, and `entities`, and `terms` objects with string `term`/`definition`. Empty arrays are allowed when no supported entries exist. The system prompt combines the modular Monday persona and JSON validator; this is not the root `STYLE_RULES`/`PROMPTS` pipeline.

The modular parser rejects malformed JSON and invalid/missing required field types with useful errors rather than treating them as an empty successful summary. Its summary handler syncs successful output directly to the optional local hub from content; that path is separate from the root prompt registry and root action settings. Other modular limitations are documented in [overview](overview.md).

## Prompt ownership quick reference

- Root named prompts and action defaults: `prompt-defaults.js`.
- Root prompt selection, dynamic prompt assembly and response parsing: `content.js`.
- Prompt editor values, previews, overrides and save/reset behavior: `options.js`, with markup in `options.html`.
- Vite-specific summary prompt, parser and hub sync: `src/content/main.ts`.
- Shared modular system prompt constants: `src/shared/constants/index.ts`.

This catalog is descriptive. When code changes, update the relevant source of truth first, then revise this inventory to match the integrated runtime and editor behavior.
