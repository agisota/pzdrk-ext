import { smartApiRouter } from '@core/api-router/smart-router';
import { keyRotationEngine } from '@core/key-manager/rotation-engine';
import { DEFAULT_PROVIDERS } from '@shared/constants';
import type { SummaryData } from '@shared/types';
import sharedDefaults from '../../shared-defaults.json';

// Background service worker for Rox Discovery v7.0
console.log('Rox Discovery v7.0 background service worker started');

// Initialize providers from storage
async function initializeProviders(): Promise<void> {
  const { apiKeys, groqApiKeys, groqApiKey } = await chrome.storage.sync.get([
    'apiKeys', 'groqApiKeys', 'groqApiKey'
  ]);
  const legacyGroqKeys = typeof groqApiKey === 'string' && groqApiKey.length > 0 ? [groqApiKey] : undefined;
  const groqKeys = apiKeys?.groq
    ?? (Array.isArray(groqApiKeys) ? groqApiKeys : undefined)
    ?? legacyGroqKeys
    ?? sharedDefaults.groqApiKeys;
  keyRotationEngine.registerKeys('groq', groqKeys);
  smartApiRouter.registerProvider({
    ...DEFAULT_PROVIDERS.groq,
    keys: groqKeys
  });

  if (apiKeys?.cerebras?.length > 0) {
    keyRotationEngine.registerKeys('cerebras', apiKeys.cerebras);
    smartApiRouter.registerProvider({
      ...DEFAULT_PROVIDERS.cerebras,
      keys: apiKeys.cerebras
    });
  }
  if (apiKeys?.openai?.length > 0) {
    keyRotationEngine.registerKeys('openai', apiKeys.openai);
    smartApiRouter.registerProvider({
      ...DEFAULT_PROVIDERS.openai,
      keys: apiKeys.openai
    });
  }
}

// Sync summary to local hub
async function syncToHub(summary: SummaryData): Promise<void> {
  try {
    const response = await fetch('http://localhost:7420/api/summaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary)
    });
    
    if (!response.ok) {
      console.warn('Failed to sync to hub:', response.statusText);
    }
  } catch (e) {
    console.warn('Hub not available, queuing for later sync');
    // Queue for later sync
    await queueForSync(summary);
  }
}

// Queue summary for later sync
async function queueForSync(summary: SummaryData): Promise<void> {
  const { syncQueue = [] } = await chrome.storage.local.get('syncQueue');
  syncQueue.push({
    summary,
    timestamp: Date.now(),
    attempts: 0
  });
  
  // Keep only last 100 items
  if (syncQueue.length > 100) {
    syncQueue.shift();
  }
  
  await chrome.storage.local.set({ syncQueue });
}

// Process sync queue
async function processSyncQueue(): Promise<void> {
  const { syncQueue = [] } = await chrome.storage.local.get('syncQueue');
  if (syncQueue.length === 0) return;
  
  const successful: number[] = [];
  
  for (let i = 0; i < syncQueue.length; i++) {
    const item = syncQueue[i];
    
    if (item.attempts >= 3) {
      successful.push(i); // Remove failed items after 3 attempts
      continue;
    }
    
    try {
      const response = await fetch('http://localhost:7420/api/summaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.summary)
      });
      
      if (response.ok) {
        successful.push(i);
      } else {
        item.attempts++;
      }
    } catch (e) {
      item.attempts++;
    }
  }
  
  // Remove successful items
  const remaining = syncQueue.filter((_item: unknown, i: number) => !successful.includes(i));
  await chrome.storage.local.set({ syncQueue: remaining });
}

