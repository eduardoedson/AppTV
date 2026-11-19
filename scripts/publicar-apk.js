// Builds a release APK and publishes it with AppTV.update.json on Google Drive.
// Usage: node scripts/publicar-apk.js [--notes "What changed"] [--version 1.2]
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const ROOT = path.join(__dirname, '..');
const REMOTE_NAME = 'gdrive';
const REMOTE_APK = 'AppTV.apk';
const REMOTE_MANIFEST = 'AppTV.update.json';
const GRADLE_FILE = path.join(ROOT, 'android', 'app', 'build.gradle');
const ENV_FILE = path.join(ROOT, '.env');
const APK_FILE = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const MANIFEST_FILE = path.join(ROOT, REMOTE_MANIFEST);
const README_FILE = path.join(ROOT, 'README.md');
const README_VERSION_START = '<!-- APP_VERSION_START -->';
const README_VERSION_END = '<!-- APP_VERSION_END -->';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? '' : '';
}

const NOTES = option('--notes');
let requestedVersion = option('--version');

function printHelp() {
  console.log(`Uso: npm run apk:publicar -- [opções]

Gera um APK release, publica APK e manifesto no Google Drive e atualiza a versão no README.

Opções:
  --version <versão>  Define o versionName (padrão: incrementa o último número)
  --notes <texto>     Notas exibidas na atualização do app
  --help              Mostra esta ajuda

Exemplo:
  npm run apk:publicar -- --version 1.31 --notes "Melhorias no player"`);
}

function run(command, args, {cwd = ROOT, quiet = false} = {}) {
  const needsShell = process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(command);
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
    shell: needsShell,
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
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
  const wingetLink = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'rclone.exe');
  if (fs.existsSync(wingetLink)) return wingetLink;
  return findFile(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages'), 'rclone.exe');
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

function remoteFileId(rclone, fileName) {
  const result = run(rclone, ['lsjson', `${REMOTE_NAME}:`, '--files-only', '--include', `/${fileName}`], {quiet: true});
  if (result.status !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout)[0]?.ID ?? null;
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function badgeValue(value) {
  return encodeURIComponent(String(value).replace(/-/g, '--'));
}

function updateReadmeVersion(versionName, versionCode, publishedAt) {
  if (!fs.existsSync(README_FILE)) throw new Error('README.md não encontrado para atualizar a versão publicada.');
  const original = fs.readFileSync(README_FILE, 'utf8');
  const start = original.indexOf(README_VERSION_START);
  const end = original.indexOf(README_VERSION_END);
  if (start < 0 || end < start) throw new Error('Marcadores de versão não encontrados no README.md.');
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'Europe/Lisbon',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(publishedAt));
  const block = `${README_VERSION_START}\n<p align="center">\n` +
    `  <img alt="Versão ${versionName}" src="https://img.shields.io/badge/vers%C3%A3o-${badgeValue(versionName)}-7C3AED">\n` +
    `  <img alt="Build ${versionCode}" src="https://img.shields.io/badge/build-${badgeValue(versionCode)}-2563EB">\n` +
    '  <img alt="Android TV" src="https://img.shields.io/badge/plataforma-Android%20TV-16A34A">\n' +
    '  <img alt="Uso privado" src="https://img.shields.io/badge/distribui%C3%A7%C3%A3o-privada-374151">\n' +
    `</p>\n\n> **Versão publicada:** \`${versionName}\` · **Build:** \`${versionCode}\` · **Publicada em:** ${date}\n${README_VERSION_END}`;
  const updated = `${original.slice(0, start)}${block}${original.slice(end + README_VERSION_END.length)}`;
  fs.writeFileSync(README_FILE, updated, 'utf8');
}

function setEnvValue(key, value) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_FILE, text, 'utf8');
}

