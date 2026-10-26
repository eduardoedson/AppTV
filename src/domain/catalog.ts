export type MediaProvider = 'direct' | 'google-drive';

export interface MediaSource {
  id: string;
  name: string;
  url: string;
  detail?: string;
  language?: string;
  quality?: string;
  mimeType?: string;
  provider?: MediaProvider;
}

export interface CatalogBaseItem {
  id: string;
  title: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  addedAt?: string;
  genres?: string[];
}

export interface Movie extends CatalogBaseItem {
  type: 'movie';
  year?: number;
  duration?: number;
  sources: MediaSource[];
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  description?: string;
  thumbnail?: string;
  duration?: number;
  sources: MediaSource[];
}

export interface Season {
  number: number;
  name?: string;
  episodes: Episode[];
}

export interface Series extends CatalogBaseItem {
  type: 'series';
  seasons: Season[];
}

export type CatalogItem = Movie | Series;

export interface Catalog {
  version: 1;
  items: CatalogItem[];
}

export interface CatalogDiagnostic {
  path: string;
  message: string;
}

export interface ValidatedCatalog {
  catalog: Catalog;
  diagnostics: CatalogDiagnostic[];
}

export interface PlayableEpisode extends Episode {
  contentId: string;
  seriesTitle: string;
  seasonNumber: number;
}

export const flattenSeries = (series: Series): PlayableEpisode[] =>
  [...series.seasons]
    .sort((a, b) => a.number - b.number)
    .flatMap(season =>
      [...season.episodes]
        .sort((a, b) => a.number - b.number)
        .map(episode => ({
          ...episode,
          contentId: series.id,
          seriesTitle: series.title,
          seasonNumber: season.number,
        })),
    );

// Picks the source matching the preferred version name (for example "Dublado"), falling back to the first one.
export const pickSource = (sources: MediaSource[], preferredName?: string | null): MediaSource | undefined => {
  if (preferredName) {
    const exact = sources.find(source => source.name === preferredName);
    if (exact) return exact;
    const normalized = preferredName.trim().toLocaleLowerCase();
    const loose = sources.find(source => source.name.trim().toLocaleLowerCase() === normalized);
    if (loose) return loose;
  }
  return sources[0];
};

// Distinct version names available for a movie or across all episodes of a series.
export const sourceNames = (item: CatalogItem): string[] => {
  const names =
    item.type === 'movie'
      ? item.sources.map(source => source.name)
      : item.seasons.flatMap(season => season.episodes.flatMap(episode => episode.sources.map(source => source.name)));
  return [...new Set(names)];
};

export const sourceLabel = (source: MediaSource): string => {
  const extra = source.detail ?? [source.language, source.quality].filter(Boolean).join(' • ');
  return extra ? `${source.name} • ${extra}` : source.name;
};
