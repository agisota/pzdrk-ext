import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOST = '127.0.0.1';
const PORT = Number(process.env.ROX_OBSIDIAN_BRIDGE_PORT || 7421);
const EXTENSION_ID = process.env.ROX_EXTENSION_ID || 'lgaeenenjfabiknicbocdmlmglljdimp';
const VAULT_ROOT = path.resolve(process.env.ROX_OBSIDIAN_VAULT || '/Users/t/Obsidian/Brain');
const NOTES_DIR = 'Rox Discovery';
const TOKEN_FILE = path.resolve(process.env.ROX_OBSIDIAN_BRIDGE_TOKEN_FILE || path.join(os.homedir(), '.config/pzdrk/obsidian-bridge.token'));
let TOKEN = process.env.ROX_OBSIDIAN_BRIDGE_TOKEN || '';
if (!TOKEN) {
  try {
    const mode = statSync(TOKEN_FILE);
    if ((mode.mode & 0o077) !== 0 || mode.uid !== process.getuid()) throw new Error('Token file must be owned by this user and accessible only to its owner');
    TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;

if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('ROX_OBSIDIAN_BRIDGE_PORT must be between 1024 and 65535');
if (!/^[a-p]{32}$/.test(EXTENSION_ID)) throw new Error('ROX_EXTENSION_ID must be a 32-character Chrome extension ID');
if (Buffer.byteLength(TOKEN, 'utf8') < 32) throw new Error('Set ROX_OBSIDIAN_BRIDGE_TOKEN or create a private token file at ~/.config/pzdrk/obsidian-bridge.token');

class RequestValidationError extends Error {}

function sendJson(res, status, body, origin = '') {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (origin === ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ORIGIN;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function reject(res, status, message, origin) {
  sendJson(res, status, { error: message }, origin);
}

function sameToken(value) {
  if (typeof value !== 'string') return false;
  const supplied = Buffer.from(value, 'utf8');
  const expected = Buffer.from(TOKEN, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function readJson(req) {
  return new Promise((resolve, rejectPromise) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        rejectPromise(new RequestValidationError('Request body exceeds 2 MiB'));
        return;
      }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { rejectPromise(new RequestValidationError('Request body must be valid JSON')); }
    });
    req.on('error', rejectPromise);
  });
}

function safeSlug(value) {
  const slug = String(value || 'Rox Discovery')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 72);
  return slug || 'Rox-Discovery';
}

function normalizeArtifact(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RequestValidationError('Artifact must be an object');
  const title = String(input.title || 'Rox Discovery').trim().slice(0, 180) || 'Rox Discovery';
  let url;
  const originalUrl = String(input.url || '');
  try { url = new URL(originalUrl); }
  catch { throw new RequestValidationError('A valid page URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new RequestValidationError('Only credential-free HTTP(S) page URLs can be saved');
  for (const key of [...url.searchParams.keys()]) {
    if (/(?:token|key|auth|session|password|secret|credential|code|signature)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  const markdown = String(input.markdown || '').trim();
  const text = String(input.text || '').trim();
  if (!markdown && !text) throw new RequestValidationError('Artifact has no Markdown or text content to save');
  const sourceUrl = url.toString();
  const body = markdown
    ? (originalUrl ? markdown.split(originalUrl).join(sourceUrl) : markdown)
    : `# ${title}\n\nSource: ${sourceUrl}\n\n${text}`;
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES - 16_384) throw new RequestValidationError('Markdown exceeds the note size limit');
  return { title, sourceUrl, body, contentHash: String(input.contentHash || '').slice(0, 160) };
}

async function saveArtifact(input) {
  const artifact = normalizeArtifact(input);
  const vault = await realpath(VAULT_ROOT);
  const notesFolder = path.resolve(vault, NOTES_DIR);
  if (!notesFolder.startsWith(`${vault}${path.sep}`)) throw new Error('Invalid notes folder');
  await mkdir(notesFolder, { recursive: true });
  const realFolder = await realpath(notesFolder);
  if (!realFolder.startsWith(`${vault}${path.sep}`)) throw new Error('Notes folder resolves outside the configured vault');

  const urlHash = createHash('sha256').update(artifact.sourceUrl).digest('hex').slice(0, 20);
  const domainSlug = safeSlug(new URL(artifact.sourceUrl).hostname);
  const filename = `${domainSlug}-${urlHash}.md`;
  const note = `---\ntitle: ${JSON.stringify(artifact.title)}\nsource: ${JSON.stringify(artifact.sourceUrl)}\ncontent_hash: ${JSON.stringify(artifact.contentHash)}\nupdated: ${new Date().toISOString()}\n---\n\n${artifact.body}\n`;

  const target = path.join(realFolder, filename);
  const temporary = path.join(realFolder, `.${filename}.${randomBytes(16).toString('hex')}.tmp`);

  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(note, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return { path: `${NOTES_DIR}/${filename}`, bytes: Buffer.byteLength(note, 'utf8') };
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::ffff:127.0.0.1') return reject(res, 403, 'Loopback connections only', '');
  if (req.headers.host !== `127.0.0.1:${PORT}` && req.headers.host !== `localhost:${PORT}`) return reject(res, 403, 'Invalid local host', '');
  if (origin !== ORIGIN) return reject(res, 403, 'Unapproved extension origin', '');

  if (req.method === 'OPTIONS') {
    const requestedMethod = req.headers['access-control-request-method'];
    const requestedHeaders = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim());
    if (requestedMethod !== 'POST' || requestedHeaders.some(value => !['authorization', 'content-type'].includes(value))) return reject(res, 403, 'Unsupported CORS request', '');
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin'
    });
    return res.end();
  }

  if (!sameToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''))) return reject(res, 401, 'Invalid bridge token', origin);
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true }, origin);
  if (req.method !== 'POST' || url.pathname !== '/v1/notes') return reject(res, 404, 'Not found', origin);
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return reject(res, 415, 'Content-Type must be application/json', origin);

  try {
    const saved = await saveArtifact(await readJson(req));
    return sendJson(res, 200, { ok: true, ...saved }, origin);
  } catch (error) {
    return reject(res, error instanceof RequestValidationError ? 400 : 500,
      error instanceof RequestValidationError ? error.message : 'Unable to save note', origin);
  }
});

server.listen(PORT, HOST, () => console.log(`Obsidian bridge listening on http://${HOST}:${PORT} for ${ORIGIN}`));
