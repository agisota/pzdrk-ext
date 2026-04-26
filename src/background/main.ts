import { smartApiRouter } from '@core/api-router/smart-router';
import { keyRotationEngine } from '@core/key-manager/rotation-engine';
import { DEFAULT_PROVIDERS } from '@shared/constants';
import type { SummaryData } from '@shared/types';

// Background service worker for pzdrk v7.0
console.log('🚀 Pzdrk v7.0 background service worker started');

// Initialize providers from storage
async function initializeProviders(): Promise<void> {
  const { apiKeys } = await chrome.storage.sync.get('apiKeys');
  
  if (apiKeys) {
    // Register Groq
    if (apiKeys.groq?.length > 0) {
      keyRotationEngine.registerKeys('groq', apiKeys.groq);
      smartApiRouter.registerProvider({
        ...DEFAULT_PROVIDERS.groq,
        keys: apiKeys.groq
      });
    }
    
    // Register Cerebras
    if (apiKeys.cerebras?.length > 0) {
      keyRotationEngine.registerKeys('cerebras', apiKeys.cerebras);
      smartApiRouter.registerProvider({
        ...DEFAULT_PROVIDERS.cerebras,
        keys: apiKeys.cerebras
      });
    }
    
    // Register OpenAI
    if (apiKeys.openai?.length > 0) {
      keyRotationEngine.registerKeys('openai', apiKeys.openai);
      smartApiRouter.registerProvider({
        ...DEFAULT_PROVIDERS.openai,
        keys: apiKeys.openai
      });
    }
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
  if (areaName === 'sync' && changes.apiKeys) {
    initializeProviders();
  }
});
