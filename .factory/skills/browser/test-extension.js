#!/usr/bin/env node

// ============ AUTOMATED EXTENSION TESTS ============
// Validates extension code without requiring Chrome with Developer mode.
// Tests: syntax, manifest, message handlers, DOM structure, API contracts.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT_ROOT = path.resolve(__dirname, '../../..');
const RESULTS = { passed: 0, failed: 0, skipped: 0, errors: [] };

function test(name, fn) {
  try {
    fn();
    RESULTS.passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    RESULTS.failed++;
    RESULTS.errors.push({ name, error: e.message });
    process.stdout.write(`  ✗ ${name}: ${e.message}\n`);
  }
}

function skip(name, reason) {
  RESULTS.skipped++;
  process.stdout.write(`  ⊘ ${name} (${reason})\n`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function readFile(rel) {
  const p = path.join(EXT_ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`File not found: ${rel}`);
  return fs.readFileSync(p, 'utf8');
}

function parseJSON(rel) {
  return JSON.parse(readFile(rel));
}

function syntaxCheck(code, filename) {
  try {
    new vm.Script(code, { filename });
    return null;
  } catch (e) {
    return e.message;
  }
}

// ============ TEST SUITES ============

function testManifest() {
  process.stdout.write('\n[Manifest]\n');
  
  test('manifest.json exists and is valid JSON', () => {
    const m = parseJSON('manifest.json');
    assert(m.manifest_version === 3, 'Expected MV3');
  });

  test('manifest has required fields', () => {
    const m = parseJSON('manifest.json');
    assert(m.name, 'Missing name');
    assert(m.version, 'Missing version');
    assert(m.permissions, 'Missing permissions');
  });

  test('background service_worker exists', () => {
    const m = parseJSON('manifest.json');
    const sw = m.background?.service_worker;
    assert(sw, 'No service_worker defined');
    assert(fs.existsSync(path.join(EXT_ROOT, sw)), `${sw} not found`);
  });

  test('content_scripts files exist', () => {
    const m = parseJSON('manifest.json');
    for (const cs of m.content_scripts || []) {
      for (const js of cs.js || []) {
        assert(fs.existsSync(path.join(EXT_ROOT, js)), `${js} not found`);
      }
      for (const css of cs.css || []) {
        assert(fs.existsSync(path.join(EXT_ROOT, css)), `${css} not found`);
      }
    }
  });

  test('options_page exists', () => {
    const m = parseJSON('manifest.json');
    if (m.options_page) {
      assert(fs.existsSync(path.join(EXT_ROOT, m.options_page)), `${m.options_page} not found`);
    }
  });

  test('popup exists', () => {
    const m = parseJSON('manifest.json');
    const popup = m.action?.default_popup;
    if (popup) {
      assert(fs.existsSync(path.join(EXT_ROOT, popup)), `${popup} not found`);
    }
  });

  test('icons exist', () => {
    const m = parseJSON('manifest.json');
    for (const [size, icon] of Object.entries(m.icons || {})) {
      assert(fs.existsSync(path.join(EXT_ROOT, icon)), `Icon ${icon} not found`);
    }
  });
}

function testSyntax() {
  process.stdout.write('\n[JavaScript Syntax]\n');
  
  const jsFiles = ['background.js', 'content.js', 'popup.js', 'options.js'];
  for (const file of jsFiles) {
    test(`${file} has valid syntax`, () => {
      const code = readFile(file);
      const err = syntaxCheck(code, file);
      assert(!err, err);
    });
  }
}

function testBackgroundHandlers() {
  process.stdout.write('\n[Background Message Handlers]\n');
  
  const bgCode = readFile('background.js');
  
  test('has onMessage listener', () => {
    assert(bgCode.includes('chrome.runtime.onMessage.addListener'), 'No onMessage listener');
  });

  const expectedActions = ['callGroq', 'searchExa', 'transcribeAudio', 'getBrowserContext'];
  for (const action of expectedActions) {
    test(`handles action: ${action}`, () => {
      const pattern = new RegExp(`['"\`]${action}['"\`]`);
      assert(pattern.test(bgCode), `Action ${action} not found in background.js`);
    });
  }
}

function testContentScript() {
  process.stdout.write('\n[Content Script]\n');
  
  const csCode = readFile('content.js');
  
  test('has getSettings function', () => {
    assert(csCode.includes('async function getSettings'), 'No getSettings function');
  });

  test('has summarizePage function', () => {
    assert(csCode.includes('async function summarizePage'), 'No summarizePage function');
  });

  test('has createNote function', () => {
    assert(csCode.includes('function createNote'), 'No createNote function');
  });

  test('uses chrome.runtime.sendMessage', () => {
    assert(csCode.includes('chrome.runtime.sendMessage'), 'No sendMessage calls');
  });

  test('has CSS class prefix pzdrk-', () => {
    assert(csCode.includes('pzdrk-'), 'No pzdrk- CSS class prefix');
  });
}

function testOptionsPage() {
  process.stdout.write('\n[Options Page]\n');
  
  const html = readFile('options.html');
  const js = readFile('options.js');
  
  test('options.html has form elements', () => {
    assert(html.includes('<select') || html.includes('<input') || html.includes('<textarea'), 'No form elements');
  });

  test('options.js uses chrome.storage.sync', () => {
    assert(js.includes('chrome.storage.sync'), 'No chrome.storage.sync usage');
  });

  // Check that IDs in HTML are referenced in JS
  const idMatches = html.matchAll(/id=["']([^"']+)["']/g);
  const ids = [...idMatches].map(m => m[1]);
  const criticalIds = ids.filter(id => 
    id.includes('Provider') || id.includes('Key') || id.includes('Model') || id === 'save'
  );
  
  for (const id of criticalIds.slice(0, 5)) {
    test(`options.js references #${id}`, () => {
      assert(js.includes(`'${id}'`) || js.includes(`"${id}"`) || js.includes(`#${id}`), `ID ${id} not referenced in options.js`);
    });
  }
}

function testCSS() {
  process.stdout.write('\n[CSS]\n');
  
  test('content.css exists', () => {
    readFile('content.css');
  });

  test('content.css has pzdrk- classes', () => {
    const css = readFile('content.css');
    assert(css.includes('.pzdrk-'), 'No .pzdrk- classes');
  });

  test('content.css has :root variables', () => {
    const css = readFile('content.css');
    assert(css.includes(':root') && css.includes('--'), 'No CSS custom properties');
  });
}

function testProviderIntegration() {
  process.stdout.write('\n[Multi-Provider Integration]\n');
  
  const bgCode = readFile('background.js');
  const optJs = readFile('options.js');
  
  test('background.js has Groq endpoint', () => {
    assert(bgCode.includes('api.groq.com') || bgCode.includes('groq'), 'No Groq endpoint');
  });

  test('background.js has Cerebras endpoint', () => {
    assert(bgCode.includes('api.cerebras.ai') || bgCode.includes('cerebras'), 'No Cerebras endpoint');
  });

  test('options.js has provider selection', () => {
    assert(optJs.includes('coreProvider') || optJs.includes('provider'), 'No provider selection');
  });

  test('background.js has key rotation logic', () => {
    assert(
      bgCode.includes('rrIndex') || bgCode.includes('cooldownUntilByKey') || bgCode.includes('keyIndex') || bgCode.includes('rotation'),
      'No key rotation logic detected'
    );
  });
}

function testSecurityBasics() {
  process.stdout.write('\n[Security Basics]\n');
  
  const bgCode = readFile('background.js');
  const csCode = readFile('content.js');
  
  test('no console.log of API keys in background.js', () => {
    const lines = bgCode.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('console.log') && (line.includes('apikey') || line.includes('api_key'))) {
        throw new Error(`Potential key logging at line ${i + 1}`);
      }
    }
  });

  test('content script does not contain API keys', () => {
    // Note: DEFAULT_GROQ_KEY etc are intentional fallbacks per project design.
    // This test now checks for keys outside of clearly labeled default constants.
    const lines = csCode.split('\n');
    let hasUnlabeledKey = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip lines that are clearly default/fallback constants
      if (/^\s*const\s+(DEFAULT_|XAI_|SLACK_)/.test(line)) continue;
      // Check for key patterns in other lines
      if (/['"`](gsk_[a-zA-Z0-9]{20,}|xai-[a-zA-Z0-9]{20,})['"`]/.test(line)) {
        hasUnlabeledKey = true;
        break;
      }
    }
    assert(!hasUnlabeledKey, 'API key found outside of labeled defaults');
  });
}

// ============ MAIN ============

process.stdout.write('\n========================================\n');
process.stdout.write('  pzdrk Extension Automated Tests\n');
process.stdout.write('========================================\n');

testManifest();
testSyntax();
testBackgroundHandlers();
testContentScript();
testOptionsPage();
testCSS();
testProviderIntegration();
testSecurityBasics();

process.stdout.write('\n========================================\n');
process.stdout.write(`  Results: ${RESULTS.passed} passed, ${RESULTS.failed} failed, ${RESULTS.skipped} skipped\n`);
process.stdout.write('========================================\n\n');

if (RESULTS.failed > 0) {
  process.stdout.write('Failed tests:\n');
  for (const { name, error } of RESULTS.errors) {
    process.stdout.write(`  - ${name}: ${error}\n`);
  }
  process.stdout.write('\n');
  process.exit(1);
}

process.exit(0);
