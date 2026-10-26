import AsyncStorage from '@react-native-async-storage/async-storage';
import {Catalog, ValidatedCatalog} from '../domain/catalog';
import {validateCatalog} from './validator';
import {resolveDriveRequest} from '../services/driveRequest';

const CACHE_KEY = 'apptv.catalog.v1';
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;

export const assertCatalogUrl = (url: string) => {
  const trimmed = url.trim();
  if (!/^https:\/\/[^\s]+$/i.test(trimmed)) throw new Error('A URL do catálogo deve usar HTTPS.');
  return trimmed;
};

export const loadCachedCatalog = async (): Promise<Catalog | null> => {
  const cached = await AsyncStorage.getItem(CACHE_KEY);
  if (!cached) return null;
  try {
    return validateCatalog(JSON.parse(cached)).catalog;
  } catch {
    return null;
  }
};

export const fetchCatalog = async (url: string): Promise<ValidatedCatalog> => {
  // With Google login configured, Drive catalogs are read through the API, so the file can stay private
  const request = await resolveDriveRequest(assertCatalogUrl(url));
  const target = request.url;
  const headers: Record<string, string> = {Accept: 'application/json', ...request.headers};
  const response = await fetch(target, {headers});
  if (!response.ok) throw new Error(`Falha ao baixar catálogo (HTTP ${response.status}).`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_CATALOG_BYTES) throw new Error('O catálogo excede o limite de 5 MB.');
  const text = await response.text();
  if (encodeURIComponent(text).replace(/%[0-9A-F]{2}|./gi, 'x').length > MAX_CATALOG_BYTES) throw new Error('O catálogo excede o limite de 5 MB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Private Google Drive files return a sign-in HTML page instead of the JSON content
    throw new Error('O catálogo não é um JSON válido. Se estiver no Google Drive, configure o login (npm run google:login) ou compartilhe como "Qualquer pessoa com o link".');
  }
  const result = validateCatalog(parsed);
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(result.catalog));
  return result;
};

