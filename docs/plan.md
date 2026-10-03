# Execution plan — prompt and workflow correction

| Phase | Owner / files | Input and artifact | Dependency | Verification |
|---|---|---|---|---|
| 0. Contract | Lead: `docs/spec.md`, `docs/plan.md` | Acceptance criteria, precise root/Vite separation and shared-default packaging contract | Scope read | Review against requested items and existing paths |
| 1. Root runtime | RootRuntime: `content.js`, `manifest.json`, new `prompt-defaults.js` | Effective runtime prompts; compact and validated summary/enrichment; conditional evidence; scaled maps/workflows; opt-in extra generation; coverage status; command/prompt fixes; no automatic Slack message | Phase 0; owns the only writer for content | Parent exercises action, summary, long-page and negative paths |
| 1. Background | Lead: `background.js` | Remove Slack message routing and embedded webhook now that it has no authorized caller | Phase 0 | Parent confirms no automatic external export and other messages still work |
| 1. Popup | PopupWorker: `popup.html`, `popup.js` | Primary task hierarchy, translation control, precise disabled/missing key and monitoring hierarchy | Phase 0 | Parent opens and interacts with real popup states |
| 1. Vite | ViteSummary: `src/content/main.ts`, `src/popup/popup.ts`, `src/popup/index.html` | Delimited untrusted inputs, validated response and user-visible popup error state; preserve distinct build | Phase 0 | Parent runs modular contract tests, typecheck and actual-message smoke |
| 2. Settings | OptionsWorker: `options.js`, `options.html`, `vite.config.ts` | Consume shared prompt-default script in both packages; only deliberate overrides saved, migrate exact old auto-saved defaults. Effective editor source/branch/variables and previews; draft state, safe Telegram Test, confirmed reset, clear prefetch cost | Shared script interface published by RootRuntime | Parent tests override precedence/migration, Test isolation/reset and options UI |
| 2. Packaging | Lead: `.github/workflows/ci.yml`, `.github/workflows/release.yml` | Include required `prompt-defaults.js` in both future root ZIP inputs | Manifest script dependency | Inspect ZIP inputs and generated Vite dist, without claiming CI ran here |
| 2. Test and integration | Lead: `tests/**` + integration fixes | Focused behavioral regressions for changed paths; update/remove obsolete implementation-text expectations, not re-pin wording | Phase 1–2 artifacts | Targeted tests then full suite, typecheck, lint, root syntax, build, real popup/options and summary/action smoke |
| 3. Guidance and review | DocsWorker: `CLAUDE.md`, `AGENTS copy.md`, `docs/prompts.md`, `docs/overview.md` | Correct root/Vite commands, prompt families/defaults, model and cache notes, workflow and privacy effects | Runtime/settings/popup behavior settled | Parent compares docs with code and independently reviews integrated diff |

## Shared prompt contract

`prompt-defaults.js` is a classic browser script loaded before root `content.js` in `manifest.json` and before root `options.js` in `options.html`, and copied unchanged to modular `dist/` by `vite.config.ts`. It sets `globalThis.ROX_PROMPT_DEFAULTS = { prompts, actions, isLegacyActionPromptDefault }` with runtime-effective strings and an exact SHA-256 matcher for historically auto-saved action defaults. `prompts` exposes root named prompt templates, `actions` exposes the 17 action prompt templates keyed by the existing action names. `content.js` ignores only exact old auto-saved defaults even if Options was never opened; `options.js` migrates those storage values when opened and stores only deliberate overrides in the existing `promptOverrides`/`actionPrompts` settings. Genuinely saved custom overrides remain effective. The modular content script still uses its own distinct prompt constants.

## Coordination and quality gates

Independent workers edit disjoint file sets and skip builds, tests, lint and formatters until parent integration. RootRuntime signals when the script shape exists; OptionsWorker starts after that contract is actionable. Lead owns all cross-file merges, verification, UI smoke and any test additions. Run tests once after each integration phase, then re-run relevant checks only after a material fix. Do not test by sending bundled credentials to external services. Screenshots belong under `~/Pictures/Shots/Agents/`, never `~/Desktop` or `~/Documents`. This folder is not a Git checkout, so commit/push is not available.

## Integrated verification (2026-09-29)

