// Synchronizes Drive-backed series directly into catalogo/series/<id>.json.
// Usage: node scripts/catalogo/sincronizar-drive.js [id ...] [--aceitar-remocoes]
const path = require('path');
const {
  DIRS, FOLDER_MIME, readJson, writeJson, listJson,
  driveToken, listChildren, parseSeasonNumber, parseEpisode, fetchImdbPoster,
} = require('./lib');
const {build} = require('./gerar');

const pad = value => String(value).padStart(2, '0');
const ACCEPT_REMOVALS = process.argv.includes('--aceitar-remocoes');

function episodeIds(seasons) {
  return new Set((seasons ?? []).flatMap(season => season.episodes.map(episode => episode.id)));
}

function previousDurations(series) {
  const durations = new Map();
  for (const season of series.seasons ?? []) for (const episode of season.episodes) {
    if (episode.duration) durations.set(episode.sources[0].url, episode.duration);
  }
  return durations;
}

async function readSeasons(token, series, warnings) {
  const {folderId, sourceName = 'Dublado'} = series.drive;
  const known = previousDurations(series);
  const folders = (await listChildren(token, folderId))
    .filter(file => file.mimeType === FOLDER_MIME)
    .map(folder => ({folder, number: parseSeasonNumber(folder.name)}))
    .filter(entry => {
      if (entry.number === null) warnings.push(`${series.id}: pasta ignorada "${entry.folder.name}"`);
      return entry.number !== null;
    })
    .sort((a, b) => a.number - b.number);

  const seasons = [];
  for (const {folder, number: seasonNumber} of folders) {
    if (seasons.some(season => season.number === seasonNumber)) {
      warnings.push(`${series.id}: temporada ${seasonNumber} repetida, pasta "${folder.name}" ignorada`);
      continue;
    }
    const files = (await listChildren(token, folder.id)).filter(file => file.mimeType.startsWith('video/'));
    const byNumber = new Map();
    for (const file of files) {
      const parsed = parseEpisode(file.name);
      if (!parsed) warnings.push(`${series.id} T${seasonNumber}: sem número de episódio em "${file.name}"`);
      else if (byNumber.has(parsed.number)) warnings.push(`${series.id} T${seasonNumber}: episódio ${parsed.number} repetido`);
      else byNumber.set(parsed.number, {file, parsed});
    }
    const episodes = [...byNumber.keys()].sort((a, b) => a - b).map(number => {
      const {file, parsed} = byNumber.get(number);
      const episodeId = `s${pad(seasonNumber)}e${pad(number)}`;
      const url = `https://drive.google.com/file/d/${file.id}/view`;
      const episode = {
        id: episodeId, number, title: parsed.title ?? `Episódio ${number}`,
        sources: [{id: episodeId, name: sourceName, url}],
      };
      const durationMillis = Number(file.videoMediaMetadata?.durationMillis);
      if (Number.isFinite(durationMillis) && durationMillis > 0) episode.duration = Math.ceil(durationMillis / 1000);
      else if (known.has(url)) episode.duration = known.get(url);
      else warnings.push(`${series.id} ${episodeId}: duração indisponível no Drive`);
      return episode;
    });
    if (episodes.length) seasons.push({
      number: seasonNumber,
      name: seasonNumber === 0 ? 'Especiais' : `Temporada ${seasonNumber}`,
      episodes,
    });
  }
  return seasons;
}

async function fillPoster(series, warnings) {
  if (series.poster || !series.imdbId) return series;
  const poster = await fetchImdbPoster(series.imdbId);
  if (!poster) {
    warnings.push(`${series.id}: não foi possível obter o pôster do IMDb`);
    return series;
  }
  const {id, type, title, description, ...rest} = series;
  return {id, type, title, description, poster, backdrop: rest.backdrop ?? poster, ...rest};
}

async function main() {
  const wanted = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const all = listJson(DIRS.series).map(name => {
    const file = path.join(DIRS.series, name);
    return {file, data: readJson(file)};
  });
  const targets = all.filter(({data}) => data.drive && (!wanted.length || wanted.includes(data.id)));
  for (const id of wanted) {
    const found = all.find(({data}) => data.id === id);
    if (!found) throw new Error(`Série não encontrada em catalogo/series: ${id}`);
    if (!found.data.drive) throw new Error(`${id} não tem o bloco "drive" com o folderId da pasta`);
  }
  if (!targets.length) throw new Error('Nenhuma série com bloco "drive" para sincronizar.');

  const token = await driveToken();
  const warnings = [];
  let blocked = 0;
  for (const {file, data} of targets) {
    const seasons = await readSeasons(token, data, warnings);
    const total = seasons.reduce((sum, season) => sum + season.episodes.length, 0);
    if (!total) {
      warnings.push(`${data.id}: nenhum episódio encontrado; arquivo anterior mantido`);
      continue;
    }
    const previous = episodeIds(data.seasons);
    const current = episodeIds(seasons);
    const removed = [...previous].filter(id => !current.has(id));
    if (removed.length && !ACCEPT_REMOVALS) {
      warnings.push(`${data.id}: ${removed.length} episódio(s) sumiriam. Use --aceitar-remocoes para confirmar.`);
      blocked += 1;
      continue;
    }
    const series = await fillPoster(data, warnings);
    writeJson(file, {...series, seasons});
    console.log(`${data.title}: ${seasons.length} temporadas, ${total} episódios`);
  }
  if (warnings.length) warnings.forEach(warning => console.warn(`Aviso: ${warning}`));
  build();
  if (blocked) process.exitCode = 2;
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
