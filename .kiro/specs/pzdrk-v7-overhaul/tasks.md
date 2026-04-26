# Implementation Plan: pzdrk v7.0 Overhaul

## Overview

Incremental implementation of the pzdrk v7.0 Chrome Extension overhaul. Tasks are ordered by dependency: foundational infrastructure and test setup first, then core components (Splitter, RateBudget, ProviderRouter), then UI layer (UnifiedPane, SectionManager, CommandRail), then feature modules (BrowserContext, WebSearch, Voice, Hotkeys), then SettingsPane, and finally integration wiring and migration. All code is vanilla ES2022 JavaScript with no build step. Tests use Vitest + fast-check.

## Tasks

- [ ] 1. Set up test infrastructure and Chrome API mocks
  - [ ] 1.1 Create `tests/setup.js` with in-memory mocks for `chrome.storage.sync`, `chrome.runtime.sendMessage`, `chrome.history.search`, `chrome.tabs.query`, and `chrome.alarms`
    - Provide `get`/`set` backed by a plain object for `chrome.storage.sync`
    - Provide `sendMessage` that routes to registered handlers
    - Provide `search` and `query` that return configurable fixture data
    - _Requirements: all (testing infrastructure)_
  - [ ] 1.2 Create `vitest.config.js` at project root configured for ESM, no build step, with `tests/setup.js` as setup file
    - _Requirements: all (testing infrastructure)_

- [ ] 2. Implement Splitter module (background.js)
  - [ ] 2.1 Extract and refactor `Splitter` as a standalone module in `background.js`
    - Implement `split(content, { modelContextWindow, templateOverhead, targetChunkTokens })` returning `string[]`
    - Implement `estimateTokens(text)` reusing existing token estimation logic
    - Split on paragraph/sentence boundaries; never mid-word
    - _Requirements: 2.1_

  - [ ] 2.2 Write property test: Splitter chunk size invariant
    - **Property 5: Splitter chunk size invariant**
    - Every chunk's estimated token count ≤ `(contextWindow - templateOverhead)`, and concatenation of all chunks covers entire original content
    - File: `tests/property/splitter.property.test.js`
    - **Validates: Requirements 2.1**

  - [ ] 2.3 Write unit tests for Splitter
    - Test empty content, single-paragraph content, content exactly at context window boundary
    - Test that split preserves all original text (no data loss)
    - File: `tests/unit/splitter.test.js`
    - _Requirements: 2.1_

- [ ] 3. Implement RateBudget module (background.js)
  - [ ] 3.1 Implement `RateBudget` with sliding-window TPM/RPM tracking in `background.js`
    - Implement `checkBudget(provider, key)` returning `{ allowed, waitMs }`
    - Implement `recordUsage(provider, key, { promptTokens, completionTokens })`
    - Implement `getUsageStats(provider)` for the settings dashboard
    - Implement `updateLimits(provider, { tpmLimit, rpmLimit })`
    - Use 60-second sliding window buckets internally
    - _Requirements: 2.3, 5.6_

  - [ ] 3.2 Write property test: Rate budget threshold
    - **Property 7: Rate budget threshold**
    - `checkBudget` returns `allowed: true` when usage < 90% of limit, `allowed: false` when ≥ 90%
    - File: `tests/property/rate-budget.property.test.js`
    - **Validates: Requirements 2.3**

  - [ ] 3.3 Write unit tests for RateBudget
    - Test sliding window expiry, multiple keys, cooldown behavior
    - Test `getUsageStats` returns correct aggregated data
    - File: `tests/unit/rate-budget.test.js`
    - _Requirements: 2.3, 5.6_

