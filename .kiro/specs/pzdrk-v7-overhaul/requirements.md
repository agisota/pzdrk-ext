# Requirements Document

## Introduction

Major overhaul of the pzdrk Chrome Extension (v7.0) focused on seven pillars:
1. Unified single-pane UI with inline sections replacing separate floating notes
2. Massively parallel multi-stream LLM pipeline that saturates available TPM/RPM limits
3. Full prompt visibility and editability from the extension panel
4. Universal provider/model configuration per command, section, and module
5. Custom user-defined action buttons with per-button provider/model routing
6. Deep browsing history integration and web search enrichment in every request
7. Grok voice agent fixes and comprehensive hotkey/shortcut customization

## Glossary

- **Unified_Pane**: The single scrollable content panel that replaces multiple floating notes; all output sections (summary, deep dive, mindmap, etc.) render inline as collapsible blocks within this pane
- **Section**: A discrete content block inside the Unified_Pane (e.g., summary, deep dive, translation, mindmap); each section is produced by one or more LLM calls
- **Splitter**: The logic that divides a page's content into chunks for parallel LLM processing; each chunk is dispatched as an independent request
- **Section_Template**: A structured prompt template attached to a Section that specifies expected output format, target token count, and structural constraints
- **Command_Rail**: The vertical strip of action buttons on the right side of the Unified_Pane
- **Custom_Button**: A user-created button added to the Command_Rail with a user-defined prompt, icon, label, and optional provider/model override
- **Provider_Router**: The subsystem that selects which LLM provider and model to use for a given request, respecting per-command overrides and rate-limit budgets
- **Rate_Budget**: A runtime tracker that monitors tokens-per-minute (TPM) and requests-per-minute (RPM) consumption per provider/model and schedules requests to maximize throughput without exceeding limits
- **Browser_Context**: Aggregated data from the user's open tabs, recent browsing history, and navigation pathway, injected into prompts as contextual enrichment
- **Web_Search_Enrichment**: Supplementary information fetched via the Exa search API and merged into prompts before LLM calls
- **Settings_Pane**: The unified options page where all extension configuration lives — providers, models, prompts, hotkeys, buttons, and formatting rules
- **Hotkey_Map**: A user-editable mapping of keyboard shortcuts to extension commands
- **Grok_Voice_Agent**: The xAI Realtime WebSocket-based voice conversation subsystem
- **Prompt_Editor**: An inline UI component within the Settings_Pane or Unified_Pane that allows viewing and editing any prompt template used by the extension

## Requirements

### Requirement 1: Unified Single-Pane Output

**User Story:** As a user, I want all analysis outputs rendered in a single scrollable pane with inline sections, so that I do not need to manage multiple floating notes.

#### Acceptance Criteria

1. WHEN the user triggers any analysis command, THE Unified_Pane SHALL render the output as a new collapsible Section appended inline below existing Sections
2. THE Unified_Pane SHALL support at least 20 concurrent Sections without layout degradation or scroll performance issues
3. WHEN a Section is collapsed, THE Unified_Pane SHALL display only the Section header and a token-count badge
4. WHEN a Section is expanded, THE Unified_Pane SHALL render the full formatted content with semantic markup highlighting
5. THE Unified_Pane SHALL preserve the glassmorphism visual style (transparency, blur, shadows) consistent with the existing pzdrk design system
6. WHEN the user drags the Unified_Pane header, THE Unified_Pane SHALL reposition on screen and remember its position across page reloads
7. THE Unified_Pane SHALL include a sticky navigation sidebar listing all active Sections with scroll-to-section links

### Requirement 2: Parallel Multi-Stream LLM Pipeline

**User Story:** As a user, I want the extension to maximize LLM throughput by sending parallel concurrent requests across all available models and keys, so that analysis results are generated as fast as possible.

#### Acceptance Criteria

1. WHEN a Section is requested, THE Splitter SHALL divide the page content into chunks sized to fit within the target model's context window minus the Section_Template overhead
2. THE Provider_Router SHALL dispatch all chunks as parallel requests, distributing them across available API keys using round-robin with cooldown awareness
3. THE Rate_Budget SHALL track per-key TPM and RPM consumption in real time and delay requests only when a key's budget is within 10% of its limit
4. WHEN multiple providers are configured, THE Provider_Router SHALL route chunks to the provider with the most available rate budget headroom
5. THE Unified_Pane SHALL render each chunk's response incrementally as it arrives, without waiting for all chunks to complete
6. WHEN a chunk request fails, THE Provider_Router SHALL retry the chunk on an alternate key or provider within 2 seconds
7. THE Provider_Router SHALL request max_tokens equal to the model's maximum output capacity for every request unless the Section_Template specifies a lower value
8. WHEN the user configures maxParallelRequests in settings, THE Provider_Router SHALL respect that limit as the upper bound of concurrent in-flight requests