- `bun run test`: 12 suites, 106 tests passed. `bun run build`: TypeScript checked and Vite `dist/` built. `bun run lint`: 0 errors, 4 existing warnings in modular sources. Classic `prompt-defaults.js`, `content.js`, `options.js`, `popup.js` and `background.js` all passed `node --check`.
- Built `dist/` copies the exact shared prompt defaults, first-run settings and 128px icon. Vite reports a non-module shared-script bundling warning and duplicate icon emission warnings, but emits the expected files.
- In the user's running browser, exercised a synthetic no-credential Options page: 12 registry cards, 17 initialized action templates, editable Section Enrich field, unsupported-variable notice and preview, draft versus Save behavior. The live browser exposed a missing textarea that the lightweight test DOM did not model; it was restored before the final build. Screenshots: `~/Pictures/Shots/Agents/pzdrk-ext-qa/options-editor-full.png` and `options-json-editor.png`.
- In the same browser, ran the actual root `content.js` on a synthetic local page. A JSON summary rendered with optional details neutral, no speculative Exa request; cache reuse made no new provider call; choosing the Twitter workspace tab made one provider call. An empty synthetic provider response showed the summary error and left no cache entry. Screenshot: `~/Pictures/Shots/Agents/pzdrk-ext-qa/root-summary-expanded.png`. The root and Vite popup surfaces were also visually checked during integration.
- All provider and Telegram responses in these browser scenarios were local stubs; no bundled credential was sent to a live service. This working directory has no Git checkout, so no commit, push, CI run or release is claimed.

## LLM repair plan (2026-10-03)

| Task | Owner / boundary | Dependency | Verification |
|---|---|---|---|
| Diagnose request and UI lifecycle | Lead + FailureSurface (read-only) | Root manifest and source | Trace provider errors, live model-list/key probes with synthetic data |
| Retry regression suite | ProviderRegressions: `tests/root-provider-retry.test.ts` | Existing worker message harness | Lead observes four failures before fixing retry behavior |
| Retry/error repair | Lead: `background.js` | Red regressions | Preserve failures, real-attempt budgeting, bounded cooldown waits, rotation/fallback |
| Obsolete model migration | ProviderRegressions: root options/popup and modular model registrations | Live model evidence | Default/migration behavior, editor/display and build |
| Error recovery panel | Lead: `content.js`, `content.css`, behavioral coverage | Failure lifecycle research | Visible failed state, escaped text, retry replacing failed panel, settings action |
| Configure and integrate | Lead: installed root extension storage and documentation | Working key/model and completed code | Reload extension, persistence readback, actual synthetic summary, failure/retry interaction, full suite/syntax/build |

Keep the scope to the observed root failure and affected model defaults. No repository metadata exists; no commit/push is possible. The browser is the user's existing Chrome session; do not launch an isolated profile. Credentials remain in the extension's configured store.

## Single-page redesign plan (2026-10-03)

| Deliverable | Owner / files | Dependency | Acceptance evidence |
|---|---|---|---|
| Single-page shell, content and dialogue | Lead: content.js, content.css | Existing root runtime | Loaded Chrome surface, source-only concise analysis, appended conversation, no top tabs/pager/actions |
| Useful prompt defaults and migration | UsefulPrompts: prompt-defaults.js | Existing JSON consumers | Existing contracts remain usable; source-grounded live answers |
| Compact tree and Mindweb | CompactMaps: workspace-map.js/.css | Normalized mindmap schema | Inline SVG/tree, local view switch, selection and export rendering |
| Real Obsidian transport | VaultDelivery: background.js, local service if needed | Current vault capabilities | Authenticated save acknowledgement and exact note readback; clear failure/retry |
| Markdown, dock, archive, HTML, PNG, manual Telegram integration | Lead | Completed shell/transports | Every footer action exercised, archive persists, actual downloads opened, manual Telegram receipt |
| Integration and delivery | Lead + independent review | All implementation slices | Single integrated suite/syntax/build; browser visual/behavioral check and docs evidence |

Confirmed choices: automatic Obsidian, manual Telegram; both Markdown and docking. Current folder has no Git metadata. Use the existing authorized Chrome session and synthetic page; never export browser history or credentials.


