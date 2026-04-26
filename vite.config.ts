import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { copyFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// Dynamic import for manifest
const manifest = {
  manifest_version: 3,
  name: '✦ pzdrk Advanced',
  version: '7.0.0',
  description: 'AI analysis • Vector DB • Multi-Provider • Obsidian Sync',
  permissions: [
    'storage',
    'activeTab',
    'contextMenus',
    'tabs',
    'history',
    'declarativeNetRequest',
    'declarativeNetRequestFeedback',
    'scripting',
    'alarms',
    'offscreen'
  ],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background/main.ts',
    type: 'module'
  },
  content_scripts: [{
    matches: ['<all_urls>'],
    js: ['src/content/main.ts'],
    css: ['src/content/styles/main.css'],
    run_at: 'document_idle'
  }],
  action: {
    default_popup: 'src/popup/index.html'
  },
  options_page: 'options.html',
  web_accessible_resources: [{
    resources: ['assets/*'],
    matches: ['<all_urls>']
  }]
};

export default defineConfig({
  plugins: [
    crx({ manifest }),
    {
      name: 'copy-content-css',
      closeBundle() {
        const targetDir = resolve(__dirname, 'dist/src/content/styles');
        mkdirSync(targetDir, { recursive: true });
        copyFileSync(
          resolve(__dirname, 'content.css'),
          resolve(targetDir, 'main.css')
        );
      }
    }
  ],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        options: resolve(__dirname, 'options.html')
      }
    }
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@content': resolve(__dirname, 'src/content'),
      '@background': resolve(__dirname, 'src/background'),
      '@storage': resolve(__dirname, 'src/storage'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
});
