export interface PlaybackProgress {
  contentId: string;
  episodeId: string | null;
  sourceId: string;
  positionMs: number;
  durationMs: number;
  completed: boolean;
  updatedAt: number;
}

export const progressKey = (
  contentId: string,
  episodeId: string | null,
  sourceId: string,
) => `${contentId}:${episodeId ?? 'movie'}:${sourceId}`;

export const isCompleted = (positionMs: number, durationMs: number): boolean => {
  if (durationMs <= 0) return false;
  const ratioComplete = positionMs / durationMs >= 0.9;
  if (durationMs < 10 * 60_000) return ratioComplete;
  return ratioComplete || durationMs - positionMs <= 5 * 60_000;
};

export const resumablePosition = (progress?: PlaybackProgress): number => {
  if (!progress || progress.completed || progress.positionMs < 30_000) return 0;
  return progress.positionMs;
};

export const progressRatio = (progress?: PlaybackProgress): number => {
  if (!progress || progress.durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, progress.positionMs / progress.durationMs));
};

// Decides which episode plays next in a series
export type PlayMode = 'sequential' | 'random';

export interface PersistedRandomQueue {
  seriesId: string;
  eligibleIds: string[];
  remainingIds: string[];
  historyIds: string[];
  currentId: string | null;
  updatedAt: number;
}
