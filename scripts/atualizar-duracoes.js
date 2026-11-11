// Reads the real duration of every catalog episode from Google Drive metadata
// and writes it back to AppTV.catalago.json. No video bytes are downloaded.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const CATALOG_PATH = path.join(ROOT, 'AppTV.catalago.json');
const CONCURRENCY = 10;

function readEnv() {
  const values = {};
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function driveId(url) {
  return url?.match(/\/d\/([^/]+)/)?.[1] ??
    url?.match(/[?&]id=([^&]+)/)?.[1] ?? null;
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function requestJson(url, options = {}, attempt = 0) {
  const response = await fetch(url, options);
  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    await wait(500 * 2 ** attempt);
    return requestJson(url, options, attempt + 1);
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status}: ${data.error?.message ?? response.statusText}`);
  }
  return data;
}

async function accessToken(env) {
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

async function main() {
  const env = readEnv();
  const required = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REFRESH_TOKEN',
  ];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error(`Credenciais ausentes: ${missing.join(', ')}`);

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const episodes = catalog.items.flatMap(item =>
    item.type === 'series'
      ? item.seasons.flatMap(season => season.episodes.map(episode => ({item, episode})))
      : [],
  );
  const token = await accessToken(env);
  let completed = 0;
  const failures = [];

  for (let offset = 0; offset < episodes.length; offset += CONCURRENCY) {
    const batch = episodes.slice(offset, offset + CONCURRENCY);
    await Promise.all(batch.map(async ({item, episode}) => {
      const fileId = driveId(episode.sources?.[0]?.url);
      if (!fileId) {
        failures.push(`${item.title} / ${episode.id}: URL do Drive inválido`);
        return;
      }
      try {
        const fields = encodeURIComponent('videoMediaMetadata(durationMillis)');
        const metadata = await requestJson(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${fields}&supportsAllDrives=true`,
          {headers: {Authorization: `Bearer ${token}`}},
        );
        const durationMillis = Number(metadata.videoMediaMetadata?.durationMillis);
        if (!Number.isFinite(durationMillis) || durationMillis <= 0) {
          throw new Error('Drive não retornou durationMillis');
        }
        episode.duration = Math.ceil(durationMillis / 1000);
      } catch (error) {
        failures.push(`${item.title} / ${episode.id}: ${error.message}`);
      } finally {
        completed += 1;
      }
    }));
    if (completed % 100 < CONCURRENCY) {
      console.log(`${completed}/${episodes.length} episódios consultados`);
    }
  }

  if (failures.length) {
    console.error(`Falharam ${failures.length} episódios:`);
    failures.forEach(failure => console.error(`- ${failure}`));
    throw new Error('Catálogo não alterado porque nem todas as durações foram obtidas.');
  }

  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Catálogo atualizado com ${episodes.length} durações reais.`);
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