async function getTelegramSettings() {
  const stored = await chrome.storage.local.get([
    'telegramEnabled', 'telegramBotToken', 'telegramChatId',
    'telegramSendHtml', 'telegramSendMarkdown'
  ]);
  if ((stored.telegramEnabled ?? sharedDefaults.telegramEnabled) !== true) throw new Error('Telegram выключен в настройках');
  const botToken = String(stored.telegramBotToken ?? sharedDefaults.telegramBotToken).trim();
  const chatId = String(stored.telegramChatId ?? sharedDefaults.telegramChatId).trim();
  if (!botToken || !chatId) throw new Error('Укажите Telegram bot token и chat id в настройках');
  return {
    botToken,
    chatId,
    sendHtml: stored.telegramSendHtml !== false,
    sendMarkdown: stored.telegramSendMarkdown === true
  };
}

async function telegramRequest(botToken: string, method: string, init: RequestInit): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, init);
  const data = await response.json() as { ok?: boolean; description?: string };
  if (!response.ok || data.ok === false) {
    throw new Error(data.description || `Telegram ${method} failed: ${response.status}`);
  }
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<void> {
  await telegramRequest(botToken, 'sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 3900),
      disable_web_page_preview: true
    })
  });
}

async function sendTelegramArtifact(artifact: unknown): Promise<{ sent: string[]; title: string }> {
  const settings = await getTelegramSettings();
  const data = artifact && typeof artifact === 'object' ? artifact as Record<string, unknown> : {};
  const title = String(data.title || 'Rox Discovery artifact');
  const url = String(data.url || '');
  const safeTitle = title.replace(/[^\wа-яА-ЯёЁ.-]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'Rox-Discovery';
  const sent: string[] = [];
  for (const [type, enabled, mime] of [
    ['html', settings.sendHtml, 'text/html;charset=utf-8'],
    ['markdown', settings.sendMarkdown, 'text/markdown;charset=utf-8']
  ] as const) {
    const content = String(data[type] || '');
    if (!enabled || !content) continue;
    const form = new FormData();
    form.append('chat_id', settings.chatId);
    form.append('caption', `${title}\n${url}`.replace(/\s+/g, ' ').slice(0, 900));
    form.append('document', new Blob([content], { type: mime }), `${safeTitle}.${type === 'html' ? 'html' : 'md'}`);
    await telegramRequest(settings.botToken, 'sendDocument', { method: 'POST', body: form });
    sent.push(type);
  }
  if (!sent.length) {
    await sendTelegramMessage(settings.botToken, settings.chatId, `${title}\n${url}\n\n${String(data.text || '').slice(0, 2400)}`);
    sent.push('message');
  }
  return { sent, title };
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'syncSummary':
          await syncToHub(request.data);
          sendResponse({ success: true });
          break;
          
        case 'getKeyStats':
          sendResponse({
            success: true,
            data: keyRotationEngine.getStats()
          });
          break;
          
        case 'testHubConnection':
          try {
            const response = await fetch('http://localhost:7420/health');
            sendResponse({
              success: true,
              connected: response.ok
            });
          } catch (e) {
            sendResponse({
              success: true,
              connected: false
            });
          }
          break;
          
        case 'testTelegram': {
          const settings = await getTelegramSettings();
          await sendTelegramMessage(settings.botToken, settings.chatId, request.message || 'Rox Discovery: Telegram delivery connected.');
          sendResponse({ success: true, data: { ok: true } });
          break;
        }

        case 'resetTrackerStats':
          // The shared options page sends this reset in both extension builds.
          // Vite has no tracker statistics to clear, but must acknowledge it.
          sendResponse({ success: true, data: true });
          break;
        case 'sendTelegramArtifact':
          sendResponse({ success: true, data: await sendTelegramArtifact(request.artifact) });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (e) {
      sendResponse({
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
    }
  })();
  
  return true; // Async response
});

// Periodic tasks
chrome.alarms.create('syncQueue', { periodInMinutes: 1 });
chrome.alarms.create('refreshKeys', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncQueue') {
    processSyncQueue();
  } else if (alarm.name === 'refreshKeys') {
    initializeProviders();
  }
});

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  initializeProviders();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  initializeProviders();
});

// Handle storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && (changes.apiKeys || changes.groqApiKeys || changes.groqApiKey)) {
    initializeProviders();
  }
});