- [ ] 4. Implement ProviderRouter module (background.js)
  - [ ] 4.1 Implement `ProviderRouter` with key rotation, provider selection, and parallel dispatch in `background.js`
    - Implement `dispatch({ messages, template, providerOverride, modelOverride, maxTokens })`
    - Implement `dispatchParallel({ chunks, template, providerOverride, modelOverride, maxParallel })`
    - Implement `registerProvider({ name, baseUrl, apiKeys, models, tpmLimit, rpmLimit })`
    - Implement `getProviderStatus(providerName)`
    - Integrate with RateBudget for budget checks before each request
    - Implement retry logic: 429 → cooldown from Retry-After, rotate key; 401/403 → cooldown 30s; 500+ → soft cooldown 1.5s
    - _Requirements: 2.2, 2.4, 2.6, 2.7, 2.8, 5.3, 5.5_

  - [ ] 4.2 Write property test: Key round-robin with cooldown awareness
    - **Property 6: Key round-robin with cooldown awareness**
    - `pickNextKey` always selects an available (non-cooled-down) key in round-robin order
    - File: `tests/property/provider-router.property.test.js`
    - **Validates: Requirements 2.2**

  - [ ] 4.3 Write property test: Provider headroom routing
    - **Property 8: Provider headroom routing**
    - ProviderRouter selects the provider with highest `(limit - currentUsage) / limit` ratio
    - File: `tests/property/provider-router.property.test.js`
    - **Validates: Requirements 2.4**

  - [ ] 4.4 Write property test: max_tokens resolution
    - **Property 9: max_tokens resolution**
    - `max_tokens` set to at least Section_Template's target token count, or model max if template doesn't specify
    - File: `tests/property/provider-router.property.test.js`
    - **Validates: Requirements 2.7, 3.4**

  - [ ] 4.5 Write property test: Max parallel requests invariant
    - **Property 10: Max parallel requests invariant**
    - Concurrent in-flight requests never exceed configured `maxParallelRequests`
    - File: `tests/property/provider-router.property.test.js`
    - **Validates: Requirements 2.8**

  - [ ] 4.6 Write property test: Provider resolution with overrides
    - **Property 17: Provider resolution with overrides**
    - Per-command overrides take precedence; falls back to extension-wide default when no override
    - File: `tests/property/provider-router.property.test.js`
    - **Validates: Requirements 5.3, 6.3**

  - [ ] 4.7 Write unit tests for ProviderRouter
    - Test retry on 429/401/500, key exhaustion error propagation, custom provider registration
    - File: `tests/unit/provider-router.test.js`
    - _Requirements: 2.2, 2.4, 2.6, 2.7, 2.8, 5.3, 5.5_

- [ ] 5. Checkpoint — Core pipeline tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement Section Template renderer and validator
  - [ ] 6.1 Implement `renderTemplate(template, context)` function for variable substitution
    - Support variables: `{url}`, `{title}`, `{content}`, `{summary}`, `{browserContext}`, `{tags}`, `{selection}`, `{webSearchResults}`, `{chunkIndex}`, `{totalChunks}`
    - Inject structural constraints into system prompt when present
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ] 6.2 Implement prompt variable validator
    - Extract all `{variableName}` patterns from prompt strings
    - Classify each as supported or unknown; flag unknown variables
    - _Requirements: 4.5_

  - [ ] 6.3 Write property test: Section template schema validation
    - **Property 11: Section template schema validation**
    - Every Section_Template must contain all required fields with correct types
    - File: `tests/property/template-renderer.property.test.js`
    - **Validates: Requirements 3.1**

  - [ ] 6.4 Write property test: Template constraints included in system prompt
    - **Property 12: Template constraints included in system prompt**
    - System prompt contains string representation of structural constraints when non-empty
    - File: `tests/property/template-renderer.property.test.js`
    - **Validates: Requirements 3.2**

  - [ ] 6.5 Write property test: Template variable rendering
    - **Property 13: Template variable rendering**
    - All supported variables replaced; no `{variableName}` placeholders remain for supported variables
    - File: `tests/property/template-renderer.property.test.js`
    - **Validates: Requirements 3.3**

  - [ ] 6.6 Write property test: Prompt variable validation
    - **Property 14: Prompt variable validation**
    - Supported variables not flagged; unknown variables flagged correctly
    - File: `tests/property/template-renderer.property.test.js`
    - **Validates: Requirements 4.5**

  - [ ] 6.7 Write unit tests for template renderer and validator
    - Test known templates render correctly, edge cases with missing context values
    - File: `tests/unit/template-renderer.test.js`
    - _Requirements: 3.1, 3.2, 3.3, 4.5_

