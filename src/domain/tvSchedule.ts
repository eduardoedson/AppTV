import {
  Catalog,
  CatalogItem,
  flattenSeries,
  MediaSource,
  PlayableEpisode,
  pickSource,
} from './catalog';

export interface TvScheduleEntry {
  id: string;
  contentId: string;
  title: string;
  episode?: PlayableEpisode;
  source: MediaSource;
  startAt: string;
  endAt: string;
  durationSeconds: number;
  estimatedDuration: boolean;
}

export interface TvSchedule {
  version: 1;
  date: string;
  generatedAt: string;
  catalogSignature: string;
  entries: TvScheduleEntry[];
}

interface Candidate {
  contentId: string;
  title: string;
  episode?: PlayableEpisode;
  source: MediaSource;
  durationSeconds: number;
  estimatedDuration: boolean;
}

const MOVIE_FALLBACK_SECONDS = 2 * 60 * 60;
const EPISODE_FALLBACK_SECONDS = 45 * 60;

const localDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const tvDateKey = (timestamp = Date.now()): string =>
  localDateKey(new Date(timestamp));

export const tvDayBounds = (timestamp = Date.now()) => {
  const date = new Date(timestamp);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {startMs: start.getTime(), endMs: end.getTime()};
};

export const catalogSignature = (catalog: Catalog): string =>
  catalog.items
    .map(item =>
      item.type === 'movie'
        ? `${item.id}:${item.sources.length}`
        : `${item.id}:${flattenSeries(item).length}`,
    )
    .join('|');

const hash = (value: string): number => {
  let result = 7;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return result;
};

const seededRandom = (seed: number) => {
  let value = seed % 2147483647 || 1;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const candidatesFor = (catalog: Catalog): Candidate[] =>
  catalog.items.flatMap((item: CatalogItem): Candidate[] => {
    if (item.type === 'movie') {
      const source = pickSource(item.sources);
      if (!source) return [];
      return [{
        contentId: item.id,
        title: item.title,
        source,
        durationSeconds: item.duration || MOVIE_FALLBACK_SECONDS,
        estimatedDuration: !item.duration,
      }];
    }
    return flattenSeries(item).flatMap(episode => {
      const source = pickSource(episode.sources);
      if (!source) return [];
      return [{
        contentId: item.id,
        title: item.title,
        episode,
        source,
        durationSeconds: episode.duration || EPISODE_FALLBACK_SECONDS,
        estimatedDuration: !episode.duration,
      }];
    });
  });

export const createDailyTvSchedule = (
  catalog: Catalog,
  timestamp = Date.now(),
): TvSchedule => {
  const date = tvDateKey(timestamp);
  const signature = catalogSignature(catalog);
  const pool = candidatesFor(catalog);
  if (!pool.length) throw new Error('A biblioteca não possui vídeos para a TV.');

  const random = seededRandom(hash(`${date}:${signature}`));
  const {startMs, endMs} = tvDayBounds(timestamp);
  const requiredSeconds = Math.ceil((endMs - startMs) / 1000);
  const availableSeconds = pool.reduce(
    (total, candidate) => total + candidate.durationSeconds,
    0,
  );
  if (availableSeconds < requiredSeconds)
    throw new Error(
      'A biblioteca não possui 24 horas de conteúdo único para montar a programação sem repetições.',
    );

  // Movies and episodes share one pool. A seeded Fisher-Yates shuffle makes the
  // order stable for the whole day while consuming every item at most once.
  const shuffled = [...pool];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  const entries: TvScheduleEntry[] = [];
  let cursor = startMs;
  let poolIndex = 0;

  while (cursor < endMs) {
    const candidate = shuffled[poolIndex];
    poolIndex += 1;
    const scheduledSeconds = Math.min(
      candidate.durationSeconds,
      Math.ceil((endMs - cursor) / 1000),
    );
    const next = cursor + scheduledSeconds * 1000;
    entries.push({
      ...candidate,
      id: `${date}-${String(entries.length + 1).padStart(3, '0')}`,
      startAt: new Date(cursor).toISOString(),
      endAt: new Date(next).toISOString(),
      durationSeconds: scheduledSeconds,
    });
    cursor = next;
  }

  return {
    version: 1,
    date,
    generatedAt: new Date(timestamp).toISOString(),
    catalogSignature: signature,
    entries,
  };
};

export const currentTvEntryIndex = (
  schedule: TvSchedule,
  timestamp = Date.now(),
): number => {
  const index = schedule.entries.findIndex(
    entry =>
      timestamp >= Date.parse(entry.startAt) && timestamp < Date.parse(entry.endAt),
  );
  return index >= 0 ? index : 0;
};

export const isCurrentTvSchedule = (
  schedule: TvSchedule | null,
  catalog: Catalog,
  timestamp = Date.now(),
): schedule is TvSchedule =>
  Boolean(
    schedule &&
      schedule.version === 1 &&
      schedule.date === tvDateKey(timestamp) &&
      schedule.catalogSignature === catalogSignature(catalog) &&
      schedule.entries.length,
  );
