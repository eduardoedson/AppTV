// Generates, validates and uploads AppTV.catalago.json to Google Drive.
// Usage: node scripts/catalogo/enviar.js [--force]
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {build} = require('./gerar');
const {ROOT, OUTPUT_PATH, readJson} = require('./lib');

const REMOTE_NAME = 'gdrive';
const REMOTE_FILE = 'AppTV.catalago.json';
const FORCE = process.argv.includes('--force');

function run(command, args, {quiet = false} = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function commandPath(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = run(locator, [command], {quiet: true});
  return result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean)?.trim() : null;
}

function findFile(directory, name) {
  if (!fs.existsSync(directory)) return null;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, {withFileTypes: true});
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return file;
      if (entry.isDirectory()) pending.push(file);
    }
  }
  return null;
}

function findRclone() {
  const fromPath = commandPath(process.platform === 'win32' ? 'rclone.exe' : 'rclone');
  if (fromPath) return fromPath;
  if (process.platform !== 'win32') return null;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const wingetLink = path.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'rclone.exe');
  if (fs.existsSync(wingetLink)) return wingetLink;
  return findFile(path.join(localAppData, 'Microsoft', 'WinGet', 'Packages'), 'rclone.exe');
}

function initializeRclone() {
  let rclone = findRclone();
  if (!rclone && process.platform === 'win32') {
    console.log('rclone não encontrado. Instalando com winget...');
    const install = run('winget.exe', [
      'install', '--id', 'Rclone.Rclone', '--exact',
      '--accept-source-agreements', '--accept-package-agreements',
    ]);
    if (install.status === 0) rclone = findRclone();
  }
  if (!rclone) throw new Error('rclone não encontrado. Instale o rclone e execute novamente.');

  const remotes = run(rclone, ['listremotes'], {quiet: true});
  if (remotes.status !== 0) throw new Error(remotes.stderr.trim() || 'Não foi possível listar os remotes do rclone.');
  if (!remotes.stdout.split(/\r?\n/).includes(`${REMOTE_NAME}:`)) {
    console.log('Primeiro acesso: o navegador será aberto para autorizar o Google Drive.');
    const configure = run(rclone, ['config', 'create', REMOTE_NAME, 'drive', 'scope=drive']);
    if (configure.status !== 0) throw new Error('Falha ao configurar o Google Drive no rclone.');
  }
  return rclone;
}

function remoteFileId(rclone) {
  const result = run(rclone, ['lsjson', `${REMOTE_NAME}:`, '--files-only', '--include', `/${REMOTE_FILE}`], {quiet: true});
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout)[0]?.ID ?? null;
  } catch {
    return null;
  }
}

function expectedFileId() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return null;
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .find(value => /^\s*DEFAULT_CATALOG_URL\s*=/.test(value));
  const url = line?.split('=').slice(1).join('=').trim() ?? '';
  return url.match(/(?:\/file\/d\/|[?&]id=)([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

function main() {
  const expectedId = expectedFileId();
  if (!expectedId) throw new Error('DEFAULT_CATALOG_URL no .env deve apontar para o catálogo no Google Drive.');

  build();
  const catalog = readJson(OUTPUT_PATH);
  if (catalog.version !== 1 || !Array.isArray(catalog.items) || catalog.items.length === 0) {
    throw new Error('O catálogo deve ter "version": 1 e uma lista "items" não vazia.');
  }
  console.log(`Catálogo local OK: ${catalog.items.length} item(ns).`);

  const rclone = initializeRclone();
  const currentId = remoteFileId(rclone);
  if (currentId && currentId !== expectedId && !FORCE) {
    throw new Error(`O arquivo no Drive tem ID ${currentId}, mas o app usa ${expectedId}. Use --force para enviar mesmo assim.`);
  }
  if (!currentId && !FORCE) {
    throw new Error(`O arquivo ${REMOTE_FILE} não foi encontrado na raiz do Drive. Use --force para criá-lo.`);
  }

  console.log('Enviando catálogo...');
  const upload = run(rclone, ['copyto', OUTPUT_PATH, `${REMOTE_NAME}:${REMOTE_FILE}`, '--checksum']);
  if (upload.status !== 0) throw new Error('Falha no envio do catálogo.');

  const finalId = remoteFileId(rclone);
  if (finalId === expectedId) console.log('Catálogo atualizado no Google Drive; o link do app foi mantido.');
  else console.warn(`Catálogo enviado com o ID ${finalId}. Atualize DEFAULT_CATALOG_URL no .env.`);
}

try {
  main();
} catch (error) {
  console.error(error.message ?? error);
  process.exit(1);
}
