// One-time migration: splits AppTV.catalago.json into catalogo/series and catalogo/filmes.
// Usage: node scripts/catalogo/dividir.js [--force]
const fs = require('fs');
const path = require('path');
const {INDEX_PATH, DIRS, OUTPUT_PATH, readJson, writeJson} = require('./lib');

const DRIVE_SERIES = {
  ossimpsons: {folderId: '1Zme_0s5Q411qjwfIA1sGd0pAtsqwpfl-', sourceName: 'Dublado'},
  futurama: {folderId: '1ILap9riXk7gToD0PI-aeqe6v0jse1MaC', sourceName: 'Dublado'},
};

if (fs.existsSync(INDEX_PATH) && !process.argv.includes('--force')) {
  console.error('catalogo/catalogo.json já existe. Use --force para refazer.');
  process.exit(1);
}

const catalog = readJson(OUTPUT_PATH);
const order = [];
for (const item of catalog.items) {
  order.push(item.id);
  if (item.type === 'movie') writeJson(path.join(DIRS.movie, `${item.id}.json`), item);
  else writeJson(path.join(DIRS.series, `${item.id}.json`), DRIVE_SERIES[item.id] ? {...item, drive: DRIVE_SERIES[item.id]} : item);
}
writeJson(INDEX_PATH, {version: catalog.version, ordem: order});
console.log(`${order.length} itens separados em catalogo/.`);
