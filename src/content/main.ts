import { smartApiRouter } from '@core/api-router/smart-router';
import { keyRotationEngine } from '@core/key-manager/rotation-engine';
import type { RequestProfile, SummaryData } from '@shared/types';
import { SYSTEM_PROMPTS } from '@shared/constants';

// Initialize API keys from storage
async function initializeKeys(): Promise<void> {
  const { apiKeys } = await chrome.storage.sync.get('apiKeys');
  
  if (apiKeys?.groq) {
    keyRotationEngine.registerKeys('groq', apiKeys.groq);
  }
  if (apiKeys?.cerebras) {
    keyRotationEngine.registerKeys('cerebras', apiKeys.cerebras);
  }
  if (apiKeys?.openai) {
    keyRotationEngine.registerKeys('openai', apiKeys.openai);
  }
}

// Enhanced summary generation with racing
async function generateSummaryEnhanced(url: string, content: string): Promise<SummaryData> {
  const request: RequestProfile = {
    id: `summary-${Date.now()}`,
    prompt: `Analyze this page and provide a comprehensive summary in Russian.
    
URL: ${url}

Content:
${content.slice(0, 12000)}

Provide output as JSON with fields:
- core: main point (2-3 sentences)
- keyPoints: array of key insights
- til: array of "today I learned" facts
- actions: array of actionable items
- entities: array of named entities
- terms: array of {term, definition}`,
    systemPrompt: `${SYSTEM_PROMPTS.mondayPersona}\n\n${SYSTEM_PROMPTS.jsonValidator}`,
    estimatedInputTokens: Math.ceil(content.length / 4),
    estimatedOutputTokens: 1500,
    requiresJson: true,
    requiresStreaming: false,
    complexity: 'complex',
    latencySlo: 5000,
    retryCount: 0
  };

  // Execute with racing (fastest provider wins)
  const response = await smartApiRouter.execute(request, {
    strategy: 'race',
    timeoutMs: 8000,
    maxRetries: 2
  });

  // Parse JSON response
  let summary;
  try {
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    summary = JSON.parse(jsonMatch ? jsonMatch[0] : response.content);
  } catch (e) {
    // Fallback to raw text
    summary = {
      core: response.content.slice(0, 500),
      keyPoints: [],
      til: [],
      actions: [],
      entities: [],
      terms: []
    };
  }

  return {
    id: `summary-${Date.now()}`,
    url,
    title: document.title,
    timestamp: Date.now(),
    domain: new URL(url).hostname,
    depth: 3, // Would be calculated
    tags: [], // Would be extracted
    tokenCount: response.inputTokens + response.outputTokens,
    summary: {
      core: summary.core || '',
      keyPoints: summary.keyPoints || [],
      til: summary.til || [],
      actions: summary.actions || [],
      entities: summary.entities || [],
      terms: summary.terms || []
    },
    rawContent: content
  };
}

// Batch translation with parallel processing
async function translateBatch(texts: string[], targetLang: string): Promise<string[]> {
  const items = texts.map((text, i) => ({
    id: `trans-${i}`,
    prompt: `Translate to ${targetLang}:\n\n${text}`,
    priority: 1
  }));

  const results = await smartApiRouter.executeBatch(items, {
    concurrency: 20,
    maxRetries: 1
  });

  return results.map(r => r.response?.content || r.error || '');
}

void translateBatch;

// Initialize on load
async function init(): Promise<void> {
  await initializeKeys();
  
  // Register providers
  smartApiRouter.registerProvider({
    id: 'groq',
    name: 'Groq',
    keys: [],
    models: [{
      id: 'groq/compound',
      provider: 'groq',
      maxTokens: 8192,
      supportsJson: true,
      supportsStreaming: true,
      costPer1kInput: 0.00015,
      costPer1kOutput: 0.0006,
      avgLatencyMs: 650
    }],
    baseUrl: 'https://api.groq.com/openai/v1',
    rateLimits: {
      requestsPerMinute: 30,
      tokensPerMinute: 6000
    },
    priority: 1,
    healthStatus: 'healthy'
  });

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'summarize') {
      const content = extractPageContent();
      generateSummaryEnhanced(location.href, content)
        .then(summary => {
          // Send to data hub
          syncToHub(summary);
          sendResponse({ success: true, data: summary });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // Async response
    }
  });
}

// Extract page content
function extractPageContent(): string {
  const selectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content'];
  let container: Element | null = null;
  
  for (const sel of selectors) {
    container = document.querySelector(sel);
    if (container) break;
  }
  
  if (!container) container = document.body;
  
  const clone = container.cloneNode(true) as Element;
  clone.querySelectorAll('script, style, nav, footer, header, aside, .ad').forEach(el => el.remove());
  
  return (clone.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 25000);
}

// Sync to local data hub
async function syncToHub(summary: SummaryData): Promise<void> {
  try {
    await fetch('http://localhost:7420/api/summaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary)
    });
  } catch (e) {
    console.error('Failed to sync to hub:', e);
  }
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