function driveLink(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function nextVersion(version) {
  const parts = version.split('.');
  const last = Number(parts.at(-1));
  if (Number.isInteger(last)) parts[parts.length - 1] = String(last + 1);
  else parts.push('1');
  return parts.join('.');
}

function assertVersion(version) {
  if (!/^\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Versão inválida: "${version}". Use algo como 1.31 ou 2.0.0-beta.1.`);
  }
}

function clearMetroCache() {
  let entries = [];
  try {
    entries = fs.readdirSync(os.tmpdir(), {withFileTypes: true});
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && (entry.name.startsWith('metro-') || entry.name.startsWith('haste-map-'))) {
      fs.rmSync(path.join(os.tmpdir(), entry.name), {recursive: true, force: true});
    }
  }
}

function main() {
  const originalGradle = fs.readFileSync(GRADLE_FILE, 'utf8');
  const codeMatch = originalGradle.match(/versionCode\s+(\d+)/);
  const nameMatch = originalGradle.match(/versionName\s+"([^"]+)"/);
  if (!codeMatch || !nameMatch) throw new Error(`versionCode/versionName não encontrados em ${GRADLE_FILE}`);

  const oldCode = Number(codeMatch[1]);
  const oldName = nameMatch[1];
  const newCode = oldCode + 1;
  requestedVersion ||= nextVersion(oldName);
  assertVersion(requestedVersion);
  const rclone = initializeRclone();
  const updatedGradle = originalGradle
    .replace(/versionCode\s+\d+/, `versionCode ${newCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${requestedVersion}"`);
  fs.writeFileSync(GRADLE_FILE, updatedGradle, 'utf8');
  console.log(`Versão: ${oldName} -> ${requestedVersion}`);

  const restoreVersion = () => {
    fs.writeFileSync(GRADLE_FILE, originalGradle, 'utf8');
    console.warn(`Versão restaurada para ${oldName} (${oldCode}).`);
  };

  let manifestId = remoteFileId(rclone, REMOTE_MANIFEST);
  if (!manifestId) {
    console.log(`Criando ${REMOTE_MANIFEST} no Google Drive...`);
    writeJson(MANIFEST_FILE, {versionCode: oldCode, versionName: oldName, apkUrl: '', notes: '', publishedAt: ''});
    const create = run(rclone, ['copyto', MANIFEST_FILE, `${REMOTE_NAME}:${REMOTE_MANIFEST}`]);
    manifestId = create.status === 0 ? remoteFileId(rclone, REMOTE_MANIFEST) : null;
    if (!manifestId) {
      restoreVersion();
      throw new Error(`Não foi possível criar ${REMOTE_MANIFEST} no Google Drive.`);
    }
  }
  setEnvValue('UPDATE_MANIFEST_URL', driveLink(manifestId));

  clearMetroCache();
  console.log('Gerando o APK de release...');
  const gradleCommand = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const build = run(gradleCommand, ['assembleRelease'], {cwd: path.join(ROOT, 'android')});
  if (build.status !== 0 || !fs.existsSync(APK_FILE)) {
    restoreVersion();
    throw new Error('A compilação falhou. Nada foi publicado.');
  }

  console.log('Enviando AppTV.apk...');
  const apkUpload = run(rclone, ['copyto', APK_FILE, `${REMOTE_NAME}:${REMOTE_APK}`, '--checksum']);
  const apkId = apkUpload.status === 0 ? remoteFileId(rclone, REMOTE_APK) : null;
  if (!apkId) throw new Error('Falha no envio do APK. A versão no build.gradle foi mantida para nova tentativa.');

  const publishedAt = new Date().toISOString();
  writeJson(MANIFEST_FILE, {
    versionCode: newCode,
    versionName: requestedVersion,
    apkUrl: driveLink(apkId),
    notes: NOTES,
    publishedAt,
  });
  const manifestUpload = run(rclone, ['copyto', MANIFEST_FILE, `${REMOTE_NAME}:${REMOTE_MANIFEST}`]);
  if (manifestUpload.status !== 0) throw new Error('Falha no envio do manifesto. Execute novamente para tentar outra vez.');

  updateReadmeVersion(requestedVersion, newCode, publishedAt);
  console.log('README.md atualizado com a versão publicada.');

  console.log(`AppTV ${requestedVersion} (${newCode}) publicado com sucesso.`);
}

module.exports = {assertVersion, badgeValue, nextVersion, updateReadmeVersion};

if (require.main === module) {
  if (process.argv.includes('--help')) {
    printHelp();
  } else {
    try {
      main();
    } catch (error) {
      console.error(error.message ?? error);
      process.exit(1);
    }
  }
}