### Requirement 3: Section Templates with Structured Output Control

**User Story:** As a user, I want each analysis section to use a detailed prompt template that specifies expected output structure, token budget, and formatting rules, so that outputs are consistent and comprehensive.

#### Acceptance Criteria

1. THE Section_Template SHALL define: system prompt, user prompt template, expected output format (markdown/JSON/list), target output token count, and structural constraints (headings, bullet depth, column layout)
2. WHEN a Section is generated, THE Provider_Router SHALL include the Section_Template's structural constraints in the system prompt sent to the LLM
3. THE Section_Template SHALL support template variables: {url}, {title}, {content}, {summary}, {browserContext}, {tags}, {selection}, {webSearchResults}, {chunkIndex}, {totalChunks}
4. WHEN a Section_Template specifies a target token count, THE Provider_Router SHALL set max_tokens to at least that value
5. THE Settings_Pane SHALL allow the user to view and edit every Section_Template used by the extension

### Requirement 4: Full Prompt Visibility and Editability

**User Story:** As a user, I want to view and edit all prompt templates used by the extension from a single settings panel, so that I can customize AI behavior without editing source code.

#### Acceptance Criteria

1. THE Settings_Pane SHALL display a dedicated "Prompts" tab listing every prompt template grouped by category (summary, enrichment, action, custom)
2. WHEN the user edits a prompt template, THE Settings_Pane SHALL save the modified template to chrome.storage.sync immediately on blur or explicit save
3. THE Prompt_Editor SHALL provide a "Reset to Default" button per prompt that restores the built-in template
4. THE Prompt_Editor SHALL display available template variables as clickable chips that insert the variable at the cursor position
5. THE Prompt_Editor SHALL validate that all template variables used in the prompt exist in the supported variable set and highlight unknown variables in red
6. WHEN the extension is updated, THE Settings_Pane SHALL preserve user-modified prompts and only update prompts the user has not customized

### Requirement 5: Universal Provider and Model Configuration

**User Story:** As a user, I want to configure which LLM provider and model is used for any command, section, or module independently, so that I can optimize cost, speed, and quality per task.

#### Acceptance Criteria

1. THE Settings_Pane SHALL allow the user to set a default provider and model for the entire extension
2. THE Settings_Pane SHALL allow the user to override the provider and model per individual command (summary, translate, mindmap, each action button, each custom button)
3. WHEN a command has no per-command provider override, THE Provider_Router SHALL use the extension-wide default
4. THE Settings_Pane SHALL allow adding custom providers by specifying: provider name, base URL (OpenAI-compatible chat completions endpoint), API keys, and available model IDs
5. WHEN a custom provider is added, THE Provider_Router SHALL route requests to that provider's endpoint using the OpenAI chat completions API format
6. THE Settings_Pane SHALL display per-provider rate limit configuration (TPM limit, RPM limit) so the Rate_Budget can enforce them
7. THE Settings_Pane SHALL allow the user to configure multiple API keys per provider, each on a separate line

### Requirement 6: Custom User-Defined Action Buttons

**User Story:** As a user, I want to add new action buttons to the command rail with my own prompts and per-button model routing, so that I can extend the extension's capabilities without code changes.

#### Acceptance Criteria

1. THE Settings_Pane SHALL provide an "Add Button" interface where the user specifies: label, icon (emoji or text), prompt template, and optional provider/model override
2. WHEN a Custom_Button is created, THE Command_Rail SHALL render the button in the user-specified order on the right side of the Unified_Pane
3. WHEN the user clicks a Custom_Button, THE Provider_Router SHALL execute the button's prompt template using the button's provider/model override or the extension default
4. THE Settings_Pane SHALL allow the user to reorder, edit, and delete Custom_Buttons
5. WHEN a Custom_Button's prompt template uses the {selection} variable and no text is selected, THE Unified_Pane SHALL display a toast instructing the user to select text first
6. THE extension SHALL persist Custom_Buttons in chrome.storage.sync and restore them on extension load

### Requirement 7: Deep Browsing History Integration

**User Story:** As a user, I want my full browsing history deeply integrated into every AI request, so that the AI understands my context and interests across sessions.

#### Acceptance Criteria

