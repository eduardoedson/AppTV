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
  version: 4;
  date: string;
  generatedAt: string;
  catalogSignature: string;
  entries: TvScheduleEntry[];
}

// Schedule entries may use an estimated duration. Keep the live offset inside
// the real media duration so the player never starts past the end of a file.
export const livePositionForDuration = (
  elapsedMs: number,
  durationMs: number,
): number => {
  if (durationMs <= 0) return 0;
  return Math.max(0, elapsedMs) % durationMs;
};

interface Candidate {
  contentId: string;
  title: string;
  episode?: PlayableEpisode;
  source: MediaSource;
  durationSeconds: number;
  estimatedDuration: boolean;
}

// Used only when the catalog omits duration. A generous slot is preferable to
// cutting longer episodes in the middle. When the file is shorter, the live
// player repeats it until the next wall-clock slot.
const MOVIE_FALLBACK_SECONDS = 100 * 60;
const EPISODE_FALLBACK_SECONDS = 60 * 60;

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
        ? `${item.id}:${item.sources.length}:${item.duration ?? 0}`
        : `${item.id}:${flattenSeries(item)
            .map(episode => `${episode.id}:${episode.duration ?? 0}`)
            .join(',')}`,
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

const shuffle = <T>(values: T[], random: () => number): T[] => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
};

// Pick titles in balanced rounds. Episodes are shuffled independently inside
// each series, so a series with hundreds of episodes does not crowd out a
// movie or a shorter series.
const balancedCandidates = (
  pool: Candidate[],
  random: () => number,
  initialCounts: Map<string, number> = new Map(),
) => {
  const groups = new Map<string, Candidate[]>();
  pool.forEach(candidate => {
    const group = groups.get(candidate.contentId) ?? [];
    group.push(candidate);
    groups.set(candidate.contentId, group);
  });
  const queues = new Map<string, Candidate[]>();
  const counts = new Map(
    [...groups.keys()].map(id => [id, initialCounts.get(id) ?? 0]),
  );

  return (): Candidate => {
    const leastUsed = Math.min(...counts.values());
    const eligible = shuffle(
      [...groups.keys()].filter(id => counts.get(id) === leastUsed),
      random,
    );
    const contentId = eligible[0];
    let queue = queues.get(contentId) ?? [];
    if (!queue.length) queue = shuffle(groups.get(contentId)!, random);
    const candidate = queue.shift()!;
    queues.set(contentId, queue);
    counts.set(contentId, (counts.get(contentId) ?? 0) + 1);
    return candidate;
  };
};

const fillSchedule = (
  pool: Candidate[],
  random: () => number,
  date: string,
  startMs: number,
  endMs: number,
  startNumber = 1,
  initialCounts: Map<string, number> = new Map(),
): TvScheduleEntry[] => {
  const pickNext = balancedCandidates(pool, random, initialCounts);
  const entries: TvScheduleEntry[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const candidate = pickNext();
    // The boundary determines when to stop adding entries, not when to cut the
    // last one. A film or episode that starts before midnight plays to its end.
    const scheduledSeconds = candidate.durationSeconds;
    const next = cursor + scheduledSeconds * 1000;
    entries.push({
      ...candidate,
      id: `${date}-${String(startNumber + entries.length).padStart(3, '0')}`,
      startAt: new Date(cursor).toISOString(),
      endAt: new Date(next).toISOString(),
      durationSeconds: scheduledSeconds,
    });
    cursor = next;
  }
  return entries;
};

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
  const entries = fillSchedule(pool, random, date, startMs, endMs);

  return {
    version: 4,
    date,
    generatedAt: new Date(timestamp).toISOString(),
    catalogSignature: signature,
    entries,
  };
};

export const extendTvSchedule = (
  schedule: TvSchedule,
  catalog: Catalog,
  timestamp = Date.now(),
): TvSchedule => {
  const pool = candidatesFor(catalog);
  if (!pool.length) return schedule;
  const lastEnd = Date.parse(schedule.entries.at(-1)?.endAt ?? '');
  const startMs = Number.isFinite(lastEnd) ? lastEnd : timestamp;
  const counts = schedule.entries.reduce((result, entry) => {
    result.set(entry.contentId, (result.get(entry.contentId) ?? 0) + 1);
    return result;
  }, new Map<string, number>());
  const random = seededRandom(hash(`${schedule.date}:extend:${startMs}:${schedule.entries.length}`));
  const appended = fillSchedule(
    pool,
    random,
    schedule.date,
    startMs,
    startMs + 24 * 60 * 60 * 1000,
    schedule.entries.length + 1,
    counts,
  );
  return {
    ...schedule,
    generatedAt: new Date(timestamp).toISOString(),
    entries: [...schedule.entries, ...appended],
  };
};

export const shouldPrepareNextTvSchedule = (
  schedule: TvSchedule,
  currentIndex: number,
): boolean => schedule.entries.length - currentIndex <= 5;

export const promoteTvScheduleEntry = (
  schedule: TvSchedule,
  catalog: Catalog,
  selectedIndex: number,
  timestamp = Date.now(),
): TvSchedule => {
  const currentIndex = currentTvEntryIndex(schedule, timestamp);
  const selected = schedule.entries[selectedIndex];
  if (!selected || selectedIndex <= currentIndex) return schedule;

  const pool = candidatesFor(catalog);
  const endMs = timestamp + 24 * 60 * 60 * 1000;
  const counts = new Map<string, number>();
  counts.set(selected.contentId, 1);

  const selectedDuration = selected.durationSeconds;
  const promoted: TvScheduleEntry = {
    ...selected,
    id: `${schedule.date}-001`,
    startAt: new Date(timestamp).toISOString(),
    endAt: new Date(timestamp + selectedDuration * 1000).toISOString(),
    durationSeconds: selectedDuration,
  };
  const random = seededRandom(hash(`${schedule.date}:${timestamp}:${selected.id}`));
  const rest = fillSchedule(
    pool,
    random,
    schedule.date,
    Date.parse(promoted.endAt),
    endMs,
    2,
    counts,
  );
  return {
    ...schedule,
    generatedAt: new Date(timestamp).toISOString(),
    entries: [promoted, ...rest],
  };
};

export const refreshTvScheduleAfterCurrent = (
  schedule: TvSchedule,
  catalog: Catalog,
  timestamp = Date.now(),
): TvSchedule => {
  const current = schedule.entries[currentTvEntryIndex(schedule, timestamp)];
  if (!current) return schedule;

  const pool = candidatesFor(catalog);
  const endMs = timestamp + 24 * 60 * 60 * 1000;
  const refreshedCurrent: TvScheduleEntry = {
    ...current,
    id: `${schedule.date}-001`,
  };
  const counts = new Map([[current.contentId, 1]]);
  const random = seededRandom(hash(`${schedule.date}:refresh:${timestamp}:${current.id}`));
  const rest = fillSchedule(
    pool,
    random,
    schedule.date,
    Date.parse(current.endAt),
    endMs,
    2,
    counts,
  );
  return {
    ...schedule,
    generatedAt: new Date(timestamp).toISOString(),
    entries: [refreshedCurrent, ...rest],
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
      schedule.version === 4 &&
      schedule.catalogSignature === catalogSignature(catalog) &&
      schedule.entries.length &&
      timestamp >= Date.parse(schedule.entries[0].startAt) &&
      timestamp < Date.parse(schedule.entries.at(-1)!.endAt),
  );
