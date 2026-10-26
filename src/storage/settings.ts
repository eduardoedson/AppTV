import AsyncStorage from '@react-native-async-storage/async-storage';

const CATALOG_URL_KEY = 'apptv.settings.catalogUrl';

export const settings = {
  getCatalogUrl: () => AsyncStorage.getItem(CATALOG_URL_KEY),
  setCatalogUrl: (url: string) => AsyncStorage.setItem(CATALOG_URL_KEY, url),
};
