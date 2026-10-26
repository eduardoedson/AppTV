import {CatalogItem, flattenSeries, PlayableEpisode, pickSource} from '../domain/catalog';
import {PlayerParams} from '../navigation/types';

export interface LaunchOptions {
  episode?: PlayableEpisode;
  queue?: PlayableEpisode[];
  // Undefined resumes from saved progress, 0 forces the beginning.
  startPositionMs?: number;
}

export interface BuildPlayOptions extends LaunchOptions {
  sourceName?: string | null;
}

// Builds the Player route params for a movie or an episode inside a sequential queue.
export const buildPlayParams = (item: CatalogItem, options: BuildPlayOptions = {}): PlayerParams | null => {
  if (item.type === 'movie') {
    const source = pickSource(item.sources, options.sourceName);
    if (!source) return null;
    return {contentId: item.id, title: item.title, source, startPositionMs: options.startPositionMs};
  }

  let queue = options.queue?.length ? options.queue : flattenSeries(item);
  const episode = options.episode ?? queue[0];
  if (!episode) return null;
  let queueIndex = queue.findIndex(candidate => candidate.id === episode.id);
  if (queueIndex < 0) {
    queue = flattenSeries(item);
    queueIndex = queue.findIndex(candidate => candidate.id === episode.id);
  }
  if (queueIndex < 0) return null;

  const source = pickSource(episode.sources, options.sourceName);
  if (!source) return null;
  return {
    contentId: item.id,
    title: item.title,
    episode,
    source,
    queue,
    queueIndex,
    startPositionMs: options.startPositionMs,
  };
};
