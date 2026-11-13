// Shared helpers for the catalog source files and the Google Drive API.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {createRequire} = require('module');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE_DIR = path.join(ROOT, 'catalogo');
const INDEX_PATH = path.join(SOURCE_DIR, 'catalogo.json');
const DIRS = {
  series: path.join(SOURCE_DIR, 'series'),
  movie: path.join(SOURCE_DIR, 'filmes'),
};
const OUTPUT_PATH = path.join(ROOT, 'AppTV.catalago.json');
const ENV_PATH = path.join(ROOT, '.env');
const BUILD_ONLY_KEYS = ['drive', 'episodios', 'imdbId'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function formatJson(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function writeJson(file, data) {
  const text = formatJson(data);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, text);
  return true;
}

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort();
}

function omit(object, keys) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

function loadValidator() {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  const catalogDir = path.join(ROOT, 'src', 'catalog');
  const baseRequire = createRequire(path.join(catalogDir, 'validator.ts'));
  const compile = (file, customRequire) => {
    const source = fs.readFileSync(path.join(catalogDir, file), 'utf8');
    const {outputText} = ts.transpileModule(source, {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true},
    });
    const module = {exports: {}};
    const wrapper = vm.runInThisContext(`(function (exports, require, module) {\n${outputText}\n})`, {
      filename: path.join(catalogDir, file),
    });
    wrapper(module.exports, customRequire, module);
    return module.exports;
  };
  const schema = compile('schema.ts', baseRequire);
  return compile('validator.ts', id => (id === './schema' ? schema : baseRequire(id)));
}

function readEnv() {
  const values = {};
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function requestJson(url, options = {}, attempt = 0) {
  const response = await fetch(url, options);
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await wait(500 * 2 ** attempt);
    return requestJson(url, options, attempt + 1);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.error?.message ?? response.statusText}`);
  return data;
}

async function driveToken() {
  const env = readEnv();
  const required = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN'];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error(`Credenciais ausentes no .env: ${missing.join(', ')}`);
  const data = await requestJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  return data.access_token;
}

async function listChildren(token, folderId) {
  const files = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, videoMediaMetadata(durationMillis))',
      pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await requestJson(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: {Authorization: `Bearer ${token}`},
    });
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

function parseSeasonNumber(folderName) {
  if (/^\s*especia/i.test(folderName)) return 0;
  const match = folderName.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseEpisode(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const match = base.match(/S\d+\s*E(\d+)(?:\s+-\s+(.+))?$/i) ?? base.match(/(?:Epis[oó]dio|Especial)\s*(\d+)\s*[-–:.]*\s*(.*)$/i);
  if (match) return {number: Number(match[1]), title: match[2]?.trim() || null};
  const anyNumber = base.match(/(\d+)/);
  return anyNumber ? {number: Number(anyNumber[1]), title: null} : null;
}

async function fetchImdbPoster(imdbId) {
  try {
    const response = await fetch(`https://www.imdb.com/title/${imdbId}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    });
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    return match && match[1].startsWith('https://') ? match[1] : null;
  } catch {
    return null;
  }
}

module.exports = {
  ROOT, SOURCE_DIR, INDEX_PATH, DIRS, OUTPUT_PATH, BUILD_ONLY_KEYS, FOLDER_MIME,
  readJson, formatJson, writeJson, listJson, omit, loadValidator,
  driveToken, listChildren, parseSeasonNumber, parseEpisode, fetchImdbPoster,
};