1. WHEN any LLM request is prepared, THE Browser_Context SHALL include the user's recent browsing history (up to 200 entries from the last 14 days) formatted as a structured list of titles and URLs
2. THE Browser_Context SHALL include all currently open tabs across all windows with their titles and URLs
3. THE Browser_Context SHALL include a navigation pathway showing how the user arrived at the current page (referrer chain)
4. WHEN the user configures history depth in settings, THE Browser_Context SHALL respect the configured number of days and entry limit
5. THE Settings_Pane SHALL allow the user to enable or disable browsing history inclusion per command

### Requirement 8: Web Search Enrichment

**User Story:** As a user, I want every analysis enriched with live web search results, so that the AI has access to current information beyond the page content.

#### Acceptance Criteria

1. WHEN a Section is generated and web search enrichment is enabled, THE Provider_Router SHALL call the Exa search API with a query derived from the page title and key topics before sending the LLM request
2. THE Web_Search_Enrichment SHALL inject search results (up to 5 snippets) into the prompt as a {webSearchResults} template variable
3. THE Settings_Pane SHALL allow the user to enable or disable web search enrichment globally and per command
4. WHEN the Exa API key is not configured, THE Web_Search_Enrichment SHALL skip enrichment silently without blocking the LLM request
5. IF the Exa search API returns an error, THEN THE Provider_Router SHALL proceed with the LLM request without search results and log the error to the console

### Requirement 9: Grok Voice Agent Fixes

**User Story:** As a user, I want the Grok voice agent to connect reliably, activate correctly, and behave predictably, so that I can use voice interactions without issues.

#### Acceptance Criteria

1. WHEN the user activates voice mode, THE Grok_Voice_Agent SHALL establish a WebSocket connection to the xAI Realtime API within 5 seconds or display a connection error toast
2. WHEN the WebSocket connection drops unexpectedly, THE Grok_Voice_Agent SHALL attempt automatic reconnection up to 3 times with exponential backoff (1s, 2s, 4s)
3. WHILE the Grok_Voice_Agent is connected, THE Unified_Pane SHALL display a visible connection status indicator (connected/reconnecting/disconnected)
4. WHEN the user presses the push-to-talk hotkey, THE Grok_Voice_Agent SHALL begin capturing audio within 100ms and transmit it over the WebSocket
5. WHEN the Grok_Voice_Agent receives a voice response, THE Unified_Pane SHALL display a real-time transcript in a dedicated voice Section
6. THE Settings_Pane SHALL expose all Grok voice configuration: voice personality, auto-speak toggle, push-to-talk hotkey, and connection timeout
7. IF the xAI Realtime API token has expired, THEN THE Grok_Voice_Agent SHALL request a fresh token automatically before reconnecting

### Requirement 10: Comprehensive Hotkey and Shortcut Customization

**User Story:** As a user, I want to customize all keyboard shortcuts and button actions from a single settings panel, so that I can adapt the extension to my workflow.

#### Acceptance Criteria

1. THE Settings_Pane SHALL display a "Shortcuts" tab listing every extension command with its current hotkey binding
2. THE Settings_Pane SHALL allow the user to change any hotkey by clicking a "Record" button and pressing the desired key combination
3. WHEN the user records a hotkey that conflicts with an existing binding, THE Settings_Pane SHALL display a warning and ask the user to confirm or choose a different combination
4. THE Hotkey_Map SHALL support modifier combinations: Ctrl, Alt, Shift, Meta (Cmd on macOS) plus any alphanumeric or function key
5. THE Settings_Pane SHALL allow the user to assign hotkeys to Custom_Buttons
6. WHEN the user presses a configured hotkey on any page, THE extension SHALL execute the associated command within 200ms
7. THE Settings_Pane SHALL provide a "Reset All Shortcuts" button that restores default hotkey bindings

### Requirement 11: Unified Settings Pane

**User Story:** As a user, I want a single comprehensive settings page where I can configure all extension features — providers, prompts, buttons, hotkeys, formatting, and behavior — so that I have one place to control everything.

#### Acceptance Criteria

1. THE Settings_Pane SHALL organize settings into tabbed sections: General, Providers, Prompts, Buttons, Shortcuts, Voice, Formatting, and Privacy
2. THE Settings_Pane SHALL persist all settings to chrome.storage.sync and apply changes without requiring extension reload
3. WHEN the user modifies a formatting rule (semantic markup styles, font size, color scheme), THE Unified_Pane SHALL reflect the change on the next Section render
4. THE Settings_Pane SHALL include an import/export feature that serializes all settings to JSON and restores them from a JSON file
5. THE Settings_Pane SHALL display current rate limit usage per provider (TPM used / TPM limit, RPM used / RPM limit) as a live dashboard
6. THE Settings_Pane SHALL validate all inputs (API keys format, numeric ranges, required fields) and display inline error messages for invalid values
