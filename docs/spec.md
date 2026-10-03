# Rox Discovery — prompt and workflow correction specification

## Scope and surfaces

The folder contains two independently loadable extensions: root Manifest V3 JavaScript and a separate Vite/TypeScript build. Changes to the root prompt registry do not automatically change `src/content/main.ts`. This directory has no Git metadata; no release or push is implied. Preserve stored user preferences, credentials, existing explicit opt-outs and the UI's usable actions.

## Acceptance criteria

1. No page URL, title or generated summary is automatically sent to Slack after summarization. Remove any bundled Slack webhook and automatic path; data leaves for an optional export only after a user's explicit action. Other explicit export destinations stay intact.
2. Summarizing does not launch the workspace action queue or hover generation by default. A single, clearly labeled opt-in may enable speculative calls; the setting explains the cost and applies to both sources. Clicking an action still launches it.
3. The direct core summary is useful and compact at the existing output-token ceiling. JSON mode demands only fields the renderer consumes, uses optional evidence and optional extra details, and rejects malformed/empty responses instead of rendering an empty successful note. Section enrichment must require a valid `right` object. A missing optional field never fabricates a citation.
4. Evidence/source/challenge instructions distinguish quoted page evidence, independently verified sources and suggested searches. Never invent quotes, URLs, DOIs, statistics or verified references. Shared evidence rules are separate from channel-specific Markdown/JSON style, without duplicate instructions at one call site.
5. Mindmaps, map expansion and workflow suggestions scale to input and budget instead of enforcing large fixed counts. Long-page map-reduce exposes processed/failed chunks or ranges and marks partial coverage on the user-visible result.
6. The 17 action templates have one effective default source for root runtime and editor. Saving unrelated settings does not persist displayed defaults as overrides. Existing customized overrides remain effective; reset of an individual template returns to the actual runtime default. The editor shows effective source/branch, available variables, customized versus default state, a rendered-input preview and the need to save/recompute stale output where relevant.
7. Generated command creation accepts its context explicitly, rather than referring to an undefined variable. Full generated prompt text survives normalization and is copyable; only the card preview is truncated.
8. Action promises match real available inputs: no claim to inspect hidden HTML fields, link validation, or external search unless performed. Sources are explicitly labeled as page references, verified external evidence, or unverified search leads.
9. The root popup presents page tasks before monitoring; translation language sits beside its action and the empty/disabled key-pool state gives accurate setup guidance. The options editor clearly indicates unsaved state, prompts navigation and effects of Telegram Test; it does not unexpectedly save unrelated settings; global reset requires confirmation and states its scope.
10. Vite summary input treats page URL/title/body as untrusted quoted data, validates schema/types on returned JSON, displays useful errors for invalid replies and retains its distinct modular limitations. Do not represent a root prompt change as a Vite behavior change.
11. Update coding guidance and prompt documentation to match actual architecture and new contracts without exposing packaged credentials. Run behavioral tests plus root syntax and modular build/typecheck/lint where available; smoke the changed actual UI and generated paths without live credential sends.

## Constraints and decisions

- The root options page is also copied into the Vite build. Any shared defaults script added to it must be packaged by Vite; on the modular build, editor descriptions must not imply root-only commands are implemented there.
- The user's previous explicitly saved `prefetchOnHover: true` remains an opt-in; missing is off. A stored action prompt overrides a default; an untouched editor field is not an override.
- Prefer consumer-observable tests for malformed responses, full copied prompts, opt-in generation, settings side effects and partial results; do not add tests that merely inspect source text or mock forwarding.
- API calls in a smoke must be faked with known outputs; never send live data using bundled credentials or webhook URLs.

## LLM failure repair (2026-10-03)

- Fix the root screenshot failure without redesigning unrelated features. Preserve key rotation and configured Cerebras fallback for ordinary Groq models; the explicitly requested Compound selection must not switch providers. Count only real HTTP calls as retry attempts; wait through short cooldowns (up to two seconds), and return promptly for longer cooldowns.
- Preserve the original provider failure on exhaustion. A new request with all keys cooling down receives retry guidance instead of an unexplained generic error.
- Configure only the working user-supplied Groq key in extension settings. Do not place credentials in source, tests, docs or build output. Live probes are explicitly authorized with that key and synthetic input only.
- Latest user steering after the benchmark comparison selects `qwen/qwen3.8-27b` as the new default and installed model. Update classic background/options/popup and both modular provider registrations; explicit saved model choices still take precedence. Compound remains an optional explicit legacy selection and must surface its upstream error without silently switching providers.
- A failed summary is visibly failed, not still analyzing: reveal an escaped provider error and offer retry and settings. Retry replaces the failed panel rather than accumulating panels.
- Acceptance: regression failures observed before edits; successful live provider and summary requests after reload; rejected-key/rate-limit/short-cooldown/fallback scenarios; UI error and retry interaction; full suite and applicable syntax/build checks.

## Compact single-page workspace (2026-10-03)

- One continuous main page, with a two-column summary: source-grounded points on the left; visible contextual explanations and terms on the right. Full suggested follow-up prompts remain visible with their purpose and fill the dialogue field on click without sending. No top action/tab strip or pager. Footer utilities remain explicit and compact.
- Visual direction: translucent glass floating panel, rich formatting and two-column content with a narrow-screen stack. Start every ordinary workspace as a 32×30 px bottom-left portrait button, during loading and after completion; background results must never force it open. Hover temporarily reveals the full panel above that button, which stays in place; leaving collapses it after a short delay. Clicking pins it for reading, and the footer folds it again. Keyboard focus must reveal the panel and protect typing. The compact state shows only the portrait button, without title/source/footer rows.
- Summary and dialogue must not import unrelated browser history. No mandatory filler, duplicate TL;DR/core wording, generic workflow suggestions, placeholder sections, automatic enrichment, or speculative command calls. Follow-ups use the source, this summary and this workspace's conversation; answers append below the summary.
- Markdown must preserve headings, lists, links, tables and fenced code safely in rendering, clipboard and .md export. Archive/HTML/PNG include all completed workspace sections, not only a selected hidden pane. Standalone HTML preserves the map SVG and is safe from executable generated HTML.
- The map and Mindweb are two compact views of the same normalized source-grounded graph, inline on the main page. Tree expansion, graph selection and responsive layout must work; no invented edges.
- User confirmed: automatically save completed results to Obsidian; Telegram only on explicit click. Obsidian success means a note actually persisted in the configured vault, not a downloaded file, invented path or broken wikilinks. Surface delivery errors and allow manual retry.
- Acceptance: actual loaded root extension on synthetic source; no top controls; concise live analysis and follow-up; Markdown/code safety; dock/restore; map/Mindweb controls; archive readback after reload; open downloaded standalone HTML; inspect downloaded PNG; real vault readback; explicit Telegram send receipt and no automatic Telegram activity. Preserve user credentials and settings.
- Product identity is **Rox Discovery** throughout manifests, popup, options, in-page header, export fallbacks and release names. The installed loopback service is `com.rox.discovery.obsidian-bridge`; the vault destination is `Brain/Rox Discovery/`. Existing browser storage keys and extension ID remain unchanged to preserve saved data.