- [ ] 7. Implement HotkeyManager (content.js)
  - [ ] 7.1 Implement `HotkeyManager` with registration, conflict detection, normalization, and lookup
    - Implement `init()`, `registerHotkey(commandId, keyCombination)`, `unregisterHotkey(commandId)`
    - Implement `getConflicts(keyCombination)` returning existing commandId or null
    - Implement `normalizeHotkey(combination)` — sort modifiers alphabetically, lowercase key
    - Implement `getMap()` and `resetAll()` to restore default bindings
    - Bind `keydown` listener that looks up and executes commands within 200ms
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ] 7.2 Write property test: Hotkey conflict detection
    - **Property 23: Hotkey conflict detection**
    - Returns existing commandId if combination is bound, null if not
    - File: `tests/property/hotkey-manager.property.test.js`
    - **Validates: Requirements 10.3**

  - [ ] 7.3 Write property test: Hotkey parsing and normalization
    - **Property 24: Hotkey parsing and normalization**
    - Modifiers sorted alphabetically, key lowercased; normalization is idempotent
    - File: `tests/property/hotkey-manager.property.test.js`
    - **Validates: Requirements 10.4**

  - [ ] 7.4 Write property test: Hotkey to command lookup
    - **Property 25: Hotkey to command lookup**
    - Matching key event returns correct commandId; non-matching returns null
    - File: `tests/property/hotkey-manager.property.test.js`
    - **Validates: Requirements 10.6**

  - [ ] 7.5 Write property test: Hotkey reset to defaults
    - **Property 26: Hotkey reset to defaults**
    - After reset, map equals built-in default bindings exactly
    - File: `tests/property/hotkey-manager.property.test.js`
    - **Validates: Requirements 10.7**

  - [ ] 7.6 Write unit tests for HotkeyManager
    - Test modifier combinations, function keys, Mac Meta key handling
    - File: `tests/unit/hotkey-manager.test.js`
    - _Requirements: 10.1, 10.3, 10.4, 10.6, 10.7_

- [ ] 8. Implement BrowserContext module (background.js)
  - [ ] 8.1 Implement `BrowserContext.collect()` in `background.js`
    - Query `chrome.history.search` filtered by configured days and maxEntries
    - Query `chrome.tabs.query` for all open tabs across windows
    - Build navigation pathway from referrer chain
    - Respect per-command enable/disable from settings
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 8.2 Write property test: Browser context history limits
    - **Property 19: Browser context history limits**
    - Output contains only entries within configured days, total ≤ maxEntries
    - File: `tests/property/browser-context.property.test.js`
    - **Validates: Requirements 7.1, 7.4**

  - [ ] 8.3 Write unit tests for BrowserContext
    - Test empty history, tab collection across windows, pathway construction
    - File: `tests/unit/browser-context.test.js`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [ ] 9. Implement WebSearchEnrichment module (background.js)
  - [ ] 9.1 Implement `WebSearchEnrichment.enrich()` in `background.js`
    - Call Exa search API with query derived from page title and topics
    - Format up to 5 snippets for `{webSearchResults}` template variable
    - Skip silently if no API key configured; log and proceed on API error
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 9.2 Write property test: Web search snippet limit
    - **Property 20: Web search snippet limit**
    - `{webSearchResults}` contains at most 5 snippets regardless of API result count
    - File: `tests/property/web-search.property.test.js`
    - **Validates: Requirements 8.2**

  - [ ] 9.3 Write unit tests for WebSearchEnrichment
    - Test missing API key, API error, empty results, result truncation to 5
    - File: `tests/unit/web-search.test.js`
    - _Requirements: 8.1, 8.2, 8.4, 8.5_

- [ ] 10. Checkpoint — Background modules complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement UnifiedPane UI (content.js + content.css)
  - [ ] 11.1 Implement `UnifiedPane` object in `content.js`
    - Implement `init()` to create and inject pane DOM structure (header, body with section-nav and sections-container, command-rail)
    - Implement `show()`, `hide()`, `destroy()`
    - Implement `addSection()`, `removeSection()`, `collapseSection()`, `expandSection()`, `scrollToSection()`
    - Implement drag-to-reposition on header; persist position to `localStorage`
    - Implement `getPosition()` / `setPosition()` with persistence
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ] 11.2 Implement glassmorphism CSS for UnifiedPane in `content.css`
    - Style `.pzdrk-unified-pane`, `.pzdrk-pane-header`, `.pzdrk-pane-body`, `.pzdrk-section-nav`, `.pzdrk-sections-container`, `.pzdrk-command-rail`
    - Maintain `pzdrk-` prefix convention; glassmorphism (transparency, blur, shadows)
    - Support collapsed/expanded section states, semantic markup highlighting spans
    - _Requirements: 1.3, 1.4, 1.5_

  - [ ] 11.3 Write property test: Pane position persistence round trip
    - **Property 3: Pane position persistence round trip**
    - Save position then load returns equivalent `{x, y, width, height}`
    - File: `tests/property/section-manager.property.test.js`
    - **Validates: Requirements 1.6**

