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
