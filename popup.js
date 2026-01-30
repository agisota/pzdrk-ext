document.addEventListener('DOMContentLoaded', async () => {
  const settings = await chrome.storage.sync.get([
    'autoSummarize', 'privacyEnabled'
  ]);

  document.getElementById('autoSummarize').checked = settings.autoSummarize !== false;
  document.getElementById('privacyEnabled').checked = settings.privacyEnabled !== false;

  // Get tracker stats
  chrome.runtime.sendMessage({ action: 'getTrackerStats' }, (response) => {
    if (response?.success) {
      document.getElementById('trackersBlocked').textContent = response.data.blocked || 0;
    }
  });

  // Toggle handlers
  ['autoSummarize', 'privacyEnabled'].forEach(id => {
    document.getElementById(id).addEventListener('change', async (e) => {
      await chrome.storage.sync.set({ [id]: e.target.checked });
    });
  });

  // Action buttons
  document.getElementById('summarizeBtn').addEventListener('click', () => {
    sendToContent({ action: 'summarize' });
    window.close();
  });

  document.getElementById('translateBtn').addEventListener('click', () => {
    const lang = document.getElementById('translateLang').value;
    sendToContent({ action: 'translatePage', lang });
    window.close();
  });

  document.getElementById('mindmapBtn').addEventListener('click', () => {
    sendToContent({ action: 'generateMindmap' });
    window.close();
  });

  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
});

function sendToContent(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, message);
    }
  });
}
