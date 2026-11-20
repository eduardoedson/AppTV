import AsyncStorage from '@react-native-async-storage/async-storage';
import {TvContentMode, TvSchedule} from '../domain/tvSchedule';

const CATALOG_URL_KEY = 'apptv.settings.catalogUrl';
const TV_SCHEDULE_KEY = 'apptv.tv.schedule';
const TV_INCLUDE_MOVIES_KEY = 'apptv.tv.includeMovies';
const TV_CONTENT_MODE_KEY = 'apptv.tv.contentMode';

export const settings = {
  getCatalogUrl: () => AsyncStorage.getItem(CATALOG_URL_KEY),
  setCatalogUrl: (url: string) => AsyncStorage.setItem(CATALOG_URL_KEY, url),
  getTvSchedule: async (): Promise<TvSchedule | null> => {
    const value = await AsyncStorage.getItem(TV_SCHEDULE_KEY);
    if (!value) return null;
    try {
      return JSON.parse(value) as TvSchedule;
    } catch {
      return null;
    }
  },
  setTvSchedule: (schedule: TvSchedule) =>
    AsyncStorage.setItem(TV_SCHEDULE_KEY, JSON.stringify(schedule)),
  getTvContentMode: async (): Promise<TvContentMode> => {
    const mode = await AsyncStorage.getItem(TV_CONTENT_MODE_KEY);
    if (mode === 'all' || mode === 'movies' || mode === 'series') return mode;
    // Migrate the previous Filmes sim/não preference.
    return (await AsyncStorage.getItem(TV_INCLUDE_MOVIES_KEY)) === 'false'
      ? 'series'
      : 'all';
  },
  setTvContentMode: (mode: TvContentMode) =>
    AsyncStorage.setItem(TV_CONTENT_MODE_KEY, mode),
};
