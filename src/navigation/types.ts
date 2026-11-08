import {MediaSource, PlayableEpisode} from '../domain/catalog';
import {TvSchedule} from '../domain/tvSchedule';

export type PlayerParams = {
  contentId: string;
  title: string;
  episode?: PlayableEpisode;
  source: MediaSource;
  queue?: PlayableEpisode[];
  queueIndex?: number;
  randomSeriesId?: string;
  // Undefined resumes from saved progress, 0 forces the beginning.
  startPositionMs?: number;
  // Episodes skipped in a row because of playback errors (stops auto skip after a limit)
  consecutiveFailures?: number;
  tvSchedule?: TvSchedule;
  tvIndex?: number;
};

export type RootStackParamList = {
  Setup: undefined;
  Library: undefined;
  TV: {showSchedule?: boolean} | undefined;
  Details: {itemId: string};
  Random: {seriesId: string};
  Player: PlayerParams;
  Update: undefined;
};