## Integrated redesign verification (2026-10-03)

- Full integration run: 13 suites / 113 tests passed; TypeScript and Vite build passed; lint reported 0 errors and 4 existing warnings. Vite still reports the classic prompt-script packaging warning and duplicate emitted icon warnings.
- After tightening the Compound provider boundary, the focused runtime/provider run passed 24 tests across 2 suites. Compound is sent unchanged and does not fall back to Cerebras on authorization or model-access failures; ordinary-model transient fallback remains covered.
- The loaded extension rendered the single-page Russian workspace with Rox Mono, no top action/tab/pager strip, source details, a source-only appended Markdown answer, dock/restore, both graph views, enlarge/fit controls, keyboard selection, node details and tree folding.
- Real footer downloads produced complete Markdown, standalone HTML and a visually inspected 1440×5010 PNG containing the summary, both graph views and dialogue. The downloaded HTML was opened in Chrome: two SVGs, dialogue and definitions present, correct SVG fills, zero executable nodes. Actual clipboard readback and the persisted `Brain/Rox Discovery/127.0.0.1-0029ff97a53c5d373771.md` contain dialogue code, terms and graph outline. Automatic Obsidian transport rejected wrong-token, wrong-origin, credential-bearing URL and empty requests in the negative probes.
- The long-workspace export smoke exposed an interaction defect: export `<summary>` and SVG button-role clicks were treated as body clicks, switching the panel into scrolling mode. Both are now recognized as interactive controls; the loaded browser confirmed graph clicks keep the panel pinned.
- One explicit Telegram click uploaded the complete HTML through the configured bot. A short UI polling deadline expired before the callback; a read-only recovery of the same persistent page found `{sent: ["html"], title: "Вода для городского сада"}`. No second send was performed. Bot identity `petabulkbot` was independently checked with read-only `getMe` (HTTP 200).
- Consolidated evidence and source/download SHA-256 values: `~/Projects/archive/rox-discovery-final-verification.json`. Original failed smoke reports are retained. The PNG capture implementation is unchanged by the last interaction-selector correction; an extra recapture failed because the relay was temporarily unavailable, without invalidating the existing PNG proof.
- Provider fixtures in UI checks are controlled synthetic responses, not live Compound answers. Groq's decommissioned Compound endpoint remains an external prerequisite, and no alternate model has been substituted.
- Working folder still has no Git metadata; no commit, push, CI or release is claimed. No general prompt-rule change was justified by the temporary host overload or the browser-controller failures.

## Qwen default cutover (2026-10-03)

- User explicitly selected Qwen3.8 27B after comparing benchmarks. Lead owns classic background/options/popup defaults, modular provider model metadata and installed Chrome settings; no credentials, prompts, export behavior or other users' explicit selections are changed.
- Default selection smoke: before the change an unset Groq model selected Compound; afterward it selects `qwen/qwen3.8-27b`, while explicit GPT-OSS and Compound selections retain precedence. Remove the obsolete incidental Compound-default test row, retaining the explicit-selection/error-boundary regression.
- Verification on the changed source: 13 suites / 113 tests passed; TypeScript/Vite build and classic background/options/popup syntax checks passed. Existing Vite prompt-script and duplicate-icon warnings remain.
- Installed Chrome settings Save acknowledged success. Reloaded settings and the actual popup both displayed Groq / `qwen/qwen3.8-27b`. The extension was reloaded through its visible details reload control; a fresh source-only summary on an owned synthetic page succeeded before and after reload, preserving the 5 cm rule and the absence of a universal water dosage.
- A live HTTP smoke through the final classic worker source (VM with Chrome storage/message interfaces and real Groq fetch) returned HTTP 200 with both requested and returned model `qwen/qwen3.8-27b`. No fallback provider was contacted. Native Chrome DOM inspection verified the loaded UI; the optional browser-relay attachment timed out and is not claimed as screenshot evidence.

## Presentation restoration (2026-10-03)

The user corrected the single-page redesign: rich formatting, transparent glass, two-column text, visible explanations and suggested next prompts are required. Do not replace this presentation with generic opaque light styling.