- [ ] 12. Implement SectionManager (content.js)
  - [ ] 12.1 Implement `SectionManager` in `content.js`
    - Implement `createSection(command, templateId)` — creates Section object, appends to UnifiedPane, sends `executeSection` message to background
    - Implement `updateSectionChunk(sectionId, chunkIndex, content)` — renders chunk incrementally
    - Implement `finalizeSection(sectionId)` — marks section complete, updates token count
    - Implement `getSections()`, `clearAll()`
    - Render semantic markup: `[[entity:]]`, `[[term:]]`, `[[wiki:]]`, `[[evidence:]]`, `[[action:]]` as highlighted spans
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.5_

  - [ ] 12.2 Write property test: Section append on command
    - **Property 1: Section append on command**
    - Executing a command increases section count by exactly one; new section is last element
    - File: `tests/property/section-manager.property.test.js`
    - **Validates: Requirements 1.1**

  - [ ] 12.3 Write property test: Section collapse/expand toggle
    - **Property 2: Section collapse/expand toggle**
    - Collapsed output shows only header + token badge; expanded shows full content with semantic markup
    - File: `tests/property/section-manager.property.test.js`
    - **Validates: Requirements 1.3, 1.4**

  - [ ] 12.4 Write property test: Section nav reflects active sections
    - **Property 4: Section nav reflects active sections**
    - Navigation sidebar has exactly one link per section; labels match section titles
    - File: `tests/property/section-manager.property.test.js`
    - **Validates: Requirements 1.7**

  - [ ] 12.5 Write unit tests for SectionManager
    - Test section creation, chunk updates, finalization, clearAll, 20+ concurrent sections
    - File: `tests/unit/section-manager.test.js`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.5_

- [ ] 13. Implement CommandRail (content.js)
  - [ ] 13.1 Implement `CommandRail` in `content.js`
    - Implement `init(container)`, `render(commands)` — render built-in + custom buttons in order
    - Implement `addCustomButton(config)`, `removeCustomButton(id)`, `reorderButtons(orderedIds)`
    - Implement `getCommands()`
    - Handle `{selection}` scope: show toast if no text selected when button requires selection
    - Wire button clicks to `SectionManager.createSection()`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 13.2 Write property test: Custom button ordering
    - **Property 18: Custom button ordering**
    - Buttons rendered in ascending order value; rendered sequence matches sorted order
    - File: `tests/property/section-manager.property.test.js`
    - **Validates: Requirements 6.2**

  - [ ] 13.3 Write unit tests for CommandRail
    - Test button rendering order, add/remove/reorder, selection scope toast
    - File: `tests/unit/section-manager.test.js`
    - _Requirements: 6.1, 6.2, 6.4, 6.5_

- [ ] 14. Implement VoiceAgent (content.js)
  - [ ] 14.1 Refactor `VoiceAgent` in `content.js` with reliability improvements
    - Implement `connect()` with 5s timeout, `disconnect()`, `getStatus()`
    - Implement exponential backoff reconnection: 1s, 2s, 4s — max 3 attempts
    - Implement automatic token refresh on 401/expired before reconnect
    - Implement `startPushToTalk()`, `stopPushToTalk()` with <100ms audio capture start
    - Implement `onTranscript(callback)`, `onStatusChange(callback)`
    - Render connection status indicator in UnifiedPane
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ] 14.2 Write property test: Voice reconnection exponential backoff
    - **Property 21: Voice reconnection exponential backoff**
    - Reconnection delays follow [1s, 2s, 4s]; stops after exactly 3 failed attempts
    - File: `tests/property/voice-agent.property.test.js`
    - **Validates: Requirements 9.2**

  - [ ] 14.3 Write property test: Voice status indicator state consistency
    - **Property 22: Voice status indicator state consistency**
    - Displayed status always equals `VoiceAgent.getStatus()` after any state transition
    - File: `tests/property/voice-agent.property.test.js`
    - **Validates: Requirements 9.3**

  - [ ] 14.4 Write unit tests for VoiceAgent
    - Test connection timeout, reconnection sequence, token refresh, push-to-talk
    - File: `tests/unit/voice-agent.test.js`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.7_

