// Builds AppTV.catalago.json from catalogo/series and catalogo/filmes and validates it.
// Usage: node scripts/catalogo/gerar.js [--check]
const fs = require('fs');
const path = require('path');
const {
  INDEX_PATH, DIRS, OUTPUT_PATH, BUILD_ONLY_KEYS,
  readJson, formatJson, writeJson, listJson, omit, loadValidator,
} = require('./lib');

function loadSources() {
  const sources = new Map();
  for (const [kind, dir] of [['series', DIRS.series], ['movie', DIRS.movie]]) {
    for (const name of listJson(dir)) {
      const file = path.join(dir, name);
      const id = name.replace(/\.json$/, '');
      const data = readJson(file);
      if (data.id !== id) throw new Error(`${file}: o "id" (${data.id}) deve ser igual ao nome do arquivo (${id})`);
      const expectedType = kind === 'series' ? 'series' : 'movie';
      if (data.type !== expectedType) throw new Error(`${file}: "type" deve ser "${expectedType}"`);
      if (sources.has(id)) throw new Error(`ID repetido em séries e filmes: ${id}`);
      sources.set(id, data);
    }
  }
  return sources;
}

function applyOverrides(id, seasons, overrides, warnings) {
  const pending = new Set(Object.keys(overrides ?? {}));
  for (const season of seasons ?? []) for (const episode of season.episodes) {
    if (overrides?.[episode.id]) {
      Object.assign(episode, overrides[episode.id]);
      pending.delete(episode.id);
    }
  }
  pending.forEach(episodeId => warnings.push(`${id}: correção para "${episodeId}" não encontrou o episódio`));
}

function build({check = false} = {}) {
  const index = fs.existsSync(INDEX_PATH) ? readJson(INDEX_PATH) : {version: 1, ordem: []};
  const sources = loadSources();
  const warnings = [];
  const order = index.ordem.filter(id => {
    if (!sources.has(id)) warnings.push(`${id}: arquivo removido, saiu do catálogo`);
    return sources.has(id);
  });
  const added = [...sources.keys()].filter(id => !order.includes(id)).sort();
  added.forEach(id => warnings.push(`${id}: novo, adicionado ao fim do catálogo`));
  order.push(...added);

  const items = order.map(id => {
    const data = sources.get(id);
    const item = omit(data, BUILD_ONLY_KEYS);
    applyOverrides(id, item.seasons, data.episodios, warnings);
    return item;
  });
  const catalog = {version: index.version ?? 1, items};
  const {diagnostics} = loadValidator().validateCatalog(catalog);
  warnings.forEach(warning => console.warn(`Aviso: ${warning}`));
  if (diagnostics.length) {
    diagnostics.forEach(diagnostic => console.error(`ERRO ${diagnostic.path}: ${diagnostic.message}`));
    throw new Error(`Catálogo inválido (${diagnostics.length} erro(s)). Nada foi gravado.`);
  }

  const series = items.filter(item => item.type === 'series');
  const episodes = series.reduce((total, item) => total + item.seasons.reduce((sum, season) => sum + season.episodes.length, 0), 0);
  const summary = `${series.length} séries (${episodes} episódios) e ${items.length - series.length} filmes`;
  const changed = !fs.existsSync(OUTPUT_PATH) || fs.readFileSync(OUTPUT_PATH, 'utf8') !== formatJson(catalog);
  if (check) {
    console.log(changed ? `O AppTV.catalago.json está DESATUALIZADO (${summary}).` : `Catálogo em dia: ${summary}.`);
    return {changed, catalog};
  }
  writeJson(INDEX_PATH, {...index, version: catalog.version, ordem: order});
  writeJson(OUTPUT_PATH, catalog);
  console.log(changed ? `AppTV.catalago.json gerado: ${summary}.` : `Nada mudou: ${summary}.`);
  return {changed, catalog};
}

module.exports = {build};

if (require.main === module) {
  try {
    const {changed} = build({check: process.argv.includes('--check')});
    if (process.argv.includes('--check') && changed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message ?? error);
    process.exit(1);
  }
}
