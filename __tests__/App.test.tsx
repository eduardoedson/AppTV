import {validateCatalog, countSkippedItems} from '../src/catalog/validator';
import {extractDriveFileId, requestHeadersFor, resolveMediaUrl} from '../src/catalog/sourceResolver';
import {isCompleted, PlaybackProgress, resumablePosition} from '../src/domain/playback';
import {flattenSeries, pickSource, Series} from '../src/domain/catalog';
import {createRandomQueue, nextRandom, previousRandom, queueStartingAt, reconcileQueue, stepRandomQueue} from '../src/playback/randomQueue';
import {resolveResumeTarget} from '../src/playback/resume';
import {buildPlayParams} from '../src/playback/launch';
import {formatClock, formatDuration} from '../src/utils/format';

const movie = {version: 1, items: [{id: 'm1', type: 'movie', title: 'Filme', sources: [{id: 'src', name: 'HD', url: 'https://cdn.example/video.mp4'}]}]};
const insecureMovie = {...movie.items[0], id: 'm2', sources: [{id: 'src', name: 'HD', url: 'http://inseguro/video.mp4'}]};

const source = (id: string, name: string) => ({id, name, url: `https://cdn.example/${id}.mp4`});
const series: Series = {
  id: 's1',
  type: 'series',
  title: 'Série',
  seasons: [
    {number: 2, episodes: [{id: 'e3', number: 1, title: 'E3', sources: [source('e3-pt', 'Dublado'), source('e3-en', 'Legendado')]}]},
    {
      number: 1,
      episodes: [
        {id: 'e2', number: 2, title: 'E2', sources: [source('e2-pt', 'Dublado'), source('e2-en', 'Legendado')]},
        {id: 'e1', number: 1, title: 'E1', sources: [source('e1-pt', 'Dublado'), source('e1-en', 'Legendado')]},
      ],
    },
  ],
};
const progress = (episodeId: string, positionMs: number, completed: boolean, updatedAt: number): PlaybackProgress => ({
  contentId: 's1',
  episodeId,
  sourceId: `${episodeId}-en`,
  positionMs,
  durationMs: 100_000,
  completed,
  updatedAt,
});

test('valida catálogo v1 e rejeita catálogo sem itens válidos', () => {
  expect(validateCatalog(movie).catalog.items).toHaveLength(1);
  expect(() => validateCatalog({version: 1, items: [insecureMovie]})).toThrow('Nenhum item válido');
  expect(() => validateCatalog({version: 2, items: []})).toThrow('Catálogo inválido');
});

test('ignora somente o item inválido', () => {
  const result = validateCatalog({version: 1, items: [movie.items[0], insecureMovie]});
  expect(result.catalog.items.map(item => item.id)).toEqual(['m1']);
  expect(countSkippedItems(result.diagnostics)).toBe(1);
});

test('ignora IDs duplicados mantendo o primeiro', () => {
  const result = validateCatalog({...movie, items: [movie.items[0], movie.items[0]]});
  expect(result.catalog.items).toHaveLength(1);
  expect(result.diagnostics[0].message).toContain('ID duplicado');
});

test('aplica regras exatas de conclusão e retomada', () => {
  expect(isCompleted(9 * 60_000, 10 * 60_000)).toBe(true);
  expect(isCompleted(5 * 60_000, 9 * 60_000)).toBe(false);
  expect(isCompleted(55 * 60_000, 60 * 60_000)).toBe(true);
  expect(resumablePosition({contentId: 'a', episodeId: null, sourceId: 's', positionMs: 29_999, durationMs: 100_000, completed: false, updatedAt: 0})).toBe(0);
});

test('fila aleatória não repete no ciclo e anterior usa histórico', () => {
  let queue = createRandomQueue('s1', ['a', 'b', 'c'], () => 0);
  const seen = new Set([queue.currentId]);
  queue = nextRandom(queue, () => 0);
  seen.add(queue.currentId);
  const beforePrevious = queue.currentId;
  queue = nextRandom(queue, () => 0);
  seen.add(queue.currentId);
  expect(seen.size).toBe(3);
  expect(previousRandom(queue).currentId).toBe(beforePrevious);
  expect(reconcileQueue(queue, ['a'])).toMatchObject({eligibleIds: ['a'], currentId: 'a'});
});