- [ ] 15. Checkpoint — UI and feature modules complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Implement SettingsPane (options.js + options.html)
  - [ ] 16.1 Build tabbed settings layout in `options.html`
    - Create 8-tab structure: General, Providers, Prompts, Buttons, Shortcuts, Voice, Formatting, Privacy
    - Style with glassmorphism consistent with pzdrk design system
    - _Requirements: 11.1_

  - [ ] 16.2 Implement General tab in `options.js`
    - Default provider/model selection, auto-summarize toggle, classic mode toggle, tags
    - _Requirements: 5.1, 11.1_

  - [ ] 16.3 Implement Providers tab in `options.js`
    - Per-provider config: API keys (multi-line), models, TPM/RPM limits, base URL
    - "Add Custom Provider" form with OpenAI-compatible endpoint fields
    - Live rate limit dashboard showing TPM used/limit, RPM used/limit per provider
    - _Requirements: 5.2, 5.4, 5.6, 5.7, 11.5_

  - [ ] 16.4 Implement Prompts tab in `options.js`
    - List all prompt templates grouped by category (summary, enrichment, action, custom)
    - Inline Prompt_Editor with template variable chips, syntax highlighting for `{variables}`
    - "Reset to Default" button per prompt
    - Validate unknown variables and highlight in red
    - _Requirements: 3.5, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ] 16.5 Implement Buttons tab in `options.js`
    - "Add Button" form: label, icon (emoji), prompt template, scope, optional provider/model override
    - Drag-to-reorder, edit, delete custom buttons
    - Per-button hotkey assignment
    - _Requirements: 6.1, 6.4, 6.6_

  - [ ] 16.6 Implement Shortcuts tab in `options.js`
    - List all commands with current hotkey binding
    - "Record" button to capture key combination
    - Conflict detection warning with confirm/change option
    - "Reset All Shortcuts" button
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.7_

  - [ ] 16.7 Implement Voice tab in `options.js`
    - Voice personality selector, auto-speak toggle, push-to-talk hotkey, connection timeout
    - _Requirements: 9.6_

  - [ ] 16.8 Implement Formatting tab in `options.js`
    - Font size, color scheme (auto/dark/light), semantic markup style editor (entity, term, wiki, evidence, action colors)
    - _Requirements: 11.3_

  - [ ] 16.9 Implement Privacy tab in `options.js`
    - History integration toggle with days/maxEntries config, per-command overrides
    - Web search enrichment toggle (global + per-command)
    - _Requirements: 7.4, 7.5, 8.3_

  - [ ] 16.10 Implement settings persistence, import/export, and input validation in `options.js`
    - Save to `chrome.storage.sync` on change; apply without extension reload
    - Import/export all settings as JSON file
    - Validate all inputs: API key format, numeric ranges, required fields; show inline errors
    - _Requirements: 4.2, 6.6, 11.2, 11.4, 11.6_

  - [ ] 16.11 Write property test: Settings persistence round trip
    - **Property 27: Settings persistence round trip**
    - Save settings then load produces equivalent object (covers prompts, buttons, providers, hotkeys)
    - File: `tests/property/settings.property.test.js`
    - **Validates: Requirements 4.2, 6.6, 11.2**

  - [ ] 16.12 Write property test: Settings import/export round trip
    - **Property 28: Settings import/export round trip**
    - Export to JSON then import produces equivalent settings object
    - File: `tests/property/settings.property.test.js`
    - **Validates: Requirements 11.4**

  - [ ] 16.13 Write property test: Settings input validation
    - **Property 29: Settings input validation**
    - Validator accepts values matching constraints, rejects violations with error messages
    - File: `tests/property/settings.property.test.js`
    - **Validates: Requirements 11.6**

  - [ ] 16.14 Write property test: User-modified prompts preserved on update
    - **Property 15: User-modified prompts preserved on update**
    - Extension update preserves user-modified prompts, updates only unmodified defaults
    - File: `tests/property/settings.property.test.js`
    - **Validates: Requirements 4.6**

  - [ ] 16.15 Write property test: Prompt reset to default
    - **Property 16: Prompt reset to default**
    - "Reset to Default" restores exactly the built-in default template value
    - File: `tests/property/settings.property.test.js`
    - **Validates: Requirements 4.3**

  - [ ] 16.16 Write unit tests for SettingsPane
    - Test tab switching, settings save/load, import/export, validation errors, rate dashboard
    - File: `tests/unit/settings.test.js`
    - _Requirements: 11.1, 11.2, 11.4, 11.6_

