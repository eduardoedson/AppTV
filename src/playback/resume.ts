import {CatalogItem, flattenSeries, PlayableEpisode} from '../domain/catalog';
import {PlaybackProgress, progressRatio, resumablePosition} from '../domain/playback';

export interface ResumeTarget {
  episode?: PlayableEpisode;
  sourceName?: string;
  positionMs: number;
  ratio: number;
  updatedAt: number;
}

const newestFirst = (rows: PlaybackProgress[]) => [...rows].sort((a, b) => b.updatedAt - a.updatedAt);

// Most recent progress row per episode, regardless of the source used. Movies use the empty key.
export const latestByEpisode = (rows: PlaybackProgress[]): Map<string, PlaybackProgress> => {
  const result = new Map<string, PlaybackProgress>();
  newestFirst(rows).forEach(row => {
    const key = row.episodeId ?? '';
    if (!result.has(key)) result.set(key, row);
  });
  return result;
};

// Decides what "Continue" should play for an item, or null when there is nothing to continue.
export const resolveResumeTarget = (item: CatalogItem, rows: PlaybackProgress[]): ResumeTarget | null => {
  const latest = newestFirst(rows.filter(row => row.contentId === item.id))[0];
  if (!latest) return null;

  if (item.type === 'movie') {
    const positionMs = resumablePosition(latest);
    if (!positionMs) return null;
    return {
      sourceName: item.sources.find(source => source.id === latest.sourceId)?.name,
      positionMs,
      ratio: progressRatio(latest),
      updatedAt: latest.updatedAt,
    };
  }

  const episodes = flattenSeries(item);
  const index = episodes.findIndex(episode => episode.id === latest.episodeId);
  if (index < 0) return null;
  const current = episodes[index];
  const sourceName = current.sources.find(source => source.id === latest.sourceId)?.name;

  if (!latest.completed) {
    return {
      episode: current,
      sourceName,
      positionMs: resumablePosition(latest),
      ratio: progressRatio(latest),
      updatedAt: latest.updatedAt,
    };
  }

  const next = episodes[index + 1];
  if (!next) return null;
  return {episode: next, sourceName, positionMs: 0, ratio: 0, updatedAt: latest.updatedAt};
};