test('avançar a fila aleatória mantém a seleção do usuário', () => {
  let queue = createRandomQueue('s1', ['a', 'b'], () => 0);
  for (let step = 0; step < 5; step += 1) {
    queue = stepRandomQueue(queue, ['a', 'b', 'c', 'd'], 1, () => 0);
    expect(queue.eligibleIds).toEqual(['a', 'b']);
    expect(['a', 'b']).toContain(queue.currentId);
  }
  expect(stepRandomQueue(queue, ['a', 'c'], 1).eligibleIds).toEqual(['a']);
});

test('fila aleatória começa no episódio escolhido sem repeti-lo', () => {
  const fresh = queueStartingAt(undefined, 's1', ['a', 'b', 'c'], 'b', () => 0);
  expect(fresh.currentId).toBe('b');
  expect(fresh.remainingIds.sort()).toEqual(['a', 'c']);
  const moved = queueStartingAt(fresh, 's1', ['a', 'b', 'c'], 'c');
  expect(moved).toMatchObject({currentId: 'c', remainingIds: ['a'], historyIds: ['b']});
  expect(queueStartingAt(moved, 's1', ['a', 'b', 'c'], 'c')).toEqual(moved);
});

test('mantém a versão escolhida entre episódios', () => {
  const episodes = flattenSeries(series);
  expect(pickSource(episodes[1].sources, 'Legendado')?.id).toBe('e2-en');
  expect(pickSource(episodes[1].sources, 'legendado')?.id).toBe('e2-en');
  expect(pickSource(episodes[1].sources, 'Inexistente')?.id).toBe('e2-pt');
});

test('calcula o alvo de continuar assistindo', () => {
  expect(resolveResumeTarget(series, [progress('e1', 100_000, true, 1)])).toMatchObject({episode: {id: 'e2'}, positionMs: 0, sourceName: 'Legendado'});
  expect(resolveResumeTarget(series, [progress('e1', 100_000, true, 1), progress('e2', 60_000, false, 2)])).toMatchObject({episode: {id: 'e2'}, positionMs: 60_000});
  expect(resolveResumeTarget(series, [progress('e3', 100_000, true, 3)])).toBeNull();
  const movieItem = validateCatalog(movie).catalog.items[0];
  expect(resolveResumeTarget(movieItem, [{contentId: 'm1', episodeId: null, sourceId: 'src', positionMs: 40_000, durationMs: 100_000, completed: false, updatedAt: 1}])).toMatchObject({positionMs: 40_000, sourceName: 'HD'});
  expect(resolveResumeTarget(movieItem, [{contentId: 'm1', episodeId: null, sourceId: 'src', positionMs: 95_000, durationMs: 100_000, completed: true, updatedAt: 1}])).toBeNull();
});

test('monta parâmetros do player para temporada com a versão preferida', () => {
  const seasonOne = flattenSeries(series).filter(episode => episode.seasonNumber === 1);
  const params = buildPlayParams(series, {queue: seasonOne, sourceName: 'Legendado', startPositionMs: 0});
  expect(params).toMatchObject({episode: {id: 'e1'}, queueIndex: 0, source: {id: 'e1-en'}, startPositionMs: 0});
  expect(params?.queue).toHaveLength(2);
});

test('formata tempos', () => {
  expect(formatClock(3_725_000)).toBe('1:02:05');
  expect(formatClock(65_000)).toBe('1:05');
  expect(formatDuration(5400)).toBe('1 h 30 min');
  expect(formatDuration(undefined)).toBeNull();
});

test('resolve formatos públicos conhecidos do Drive', () => {
  expect(extractDriveFileId('https://drive.google.com/file/d/abc_123/view')).toBe('abc_123');
  expect(resolveMediaUrl('https://drive.google.com/open?id=abc_123', 'google-drive', '', false)).toContain('id=abc_123');
  expect(resolveMediaUrl('https://drive.google.com/file/d/abc_123/view', undefined, 'KEY', false)).toBe(
    'https://www.googleapis.com/drive/v3/files/abc_123?alt=media&supportsAllDrives=true&key=KEY',
  );
  expect(resolveMediaUrl('https://drive.google.com/file/d/abc_123/view', undefined, 'KEY', true)).toBe(
    'https://www.googleapis.com/drive/v3/files/abc_123?alt=media&supportsAllDrives=true',
  );
  expect(resolveMediaUrl('https://cdn.example/video.mp4', 'direct', 'KEY', true)).toBe('https://cdn.example/video.mp4');
  expect(requestHeadersFor('https://drive.google.com/file/d/abc_123/view', undefined, 'TOKEN')).toMatchObject({Authorization: 'Bearer TOKEN'});
  expect(requestHeadersFor('https://cdn.example/video.mp4', 'direct', 'TOKEN')).toBeUndefined();
});
