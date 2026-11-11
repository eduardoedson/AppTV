import AsyncStorage from '@react-native-async-storage/async-storage';
import {TvSchedule} from '../domain/tvSchedule';

const CATALOG_URL_KEY = 'apptv.settings.catalogUrl';
const TV_SCHEDULE_KEY = 'apptv.tv.schedule';
const NEXT_TV_SCHEDULE_KEY = 'apptv.tv.schedule.next';

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
  getNextTvSchedule: async (): Promise<TvSchedule | null> => {
    const value = await AsyncStorage.getItem(NEXT_TV_SCHEDULE_KEY);
    if (!value) return null;
    try {
      return JSON.parse(value) as TvSchedule;
    } catch {
      return null;
    }
  },
  setNextTvSchedule: (schedule: TvSchedule) =>
    AsyncStorage.setItem(NEXT_TV_SCHEDULE_KEY, JSON.stringify(schedule)),
};