- [ ] 17. Checkpoint — Settings pane complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Implement v6 → v7 settings migration
  - [ ] 18.1 Implement migration function in `background.js` or `options.js`
    - Read existing v6 keys (`groqApiKey`, `groqApiKeys`, `cerebrasApiKeys`, `model`, `modelGroq`, `modelCerebras`, `summaryPrompt`, `summaryJsonPrompt`, `sectionEnrichPrompt`, `actionPrompts`, etc.)
    - Map to v7 schema (`providers.groq.apiKeys`, `providers.cerebras.apiKeys`, `coreModel`, `sectionTemplates.*`, `customButtons[]`)
    - Track migration state with `settingsVersion` key; run once, idempotent
    - _Requirements: 11.2 (backward compatibility implied by design)_

  - [ ] 18.2 Write unit tests for settings migration
    - Test with known v6 fixture data, verify correct v7 mapping
    - Test idempotence: running migration twice produces same result
    - Test partial v6 data (some keys missing)
    - File: `tests/unit/settings-migration.test.js`
    - _Requirements: 11.2_

- [ ] 19. Wire message passing between content.js and background.js
  - [ ] 19.1 Implement message handlers in `background.js` for new message types
    - Handle `executeSection`: run Splitter → BrowserContext → WebSearchEnrichment → ProviderRouter.dispatchParallel, stream chunk results back via `chrome.tabs.sendMessage`
    - Handle `getBrowserContext`: return BrowserContext.collect() result
    - Handle `exaSearch`: return WebSearchEnrichment.enrich() result
    - Handle `getProviderStatus` and `getRateBudgetStats`: return status data for settings dashboard
    - _Requirements: 2.1, 2.2, 2.5, 7.1, 8.1_

  - [ ] 19.2 Implement message listeners in `content.js`
    - Handle `sectionChunkResult`: route to `SectionManager.updateSectionChunk()`
    - Handle `sectionError`: display error state in section with "Retry" button
    - _Requirements: 2.5, 2.6_

  - [ ] 19.3 Wire CommandRail button clicks through the full pipeline
    - Button click → SectionManager.createSection() → sendMessage to background → chunk results stream back → incremental render
    - Wire custom button provider/model overrides into the message payload
    - Wire HotkeyManager commands to trigger the same flow
    - _Requirements: 1.1, 6.3, 10.6_

- [ ] 20. Wire settings changes to runtime components
  - [ ] 20.1 Listen for `chrome.storage.onChanged` in `content.js` and `background.js`
    - In content.js: update UnifiedPane formatting, HotkeyManager bindings, CommandRail custom buttons on settings change
    - In background.js: update ProviderRouter providers/limits, RateBudget limits on settings change
    - Apply changes without requiring extension reload
    - _Requirements: 5.2, 5.3, 11.2, 11.3_

- [ ] 21. Checkpoint — Full integration complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 22. Remove legacy floating note system
  - [ ] 22.1 Remove `createNote()` and related floating note code from `content.js`
    - Remove old note creation, positioning, and management functions
    - Remove associated CSS classes from `content.css`
    - Ensure UnifiedPane is the sole UI entry point
    - _Requirements: 1.1 (replaces floating notes)_

- [ ] 23. Final checkpoint — All tests pass, extension loads cleanly
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate the 29 universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All code is vanilla ES2022 JavaScript — no build step, no bundler
- Chrome API mocks in `tests/setup.js` are shared across all test files
