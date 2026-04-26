import { DEFAULT_PROVIDERS } from '@shared/constants';

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  await checkHubStatus();
  setupEventListeners();
});

async function loadStats(): Promise<void> {
  try {
    // Get key stats from background
    const response = await chrome.runtime.sendMessage({ action: 'getKeyStats' });
    
    if (response.success) {
      renderProviders(response.data);
      updateSummariesCount(response.data);
    }
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

async function checkHubStatus(): Promise<void> {
  const hubStatus = document.getElementById('hub-status');
  const milvusStatus = document.getElementById('milvus-status');
  
  if (!hubStatus || !milvusStatus) return;
  
  try {
    // Check hub connection
    const hubResponse = await chrome.runtime.sendMessage({ action: 'testHubConnection' });
    hubStatus.textContent = hubResponse.connected ? '●' : '○';
    hubStatus.style.color = hubResponse.connected ? '#4ade80' : '#ef4444';
    
    // Check Milvus via hub
    if (hubResponse.connected) {
      const statsResponse = await fetch('http://localhost:7420/api/stats');
      if (statsResponse.ok) {
        milvusStatus.textContent = '●';
        milvusStatus.style.color = '#4ade80';
      } else {
        milvusStatus.textContent = '○';
        milvusStatus.style.color = '#ef4444';
      }
    } else {
      milvusStatus.textContent = '○';
      milvusStatus.style.color = '#888';
    }
  } catch (e) {
    hubStatus.textContent = '○';
    hubStatus.style.color = '#ef4444';
    milvusStatus.textContent = '○';
    milvusStatus.style.color = '#888';
  }
}

function renderProviders(stats: Record<string, { total: number; available: number; exhausted: number }>): void {
  const container = document.getElementById('providers-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  Object.entries(stats).forEach(([providerId, data]) => {
    const provider = DEFAULT_PROVIDERS[providerId];
    if (!provider) return;
    
    let status: 'healthy' | 'degraded' | 'down' = 'healthy';
    if (data.available === 0) status = 'down';
    else if (data.exhausted > 0) status = 'degraded';
    
    const item = document.createElement('div');
    item.className = 'provider-item';
    item.innerHTML = `
      <div class="provider-name">
        <div class="provider-status ${status}"></div>
        <span>${provider.name}</span>
      </div>
      <span>${data.available}/${data.total} keys</span>
    `;
    
    container.appendChild(item);
  });
}

function updateSummariesCount(stats: Record<string, unknown>): void {
  const countEl = document.getElementById('summaries-count');
  if (!countEl) return;
  
  // This would come from actual storage
  // For now, show total providers as a proxy
  const providerCount = Object.keys(stats).length;
  countEl.textContent = providerCount.toString();
}

function setupEventListeners(): void {
  // Summarize button
  const summarizeBtn = document.getElementById('summarize-btn');
  if (summarizeBtn) {
    summarizeBtn.addEventListener('click', async () => {
      setLoading(summarizeBtn, true);
      
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.id) {
          await chrome.tabs.sendMessage(tab.id, { action: 'summarize' });
        }
        window.close();
      } catch (e) {
        console.error('Failed to summarize:', e);
        setLoading(summarizeBtn, false);
      }
    });
  }
  
  // Translate button
  const translateBtn = document.getElementById('translate-btn');
  if (translateBtn) {
    translateBtn.addEventListener('click', async () => {
      setLoading(translateBtn, true);
      
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.id) {
          await chrome.tabs.sendMessage(tab.id, { action: 'translatePage', lang: 'ru' });
        }
        window.close();
      } catch (e) {
        console.error('Failed to translate:', e);
        setLoading(translateBtn, false);
      }
    });
  }
  
  // Mindmap button
  const mindmapBtn = document.getElementById('mindmap-btn');
  if (mindmapBtn) {
    mindmapBtn.addEventListener('click', async () => {
      setLoading(mindmapBtn, true);
      
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab.id) {
          await chrome.tabs.sendMessage(tab.id, { action: 'generateMindmap' });
        }
        window.close();
      } catch (e) {
        console.error('Failed to generate mindmap:', e);
        setLoading(mindmapBtn, false);
      }
    });
  }
  
  // Settings link
  const settingsLink = document.getElementById('settings-link');
  if (settingsLink) {
    settingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

function setLoading(button: HTMLElement, loading: boolean): void {
  const control = button as HTMLButtonElement;

  if (loading) {
    const originalContent = button.innerHTML;
    button.setAttribute('data-original', originalContent);
    button.innerHTML = '<div class="loading"></div>';
    control.disabled = true;
  } else {
    const originalContent = button.getAttribute('data-original');
    if (originalContent) {
      button.innerHTML = originalContent;
    }
    control.disabled = false;
  }
}
