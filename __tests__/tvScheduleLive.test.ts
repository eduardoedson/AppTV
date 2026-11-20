import {Catalog, CatalogItem, isInLiveTv} from '../src/domain/catalog';
import {catalogSignature, createDailyTvSchedule, isCurrentTvSchedule} from '../src/domain/tvSchedule';
import {validateCatalog} from '../src/catalog/validator';

const series = (id: string, live?: boolean): CatalogItem => ({
  id,
  type: 'series',
  title: id,
  ...(live === undefined ? {} : {live}),
  seasons: [
    {
      number: 1,
      episodes: [1, 2, 3].map(number => ({
        id: `s01e0${number}`,
        number,
        title: `Episódio ${number}`,
        duration: 1300,
        sources: [{id: `s01e0${number}`, name: 'Dublado', url: `https://example.com/${id}/${number}.mp4`}],
      })),
    },
  ],
});

const movie = (id: string, live?: boolean): CatalogItem => ({
  id,
  type: 'movie',
  title: id,
  duration: 5400,
  ...(live === undefined ? {} : {live}),
  sources: [{id: `${id}-src`, name: 'Dublado', url: `https://example.com/${id}.mp4`}],
});

const catalogOf = (...items: CatalogItem[]): Catalog => ({version: 1, items});
const NOON = new Date(2026, 10, 13, 12, 0, 0).getTime();

describe('live flag in the catalog', () => {
  it('keeps items with live false out of the schedule', () => {
    const catalog = catalogOf(series('in-live'), series('hidden', false), movie('film', false), movie('film-live', true));
    const schedule = createDailyTvSchedule(catalog, NOON);
    const ids = new Set(schedule.entries.map(entry => entry.contentId));
    expect(ids.has('hidden')).toBe(false);
    expect(ids.has('film')).toBe(false);
    expect(ids.has('in-live')).toBe(true);
    expect(ids.has('film-live')).toBe(true);
  });

  it('treats a missing flag as part of the live TV', () => {
    expect(isInLiveTv(series('a'))).toBe(true);
    expect(isInLiveTv(series('b', true))).toBe(true);
    expect(isInLiveTv(series('c', false))).toBe(false);
  });

  it('rebuilds the saved schedule when an item leaves the live TV', () => {
    const before = catalogOf(series('a'), series('b'));
    const after = catalogOf(series('a'), series('b', false));
    expect(catalogSignature(before)).not.toBe(catalogSignature(after));
    const schedule = createDailyTvSchedule(before, NOON);
    expect(isCurrentTvSchedule(schedule, before, NOON)).toBe(true);
    expect(isCurrentTvSchedule(schedule, after, NOON)).toBe(false);
  });

  it('fails clearly when every item is out of the live TV', () => {
    expect(() => createDailyTvSchedule(catalogOf(series('a', false)), NOON)).toThrow();
  });

  it('accepts the flag in the catalog and rejects a non boolean value', () => {
    const valid = validateCatalog({version: 1, items: [series('a', false), movie('m', false)]});
    expect(valid.diagnostics).toHaveLength(0);
    const invalid = validateCatalog({version: 1, items: [{...series('a'), live: 'no'}, series('b')]});
    expect(invalid.catalog.items.map(item => item.id)).toEqual(['b']);
  });
});

describe('movie spacing in the live schedule', () => {
  it('places between 5 and 8 series episodes between consecutive movies', () => {
    const catalog = catalogOf(
      series('series-a'),
      series('series-b'),
      movie('movie-a'),
      movie('movie-b'),
      movie('movie-c'),
    );
    const entries = createDailyTvSchedule(catalog, NOON).entries;
    const movieIndexes = entries
      .map((entry, index) => entry.episode ? -1 : index)
      .filter(index => index >= 0);

    expect(movieIndexes.length).toBeGreaterThan(2);
    for (let index = 1; index < movieIndexes.length; index += 1) {
      const between = entries.slice(movieIndexes[index - 1] + 1, movieIndexes[index]);
      expect(between.every(entry => Boolean(entry.episode))).toBe(true);
      expect(between.length).toBeGreaterThanOrEqual(5);
      expect(between.length).toBeLessThanOrEqual(8);
    }
  });

  it('keeps a series-only schedule working when movies are disabled', () => {
    const entries = createDailyTvSchedule(catalogOf(series('series-a')), NOON, {contentMode: 'series'}).entries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => Boolean(entry.episode))).toBe(true);
  });

  it('supports Todos, Filmes and Séries as distinct schedule modes', () => {
    const catalog = catalogOf(series('series-a'), movie('movie-a'));
    const all = createDailyTvSchedule(catalog, NOON, {contentMode: 'all'});
    const movies = createDailyTvSchedule(catalog, NOON, {contentMode: 'movies'});
    const seriesOnly = createDailyTvSchedule(catalog, NOON, {contentMode: 'series'});

    expect(all.entries.some(entry => Boolean(entry.episode))).toBe(true);
    expect(all.entries.some(entry => !entry.episode)).toBe(true);
    expect(movies.entries.every(entry => !entry.episode)).toBe(true);
    expect(seriesOnly.entries.every(entry => Boolean(entry.episode))).toBe(true);
    expect(isCurrentTvSchedule(movies, catalog, NOON, {contentMode: 'movies'})).toBe(true);
    expect(isCurrentTvSchedule(movies, catalog, NOON, {contentMode: 'all'})).toBe(false);
  });
});