| Deliverable | Owner / files | Dependency | Verification |
|---|---|---|---|
| Rich source content, visible explanations and full prompt cards | RestoreSummary: `content.js`, `prompt-defaults.js` | Existing safe renderer and summary schema | Meaningful renderer safety/content regressions; actual Qwen summary and prompt-fill interaction |
| Translucent responsive two-column surface | RestoreGlass: `content.css` | Shared existing column classes and follow-up child contract | Actual installed Chrome, desktop/narrow geometry, computed alpha/contrast, screenshots and focus/hover |
| Integration and delivery | Lead: tests/docs/browser/evidence | Both repair artifacts | Full integrated suite/build, extension reload, rich synthetic-source UI, HTML/Markdown export, unchanged model and transport settings |

Both workers skip builds/tests/lint/formatters while editing. Lead retains verification and integration; no live Telegram send or unrelated credential/storage changes.

### Restoration acceptance

- Final integrated source: 13 suites / 116 tests passed; TypeScript/Vite build and classic content/prompt syntax checks passed. Existing Vite packaging/icon warnings remain.
- Reloaded installed classic extension in the user's Chrome. A real source-only Qwen summary rendered two columns (508.68/433.32 px), three visible explanation/term cards, inline code and rich emphasis. Settings readback preserved Groq / `qwen/qwen3.8-27b` and two-column mode.
- Native owned-window screenshots show translucent dark glass over a patterned page, complete follow-up prompt text and a readable glass footer. At 520 px viewport, columns stack, the panel stays within the viewport and content horizontal overflow is zero.
- Clicking the full prompt fills and focuses the ask field without adding a dialogue turn. Dock/restore works. Full multiline prompts survive attribute insertion; repeated summary points no longer discard distinct explanations; the accepted `def` alias retains its definition.
- Actual Markdown, HTML and 2000×1666 PNG downloads were inspected. HTML preserves explanations and full prompts as static articles, with zero executable nodes/event attributes inside the exported document surface. PNG visibly contains the complete prompt. No Telegram send or credential change was made.
- Evidence and source/download hashes: `~/Projects/archive/rox-discovery-presentation-restoration-20261003.json`. Browser relay capture timed out; acceptance uses native captures of a verified owned Chrome window, not the initial wrong-window or inactive-window captures.
- Prompt evolution: clarified the existing project summary/enrichment defaults to distinguish JSON transport from inline Markdown; exercised with the real Qwen summary. No global rule change is justified: current scope-preservation rules already cover the redesign regression.

## Small collapsed startup and hover reveal

Lead owns `content.js`, `content.css`, runtime regressions and installed Chrome acceptance. Reuse dock geometry rather than the old 900 px collapsed header. Start docked at creation, retain that state through summary completion/error, preview on pointer/focus entry above a stable bottom-left 32×30 px portrait button, collapse after leaving unless clicked/pinned or focused, and keep manual dock/restore. No title/footer/source row in the compact state. Preserve the restored rich two-column content, provider settings and all exports.

Verification: failing-before/passing-after state regressions for initial docking, hover/leave, explicit pin and focused/reentered preview; full integration suite/build; actual installed startup/cache completion, native pointer hover/leave/click, geometry and screenshots. No unrelated Obsidian recovery work or automatic Telegram send.

Acceptance (2026-10-03): 13 suites / 119 tests passed; TypeScript/Vite build and classic content/prompt syntax checks passed on the integrated source. Installed classic extension was reloaded. Chrome observed the 32×30 startup/completed dock, real hover preview, click pin and manual fold. Final loading-hover and leave-to-compact screenshots are `~/Pictures/Shots/Agents/rox-hover-startup-20261003/accepted-expanded.png` and `accepted-compact.png`; the raw CDP run produced these before its controller failed request-interception cleanup, so its structured return is unavailable. Keyboard focus/reentry are covered by state regressions, not claimed as final native keyboard acceptance.

Parallel review corrections: capture click-to-pin before stop-propagating child handlers; make the transparent preview band pass page input through; disable transient/docked resize-handle interception and keep the launcher above handles. Glass/two-column content, Qwen, credentials and exports remain unchanged.

User correction: stop repeated browser launches and foreground disruption. Further UI launches/retries stopped; existing evidence retained and the owned fixture service stopped. Do not reopen the browser merely to repeat accepted checks.
